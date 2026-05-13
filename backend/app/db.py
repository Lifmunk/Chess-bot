from __future__ import annotations

import logging
from datetime import datetime, timezone, timedelta
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
    
    uri = settings.mongodb_uri
    # Redact password for logging
    log_uri = uri
    if "@" in uri and "://" in uri:
        prefix, rest = uri.split("://", 1)
        if "@" in rest:
            auth, host = rest.split("@", 1)
            log_uri = f"{prefix}://****:****@{host}"

    logging.info(f"Connecting to MongoDB: {log_uri}")
    
    try:
        # We set a short server selection timeout for the initial check
        client = AsyncIOMotorClient(
            uri,
            serverSelectionTimeoutMS=5000,
            # Ensure we use the latest TLS version supported
            tls=True if "mongodb+srv" in uri else None
        )
        db = client[settings.mongodb_db_name]
        
        # Verify connection
        await client.admin.command('ping')
        logging.info("Successfully pinged MongoDB.")

        # Create indexes
        await db.tournaments.create_index("tournament_id", unique=True)
        await db.users.create_index("discord_id", unique=True)
        await db.users.create_index("chesscom_username", unique=True)
        logging.info("MongoDB connection established and indexes created.")
    except Exception as e:
        logging.error(f"Failed to initialize MongoDB: {e}")
        logging.error("Check your MONGODB_URI and ensure your IP is allow-listed if using Atlas.")
        raise

async def close_db() -> None:
    global client
    if client:
        client.close()
        logging.info("MongoDB connection closed.")

def utc_now() -> datetime:
    return datetime.now(timezone.utc)

def parse_dt(value: Any) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None

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
        "time_control": payload.get("time_control", "10 min"),
        "rules": payload.get("rules", ""),
        "description": payload.get("description", ""),
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
        "reminder_sent": False,
        "results_fetched": False,
        "created_at": now,
        "updated_at": now,
    }
    
    await database.tournaments.insert_one(doc)
    return _transform_doc(doc)

async def get_tournament(tournament_id: str) -> dict[str, Any] | None:
    database = get_db()
    doc = await database.tournaments.find_one({"tournament_id": tournament_id})
    return _transform_doc(doc)

async def get_pending_reminders(minutes_before: int = 30) -> list[dict[str, Any]]:
    database = get_db()
    now = utc_now()
    threshold = now + timedelta(minutes=minutes_before)
    cursor = database.tournaments.find({
        "status": "planned",
        "reminder_sent": False,
        "scheduled_for": {"$gt": now, "$lte": threshold}
    })
    return [_transform_doc(doc) for doc in await cursor.to_list(length=100)]

async def get_started_tournaments() -> list[dict[str, Any]]:
    database = get_db()
    cursor = database.tournaments.find({
        "status": "started",
        "results_fetched": False
    })
    return [_transform_doc(doc) for doc in await cursor.to_list(length=100)]

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
        "winner", "runner_up", "third_place", "notes",
        "reminder_sent", "results_fetched", "is_automated", "recurrence",
        "time_control", "rules", "description"
    }
    
    update_data = {k: v for k, v in fields.items() if k in allowed}
    if not update_data:
        return await get_tournament(tournament_id)
    
    for key in ["scheduled_for", "started_at", "finished_at"]:
        if key in update_data:
            update_data[key] = parse_dt(update_data[key])
        
    update_data["updated_at"] = utc_now()
    
    await database.tournaments.update_one(
        {"tournament_id": tournament_id},
        {"$set": update_data}
    )
    return await get_tournament(tournament_id)

async def delete_tournament(tournament_id: str) -> bool:
    database = get_db()
    res = await database.tournaments.delete_one({"tournament_id": tournament_id})
    return res.deleted_count > 0

async def list_users() -> list[dict[str, Any]]:
    database = get_db()
    cursor = database.users.find({}).sort("updated_at", -1)
    return [_transform_doc(doc) for doc in await cursor.to_list(length=1000)]

async def unlink_user(discord_id: str) -> bool:
    database = get_db()
    res = await database.users.delete_one({"discord_id": discord_id})
    return res.deleted_count > 0

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
