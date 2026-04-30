"""Endpoints for the new enrollment + group flow.

Read endpoints exposed:
  GET  /admin/enrollments/?student_id=...
  POST /admin/enrollments/                    body: {student_id, subjects: [...], english_level?}
  GET  /admin/enrollments/options/?year=10    options + rules for the UI
  GET  /admin/teacher-subjects/                list teacher↔subject map
  POST /admin/teacher-subjects/                body: {teacher_id, subject_ids: [...]} or {teacher_id, subject_id, years_allowed}
  POST /admin/teacher-subjects/delete/         body: {teacher_id, subject_id}
  POST /admin/seed-teacher-subjects/           derive from current schedule + apply year restrictions

CSV import for student choices is handled via the existing
/admin/csv-import/ endpoint (type "enrollments") — added in admin_views.
"""
import json
import re

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from ..utils import _require_admin, _admin_has_perm, ediary
from ..enrollment_constants import (
    Y10_11_MANDATORY_CLASS, Y10_11_MANDATORY_LEVEL_SPLIT,
    Y10_11_HUMANITIES, Y10_11_PE_BUCKET, Y10_11_LANGUAGES,
    Y12_13_MIN_SUBJECTS, Y12_13_NOT_OFFERED, Y12_13_ONLY,
    ENGLISH_OR_LIT,
    subject_years, is_subject_allowed_for_year,
    validate_year_10_11_choices, validate_year_12_13_choices,
    needs_ielts, years_allowed_for_teacher,
    GROUP_SIZE_MAX,
)


__all__ = [
    "admin_enrollment", "admin_enrollment_options",
    "admin_enrollment_bulk", "admin_enrollment_list",
    "admin_teacher_subjects", "admin_teacher_subjects_delete",
    "admin_seed_teacher_subjects",
]


# ---------------------------------------------------------------- helpers


_YEAR_RE = re.compile(r"^(\d{1,2})")


def _year_from_class_name(name: str) -> int | None:
    if not name:
        return None
    m = _YEAR_RE.match(name.strip())
    return int(m.group(1)) if m else None


def _student_year(db, student_id: str) -> tuple[int | None, str]:
    """Return (year, class_name) for a student, or (None, '') if unknown."""
    s = db.table("students").select("class_id").eq("id", student_id) \
        .single().execute().data
    if not s or not s.get("class_id"):
        return None, ""
    c = db.table("classes").select("class_name").eq("id", s["class_id"]) \
        .single().execute().data
    if not c:
        return None, ""
    return _year_from_class_name(c["class_name"]), c["class_name"]


def _subject_lookup(db) -> tuple[dict[str, str], dict[str, str]]:
    """Return (name_to_id, id_to_name) for subjects."""
    rows = db.table("subjects").select("id, name").execute().data or []
    name_to_id = {r["name"]: r["id"] for r in rows}
    id_to_name = {r["id"]: r["name"] for r in rows}
    return name_to_id, id_to_name


# ---------------------------------------------------------------- enrollments


