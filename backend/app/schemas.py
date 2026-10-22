"""
Pydantic schemas for request/response validation.
"""
from datetime import datetime
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field, EmailStr, field_validator


# ─── Self-reported discovery source ─────────────────────────────────────────
# Canonical "How did you hear about LYKA Realty?" options. Kept separate
# from automatic UTM/referrer attribution; absent stays None, never guessed.

DISCOVERY_SOURCES = (
    "Google",
    "Instagram",
    "Facebook",
    "Friend/Referral",
    "Direct Website",
    "Other/Unknown",
)


def _validate_discovery_source(v: Optional[str]) -> Optional[str]:
    if v is None:
        return None
    t = v.strip()
    if not t:
        return None
    if t not in DISCOVERY_SOURCES:
        raise ValueError(
            "discovery_source must be one of: " + ", ".join(DISCOVERY_SOURCES)
        )
    return t


# ─── Analyse ──────────────────────────────────────────────────────────────────

class AnalyseRequest(BaseModel):
    enquiry_text: str = Field(..., min_length=10, max_length=5000)

class ScoreBreakdown(BaseModel):
    budget: int = 0
    location: int = 0
    property_type_bedrooms: int = 0
    intent: int = 0
    timeline: int = 0
    preferences: int = 0
    total: int = 0
    label: str = "Low"
    reasoning: List[str] = []

class ExtractedRequirements(BaseModel):
    customer_name: Optional[str] = None
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    lead_type: Optional[str] = None        # buyer | renter
    property_type: Optional[str] = None
    location: Optional[str] = None
    bedrooms: Optional[int] = None
    budget_min: Optional[int] = None
    budget_max: Optional[int] = None
    purpose: Optional[str] = None
    amenities: List[str] = []
    timeline_days: Optional[int] = None
    missing_fields: List[str] = []

class AnalyseResponse(BaseModel):
    requirements: ExtractedRequirements
    score: ScoreBreakdown
    suggestions: List[str] = []


# ─── Properties ───────────────────────────────────────────────────────────────

class PropertyCreate(BaseModel):
    ref_code: str
    title: str
    property_type: str
    listing_type: str   # Sale | Rent
    location: str
    community: Optional[str] = None
    bedrooms: int
    bathrooms: int
    size_sqft: int
    price_sale: Optional[float] = None
    price_rent_monthly: Optional[float] = None
    description: Optional[str] = None
    amenities: List[str] = []
    near_metro: bool = False
    near_beach: bool = False
    view: Optional[str] = None
    is_available: bool = True
    image_url: Optional[str] = None

class PropertyUpdate(BaseModel):
    title: Optional[str] = None
    listing_type: Optional[str] = None
    price_sale: Optional[float] = None
    price_rent_monthly: Optional[float] = None
    description: Optional[str] = None
    amenities: Optional[List[str]] = None
    is_available: Optional[bool] = None
    image_url: Optional[str] = None

class PropertyOut(PropertyCreate):
    id: int
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}


# ─── Leads ────────────────────────────────────────────────────────────────────

class LeadCreate(BaseModel):
    raw_enquiry_text: str = Field(..., min_length=10, max_length=5000)
    # Optional pre-filled from analyse step
    customer_name: Optional[str] = None
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    lead_type: Optional[str] = None
    property_type: Optional[str] = None
    location: Optional[str] = None
    bedrooms: Optional[int] = None
    budget_min: Optional[float] = None
    budget_max: Optional[float] = None
    purpose: Optional[str] = None
    amenities: List[str] = []
    timeline_days: Optional[int] = None
    missing_fields: List[str] = []
    priority_score: int = 0
    priority_label: str = "Low"
    score_breakdown: Dict[str, Any] = {}

class LeadUpdate(BaseModel):
    customer_name: Optional[str] = None
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    lead_type: Optional[str] = None
    property_type: Optional[str] = None
    location: Optional[str] = None
    bedrooms: Optional[int] = None
    budget_min: Optional[float] = None
    budget_max: Optional[float] = None
    purpose: Optional[str] = None
    amenities: Optional[List[str]] = None
    timeline_days: Optional[int] = None
    agent_notes: Optional[str] = None

class LeadStatusUpdate(BaseModel):
    status: str = Field(..., pattern="^(new|contacted|qualified|closed|lost)$")
    notes: Optional[str] = None

