import json
import logging
import os
import re
import time
from typing import Any, Dict, List, Optional
import httpx
from dotenv import load_dotenv

from app.services.property_service import search_properties_dataset

load_dotenv()
logger = logging.getLogger("lyka.ollama_chat")
logger.setLevel(logging.INFO)

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2:3b")

# Short-lived cache for the Ollama /api/tags probe so chat turns do not pay
# for a redundant health round-trip on every message.
_HEALTH_CACHE: Dict[str, Any] = {}
_HEALTH_TTL_S = 30.0

# Deterministic instant replies: greetings and small talk are answered
# without any DB scan or model call (0ms AI time). Keeps "Hi" / "How are
# you?" / "Thanks" / "Bye" fast and never triggers a property search.
_INSTANT_GREETINGS_LIST = [
    "Hello and welcome to LYKA Realty! I'm your Dubai property concierge. Are you looking to buy or rent — and which community do you love?",
    "Welcome to LYKA Realty! Wonderful to connect with you. Tell me what kind of home you're envisioning in Dubai.",
    "Hello! Welcome to LYKA Realty. I'm here to help you find verified luxury homes across Dubai. Where would you like to begin?",
    "Warm greetings from LYKA Realty! Whether you're searching for an apartment, villa, or investment, I'm ready to assist.",
    "Hi there! Welcome to LYKA Realty. Tell me your preferred location, budget, or bedroom count to get started."
]
_INSTANT_GREETINGS = _INSTANT_GREETINGS_LIST[0]

_GREETING_RE = re.compile(
    r"^(hi+|hello+|hey+|yo|hiya|salam|salaam|namaste|greetings?|howdy|good\s*(morning|afternoon|evening|day))\b",
    re.IGNORECASE
)
_INSTANT_HOW_ARE_YOU = (
    "I'm doing wonderfully, thank you for asking! Ready to help you find "
    "a great Dubai home. How are you feeling today — and what kind of "
    "home are you dreaming about?"
)
_INSTANT_THANKS = (
    "You're so welcome! It was my pleasure. I'm here whenever you need — "
    "just tell me a location, budget, or bedroom count to keep exploring."
)
_INSTANT_BYE = (
    "Goodbye for now! Wishing you a wonderful day — I'll keep the Dubai "
    "listings warm for your return."
)


_SMALLTALK_HOW = re.compile(
    r"\b(how are you|how r u|how('s| is) it going|how do you feel)\b"
)
_SMALLTALK_THANKS = re.compile(r"\b(thank|thanks|thx|shukran|appreciated)\b")
_SMALLTALK_BYE = re.compile(r"^(bye|goodbye|good night|see you|talk later|gtg)\b")

_RESET_PATTERNS = re.compile(
    r"\b(start over|start fresh|fresh search|reset|clear (my )?search|forget everything)\b"
)


def safe_int(val: Any) -> Optional[int]:
    if val is None or val == "":
        return None
    try:
        return int(float(str(val).replace(",", "").strip()))
    except (ValueError, TypeError):
        return None


def safe_float(val: Any) -> Optional[float]:
    if val is None or val == "":
        return None
    try:
        return float(str(val).replace(",", "").strip())
    except (ValueError, TypeError):
        return None


def clean_str_arg(val: Any) -> Optional[str]:
    if val is None:
        return None
    s = str(val).strip()
    if not s or s.lower() in ["null", "none", "nil", "n/a", "na", "undefined", "unknown", "any"]:
        return None
    return s


class OllamaChatSession:
    def __init__(self, session_id: str):
        self.session_id = session_id
        self.requirements: Dict[str, Any] = {
            "purpose": None,
            "location": None,
            "propertyType": None,
            "bhk": None,
            "budget": None,
            "timeline": None,
            "nearMetro": None,
            "beachfront": None,
            "mainRoad": None,
            "parking": None,
            "budgetFlexible": None,
            "amenities": [],
            # Internal: user said "house"/"home" without a clear type.
            # Never sent as a search filter; drives a clarification ask.
            "pendingTypeClarify": None
        }
        self.last_matched_properties: List[Dict[str, Any]] = []
        self.conversation_turns: List[Dict[str, str]] = []
        self.greeting_turn_count: int = 0

    def update_req(
        self,
        purpose: Optional[str] = None,
        location: Optional[str] = None,
        property_type: Optional[str] = None,
        bedrooms: Optional[Any] = None,
        budget: Optional[Any] = None,
        timeline: Optional[str] = None,
        near_metro: Optional[bool] = None,
        beachfront: Optional[bool] = None,
        main_road: Optional[bool] = None,
        parking: Optional[bool] = None,
        amenities: Optional[List[str]] = None
    ) -> None:
        if purpose:
            p_clean = clean_str_arg(purpose)
            if p_clean:
                self.requirements["purpose"] = "Sale" if p_clean.lower() in ["buy", "sale", "purchase", "invest"] else "Rent"
        if location:
            loc_clean = clean_str_arg(location)
            if loc_clean:
                self.requirements["location"] = loc_clean
        if property_type:
            pt_clean = clean_str_arg(property_type)
            if pt_clean:
                self.requirements["propertyType"] = pt_clean.strip().capitalize()
        if bedrooms is not None:
            b_val = safe_int(bedrooms)
            if b_val is not None:
                self.requirements["bhk"] = b_val
        if budget is not None:
            bg_val = safe_float(budget)
            if bg_val is not None:
                self.requirements["budget"] = int(bg_val)
        if timeline:
            tl_clean = clean_str_arg(timeline)
            if tl_clean:
                self.requirements["timeline"] = tl_clean
        if near_metro is not None:
            self.requirements["nearMetro"] = bool(near_metro)
        if beachfront is not None:
            self.requirements["beachfront"] = bool(beachfront)
        if main_road is not None:
            self.requirements["mainRoad"] = bool(main_road)
        if parking is not None:
            self.requirements["parking"] = bool(parking)
        if amenities:
            self.requirements["amenities"] = list(set(self.requirements["amenities"] + amenities))


_OLLAMA_SESSIONS: Dict[str, OllamaChatSession] = {}


def get_or_create_ollama_session(session_id: str) -> OllamaChatSession:
    if session_id not in _OLLAMA_SESSIONS:
        _OLLAMA_SESSIONS[session_id] = OllamaChatSession(session_id)
    return _OLLAMA_SESSIONS[session_id]


def check_ollama_health() -> Dict[str, Any]:
    """Checks if Ollama is running and whether the target model is installed.

    Results are cached for a short TTL so every chat turn does not pay for
    an extra /api/tags round-trip (measured ~2s on slow hosts). DB search
    stays ~1ms; Ollama text generation dominates total latency (seconds).
    """
    global _HEALTH_CACHE
    now = time.monotonic()
    cached = _HEALTH_CACHE.get("result")
    if cached is not None and (now - _HEALTH_CACHE.get("at", 0.0)) < _HEALTH_TTL_S:
        return cached
    try:
        with httpx.Client(timeout=3.0) as client:
            r = client.get(f"{OLLAMA_BASE_URL}/api/tags")
            if r.status_code == 200:
                data = r.json()
                models = [m.get("name", "") for m in data.get("models", [])]
                model_found = any(OLLAMA_MODEL in m for m in models)
                result: Dict[str, Any] = {
                    "status": "online",
                    "base_url": OLLAMA_BASE_URL,
                    "target_model": OLLAMA_MODEL,
                    "model_available": model_found,
                    "available_models": models
                }
                _HEALTH_CACHE = {"result": result, "at": now}
                return result
            result = {
                "status": "error",
                "base_url": OLLAMA_BASE_URL,
                "detail": f"Ollama returned HTTP {r.status_code}"
            }
            _HEALTH_CACHE = {"result": result, "at": now}
            return result
    except Exception as e:
        result = {
            "status": "offline",
            "base_url": OLLAMA_BASE_URL,
            "target_model": OLLAMA_MODEL,
            "detail": f"Cannot connect to Ollama at {OLLAMA_BASE_URL}: {str(e)}"
        }
        _HEALTH_CACHE = {"result": result, "at": now}
        return result


