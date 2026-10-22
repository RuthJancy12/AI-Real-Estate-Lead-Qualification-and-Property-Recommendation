"""
Explicit nearby-community map for the LYKA Realty recommendation engine.

When a customer requests a location with no suitable stock, the engines
(CRM lead matcher + deterministic dataset search) fall back to these
neighbouring communities — ordered closest-first — instead of showing
unrelated areas or inventing listings.

Rules:
- Only communities with a genuine geographic adjacency are listed. A
  community NOT in this map has NO fallback: the result is honestly empty.
- Never assume every Dubai community is nearby; unknown or vague input
  ("Dubai", "UAE") resolves to None.
- Matching stays substring-based so dataset spellings ("Jumeirah Lake
  Towers") and common abbreviations ("JLT", "DSO") resolve correctly.
- Display names below must match the real dataset location spellings.
"""
import re
from typing import Any, Dict, List, Optional

# Canonical key (lowercase) -> nearby display names, closest first.
NEARBY_MAP: Dict[str, List[str]] = {
    "dubai marina": ["Jumeirah Lake Towers", "Jumeirah Beach Residence", "Palm Jumeirah"],
    "jumeirah lake towers": ["Dubai Marina", "Jumeirah Beach Residence"],
    "jumeirah beach residence": ["Dubai Marina", "Palm Jumeirah", "Jumeirah Lake Towers"],
    "palm jumeirah": ["Jumeirah Beach Residence", "Dubai Marina", "Jumeirah Lake Towers"],
    "downtown dubai": ["Business Bay", "Mohammed Bin Rashid City", "Meydan"],
    "business bay": ["Downtown Dubai", "Mohammed Bin Rashid City", "Meydan"],
    "mohammed bin rashid city": ["Meydan", "Downtown Dubai", "Business Bay"],
    "meydan": ["Mohammed Bin Rashid City", "Downtown Dubai", "Business Bay"],
    "dubai hills estate": ["Al Barsha", "Dubai Sports City", "Jumeirah Village Circle"],
    "al barsha": ["Jumeirah Village Circle", "Dubai Sports City", "Dubai Hills Estate"],
    "jumeirah village circle": ["Dubai Sports City", "Al Barsha", "Dubai Hills Estate"],
    "dubai sports city": ["Jumeirah Village Circle", "Al Barsha", "Dubai Hills Estate"],
    "arabian ranches": ["DAMAC Hills", "Dubai Hills Estate"],
    "damac hills": ["Arabian Ranches"],
    "emirates hills": ["Al Barsha", "Dubai Marina"],
    "discovery gardens": ["Jumeirah Lake Towers", "Dubai South"],
    "dubai south": ["Discovery Gardens"],
    "dubai creek harbour": ["Mirdif"],
    "mirdif": ["Dubai Creek Harbour"],
    "dubai silicon oasis": ["Mirdif", "Dubai Creek Harbour"],
    "difc": ["Downtown Dubai", "Business Bay"],
}

_ABBREVIATIONS: Dict[str, str] = {
    "dso": "dubai silicon oasis",
    "silicon oasis": "dubai silicon oasis",
    "jvc": "jumeirah village circle",
    "jlt": "jumeirah lake towers",
    "jbr": "jumeirah beach residence",
    "dhe": "dubai hills estate",
    "dmac": "damac hills",
    "palm": "palm jumeirah",
    "dt": "downtown dubai",
    "downtown": "downtown dubai",
    "bb": "business bay",
    "mbr city": "mohammed bin rashid city",
    "mbr": "mohammed bin rashid city",
    "sports city": "dubai sports city",
    "marina": "dubai marina",
    "creek harbour": "dubai creek harbour",
    "hills": "dubai hills estate",
}


def normalize_community(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip().lower())


def resolve_community(location: Any) -> Optional[str]:
    """Resolve free text to a canonical map key, or None when unknown.

    Conservative by design: bare "dubai"/"uae" and unlisted areas return
    None so no fallback is ever guessed for them.
    """
    t = normalize_community(location)
    if not t or t in ("dubai", "uae", "united arab emirates"):
        return None
    if t in _ABBREVIATIONS:
        return _ABBREVIATIONS[t]
    if t in NEARBY_MAP:
        return t
    for key in sorted(NEARBY_MAP, key=len, reverse=True):
        expanded = _ABBREVIATIONS.get(t, t)
        if expanded in NEARBY_MAP:
            return expanded
        if len(t) >= 6 and (t in key or key in t):
            return key
    return None


def nearby_communities_for(location: Any) -> List[str]:
    """Ordered nearby display names for a (possibly multi-location) request.

    Multi-location requests ("Business Bay, Downtown") union each token's
    neighbours with duplicates removed. Unknown tokens contribute nothing.
    """
    seen: List[str] = []
    tokens = [t.strip() for t in re.split(r"[,;/|]+", str(location or "")) if t.strip()]
    for tok in tokens or [str(location or "")]:
        key = resolve_community(tok)
        if not key:
            continue
        for name in NEARBY_MAP[key]:
            if name not in seen:
                seen.append(name)
    return seen
