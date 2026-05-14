from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Response, status, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import db
from .config import get_settings
from .discord_bot import build_bot
from .services.chesscom import fetch_tournament_results, fetch_tournament_details
from .schemas import (
    LoginRequest,
    MeResponse,
    TokenResponse,
    TournamentCreate,
    TournamentListResponse,
    TournamentOut,
    TournamentResultUpdate,
    TournamentUpdate,
    UserOut,
    UserLinkRequest,
    UserListResponse,
    AnnouncementRequest,
    AnnouncementCreate,
    AnnouncementUpdate,
    AnnouncementOut,
)
from .security import create_admin_token, require_admin


logging.basicConfig(level=logging.INFO)
settings = get_settings()


class DiscordBridge:
    def __init__(self, bot):
        self.bot = bot
        self.task: asyncio.Task | None = None

    @staticmethod
    def _log_task_result(task: asyncio.Task) -> None:
        if task.cancelled():
            return
        exc = task.exception()
        if exc:
            logging.exception("Discord bot task crashed", exc_info=exc)

    async def start(self) -> None:
        if not settings.discord_bot_token:
            logging.warning("Discord bot token not configured; Discord features are disabled.")
            return
        if self.task and not self.task.done():
            return
        self.task = asyncio.create_task(self.bot.start(settings.discord_bot_token))
        self.task.add_done_callback(self._log_task_result)

    async def close(self) -> None:
        if self.bot.is_closed():
            return
        await self.bot.close()
        if self.task:
            try:
                await asyncio.wait_for(self.task, timeout=5)
            except asyncio.TimeoutError:
                self.task.cancel()
            except Exception:
                pass

    async def _wait_for_ready(self) -> bool:
        if not settings.discord_bot_token:
            return False
        try:
            await asyncio.wait_for(self.bot.wait_until_bot_ready(), timeout=15)
            return True
        except asyncio.TimeoutError:
            logging.warning("Discord bot was not ready in time; announcement skipped.")
            return False

    async def announce_created(self, tournament: dict) -> None:
        if await self._wait_for_ready():
            await self.bot.announce_tournament_created(tournament)

    async def announce_started(self, tournament: dict) -> None:
        if await self._wait_for_ready():
            await self.bot.announce_tournament_started(tournament)

    async def announce_finished(self, tournament: dict) -> None:
        if await self._wait_for_ready():
            await self.bot.announce_tournament_results(tournament)

    async def announce_reminder(self, tournament: dict, time_left: str) -> None:
        if await self._wait_for_ready():
            await self.bot.announce_tournament_reminder(tournament, time_left)

    async def manual_announce(self, channel_id: str, message: str) -> bool:
        if await self._wait_for_ready():
            try:
                await self.bot.safe_send(int(channel_id), content=message)
                return True
            except ValueError:
                logging.error("Invalid channel ID for manual announcement: %s", channel_id)
        return False

    async def check_scheduled_announcements(self) -> None:
        pending = await db.get_pending_announcements()
        for ann in pending:
            logging.info("Sending scheduled announcement %s", ann["announcement_id"])
            success = await self.manual_announce(ann["channel_id"], ann["message"])
            if success:
                await db.update_announcement(ann["announcement_id"], {"sent": True})
            else:
                logging.warning("Failed to send scheduled announcement %s, will retry.", ann["announcement_id"])

    async def check_reminders(self) -> None:
        pending = await db.get_pending_reminders(minutes_before=30)
        for t in pending:
            logging.info("Sending reminder for tournament %s", t["tournament_id"])
            await self.announce_reminder(t, "30 minutes")
            await db.update_tournament(t["tournament_id"], {"reminder_sent": True})

    async def check_tournament_results(self) -> None:
        started = await db.get_started_tournaments()
        for t in started:
            results = await fetch_tournament_results(t["chesscom_link"])
            if results:
                logging.info("Fetched results for tournament %s", t["tournament_id"])
                updated = await db.update_tournament(
                    t["tournament_id"],
                    {
                        "status": "finished",
                        "results_fetched": True,
                        "winner": results["winner"],
                        "runner_up": results["runner_up"],
                        "third_place": results["third_place"],
                        "finished_at": results["finished_at"],
                    },
                )
                if updated:
                    await self.announce_finished(updated)

    async def check_automated_starts(self) -> None:
        pending = await db.get_pending_automated_starts()
        for t in pending:
            logging.info("Automating start for tournament %s", t["tournament_id"])
            updated = await db.update_tournament(
                t["tournament_id"],
                {
                    "status": "started",
                    "started_at": db.utc_now(),
                },
            )
            if updated:
                await self.announce_started(updated)
                
                # Handle recurrence
                if t.get("is_automated") and t.get("recurrence") and t.get("scheduled_for"):
                    from datetime import timedelta
                    next_start = None
                    if t["recurrence"] == "daily":
                        next_start = t["scheduled_for"] + timedelta(days=1)
                    elif t["recurrence"] == "weekly":
                        next_start = t["scheduled_for"] + timedelta(days=7)
                    elif t["recurrence"] == "monthly":
                        next_start = t["scheduled_for"] + timedelta(days=30)
                    
                    if next_start:
                        # For recurring tournaments, we might not have the new link yet if it's not created
                        # User requested option to add next event url.
                        # For now, we create the record and user can update link in admin.
                        await db.create_tournament({
                            "name": t["name"],
                            "chesscom_link": t["chesscom_link"], # Placeholder or same if multi-event link
                            "format": t["format"],
                            "rated": t["rated"],
                            "scheduled_for": next_start,
                            "notes": t["notes"],
                            "is_automated": True,
                            "recurrence": t["recurrence"]
                        })
                        logging.info("Scheduled next recurring tournament for %s", next_start)


