import json
import logging
import os
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
    import secrets as _s
    _jwt_secret = _s.token_urlsafe(48)
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
    "holidays": True, "import": True,
}


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

@csrf_exempt
@_ratelimit(key="ip", rate="5/m", method="POST", block=False)
def login(request):
    if request.method != "POST":
        return JsonResponse({"message": "Method not allowed"}, status=405)

    # Check rate limit
    if getattr(request, "limited", False):
        return JsonResponse({"message": "Too many login attempts. Please try again later."}, status=429)

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

    # Determine admin level from email (super/master override DB value)
    admin_level = profile.get("admin_level", "")
    permissions = profile.get("permissions") or {}
    if role == "admin":
        if user_email.lower() == SUPER_ADMIN_EMAIL:
            admin_level = "super"
            permissions = ALL_ADMIN_PERMISSIONS
        elif user_email.lower() == MASTER_ADMIN_EMAIL:
            admin_level = "master"
            permissions = ALL_ADMIN_PERMISSIONS

    token = _make_token(user_id, role, user_email, admin_level, permissions if role == "admin" else None)

    resp = {
        "token": token,
        "user": {
            "id": user_id,
            "email": user_email,
            "full_name": profile["full_name"],
            "role": role,
            "class_name": profile.get("class_name", ""),
        },
    }
    if role == "admin":
        resp["user"]["admin_level"] = admin_level
        resp["user"]["permissions"] = permissions

    return JsonResponse(resp)


# ------------------------------------------------------------------
# Current user profile
# ------------------------------------------------------------------

@csrf_exempt
def me(request):
    payload = _verify_token(request)
    if not payload:
        return JsonResponse({"message": "Unauthorized"}, status=401)

    user_id = payload["sub"]

    # PATCH = update email or password
    if request.method in ("PATCH", "PUT"):
        try:
            data = json.loads(request.body)
        except json.JSONDecodeError:
            return JsonResponse({"message": "Invalid JSON"}, status=400)

        updates = {}
        new_email = data.get("email", "").strip()
        new_password = data.get("password", "").strip()

        if new_email:
            updates["email"] = new_email
        if new_password:
            if len(new_password) < 8:
                return JsonResponse({"message": "Password must be at least 8 characters"}, status=400)
            updates["password"] = new_password

        if not updates:
            return JsonResponse({"message": "Nothing to update"}, status=400)

        try:
            supabase_admin_auth.auth.admin.update_user_by_id(user_id, updates)
        except Exception as exc:
            logger.exception("Profile update failed")
            return JsonResponse({"message": "Failed to update profile"}, status=400)

        return JsonResponse({"message": "Updated successfully"})

    role, profile = _get_profile(user_id)

    if not role:
        role = "student"
        profile = {
            "full_name": payload.get("email", "").split("@")[0],
            "class_name": "",
        }

    resp = {
        "id": user_id,
        "email": payload.get("email", ""),
        "full_name": profile["full_name"],
        "role": role,
        "class_name": profile.get("class_name", ""),
    }
    if role == "admin":
        email_lower = payload.get("email", "").lower()
        if email_lower == SUPER_ADMIN_EMAIL:
            resp["admin_level"] = "super"
            resp["permissions"] = ALL_ADMIN_PERMISSIONS
        elif email_lower == MASTER_ADMIN_EMAIL:
            resp["admin_level"] = "master"
            resp["permissions"] = ALL_ADMIN_PERMISSIONS
        else:
            resp["admin_level"] = profile.get("admin_level", "regular")
            resp["permissions"] = profile.get("permissions") or ALL_ADMIN_PERMISSIONS

    return JsonResponse(resp)


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
        .select("id, subject_id, assessment_name, percentage, grade_code, date_taken, comment, category, term")
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
            "subject_id": row.get("subject_id"),
            "subject_color": subj.get("color_code", "#607D8B"),
            "assessment": row.get("assessment_name", ""),
            "percentage": row.get("percentage"),
            "grade_code": row.get("grade_code", ""),
            "date": row.get("date_taken", ""),
            "comment": row.get("comment", ""),
            "category": row.get("category", "other"),
            "term": row.get("term", 1),
        })

    # Get enrolled subjects so the frontend can show them even without grades
    enrolled_result = (
        ediary().table("student_subjects")
        .select("subject_id")
        .eq("student_id", payload["sub"])
        .execute()
    )
    enrolled = []
    for e in (enrolled_result.data or []):
        subj = subj_map.get(e["subject_id"])
        if subj:
            enrolled.append({
                "subject_id": subj["id"],
                "subject": subj["name"],
                "subject_color": subj.get("color_code", "#607D8B"),
            })
    enrolled.sort(key=lambda x: x["subject"])

    return JsonResponse({"grades": rows, "enrolled_subjects": enrolled})


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
        .select("id, date_recorded, status, class_id, subject_id, comment")
        .eq("student_id", payload["sub"])
        .order("date_recorded", desc=True)
        .execute()
    )

    # Build subject lookup
    subj_result = ediary().table("subjects").select("id, name").execute()
    subj_map = {s["id"]: s["name"] for s in (subj_result.data or [])}

    rows = []
    for r in (result.data or []):
        row = {
            "id": r["id"],
            "date_recorded": r["date_recorded"],
            "status": r["status"],
            "class_id": r["class_id"],
            "subject_id": r.get("subject_id", ""),
            "subject": subj_map.get(r.get("subject_id"), ""),
            "comment": r.get("comment", ""),
        }
        rows.append(row)

    return JsonResponse({"attendance": rows})


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
        # PLUS any group-class schedule entries (via student_subjects.group_class_id)
        db2 = ediary()
        student = db2.table("students").select("class_id").eq("id", user_id).limit(1).execute()
        class_id = student.data[0]["class_id"] if student.data else None
        if not class_id:
            return JsonResponse({"schedule": []})

        # Get group class IDs from student_subjects
        ss_result = (
            ediary().table("student_subjects")
            .select("group_class_id")
            .eq("student_id", user_id)
            .execute()
        )
        group_class_ids = [
            r["group_class_id"] for r in (ss_result.data or [])
            if r.get("group_class_id")
        ]

        # Fetch schedule for the student's own class
        result = (
            ediary().table("schedule")
            .select("id, subject_id, class_id, day_of_week, period, room")
            .eq("class_id", class_id)
            .order("day_of_week")
            .order("period")
            .execute()
        )

        # Also fetch schedule entries for any group classes the student is in
        if group_class_ids:
            group_result = (
                ediary().table("schedule")
                .select("id, subject_id, class_id, day_of_week, period, room")
                .in_("class_id", group_class_ids)
                .order("day_of_week")
                .order("period")
                .execute()
            )
            # Merge: group entries fill in slots not already occupied
            existing_slots = {(s["day_of_week"], s["period"]) for s in (result.data or [])}
            for slot in (group_result.data or []):
                key = (slot["day_of_week"], slot["period"])
                if key not in existing_slots:
                    result.data.append(slot)
                    existing_slots.add(key)

    # Build subject + class name lookup
    subj_result = ediary().table("subjects").select("id, name, color_code").execute()
    subj_map = {s["id"]: s for s in (subj_result.data or [])}

    cls_result = ediary().table("classes").select("id, class_name, grade_level").execute()
    cls_map = {c["id"]: c for c in (cls_result.data or [])}

    rows = []
    for slot in (result.data or []):
        subj = subj_map.get(slot["subject_id"], {})
        cls = cls_map.get(slot["class_id"], {})
        gl = cls.get("grade_level", 0)
        cn = cls.get("class_name", "")
        rows.append({
            "id": slot["id"],
            "subject": subj.get("name", "Unknown"),
            "subject_color": subj.get("color_code", "#607D8B"),
            "subject_id": slot["subject_id"],
            "class_id": slot["class_id"],
            "class_name": cn,
            "grade_level": gl,
            "day_of_week": slot["day_of_week"],
            "period": slot["period"],
            "room": slot.get("room", ""),
        })

    # Include study hall sessions
    study_hall_sessions = _get_study_hall_for_schedule(ediary(), user_id, role)

    return JsonResponse({"schedule": rows, "study_hall": study_hall_sessions})


def _get_study_hall_for_schedule(db, user_id, role):
    """Return study hall sessions relevant to this user as schedule-like rows.

    For teachers: sessions they created.
    For students: sessions where they are in the attendance list.
    Returns list of dicts with date, period, room, teacher_name.
    """
    teacher_map = {}
    def _teacher_name(tid):
        if not teacher_map:
            rows = db.table("teachers").select("id, name, surname").execute()
            for t in (rows.data or []):
                teacher_map[t["id"]] = f"{t['surname']} {t['name']}"
        return teacher_map.get(tid, "Study Hall")

    try:
        if role == "teacher":
            result = (
                db.table("study_hall")
                .select("id, date, period, room, teacher_id")
                .eq("teacher_id", user_id)
                .execute()
            )
            return [
                {
                    "date": s["date"],
                    "period": s["period"],
                    "room": s.get("room") or "",
                    "teacher_name": _teacher_name(s["teacher_id"]),
                    "is_study_hall": True,
                }
                for s in (result.data or [])
            ]
        else:
            # Student: find study_hall_attendance rows for this student
            att = (
                db.table("study_hall_attendance")
                .select("study_hall_id")
                .eq("student_id", user_id)
                .execute()
            )
            sh_ids = [a["study_hall_id"] for a in (att.data or [])]
            if not sh_ids:
                return []
            sessions = (
                db.table("study_hall")
                .select("id, date, period, room, teacher_id")
                .in_("id", sh_ids)
                .execute()
            )
            return [
                {
                    "date": s["date"],
                    "period": s["period"],
                    "room": s.get("room") or "",
                    "teacher_name": _teacher_name(s["teacher_id"]),
                    "is_study_hall": True,
                }
                for s in (sessions.data or [])
            ]
    except Exception:
        return []


# ------------------------------------------------------------------
# Teacher: get students for a class + subject (for attendance)
# Looks up the grade level of the given class and returns ALL
# students from that year group enrolled in the subject.
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

    # Load all students once; selection logic below mirrors teacher_marks group behavior
    db = ediary()
    all_students = (
        db.table("students")
        .select("id, name, surname, class_id")
        .order("surname")
        .order("name")
        .execute()
    )
    student_rows = all_students.data or []
    if not student_rows:
        return JsonResponse({"students": []})

    stu_map = {s["id"]: s for s in student_rows}

    # Subject enrolments with optional group_class mapping
    db2 = ediary()
    enrolments = (
        db2.table("student_subjects")
        .select("student_id, group_class_id")
        .eq("subject_id", subject_id)
        .execute()
    )

    enrolled_ids = set()
    for ss in (enrolments.data or []):
        sid = ss.get("student_id")
        if sid not in stu_map:
            continue
        group_class_id = ss.get("group_class_id")
        if group_class_id:
            if group_class_id == class_id:
                enrolled_ids.add(sid)
        elif stu_map[sid].get("class_id") == class_id:
            enrolled_ids.add(sid)

    if not enrolled_ids:
        return JsonResponse({"students": []})

    # Class names for home classes of selected students
    selected_class_ids = sorted(list({stu_map[sid].get("class_id") for sid in enrolled_ids if stu_map[sid].get("class_id")}))
    cls_result = (
        ediary().table("classes")
        .select("id, class_name")
        .in_("id", selected_class_ids)
        .execute()
    ) if selected_class_ids else type('', (), {'data': []})()
    cls_map = {c["id"]: c["class_name"] for c in (cls_result.data or [])}

    students = []
    for s in student_rows:
        if s["id"] in enrolled_ids:
            students.append({
                "id": s["id"],
                "name": s["name"],
                "surname": s["surname"],
                "class_name": cls_map.get(s.get("class_id"), ""),
            })

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
        try:
            result = (
                db.table("attendance")
                .select("id, student_id, status, comment, topic")
                .eq("class_id", class_id)
                .eq("subject_id", subject_id)
                .eq("date_recorded", date)
                .eq("recorded_by_teacher_id", teacher_id)
                .execute()
            )
        except Exception:
            # topic column may not exist yet – retry without it
            result = (
                db.table("attendance")
                .select("id, student_id, status, comment")
                .eq("class_id", class_id)
                .eq("subject_id", subject_id)
                .eq("date_recorded", date)
                .eq("recorded_by_teacher_id", teacher_id)
                .execute()
            )
        # Extract topic from any record (same for all in a session)
        att_rows = result.data or []
        topic = att_rows[0].get("topic", "") if att_rows else ""
        return JsonResponse({"attendance": att_rows, "topic": topic})

    if request.method == "POST":
        try:
            data = json.loads(request.body)
        except json.JSONDecodeError:
            return JsonResponse({"message": "Invalid JSON"}, status=400)

        records = data.get("records", [])
        class_id = data.get("class_id")
        subject_id = data.get("subject_id")
        date = data.get("date")
        topic = data.get("topic", "").strip()

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
                "topic": topic,
                "recorded_by_teacher_id": teacher_id,
            })

        db2 = ediary()
        try:
            result = db2.table("attendance").insert(rows).execute()
        except Exception:
            # topic column may not exist – retry without it
            for r in rows:
                r.pop("topic", None)
            result = db2.table("attendance").insert(rows).execute()

        return JsonResponse({"saved": len(result.data or [])}, status=201)

    return JsonResponse({"message": "Method not allowed"}, status=405)


# ------------------------------------------------------------------
# Announcements – return homework/tasks as announcements for students
# ------------------------------------------------------------------

