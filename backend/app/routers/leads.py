"""
Lead management REST endpoints.
"""
import logging
import time
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.models import Assignment, Lead, Recommendation, Activity, CRMProperty
from app.schemas import (
    AnalyseRequest, AnalyseResponse, ExtractedRequirements, ScoreBreakdown,
    LeadCreate, LeadOut, LeadListOut, LeadListResponse,
    LeadUpdate, LeadStatusUpdate, PublicEnquiryCreate,
    DashboardStats, ActivityOut,
    RecommendationOut, PropertyOut,
)
from app.services.lead_service import (
    extract_requirements, calculate_score,
    match_properties, save_recommendations, log_activity
)
from app.services.lead_source import channel_predicate, validate_channel
from app.services.roles import assert_lead_access, require_staff, team_lead_ids

logger = logging.getLogger("lyka.leads")

router = APIRouter(prefix="/api/leads", tags=["leads"])


# ─── POST /api/leads/analyze ──────────────────────────────────────────────────

@router.post("/analyze", response_model=AnalyseResponse, summary="AI extraction + scoring (no DB save)")
def analyze_enquiry(
    payload: AnalyseRequest,
    ctx: Dict[str, Any] = Depends(require_staff),
    db: Session = Depends(get_db),
):
    """
    Extract structured requirements from a free-text customer enquiry using
    the local Ollama model, score them, and return suggestions — without saving to DB.
    """
    # Diagnostic log: endpoint path, caller role, provider, outcome. Never
    # logs tokens, keys, enquiry text, or customer details.
    t0 = time.perf_counter()
    try:
        req = extract_requirements(payload.enquiry_text)
    except RuntimeError as e:
        logger.warning("POST /api/leads/analyze provider=ollama role=%s status=502 error=%s",
                       ctx.get("role"), e)
        raise HTTPException(status_code=502, detail=str(e))
    except ValueError as e:
        logger.info("POST /api/leads/analyze provider=ollama role=%s status=400",
                    ctx.get("role"))
        raise HTTPException(status_code=400, detail=str(e))

    score = calculate_score(req)

    logger.info("POST /api/leads/analyze provider=ollama role=%s status=200 score=%s label=%s ms=%.0f",
                ctx.get("role"), score.get("total"), score.get("label"),
                (time.perf_counter() - t0) * 1000)

    # Build suggestions for missing fields
    suggestions: List[str] = []
    missing = req.get("missing_fields", [])
    if "budget_max" in missing:
        suggestions.append("Ask the customer for their maximum budget to improve lead score by 20 points.")
    if "location" in missing:
        suggestions.append("Ask for preferred Dubai community (Marina, Downtown, JVC, etc.) for +20 points.")
    if "lead_type" in missing:
        suggestions.append("Clarify whether the customer wants to buy or rent.")
    if "timeline_days" in missing:
        suggestions.append("Ask when they plan to move in — answers within 30 days score highest (+20).")
    if "contact_email" in missing and "contact_phone" in missing:
        suggestions.append("Obtain at least one contact method.")

    return AnalyseResponse(
        requirements=ExtractedRequirements(**req),
        score=ScoreBreakdown(**score),
        suggestions=suggestions,
    )


# ─── POST /api/leads ──────────────────────────────────────────────────────────

@router.post("", response_model=LeadOut, status_code=201, summary="Save lead to database")
def create_lead(
    payload: LeadCreate,
    ctx: Dict[str, Any] = Depends(require_staff),
    db: Session = Depends(get_db),
):
    """Save a qualified lead. If raw text was already analysed, pass in the pre-computed fields."""
    # Duplicate prevention: same email + same raw text within 24 hours
    if payload.contact_email:
        cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
        existing = db.query(Lead).filter(
            Lead.contact_email == payload.contact_email,
            Lead.created_at >= cutoff
        ).first()
        if existing:
            raise HTTPException(
                status_code=409,
                detail=f"A lead from {payload.contact_email} was already submitted in the last 24 hours (id={existing.id})."
            )

    lead = Lead(
        raw_enquiry_text=payload.raw_enquiry_text,
        customer_name=payload.customer_name,
        contact_email=payload.contact_email,
        contact_phone=payload.contact_phone,
        lead_type=payload.lead_type,
        property_type=payload.property_type,
        location=payload.location,
        bedrooms=payload.bedrooms,
        budget_min=payload.budget_min,
        budget_max=payload.budget_max,
        purpose=payload.purpose,
        amenities=payload.amenities,
        timeline_days=payload.timeline_days,
        missing_fields=payload.missing_fields,
        priority_score=payload.priority_score,
        priority_label=payload.priority_label,
        score_breakdown=payload.score_breakdown,
        status="new",
    )
    db.add(lead)
    db.commit()
    db.refresh(lead)

    # If we have enough info, run matching immediately
    if lead.lead_type or lead.location:
        matches = match_properties(lead, db)
        if matches:
            save_recommendations(lead, matches, db)

    log_activity(lead.id, "enquiry_received", "Lead created from customer enquiry.", db)
    log_activity(lead.id, "ai_analysed", f"Priority: {lead.priority_label} ({lead.priority_score}/100)", db)

    db.refresh(lead)
    return _load_lead(lead.id, db)


