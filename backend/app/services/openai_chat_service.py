import json
import logging
import os
from typing import Any, Dict, List, Optional
from dotenv import load_dotenv
from openai import OpenAI

from app.services.property_service import search_properties_dataset

load_dotenv()
logger = logging.getLogger("lyka.openai_chat")
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
    "'Hello! How can I help you find your dream property in Dubai today?').\n"
    "4. When search_properties returns listings:\n"
    "   - Naturally and concisely introduce the top findings in English by highlighting key attributes.\n"
    "   - Encourage the user to explore the property cards, view details, or save properties they are interested in.\n"
    "5. If search_properties returns 0 results:\n"
    "   - Explain naturally in English that no exact matches were found with those exact criteria.\n"
    "   - Suggest natural alternatives (e.g. slightly increasing budget, nearby communities, or adjusting layout).\n"
    "6. When the user specifies or modifies criteria, you can also use update_requirements to keep track of preferences."
)

DEFAULT_CHAT_MODEL = "gpt-4o"
FALLBACK_CHAT_MODELS = ["gpt-4o-mini"]

_OPENAI_CLIENT: Optional[OpenAI] = None


def get_openai_client() -> OpenAI:
    global _OPENAI_CLIENT
    if _OPENAI_CLIENT is None:
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise ValueError("OPENAI_API_KEY is not configured in backend environment.")
        _OPENAI_CLIENT = OpenAI(api_key=api_key)
    return _OPENAI_CLIENT


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
            p_clean = "Sale" if purpose.lower() in ["buy", "sale", "purchase", "invest"] else "Rent"
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


