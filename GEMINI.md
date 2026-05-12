# Project Overview: Chess Club Discord Bot

A full-stack application for managing a chess club's activities, featuring a FastAPI backend, a Discord bot, and a React-based admin panel.

## Core Technologies
- **Backend:** FastAPI (Python 3.13+), `discord.py` for bot logic, `uvicorn` as the ASGI server.
- **Frontend:** React 19, Vite 6, Vanilla CSS.
- **Database:** SQLite (local `.db` file).
- **External APIs:** Lichess (puzzles), Chess.com (tournament links).

## Architecture
- **Monorepo Structure:**
  - `backend/`: Contains the FastAPI application and Discord bot.
  - `frontend/`: Contains the React admin panel.
- **Discord Bot:** Integrated into the FastAPI process using a `DiscordBridge` class and `lifespan` events.
- **State Management:** SQLite for persisting tournament data.
- **Authentication:** Simple shared admin password and token-based (itsdangerous) session management.

## Building and Running

### Prerequisites
- Python 3.13+
- Node.js (Latest LTS recommended)
- Docker & Docker Compose (Recommended for local setup)
- A Discord Bot Token (configured in `backend/.env`)

### Docker Setup (Recommended)
1. Configure `backend/.env` and `frontend/.env`.
2. Run `docker compose up --build`.

### Manual Backend Setup
1. `cd backend`
2. `python -m venv venv`
3. `source venv/bin/activate` (or `venv\Scripts\activate` on Windows)
4. `pip install -r requirements.txt`
5. `cp .env.example .env` (and configure variables)
6. `uvicorn app.main:app --reload --port 8000`

### Frontend Setup
1. `cd frontend`
2. `npm install`
3. `cp .env.example .env` (set `VITE_API_BASE_URL=http://localhost:8000`)
4. `npm run dev`

### Testing
- No automated tests currently exist.

## Development Conventions

### Backend
- **Type Safety:** Use Python type hints throughout the application.
- **Schema Management:** Use Pydantic models (`app/schemas.py`) for request/response validation.
- **Database Access:** Direct SQLite queries via `app/db.py`. Use `sqlite3.Row` for dictionary-like access.
- **Configuration:** Managed via `pydantic-settings` in `app/config.py`.
- **Async:** Leverage `async`/`await` for I/O bound operations (API, Discord, HTTPX).

### Frontend
- **State:** Use React hooks (`useState`, `useEffect`, `useMemo`).
- **API Communication:** Centralized in `src/api.js`.
- **Styling:** Vanilla CSS in `src/styles.css`. No external CSS frameworks are used.
- **Build System:** Vite.

### General
- **Security:** Never commit `.env` files. Ensure `ADMIN_TOKEN_SECRET` is strong in production.
- **Deployment:**
  - Backend: Designed for Render (Python runtime).
  - Frontend: Designed for Vercel (Static site hosting).

## Bot Features & Slash Commands
The bot registers several slash commands for community engagement:
- `/link <username>`: Links your Chess.com username and assigns the **Verified** role.
- `/puzzle`: Posts the current Lichess puzzle.
- `/leaderboard`: Displays top club players by wins.
- `/next`: Shows details for the next scheduled tournament.
- `/trigger_puzzle` (Admin only): Manually triggers a daily puzzle post.
- `/tournament info <id>`: Shows a stored tournament record.

### Advanced Features
- **Automation Engine:**
  - **Auto-Start:** Tournaments can be set to automatically start and announce in Discord at their scheduled time.
  - **Recurrence:** Support for daily, weekly, and monthly recurring tournaments. When a recurring tournament starts, the next one is automatically scheduled.
- **Automated Pings:** When a tournament winner is announced in the admin panel, the bot automatically pings the winner if they have linked their account.
- **Data Management:** A "Nuke" feature in the admin panel allows for a complete reset of all tournament and user data.
- **Dedicated Channels:** Tournament results can now be directed to a separate channel via `DISCORD_RESULTS_CHANNEL_ID`.
- **Role Management:**
  - **Verified Role:** Automatically assigned upon using `/link`.
  - **Champion Role:** Automatically assigned to the winner of a tournament if their account is linked.
- **Rich Embeds:** All tournament announcements (creation, start, results) use professional Discord embeds with timestamps and clear call-to-actions.