def extract_criteria_from_text(text: str) -> Dict[str, Any]:
    """
    Deterministically extracts search filters and intent from user message.
    Ultra-fast (< 0.1ms). Never misses explicit criteria or follow-up changes.
    """
    text_lower = text.lower()
    criteria: Dict[str, Any] = {}

    # 1. Location extraction
    known_locations = [
        ("dubai marina", "Dubai Marina"),
        ("marina", "Dubai Marina"),
        ("downtown dubai", "Downtown Dubai"),
        ("downtown", "Downtown Dubai"),
        ("palm jumeirah", "Palm Jumeirah"),
        ("palm", "Palm Jumeirah"),
        ("business bay", "Business Bay"),
        ("dubai hills estate", "Dubai Hills Estate"),
        ("dubai hills", "Dubai Hills Estate"),
        ("emirates hills", "Emirates Hills"),
        ("damac hills", "DAMAC Hills"),
        ("hills", "Dubai Hills Estate"),
        ("jumeirah village circle", "Jumeirah Village Circle"),
        ("village circle", "Jumeirah Village Circle"),
        ("jvc", "Jumeirah Village Circle"),
        ("jumeirah lake towers", "Jumeirah Lake Towers"),
        ("lake towers", "Jumeirah Lake Towers"),
        ("jlt", "Jumeirah Lake Towers"),
        ("jbr", "Jumeirah Beach Residence"),
        ("jumeirah beach residence", "Jumeirah Beach Residence"),
        ("dubai creek harbour", "Dubai Creek Harbour"),
        ("creek harbour", "Dubai Creek Harbour"),
        ("arabian ranches", "Arabian Ranches"),
        ("al barsha", "Al Barsha"),
        ("barsha", "Al Barsha"),
        ("discovery gardens", "Discovery Gardens"),
        ("dubai silicon oasis", "Dubai Silicon Oasis"),
        ("silicon oasis", "Dubai Silicon Oasis"),
        ("dso", "Dubai Silicon Oasis"),
        ("dubai sports city", "Dubai Sports City"),
        ("sports city", "Dubai Sports City"),
        ("emirates hills", "Emirates Hills"),
        ("mirdif", "Mirdif"),
        ("mohammed bin rashid city", "Mohammed Bin Rashid City"),
        ("mbr", "Mohammed Bin Rashid City"),
        ("difc", "DIFC"),
        ("dubai south", "Dubai South"),
        ("meydan", "Meydan"),
    ]
    for loc_key, canonical in known_locations:
        if re.search(r"\b" + re.escape(loc_key) + r"\b", text_lower):
            criteria["location"] = canonical
            break

    # 2. Bedrooms / BHK
    if re.search(r"\b(studio|0\s*bhk|zero\s*bed)\b", text_lower):
        criteria["bedrooms"] = 0
    else:
        # Match explicit transition: "from 2 to 3 bedrooms", "from 2 to 3"
        from_to_match = re.search(r"\bfrom\s+\d+\s+to\s+(\d+)\b", text_lower)
        if from_to_match:
            try:
                criteria["bedrooms"] = int(from_to_match.group(1))
            except ValueError:
                pass
        else:
            # Match patterns like: "2-bedroom", "2 bedroom", "2bed", "2 BHK", "make it 3 bedrooms", "3 beds", "3br"
            bhk_match = re.search(r"\b(\d+)[\s-]*(?:bhk|bedrooms?|beds?|br)\b", text_lower)
            if bhk_match:
                try:
                    criteria["bedrooms"] = int(bhk_match.group(1))
                except ValueError:
                    pass
            else:
                # Match "make it 3", "switch to 3", "change to 3", "how about 3", "what about 3"
                follow_bhk = re.search(r"\b(?:make it|switch to|change to|how about|what about)\s+(\d+)\b", text_lower)
                if follow_bhk:
                    try:
                        criteria["bedrooms"] = int(follow_bhk.group(1))
                    except ValueError:
                        pass
                else:
                    # Match "3 instead", "3 please"
                    bare_follow = re.search(r"\b(\d+)\s*(?:instead|please)\b", text_lower)
                    if bare_follow:
                        try:
                            criteria["bedrooms"] = int(bare_follow.group(1))
                        except ValueError:
                            pass

    # 3. Budget (Min / Max in AED)
    # Examples: "under AED 3 million", "under 2m", "budget 1.5 million", "less than 2000000", "upto 3M"
    budget_match = re.search(
        r"(?:under|below|less than|max|budget|within|upto|up to|around|approx)\s*(?:aed)?\s*([\d,\.]+)\s*(k|m|million|thousand)?\b",
        text_lower
    )
    if budget_match and re.match(
        r"\s*(months?|weeks?|days?|years?)\b", text_lower[budget_match.end():]
    ):
        # "within 3 months" is a move-in timeline, not a budget ceiling.
        budget_match = None
    if budget_match:
        val_str = budget_match.group(1).replace(",", "")
        unit = (budget_match.group(2) or "").lower()
        try:
            val = float(val_str)
            if unit in ["m", "million"] or (val < 100 and val > 0):
                val *= 1_000_000
            elif unit in ["k", "thousand"]:
                val *= 1_000
            criteria["max_budget_aed"] = int(val)
        except ValueError:
            pass
    else:
        # Match bare "3 million", "3m", "2,000,000 aed"
        bare_budget = re.search(r"\b([\d,\.]+)\s*(?:m|million)\s*(?:aed)?\b", text_lower)
        if bare_budget:
            try:
                val = float(bare_budget.group(1).replace(",", "")) * 1_000_000
                criteria["max_budget_aed"] = int(val)
            except ValueError:
                pass

    # 4. Purpose (Buy / Rent)
    if any(w in text_lower for w in ["rent", "lease", "rental", "renting"]):
        criteria["purpose"] = "Rent"
    elif any(w in text_lower for w in ["buy", "purchase", "sale", "invest", "buying"]):
        criteria["purpose"] = "Sale"

    # 5. Property Type
    # Check transitions first: "switch from townhouse to villa", "change to villa", "townhouse instead of villa", etc.
    type_transition = re.search(
        r"\b(?:switch to|change to|move to|to|prefer)\s+(villa|townhouse|apartment|penthouse)\b",
        text_lower
    )
    instead_transition = re.search(
        r"\b(villa|townhouse|apartment|penthouse)\s+(?:instead|rather)\b",
        text_lower
    )
    if type_transition:
        target = type_transition.group(1).lower()
        criteria["property_type"] = "Townhouse" if target == "townhouse" else target.capitalize()
    elif instead_transition:
        target = instead_transition.group(1).lower()
        criteria["property_type"] = "Townhouse" if target == "townhouse" else target.capitalize()
    elif re.search(r"\btownhouse\b", text_lower) and not re.search(r"\bvilla\b", text_lower):
        criteria["property_type"] = "Townhouse"
    elif re.search(r"\bvilla\b", text_lower) and not re.search(r"\btownhouse\b", text_lower):
        criteria["property_type"] = "Villa"
    elif re.search(r"\bapartment\b", text_lower) or re.search(r"\bflat\b", text_lower):
        criteria["property_type"] = "Apartment"
    elif re.search(r"\bpenthouse\b", text_lower):
        criteria["property_type"] = "Penthouse"
    elif re.search(r"\btownhouse\b", text_lower):
        criteria["property_type"] = "Townhouse"
    elif re.search(r"\bvilla\b", text_lower):
        criteria["property_type"] = "Villa"
    elif re.search(r"\b(houses?|homes?)\b", text_lower):
        # Ambiguous "house"/"home": NEVER guess Villa vs Townhouse vs
        # Apartment here. Flag it so the flow asks a follow-up instead.
        criteria["needs_type_clarify"] = True

    # 6. Proximity / Amenities
    if "metro" in text_lower and not any(w in text_lower for w in ["no metro", "without metro"]):
        criteria["near_metro"] = True
    if any(w in text_lower for w in ["beach", "sea", "ocean", "beachfront"]) and not any(w in text_lower for w in ["no beach"]):
        criteria["near_beach"] = True
    if "main road" in text_lower or "main-road" in text_lower:
        if not any(w in text_lower for w in ["no main road", "away from main road"]):
            criteria["main_road_access"] = True
    if re.search(r"\bpark(ing|ed)?\b", text_lower) and not any(
        w in text_lower for w in ["no parking", "without parking", "no garage"]
    ):
        criteria["parking"] = True

    # 6b. Named facilities (deterministic keywords only — each becomes a
    # LIKE filter against the real amenities string; never invented).
    _AMENITY_KEYWORDS = [
        "pool", "gym", "balcony", "garden", "spa", "sauna",
        "concierge", "security", "jacuzzi", "cinema",
    ]
    found_amenities = [
        kw for kw in _AMENITY_KEYWORDS
        if re.search(r"\b" + re.escape(kw) + r"\b", text_lower)
    ]
    if found_amenities:
        criteria["amenities"] = found_amenities

    # 7. Availability / Handover
    if "off-plan" in text_lower or "off plan" in text_lower:
        criteria["availability"] = "off-plan"
    elif any(w in text_lower for w in ["ready to move", "move-in ready", "completed property", "ready property"]):
        criteria["availability"] = "Ready"

    # 8. Timeline (Move-in urgency)
    if re.search(r"\b(immediately|immediate|asap|urgently|urgent|this month)\b", text_lower):
        criteria["timeline"] = "Immediate"
    elif re.search(r"within\s*(1|2|3)\s*months?|(?:1|2|3)[\s-]*months?\b", text_lower):
        criteria["timeline"] = "Within 3 months"
    elif re.search(r"within\s*(4|5|6)\s*months?|half a year", text_lower):
        criteria["timeline"] = "3–6 months"
    elif re.search(r"\b(just browsing|browsing|exploring|no rush)\b", text_lower):
        criteria["timeline"] = "Just browsing"

    return criteria


