import os
from supabase import create_client, Client

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

# Auth client – used only for sign_in_with_password.
# After a successful sign-in the SDK mutates the client's Authorization
# header to the *user's* JWT, which triggers RLS.  We keep a second,
# untouched client for data queries so we always use the service-role key.
supabase_auth: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

# Data client – never call .auth methods on this one.
supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)


def ediary():
    """Return a PostgREST client scoped to the ediary_schema."""
    return supabase.schema("ediary_schema")
