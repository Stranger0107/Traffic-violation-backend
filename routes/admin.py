"""
routes/admin.py
───────────────
Endpoints available only to Admins:

  GET  /admin/violations          – all system violations
  GET  /admin/grievances          – all open grievances
  POST /admin/resolve-grievance   – approve or reject a grievance
"""

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database.connection import get_db
from models.user import User
from utils.auth import require_admin
from services.admin_service import (
    get_all_violations,
    get_all_grievances,
    create_staff_user,
    resolve_grievance,
)

router = APIRouter(prefix="/admin", tags=["Admin"])


# ── All Violations ────────────────────────────────────────────────────────────

@router.get("/violations", summary="View all system-wide violations")
def all_violations(
    db:           Session = Depends(get_db),
    current_user: User    = Depends(require_admin),
):
    """Returns every violation regardless of status, newest first."""
    return get_all_violations(db)


# ── All Open Grievances ───────────────────────────────────────────────────────

@router.get("/grievances", summary="View all open grievances awaiting admin review")
def all_grievances(
    db:           Session = Depends(get_db),
    current_user: User    = Depends(require_admin),
):
    """Returns all grievances currently in `open` status."""
    return get_all_grievances(db)


# ── Resolve Grievance ─────────────────────────────────────────────────────────

class ResolveRequest(BaseModel):
    grievance_id: int
    action:       str   # "approve" | "reject"
    admin_remark: str = ""


class CreateStaffRequest(BaseModel):
    username: str
    password: str
    role: str   # "citizen" | "officer" | "admin"
    plate_number: str | None = None


@router.post("/resolve-grievance", summary="Approve or reject a citizen grievance")
def resolve(
    payload:      ResolveRequest,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(require_admin),
):
    """
    **approve** → grievance marked `approved`, associated challan becomes `invalidated`.
    **reject**  → grievance marked `rejected`, associated challan returns to `issued`.
    """
    return resolve_grievance(db, payload.grievance_id, payload.action, payload.admin_remark)


@router.post("/users", summary="Create a staff or citizen account from the admin panel")
def create_user(
    payload:      CreateStaffRequest,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(require_admin),
):
    """Create officer/admin/citizen users from a protected admin-only path."""
    return create_staff_user(db, payload.username, payload.password, payload.role, payload.plate_number)
