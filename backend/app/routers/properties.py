"""
Property management REST endpoints (staff only — enforced on the backend).
"""
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import CRMProperty
from app.schemas import PropertyCreate, PropertyOut, PropertyUpdate
from app.services.roles import require_roles, require_staff

router = APIRouter(prefix="/api/properties", tags=["properties"])

# Property catalogue reads: any staff. Writes: admin + manager only
# (sales managers distribute leads; salespeople work assignments).
require_property_write = require_roles("admin", "manager")


# ─── GET /api/properties ──────────────────────────────────────────────────────

@router.get("", response_model=List[PropertyOut], summary="List CRM properties")
def list_properties(
    location: Optional[str] = Query(None),
    listing_type: Optional[str] = Query(None),
    bedrooms: Optional[int] = Query(None),
    available_only: bool = Query(True),
    ctx: Dict[str, Any] = Depends(require_staff),
    db: Session = Depends(get_db),
):
    q = db.query(CRMProperty)
    if available_only:
        q = q.filter(CRMProperty.is_available == True)  # noqa: E712
    if location:
        q = q.filter(CRMProperty.location.ilike(f"%{location}%"))
    if listing_type:
        q = q.filter(CRMProperty.listing_type == listing_type)
    if bedrooms is not None:
        q = q.filter(CRMProperty.bedrooms == bedrooms)
    return q.order_by(CRMProperty.location, CRMProperty.bedrooms).all()


# ─── POST /api/properties ─────────────────────────────────────────────────────

@router.post("", response_model=PropertyOut, status_code=201, summary="Add property (admin/manager)")
def create_property(
    payload: PropertyCreate,
    ctx: Dict[str, Any] = Depends(require_property_write),
    db: Session = Depends(get_db),
):
    existing = db.query(CRMProperty).filter(CRMProperty.ref_code == payload.ref_code).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"Property {payload.ref_code} already exists.")

    prop = CRMProperty(**payload.model_dump())
    db.add(prop)
    db.commit()
    db.refresh(prop)
    return prop


# ─── PATCH /api/properties/:id ────────────────────────────────────────────────

@router.patch("/{prop_id:int}", response_model=PropertyOut, summary="Update property (admin/manager)")
def update_property(
    prop_id: int,
    payload: PropertyUpdate,
    ctx: Dict[str, Any] = Depends(require_property_write),
    db: Session = Depends(get_db),
):
    prop = db.query(CRMProperty).filter(CRMProperty.id == prop_id).first()
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found.")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(prop, field, value)

    db.commit()
    db.refresh(prop)
    return prop


# ─── GET /api/properties/:id ──────────────────────────────────────────────────
# NOTE: the `:int` converter is load-bearing. Without it this route also
# matches GET /api/properties/search (prop_id="search"), which shadows the
# real dataset-search endpoint registered in app/main.py and fails with
# HTTP 422 (int_parsing on path prop_id). With `:int`, non-integer paths
# fall through to the search handler.

@router.get("/{prop_id:int}", response_model=PropertyOut, summary="Get single property")
def get_property(
    prop_id: int,
    ctx: Dict[str, Any] = Depends(require_staff),
    db: Session = Depends(get_db),
):
    prop = db.query(CRMProperty).filter(CRMProperty.id == prop_id).first()
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found.")
    return prop
