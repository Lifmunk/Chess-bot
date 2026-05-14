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
from .services.lichess import fetch_daily_puzzle, puzzle_message, render_board_to_bytes
from .services.ai_service import ai_service


logger = logging.getLogger(__name__)


class ChessClubBot(commands.Bot):
    def __init__(self, settings: Settings):
        intents = discord.Intents.default()
        intents.guilds = True
        intents.members = True
        intents.presences = True # Required to see who is online
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
        
        # We always sync globally to ensure commands are available everywhere.
        # Global sync can take up to an hour to propagate.
        try:
            await self.tree.sync()
            logger.info("Commands synced globally")
        except Exception as e:
            logger.error("Failed to sync commands globally: %s", e)
        
        # If a specific guild is configured, we sync to it for immediate updates.
        if guild_id:
            try:
                guild = discord.Object(id=int(guild_id))
                self.tree.copy_global_to(guild=guild)
                await self.tree.sync(guild=guild)
                logger.info("Commands synced to guild %s (instant sync)", guild_id)
            except Exception as e:
                logger.warning("Failed to sync commands to guild %s: %s", guild_id, e)
        
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
        logger.info("Bot is in %s guilds", len(self.guilds))
        for guild in self.guilds:
            logger.info(" - %s (ID: %s)", guild.name, guild.id)
            
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
        await db.set_active_puzzle(puzzle.puzzle_id, puzzle.solution, puzzle.fen)

        # Render image
        image_buf = render_board_to_bytes(puzzle.fen, puzzle.last_move)
        file = discord.File(image_buf, filename=f"puzzle_{puzzle.puzzle_id}.png")

        await self.safe_send(self.puzzle_channel_id(), content=content, file=file)

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

    @bot.tree.command(name="match", description="Seek an opponent for a chess match")
    @app_commands.describe(time_control="Preferred time control (e.g., 10+0, 3+2, 1+0)")
    async def match_command(interaction: discord.Interaction, time_control: str) -> None:
        await interaction.response.defer()
        
        discord_id = str(interaction.user.id)
        username = await db.get_chesscom_username_by_discord(discord_id)
        
        if not username:
            await interaction.followup.send("You must link your Chess.com account with `/link` first.")
            return
            
        # Check if already seeking
        existing = await db.get_user_match_seek(discord_id)
        if existing:
            await interaction.followup.send(f"You are already seeking a match for `{existing['time_control']}`. Use `/match_cancel` to stop.")
            return

        try:
            stats = await fetch_chesscom_stats(username)
            # Use max of rapid/blitz for matching
            rapid = stats.stats.get("chess_rapid", {}).get("last", {}).get("rating", 1200)
            blitz = stats.stats.get("chess_blitz", {}).get("last", {}).get("rating", 1200)
            user_rating = max(rapid, blitz)
        except Exception:
            user_rating = 1200

        await db.add_match_seek(discord_id, username, user_rating, time_control)
        
        # Search for online linked users with similar rating
        guild = interaction.guild
        if not guild:
            await interaction.followup.send(f"Seeking match for `{time_control}`. (Run this in a server to find opponents)")
            return

        candidates = []
        all_linked = await db.list_users()
        linked_ids = {u["discord_id"] for u in all_linked}
        
        for member in guild.members:
            if member.bot or str(member.id) == discord_id:
                continue
            
            if str(member.id) not in linked_ids:
                continue
                
            # Check online status (needs presences intent)
            if member.status == discord.Status.offline:
                continue
                
            # Fetch candidate rating
            c_username = next(u["chesscom_username"] for u in all_linked if u["discord_id"] == str(member.id))
            try:
                # In a real high-traffic bot, we'd cache these ratings
                c_stats = await fetch_chesscom_stats(c_username)
                c_rapid = c_stats.stats.get("chess_rapid", {}).get("last", {}).get("rating", 1200)
                c_blitz = c_stats.stats.get("chess_blitz", {}).get("last", {}).get("rating", 1200)
                c_rating = max(c_rapid, c_blitz)
                
                diff = c_rating - user_rating
                if abs(diff) <= 200:
                    diff_str = f"+{diff}" if diff >= 0 else str(diff)
                    candidates.append((member, diff_str))
            except Exception:
                continue

        if not candidates:
            await interaction.followup.send(f"Challenge seek started for `{time_control}`. No similar-rated players are online right now, I will let you know if someone joins!")
            return

        pings = " ".join([m.mention for m, _ in candidates])
        lines = [f"{m.display_name} ({d})" for m, d in candidates]
        
        embed = discord.Embed(
            title="⚔️ Match Challenge Seek",
            description=f"**{interaction.user.display_name}** is looking for a **{time_control}** match!",
            color=discord.Color.red()
        )
        embed.add_field(name="Possible Opponents", value="\n".join(lines))
        embed.set_footer(text="Use /match_cancel to stop seeking.")
        
        await interaction.followup.send(content=f"{pings}\n**{interaction.user.display_name}** has challenged you!", embed=embed)

    @bot.tree.command(name="match_cancel", description="Cancel your active match challenge seek")
    async def match_cancel(interaction: discord.Interaction) -> None:
        deleted = await db.remove_match_seek(str(interaction.user.id))
        if deleted:
            await interaction.response.send_message("Your match challenge seek has been cancelled.", ephemeral=True)
        else:
            await interaction.response.send_message("You don't have an active match seek.", ephemeral=True)

    @bot.tree.command(name="help", description="List all available commands")
    async def help_command(interaction: discord.Interaction) -> None:
        embed = discord.Embed(
            title="♟️ Chess Club Bot Help",
            description="Here are the available slash commands:",
            color=discord.Color.blue()
        )
        embed.add_field(name="/match", value="Seek a chess match with similar-rated online players", inline=False)
        embed.add_field(name="/match_cancel", value="Cancel your active match seek", inline=False)
        embed.add_field(name="/profile", value="Show your Chess Club profile with stats and ratings", inline=False)
        embed.add_field(name="/rank", value="Show your current club rank and wins", inline=False)
        embed.add_field(name="/link", value="Link your Chess.com username", inline=False)
        embed.add_field(name="/leaderboard", value="Show the top club players by tournament wins", inline=False)
        embed.add_field(name="/ask", value="Ask the AI Grandmaster a question", inline=False)
        embed.add_field(name="/puzzle", value="Post today's Lichess puzzle", inline=False)
        embed.add_field(name="/puzzle_leaderboard", value="Show the top puzzle solvers", inline=False)
        embed.add_field(name="/compare", value="Compare your stats with another member", inline=False)
        embed.add_field(name="/next", value="Show the details of the next scheduled tournament", inline=False)
        embed.add_field(name="/opening", value="Show the current opening of the week", inline=False)
        embed.add_field(name="/about", value="Information about the Chess Club and Bot", inline=False)
        await interaction.response.send_message(embed=embed)

    @bot.tree.command(name="about", description="Information about the Chess Club and Bot")
    async def about_command(interaction: discord.Interaction) -> None:
        embed = discord.Embed(
            title="About Chess Club Bot",
            description="This bot is designed to manage our Chess Club activities, track tournament results, and keep the community engaged with puzzles and AI insights.",
            color=discord.Color.green()
        )
        embed.add_field(name="Features", value="• Automated Tournament Announcements\n• Chess.com Integration\n• Daily Lichess Puzzles\n• AI-powered Chess Advice", inline=False)
        embed.add_field(name="Created for", value="The Official Chess Club community.", inline=False)
        await interaction.response.send_message(embed=embed)

    @bot.tree.command(name="opening", description="Show the current opening of the week")
    async def opening_command(interaction: discord.Interaction) -> None:
        opening_data = await db.get_current_opening()
        if not opening_data:
            await interaction.response.send_message("No opening of the week has been set yet.")
            return

        embed = discord.Embed(
            title=f"Opening of the Week: {opening_data['name']}",
            description=opening_data["summary"],
            color=discord.Color.blue(),
        )
        embed.add_field(name="Moves", value=f"`{opening_data['moves']}`", inline=False)
        embed.add_field(name="ECO", value=opening_data["eco"], inline=True)
        embed.add_field(name="Lichess Study", value=f"[Click to Study]({opening_data['lichess_study_url']})", inline=True)
        await interaction.response.send_message(embed=embed)

    @bot.tree.command(name="rank", description="Show your current club rank and wins")
    async def rank_command(interaction: discord.Interaction, member: discord.Member | None = None) -> None:
        target = member or interaction.user
        username = await db.get_chesscom_username_by_discord(str(target.id))
        
        if not username:
            await interaction.response.send_message(f"{target.display_name} has not linked their account with `/link` yet.")
            return

        club_stats = await db.get_user_stats(username)
        leaders = await db.get_leaderboard(limit=100)
        
        rank = "Unranked"
        for i, l in enumerate(leaders):
            if l['username'].lower() == username.lower():
                rank = f"#{i+1}"
                break
        
        embed = discord.Embed(
            title=f"Rank: {target.display_name}",
            color=discord.Color.gold()
        )
        embed.add_field(name="Chess.com", value=username, inline=True)
        embed.add_field(name="Club Wins", value=str(club_stats["wins"]), inline=True)
        embed.add_field(name="Club Rank", value=rank, inline=True)
        await interaction.response.send_message(embed=embed)
        
    @bot.tree.command(name="sync", description="Admin only: Force sync slash commands")
    @app_commands.checks.has_permissions(administrator=True)
    async def sync_commands(interaction: discord.Interaction) -> None:
        await interaction.response.defer(ephemeral=True)
        try:
            await bot.setup_hook()
            await interaction.followup.send("Commands synced successfully!", ephemeral=True)
        except Exception as e:
            await interaction.followup.send(f"Failed to sync: {e}", ephemeral=True)

    @bot.tree.command(name="ask", description="Ask the AI Grandmaster anything chess-related")
    @app_commands.describe(question="Your question for the Grandmaster")
    async def ask_command(interaction: discord.Interaction, question: str) -> None:
        await interaction.response.defer()
        answer = await ai_service.ask_funny_question(question)
        await interaction.followup.send(answer)

    @bot.tree.command(name="solve", description="Attempt to solve the current puzzle")
    @app_commands.describe(puzzle_id="The ID of the puzzle", move="Your move in UCI format (e.g., e2e4)")
    async def solve_command(interaction: discord.Interaction, puzzle_id: str, move: str) -> None:
        # Ephemeral response to keep solving private
        await interaction.response.defer(ephemeral=True)
        
        active = await db.get_active_puzzle()
        if not active or active["puzzle_id"] != puzzle_id:
            await interaction.followup.send("This puzzle is no longer active or the ID is incorrect.", ephemeral=True)
            return
        
        attempt = await db.get_puzzle_attempt(str(interaction.user.id))
        if attempt and attempt["puzzle_id"] != puzzle_id:
            # If they start a new puzzle, clear the old one
            await db.clear_puzzle_attempt(str(interaction.user.id))
            attempt = None
            
        current_idx = attempt["current_move_index"] if attempt else 0
        solution = active["solution"]
        
        user_move = move.strip().lower()
        
        if user_move == solution[current_idx].lower():
            # Correct move!
            points = 1
            is_last = (current_idx + 1) >= len(solution)
            
            if is_last:
                points += 5 # Bonus for completing
                await db.mark_puzzle_solved(puzzle_id, str(interaction.user.id), points)
                await db.clear_puzzle_attempt(str(interaction.user.id))
                await interaction.followup.send(f"✅ **Correct!** That was the final move. You've solved the puzzle! (+{points} points)", ephemeral=True)
            else:
                # Bot moves are usually at odd indices: [user_0, bot_1, user_2, bot_3...]
                # So if current_idx is 0 (user), then bot is 1, and next user is 2.
                bot_move = solution[current_idx + 1]
                next_user_move_idx = current_idx + 2
                
                if next_user_move_idx >= len(solution):
                    # Only one move left and it was the bot's? No, solution always ends with user move usually.
                    # But if it ends with bot move for some reason:
                    await db.mark_puzzle_solved(puzzle_id, str(interaction.user.id), points)
                    await db.clear_puzzle_attempt(str(interaction.user.id))
                    await interaction.followup.send(f"✅ **Correct!** The opponent responded with `{bot_move}`. Puzzle solved! (+{points} points)", ephemeral=True)
                else:
                    await db.set_puzzle_attempt(str(interaction.user.id), puzzle_id, next_user_move_idx)
                    await db.mark_puzzle_solved(puzzle_id, str(interaction.user.id), 1) # +1 for current correct move
                    await interaction.followup.send(f"✅ **Correct!** The opponent responded with `{bot_move}`. What is your next move?", ephemeral=True)
        else:
            # Wrong move
            await db.clear_puzzle_attempt(str(interaction.user.id))
            await interaction.followup.send(f"❌ **Wrong move.** The puzzle solving attempt has ended.", ephemeral=True)

    @bot.tree.command(name="puzzle_leaderboard", description="Show the top puzzle solvers")
    async def puzzle_leaderboard(interaction: discord.Interaction) -> None:
        leaders = await db.get_puzzle_leaderboard()
        if not leaders:
            await interaction.response.send_message("No one has solved any puzzles yet!")
            return

        lines = []
        for i, l in enumerate(leaders):
            points = l.get('points', 0)
            lines.append(f"**{i+1}.** <@{l['discord_id']}> — {l['solves']} solves ({points} pts)")

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


    async def update_member_roles(self, discord_id: str) -> None:
        """Update both verified and rating roles for a member immediately."""
        guild_id = self.dynamic_settings.get("discord_guild_id")
        if not guild_id:
            return
            
        guild = self.get_guild(int(guild_id))
        if not guild:
            return
            
        try:
            member = guild.get_member(int(discord_id)) or await guild.fetch_member(int(discord_id))
        except Exception:
            return

        # 1. Verified Role
        verified_role_id = self.dynamic_settings.get("discord_verified_role_id")
        if verified_role_id:
            role = guild.get_role(int(verified_role_id))
            if role and role not in member.roles:
                try:
                    await member.add_roles(role)
                except Exception:
                    pass

        # 2. Rating Roles
        username = await db.get_chesscom_username_by_discord(discord_id)
        if not username:
            return

        try:
            stats = await fetch_chesscom_stats(username)
            rapid = stats.stats.get("chess_rapid", {}).get("last", {}).get("rating", 0)
            blitz = stats.stats.get("chess_blitz", {}).get("last", {}).get("rating", 0)
            rating = max(rapid, blitz)

            role_mapping = {
                "discord_expert_role_id": 2000,
                "discord_intermediate_role_id": 1200,
                "discord_beginner_role_id": 0
            }

            roles = {}
            for key, min_rating in role_mapping.items():
                rid = self.dynamic_settings.get(key)
                if rid:
                    r = guild.get_role(int(rid))
                    if r:
                        roles[min_rating] = r

            if roles:
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

    def get_guild_channels(self) -> list[dict[str, Any]]:
        guild_id = self.dynamic_settings.get("discord_guild_id")
        if not guild_id:
            return []
        guild = self.get_guild(int(guild_id))
        if not guild:
            return []
            
        channels = []
        for channel in guild.text_channels:
            channels.append({
                "id": str(channel.id),
                "name": channel.name,
                "category": channel.category.name if channel.category else None
            })
        return sorted(channels, key=lambda x: (x["category"] or "", x["name"]))

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
        await bot.update_member_roles(str(interaction.user.id))

        await interaction.followup.send(f"Chess.com username linked: `{username}`. Your roles have been updated.", ephemeral=True)

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