@csrf_exempt
def admin_enrollment(request):
    payload = _require_admin(request)
    if not payload:
        return JsonResponse({"message": "Unauthorized"}, status=401)
    if not _admin_has_perm(payload, "students"):
        return JsonResponse({"message": "No permission"}, status=403)

    db = ediary()

    if request.method == "GET":
        student_id = request.GET.get("student_id", "").strip()
        if not student_id:
            return JsonResponse({"message": "student_id required"}, status=400)

        year, class_name = _student_year(db, student_id)
        student = db.table("students") \
            .select("id, name, surname, english_level, class_id") \
            .eq("id", student_id).single().execute().data
        if not student:
            return JsonResponse({"message": "Student not found"}, status=404)

        rows = db.table("student_subjects") \
            .select("subject_id, group_label") \
            .eq("student_id", student_id).execute().data or []
        _, id_to_name = _subject_lookup(db)
        subjects = [{
            "subject_id": r["subject_id"],
            "subject_name": id_to_name.get(r["subject_id"], "?"),
            "group_label": r.get("group_label"),
        } for r in rows]

        return JsonResponse({
            "student": {**student, "class_name": class_name, "year": year},
            "subjects": subjects,
        })

    if request.method == "POST":
        data = json.loads(request.body)
        student_id = data.get("student_id", "").strip()
        chosen_names = [s.strip() for s in data.get("subjects", []) if s.strip()]
        english_level = data.get("english_level")
        if english_level == "" or english_level is None:
            english_level = None
        else:
            try:
                english_level = int(english_level)
                if english_level < 1 or english_level > 5:
                    return JsonResponse({"message": "english_level must be 1..5"}, status=400)
            except (TypeError, ValueError):
                return JsonResponse({"message": "english_level must be int"}, status=400)

        if not student_id:
            return JsonResponse({"message": "student_id required"}, status=400)

        year, _ = _student_year(db, student_id)
        if year is None:
            return JsonResponse({"message": "Cannot determine student's year"}, status=400)

        # Validate choices per year rules.
        if year in (10, 11):
            ok, err = validate_year_10_11_choices(chosen_names)
            if not ok:
                return JsonResponse({"message": err}, status=400)
            # Mandatory class subjects (Math/Phys/Chem/Bio/ICT) auto-added.
            chosen_names = list(set(chosen_names) | set(Y10_11_MANDATORY_CLASS) |
                                set(Y10_11_MANDATORY_LEVEL_SPLIT))
        elif year in (12, 13):
            ok, err = validate_year_12_13_choices(chosen_names)
            if not ok:
                return JsonResponse({"message": err}, status=400)
            # IELTS auto-add if no English/EngLit.
            if needs_ielts(chosen_names):
                chosen_names = list(set(chosen_names) | {"IELTS"})
        else:
            return JsonResponse({"message": f"Year {year} not supported"}, status=400)

        name_to_id, _ = _subject_lookup(db)
        missing = [n for n in chosen_names if n not in name_to_id]
        if missing:
            return JsonResponse({
                "message": f"Subject(s) not in DB: {', '.join(missing)}"
            }, status=400)
        chosen_ids = [name_to_id[n] for n in chosen_names]

        # Replace student's enrollments wholesale.
        db.table("student_subjects").delete().eq("student_id", student_id).execute()
        if chosen_ids:
            db.table("student_subjects").insert([
                {"student_id": student_id, "subject_id": sid} for sid in chosen_ids
            ]).execute()

        # Update english_level (year 10/11 only — ignore for 12/13).
        if year in (10, 11):
            db.table("students").update({"english_level": english_level}) \
                .eq("id", student_id).execute()

        return JsonResponse({"saved": True, "subjects": chosen_names})

    return JsonResponse({"message": "Method not allowed"}, status=405)


@csrf_exempt
def admin_enrollment_options(request):
    """Return the rules + valid subject lists for a given year, so the
    enrollment UI can render the right tick-boxes and validate locally."""
    payload = _require_admin(request)
    if not payload:
        return JsonResponse({"message": "Unauthorized"}, status=401)

    try:
        year = int(request.GET.get("year", "0"))
    except ValueError:
        return JsonResponse({"message": "year required"}, status=400)

    db = ediary()
    name_to_id, _ = _subject_lookup(db)

    def names_present(names):
        return [n for n in names if n in name_to_id]

    if year in (10, 11):
        return JsonResponse({
            "year": year,
            "mandatory_class": names_present(Y10_11_MANDATORY_CLASS),
            "mandatory_level_split": names_present(Y10_11_MANDATORY_LEVEL_SPLIT),
            "humanities_pick_2": names_present(Y10_11_HUMANITIES),
            "pe_bucket_pick_1": names_present(Y10_11_PE_BUCKET),
            "languages_pick_1": names_present(Y10_11_LANGUAGES),
            "english_levels": [1, 2, 3, 4, 5],
        })
    if year in (12, 13):
        all_subjects = [n for n in name_to_id.keys()
                        if is_subject_allowed_for_year(n, 12)]
        return JsonResponse({
            "year": year,
            "min_subjects": Y12_13_MIN_SUBJECTS,
            "all_choices": sorted(all_subjects),
            "ielts_auto": "IELTS auto-added if neither English nor English Literature is chosen",
        })
    return JsonResponse({"message": f"Year {year} not supported"}, status=400)


# ---------------------------------------------------------------- list + bulk


