"""
utils/auth.py
─────────────
JWT helpers and FastAPI security dependencies.

Flow:
  1. Client POSTs credentials to /login
  2. Server returns a signed JWT (access token)
  3. Client sends  Authorization: Bearer <token>  on every protected request
  4. FastAPI deps (get_current_user, require_officer, require_admin) verify the token
     and inject the authenticated user into the route handler
"""

import os
from datetime import datetime, timedelta, timezone

from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from database.connection import get_db
from models.user import User, UserRole

# ── Config ────────────────────────────────────────────────────────────────────
SECRET_KEY  = os.getenv("SECRET_KEY", "change-me-in-production")
ALGORITHM   = os.getenv("ALGORITHM", "HS256")
TOKEN_EXPIRE = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", 60))

pwd_context   = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/login")


# ── Password helpers ──────────────────────────────────────────────────────────

def hash_password(plain: str) -> str:
    """Return bcrypt hash of a plain-text password."""
    return pwd_context.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    """Return True if plain matches the stored bcrypt hash."""
    return pwd_context.verify(plain, hashed)


# ── Token helpers ─────────────────────────────────────────────────────────────

def create_access_token(data: dict) -> str:
    """
    Sign a JWT containing `data` plus an `exp` claim.
    `data` should include at minimum {"sub": username, "role": role}.
    """
    payload = data.copy()
    expire  = datetime.now(timezone.utc) + timedelta(minutes=TOKEN_EXPIRE)
    payload.update({"exp": expire})
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> dict:
    """
    Decode and verify a JWT.  Raises HTTP 401 on any failure
    (expired, tampered, missing required claims).
    """
    credentials_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exc
        return payload
    except JWTError:
        raise credentials_exc


# ── FastAPI Dependencies ──────────────────────────────────────────────────────

def get_current_user(
    token: str = Depends(oauth2_scheme),
    db:    Session = Depends(get_db),
) -> User:
    """Inject the authenticated User ORM object into a route."""
    payload  = decode_token(token)
    username = payload.get("sub")
    user     = db.query(User).filter(User.username == username).first()
    if user is None:
        raise HTTPException(status_code=401, detail="User not found")
    return user


def require_officer(current_user: User = Depends(get_current_user)) -> User:
    """Allow only Traffic Officers (and Admins) through."""
    if current_user.role not in (UserRole.officer, UserRole.admin):
        raise HTTPException(status_code=403, detail="Officer access required")
    return current_user


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    """Allow only Admins through."""
    if current_user.role != UserRole.admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user


def require_citizen(current_user: User = Depends(get_current_user)) -> User:
    """Allow only Citizens through."""
    if current_user.role != UserRole.citizen:
        raise HTTPException(status_code=403, detail="Citizen access required")
    return current_user