@csrf_exempt
def announcements(request):
    payload = _verify_token(request)
    if not payload:
        return JsonResponse({"message": "Unauthorized"}, status=401)

    user_id = payload["sub"]
    role = payload.get("role", "student")
    db = ediary()

    if role == "teacher":
        # Teacher sees their own homework
        result = (
            db.table("homework")
            .select("id, subject_id, class_id, title, description, due_date, created_at")
            .eq("teacher_id", user_id)
            .order("due_date", desc=True)
            .execute()
        )
    else:
        # Student: get class_id + group_class_ids from student_subjects
        stu = db.table("students").select("class_id").eq("id", user_id).limit(1).execute()
        class_id = stu.data[0]["class_id"] if stu.data else None

        ss = (
            ediary().table("student_subjects")
            .select("subject_id, group_class_id")
            .eq("student_id", user_id)
            .execute()
        )
        enrolled_subjects = [r["subject_id"] for r in (ss.data or [])]
        group_class_ids = [
            r["group_class_id"] for r in (ss.data or [])
            if r.get("group_class_id")
        ]

        # Get homework where (class_id matches student's class OR group_class_ids)
        # AND subject is one the student is enrolled in
        all_class_ids = group_class_ids[:]
        if class_id:
            all_class_ids.append(class_id)

        if not all_class_ids or not enrolled_subjects:
            return JsonResponse({"announcements": []})

        result = (
            ediary().table("homework")
            .select("id, subject_id, class_id, title, description, due_date, created_at, teacher_id")
            .in_("class_id", all_class_ids)
            .in_("subject_id", enrolled_subjects)
            .order("due_date", desc=True)
            .execute()
        )

    # Build lookups
    subj_result = ediary().table("subjects").select("id, name").execute()
    subj_map = {s["id"]: s["name"] for s in (subj_result.data or [])}

    cls_result = ediary().table("classes").select("id, class_name").execute()
    cls_map = {c["id"]: c["class_name"] for c in (cls_result.data or [])}

    teacher_ids = list({r.get("teacher_id", "") for r in (result.data or []) if r.get("teacher_id")})
    teacher_map = {}
    if teacher_ids:
        t_result = ediary().table("teachers").select("id, name, surname").in_("id", teacher_ids).execute()
        teacher_map = {t["id"]: f"{t['name']} {t['surname']}" for t in (t_result.data or [])}

    # For students, fetch their homework completion statuses
    completion_map = {}  # homework_id -> status
    if role != "teacher":
        hw_ids = [r["id"] for r in (result.data or [])]
        if hw_ids:
            comp_result = (
                ediary().table("homework_completions")
                .select("homework_id, status")
                .eq("student_id", user_id)
                .in_("homework_id", hw_ids)
                .execute()
            )
            for c in (comp_result.data or []):
                completion_map[c["homework_id"]] = c["status"]

    rows = []
    for r in (result.data or []):
        row = {
            "id": r["id"],
            "subject_id": r.get("subject_id", ""),
            "class_id": r.get("class_id", ""),
            "title": r.get("title", ""),
            "body": r.get("description", ""),
            "subject": subj_map.get(r.get("subject_id"), ""),
            "class_name": cls_map.get(r.get("class_id"), ""),
            "due_date": r.get("due_date", ""),
            "created_at": r.get("created_at", ""),
            "author": teacher_map.get(r.get("teacher_id"), ""),
        }
        if role != "teacher":
            row["completion_status"] = completion_map.get(r["id"], "")
        rows.append(row)

    return JsonResponse({"announcements": rows})


# ------------------------------------------------------------------
# Teacher: add a grade
# ------------------------------------------------------------------

@csrf_exempt
def teacher_add_grade(request):
    payload = _verify_token(request)
    if not payload or payload.get("role") != "teacher":
        return JsonResponse({"message": "Unauthorized"}, status=401)

    if request.method != "POST":
        return JsonResponse({"message": "Method not allowed"}, status=405)

    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({"message": "Invalid JSON"}, status=400)

    student_id = data.get("student_id", "").strip()
    subject_id = data.get("subject_id", "").strip()
    assessment_name = data.get("assessment_name", "").strip()
    grade_code = data.get("grade_code", "").strip()
    percentage = data.get("percentage")
    comment = data.get("comment", "").strip()
    date_taken = data.get("date", "").strip()
    category = data.get("category", "other").strip()
    term = data.get("term")

    if not student_id or not subject_id or not grade_code:
        return JsonResponse({"message": "student_id, subject_id, and grade_code are required"}, status=400)

    row = {
        "student_id": student_id,
        "subject_id": subject_id,
        "grade_code": grade_code,
        "created_by_teacher_id": payload["sub"],
    }
    if assessment_name:
        row["assessment_name"] = assessment_name
    if percentage is not None and percentage != "":
        row["percentage"] = float(percentage)
    if comment:
        row["comment"] = comment
    if date_taken:
        row["date_taken"] = date_taken
    else:
        from datetime import date as _date
        row["date_taken"] = _date.today().isoformat()
    if category:
        row["category"] = category
    if term is not None:
        row["term"] = int(term)

    try:
        r = ediary().table("grades").insert(row).execute()
    except Exception as exc:
        logger.exception("teacher_add_grade failed")
        return JsonResponse({"message": "Failed to add grade"}, status=500)

    return JsonResponse({"grade": r.data[0] if r.data else {}}, status=201)


# ------------------------------------------------------------------
# Teacher: edit a grade
# ------------------------------------------------------------------

@csrf_exempt
def teacher_edit_grade(request):
    payload = _verify_token(request)
    if not payload or payload.get("role") != "teacher":
        return JsonResponse({"message": "Unauthorized"}, status=401)

    if request.method != "PATCH":
        return JsonResponse({"message": "Method not allowed"}, status=405)

    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({"message": "Invalid JSON"}, status=400)

    grade_id = data.get("id", "").strip()
    if not grade_id:
        return JsonResponse({"message": "Grade id is required"}, status=400)

    updates = {}
    if "assessment_name" in data:
        updates["assessment_name"] = data["assessment_name"].strip()
    if "grade_code" in data:
        updates["grade_code"] = data["grade_code"].strip()
    if "percentage" in data:
        val = data["percentage"]
        updates["percentage"] = float(val) if val is not None and val != "" else None
    if "comment" in data:
        updates["comment"] = data["comment"].strip() or None
    if "date" in data:
        updates["date_taken"] = data["date"].strip()
    if "category" in data:
        updates["category"] = data["category"].strip() or "other"
    if "term" in data:
        updates["term"] = int(data["term"])

    if not updates:
        return JsonResponse({"message": "Nothing to update"}, status=400)

    try:
        r = (ediary().table("grades").update(updates)
             .eq("id", grade_id)
             .eq("created_by_teacher_id", payload["sub"])
             .execute())
        if not r.data:
            return JsonResponse({"message": "Grade not found or not yours"}, status=403)
    except Exception as exc:
        logger.exception("teacher_edit_grade failed")
        return JsonResponse({"message": "Failed to update grade"}, status=500)

    return JsonResponse({"grade": r.data[0] if r.data else {}})


# ------------------------------------------------------------------
# Teacher: delete a grade
# ------------------------------------------------------------------

@csrf_exempt
def teacher_delete_grade(request):
    payload = _verify_token(request)
    if not payload or payload.get("role") != "teacher":
        return JsonResponse({"message": "Unauthorized"}, status=401)

    if request.method != "DELETE":
        return JsonResponse({"message": "Method not allowed"}, status=405)

    grade_id = request.GET.get("id", "").strip()
    if not grade_id:
        return JsonResponse({"message": "Grade id is required"}, status=400)

    try:
        r = (ediary().table("grades").delete()
             .eq("id", grade_id)
             .eq("created_by_teacher_id", payload["sub"])
             .execute())
        if not r.data:
            return JsonResponse({"message": "Grade not found or not yours"}, status=403)
    except Exception as exc:
        logger.exception("teacher_delete_grade failed")
        return JsonResponse({"message": "Failed to delete grade"}, status=500)

    return JsonResponse({"deleted": True})


# ------------------------------------------------------------------
# Teacher: view marks for students they teach
# For class teachers: also see ALL subjects for their class
# ------------------------------------------------------------------

