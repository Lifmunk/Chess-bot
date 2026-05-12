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

This project is set up for a split deployment:

- **Backend** (FastAPI + Discord bot) on **Render**
- **Frontend** (React + Vite) on **Vercel**

The backend uses SQLite, so it needs persistent storage on Render. The frontend is a static Vite build that calls the backend through `VITE_API_BASE_URL`.

---

### 1. Deploy the backend on Render

#### Option A: Using `render.yaml` (recommended)

The included `render.yaml` at the repo root automates the backend setup. Just push to GitHub and create a **Blueprint** on Render.

1. Push your repo to **GitHub**.
2. Go to [Render Dashboard](https://dashboard.render.com) → **New +** → **Blueprint**.
3. Connect your GitHub repo. Render will read `render.yaml` and create the `chess-club-backend` web service automatically.
4. Before the first deploy, fill in the **Environment Variables** (see below).
5. Click **Apply** and wait for the build to finish.

#### Option B: Manual Web Service

1. Push your repo to **GitHub**.
2. On Render, create a **New Web Service**.
3. Connect your repository.
4. Set the following:
   - **Name**: `chess-club-backend`
   - **Environment**: `Python 3`
   - **Build Command**: `pip install -r backend/requirements.txt`
   - **Start Command**: `cd backend && uvicorn app.main:app --host 0.0.0.0 --port $PORT`
5. Add a **Persistent Disk** (under Advanced):
   - **Name**: `chess-data`
   - **Mount Path**: `/data`
   - **Size**: `1 GB`
6. Set the **Environment Variables** (see table below).
7. Click **Create Web Service**.

#### Required Environment Variables

| Variable | Description |
|---|---|
| `DATABASE_PATH` | Set to `/data/chessclub.db` (maps to the persistent disk) |
| `ADMIN_PASSWORD` | A strong password for the admin dashboard login |
| `ADMIN_TOKEN_SECRET` | A long random string for signing auth tokens |
| `CORS_ORIGINS` | Your Vercel frontend URL (e.g. `https://chess-club.vercel.app`) |

#### Optional Environment Variables (for Discord features)

| Variable | Description |
|---|---|
| `DISCORD_BOT_TOKEN` | Your Discord bot token |
| `DISCORD_GUILD_ID` | Your Discord server ID |
| `DISCORD_ANNOUNCEMENT_CHANNEL_ID` | Channel for tournament announcements |
| `DISCORD_RESULTS_CHANNEL_ID` | Channel for tournament results |
| `DISCORD_PUZZLE_CHANNEL_ID` | Channel for daily puzzles |
| `DISCORD_PLAYERS_ROLE_ID` | Role ID for regular players |
| `DISCORD_VERIFIED_ROLE_ID` | Role ID for verified members |
| `DISCORD_CHAMPION_ROLE_ID` | Role ID for tournament champions |
| `FRONTEND_URL` | Your Vercel frontend URL |
| `BACKEND_PUBLIC_URL` | Your Render backend URL (e.g. `https://chess-club-backend.onrender.com`) |

> The app runs fine without Discord variables — bot features are simply disabled.

---

### 2. Deploy the frontend on Vercel

1. Push your repo to **GitHub** (the same repo as the backend).
2. Go to [Vercel Dashboard](https://vercel.com) → **Add New** → **Project**.
3. Import your GitHub repository.
4. Configure the project:
   - **Root Directory**: Select `frontend` (click **Edit** → choose `frontend/`).
   - **Framework Preset**: Vite should be auto-detected. If not, select **Vite**.
   - **Build Command**: `npm run build` (auto-filled).
   - **Output Directory**: `dist` (auto-filled).
5. Add the **Environment Variable**:
   - `VITE_API_BASE_URL`: Set to your Render backend URL, e.g. `https://chess-club-backend.onrender.com`
6. Click **Deploy**.

> The included `frontend/vercel.json` handles SPA rewrites, so direct URL navigation and page refreshes work correctly.

---

### 3. Post-deployment checklist

- [ ] Confirm `https://your-render-app.onrender.com/health` returns `{"status":"ok"}`.
- [ ] Open your Vercel app and verify the login page loads.
- [ ] Sign in with the admin password set in Render's env vars.
- [ ] Click **Test API Connection** in the dashboard — you should see a greeting from the backend.
- [ ] If the dashboard can't reach the backend, verify:
  - `CORS_ORIGINS` on Render includes the exact Vercel domain (no trailing slash).
  - `VITE_API_BASE_URL` on Vercel is the full Render URL (e.g. `https://chess-club-backend.onrender.com`).
  - Both services are deployed and not in a sleeping state (Render free tier spins down after inactivity — upgrade or use a uptime monitor for production).

---

## 🎨 Design Philosophy
The UI is built with **Vanilla CSS** and a focus on clarity. The **rectangular design** utilizes sharp borders and a high-contrast palette to ensure a professional look while maintaining a lightweight footprint.

## 📄 License
MIT License. Feel free to fork and adapt for your own club!