def format_listings_for_prompt(properties: List[Dict[str, Any]]) -> str:
    """Formats top real listings into a concise text summary for Ollama prompt."""
    if not properties:
        return "No matching listings found."
    lines = []
    for i, p in enumerate(properties[:3], 1):
        bhk_str = f"{p['bhk']} BHK" if p.get("bhk", 0) > 0 else "Studio"
        price_str = f"AED {p.get('price_aed', 0):,}"
        feat = p.get("view") or (p.get("amenities") or ["Prime location"])[0]
        tag = ""
        if p.get("is_nearby_alternative"):
            tag = (
                f" [NEARBY ALTERNATIVE in {p.get('actual_location') or p.get('location')}; "
                f"customer asked for {p.get('requested_location')}]"
            )
        lines.append(
            f"{i}. {p['title']} in {p['location']} ({bhk_str} {p['property_type']}, {price_str}, {p.get('property_size_sqft', 0)} sqft, {feat}){tag}"
        )
    return "\n".join(lines)


def describe_criteria(req: Dict[str, Any]) -> str:
    """Short human phrase for already-stated criteria, e.g. '2 BHK home in
    Dubai Marina'. Only uses known values — never invents missing ones."""
    bits = []
    if req.get("bhk") is not None:
        bits.append("Studio" if req.get("bhk") == 0 else f"{req.get('bhk')} BHK")
    bits.append(req["propertyType"].lower() if req.get("propertyType") else "home")
    bits.append(f"in {req['location']}" if req.get("location") else "in Dubai")
    return " ".join(bits)


def formulate_followup_question(req: Dict[str, Any], has_matches: bool) -> str:
    """Intelligently suggests the most relevant next question based on missing filters.
    Buy/Rent purpose always comes first — listings are never shown for an
    assumed purpose."""
    if not req.get("purpose"):
        return "Are you planning to buy or rent?"
    if req.get("pendingTypeClarify") and not req.get("propertyType"):
        return "Do you mean a villa, a townhouse, or an apartment?"
    if not req.get("location"):
        return "Which Dubai neighborhood do you prefer — such as Dubai Marina, Downtown, or Palm Jumeirah?"
    if req.get("bhk") is None and req.get("propertyType") != "Villa":
        return "How many bedrooms are you looking for?"
    if not req.get("budget"):
        return "What is your comfortable budget in AED?"
    if has_matches:
        return "Would you like to schedule a private viewing or see floor plans for any of these?"
    return "Would you like to adjust your budget or explore a nearby community?"


def _first_unmet_requirement(req: Dict[str, Any]) -> Optional[str]:
    """Oldest unanswered of the 8 mandatory search criteria, in ask order.

    Order: purpose -> property type (ambiguity first) -> location ->
    bedrooms -> budget -> timeline -> metro proximity -> coastline/view.
    Returns None only when all eight are explicitly answered. A default,
    empty, or never-asked value never counts as answered; explicit
    "Flexible"/"Not sure" markers (budgetFlexible, timeline "Flexible")
    do count as intentional answers.
    """
    if not req.get("purpose"):
        return "purpose"
    if req.get("pendingTypeClarify") and not req.get("propertyType"):
        return "property_type"
    if not req.get("location"):
        return "location"
    if not req.get("propertyType"):
        return "property_type"
    if req.get("bhk") is None:
        return "bhk"
    if req.get("budget") is None and not req.get("budgetFlexible"):
        return "budget"
    if not req.get("timeline"):
        return "timeline"
    if req.get("nearMetro") is None:
        return "metro"
    if req.get("beachfront") is None:
        return "beach"
    return None


_YES_RE = re.compile(r"^(yes|yeah|yep|sure|ok|okay|please|definitely|absolutely|of course|why not|course)\b")
_NO_RE = re.compile(r"^(no|nope|not really|nah)\b")
_UNSURE_RE = re.compile(
    r"\b(not sure|dont know|don't know|do not know|no idea|flexible|any|anything|"
    r"whatever|no preference|doesn'?t matter|does not matter|skip|not bothered)\b"
)

_BUDGET_OPTIONS = ["Under 1.5M AED", "1.5M - 3M AED", "3M - 5M AED", "5M+ AED", "Not sure"]
_TIMELINE_OPTIONS = ["Immediate", "Within 3 months", "3–6 months", "Flexible", "Just browsing"]
_BHK_OPTIONS = ["Studio", "1 BHK", "2 BHK", "3 BHK", "4+ BHK"]
_TYPE_OPTIONS = ["Apartment", "Villa", "Townhouse", "Penthouse"]
_METRO_OPTIONS = ["Yes", "No"]
_BEACH_OPTIONS = ["Yes", "No preference"]


def _apply_bare_answer(session: "OllamaChatSession", message: str) -> bool:
    """Applies a bare yes/no/not-sure reply to the pending question.

    Returns True when a pending question was intentionally answered, so the
    turn recomputes what is still missing instead of re-asking. At most one
    interpretation per turn — a single "no" never answers two questions.
    """
    pending = _first_unmet_requirement(session.requirements)
    if not pending:
        return False
    low = message.strip().lower()
    is_yes = bool(_YES_RE.search(low))
    is_no = bool(_NO_RE.search(low))
    is_unsure = bool(_UNSURE_RE.search(low))
    if pending == "metro":
        if is_yes:
            session.requirements["nearMetro"] = True
            return True
        if is_no or is_unsure:
            session.requirements["nearMetro"] = False
            return True
    elif pending == "beach":
        if is_yes:
            session.requirements["beachfront"] = True
            return True
        if is_no or is_unsure:
            session.requirements["beachfront"] = False
            return True
    elif pending == "budget":
        if is_unsure:
            session.requirements["budgetFlexible"] = True
            return True
    elif pending == "timeline":
        if is_unsure:
            session.requirements["timeline"] = "Flexible"
            return True
    return False


def _dataset_location_options() -> List[str]:
    """Real dataset communities (most stocked first) for location chips.

    Falls back to a short curated list if the dataset cannot load, so the
    conversation never stalls — and never invents communities.
    """
    try:
        from app.services.property_service import get_distinct_locations
        names = [c["location"] for c in get_distinct_locations() if c.get("location")]
        return names or ["Dubai Marina", "Downtown Dubai", "Palm Jumeirah", "Business Bay"]
    except Exception:
        return ["Dubai Marina", "Downtown Dubai", "Palm Jumeirah", "Business Bay"]


def get_followup_options(req: Dict[str, Any], has_matches: bool) -> List[str]:
    """Provides clickable, properly styled quick action choices for each step."""
    if not req.get("purpose"):
        return ["Buy", "Rent", "Invest"]
    if req.get("pendingTypeClarify") and not req.get("propertyType"):
        return ["Villa", "Townhouse", "Apartment"]
    if not req.get("location"):
        return _dataset_location_options()
    if req.get("bhk") is None and req.get("propertyType") != "Villa":
        return ["Studio", "1 BHK", "2 BHK", "3 BHK", "4+ BHK"]
    if not req.get("budget"):
        return ["Under 1.5M AED", "1.5M - 3M AED", "3M - 5M AED", "5M+ AED"]
    if has_matches:
        return ["Schedule Viewing", "Floor Plans", "More Details"]
    return ["Adjust Budget", "Explore Nearby", "Reset Search"]