@csrf_exempt
def teacher_marks(request):
    payload = _verify_token(request)
    if not payload or payload.get("role") != "teacher":
        return JsonResponse({"message": "Unauthorized"}, status=401)

    teacher_id = payload["sub"]

    # Get teacher info (is_class_teacher, class_teacher_of_class_id)
    db = ediary()
    teacher = db.table("teachers").select("*").eq("id", teacher_id).limit(1).execute()
    if not teacher.data:
        return JsonResponse({"message": "Teacher not found"}, status=404)
    t = teacher.data[0]

    # Get teacher's subject/class assignments
    db2 = ediary()
    assignments = db2.table("teacher_assignments").select("subject_id, class_id").eq("teacher_id", teacher_id).execute()

    # Build set of (subject_id, grade_level) pairs the teacher teaches
    db3 = ediary()
    all_classes = db3.table("classes").select("id, class_name, grade_level").execute()
    cls_map = {c["id"]: c for c in (all_classes.data or [])}

    # Build set of (subject_id, class_id) pairs the teacher teaches
    teaching_pairs = []  # [(subject_id, class_id)]
    for a in (assignments.data or []):
        cls = cls_map.get(a["class_id"])
        if cls:
            teaching_pairs.append((a["subject_id"], a["class_id"]))

    # Build list of class_ids per grade_level
    grade_class_map = {}  # grade_level -> [class_ids]
    for c in (all_classes.data or []):
        grade_class_map.setdefault(c["grade_level"], []).append(c["id"])

    # Collect all relevant class_ids
    taught_class_ids = {cid for (_, cid) in teaching_pairs}
    year_levels_taught = {cls_map[cid]["grade_level"] for cid in taught_class_ids if cid in cls_map}

    # If class teacher, note their homeroom class info
    class_teacher_class_id = t.get("class_teacher_of_class_id")
    class_teacher_grade = None
    if t.get("is_class_teacher") and class_teacher_class_id:
        cls_t = cls_map.get(class_teacher_class_id)
        if cls_t:
            class_teacher_grade = cls_t["grade_level"]

    # Get all class_ids for year levels the teacher teaches
    relevant_class_ids = set()
    for gl in year_levels_taught:
        relevant_class_ids.update(grade_class_map.get(gl, []))

    # Also include the class teacher's homeroom class (may be a different year)
    if class_teacher_class_id:
        relevant_class_ids.add(class_teacher_class_id)

    relevant_class_ids = list(relevant_class_ids)
    if not relevant_class_ids:
        return JsonResponse({"groups": []})

    # Get all students in relevant classes
    db4 = ediary()
    students = (
        db4.table("students")
        .select("id, name, surname, class_id")
        .in_("class_id", relevant_class_ids)
        .order("surname")
        .order("name")
        .execute()
    )
    student_map = {s["id"]: s for s in (students.data or [])}
    student_ids = list(student_map.keys())

    if not student_ids:
        return JsonResponse({"groups": []})

    # Get student_subjects (to know which group class each student is in)
    db_ss = ediary()
    all_student_subjects = db_ss.table("student_subjects").select("student_id, subject_id, group_class_id").in_("student_id", student_ids).execute()
    # Build map: (student_id, subject_id) -> group_class_id
    ss_group_map = {}
    for ss in (all_student_subjects.data or []):
        ss_group_map[(ss["student_id"], ss["subject_id"])] = ss.get("group_class_id")

    # Get subjects lookup
    db5 = ediary()
    subjects_result = db5.table("subjects").select("id, name, color_code").execute()
    subj_map = {s["id"]: s for s in (subjects_result.data or [])}

    # Get ALL grades for these students
    db6 = ediary()
    grades_result = (
        db6.table("grades")
        .select("id, student_id, subject_id, assessment_name, grade_code, percentage, date_taken, comment, category, term")
        .in_("student_id", student_ids)
        .order("date_taken", desc=True)
        .execute()
    )

    # ── Fetch stats data for ALL students (used by both class_overview and subject_groups) ──
    att_data = []
    hw_comp_data = []
    beh_data = []
    if student_ids:
        att_data = (
            ediary().table("attendance")
            .select("student_id, subject_id, class_id, date_recorded, status, comment")
            .in_("student_id", student_ids)
            .execute()
        ).data or []

        # All homework for relevant classes
        hw_all = (
            ediary().table("homework")
            .select("id, class_id")
            .in_("class_id", relevant_class_ids)
            .execute()
        ).data or []
        hw_all_ids = [h["id"] for h in hw_all]

        if hw_all_ids:
            hw_comp_data = (
                ediary().table("homework_completions")
                .select("student_id, status")
                .in_("homework_id", hw_all_ids)
                .execute()
            ).data or []

        beh_data = (
            ediary().table("behavioral_entries")
            .select("student_id, entry_type, subject_id, content")
            .in_("student_id", student_ids)
            .execute()
        ).data or []

    def build_student_stats(sid, subject_id=None, class_id=None):
        att_c = {"Present": 0, "Late": 0, "Absent": 0, "Excused": 0}
        att_term = {
            1: {"total": 0, "present_or_late": 0, "absent": 0},
            2: {"total": 0, "present_or_late": 0, "absent": 0},
        }
        att_comment_count = 0
        today = datetime.now().date()
        week_start = today - timedelta(days=today.weekday())
        trend = {
            "today": {"total": 0, "present_or_late": 0, "absent": 0},
            "week": {"total": 0, "present_or_late": 0, "absent": 0},
        }
        for a in att_data:
            if a["student_id"] == sid:
                if subject_id and a.get("subject_id") != subject_id:
                    continue
                if class_id and a.get("class_id") != class_id:
                    continue
                st = a.get("status", "Present")
                if st in att_c:
                    att_c[st] += 1
                term_no = _term_from_iso_date(a.get("date_recorded"))
                att_term[term_no]["total"] += 1
                if st in ("Present", "Late"):
                    att_term[term_no]["present_or_late"] += 1
                if st == "Absent":
                    att_term[term_no]["absent"] += 1
                if (a.get("comment") or "").strip():
                    att_comment_count += 1

                try:
                    d = datetime.fromisoformat(str(a.get("date_recorded"))).date()
                except Exception:
                    d = None
                if d:
                    if d == today:
                        trend["today"]["total"] += 1
                        if st in ("Present", "Late"):
                            trend["today"]["present_or_late"] += 1
                        if st == "Absent":
                            trend["today"]["absent"] += 1
                    if week_start <= d <= today:
                        trend["week"]["total"] += 1
                        if st in ("Present", "Late"):
                            trend["week"]["present_or_late"] += 1
                        if st == "Absent":
                            trend["week"]["absent"] += 1
        att_total = sum(att_c.values())

        # ── Absent-today and attendance-conflict detection (always unfiltered) ──
        today_statuses = {}  # (subject_id, class_id) -> status
        all_att_comments = 0
        for a in att_data:
            if a["student_id"] != sid:
                continue
            if (a.get("comment") or "").strip():
                all_att_comments += 1
            try:
                d = datetime.fromisoformat(str(a.get("date_recorded"))).date()
            except Exception:
                d = None
            if d == today:
                key = (a.get("subject_id"), a.get("class_id"))
                today_statuses[key] = a.get("status", "Present")

        has_absent_today = any(s == "Absent" for s in today_statuses.values())
        has_present_today = any(s in ("Present", "Late") for s in today_statuses.values())
        absent_today = has_absent_today
        attendance_conflict_today = has_absent_today and has_present_today

        # ── Comment counts from ALL 3 sources ──
        # Grade comments
        grade_comments_filtered = 0
        grade_comments_all = 0
        for g in (grades_result.data or []):
            if g["student_id"] == sid and (g.get("comment") or "").strip():
                grade_comments_all += 1
                if not subject_id or g.get("subject_id") == subject_id:
                    grade_comments_filtered += 1

        # Behavioral comments
        beh_comments_filtered = 0
        beh_comments_all = 0
        for b in beh_data:
            if b["student_id"] == sid and (b.get("content") or "").strip():
                beh_comments_all += 1
                if not subject_id or b.get("subject_id") == subject_id:
                    beh_comments_filtered += 1

        total_comments = att_comment_count + grade_comments_filtered + beh_comments_filtered
        total_comments_all = all_att_comments + grade_comments_all + beh_comments_all

        pcts = [
            g["percentage"] for g in (grades_result.data or [])
            if g["student_id"] == sid and g.get("percentage") is not None
        ]
        grade_avg = round(sum(pcts) / len(pcts), 1) if pcts else None

        hwc_c = {"completed": 0, "partial": 0, "not_done": 0}
        for h in hw_comp_data:
            if h["student_id"] == sid:
                st = h.get("status", "")
                if st in hwc_c:
                    hwc_c[st] += 1

        beh_c = {"positive": 0, "negative": 0, "note": 0}
        for b in beh_data:
            if b["student_id"] == sid:
                bt = b.get("entry_type", "note")
                if bt in beh_c:
                    beh_c[bt] += 1

        return {
            "attendance": {"total": att_total, **att_c},
            "attendance_by_term": {
                "term_1": {
                    "total": att_term[1]["total"],
                    "attendance_pct": round((att_term[1]["present_or_late"] / att_term[1]["total"]) * 100, 1) if att_term[1]["total"] else None,
                    "absent": att_term[1]["absent"],
                },
                "term_2": {
                    "total": att_term[2]["total"],
                    "attendance_pct": round((att_term[2]["present_or_late"] / att_term[2]["total"]) * 100, 1) if att_term[2]["total"] else None,
                    "absent": att_term[2]["absent"],
                },
            },
            "absent_today": absent_today,
            "attendance_conflict_today": attendance_conflict_today,
            "comments": {
                "count": total_comments,
                "all_count": total_comments_all,
            },
            "attendance_trends": {
                "today": {
                    "attendance_pct": round((trend["today"]["present_or_late"] / trend["today"]["total"]) * 100, 1) if trend["today"]["total"] else None,
                    "absent": trend["today"]["absent"],
                },
                "week": {
                    "attendance_pct": round((trend["week"]["present_or_late"] / trend["week"]["total"]) * 100, 1) if trend["week"]["total"] else None,
                    "absent": trend["week"]["absent"],
                },
            },
            "grades": {"count": len(pcts), "average": grade_avg},
            "homework": hwc_c,
            "behavioral": beh_c,
        }

    # Build response
    groups = []

    # === CLASS TEACHER OVERVIEW (first tab) ===
    if class_teacher_class_id and t.get("is_class_teacher"):
        homeroom_students = [s for s in (students.data or []) if s["class_id"] == class_teacher_class_id]

        if homeroom_students:
            # Build enrollment map: student_id -> set of subject_ids
            enrollment_map = {}
            for ss in (all_student_subjects.data or []):
                enrollment_map.setdefault(ss["student_id"], set()).add(ss["subject_id"])

            overview_students = []
            for s in sorted(homeroom_students, key=lambda x: (x.get("surname", "").lower(), x.get("name", "").lower())):
                enrolled_subjects = enrollment_map.get(s["id"], set())
                subjects_data = []
                for subj_id in sorted(enrolled_subjects, key=lambda x: subj_map.get(x, {}).get("name", "")):
                    subj = subj_map.get(subj_id, {})
                    s_grades = [
                        g for g in (grades_result.data or [])
                        if g["student_id"] == s["id"] and g["subject_id"] == subj_id
                    ]
                    subjects_data.append({
                        "subject_id": subj_id,
                        "subject": subj.get("name", "Unknown"),
                        "subject_color": subj.get("color_code", "#607D8B"),
                        "stats": build_student_stats(s["id"], subj_id, class_teacher_class_id),
                        "grades": [
                            {
                                "id": g["id"],
                                "assessment": g.get("assessment_name", ""),
                                "grade_code": g.get("grade_code", ""),
                                "percentage": g.get("percentage"),
                                "date": g.get("date_taken", ""),
                                "comment": g.get("comment", ""),
                                "category": g.get("category", "other"),
                                "term": g.get("term", 1),
                            }
                            for g in s_grades
                        ],
                    })

                overview_students.append({
                    "student_id": s["id"],
                    "name": s["name"],
                    "surname": s["surname"],
                    "class_name": cls_map.get(s["class_id"], {}).get("class_name", ""),
                    "subjects": subjects_data,
                    "stats": build_student_stats(s["id"]),
                })

            ct_class = cls_map.get(class_teacher_class_id, {})
            groups.append({
                "type": "class_overview",
                "class_name": ct_class.get("class_name", ""),
                "year_group": class_teacher_grade,
                "students": overview_students,
            })

    # === TEACHING GROUPS ===
    for subj_id, class_id in sorted(teaching_pairs, key=lambda x: (cls_map.get(x[1], {}).get("grade_level", 0), cls_map.get(x[1], {}).get("class_name", ""))):
        cls = cls_map.get(class_id, {})
        subj = subj_map.get(subj_id, {})
        gl = cls.get("grade_level", 0)
        class_name = cls.get("class_name", "")

        # Find students for this specific class/group
        # Students whose home class is this class_id, OR
        # students enrolled via student_subjects with this group_class_id
        group_students = []
        for s in (students.data or []):
            # Student is in this group class if:
            # 1) Their home class IS this class_id (for regular classes)
            # 2) Their student_subjects.group_class_id matches (for group classes)
            gc = ss_group_map.get((s["id"], subj_id))
            if gc == class_id:
                group_students.append(s)
            elif s["class_id"] == class_id and not gc:
                # Regular class, no group class assigned
                group_students.append(s)

        student_grades = []
        for s in sorted(group_students, key=lambda x: (x.get("surname", "").lower(), x.get("name", "").lower())):
            s_grades = [
                g for g in (grades_result.data or [])
                if g["student_id"] == s["id"] and g["subject_id"] == subj_id
            ]
            student_grades.append({
                "student_id": s["id"],
                "name": s["name"],
                "surname": s["surname"],
                "class_name": cls_map.get(s["class_id"], {}).get("class_name", ""),
                "grades": [
                    {
                        "id": g["id"],
                        "assessment": g.get("assessment_name", ""),
                        "grade_code": g.get("grade_code", ""),
                        "percentage": g.get("percentage"),
                        "date": g.get("date_taken", ""),
                        "comment": g.get("comment", ""),
                        "category": g.get("category", "other"),
                        "term": g.get("term", 1),
                    }
                    for g in s_grades
                ],
                "stats": build_student_stats(s["id"], subj_id, class_id),
            })

        groups.append({
            "type": "subject_group",
            "year_group": gl,
            "subject": subj.get("name", "Unknown"),
            "subject_id": subj_id,
            "subject_color": subj.get("color_code", "#607D8B"),
            "class_id": class_id,
            "class_name": class_name,
            "is_own_class": class_teacher_class_id == class_id,
            "students": student_grades,
        })

    return JsonResponse({"groups": groups})


# ------------------------------------------------------------------
# Teacher: add homework / task
# ------------------------------------------------------------------

@csrf_exempt
def teacher_add_homework(request):
    payload = _verify_token(request)
    if not payload or payload.get("role") != "teacher":
        return JsonResponse({"message": "Unauthorized"}, status=401)

    if request.method != "POST":
        return JsonResponse({"message": "Method not allowed"}, status=405)

    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({"message": "Invalid JSON"}, status=400)

    subject_id = data.get("subject_id", "").strip()
    class_id = data.get("class_id", "").strip()
    title = data.get("title", "").strip()
    description = data.get("description", "").strip()
    due_date = data.get("due_date", "").strip()

    if not subject_id or not class_id or not title or not due_date:
        return JsonResponse({"message": "subject_id, class_id, title and due_date are required"}, status=400)

    db = ediary()
    result = db.table("homework").insert({
        "teacher_id": payload["sub"],
        "subject_id": subject_id,
        "class_id": class_id,
        "title": title,
        "description": description,
        "due_date": due_date,
    }).execute()

    return JsonResponse({"homework": result.data[0] if result.data else {}}, status=201)


# ------------------------------------------------------------------
# Teacher: delete homework
# ------------------------------------------------------------------

@csrf_exempt
def teacher_delete_homework(request):
    payload = _verify_token(request)
    if not payload or payload.get("role") != "teacher":
        return JsonResponse({"message": "Unauthorized"}, status=401)

    if request.method != "POST":
        return JsonResponse({"message": "Method not allowed"}, status=405)

    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({"message": "Invalid JSON"}, status=400)

    hw_id = data.get("id", "").strip()
    if not hw_id:
        return JsonResponse({"message": "id is required"}, status=400)

    db = ediary()
    result = (
        db.table("homework")
        .delete()
        .eq("id", hw_id)
        .eq("teacher_id", payload["sub"])
        .execute()
    )

    if not result.data:
        return JsonResponse({"message": "Not found or not yours"}, status=404)

    return JsonResponse({"deleted": True})


# ------------------------------------------------------------------
# Behavioral entries – list for teacher or student
# ------------------------------------------------------------------

@csrf_exempt
def behavioral_entries(request):
    payload = _verify_token(request)
    if not payload:
        return JsonResponse({"message": "Unauthorized"}, status=401)

    user_id = payload["sub"]
    role = payload.get("role", "student")
    db = ediary()

    if role == "teacher":
        result = (
            db.table("behavioral_entries")
            .select("id, student_id, subject_id, class_id, entry_type, content, severity, created_at")
            .eq("teacher_id", user_id)
            .order("created_at", desc=True)
            .execute()
        )
    else:
        result = (
            db.table("behavioral_entries")
            .select("id, teacher_id, subject_id, class_id, entry_type, content, severity, created_at")
            .eq("student_id", user_id)
            .order("created_at", desc=True)
            .execute()
        )

    # Build lookups
    subj_result = ediary().table("subjects").select("id, name").execute()
    subj_map = {s["id"]: s["name"] for s in (subj_result.data or [])}

    stu_ids = list({r.get("student_id", "") for r in (result.data or []) if r.get("student_id")})
    t_ids = list({r.get("teacher_id", "") for r in (result.data or []) if r.get("teacher_id")})

    stu_map = {}
    if stu_ids:
        sr = ediary().table("students").select("id, name, surname").in_("id", stu_ids).execute()
        stu_map = {s["id"]: f"{s['name']} {s['surname']}" for s in (sr.data or [])}

    t_map = {}
    if t_ids:
        tr = ediary().table("teachers").select("id, name, surname").in_("id", t_ids).execute()
        t_map = {t["id"]: f"{t['name']} {t['surname']}" for t in (tr.data or [])}

    rows = []
    for r in (result.data or []):
        rows.append({
            "id": r["id"],
            "entry_type": r.get("entry_type", ""),
            "content": r.get("content", ""),
            "severity": r.get("severity", ""),
            "subject": subj_map.get(r.get("subject_id"), ""),
            "student": stu_map.get(r.get("student_id"), ""),
            "teacher": t_map.get(r.get("teacher_id"), ""),
            "created_at": r.get("created_at", ""),
        })

    return JsonResponse({"entries": rows})


# ------------------------------------------------------------------
# Teacher: add behavioral entry
# ------------------------------------------------------------------

@csrf_exempt
def teacher_add_behavioral(request):
    payload = _verify_token(request)
    if not payload or payload.get("role") != "teacher":
        return JsonResponse({"message": "Unauthorized"}, status=401)

    if request.method != "POST":
        return JsonResponse({"message": "Method not allowed"}, status=405)

    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({"message": "Invalid JSON"}, status=400)

    student_id = data.get("student_id", "").strip()
    subject_id = data.get("subject_id", "").strip()
    class_id = data.get("class_id", "").strip()
    entry_type = data.get("entry_type", "").strip()
    content = data.get("content", "").strip()
    severity = data.get("severity", "").strip()

    if not student_id or not entry_type or not content:
        return JsonResponse({"message": "student_id, entry_type and content are required"}, status=400)

    insert_row = {
        "teacher_id": payload["sub"],
        "student_id": student_id,
        "entry_type": entry_type,
        "content": content,
    }
    if subject_id:
        insert_row["subject_id"] = subject_id
    if class_id:
        insert_row["class_id"] = class_id
    if severity:
        insert_row["severity"] = severity

    db = ediary()
    result = db.table("behavioral_entries").insert(insert_row).execute()

    return JsonResponse({"entry": result.data[0] if result.data else {}}, status=201)


# ------------------------------------------------------------------
# Teacher: delete behavioral entry
# ------------------------------------------------------------------

