"""
routes/auth.py
──────────────
POST /login  →  returns JWT token + role
"""

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field, ConfigDict
from sqlalchemy.orm import Session

from database.connection import get_db
from services.auth_service import authenticate_user, register_citizen

router = APIRouter(tags=["Authentication"])


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type:   str
    role:         str
    username:     str


class RegisterRequest(BaseModel):
    username: str
    password: str
    plate_number: str = Field(alias="plateNumber")

    model_config = ConfigDict(populate_by_name=True)


@router.post("/login", response_model=LoginResponse, summary="Login and receive a JWT token")
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    """
    Authenticate with username + password.
    Returns a Bearer token and the user's role (citizen / officer / admin).
    """
    return authenticate_user(db, payload.username, payload.password)

@router.post("/register", summary="Register a new citizen")
def register(payload: RegisterRequest, db: Session = Depends(get_db)):
    """
    Register a new citizen with a username, password, and vehicle plate number.
    """
    return register_citizen(db, payload.username, payload.password, payload.plate_number)
