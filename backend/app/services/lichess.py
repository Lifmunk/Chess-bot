from __future__ import annotations

import io
import logging
from dataclasses import dataclass
from typing import Any

import chess
import chess.svg
import httpx
import cairosvg

logger = logging.getLogger(__name__)

LICHESS_DAILY_PUZZLE_URL = "https://lichess.org/api/puzzle/daily"

@dataclass
class PuzzleData:
    game: dict[str, Any]
    puzzle: dict[str, Any]
    board: chess.Board
    solution: list[str]
    theme_text: str
    rating: int | None
    plays: int | None
    game_url: str | None
    fen: str

    @property
    def puzzle_id(self) -> str:
        return str(self.puzzle.get("id", "unknown"))

    @property
    def last_move(self) -> str:
        return str(self.puzzle.get("lastMove") or "unknown")

    @property
    def player_lines(self) -> list[str]:
        players = self.game.get("players") or []
        lines = []
        for player in players:
            name = player.get("name") or "Unknown"
            rating = player.get("rating")
            color = player.get("color") or "?"
            rating_text = f" ({rating})" if rating is not None else ""
            lines.append(f"{color.title()}: {name}{rating_text}")
        return lines


def render_board_to_bytes(fen: str, last_move_uci: str | None = None) -> io.BytesIO:
    """Generates a chess board image from FEN using SVG and returns it as a BytesIO object."""
    board = chess.Board(fen)
    
    lastmove = None
    if last_move_uci and len(last_move_uci) >= 4:
        try:
            lastmove = chess.Move.from_uci(last_move_uci)
        except ValueError:
            pass

    # Generate high-quality SVG with custom colors
    svg_data = chess.svg.board(
        board=board,
        lastmove=lastmove,
        orientation=board.turn,
        size=600,
        colors={
            "square light": "#dee3e6",
            "square dark": "#8ca2ad",
            "margin": "#fdfaf5",
            "coord": "#262421"
        }
    )

    # Convert SVG to PNG in memory
    png_bytes = cairosvg.svg2png(bytestring=svg_data.encode("utf-8"))
    
    buf = io.BytesIO(png_bytes)
    buf.seek(0)
    return buf


async def fetch_daily_puzzle() -> PuzzleData:
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.get(LICHESS_DAILY_PUZZLE_URL)
        response.raise_for_status()
        payload = response.json()

    puzzle = payload["puzzle"]
    game_data = payload.get("game", {})
    fen = puzzle["fen"]
    board = chess.Board(fen)

    themes = puzzle.get("themes", [])
    theme_text = ", ".join(themes) if isinstance(themes, list) else str(themes or "")

    return PuzzleData(
        game=game_data,
        puzzle=puzzle,
        board=board,
        solution=list(puzzle.get("solution", [])),
        theme_text=theme_text,
        rating=puzzle.get("rating"),
        plays=puzzle.get("plays"),
        game_url=f"https://lichess.org/{game_data['id']}" if game_data.get("id") else None,
        fen=fen
    )


def puzzle_message(puzzle: PuzzleData) -> str:
    players = puzzle.player_lines or ["Game details unavailable"]
    player_block = " vs ".join([p.split(": ")[1] for p in players[:2]])
    turn = "White" if puzzle.board.turn == chess.WHITE else "Black"
    
    msg = (
        f"🧩 **Lichess Daily Puzzle #{puzzle.puzzle_id}**\n"
        f"**Rating:** {puzzle.rating or 'unknown'}  •  **Themes:** {puzzle.theme_text or 'mixed'}\n"
        f"**Game:** {player_block}\n"
        f"**Goal:** Find the best move for **{turn}**!\n\n"
        f"To solve, use `/solve {puzzle.puzzle_id}` followed by your first move (e.g., `e2e4`)."
    )
    return msg