discord_bridge = DiscordBridge(build_bot(settings))


from .services.openings import get_random_opening
...
async def automation_loop():
    while True:
        try:
            await discord_bridge.check_automated_starts()
            await discord_bridge.check_reminders()
            await discord_bridge.check_tournament_results()
            await discord_bridge.check_scheduled_announcements()
            
            # Opening of the Week & Sunday Arena Logic
            now = db.utc_now()
            # 1. Monday Opening Reveal (UTC)
            if now.weekday() == 0 and now.hour == 9 and now.minute == 0:
                current = await db.get_current_opening()
                # Check if we already did this today
                if not current or current.get("last_updated_date") != now.strftime("%Y-%m-%d"):
                    opening = get_random_opening()
                    summary = await ai_service.generate_opening_summary(opening.name, opening.moves)
                    opening_data = {
                        "name": opening.name,
                        "moves": opening.moves,
                        "eco": opening.eco,
                        "lichess_study_url": opening.lichess_study_url,
                        "summary": summary,
                        "last_updated_date": now.strftime("%Y-%m-%d")
                    }
                    await db.set_current_opening(opening_data)
                    await discord_bridge.bot.announce_opening(opening_data)
                    logging.info("Announced Opening of the Week: %s", opening.name)

            # 2. Sunday Arena Auto-Schedule (if not exists)
            if now.weekday() == 6 and now.hour == 18 and now.minute == 0:
                # Check if Arena for today exists
                today_str = now.strftime("%Y-%m-%d")
                tournaments = await db.list_tournaments(status="planned")
                exists = any(t.get("scheduled_for") and t["scheduled_for"].strftime("%Y-%m-%d") == today_str and "Sunday Arena" in t["name"] for t in tournaments)
                
                if not exists:
                    current_opening = await db.get_current_opening()
                    opening_name = current_opening["name"] if current_opening else "Weekly"
                    
                    # Create Arena record (Admin will need to provide the link manually in UI)
                    await db.create_tournament({
                        "name": f"Sunday Arena: {opening_name}",
                        "chesscom_link": "https://www.chess.com/tournament/live", 
                        "format": "Arena",
                        "time_control": "1+0",
                        "rated": True,
                        "scheduled_for": now.replace(hour=19, minute=0, second=0, microsecond=0),
                        "notes": f"Opening of the week: {opening_name}",
                        "is_automated": True
                    })
                    logging.info("Auto-scheduled Sunday Arena for %s", opening_name)

        except Exception:
            logging.exception("Error in automation loop")
        await asyncio.sleep(60)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.init_db()
    await discord_bridge.start()
    app.state.discord = discord_bridge
    # Start automation loop in background
    asyncio.create_task(automation_loop())
    try:
        yield
    finally:
        await discord_bridge.close()
        await db.close_db()


app = FastAPI(title=settings.app_name, lifespan=lifespan)

# CORS configuration
origins = settings.cors_origin_list
if not origins:
    origins = ["*"]

logging.info(f"Allowed CORS origins: {origins}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True if "*" not in origins else False,
    allow_methods=["*"],
    allow_headers=["*"],
)


def tournament_to_response(tournament: dict) -> TournamentOut:
    return TournamentOut(**tournament)


@app.get("/health")
async def health() -> dict[str, str]:
    db_status = "ok"
    try:
        database = db.get_db()
        await database.command("ping")
    except Exception:
        db_status = "error"
    
    return {
        "status": "ok",
        "database": db_status,
        "version": "1.0.0"
    }


