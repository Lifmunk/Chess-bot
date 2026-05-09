from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    password: str = Field(min_length=1)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class MeResponse(BaseModel):
    username: str = "admin"


class TournamentCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    chesscom_link: str = Field(min_length=1, max_length=500)
    format: str = Field(min_length=1, max_length=60)
    rated: bool = True
    scheduled_for: Optional[datetime] = None
    notes: Optional[str] = Field(default="", max_length=1000)
    is_automated: bool = False
    recurrence: Optional[str] = None


class TournamentResultUpdate(BaseModel):
    winner: str = Field(min_length=1, max_length=80)
    runner_up: str = Field(min_length=1, max_length=80)
    third_place: str = Field(min_length=1, max_length=80)


class TournamentOut(BaseModel):
    tournament_id: str
    name: str
    chesscom_link: str
    format: str
    rated: bool
    status: str
    scheduled_for: Optional[datetime] = None
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    winner: Optional[str] = None
    runner_up: Optional[str] = None
    third_place: Optional[str] = None
    notes: Optional[str] = ""
    is_automated: bool = False
    recurrence: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class TournamentListResponse(BaseModel):
    items: list[TournamentOut]


class MessageResponse(BaseModel):
    detail: str
