"""
services/auth_service.py
────────────────────────
Business logic for authenticating users and issuing JWT tokens.
The route layer stays thin – all DB interaction lives here.
"""

from sqlalchemy.orm import Session
from fastapi import HTTPException, status

from models.user import User, UserRole
from utils.auth import verify_password, hash_password, create_access_token


def authenticate_user(db: Session, username: str, password: str) -> dict:
    """
    Validate credentials and return a JWT access token + role.

    Raises HTTP 401 if the username doesn't exist or the password is wrong.
    """
    user: User | None = db.query(User).filter(User.username == username).first()

    if not user or not verify_password(password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = create_access_token({"sub": user.username, "role": user.role.value})

    return {
        "access_token": token,
        "token_type":   "bearer",
        "role":         user.role.value,
        "username":     user.username,
    }


def register_citizen(db: Session, username: str, password: str, plate_number: str) -> dict:
    """
    Register a new citizen user.
    """
    if db.query(User).filter(User.username == username).first():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already registered",
        )
    
    new_user = User(
        username=username,
        password_hash=hash_password(password),
        role=UserRole.citizen,
        plate_number=plate_number,
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    return {"message": "Citizen registered successfully"}
