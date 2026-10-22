"""
Staff, assignment, follow-up, and viewing endpoints with backend role enforcement.

- All routes require a verified Firebase staff identity (401 otherwise).
- /api/staff (list/create/update) is admin-only. Exactly one active admin is
  enforced: creating a second admin, or removing the last one, returns 409.
- Assignments/follow-ups/viewings: managers+ assign; salespeople see and
  update only their own assignments.
- Customers never appear here: verified non-staff emails resolve to role
  "customer" and receive 403 on these routes.
"""
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Assignment, CustomerProfile, FollowUp, Lead, StaffUser, Viewing
from app.services.lead_source import CHANNELS, channel_predicate
from app.schemas import (
    AssignmentCreate, AssignmentOut, AssignmentUpdate,
    FollowUpCreate, FollowUpOut,
    StaffCreate, StaffOut, StaffUpdate,
    ViewingCreate, ViewingOut, ViewingUpdate,
)
from app.services.roles import (
    STAFF_ROLES, _identity_match, find_staff, forbid_second_admin,
    require_admin, require_manager_plus, require_roles, require_staff,
    resolve_role, team_lead_ids, team_scope_emails,
)

router = APIRouter(prefix="/api/staff", tags=["staff"])


def _utcnow():
    return datetime.now(timezone.utc)


def _row_is_mine(model: Any, row: Any, ctx: Dict[str, Any]) -> bool:
    """True when the row's staff identity matches the caller (UID or email)."""
    uid = ctx.get("uid")
    if uid and getattr(row, "staff_uid", None) == uid:
        return True
    return (getattr(row, "staff_email", "") or "").lower() == (ctx.get("email") or "").lower()


def _row_in_team_scope(db: Session, ctx: Dict[str, Any], staff_email: Optional[str]) -> bool:
    """True when the email belongs to the caller's team (or is the caller)."""
    scope = [(e or "").lower() for e in (team_scope_emails(db, ctx) or [])]
    return (staff_email or "").lower() in scope


# ─── Self ─────────────────────────────────────────────────────────────────────

@router.get("/me", response_model=StaffOut, summary="Own staff profile (records login)")
def get_self(
    ctx: Dict[str, Any] = Depends(require_staff),
    db: Session = Depends(get_db),
):
    staff = find_staff(db, ctx.get("uid"), ctx.get("email"))
    if not staff:
        raise HTTPException(status_code=403, detail="Staff record not found.")
    # Bind the stable UID on first verified sign-in (no-op afterwards).
    if ctx.get("uid") and not staff.firebase_uid:
        staff.firebase_uid = ctx["uid"]
    staff.last_login_at = _utcnow()
    db.commit()
    db.refresh(staff)
    return staff


# ─── Staff management (admin only) ────────────────────────────────────────────

@router.get("", response_model=List[StaffOut], summary="List staff (admin/manager all, SM team only)")
def list_staff(
    include_inactive: bool = Query(False),
    ctx: Dict[str, Any] = Depends(require_staff),
    db: Session = Depends(get_db),
):
    if ctx["role"] == "salesperson":
        raise HTTPException(status_code=403, detail="Insufficient role.")
    q = db.query(StaffUser)
    if not include_inactive:
        q = q.filter(StaffUser.is_active == True)  # noqa: E712
    if ctx["role"] == "sales_manager":
        scope = team_scope_emails(db, ctx) or []
        lowered = [e.lower() for e in scope]
        q = q.filter(
            or_(StaffUser.email.in_(scope),
                func.lower(StaffUser.email).in_(lowered or [""]))
        )
    return q.order_by(StaffUser.role, StaffUser.email).all()


@router.post("", response_model=StaffOut, status_code=201, summary="Add staff (admin)")
def create_staff(
    payload: StaffCreate,
    _ctx: Dict[str, Any] = Depends(require_admin),
    db: Session = Depends(get_db),
):
    if payload.role not in STAFF_ROLES:
        raise HTTPException(status_code=422, detail="Unknown role.")
    forbid_second_admin(db, payload.role)
    existing = db.query(StaffUser).filter(StaffUser.email == payload.email).first()
    if existing:
        raise HTTPException(status_code=409, detail="Staff email already registered.")
    staff = StaffUser(email=payload.email, name=payload.name, role=payload.role,
                      is_active=True, manager_email=payload.manager_email)
    db.add(staff)
    db.commit()
    db.refresh(staff)
    return staff


