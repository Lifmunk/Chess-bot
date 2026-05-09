# ♟️ Chess Club Manager & Discord Bot

A powerful, full-stack management suite for chess clubs. This project combines a high-performance **FastAPI** backend with a sleek, **React-based** moderator dashboard and an automated **Discord bot**.

---

## 🚀 Key Features

### 🛠️ Admin Dashboard
- **Dark Mode UI**: Minimalist, high-contrast dark theme with a modern rectangular aesthetic.
- **Tournament Control**: Create, search, filter, and manage tournaments with ease.
- **Automated Scheduling**: Support for one-time and recurring tournaments (daily/weekly/monthly).
- **Results Engine**: Publish winners directly to Discord with automatic role assignments.
- **System Diagnostics**: Built-in API connection testing and database management.

### 🤖 Discord Bot
- **Slash Commands**: `/puzzle`, `/leaderboard`, `/next`, `/link`, `/stats`, and more.
- **Automated Announcements**: Real-time posts for tournament creation, starts, and results.
- **Role Management**: Automatically assigns "Verified" roles to linked users and "Champion" roles to winners.
- **Daily Puzzles**: Fetches and posts high-quality puzzles from Lichess every day.

---

## 📂 Project Structure

```text
├── backend/                # FastAPI, Discord.py, SQLite
│   ├── app/                # Application logic
│   ├── data/               # Persistent database storage
│   └── requirements.txt    # Python dependencies
├── frontend/               # React 19, Vite 6, Vanilla CSS
│   ├── src/                # UI components and API bridge
│   └── package.json        # JS dependencies
└── docker-compose.yml      # Orchestration for local development
```

---

## 🛠️ Installation & Setup

### 1. Prerequisites
- **Python 3.13+**
- **Node.js 20+**
- **Discord Bot Token** (from the [Developer Portal](https://discord.com/developers/applications))

### 2. Environment Configuration

#### Backend (`backend/.env`)
| Variable | Description |
| --- | --- |
| `ADMIN_PASSWORD` | Password for dashboard login |
| `ADMIN_TOKEN_SECRET` | Secret for session tokens |
| `DISCORD_BOT_TOKEN` | Your Discord bot token |
| `DISCORD_GUILD_ID` | Your server ID |
| `DISCORD_ANNOUNCEMENT_CHANNEL_ID` | Channel for tournament posts |
| `DISCORD_PUZZLE_CHANNEL_ID` | Channel for daily puzzles |

#### Frontend (`frontend/.env`)
| Variable | Description |
| --- | --- |
| `VITE_API_BASE_URL` | `http://localhost:8000` (development) |

### 3. Quick Start with Docker
```bash
docker compose up --build
```
Access the dashboard at `http://localhost:5173`.

### 4. Manual Setup

**Backend:**
```bash
cd backend
python -m venv venv
source venv/bin/activate # or venv\Scripts\activate on Windows
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev
```

---

## 🔌 API Documentation

### Public Endpoints
- `GET /health`: Basic health check.
- `GET /test`: Returns a random greeting (used for connection testing).

### Protected Endpoints (Requires Admin Token)
- `GET /tournaments`: List all tournaments.
- `POST /tournaments`: Create a new tournament.
- `POST /tournaments/{id}/start`: Mark as started.
- `POST /tournaments/{id}/finish`: Publish winners.
- `POST /nuke`: Wipe the database (Danger!).

---

## 🤖 Discord Bot Commands

| Command | Usage |
| --- | --- |
| `/link <username>` | Connect your Chess.com account |
| `/puzzle` | Post a random Lichess puzzle |
| `/leaderboard` | Show top club players |
| `/next` | Show the next upcoming tournament |
| `/stats [user]` | View player statistics |

---

## 🌐 Deployment Guide

### Backend: Render.com
1.  **Create a new Blueprint**: Connect your GitHub repository to Render and it will automatically detect the `render.yaml` file.
2.  **Environment Variables**: Render will prompt you for the variables in the `chess-club-secrets` group (Discord tokens, etc.).
3.  **Persistence**: The `render.yaml` automatically configures a **1GB Disk** mounted at `/data` to ensure your SQLite database persists across deployments.

### Frontend: Vercel
1.  **Import Project**: Push your code to GitHub and import the repository into Vercel.
2.  **Root Directory**: Set the root directory to `frontend`.
3.  **Framework Preset**: Select **Vite**.
4.  **Environment Variables**: Add `VITE_API_BASE_URL` pointing to your Render backend URL (e.g., `https://chess-club-backend.onrender.com`).
5.  **SPA Support**: The included `frontend/vercel.json` ensures that client-side routing works correctly.

---

## 🎨 Design Philosophy
The UI is built with **Vanilla CSS** and a focus on clarity. The **rectangular design** utilizes sharp borders and a high-contrast palette to ensure a professional look while maintaining a lightweight footprint.

## 📄 License
MIT License. Feel free to fork and adapt for your own club!
