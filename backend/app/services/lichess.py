from __future__ import annotations

import io
import logging
from dataclasses import dataclass
from typing import Any

import chess
import httpx
from PIL import Image, ImageDraw, ImageFont

logger = logging.getLogger(__name__)

LICHESS_DAILY_PUZZLE_URL = "https://lichess.org/api/puzzle/daily"

# Visual Constants
BOARD_SIZE = 600
MARGIN = 40
LIGHT_SQUARE = "#dee3e6"
DARK_SQUARE = "#8ca2ad"
HIGHLIGHT = "#bbc91c"  # Classic Lichess green highlight
HIGHLIGHT_SECONDARY = "#f5f682"
TEXT = "#262421"
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


def _load_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    # Common Linux font paths for Render environment
    font_paths = (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf",
    )
    for path in font_paths:
        try:
            return ImageFont.truetype(path, size=size)
        except OSError:
            continue
    return ImageFont.load_default()


def render_board_to_bytes(fen: str, last_move_uci: str | None = None) -> io.BytesIO:
    """Generates a chess board image from FEN and returns it as a BytesIO object."""
    board = chess.Board(fen)
    image = Image.new("RGB", (BOARD_SIZE + MARGIN * 2, BOARD_SIZE + MARGIN * 2), "#fdfaf5")
    draw = ImageDraw.Draw(image)

    piece_font = _load_font(48, bold=True)
    coord_font = _load_font(14, bold=True)

    square_size = BOARD_SIZE // 8
    board_left = MARGIN
    board_top = MARGIN

    # Draw border
    draw.rectangle(
        (board_left - 2, board_top - 2, board_left + BOARD_SIZE + 2, board_top + BOARD_SIZE + 2),
        fill=BOARD_BORDER
    )

    highlight_squares: set[int] = set()
    if last_move_uci and len(last_move_uci) >= 4:
        try:
            m = chess.Move.from_uci(last_move_uci)
            highlight_squares.update({m.from_square, m.to_square})
        except ValueError:
            pass

    # Board orientation: White at bottom if white to move, else Black at bottom
    perspective = board.turn

    for rank in range(8):
        for file in range(8):
            # Map (file, rank) based on perspective
            if perspective == chess.WHITE:
                square = chess.square(file, 7 - rank)
                display_rank = str(8 - rank)
                display_file = chr(ord("a") + file)
            else:
                square = chess.square(7 - file, rank)
                display_rank = str(rank + 1)
                display_file = chr(ord("h") - file)
            
            x0 = board_left + file * square_size
            y0 = board_top + rank * square_size
            x1 = x0 + square_size
            y1 = y0 + square_size
            
            # Base color
            color = LIGHT_SQUARE if (file + rank) % 2 == 0 else DARK_SQUARE
            
            # Highlight
            if square in highlight_squares:
                color = HIGHLIGHT if (file + rank) % 2 != 0 else HIGHLIGHT_SECONDARY

            draw.rectangle((x0, y0, x1, y1), fill=color)
            
            # Piece
            piece = board.piece_at(square)
            if piece:
                glyph = PIECE_GLYPHS[(piece.piece_type, piece.color)]
                fill = "#ffffff" if piece.color == chess.WHITE else "#000000"
                stroke = "#000000" if piece.color == chess.WHITE else "#ffffff"
                
                text_bbox = draw.textbbox((0, 0), glyph, font=piece_font)
                text_width = text_bbox[2] - text_bbox[0]
                text_height = text_bbox[3] - text_bbox[1]
                
                text_x = x0 + (square_size - text_width) / 2
                text_y = y0 + (square_size - text_height) / 2 - 2
                
                draw.text(
                    (text_x, text_y),
                    glyph,
                    fill=fill,
                    font=piece_font,
                    stroke_width=2,
                    stroke_fill=stroke
                )

            # Coordinates
            if file == 0: # Rank labels
                draw.text((board_left - 20, y0 + square_size // 2 - 8), display_rank, fill=TEXT, font=coord_font)
            if rank == 7: # File labels
                draw.text((x0 + square_size // 2 - 4, board_top + BOARD_SIZE + 5), display_file, fill=TEXT, font=coord_font)

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
