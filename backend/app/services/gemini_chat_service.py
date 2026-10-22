import json
import logging
import os
import time
from typing import Any, Dict, List, Optional
from dotenv import load_dotenv
from google import genai
from google.genai import types
from google.genai.errors import APIError

from app.services.property_service import search_properties_dataset

load_dotenv()
logger = logging.getLogger("lyka.chat")
logger.setLevel(logging.INFO)

CHAT_SYSTEM_INSTRUCTION = (
    "You are LYKA Realty's Dubai property assistant.\n\n"
    "CRITICAL LANGUAGE RULES:\n"
    "- Always respond in English by default.\n"
    "- Do not automatically switch to Hindi or any other language.\n"
    "- Use another language ONLY when the user explicitly requests it.\n\n"
    "Tone & Style:\n"
    "- You are friendly, professional, natural, conversational, concise, and helpful.\n\n"
    "Core instructions:\n"
    "1. Maintain complete conversational context across turns. If the user clarifies, modifies, or "
    "changes their mind (e.g., 'Actually make it 3 bedrooms', 'Forget Marina, show me Downtown', "
    "'Can I rent instead?', 'Show me cheaper ones', 'Something closer to metro', 'Only with parking'), "
    "seamlessly update your understanding and search parameters.\n"
    "2. NEVER invent or hallucinate property listings, reference IDs, prices, sqft, or amenities. "
    "All property recommendations MUST come from calling the search_properties tool.\n"
    "3. Decide when to search using tool calling:\n"
    "   - When the user asks for properties or provides criteria (e.g. location, bedrooms, budget), "
    "call search_properties to retrieve real verified listings from the Dubai dataset.\n"
    "   - When the user modifies an existing search (e.g., 'cheaper ones', 'make it 3 bedrooms', "
    "'rent instead', 'Downtown instead'), call search_properties with updated parameters.\n"
    "   - For polite greetings or casual conversation ('Hi', 'Hello', 'How are you?'), greet them warmly "
    "and offer assistance in English without searching properties (e.g. If user says 'Hi', reply like "
    "'Hello! How can I help you today?'; If user says 'How are you?', reply like "
    "'I\\'m doing well, thank you! How can I help you with Dubai real estate today?').\n"
    "4. When search_properties returns listings:\n"
    "   - Naturally and concisely introduce the top findings in English by highlighting key attributes.\n"
    "   - Encourage the user to explore the property cards or ask for more details.\n"
    "5. If search_properties returns 0 results:\n"
    "   - Explain naturally in English that no exact matches were found with those exact criteria.\n"
    "   - Suggest natural alternatives (e.g. slightly increasing budget, nearby communities, or adjusting layout).\n"
    "6. When the user specifies or modifies criteria, you can also use update_requirements to keep track of preferences."
)

MODELS_ORDER = ["gemini-3.1-flash-lite", "gemini-3.8-flash", "gemini-3.5-flash"]

_GLOBAL_CLIENT: Optional[genai.Client] = None


def get_gemini_client() -> genai.Client:
    global _GLOBAL_CLIENT
    if _GLOBAL_CLIENT is None:
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            raise ValueError("GEMINI_API_KEY is not configured in backend environment.")
        _GLOBAL_CLIENT = genai.Client(api_key=api_key)
    return _GLOBAL_CLIENT


class ChatSession:
    def __init__(self, session_id: str):
        self.session_id = session_id
        self.requirements: Dict[str, Any] = {
            "purpose": None,
            "location": None,
            "propertyType": None,
            "bhk": None,
            "budget": None,
            "nearMetro": None,
            "beachfront": None,
            "amenities": []
        }
        self.last_matched_properties: List[Dict[str, Any]] = []
        self.conversation_turns: List[Dict[str, str]] = []

    def update_req(
        self,
        purpose: Optional[str] = None,
        location: Optional[str] = None,
        property_type: Optional[str] = None,
        bedrooms: Optional[int] = None,
        budget: Optional[float] = None,
        near_metro: Optional[bool] = None,
        beachfront: Optional[bool] = None,
        amenities: Optional[List[str]] = None
    ) -> None:
        if purpose:
            p_clean = "Sale" if purpose.lower() in ["buy", "sale", "purchase"] else "Rent"
            self.requirements["purpose"] = p_clean
        if location:
            self.requirements["location"] = location
        if property_type:
            self.requirements["propertyType"] = property_type.capitalize()
        if bedrooms is not None:
            self.requirements["bhk"] = bedrooms
        if budget is not None:
            self.requirements["budget"] = int(budget)
        if near_metro is not None:
            self.requirements["nearMetro"] = near_metro
        if beachfront is not None:
            self.requirements["beachfront"] = beachfront
        if amenities:
            self.requirements["amenities"] = list(set(self.requirements["amenities"] + amenities))


_SESSIONS: Dict[str, ChatSession] = {}


def get_or_create_session(session_id: str) -> ChatSession:
    if session_id not in _SESSIONS:
        _SESSIONS[session_id] = ChatSession(session_id)
    return _SESSIONS[session_id]


