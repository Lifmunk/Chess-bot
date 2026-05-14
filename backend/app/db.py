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
        await db.announcements.create_index("announcement_id", unique=True)
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
    await database.announcements.delete_many({})
    logging.info("Database nuked.")

def generate_tournament_id() -> str:
    stamp = utc_now().strftime("%Y%m%d")
    suffix = token_hex(2).upper()
    return f"TC-{stamp}-{suffix}"

def generate_announcement_id() -> str:
    return f"ANN-{token_hex(4).upper()}"

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

# Announcements
async def create_announcement(payload: dict[str, Any]) -> dict[str, Any]:
    database = get_db()
    now = utc_now()
    doc = {
        "announcement_id": generate_announcement_id(),
        "channel_id": payload["channel_id"],
        "message": payload["message"],
        "scheduled_for": parse_dt(payload["scheduled_for"]),
        "sent": False,
        "created_at": now,
    }
    await database.announcements.insert_one(doc)
    return _transform_doc(doc)

async def list_announcements(sent: bool | None = None) -> list[dict[str, Any]]:
    database = get_db()
    query = {}
    if sent is not None:
        query["sent"] = sent
    cursor = database.announcements.find(query).sort("scheduled_for", 1)
    return [_transform_doc(doc) for doc in await cursor.to_list(length=100)]

async def get_pending_announcements() -> list[dict[str, Any]]:
    database = get_db()
    now = utc_now()
    cursor = database.announcements.find({
        "sent": False,
        "scheduled_for": {"$lte": now}
    })
    return [_transform_doc(doc) for doc in await cursor.to_list(length=100)]

async def update_announcement(announcement_id: str, fields: dict[str, Any]) -> dict[str, Any] | None:
    database = get_db()
    allowed = {"channel_id", "message", "scheduled_for", "sent"}
    update_data = {k: v for k, v in fields.items() if k in allowed}
    if "scheduled_for" in update_data:
        update_data["scheduled_for"] = parse_dt(update_data["scheduled_for"])
    
    await database.announcements.update_one(
        {"announcement_id": announcement_id},
        {"$set": update_data}
    )
    doc = await database.announcements.find_one({"announcement_id": announcement_id})
    return _transform_doc(doc)

async def delete_announcement(announcement_id: str) -> bool:
    database = get_db()
    res = await database.announcements.delete_one({"announcement_id": announcement_id})
    return res.deleted_count > 0

# Dynamic Settings
async def get_app_settings() -> dict[str, Any]:
    database = get_db()
    doc = await database.settings.find_one({"_id": "app_config"})
    if not doc:
        return {}
    return doc.get("values", {})

async def update_app_settings(values: dict[str, Any]) -> dict[str, Any]:
    database = get_db()
    await database.settings.update_one(
        {"_id": "app_config"},
        {"$set": {"values": values}},
        upsert=True
    )
    return await get_app_settings()

# Opening of the Week
async def get_current_opening() -> dict[str, Any] | None:
    database = get_db()
    return await database.openings.find_one({"_id": "current_opening"})

async def set_current_opening(opening: dict[str, Any]) -> None:
    database = get_db()
    await database.openings.update_one(
        {"_id": "current_opening"},
        {"$set": opening},
        upsert=True
    )

# Puzzle Tracking
async def set_active_puzzle(puzzle_id: str, solution: list[str]) -> None:
    database = get_db()
    await database.puzzles.update_one(
        {"_id": "active"},
        {"$set": {
            "puzzle_id": puzzle_id,
            "solution": solution,
            "solved_by": [],
            "created_at": utc_now()
        }},
        upsert=True
    )

async def get_active_puzzle() -> dict[str, Any] | None:
    database = get_db()
    return await database.puzzles.find_one({"_id": "active"})

async def mark_puzzle_solved(puzzle_id: str, discord_id: str) -> bool:
    """Returns True if this is the first time the user solved this puzzle."""
    database = get_db()
    res = await database.puzzles.update_one(
        {"_id": "active", "puzzle_id": puzzle_id, "solved_by": {"$ne": discord_id}},
        {"$push": {"solved_by": discord_id}}
    )
    if res.modified_count > 0:
        # Increment leaderboard
        await database.puzzle_leaderboard.update_one(
            {"discord_id": discord_id},
            {"$inc": {"solves": 1}, "$set": {"updated_at": utc_now()}},
            upsert=True
        )
        return True
    return False

