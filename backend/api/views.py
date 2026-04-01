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
            if len(new_password) < 4:
                return JsonResponse({"message": "Password must be at least 4 characters"}, status=400)
            updates["password"] = new_password

        if not updates:
            return JsonResponse({"message": "Nothing to update"}, status=400)

        try:
            supabase_auth.auth.admin.update_user_by_id(user_id, updates)
        except Exception as exc:
            return JsonResponse({"message": f"Failed to update: {str(exc)}"}, status=400)

        return JsonResponse({"message": "Updated successfully"})

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
            "subject_color": subj.get("color_code", "#607D8B"),
            "assessment": row.get("assessment_name", ""),
            "percentage": row.get("percentage"),
            "grade_code": row.get("grade_code", ""),
            "date": row.get("date_taken", ""),
            "comment": row.get("comment", ""),
            "category": row.get("category", "other"),
            "term": row.get("term", 1),
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

    return JsonResponse({"schedule": rows})


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

        # Alert: student marked absent here but present/late/excused in another class/subject same day
        conflicting_students = []
        absent_ids = [r.get("student_id") for r in rows if r.get("status") == "Absent"]
        if absent_ids:
            same_day = (
                ediary().table("attendance")
                .select("student_id, class_id, subject_id, status")
                .eq("date_recorded", date)
                .in_("student_id", absent_ids)
                .execute()
            )
            for rec in (same_day.data or []):
                if rec.get("status") in ("Present", "Late", "Excused"):
                    if rec.get("class_id") != class_id or rec.get("subject_id") != subject_id:
                        conflicting_students.append(rec.get("student_id"))

        return JsonResponse({
            "saved": len(result.data or []),
            "alerts": {
                "absent_present_conflicts": sorted(list(set(conflicting_students))),
            },
        }, status=201)

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
        return JsonResponse({"message": str(exc)}, status=500)

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
        r = ediary().table("grades").update(updates).eq("id", grade_id).execute()
    except Exception as exc:
        return JsonResponse({"message": str(exc)}, status=500)

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
        ediary().table("grades").delete().eq("id", grade_id).execute()
    except Exception as exc:
        return JsonResponse({"message": str(exc)}, status=500)

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
            .select("student_id, entry_type")
            .in_("student_id", student_ids)
            .execute()
        ).data or []

    def build_student_stats(sid, subject_id=None, class_id=None):
        att_c = {"Present": 0, "Late": 0, "Absent": 0, "Excused": 0}
        att_term = {
            1: {"total": 0, "present_or_late": 0, "absent": 0},
            2: {"total": 0, "present_or_late": 0, "absent": 0},
        }
        comment_count = 0
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
                    comment_count += 1

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
            "comments": {
                "count": comment_count,
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
            for s in sorted(homeroom_students, key=lambda x: (x.get("surname", ""), x.get("name", ""))):
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
        for s in sorted(group_students, key=lambda x: (x.get("surname", ""), x.get("name", ""))):
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

        class_ids = [c for _, c in pairs]
        students = (
            db.table("students")
            .select("id, name, surname, class_id")
            .in_("class_id", class_ids)
            .order("surname")
            .order("name")
            .execute()
        )
        student_ids = [s["id"] for s in (students.data or [])]

        ss = (
            db.table("student_subjects")
            .select("student_id, subject_id, group_class_id")
            .in_("student_id", student_ids)
            .execute()
        ) if student_ids else type('', (), {'data': []})()

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
        except Exception as exc:
            return JsonResponse({
                "message": "teacher_reports table not available",
                "details": str(exc),
            }, status=500)

        existing_map = {
            (r.get("student_id"), r.get("subject_id"), r.get("class_id"), r.get("term")): r
            for r in existing_rows
        }

        reports = []
        ss_rows = ss.data or []
        for s in (students.data or []):
            for subj_id, class_id in pairs:
                group_class_id = None
                for row in ss_rows:
                    if row.get("student_id") == s["id"] and row.get("subject_id") == subj_id:
                        group_class_id = row.get("group_class_id")
                        break
                in_group = group_class_id == class_id or (not group_class_id and s.get("class_id") == class_id)
                if not in_group:
                    continue

                key = (s["id"], subj_id, class_id, int(term))
                existing_row = existing_map.get(key, {})
                reports.append({
                    "id": existing_row.get("id"),
                    "student_id": s["id"],
                    "student": f"{s.get('surname', '')} {s.get('name', '')}".strip(),
                    "subject_id": subj_id,
                    "subject": subj_map.get(subj_id, ""),
                    "class_id": class_id,
                    "class_name": cls_map.get(class_id, ""),
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
            return JsonResponse({
                "message": "Failed to save report",
                "details": str(exc),
            }, status=500)

        return JsonResponse({"report": result.data[0] if result.data else {}})

    return JsonResponse({"message": "Method not allowed"}, status=405)