def process_ollama_chat_message(
    message: str,
    session_id: str,
    client_history: Optional[List[Dict[str, str]]] = None
) -> Dict[str, Any]:
    """
    Optimized conversational turn using single-pass prompt generation,
    sub-millisecond in-memory SQL filtering, and session memory across turns.
    """
    t_start = time.perf_counter()
    clean_message = (message or "").strip()
    session = get_or_create_ollama_session(session_id)

    if not clean_message:
        return {
            "reply": "How can I assist you with your Dubai property search today?",
            "matched_properties": session.last_matched_properties,
            "requirements": session.requirements,
            "session_id": session_id,
            "provider": "ollama",
            "model": OLLAMA_MODEL,
            "timings": {"db_search_ms": 0.0, "ai_generation_ms": 0.0, "total_ms": 0.0}
        }

    # NOTE: client_history is accepted for API compatibility but deliberately
    # NOT forwarded to the model. The prompt carries only the current message
    # plus the top-3 deterministic matches, which keeps payloads small and
    # responses fast. Only the last few turns are logged server-side.
    _ = (client_history or [])[-6:]

    # Deterministic extraction runs ONCE per turn (<0.1ms); every stage
    # below reuses this result instead of re-scanning the message.
    new_crit_early = extract_criteria_from_text(clean_message)

    # 0. Fresh-search reset: "start over" clears stored criteria so the
    # customer can begin again. Deterministic — no DB scan, no AI call.
    if _RESET_PATTERNS.search(clean_message.lower()) and not new_crit_early:
        session.requirements = {
            "purpose": None, "location": None, "propertyType": None,
            "bhk": None, "budget": None, "timeline": None,
            "nearMetro": None, "beachfront": None, "mainRoad": None,
            "parking": None, "budgetFlexible": None,
            "amenities": [], "pendingTypeClarify": None,
        }
        session.last_matched_properties = []
        ask = ("Fresh start — I've cleared your earlier filters. "
               "Are you looking to buy or rent in Dubai?")
        session.conversation_turns.append({"user": clean_message, "ai": ask})
        session.conversation_turns = session.conversation_turns[-6:]
        return {
            "reply": ask,
            "matched_properties": [],
            "requirements": session.requirements,
            "session_id": session_id,
            "provider": "ollama",
            "model": OLLAMA_MODEL,
            "need": "purpose",
            "options": ["Buy", "Rent"],
            "timings": {"db_search_ms": 0.0, "ai_generation_ms": 0.0,
                        "total_ms": round((time.perf_counter() - t_start) * 1000, 2)}
        }

    # 0b. Small talk without any property criteria is answered instantly —
    # no DB scan, no model call. Never runs a property search.
    msg_lower = clean_message.lower()
    if not new_crit_early:
        if _SMALLTALK_HOW.search(msg_lower):
            session.conversation_turns.append({"user": clean_message, "ai": _INSTANT_HOW_ARE_YOU})
            session.conversation_turns = session.conversation_turns[-6:]
            return {
                "reply": _INSTANT_HOW_ARE_YOU,
                "matched_properties": [],
                "requirements": session.requirements,
                "session_id": session_id,
                "provider": "ollama",
                "model": OLLAMA_MODEL,
                "timings": {"db_search_ms": 0.0, "ai_generation_ms": 0.0,
                            "total_ms": round((time.perf_counter() - t_start) * 1000, 2)}
            }
        if _SMALLTALK_THANKS.search(msg_lower) and len(clean_message.split()) <= 8:
            session.conversation_turns.append({"user": clean_message, "ai": _INSTANT_THANKS})
            session.conversation_turns = session.conversation_turns[-6:]
            return {
                "reply": _INSTANT_THANKS,
                "matched_properties": session.last_matched_properties,
                "requirements": session.requirements,
                "session_id": session_id,
                "provider": "ollama",
                "model": OLLAMA_MODEL,
                "timings": {"db_search_ms": 0.0, "ai_generation_ms": 0.0,
                            "total_ms": round((time.perf_counter() - t_start) * 1000, 2)}
            }
        if _SMALLTALK_BYE.search(msg_lower) and len(clean_message.split()) <= 4:
            session.conversation_turns.append({"user": clean_message, "ai": _INSTANT_BYE})
            session.conversation_turns = session.conversation_turns[-6:]
            return {
                "reply": _INSTANT_BYE,
                "matched_properties": [],
                "requirements": session.requirements,
                "session_id": session_id,
                "provider": "ollama",
                "model": OLLAMA_MODEL,
                "timings": {"db_search_ms": 0.0, "ai_generation_ms": 0.0,
                            "total_ms": round((time.perf_counter() - t_start) * 1000, 2)}
            }
        if _GREETING_RE.match(msg_lower):
            greeting_reply = _INSTANT_GREETINGS_LIST[session.greeting_turn_count % len(_INSTANT_GREETINGS_LIST)]
            session.greeting_turn_count += 1
            session.conversation_turns.append({"user": clean_message, "ai": greeting_reply})
            session.conversation_turns = session.conversation_turns[-6:]
            return {
                "reply": greeting_reply,
                "matched_properties": [],
                "requirements": session.requirements,
                "session_id": session_id,
                "provider": "ollama",
                "model": OLLAMA_MODEL,
                "need": None,
                "options": ["Buy", "Rent", "Invest"],
                "timings": {"db_search_ms": 0.0, "ai_generation_ms": 0.0,
                            "total_ms": round((time.perf_counter() - t_start) * 1000, 2)}
            }

    # 1. Deterministic Criteria Extraction & Context Update (< 0.1ms,
    # reused from the single pass above — never re-scanned).
    new_crit = new_crit_early

    # Handle property-type switch: if switching from Apartment to Villa, clear studio bhk=0
    if new_crit.get("property_type") == "Villa" and session.requirements.get("bhk") == 0:
        session.requirements["bhk"] = None

    # Handle purpose change
    if new_crit.get("purpose"):
        session.requirements["purpose"] = new_crit["purpose"]

    # Handle location change
    if new_crit.get("location"):
        session.requirements["location"] = new_crit["location"]

    # Handle property type change
    if new_crit.get("property_type"):
        session.requirements["propertyType"] = new_crit["property_type"]

    # Handle bedrooms change
    if new_crit.get("bedrooms") is not None:
        session.requirements["bhk"] = new_crit["bedrooms"]

    # Handle budget change
    if new_crit.get("max_budget_aed") is not None:
        session.requirements["budget"] = new_crit["max_budget_aed"]

    # Handle amenities / proximity
    if new_crit.get("near_metro") is not None:
        session.requirements["nearMetro"] = new_crit["near_metro"]
    if new_crit.get("near_beach") is not None:
        session.requirements["beachfront"] = new_crit["near_beach"]
    if new_crit.get("main_road_access") is not None:
        session.requirements["mainRoad"] = new_crit["main_road_access"]
    if new_crit.get("parking") is not None:
        session.requirements["parking"] = new_crit["parking"]
    if new_crit.get("amenities"):
        session.requirements["amenities"] = list(
            set(session.requirements.get("amenities", []) + new_crit["amenities"])
        )
    if new_crit.get("timeline"):
        session.requirements["timeline"] = new_crit["timeline"]

    # Determine whether user is searching / discussing properties or just chatting
    has_active_criteria = bool(
        session.requirements.get("location")
        or session.requirements.get("propertyType")
        or session.requirements.get("bhk") is not None
        or session.requirements.get("budget")
        or new_crit
    )

    is_greeting = bool(
        _GREETING_RE.match(clean_message.lower())
        and not new_crit
    )

    turn_matches: List[Dict[str, Any]] = []
    db_search_ms = 0.0
    search_res: Dict[str, Any] = {}

    # 1b. Clarification gates: never show listings based on an assumed
    # Buy/Rent purpose or an ambiguous house-vs-apartment type. Ask first
    # with a deterministic reply — no DB scan, no AI call, no delay.
    # (Deliberately no budget->purpose inference here: purpose must be
    # stated by the customer, never guessed from numbers.)
    if new_crit.get("needs_type_clarify") and not session.requirements.get("propertyType"):
        session.requirements["pendingTypeClarify"] = True
    if session.requirements.get("propertyType"):
        session.requirements["pendingTypeClarify"] = None

    states_search_criteria = bool(
        session.requirements.get("location")
        or session.requirements.get("propertyType")
        or session.requirements.get("bhk") is not None
        or session.requirements.get("budget")
    )

    # Bare yes/no/not-sure replies answer the currently pending question
    # (e.g. "yes" to the metro question). At most one interpretation per
    # turn; anything substantive was already handled by extraction above.
    if not is_greeting and not new_crit:
        _apply_bare_answer(session, clean_message)

    # One question at a time, in collection order, across all 8 mandatory
    # criteria. Gates stay armed once the customer is clearly searching
    # (concrete criteria) or has stated buy/rent intent — but never for
    # greetings or content-free messages, which keep the generic path.
    gate_armed = bool(states_search_criteria or session.requirements.get("purpose"))
    pending = _first_unmet_requirement(session.requirements) if (gate_armed and not is_greeting) else None

    if pending:
        if pending == "purpose":
            need, options = "purpose", ["Buy", "Rent"]
            ask = (
                f"Lovely — a {describe_criteria(session.requirements)}! "
                "Are you looking to buy or rent?"
            )
        elif pending == "property_type" and session.requirements.get("pendingTypeClarify"):
            need, options = "property_type", ["Villa", "Townhouse", "Apartment"]
            ask = (
                f"For your {describe_criteria(session.requirements)} search, "
                "when you say 'house', do you mean a villa, a townhouse, or an apartment?"
            )
        elif pending == "property_type":
            need, options = "property_type", _TYPE_OPTIONS
            ask = "What type of property are you looking for?"
        elif pending == "location":
            need, options = "location", _dataset_location_options()
            ask = (
                "Great! Which Dubai community would you prefer? "
                "Here are some available locations:"
            )
        elif pending == "bhk":
            need, options = "bhk", _BHK_OPTIONS
            ask = "How many bedrooms would you prefer?"
        elif pending == "budget":
            need, options = "budget", _BUDGET_OPTIONS
            ask = "What is your comfortable budget ceiling in AED?"
        elif pending == "timeline":
            need, options = "timeline", _TIMELINE_OPTIONS
            ask = "When are you planning to move or invest?"
        elif pending == "metro":
            need, options = "metro", _METRO_OPTIONS
            ask = "Would you prefer to be near a metro station?"
        else:
            need, options = "beach", _BEACH_OPTIONS
            ask = "Would you like a beachfront or sea-view setting?"
        session.last_matched_properties = []
        session.conversation_turns.append({"user": clean_message, "ai": ask})
        session.conversation_turns = session.conversation_turns[-6:]
        logger.info("Chat turn clarified (%s): no DB scan, no AI call.", need)
        return {
            "reply": ask,
            "matched_properties": [],
            "requirements": session.requirements,
            "session_id": session_id,
            "provider": "ollama",
            "model": OLLAMA_MODEL,
            "need": need,
            "options": options,
            "timings": {"db_search_ms": 0.0, "ai_generation_ms": 0.0,
                        "total_ms": round((time.perf_counter() - t_start) * 1000, 2)}
        }

    # 2. Database Search (< 1ms via indexed in-memory SQLite table)
    if has_active_criteria and not is_greeting:
        t_db0 = time.perf_counter()
        search_res = search_properties_dataset(
            location=session.requirements.get("location"),
            property_type=session.requirements.get("propertyType"),
            bedrooms=session.requirements.get("bhk"),
            max_budget_aed=session.requirements.get("budget"),
            purpose=session.requirements.get("purpose"),
            near_metro=session.requirements.get("nearMetro"),
            near_beach=session.requirements.get("beachfront"),
            main_road_access=session.requirements.get("mainRoad"),
            availability=new_crit.get("availability"),
            limit=3,
            min_parking=1 if session.requirements.get("parking") else None,
            amenities=session.requirements.get("amenities") or None,
        )
        db_search_ms = round((time.perf_counter() - t_db0) * 1000, 2)
        turn_matches = search_res.get("top_properties", [])
        session.last_matched_properties = turn_matches

    # 3. Check Ollama Health
    health = check_ollama_health()
    is_online = health.get("status") == "online"

    ai_reply_text = ""
    ai_generation_ms = 0.0

    if not is_online:
        logger.warning("Ollama is offline: %s", health.get("detail"))
        if turn_matches:
            loc = session.requirements.get("location") or "Dubai"
            bhk = session.requirements.get("bhk")
            bhk_s = f"{bhk} BHK " if bhk is not None else ""
            pt_s = session.requirements.get("propertyType") or "property"
            nearby_bits = [m for m in turn_matches if m.get("is_nearby_alternative")]
            if nearby_bits:
                actuals = sorted({m.get("actual_location") or m.get("location") for m in nearby_bits})
                ai_reply_text = (
                    f"I couldn't find an exact match in {loc}, but I found {len(turn_matches)} verified "
                    f"{bhk_s}{pt_s.lower()} alternative(s) nearby in {', '.join(actuals)}. "
                    "Take a look at the listings below with verified prices and details. "
                    + formulate_followup_question(session.requirements, True)
                )
            else:
                ai_reply_text = (
                    f"I found {len(turn_matches)} verified {bhk_s}{pt_s.lower()} options in {loc} matching your criteria! "
                    "Take a look at the listings below with verified prices and details. "
                    + formulate_followup_question(session.requirements, True)
                )
        else:
            ai_reply_text = (
                "Hello! Welcome to LYKA Realty. How can I assist you with your property search in Dubai today? "
                "Tell me your preferred location, number of bedrooms, or budget."
            )
    else:
        # 4. Streamlined Single-Pass Ollama Generation (3 - 5s)
        followup_hint = formulate_followup_question(session.requirements, len(turn_matches) > 0)
        ack_criteria = describe_criteria(session.requirements)
        t_ai0 = time.perf_counter()
        # Set by the zero-match branch below: reply is already final and no
        # model call may run (it could only contradict the empty result).
        skip_model = False
        no_results_options: Optional[List[str]] = None

        if is_greeting:
            prompt = (
                "You are LYKA AI, the warm, prestigious AI property concierge of LYKA Realty in Dubai. "
                f"The user greeted you with: \"{clean_message}\". "
                "Respond warmly and professionally in 1-2 sentences. Welcome them to LYKA Realty and ask how you can help with their property journey in Dubai."
            )
        elif turn_matches:
            listings_text = format_listings_for_prompt(turn_matches)
            nearby_note = ""
            if any(m.get("is_nearby_alternative") for m in turn_matches):
                req_loc = session.requirements.get("location") or "the requested area"
                nearby_note = (
                    f"4. Some listings are marked [NEARBY ALTERNATIVE]: no exact match "
                    f"exists in {req_loc}, so these come from neighbouring communities. "
                    f"Say so explicitly, name each alternative's actual community, and "
                    f"never present them as being in {req_loc}.\n"
                )
            prompt = (
                "You are LYKA AI, a friendly Dubai luxury property concierge for LYKA Realty. "
                "Respond conversationally in 2-3 warm sentences. Always quote the EXACT prices from the verified listings below. Never invent addresses, prices, or details.\n\n"
                f"User request: \"{clean_message}\"\n"
                f"Verified listings from database:\n{listings_text}\n\n"
                f"Instructions:\n"
                f"0. Open with one warm acknowledgement clause naming the known criteria (e.g. 'Great — {ack_criteria}!'). Never contradict or re-ask stored criteria.\n"
                f"1. Warmly present these real matching homes with their exact AED prices and locations.\n"
                f"2. Rent prices in the listings are TOTAL ANNUAL rents (AED per year) — always label them 'per year', never 'per month'. Sale prices are full purchase prices; label them as the total price.\n"
                f"{nearby_note}"
                f"3. End with this follow-up question: \"{followup_hint}\""
            )
        elif has_active_criteria:
            # Zero matches: the deterministic search above already tried the
            # exact community AND every verified nearby community with ALL
            # filters enforced. Reply deterministically (no model call), so
            # no invented or budget-violating "alternative" can contradict
            # the empty result, and no second query is spent.
            no_results_options = _dataset_location_options()
            loc = session.requirements.get("location") or "Dubai"
            fb = search_res.get("fallback", {}) or {}
            areas = [a for a in (fb.get("nearby_locations") or [])][:3]
            budget = session.requirements.get("budget")
            budget_bit = f" within AED {int(budget):,}" if budget else ""
            scope = f"{loc} and nearby {', '.join(areas)}" if areas else loc
            ai_reply_text = (
                f"No exact match for {describe_criteria(session.requirements)}{budget_bit} — "
                f"I checked {scope} with all your filters and nothing suitable is listed right now. "
                f"{followup_hint}"
            )
            skip_model = True
        else:
            prompt = (
                "You are LYKA AI, a friendly Dubai property concierge for LYKA Realty. "
                f"The user said: \"{clean_message}\". "
                "Answer helpfully and conversationally in 2 sentences, and ask how you can assist with buying, renting, or investing in Dubai properties."
            )

        try:
            if not skip_model:
                with httpx.Client(timeout=25.0) as client:
                    res = client.post(
                        f"{OLLAMA_BASE_URL}/api/generate",
                        json={
                            "model": OLLAMA_MODEL,
                            "prompt": prompt,
                            "stream": False,
                            # keep_alive keeps the model resident so repeat turns
                            # skip cold-load seconds; single-pass, capped tokens.
                            "keep_alive": "30m",
                            "options": {
                                "num_predict": 120,
                                "temperature": 0.3
                            }
                        }
                    )
                    if res.status_code == 200:
                        ai_reply_text = (res.json().get("response") or "").strip()
                    else:
                        logger.warning("Ollama generate returned status %d", res.status_code)
        except Exception as e:
            logger.warning("Ollama generation call error: %s", e)

        ai_generation_ms = 0.0 if skip_model else round((time.perf_counter() - t_ai0) * 1000, 2)

    # 5. Robust Fallback if Model Output is Empty or Failed
    if not ai_reply_text:
        if turn_matches:
            loc = session.requirements.get("location") or "Dubai"
            bhk = session.requirements.get("bhk")
            bhk_s = f"{bhk} BHK " if bhk is not None else ""
            pt_s = session.requirements.get("propertyType") or "property"
            p0 = turn_matches[0]
            price_str = f"AED {p0.get('price_aed', 0):,}"
            if any(m.get("is_nearby_alternative") for m in turn_matches):
                actuals = sorted({m.get("actual_location") or m.get("location") for m in turn_matches if m.get("is_nearby_alternative")})
                ai_reply_text = (
                    f"No exact match in {loc}, but I found {len(turn_matches)} verified {bhk_s}{pt_s.lower()} "
                    f"alternative(s) nearby in {', '.join(actuals)}, starting at {price_str} for \"{p0.get('title')}\". "
                    f"{formulate_followup_question(session.requirements, True)}"
                )
            else:
                ai_reply_text = (
                    f"I found {len(turn_matches)} verified {bhk_s}{pt_s.lower()} options in {loc}, starting at {price_str} for \"{p0.get('title')}\". "
                    f"{formulate_followup_question(session.requirements, True)}"
                )
        else:
            ai_reply_text = (
                "Hello! Welcome to LYKA Realty. How can I assist you with your property search in Dubai today? "
                "Could you tell me your preferred location, number of bedrooms, or budget?"
            )

    # Strip any thinking tags or hallucinated prefix artifacts
    ai_reply_text = re.sub(r"<think>.*?</think>", "", ai_reply_text, flags=re.DOTALL).strip()
    if ai_reply_text.startswith("Thinking"):
        ai_reply_text = re.sub(r"^Thinking.*?\n\n?", "", ai_reply_text, flags=re.DOTALL).strip()

    total_ms = round((time.perf_counter() - t_start) * 1000, 2)
    session.conversation_turns.append({"user": clean_message, "ai": ai_reply_text})
    # Cap in-memory history: only recent turns are ever kept, and the model
    # prompt never receives full history (current message + top-3 matches).
    session.conversation_turns = session.conversation_turns[-6:]

    logger.info(
        "Chat turn completed in %.2fms (DB Search: %.2fms | AI Gen: %.2fms | Matches: %d)",
        total_ms, db_search_ms, ai_generation_ms, len(turn_matches)
    )

    options = get_followup_options(session.requirements, len(turn_matches) > 0)
    # Zero-match turns carry community options so the customer can pick
    # another available community directly (one concise response + options,
    # never a second contradictory reply).
    need: Optional[str] = None
    if no_results_options is not None:
        need = "no_results"
        options = no_results_options
    return {
        "reply": ai_reply_text,
        "matched_properties": turn_matches,
        "requirements": session.requirements,
        "session_id": session_id,
        "provider": "ollama" if is_online else "ollama-offline",
        "model": OLLAMA_MODEL,
        "need": need,
        "options": options,
        "timings": {
            "db_search_ms": db_search_ms,
            "ai_generation_ms": ai_generation_ms,
            "total_ms": total_ms
        }
    }


