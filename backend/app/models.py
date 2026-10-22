"""
SQLAlchemy ORM models for the LYKA Realty CRM system.
Models: Lead, CRMProperty, Recommendation, Activity
"""
import json
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import (
    Boolean, Column, DateTime, Float, ForeignKey,
    Integer, String, Text, JSON
)
from sqlalchemy.orm import relationship

from app.database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class CRMProperty(Base):
    """
    Fictional Dubai properties for the CRM seed dataset.
    Separate from the CSV-backed search used by the public site.
    """
    __tablename__ = "crm_properties"

    id = Column(Integer, primary_key=True, index=True)
    ref_code = Column(String(20), unique=True, nullable=False, index=True)
    title = Column(String(255), nullable=False)
    property_type = Column(String(50), nullable=False)  # Apartment, Villa, Penthouse, Townhouse
    listing_type = Column(String(10), nullable=False)   # Sale | Rent
    location = Column(String(100), nullable=False, index=True)
    community = Column(String(100), nullable=True)
    bedrooms = Column(Integer, nullable=False)
    bathrooms = Column(Integer, nullable=False)
    size_sqft = Column(Integer, nullable=False)
    price_sale = Column(Float, nullable=True)           # AED
    price_rent_monthly = Column(Float, nullable=True)  # AED/month
    description = Column(Text, nullable=True)
    amenities = Column(JSON, default=list)              # List[str]
    near_metro = Column(Boolean, default=False)
    near_beach = Column(Boolean, default=False)
    view = Column(String(100), nullable=True)
    is_available = Column(Boolean, default=True)
    image_url = Column(String(500), nullable=True)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    recommendations = relationship("Recommendation", back_populates="property")


class Lead(Base):
    """Customer enquiry lead with AI-extracted requirements and scoring."""
    __tablename__ = "leads"

    id = Column(Integer, primary_key=True, index=True)

    # Contact info
    customer_name = Column(String(200), nullable=True)
    contact_email = Column(String(200), nullable=True, index=True)
    contact_phone = Column(String(50), nullable=True)

    # Property requirements (AI-extracted)
    lead_type = Column(String(10), nullable=True)        # buyer | renter
    property_type = Column(String(50), nullable=True)
    location = Column(String(100), nullable=True, index=True)
    bedrooms = Column(Integer, nullable=True)
    budget_min = Column(Float, nullable=True)
    budget_max = Column(Float, nullable=True)
    purpose = Column(String(100), nullable=True)         # investment, own-use
    amenities = Column(JSON, default=list)               # List[str]
    timeline_days = Column(Integer, nullable=True)
    missing_fields = Column(JSON, default=list)          # List[str]

    # Scoring
    priority_score = Column(Integer, default=0)
    priority_label = Column(String(10), default="Low")   # High | Medium | Low
    score_breakdown = Column(JSON, default=dict)          # {criterion: points}

    # Workflow
    status = Column(String(20), default="new", index=True)
    # new | contacted | qualified | closed | lost

    # Raw data
    raw_enquiry_text = Column(Text, nullable=False)
    agent_notes = Column(Text, nullable=True)

    # Lead source (UTM + referrer captured at enquiry time; all nullable —
    # absent attribution stays NULL, never invented).
    utm_source = Column(String(255), nullable=True)
    utm_medium = Column(String(255), nullable=True)
    utm_campaign = Column(String(255), nullable=True)
    referrer = Column(String(500), nullable=True)
    # Self-reported discovery source ("How did you hear about LYKA
    # Realty?"). Stored separately from automatic UTM/referrer attribution;
    # never guessed, never defaulted.
    discovery_source = Column(String(50), nullable=True)

    created_at = Column(DateTime, default=utcnow, index=True)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    recommendations = relationship(
        "Recommendation", back_populates="lead",
        cascade="all, delete-orphan",
        order_by="Recommendation.match_score.desc()"
    )
    activities = relationship(
        "Activity", back_populates="lead",
        cascade="all, delete-orphan",
        order_by="Activity.created_at.desc()"
    )


class Recommendation(Base):
    """Property recommendation generated for a lead."""
    __tablename__ = "recommendations"

    id = Column(Integer, primary_key=True, index=True)
    lead_id = Column(Integer, ForeignKey("leads.id", ondelete="CASCADE"), nullable=False, index=True)
    property_id = Column(Integer, ForeignKey("crm_properties.id"), nullable=False, index=True)
    match_score = Column(Float, nullable=False)          # 0.0 – 100.0
    match_explanation = Column(Text, nullable=True)
    mismatches = Column(JSON, default=list)              # List[str]
    # True when this row is a nearby-community alternative (not an exact
    # location match). The UI renders a "Nearby alternative" label for it.
    is_nearby = Column(Boolean, default=False)
    created_at = Column(DateTime, default=utcnow)

    lead = relationship("Lead", back_populates="recommendations")
    property = relationship("CRMProperty", back_populates="recommendations")


