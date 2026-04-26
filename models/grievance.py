"""
models/grievance.py
───────────────────
ORM model for the `grievances` table.
A citizen raises a grievance against an `issued` challan they believe is wrong.
An admin then approves (→ challan invalidated) or rejects (→ challan stands).
"""

import enum
from datetime import datetime
from sqlalchemy import Column, Integer, String, ForeignKey, Enum as SAEnum, DateTime, Text
from database.connection import Base


class GrievanceStatus(str, enum.Enum):
    open     = "open"
    approved = "approved"
    rejected = "rejected"


class Grievance(Base):
    __tablename__ = "grievances"

    id           = Column(Integer, primary_key=True, index=True)
    violation_id = Column(Integer, ForeignKey("Violations.ticket_id"), nullable=False, index=True)
    plate_number = Column(String(20), nullable=False)
    reason       = Column(Text, nullable=False)
    status       = Column(SAEnum(GrievanceStatus), nullable=False, default=GrievanceStatus.open)
    admin_remark = Column(Text, nullable=True)
    created_at   = Column(DateTime, default=datetime.utcnow, nullable=False)

    def __repr__(self):
        return f"<Grievance id={self.id} violation_id={self.violation_id} status={self.status}>"
