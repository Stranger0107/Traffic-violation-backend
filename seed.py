"""
seed.py
───────
One-time script to bootstrap the database with:
  - A demo admin, officer, and citizen account
  - The citizen has a sample plate linked to their record

Run once after `uvicorn app:app` has created the tables:
    python seed.py
"""

from dotenv import load_dotenv
load_dotenv()

from database.connection import SessionLocal, Base, engine
from models.user import User, UserRole
from utils.auth import hash_password

Base.metadata.create_all(bind=engine)

SEED_USERS = [
    {"username": "admin",   "password": "Admin@1234",   "role": UserRole.admin},
    {"username": "officer1","password": "Officer@1234", "role": UserRole.officer},
    {"username": "rahul",   "password": "Citizen@1234", "role": UserRole.citizen},
]

def main():
    db = SessionLocal()
    try:
        for u in SEED_USERS:
            if db.query(User).filter(User.username == u["username"]).first():
                print(f"  [SKIP] User '{u['username']}' already exists")
                continue
            user = User(
                username      = u["username"],
                password_hash = hash_password(u["password"]),
                role          = u["role"],
                plate_number  = "MH12AB1234" if u["role"] == UserRole.citizen else None,
            )
            db.add(user)
            print(f"  [ADD]  User '{u['username']}' ({u['role']})")
        db.commit()
        print("\n✅  Seed complete.")
    finally:
        db.close()

if __name__ == "__main__":
    main()
