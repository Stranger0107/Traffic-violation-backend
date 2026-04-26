"""
routes/auth.py
──────────────
POST /login  →  returns JWT token + role
"""

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database.connection import get_db
from services.auth_service import authenticate_user

router = APIRouter(tags=["Authentication"])


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type:   str
    role:         str
    username:     str


@router.post("/login", response_model=LoginResponse, summary="Login and receive a JWT token")
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    """
    Authenticate with username + password.
    Returns a Bearer token and the user's role (citizen / officer / admin).
    """
    return authenticate_user(db, payload.username, payload.password)