@app.get("/test")
async def test_endpoint() -> dict[str, str]:
    import random
    messages = [
        "Hello from the Chess Club API!",
        "Everything is working perfectly.",
        "System check: All systems go.",
        "Greetings, grandmaster!",
        "Ready for the next tournament?"
    ]
    return {"message": random.choice(messages)}


@app.post("/auth/login", response_model=TokenResponse)
async def login(payload: LoginRequest) -> TokenResponse:
    if payload.password != settings.admin_password:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Wrong password")
    return TokenResponse(access_token=create_admin_token())


@app.get("/auth/me", response_model=MeResponse)
async def me(_: dict = Depends(require_admin)) -> MeResponse:
    return MeResponse()


@app.get("/tournaments", response_model=TournamentListResponse)
async def get_tournaments(
    status_filter: str | None = None,
    q: str | None = None,
    _: dict = Depends(require_admin),
) -> TournamentListResponse:
    items = [tournament_to_response(item) for item in await db.list_tournaments(status_filter, q)]
    return TournamentListResponse(items=items)


@app.get("/tournaments/leaderboard")
async def get_leaderboard(
    limit: int = 10,
    _: dict = Depends(require_admin),
):
    return await db.get_leaderboard(limit)


@app.get("/tournaments/fetch")
async def fetch_tournament_info(url: str, _: dict = Depends(require_admin)):
    details = await fetch_tournament_details(url)
    if not details:
        raise HTTPException(status_code=400, detail="Could not fetch tournament details. Ensure the link is correct.")
    return details


@app.post("/tournaments", response_model=TournamentOut, status_code=status.HTTP_201_CREATED)
async def create_tournament(
    payload: TournamentCreate,
    _: dict = Depends(require_admin),
) -> TournamentOut:
    tournament = await db.create_tournament(payload.model_dump())
    await app.state.discord.announce_created(tournament)
    return tournament_to_response(tournament)


@app.get("/tournaments/{tournament_id}", response_model=TournamentOut)
async def read_tournament(
    tournament_id: str,
    _: dict = Depends(require_admin),
) -> TournamentOut:
    tournament = await db.get_tournament(tournament_id)
    if not tournament:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")
    return tournament_to_response(tournament)


@app.patch("/tournaments/{tournament_id}", response_model=TournamentOut)
async def update_tournament(
    tournament_id: str,
    payload: TournamentUpdate,
    _: dict = Depends(require_admin),
) -> TournamentOut:
    reannounce = payload.reannounce
    tournament_data = payload.model_dump(exclude_unset=True)
    tournament_data.pop("reannounce", None)
    
    tournament = await db.update_tournament(tournament_id, tournament_data)
    if not tournament:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")
    
    if reannounce:
        await app.state.discord.announce_created(tournament)
        
    return tournament_to_response(tournament)


