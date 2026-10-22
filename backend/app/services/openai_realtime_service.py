import json
import logging
import os
from typing import Any, Dict, Optional
import httpx
from dotenv import load_dotenv

load_dotenv()
logger = logging.getLogger("lyka.openai_realtime")
logger.setLevel(logging.INFO)

REALTIME_MODEL = "gpt-realtime-1.5"
OPENAI_REALTIME_BASE_CALLS_URL = "https://api.openai.com/v1/realtime/calls"
OPENAI_REALTIME_CLIENT_SECRETS_URL = "https://api.openai.com/v1/realtime/client_secrets"

REALTIME_SYSTEM_INSTRUCTION = (
    "You are LYKA Realty's Dubai property assistant.\n\n"
    "CRITICAL LANGUAGE RULES:\n"
    "- Always respond in English by default.\n"
    "- Do not automatically switch to Hindi or any other language.\n"
    "- Use another language ONLY when the user explicitly requests it.\n\n"
    "Tone & Voice Style:\n"
    "- You are friendly, professional, natural, and conversational.\n"
    "- Keep spoken responses concise, engaging, and clear (1-3 sentences per turn for natural dialogue).\n"
    "- Respond promptly and warmly to greetings (e.g. for 'Hi' or 'Hello', give an instant, concise 1-sentence greeting asking how you can help with their Dubai property search).\n\n"
    "Core Capabilities:\n"
    "1. Welcome users and understand their Dubai property goals (e.g. buying, renting, investing).\n"
    "2. If user provides criteria (e.g. location, bedrooms, budget), call the search_properties tool to retrieve real verified Dubai listings.\n"
    "3. Seamlessly adapt when users change criteria (e.g., 'Actually 3 bedrooms', 'Increase my budget', 'Rent instead').\n"
    "4. NEVER invent or hallucinate property details or reference IDs. Use only data from search_properties.\n"
    "5. When properties are returned, highlight the top 1-2 options naturally and invite the user to view details or save favorites."
)

REALTIME_TOOLS = [
    {
        "type": "function",
        "name": "search_properties",
        "description": "Searches real Dubai properties in the Lyka Realty dataset based on location, property type, bedrooms, budget, purpose, etc.",
        "parameters": {
            "type": "object",
            "properties": {
                "location": {
                    "type": "string",
                    "description": "Dubai location/community (e.g., Dubai Marina, Downtown Dubai, Palm Jumeirah, Dubai Hills Estate, Business Bay)"
                },
                "property_type": {
                    "type": "string",
                    "description": "Property type: Apartment, Villa, Townhouse, Penthouse"
                },
                "bedrooms": {
                    "type": "integer",
                    "description": "Number of bedrooms / BHK (0 for Studio, 1, 2, 3, etc.)"
                },
                "max_budget_aed": {
                    "type": "number",
                    "description": "Maximum budget in AED"
                },
                "purpose": {
                    "type": "string",
                    "description": "Purpose: 'Sale' (or 'Buy') or 'Rent'"
                }
            }
        }
    }
]


def get_api_key() -> str:
    key = os.getenv("OPENAI_API_KEY")
    if not key:
        raise ValueError("OPENAI_API_KEY is not configured in the backend environment.")
    return key


async def create_realtime_session(model: Optional[str] = None) -> Dict[str, Any]:
    """
    Creates an ephemeral client secret session with OpenAI Realtime API (/v1/realtime/client_secrets)
    for secure browser WebRTC connection. Keeps permanent API key on backend.
    """
    api_key = get_api_key()
    selected_model = model or REALTIME_MODEL

    client_secrets_payload = {
        "session": {
            "type": "realtime",
            "model": selected_model,
            "instructions": REALTIME_SYSTEM_INSTRUCTION,
            "audio": {
                "output": {
                    "voice": "alloy"
                }
            }
        }
    }

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }

    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.post(
            OPENAI_REALTIME_CLIENT_SECRETS_URL,
            json=client_secrets_payload,
            headers=headers
        )

        if response.status_code != 200:
            error_text = response.text
            logger.error("Failed to create OpenAI Realtime client secret (%d): %s", response.status_code, error_text)
            try:
                err_json = response.json()
                msg = err_json.get("error", {}).get("message") or error_text
            except Exception:
                msg = error_text
            raise RuntimeError(f"OpenAI Realtime session creation failed ({response.status_code}): {msg}")

        session_data = response.json()
        # Provide client_secret object for client compatibility
        if "value" in session_data and "client_secret" not in session_data:
            session_data["client_secret"] = {"value": session_data["value"]}

        logger.info("Created OpenAI Realtime client secret: %s", session_data.get("value", "")[:12])
        return session_data


async def negotiate_webrtc_sdp(offer_sdp: str, model: Optional[str] = None) -> str:
    """
    Directly exchanges a WebRTC SDP offer with OpenAI's Realtime WebRTC server (/v1/realtime/calls?model=...).
    Returns the answer SDP for the browser's RTCPeerConnection.
    """
    if not offer_sdp or not offer_sdp.strip():
        raise ValueError("WebRTC SDP offer cannot be empty.")

    api_key = get_api_key()
    selected_model = model or REALTIME_MODEL

    # Ensure SDP lines use standard WebRTC CRLF endings and terminate cleanly
    raw_sdp = offer_sdp
    if "\r\n" not in raw_sdp and "\n" in raw_sdp:
        raw_sdp = raw_sdp.replace("\n", "\r\n")
    if not raw_sdp.endswith("\r\n"):
        raw_sdp += "\r\n"

    target_url = f"{OPENAI_REALTIME_BASE_CALLS_URL}?model={selected_model}"

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/sdp"
    }

    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.post(
            target_url,
            content=raw_sdp.encode("utf-8"),
            headers=headers
        )

        if response.status_code not in (200, 201):
            error_text = response.text
            logger.error("WebRTC SDP exchange failed (%d): %s", response.status_code, error_text)
            try:
                err_json = response.json()
                msg = err_json.get("error", {}).get("message") or error_text
            except Exception:
                msg = error_text
            raise RuntimeError(f"OpenAI WebRTC negotiation failed ({response.status_code}): {msg}")

        answer_sdp = response.text
        return answer_sdp