class RecommendationOut(BaseModel):
    id: int
    property_id: int
    match_score: float
    match_explanation: str
    mismatches: List[str]
    is_nearby: bool = False
    property: PropertyOut
    model_config = {"from_attributes": True}

class ActivityOut(BaseModel):
    id: int
    activity_type: str
    notes: Optional[str] = None
    created_at: datetime
    model_config = {"from_attributes": True}

class LeadOut(BaseModel):
    id: int
    customer_name: Optional[str]
    contact_email: Optional[str]
    contact_phone: Optional[str]
    lead_type: Optional[str]
    property_type: Optional[str]
    location: Optional[str]
    bedrooms: Optional[int]
    budget_min: Optional[float]
    budget_max: Optional[float]
    purpose: Optional[str]
    amenities: List[str]
    timeline_days: Optional[int]
    missing_fields: List[str]
    priority_score: int
    priority_label: str
    score_breakdown: Dict[str, Any]
    status: str
    raw_enquiry_text: str
    agent_notes: Optional[str]
    utm_source: Optional[str] = None
    utm_medium: Optional[str] = None
    utm_campaign: Optional[str] = None
    referrer: Optional[str] = None
    discovery_source: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    recommendations: List[RecommendationOut] = []
    activities: List[ActivityOut] = []
    model_config = {"from_attributes": True}

class LeadListOut(BaseModel):
    id: int
    customer_name: Optional[str]
    contact_email: Optional[str]
    lead_type: Optional[str]
    location: Optional[str]
    priority_score: int
    priority_label: str
    status: str
    created_at: datetime
    utm_source: Optional[str] = None
    utm_medium: Optional[str] = None
    utm_campaign: Optional[str] = None
    referrer: Optional[str] = None
    discovery_source: Optional[str] = None
    model_config = {"from_attributes": True}

class LeadListResponse(BaseModel):
    total: int
    page: int
    per_page: int
    leads: List[LeadListOut]


# ─── Public website enquiry (no staff auth) ─────────────────────────────────

class PublicEnquiryCreate(BaseModel):
    """Anonymous customer enquiry from the public site (PropertyModal /
    ContactConsultation). Saved as a Lead row in the SAME `leads` table
    used by the CRM so Admin → Leads lists it immediately."""

    customer_name: str = Field(..., min_length=1, max_length=200)
    contact_email: EmailStr
    contact_phone: Optional[str] = Field(None, max_length=50)
    property_ref: Optional[str] = Field(None, max_length=50)
    property_title: Optional[str] = Field(None, max_length=255)
    location: Optional[str] = Field(None, max_length=100)
    lead_type: Optional[str] = Field(None, pattern="^(buyer|renter)$")
    property_type: Optional[str] = Field(None, max_length=50)
    # Optional customer-stated requirements. Never defaulted/invented:
    # absent stays None and scores 0 for that criterion.
    bedrooms: Optional[int] = Field(None, ge=0, le=20)
    budget_min: Optional[float] = Field(None, ge=0)
    budget_max: Optional[float] = Field(None, ge=0)
    timeline_days: Optional[int] = Field(None, ge=0, le=3650)
    message: Optional[str] = Field(None, max_length=2000)
    preferred_date: Optional[str] = Field(None, max_length=50)
    # Lead-source attribution (UTM + referrer); all optional, never invented.
    utm_source: Optional[str] = Field(None, max_length=255)
    utm_medium: Optional[str] = Field(None, max_length=255)
    utm_campaign: Optional[str] = Field(None, max_length=255)
    referrer: Optional[str] = Field(None, max_length=500)
    # Self-reported discovery source ("How did you hear about LYKA
    # Realty?"). Optional, allowlisted, stored separately from UTM data.
    discovery_source: Optional[str] = Field(None, max_length=50)

    @field_validator("discovery_source")
    @classmethod
    def discovery_must_be_listed(cls, v: Optional[str]) -> Optional[str]:
        return _validate_discovery_source(v)


# ─── Dashboard ────────────────────────────────────────────────────────────────

class DashboardStats(BaseModel):
    total_leads: int
    new_today: int
    high_priority: int
    medium_priority: int
    low_priority: int
    status_counts: Dict[str, int]
    recent_activities: List[ActivityOut]


