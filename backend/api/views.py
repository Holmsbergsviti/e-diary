import json
import os
import jwt
from jwt.exceptions import PyJWTError
from datetime import datetime, timedelta, timezone
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from .supabase_client import supabase, table

JWT_SECRET = os.environ.get("JWT_SECRET", "dev-jwt-secret-change-this")
JWT_ALGORITHM = "HS256"
JWT_EXPIRY_HOURS = 8


# ------------------------------------------------------------------
# Token helpers
# ------------------------------------------------------------------

def _make_token(user_id: str, role: str, email: str = "") -> str:
    payload = {
        "sub": user_id,
        "role": role,
        "email": email,
        "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRY_HOURS),
    }
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


# ------------------------------------------------------------------
# Profile helper – determine role by checking profile tables
# ------------------------------------------------------------------

def _get_profile(user_id: str) -> tuple:
    """Return (role, profile_dict) or (None, None)."""

    # Admin?
    result = table("admins").select("*").eq("id", user_id).maybe_single().execute()
    if result.data:
        return "admin", result.data

    # Teacher?
    result = (
        table("teachers")
        .select("*, classes(class_name)")
        .eq("id", user_id)
        .maybe_single()
        .execute()
    )
    if result.data:
        profile = result.data
        cls = profile.pop("classes", None) or {}
        profile["class_name"] = cls.get("class_name", "")
        return "teacher", profile

    # Student?
    result = (
        table("students")
        .select("*, classes(class_name)")
        .eq("id", user_id)
        .maybe_single()
        .execute()
    )
    if result.data:
        profile = result.data
        cls = profile.pop("classes", None) or {}
        profile["class_name"] = cls.get("class_name", "")
        return "student", profile

    return None, None


# ------------------------------------------------------------------
# Login – authenticate via Supabase Auth
# ------------------------------------------------------------------

@csrf_exempt
def login(request):
    if request.method != "POST":
        return JsonResponse({"message": "Method not allowed"}, status=405)

    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({"message": "Invalid JSON"}, status=400)

    email = data.get("email", "").strip()
    password = data.get("password", "")

    if not email or not password:
        return JsonResponse({"message": "Email and password required"}, status=400)

    # Authenticate with Supabase Auth
    try:
        auth_response = supabase.auth.sign_in_with_password(
            {"email": email, "password": password}
        )
    except Exception:
        return JsonResponse({"message": "Invalid credentials"}, status=401)

    if not auth_response.user:
        return JsonResponse({"message": "Invalid credentials"}, status=401)

    user_id = str(auth_response.user.id)
    user_email = auth_response.user.email or email

    # Determine role from profile tables
    role, profile = _get_profile(user_id)
    if not role or not profile:
        return JsonResponse({"message": "User profile not found"}, status=404)

    full_name = f"{profile['name']} {profile['surname']}"
    token = _make_token(user_id, role, user_email)

    return JsonResponse({
        "token": token,
        "user": {
            "id": user_id,
            "email": user_email,
            "full_name": full_name,
            "role": role,
            "class_name": profile.get("class_name", ""),
        },
    })


# ------------------------------------------------------------------
# Current user profile
# ------------------------------------------------------------------

@csrf_exempt
def me(request):
    payload = _verify_token(request)
    if not payload:
        return JsonResponse({"message": "Unauthorized"}, status=401)

    user_id = payload["sub"]
    role, profile = _get_profile(user_id)

    if not role or not profile:
        return JsonResponse({"message": "User not found"}, status=404)

    return JsonResponse({
        "id": user_id,
        "email": payload.get("email", ""),
        "full_name": f"{profile['name']} {profile['surname']}",
        "role": role,
        "class_name": profile.get("class_name", ""),
    })


# ------------------------------------------------------------------
# Grades
# ------------------------------------------------------------------

@csrf_exempt
def grades(request):
    payload = _verify_token(request)
    if not payload:
        return JsonResponse({"message": "Unauthorized"}, status=401)

    result = (
        table("grades")
        .select("id, assessment_name, percentage, grade_code, date_taken, subjects(name)")
        .eq("student_id", payload["sub"])
        .order("date_taken", desc=True)
        .execute()
    )

    rows = []
    for row in (result.data or []):
        subject = (row.get("subjects") or {}).get("name", "")
        rows.append({
            "id": row["id"],
            "subject": subject,
            "assessment_name": row["assessment_name"],
            "percentage": row.get("percentage"),
            "grade_code": row.get("grade_code", ""),
            "date": row["date_taken"],
        })

    return JsonResponse({"grades": rows})


# ------------------------------------------------------------------
# Attendance
# ------------------------------------------------------------------

@csrf_exempt
def attendance(request):
    payload = _verify_token(request)
    if not payload:
        return JsonResponse({"message": "Unauthorized"}, status=401)

    result = (
        table("attendance")
        .select("id, date_recorded, status, classes(class_name)")
        .eq("student_id", payload["sub"])
        .order("date_recorded", desc=True)
        .execute()
    )

    rows = []
    for row in (result.data or []):
        class_name = (row.get("classes") or {}).get("class_name", "")
        rows.append({
            "id": row["id"],
            "date": row["date_recorded"],
            "status": row["status"],
            "class_name": class_name,
        })

    return JsonResponse({"attendance": rows})


# ------------------------------------------------------------------
# Schedule (no table in current schema – returns empty list)
# ------------------------------------------------------------------

@csrf_exempt
def schedule(request):
    payload = _verify_token(request)
    if not payload:
        return JsonResponse({"message": "Unauthorized"}, status=401)

    return JsonResponse({"schedule": []})


# ------------------------------------------------------------------
# Announcements (no table in current schema – returns empty list)
# ------------------------------------------------------------------

@csrf_exempt
def announcements(request):
    payload = _verify_token(request)
    if not payload:
        return JsonResponse({"message": "Unauthorized"}, status=401)

    return JsonResponse({"announcements": []})

