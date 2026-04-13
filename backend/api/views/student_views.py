import json

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from ..utils import (
    logger,
    _verify_token,
    ediary,
    supabase_admin_auth,
)

__all__ = [
    "grades", "subjects", "diary_entries", "attendance",
    "announcements", "behavioral_entries",
]


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
        .select("id, subject_id, assessment_name, percentage, grade_code, date_taken, comment, category, term, created_by_teacher_id")
        .eq("student_id", payload["sub"])
        .order("date_taken", desc=False)
        .execute()
    )

    # Build subject-id → name lookup
    db2 = ediary()
    subj_result = db2.table("subjects").select("id, name, color_code").execute()
    subj_map = {s["id"]: s for s in (subj_result.data or [])}

    # Build teacher lookup (id → {name, profile_picture_url})
    db_t = ediary()
    teachers_result = db_t.table("teachers").select("id, name, surname, profile_picture_url").execute()
    teacher_map = {}
    for t in (teachers_result.data or []):
        teacher_map[t["id"]] = {
            "id": t["id"],
            "name": t["name"],
            "surname": t["surname"],
            "full_name": f"{t['name']} {t['surname']}",
            "profile_picture_url": t.get("profile_picture_url") or None,
        }

    # Collect unique teacher IDs to batch-fetch their emails
    teacher_ids_set = set()
    for row in (result.data or []):
        tid = row.get("created_by_teacher_id")
        if tid:
            teacher_ids_set.add(tid)

    # Batch fetch teacher emails from auth
    teacher_email_map = {}
    for tid in teacher_ids_set:
        try:
            auth_u = supabase_admin_auth.auth.admin.get_user_by_id(tid)
            teacher_email_map[tid] = auth_u.user.email if auth_u and auth_u.user else ""
        except Exception:
            teacher_email_map[tid] = ""

    # Also figure out which subjects each teacher teaches
    db_ta = ediary()
    all_assignments = db_ta.table("teacher_assignments").select("teacher_id, subject_id").execute()
    teacher_subjects = {}  # teacher_id -> set of subject names
    for a in (all_assignments.data or []):
        subj = subj_map.get(a["subject_id"])
        if subj:
            teacher_subjects.setdefault(a["teacher_id"], set()).add(subj["name"])

    rows = []
    for row in (result.data or []):
        subj = subj_map.get(row.get("subject_id"), {})
        tid = row.get("created_by_teacher_id")
        t_info = teacher_map.get(tid, {})
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
            "teacher": {
                "id": tid,
                "full_name": t_info.get("full_name", ""),
                "profile_picture_url": t_info.get("profile_picture_url"),
                "email": teacher_email_map.get(tid, ""),
                "subjects": sorted(teacher_subjects.get(tid, set())) if tid else [],
            } if tid else None,
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
# Announcements – return homework/tasks as announcements
# (Handles both student and teacher roles)
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
        result = (
            db.table("homework")
            .select("id, subject_id, class_id, title, description, due_date, created_at")
            .eq("teacher_id", user_id)
            .order("due_date", desc=True)
            .execute()
        )
    else:
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

    completion_map = {}
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
