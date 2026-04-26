# 🚦 AI e-Challan System — Backend API

FastAPI backend that bridges the ML vision pipeline, Traffic Officer Mobile App, Citizen Portal, and Admin Web Panel.

---

## 📁 Project Structure

```
backend/
├── app.py                   # FastAPI entry point – registers all routers
├── seed.py                  # Bootstrap demo users
├── requirements.txt
├── .env.example             # Copy to .env and fill in your values
│
├── database/
│   ├── __init__.py
│   └── connection.py        # SQLAlchemy engine, Base, get_db dependency
│
├── models/
│   ├── __init__.py
│   ├── user.py              # User ORM model (citizen / officer / admin)
│   ├── violation.py         # Violation / Challan ORM model + FINE_MAP
│   └── grievance.py         # Grievance ORM model
│
├── services/
│   ├── __init__.py
│   ├── auth_service.py      # Login / token issuance
│   ├── officer_service.py   # Upload video, pending challans, review
│   ├── citizen_service.py   # My challans, grievance submission
│   └── admin_service.py     # All violations, resolve grievances
│
├── routes/
│   ├── __init__.py
│   ├── auth.py              # POST /login
│   ├── officer.py           # /officer/* endpoints
│   ├── citizen.py           # /citizen/* endpoints
│   └── admin.py             # /admin/* endpoints
│
└── utils/
    ├── __init__.py
    ├── auth.py              # JWT helpers + FastAPI role dependencies
    └── response.py          # Standard challan JSON formatter
```

---

## ⚡ Quick Start

### 1. Install dependencies
```bash
cd backend
python -m venv venv && source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### 2. Configure environment
```bash
cp .env.example .env
# Edit .env: set DATABASE_URL and SECRET_KEY
```

### 3. Create the MySQL database
```sql
CREATE DATABASE echallan_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

### 4. Start the server (tables are auto-created on first run)
```bash
uvicorn app:app --reload --host 0.0.0.0 --port 8000
```

### 5. Seed demo users
```bash
python seed.py
```

---

## 🔑 Demo Credentials

| Role    | Username  | Password       |
|---------|-----------|----------------|
| Admin   | admin     | Admin@1234     |
| Officer | officer1  | Officer@1234   |
| Citizen | rahul     | Citizen@1234   |

---

## 🌐 API Reference

Interactive docs: **http://localhost:8000/docs**

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST   | `/login` | Returns JWT token + role |

### Traffic Officer  *(requires Officer or Admin token)*
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST   | `/officer/upload-video` | Upload footage, trigger ML pipeline |
| GET    | `/officer/pending-challans` | Challans awaiting human review |
| POST   | `/officer/review-challan` | Approve or reject a challan |

### Citizen  *(requires Citizen token)*
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET    | `/citizen/my-challans` | All issued challans for your plate |
| GET    | `/citizen/challan/{id}` | Single challan detail |
| POST   | `/citizen/grievance` | Raise a grievance |
| GET    | `/citizen/grievance/{id}` | Grievance status |

### Admin  *(requires Admin token)*
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET    | `/admin/violations` | All system-wide violations |
| GET    | `/admin/grievances` | All open grievances |
| POST   | `/admin/resolve-grievance` | Approve or reject a grievance |

---

## 💰 Fine Schedule

| Violation              | Fine   |
|------------------------|--------|
| WITHOUT_HELMET         | ₹500   |
| USING_MOBILE           | ₹1,000 |
| RED_LIGHT              | ₹1,000 |
| MORE_THAN_TWO_PERSONS  | ₹500   |

---

## 🔄 Challan Status Flow

```
ML Pipeline inserts → pending_review
                             │
             ┌───────────────┴───────────────┐
          (Officer approves)          (Officer rejects)
             │                               │
           issued                        rejected
             │
     (Citizen contests)
             │
         contested
             │
   ┌─────────┴─────────┐
(Admin approves)  (Admin rejects)
   │                   │
invalidated           issued
```

---

## 🔌 ML Pipeline Integration

Your existing pipeline calls `process_video(video_path)`.  
The backend triggers it as a **background task** (non-blocking) via `BackgroundTasks`.

The pipeline should continue writing violations directly to the DB with:
- `status = "pending_review"`
- `fine = 0`  *(fine is set by the backend on officer approval)*

To connect your pipeline, update the import in `services/officer_service.py`:
```python
from src.pipeline import process_video   # ← adjust to your actual module path
```
