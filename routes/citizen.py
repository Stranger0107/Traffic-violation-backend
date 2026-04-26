"""
routes/citizen.py
─────────────────
Endpoints available to logged-in citizens:

  GET  /citizen/my-challans         – all issued challans for their plate
  GET  /citizen/challan/{id}        – single challan detail
  POST /citizen/grievance           – raise a grievance against a challan
  GET  /citizen/grievance/{id}      – check grievance status
"""

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database.connection import get_db
from models.user import User
from utils.auth import require_citizen
from services.citizen_service import (
    get_my_challans,
    get_challan_by_id,
    submit_grievance,
    get_grievance_by_id,
)

router = APIRouter(prefix="/citizen", tags=["Citizen"])


# ── My Challans ───────────────────────────────────────────────────────────────

@router.get("/my-challans", summary="View all issued challans linked to your vehicle")
def my_challans(
    db:           Session = Depends(get_db),
    current_user: User    = Depends(require_citizen),
):
    """Returns all challans in `issued` status for the citizen's registered plate."""
    return get_my_challans(db, current_user)


@router.get("/challan/{challan_id}", summary="View a single challan by ID")
def challan_detail(
    challan_id:   int,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(require_citizen),
):
    """Fetch one challan.  Citizens can only see their own challans."""
    return get_challan_by_id(db, challan_id, current_user)


# ── Grievances ────────────────────────────────────────────────────────────────

class GrievanceRequest(BaseModel):
    challan_id: int
    reason:     str


@router.post("/grievance", summary="Raise a grievance against an issued challan")
def raise_grievance(
    payload:      GrievanceRequest,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(require_citizen),
):
    """
    Dispute a challan you believe was issued incorrectly.
    The challan moves to `contested` status until an admin resolves the grievance.
    """
    return submit_grievance(db, current_user, payload.challan_id, payload.reason)


@router.get("/grievance/{grievance_id}", summary="Check the status of a grievance")
def grievance_status(
    grievance_id: int,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(require_citizen),
):
    """Returns the current status and admin remark for a specific grievance."""
    return get_grievance_by_id(db, grievance_id, current_user)
