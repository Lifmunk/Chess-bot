from __future__ import annotations

import logging
from datetime import datetime, timezone
from secrets import token_hex
from typing import Any

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from .config import get_settings

settings = get_settings()

client: AsyncIOMotorClient | None = None
db: AsyncIOMotorDatabase | None = None

def get_db() -> AsyncIOMotorDatabase:
    if db is None:
        raise RuntimeError("Database not initialized. Call init_db() first.")
    return db

async def init_db() -> None:
    global client, db
    logging.info("Initializing MongoDB connection...")
    client = AsyncIOMotorClient(settings.mongodb_uri)
    db = client[settings.mongodb_db_name]
    # Create indexes
    await db.tournaments.create_index("tournament_id", unique=True)
    await db.users.create_index("discord_id", unique=True)
    await db.users.create_index("chesscom_username", unique=True)
    logging.info("MongoDB connection established and indexes created.")

async def close_db() -> None:
    global client
    if client:
        client.close()
        logging.info("MongoDB connection closed.")

def utc_now() -> datetime:
    return datetime.now(timezone.utc)

async def nuke_database() -> None:
    database = get_db()
    await database.tournaments.delete_many({})
    await database.users.delete_many({})
    logging.info("Database nuked.")

def generate_tournament_id() -> str:
    stamp = utc_now().strftime("%Y%m%d")
    suffix = token_hex(2).upper()
    return f"TC-{stamp}-{suffix}"

def _transform_doc(doc: dict[str, Any] | None) -> dict[str, Any] | None:
    if doc is None:
        return None
    doc.pop("_id", None)
    return doc

async def create_tournament(payload: dict[str, Any]) -> dict[str, Any]:
    database = get_db()
    now = utc_now()
    tournament_id = generate_tournament_id()
    
    doc = {
        "tournament_id": tournament_id,
        "name": payload["name"],
        "chesscom_link": payload["chesscom_link"],
        "format": payload["format"],
        "rated": bool(payload.get("rated", True)),
        "status": "planned",
        "scheduled_for": parse_dt(payload.get("scheduled_for")),
        "started_at": None,
        "finished_at": None,
        "winner": None,
        "runner_up": None,
        "third_place": None,
        "notes": payload.get("notes", ""),
        "is_automated": bool(payload.get("is_automated", False)),
        "recurrence": payload.get("recurrence"),
        "created_at": now,
        "updated_at": now,
    }
    
    await database.tournaments.insert_one(doc)
    return _transform_doc(doc)

async def get_tournament(tournament_id: str) -> dict[str, Any] | None:
    database = get_db()
    doc = await database.tournaments.find_one({"tournament_id": tournament_id})
    return _transform_doc(doc)

async def link_user(discord_id: str, chesscom_username: str) -> None:
    database = get_db()
    now = utc_now()
    await database.users.update_one(
        {"discord_id": discord_id},
        {"$set": {"chesscom_username": chesscom_username, "updated_at": now}},
        upsert=True
    )

async def get_user_by_chesscom(chesscom_username: str) -> str | None:
    database = get_db()
    doc = await database.users.find_one({"chesscom_username": {"$regex": f"^{chesscom_username}$", "$options": "i"}})
    return doc["discord_id"] if doc else None

async def get_chesscom_username_by_discord(discord_id: str) -> str | None:
    database = get_db()
    doc = await database.users.find_one({"discord_id": discord_id})
    return doc["chesscom_username"] if doc else None

async def get_pending_automated_starts() -> list[dict[str, Any]]:
    database = get_db()
    now = utc_now()
    cursor = database.tournaments.find({
        "status": "planned",
        "is_automated": True,
        "scheduled_for": {"$lte": now}
    })
    return [_transform_doc(doc) for doc in await cursor.to_list(length=100)]

async def list_tournaments(status: str | None = None, query: str | None = None) -> list[dict[str, Any]]:
    database = get_db()
    filter_query = {}
    if status:
        filter_query["status"] = status
    if query:
        filter_query["$or"] = [
            {"tournament_id": {"$regex": query, "$options": "i"}},
            {"name": {"$regex": query, "$options": "i"}},
            {"chesscom_link": {"$regex": query, "$options": "i"}}
        ]
    
    cursor = database.tournaments.find(filter_query).sort("created_at", -1)
    return [_transform_doc(doc) for doc in await cursor.to_list(length=1000)]

async def update_tournament(tournament_id: str, fields: dict[str, Any]) -> dict[str, Any] | None:
    database = get_db()
    allowed = {
        "name", "chesscom_link", "format", "rated", "status",
        "scheduled_for", "started_at", "finished_at",
        "winner", "runner_up", "third_place", "notes"
    }
    
    update_data = {k: v for k, v in fields.items() if k in allowed}
    if not update_data:
        return await get_tournament(tournament_id)
        
    update_data["updated_at"] = utc_now()
    
    await database.tournaments.update_one(
        {"tournament_id": tournament_id},
        {"$set": update_data}
    )
    return await get_tournament(tournament_id)

async def get_leaderboard(limit: int = 10) -> list[dict[str, Any]]:
    database = get_db()
    pipeline = [
        {"$match": {"status": "finished", "winner": {"$exists": True, "$ne": None, "$ne": ""}}},
        {"$group": {"_id": "$winner", "wins": {"$sum": 1}}},
        {"$sort": {"wins": -1}},
        {"$limit": limit},
        {"$project": {"username": "$_id", "wins": 1, "_id": 0}}
    ]
    cursor = database.tournaments.aggregate(pipeline)
    return await cursor.to_list(length=limit)

async def get_next_tournament() -> dict[str, Any] | None:
    database = get_db()
    now = utc_now()
    doc = await database.tournaments.find_one(
        {"status": "planned", "scheduled_for": {"$gt": now}},
        sort=[("scheduled_for", 1)]
    )
    return _transform_doc(doc)
s.find_one(
        {"status": "planned", "scheduled_for": {"$gt": now}},
        sort=[("scheduled_for", 1)]
    )
    return _transform_doc(doc)
ment() -> dict[str, Any] | None:
    database = get_db()
    now = utc_now()
    doc = await database.tournaments.find_one(
        {"status": "planned", "scheduled_for": {"$gt": now}},
        sort=[("scheduled_for", 1)]
    )
    return _transform_doc(doc)
