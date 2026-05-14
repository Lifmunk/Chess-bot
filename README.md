# ♟️ Chess Club Discord Bot & Admin Suite

A high-performance, full-stack application designed for managing competitive chess communities. Features a professional Discord bot with automated matchmaking, interactive puzzles, and tournament tracking, paired with a sleek React-based admin dashboard for community management.

## 🚀 Key Features

### 🤖 Discord Bot
- **Interactive Puzzle System:** Daily high-quality chess puzzles from Lichess with private, move-by-move solving logic and a points-based leaderboard.
- **Automated Matchmaking:** Seek opponents based on time control and rating. The bot automatically finds and pings online players with similar skills.
- **Account Linking:** `/link` your Chess.com account to verify membership and automatically receive Discord roles based on your rating.
- **AI Grandmaster:** Powered by Groq (LLAMA 3), ask chess-related questions and get expert (and often humorous) insights.
- **Tournament Integration:** Automated announcements for upcoming, started, and finished tournaments with automatic winner tracking and "Champion" role assignment.

### 🛡️ Admin Dashboard
- **Dynamic Settings:** Configure your Discord server, channel selections, and role mappings using live dropdowns—no manual ID entry required.
- **Tournament Management:** Create, schedule, and automate tournaments. Includes a "Fetch Details" feature to pull data directly from Chess.com links.
- **Announcement Engine:** Schedule or send immediate bot announcements with a live Markdown preview.
- **Member Directory:** Manage linked accounts and manually link/unlink users.

---

## 🛠️ Bot Configuration (Crucial)

To function correctly, the Discord bot requires specific settings in the [Discord Developer Portal](https://discord.com/developers/applications):

### 1. OAuth2 Scopes
- `bot`
- `applications.commands`

### 2. Bot Permissions
- **General:** `Manage Roles`, `View Channels`.
- **Text:** `Send Messages`, `Embed Links`, `Attach Files`, `Read Message History`, `Add Reactions`, `Use Slash Commands`.

### 3. Privileged Gateway Intents
**You MUST enable these in the "Bot" tab:**
- **Presence Intent:** Required for the matchmaking system to see who is online.
- **Server Members Intent:** Required for automatic role assignment and linking.
- **Message Content Intent:** Required for the AI mention logic and puzzle interactions.

---

## ⚙️ Environment Variables

Create a `.env` file in the `backend/` directory based on `.env.example`:

| Variable | Description |
| :--- | :--- |
| `DISCORD_BOT_TOKEN` | Your Discord bot token from the Developer Portal. |
| `MONGODB_URI` | MongoDB connection string (Local or Atlas). |
| `GROQ_API_KEY` | API Key from Groq for AI features. |
| `ADMIN_PASSWORD` | The password used to access the React Admin Panel. |
| `ADMIN_TOKEN_SECRET` | A secret string for signing admin session tokens. |
| `DAILY_PUZZLE_HOUR_UTC` | Hour (0-23) to post the daily puzzle. |

---

## 🏃 Setup & Installation

### Option 1: Docker (Recommended)
The easiest way to get started with everything pre-configured.
```bash
docker-compose up --build
```

### Option 2: Local Development

#### Backend (FastAPI)
1. Navigate to `backend/`.
2. Install dependencies: `pip install -r requirements.txt`.
3. Run the server: `uvicorn app.main:app --reload`.

#### Frontend (React + Vite)
1. Navigate to `frontend/`.
2. Install dependencies: `npm install`.
3. Set `VITE_API_BASE_URL` in your `.env`.
4. Run: `npm run dev`.

---

## 📜 Slash Commands Reference

| Command | Description |
| :--- | :--- |
| `/help` | List all available commands and their usage. |
| `/link <username>` | Links your Chess.com account and updates your roles. |
| `/solve <id> <move>` | Privately attempt to solve the active daily puzzle. |
| `/match <time>` | Seek an online opponent with a similar rating. |
| `/match_cancel` | Cancel your active matchmaking seek. |
| `/profile [member]` | Show a detailed chess profile with stats and history. |
| `/rank [member]` | View club rank and win statistics. |
| `/leaderboard` | Show the top 10 tournament winners. |
| `/puzzle_leaderboard`| Show the top puzzle solvers and their total points. |
| `/opening` | Show the current "Opening of the Week." |
| `/ask <question>` | Ask the AI Grandmaster a chess-themed question. |
| `/next` | Show details for the next scheduled club tournament. |
| `/trigger_puzzle` (Admin) | Post the daily puzzle immediately. |
| `/sync` (Admin) | Force a re-sync of slash commands to the server. |
| `/tournament info <id>` | Show a stored tournament by ID. |

---

## 📈 Role & Point System
- **Points:** Correct puzzle moves (+1), full puzzle completion (+5).
- **Verified Role:** Automatically assigned upon linking a valid club-member account.
- **Rating Roles:** Automatically assigned based on the highest of Blitz/Rapid ratings:
  - **Expert:** 2000+
  - **Intermediate:** 1200 - 1999
  - **Beginner:** 0 - 1199
- **Champion Role:** Automatically granted to the winner of a club tournament.

---

## 🚀 Deployment

### Backend (Render/Heroku)
The backend is Dockerized and ready for deployment on Render. Ensure all environment variables are set in the dashboard.

### Frontend (Vercel/Netlify)
Build the frontend using `npm run build` and deploy the `dist/` folder. Ensure `VITE_API_BASE_URL` points to your deployed backend.

---

## 📄 License
MIT License. Created for the Chess Club Community.