@csrf_exempt
def teacher_delete_behavioral(request):
    payload = _verify_token(request)
    if not payload or payload.get("role") != "teacher":
        return JsonResponse({"message": "Unauthorized"}, status=401)

    if request.method != "POST":
        return JsonResponse({"message": "Method not allowed"}, status=405)

    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({"message": "Invalid JSON"}, status=400)

    entry_id = data.get("id", "").strip()
    if not entry_id:
        return JsonResponse({"message": "id is required"}, status=400)

    db = ediary()
    result = (
        db.table("behavioral_entries")
        .delete()
        .eq("id", entry_id)
        .eq("teacher_id", payload["sub"])
        .execute()
    )

    if not result.data:
        return JsonResponse({"message": "Not found or not yours"}, status=404)

    return JsonResponse({"deleted": True})


# ------------------------------------------------------------------
# Teacher: homework completions (get + save)
# ------------------------------------------------------------------

@csrf_exempt
def teacher_homework_completions(request):
    payload = _verify_token(request)
    if not payload or payload.get("role") != "teacher":
        return JsonResponse({"message": "Unauthorized"}, status=401)

    if request.method == "GET":
        homework_id = request.GET.get("homework_id")
        if not homework_id:
            return JsonResponse({"message": "homework_id required"}, status=400)

        db = ediary()
        result = (
            db.table("homework_completions")
            .select("id, homework_id, student_id, status")
            .eq("homework_id", homework_id)
            .execute()
        )
        return JsonResponse({"completions": result.data or []})

    if request.method == "POST":
        try:
            data = json.loads(request.body)
        except json.JSONDecodeError:
            return JsonResponse({"message": "Invalid JSON"}, status=400)

        homework_id = data.get("homework_id", "").strip()
        records = data.get("records", [])

        if not homework_id or not records:
            return JsonResponse({"message": "homework_id and records required"}, status=400)

        db = ediary()

        # Verify requesting teacher owns this homework
        hw_check = db.table("homework").select("id").eq("id", homework_id).eq("teacher_id", payload["sub"]).execute()
        if not hw_check.data:
            return JsonResponse({"message": "Homework not found or not yours"}, status=403)

        # Delete existing completions for this homework
        db.table("homework_completions") \
            .delete() \
            .eq("homework_id", homework_id) \
            .execute()

        # Insert new records (only those with a status set)
        rows = []
        for rec in records:
            status = rec.get("status", "").strip()
            if not status:
                continue
            rows.append({
                "homework_id": homework_id,
                "student_id": rec["student_id"],
                "status": status,
                "recorded_by_teacher_id": payload["sub"],
            })

        if rows:
            db2 = ediary()
            db2.table("homework_completions").insert(rows).execute()

        return JsonResponse({"saved": len(rows)}, status=201)

    return JsonResponse({"message": "Method not allowed"}, status=405)


# ------------------------------------------------------------------
# Teacher: class statistics (attendance, grades, hw, behavioral)
# ------------------------------------------------------------------

@csrf_exempt
def teacher_class_stats(request):
    payload = _verify_token(request)
    if not payload or payload.get("role") != "teacher":
        return JsonResponse({"message": "Unauthorized"}, status=401)

    teacher_id = payload["sub"]
    db = ediary()

    # Get teacher assignments
    assignments = (
        db.table("teacher_assignments")
        .select("subject_id, class_id")
        .eq("teacher_id", teacher_id)
        .execute()
    )
    pairs = [(a["subject_id"], a["class_id"]) for a in (assignments.data or [])]
    if not pairs:
        return JsonResponse({"stats": []})

    # Lookups
    subj_result = ediary().table("subjects").select("id, name").execute()
    subj_map = {s["id"]: s["name"] for s in (subj_result.data or [])}

    cls_result = ediary().table("classes").select("id, class_name, grade_level").execute()
    cls_map = {c["id"]: c for c in (cls_result.data or [])}

    subjects_in_pairs = sorted(list({sid for sid, _ in pairs}))
    classes_in_pairs = sorted(list({cid for _, cid in pairs}))

    students_all = (
        ediary().table("students")
        .select("id, class_id")
        .execute()
    )
    student_class_map = {s["id"]: s.get("class_id") for s in (students_all.data or [])}
    all_student_ids = list(student_class_map.keys())

    ss_result = (
        ediary().table("student_subjects")
        .select("student_id, subject_id, group_class_id")
        .in_("subject_id", subjects_in_pairs)
        .execute()
    ) if subjects_in_pairs else type('', (), {'data': []})()

    pair_enrolled_map = {}
    for subject_id, class_id in pairs:
        enrolled = set()
        for ss in (ss_result.data or []):
            if ss.get("subject_id") != subject_id:
                continue
            sid = ss.get("student_id")
            gc = ss.get("group_class_id")
            if gc:
                if gc == class_id:
                    enrolled.add(sid)
            elif student_class_map.get(sid) == class_id:
                enrolled.add(sid)
        pair_enrolled_map[(subject_id, class_id)] = enrolled

    # Fetch all attendance for this teacher
    att_result = (
        ediary().table("attendance")
        .select("class_id, subject_id, student_id, status")
        .eq("recorded_by_teacher_id", teacher_id)
        .execute()
    )

    # Fetch all grades for students in relevant classes
    grades_result = (
        ediary().table("grades")
        .select("subject_id, student_id, percentage")
        .in_("student_id", all_student_ids)
        .execute()
    ) if all_student_ids else type('', (), {'data': []})()

    # Fetch homework for this teacher
    hw_result = (
        ediary().table("homework")
        .select("id, subject_id, class_id")
        .eq("teacher_id", teacher_id)
        .execute()
    )
    hw_ids = [h["id"] for h in (hw_result.data or [])]

    # Fetch homework completions
    hwc_result = (
        ediary().table("homework_completions")
        .select("homework_id, student_id, status")
        .in_("homework_id", hw_ids)
        .execute()
    ) if hw_ids else type('', (), {'data': []})()

    # Map homework_id -> (subject_id, class_id)
    hw_pair_map = {h["id"]: (h["subject_id"], h["class_id"]) for h in (hw_result.data or [])}

    # Fetch behavioral entries for this teacher
    beh_result = (
        ediary().table("behavioral_entries")
        .select("subject_id, class_id, student_id, entry_type")
        .eq("teacher_id", teacher_id)
        .execute()
    )

    # Build stats per (subject_id, class_id)
    stats = []
    for subject_id, class_id in pairs:
        cl = cls_map.get(class_id)
        if not cl:
            continue

        class_enrolled = pair_enrolled_map.get((subject_id, class_id), set())
        student_count = len(class_enrolled)

        # Attendance stats: filter by this class_id + subject
        att_counts = {"Present": 0, "Late": 0, "Absent": 0, "Excused": 0}
        for a in (att_result.data or []):
            if a["subject_id"] == subject_id and a.get("class_id") == class_id and a.get("student_id") in class_enrolled:
                s = a.get("status", "Present")
                if s in att_counts:
                    att_counts[s] += 1
        att_total = sum(att_counts.values())

        # Grade stats: filter by subject + students in this class
        grade_values = []
        for g in (grades_result.data or []):
            if g["subject_id"] == subject_id and g.get("student_id") in class_enrolled:
                gv = g.get("percentage")
                if gv is not None:
                    grade_values.append(gv)
        grade_count = len(grade_values)
        grade_avg = round(sum(grade_values) / grade_count, 2) if grade_count else None

        # Homework stats
        hw_for_pair = [h_id for h_id, (sid, cid) in hw_pair_map.items() if sid == subject_id and cid == class_id]
        hw_count = len(hw_for_pair)
        hwc_counts = {"completed": 0, "partial": 0, "not_done": 0}
        for c in (hwc_result.data or []):
            if c["homework_id"] in hw_for_pair and c.get("student_id") in class_enrolled:
                st = c.get("status", "")
                if st in hwc_counts:
                    hwc_counts[st] += 1

        # Behavioral stats
        beh_counts = {"positive": 0, "negative": 0, "note": 0}
        for b in (beh_result.data or []):
            if b.get("subject_id") == subject_id and b.get("class_id") == class_id and b.get("student_id") in class_enrolled:
                bt = b.get("entry_type", "note")
                if bt in beh_counts:
                    beh_counts[bt] += 1

        stats.append({
            "subject_id": subject_id,
            "class_id": class_id,
            "subject": subj_map.get(subject_id, ""),
            "class_name": cl.get("class_name", ""),
            "student_count": student_count,
            "attendance": {
                "total": att_total,
                "present": att_counts["Present"],
                "late": att_counts["Late"],
                "absent": att_counts["Absent"],
                "excused": att_counts["Excused"],
            },
            "grades": {
                "count": grade_count,
                "average": grade_avg,
            },
            "homework": {
                "assigned": hw_count,
                "completed": hwc_counts["completed"],
                "partial": hwc_counts["partial"],
                "not_done": hwc_counts["not_done"],
            },
            "behavioral": {
                "positive": beh_counts["positive"],
                "negative": beh_counts["negative"],
                "note": beh_counts["note"],
            },
        })

    # Sort by subject then class
    stats.sort(key=lambda s: (s["subject"], s["class_name"]))
    return JsonResponse({"stats": stats})


# ------------------------------------------------------------------
# Teacher: per-student comments timeline for class teachers/subject teachers
# ------------------------------------------------------------------

@csrf_exempt
def teacher_student_comments(request):
    payload = _verify_token(request)
    if not payload or payload.get("role") != "teacher":
        return JsonResponse({"message": "Unauthorized"}, status=401)

    if request.method != "GET":
        return JsonResponse({"message": "Method not allowed"}, status=405)

    student_id = request.GET.get("student_id", "").strip()
    subject_id = request.GET.get("subject_id", "").strip()

    if not student_id:
        return JsonResponse({"message": "student_id required"}, status=400)

    db = ediary()

    subjects = db.table("subjects").select("id, name").execute()
    subj_map = {s["id"]: s["name"] for s in (subjects.data or [])}

    classes = db.table("classes").select("id, class_name").execute()
    cls_map = {c["id"]: c["class_name"] for c in (classes.data or [])}

    teachers = db.table("teachers").select("id, name, surname").execute()
    teacher_map = {t["id"]: f"{t['name']} {t['surname']}" for t in (teachers.data or [])}

    # Build schedule lookup for period from weekday+subject+class
    sched = db.table("schedule").select("subject_id, class_id, day_of_week, period").execute()
    sched_map = {}
    for r in (sched.data or []):
        key = (r.get("subject_id"), r.get("class_id"), r.get("day_of_week"))
        cur = sched_map.get(key)
        p = r.get("period")
        if cur is None or (p is not None and p < cur):
            sched_map[key] = p

    comments = []

    # Attendance comments
    att = (
        db.table("attendance")
        .select("date_recorded, class_id, subject_id, comment, recorded_by_teacher_id")
        .eq("student_id", student_id)
        .execute()
    )
    for a in (att.data or []):
        text = (a.get("comment") or "").strip()
        if not text:
            continue
        if subject_id and a.get("subject_id") != subject_id:
            continue
        day_of_week = None
        try:
            day_of_week = datetime.fromisoformat(str(a.get("date_recorded"))).isoweekday()
        except Exception:
            day_of_week = None
        comments.append({
            "source": "attendance",
            "date": a.get("date_recorded", ""),
            "subject": subj_map.get(a.get("subject_id"), ""),
            "group": cls_map.get(a.get("class_id"), ""),
            "period": sched_map.get((a.get("subject_id"), a.get("class_id"), day_of_week)),
            "teacher": teacher_map.get(a.get("recorded_by_teacher_id"), ""),
            "comment": text,
        })

    # Grade comments
    stu_row = db.table("students").select("class_id").eq("id", student_id).limit(1).execute()
    student_class_id = stu_row.data[0]["class_id"] if stu_row.data else None

    grades = (
        db.table("grades")
        .select("date_taken, subject_id, comment, created_by_teacher_id")
        .eq("student_id", student_id)
        .execute()
    )
    for g in (grades.data or []):
        text = (g.get("comment") or "").strip()
        if not text:
            continue
        if subject_id and g.get("subject_id") != subject_id:
            continue
        comments.append({
            "source": "grade",
            "date": g.get("date_taken", ""),
            "subject": subj_map.get(g.get("subject_id"), ""),
            "group": cls_map.get(student_class_id, ""),
            "period": None,
            "teacher": teacher_map.get(g.get("created_by_teacher_id"), ""),
            "comment": text,
        })

    # Behavioral notes (as comments)
    beh = (
        db.table("behavioral_entries")
        .select("created_at, class_id, subject_id, content, teacher_id")
        .eq("student_id", student_id)
        .execute()
    )
    for b in (beh.data or []):
        text = (b.get("content") or "").strip()
        if not text:
            continue
        if subject_id and b.get("subject_id") != subject_id:
            continue
        created_at = str(b.get("created_at") or "")
        comments.append({
            "source": "behavioral",
            "date": created_at[:10] if len(created_at) >= 10 else created_at,
            "subject": subj_map.get(b.get("subject_id"), ""),
            "group": cls_map.get(b.get("class_id"), ""),
            "period": None,
            "teacher": teacher_map.get(b.get("teacher_id"), ""),
            "comment": text,
        })

    comments.sort(key=lambda c: c.get("date", ""), reverse=True)
    return JsonResponse({"comments": comments})


# ------------------------------------------------------------------
# Teacher: winter / end-of-year reports
# ------------------------------------------------------------------

