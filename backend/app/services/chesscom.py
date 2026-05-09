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
