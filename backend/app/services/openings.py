from dataclasses import dataclass
import random

@dataclass
class ChessOpening:
    name: str
    eco: str
    moves: str
    lichess_study_url: str

OPENINGS_DATABASE = [
    ChessOpening(
        name="Sicilian Defense: Dragon Variation",
        eco="B70",
        moves="1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 g6",
        lichess_study_url="https://lichess.org/study/R7O5U7N9"
    ),
    ChessOpening(
        name="Ruy Lopez: Marshall Attack",
        eco="C89",
        moves="1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 O-O 8. c3 d5",
        lichess_study_url="https://lichess.org/study/TfKPrh6Z"
    ),
    ChessOpening(
        name="King's Indian Defense",
        eco="E61",
        moves="1. d4 Nf6 2. c4 g6 3. Nc3 Bg7",
        lichess_study_url="https://lichess.org/study/uLqB0Y6S"
    ),
    ChessOpening(
        name="Caro-Kann Defense: Advance Variation",
        eco="B12",
        moves="1. e4 c6 2. d4 d5 3. e5",
        lichess_study_url="https://lichess.org/study/mR7A7Y8S"
    ),
    ChessOpening(
        name="Italian Game: Evans Gambit",
        eco="C51",
        moves="1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. b4",
        lichess_study_url="https://lichess.org/study/HshS7Y8S"
    ),
    ChessOpening(
        name="French Defense: Winawer Variation",
        eco="C18",
        moves="1. e4 e6 2. d4 d5 3. Nc3 Bb4 4. e5 c5 5. a3 Bxc3+ 6. bxc3",
        lichess_study_url="https://lichess.org/study/0ZqB0Y6S"
    ),
    ChessOpening(
        name="Queen's Gambit Declined: Tartakower Variation",
        eco="D45",
        moves="1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. Bg5 Be7 5. e3 O-O 6. Nf3 h6 7. Bh4 b6",
        lichess_study_url="https://lichess.org/study/TfKPrh6Z"
    ),
    ChessOpening(
        name="Scandinavia Defense: Modern Variation",
        eco="B01",
        moves="1. e4 d5 2. exd5 Nf6",
        lichess_study_url="https://lichess.org/study/R7O5U7N9"
    ),
]

def get_random_opening() -> ChessOpening:
    return random.choice(OPENINGS_DATABASE)
