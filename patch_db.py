from database.connection import SessionLocal
from models.user import User
db = SessionLocal()
rahul = db.query(User).filter(User.username == 'rahul').first()
if rahul:
    rahul.plate_number = 'MH12-AB-1234'
    db.commit()
    print('Updated Rahul plate number to MH12-AB-1234')
else:
    print('Rahul not found in DB')