@app.delete("/tournaments/{tournament_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_tournament(
    tournament_id: str,
    _: dict = Depends(require_admin),
) -> Response:
    deleted = await db.delete_tournament(tournament_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.post("/tournaments/{tournament_id}/start", response_model=TournamentOut)
async def start_tournament(
    tournament_id: str,
    _: dict = Depends(require_admin),
) -> TournamentOut:
    tournament = await db.update_tournament(
        tournament_id,
        {
            "status": "started",
            "started_at": db.utc_now(),
        },
    )
    if not tournament:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")
    await app.state.discord.announce_started(tournament)
    return tournament_to_response(tournament)


@app.post("/tournaments/{tournament_id}/finish", response_model=TournamentOut)
async def finish_tournament(
    tournament_id: str,
    payload: TournamentResultUpdate,
    _: dict = Depends(require_admin),
) -> TournamentOut:
    tournament = await db.update_tournament(
        tournament_id,
        {
            "status": "finished",
            "finished_at": db.utc_now(),
            "winner": payload.winner,
            "runner_up": payload.runner_up,
            "third_place": payload.third_place,
        },
    )
    if not tournament:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")
    await app.state.discord.announce_finished(tournament)
    return tournament_to_response(tournament)


@app.get("/users", response_model=UserListResponse)
async def get_users(_: dict = Depends(require_admin)) -> UserListResponse:
    items = [UserOut(**item) for item in await db.list_users()]
    return UserListResponse(items=items)


@app.post("/users/link", response_model=UserOut)
async def manual_link_user(
    payload: UserLinkRequest,
    _: dict = Depends(require_admin),
) -> UserOut:
    await db.link_user(payload.discord_id, payload.chesscom_username)
    return UserOut(
        discord_id=payload.discord_id,
        chesscom_username=payload.chesscom_username,
        updated_at=db.utc_now()
    )


@app.delete("/users/{discord_id}", status_code=status.HTTP_204_NO_CONTENT)
async def unlink_user(
    discord_id: str,
    _: dict = Depends(require_admin),
) -> Response:
    deleted = await db.unlink_user(discord_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.post("/announce", status_code=status.HTTP_200_OK)
async def manual_announce(
    payload: AnnouncementRequest,
    _: dict = Depends(require_admin),
) -> dict[str, str]:
    success = await app.state.discord.manual_announce(payload.channel_id, payload.message)
    if not success:
        raise HTTPException(status_code=503, detail="Discord bot not ready or invalid channel")
    return {"message": "Announcement sent"}


@app.get("/announcements", response_model=list[AnnouncementOut])
async def get_announcements(
    sent: bool | None = None,
    _: dict = Depends(require_admin),
) -> list[AnnouncementOut]:
    items = await db.list_announcements(sent)
    return [AnnouncementOut(**item) for item in items]


@app.post("/announcements", response_model=AnnouncementOut, status_code=status.HTTP_201_CREATED)
async def schedule_announcement(
    payload: AnnouncementCreate,
    _: dict = Depends(require_admin),
) -> AnnouncementOut:
    announcement = await db.create_announcement(payload.model_dump())
    return AnnouncementOut(**announcement)


@app.post("/announcements/{announcement_id}/send", response_model=AnnouncementOut)
async def send_announcement_now(
    announcement_id: str,
    _: dict = Depends(require_admin),
) -> AnnouncementOut:
    announcements = await db.list_announcements()
    ann = next((a for a in announcements if a["announcement_id"] == announcement_id), None)
    
    if not ann:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Announcement not found")
    
    success = await app.state.discord.manual_announce(ann["channel_id"], ann["message"])
    if not success:
        raise HTTPException(status_code=503, detail="Discord bot not ready or invalid channel")
    
    updated = await db.update_announcement(announcement_id, {"sent": True})
    return AnnouncementOut(**updated)


@app.patch("/announcements/{announcement_id}", response_model=AnnouncementOut)
async def update_announcement(
    announcement_id: str,
    payload: AnnouncementUpdate,
    _: dict = Depends(require_admin),
) -> AnnouncementOut:
    announcement = await db.update_announcement(announcement_id, payload.model_dump(exclude_unset=True))
    if not announcement:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Announcement not found")
    return AnnouncementOut(**announcement)


@app.delete("/announcements/{announcement_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_announcement(
    announcement_id: str,
    _: dict = Depends(require_admin),
) -> Response:
    deleted = await db.delete_announcement(announcement_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Announcement not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.get("/templates")
async def templates(_: dict = Depends(require_admin)) -> dict[str, list[str]]:
    return {
        "created": [
            "Tournament scheduled: {name}",
            "Format: {format}",
            "Rated: {rated}",
            "Scheduled start: {scheduled_for}",
            "Tournament link: {link}",
        ],
        "started": [
            "Tournament started: {name}",
            "Players may now join from the official Chess.com page.",
            "Link: {link}",
        ],
        "finished": [
            "Tournament completed: {name}",
            "Winner: {winner}",
            "Runner-up: {runner_up}",
            "Third place: {third_place}",
        ],
        "puzzle": [
            "Daily puzzle: {puzzle_id}",
            "Rating: {rating} | Plays: {plays}",
            "Themes: {themes}",
            "Source: Lichess",
        ],
    }


@app.post("/nuke", status_code=status.HTTP_204_NO_CONTENT)
async def nuke(_: dict = Depends(require_admin)) -> Response:
    await db.nuke_database()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.get("/settings")
async def get_settings_endpoint(_: dict = Depends(require_admin)) -> dict[str, Any]:
    return await db.get_app_settings()


@app.post("/settings")
async def update_settings_endpoint(payload: dict[str, Any] = Body(...), _: dict = Depends(require_admin)) -> dict[str, Any]:
    old_settings = await db.get_app_settings()
    new_settings = await db.update_app_settings(payload)

    # Trigger bot to refresh settings
    if hasattr(app.state, "discord") and app.state.discord.bot:
        await app.state.discord.bot.refresh_settings()

        # If guild ID changed, re-sync commands
        if old_settings.get("discord_guild_id") != new_settings.get("discord_guild_id"):
            logging.info("Discord Guild ID changed, triggering command sync...")
            await app.state.discord.bot.setup_hook()

    return new_settings

