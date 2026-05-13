from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import httpx


CHESSCOM_PROFILE_URL = "https://api.chess.com/pub/player/{username}"
CHESSCOM_STATS_URL = "https://api.chess.com/pub/player/{username}/stats"


@dataclass
class ChessComStats:
    username: str
    profile: dict[str, Any]
    stats: dict[str, Any]


async def fetch_chesscom_stats(username: str) -> ChessComStats:
    async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
        profile_response = await client.get(CHESSCOM_PROFILE_URL.format(username=username))
        stats_response = await client.get(CHESSCOM_STATS_URL.format(username=username))

    if profile_response.status_code == 404 or stats_response.status_code == 404:
        raise ValueError(f"Chess.com player '{username}' was not found")

    profile_response.raise_for_status()
    stats_response.raise_for_status()

    return ChessComStats(
        username=username,
        profile=profile_response.json(),
        stats=stats_response.json(),
    )


def _record_text(section: dict[str, Any] | None) -> str | None:
    if not section:
        return None
    record = section.get("record") or {}
    win = record.get("win")
    loss = record.get("loss")
    draw = record.get("draw")
    parts = []
    if win is not None:
        parts.append(f"W {win}")
    if loss is not None:
        parts.append(f"L {loss}")
    if draw is not None:
        parts.append(f"D {draw}")
    return "  ".join(parts) if parts else None


def _format_timestamp(value: Any) -> str:
    if not isinstance(value, (int, float)):
        return "unknown"
    return datetime.fromtimestamp(value, tz=timezone.utc).strftime("%Y-%m-%d %H:%M UTC")


def build_stats_summary(data: ChessComStats) -> dict[str, str]:
    profile = data.profile
    stats = data.stats

    summary: dict[str, str] = {
        "Username": profile.get("username") or data.username,
        "Name": profile.get("name") or "Private",
        "Status": profile.get("status") or "unknown",
        "Country": profile.get("country", "").rsplit("/", 1)[-1].upper() if profile.get("country") else "unknown",
        "Joined": _format_timestamp(profile.get("joined")),
        "Last online": _format_timestamp(profile.get("last_online")),
        "Followers": str(profile.get("followers") or 0),
    }

    sections = (
        ("Rapid", stats.get("chess_rapid")),
        ("Blitz", stats.get("chess_blitz")),
        ("Bullet", stats.get("chess_bullet")),
        ("Daily", stats.get("chess_daily")),
    )
    for label, section in sections:
        record = _record_text(section)
        if record:
            summary[f"{label} record"] = record

    if stats.get("tactics"):
        summary["Tactics"] = f"Highest: {stats['tactics'].get('highest', {}).get('rating', 'unknown')}"
    if stats.get("puzzles"):
        summary["Puzzles"] = f"Best: {stats['puzzles'].get('highest', {}).get('rating', 'unknown')}"

    return summary


async def is_player_in_club(username: str, club_id: str) -> bool:
    if not club_id:
        return True  # If no club ID is configured, skip the check
    
    url = f"https://api.chess.com/pub/club/{club_id}/members"
    try:
        async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
            resp = await client.get(url)
            if resp.status_code != 200:
                return False
            
            members = resp.json()
            # Members are grouped by 'all_time', 'weekly', 'monthly'
            for category in ["all_time", "weekly", "monthly"]:
                for member in members.get(category, []):
                    if member.get("username", "").lower() == username.lower():
                        return True
            return False
    except Exception:
        return False


async def fetch_tournament_details(tournament_url: str) -> dict[str, Any] | None:
    """
    Attempts to fetch tournament details from Chess.com API.
    Expects a URL like https://www.chess.com/tournament/live/-tc-20230512-abcd
    """
    if "chess.com/tournament/live/" not in tournament_url:
        return None

    try:
        url_id = tournament_url.split("tournament/live/")[-1].split("/")[0].split("?")[0]
        api_url = f"https://api.chess.com/pub/tournament/{url_id}"
        
        async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
            resp = await client.get(api_url)
            if resp.status_code != 200:
                return None
            
            data = resp.json()
            
            # Chess.com API returns timestamps for start_time
            start_time = data.get("start_time")
            dt = None
            if start_time:
                dt = datetime.fromtimestamp(start_time, tz=timezone.utc)
            
            settings = data.get("settings", {})
            
            return {
                "name": data.get("name"),
                "format": str(settings.get("type", "Swiss")).title(),
                "time_control": f"{settings.get('time_control')}",
                "rated": settings.get("rated", True),
                "scheduled_for": dt,
                "description": data.get("description"),
            }
    except Exception as e:
        print(f"Error fetching tournament details: {e}")
        return None


async def fetch_tournament_results(tournament_url: str) -> dict[str, Any] | None:
    """
    Attempts to fetch tournament results from Chess.com.
    Expects a URL like https://www.chess.com/tournament/live/-tc-20230512-abcd
    """
    if "chess.com/tournament/live/" not in tournament_url:
        return None

    try:
        url_id = tournament_url.split("tournament/live/")[-1].split("/")[0].split("?")[0]
        api_url = f"https://api.chess.com/pub/tournament/{url_id}"
        
        async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
            resp = await client.get(api_url)
            if resp.status_code != 200:
                return None
            
            data = resp.json()
            if data.get("status") != "finished":
                return None
            
            # Fetch results
            results_resp = await client.get(f"{api_url}/results")
            if results_resp.status_code != 200:
                return None
            
            players = results_resp.json().get("players", [])
            if not players:
                return None
            
            # Sort by rank
            players.sort(key=lambda x: x.get("rank", 999))
            
            return {
                "winner": players[0].get("username") if len(players) > 0 else None,
                "runner_up": players[1].get("username") if len(players) > 1 else None,
                "third_place": players[2].get("username") if len(players) > 2 else None,
                "finished_at": datetime.now(timezone.utc)
            }
    except Exception as e:
        print(f"Error fetching results: {e}")
        return None
