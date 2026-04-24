import json
import logging
import os
import re
import secrets
import string
import uuid
import jwt
from jwt.exceptions import PyJWTError
from datetime import datetime, timedelta, timezone
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from .supabase_client import supabase, supabase_auth, supabase_admin_auth, ediary

logger = logging.getLogger(__name__)

# Warn loudly if JWT secret is not configured, but don't crash
_jwt_secret = os.environ.get("JWT_SECRET", "")
if not _jwt_secret:
    _jwt_secret = secrets.token_urlsafe(48)
    logger.warning("JWT_SECRET is not set! Generated a random ephemeral key. Tokens will NOT survive restarts.")
JWT_SECRET = _jwt_secret
JWT_ALGORITHM = "HS256"
JWT_EXPIRY_HOURS = 8

# Admin hierarchy – these emails are resolved at login time
SUPER_ADMIN_EMAIL = "system.core@chartwell.edu.rs"
MASTER_ADMIN_EMAIL = "bojan.milenkovic@chartwell.edu.rs"

ALL_ADMIN_PERMISSIONS = {
    "students": True, "teachers": True, "classes": True,
    "subjects": True, "schedule": True, "events": True,
    "holidays": True, "import": True, "impersonate": True,
    "attendance": True, "exports": True,
}


# ------------------------------------------------------------------
# Password / email helpers
# ------------------------------------------------------------------

def _generate_password(length=10):
    """Generate a random alphanumeric password (easy to read: no 0/O/l/1)."""
    alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    return ''.join(secrets.choice(alphabet) for _ in range(length))


def _generate_email(name: str, surname: str, existing_emails: set, separator: str = "-") -> str:
    """Generate firstname{sep}surname@chartwell.edu.rs, appending a number for duplicates.
    Students use hyphen (-), teachers use dot (.)."""
    safe_name = re.sub(r'[^a-z0-9]', '', name.lower().strip())
    safe_surname = re.sub(r'[^a-z0-9]', '', surname.lower().strip())
    base = f"{safe_name}{separator}{safe_surname}" if safe_name and safe_surname else (safe_name or safe_surname or "user")
    email = f"{base}@chartwell.edu.rs"
    if email not in existing_emails:
        existing_emails.add(email)
        return email
    counter = 2
    while True:
        email = f"{base}{counter}@chartwell.edu.rs"
        if email not in existing_emails:
            existing_emails.add(email)
            return email
        counter += 1


# ------------------------------------------------------------------
# Token helpers
# ------------------------------------------------------------------

def _make_token(user_id: str, role: str, email: str = "", admin_level: str = "", permissions: dict = None) -> str:
    payload = {
        "sub": user_id,
        "role": role,
        "email": email,
        "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRY_HOURS),
    }
    if admin_level:
        payload["admin_level"] = admin_level
    if permissions is not None:
        payload["permissions"] = permissions
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def _verify_token(request) -> dict | None:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return None
    token = auth.split(" ", 1)[1]
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except PyJWTError:
        return None


def _term_from_iso_date(date_str: str) -> int:
    try:
        dt = datetime.fromisoformat(str(date_str))
        return 1 if 9 <= dt.month <= 12 else 2
    except Exception:
        return 1


# ------------------------------------------------------------------
# Profile helper – figure out role from ediary_schema tables
# ------------------------------------------------------------------

