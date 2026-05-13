import logging
from typing import Any

from groq import AsyncGroq

from ..config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)


class GroqService:
    def __init__(self):
        self.client = None

        if settings.groq_api_key:
            self.client = AsyncGroq(api_key=settings.groq_api_key)
        else:
            logger.warning("GROQ_API_KEY not set. AI features disabled.")

    async def generate_message(self, prompt_type: str, context: dict[str, Any]) -> str:
        if not self.client:
            return self._fallback_message(prompt_type, context)

        prompts = {
            "tournament_created": (
                f"Write a short and welcoming Discord announcement for a newly created chess tournament called "
                f"'{context.get('name')}'. "
                "Do not repeat technical tournament details like format, rules, or time control because they are already displayed automatically. "
                "Focus on excitement, participation, and community energy. "
                "Keep it professional, natural, and concise. Maximum 3 short paragraphs."
            ),
            "tournament_started": (
                f"Write a short Discord announcement that the tournament '{context.get('name')}' has started. "
                "Encourage players to join their games and wish everyone good luck. "
                "Keep it clean, energetic, and professional."
            ),
            "tournament_finished": (
                f"Write a professional closing announcement for the tournament '{context.get('name')}'. "
                f"Mention the winner: {context.get('winner')}. "
                f"Runner-up: {context.get('runner_up')}. "
                "Congratulate all participants and encourage everyone to join future events. "
                "Keep it respectful and concise."
            ),
            "reminder": (
                f"Write a friendly reminder for the upcoming tournament '{context.get('name')}'. "
                f"It begins in {context.get('time_left')}. "
                "Keep the tone welcoming and motivating without sounding robotic."
            ),
            "funny_ask": (
                f"User question: '{context.get('question')}'. "
                "Reply as Sarmak, a calm and intelligent chess grandmaster from Mars. "
                "Keep responses witty, short, and natural. "
                "Do not overuse Martian references."
            ),
        }

        prompt = prompts.get(
            prompt_type, "Write a short professional chess community announcement."
        )

        try:
            completion = await self.client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You are Sarmak, a respected chess grandmaster from Mars. "
                            "Your personality is calm, intelligent, welcoming, and professional. "
                            "You speak naturally like a modern community manager, not like a roleplay character. "
                            "Martian references should be subtle and occasional, never forced. "
                            "Avoid repeating structured tournament data already visible in embeds or bot UI. "
                            "Keep announcements concise, readable, and Discord-friendly."
                        ),
                    },
                    {
                        "role": "user",
                        "content": prompt,
                    },
                ],
                temperature=0.75,
                max_tokens=120,
            )

            return completion.choices[0].message.content.strip()

        except Exception as e:
            logger.error("Error generating AI message: %s", e)
            return self._fallback_message(prompt_type, context)

    async def ask_funny_question(self, question: str) -> str:
        return await self.generate_message(
            "funny_ask",
            {"question": question},
        )

    def _fallback_message(self, prompt_type: str, context: dict[str, Any]) -> str:

        if prompt_type == "tournament_created":
            return (
                f"♟️ **{context.get('name')}** has been announced.\n"
                "Registrations are now open. Good luck to everyone joining!"
            )

        if prompt_type == "tournament_started":
            return f"🚀 **{context.get('name')}** is now live.\nGood luck and have fun!"

        if prompt_type == "tournament_finished":
            return (
                f"🏆 **{context.get('name')}** has concluded.\n"
                f"Congratulations to **{context.get('winner')}** for the victory!"
            )

        if prompt_type == "reminder":
            return (
                f"⏰ Reminder: **{context.get('name')}** starts in "
                f"{context.get('time_left')}."
            )

        return "♟️ A new message from Sarmak."


ai_service = GroqService()
