import os
from supabase import create_client, Client

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

# Lazy-initialised clients so module import never blocks on network I/O.
_auth_client: Client | None = None
_data_client: Client | None = None


def _get_auth_client() -> Client:
    """Auth client – used only for sign_in_with_password."""
    global _auth_client
    if _auth_client is None:
        _auth_client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    return _auth_client


def _get_data_client() -> Client:
    """Data client – never call .auth methods on this one."""
    global _data_client
    if _data_client is None:
        _data_client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    return _data_client


class _LazyProxy:
    """Proxy that defers client creation until first attribute access."""
    def __init__(self, factory):
        object.__setattr__(self, '_factory', factory)
        object.__setattr__(self, '_client', None)

    def _resolve(self):
        c = object.__getattribute__(self, '_client')
        if c is None:
            c = object.__getattribute__(self, '_factory')()
            object.__setattr__(self, '_client', c)
        return c

    def __getattr__(self, name):
        return getattr(self._resolve(), name)


# Module-level names so existing `from .supabase_client import supabase, supabase_auth`
# imports keep working, but client creation is deferred until first use.
supabase_auth: Client = _LazyProxy(_get_auth_client)   # type: ignore[assignment]
supabase: Client = _LazyProxy(_get_data_client)         # type: ignore[assignment]


def ediary():
    """Return a PostgREST client scoped to the ediary_schema."""
    return supabase.schema("ediary_schema")
