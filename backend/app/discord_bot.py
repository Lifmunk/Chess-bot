from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

import discord
from discord import app_commands
from discord.ext import commands, tasks

from .config import Settings
from . import db
from .services.chesscom import build_stats_summary, fetch_chesscom_stats
from .services.lichess import fetch_daily_puzzle, puzzle_message, render_puzzle_jpg
from .services.ai_service import ai_service


logger = logging.getLogger(__name__)


class ChessClubBot(commands.Bot):
    def __init__(self, settings: Settings):
        intents = discord.Intents.default()
        intents.guilds = True
        intents.members = True  # Required for role assignment and member lookups
        super().__init__(command_prefix="!", intents=intents)
        self.settings = settings
        self._ready_event = asyncio.Event()
        self.dynamic_settings: dict[str, Any] = {}

    async def refresh_settings(self) -> None:
        self.dynamic_settings = await db.get_app_settings()
        logger.info("Dynamic settings refreshed: %s", self.dynamic_settings)

    async def setup_hook(self) -> None:
        await self.refresh_settings()
        guild_id = self.dynamic_settings.get("discord_guild_id")
        
        if guild_id:
            try:
                guild = discord.Object(id=int(guild_id))
                # To prevent duplicates (global + guild), we clear global commands first
                self.tree.clear_commands(guild=None)
                await self.tree.sync() 
                
                self.tree.copy_global_to(guild=guild)
                await self.tree.sync(guild=guild)
                logger.info("Commands synced to guild %s (global cleared)", guild_id)
            except Exception as e:
                logger.warning("Failed to sync commands to guild %s: %s", guild_id, e)
        else:
            await self.tree.sync()
            logger.info("Commands synced globally")
        
        if not self.daily_puzzle_loop.is_running():
            self.daily_puzzle_loop.start()
        
        if not self.club_verification_loop.is_running():
            self.club_verification_loop.start()
            
        if not self.rating_roles_loop.is_running():
            self.rating_roles_loop.start()

        if not self.monitoring_loop.is_running():
            self.monitoring_loop.start()
            
        if not self.weekly_report_loop.is_running():
            self.weekly_report_loop.start()

    async def on_ready(self) -> None:
        logger.info("Discord bot ready as %s", self.user)
        self._ready_event.set()
        # Start greeting task
        asyncio.create_task(self.delayed_greeting())

    async def delayed_greeting(self) -> None:
        await asyncio.sleep(300) # 5 minutes wait
        await self.refresh_settings()
        channel_id = self.dynamic_settings.get("discord_greeting_channel_id")
        if channel_id:
            message = self.dynamic_settings.get("bot_greeting_message") or "Grandmaster is online and ready for some chess! ♟️"
            try:
                await self.safe_send(int(channel_id), content=message)
                logger.info("Sent startup greeting to channel %s", channel_id)
            except Exception as e:
                logger.error("Failed to send startup greeting: %s", e)

    async def wait_until_bot_ready(self) -> None:
        await self._ready_event.wait()

    def announcement_mention(self) -> str:
        role_id = self.dynamic_settings.get("discord_players_role_id")
        if role_id:
            return f"<@&{role_id}>"
        return "@players"

    def announcement_channel_id(self) -> int:
        return int(self.dynamic_settings.get("discord_announcement_channel_id") or self.dynamic_settings.get("discord_puzzle_channel_id") or 0)

    def results_channel_id(self) -> int:
        return int(self.dynamic_settings.get("discord_results_channel_id") or self.announcement_channel_id())

    def puzzle_channel_id(self) -> int:
        return int(self.dynamic_settings.get("discord_puzzle_channel_id") or self.announcement_channel_id())

    async def safe_send(self, channel_id: int, content: str | None = None, *, embed: discord.Embed | None = None, file: discord.File | None = None) -> None:
        if not channel_id:
            return
        channel = self.get_channel(channel_id)
        if channel is None:
            try:
                channel = await self.fetch_channel(channel_id)
            except discord.HTTPException:
                logger.warning("Unable to fetch Discord channel %s", channel_id)
                return

        if hasattr(channel, "send"):
            try:
                await channel.send(
                    content=content,
                    embed=embed,
                    file=file,
                    allowed_mentions=discord.AllowedMentions(roles=True)
                )
            except discord.Forbidden:
                logger.error(
                    "Permission denied when sending message to channel %s. "
                    "Ensure the bot has 'Send Messages', 'Embed Links', and 'Mention @everyone, @here, and All Roles' permissions.",
                    channel_id
                )
            except Exception as e:
                logger.error("Unexpected error sending Discord message: %s", e)

    async def announce_tournament_created(self, tournament: dict[str, Any]) -> None:
        ai_description = await ai_service.generate_message("tournament_created", tournament)
        embed = discord.Embed(
            title=f"Tournament: {tournament['name']}",
            description=ai_description,
            color=discord.Color.blue(),
        )
        embed.add_field(name="Format", value=tournament["format"], inline=True)
        embed.add_field(name="Time Control", value=tournament.get("time_control", "10 min"), inline=True)
        embed.add_field(name="Rated", value="Yes" if tournament["rated"] else "No", inline=True)
        
        if tournament.get("scheduled_for"):
            embed.add_field(name="Scheduled start", value=f"<t:{int(tournament['scheduled_for'].timestamp())}:F>", inline=False)
        
        if tournament.get("rules"):
            embed.add_field(name="Rules", value=tournament["rules"][:1024], inline=False)
        
        embed.add_field(name="Link", value=f"[Open Chess.com tournament]({tournament['chesscom_link']})", inline=False)
        
        if tournament.get("notes"):
            embed.add_field(name="Staff Notes", value=tournament["notes"][:1024], inline=False)

        await self.safe_send(self.announcement_channel_id(), content=self.announcement_mention(), embed=embed)

    async def announce_tournament_started(self, tournament: dict[str, Any]) -> None:
        ai_description = await ai_service.generate_message("tournament_started", tournament)
        embed = discord.Embed(
            title="Tournament started",
            description=ai_description,
            color=discord.Color.green(),
        )
        embed.add_field(name="Tournament ID", value=tournament["tournament_id"], inline=True)
        embed.add_field(name="Link", value=f"[Open Chess.com tournament]({tournament['chesscom_link']})", inline=False)
        await self.safe_send(self.announcement_channel_id(), content=self.announcement_mention(), embed=embed)

    async def announce_tournament_results(self, tournament: dict[str, Any]) -> None:
        ai_description = await ai_service.generate_message("tournament_finished", tournament)
        embed = discord.Embed(
            title="Tournament results",
            description=ai_description,
            color=discord.Color.gold(),
        )

        # Ping the winner if linked
        winner_ping = ""
        winner_username = tournament.get("winner")
        if winner_username:
            discord_id = await db.get_user_by_chesscom(winner_username)
            if discord_id:
                winner_ping = f" Congratulations <@{discord_id}>!"

        await self.safe_send(
            self.results_channel_id(),
            content=f"{self.announcement_mention()} Tournament results are available.{winner_ping}",
            embed=embed,
        )

        # Assign champion role if configured
        champion_role_id = self.dynamic_settings.get("discord_champion_role_id")
        guild_id = self.dynamic_settings.get("discord_guild_id")
        if winner_username and champion_role_id and guild_id:
            discord_id = await db.get_user_by_chesscom(winner_username)
            if discord_id:
                guild = self.get_guild(int(guild_id))
                if guild:
                    try:
                        member = guild.get_member(int(discord_id)) or await guild.fetch_member(int(discord_id))
                        role = guild.get_role(int(champion_role_id))
                        if member and role:
                            await member.add_roles(role)
                            logger.info("Assigned Champion role to %s", member.display_name)
                    except Exception as e:
                        logger.warning("Failed to assign Champion role: %s", e)

    async def announce_tournament_reminder(self, tournament: dict[str, Any], time_left: str) -> None:
        context = {**tournament, "time_left": time_left}
        ai_description = await ai_service.generate_message("reminder", context)
        embed = discord.Embed(
            title=f"Tournament Reminder: {tournament['name']}",
            description=ai_description,
            color=discord.Color.orange(),
        )
        embed.add_field(name="Starts in", value=time_left, inline=True)
        embed.add_field(name="Link", value=f"[Open Chess.com tournament]({tournament['chesscom_link']})", inline=False)
        await self.safe_send(self.announcement_channel_id(), content=self.announcement_mention(), embed=embed)

    async def announce_opening(self, opening_data: dict[str, Any]) -> None:
        channel_id = self.dynamic_settings.get("discord_opening_channel_id")
        if not channel_id:
            logger.warning("No opening channel ID configured.")
            return

        embed = discord.Embed(
            title=f"Opening of the Week: {opening_data['name']}",
            description=opening_data["summary"],
            color=discord.Color.blue(),
        )
        embed.add_field(name="Moves", value=f"`{opening_data['moves']}`", inline=False)
        embed.add_field(name="ECO", value=opening_data["eco"], inline=True)
        embed.add_field(name="Lichess Study", value=f"[Click to Study]({opening_data['lichess_study_url']})", inline=True)
        
        message = "♟️ **New Week, New Opening!**\nOur goal this week is to master this opening for our Sunday 1+0 Arena!"
        await self.safe_send(int(channel_id), content=message, embed=embed)

    async def post_daily_puzzle(self) -> None:
        try:
            puzzle = await fetch_daily_puzzle()
        except Exception:
            logger.exception("Failed to fetch daily puzzle")
            return

        content = puzzle_message(puzzle)
        # Store solution for interactive solving
        await db.set_active_puzzle(puzzle.puzzle_id, puzzle.solution)

        await self.safe_send(self.puzzle_channel_id(), content=content)

    @tasks.loop(hours=24)
    async def daily_puzzle_loop(self) -> None:
        await self.post_daily_puzzle()

    @tasks.loop(hours=24)
    async def club_verification_loop(self) -> None:
        """Periodically verify linked users are still in the Chess.com club."""
        guild_id = self.dynamic_settings.get("discord_guild_id")
        verified_role_id = self.dynamic_settings.get("discord_verified_role_id")
        club_id = self.dynamic_settings.get("chesscom_club_id")

        if not (guild_id and verified_role_id and club_id):
            return

        guild = self.get_guild(int(guild_id))
        if not guild:
            return

        role = guild.get_role(int(verified_role_id))
        if not role:
            return

        from .services.chesscom import is_player_in_club
        users = await db.list_users()

        for user in users:
            discord_id = user["discord_id"]
            username = user["chesscom_username"]

            in_club = await is_player_in_club(username, club_id)
            if not in_club:
                member = guild.get_member(int(discord_id)) or await guild.fetch_member(int(discord_id))
                if member and role in member.roles:
                    try:
                        await member.remove_roles(role, reason=f"User {username} no longer in Chess.com club")
                        logger.info("Removed verified role from %s (not in club)", member.display_name)
                    except Exception as e:
                        logger.warning("Failed to remove verified role from %s: %s", member.display_name, e)

    @tasks.loop(hours=6)
    async def monitoring_loop(self) -> None:
        """Fair play monitoring and rating snapshotting."""
        guild_id = self.dynamic_settings.get("discord_guild_id")
        if not guild_id:
            return

        guild = self.get_guild(int(guild_id))
        if not guild:
            return

        users = await db.list_users()
        for user in users:
            discord_id = user["discord_id"]
            username = user["chesscom_username"]

            try:
                stats = await fetch_chesscom_stats(username)
                profile = stats.profile
                status = profile.get("status", "unknown")

                # Rating for snapshots
                rapid = stats.stats.get("chess_rapid", {}).get("last", {}).get("rating", 0)
                blitz = stats.stats.get("chess_blitz", {}).get("last", {}).get("rating", 0)
                rating = max(rapid, blitz)

                prev = await db.update_player_snapshot(discord_id, username, status, rating)

                # Fair Play Check
                if "closed:fair_play_violations" in status.lower():
                    if not prev or "closed:fair_play_violations" not in prev.get("status", "").lower():
                        # New violation detected
                        msg = f"⚠️ **Fair Play Violation Detected!**\nUser `{username}` (<@{discord_id}>) has had their Chess.com account closed for fair play violations."
                        await self.safe_send(self.results_channel_id(), content=msg)
                        logger.warning("Fair play violation: %s", username)

            except Exception as e:
                logger.warning("Monitoring error for %s: %s", username, e)

    @tasks.loop(hours=12)
    async def rating_roles_loop(self) -> None:
        """Automatically update roles based on Chess.com ratings."""
        guild_id = self.dynamic_settings.get("discord_guild_id")
        if not guild_id:
            return

        guild = self.get_guild(int(guild_id))
        if not guild:
            return

        # Mapping of Rating -> Role ID (from settings)
        role_mapping = {
            "discord_expert_role_id": 2000,
            "discord_intermediate_role_id": 1200,
            "discord_beginner_role_id": 0
        }

        roles = {}
        for key, min_rating in role_mapping.items():
            role_id = self.dynamic_settings.get(key)
            if role_id:
                role = guild.get_role(int(role_id))
                if role:
                    roles[min_rating] = role

        if not roles:
            return

        users = await db.list_users()
        for user in users:
            discord_id = user["discord_id"]
            username = user["chesscom_username"]

            try:
                # We can use the snapshot rating if fresh enough, but let's fetch for accuracy
                stats = await fetch_chesscom_stats(username)
                rapid = stats.stats.get("chess_rapid", {}).get("last", {}).get("rating", 0)
                blitz = stats.stats.get("chess_blitz", {}).get("last", {}).get("rating", 0)
                rating = max(rapid, blitz)

                member = guild.get_member(int(discord_id)) or await guild.fetch_member(int(discord_id))
                if not member:
                    continue

                best_role = None
                for min_rating in sorted(roles.keys(), reverse=True):
                    if rating >= min_rating:
                        best_role = roles[min_rating]
                        break

                if best_role:
                    to_remove = [r for r in roles.values() if r in member.roles and r != best_role]
                    if to_remove:
                        await member.remove_roles(*to_remove)
                    if best_role not in member.roles:
                        await member.add_roles(best_role)
            except Exception:
                pass

    @tasks.loop(hours=168) # Weekly
    async def weekly_report_loop(self) -> None:
        """Generate and post weekly club performance report."""
        winners = await db.get_recent_winners(7)
        improved = await db.get_weekly_rating_diffs()

        winners_text = ", ".join([f"{w.get('winner')} ({w['name']})" for w in winners if w.get("winner")]) or "No winners this week."
        improved_text = ", ".join([f"{i['username']} (+{i['diff']})" for i in improved[:3] if i['diff'] > 0]) or "No rating gains this week."
        potw = improved[0]['username'] if improved else "None"

        context = {
            "winners": winners_text,
            "improved": improved_text,
            "potw": potw
        }

        report = await ai_service.generate_message("weekly_report", context)
        embed = discord.Embed(
            title="📊 Weekly Club Performance Report",
            description=report,
            color=discord.Color.purple()
        )
        await self.safe_send(self.announcement_channel_id(), embed=embed)

    @daily_puzzle_loop.before_loop
    async def before_daily_puzzle_loop(self) -> None:
        await self.wait_until_ready()
        now = datetime.now(timezone.utc)
        target = now.replace(
            hour=self.settings.daily_puzzle_hour_utc,
            minute=self.settings.daily_puzzle_minute_utc,
            second=0,
            microsecond=0,
        )
        if target <= now:
            target += timedelta(days=1)
        await asyncio.sleep((target - now).total_seconds())

    @club_verification_loop.before_loop
    @rating_roles_loop.before_loop
    @monitoring_loop.before_loop
    @weekly_report_loop.before_loop
    async def before_other_loops(self) -> None:
        await self.wait_until_ready()


