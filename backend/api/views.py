import json
import os
import jwt
from jwt.exceptions import PyJWTError
from datetime import datetime, timedelta, timezone
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from .supabase_client import supabase, supabase_auth, ediary

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
        return "teacher", {
            "full_name": f"{t['name']} {t['surname']}",
            "class_name": class_name,
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
        }

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

    # Authenticate with Supabase Auth (use dedicated auth client so the
    # data client's service-role header is never overwritten)
    try:
        auth_response = supabase_auth.auth.sign_in_with_password(
            {"email": email, "password": password}
        )
    except Exception as exc:
        return JsonResponse({"message": "Invalid credentials"}, status=401)

    if not auth_response.user:
        return JsonResponse({"message": "Invalid credentials"}, status=401)

    user_id = str(auth_response.user.id)
    user_email = auth_response.user.email or email

    # Determine role from ediary_schema profile tables
    role, profile = _get_profile(user_id)
    if not role:
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
# Grades – read from ediary_schema.grades + subjects
# ------------------------------------------------------------------

@csrf_exempt
def grades(request):
    payload = _verify_token(request)
    if not payload:
        return JsonResponse({"message": "Unauthorized"}, status=401)

    db = ediary()
    result = (
        db.table("grades")
        .select("id, subject_id, assessment_name, percentage, grade_code, date_taken")
        .eq("student_id", payload["sub"])
        .order("date_taken", desc=True)
        .execute()
    )

    # Build subject-id → name lookup
    db2 = ediary()
    subj_result = db2.table("subjects").select("id, name, color_code").execute()
    subj_map = {s["id"]: s for s in (subj_result.data or [])}

    rows = []
    for row in (result.data or []):
        subj = subj_map.get(row.get("subject_id"), {})
        rows.append({
            "id": row["id"],
            "subject": subj.get("name", "Unknown"),
            "subject_color": subj.get("color_code", "#607D8B"),
            "assessment": row.get("assessment_name", ""),
            "percentage": row.get("percentage"),
            "grade_code": row.get("grade_code", ""),
            "date": row.get("date_taken", ""),
        })

    return JsonResponse({"grades": rows})


# ------------------------------------------------------------------
# Subjects – return student's enrolled subjects
# ------------------------------------------------------------------

@csrf_exempt
def subjects(request):
    payload = _verify_token(request)
    if not payload:
        return JsonResponse({"message": "Unauthorized"}, status=401)

    db = ediary()
    enrolments = (
        db.table("student_subjects")
        .select("subject_id")
        .eq("student_id", payload["sub"])
        .execute()
    )
    subject_ids = [e["subject_id"] for e in (enrolments.data or [])]

    if not subject_ids:
        return JsonResponse({"subjects": []})

    db2 = ediary()
    result = (
        db2.table("subjects")
        .select("id, name, color_code")
        .in_("id", subject_ids)
        .execute()
    )

    return JsonResponse({"subjects": result.data or []})


# ------------------------------------------------------------------
# Diary entries (personal journal)
# ------------------------------------------------------------------

@csrf_exempt
def diary_entries(request):
    payload = _verify_token(request)
    if not payload:
        return JsonResponse({"message": "Unauthorized"}, status=401)

    db = ediary()

    if request.method == "GET":
        result = (
            db.table("entries")
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
            "mood": data.get("mood", ""),
        }
        if data.get("subject_id"):
            entry["subject_id"] = data["subject_id"]

        db2 = ediary()
        result = db2.table("entries").insert(entry).execute()
        return JsonResponse({"entry": result.data[0] if result.data else {}}, status=201)

    return JsonResponse({"message": "Method not allowed"}, status=405)


# ------------------------------------------------------------------
# Attendance
# ------------------------------------------------------------------

@csrf_exempt
def attendance(request):
    payload = _verify_token(request)
    if not payload:
        return JsonResponse({"message": "Unauthorized"}, status=401)

    db = ediary()
    result = (
        db.table("attendance")
        .select("id, date_recorded, status, class_id")
        .eq("student_id", payload["sub"])
        .order("date_recorded", desc=True)
        .execute()
    )

    return JsonResponse({"attendance": result.data or []})


# ------------------------------------------------------------------
# Schedule – returns timetable for students OR teachers
# ------------------------------------------------------------------