@csrf_exempt
def teacher_reports(request):
    payload = _verify_token(request)
    if not payload or payload.get("role") != "teacher":
        return JsonResponse({"message": "Unauthorized"}, status=401)

    teacher_id = payload["sub"]

    if request.method == "GET":
        term = request.GET.get("term", "1").strip()
        if term not in ("1", "2"):
            return JsonResponse({"message": "term must be 1 or 2"}, status=400)

        db = ediary()
        assignments = (
            db.table("teacher_assignments")
            .select("subject_id, class_id")
            .eq("teacher_id", teacher_id)
            .execute()
        )
        pairs = {(a["subject_id"], a["class_id"]) for a in (assignments.data or [])}
        if not pairs:
            return JsonResponse({"reports": []})

        taught_class_ids = list({cid for _, cid in pairs})
        subjects_in_pairs = sorted(list({sid for sid, _ in pairs}))

        # Get all students in the classes the teacher teaches
        students = (
            db.table("students")
            .select("id, name, surname, class_id")
            .in_("class_id", taught_class_ids)
            .order("surname")
            .order("name")
            .execute()
        )
        student_rows = students.data or []
        student_ids = [s["id"] for s in student_rows]
        student_map = {s["id"]: s for s in student_rows}

        # Also fetch students from OTHER classes who might be group-enrolled
        ss_all = (
            db.table("student_subjects")
            .select("student_id, subject_id, group_class_id")
            .in_("subject_id", subjects_in_pairs)
            .execute()
        ) if subjects_in_pairs else type('', (), {'data': []})()
        ss_rows = ss_all.data or []

        # Build group map: (student_id, subject_id) -> group_class_id
        ss_group_map = {}
        extra_student_ids = set()
        for row in ss_rows:
            sid = row.get("student_id")
            subj_id = row.get("subject_id")
            gc = row.get("group_class_id")
            ss_group_map[(sid, subj_id)] = gc
            if gc and gc in set(taught_class_ids) and sid not in student_map:
                extra_student_ids.add(sid)

        # Fetch extra students from other classes who are group-enrolled
        if extra_student_ids:
            extra = (
                db.table("students")
                .select("id, name, surname, class_id")
                .in_("id", list(extra_student_ids))
                .execute()
            )
            for s in (extra.data or []):
                student_map[s["id"]] = s
                student_rows.append(s)

        subjects = db.table("subjects").select("id, name").execute()
        subj_map = {s["id"]: s["name"] for s in (subjects.data or [])}
        classes = db.table("classes").select("id, class_name").execute()
        cls_map = {c["id"]: c["class_name"] for c in (classes.data or [])}

        try:
            existing = (
                db.table("teacher_reports")
                .select("id, student_id, subject_id, class_id, term, report_grade, effort, comment")
                .eq("teacher_id", teacher_id)
                .eq("term", int(term))
                .execute()
            )
            existing_rows = existing.data or []
        except Exception:
            existing_rows = []

        existing_map = {
            (r.get("student_id"), r.get("subject_id"), r.get("class_id"), r.get("term")): r
            for r in existing_rows
        }

        reports = []
        seen_keys = set()
        for pair_subj_id, pair_class_id in pairs:
            for s in student_rows:
                sid = s["id"]
                gc = ss_group_map.get((sid, pair_subj_id))

                # Student belongs if: group_class_id matches, or no group_class and home class matches
                in_group = (gc == pair_class_id) or (not gc and s.get("class_id") == pair_class_id)
                if not in_group:
                    continue

                dedupe = (sid, pair_subj_id, pair_class_id)
                if dedupe in seen_keys:
                    continue
                seen_keys.add(dedupe)

                key = (sid, pair_subj_id, pair_class_id, int(term))
                existing_row = existing_map.get(key, {})
                reports.append({
                    "id": existing_row.get("id"),
                    "student_id": sid,
                    "student": f"{s.get('surname', '')} {s.get('name', '')}".strip(),
                    "subject_id": pair_subj_id,
                    "subject": subj_map.get(pair_subj_id, ""),
                    "class_id": pair_class_id,
                    "class_name": cls_map.get(pair_class_id, ""),
                    "term": int(term),
                    "report_grade": existing_row.get("report_grade", ""),
                    "effort": existing_row.get("effort", ""),
                    "comment": existing_row.get("comment", ""),
                })

        reports.sort(key=lambda r: (r.get("class_name", ""), r.get("subject", ""), r.get("student", "")))
        return JsonResponse({"reports": reports})

    if request.method == "POST":
        try:
            data = json.loads(request.body)
        except json.JSONDecodeError:
            return JsonResponse({"message": "Invalid JSON"}, status=400)

        student_id = data.get("student_id", "").strip()
        subject_id = data.get("subject_id", "").strip()
        class_id = data.get("class_id", "").strip()
        term = int(data.get("term", 1))
        report_grade = data.get("report_grade", "").strip()
        effort = data.get("effort", "").strip()
        comment = data.get("comment", "").strip()

        if not student_id or not subject_id or not class_id or term not in (1, 2):
            return JsonResponse({"message": "student_id, subject_id, class_id and valid term are required"}, status=400)

        row = {
            "teacher_id": teacher_id,
            "student_id": student_id,
            "subject_id": subject_id,
            "class_id": class_id,
            "term": term,
            "report_grade": report_grade,
            "effort": effort,
            "comment": comment,
        }

        try:
            existing = (
                ediary().table("teacher_reports")
                .select("id")
                .eq("teacher_id", teacher_id)
                .eq("student_id", student_id)
                .eq("subject_id", subject_id)
                .eq("class_id", class_id)
                .eq("term", term)
                .limit(1)
                .execute()
            )
            if existing.data:
                result = (
                    ediary().table("teacher_reports")
                    .update({
                        "report_grade": report_grade,
                        "effort": effort,
                        "comment": comment,
                    })
                    .eq("id", existing.data[0]["id"])
                    .execute()
                )
            else:
                result = ediary().table("teacher_reports").insert(row).execute()
        except Exception as exc:
            logger.exception("Failed to save report")
            return JsonResponse({
                "message": "Failed to save report",
            }, status=500)

        return JsonResponse({"report": result.data[0] if result.data else {}})

    return JsonResponse({"message": "Method not allowed"}, status=405)


# ==================================================================
#  Admin endpoints
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


# ---------- Stats / Overview ----------

@csrf_exempt
def admin_stats(request):
    """Return aggregate counts for the admin overview."""
    payload = _require_admin(request)
    if not payload:
        return JsonResponse({"message": "Unauthorized"}, status=401)
    if request.method != "GET":
        return JsonResponse({"message": "Method not allowed"}, status=405)
    db = ediary()
    classes = db.table("classes").select("id,class_name,grade_level").order("grade_level").order("class_name").execute().data or []
    subjects = db.table("subjects").select("id").execute().data or []
    teachers = db.table("teachers").select("id").execute().data or []
    students = db.table("students").select("id,class_id").execute().data or []
    admins_raw = db.table("admins").select("id").execute().data or []
    # Hide super admin from counts; hide master from non-super
    caller_level = _admin_level(payload)
    admins = [a for a in admins_raw if not _is_super_admin_id(a["id"])]
    if caller_level != "super":
        admins = [a for a in admins if not _is_master_admin_id(a["id"])]
    assignments = db.table("teacher_assignments").select("teacher_id").execute().data or []
    enrollments = db.table("student_subjects").select("student_id").execute().data or []
    schedule_slots = db.table("schedule").select("id").execute().data or []

    # Count students per class
    class_student_count = {}
    for s in students:
        cid = s.get("class_id")
        if cid:
            class_student_count[cid] = class_student_count.get(cid, 0) + 1

    classes_breakdown = []
    for c in classes:
        classes_breakdown.append({
            "class_name": c["class_name"],
            "grade_level": c["grade_level"],
            "student_count": class_student_count.get(c["id"], 0),
        })

    return JsonResponse({
        "total_classes": len(classes),
        "total_subjects": len(subjects),
        "total_teachers": len(teachers),
        "total_students": len(students),
        "total_admins": len(admins),
        "total_assignments": len(assignments),
        "total_enrollments": len(enrollments),
        "total_schedule_slots": len(schedule_slots),
        "classes_breakdown": classes_breakdown,
    })


# ---------- Impersonate ----------

@csrf_exempt
def admin_impersonate(request):
    """Generate a token for a target user so the admin can log in as them."""
    payload = _require_admin(request)
    if not payload:
        return JsonResponse({"message": "Unauthorized"}, status=401)
    if request.method != "POST":
        return JsonResponse({"message": "Method not allowed"}, status=405)
    caller_level = _admin_level(payload)
    if caller_level not in ("super", "master"):
        return JsonResponse({"message": "Only master+ can impersonate"}, status=403)
    data = json.loads(request.body)
    target_id = data.get("user_id", "").strip()
    if not target_id:
        return JsonResponse({"message": "user_id required"}, status=400)
    if _is_super_admin_id(target_id):
        return JsonResponse({"message": "Cannot impersonate this account"}, status=403)

    role, profile = _get_profile(target_id)
    if not role:
        return JsonResponse({"message": "User not found"}, status=404)

    # Build a standard token for the target user
    db = ediary()
    # Try to get the user's email from Supabase Auth
    email = ""
    try:
        auth_user = supabase_admin_auth.auth.admin.get_user_by_id(target_id)
        if auth_user and auth_user.user:
            email = auth_user.user.email or ""
    except Exception:
        pass

    token = _make_token(target_id, role, email)

    return JsonResponse({
        "token": token,
        "user": {
            "id": target_id,
            "email": email,
            "full_name": profile["full_name"],
            "role": role,
            "class_name": profile.get("class_name", ""),
        },
    })


# ---------- Classes ----------

@csrf_exempt
def admin_classes(request):
    payload = _require_admin(request)
    if not payload:
        return JsonResponse({"message": "Unauthorized"}, status=401)
    if not _admin_has_perm(payload, "classes"):
        return JsonResponse({"message": "No permission"}, status=403)
    db = ediary()
    if request.method == "GET":
        rows = db.table("classes").select("*").order("grade_level").order("class_name").execute()
        return JsonResponse({"classes": rows.data or []})
    if request.method == "POST":
        data = json.loads(request.body)
        class_name = data.get("class_name", "").strip()
        grade_level = int(data.get("grade_level", 0))
        if not class_name or not grade_level:
            return JsonResponse({"message": "class_name and grade_level required"}, status=400)
        result = db.table("classes").insert({"class_name": class_name, "grade_level": grade_level}).execute()
        return JsonResponse({"class": result.data[0] if result.data else {}})
    return JsonResponse({"message": "Method not allowed"}, status=405)


@csrf_exempt
def admin_class_detail(request):
    payload = _require_admin(request)
    if not payload:
        return JsonResponse({"message": "Unauthorized"}, status=401)
    if not _admin_has_perm(payload, "classes"):
        return JsonResponse({"message": "No permission"}, status=403)
    db = ediary()
    if request.method == "PATCH":
        data = json.loads(request.body)
        cid = data.get("id", "").strip()
        updates = {}
        if "class_name" in data: updates["class_name"] = data["class_name"].strip()
        if "grade_level" in data: updates["grade_level"] = int(data["grade_level"])
        if not cid or not updates:
            return JsonResponse({"message": "id and fields required"}, status=400)
        result = db.table("classes").update(updates).eq("id", cid).execute()
        return JsonResponse({"class": result.data[0] if result.data else {}})
    if request.method == "DELETE":
        cid = request.GET.get("id", "").strip()
        if not cid:
            return JsonResponse({"message": "id required"}, status=400)
        db.table("classes").delete().eq("id", cid).execute()
        return JsonResponse({"deleted": True})
    return JsonResponse({"message": "Method not allowed"}, status=405)


# ---------- Subjects ----------

@csrf_exempt
def admin_subjects(request):
    payload = _require_admin(request)
    if not payload:
        return JsonResponse({"message": "Unauthorized"}, status=401)
    if not _admin_has_perm(payload, "subjects"):
        return JsonResponse({"message": "No permission"}, status=403)
    db = ediary()
    if request.method == "GET":
        rows = db.table("subjects").select("*").order("name").execute()
        return JsonResponse({"subjects": rows.data or []})
    if request.method == "POST":
        data = json.loads(request.body)
        name = data.get("name", "").strip()
        color_code = data.get("color_code", "").strip() or None
        if not name:
            return JsonResponse({"message": "name required"}, status=400)
        result = db.table("subjects").insert({"name": name, "color_code": color_code}).execute()
        return JsonResponse({"subject": result.data[0] if result.data else {}})
    return JsonResponse({"message": "Method not allowed"}, status=405)


@csrf_exempt
def admin_subject_detail(request):
    payload = _require_admin(request)
    if not payload:
        return JsonResponse({"message": "Unauthorized"}, status=401)
    if not _admin_has_perm(payload, "subjects"):
        return JsonResponse({"message": "No permission"}, status=403)
    db = ediary()
    if request.method == "PATCH":
        data = json.loads(request.body)
        sid = data.get("id", "").strip()
        updates = {}
        if "name" in data: updates["name"] = data["name"].strip()
        if "color_code" in data: updates["color_code"] = data["color_code"].strip() or None
        if not sid or not updates:
            return JsonResponse({"message": "id and fields required"}, status=400)
        result = db.table("subjects").update(updates).eq("id", sid).execute()
        return JsonResponse({"subject": result.data[0] if result.data else {}})
    if request.method == "DELETE":
        sid = request.GET.get("id", "").strip()
        if not sid:
            return JsonResponse({"message": "id required"}, status=400)
        db.table("subjects").delete().eq("id", sid).execute()
        return JsonResponse({"deleted": True})
    return JsonResponse({"message": "Method not allowed"}, status=405)


# ---------- Users (teachers, students, admins) ----------