@router.patch("/{staff_id:int}", response_model=StaffOut, summary="Update staff (admin)")
def update_staff(
    staff_id: int,
    payload: StaffUpdate,
    _ctx: Dict[str, Any] = Depends(require_admin),
    db: Session = Depends(get_db),
):
    staff = db.query(StaffUser).filter(StaffUser.id == staff_id).first()
    if not staff:
        raise HTTPException(status_code=404, detail="Staff not found.")
    if payload.role is not None:
        if payload.role not in STAFF_ROLES:
            raise HTTPException(status_code=422, detail="Unknown role.")
        forbid_second_admin(db, payload.role, exclude_id=staff.id)
        staff.role = payload.role
    if payload.name is not None:
        staff.name = payload.name
    if "manager_email" in payload.model_dump(exclude_unset=True):
        # Explicit null clears the team assignment; omitted leaves it.
        staff.manager_email = payload.manager_email
    if payload.is_active is not None:
        if staff.role == "admin" and payload.is_active is False:
            # Deactivating the last active admin is forbidden.
            forbid_second_admin(db, "admin", exclude_id=None)
            raise HTTPException(
                status_code=409,
                detail="Cannot deactivate the only active Admin.",
            )
        staff.is_active = payload.is_active
    staff.updated_at = _utcnow()
    db.commit()
    db.refresh(staff)
    return staff


# ─── Role-scoped operational overview ───────────────────────────────────────

def _as_utc(dt: Any) -> Optional[datetime]:
    if dt is None:
        return None
    if isinstance(dt, datetime):
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    return None


