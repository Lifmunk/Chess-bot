from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import Header, HTTPException, status
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from .config import get_settings


settings = get_settings()


def serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(settings.admin_token_secret, salt="chess-club-admin")


def create_admin_token() -> str:
    payload = {"username": "admin", "issued_at": datetime.now(timezone.utc).isoformat()}
    return serializer().dumps(payload)


def verify_admin_token(token: str) -> dict[str, str]:
    max_age = settings.admin_token_ttl_hours * 3600
    try:
        data = serializer().loads(token, max_age=max_age)
    except SignatureExpired as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Admin session expired") from exc
    except BadSignature as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid admin session") from exc
    return data


async def require_admin(authorization: str | None = Header(default=None)) -> dict[str, str]:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing admin token")
    token = authorization.split(" ", 1)[1].strip()
    return verify_admin_token(token)
