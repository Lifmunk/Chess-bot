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
            logger.warning("GROQ_API_KEY not set. AI features will be disabled.")

    async def generate_message(self, prompt_type: str, context: dict[str, Any]) -> str:
        if not self.client:
            return self._fallback_message(prompt_type, context)
        
        # prompts dictionary reflects Sarmak's Martian perspective
        prompts = {
            "tournament_created": (
                f"As Grandmaster Sarmak of Mars, announce a new interplanetary-standard chess tournament: '{context.get('name')}'. "
                f"Format: {context.get('format')}. Rated: {context.get('rated')}. "
                f"Time Control: {context.get('time_control')}. "
                f"Rules: {context.get('rules') or 'Martian-Earth Unified Rules'}. "
                f"Description: {context.get('description') or 'A test of strategic excellence across the red sands.'}. "
                f"Scheduled start: {context.get('scheduled_for')}. "
                f"Tournament Link: {context.get('chesscom_link')}. "
                "Be polite, professional, and welcoming to all Earthian and Martian players. Use Discord markdown."
            ),
            "tournament_started": (
                f"As GM Sarmak, announce that the clocks have started for '{context.get('name')}'. "
                f"Link: {context.get('chesscom_link')}. Invite all competitors to take their seats at the board with Martian discipline."
            ),
            "tournament_finished": (
                f"As GM Sarmak, offer professional congratulations to the victors of '{context.get('name')}'. "
                f"Winner: {context.get('winner')}. Runner-up: {context.get('runner_up')}. Third: {context.get('third_place')}. "
                "Commend their precision and tactical depth. Acknowledge their contribution to the sport's growth on both planets."
            ),
            "reminder": (
                f"As GM Sarmak, provide a polite reminder for the tournament '{context.get('name')}'. "
                f"Commencement in {context.get('time_left')}. Link: {context.get('chesscom_link')}. "
                "Advise players to begin their mental preparations."
            ),
            "funny_ask": (
                f"The user asked: '{context.get('question')}'. "
                "Respond as Sarmak, the polite Martian Grandmaster. You are knowledgeable, professional, and slightly curious about Earthian customs. "
                "Mention your Martian heritage or the red planet if relevant, but stay respectful and focused on the wisdom of chess. "
                "Keep it short and punchy. Maximum 2-3 sentences."
            ),
        }

        prompt = prompts.get(prompt_type, "Greetings from Sarmak, Grandmaster of Mars.")

        try:
            completion = await self.client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You are Sarmak, the first non-Earthian Grandmaster, hailing from the Valles Marineris region of Mars. "
                            "You are exceptionally polite, professional, and poised. You represent the prestigious Martian Chess Academy. "
                            "While you are a master of the 64 squares, you occasionally reference Martian culture, the thin atmosphere, "
                            "or the red sands of your home planet. You view chess as a universal language that bridges the gap between Earth and Mars."
                        ),
                    },
                    {"role": "user", "content": prompt},
                ],
                temperature=0.7,
                max_tokens=150,
            )
            return completion.choices[0].message.content
        except Exception as e:
            logger.error("Error generating AI message: %s", e)
            return self._fallback_message(prompt_type, context)

    async def ask_funny_question(self, question: str) -> str:
        return await self.generate_message("funny_ask", {"question": question})

    def _fallback_message(self, prompt_type: str, context: dict[str, Any]) -> str:
        if prompt_type == "tournament_created":
            return f"🔴 **Greetings from Sarmak.** A new tournament has been scheduled: {context.get('name')}\nFormat: {context.get('format')}\nLink: {context.get('chesscom_link')}"
        if prompt_type == "tournament_started":
            return f"🚀 **The Tournament {context.get('name')} has COMMENCED.**\nSeats are available here: {context.get('chesscom_link')}"
        if prompt_type == "tournament_finished":
            return f"🏁 **Tournament {context.get('name')} Concluded.**\nWinner: {context.get('winner')}. Well played by all."
        return "A message from Grandmaster Sarmak."


ai_service = GroqService()