@csrf_exempt
def admin_enrollment_list(request):
    """Return a flat list of every student with their enrollments,
    english level, and class. Used by the Enrollments tab."""
    payload = _require_admin(request)
    if not payload:
        return JsonResponse({"message": "Unauthorized"}, status=401)
    if not _admin_has_perm(payload, "students"):
        return JsonResponse({"message": "No permission"}, status=403)

    db = ediary()
    students = db.table("students") \
        .select("id, name, surname, class_id, english_level").execute().data or []
    classes = db.table("classes").select("id, class_name").execute().data or []
    enrolls = db.table("student_subjects") \
        .select("student_id, subject_id, group_label").execute().data or []
    _, id_to_name = _subject_lookup(db)

    class_by_id = {c["id"]: c["class_name"] for c in classes}
    by_student = {}
    for e in enrolls:
        by_student.setdefault(e["student_id"], []).append({
            "subject_id": e["subject_id"],
            "subject_name": id_to_name.get(e["subject_id"], "?"),
            "group_label": e.get("group_label"),
        })

    rows = []
    for s in students:
        cn = class_by_id.get(s.get("class_id"), "")
        yr = _year_from_class_name(cn)
        rows.append({
            "id": s["id"],
            "name": s["name"], "surname": s["surname"],
            "class_id": s.get("class_id"),
            "class_name": cn,
            "year": yr,
            "english_level": s.get("english_level"),
            "subjects": by_student.get(s["id"], []),
        })
    rows.sort(key=lambda r: ((r["class_name"] or "ZZ"),
                             (r["surname"] or "").lower(),
                             (r["name"] or "").lower()))
    return JsonResponse({"rows": rows})


