import json
from datetime import datetime

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from ..utils import (
    logger,
    _verify_token,
    ediary,
    supabase_admin_auth,
)

__all__ = ["schedule", "public_events"]


# ------------------------------------------------------------------
# Schedule (teacher + student)
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
        result = (
            db.table("schedule")
            .select("id, subject_id, class_id, teacher_id, day_of_week, period, room")
            .eq("teacher_id", user_id)
            .order("day_of_week")
            .order("period")
            .execute()
        )
    else:
        db2 = ediary()
        student = db2.table("students").select("class_id").eq("id", user_id).limit(1).execute()
        class_id = student.data[0]["class_id"] if student.data else None
        if not class_id:
            return JsonResponse({"schedule": []})

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

        result = (
            ediary().table("schedule")
            .select("id, subject_id, class_id, teacher_id, day_of_week, period, room")
            .eq("class_id", class_id)
            .order("day_of_week")
            .order("period")
            .execute()
        )

        if group_class_ids:
            group_result = (
                ediary().table("schedule")
                .select("id, subject_id, class_id, teacher_id, day_of_week, period, room")
                .in_("class_id", group_class_ids)
                .order("day_of_week")
                .order("period")
                .execute()
            )
            existing_slots = {(s["day_of_week"], s["period"]) for s in (result.data or [])}
            for slot in (group_result.data or []):
                key = (slot["day_of_week"], slot["period"])
                if key not in existing_slots:
                    result.data.append(slot)
                    existing_slots.add(key)

    # Lookups
    subj_result = ediary().table("subjects").select("id, name, color_code").execute()
    subj_map = {s["id"]: s for s in (subj_result.data or [])}

    cls_result = ediary().table("classes").select("id, class_name, grade_level").execute()
    cls_map = {c["id"]: c for c in (cls_result.data or [])}

    tch_result = ediary().table("teachers").select("id, name, surname").execute()
    teacher_name_map = {t["id"]: f"{t['name']} {t['surname']}" for t in (tch_result.data or [])}

    teacher_email_map = {}
    try:
        all_auth = supabase_admin_auth.auth.admin.list_users()
        tch_ids = set(teacher_name_map.keys())
        for u in (all_auth if isinstance(all_auth, list) else getattr(all_auth, 'users', []) or []):
            uid = str(getattr(u, 'id', '') or u.get('id', '') if isinstance(u, dict) else u.id)
            if uid in tch_ids:
                teacher_email_map[uid] = getattr(u, 'email', '') if not isinstance(u, dict) else u.get('email', '')
    except Exception:
        pass

    rows = []
    for slot in (result.data or []):
        subj = subj_map.get(slot["subject_id"], {})
        cls = cls_map.get(slot["class_id"], {})
        gl = cls.get("grade_level", 0)
        cn = cls.get("class_name", "")
        tid = slot.get("teacher_id")
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
            "teacher_name": teacher_name_map.get(tid, ""),
            "teacher_email": teacher_email_map.get(tid, ""),
        })

    study_hall_sessions = _get_study_hall_for_schedule(ediary(), user_id, role)
    substitutes = _get_substitutes_for_schedule(ediary(), user_id, role, rows, teacher_name_map)

    return JsonResponse({
        "schedule": rows,
        "study_hall": study_hall_sessions,
        "substitutes": substitutes,
    })


# ------------------------------------------------------------------
# Helpers (private)
# ------------------------------------------------------------------

def _get_study_hall_for_schedule(db, user_id, role):
    """Return study hall sessions relevant to this user."""
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
            att = (
                db.table("study_hall_attendance")
                .select("study_hall_id")
                .eq("student_id", user_id)
                .eq("status", "Present")
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


def _get_substitutes_for_schedule(db, user_id, role, schedule_rows, teacher_name_map):
    """Return substitute lessons as date-keyed overrides."""
    try:
        subj_map = {s["id"]: s["name"] for s in (db.table("subjects").select("id, name").execute().data or [])}
        cls_map = {c["id"]: c["class_name"] for c in (db.table("classes").select("id, class_name").execute().data or [])}
        if not teacher_name_map:
            for t in (db.table("teachers").select("id, name, surname").execute().data or []):
                teacher_name_map[t["id"]] = f"{t['name']} {t['surname']}"

        if role == "teacher":
            own = db.table("substitutes").select("*").eq("original_teacher_id", user_id).execute()
            covering = ediary().table("substitutes").select("*").eq("substitute_teacher_id", user_id).execute()
            all_subs = (own.data or []) + [r for r in (covering.data or []) if r.get("original_teacher_id") != user_id]
        else:
            class_ids = list({s["class_id"] for s in schedule_rows if s.get("class_id")})
            if not class_ids:
                return []
            all_subs = db.table("substitutes").select("*").in_("class_id", class_ids).execute().data or []

        return [
            {
                "id": r["id"],
                "date": r["date"],
                "period": r["period"],
                "subject": subj_map.get(r.get("subject_id"), ""),
                "subject_id": r.get("subject_id"),
                "class_name": cls_map.get(r.get("class_id"), ""),
                "class_id": r.get("class_id"),
                "original_teacher": teacher_name_map.get(r.get("original_teacher_id"), ""),
                "original_teacher_id": r.get("original_teacher_id"),
                "substitute_teacher": teacher_name_map.get(r.get("substitute_teacher_id"), ""),
                "substitute_teacher_id": r.get("substitute_teacher_id"),
                "room": r.get("room") or "",
                "note": r.get("note") or "",
                "topic": r.get("topic") or "",
                "is_substitute": True,
                "is_substitute_for_me": role == "teacher" and r.get("original_teacher_id") == user_id,
            }
            for r in all_subs
        ]
    except Exception:
        return []


# ------------------------------------------------------------------
# Public: events & holidays visible to the current user
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

        holidays = (db.table("holidays").select("*").order("start_date").execute()).data or []
        all_events = (db.table("events").select("*").order("event_date").execute()).data or []

        visible_events = []
        student_class_id = None
        if role == "student":
            stu = db.table("students").select("class_id").eq("id", user_id).limit(1).execute()
            student_class_id = stu.data[0]["class_id"] if stu.data else None

        for ev in all_events:
            tt = ev.get("target_type", "all")
            if role in ("teacher", "admin"):
                visible_events.append(ev)
            elif tt == "all":
                visible_events.append(ev)
            elif tt == "class" and student_class_id:
                ids = ev.get("target_class_ids") or []
                if student_class_id in ids:
                    visible_events.append(ev)
            elif tt == "students":
                ids = ev.get("target_student_ids") or []
                if user_id in ids:
                    visible_events.append(ev)

        return JsonResponse({"events": visible_events, "holidays": holidays})
    except Exception:
        logger.exception("Server error")
        return JsonResponse({"message": "Internal server error"}, status=500)
