import os
import logging
from typing import Optional
from dotenv import load_dotenv
from openai import OpenAI

# Load environment variables
load_dotenv()

logger = logging.getLogger(__name__)

SYSTEM_INSTRUCTION = (
    "You are LYKA Realty's Dubai property assistant. "
    "Always respond in English by default. Use another language only when the user explicitly requests it. "
    "Be helpful, professional, concise, and friendly. "
    "Do not invent specific property listings or property data."
)

DEFAULT_MODEL = "gpt-4o"
FALLBACK_MODELS = ["gpt-4o-mini"]

_OPENAI_CLIENT: Optional[OpenAI] = None


def get_openai_client() -> OpenAI:
    """Initializes and returns an OpenAI client using the environment API key."""
    global _OPENAI_CLIENT
    if _OPENAI_CLIENT is None:
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise ValueError("OPENAI_API_KEY is not configured in the environment.")
        _OPENAI_CLIENT = OpenAI(api_key=api_key)
    return _OPENAI_CLIENT


def generate_text_response(message: str) -> str:
    """
    Sends a user prompt to OpenAI with system instructions and returns the generated response.
    """
    if not message or not message.strip():
        raise ValueError("Message prompt cannot be empty.")

    client = get_openai_client()
    models_to_try = [DEFAULT_MODEL] + FALLBACK_MODELS
    last_error: Optional[Exception] = None

    for model_name in models_to_try:
        try:
            response = client.chat.completions.create(
                model=model_name,
                messages=[
                    {"role": "system", "content": SYSTEM_INSTRUCTION},
                    {"role": "user", "content": message.strip()}
                ],
                temperature=0.3
            )
            choice = response.choices[0]
            if choice.message.content:
                return choice.message.content.strip()
            return "No response generated."
        except Exception as e:
            logger.warning("OpenAI model %s error: %s", model_name, e)
            last_error = e
            continue

    if last_error:
        raise RuntimeError(f"OpenAI API request failed: {last_error}")

    return "No response generated."
