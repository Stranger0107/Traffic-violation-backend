"""
services/admin_service.py
─────────────────────────
Business logic for Admin-facing APIs:
  - View all system violations
  - View all open grievances
  - Resolve a grievance (approve → challan invalidated | reject → challan re-issued)
"""

from sqlalchemy.orm import Session
from fastapi import HTTPException

from models.violation import Violation, ViolationStatus
from models.grievance import Grievance, GrievanceStatus
from utils.response import format_challan


def get_all_violations(db: Session) -> list[dict]:
    """Return every violation in the system, newest first."""
    rows = db.query(Violation).order_by(Violation.timestamp.desc()).all()
    return [format_challan(v) for v in rows]


def get_all_grievances(db: Session) -> list[dict]:
    """Return all open grievances pending admin review."""
    rows = (
        db.query(Grievance)
        .filter(Grievance.status == GrievanceStatus.open)
        .order_by(Grievance.created_at.desc())
        .all()
    )
    return [_format_grievance(g) for g in rows]


def resolve_grievance(
    db:           Session,
    grievance_id: int,
    action:       str,
    admin_remark: str = "",
) -> dict:
    """
    action = "approve"  →  grievance.status = approved,  violation.status = invalidated
    action = "reject"   →  grievance.status = rejected,  violation.status = issued  (challan stands)
    """
    action = action.lower()
    if action not in ("approve", "reject"):
        raise HTTPException(status_code=400, detail="Action must be 'approve' or 'reject'")

    grievance: Grievance | None = db.query(Grievance).filter(Grievance.id == grievance_id).first()
    if not grievance:
        raise HTTPException(status_code=404, detail="Grievance not found")

    if grievance.status != GrievanceStatus.open:
        raise HTTPException(
            status_code=400,
            detail=f"Grievance is already '{grievance.status}' – cannot resolve again",
        )

    violation: Violation | None = db.query(Violation).filter(
        Violation.id == grievance.violation_id
    ).first()

    if not violation:
        raise HTTPException(status_code=404, detail="Associated challan not found")

    # ── Apply resolution ───────────────────────────────────────────────────────
    grievance.admin_remark = admin_remark

    if action == "approve":
        grievance.status  = GrievanceStatus.approved
        violation.status  = ViolationStatus.invalidated   # challan cancelled
    else:
        grievance.status  = GrievanceStatus.rejected
        violation.status  = ViolationStatus.issued         # challan reinstated

    db.commit()
    db.refresh(grievance)
    db.refresh(violation)

    return {
        "grievance": _format_grievance(grievance),
        "challan":   format_challan(violation),
    }


# ─── Internal formatter ───────────────────────────────────────────────────────

def _format_grievance(g: Grievance) -> dict:
    return {
        "id":           g.id,
        "violation_id": g.violation_id,
        "plate_number": g.plate_number,
        "reason":       g.reason,
        "status":       g.status,
        "admin_remark": g.admin_remark,
        "created_at":   g.created_at.strftime("%Y-%m-%dT%H:%M:%SZ") if g.created_at else None,
    }
