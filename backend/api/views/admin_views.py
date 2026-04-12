import json
import csv
import io
from datetime import date as _date, timedelta
from collections import defaultdict

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from ..utils import (
    logger,
    _verify_token,
    _make_token,
    _get_profile,
    _generate_password,
    _generate_email,
    _term_from_iso_date,
    _require_admin,
    _admin_level,
    _admin_has_perm,
    _is_super_admin_id,
    _is_master_admin_id,
    ediary,
    supabase_admin_auth,
    ALL_ADMIN_PERMISSIONS,
)

__all__ = [
    "admin_stats", "admin_impersonate",
    "admin_classes", "admin_class_detail",
    "admin_subjects", "admin_subject_detail",
    "admin_users", "admin_user_detail",
    "admin_teacher_assignments", "admin_teacher_assignment_delete",
    "admin_student_subjects", "admin_student_subject_delete",
    "admin_schedule", "admin_schedule_detail",
    "admin_csv_import",
    "admin_events", "admin_event_detail",
    "admin_holidays", "admin_holiday_detail",
    "admin_attendance_flags", "admin_student_lookup",
]


# ------------------------------------------------------------------
# Admin: dashboard statistics
# ------------------------------------------------------------------

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

    caller_level = _admin_level(payload)
    admins = [a for a in admins_raw if not _is_super_admin_id(a["id"])]
    if caller_level != "super":
        admins = [a for a in admins if not _is_master_admin_id(a["id"])]

    assignments = db.table("teacher_assignments").select("teacher_id").execute().data or []
    enrollments = db.table("student_subjects").select("student_id").execute().data or []
    schedule_slots = db.table("schedule").select("id").execute().data or []

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


# ------------------------------------------------------------------
# Admin: impersonate a user
# ------------------------------------------------------------------

@csrf_exempt
def admin_impersonate(request):
    """Generate a token for a target user so the admin can log in as them."""
    payload = _require_admin(request)
    if not payload:
        return JsonResponse({"message": "Unauthorized"}, status=401)
    if request.method != "POST":
        return JsonResponse({"message": "Method not allowed"}, status=405)

    caller_level = _admin_level(payload)
    if caller_level not in ("super", "master") and not _admin_has_perm(payload, "impersonate"):
        return JsonResponse({"message": "No permission to impersonate"}, status=403)

    data = json.loads(request.body)
    target_id = data.get("user_id", "").strip()
    if not target_id:
        return JsonResponse({"message": "user_id required"}, status=400)
    if _is_super_admin_id(target_id):
        return JsonResponse({"message": "Cannot impersonate this account"}, status=403)

    role, profile = _get_profile(target_id)
    if not role:
        return JsonResponse({"message": "User not found"}, status=404)

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


# ------------------------------------------------------------------
# Admin: classes CRUD
# ------------------------------------------------------------------

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
        if "class_name" in data:
            updates["class_name"] = data["class_name"].strip()
        if "grade_level" in data:
            updates["grade_level"] = int(data["grade_level"])
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


# ------------------------------------------------------------------
# Admin: subjects CRUD
# ------------------------------------------------------------------

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
        if "name" in data:
            updates["name"] = data["name"].strip()
        if "color_code" in data:
            updates["color_code"] = data["color_code"].strip() or None
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


