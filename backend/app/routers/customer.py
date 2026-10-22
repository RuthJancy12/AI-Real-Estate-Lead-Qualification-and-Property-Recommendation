"""
Customer self-service profile endpoints (any verified Firebase identity).

Ownership model: every row is keyed by the UID from the VERIFIED token.
Callers address only "my profile" — there is no id parameter, so one
account can never read or write another's row. Email is copied from the
verified claims (never trusted from the body); role is resolved through
trusted backend logic (non-staff => customer) and reported read-only.
Acquisition attribution is first-touch-wins: stored source columns are
never overwritten by later updates.
"""
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app import schemas
from app.database import get_db
from app.models import CustomerProfile
from app.services import roles

router = APIRouter(prefix="/api/customer", tags=["customer"])


def require_verified_user(
    authorization: Optional[str] = Header(default=None),
) -> Dict[str, Any]:
    """Verified Firebase identity (any account, staff or customer)."""
    claims = roles.verify_bearer_token(authorization)
    if not claims or (not claims.get("uid") and not claims.get("email")):
        raise HTTPException(
            status_code=401,
            detail="Sign-in required (valid Firebase ID token).",
        )
    return claims


def _out(row: CustomerProfile, role: str) -> schemas.CustomerProfileOut:
    prefs = row.preferences if isinstance(row.preferences, dict) else {}
    return schemas.CustomerProfileOut(
        firebase_uid=row.firebase_uid,
        email=row.email,
        name=row.name,
        phone=row.phone,
        city=row.city,
        country=row.country,
        preferences=prefs,
        utm_source=row.utm_source,
        utm_medium=row.utm_medium,
        utm_campaign=row.utm_campaign,
        referrer=row.referrer,
        discovery_source=row.discovery_source,
        role=role,
        created_at=_as_utc(row.created_at),
        updated_at=_as_utc(row.updated_at),
    )


def _as_utc(dt: Any) -> datetime:
    if isinstance(dt, datetime):
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc)


class ProfileResponse(BaseModel):
    profile: Optional[schemas.CustomerProfileOut] = None
    role: str


@router.get("/profile", response_model=ProfileResponse, summary="My customer profile + trusted role")
def get_my_profile(
    claims: Dict[str, Any] = Depends(require_verified_user),
    db: Session = Depends(get_db),
):
    role, _, _ = roles.resolve_role(db, claims)
    uid = claims.get("uid")
    row = (
        db.query(CustomerProfile)
        .filter(CustomerProfile.firebase_uid == (uid or ""))
        .first()
        if uid else None
    )
    return ProfileResponse(profile=_out(row, role) if row else None, role=role)


@router.put("/profile", response_model=ProfileResponse, summary="Create/update my customer profile")
def save_my_profile(
    payload: schemas.CustomerProfileUpdate,
    claims: Dict[str, Any] = Depends(require_verified_user),
    db: Session = Depends(get_db),
):
    uid = claims.get("uid")
    if not uid:
        raise HTTPException(status_code=401, detail="A UID-bearing token is required.")
    role, email, _ = roles.resolve_role(db, claims)
    row = (
        db.query(CustomerProfile)
        .filter(CustomerProfile.firebase_uid == uid)
        .first()
    )
    prefs = payload.preferences.model_dump()
    if row is None:
        row = CustomerProfile(
            firebase_uid=uid,
            email=email,
            name=payload.name.strip(),
            phone=(payload.phone or "").strip() or None,
            city=(payload.city or "").strip() or None,
            country=(payload.country or "").strip() or None,
            preferences=prefs,
            utm_source=(payload.utm_source or "").strip() or None,
            utm_medium=(payload.utm_medium or "").strip() or None,
            utm_campaign=(payload.utm_campaign or "").strip() or None,
            referrer=(payload.referrer or "").strip() or None,
            discovery_source=(payload.discovery_source or "").strip() or None,
        )
        db.add(row)
    else:
        # Email always follows the verified token (never the body).
        row.email = email
        row.name = payload.name.strip()
        row.phone = (payload.phone or "").strip() or None
        row.city = (payload.city or "").strip() or None
        row.country = (payload.country or "").strip() or None
        row.preferences = prefs
        # First-touch attribution: keep the original acquisition source.
        if not row.utm_source and payload.utm_source:
            row.utm_source = payload.utm_source.strip() or None
        if not row.utm_medium and payload.utm_medium:
            row.utm_medium = payload.utm_medium.strip() or None
        if not row.utm_campaign and payload.utm_campaign:
            row.utm_campaign = payload.utm_campaign.strip() or None
        if not row.referrer and payload.referrer:
            row.referrer = payload.referrer.strip() or None
        # Self-reported discovery source is first-touch too: the customer's
        # own first answer is kept, never overwritten or guessed.
        if not row.discovery_source and payload.discovery_source:
            row.discovery_source = payload.discovery_source.strip() or None
        row.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(row)
    return ProfileResponse(profile=_out(row, role), role=role)
