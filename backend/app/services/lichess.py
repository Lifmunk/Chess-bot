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


@dataclass
class PuzzleData:
    game: dict[str, Any]
    puzzle: dict[str, Any]
    board: chess.Board
    svg_bytes: bytes
    solution: list[str]
    theme_text: str
    rating: int | None
    plays: int | None
    game_url: str | None
    pgn: str | None = None

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
    def initial_ply(self) -> int | None:
        value = self.puzzle.get("initialPly")
        return int(value) if isinstance(value, int) else None

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

    @property
    def opening_hint(self) -> str | None:
        if not self.solution:
            return None
        return " ".join(self.solution[:2])


def _load_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
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


def _piece_key(piece: chess.Piece) -> tuple[int, bool]:
    return piece.piece_type, piece.color


def render_puzzle_jpg(puzzle: PuzzleData) -> Path:
    image = Image.new("RGB", (BOARD_SIZE + MARGIN * 2, BOARD_SIZE + INFO_PANEL_HEIGHT + MARGIN * 2 + 100), "#fdfaf5")
    draw = ImageDraw.Draw(image)

    title_font = _load_font(42, bold=True)
    body_font = _load_font(28)
    small_font = _load_font(24)
    piece_font = _load_font(60, bold=True)
    coord_font = _load_font(20, bold=True)

    board = puzzle.board
    square_size = BOARD_SIZE // 8
    board_left = MARGIN
    board_top = MARGIN + 120

    # Draw a border around the board
    draw.rectangle(
        (board_left - 4, board_top - 4, board_left + BOARD_SIZE + 4, board_top + BOARD_SIZE + 4),
        fill=BOARD_BORDER
    )

    last_move = None
    try:
        if puzzle.last_move and len(puzzle.last_move) >= 4:
            last_move = chess.Move.from_uci(puzzle.last_move)
    except ValueError:
        last_move = None

    highlight_squares: set[int] = set()
    if last_move:
        highlight_squares.update({last_move.from_square, last_move.to_square})

    def square_to_xy(square: chess.Square) -> tuple[int, int]:
        file_index = chess.square_file(square)
        rank_index = chess.square_rank(square)
        if board.turn == chess.WHITE:
            x_index = file_index
            y_index = 7 - rank_index
        else:
            x_index = 7 - file_index
            y_index = rank_index
        return board_left + x_index * square_size, board_top + y_index * square_size

    # Header
    draw.text((MARGIN, 30), "Lichess Daily Puzzle", fill=TEXT, font=title_font)
    header_right = BOARD_SIZE + MARGIN * 2
    draw.text((header_right - MARGIN - 250, 40), f"#{puzzle.puzzle_id}", fill=SUBTLE_TEXT, font=body_font)
    draw.text((MARGIN, 85), f"{puzzle.perf_name}  •  Rating {puzzle.rating}", fill=SUBTLE_TEXT, font=small_font)

    # Board squares and coordinates
    for rank in range(8):
        for file in range(8):
            if board.turn == chess.WHITE:
                square = chess.square(file, 7 - rank)
            else:
                square = chess.square(7 - file, rank)
            
            x0 = board_left + file * square_size
            y0 = board_top + rank * square_size
            x1 = x0 + square_size
            y1 = y0 + square_size
            
            color = LIGHT_SQUARE if (file + rank) % 2 == 0 else DARK_SQUARE
            
            # Highlight last move
            if square in highlight_squares:
                color = HIGHLIGHT if (file + rank) % 2 != 0 else HIGHLIGHT_SECONDARY

            draw.rectangle((x0, y0, x1, y1), fill=color)
            
            piece = board.piece_at(square)
            if piece:
                glyph = PIECE_GLYPHS[_piece_key(piece)]
                fill = "#ffffff" if piece.color == chess.WHITE else "#000000"
                stroke = "#000000" if piece.color == chess.WHITE else "#ffffff"
                
                text_bbox = draw.textbbox((0, 0), glyph, font=piece_font)
                text_width = text_bbox[2] - text_bbox[0]
                text_height = text_bbox[3] - text_bbox[1]
                
                text_x = x0 + (square_size - text_width) / 2
                text_y = y0 + (square_size - text_height) / 2 - 5
                
                draw.text(
                    (text_x, text_y),
                    glyph,
                    fill=fill,
                    font=piece_font,
                    stroke_width=2,
                    stroke_fill=stroke
                )

            # Coordinates
            if file == 0:
                rank_label = str(8 - rank) if board.turn == chess.WHITE else str(rank + 1)
                draw.text((board_left - 30, y0 + square_size // 2 - 10), rank_label, fill=TEXT, font=coord_font)
            if rank == 7:
                file_label = chr(ord("a") + file) if board.turn == chess.WHITE else chr(ord("h") - file)
                draw.text((x0 + square_size // 2 - 5, board_top + BOARD_SIZE + 10), file_label, fill=TEXT, font=coord_font)

    # Info panel
    info_top = board_top + BOARD_SIZE + 60
    draw.rounded_rectangle(
        (MARGIN, info_top, BOARD_SIZE + MARGIN, info_top + INFO_PANEL_HEIGHT),
        radius=15,
        fill="#ffffff",
        outline="#d0d0d0",
        width=1,
    )

    info_x = MARGIN + 30
    info_y = info_top + 25
    draw.text((info_x, info_y), f"Goal: Find the best move for {'White' if board.turn == chess.WHITE else 'Black'}", fill=TEXT, font=body_font)
    
    info_y += 50
    draw.text((info_x, info_y), f"Themes: {puzzle.theme_text or 'chess strategy'}", fill=SUBTLE_TEXT, font=small_font)
    
    info_y += 40
    if puzzle.player_lines:
        player_info = " vs ".join([p.split(": ")[1] for p in puzzle.player_lines[:2]])
        draw.text((info_x, info_y), f"Game: {player_info}", fill=SUBTLE_TEXT, font=small_font)

    info_y += 40
    draw.text((info_x, info_y), "Reply with your solution!", fill="#1a73e8", font=small_font)

    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".jpg")
    try:
        image.save(tmp.name, format="JPEG", quality=95, optimize=True)
    finally:
        tmp.close()
    return Path(tmp.name)


async def fetch_daily_puzzle() -> PuzzleData:
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.get(LICHESS_DAILY_PUZZLE_URL)
        response.raise_for_status()
        payload = response.json()

    puzzle = payload["puzzle"]
    game_data = payload.get("game", {})
    fen = puzzle["fen"]
    board = chess.Board(fen)

    # Generate PGN for the puzzle solution
    pgn_game = chess.pgn.Game()
    pgn_game.setup(board)
    pgn_game.headers["Event"] = f"Lichess Daily Puzzle #{puzzle['id']}"
    pgn_game.headers["FEN"] = fen
    
    node = pgn_game
    for move_uci in puzzle.get("solution", []):
        move = chess.Move.from_uci(move_uci)
        node = node.add_main_variation(move)
    
    pgn_string = str(pgn_game)

    svg = chess.svg.board(
        board,
        size=540,
        lastmove=chess.Move.from_uci(puzzle["lastMove"]) if puzzle.get("lastMove") else None,
        coordinates=True,
        orientation=chess.WHITE if board.turn == chess.WHITE else chess.BLACK,
    )

    themes = puzzle.get("themes", [])
    theme_text = ", ".join(themes) if isinstance(themes, list) else str(themes or "")

    return PuzzleData(
        game=game_data,
        puzzle=puzzle,
        board=board,
        svg_bytes=svg.encode("utf-8"),
        solution=list(puzzle.get("solution", [])),
        theme_text=theme_text,
        rating=puzzle.get("rating"),
        plays=puzzle.get("plays"),
        game_url=f"https://lichess.org/{game_data['id']}" if game_data.get("id") else None,
        pgn=pgn_string,
    )


def puzzle_message(puzzle: PuzzleData) -> str:
    players = puzzle.player_lines or ["Game details unavailable"]
    player_block = "\n".join(players[:2])
    hint = puzzle.opening_hint or "No solution hint available"
    game_url = puzzle.game_url or "https://lichess.org/training"
    
    msg = (
        f"Daily puzzle #{puzzle.puzzle_id}\n"
        f"{puzzle.perf_name} • Rated {'yes' if puzzle.rated else 'no'} • Clock {puzzle.clock}\n"
        f"Rating: {puzzle.rating or 'unknown'} • Plays: {puzzle.plays or 'unknown'}\n"
        f"Themes: {puzzle.theme_text or 'mixed'}\n"
        f"{player_block}\n"
        f"Hint: {hint}\n"
    )
    
    if puzzle.pgn:
        msg += f"\n**PGN:**\n```\n{puzzle.pgn}\n```\n"
        
    msg += f"Source: Lichess <{game_url}>"
    return msg
