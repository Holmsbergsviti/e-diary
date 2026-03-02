"""
Utility script: create a user in the Supabase 'users' table.

Usage:
    SUPABASE_URL=... SUPABASE_SERVICE_KEY=... python create_user.py

Edit the variables below before running.
"""
import os
import bcrypt
from supabase import create_client

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

# ── edit these ──────────────────────────────
USERNAME = "student1"
PASSWORD = "changeme"
FULL_NAME = "Alice Smith"
ROLE = "student"       # student | teacher | admin
CLASS_ID = None        # set to the integer id of the class row, or None
CLASS_NAME = "12A"
# ─────────────────────────────────────────────

supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

password_hash = bcrypt.hashpw(PASSWORD.encode(), bcrypt.gensalt()).decode()

result = supabase.table("users").insert({
    "username": USERNAME,
    "password_hash": password_hash,
    "full_name": FULL_NAME,
    "role": ROLE,
    "class_id": CLASS_ID,
    "class_name": CLASS_NAME,
}).execute()

print("User created:", result.data)