@csrf_exempt
def admin_users(request):
    """GET: list users by role; POST: create a user (auth + profile)."""
    payload = _require_admin(request)
    if not payload:
        return JsonResponse({"message": "Unauthorized"}, status=401)
    db = ediary()
    caller_level = _admin_level(payload)

    if request.method == "GET":
        role = request.GET.get("role", "student")
        if role == "teacher":
            if not _admin_has_perm(payload, "teachers"):
                return JsonResponse({"message": "No permission"}, status=403)
            rows = db.table("teachers").select("*").order("surname").order("name").execute()
            teachers = rows.data or []
            # Attach class name for class teachers
            classes = db.table("classes").select("id, class_name").execute()
            cls_map = {c["id"]: c["class_name"] for c in (classes.data or [])}
            for t in teachers:
                t["class_teacher_class_name"] = cls_map.get(t.get("class_teacher_of_class_id"), "")
            return JsonResponse({"users": teachers})
        elif role == "admin":
            # Only super and master can see admin list
            if caller_level not in ("super", "master"):
                return JsonResponse({"message": "No permission"}, status=403)
            rows = db.table("admins").select("*").order("surname").order("name").execute()
            admins_list = rows.data or []
            # Super admins are always hidden from everyone (including other supers)
            admins_list = [a for a in admins_list if a.get("admin_level") != "super" and not _is_super_admin_id(a["id"])]
            # Master admin hidden from regular admins (but visible to super)
            if caller_level != "super":
                admins_list = [a for a in admins_list if not _is_master_admin_id(a["id"])]
            # Attach email from auth for display
            for a in admins_list:
                try:
                    auth_u = supabase_admin_auth.auth.admin.get_user_by_id(a["id"])
                    a["email"] = auth_u.user.email if auth_u and auth_u.user else ""
                except Exception:
                    a["email"] = ""
            return JsonResponse({"users": admins_list})
        else:
            if not _admin_has_perm(payload, "students"):
                return JsonResponse({"message": "No permission"}, status=403)
            rows = db.table("students").select("*").order("surname").order("name").execute()
            students = rows.data or []
            # Filter out any IDs that also appear in the admins table
            admin_rows = db.table("admins").select("id").execute()
            admin_ids = {a["id"] for a in (admin_rows.data or [])}
            students = [s for s in students if s["id"] not in admin_ids]
            classes = db.table("classes").select("id, class_name").execute()
            cls_map = {c["id"]: c["class_name"] for c in (classes.data or [])}
            for s in students:
                s["class_name"] = cls_map.get(s.get("class_id"), "")
            return JsonResponse({"users": students})

    if request.method == "POST":
        data = json.loads(request.body)
        email = data.get("email", "").strip()
        password = data.get("password", "").strip()
        name = data.get("name", "").strip()
        surname = data.get("surname", "").strip()
        role = data.get("role", "student").strip()

        if not email or not password or not name or not surname:
            return JsonResponse({"message": "email, password, name, surname required"}, status=400)

        # Permission checks per role
        if role == "admin":
            if caller_level not in ("super", "master"):
                return JsonResponse({"message": "Only master admins can create admins"}, status=403)
            # Only super can create master/super-level admins
            requested_level = data.get("admin_level", "regular").strip()
            if requested_level in ("master", "super") and caller_level != "super":
                return JsonResponse({"message": "Only the super admin can create master/super admins"}, status=403)
            if requested_level not in ("regular", "master", "super"):
                requested_level = "regular"
        elif role == "teacher":
            if not _admin_has_perm(payload, "teachers"):
                return JsonResponse({"message": "No permission"}, status=403)
        else:
            if not _admin_has_perm(payload, "students"):
                return JsonResponse({"message": "No permission"}, status=403)

        # Create Supabase Auth user
        try:
            auth_response = supabase_admin_auth.auth.admin.create_user({
                "email": email,
                "password": password,
                "email_confirm": True,
            })
            user_id = str(auth_response.user.id)
        except Exception as exc:
            logger.exception("Auth creation failed")
            return JsonResponse({"message": "Failed to create user account"}, status=400)

        # Insert profile row
        try:
            if role == "teacher":
                is_class_teacher = data.get("is_class_teacher", False)
                class_teacher_of = data.get("class_teacher_of_class_id", "").strip() or None
                db.table("teachers").insert({
                    "id": user_id, "name": name, "surname": surname,
                    "is_class_teacher": bool(is_class_teacher),
                    "class_teacher_of_class_id": class_teacher_of,
                }).execute()
            elif role == "admin":
                admin_permissions = data.get("permissions") or ALL_ADMIN_PERMISSIONS
                # Super/master always get all permissions
                if requested_level in ("super", "master"):
                    admin_permissions = ALL_ADMIN_PERMISSIONS
                db.table("admins").insert({
                    "id": user_id, "name": name, "surname": surname,
                    "admin_level": requested_level,
                    "permissions": admin_permissions,
                }).execute()
            else:
                class_id = data.get("class_id", "").strip() or None
                db.table("students").insert({
                    "id": user_id, "name": name, "surname": surname,
                    "class_id": class_id,
                }).execute()
        except Exception as exc:
            # Try to clean up auth user on profile insert failure
            try:
                supabase_admin_auth.auth.admin.delete_user(user_id)
            except Exception:
                pass
            logger.exception("Profile creation failed")
            return JsonResponse({"message": "Failed to create user profile"}, status=500)

        return JsonResponse({"user_id": user_id, "email": email, "role": role})

    return JsonResponse({"message": "Method not allowed"}, status=405)


@csrf_exempt
def admin_user_detail(request):
    """PATCH: update profile; DELETE: remove user (auth + profile)."""
    payload = _require_admin(request)
    if not payload:
        return JsonResponse({"message": "Unauthorized"}, status=401)
    db = ediary()
    caller_level = _admin_level(payload)

    if request.method == "PATCH":
        data = json.loads(request.body)
        uid = data.get("id", "").strip()
        role = data.get("role", "student").strip()
        if not uid:
            return JsonResponse({"message": "id required"}, status=400)

        # --- hierarchy guards ---
        if role == "admin":
            if _is_super_admin_id(uid):
                return JsonResponse({"message": "Cannot edit this account"}, status=403)
            if _is_master_admin_id(uid) and caller_level != "super":
                return JsonResponse({"message": "Cannot edit master admin"}, status=403)
            if caller_level not in ("super", "master"):
                return JsonResponse({"message": "Only master+ can edit admins"}, status=403)
        elif role == "teacher" and not _admin_has_perm(payload, "teachers"):
            return JsonResponse({"message": "No permission"}, status=403)
        elif role == "student" and not _admin_has_perm(payload, "students"):
            return JsonResponse({"message": "No permission"}, status=403)

        table = {"teacher": "teachers", "admin": "admins"}.get(role, "students")
        updates = {}
        for key in ("name", "surname"):
            if key in data and data[key]:
                updates[key] = data[key].strip()

        if role == "teacher":
            if "is_class_teacher" in data:
                updates["is_class_teacher"] = bool(data["is_class_teacher"])
            if "class_teacher_of_class_id" in data:
                updates["class_teacher_of_class_id"] = data["class_teacher_of_class_id"].strip() or None
        elif role == "student":
            if "class_id" in data:
                updates["class_id"] = data["class_id"].strip() or None
        elif role == "admin":
            # Allow super/master to update permissions for regular admins
            if "permissions" in data and not _is_master_admin_id(uid):
                updates["permissions"] = data["permissions"]
            # Only super can change admin_level
            if "admin_level" in data and caller_level == "super" and not _is_super_admin_id(uid):
                new_level = data["admin_level"].strip()
                if new_level in ("regular", "master", "super"):
                    updates["admin_level"] = new_level

        # Update email/password in Supabase Auth if provided
        if data.get("email") or data.get("password"):
            try:
                auth_updates = {}
                if data.get("email"): auth_updates["email"] = data["email"].strip()
                if data.get("password"): auth_updates["password"] = data["password"].strip()
                supabase_admin_auth.auth.admin.update_user_by_id(uid, auth_updates)
            except Exception as exc:
                logger.exception("Auth update failed")
                return JsonResponse({"message": "Failed to update user credentials"}, status=400)

        if updates:
            db.table(table).update(updates).eq("id", uid).execute()
        return JsonResponse({"updated": True})

    if request.method == "DELETE":
        uid = request.GET.get("id", "").strip()
        role = request.GET.get("role", "student").strip()
        if not uid:
            return JsonResponse({"message": "id required"}, status=400)

        # --- hierarchy guards ---
        if role == "admin":
            if _is_super_admin_id(uid):
                return JsonResponse({"message": "Cannot delete this account"}, status=403)
            if _is_master_admin_id(uid) and caller_level != "super":
                return JsonResponse({"message": "Cannot delete master admin"}, status=403)
            if caller_level not in ("super", "master"):
                return JsonResponse({"message": "Only master+ can delete admins"}, status=403)
        elif role == "teacher" and not _admin_has_perm(payload, "teachers"):
            return JsonResponse({"message": "No permission"}, status=403)
        elif role == "student" and not _admin_has_perm(payload, "students"):
            return JsonResponse({"message": "No permission"}, status=403)

        table = {"teacher": "teachers", "admin": "admins"}.get(role, "students")
        try:
            db.table(table).delete().eq("id", uid).execute()
        except Exception:
            pass
        try:
            supabase_admin_auth.auth.admin.delete_user(uid)
        except Exception:
            pass
        return JsonResponse({"deleted": True})

    return JsonResponse({"message": "Method not allowed"}, status=405)


# ---------- Teacher Assignments ----------

@csrf_exempt
def admin_teacher_assignments(request):
    payload = _require_admin(request)
    if not payload:
        return JsonResponse({"message": "Unauthorized"}, status=401)
    if not _admin_has_perm(payload, "schedule"):
        return JsonResponse({"message": "No permission"}, status=403)
    db = ediary()
    if request.method == "GET":
        rows = db.table("teacher_assignments").select("*").execute()
        # Enrich with names
        teachers = db.table("teachers").select("id, name, surname").execute()
        t_map = {t["id"]: f"{t['surname']} {t['name']}" for t in (teachers.data or [])}
        subjects = db.table("subjects").select("id, name").execute()
        s_map = {s["id"]: s["name"] for s in (subjects.data or [])}
        classes = db.table("classes").select("id, class_name").execute()
        c_map = {c["id"]: c["class_name"] for c in (classes.data or [])}
        enriched = []
        for r in (rows.data or []):
            enriched.append({
                **r,
                "teacher_name": t_map.get(r.get("teacher_id"), ""),
                "subject_name": s_map.get(r.get("subject_id"), ""),
                "class_name": c_map.get(r.get("class_id"), ""),
            })
        return JsonResponse({"assignments": enriched})
    if request.method == "POST":
        data = json.loads(request.body)
        teacher_id = data.get("teacher_id", "").strip()
        subject_id = data.get("subject_id", "").strip()
        class_id = data.get("class_id", "").strip()
        if not teacher_id or not subject_id or not class_id:
            return JsonResponse({"message": "teacher_id, subject_id, class_id required"}, status=400)
        try:
            result = db.table("teacher_assignments").insert({
                "teacher_id": teacher_id, "subject_id": subject_id, "class_id": class_id,
            }).execute()
            return JsonResponse({"assignment": result.data[0] if result.data else {}})
        except Exception as exc:
            logger.exception("Operation failed")
            return JsonResponse({"message": "Operation failed"}, status=400)
    return JsonResponse({"message": "Method not allowed"}, status=405)


@csrf_exempt
def admin_teacher_assignment_delete(request):
    payload = _require_admin(request)
    if not payload:
        return JsonResponse({"message": "Unauthorized"}, status=401)
    if not _admin_has_perm(payload, "schedule"):
        return JsonResponse({"message": "No permission"}, status=403)
    if request.method != "DELETE":
        return JsonResponse({"message": "Method not allowed"}, status=405)
    db = ediary()
    tid = request.GET.get("teacher_id", "").strip()
    sid = request.GET.get("subject_id", "").strip()
    cid = request.GET.get("class_id", "").strip()
    if not tid or not sid or not cid:
        return JsonResponse({"message": "teacher_id, subject_id, class_id required"}, status=400)
    db.table("teacher_assignments").delete().eq("teacher_id", tid).eq("subject_id", sid).eq("class_id", cid).execute()
    return JsonResponse({"deleted": True})


# ---------- Student Subjects (enrolments) ----------

@csrf_exempt
def admin_student_subjects(request):
    payload = _require_admin(request)
    if not payload:
        return JsonResponse({"message": "Unauthorized"}, status=401)
    if not _admin_has_perm(payload, "students"):
        return JsonResponse({"message": "No permission"}, status=403)
    db = ediary()
    if request.method == "GET":
        rows = db.table("student_subjects").select("*").execute()
        students = db.table("students").select("id, name, surname").execute()
        st_map = {s["id"]: f"{s['surname']} {s['name']}" for s in (students.data or [])}
        subjects = db.table("subjects").select("id, name").execute()
        s_map = {s["id"]: s["name"] for s in (subjects.data or [])}
        classes = db.table("classes").select("id, class_name").execute()
        c_map = {c["id"]: c["class_name"] for c in (classes.data or [])}
        enriched = []
        for r in (rows.data or []):
            enriched.append({
                **r,
                "student_name": st_map.get(r.get("student_id"), ""),
                "subject_name": s_map.get(r.get("subject_id"), ""),
                "group_class_name": c_map.get(r.get("group_class_id"), ""),
            })
        return JsonResponse({"enrollments": enriched})
    if request.method == "POST":
        data = json.loads(request.body)
        student_id = data.get("student_id", "").strip()
        subject_id = data.get("subject_id", "").strip()
        group_class_id = data.get("group_class_id", "").strip() or None
        if not student_id or not subject_id:
            return JsonResponse({"message": "student_id, subject_id required"}, status=400)
        row = {"student_id": student_id, "subject_id": subject_id}
        if group_class_id:
            row["group_class_id"] = group_class_id
        try:
            result = db.table("student_subjects").insert(row).execute()
            return JsonResponse({"enrollment": result.data[0] if result.data else {}})
        except Exception as exc:
            logger.exception("Operation failed")
            return JsonResponse({"message": "Operation failed"}, status=400)
    return JsonResponse({"message": "Method not allowed"}, status=405)


@csrf_exempt
def admin_student_subject_delete(request):
    payload = _require_admin(request)
    if not payload:
        return JsonResponse({"message": "Unauthorized"}, status=401)
    if not _admin_has_perm(payload, "students"):
        return JsonResponse({"message": "No permission"}, status=403)
    if request.method != "DELETE":
        return JsonResponse({"message": "Method not allowed"}, status=405)
    db = ediary()
    student_id = request.GET.get("student_id", "").strip()
    subject_id = request.GET.get("subject_id", "").strip()
    if not student_id or not subject_id:
        return JsonResponse({"message": "student_id, subject_id required"}, status=400)
    db.table("student_subjects").delete().eq("student_id", student_id).eq("subject_id", subject_id).execute()
    return JsonResponse({"deleted": True})


