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

### Deployment

#### Backend (Render)
1. Create a new "Blueprint" on Render and connect this repository.
2. Render will use the `render.yaml` file to set up the backend service.
3. Ensure you configure the `GROQ_API_KEY` and `DISCORD_BOT_TOKEN` in the Render environment variables or Secret Group.
4. The backend is configured to run via Docker for consistency.

#### Frontend (Vercel)
1. Create a new project on Vercel and connect this repository.
2. Set the **Root Directory** to `frontend`.
3. Configure the following environment variable:
   - `VITE_API_BASE_URL`: The URL of your deployed Render backend (e.g., `https://chess-club-backend.onrender.com`).
4. Vercel will automatically detect Vite and deploy the admin panel.

## Bot Features & Slash Commands

### Backend
- **Type Safety:** Use Python type hints throughout the application.
- **Schema Management:** Use Pydantic models (`app/schemas.py`) for request/response validation.
- **Database Access:** Asynchronous MongoDB access via `motor` in `app/db.py`.
- **Configuration:** Managed via `pydantic-settings` in `app/config.py`.
- **Async:** Leverage `async`/`await` for I/O bound operations (API, Discord, HTTPX, MongoDB).

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
- `/puzzle`: Posts the current Lichess puzzle with high-quality rendering.
- `/ask <question>`: Ask the AI Grandmaster anything and get a funny, chess-themed response.
- `/leaderboard`: Displays top club players by wins.
- `/next`: Shows details for the next scheduled tournament.
- `/trigger_puzzle` (Admin only): Manually triggers a daily puzzle post.
- `/tournament info <id>`: Shows a stored tournament record.

### Advanced Features
- **Automation Engine:**
  - **Auto-Start:** Tournaments automatically start and announce in Discord at their scheduled time.
  - **Auto-Results:** The bot automatically polls Chess.com for finished tournaments, fetches winners, updates the leaderboard, and announces results.
  - **Reminders:** Automatically pings the community 30 minutes before a tournament starts.
  - **Recurrence:** Support for daily, weekly, and monthly recurring tournaments.
- **Improved Puzzle System:**
  - Automated daily posts at a configurable time.
  - Custom high-quality board rendering with last-move highlights and game details.
- **AI Integration:**
  - Powered by Groq (LLAMA 3) for dynamic announcements and interactive commands.
- **Automated Pings:** When a tournament winner is announced (manually or automatically), the bot pings the winner if their account is linked.
- **Role Management:**
  - **Verified Role:** Automatically assigned upon using `/link`.
  - **Champion Role:** Automatically assigned to tournament winners.
- **Rich Embeds:** Professional Discord embeds with timestamps and clear call-to-actions.