@csrf_exempt
def admin_enrollment_bulk(request):
    """Bulk import student enrollments.
    Body: {
      "rows": [
        {"email": "...", "subjects": ["Mathematics", ...], "english_level": 3},
        ...
      ],
      "wipe_existing": false      # if true, clears all student_subjects first
    }
    Resolves email -> student_id via auth.users. Validates per-year rules
    using existing helpers. Returns summary + per-row errors.
    """
    payload = _require_admin(request)
    if not payload:
        return JsonResponse({"message": "Unauthorized"}, status=401)
    if not _admin_has_perm(payload, "students"):
        return JsonResponse({"message": "No permission"}, status=403)
    if request.method != "POST":
        return JsonResponse({"message": "Method not allowed"}, status=405)

    data = json.loads(request.body)
    in_rows = data.get("rows", [])
    wipe_existing = bool(data.get("wipe_existing"))
    if not isinstance(in_rows, list) or not in_rows:
        return JsonResponse({"message": "rows required"}, status=400)

    db = ediary()
    name_to_id, _ = _subject_lookup(db)

    # email -> student_id (via auth.users join through students.id)
    students = db.table("students").select("id, name, surname, class_id").execute().data or []
    classes = db.table("classes").select("id, class_name").execute().data or []
    class_year = {c["id"]: _year_from_class_name(c["class_name"]) for c in classes}

    # Resolve emails via Supabase auth.admin
    from ..utils import supabase_admin_auth
    email_to_id: dict[str, str] = {}
    try:
        page = 1
        while True:
            res = supabase_admin_auth.auth.admin.list_users(
                page=page, per_page=1000)
            users = res or []
            if not users:
                break
            for u in users:
                if getattr(u, "email", None):
                    email_to_id[u.email.lower()] = u.id
            if len(users) < 1000:
                break
            page += 1
    except Exception as e:
        return JsonResponse({"message": f"Could not list auth users: {e}"}, status=500)

    student_ids = {s["id"] for s in students}
    student_class = {s["id"]: s.get("class_id") for s in students}

    if wipe_existing:
        # Defensive delete-all: avoids rebuilding stale group labels.
        db.table("student_subjects").delete() \
            .neq("student_id", "00000000-0000-0000-0000-000000000000").execute()

    summary = {"imported": 0, "skipped": 0, "errors": []}
    bulk_inserts = []
    level_updates = []

    for idx, row in enumerate(in_rows):
        email = (row.get("email") or "").strip().lower()
        subjects = row.get("subjects") or []
        elevel = row.get("english_level")
        if not email:
            summary["errors"].append({"row": idx, "error": "missing email"})
            summary["skipped"] += 1
            continue
        sid = email_to_id.get(email)
        if not sid or sid not in student_ids:
            summary["errors"].append({"row": idx, "email": email,
                                      "error": "student not found"})
            summary["skipped"] += 1
            continue
        cid = student_class.get(sid)
        year = class_year.get(cid)
        if year is None:
            summary["errors"].append({"row": idx, "email": email,
                                      "error": "class/year unknown"})
            summary["skipped"] += 1
            continue

        chosen = [s.strip() for s in subjects if s and s.strip()]

        if year in (10, 11):
            ok, err = validate_year_10_11_choices(chosen)
            if not ok:
                summary["errors"].append({"row": idx, "email": email,
                                          "year": year, "error": err})
                summary["skipped"] += 1
                continue
            chosen = list(set(chosen)
                          | set(Y10_11_MANDATORY_CLASS)
                          | set(Y10_11_MANDATORY_LEVEL_SPLIT))
            # english level
            if elevel in (None, ""):
                lv = None
            else:
                try:
                    lv = int(elevel)
                    if lv < 1 or lv > 5:
                        lv = None
                except (TypeError, ValueError):
                    lv = None
            level_updates.append({"id": sid, "english_level": lv})
        elif year in (12, 13):
            ok, err = validate_year_12_13_choices(chosen)
            if not ok:
                summary["errors"].append({"row": idx, "email": email,
                                          "year": year, "error": err})
                summary["skipped"] += 1
                continue
            if needs_ielts(chosen):
                chosen = list(set(chosen) | {"IELTS"})
        else:
            summary["errors"].append({"row": idx, "email": email,
                                      "year": year, "error": "year not supported"})
            summary["skipped"] += 1
            continue

        missing_subjects = [s for s in chosen if s not in name_to_id]
        if missing_subjects:
            summary["errors"].append({"row": idx, "email": email,
                                      "error": f"subject(s) missing in DB: {missing_subjects}"})
            summary["skipped"] += 1
            continue

        # Per-student wipe so re-imports replace cleanly.
        if not wipe_existing:
            db.table("student_subjects").delete().eq("student_id", sid).execute()
        for n in chosen:
            bulk_inserts.append({"student_id": sid, "subject_id": name_to_id[n]})
        summary["imported"] += 1

    # Bulk insert
    if bulk_inserts:
        chunk = 500
        for i in range(0, len(bulk_inserts), chunk):
            db.table("student_subjects").insert(bulk_inserts[i:i+chunk]).execute()
    # English level updates
    for u in level_updates:
        db.table("students").update({"english_level": u["english_level"]}) \
            .eq("id", u["id"]).execute()

    return JsonResponse({"summary": summary})


# ---------------------------------------------------------------- teacher_subjects


@csrf_exempt
def admin_teacher_subjects(request):
    payload = _require_admin(request)
    if not payload:
        return JsonResponse({"message": "Unauthorized"}, status=401)
    if not _admin_has_perm(payload, "teachers"):
        return JsonResponse({"message": "No permission"}, status=403)

    db = ediary()

    if request.method == "GET":
        teacher_id = request.GET.get("teacher_id", "").strip()
        q = db.table("teacher_subjects") \
            .select("teacher_id, subject_id, years_allowed")
        if teacher_id:
            q = q.eq("teacher_id", teacher_id)
        rows = q.execute().data or []
        return JsonResponse({"rows": rows})

    if request.method == "POST":
        data = json.loads(request.body)
        teacher_id = data.get("teacher_id", "").strip()
        if not teacher_id:
            return JsonResponse({"message": "teacher_id required"}, status=400)

        # Bulk replace mode: subject_ids list (replaces all rows for teacher).
        if "subject_ids" in data:
            sids = [s.strip() for s in data["subject_ids"] if s.strip()]
            years = data.get("years_allowed") or ["10", "11", "12", "13"]
            db.table("teacher_subjects").delete() \
                .eq("teacher_id", teacher_id).execute()
            if sids:
                db.table("teacher_subjects").insert([
                    {"teacher_id": teacher_id, "subject_id": s,
                     "years_allowed": years}
                    for s in sids
                ]).execute()
            return JsonResponse({"saved": True, "count": len(sids)})

        # Single-row upsert mode.
        sid = data.get("subject_id", "").strip()
        if not sid:
            return JsonResponse({"message": "subject_id required"}, status=400)
        years = data.get("years_allowed") or ["10", "11", "12", "13"]

        existing = db.table("teacher_subjects") \
            .select("teacher_id") \
            .eq("teacher_id", teacher_id).eq("subject_id", sid) \
            .execute().data or []
        if existing:
            db.table("teacher_subjects") \
                .update({"years_allowed": years}) \
                .eq("teacher_id", teacher_id).eq("subject_id", sid).execute()
        else:
            db.table("teacher_subjects").insert({
                "teacher_id": teacher_id, "subject_id": sid,
                "years_allowed": years,
            }).execute()
        return JsonResponse({"saved": True})

    return JsonResponse({"message": "Method not allowed"}, status=405)