# ─── POST /api/leads/public (anonymous website enquiry) ─────────────────────

@router.post("/public", response_model=LeadOut, status_code=201, summary="Public website enquiry (no auth)")
def create_public_enquiry(
    payload: PublicEnquiryCreate,
    db: Session = Depends(get_db),
):
    """Save an anonymous customer website enquiry as a Lead in the SAME
    `leads` table used by the CRM. No staff token required so the public
    React forms can persist enquiries. Admin/manager list filters are
    unchanged, so the new row appears in Admin → Leads immediately
    (status `new`, unassigned)."""
    # Duplicate prevention without blocking legitimate separate enquiries:
    # an accidental double-submit (same email + same property within 24h)
    # returns 409, while a different property (or a property-less general
    # enquiry vs a property enquiry) saves as its own lead.
    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
    recent = db.query(Lead).filter(
        Lead.contact_email == payload.contact_email,
        Lead.created_at >= cutoff
    ).all()
    dup: Optional[Lead] = None
    if payload.property_ref:
        for row in recent:
            if payload.property_ref in (row.raw_enquiry_text or ""):
                dup = row
                break
    else:
        for row in recent:
            if "(Ref:" not in (row.raw_enquiry_text or ""):
                dup = row
                break
    if dup:
        raise HTTPException(
            status_code=409,
            detail=f"A lead from {payload.contact_email} was already submitted in the last 24 hours (id={dup.id})."
        )

    parts = [
        f"Public website enquiry from {payload.customer_name.strip()}",
        f"<{payload.contact_email}>",
    ]
    if payload.contact_phone:
        parts.append(f"phone {payload.contact_phone.strip()}")
    if payload.property_title or payload.property_ref:
        prop = payload.property_title or ""
        if payload.property_ref:
            prop = f"{prop} (Ref: {payload.property_ref})".strip()
        parts.append(f"Interested in: {prop}")
    if payload.location:
        parts.append(f"Location: {payload.location}")
    if payload.lead_type:
        parts.append(f"Intent: {'buy' if payload.lead_type == 'buyer' else 'rent'}")
    if payload.property_type:
        parts.append(f"Property type: {payload.property_type}")
    if payload.preferred_date:
        parts.append(f"Preferred viewing date: {payload.preferred_date}")
    if payload.message and payload.message.strip():
        parts.append(f"Message: {payload.message.strip()}")
    raw_text = ". ".join(parts) + "."

    lead = Lead(
        raw_enquiry_text=raw_text,
        customer_name=payload.customer_name.strip(),
        contact_email=payload.contact_email,
        contact_phone=(payload.contact_phone.strip() if payload.contact_phone else None),
        lead_type=payload.lead_type,
        property_type=payload.property_type,
        location=payload.location,
        bedrooms=payload.bedrooms,
        budget_min=payload.budget_min,
        budget_max=payload.budget_max,
        timeline_days=payload.timeline_days,
        utm_source=payload.utm_source,
        utm_medium=payload.utm_medium,
        utm_campaign=payload.utm_campaign,
        referrer=payload.referrer,
        discovery_source=payload.discovery_source,
        status="new",
    )
    # Score from the ACTUAL saved fields (never invented: absent stays
    # None and scores 0 for that criterion). Previously this endpoint
    # saved the column defaults (0/Low/{}), which is why Lead #3 showed
    # 0/100 despite having name, email, phone, intent, type, location.
    req = {
        "budget_max": lead.budget_max, "budget_min": lead.budget_min,
        "location": lead.location, "property_type": lead.property_type,
        "bedrooms": lead.bedrooms, "lead_type": lead.lead_type,
        "timeline_days": lead.timeline_days, "amenities": [],
        "purpose": None,
    }
    score = calculate_score(req)
    core_fields = ["customer_name", "contact_email", "contact_phone",
                   "lead_type", "property_type", "location", "bedrooms",
                   "budget_max", "timeline_days"]
    known = {
        "customer_name": lead.customer_name, "contact_email": lead.contact_email,
        "contact_phone": lead.contact_phone, "lead_type": lead.lead_type,
        "property_type": lead.property_type, "location": lead.location,
        "bedrooms": lead.bedrooms, "budget_max": lead.budget_max,
        "timeline_days": lead.timeline_days,
    }
    lead.missing_fields = [f for f in core_fields if known.get(f) is None]
    lead.priority_score = score["total"]
    lead.priority_label = score["label"]
    lead.score_breakdown = score
    db.add(lead)
    db.commit()
    db.refresh(lead)

    if lead.lead_type or lead.location:
        matches = match_properties(lead, db)
        if matches:
            save_recommendations(lead, matches, db)

    log_activity(lead.id, "enquiry_received", "Lead created from public website enquiry.", db)
    log_activity(lead.id, "ai_analysed", f"Priority: {lead.priority_label} ({lead.priority_score}/100)", db)

    db.refresh(lead)
    return _load_lead(lead.id, db)


