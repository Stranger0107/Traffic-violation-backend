"""
database/connection.py
──────────────────────
SQLAlchemy engine, session factory, and the declarative Base that
every model inherits from.  Import `get_db` as a FastAPI dependency
to get a request-scoped session that auto-closes on exit.
"""

import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./traffic_system.db")

engine_kwargs = {"pool_pre_ping": True, "echo": False}
if DATABASE_URL.startswith("sqlite"):
    engine_kwargs["connect_args"] = {"check_same_thread": False}

# pool_pre_ping keeps the connection alive across long-running requests
engine = create_engine(DATABASE_URL, **engine_kwargs)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    """Shared declarative base – every ORM model inherits from this."""
    pass


def get_db():
    """
    FastAPI dependency that yields a DB session and guarantees cleanup.

    Usage:
        @router.get("/example")
        def example(db: Session = Depends(get_db)):
            ...
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
