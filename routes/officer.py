"""
routes/officer.py
─────────────────
All endpoints that require Traffic Officer (or Admin) privileges.

  POST /officer/upload-video       – upload footage, trigger ML pipeline
  GET  /officer/pending-challans   – list violations awaiting review
  POST /officer/review-challan     – approve or reject a specific challan
"""

from fastapi import APIRouter, Depends, UploadFile, File, BackgroundTasks
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database.connection import get_db
from models.user import User
from utils.auth import require_officer
from services.officer_service import (
    save_video_and_trigger_pipeline,
    get_pending_challans,
    review_challan,
)

router = APIRouter(prefix="/officer", tags=["Traffic Officer"])


# ── Upload Video ──────────────────────────────────────────────────────────────

@router.post("/upload-video", summary="Upload traffic footage and trigger ML pipeline")
async def upload_video(
    background_tasks: BackgroundTasks,
    video:            UploadFile = File(..., description="MP4 / AVI traffic footage"),
    current_user:     User       = Depends(require_officer),
):
    """
    Saves the video to disk and schedules the ML pipeline in the background.
    The ML pipeline will insert violations with status=`pending_review` directly
    into the database.  Returns immediately so the officer's app isn't blocked.
    """
    return save_video_and_trigger_pipeline(video, background_tasks)


# ── Pending Challans ──────────────────────────────────────────────────────────

@router.get("/pending-challans", summary="List AI-detected challans awaiting human review")
def pending_challans(
    db:           Session = Depends(get_db),
    current_user: User    = Depends(require_officer),
):
    """
    Returns all challans currently in `pending_review` status.
    Each entry includes the plate, violation type, AI-assigned fine, and timestamp.
    """
    return get_pending_challans(db)


# ── Review Challan ────────────────────────────────────────────────────────────

class ReviewRequest(BaseModel):
    challan_id: int
    action:     str   # "approve" | "reject"


@router.post("/review-challan", summary="Approve or reject an AI-detected challan")
def review(
    payload:      ReviewRequest,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(require_officer),
):
    """
    **approve** → status changes to `issued`, fine is confirmed.
    **reject**  → status changes to `rejected` (AI false-positive, no penalty).
    """
    return review_challan(db, payload.challan_id, payload.action)
