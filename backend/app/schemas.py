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
    time_control: str = Field(default="10 min", min_length=1, max_length=60)
    rules: Optional[str] = Field(default="", max_length=2000)
    description: Optional[str] = Field(default="", max_length=2000)
    rated: bool = True
    scheduled_for: Optional[datetime] = None
    notes: Optional[str] = Field(default="", max_length=1000)
    is_automated: bool = False
    recurrence: Optional[str] = None


class TournamentUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=120)
    chesscom_link: Optional[str] = Field(None, max_length=500)
    format: Optional[str] = Field(None, max_length=60)
    time_control: Optional[str] = Field(None, max_length=60)
    rules: Optional[str] = Field(None, max_length=2000)
    description: Optional[str] = Field(None, max_length=2000)
    rated: Optional[bool] = None
    scheduled_for: Optional[datetime] = None
    notes: Optional[str] = Field(None, max_length=1000)
    is_automated: Optional[bool] = None
    recurrence: Optional[str] = None
    status: Optional[str] = None
    reannounce: Optional[bool] = False


class TournamentResultUpdate(BaseModel):
    winner: str = Field(min_length=1, max_length=80)
    runner_up: str = Field(min_length=1, max_length=80)
    third_place: str = Field(min_length=1, max_length=80)


class TournamentOut(BaseModel):
    tournament_id: str
    name: str
    chesscom_link: str
    format: str
    time_control: str = "10 min"
    rules: Optional[str] = ""
    description: Optional[str] = ""
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


class UserOut(BaseModel):
    discord_id: str
    chesscom_username: str
    updated_at: datetime


class UserLinkRequest(BaseModel):
    discord_id: str
    chesscom_username: str


class TournamentListResponse(BaseModel):
    items: list[TournamentOut]


class UserListResponse(BaseModel):
    items: list[UserOut]


class AnnouncementRequest(BaseModel):
    channel_id: str = Field(min_length=1)
    message: str = Field(min_length=1, max_length=2000)


class AnnouncementCreate(BaseModel):
    channel_id: str = Field(min_length=1)
    message: str = Field(min_length=1, max_length=2000)
    scheduled_for: datetime


class AnnouncementUpdate(BaseModel):
    channel_id: Optional[str] = Field(None, min_length=1)
    message: Optional[str] = Field(None, min_length=1, max_length=2000)
    scheduled_for: Optional[datetime] = None


class AnnouncementOut(BaseModel):
    announcement_id: str
    channel_id: str
    message: str
    scheduled_for: datetime
    sent: bool
    created_at: datetime
