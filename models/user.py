"""
models/user.py
──────────────
ORM model for the `users` table.
Roles: citizen | officer | admin
"""

import enum
from sqlalchemy import Column, Integer, String, Enum as SAEnum
from database.connection import Base


class UserRole(str, enum.Enum):
    citizen = "citizen"
    officer = "officer"
    admin   = "admin"


class User(Base):
    __tablename__ = "users"

    id            = Column(Integer, primary_key=True, index=True)
    username      = Column(String(100), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    role          = Column(SAEnum(UserRole), nullable=False, default=UserRole.citizen)
    plate_number  = Column(String(20), nullable=True)

    def __repr__(self):
        return f"<User id={self.id} username={self.username} role={self.role}>"
