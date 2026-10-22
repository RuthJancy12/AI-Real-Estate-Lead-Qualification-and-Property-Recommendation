"""
Lead acquisition-channel helpers shared by the leads list filter and the
staff overview breakdown.

Mirrors the frontend `classifyLeadChannel` (src/utils/leadSource.ts)
exactly: recognised utm_source wins (Google / Instagram / Facebook);
otherwise a recorded external referrer means Referral; a bare direct
visit means Direct; anything else is Unknown — never guessed.
"""
from typing import Any, Optional

from sqlalchemy import func, or_, and_

CHANNELS = ("Google", "Instagram", "Facebook", "Referral", "Direct", "Unknown")


def _present(col: Any):
    return and_(col.isnot(None), col != "")


def _blank(col: Any):
    return or_(col.is_(None), col == "")


def _known_network(col: Any):
    low = func.lower(col)
    return or_(
        low.like("%google%"),
        low.like("%instagram%"),
        low.like("%facebook%"),
        low == "fb",
        low.like("% meta%"),
    )


def channel_predicate(lead_model: Any, channel: str) -> Any:
    """SQLAlchemy boolean expression matching `classifyLeadChannel`."""
    src = lead_model.utm_source
    med = lead_model.utm_medium
    cmp = lead_model.utm_campaign
    ref = lead_model.referrer
    src_blank = _blank(src)
    if channel == "Google":
        return and_(_present(src), func.lower(src).like("%google%"))
    if channel == "Instagram":
        return and_(_present(src), func.lower(src).like("%instagram%"))
    if channel == "Facebook":
        return and_(
            _present(src),
            or_(func.lower(src).like("%facebook%"), func.lower(src) == "fb",
                func.lower(src).like("% meta%")),
        )
    if channel == "Referral":
        return and_(src_blank, _present(ref))
    if channel == "Direct":
        return and_(src_blank, _blank(ref), _blank(med), _blank(cmp))
    if channel == "Unknown":
        return or_(
            and_(_present(src), ~_known_network(src)),
            and_(src_blank, _blank(ref), or_(_present(med), _present(cmp))),
        )
    raise ValueError(f"Unknown channel: {channel}")


def validate_channel(channel: Optional[str]) -> Optional[str]:
    if channel is None:
        return None
    if channel not in CHANNELS:
        raise ValueError(f"Unknown channel: {channel}. Expected one of {', '.join(CHANNELS)}.")
    return channel