# ------------------------------------------------------------------
# Admin: users (teachers, students, admins) CRUD
# ------------------------------------------------------------------

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
            classes = db.table("classes").select("id, class_name").execute()
            cls_map = {c["id"]: c["class_name"] for c in (classes.data or [])}
            for t in teachers:
                t["class_teacher_class_name"] = cls_map.get(t.get("class_teacher_of_class_id"), "")
            return JsonResponse({"users": teachers})

        elif role == "admin":
            if caller_level not in ("super", "master"):
                return JsonResponse({"message": "No permission"}, status=403)
            rows = db.table("admins").select("*").order("surname").order("name").execute()
            admins_list = rows.data or []
            admins_list = [a for a in admins_list if a.get("admin_level") != "super" and not _is_super_admin_id(a["id"])]
            if caller_level != "super":
                admins_list = [a for a in admins_list if not _is_master_admin_id(a["id"])]
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
        name = data.get("name", "").strip()
        surname = data.get("surname", "").strip()
        role = data.get("role", "student").strip()
        email = data.get("email", "").strip()
        password = data.get("password", "").strip()

        if not name or not surname:
            return JsonResponse({"message": "name, surname required"}, status=400)

        if password and len(password) < 8:
            return JsonResponse({"message": "Password must be at least 8 characters"}, status=400)

        generated_password = None
        if role == "student":
            if not password:
                password = _generate_password()
                generated_password = password
            if not email:
                existing = set()
                email = _generate_email(name, surname, existing)
        elif role == "teacher":
            if not password:
                password = _generate_password()
                generated_password = password
            if not email:
                existing = set()
                email = _generate_email(name, surname, existing, separator=".")
        else:
            if not email or not password:
                return JsonResponse({"message": "email, password required"}, status=400)

        # Permission checks per role
        if role == "admin":
            if caller_level not in ("super", "master"):
                return JsonResponse({"message": "Only master admins can create admins"}, status=403)
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
                row = {
                    "id": user_id, "name": name, "surname": surname,
                    "is_class_teacher": bool(is_class_teacher),
                    "class_teacher_of_class_id": class_teacher_of,
                }
                if generated_password:
                    row["default_password"] = generated_password
                db.table("teachers").upsert(row).execute()
            elif role == "admin":
                admin_permissions = data.get("permissions") or ALL_ADMIN_PERMISSIONS
                if requested_level in ("super", "master"):
                    admin_permissions = ALL_ADMIN_PERMISSIONS
                db.table("admins").insert({
                    "id": user_id, "name": name, "surname": surname,
                    "admin_level": requested_level,
                    "permissions": admin_permissions,
                }).execute()
            else:
                class_id = data.get("class_id", "").strip() or None
                row = {"id": user_id, "name": name, "surname": surname, "class_id": class_id}
                if generated_password:
                    row["default_password"] = generated_password
                db.table("students").upsert(row).execute()
        except Exception as exc:
            try:
                supabase_admin_auth.auth.admin.delete_user(user_id)
            except Exception:
                pass
            logger.exception("Profile creation failed")
            return JsonResponse({"message": f"Failed to create user profile: {str(exc)[:200]}"}, status=500)

        resp = {"user_id": user_id, "email": email, "role": role}
        if generated_password:
            resp["default_password"] = generated_password
        return JsonResponse(resp)

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

        # Hierarchy guards
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
            if "permissions" in data and not _is_master_admin_id(uid):
                updates["permissions"] = data["permissions"]
            if "admin_level" in data and caller_level == "super" and not _is_super_admin_id(uid):
                new_level = data["admin_level"].strip()
                if new_level in ("regular", "master", "super"):
                    updates["admin_level"] = new_level

        # Update email/password in Supabase Auth if provided
        if data.get("email") or data.get("password"):
            try:
                auth_updates = {}
                if data.get("email"):
                    auth_updates["email"] = data["email"].strip()
                if data.get("password"):
                    auth_updates["password"] = data["password"].strip()
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

        # Hierarchy guards
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

        # Cascade-delete related data for students
        if role == "student":
            for rel_table in ("homework_completions", "attendance", "grades",
                              "behavioral_entries", "student_subjects", "teacher_reports"):
                try:
                    db.table(rel_table).delete().eq("student_id", uid).execute()
                except Exception:
                    pass

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


# ------------------------------------------------------------------
# Admin: teacher assignments
# ------------------------------------------------------------------

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


# ------------------------------------------------------------------
# Admin: student-subject enrolments
# ------------------------------------------------------------------

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


# ------------------------------------------------------------------
# Admin: schedule CRUD
# ------------------------------------------------------------------

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


# ------------------------------------------------------------------
# Admin: CSV bulk import
# ------------------------------------------------------------------

