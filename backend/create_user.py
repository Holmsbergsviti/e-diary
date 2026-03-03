"""
Utility script: create a user via Supabase Auth and optionally insert
a profile row into the students or teachers table.

Usage:
    SUPABASE_URL=... SUPABASE_SERVICE_KEY=... python create_user.py

Or with a .env file in the same directory.
Edit the variables below before running.
"""
import os
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).resolve().parent / ".env")

from supabase import create_client

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

# ── edit these ──────────────────────────────
EMAIL = "student1@example.com"
PASSWORD = "changeme"
NAME = "Alice"
SURNAME = "Smith"
ROLE = "student"       # student | teacher
YEAR = 12              # students only – year group
LETTER = "A"           # students only – class letter
# ─────────────────────────────────────────────

supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

# 1. Create auth user
auth_response = supabase.auth.admin.create_user({
    "email": EMAIL,
    "password": PASSWORD,
    "email_confirm": True,
})
user_id = str(auth_response.user.id)
print(f"Auth user created: {user_id} ({EMAIL})")

# 2. Insert profile row
if ROLE == "student":
    result = supabase.table("students").insert({
        "Name": NAME,
        "Surname": SURNAME,
        "user_id": user_id,
        "year": YEAR,
        "Letter": LETTER,
        "Subject": 0,
    }).execute()
    print("Student profile created:", result.data)
elif ROLE == "teacher":
    result = supabase.table("teachers").insert({
        "user_id": user_id,
    }).execute()
    print("Teacher profile created:", result.data)