def _get_profile(user_id: str) -> tuple:
    """
    Return (role, profile_dict) by checking ediary_schema.admins,
    ediary_schema.teachers, then ediary_schema.students.
    """
    db = ediary()

    # Admin?
    admin = db.table("admins").select("*").eq("id", user_id).limit(1).execute()
    if admin.data:
        a = admin.data[0]
        return "admin", {
            "full_name": f"{a['name']} {a['surname']}",
            "class_name": "",
            "admin_level": a.get("admin_level", "regular"),
            "permissions": a.get("permissions") or ALL_ADMIN_PERMISSIONS,
            "profile_picture_url": a.get("profile_picture_url") or None,
            "avatar_emoji": a.get("avatar_emoji") or None,
        }

    # Teacher?
    teacher = db.table("teachers").select("*").eq("id", user_id).limit(1).execute()
    if teacher.data:
        t = teacher.data[0]
        # Resolve class name if class_teacher_of_class_id set
        class_name = ""
        if t.get("class_teacher_of_class_id"):
            db2 = ediary()
            cls = (
                db2.table("classes")
                .select("class_name")
                .eq("id", t["class_teacher_of_class_id"])
                .limit(1)
                .execute()
            )
            if cls.data:
                class_name = cls.data[0]["class_name"]
        # Get email from auth
        teacher_email = ""
        try:
            auth_u = supabase_admin_auth.auth.admin.get_user_by_id(user_id)
            teacher_email = auth_u.user.email if auth_u and auth_u.user else ""
        except Exception:
            pass
        return "teacher", {
            "full_name": f"{t['name']} {t['surname']}",
            "class_name": class_name,
            "profile_picture_url": t.get("profile_picture_url") or None,
            "avatar_emoji": t.get("avatar_emoji") or None,
            "contact_email": teacher_email,
        }

    # Student?
    student = db.table("students").select("*").eq("id", user_id).limit(1).execute()
    if student.data:
        s = student.data[0]
        # Resolve class name
        class_name = ""
        if s.get("class_id"):
            db2 = ediary()
            cls = (
                db2.table("classes")
                .select("class_name")
                .eq("id", s["class_id"])
                .limit(1)
                .execute()
            )
            if cls.data:
                class_name = cls.data[0]["class_name"]
        return "student", {
            "full_name": f"{s['name']} {s['surname']}",
            "class_name": class_name,
            "profile_picture_url": s.get("profile_picture_url") or None,
            "avatar_emoji": s.get("avatar_emoji") or None,
        }

    return None, None


# ------------------------------------------------------------------
# Rate limiting fallback
# ------------------------------------------------------------------
try:
    from django_ratelimit.decorators import ratelimit as _ratelimit
    _HAS_RATELIMIT = True
except ImportError:
    _HAS_RATELIMIT = False
    logger.warning("django-ratelimit not installed – login rate limiting disabled")

    def _ratelimit(**kwargs):
        """No-op decorator fallback."""
        def decorator(fn):
            return fn
        return decorator


# ==================================================================
#  Admin utility functions
# ==================================================================

def _require_admin(request):
    payload = _verify_token(request)
    if not payload or payload.get("role") != "admin":
        return None
    return payload


def _admin_level(payload):
    """Return the effective admin level from a JWT payload."""
    email = (payload.get("email") or "").lower()
    if email == SUPER_ADMIN_EMAIL:
        return "super"
    if email == MASTER_ADMIN_EMAIL:
        return "master"
    return payload.get("admin_level", "regular")


def _admin_has_perm(payload, perm_key):
    """Check if admin has a specific permission.  Super/master always have all perms.
    Regular admins: re-read permissions from the DB to honour real-time revocations."""
    level = _admin_level(payload)
    if level in ("super", "master"):
        return True
    # Re-verify from database instead of trusting JWT claims
    try:
        admin_row = ediary().table("admins").select("permissions").eq("id", payload["sub"]).limit(1).execute()
        if admin_row.data:
            perms = admin_row.data[0].get("permissions") or {}
            return perms.get(perm_key, False)
    except Exception:
        pass
    # Fallback to JWT claims if DB lookup fails
    perms = payload.get("permissions") or {}
    return perms.get(perm_key, False)


# Cache for super/master admin IDs (resolved once per process lifetime)
_super_admin_id_cache = None
_master_admin_id_cache = None


def _is_super_admin_id(uid):
    """Check if a user ID belongs to the super admin."""
    global _super_admin_id_cache
    if _super_admin_id_cache is None:
        try:
            from .supabase_client import supabase_admin_auth as _saa
            users = _saa.auth.admin.list_users()
            for u in users:
                if u.email and u.email.lower() == SUPER_ADMIN_EMAIL:
                    _super_admin_id_cache = str(u.id)
                    break
            if _super_admin_id_cache is None:
                _super_admin_id_cache = ""
        except Exception:
            _super_admin_id_cache = ""
    return uid == _super_admin_id_cache and _super_admin_id_cache != ""


def _is_master_admin_id(uid):
    """Check if a user ID belongs to the master admin."""
    global _master_admin_id_cache
    if _master_admin_id_cache is None:
        try:
            from .supabase_client import supabase_admin_auth as _saa
            users = _saa.auth.admin.list_users()
            for u in users:
                if u.email and u.email.lower() == MASTER_ADMIN_EMAIL:
                    _master_admin_id_cache = str(u.id)
                    break
            if _master_admin_id_cache is None:
                _master_admin_id_cache = ""
        except Exception:
            _master_admin_id_cache = ""
    return uid == _master_admin_id_cache and _master_admin_id_cache != ""
