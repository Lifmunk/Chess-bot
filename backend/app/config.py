from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "Chess Club Bot"
    app_env: str = "local"  # "local" or "deployment"
    admin_password: str = "change-me"
    admin_token_secret: str = "change-this-secret"
    admin_token_ttl_hours: int = 168

    mongodb_uri: str = "mongodb://localhost:27017"
    mongodb_db_name: str = "chessclub"
    groq_api_key: str = ""
    cors_origins: str = ""

    discord_bot_token: str = ""
    discord_guild_id: int = 0
    discord_announcement_channel_id: int = 0
    discord_results_channel_id: int = 0
    discord_puzzle_channel_id: int = 0
    discord_players_role_id: int = 0
    discord_verified_role_id: int = 0
    discord_champion_role_id: int = 0
    daily_puzzle_hour_utc: int = 12
    daily_puzzle_minute_utc: int = 0

    frontend_url: str = ""
    backend_public_url: str = ""

    @property
    def is_deployment(self) -> bool:
        return self.app_env.lower() == "deployment"

    @property
    def effective_frontend_url(self) -> str:
        if self.frontend_url:
            return self.frontend_url.rstrip("/")
        return "http://localhost:5173" if not self.is_deployment else ""

    @property
    def effective_backend_url(self) -> str:
        if self.backend_public_url:
            return self.backend_public_url.rstrip("/")
        return "http://localhost:8000" if not self.is_deployment else ""

    @property
    def cors_origin_list(self) -> list[str]:
        if self.cors_origins == "*":
            return ["*"]
        
        origins = [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]
        
        frontend = self.effective_frontend_url
        if frontend and frontend not in origins:
            origins.append(frontend)
                
        return origins

    @property
    def database_dir(self) -> Path:
        return self.database_path.parent


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