@csrf_exempt
def admin_csv_import(request):
    """
    POST with JSON: { "type": "classes|subjects|students|teachers|admins|
    teacher_assignments|student_subjects|schedule", "rows": [...] }
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
            except Exception:
                errors.append({"row": i + 1, "error": "Processing failed"})

    elif import_type == "subjects":
        for i, r in enumerate(rows):
            try:
                db.table("subjects").insert({
                    "name": r.get("name", "").strip(),
                    "color_code": r.get("color_code", "").strip() or None,
                }).execute()
                created += 1
            except Exception:
                errors.append({"row": i + 1, "error": "Processing failed"})

    elif import_type in ("students", "teachers", "admins"):
        cls_map = {}
        existing_emails = set()
        if import_type == "students":
            classes = db.table("classes").select("id, class_name").execute()
            cls_map = {c["class_name"]: c["id"] for c in (classes.data or [])}

        credentials = []

        for i, r in enumerate(rows):
            email = r.get("email", "").strip()
            password = r.get("password", "").strip()
            name = r.get("name", "").strip()
            surname = r.get("surname", "").strip()
            if not name or not surname:
                errors.append({"row": i + 1, "error": "name, surname required"})
                continue

            generated_password = None
            if import_type == "students":
                if not password:
                    password = _generate_password()
                    generated_password = password
                if not email:
                    email = _generate_email(name, surname, existing_emails)
            elif import_type == "teachers":
                if not password:
                    password = _generate_password()
                    generated_password = password
                if not email:
                    email = _generate_email(name, surname, existing_emails, separator=".")
            else:
                if not email:
                    errors.append({"row": i + 1, "error": "email required"})
                    continue
                if not password:
                    password = "changeme"

            try:
                auth_response = supabase_admin_auth.auth.admin.create_user({
                    "email": email, "password": password, "email_confirm": True,
                })
                uid = str(auth_response.user.id)
            except Exception:
                errors.append({"row": i + 1, "error": "Account creation failed"})
                continue

            try:
                if import_type == "students":
                    class_name = r.get("class_name", "").strip()
                    class_id = cls_map.get(class_name)
                    row_data = {"id": uid, "name": name, "surname": surname, "class_id": class_id}
                    if generated_password:
                        row_data["default_password"] = generated_password
                    db.table("students").upsert(row_data).execute()
                    credentials.append({
                        "name": name, "surname": surname, "class_name": class_name,
                        "email": email, "password": generated_password or password,
                    })
                elif import_type == "teachers":
                    row_data = {"id": uid, "name": name, "surname": surname}
                    if generated_password:
                        row_data["default_password"] = generated_password
                    db.table("teachers").upsert(row_data).execute()
                    credentials.append({
                        "name": name, "surname": surname, "class_name": "",
                        "email": email, "password": generated_password or password,
                    })
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
                logger.exception("Profile insert failed for row %d", i + 1)
                errors.append({"row": i + 1, "error": f"Profile creation failed: {str(exc)[:120]}"})

    elif import_type == "teacher_assignments":
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
                db.table("teacher_assignments").insert({
                    "teacher_id": tid, "subject_id": sid, "class_id": cid,
                }).execute()
                created += 1
            except Exception:
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
            except Exception:
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
            except Exception:
                errors.append({"row": i + 1, "error": "Processing failed"})

    else:
        return JsonResponse({"message": f"Unknown import type: {import_type}"}, status=400)

    result = {"created": created, "errors": errors}
    if import_type in ("students", "teachers") and credentials:
        result["credentials"] = credentials
    return JsonResponse(result)


# ------------------------------------------------------------------
# Admin: events
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
            target_type = data.get("target_type", "all")
            target_class_ids = data.get("target_class_ids", [])
            target_student_ids = data.get("target_student_ids", [])
            target_teacher_ids = data.get("target_teacher_ids", [])

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
                "target_teacher_ids": target_teacher_ids,
            }
            result = db.table("events").insert(row).execute()
            return JsonResponse({"event": (result.data or [None])[0]}, status=201)

        return JsonResponse({"message": "Method not allowed"}, status=405)
    except Exception:
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
            for key in ("title", "description", "event_date", "event_end_date",
                        "start_time", "end_time", "affected_periods",
                        "target_type", "target_class_ids", "target_student_ids",
                        "target_teacher_ids"):
                if key in data:
                    updates[key] = data[key]
            if updates:
                db.table("events").update(updates).eq("id", event_id).execute()
            return JsonResponse({"updated": True})

        return JsonResponse({"message": "Method not allowed"}, status=405)
    except Exception:
        logger.exception("Server error")
        return JsonResponse({"message": "Internal server error"}, status=500)


# ------------------------------------------------------------------
# Admin: holidays
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
    except Exception:
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
    except Exception:
        logger.exception("Server error")
        return JsonResponse({"message": "Internal server error"}, status=500)


# ------------------------------------------------------------------
# Admin: attendance conflict flags
# ------------------------------------------------------------------

@csrf_exempt
def admin_attendance_flags(request):
    payload = _require_admin(request)
    if not payload:
        return JsonResponse({"message": "Unauthorized"}, status=401)
    if not _admin_has_perm(payload, "attendance"):
        return JsonResponse({"message": "No permission"}, status=403)
    if request.method != "GET":
        return JsonResponse({"message": "Method not allowed"}, status=405)

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

        lookup = defaultdict(list)
        for r in records:
            lookup[(r["student_id"], r["date_recorded"])].append(r)

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

        # Enrich with names
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

    except Exception:
        logger.exception("admin_attendance_flags error")
        return JsonResponse({"message": "Internal server error"}, status=500)


# ------------------------------------------------------------------
# Admin: comprehensive student lookup
# ------------------------------------------------------------------

@csrf_exempt
def admin_student_lookup(request):
    """GET ?student_id=<uuid> — return comprehensive data for a single student."""
    payload = _require_admin(request)
    if not payload:
        return JsonResponse({"message": "Unauthorized"}, status=401)
    if request.method != "GET":
        return JsonResponse({"message": "Method not allowed"}, status=405)

    student_id = request.GET.get("student_id", "").strip()
    if not student_id:
        return JsonResponse({"message": "student_id required"}, status=400)

    db = ediary()

    # Student profile
    stu = db.table("students").select("id, name, surname, class_id, default_password, profile_picture_url").eq("id", student_id).limit(1).execute()
    if not stu.data:
        return JsonResponse({"message": "Student not found"}, status=404)
    student = stu.data[0]

    # Lookups
    classes = db.table("classes").select("id, class_name, grade_level").execute()
    cls_map = {c["id"]: c for c in (classes.data or [])}
    subjects = db.table("subjects").select("id, name, color_code").execute()
    subj_map = {s["id"]: s for s in (subjects.data or [])}
    teachers = db.table("teachers").select("id, name, surname").execute()
    teacher_map = {t["id"]: f"{t['name']} {t['surname']}" for t in (teachers.data or [])}

    cls = cls_map.get(student["class_id"], {})

    # Enrolled subjects
    enrollments = db.table("student_subjects").select("subject_id, group_class_id").eq("student_id", student_id).execute()
    enrolled_subjects = []
    for e in (enrollments.data or []):
        sid = e["subject_id"]
        subj = subj_map.get(sid, {})
        gc = cls_map.get(e.get("group_class_id"), {})
        enrolled_subjects.append({
            "subject_id": sid,
            "subject": subj.get("name", "Unknown"),
            "color": subj.get("color_code", "#607D8B"),
            "group_class": gc.get("class_name", ""),
        })
    enrolled_subjects.sort(key=lambda x: x["subject"])

    # Grades
    grades_res = db.table("grades").select(
        "id, subject_id, assessment_name, grade_code, percentage, date_taken, comment, category, term, created_by_teacher_id"
    ).eq("student_id", student_id).order("date_taken", desc=True).execute()
    grades_by_subject = {}
    for g in (grades_res.data or []):
        sid = g.get("subject_id")
        grades_by_subject.setdefault(sid, []).append({
            "assessment": g.get("assessment_name", ""),
            "grade_code": g.get("grade_code", ""),
            "percentage": g.get("percentage"),
            "date": g.get("date_taken", ""),
            "category": g.get("category", "other"),
            "term": g.get("term", 1),
            "teacher": teacher_map.get(g.get("created_by_teacher_id"), ""),
            "comment": g.get("comment", ""),
        })

    # Attendance
    att_res = db.table("attendance").select(
        "subject_id, class_id, date_recorded, status, comment, recorded_by_teacher_id"
    ).eq("student_id", student_id).order("date_recorded", desc=True).execute()
    att_summary = {"Present": 0, "Late": 0, "Absent": 0, "Excused": 0}
    att_by_term = {1: {"total": 0, "present_or_late": 0}, 2: {"total": 0, "present_or_late": 0}}
    att_records = []
    for a in (att_res.data or []):
        st = a.get("status", "Present")
        if st in att_summary:
            att_summary[st] += 1
        term = _term_from_iso_date(a.get("date_recorded"))
        att_by_term[term]["total"] += 1
        if st in ("Present", "Late"):
            att_by_term[term]["present_or_late"] += 1
        att_records.append({
            "date": a.get("date_recorded", ""),
            "subject": subj_map.get(a.get("subject_id"), {}).get("name", ""),
            "status": st,
            "comment": (a.get("comment") or "").strip() or None,
            "teacher": teacher_map.get(a.get("recorded_by_teacher_id"), ""),
        })
    att_total = sum(att_summary.values())
    att_rate = round((att_summary["Present"] + att_summary["Late"]) / att_total * 100, 1) if att_total else None

    # Homework
    student_class_id = student.get("class_id")
    hw_res = db.table("homework").select("id, subject_id, class_id, title, due_date, teacher_id").execute()
    hw_for_student = [h for h in (hw_res.data or []) if h.get("class_id") == student_class_id]
    hw_ids = [h["id"] for h in hw_for_student]
    hwc_res = db.table("homework_completions").select("homework_id, status").eq("student_id", student_id).execute() if hw_ids else type('', (), {'data': []})()
    hwc_map = {c["homework_id"]: c["status"] for c in (hwc_res.data or [])}
    hw_list = []
    hw_counts = {"completed": 0, "partial": 0, "not_done": 0}
    for h in hw_for_student:
        status = hwc_map.get(h["id"], "not_done")
        if status in hw_counts:
            hw_counts[status] += 1
        hw_list.append({
            "title": h.get("title", ""),
            "due_date": h.get("due_date"),
            "subject": subj_map.get(h.get("subject_id"), {}).get("name", ""),
            "teacher": teacher_map.get(h.get("teacher_id"), ""),
            "status": status,
        })
    hw_list.sort(key=lambda x: x.get("due_date") or "", reverse=True)

    # Behavioral entries
    beh_res = db.table("behavioral_entries").select(
        "entry_type, subject_id, class_id, content, created_at, teacher_id"
    ).eq("student_id", student_id).order("created_at", desc=True).execute()
    beh_counts = {"positive": 0, "negative": 0, "note": 0}
    beh_records = []
    for b in (beh_res.data or []):
        bt = b.get("entry_type", "note")
        if bt in beh_counts:
            beh_counts[bt] += 1
        beh_records.append({
            "type": bt,
            "subject": subj_map.get(b.get("subject_id"), {}).get("name", ""),
            "content": (b.get("content") or ""),
            "date": str(b.get("created_at") or "")[:10],
            "teacher": teacher_map.get(b.get("teacher_id"), ""),
        })

    # Subject-level grade summaries
    subject_grades = []
    for es in enrolled_subjects:
        sid = es["subject_id"]
        sg = grades_by_subject.get(sid, [])
        pcts = [g["percentage"] for g in sg if g.get("percentage") is not None]
        subject_grades.append({
            "subject": es["subject"],
            "color": es["color"],
            "grade_count": len(sg),
            "average": round(sum(pcts) / len(pcts), 1) if pcts else None,
            "grades": sg,
        })

    return JsonResponse({
        "student": {
            "id": student["id"],
            "name": student["name"],
            "surname": student["surname"],
            "class_name": cls.get("class_name", ""),
            "grade_level": cls.get("grade_level", ""),
            "default_password": student.get("default_password") or None,
            "profile_picture_url": student.get("profile_picture_url") or None,
        },
        "enrolled_subjects": enrolled_subjects,
        "subject_grades": subject_grades,
        "attendance": {
            "summary": att_summary,
            "total": att_total,
            "rate": att_rate,
            "by_term": {
                "term_1": {
                    "total": att_by_term[1]["total"],
                    "rate": round(att_by_term[1]["present_or_late"] / att_by_term[1]["total"] * 100, 1) if att_by_term[1]["total"] else None,
                },
                "term_2": {
                    "total": att_by_term[2]["total"],
                    "rate": round(att_by_term[2]["present_or_late"] / att_by_term[2]["total"] * 100, 1) if att_by_term[2]["total"] else None,
                },
            },
            "records": att_records[:50],
        },
        "homework": {
            "counts": hw_counts,
            "items": hw_list,
        },
        "behavioral": {
            "counts": beh_counts,
            "records": beh_records,
        },
    })
