import json
import os
import jwt
from jwt.exceptions import PyJWTError
from datetime import datetime, timedelta, timezone
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from .supabase_client import supabase

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
# Profile helper – figure out role from the public tables
# ------------------------------------------------------------------

def _get_profile(user_id: str) -> tuple:
    """
    Return (role, profile_dict) for the given auth user id.

    Checks public.teachers then public.students.
    The students table is denormalised – one row per subject – so we
    grab the first row for name / year info.
    """
    # Teacher?
    teacher = (
        supabase.table("teachers")
        .select("*")
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    if teacher.data:
        t = teacher.data[0]
        return "teacher", {
            "full_name": f"Teacher (id {t['id']})",
            "class_name": f"{t.get('class_teacher_grade', '')}{t.get('class_teacher_letter', '')}".strip(),
        }

    # Student?
    student = (
        supabase.table("students")
        .select("*")
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    if student.data:
        s = student.data[0]
        full_name = f"{s['Name']} {s['Surname']}"
        class_name = f"{s.get('year', '')}{s.get('Letter', '')}".strip()
        return "student", {"full_name": full_name, "class_name": class_name}

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
    if not role:
        # No profile row yet – default to student with basic info
        role = "student"
        profile = {"full_name": user_email.split("@")[0], "class_name": ""}

    token = _make_token(user_id, role, user_email)

    return JsonResponse({
        "token": token,
        "user": {
            "id": user_id,
            "email": user_email,
            "full_name": profile["full_name"],
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

    if not role:
        role = "student"
        profile = {
            "full_name": payload.get("email", "").split("@")[0],
            "class_name": "",
        }

    return JsonResponse({
        "id": user_id,
        "email": payload.get("email", ""),
        "full_name": profile["full_name"],
        "role": role,
        "class_name": profile.get("class_name", ""),
    })


# ------------------------------------------------------------------
# Grades – read from denormalised students table
# ------------------------------------------------------------------

@csrf_exempt
def grades(request):
    payload = _verify_token(request)
    if not payload:
        return JsonResponse({"message": "Unauthorized"}, status=401)

    # Each student row contains a Subject FK and a Mark
    result = (
        supabase.table("students")
        .select("id, Subject, Mark")
        .eq("user_id", payload["sub"])
        .execute()
    )

    # Build a subject-id → name lookup
    subj_result = supabase.table("subjects").select("Subject ID, name").execute()
    subj_map = {s["Subject ID"]: s["name"] for s in (subj_result.data or [])}

    rows = []
    for row in (result.data or []):
        subj_name = subj_map.get(row.get("Subject"), f"Subject {row.get('Subject', '?')}")
        rows.append({
            "id": row["id"],
            "subject": subj_name,
            "mark": row.get("Mark", ""),
        })

    return JsonResponse({"grades": rows})


# ------------------------------------------------------------------
# Diary entries
# ------------------------------------------------------------------

@csrf_exempt
def diary_entries(request):
    payload = _verify_token(request)
    if not payload:
        return JsonResponse({"message": "Unauthorized"}, status=401)

    if request.method == "GET":
        result = (
            supabase.table("diary_entries")
            .select("*")
            .eq("user_id", payload["sub"])
            .order("created_at", desc=True)
            .execute()
        )
        return JsonResponse({"entries": result.data or []})

    if request.method == "POST":
        try:
            data = json.loads(request.body)
        except json.JSONDecodeError:
            return JsonResponse({"message": "Invalid JSON"}, status=400)

        entry = {
            "user_id": payload["sub"],
            "title": data.get("title", ""),
            "content": data.get("content", ""),
        }
        result = supabase.table("diary_entries").insert(entry).execute()
        return JsonResponse({"entry": result.data[0] if result.data else {}}, status=201)

    return JsonResponse({"message": "Method not allowed"}, status=405)


# ------------------------------------------------------------------
# Schedule – no schedule table exists yet; return empty
# ------------------------------------------------------------------

@csrf_exempt
def schedule(request):
    payload = _verify_token(request)
    if not payload:
        return JsonResponse({"message": "Unauthorized"}, status=401)

    return JsonResponse({"schedule": []})


# ------------------------------------------------------------------
# Announcements – no announcements table exists; return empty
# ------------------------------------------------------------------

@csrf_exempt
def announcements(request):
    payload = _verify_token(request)
    if not payload:
        return JsonResponse({"message": "Unauthorized"}, status=401)

    return JsonResponse({"announcements": []})

