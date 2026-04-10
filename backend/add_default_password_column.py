#!/usr/bin/env python3
"""
One-time migration: add default_password column to ediary_schema.students.
Run with:  python add_default_password_column.py
"""
import os
from supabase import create_client

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
    raise SystemExit("Set SUPABASE_URL and SUPABASE_SERVICE_KEY env vars first.")

client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

print("Adding default_password column to ediary_schema.students …")
client.postgrest.schema("ediary_schema")
# Use rpc to run raw SQL via a Supabase function, or use the REST API.
# Since we can't run raw SQL via PostgREST, execute via Supabase SQL Editor
# or run this SQL directly:
SQL = """
ALTER TABLE ediary_schema.students
ADD COLUMN IF NOT EXISTS default_password text;
"""
print("Run this SQL in the Supabase SQL Editor:\n")
print(SQL)
print("Done. You can delete this script afterwards.")