OPENAI_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "search_properties",
            "description": "Searches the real Dubai property dataset for matching listings based on criteria.",
            "parameters": {
                "type": "object",
                "properties": {
                    "location": {
                        "type": "string",
                        "description": "Dubai location/community, e.g. Dubai Marina, Downtown Dubai, Palm Jumeirah, Business Bay"
                    },
                    "property_type": {
                        "type": "string",
                        "description": "Property type: Apartment, Villa, Townhouse, Penthouse"
                    },
                    "bedrooms": {
                        "type": "integer",
                        "description": "Number of bedrooms / BHK (0 for Studio, 1, 2, 3, etc.)"
                    },
                    "bathrooms": {
                        "type": "integer",
                        "description": "Minimum number of bathrooms"
                    },
                    "max_budget_aed": {
                        "type": "number",
                        "description": "Maximum budget in AED"
                    },
                    "min_budget_aed": {
                        "type": "number",
                        "description": "Minimum budget in AED"
                    },
                    "purpose": {
                        "type": "string",
                        "description": "Listing purpose: 'Sale' (or 'Buy') or 'Rent'"
                    },
                    "near_metro": {
                        "type": "boolean",
                        "description": "Whether the property must be near a Dubai Metro station"
                    },
                    "near_beach": {
                        "type": "boolean",
                        "description": "Whether the property should have direct beach access or sea view"
                    },
                    "view": {
                        "type": "string",
                        "description": "Desired view, e.g. Sea View, Marina View, Burj Khalifa View"
                    },
                    "sort_by": {
                        "type": "string",
                        "enum": ["cheapest", "expensive", "size"],
                        "description": "Sorting preference"
                    }
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "update_requirements",
            "description": "Updates client's property preference profile in memory.",
            "parameters": {
                "type": "object",
                "properties": {
                    "purpose": {"type": "string"},
                    "location": {"type": "string"},
                    "property_type": {"type": "string"},
                    "bedrooms": {"type": "integer"},
                    "budget": {"type": "number"},
                    "near_metro": {"type": "boolean"},
                    "beachfront": {"type": "boolean"}
                }
            }
        }
    }
]


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

    try:
        client = get_openai_client()
    except ValueError:
        return {
            "reply": "Welcome to LYKA Realty! Please configure your OPENAI_API_KEY in backend/.env to activate live conversational voice and chat with OpenAI Realtime.",
            "matched_properties": [],
            "requirements": session.requirements,
            "session_id": session_id
        }

    turn_matches: List[Dict[str, Any]] = []

    def execute_search_properties(args: Dict[str, Any]) -> str:
        nonlocal turn_matches

        location = args.get("location")
        property_type = args.get("property_type")
        bedrooms = args.get("bedrooms")
        bathrooms = args.get("bathrooms")
        min_budget_aed = args.get("min_budget_aed")
        max_budget_aed = args.get("max_budget_aed")
        purpose = args.get("purpose")
        near_metro = args.get("near_metro")
        near_beach = args.get("near_beach")
        view = args.get("view")
        sort_by = args.get("sort_by")

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

    def execute_update_requirements(args: Dict[str, Any]) -> str:
        session.update_req(
            purpose=args.get("purpose"),
            location=args.get("location"),
            property_type=args.get("property_type"),
            bedrooms=args.get("bedrooms"),
            budget=args.get("budget"),
            near_metro=args.get("near_metro"),
            beachfront=args.get("beachfront")
        )
        return json.dumps({
            "status": "success",
            "current_requirements": session.requirements
        })

    # Build messages array
    messages: List[Dict[str, Any]] = [
        {"role": "system", "content": CHAT_SYSTEM_INSTRUCTION}
    ]

    # Incorporate history
    if session.conversation_turns:
        for t in session.conversation_turns[-10:]:
            messages.append({"role": "user", "content": t["user"]})
            messages.append({"role": "assistant", "content": t["ai"]})
    elif client_history:
        for h in client_history[-10:]:
            role = "user" if h.get("role") in ["user", "human"] else "assistant"
            txt = h.get("text") or ""
            if txt:
                messages.append({"role": role, "content": txt})

    # Current user turn
    messages.append({"role": "user", "content": clean_message})

    ai_reply_text = ""
    models_to_try = [DEFAULT_CHAT_MODEL] + FALLBACK_CHAT_MODELS

    for model_name in models_to_try:
        try:
            # 1st call: model may call tools
            response = client.chat.completions.create(
                model=model_name,
                messages=messages,
                tools=OPENAI_TOOLS,
                tool_choice="auto",
                temperature=0.3
            )

            response_msg = response.choices[0].message

            if response_msg.tool_calls:
                # Append assistant tool call message
                messages.append(response_msg.to_dict() if hasattr(response_msg, "to_dict") else response_msg)

                # Process all tool calls
                for tool_call in response_msg.tool_calls:
                    fn_name = tool_call.function.name
                    fn_args_raw = tool_call.function.arguments or "{}"
                    try:
                        fn_args = json.loads(fn_args_raw)
                    except Exception:
                        fn_args = {}

                    if fn_name == "search_properties":
                        tool_result = execute_search_properties(fn_args)
                    elif fn_name == "update_requirements":
                        tool_result = execute_update_requirements(fn_args)
                    else:
                        tool_result = json.dumps({"error": f"Unknown tool {fn_name}"})

                    messages.append({
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "content": tool_result
                    })

                # 2nd call: model generates conversational reply based on tool outputs
                second_response = client.chat.completions.create(
                    model=model_name,
                    messages=messages,
                    temperature=0.3
                )
                ai_reply_text = second_response.choices[0].message.content or ""
            else:
                ai_reply_text = response_msg.content or ""

            if ai_reply_text:
                break

        except Exception as e:
            logger.warning("OpenAI model %s chat failed: %s", model_name, e)
            continue

    if not ai_reply_text:
        ai_reply_text = (
            "I'd be delighted to help you explore Dubai's finest properties. "
            "Could you share your preferred location, property type, or budget?"
        )

    session.conversation_turns.append({"user": clean_message, "ai": ai_reply_text})

    return {
        "reply": ai_reply_text,
        "matched_properties": turn_matches,
        "requirements": session.requirements,
        "session_id": session_id
    }
