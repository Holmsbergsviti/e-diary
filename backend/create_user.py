"""
Utility script: create a user via Supabase Auth and insert
a profile row into the ediary_schema tables.

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
ROLE = "student"       # student | teacher | admin
CLASS_NAME = "12A"     # students only – e.g. "12A", "11B"
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

# 2. Insert profile row into ediary_schema
db = supabase.schema("ediary_schema")
if ROLE == "student":
    cls = db.table("classes").select("id").eq("class_name", CLASS_NAME).limit(1).execute()
    class_id = cls.data[0]["id"] if cls.data else None
    result = supabase.schema("ediary_schema").table("students").insert({
        "id": user_id,
        "name": NAME,
        "surname": SURNAME,
        "class_id": class_id,
    }).execute()
    print("Student profile created:", result.data)
elif ROLE == "teacher":
    result = supabase.schema("ediary_schema").table("teachers").insert({
        "id": user_id,
        "name": NAME,
        "surname": SURNAME,
    }).execute()
    print("Teacher profile created:", result.data)
elif ROLE == "admin":
    result = supabase.schema("ediary_schema").table("admins").insert({
        "id": user_id,
        "name": NAME,
        "surname": SURNAME,
    }).execute()
    print("Admin profile created:", result.data)

