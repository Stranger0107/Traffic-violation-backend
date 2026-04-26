# Testing & Execution Guide for AI e-Challan Backend

This guide outlines the step-by-step process to run the `Traffic_violation backend` and verify that the integration with the ML database is functioning correctly.

## 1. Prerequisites
Ensure you have the following installed on your system:
- **Python 3.9+**
- **MySQL Server** (running locally on port `3306`)

## 2. Database Verification
The backend connects to the same database as your ML pipeline (`traffic_system`). Ensure your MySQL service is running and the database exists. 

If you haven't created the database yet, you can create it via MySQL command line or a GUI tool (like MySQL Workbench):
```sql
CREATE DATABASE traffic_system;
```
*(The backend's SQLAlchemy engine will automatically create the required tables when it starts up.)*

## 3. Environment Setup

Open a terminal (Command Prompt or PowerShell) and navigate to the backend directory:
```powershell
cd "d:\traffic_violation_detection\Traffic_violation backend"
```

**Create and activate a virtual environment (Recommended):**
```powershell
python -m venv venv
venv\Scripts\activate
```

**Install the dependencies:**
```powershell
pip install -r requirements.txt
```

## 4. Running the Backend Server

Start the FastAPI application using `uvicorn`:
```powershell
uvicorn app:app --reload
```
You should see output indicating that the server is running on `http://127.0.0.1:8000`. Leave this terminal open.

## 5. Bootstrapping Test Data (Seeding)

Open a **new terminal**, activate the virtual environment, and run the seeder script. This will insert demo users so you can log in and test the system.

```powershell
cd "d:\traffic_violation_detection\Traffic_violation backend"
venv\Scripts\activate
python seed.py
```
**This script creates 3 test users:**
- **Admin**: `admin` / `Admin@1234`
- **Officer**: `officer1` / `Officer@1234`
- **Citizen**: `rahul` / `Citizen@1234` (This user is automatically assigned the vehicle plate `MH12AB1234` for testing).

## 6. Testing the APIs (Interactive Mode)

FastAPI provides an automatic Swagger UI that you can use to interact with and test all the endpoints.

1. Open your browser and navigate to: **http://127.0.0.1:8000/docs**
2. You will see a list of all available routes categorized by their user role (Authentication, Traffic Officer, Citizen, Admin).

### Step-by-Step Test Workflow:

**A. Test Login (Authentication):**
1. Scroll to the **Authentication** section and click on `POST /login`.
2. Click **Try it out**.
3. Enter the officer credentials:
   - `username`: `officer1`
   - `password`: `Officer@1234`
4. Click **Execute**. You should receive a `200 OK` response with an `access_token`. 
5. Copy the `access_token`.
6. Scroll to the very top of the page, click the green **Authorize** button, paste the token, and click **Authorize**. You are now logged in as the Officer.

**B. Test ML Integration (Pending Challans):**
1. Scroll to the **Traffic Officer** section and expand `GET /officer/pending-challans`.
2. Click **Try it out** and then **Execute**.
3. *Note: If the ML Pipeline has not detected any violations yet, this list will be empty.* If the ML pipeline has run and dumped items into the `Violations` table, they will appear here with a `pending_review` status!

**C. Approve a Challan:**
1. If you see a pending challan from the step above, note its `vehicle_id` (this represents the challan ID).
2. Go to `POST /officer/review-challan`.
3. Provide the `challan_id` and set `action` to `"approve"`. 
4. Execute. The status will update to `"issued"` and a fine will be mapped based on the `violation_type`.

**D. Test Citizen View:**
1. Scroll up, click **Authorize**, and click **Logout** to remove the officer token.
2. Go back to `POST /login` and log in as the Citizen:
   - `username`: `rahul`
   - `password`: `Citizen@1234`
3. Copy the new token and **Authorize** at the top.
4. Scroll to the **Citizen** section and execute `GET /citizen/my-challans`.
5. You should see any issued challans that belong to plate `MH12AB1234` (if the ML pipeline recorded violations for that plate and the officer approved them).

## Troubleshooting 

- **ModuleNotFoundError**: If you get a module not found error when starting uvicorn, make sure your virtual environment is activated and you ran `pip install -r requirements.txt`.
- **Database Connection Refused**: If the backend crashes on startup with a database error, verify that your MySQL server is running and the password in `database/connection.py` matches your root MySQL password (`0107@Bbs`).
- **Missing Tables**: If an API throws a SQL error indicating missing tables, ensure the ML pipeline or the FastAPI startup routine successfully created the tables. `app.py` has `Base.metadata.create_all(bind=engine)` which automatically handles table creation if they don't exist.
