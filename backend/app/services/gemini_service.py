import os
import logging
from typing import Optional
from dotenv import load_dotenv
from google import genai
from google.genai import types
from google.genai.errors import APIError

# Load environment variables
load_dotenv()

logger = logging.getLogger(__name__)

SYSTEM_INSTRUCTION = (
    "You are LYKA Realty's Dubai property assistant. "
    "Always respond in English by default. Use another language only when the user explicitly requests it. "
    "Do not automatically switch to Hindi. "
    "Be helpful, professional, concise, and friendly. "
    "For this step, only respond to the user's message. "
    "Do not invent specific property listings or property data."
)

DEFAULT_MODEL = "gemini-3.8-flash"
FALLBACK_MODELS = ["gemini-3.5-flash", "gemini-2.5-flash-lite"]


def get_gemini_client() -> genai.Client:
    """Initializes and returns a Gemini client using the environment API key."""
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise ValueError("GEMINI_API_KEY is not configured in the environment.")
    return genai.Client(api_key=api_key)


def generate_text_response(message: str) -> str:
    """
    Sends a user prompt to Gemini with system instructions and returns the generated response.
    Handles API errors cleanly.
    """
    if not message or not message.strip():
        raise ValueError("Message prompt cannot be empty.")

    client = get_gemini_client()
    config = types.GenerateContentConfig(
        system_instruction=SYSTEM_INSTRUCTION
    )

    models_to_try = [DEFAULT_MODEL] + FALLBACK_MODELS
    last_error: Optional[Exception] = None

    for model_name in models_to_try:
        try:
            response = client.models.generate_content(
                model=model_name,
                contents=message,
                config=config,
            )
            if response.text:
                return response.text.strip()
            return "No response generated."
        except APIError as e:
            logger.warning("Gemini model %s API error: %s", model_name, e)
            last_error = e
            continue
        except Exception as e:
            logger.error("Unexpected error with Gemini model %s: %s", model_name, e)
            last_error = e
            break

    if last_error:
        raise RuntimeError(f"Gemini API request failed: {last_error}")

    return "No response generated."