@csrf_exempt
def schedule(request):
    payload = _verify_token(request)
    if not payload:
        return JsonResponse({"message": "Unauthorized"}, status=401)

    user_id = payload["sub"]
    role = payload.get("role", "student")

    db = ediary()

    if role == "teacher":
        # Teacher sees their own schedule
        result = (
            db.table("schedule")
            .select("id, subject_id, class_id, day_of_week, period, room")
            .eq("teacher_id", user_id)
            .order("day_of_week")
            .order("period")
            .execute()
        )
    else:
        # Student: get their class_id, return schedule for that class
        db2 = ediary()
        student = db2.table("students").select("class_id").eq("id", user_id).limit(1).execute()
        class_id = student.data[0]["class_id"] if student.data else None
        if not class_id:
            return JsonResponse({"schedule": []})
        result = (
            ediary().table("schedule")
            .select("id, subject_id, class_id, day_of_week, period, room")
            .eq("class_id", class_id)
            .order("day_of_week")
            .order("period")
            .execute()
        )

    # Build subject + class name lookup
    subj_result = ediary().table("subjects").select("id, name, color_code").execute()
    subj_map = {s["id"]: s for s in (subj_result.data or [])}

    cls_result = ediary().table("classes").select("id, class_name").execute()
    cls_map = {c["id"]: c["class_name"] for c in (cls_result.data or [])}

    rows = []
    for slot in (result.data or []):
        subj = subj_map.get(slot["subject_id"], {})
        rows.append({
            "id": slot["id"],
            "subject": subj.get("name", "Unknown"),
            "subject_color": subj.get("color_code", "#607D8B"),
            "subject_id": slot["subject_id"],
            "class_id": slot["class_id"],
            "class_name": cls_map.get(slot["class_id"], ""),
            "day_of_week": slot["day_of_week"],
            "period": slot["period"],
            "room": slot.get("room", ""),
        })

    return JsonResponse({"schedule": rows})


# ------------------------------------------------------------------
# Teacher: get students for a class + subject (for attendance)
# ------------------------------------------------------------------

@csrf_exempt
def teacher_class_students(request):
    payload = _verify_token(request)
    if not payload or payload.get("role") != "teacher":
        return JsonResponse({"message": "Unauthorized"}, status=401)

    class_id = request.GET.get("class_id")
    subject_id = request.GET.get("subject_id")

    if not class_id or not subject_id:
        return JsonResponse({"message": "class_id and subject_id required"}, status=400)

    # Get students in this class who are enrolled in this subject
    db = ediary()
    students_in_class = (
        db.table("students")
        .select("id, name, surname")
        .eq("class_id", class_id)
        .order("surname")
        .execute()
    )

    if not students_in_class.data:
        return JsonResponse({"students": []})

    student_ids = [s["id"] for s in students_in_class.data]

    # Filter to those enrolled in this subject
    db2 = ediary()
    enrolments = (
        db2.table("student_subjects")
        .select("student_id")
        .eq("subject_id", subject_id)
        .in_("student_id", student_ids)
        .execute()
    )
    enrolled_ids = {e["student_id"] for e in (enrolments.data or [])}

    students = [
        {"id": s["id"], "name": s["name"], "surname": s["surname"]}
        for s in students_in_class.data
        if s["id"] in enrolled_ids
    ]

    return JsonResponse({"students": students})


# ------------------------------------------------------------------
# Teacher: submit / view attendance
# ------------------------------------------------------------------

@csrf_exempt
def teacher_attendance(request):
    payload = _verify_token(request)
    if not payload or payload.get("role") != "teacher":
        return JsonResponse({"message": "Unauthorized"}, status=401)

    teacher_id = payload["sub"]

    if request.method == "GET":
        # Get existing attendance for a class+subject+date
        class_id = request.GET.get("class_id")
        subject_id = request.GET.get("subject_id")
        date = request.GET.get("date")
        if not class_id or not subject_id or not date:
            return JsonResponse({"message": "class_id, subject_id, and date required"}, status=400)

        db = ediary()
        result = (
            db.table("attendance")
            .select("id, student_id, status, comment")
            .eq("class_id", class_id)
            .eq("subject_id", subject_id)
            .eq("date_recorded", date)
            .eq("recorded_by_teacher_id", teacher_id)
            .execute()
        )
        return JsonResponse({"attendance": result.data or []})

    if request.method == "POST":
        try:
            data = json.loads(request.body)
        except json.JSONDecodeError:
            return JsonResponse({"message": "Invalid JSON"}, status=400)

        records = data.get("records", [])
        class_id = data.get("class_id")
        subject_id = data.get("subject_id")
        date = data.get("date")

        if not records or not class_id or not subject_id or not date:
            return JsonResponse({"message": "records, class_id, subject_id, and date required"}, status=400)

        # Delete existing attendance for this teacher/class/subject/date
        db = ediary()
        db.table("attendance").delete()\
            .eq("class_id", class_id)\
            .eq("subject_id", subject_id)\
            .eq("date_recorded", date)\
            .eq("recorded_by_teacher_id", teacher_id)\
            .execute()

        # Insert new records
        rows = []
        for rec in records:
            rows.append({
                "student_id": rec["student_id"],
                "class_id": class_id,
                "subject_id": subject_id,
                "date_recorded": date,
                "status": rec.get("status", "Present"),
                "comment": rec.get("comment", ""),
                "recorded_by_teacher_id": teacher_id,
            })

        db2 = ediary()
        result = db2.table("attendance").insert(rows).execute()
        return JsonResponse({"saved": len(result.data or [])}, status=201)

    return JsonResponse({"message": "Method not allowed"}, status=405)


# ------------------------------------------------------------------
# Announcements – no announcements table exists; return empty
# ------------------------------------------------------------------

@csrf_exempt
def announcements(request):
    payload = _verify_token(request)
    if not payload:
        return JsonResponse({"message": "Unauthorized"}, status=401)

    return JsonResponse({"announcements": []})