def process_chat_message(
    message: str,
    session_id: str,
    client_history: Optional[List[Dict[str, str]]] = None
) -> Dict[str, Any]:
    session = get_or_create_session(session_id)
    clean_message = (message or "").strip()

    if not clean_message:
        return {
            "reply": "How can I assist you with your Dubai property search today?",
            "matched_properties": [],
            "requirements": session.requirements,
            "session_id": session_id
        }

    client = get_gemini_client()
    turn_matches: List[Dict[str, Any]] = []

    def search_properties(
        location: Optional[str] = None,
        property_type: Optional[str] = None,
        bedrooms: Optional[int] = None,
        bathrooms: Optional[int] = None,
        min_budget_aed: Optional[float] = None,
        max_budget_aed: Optional[float] = None,
        purpose: Optional[str] = None,
        near_metro: Optional[bool] = None,
        near_beach: Optional[bool] = None,
        view: Optional[str] = None,
        sort_by: Optional[str] = None
    ) -> str:
        """
        Searches the real Dubai property dataset for matching properties.
        Call this when the user is searching for real estate matching specific criteria.
        """
        nonlocal turn_matches

        # Merge with session memory
        effective_loc = location or session.requirements.get("location")
        effective_pt = property_type or session.requirements.get("propertyType")
        effective_bhk = bedrooms if bedrooms is not None else session.requirements.get("bhk")
        effective_budget = max_budget_aed if max_budget_aed is not None else session.requirements.get("budget")
        effective_purpose = purpose or session.requirements.get("purpose")
        effective_metro = near_metro if near_metro is not None else session.requirements.get("nearMetro")

        session.update_req(
            purpose=effective_purpose,
            location=effective_loc,
            property_type=effective_pt,
            bedrooms=effective_bhk,
            budget=effective_budget,
            near_metro=effective_metro,
            beachfront=near_beach
        )

        res = search_properties_dataset(
            location=effective_loc,
            property_type=effective_pt,
            bedrooms=effective_bhk,
            bathrooms=bathrooms,
            min_budget_aed=min_budget_aed,
            max_budget_aed=effective_budget,
            purpose=effective_purpose,
            near_metro=effective_metro,
            near_beach=near_beach,
            view=view,
            sort_by=sort_by,
            limit=4
        )

        turn_matches = res["top_properties"]
        session.last_matched_properties = turn_matches

        return json.dumps({
            "total_found": res["total_found"],
            "exact_match_found": res["exact_match"],
            "top_properties": res["ai_summary"],
            "applied_criteria": res["criteria"]
        })

    def update_requirements(
        purpose: Optional[str] = None,
        location: Optional[str] = None,
        property_type: Optional[str] = None,
        bedrooms: Optional[int] = None,
        budget: Optional[float] = None,
        near_metro: Optional[bool] = None,
        beachfront: Optional[bool] = None
    ) -> str:
        """
        Updates the client's current property preference profile in memory.
        """
        session.update_req(
            purpose=purpose,
            location=location,
            property_type=property_type,
            bedrooms=bedrooms,
            budget=budget,
            near_metro=near_metro,
            beachfront=beachfront
        )
        return json.dumps({
            "status": "success",
            "current_requirements": session.requirements
        })

    tools = [search_properties, update_requirements]
    config = types.GenerateContentConfig(
        system_instruction=CHAT_SYSTEM_INSTRUCTION,
        tools=tools,
        temperature=0.3
    )

    # Build history from session or client
    chat_history: List[types.Content] = []
    if session.conversation_turns:
        for t in session.conversation_turns[-10:]:
            chat_history.append(types.Content(role="user", parts=[types.Part.from_text(text=t["user"])]))
            chat_history.append(types.Content(role="model", parts=[types.Part.from_text(text=t["ai"])]))
    elif client_history:
        for h in client_history[-10:]:
            r = "user" if h.get("role") in ["user", "human"] else "model"
            txt = h.get("text") or ""
            if txt:
                chat_history.append(types.Content(role=r, parts=[types.Part.from_text(text=txt)]))

    ai_reply_text = ""
    last_error = None

    for model_name in MODELS_ORDER:
        try:
            chat = client.chats.create(
                model=model_name,
                config=config,
                history=chat_history if chat_history else None
            )
            response = chat.send_message(clean_message)
            if response.text:
                ai_reply_text = response.text.strip()
                break
        except APIError as e:
            logger.warning("Gemini model %s API error: %s", model_name, e)
            last_error = e
            time.sleep(1.0)
            continue
        except Exception as e:
            logger.error("Gemini model %s unexpected error: %s", model_name, e)
            last_error = e
            continue

    if not ai_reply_text:
        if last_error:
            logger.error("All Gemini models failed: %s", last_error)
            ai_reply_text = (
                "I apologize, our advisory system is experiencing high demand. "
                "Please share your preferred Dubai location and budget, and I'll be glad to help."
            )
        else:
            ai_reply_text = "How can I assist you with your Dubai property search today?"

    session.conversation_turns.append({"user": clean_message, "ai": ai_reply_text})

    return {
        "reply": ai_reply_text,
        "matched_properties": turn_matches,
        "requirements": session.requirements,
        "session_id": session_id
    }
