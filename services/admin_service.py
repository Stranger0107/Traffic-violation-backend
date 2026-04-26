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

from models.user import User, UserRole
from models.violation import Violation, ViolationStatus
from models.grievance import Grievance, GrievanceStatus
from utils.response import format_challan
from utils.auth import hash_password


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
    return [_format_grievance(g, db) for g in rows]


def create_staff_user(
    db: Session,
    username: str,
    password: str,
    role: str,
    plate_number: str | None = None,
) -> dict:
    """Create a citizen, officer, or admin account from an admin-only path."""
    try:
        user_role = UserRole(role)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Role must be citizen, officer, or admin") from exc

    if user_role == UserRole.citizen and not plate_number:
        raise HTTPException(status_code=400, detail="plate_number is required for citizens")

    if db.query(User).filter(User.username == username).first():
        raise HTTPException(status_code=400, detail="Username already registered")

    user = User(
        username=username,
        password_hash=hash_password(password),
        role=user_role,
        plate_number=plate_number,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    return {
        "message": "User created successfully",
        "user": {
            "id": user.id,
            "username": user.username,
            "role": user.role.value,
            "plate_number": user.plate_number,
        },
    }


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

def _format_grievance(g: Grievance, db: Session) -> dict:
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
