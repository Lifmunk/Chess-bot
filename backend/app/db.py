from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from secrets import token_hex
from typing import Any

from .config import get_settings


settings = get_settings()
DB_PATH = settings.database_path


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def ensure_database() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS tournaments (
                tournament_id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                chesscom_link TEXT NOT NULL,
                format TEXT NOT NULL,
                rated INTEGER NOT NULL,
                status TEXT NOT NULL,
                scheduled_for TEXT,
                started_at TEXT,
                finished_at TEXT,
                winner TEXT,
                runner_up TEXT,
                third_place TEXT,
                notes TEXT,
                is_automated INTEGER DEFAULT 0,
                recurrence TEXT, -- 'weekly', 'monthly', 'daily', or NULL
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        _migrate_tournaments_table(conn)
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                discord_id TEXT PRIMARY KEY,
                chesscom_username TEXT NOT NULL UNIQUE,
                created_at TEXT NOT NULL
            )
            """
        )
        conn.commit()


def _migrate_tournaments_table(conn: sqlite3.Connection) -> None:
    columns = {
        row[1]
        for row in conn.execute("PRAGMA table_info(tournaments)").fetchall()
    }
    migrations = [
        ("is_automated", "ALTER TABLE tournaments ADD COLUMN is_automated INTEGER NOT NULL DEFAULT 0"),
        ("recurrence", "ALTER TABLE tournaments ADD COLUMN recurrence TEXT"),
    ]
    for column, sql in migrations:
        if column not in columns:
            conn.execute(sql)


def nuke_database() -> None:
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("DROP TABLE IF EXISTS tournaments")
        conn.execute("DROP TABLE IF EXISTS users")
        conn.commit()
    ensure_database()


@contextmanager
def get_connection() -> sqlite3.Connection:
    ensure_database()
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


def parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    dt = datetime.fromisoformat(value)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def serialize_dt(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat()


def generate_tournament_id() -> str:
    stamp = utc_now().strftime("%Y%m%d")
    suffix = token_hex(2).upper()
    return f"TC-{stamp}-{suffix}"


def row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    keys = set(row.keys())

    def value(name: str, default: Any = None) -> Any:
        return row[name] if name in keys else default

    return {
        "tournament_id": value("tournament_id"),
        "name": value("name"),
        "chesscom_link": value("chesscom_link"),
        "format": value("format"),
        "rated": bool(value("rated", 0)),
        "status": value("status"),
        "scheduled_for": parse_dt(value("scheduled_for")),
        "started_at": parse_dt(value("started_at")),
        "finished_at": parse_dt(value("finished_at")),
        "winner": value("winner"),
        "runner_up": value("runner_up"),
        "third_place": value("third_place"),
        "notes": value("notes") or "",
        "is_automated": bool(value("is_automated", 0)),
        "recurrence": value("recurrence"),
        "created_at": parse_dt(value("created_at")),
        "updated_at": parse_dt(value("updated_at")),
    }


def create_tournament(payload: dict[str, Any]) -> dict[str, Any]:
    now = serialize_dt(utc_now())
    tournament_id = generate_tournament_id()
    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO tournaments (
                tournament_id, name, chesscom_link, format, rated, status,
                scheduled_for, started_at, finished_at, winner, runner_up,
                third_place, notes, is_automated, recurrence, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                tournament_id,
                payload["name"],
                payload["chesscom_link"],
                payload["format"],
                1 if payload["rated"] else 0,
                "planned",
                serialize_dt(payload.get("scheduled_for")),
                None,
                None,
                None,
                None,
                None,
                payload.get("notes", ""),
                1 if payload.get("is_automated") else 0,
                payload.get("recurrence"),
                now,
                now,
            ),
        )
        conn.commit()
    return get_tournament(tournament_id)


def get_tournament(tournament_id: str) -> dict[str, Any] | None:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT * FROM tournaments WHERE tournament_id = ?",
            (tournament_id,),
        ).fetchone()
    return row_to_dict(row) if row else None


def link_user(discord_id: str, chesscom_username: str) -> None:
    now = serialize_dt(utc_now())
    with get_connection() as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO users (discord_id, chesscom_username, created_at)
            VALUES (?, ?, ?)
            """,
            (discord_id, chesscom_username, now),
        )
        conn.commit()


def get_user_by_chesscom(chesscom_username: str) -> str | None:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT discord_id FROM users WHERE LOWER(chesscom_username) = LOWER(?)",
            (chesscom_username,),
        ).fetchone()
    return row["discord_id"] if row else None


def get_chesscom_username_by_discord(discord_id: str) -> str | None:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT chesscom_username FROM users WHERE discord_id = ?",
            (discord_id,),
        ).fetchone()
    return row["chesscom_username"] if row else None


def get_pending_automated_starts() -> list[dict[str, Any]]:
    # Get all planned automated tournaments that should have started by now
    now = serialize_dt(utc_now())
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT * FROM tournaments
            WHERE status = 'planned' AND is_automated = 1 AND scheduled_for <= ?
            """,
            (now,),
        ).fetchall()
    return [row_to_dict(row) for row in rows]


def list_tournaments(status: str | None = None, query: str | None = None) -> list[dict[str, Any]]:

    sql = "SELECT * FROM tournaments"
    clauses: list[str] = []
    params: list[Any] = []
    if status:
        clauses.append("status = ?")
        params.append(status)
    if query:
        clauses.append("(tournament_id LIKE ? OR name LIKE ? OR chesscom_link LIKE ?)")
        q = f"%{query}%"
        params.extend([q, q, q])
    if clauses:
        sql += " WHERE " + " AND ".join(clauses)
    sql += " ORDER BY datetime(created_at) DESC"
    with get_connection() as conn:
        rows = conn.execute(sql, params).fetchall()
    return [row_to_dict(row) for row in rows]


def update_tournament(tournament_id: str, fields: dict[str, Any]) -> dict[str, Any] | None:
    allowed = {
        "name",
        "chesscom_link",
        "format",
        "rated",
        "status",
        "scheduled_for",
        "started_at",
        "finished_at",
        "winner",
        "runner_up",
        "third_place",
        "notes",
    }
    sets: list[str] = []
    params: list[Any] = []
    for key, value in fields.items():
        if key not in allowed:
            continue
        if key in {"scheduled_for", "started_at", "finished_at"}:
            value = serialize_dt(value)
        if key == "rated":
            value = 1 if value else 0
        sets.append(f"{key} = ?")
        params.append(value)
    if not sets:
        return get_tournament(tournament_id)
    params.extend([serialize_dt(utc_now()), tournament_id])
    with get_connection() as conn:
        conn.execute(
            f"UPDATE tournaments SET {', '.join(sets)}, updated_at = ? WHERE tournament_id = ?",
            params,
        )
        conn.commit()
    return get_tournament(tournament_id)


def get_leaderboard(limit: int = 10) -> list[dict[str, Any]]:
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT winner, COUNT(*) as wins
            FROM tournaments
            WHERE status = 'finished' AND winner IS NOT NULL AND winner != ''
            GROUP BY winner
            ORDER BY wins DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    return [{"username": row["winner"], "wins": row["wins"]} for row in rows]


def get_next_tournament() -> dict[str, Any] | None:
    # Get the earliest planned tournament that has a scheduled_for date in the future
    with get_connection() as conn:
        row = conn.execute(
            """
            SELECT * FROM tournaments
            WHERE status = 'planned' AND scheduled_for IS NOT NULL
            ORDER BY datetime(scheduled_for) ASC
            LIMIT 1
            """
        ).fetchone()
    return row_to_dict(row) if row else None
