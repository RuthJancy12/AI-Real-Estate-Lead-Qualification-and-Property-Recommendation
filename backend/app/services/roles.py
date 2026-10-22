"""
Backend role enforcement for LYKA Realty (PRD: five roles).

Roles: admin (exactly one, active) > manager > sales_manager > salesperson,
plus customer (any verified Firebase email WITHOUT an active staff row).

Source of truth is the SQLite staff_users table, matched against VERIFIED
Firebase token claims — never against a client-supplied role. Identity
resolution prefers the stable Firebase UID and falls back to verified email,
so records survive email changes. A staff row's UID is bound automatically
on its first verified sign-in. A Firebase custom claim `role` may
additionally be set via the Admin SDK for Realtime Database rules, but the
backend does not trust it alone.

Without Firebase server credentials configured, verify_bearer_token()
returns None and every staff endpoint answers 401 (secure default).
"""
from typing import Any, Dict, List, Optional, Tuple

from fastapi import Depends, Header, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import STAFF_ROLES, StaffUser
from app.services.firebase_auth import verify_bearer_token

CUSTOMER = "customer"
ALL_ROLES = STAFF_ROLES + (CUSTOMER,)


def find_staff(db: Session, uid: Optional[str], email: Optional[str]) -> Optional["StaffUser"]:
    """Find an active staff row by stable UID first, then verified email."""
    if uid:
        hit = (
            db.query(StaffUser)
            .filter(StaffUser.firebase_uid == uid)
            .filter(StaffUser.is_active == True)  # noqa: E712
            .first()
        )
        if hit:
            return hit
    if email:
        return (
            db.query(StaffUser)
            .filter(func.lower(StaffUser.email) == str(email).lower())
            .filter(StaffUser.is_active == True)  # noqa: E712
            .first()
        )
    return None


def resolve_role(db: Session, claims: Optional[Dict[str, Any]]) -> Tuple[str, Optional[str], Optional[str]]:
    """Map verified token claims to (role, email, uid). Unknown/inactive -> customer.

    Binds the stable UID to an email-matched staff row on first verified
    sign-in (one UPDATE, no data loss). UID collisions across rows resolve to
    customer rather than guessing.
    """
    uid = (claims or {}).get("uid") if claims else None
    email = (claims or {}).get("email") if claims else None
    uid = str(uid) if uid else None
    email = str(email) if email else None
    if not uid and not email:
        return CUSTOMER, None, None
    if uid:
        dupes = (
            db.query(StaffUser)
            .filter(StaffUser.firebase_uid == uid)
            .filter(StaffUser.is_active == True)  # noqa: E712
            .all()
        )
        if len(dupes) > 1:
            return CUSTOMER, email, uid
        if len(dupes) == 1:
            return dupes[0].role, email, uid
    staff = find_staff(db, None, email)
    if staff and staff.role in STAFF_ROLES:
        if uid and not staff.firebase_uid:
            staff.firebase_uid = uid
            db.commit()
        return staff.role, email, uid
    return CUSTOMER, email, uid


def active_admin_exists(db: Session, exclude_id: Optional[int] = None) -> bool:
    q = db.query(StaffUser).filter(
        StaffUser.role == "admin", StaffUser.is_active == True  # noqa: E712
    )
    if exclude_id is not None:
        q = q.filter(StaffUser.id != exclude_id)
    return q.first() is not None


def forbid_second_admin(db: Session, new_role: Optional[str], exclude_id: Optional[int] = None) -> None:
    """Raises 409 if the change would create a second active admin."""
    if new_role == "admin" and active_admin_exists(db, exclude_id):
        raise HTTPException(
            status_code=409,
            detail="Exactly one active Admin is allowed; demote or deactivate the current Admin first.",
        )


def require_roles(*allowed: str):
    """FastAPI dependency: verified staff identity whose role is allowed."""
    def dep(
        authorization: Optional[str] = Header(default=None),
        db: Session = Depends(get_db),
    ) -> Dict[str, Any]:
        claims = verify_bearer_token(authorization)
        if not claims:
            raise HTTPException(
                status_code=401,
                detail="Staff sign-in required (valid Firebase ID token).",
            )
        role, email, uid = resolve_role(db, claims)
        if role not in allowed:
            raise HTTPException(status_code=403, detail="Insufficient role.")
        return {"role": role, "email": email, "uid": uid}

    return dep


require_staff = require_roles(*STAFF_ROLES)
require_manager_plus = require_roles("admin", "manager", "sales_manager")
require_admin = require_roles("admin")


def scoped_assignee_filter(role: str, email: Optional[str]):
    """Salespeople only see their own assignments; managers and admin see all."""
    if role == "salesperson":
        from app.models import Assignment

        return [Assignment.staff_email == (email or "")]
    return []


def _identity_match(model: Any, ctx: Dict[str, Any]):
    """Email-or-UID match against a row's staff_email/staff_uid columns."""
    from sqlalchemy import or_

    email = ctx.get("email") or ""
    uid = ctx.get("uid")
    if uid:
        return or_(model.staff_uid == uid, model.staff_email == email)
    return model.staff_email == email


def team_scope_emails(db: Session, ctx: Dict[str, Any]) -> Optional[List[str]]:
    """Emails a sales manager may operate on: their team + themselves.

    Returns None for admin/manager (unrestricted). A team is the set of
    active staff whose manager_email equals the SM's email.
    """
    if ctx.get("role") in ("admin", "manager"):
        return None
    if ctx.get("role") != "sales_manager":
        return None
    me = (ctx.get("email") or "").lower()
    members = [
        s.email for s in
        db.query(StaffUser)
        .filter(StaffUser.is_active == True)  # noqa: E712
        .filter(func.lower(StaffUser.manager_email) == me)
        .all()
    ]
    return members + ([ctx.get("email")] if ctx.get("email") else [])


def team_lead_ids(db: Session, ctx: Dict[str, Any]) -> Optional[List[int]]:
    """Lead IDs assigned to the caller's team (SM) — None when unrestricted."""
    from app.models import Assignment

    scope = team_scope_emails(db, ctx)
    if scope is None:
        return None
    lowered = [e.lower() for e in scope]
    rows = (
        db.query(Assignment)
        .filter(Assignment.staff_email.in_(scope) | func.lower(Assignment.staff_email).in_(lowered))
        .all()
    )
    return [a.lead_id for a in rows]


def assert_lead_access(db: Session, ctx: Dict[str, Any], lead_id: int) -> None:
    """Object-level lead access.

    - salesperson: only leads assigned to them;
    - sales_manager: only leads assigned to their team (incl. themselves);
    - admin/manager: all leads.
    """
    from app.models import Assignment

    role = ctx.get("role")
    if role in ("admin", "manager"):
        return
    if role == "salesperson":
        own = (
            db.query(Assignment)
            .filter(Assignment.lead_id == lead_id)
            .filter(_identity_match(Assignment, ctx))
            .filter(Assignment.status != "closed")
            .first()
        )
        if not own:
            raise HTTPException(status_code=403, detail="Lead is not assigned to you.")
        return
    if role == "sales_manager":
        ids = team_lead_ids(db, ctx) or []
        if lead_id not in ids:
            raise HTTPException(status_code=403, detail="Lead is outside your team.")
        return
    raise HTTPException(status_code=403, detail="Insufficient role.")