async def stream_ollama_chat_message(
    message: str,
    session_id: str,
    client_history: Optional[List[Dict[str, str]]] = None
):
    """
    Streams conversational turn from Ollama token-by-token using SSE,
    preceded immediately by in-memory SQLite search results (< 3ms) so the UI
    displays matched properties and options without waiting for model completion.
    """
    t_start = time.perf_counter()
    clean_message = (message or "").strip()
    session = get_or_create_ollama_session(session_id)

    if not clean_message:
        reply = "How can I assist you with your Dubai property search today?"
        opts = ["Buy", "Rent", "Invest"]
        yield f"data: {json.dumps({'type': 'meta', 'matched_properties': session.last_matched_properties, 'requirements': session.requirements, 'session_id': session_id, 'need': None, 'options': opts})}\n\n"
        yield f"data: {json.dumps({'type': 'token', 'token': reply})}\n\n"
        yield f"data: {json.dumps({'type': 'done', 'reply': reply, 'matched_properties': session.last_matched_properties, 'requirements': session.requirements, 'session_id': session_id, 'need': None, 'options': opts, 'timings': {'db_search_ms': 0.0, 'ai_generation_ms': 0.0, 'total_ms': 0.0}})}\n\n"
        return

    _ = (client_history or [])[-6:]

    # Deterministic extraction runs ONCE per turn (<0.1ms); every stage
    # below reuses this result instead of re-scanning the message.
    new_crit_early = extract_criteria_from_text(clean_message)

    # 0. Fresh-search reset
    if _RESET_PATTERNS.search(clean_message.lower()) and not new_crit_early:
        session.requirements = {
            "purpose": None, "location": None, "propertyType": None,
            "bhk": None, "budget": None, "timeline": None,
            "nearMetro": None, "beachfront": None, "mainRoad": None,
            "parking": None, "budgetFlexible": None,
            "amenities": [], "pendingTypeClarify": None,
        }
        session.last_matched_properties = []
        ask = ("Fresh start — I've cleared your earlier filters. "
               "Are you looking to buy or rent in Dubai?")
        session.conversation_turns.append({"user": clean_message, "ai": ask})
        session.conversation_turns = session.conversation_turns[-6:]
        total_ms = round((time.perf_counter() - t_start) * 1000, 2)
        yield f"data: {json.dumps({'type': 'meta', 'matched_properties': [], 'requirements': session.requirements, 'session_id': session_id, 'need': 'purpose', 'options': ['Buy', 'Rent', 'Invest']})}\n\n"
        yield f"data: {json.dumps({'type': 'token', 'token': ask})}\n\n"
        yield f"data: {json.dumps({'type': 'done', 'reply': ask, 'matched_properties': [], 'requirements': session.requirements, 'session_id': session_id, 'need': 'purpose', 'options': ['Buy', 'Rent', 'Invest'], 'timings': {'db_search_ms': 0.0, 'ai_generation_ms': 0.0, 'total_ms': total_ms}})}\n\n"
        return

    # 0b. Small talk & greetings
    msg_lower = clean_message.lower()
    if not new_crit_early:
        reply_text = None
        opts = ["Buy", "Rent", "Invest"]
        matched_props = []
        if _SMALLTALK_HOW.search(msg_lower):
            reply_text = _INSTANT_HOW_ARE_YOU
        elif _SMALLTALK_THANKS.search(msg_lower) and len(clean_message.split()) <= 8:
            reply_text = _INSTANT_THANKS
            matched_props = session.last_matched_properties
        elif _SMALLTALK_BYE.search(msg_lower) and len(clean_message.split()) <= 4:
            reply_text = _INSTANT_BYE
        elif _GREETING_RE.match(msg_lower):
            reply_text = _INSTANT_GREETINGS_LIST[session.greeting_turn_count % len(_INSTANT_GREETINGS_LIST)]
            session.greeting_turn_count += 1

        if reply_text:
            session.conversation_turns.append({"user": clean_message, "ai": reply_text})
            session.conversation_turns = session.conversation_turns[-6:]
            total_ms = round((time.perf_counter() - t_start) * 1000, 2)
            yield f"data: {json.dumps({'type': 'meta', 'matched_properties': matched_props, 'requirements': session.requirements, 'session_id': session_id, 'need': None, 'options': opts})}\n\n"
            yield f"data: {json.dumps({'type': 'token', 'token': reply_text})}\n\n"
            yield f"data: {json.dumps({'type': 'done', 'reply': reply_text, 'matched_properties': matched_props, 'requirements': session.requirements, 'session_id': session_id, 'need': None, 'options': opts, 'timings': {'db_search_ms': 0.0, 'ai_generation_ms': 0.0, 'total_ms': total_ms}})}\n\n"
            return

    # 1. Deterministic Criteria Extraction & Context Update (< 0.1ms,
    # reused from the single pass above — never re-scanned).
    new_crit = new_crit_early

    if new_crit.get("property_type") == "Villa" and session.requirements.get("bhk") == 0:
        session.requirements["bhk"] = None
    if new_crit.get("purpose"):
        session.requirements["purpose"] = new_crit["purpose"]
    if new_crit.get("location"):
        session.requirements["location"] = new_crit["location"]
    if new_crit.get("property_type"):
        session.requirements["propertyType"] = new_crit["property_type"]
    if new_crit.get("bedrooms") is not None:
        session.requirements["bhk"] = new_crit["bedrooms"]
    if new_crit.get("max_budget_aed") is not None:
        session.requirements["budget"] = new_crit["max_budget_aed"]
    if new_crit.get("near_metro") is not None:
        session.requirements["nearMetro"] = new_crit["near_metro"]
    if new_crit.get("near_beach") is not None:
        session.requirements["beachfront"] = new_crit["near_beach"]
    if new_crit.get("main_road_access") is not None:
        session.requirements["mainRoad"] = new_crit["main_road_access"]
    if new_crit.get("parking") is not None:
        session.requirements["parking"] = new_crit["parking"]
    if new_crit.get("amenities"):
        session.requirements["amenities"] = list(
            set(session.requirements.get("amenities", []) + new_crit["amenities"])
        )
    if new_crit.get("timeline"):
        session.requirements["timeline"] = new_crit["timeline"]

    has_active_criteria = bool(
        session.requirements.get("location")
        or session.requirements.get("propertyType")
        or session.requirements.get("bhk") is not None
        or session.requirements.get("budget")
        or new_crit
    )
    is_greeting = bool(_GREETING_RE.match(clean_message.lower()) and not new_crit)

    if new_crit.get("needs_type_clarify") and not session.requirements.get("propertyType"):
        session.requirements["pendingTypeClarify"] = True
    if session.requirements.get("propertyType"):
        session.requirements["pendingTypeClarify"] = None

    states_search_criteria = bool(
        session.requirements.get("location")
        or session.requirements.get("propertyType")
        or session.requirements.get("bhk") is not None
        or session.requirements.get("budget")
    )

    # Bare yes/no/not-sure replies answer the currently pending question.
    if not is_greeting and not new_crit:
        _apply_bare_answer(session, clean_message)

    # One question at a time, in collection order, across all 8 mandatory
    # criteria. Gates stay armed once the customer is clearly searching
    # (concrete criteria) or has stated buy/rent intent — but never for
    # greetings or content-free messages, which keep the generic path.
    gate_armed = bool(states_search_criteria or session.requirements.get("purpose"))
    pending = _first_unmet_requirement(session.requirements) if (gate_armed and not is_greeting) else None

    if pending:
        if pending == "purpose":
            need, options = "purpose", ["Buy", "Rent", "Invest"]
            ask = f"Lovely — a {describe_criteria(session.requirements)}! Are you looking to buy or rent?"
        elif pending == "property_type" and session.requirements.get("pendingTypeClarify"):
            need, options = "property_type", ["Villa", "Townhouse", "Apartment"]
            ask = f"For your {describe_criteria(session.requirements)} search, when you say 'house', do you mean a villa, a townhouse, or an apartment?"
        elif pending == "property_type":
            need, options = "property_type", _TYPE_OPTIONS
            ask = "What type of property are you looking for?"
        elif pending == "location":
            need, options = "location", _dataset_location_options()
            ask = (
                "Great! Which Dubai community would you prefer? "
                "Here are some available locations:"
            )
        elif pending == "bhk":
            need, options = "bhk", _BHK_OPTIONS
            ask = "How many bedrooms would you prefer?"
        elif pending == "budget":
            need, options = "budget", _BUDGET_OPTIONS
            ask = "What is your comfortable budget ceiling in AED?"
        elif pending == "timeline":
            need, options = "timeline", _TIMELINE_OPTIONS
            ask = "When are you planning to move or invest?"
        elif pending == "metro":
            need, options = "metro", _METRO_OPTIONS
            ask = "Would you prefer to be near a metro station?"
        else:
            need, options = "beach", _BEACH_OPTIONS
            ask = "Would you like a beachfront or sea-view setting?"
        session.last_matched_properties = []
        session.conversation_turns.append({"user": clean_message, "ai": ask})
        session.conversation_turns = session.conversation_turns[-6:]
        total_ms = round((time.perf_counter() - t_start) * 1000, 2)
        yield f"data: {json.dumps({'type': 'meta', 'matched_properties': [], 'requirements': session.requirements, 'session_id': session_id, 'need': need, 'options': options})}\n\n"
        yield f"data: {json.dumps({'type': 'token', 'token': ask})}\n\n"
        yield f"data: {json.dumps({'type': 'done', 'reply': ask, 'matched_properties': [], 'requirements': session.requirements, 'session_id': session_id, 'need': need, 'options': options, 'timings': {'db_search_ms': 0.0, 'ai_generation_ms': 0.0, 'total_ms': total_ms}})}\n\n"
        return

    # 2. Database Search (< 1ms)
    turn_matches = []
    db_search_ms = 0.0
    if has_active_criteria and not is_greeting:
        t_db0 = time.perf_counter()
        search_res = search_properties_dataset(
            location=session.requirements.get("location"),
            property_type=session.requirements.get("propertyType"),
            bedrooms=session.requirements.get("bhk"),
            max_budget_aed=session.requirements.get("budget"),
            purpose=session.requirements.get("purpose"),
            near_metro=session.requirements.get("nearMetro"),
            near_beach=session.requirements.get("beachfront"),
            main_road_access=session.requirements.get("mainRoad"),
            availability=new_crit.get("availability"),
            limit=3,
            min_parking=1 if session.requirements.get("parking") else None,
            amenities=session.requirements.get("amenities") or None,
        )
        db_search_ms = round((time.perf_counter() - t_db0) * 1000, 2)
        turn_matches = search_res.get("top_properties", [])
        session.last_matched_properties = turn_matches

    options = get_followup_options(session.requirements, len(turn_matches) > 0)

    # Yield initial metadata immediately (< 3ms) so frontend displays cards right away!
    yield f"data: {json.dumps({'type': 'meta', 'matched_properties': turn_matches, 'requirements': session.requirements, 'session_id': session_id, 'need': None, 'options': options, 'provider': 'ollama', 'model': OLLAMA_MODEL, 'timings': {'db_search_ms': db_search_ms}})}\n\n"

    # 3. Check Ollama Health
    health = check_ollama_health()
    is_online = health.get("status") == "online"

    ai_reply_text = ""
    ai_generation_ms = 0.0
    first_token_ms: Optional[float] = None

    if not is_online:
        logger.warning("Ollama is offline: %s", health.get("detail"))
        if turn_matches:
            loc = session.requirements.get("location") or "Dubai"
            bhk = session.requirements.get("bhk")
            bhk_s = f"{bhk} BHK " if bhk is not None else ""
            pt_s = session.requirements.get("propertyType") or "property"
            nearby_bits = [m for m in turn_matches if m.get("is_nearby_alternative")]
            if nearby_bits:
                actuals = sorted({m.get("actual_location") or m.get("location") for m in nearby_bits})
                ai_reply_text = (
                    f"I couldn't find an exact match in {loc}, but I found {len(turn_matches)} verified "
                    f"{bhk_s}{pt_s.lower()} alternative(s) nearby in {', '.join(actuals)}. "
                    "Take a look at the listings below with verified prices and details. "
                    + formulate_followup_question(session.requirements, True)
                )
            else:
                ai_reply_text = (
                    f"I found {len(turn_matches)} verified {bhk_s}{pt_s.lower()} options in {loc} matching your criteria! "
                    "Take a look at the listings below with verified prices and details. "
                    + formulate_followup_question(session.requirements, True)
                )
        else:
            ai_reply_text = (
                "Hello! Welcome to LYKA Realty. How can I assist you with your property search in Dubai today? "
                "Tell me your preferred location, number of bedrooms, or budget."
            )
        yield f"data: {json.dumps({'type': 'token', 'token': ai_reply_text})}\n\n"
    else:
        followup_hint = formulate_followup_question(session.requirements, len(turn_matches) > 0)
        ack_criteria = describe_criteria(session.requirements)
        t_ai0 = time.perf_counter()
        # Set by the zero-match branch below: reply is already final and no
        # model call may run (it could only contradict the empty result).
        skip_model = False
        no_results_options: Optional[List[str]] = None

        if is_greeting:
            prompt = (
                "You are LYKA AI, the warm, prestigious AI property concierge of LYKA Realty in Dubai. "
                f"The user greeted you with: \"{clean_message}\". "
                "Respond warmly and professionally in 1-2 sentences. Welcome them to LYKA Realty and ask how you can help with their property journey in Dubai."
            )
        elif turn_matches:
            listings_text = format_listings_for_prompt(turn_matches)
            nearby_note = ""
            if any(m.get("is_nearby_alternative") for m in turn_matches):
                req_loc = session.requirements.get("location") or "the requested area"
                nearby_note = (
                    f"4. Some listings are marked [NEARBY ALTERNATIVE]: no exact match "
                    f"exists in {req_loc}, so these come from neighbouring communities. "
                    f"Say so explicitly, name each alternative's actual community, and "
                    f"never present them as being in {req_loc}.\n"
                )
            prompt = (
                "You are LYKA AI, a friendly Dubai luxury property concierge for LYKA Realty. "
                "Respond conversationally in 2-3 warm sentences. Always quote the EXACT prices from the verified listings below. Never invent addresses, prices, or details.\n\n"
                f"User request: \"{clean_message}\"\n"
                f"Verified listings from database:\n{listings_text}\n\n"
                f"Instructions:\n"
                f"0. Open with one warm acknowledgement clause naming the known criteria (e.g. 'Great — {ack_criteria}!'). Never contradict or re-ask stored criteria.\n"
                f"1. Warmly present these real matching homes with their exact AED prices and locations.\n"
                f"2. Rent prices in the listings are TOTAL ANNUAL rents (AED per year) — always label them 'per year', never 'per month'. Sale prices are full purchase prices; label them as the total price.\n"
                f"{nearby_note}"
                f"3. End with this follow-up question: \"{followup_hint}\""
            )
        elif has_active_criteria:
            # Zero matches: the deterministic search above already tried the
            # exact community AND every verified nearby community with ALL
            # filters enforced. Reply deterministically (no model call), so
            # no invented or budget-violating "alternative" can contradict
            # the empty result, and no second query is spent.
            no_results_options = _dataset_location_options()
            loc = session.requirements.get("location") or "Dubai"
            fb = search_res.get("fallback", {}) or {}
            areas = [a for a in (fb.get("nearby_locations") or [])][:3]
            budget = session.requirements.get("budget")
            budget_bit = f" within AED {int(budget):,}" if budget else ""
            scope = f"{loc} and nearby {', '.join(areas)}" if areas else loc
            ai_reply_text = (
                f"No exact match for {describe_criteria(session.requirements)}{budget_bit} — "
                f"I checked {scope} with all your filters and nothing suitable is listed right now. "
                f"{followup_hint}"
            )
            skip_model = True
            options = no_results_options
            yield f"data: {json.dumps({'type': 'token', 'token': ai_reply_text})}\n\n"
        else:
            prompt = (
                "You are LYKA AI, a friendly Dubai property concierge for LYKA Realty. "
                f"The user said: \"{clean_message}\". "
                "Answer helpfully and conversationally in 2 sentences, and ask how you can assist with buying, renting, or investing in Dubai properties."
            )

        token_chunks = []
        try:
            if not skip_model:
                async with httpx.AsyncClient(timeout=45.0) as client:
                    async with client.stream(
                        "POST",
                        f"{OLLAMA_BASE_URL}/api/generate",
                        json={
                            "model": OLLAMA_MODEL,
                            "prompt": prompt,
                            "stream": True,
                            "keep_alive": "30m",
                            "options": {
                                "num_predict": 120,
                                "temperature": 0.3
                            }
                        }
                    ) as response:
                        if response.status_code == 200:
                            async for line in response.aiter_lines():
                                if line:
                                    if first_token_ms is None:
                                        first_token_ms = round((time.perf_counter() - t_ai0) * 1000, 2)
                                    data = json.loads(line)
                                    chunk = data.get("response", "")
                                    if chunk:
                                        token_chunks.append(chunk)
                                        yield f"data: {json.dumps({'type': 'token', 'token': chunk})}\n\n"
                                    if data.get("done"):
                                        break
                            ai_reply_text = "".join(token_chunks).strip()
                        else:
                            logger.warning("Ollama streaming returned status %d", response.status_code)
        except Exception as e:
            logger.warning("Ollama streaming call error: %s", e)

        ai_generation_ms = 0.0 if skip_model else round((time.perf_counter() - t_ai0) * 1000, 2)

    if not ai_reply_text:
        if turn_matches:
            loc = session.requirements.get("location") or "Dubai"
            bhk = session.requirements.get("bhk")
            bhk_s = f"{bhk} BHK " if bhk is not None else ""
            pt_s = session.requirements.get("propertyType") or "property"
            p0 = turn_matches[0]
            price_str = f"AED {p0.get('price_aed', 0):,}"
            ai_reply_text = (
                f"I found {len(turn_matches)} verified {bhk_s}{pt_s.lower()} options in {loc}, starting at {price_str} for \"{p0.get('title')}\". "
                f"{formulate_followup_question(session.requirements, True)}"
            )
        else:
            ai_reply_text = (
                "Hello! Welcome to LYKA Realty. How can I assist you with your property search in Dubai today? "
                "Could you tell me your preferred location, number of bedrooms, or budget?"
            )
        yield f"data: {json.dumps({'type': 'token', 'token': ai_reply_text})}\n\n"

    ai_reply_text = re.sub(r"<think>.*?</think>", "", ai_reply_text, flags=re.DOTALL).strip()
    if ai_reply_text.startswith("Thinking"):
        ai_reply_text = re.sub(r"^Thinking.*?\n\n?", "", ai_reply_text, flags=re.DOTALL).strip()

    total_ms = round((time.perf_counter() - t_start) * 1000, 2)
    session.conversation_turns.append({"user": clean_message, "ai": ai_reply_text})
    session.conversation_turns = session.conversation_turns[-6:]

    logger.info(
        "Chat stream completed in %.2fms (DB Search: %.2fms | TTFT: %sms | AI Gen: %.2fms | Matches: %d)",
        total_ms, db_search_ms, str(first_token_ms), ai_generation_ms, len(turn_matches)
    )

    yield f"data: {json.dumps({'type': 'done', 'reply': ai_reply_text, 'matched_properties': turn_matches, 'requirements': session.requirements, 'session_id': session_id, 'provider': 'ollama' if is_online else 'ollama-offline', 'model': OLLAMA_MODEL, 'need': ('no_results' if no_results_options is not None else None), 'options': options, 'timings': {'db_search_ms': db_search_ms, 'ttft_ms': first_token_ms, 'ai_generation_ms': ai_generation_ms, 'total_ms': total_ms}})}\n\n"

