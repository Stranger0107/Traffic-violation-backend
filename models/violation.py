"""
models/violation.py
───────────────────
ORM model for the `violations` (challans) table.

Status flow:
  pending_review  ──► issued      (officer approves AI detection)
                  └─► rejected    (officer rejects – false positive)
  issued          ──► paid        (citizen pays fine)
                  └─► contested   (citizen raises a grievance)
  contested       ──► invalidated (admin approves grievance)
                  └─► issued      (admin rejects grievance – challan stands)
"""

import enum
from datetime import datetime
from sqlalchemy import Column, Integer, String, Enum as SAEnum, DateTime
from database.connection import Base


class ViolationType(str, enum.Enum):
    WITHOUT_HELMET       = "WITHOUT_HELMET"
    USING_MOBILE         = "USING_MOBILE"
    RED_LIGHT            = "RED_LIGHT"
    MORE_THAN_TWO_PERSONS = "MORE_THAN_TWO_PERSONS"


class ViolationStatus(str, enum.Enum):
    pending_review = "pending_review"
    issued         = "issued"
    rejected       = "rejected"
    paid           = "paid"
    contested      = "contested"
    invalidated    = "invalidated"


# Fine lookup table – single source of truth
FINE_MAP: dict[str, int] = {
    ViolationType.WITHOUT_HELMET:        500,
    ViolationType.USING_MOBILE:         1000,
    ViolationType.RED_LIGHT:            1000,
    ViolationType.MORE_THAN_TWO_PERSONS: 500,
}


class Violation(Base):
    __tablename__ = "Violations"

    id           = Column(Integer, primary_key=True, index=True)
    frame_no     = Column(Integer, nullable=True)
    plate_number = Column(String(20), nullable=False, index=True)
    violation_type = Column(String(50), nullable=False)          # stores ViolationType value
    fine         = Column(Integer, nullable=False, default=0)
    timestamp    = Column(DateTime, default=datetime.utcnow, nullable=False)
    status       = Column(
        SAEnum(ViolationStatus),
        nullable=False,
        default=ViolationStatus.pending_review,
    )
    # Optional: store path to the offending video frame / evidence snapshot
    evidence_path = Column(String(255), nullable=True)

    def __repr__(self):
        return f"<Violation id={self.id} plate={self.plate_number} type={self.violation_type} status={self.status}>"