async def get_puzzle_leaderboard(limit: int = 10) -> list[dict[str, Any]]:
    database = get_db()
    cursor = database.puzzle_leaderboard.find({}).sort("solves", -1).limit(limit)
    return await cursor.to_list(length=limit)

# Player Snapshots (Fair Play & Most Improved)
async def update_player_snapshot(discord_id: str, username: str, status: str, rating: int) -> dict[str, Any] | None:
    database = get_db()
    now = utc_now()
    
    # Get previous snapshot to detect status change or rating diff
    prev = await database.player_snapshots.find_one({"discord_id": discord_id})
    
    doc = {
        "discord_id": discord_id,
        "username": username,
        "status": status,
        "rating": rating,
        "last_updated": now
    }
    
    # Track rating history for weekly reports (store last 7 days of peaks)
    if not prev or prev.get("rating") != rating:
        await database.rating_history.insert_one({
            "discord_id": discord_id,
            "rating": rating,
            "timestamp": now
        })

    await database.player_snapshots.update_one(
        {"discord_id": discord_id},
        {"$set": doc},
        upsert=True
    )
    return prev

async def get_weekly_rating_diffs() -> list[dict[str, Any]]:
    database = get_db()
    seven_days_ago = utc_now() - timedelta(days=7)
    
    # This is a bit complex for a simple query, we'll fetch all users and their history
    users = await list_users()
    results = []
    
    for user in users:
        did = user["discord_id"]
        # Get earliest rating in last 7-8 days
        start_cursor = database.rating_history.find({"discord_id": did, "timestamp": {"$gte": seven_days_ago}}).sort("timestamp", 1).limit(1)
        start_list = await start_cursor.to_list(length=1)
        
        # Get latest rating
        end_cursor = database.rating_history.find({"discord_id": did}).sort("timestamp", -1).limit(1)
        end_list = await end_cursor.to_list(length=1)
        
        if start_list and end_list:
            diff = end_list[0]["rating"] - start_list[0]["rating"]
            results.append({
                "username": user["chesscom_username"],
                "discord_id": did,
                "start_rating": start_list[0]["rating"],
                "end_rating": end_list[0]["rating"],
                "diff": diff
            })
    
    return sorted(results, key=lambda x: x["diff"], reverse=True)

async def get_recent_winners(days: int = 7) -> list[dict[str, Any]]:
    database = get_db()
    threshold = utc_now() - timedelta(days=days)
    cursor = database.tournaments.find({
        "status": "finished",
        "finished_at": {"$gte": threshold}
    })
    return [_transform_doc(doc) for doc in await cursor.to_list(length=100)]

async def get_user_stats(chesscom_username: str) -> dict[str, Any]:
    database = get_db()
    # Count wins in finished tournaments
    wins = await database.tournaments.count_documents({
        "status": "finished",
        "winner": {"$regex": f"^{chesscom_username}$", "$options": "i"}
    })
    
    # Count podiums
    podiums = await database.tournaments.count_documents({
        "status": "finished",
        "$or": [
            {"winner": {"$regex": f"^{chesscom_username}$", "$options": "i"}},
            {"runner_up": {"$regex": f"^{chesscom_username}$", "$options": "i"}},
            {"third_place": {"$regex": f"^{chesscom_username}$", "$options": "i"}}
        ]
    })
    
    # Get last 5 tournaments played
    # This is a bit simplified - we check if they were in the top 3
    # A real 'participation' check would require fetching all participants from Chess.com for every tournament
    cursor = database.tournaments.find({
        "status": "finished",
        "$or": [
            {"winner": {"$regex": f"^{chesscom_username}$", "$options": "i"}},
            {"runner_up": {"$regex": f"^{chesscom_username}$", "$options": "i"}},
            {"third_place": {"$regex": f"^{chesscom_username}$", "$options": "i"}}
        ]
    }).sort("finished_at", -1).limit(5)
    
    history = [_transform_doc(doc) for doc in await cursor.to_list(length=5)]
    
    return {
        "wins": wins,
        "podiums": podiums,
        "recent_history": history
    }