@router.get("/overview", summary="Role-scoped dashboard overview (real data)")
def get_overview(
    ctx: Dict[str, Any] = Depends(require_staff),
    db: Session = Depends(get_db),
):
    """Single real-data summary powering every role dashboard.

    Scoping mirrors the list endpoints: admin/manager see everything,
    sales managers see their team (+themselves), salespeople see only
    their own assignments. Staff totals are included for admin/manager
    (read-only here; writes stay admin-only).
    """
    role = ctx.get("role")
    now = datetime.now(timezone.utc)

    # Lead IDs visible to the caller.
    if role in ("admin", "manager"):
        visible_ids: Optional[List[int]] = None
    elif role == "sales_manager":
        visible_ids = team_lead_ids(db, ctx) or []
    else:
        own = db.query(Assignment).filter(_identity_match(Assignment, ctx)).all()
        visible_ids = [a.lead_id for a in own]

    def _scope_leads(q):
        if visible_ids is not None:
            q = q.filter(Lead.id.in_(visible_ids or [-1]))
        return q

    leads_total = _scope_leads(db.query(func.count(Lead.id))).scalar() or 0

    open_assigned_ids = {
        r[0] for r in db.query(Assignment.lead_id)
        .filter(Assignment.status != "closed").all()
    }
    if visible_ids is not None:
        open_assigned_ids &= set(visible_ids)
    assigned_leads = len(open_assigned_ids)
    unassigned_leads = _scope_leads(
        db.query(func.count(Lead.id)).filter(~Lead.id.in_(list(open_assigned_ids) or [-1]))
    ).scalar() or 0

    status_rows = _scope_leads(
        db.query(Lead.status, func.count(Lead.id))
    ).group_by(Lead.status).all()
    pipeline = {row[0]: row[1] for row in status_rows}

    # Acquisition-channel breakdown over the same scoped leads (real UTM data).
    channel_breakdown: Dict[str, int] = {}
    for ch in CHANNELS:
        channel_breakdown[ch] = (
            _scope_leads(db.query(func.count(Lead.id)))
            .filter(channel_predicate(Lead, ch))
            .scalar() or 0
        )

    # Follow-ups due within 7 days on visible leads (real notes only).
    fu_q = db.query(FollowUp).filter(FollowUp.next_action_at.isnot(None))
    if visible_ids is not None:
        fu_q = fu_q.filter(FollowUp.lead_id.in_(visible_ids or [-1]))
    due_cutoff = now + timedelta(days=7)
    due_all = fu_q.order_by(FollowUp.next_action_at.asc()).limit(200).all()
    due = [
        {
            "id": f.id, "lead_id": f.lead_id, "staff_email": f.staff_email,
            "note": f.note, "next_action_at": _as_utc(f.next_action_at),
            "created_at": _as_utc(f.created_at),
        }
        for f in due_all
        if (_as_utc(f.next_action_at) or due_cutoff + timedelta(days=1)) <= due_cutoff
    ]
    followups_due = due[:10]
    followups_due_count = len(due)

    # Upcoming scheduled viewings on visible leads.
    v_q = db.query(Viewing).filter(Viewing.status == "scheduled")
    if role == "salesperson":
        v_q = v_q.filter(_identity_match(Viewing, ctx))
    elif role == "sales_manager":
        scope = team_scope_emails(db, ctx) or []
        lowered = [e.lower() for e in scope]
        v_q = v_q.filter(
            or_(Viewing.staff_email.in_(scope),
                func.lower(Viewing.staff_email).in_(lowered or [""]))
        )
    upcoming_all = v_q.order_by(Viewing.scheduled_at.asc()).limit(100).all()
    upcoming = [
        {
            "id": v.id, "lead_id": v.lead_id, "property_ref": v.property_ref,
            "staff_email": v.staff_email, "scheduled_at": _as_utc(v.scheduled_at),
            "status": v.status,
        }
        for v in upcoming_all
        if (_as_utc(v.scheduled_at) or now) >= now - timedelta(hours=1)
    ]
    upcoming_viewings = upcoming[:10]

    recent = _scope_leads(db.query(Lead)).order_by(Lead.created_at.desc()).limit(8).all()
    recent_inquiries = [
        {
            "id": l.id, "customer_name": l.customer_name,
            "contact_email": l.contact_email, "location": l.location,
            "status": l.status, "priority_label": l.priority_label,
            "created_at": _as_utc(l.created_at),
        }
        for l in recent
    ]

    # Workload per staff email (team-scoped for SM, own for salesperson).
    perf_q = db.query(Assignment)
    if role == "salesperson":
        perf_q = perf_q.filter(_identity_match(Assignment, ctx))
    elif role == "sales_manager":
        scope = team_scope_emails(db, ctx) or []
        lowered = [e.lower() for e in scope]
        perf_q = perf_q.filter(
            or_(Assignment.staff_email.in_(scope),
                func.lower(Assignment.staff_email).in_(lowered or [""]))
        )
    perf_rows = perf_q.all()
    perf: Dict[str, Dict[str, int]] = {}
    for a in perf_rows:
        cell = perf.setdefault(a.staff_email, {"open": 0, "in_progress": 0, "closed": 0, "total": 0})
        cell["total"] += 1
        if a.status in cell:
            cell[a.status] += 1
    team_performance = [
        {"staff_email": email, **counts}
        for email, counts in sorted(perf.items(), key=lambda kv: -kv[1]["total"])
    ][:20]

    out: Dict[str, Any] = {
        "role": role,
        "leads_total": leads_total,
        "assigned_leads": assigned_leads,
        "unassigned_leads": unassigned_leads,
        "pipeline": pipeline,
        "channel_breakdown": channel_breakdown,
        "followups_due_count": followups_due_count,
        "followups_due": followups_due,
        "upcoming_viewings": upcoming_viewings,
        "recent_inquiries": recent_inquiries,
        "team_performance": team_performance,
    }

    if role in ("admin", "manager"):
        out["staff_total"] = db.query(func.count(StaffUser.id)).scalar() or 0
        out["active_staff"] = db.query(func.count(StaffUser.id)).filter(
            StaffUser.is_active == True  # noqa: E712
        ).scalar() or 0
    elif role == "sales_manager":
        team = team_scope_emails(db, ctx) or []
        out["team_members"] = team
        out["team_size"] = len(team)

    return out


# ─── Customer directory (admin/manager read-only) ─────────────────────────

@router.get("/customers", summary="Customer directory (admin/manager)")
def list_customers(
    ctx: Dict[str, Any] = Depends(require_roles("admin", "manager")),
    db: Session = Depends(get_db),
):
    """Permitted customer fields for authorized employees. Staff identities
    are excluded; customers resolve by absence of an active staff row.
    No firebase_uid or internal identifiers are exposed."""
    staff_uids = {
        (s.firebase_uid or "").strip()
        for s in db.query(StaffUser).filter(StaffUser.is_active == True).all()  # noqa: E712
    }
    staff_uids.discard("")
    staff_emails = {
        (s.email or "").strip().lower()
        for s in db.query(StaffUser).filter(StaffUser.is_active == True).all()  # noqa: E712
    }
    rows = (
        db.query(CustomerProfile)
        .order_by(CustomerProfile.updated_at.desc())
        .limit(200)
        .all()
    )
    out = []
    for p in rows:
        if (p.firebase_uid or "") in staff_uids:
            continue
        if (p.email or "").strip().lower() in staff_emails:
            continue
        out.append({
            "name": p.name,
            "email": p.email,
            "phone": p.phone,
            "city": p.city,
            "country": p.country,
            "role": "customer",
            "utm_source": p.utm_source,
            "utm_medium": p.utm_medium,
            "utm_campaign": p.utm_campaign,
            "referrer": p.referrer,
            "discovery_source": p.discovery_source,
            "created_at": _as_utc(p.created_at),
            "updated_at": _as_utc(p.updated_at),
        })
    return out