# ---------- Schedule ----------

@csrf_exempt
def admin_schedule(request):
    payload = _require_admin(request)
    if not payload:
        return JsonResponse({"message": "Unauthorized"}, status=401)
    if not _admin_has_perm(payload, "schedule"):
        return JsonResponse({"message": "No permission"}, status=403)
    db = ediary()
    if request.method == "GET":
        rows = db.table("schedule").select("*").order("day_of_week").order("period").execute()
        teachers = db.table("teachers").select("id, name, surname").execute()
        t_map = {t["id"]: f"{t['surname']} {t['name']}" for t in (teachers.data or [])}
        subjects = db.table("subjects").select("id, name").execute()
        s_map = {s["id"]: s["name"] for s in (subjects.data or [])}
        classes = db.table("classes").select("id, class_name").execute()
        c_map = {c["id"]: c["class_name"] for c in (classes.data or [])}
        enriched = []
        for r in (rows.data or []):
            enriched.append({
                **r,
                "teacher_name": t_map.get(r.get("teacher_id"), ""),
                "subject_name": s_map.get(r.get("subject_id"), ""),
                "class_name": c_map.get(r.get("class_id"), ""),
            })
        return JsonResponse({"schedule": enriched})
    if request.method == "POST":
        data = json.loads(request.body)
        row = {
            "teacher_id": data.get("teacher_id", "").strip(),
            "subject_id": data.get("subject_id", "").strip(),
            "class_id": data.get("class_id", "").strip(),
            "day_of_week": int(data.get("day_of_week", 0)),
            "period": int(data.get("period", 0)),
            "room": data.get("room", "").strip() or None,
        }
        if not row["teacher_id"] or not row["subject_id"] or not row["class_id"]:
            return JsonResponse({"message": "teacher_id, subject_id, class_id required"}, status=400)
        if not (1 <= row["day_of_week"] <= 5) or not (1 <= row["period"] <= 8):
            return JsonResponse({"message": "day_of_week (1-5) and period (1-8) required"}, status=400)
        try:
            result = db.table("schedule").insert(row).execute()
            return JsonResponse({"slot": result.data[0] if result.data else {}})
        except Exception as exc:
            logger.exception("Operation failed")
            return JsonResponse({"message": "Operation failed"}, status=400)
    return JsonResponse({"message": "Method not allowed"}, status=405)


@csrf_exempt
def admin_schedule_detail(request):
    payload = _require_admin(request)
    if not payload:
        return JsonResponse({"message": "Unauthorized"}, status=401)
    if not _admin_has_perm(payload, "schedule"):
        return JsonResponse({"message": "No permission"}, status=403)
    db = ediary()
    if request.method == "PATCH":
        data = json.loads(request.body)
        sid = data.get("id", "").strip()
        if not sid:
            return JsonResponse({"message": "id required"}, status=400)
        updates = {}
        for k in ("teacher_id", "subject_id", "class_id", "room"):
            if k in data:
                updates[k] = data[k].strip() if isinstance(data[k], str) else data[k]
        for k in ("day_of_week", "period"):
            if k in data:
                updates[k] = int(data[k])
        if updates:
            db.table("schedule").update(updates).eq("id", sid).execute()
        return JsonResponse({"updated": True})
    if request.method == "DELETE":
        sid = request.GET.get("id", "").strip()
        if not sid:
            return JsonResponse({"message": "id required"}, status=400)
        db.table("schedule").delete().eq("id", sid).execute()
        return JsonResponse({"deleted": True})
    return JsonResponse({"message": "Method not allowed"}, status=405)


# ---------- CSV Bulk Import ----------

import csv
import io

@csrf_exempt
def admin_csv_import(request):
    """
    POST with JSON: { "type": "classes|subjects|students|teachers|admins|teacher_assignments|student_subjects|schedule", "rows": [...] }
    Each row is a dict matching the required fields.
    """
    payload = _require_admin(request)
    if not payload:
        return JsonResponse({"message": "Unauthorized"}, status=401)
    if not _admin_has_perm(payload, "import"):
        return JsonResponse({"message": "No permission"}, status=403)
    if request.method != "POST":
        return JsonResponse({"message": "Method not allowed"}, status=405)

    data = json.loads(request.body)
    import_type = data.get("type", "").strip()
    rows = data.get("rows", [])

    if not import_type or not rows:
        return JsonResponse({"message": "type and rows required"}, status=400)

    db = ediary()
    created = 0
    errors = []

    if import_type == "classes":
        for i, r in enumerate(rows):
            try:
                db.table("classes").insert({
                    "class_name": r.get("class_name", "").strip(),
                    "grade_level": int(r.get("grade_level", 0)),
                }).execute()
                created += 1
            except Exception as exc:
                errors.append({"row": i + 1, "error": "Processing failed"})

    elif import_type == "subjects":
        for i, r in enumerate(rows):
            try:
                db.table("subjects").insert({
                    "name": r.get("name", "").strip(),
                    "color_code": r.get("color_code", "").strip() or None,
                }).execute()
                created += 1
            except Exception as exc:
                errors.append({"row": i + 1, "error": "Processing failed"})

    elif import_type in ("students", "teachers", "admins"):
        # Need to resolve class names to IDs for students
        cls_map = {}
        if import_type == "students":
            classes = db.table("classes").select("id, class_name").execute()
            cls_map = {c["class_name"]: c["id"] for c in (classes.data or [])}

        for i, r in enumerate(rows):
            email = r.get("email", "").strip()
            password = r.get("password", "").strip() or "changeme"
            name = r.get("name", "").strip()
            surname = r.get("surname", "").strip()
            if not email or not name or not surname:
                errors.append({"row": i + 1, "error": "email, name, surname required"})
                continue
            try:
                auth_response = supabase_admin_auth.auth.admin.create_user({
                    "email": email, "password": password, "email_confirm": True,
                })
                uid = str(auth_response.user.id)
            except Exception as exc:
                errors.append({"row": i + 1, "error": "Account creation failed"})
                continue
            try:
                if import_type == "students":
                    class_name = r.get("class_name", "").strip()
                    class_id = cls_map.get(class_name)
                    db.table("students").insert({
                        "id": uid, "name": name, "surname": surname,
                        "class_id": class_id,
                    }).execute()
                elif import_type == "teachers":
                    db.table("teachers").insert({
                        "id": uid, "name": name, "surname": surname,
                    }).execute()
                else:
                    db.table("admins").insert({
                        "id": uid, "name": name, "surname": surname,
                    }).execute()
                created += 1
            except Exception as exc:
                try:
                    supabase_admin_auth.auth.admin.delete_user(uid)
                except Exception:
                    pass
                errors.append({"row": i + 1, "error": "Profile creation failed"})

    elif import_type == "teacher_assignments":
        # Resolve names to IDs
        teachers = db.table("teachers").select("id, name, surname").execute()
        t_map = {f"{t['surname']} {t['name']}".strip(): t["id"] for t in (teachers.data or [])}
        t_email_map = {}  # will resolve by email if needed
        subjects = db.table("subjects").select("id, name").execute()
        s_map = {s["name"]: s["id"] for s in (subjects.data or [])}
        classes = db.table("classes").select("id, class_name").execute()
        c_map = {c["class_name"]: c["id"] for c in (classes.data or [])}

        for i, r in enumerate(rows):
            try:
                tid = r.get("teacher_id") or t_map.get(r.get("teacher_name", "").strip())
                sid = r.get("subject_id") or s_map.get(r.get("subject_name", "").strip())
                cid = r.get("class_id") or c_map.get(r.get("class_name", "").strip())
                if not tid or not sid or not cid:
                    errors.append({"row": i + 1, "error": "Could not resolve teacher/subject/class"})
                    continue
                db.table("teacher_assignments").insert({
                    "teacher_id": tid, "subject_id": sid, "class_id": cid,
                }).execute()
                created += 1
            except Exception as exc:
                errors.append({"row": i + 1, "error": "Processing failed"})

    elif import_type == "student_subjects":
        students = db.table("students").select("id, name, surname").execute()
        st_map = {f"{s['surname']} {s['name']}".strip(): s["id"] for s in (students.data or [])}
        subjects = db.table("subjects").select("id, name").execute()
        s_map = {s["name"]: s["id"] for s in (subjects.data or [])}
        classes = db.table("classes").select("id, class_name").execute()
        c_map = {c["class_name"]: c["id"] for c in (classes.data or [])}

        for i, r in enumerate(rows):
            try:
                student_id = r.get("student_id") or st_map.get(r.get("student_name", "").strip())
                subject_id = r.get("subject_id") or s_map.get(r.get("subject_name", "").strip())
                group_class_id = r.get("group_class_id") or c_map.get(r.get("group_class_name", "").strip()) or None
                if not student_id or not subject_id:
                    errors.append({"row": i + 1, "error": "Could not resolve student/subject"})
                    continue
                row_data = {"student_id": student_id, "subject_id": subject_id}
                if group_class_id:
                    row_data["group_class_id"] = group_class_id
                db.table("student_subjects").insert(row_data).execute()
                created += 1
            except Exception as exc:
                errors.append({"row": i + 1, "error": "Processing failed"})

    elif import_type == "schedule":
        teachers = db.table("teachers").select("id, name, surname").execute()
        t_map = {f"{t['surname']} {t['name']}".strip(): t["id"] for t in (teachers.data or [])}
        subjects = db.table("subjects").select("id, name").execute()
        s_map = {s["name"]: s["id"] for s in (subjects.data or [])}
        classes = db.table("classes").select("id, class_name").execute()
        c_map = {c["class_name"]: c["id"] for c in (classes.data or [])}

        for i, r in enumerate(rows):
            try:
                tid = r.get("teacher_id") or t_map.get(r.get("teacher_name", "").strip())
                sid = r.get("subject_id") or s_map.get(r.get("subject_name", "").strip())
                cid = r.get("class_id") or c_map.get(r.get("class_name", "").strip())
                if not tid or not sid or not cid:
                    errors.append({"row": i + 1, "error": "Could not resolve teacher/subject/class"})
                    continue
                db.table("schedule").insert({
                    "teacher_id": tid, "subject_id": sid, "class_id": cid,
                    "day_of_week": int(r.get("day_of_week", 0)),
                    "period": int(r.get("period", 0)),
                    "room": r.get("room", "").strip() or None,
                }).execute()
                created += 1
            except Exception as exc:
                errors.append({"row": i + 1, "error": "Processing failed"})

    else:
        return JsonResponse({"message": f"Unknown import type: {import_type}"}, status=400)

    return JsonResponse({"created": created, "errors": errors})


# ------------------------------------------------------------------
# Admin: events (special school events for groups/individual students)
# ------------------------------------------------------------------

@csrf_exempt
def admin_events(request):
    payload = _require_admin(request)
    if not payload:
        return JsonResponse({"message": "Unauthorized"}, status=401)
    if not _admin_has_perm(payload, "events"):
        return JsonResponse({"message": "No permission"}, status=403)

    try:
        db = ediary()

        if request.method == "GET":
            result = db.table("events").select("*").order("event_date", desc=True).execute()
            return JsonResponse({"events": result.data or []})

        if request.method == "POST":
            try:
                data = json.loads(request.body)
            except json.JSONDecodeError:
                return JsonResponse({"message": "Invalid JSON"}, status=400)

            title = data.get("title", "").strip()
            description = data.get("description", "").strip()
            event_date = data.get("event_date")
            event_end_date = data.get("event_end_date") or event_date
            start_time = data.get("start_time") or None
            end_time = data.get("end_time") or None
            affected_periods = data.get("affected_periods", [])
            target_type = data.get("target_type", "all")  # all, class, students
            target_class_ids = data.get("target_class_ids", [])
            target_student_ids = data.get("target_student_ids", [])

            if not title or not event_date:
                return JsonResponse({"message": "title and event_date required"}, status=400)

            row = {
                "title": title,
                "description": description,
                "event_date": event_date,
                "event_end_date": event_end_date,
                "start_time": start_time,
                "end_time": end_time,
                "affected_periods": affected_periods,
                "target_type": target_type,
                "target_class_ids": target_class_ids,
                "target_student_ids": target_student_ids,
            }
            result = db.table("events").insert(row).execute()
            return JsonResponse({"event": (result.data or [None])[0]}, status=201)

        return JsonResponse({"message": "Method not allowed"}, status=405)
    except Exception as exc:
        logger.exception("Server error")
        return JsonResponse({"message": "Internal server error"}, status=500)


@csrf_exempt
def admin_event_detail(request):
    payload = _require_admin(request)
    if not payload:
        return JsonResponse({"message": "Unauthorized"}, status=401)
    if not _admin_has_perm(payload, "events"):
        return JsonResponse({"message": "No permission"}, status=403)

    event_id = request.GET.get("id")
    if not event_id:
        return JsonResponse({"message": "id required"}, status=400)

    try:
        db = ediary()

        if request.method == "DELETE":
            db.table("events").delete().eq("id", event_id).execute()
            return JsonResponse({"deleted": True})

        if request.method == "PATCH":
            try:
                data = json.loads(request.body)
            except json.JSONDecodeError:
                return JsonResponse({"message": "Invalid JSON"}, status=400)
            updates = {}
            for key in ("title", "description", "event_date", "event_end_date", "start_time", "end_time", "affected_periods", "target_type", "target_class_ids", "target_student_ids"):
                if key in data:
                    updates[key] = data[key]
            if updates:
                db.table("events").update(updates).eq("id", event_id).execute()
            return JsonResponse({"updated": True})

        return JsonResponse({"message": "Method not allowed"}, status=405)
    except Exception as exc:
        logger.exception("Server error")
        return JsonResponse({"message": "Internal server error"}, status=500)


# ------------------------------------------------------------------
# Admin: holidays (school-wide non-school days)
# ------------------------------------------------------------------

