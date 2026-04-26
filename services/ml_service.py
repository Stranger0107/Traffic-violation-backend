"""
services/ml_service.py
──────────────────────
Internal helpers for the ML pipeline to hand off detected violations
to the backend review queue.
"""

from sqlalchemy.orm import Session

from models.violation import Violation, ViolationStatus


def ingest_violation(
    db: Session,
    frame_no: int | None,
    violation_type: str,
    plate_number: str,
    evidence_path: str | None = None,
) -> dict:
    """Create a pending-review violation entry for officer/admin review."""
    violation = Violation(
        frame_no=frame_no,
        plate_number=plate_number,
        violation_type=violation_type,
        fine=0,
        status=ViolationStatus.pending_review,
        evidence_path=evidence_path,
    )
    db.add(violation)
    db.commit()
    db.refresh(violation)

    return {
        "message": "Violation ingested successfully",
        "violation": {
            "id": violation.id,
            "plate_number": violation.plate_number,
            "violation_type": violation.violation_type,
            "status": violation.status.value,
            "fine": violation.fine,
            "frame_no": violation.frame_no,
            "timestamp": violation.timestamp.strftime("%Y-%m-%dT%H:%M:%SZ") if violation.timestamp else None,
            "evidence_path": violation.evidence_path,
        },
    }