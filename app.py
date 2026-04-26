"""
app.py
──────
FastAPI application entry point for the AI e-Challan Backend.

Start the server:
    uvicorn app:app --reload --host 0.0.0.0 --port 8000

Interactive docs available at:
    http://localhost:8000/docs     (Swagger UI)
    http://localhost:8000/redoc   (ReDoc)
"""

from fastapi import FastAPI
from fastapi.responses import RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

# Load .env before anything else
load_dotenv()

from database.connection import Base, engine
from routes import auth_router, officer_router, citizen_router, admin_router

# ── Create all tables (idempotent) ────────────────────────────────────────────
# In production prefer Alembic migrations; this is fine for development.
Base.metadata.create_all(bind=engine)

# ── App factory ───────────────────────────────────────────────────────────────
app = FastAPI(
    title       = "AI e-Challan System API",
    description = (
        "Backend for the AI-powered traffic violation (e-Challan) system. "
        "Connects the ML vision pipeline with the Mobile Officer App, "
        "Citizen Portal, and Admin Web Panel."
    ),
    version = "1.0.0",
    docs_url    = "/docs",
    redoc_url   = "/redoc",
)

# ── CORS ──────────────────────────────────────────────────────────────────────
# Restrict origins in production to your actual frontend domain(s).
app.add_middleware(
    CORSMiddleware,
    allow_origins     = ["*"],
    allow_credentials = True,
    allow_methods     = ["*"],
    allow_headers     = ["*"],
)

# ── Register Routers ──────────────────────────────────────────────────────────
app.include_router(auth_router)
app.include_router(officer_router)
app.include_router(citizen_router)
app.include_router(admin_router)


# ── Health check ──────────────────────────────────────────────────────────────
@app.get("/health", tags=["System"])
def health_check():
    """Simple liveness probe for load-balancers and uptime monitors."""
    return {"status": "ok", "service": "AI e-Challan API"}

@app.get("/", include_in_schema=False)
def root():
    """Redirect users to the interactive documentation."""
    return RedirectResponse(url="/docs")