@csrf_exempt
def admin_holidays(request):
    payload = _require_admin(request)
    if not payload:
        return JsonResponse({"message": "Unauthorized"}, status=401)
    if not _admin_has_perm(payload, "holidays"):
        return JsonResponse({"message": "No permission"}, status=403)

    try:
        db = ediary()

        if request.method == "GET":
            result = db.table("holidays").select("*").order("start_date").execute()
            return JsonResponse({"holidays": result.data or []})

        if request.method == "POST":
            try:
                data = json.loads(request.body)
            except json.JSONDecodeError:
                return JsonResponse({"message": "Invalid JSON"}, status=400)

            name = data.get("name", "").strip()
            start_date = data.get("start_date")
            end_date = data.get("end_date") or start_date

            if not name or not start_date:
                return JsonResponse({"message": "name and start_date required"}, status=400)

            row = {"name": name, "start_date": start_date, "end_date": end_date}
            result = db.table("holidays").insert(row).execute()
            return JsonResponse({"holiday": (result.data or [None])[0]}, status=201)

        return JsonResponse({"message": "Method not allowed"}, status=405)
    except Exception as exc:
        logger.exception("Server error")
        return JsonResponse({"message": "Internal server error"}, status=500)


@csrf_exempt
def admin_holiday_detail(request):
    payload = _require_admin(request)
    if not payload:
        return JsonResponse({"message": "Unauthorized"}, status=401)
    if not _admin_has_perm(payload, "holidays"):
        return JsonResponse({"message": "No permission"}, status=403)

    holiday_id = request.GET.get("id")
    if not holiday_id:
        return JsonResponse({"message": "id required"}, status=400)

    try:
        db = ediary()

        if request.method == "DELETE":
            db.table("holidays").delete().eq("id", holiday_id).execute()
            return JsonResponse({"deleted": True})

        if request.method == "PATCH":
            try:
                data = json.loads(request.body)
            except json.JSONDecodeError:
                return JsonResponse({"message": "Invalid JSON"}, status=400)
            updates = {}
            for key in ("name", "start_date", "end_date"):
                if key in data:
                    updates[key] = data[key]
            if updates:
                db.table("holidays").update(updates).eq("id", holiday_id).execute()
            return JsonResponse({"updated": True})

        return JsonResponse({"message": "Method not allowed"}, status=405)
    except Exception as exc:
        logger.exception("Server error")
        return JsonResponse({"message": "Internal server error"}, status=500)


# ------------------------------------------------------------------
# Public: get events & holidays for the current user
# ------------------------------------------------------------------

@csrf_exempt
def public_events(request):
    """Return events visible to the requesting user + all holidays."""
    payload = _verify_token(request)
    if not payload:
        return JsonResponse({"message": "Unauthorized"}, status=401)

    try:
        db = ediary()
        role = payload.get("role", "student")
        user_id = payload["sub"]

        # Holidays (visible to everyone)
        holidays = (db.table("holidays").select("*").order("start_date").execute()).data or []

        # Events
        all_events = (db.table("events").select("*").order("event_date").execute()).data or []

        # Filter events for this user
        visible_events = []
        student_class_id = None
        if role == "student":
            stu = db.table("students").select("class_id").eq("id", user_id).limit(1).execute()
            student_class_id = stu.data[0]["class_id"] if stu.data else None

        for ev in all_events:
            tt = ev.get("target_type", "all")
            if tt == "all":
                visible_events.append(ev)
            elif tt == "class" and student_class_id:
                ids = ev.get("target_class_ids") or []
                if student_class_id in ids:
                    visible_events.append(ev)
            elif tt == "students":
                ids = ev.get("target_student_ids") or []
                if user_id in ids:
                    visible_events.append(ev)
            elif role in ("teacher", "admin"):
                # Teachers and admins see all events
                visible_events.append(ev)

        return JsonResponse({"events": visible_events, "holidays": holidays})
    except Exception as exc:
        logger.exception("Server error")
        return JsonResponse({"message": "Internal server error"}, status=500)


# ------------------------------------------------------------------
# Teacher: study hall (duty teacher fills empty periods)
# ------------------------------------------------------------------

@csrf_exempt
def teacher_study_hall(request):
    payload = _verify_token(request)
    if not payload or payload.get("role") != "teacher":
        return JsonResponse({"message": "Unauthorized"}, status=401)

    try:
        teacher_id = payload["sub"]
        db = ediary()

        if request.method == "GET":
            # Return study hall sessions created by this teacher
            result = (
                db.table("study_hall")
                .select("*")
                .eq("teacher_id", teacher_id)
                .order("date", desc=True)
                .execute()
            )
            return JsonResponse({"sessions": result.data or []})

        if request.method == "POST":
            try:
                data = json.loads(request.body)
            except json.JSONDecodeError:
                return JsonResponse({"message": "Invalid JSON"}, status=400)

            date = data.get("date")
            period = data.get("period")
            room = data.get("room", "").strip()

            if not date or not period:
                return JsonResponse({"message": "date and period required"}, status=400)

            # Create or update study hall session
            existing = (
                db.table("study_hall")
                .select("id")
                .eq("teacher_id", teacher_id)
                .eq("date", date)
                .eq("period", period)
                .limit(1)
                .execute()
            )
            if existing.data:
                session_id = existing.data[0]["id"]
                db.table("study_hall").update({"room": room}).eq("id", session_id).execute()
            else:
                ins = db.table("study_hall").insert({
                    "teacher_id": teacher_id,
                    "date": date,
                    "period": int(period),
                    "room": room,
                }).execute()
                session_id = ins.data[0]["id"] if ins.data else None

            return JsonResponse({"session_id": session_id}, status=201)

        return JsonResponse({"message": "Method not allowed"}, status=405)
    except Exception as exc:
        logger.exception("Server error")
        return JsonResponse({"message": "Internal server error"}, status=500)


@csrf_exempt
def teacher_study_hall_students(request):
    """Get students who have no class for a given period on a given date."""
    payload = _verify_token(request)
    if not payload or payload.get("role") != "teacher":
        return JsonResponse({"message": "Unauthorized"}, status=401)

    date = request.GET.get("date")
    period = request.GET.get("period")

    if not date or not period:
        return JsonResponse({"message": "date and period required"}, status=400)

    period = int(period)

    # Figure out day_of_week from the date
    try:
        dt = datetime.fromisoformat(date)
        day_of_week = dt.isoweekday()  # 1=Mon ... 5=Fri
    except Exception:
        return JsonResponse({"message": "Invalid date"}, status=400)

    if day_of_week > 5:
        return JsonResponse({"students": []})

    try:
        db = ediary()

        # Get ALL schedule slots for this day+period (tells us which class_ids have class)
        sched = (
            db.table("schedule")
            .select("class_id, subject_id")
            .eq("day_of_week", day_of_week)
            .eq("period", period)
            .execute()
        ).data or []

        busy_class_ids = {s["class_id"] for s in sched}
        busy_subject_ids = {s["subject_id"] for s in sched}

        # Get ALL students (only those with a class assignment)
        all_students = (
            db.table("students")
            .select("id, name, surname, class_id")
            .not_.is_("class_id", "null")
            .order("surname")
            .order("name")
            .execute()
        ).data or []

        # Get student_subjects with group_class_id for cross-class groups
        all_ss = (
            db.table("student_subjects")
            .select("student_id, subject_id, group_class_id")
            .execute()
        ).data or []
        ss_by_student = {}
        for ss in all_ss:
            ss_by_student.setdefault(ss["student_id"], []).append(ss)

        # Class name lookup
        classes = (db.table("classes").select("id, class_name").execute()).data or []
        cls_map = {c["id"]: c["class_name"] for c in classes}

        # A student is "free" if they don't have any scheduled class at this period
        free_students = []
        for s in all_students:
            home_class = s["class_id"]
            has_class = False

            # Check 1: student's home class has a schedule slot at this period
            if home_class in busy_class_ids:
                # But only if student is actually enrolled in that subject
                # We check if there's a slot for their home class
                for slot in sched:
                    if slot["class_id"] == home_class:
                        has_class = True
                        break

            # Check 2: student might be in a group class that has a slot
            if not has_class:
                enrollments = ss_by_student.get(s["id"], [])
                for enr in enrollments:
                    gc = enr.get("group_class_id")
                    if gc and gc in busy_class_ids:
                        for slot in sched:
                            if slot["class_id"] == gc and slot["subject_id"] == enr["subject_id"]:
                                has_class = True
                                break
                    if has_class:
                        break

            if not has_class:
                free_students.append({
                    "id": s["id"],
                    "name": s["name"],
                    "surname": s["surname"],
                    "class_name": cls_map.get(home_class, ""),
                })

        # Also get existing study hall attendance for this teacher/date/period
        teacher_id = payload["sub"]
        sh_session = (
            db.table("study_hall")
            .select("id")
            .eq("teacher_id", teacher_id)
            .eq("date", date)
            .eq("period", period)
            .limit(1)
            .execute()
        ).data

        existing_att = []
        if sh_session:
            session_id = sh_session[0]["id"]
            existing_att = (
                db.table("study_hall_attendance")
                .select("student_id, status")
                .eq("study_hall_id", session_id)
                .execute()
            ).data or []

        return JsonResponse({
            "students": free_students,
            "attendance": existing_att,
        })
    except Exception as exc:
        logger.exception("Server error")
        return JsonResponse({"message": "Internal server error"}, status=500)


@csrf_exempt
def teacher_study_hall_attendance(request):
    """Save attendance for a study hall session."""
    payload = _verify_token(request)
    if not payload or payload.get("role") != "teacher":
        return JsonResponse({"message": "Unauthorized"}, status=401)

    if request.method != "POST":
        return JsonResponse({"message": "Method not allowed"}, status=405)

    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({"message": "Invalid JSON"}, status=400)

    session_id = data.get("session_id")
    records = data.get("records", [])

    if not session_id or not records:
        return JsonResponse({"message": "session_id and records required"}, status=400)

    try:
        db = ediary()

        # Delete existing attendance for this session
        db.table("study_hall_attendance").delete().eq("study_hall_id", session_id).execute()

        # Insert new records
        rows = []
        for r in records:
            rows.append({
                "study_hall_id": session_id,
                "student_id": r["student_id"],
                "status": r.get("status", "Present"),
            })

        if rows:
            db.table("study_hall_attendance").insert(rows).execute()

        return JsonResponse({"saved": len(rows)}, status=201)
    except Exception as exc:
        logger.exception("Server error")
        return JsonResponse({"message": "Internal server error"}, status=500)


# ------------------------------------------------------------------
# Admin: Attendance flags – suspicious students
# Students marked absent in one subject but present/late in another
# on the same day.
# ------------------------------------------------------------------

@csrf_exempt
def admin_attendance_flags(request):
    payload = _require_admin(request)
    if not payload:
        return JsonResponse({"message": "Unauthorized"}, status=401)
    if not _admin_has_perm(payload, "students"):
        return JsonResponse({"message": "No permission"}, status=403)
    if request.method != "GET":
        return JsonResponse({"message": "Method not allowed"}, status=405)

    # Optional date filter (default: last 7 days)
    from datetime import date as _date
    date_from = request.GET.get("from", "")
    date_to = request.GET.get("to", "")
    if not date_from:
        date_from = (_date.today() - timedelta(days=7)).isoformat()
    if not date_to:
        date_to = _date.today().isoformat()

    db = ediary()
    try:
        att_result = (
            db.table("attendance")
            .select("student_id, class_id, subject_id, date_recorded, status")
            .gte("date_recorded", date_from)
            .lte("date_recorded", date_to)
            .execute()
        )
        records = att_result.data or []

        # Build per-student-per-date status pairs
        from collections import defaultdict
        lookup = defaultdict(list)
        for r in records:
            lookup[(r["student_id"], r["date_recorded"])].append(r)

        # Find conflicts: absent in one subject, present/late/excused in another
        flags = []
        seen = set()
        for (sid, dt), entries in lookup.items():
            statuses = {e["status"] for e in entries}
            if "Absent" in statuses and statuses & {"Present", "Late", "Excused"}:
                if (sid, dt) in seen:
                    continue
                seen.add((sid, dt))
                absent_in = [e["subject_id"] for e in entries if e["status"] == "Absent"]
                present_in = [e["subject_id"] for e in entries if e["status"] in ("Present", "Late", "Excused")]
                flags.append({
                    "student_id": sid,
                    "date": dt,
                    "absent_subject_ids": absent_in,
                    "present_subject_ids": present_in,
                })

        # Enrich with student names + subject names
        student_ids = list({f["student_id"] for f in flags})
        subject_ids = list({sid for f in flags for sid in f["absent_subject_ids"] + f["present_subject_ids"]})

        student_map = {}
        if student_ids:
            stus = ediary().table("students").select("id, name, surname, class_id").in_("id", student_ids).execute()
            for s in (stus.data or []):
                student_map[s["id"]] = s

        subject_map = {}
        if subject_ids:
            subs = ediary().table("subjects").select("id, name").in_("id", subject_ids).execute()
            for s in (subs.data or []):
                subject_map[s["id"]] = s["name"]

        class_map = {}
        class_ids = list({s.get("class_id") for s in student_map.values() if s.get("class_id")})
        if class_ids:
            cls = ediary().table("classes").select("id, class_name").in_("id", class_ids).execute()
            for c in (cls.data or []):
                class_map[c["id"]] = c["class_name"]

        result = []
        for f in flags:
            stu = student_map.get(f["student_id"], {})
            result.append({
                "student_id": f["student_id"],
                "student_name": f"{stu.get('name', '')} {stu.get('surname', '')}".strip(),
                "class_name": class_map.get(stu.get("class_id"), ""),
                "date": f["date"],
                "absent_in": [subject_map.get(sid, sid) for sid in f["absent_subject_ids"]],
                "present_in": [subject_map.get(sid, sid) for sid in f["present_subject_ids"]],
            })

        result.sort(key=lambda x: (x["date"], x["student_name"]), reverse=True)

        return JsonResponse({"flags": result, "date_from": date_from, "date_to": date_to})
    except Exception as exc:
        logger.exception("admin_attendance_flags error")
        return JsonResponse({"message": "Internal server error"}, status=500)