# ─── GET /api/leads ───────────────────────────────────────────────────────────

@router.get("", response_model=LeadListResponse, summary="List leads with search/filter")
def list_leads(
    search: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    priority: Optional[str] = Query(None),
    lead_type: Optional[str] = Query(None),
    channel: Optional[str] = Query(None, description="Acquisition channel: Google, Instagram, Facebook, Referral, Direct, Unknown"),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    ctx: Dict[str, Any] = Depends(require_staff),
    db: Session = Depends(get_db),
):
    q = db.query(Lead)

    # Data isolation: salespeople list only leads assigned to them,
    # sales managers only leads assigned to their team.
    if ctx["role"] == "salesperson":
        own_ids = [
            a.lead_id for a in
            db.query(Assignment).filter(Assignment.staff_email == (ctx["email"] or "")).filter(
                Assignment.status != "closed").all()
        ]
        q = q.filter(Lead.id.in_(own_ids or [-1]))
    elif ctx["role"] == "sales_manager":
        q = q.filter(Lead.id.in_(team_lead_ids(db, ctx) or [-1]))

    if search:
        like = f"%{search}%"
        q = q.filter(
            Lead.customer_name.ilike(like) |
            Lead.contact_email.ilike(like) |
            Lead.location.ilike(like)
        )
    if status:
        q = q.filter(Lead.status == status)
    if priority:
        q = q.filter(Lead.priority_label == priority)
    if lead_type:
        q = q.filter(Lead.lead_type == lead_type)
    if channel:
        try:
            validate_channel(channel)
        except ValueError as e:
            raise HTTPException(status_code=422, detail=str(e))
        q = q.filter(channel_predicate(Lead, channel))

    total = q.count()
    leads = (
        q.order_by(Lead.created_at.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
        .all()
    )

    return LeadListResponse(
        total=total,
        page=page,
        per_page=per_page,
        leads=[LeadListOut.model_validate(l) for l in leads],
    )


# ─── GET /api/leads/:id ───────────────────────────────────────────────────────

@router.get("/{lead_id:int}", response_model=LeadOut, summary="Get single lead with recommendations")
def get_lead(
    lead_id: int,
    ctx: Dict[str, Any] = Depends(require_staff),
    db: Session = Depends(get_db),
):
    assert_lead_access(db, ctx, lead_id)
    return _load_lead(lead_id, db)


# ─── PATCH /api/leads/:id ─────────────────────────────────────────────────────

@router.patch("/{lead_id:int}", response_model=LeadOut, summary="Update lead fields")
def update_lead(
    lead_id: int,
    payload: LeadUpdate,
    ctx: Dict[str, Any] = Depends(require_staff),
    db: Session = Depends(get_db),
):
    assert_lead_access(db, ctx, lead_id)
    lead = db.query(Lead).filter(Lead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(lead, field, value)

    # Re-score if requirements changed
    req = {
        "budget_max": lead.budget_max, "budget_min": lead.budget_min,
        "location": lead.location, "property_type": lead.property_type,
        "bedrooms": lead.bedrooms, "lead_type": lead.lead_type,
        "timeline_days": lead.timeline_days, "amenities": lead.amenities or [],
        "purpose": lead.purpose,
    }
    score = calculate_score(req)
    lead.priority_score = score["total"]
    lead.priority_label = score["label"]
    lead.score_breakdown = score

    db.commit()
    log_activity(lead_id, "note_added", f"Lead details updated by agent.", db)
    return _load_lead(lead_id, db)


# ─── PATCH /api/leads/:id/status ──────────────────────────────────────────────

@router.patch("/{lead_id:int}/status", response_model=LeadOut, summary="Update lead status")
def update_status(
    lead_id: int,
    payload: LeadStatusUpdate,
    ctx: Dict[str, Any] = Depends(require_staff),
    db: Session = Depends(get_db),
):
    assert_lead_access(db, ctx, lead_id)
    lead = db.query(Lead).filter(Lead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    old_status = lead.status
    lead.status = payload.status
    db.commit()
    log_activity(
        lead_id, "status_changed",
        f"Status changed: {old_status} → {payload.status}. {payload.notes or ''}",
        db
    )
    return _load_lead(lead_id, db)


# ─── POST /api/leads/:id/recommendations ──────────────────────────────────────

@router.post("/{lead_id:int}/recommendations", response_model=LeadOut, summary="Run/refresh property matching")
def refresh_recommendations(
    lead_id: int,
    ctx: Dict[str, Any] = Depends(require_staff),
    db: Session = Depends(get_db),
):
    assert_lead_access(db, ctx, lead_id)
    lead = db.query(Lead).filter(Lead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    matches = match_properties(lead, db)
    # Always persist the fresh result — including an empty list. Skipping
    # the save on empty (the old behaviour) left previously stored rows in
    # place, so stale cross-location cards kept rendering after the
    # location gate started returning []. save_recommendations deletes
    # existing rows first, so this both replaces and clears correctly.
    save_recommendations(lead, matches, db)
    if matches:
        nearby_n = sum(1 for m in matches if m.get("is_nearby"))
        if nearby_n:
            log_activity(lead_id, "recommendation_sent",
                         f"{len(matches)} properties recommended "
                         f"({nearby_n} nearby alternative(s) — "
                         f"no exact match in {lead.location}).", db)
        else:
            log_activity(lead_id, "recommendation_sent",
                         f"{len(matches)} properties matched and recommended.", db)
    else:
        log_activity(lead_id, "recommendation_sent",
                     "No matching properties found with current criteria.", db)

    return _load_lead(lead_id, db)


# ─── GET /api/dashboard ───────────────────────────────────────────────────────

@router.get("/stats/dashboard", response_model=DashboardStats, summary="Dashboard statistics")
def get_dashboard(
    ctx: Dict[str, Any] = Depends(require_staff),
    db: Session = Depends(get_db),
):
    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)

    total_leads = db.query(func.count(Lead.id)).scalar() or 0
    new_today = db.query(func.count(Lead.id)).filter(Lead.created_at >= today_start).scalar() or 0
    high_priority = db.query(func.count(Lead.id)).filter(Lead.priority_label == "High").scalar() or 0
    medium_priority = db.query(func.count(Lead.id)).filter(Lead.priority_label == "Medium").scalar() or 0
    low_priority = db.query(func.count(Lead.id)).filter(Lead.priority_label == "Low").scalar() or 0

    status_rows = db.query(Lead.status, func.count(Lead.id)).group_by(Lead.status).all()
    status_counts = {row[0]: row[1] for row in status_rows}

    recent_acts = (
        db.query(Activity)
        .order_by(Activity.created_at.desc())
        .limit(10)
        .all()
    )

    return DashboardStats(
        total_leads=total_leads,
        new_today=new_today,
        high_priority=high_priority,
        medium_priority=medium_priority,
        low_priority=low_priority,
        status_counts=status_counts,
        recent_activities=[ActivityOut.model_validate(a) for a in recent_acts],
    )


# ─── Helper ───────────────────────────────────────────────────────────────────

def _load_lead(lead_id: int, db: Session) -> LeadOut:
    lead = (
        db.query(Lead)
        .options(
            joinedload(Lead.recommendations).joinedload(Recommendation.property),
            joinedload(Lead.activities),
        )
        .filter(Lead.id == lead_id)
        .first()
    )
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    return LeadOut.model_validate(lead)
