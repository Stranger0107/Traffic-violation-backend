"""
routes/ml.py
────────────
Internal endpoint used by the detection pipeline to submit newly
detected violations into the backend review queue.
"""

import os

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database.connection import get_db
from services.ml_service import ingest_violation

router = APIRouter(prefix="/ml", tags=["ML Pipeline"])

ML_API_KEY = os.getenv("ML_API_KEY", "local-dev-key")


class IngestViolationRequest(BaseModel):
    frame_no: int | None = None
    violation_type: str
    plate_number: str
    evidence_path: str | None = None


def require_ml_key(x_api_key: str = Header(default="", alias="X-API-Key")) -> None:
    if x_api_key != ML_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid ML API key",
        )


@router.post("/violations", summary="Ingest a violation from the ML pipeline")
def create_violation(
    payload: IngestViolationRequest,
    db: Session = Depends(get_db),
    _: None = Depends(require_ml_key),
):
    return ingest_violation(
        db=db,
        frame_no=payload.frame_no,
        violation_type=payload.violation_type,
        plate_number=payload.plate_number,
        evidence_path=payload.evidence_path,
    )