import json
import os
import bcrypt
import jwt
from jwt.exceptions import PyJWTError
from datetime import datetime, timedelta, timezone
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from .supabase_client import supabase

JWT_SECRET = os.environ.get("JWT_SECRET", "dev-jwt-secret-change-this")
JWT_ALGORITHM = "HS256"
JWT_EXPIRY_HOURS = 8


def _make_token(user_id: int, role: str) -> str:
    payload = {
        "sub": user_id,
        "role": role,
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


@csrf_exempt
def login(request):
    if request.method != "POST":
        return JsonResponse({"message": "Method not allowed"}, status=405)

    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({"message": "Invalid JSON"}, status=400)

    username = data.get("username", "").strip()
    password = data.get("password", "")

    if not username or not password:
        return JsonResponse({"message": "Username and password required"}, status=400)

    result = supabase.table("users").select("*").eq("username", username).single().execute()
    user = result.data

    if not user:
        return JsonResponse({"message": "Invalid credentials"}, status=401)

    stored_hash = user.get("password_hash", "")
    if isinstance(stored_hash, str):
        stored_hash = stored_hash.encode()

    if not bcrypt.checkpw(password.encode(), stored_hash):
        return JsonResponse({"message": "Invalid credentials"}, status=401)

    token = _make_token(user["id"], user.get("role", "student"))
    return JsonResponse({
        "token": token,
        "user": {
            "id": user["id"],
            "username": user["username"],
            "full_name": user.get("full_name", ""),
            "role": user.get("role", "student"),
            "class_name": user.get("class_name", ""),
        },
    })


@csrf_exempt
def me(request):
    payload = _verify_token(request)
    if not payload:
        return JsonResponse({"message": "Unauthorized"}, status=401)

    result = supabase.table("users").select(
        "id, username, full_name, role, class_name, email"
    ).eq("id", payload["sub"]).single().execute()
    user = result.data

    if not user:
        return JsonResponse({"message": "User not found"}, status=404)

    return JsonResponse(user)


@csrf_exempt
def grades(request):
    payload = _verify_token(request)
    if not payload:
        return JsonResponse({"message": "Unauthorized"}, status=401)

    result = supabase.table("grades").select(
        "id, value, date, grade_type, description, subjects(name)"
    ).eq("student_id", payload["sub"]).order("date", desc=True).execute()

    rows = []
    for row in (result.data or []):
        subject = (row.get("subjects") or {}).get("name", "")
        rows.append({
            "id": row["id"],
            "subject": subject,
            "value": row["value"],
            "date": row["date"],
            "grade_type": row.get("grade_type", ""),
            "description": row.get("description", ""),
        })

    return JsonResponse({"grades": rows})


@csrf_exempt
def schedule(request):
    payload = _verify_token(request)
    if not payload:
        return JsonResponse({"message": "Unauthorized"}, status=401)

    user_res = supabase.table("users").select("class_id").eq("id", payload["sub"]).single().execute()
    user = user_res.data
    if not user or not user.get("class_id"):
        return JsonResponse({"schedule": []})

    result = supabase.table("schedule").select(
        "id, day_of_week, period, room, subjects(name), teachers:teacher_id(full_name)"
    ).eq("class_id", user["class_id"]).order("day_of_week").order("period").execute()

    rows = []
    for row in (result.data or []):
        subject = (row.get("subjects") or {}).get("name", "")
        teacher = (row.get("teachers") or {}).get("full_name", "")
        rows.append({
            "id": row["id"],
            "day_of_week": row["day_of_week"],
            "period": row["period"],
            "room": row.get("room", ""),
            "subject": subject,
            "teacher": teacher,
        })

    return JsonResponse({"schedule": rows})


@csrf_exempt
def announcements(request):
    payload = _verify_token(request)
    if not payload:
        return JsonResponse({"message": "Unauthorized"}, status=401)

    result = supabase.table("announcements").select(
        "id, title, body, created_at, users:author_id(full_name)"
    ).order("created_at", desc=True).limit(20).execute()

    rows = []
    for row in (result.data or []):
        author = (row.get("users") or {}).get("full_name", "")
        rows.append({
            "id": row["id"],
            "title": row["title"],
            "body": row.get("body", ""),
            "created_at": row["created_at"],
            "author": author,
        })

    return JsonResponse({"announcements": rows})