class Activity(Base):
    """Follow-up activities logged against a lead."""
    __tablename__ = "activities"

    id = Column(Integer, primary_key=True, index=True)
    lead_id = Column(Integer, ForeignKey("leads.id", ondelete="CASCADE"), nullable=False, index=True)
    activity_type = Column(String(50), nullable=False)
    # enquiry_received | ai_analysed | agent_contacted | recommendation_sent |
    # note_added | status_changed | property_viewed
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=utcnow, index=True)

    lead = relationship("Lead", back_populates="activities")


# ─── Staff & roles (PRD: exactly one Admin + Manager, Sales Manager, Salesperson) ──
# Customers are Firebase Auth users and are NOT rows here: any verified email
# without an active staff row resolves to role "customer". The single-admin
# invariant is enforced in code (routers/staff.py + create_admin.py), because
# SQLite has no portable partial-unique constraint.

STAFF_ROLES = ("admin", "manager", "sales_manager", "salesperson")


class StaffUser(Base):
    """Internal team member. Role determines backend permissions (see services/roles.py)."""
    __tablename__ = "staff_users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(200), unique=True, nullable=False, index=True)
    # Stable Firebase UID, bound automatically on the staff member's first
    # verified sign-in. Identity resolution prefers UID and falls back to
    # email, so records survive email changes.
    firebase_uid = Column(String(128), unique=True, nullable=True, index=True)
    name = Column(String(200), nullable=False)
    role = Column(String(20), nullable=False, index=True)
    # admin | manager | sales_manager | salesperson
    is_active = Column(Boolean, default=True, nullable=False)
    # Direct manager's staff email (team relationship). Used to scope a
    # sales manager to their authorized team. Null = no team assignment.
    manager_email = Column(String(200), nullable=True, index=True)
    last_login_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)


class Assignment(Base):
    """Lead routed to a staff member by a manager (or admin)."""
    __tablename__ = "assignments"

    id = Column(Integer, primary_key=True, index=True)
    lead_id = Column(Integer, ForeignKey("leads.id", ondelete="CASCADE"), nullable=False, index=True)
    staff_email = Column(String(200), nullable=False, index=True)
    # Stable assignee UID snapshot (null for rows created before UID binding).
    staff_uid = Column(String(128), nullable=True, index=True)
    assigned_by = Column(String(200), nullable=False)
    status = Column(String(20), default="open", nullable=False)
    # open | in_progress | closed
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)


class CustomerProfile(Base):
    """Self-service customer profile, owned by exactly one Firebase UID.

    Identity (firebase_uid, email) always comes from the verified token —
    never from request bodies. Permitted self-service fields only; role is
    resolved via staff rows (non-staff => customer) and is never stored
    or accepted here. Acquisition attribution uses first-touch-wins.
    """
    __tablename__ = "customer_profiles"

    id = Column(Integer, primary_key=True, index=True)
    firebase_uid = Column(String(128), unique=True, nullable=False, index=True)
    email = Column(String(200), nullable=True, index=True)
    name = Column(String(200), nullable=True)
    phone = Column(String(50), nullable=True)
    city = Column(String(100), nullable=True)
    # Customer country (optional, self-reported; additive nullable column).
    country = Column(String(100), nullable=True)
    preferences = Column(JSON, default=dict)
    # {locations, propertyType, bedrooms, budgetMin, budgetMax, purpose,
    #  timeline_days}
    utm_source = Column(String(255), nullable=True)
    utm_medium = Column(String(255), nullable=True)
    utm_campaign = Column(String(255), nullable=True)
    referrer = Column(String(500), nullable=True)
    # Self-reported discovery source ("How did you hear about LYKA
    # Realty?"). Separate from automatic UTM/referrer attribution and
    # governed by first-touch-wins in routers/customer.py.
    discovery_source = Column(String(50), nullable=True)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)


class FollowUp(Base):
    """Immutable follow-up note on a lead (append-only history)."""
    __tablename__ = "follow_ups"

    id = Column(Integer, primary_key=True, index=True)
    lead_id = Column(Integer, ForeignKey("leads.id", ondelete="CASCADE"), nullable=False, index=True)
    staff_email = Column(String(200), nullable=False, index=True)
    staff_uid = Column(String(128), nullable=True, index=True)
    note = Column(Text, nullable=False)
    next_action_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=utcnow, index=True)


class Viewing(Base):
    """Scheduled property viewing for a lead."""
    __tablename__ = "viewings"

    id = Column(Integer, primary_key=True, index=True)
    lead_id = Column(Integer, ForeignKey("leads.id", ondelete="CASCADE"), nullable=False, index=True)
    property_ref = Column(String(20), nullable=False)
    # CRM ref_code (CRM-*) or CSV property_id (LYK-*) — always a real record.
    staff_email = Column(String(200), nullable=False, index=True)
    staff_uid = Column(String(128), nullable=True, index=True)
    scheduled_at = Column(DateTime, nullable=False, index=True)
    status = Column(String(20), default="scheduled", nullable=False)
    # scheduled | completed | cancelled | no_show
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)
