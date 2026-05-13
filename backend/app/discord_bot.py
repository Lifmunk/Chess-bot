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
                self.tree.copy_global_to(guild=guild)
                await self.tree.sync(guild=guild)
            except Exception as e:
                logger.warning("Failed to sync commands to guild %s: %s", guild_id, e)
        else:
            await self.tree.sync()
        
        if not self.daily_puzzle_loop.is_running():
            self.daily_puzzle_loop.start()

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

    async def post_daily_puzzle(self) -> None:
        try:
            puzzle = await fetch_daily_puzzle()
        except Exception:
            logger.exception("Failed to fetch daily puzzle")
            return

        content = puzzle_message(puzzle)
        jpg_path = render_puzzle_jpg(puzzle)
        try:
            file = discord.File(str(jpg_path), filename="puzzle.jpg")
            await self.safe_send(self.puzzle_channel_id(), content=content, file=file)
        finally:
            try:
                jpg_path.unlink(missing_ok=True)
            except OSError:
                logger.warning("Failed to remove temporary puzzle image %s", jpg_path)

    @tasks.loop(hours=24)
    async def daily_puzzle_loop(self) -> None:
        await self.post_daily_puzzle()

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


def build_bot(settings: Settings) -> ChessClubBot:
    bot = ChessClubBot(settings)

    @bot.event
    async def on_message(message: discord.Message):
        if message.author.bot:
            return
        
        # Check if bot is mentioned
        if bot.user in message.mentions:
            # Strip the mention from the content
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
        jpg_path = render_puzzle_jpg(puzzle)
        try:
            file = discord.File(str(jpg_path), filename="puzzle.jpg")
            await interaction.followup.send(content=content, file=file)
        finally:
            try:
                jpg_path.unlink(missing_ok=True)
            except OSError:
                logger.warning("Failed to remove temporary puzzle image %s", jpg_path)

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

    @bot.tree.command(name="stats", description="Show Chess.com stats for a player")
    @app_commands.describe(username="Chess.com username. Leave blank to use your linked account.")
    async def stats_command(interaction: discord.Interaction, username: str | None = None) -> None:
        await interaction.response.defer(ephemeral=True)
        target_username = username or await db.get_chesscom_username_by_discord(str(interaction.user.id))
        if not target_username:
            await interaction.followup.send("Provide a Chess.com username or link your account with /link first.", ephemeral=True)
            return

        try:
            stats = await fetch_chesscom_stats(target_username)
        except ValueError as exc:
            await interaction.followup.send(str(exc), ephemeral=True)
            return
        except Exception:
            logger.exception("Failed to fetch Chess.com stats")
            await interaction.followup.send("I could not fetch Chess.com stats right now.", ephemeral=True)
            return

        summary = build_stats_summary(stats)
        embed = discord.Embed(
            title=f"Chess.com stats for {summary['Username']}",
            color=discord.Color.dark_green(),
        )
        embed.add_field(name="Name", value=summary["Name"], inline=True)
        embed.add_field(name="Status", value=summary["Status"], inline=True)
        embed.add_field(name="Country", value=summary["Country"], inline=True)
        embed.add_field(name="Joined", value=summary["Joined"], inline=True)
        embed.add_field(name="Last online", value=summary["Last online"], inline=True)
        embed.add_field(name="Followers", value=summary["Followers"], inline=True)

        for label, value in summary.items():
            if label in {"Username", "Name", "Status", "Country", "Joined", "Last online", "Followers"}:
                continue
            embed.add_field(name=label, value=value, inline=True)

        await interaction.followup.send(embed=embed, ephemeral=True)

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
