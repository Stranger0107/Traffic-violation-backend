"""
services/citizen_service.py
───────────────────────────
Business logic for Citizen-facing APIs:
  - View own issued challans (matched by plate_number linked to the citizen's account)
  - View a single challan detail
  - Submit a grievance
  - View grievance status
"""

from sqlalchemy.orm import Session
from fastapi import HTTPException

from models.user import User
from models.violation import Violation, ViolationStatus
from models.grievance import Grievance, GrievanceStatus
from utils.response import format_challan


# ─── Helper: resolve the citizen's plate number ───────────────────────────────

def _get_citizen_plate(db: Session, user: User) -> str:
    """
    Fetch the plate number linked to the logged-in citizen.

    Assumption: your existing `vehicles` table has a `owner_username` (or FK)
    column that maps a citizen user to their vehicle.  Adjust the query below
    to match your actual schema.

    For now we store the plate on the User model via a `plate_number` attribute.
    If it doesn't exist, raise a clean error so the citizen knows to register
    their vehicle first.
    """
    plate = getattr(user, "plate_number", None)
    if not plate:
        raise HTTPException(
            status_code=400,
            detail="No vehicle registered to this account. Please link your vehicle first.",
        )
    return plate


# ─── My Challans ──────────────────────────────────────────────────────────────

def get_my_challans(db: Session, user: User) -> list[dict]:
    """Return all *issued* challans that belong to this citizen's plate."""
    plate = _get_citizen_plate(db, user)

    rows = (
        db.query(Violation)
        .filter(
            Violation.plate_number == plate,
            Violation.status == ViolationStatus.issued,
        )
        .order_by(Violation.timestamp.desc())
        .all()
    )
    return [format_challan(v, owner_name=user.username) for v in rows]


def get_my_grievances(db: Session, user: User) -> list[dict]:
    """Return all grievances raised by the citizen, newest first."""
    plate = _get_citizen_plate(db, user)

    rows = (
        db.query(Grievance)
        .filter(Grievance.plate_number == plate)
        .order_by(Grievance.created_at.desc())
        .all()
    )
    return [_format_grievance(g, db) for g in rows]


def get_challan_by_id(db: Session, challan_id: int, user: User) -> dict:
    """Return a single challan – citizen can only see their own."""
    plate     = _get_citizen_plate(db, user)
    violation = db.query(Violation).filter(Violation.id == challan_id).first()

    if not violation:
        raise HTTPException(status_code=404, detail="Challan not found")

    if violation.plate_number != plate:
        raise HTTPException(status_code=403, detail="Access denied – this challan is not yours")

    return format_challan(violation, owner_name=user.username)


# ─── Grievances ───────────────────────────────────────────────────────────────

def submit_grievance(db: Session, user: User, challan_id: int, reason: str) -> dict:
    """
    A citizen raises a grievance against an issued challan.

    Rules:
    - Challan must exist and be in `issued` status.
    - Challan must belong to the citizen.
    - A duplicate grievance (same violation_id) is rejected.
    """
    plate     = _get_citizen_plate(db, user)
    violation = db.query(Violation).filter(Violation.id == challan_id).first()

    if not violation:
        raise HTTPException(status_code=404, detail="Challan not found")

    if violation.plate_number != plate:
        raise HTTPException(status_code=403, detail="This challan does not belong to your account")

    if violation.status != ViolationStatus.issued:
        raise HTTPException(
            status_code=400,
            detail=f"Only 'issued' challans can be contested. Current status: {violation.status}",
        )

    # Prevent duplicate grievances
    existing = db.query(Grievance).filter(Grievance.violation_id == challan_id).first()
    if existing:
        raise HTTPException(status_code=409, detail="A grievance for this challan already exists")

    grievance = Grievance(
        violation_id = challan_id,
        plate_number = plate,
        reason       = reason,
        status       = GrievanceStatus.open,
    )
    db.add(grievance)

    # Move challan to contested so officers / admins know it's under dispute
    violation.status = ViolationStatus.contested

    db.commit()
    db.refresh(grievance)

    return _format_grievance(grievance)


def get_grievance_by_id(db: Session, grievance_id: int, user: User) -> dict:
    """Citizen can only view their own grievances."""
    plate     = _get_citizen_plate(db, user)
    grievance = db.query(Grievance).filter(Grievance.id == grievance_id).first()

    if not grievance:
        raise HTTPException(status_code=404, detail="Grievance not found")

    if grievance.plate_number != plate:
        raise HTTPException(status_code=403, detail="Access denied – this grievance is not yours")

    return _format_grievance(grievance)


# ─── Internal formatter ───────────────────────────────────────────────────────

def _format_grievance(g: Grievance, db: Session | None = None) -> dict:
    violation = None
    if db is not None:
        violation = db.query(Violation).filter(Violation.id == g.violation_id).first()

    return {
        "id":           g.id,
        "violation_id": g.violation_id,
        "plate_number": g.plate_number,
        "reason":       g.reason,
        "status":       g.status,
        "admin_remark": g.admin_remark,
        "created_at":   g.created_at.strftime("%Y-%m-%dT%H:%M:%SZ") if g.created_at else None,
        "challan": {
            "id": violation.id,
            "plate_number": violation.plate_number,
            "violation": violation.violation_type,
            "fine": violation.fine,
            "status": violation.status,
            "timestamp": violation.timestamp.strftime("%Y-%m-%dT%H:%M:%SZ") if violation and violation.timestamp else None,
        } if violation else None,
    }
