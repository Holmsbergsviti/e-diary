import os
from supabase import create_client, Client

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

SCHEMA = "ediary_schema"


def table(name: str):
    """Return a PostgREST query builder for a table in ediary_schema."""
    return supabase.schema(SCHEMA).table(name)