def build_bot(settings: Settings) -> ChessClubBot:
    bot = ChessClubBot(settings)

    @bot.event
    async def on_message(message: discord.Message):
        if message.author.bot:
            return

        # Interactive Puzzle Solving
        if message.channel.id == bot.puzzle_channel_id():
            active = await db.get_active_puzzle()
            if active and active.get("solution"):
                # Check if message matches the first move of the solution
                content = message.content.strip().lower()
                solution = active["solution"]

                # Check if user already solved it
                if str(message.author.id) in active.get("solved_by", []):
                    # Silently ignore or maybe a small react?
                    return

                if content == solution[0].lower():
                    # Correct first move!
                    first_time = await db.mark_puzzle_solved(active["puzzle_id"], str(message.author.id))
                    if first_time:
                        await message.add_reaction("✅")
                        # Optional: Respond with next part or just congrats
                        if len(solution) > 1:
                            await message.reply(f"Correct! The full solution is: `{' '.join(solution)}`")
                        else:
                            await message.reply("Spot on! You solved today's puzzle.")
                elif len(content) >= 4 and any(s.lower() == content for s in solution):
                    # They sent a later move or the whole thing?
                     await message.add_reaction("❌")

        # AI Mention Logic
        if bot.user in message.mentions:
            content = message.content.replace(f"<@!{bot.user.id}>", "").replace(f"<@{bot.user.id}>", "").strip()
            if not content:
                await message.channel.send("Grandmaster is here! ♟️ How can I help you? (Ask me a chess question!)")
                return

            async with message.channel.typing():
                answer = await ai_service.ask_funny_question(content)
                await message.reply(answer)

        await bot.process_commands(message)

    @bot.tree.command(name="puzzle", description="Post today's Lichess puzzle in this channel")
    async def puzzle_command(interaction: discord.Interaction) -> None:
        await interaction.response.defer()
        try:
            puzzle = await fetch_daily_puzzle()
        except Exception:
            await interaction.followup.send("I could not fetch the puzzle right now.")
            return

        content = puzzle_message(puzzle)
        await db.set_active_puzzle(puzzle.puzzle_id, puzzle.solution)
        await interaction.followup.send(content=content)

    @bot.tree.command(name="puzzle_leaderboard", description="Show the top puzzle solvers")
    async def puzzle_leaderboard(interaction: discord.Interaction) -> None:
        leaders = await db.get_puzzle_leaderboard()
        if not leaders:
            await interaction.response.send_message("No one has solved any puzzles yet!")
            return

        lines = []
        for i, l in enumerate(leaders):
            lines.append(f"**{i+1}.** <@{l['discord_id']}> — {l['solves']} solves")

        embed = discord.Embed(
            title="🧩 Puzzle Leaderboard",
            description="\n".join(lines),
            color=discord.Color.blue()
        )
        await interaction.response.send_message(embed=embed)

    @bot.tree.command(name="compare", description="Compare your stats with another member")
    @app_commands.describe(member="The member to compare against")
    async def compare_command(interaction: discord.Interaction, member: discord.Member) -> None:
        await interaction.response.defer()

        u1 = await db.get_chesscom_username_by_discord(str(interaction.user.id))
        u2 = await db.get_chesscom_username_by_discord(str(member.id))

        if not u1:
            await interaction.followup.send("You haven't linked your account with `/link`.")
            return
        if not u2:
            await interaction.followup.send(f"{member.display_name} hasn't linked their account.")
            return

        try:
            s1 = await fetch_chesscom_stats(u1)
            s2 = await fetch_chesscom_stats(u2)
            c1 = await db.get_user_stats(u1)
            c2 = await db.get_user_stats(u2)
        except Exception:
            await interaction.followup.send("Error fetching stats.")
            return

        embed = discord.Embed(title=f"⚔️ Comparison: {u1} vs {u2}", color=discord.Color.dark_red())

        def get_r(s, k): return s.stats.get(k, {}).get("last", {}).get("rating", 0)

        lines = [
            f"**Club Wins:** {c1['wins']} vs {c2['wins']}",
            f"**Club Podiums:** {c1['podiums']} vs {c2['podiums']}",
            f"**Rapid:** {get_r(s1, 'chess_rapid')} vs {get_r(s2, 'chess_rapid')}",
            f"**Blitz:** {get_r(s1, 'chess_blitz')} vs {get_r(s2, 'chess_blitz')}",
            f"**Bullet:** {get_r(s1, 'chess_bullet')} vs {get_r(s2, 'chess_bullet')}"
        ]
        embed.description = "\n".join(lines)
        await interaction.followup.send(embed=embed)


    @bot.tree.command(name="link", description="Link your Chess.com username to your Discord account")
    @app_commands.describe(username="Your Chess.com username")
    async def link_command(interaction: discord.Interaction, username: str) -> None:
        await interaction.response.defer(ephemeral=True)
        
        # Check if user is in club
        from .services.chesscom import is_player_in_club
        club_id = bot.dynamic_settings.get("chesscom_club_id")
        in_club = await is_player_in_club(username, club_id)
        
        if not in_club:
            await interaction.followup.send(
                f"I couldn't find `{username}` in our Chess.com club. Please join the club first!", 
                ephemeral=True
            )
            return

        await db.link_user(str(interaction.user.id), username)

        role_added = False
        verified_role_id = bot.dynamic_settings.get("discord_verified_role_id")
        guild_id = bot.dynamic_settings.get("discord_guild_id")
        if verified_role_id and guild_id:
            guild = bot.get_guild(int(guild_id))
            if guild:
                member = interaction.user
                role = guild.get_role(int(verified_role_id))
                if role:
                    try:
                        await member.add_roles(role)
                        role_added = True
                    except discord.Forbidden:
                        logger.warning("Bot lacks permission to assign verified role")
                    except Exception as e:
                        logger.warning("Failed to assign verified role: %s", e)

        msg = f"Chess.com username linked: `{username}`"
        if role_added:
            msg += ". The verified role has been assigned."

        await interaction.followup.send(msg, ephemeral=True)

    @bot.tree.command(name="profile", description="Show your Chess Club profile with stats and ratings")
    @app_commands.describe(member="The member to show. Leave blank for yourself.")
    async def profile_command(interaction: discord.Interaction, member: discord.Member | None = None) -> None:
        await interaction.response.defer()
        target = member or interaction.user
        username = await db.get_chesscom_username_by_discord(str(target.id))
        
        if not username:
            await interaction.followup.send(f"{target.display_name} has not linked their Chess.com account with `/link` yet.")
            return

        try:
            stats_data = await fetch_chesscom_stats(username)
            club_stats = await db.get_user_stats(username)
        except Exception as e:
            logger.error(f"Profile error: {e}")
            await interaction.followup.send("Could not fetch profile data right now.")
            return

        summary = build_stats_summary(stats_data)
        
        embed = discord.Embed(
            title=f"Chess Club Profile: {target.display_name}",
            url=f"https://www.chess.com/member/{username}",
            color=target.color if target.color != discord.Color.default() else discord.Color.blue(),
        )
        embed.set_thumbnail(url=target.display_avatar.url)
        
        # Profile Details
        details = [
            f"**Name:** {summary.get('Name', 'Private')}",
            f"**Status:** {summary.get('Status', 'unknown')}",
            f"**Country:** {summary.get('Country', 'unknown')}",
            f"**Joined:** {summary.get('Joined', 'unknown')}",
            f"**Followers:** {summary.get('Followers', '0')}"
        ]
        embed.add_field(name="👤 Chess.com Profile", value="\n".join(details), inline=False)

        # Club Stats
        embed.add_field(name="🏆 Club Wins", value=str(club_stats["wins"]), inline=True)
        embed.add_field(name="🎖️ Podiums", value=str(club_stats["podiums"]), inline=True)
        embed.add_field(name="⭐ Username", value=username, inline=True)
        
        # Ratings
        ratings_text = []
        if "Rapid record" in summary: 
            rating = stats_data.stats.get('chess_rapid', {}).get('last', {}).get('rating', 'N/A')
            ratings_text.append(f"**Rapid:** {rating} ({summary.get('Rapid record', 'N/A').split('  ')[0]})")
        if "Blitz record" in summary: 
            rating = stats_data.stats.get('chess_blitz', {}).get('last', {}).get('rating', 'N/A')
            ratings_text.append(f"**Blitz:** {rating} ({summary.get('Blitz record', 'N/A').split('  ')[0]})")
        if "Bullet record" in summary: 
            rating = stats_data.stats.get('chess_bullet', {}).get('last', {}).get('rating', 'N/A')
            ratings_text.append(f"**Bullet:** {rating} ({summary.get('Bullet record', 'N/A').split('  ')[0]})")
        
        if ratings_text:
            embed.add_field(name="📈 Ratings & Records", value="\n".join(ratings_text), inline=False)
        
        # Recent History
        if club_stats["recent_history"]:
            history_text = []
            for t in club_stats["recent_history"]:
                place = "1st" if t.get("winner", "").lower() == username.lower() else ("2nd" if t.get("runner_up", "").lower() == username.lower() else "3rd")
                history_text.append(f"• {place} in *{t['name']}*")
            embed.add_field(name="🕒 Recent Club History", value="\n".join(history_text), inline=False)

        await interaction.followup.send(embed=embed)


    @bot.tree.command(name="trigger_puzzle", description="Admin only: Manually trigger the daily puzzle post")
    @app_commands.checks.has_permissions(administrator=True)
    async def trigger_puzzle(interaction: discord.Interaction) -> None:
        await interaction.response.send_message("Posting the daily puzzle now.", ephemeral=True)
        await bot.post_daily_puzzle()

    @bot.tree.command(name="leaderboard", description="Show the top club players by tournament wins")
    async def leaderboard_command(interaction: discord.Interaction) -> None:
        leaders = await db.get_leaderboard()
        if not leaders:
            await interaction.response.send_message("No finished tournaments are available yet.")
            return
        
        description = "\n".join([f"**{i+1}. {l['username']}** — {l['wins']} wins" for i, l in enumerate(leaders)])
        embed = discord.Embed(
            title="Chess Club leaderboard",
            description=description,
            color=discord.Color.gold(),
        )
        await interaction.response.send_message(embed=embed)

    @bot.tree.command(name="next", description="Show the details of the next scheduled tournament")
    async def next_tournament(interaction: discord.Interaction) -> None:
        tournament = await db.get_next_tournament()
        if not tournament:
            await interaction.response.send_message("No upcoming tournaments are scheduled.")
            return
        
        scheduled_for = f"<t:{int(tournament['scheduled_for'].timestamp())}:F>" if tournament['scheduled_for'] else "Not set"
        embed = discord.Embed(
            title=f"Next tournament: {tournament['name']}",
            description=(
                f"**ID:** `{tournament['tournament_id']}`\n"
                f"**Format:** {tournament['format']}\n"
                f"**Scheduled for:** {scheduled_for}\n"
                f"**Link:** [Join on Chess.com]({tournament['chesscom_link']})"
            ),
            color=discord.Color.blue(),
        )
        await interaction.response.send_message(embed=embed)

    tournament_group = app_commands.Group(name="tournament", description="Tournament helper commands")

    @tournament_group.command(name="info", description="Show a stored tournament by ID")
    @app_commands.describe(tournament_id="The unique tournament ID")
    async def tournament_info(interaction: discord.Interaction, tournament_id: str) -> None:
        tournament = await db.get_tournament(tournament_id)
        if not tournament:
            await interaction.response.send_message("Tournament not found.", ephemeral=True)
            return
        message = (
            f"**{tournament['name']}**\n"
            f"ID: `{tournament['tournament_id']}`\n"
            f"Format: `{tournament['format']}`\n"
            f"Rated: `{('Yes' if tournament['rated'] else 'No')}`\n"
            f"Status: `{tournament['status']}`\n"
            f"Chess.com: {tournament['chesscom_link']}"
        )
        await interaction.response.send_message(message, ephemeral=True)

    bot.tree.add_command(tournament_group)
    return bot
