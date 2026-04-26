"""
services/officer_service.py
───────────────────────────
Business logic for Traffic Officer workflows:
  - Trigger the ML pipeline after video upload
  - Fetch pending (AI-detected) challans for human review
  - Approve or Reject a challan
"""

import os
import shutil
from sqlalchemy.orm import Session
from fastapi import HTTPException

from models.violation import Violation, ViolationStatus, FINE_MAP
from utils.response import format_challan

VIDEO_DIR = os.getenv("VIDEO_UPLOAD_DIR", "uploads/videos")


# ── Video upload ──────────────────────────────────────────────────────────────

def save_video_and_trigger_pipeline(video_file, background_tasks) -> dict:
    """
    1. Persist the uploaded video to disk.
    2. Schedule ML pipeline execution as a background task so the HTTP
       response is returned immediately (non-blocking).

    NOTE: `process_video(path)` is your existing ML pipeline function.
          It is imported lazily inside the background task to avoid
          pulling in heavy CV dependencies at server startup.
    """
    os.makedirs(VIDEO_DIR, exist_ok=True)

    # Sanitise filename and save
    safe_name  = os.path.basename(video_file.filename)
    dest_path  = os.path.join(VIDEO_DIR, safe_name)

    with open(dest_path, "wb") as out:
        shutil.copyfileobj(video_file.file, out)

    # Enqueue the ML job – runs after the response is sent
    background_tasks.add_task(_run_ml_pipeline, dest_path)

    return {
        "message":    "Video uploaded successfully. ML pipeline triggered in background.",
        "video_path": dest_path,
    }


def _run_ml_pipeline(video_path: str):
    """
    Background task that calls your existing ML pipeline.
    The pipeline is responsible for writing violations (status=pending_review)
    directly to the database, so no DB session is needed here.
    """
    try:
        # ── Import your pipeline here (kept lazy to avoid heavy import at boot)
        from src.pipeline import process_video  # adjust import path as needed
        process_video(video_path)
    except Exception as exc:
        # In production replace with proper logging (e.g. structlog / loguru)
        print(f"[ML Pipeline ERROR] {video_path}: {exc}")


# ── Pending challans ──────────────────────────────────────────────────────────

def get_pending_challans(db: Session) -> list[dict]:
    """Return all challans currently awaiting officer review."""
    rows = (
        db.query(Violation)
        .filter(Violation.status == ViolationStatus.pending_review)
        .order_by(Violation.timestamp.desc())
        .all()
    )
    return [format_challan(v) for v in rows]


# ── Review (approve / reject) ─────────────────────────────────────────────────

def review_challan(db: Session, challan_id: int, action: str) -> dict:
    """
    action must be "approve" or "reject" (case-insensitive).

    approve → status becomes `issued`  (fine is now officially owed)
    reject  → status becomes `rejected` (AI false-positive, no fine)
    """
    action = action.lower()
    if action not in ("approve", "reject"):
        raise HTTPException(status_code=400, detail="Action must be 'approve' or 'reject'")

    violation: Violation | None = db.query(Violation).filter(Violation.id == challan_id).first()
    if not violation:
        raise HTTPException(status_code=404, detail="Challan not found")

    if violation.status != ViolationStatus.pending_review:
        raise HTTPException(
            status_code=400,
            detail=f"Challan is already '{violation.status}' – cannot review again",
        )

    # Apply fine from the canonical lookup table when issuing
    if action == "approve":
        violation.status = ViolationStatus.issued
        violation.fine   = FINE_MAP.get(violation.violation_type, 0)
    else:
        violation.status = ViolationStatus.rejected

    db.commit()
    db.refresh(violation)
    return format_challan(violation)
