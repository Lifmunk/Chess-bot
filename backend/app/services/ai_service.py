import logging
from typing import Any
from groq import Groq
from ..config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)

class GroqService:
    def __init__(self):
        self.client = None
        if settings.groq_api_key:
            self.client = Groq(api_key=settings.groq_api_key)
        else:
            logger.warning("GROQ_API_KEY not set. AI features will be disabled.")

    async def generate_message(self, prompt_type: str, context: dict[str, Any]) -> str:
        if not self.client:
            return self._fallback_message(prompt_type, context)

        prompts = {
            "tournament_created": (
                f"Generate an enthusiastic Discord announcement for a new chess tournament scheduled for {context.get('name')}. "
                f"Format: {context.get('format')}. Rated: {context.get('rated')}. "
                f"Scheduled start: {context.get('scheduled_for')}. "
                f"Tournament Link: {context.get('chesscom_link')}. "
                "Keep it professional but exciting. Use Discord markdown."
            ),
            "tournament_started": (
                f"Generate a short, urgent Discord announcement that the tournament '{context.get('name')}' has just started! "
                f"Link: {context.get('chesscom_link')}. Tell players to join now."
            ),
            "tournament_finished": (
                f"Generate a congratulatory Discord message for the tournament '{context.get('name')}' winners. "
                f"Winner: {context.get('winner')}. Runner-up: {context.get('runner_up')}. Third: {context.get('third_place')}. "
                "Be cheerful and celebrate their achievement."
            ),
            "reminder": (
                f"Generate a friendly reminder for the upcoming chess tournament '{context.get('name')}'. "
                f"It starts in {context.get('time_left')}. Link: {context.get('chesscom_link')}."
            )
        }

        prompt = prompts.get(prompt_type, "Hello from the Chess Club!")

        try:
            # Note: Groq SDK might not be fully async in all versions, 
            # but usually it's used in async contexts or has an async client.
            # Using the standard client for simplicity as per user example.
            completion = self.client.chat.completions.create(
                model="llama-3.3-70b-versatile", # Using a common Groq model
                messages=[
                    {"role": "system", "content": "You are a helpful and enthusiastic Chess Club assistant for a Discord server."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.7,
                max_tokens=500,
            )
            return completion.choices[0].message.content
        except Exception as e:
            logger.error("Error generating AI message: %s", e)
            return self._fallback_message(prompt_type, context)

    def _fallback_message(self, prompt_type: str, context: dict[str, Any]) -> str:
        if prompt_type == "tournament_created":
            return f"🏆 **New Tournament Scheduled: {context.get('name')}**\nFormat: {context.get('format')}\nLink: {context.get('chesscom_link')}"
        if prompt_type == "tournament_started":
            return f"🚀 **The Tournament {context.get('name')} has STARTED!**\nJoin here: {context.get('chesscom_link')}"
        if prompt_type == "tournament_finished":
            return f"🏁 **Tournament {context.get('name')} Finished!**\nWinner: {context.get('winner')}"
        return "New chess event update!"

ai_service = GroqService()
