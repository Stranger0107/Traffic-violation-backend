"""
utils/response.py
─────────────────
Helper to produce the standardised challan JSON shape required by the spec,
plus generic success / error envelope builders.
"""

from datetime import datetime
from typing import Any

from models.violation import Violation


def format_challan(violation: Violation, owner_name: str = "Unknown") -> dict:
    """
    Serialise a Violation ORM row into the required API response shape:

    {
        "vehicle_id":   102,
        "plate_number": "MH12AB1234",
        "violation":    "WITHOUT_HELMET",
        "owner_name":   "Rahul Sharma",
        "fine":         500,
        "status":       "pending_review",
        "timestamp":    "2024-05-12T14:30:00Z"
    }
    """
    ts = violation.timestamp
    if isinstance(ts, datetime):
        ts_str = ts.strftime("%Y-%m-%dT%H:%M:%SZ")
    else:
        ts_str = str(ts)

    return {
        "vehicle_id":  violation.id,
        "plate_number": violation.plate_number,
        "violation":   violation.violation_type,
        "owner_name":  owner_name,
        "fine":        violation.fine,
        "status":      violation.status,
        "timestamp":   ts_str,
    }


def success(data: Any = None, message: str = "OK") -> dict:
    """Generic success envelope."""
    return {"success": True, "message": message, "data": data}


def error(message: str, code: int = 400) -> dict:
    """Generic error envelope (used inside HTTPException detail)."""
    return {"success": False, "message": message, "code": code}
