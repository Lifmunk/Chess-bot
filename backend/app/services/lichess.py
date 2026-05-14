from __future__ import annotations

import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import chess
import chess.svg
import chess.pgn
import io
import httpx
from PIL import Image, ImageDraw, ImageFont


LICHESS_DAILY_PUZZLE_URL = "https://lichess.org/api/puzzle/daily"

BOARD_SIZE = 800
MARGIN = 60
INFO_PANEL_HEIGHT = 220
LIGHT_SQUARE = "#dee3e6"
DARK_SQUARE = "#8ca2ad"
HIGHLIGHT = "#bbc91c"  # Classic Lichess green highlight
HIGHLIGHT_SECONDARY = "#f5f682"
TEXT = "#262421"
SUBTLE_TEXT = "#6b6b6b"
BOARD_BORDER = "#403d39"

PIECE_GLYPHS = {
    (chess.PAWN, chess.WHITE): "P",
    (chess.KNIGHT, chess.WHITE): "N",
    (chess.BISHOP, chess.WHITE): "B",
    (chess.ROOK, chess.WHITE): "R",
    (chess.QUEEN, chess.WHITE): "Q",
    (chess.KING, chess.WHITE): "K",
    (chess.PAWN, chess.BLACK): "p",
    (chess.KNIGHT, chess.BLACK): "n",
    (chess.BISHOP, chess.BLACK): "b",
    (chess.ROOK, chess.BLACK): "r",
    (chess.QUEEN, chess.BLACK): "q",
    (chess.KING, chess.BLACK): "k",
}


import io
import httpx
from PIL import Image
from chessboard_image import BoardImage


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
    def perf_name(self) -> str:
        perf = self.game.get("perf") or {}
        return str(perf.get("name") or perf.get("key") or "Unknown")

    @property
    def rated(self) -> bool:
        return bool(self.game.get("rated"))

    @property
    def clock(self) -> str:
        return str(self.game.get("clock") or "unknown")

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
    """Generates a chess board image from FEN and returns it as a BytesIO object."""
    # chessboard-image uses BoardImage(fen, highlights=[...])
    highlights = []
    if last_move_uci and len(last_move_uci) >= 4:
        try:
            m = chess.Move.from_uci(last_move_uci)
            highlights = [m.from_square, m.to_square]
        except ValueError:
            pass
            
    # board_image returns a PIL Image
    image = BoardImage(fen).render(highlights=highlights)
    
    # We want to add a footer with "Turn to move" info or similar? 
    # For now keep it simple.
    
    buf = io.BytesIO()
    image.save(buf, format="PNG")
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
