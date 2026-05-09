from __future__ import annotations

import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import chess
import chess.svg
import httpx
from PIL import Image, ImageDraw, ImageFont


LICHESS_DAILY_PUZZLE_URL = "https://lichess.org/api/puzzle/daily"

BOARD_SIZE = 960
MARGIN = 48
INFO_PANEL_HEIGHT = 260
LIGHT_SQUARE = "#f0d9b5"
DARK_SQUARE = "#b58863"
HIGHLIGHT = "#8ecae6"
HIGHLIGHT_SECONDARY = "#ffb703"
TEXT = "#181818"
SUBTLE_TEXT = "#5f5f5f"

PIECE_GLYPHS = {
    (chess.PAWN, chess.WHITE): "♙",
    (chess.KNIGHT, chess.WHITE): "♘",
    (chess.BISHOP, chess.WHITE): "♗",
    (chess.ROOK, chess.WHITE): "♖",
    (chess.QUEEN, chess.WHITE): "♕",
    (chess.KING, chess.WHITE): "♔",
    (chess.PAWN, chess.BLACK): "♟",
    (chess.KNIGHT, chess.BLACK): "♞",
    (chess.BISHOP, chess.BLACK): "♝",
    (chess.ROOK, chess.BLACK): "♜",
    (chess.QUEEN, chess.BLACK): "♛",
    (chess.KING, chess.BLACK): "♚",
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
    image = Image.new("RGB", (BOARD_SIZE + MARGIN * 2, BOARD_SIZE + INFO_PANEL_HEIGHT + MARGIN * 2), "#f7f3eb")
    draw = ImageDraw.Draw(image)

    title_font = _load_font(38, bold=True)
    body_font = _load_font(26)
    small_font = _load_font(22)
    piece_font = _load_font(52, bold=True)
    coord_font = _load_font(18)

    board = puzzle.board
    square_size = BOARD_SIZE // 8
    board_left = MARGIN
    board_top = MARGIN + 96

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
    draw.text((MARGIN, 22), "Lichess daily puzzle", fill=TEXT, font=title_font)
    header_right = BOARD_SIZE + MARGIN * 2
    draw.text((header_right - 320, 30), f"Puzzle #{puzzle.puzzle_id}", fill=SUBTLE_TEXT, font=small_font)
    draw.text((MARGIN, 68), f"{puzzle.perf_name}  •  Rated { 'yes' if puzzle.rated else 'no' }  •  Clock {puzzle.clock}", fill=SUBTLE_TEXT, font=small_font)

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
            draw.rectangle((x0, y0, x1, y1), fill=color)
            if square in highlight_squares:
                overlay = HIGHLIGHT if square == getattr(last_move, "to_square", None) else HIGHLIGHT_SECONDARY
                draw.rectangle((x0, y0, x1, y1), outline=overlay, width=8)
            piece = board.piece_at(square)
            if piece:
                glyph = PIECE_GLYPHS[_piece_key(piece)]
                text_bbox = draw.textbbox((0, 0), glyph, font=piece_font)
                text_width = text_bbox[2] - text_bbox[0]
                text_height = text_bbox[3] - text_bbox[1]
                text_x = x0 + (square_size - text_width) / 2
                text_y = y0 + (square_size - text_height) / 2 - 10
                fill = "#f5f5f5" if piece.color == chess.WHITE else "#222222"
                stroke = "#111111" if piece.color == chess.WHITE else "#f9f9f9"
                draw.text(
                    (text_x, text_y),
                    glyph,
                    fill=fill,
                    font=piece_font,
                    stroke_width=1,
                    stroke_fill=stroke,
                )

            if file == 0:
                rank_label = str(8 - rank) if board.turn == chess.WHITE else str(rank + 1)
                draw.text((board_left - 24, y0 + 10), rank_label, fill=SUBTLE_TEXT, font=coord_font)
            if rank == 7:
                file_label = chr(ord("a") + file) if board.turn == chess.WHITE else chr(ord("h") - file)
                draw.text((x0 + square_size - 16, board_top + BOARD_SIZE + 8), file_label, fill=SUBTLE_TEXT, font=coord_font)

    # Info panel
    info_top = board_top + BOARD_SIZE + 22
    draw.rounded_rectangle(
        (MARGIN, info_top, BOARD_SIZE + MARGIN, info_top + INFO_PANEL_HEIGHT - 18),
        radius=24,
        fill="#ffffff",
        outline="#e6dfd3",
        width=2,
    )

    info_x = MARGIN + 28
    info_y = info_top + 22
    draw.text((info_x, info_y), f"Puzzle ID: {puzzle.puzzle_id}", fill=TEXT, font=body_font)
    info_y += 38
    draw.text((info_x, info_y), f"Rating: {puzzle.rating or 'unknown'}", fill=TEXT, font=body_font)
    info_y += 36
    draw.text((info_x, info_y), f"Played in: {puzzle.plays or 'unknown'} games", fill=TEXT, font=body_font)
    info_y += 36
    draw.text((info_x, info_y), f"Themes: {puzzle.theme_text or 'mixed'}", fill=TEXT, font=body_font)
    info_y += 50

    if puzzle.player_lines:
        draw.text((info_x, info_y), "Game details", fill=TEXT, font=body_font)
        info_y += 34
        for line in puzzle.player_lines[:2]:
            draw.text((info_x, info_y), line, fill=SUBTLE_TEXT, font=small_font)
            info_y += 28
        info_y += 6

    hint = puzzle.opening_hint
    if hint:
        draw.text((info_x, info_y), f"Opening hint: {hint}", fill=SUBTLE_TEXT, font=small_font)

    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".jpg")
    try:
        image.save(tmp.name, format="JPEG", quality=92, optimize=True)
    finally:
        tmp.close()
    return Path(tmp.name)


async def fetch_daily_puzzle() -> PuzzleData:
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.get(LICHESS_DAILY_PUZZLE_URL)
        response.raise_for_status()
        payload = response.json()

    puzzle = payload["puzzle"]
    game = payload.get("game", {})
    fen = puzzle["fen"]
    board = chess.Board(fen)
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
        game=game,
        puzzle=puzzle,
        board=board,
        svg_bytes=svg.encode("utf-8"),
        solution=list(puzzle.get("solution", [])),
        theme_text=theme_text,
        rating=puzzle.get("rating"),
        plays=puzzle.get("plays"),
        game_url=f"https://lichess.org/{game['id']}" if game.get("id") else None,
    )


def puzzle_message(puzzle: PuzzleData) -> str:
    players = puzzle.player_lines or ["Game details unavailable"]
    player_block = "\n".join(players[:2])
    hint = puzzle.opening_hint or "No solution hint available"
    game_url = puzzle.game_url or "https://lichess.org/training"
    return (
        f"Daily puzzle #{puzzle.puzzle_id}\n"
        f"{puzzle.perf_name} • Rated {'yes' if puzzle.rated else 'no'} • Clock {puzzle.clock}\n"
        f"Rating: {puzzle.rating or 'unknown'} • Plays: {puzzle.plays or 'unknown'}\n"
        f"Themes: {puzzle.theme_text or 'mixed'}\n"
        f"{player_block}\n"
        f"Hint: {hint}\n"
        f"Source: Lichess <{game_url}>"
    )