# ─── Customer portal (self-service profile, UID-owned) ────────────────────────

class CustomerPreferences(BaseModel):
    locations: List[str] = []
    propertyType: Optional[str] = None
    bedrooms: Optional[int] = None
    budgetMin: Optional[float] = None
    budgetMax: Optional[float] = None
    purpose: Optional[str] = None
    # Expected buying/renting timeline in days (optional; absent stays None
    # and is never invented). Lives inside the JSON preferences column, so
    # no table migration is needed for it.
    timeline_days: Optional[int] = Field(None, ge=0, le=3650)


class CustomerProfileUpdate(BaseModel):
    """Permitted self-service fields only. No email (token-owned), no role."""
    name: str = Field(..., min_length=1, max_length=200)
    phone: Optional[str] = Field(None, max_length=50)
    city: Optional[str] = Field(None, max_length=100)
    country: Optional[str] = Field(None, max_length=100)
    preferences: CustomerPreferences = CustomerPreferences()
    utm_source: Optional[str] = Field(None, max_length=255)
    utm_medium: Optional[str] = Field(None, max_length=255)
    utm_campaign: Optional[str] = Field(None, max_length=255)
    referrer: Optional[str] = Field(None, max_length=500)
    discovery_source: Optional[str] = Field(None, max_length=50)

    @field_validator("name")
    @classmethod
    def name_must_be_nonblank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Name must not be blank.")
        return v

    @field_validator("discovery_source")
    @classmethod
    def discovery_must_be_listed(cls, v: Optional[str]) -> Optional[str]:
        return _validate_discovery_source(v)


class CustomerProfileOut(BaseModel):
    firebase_uid: str
    email: Optional[str]
    name: Optional[str]
    phone: Optional[str]
    city: Optional[str]
    country: Optional[str]
    preferences: Dict[str, Any] = {}
    utm_source: Optional[str] = None
    utm_medium: Optional[str] = None
    utm_campaign: Optional[str] = None
    referrer: Optional[str] = None
    discovery_source: Optional[str] = None
    role: str
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}


# ─── Staff & roles ────────────────────────────────────────────────────────────

class StaffCreate(BaseModel):
    email: EmailStr
    name: str = Field(..., min_length=1, max_length=200)
    role: str = Field(..., pattern="^(admin|manager|sales_manager|salesperson)$")
    manager_email: Optional[EmailStr] = None


class StaffUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    role: Optional[str] = Field(None, pattern="^(admin|manager|sales_manager|salesperson)$")
    is_active: Optional[bool] = None
    manager_email: Optional[EmailStr] = None


class StaffOut(BaseModel):
    id: int
    email: str
    firebase_uid: Optional[str] = None
    name: str
    role: str
    is_active: bool
    manager_email: Optional[str] = None
    last_login_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}


class AssignmentCreate(BaseModel):
    lead_id: int
    staff_email: EmailStr


class AssignmentUpdate(BaseModel):
    status: str = Field(..., pattern="^(open|in_progress|closed)$")


class AssignmentOut(BaseModel):
    id: int
    lead_id: int
    staff_email: str
    staff_uid: Optional[str] = None
    assigned_by: str
    status: str
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}


class FollowUpCreate(BaseModel):
    lead_id: int
    note: str = Field(..., min_length=1, max_length=2000)
    next_action_at: Optional[datetime] = None


class FollowUpOut(BaseModel):
    id: int
    lead_id: int
    staff_email: str
    staff_uid: Optional[str] = None
    note: str
    next_action_at: Optional[datetime]
    created_at: datetime
    model_config = {"from_attributes": True}


class ViewingCreate(BaseModel):
    lead_id: int
    property_ref: str = Field(..., min_length=1, max_length=20)
    scheduled_at: datetime


class ViewingUpdate(BaseModel):
    scheduled_at: Optional[datetime] = None
    status: Optional[str] = Field(None, pattern="^(scheduled|completed|cancelled|no_show)$")
    notes: Optional[str] = Field(None, max_length=2000)


class ViewingOut(BaseModel):
    id: int
    lead_id: int
    property_ref: str
    staff_email: str
    staff_uid: Optional[str] = None
    scheduled_at: datetime
    status: str
    notes: Optional[str]
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}