# ─── Assignments ──────────────────────────────────────────────────────────────

@router.get("/assignments", response_model=List[AssignmentOut], summary="List assignments (scoped)")
def list_assignments(
    ctx: Dict[str, Any] = Depends(require_staff),
    db: Session = Depends(get_db),
):
    q = db.query(Assignment)
    if ctx["role"] == "salesperson":
        # Salespeople see only ACTIVE work: closed rows are history for
        # managers, and ex-assignees must lose access after reassignment.
        q = q.filter(_identity_match(Assignment, ctx)).filter(Assignment.status != "closed")
    elif ctx["role"] == "sales_manager":
        scope = team_scope_emails(db, ctx) or []
        lowered = [e.lower() for e in scope]
        q = q.filter(
            or_(Assignment.staff_email.in_(scope),
                func.lower(Assignment.staff_email).in_(lowered or [""]))
        )
    return q.order_by(Assignment.created_at.desc()).all()


@router.post("/assignments", response_model=AssignmentOut, status_code=201, summary="Assign lead (manager+)")
def create_assignment(
    payload: AssignmentCreate,
    ctx: Dict[str, Any] = Depends(require_manager_plus),
    db: Session = Depends(get_db),
):
    lead = db.query(Lead).filter(Lead.id == payload.lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found.")
    role, _, _ = resolve_role(db, {"email": payload.staff_email})
    if role not in STAFF_ROLES:
        raise HTTPException(status_code=422, detail="Assignee is not an active staff member.")
    if ctx["role"] == "sales_manager":
        # Sales managers distribute only within their authorized team.
        scope = [(e or "").lower() for e in (team_scope_emails(db, ctx) or [])]
        if (payload.staff_email or "").lower() not in scope:
            raise HTTPException(status_code=403, detail="Assignee is outside your team.")
    existing = (
        db.query(Assignment)
        .filter(Assignment.lead_id == payload.lead_id, Assignment.status != "closed")
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail="Lead already has an open assignment.")
    assignee = find_staff(db, None, payload.staff_email)
    row = Assignment(
        lead_id=payload.lead_id, staff_email=payload.staff_email,
        staff_uid=assignee.firebase_uid if assignee else None,
        assigned_by=ctx["email"] or "", status="open",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.patch("/assignments/{assignment_id:int}", response_model=AssignmentOut, summary="Update assignment status")
def update_assignment(
    assignment_id: int,
    payload: AssignmentUpdate,
    ctx: Dict[str, Any] = Depends(require_staff),
    db: Session = Depends(get_db),
):
    row = db.query(Assignment).filter(Assignment.id == assignment_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Assignment not found.")
    if ctx["role"] == "salesperson" and not _row_is_mine(Assignment, row, ctx):
        raise HTTPException(status_code=403, detail="Salespeople update only their own assignments.")
    if ctx["role"] == "salesperson" and row.status == "closed":
        raise HTTPException(status_code=403, detail="Closed assignments are read-only history.")
    if ctx["role"] == "sales_manager" and not _row_in_team_scope(db, ctx, row.staff_email):
        raise HTTPException(status_code=403, detail="Assignment is outside your team.")
    row.status = payload.status
    row.updated_at = _utcnow()
    db.commit()
    db.refresh(row)
    return row


# ─── Follow-ups (append-only) ─────────────────────────────────────────────────

@router.get("/followups", response_model=List[FollowUpOut], summary="List follow-up notes (scoped)")
def list_followups(
    lead_id: Optional[int] = Query(None),
    ctx: Dict[str, Any] = Depends(require_staff),
    db: Session = Depends(get_db),
):
    q = db.query(FollowUp)
    if lead_id is not None:
        q = q.filter(FollowUp.lead_id == lead_id)
    if ctx["role"] == "salesperson":
        own_lead_ids = [
            a.lead_id for a in
            db.query(Assignment).filter(_identity_match(Assignment, ctx)).filter(
                Assignment.status != "closed").all()
        ]
        q = q.filter(FollowUp.lead_id.in_(own_lead_ids or [-1]))
    elif ctx["role"] == "sales_manager":
        team_ids = team_lead_ids(db, ctx) or [-1]
        q = q.filter(FollowUp.lead_id.in_(team_ids))
    return q.order_by(FollowUp.created_at.desc()).limit(200).all()


@router.post("/followups", response_model=FollowUpOut, status_code=201, summary="Add follow-up note")
def create_followup(
    payload: FollowUpCreate,
    ctx: Dict[str, Any] = Depends(require_staff),
    db: Session = Depends(get_db),
):
    lead = db.query(Lead).filter(Lead.id == payload.lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found.")
    if ctx["role"] == "salesperson":
        own = (
            db.query(Assignment)
            .filter(Assignment.lead_id == payload.lead_id)
            .filter(_identity_match(Assignment, ctx))
            .filter(Assignment.status != "closed")
            .first()
        )
        if not own:
            raise HTTPException(status_code=403, detail="Lead is not assigned to you.")
    elif ctx["role"] == "sales_manager":
        if payload.lead_id not in (team_lead_ids(db, ctx) or []):
            raise HTTPException(status_code=403, detail="Lead is outside your team.")
    row = FollowUp(
        lead_id=payload.lead_id, staff_email=ctx["email"] or "",
        staff_uid=ctx.get("uid"),
        note=payload.note, next_action_at=payload.next_action_at,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


# ─── Viewings ─────────────────────────────────────────────────────────────────

@router.get("/viewings", response_model=List[ViewingOut], summary="List viewings (scoped)")
def list_viewings(
    ctx: Dict[str, Any] = Depends(require_staff),
    db: Session = Depends(get_db),
):
    q = db.query(Viewing)
    if ctx["role"] == "salesperson":
        active_ids = [
            a.lead_id for a in
            db.query(Assignment).filter(_identity_match(Assignment, ctx)).filter(
                Assignment.status != "closed").all()
        ]
        q = q.filter(_identity_match(Viewing, ctx)).filter(
            Viewing.lead_id.in_(active_ids or [-1]))
    elif ctx["role"] == "sales_manager":
        scope = team_scope_emails(db, ctx) or []
        lowered = [e.lower() for e in scope]
        q = q.filter(
            or_(Viewing.staff_email.in_(scope),
                func.lower(Viewing.staff_email).in_(lowered or [""]))
        )
    return q.order_by(Viewing.scheduled_at.desc()).limit(200).all()


@router.post("/viewings", response_model=ViewingOut, status_code=201, summary="Schedule viewing")
def create_viewing(
    payload: ViewingCreate,
    ctx: Dict[str, Any] = Depends(require_staff),
    db: Session = Depends(get_db),
):
    lead = db.query(Lead).filter(Lead.id == payload.lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found.")
    if ctx["role"] == "salesperson":
        own = (
            db.query(Assignment)
            .filter(Assignment.lead_id == payload.lead_id)
            .filter(_identity_match(Assignment, ctx))
            .filter(Assignment.status != "closed")
            .first()
        )
        if not own:
            raise HTTPException(status_code=403, detail="Lead is not assigned to you.")
    elif ctx["role"] == "sales_manager":
        if payload.lead_id not in (team_lead_ids(db, ctx) or []):
            raise HTTPException(status_code=403, detail="Lead is outside your team.")
    row = Viewing(
        lead_id=payload.lead_id, property_ref=payload.property_ref,
        staff_email=ctx["email"] or "", staff_uid=ctx.get("uid"),
        scheduled_at=payload.scheduled_at,
        status="scheduled",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.patch("/viewings/{viewing_id:int}", response_model=ViewingOut, summary="Update viewing")
def update_viewing(
    viewing_id: int,
    payload: ViewingUpdate,
    ctx: Dict[str, Any] = Depends(require_staff),
    db: Session = Depends(get_db),
):
    row = db.query(Viewing).filter(Viewing.id == viewing_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Viewing not found.")
    if ctx["role"] == "salesperson" and not _row_is_mine(Viewing, row, ctx):
        raise HTTPException(status_code=403, detail="Salespeople update only their own viewings.")
    if ctx["role"] == "salesperson":
        active = (
            db.query(Assignment)
            .filter(Assignment.lead_id == row.lead_id)
            .filter(_identity_match(Assignment, ctx))
            .filter(Assignment.status != "closed")
            .first()
        )
        if not active:
            raise HTTPException(status_code=403, detail="Lead is no longer assigned to you.")
    if ctx["role"] == "sales_manager" and not _row_in_team_scope(db, ctx, row.staff_email):
        raise HTTPException(status_code=403, detail="Viewing is outside your team.")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(row, field, value)
    row.updated_at = _utcnow()
    db.commit()
    db.refresh(row)
    return row
