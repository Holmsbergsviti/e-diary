"""
Utility script: create a user via Supabase Auth and insert their
profile into the appropriate ediary_schema table.

Usage:
    SUPABASE_URL=... SUPABASE_SERVICE_KEY=... python create_user.py

Edit the variables below before running.
"""
import os
from supabase import create_client

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

# ── edit these ──────────────────────────────
EMAIL = "student1@example.com"
PASSWORD = "changeme"
NAME = "Alice"
SURNAME = "Smith"
ROLE = "student"       # student | teacher | admin
CLASS_ID = None        # UUID string of the class, or None (students only)
# ─────────────────────────────────────────────

SCHEMA = "ediary_schema"
ROLE_TABLE = {"student": "students", "teacher": "teachers", "admin": "admins"}

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
profile_table = ROLE_TABLE[ROLE]
profile_data = {"id": user_id, "name": NAME, "surname": SURNAME}

if ROLE == "student" and CLASS_ID:
    profile_data["class_id"] = CLASS_ID

result = (
    supabase.schema(SCHEMA)
    .table(profile_table)
    .insert(profile_data)
    .execute()
)
print(f"Profile created in {profile_table}:", result.data)