@csrf_exempt
def admin_teacher_subjects_delete(request):
    payload = _require_admin(request)
    if not payload:
        return JsonResponse({"message": "Unauthorized"}, status=401)
    if not _admin_has_perm(payload, "teachers"):
        return JsonResponse({"message": "No permission"}, status=403)
    if request.method != "POST":
        return JsonResponse({"message": "Method not allowed"}, status=405)

    data = json.loads(request.body)
    tid = data.get("teacher_id", "").strip()
    sid = data.get("subject_id", "").strip()
    if not tid or not sid:
        return JsonResponse({"message": "teacher_id and subject_id required"}, status=400)
    db = ediary()
    db.table("teacher_subjects").delete() \
        .eq("teacher_id", tid).eq("subject_id", sid).execute()
    return JsonResponse({"deleted": True})


# ---------------------------------------------------------------- seeder


@csrf_exempt
def admin_seed_teacher_subjects(request):
    """Derive teacher↔subject map from the current schedule and apply
    the hard-coded year restrictions. Wipes teacher_subjects first.
    Body: {} (no params).
    """
    payload = _require_admin(request)
    if not payload:
        return JsonResponse({"message": "Unauthorized"}, status=401)
    if not _admin_has_perm(payload, "teachers"):
        return JsonResponse({"message": "No permission"}, status=403)
    if request.method != "POST":
        return JsonResponse({"message": "Method not allowed"}, status=405)

    db = ediary()
    teachers = db.table("teachers").select("id, name, surname").execute().data or []
    classes = db.table("classes").select("id, class_name").execute().data or []
    schedule = db.table("schedule") \
        .select("teacher_id, subject_id, class_id").execute().data or []

    class_year = {c["id"]: _year_from_class_name(c["class_name"]) for c in classes}
    teacher_full = {t["id"]: f'{t["surname"]} {t["name"]}' for t in teachers}

    # teacher_id -> subject_id -> set of years observed
    derived = {}
    for s in schedule:
        tid = s.get("teacher_id")
        sid = s.get("subject_id")
        cid = s.get("class_id")
        if not tid or not sid or not cid:
            continue
        yr = class_year.get(cid)
        if yr is None:
            continue
        derived.setdefault(tid, {}).setdefault(sid, set()).add(str(yr))

    # Apply hard-coded year restrictions per teacher name.
    rows_to_insert = []
    for tid, subj_map in derived.items():
        full = teacher_full.get(tid, "")
        allowed = years_allowed_for_teacher(full)
        for sid, observed_years in subj_map.items():
            # Years to record = intersection of observed and allowed,
            # but if intersection empty (teacher restricted but only
            # taught the wrong year in past), fall back to allowed.
            yrs = sorted(set(allowed) & observed_years) or list(allowed)
            rows_to_insert.append({
                "teacher_id": tid, "subject_id": sid,
                "years_allowed": yrs,
            })

    db.table("teacher_subjects").delete().neq("teacher_id",
        "00000000-0000-0000-0000-000000000000").execute()
    if rows_to_insert:
        chunk = 500
        for i in range(0, len(rows_to_insert), chunk):
            db.table("teacher_subjects").insert(rows_to_insert[i:i+chunk]).execute()

    return JsonResponse({
        "seeded": True,
        "rows": len(rows_to_insert),
        "teachers": len(derived),
    })
