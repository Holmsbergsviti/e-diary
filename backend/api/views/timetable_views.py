# Chartwell E-Diary - timetable generation API
import json
import random
from collections import defaultdict

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from ..utils import (
    logger, _require_admin, _admin_has_perm, ediary,
    supabase_admin_auth, _generate_password, _generate_email,
)

__all__ = [
    "generate_timetable",
    "generate_multi",
    "save_multi",
    "import_schedule",
    "seed_from_json",
    "get_timetable",
    "update_slot",
    "get_class_data",
    "multi_class_data",
    "clear_timetable",
]


DAYS = [1, 2, 3, 4, 5]
PERIODS = list(range(1, 9))
DEFAULT_PERIODS_PER_WEEK = 4
MAX_RESTARTS = 40


def _auth(request):
    payload = _require_admin(request)
    if not payload:
        return None, JsonResponse({"message": "Unauthorized"}, status=401)
    if not _admin_has_perm(payload, "schedule"):
        return None, JsonResponse({"message": "No permission"}, status=403)
    return payload, None


def _fetch_class_subjects(db, class_id):
    """Return list of dicts: {subject_id, subject_name, teacher_id, teacher_name}
    derived from teacher_assignments for this class."""
    assigns = db.table("teacher_assignments") \
        .select("teacher_id, subject_id") \
        .eq("class_id", class_id) \
        .execute()
    rows = assigns.data or []
    if not rows:
        return []

    subj_ids = list({r["subject_id"] for r in rows})
    teacher_ids = list({r["teacher_id"] for r in rows})

    subj_rows = db.table("subjects").select("id, name").in_("id", subj_ids).execute().data or []
    teacher_rows = db.table("teachers").select("id, name, surname").in_("id", teacher_ids).execute().data or []

    s_map = {s["id"]: s["name"] for s in subj_rows}
    t_map = {t["id"]: f"{t.get('name', '')} {t.get('surname', '')}".strip() for t in teacher_rows}

    out = []
    for r in rows:
        out.append({
            "subject_id": r["subject_id"],
            "subject_name": s_map.get(r["subject_id"], ""),
            "teacher_id": r["teacher_id"],
            "teacher_name": t_map.get(r["teacher_id"], ""),
        })
    return out


def _fetch_teacher_busy(db, teacher_ids, exclude_class_id):
    """Map (teacher_id, day_of_week, period) -> True for slots already filled
    in OTHER classes."""
    if not teacher_ids:
        return {}
    rows = db.table("schedule") \
        .select("teacher_id, day_of_week, period, class_id") \
        .in_("teacher_id", teacher_ids) \
        .execute().data or []
    busy = {}
    for r in rows:
        if r.get("class_id") == exclude_class_id:
            continue
        busy[(r["teacher_id"], r["day_of_week"], r["period"])] = True
    return busy


def _generate(subjects, busy, break_after, max_same_per_day):
    """Random-restart constraint placer. Returns dict of (day, period) -> {subject_id, teacher_id}
    or None if unsolvable."""
    placements = []
    for s in subjects:
        for _ in range(s.get("periods_per_week", DEFAULT_PERIODS_PER_WEEK)):
            placements.append((s["subject_id"], s["teacher_id"]))

    for _attempt in range(MAX_RESTARTS):
        random.shuffle(placements)
        slots = {}
        same_per_day = defaultdict(int)
        teacher_used = dict(busy)
        success = True

        for subj_id, teacher_id in placements:
            slot_choices = [(d, p) for d in DAYS for p in PERIODS if (d, p) not in slots]
            random.shuffle(slot_choices)
            placed = False
            for d, p in slot_choices:
                if (teacher_id, d, p) in teacher_used:
                    continue
                if same_per_day[(d, subj_id)] >= max_same_per_day:
                    continue
                # Break constraint: no run of more than break_after consecutive filled periods
                run = 1
                pp = p - 1
                while pp >= 1 and (d, pp) in slots:
                    run += 1
                    pp -= 1
                pp = p + 1
                while pp <= 8 and (d, pp) in slots:
                    run += 1
                    pp += 1
                if run > break_after:
                    continue
                slots[(d, p)] = {"subject_id": subj_id, "teacher_id": teacher_id}
                same_per_day[(d, subj_id)] += 1
                teacher_used[(teacher_id, d, p)] = True
                placed = True
                break

            if not placed:
                success = False
                break

        if success:
            return slots

    return None


def _generate_joint(class_specs, busy_external, break_after, max_same):
    """Joint constraint placer across multiple classes.

    class_specs: list of dicts {class_id, building, subjects: [{subject_id, teacher_id, periods_per_week}]}
    busy_external: {(teacher_id, day, period): building_or_True} from classes NOT being generated
    Returns: dict class_id -> {(day, period): {subject_id, teacher_id}} or None.
    """
    placements = []
    class_building = {}
    for cs in class_specs:
        class_building[cs["class_id"]] = (cs.get("building") or "").strip()
        for s in cs["subjects"]:
            ppw = max(1, int(s.get("periods_per_week") or DEFAULT_PERIODS_PER_WEEK))
            for _ in range(ppw):
                placements.append((cs["class_id"], s["subject_id"], s["teacher_id"]))

    for _attempt in range(MAX_RESTARTS):
        random.shuffle(placements)
        per_class_slots = defaultdict(dict)         # class_id -> {(d,p): {...}}
        teacher_used = dict(busy_external)          # (t, d, p) -> truthy (building string or True)
        teacher_building = {k: v for k, v in busy_external.items() if isinstance(v, str)}
        same_per_day = defaultdict(int)             # (class_id, d, subj) -> count
        success = True

        for class_id, subj_id, teacher_id in placements:
            slot_choices = [(d, p) for d in DAYS for p in PERIODS
                            if (d, p) not in per_class_slots[class_id]]
            random.shuffle(slot_choices)
            placed = False
            for d, p in slot_choices:
                if (teacher_id, d, p) in teacher_used:
                    continue
                if same_per_day[(class_id, d, subj_id)] >= max_same:
                    continue
                # No more than break_after consecutive filled periods for this class
                run = 1
                pp = p - 1
                while pp >= 1 and (d, pp) in per_class_slots[class_id]:
                    run += 1
                    pp -= 1
                pp = p + 1
                while pp <= 8 and (d, pp) in per_class_slots[class_id]:
                    run += 1
                    pp += 1
                if run > break_after:
                    continue
                # Building constraint: same teacher in adjacent period must not switch building
                bld = class_building[class_id]
                conflict = False
                for np in (p - 1, p + 1):
                    if 1 <= np <= 8:
                        prev_bld = teacher_building.get((teacher_id, d, np))
                        if prev_bld and bld and prev_bld != bld:
                            conflict = True
                            break
                if conflict:
                    continue
                per_class_slots[class_id][(d, p)] = {
                    "subject_id": subj_id,
                    "teacher_id": teacher_id,
                }
                teacher_used[(teacher_id, d, p)] = bld or True
                if bld:
                    teacher_building[(teacher_id, d, p)] = bld
                same_per_day[(class_id, d, subj_id)] += 1
                placed = True
                break

            if not placed:
                success = False
                break

        if success:
            return dict(per_class_slots)

    return None


@csrf_exempt
def generate_multi(request):
    payload, err = _auth(request)
    if err:
        return err
    if request.method != "POST":
        return JsonResponse({"message": "Method not allowed"}, status=405)

    try:
        data = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"message": "Invalid JSON"}, status=400)

    classes_in = data.get("classes") or []
    if not isinstance(classes_in, list) or not classes_in:
        return JsonResponse({"message": "classes (list) required"}, status=400)

    constraints = data.get("constraints") or {}
    try:
        break_after = int(constraints.get("break_after", 4))
        max_same = int(constraints.get("max_same_subject_per_day", 2))
    except (TypeError, ValueError):
        return JsonResponse({"message": "Invalid constraints"}, status=400)
    if break_after < 1 or max_same < 1:
        return JsonResponse({"message": "Constraints must be >= 1"}, status=400)

    db = ediary()

    # Validate inputs and build class_specs. Classes without teacher
    # assignments are skipped (with a note) instead of failing the batch.
    class_specs = []
    selected_class_ids = []
    skipped = []
    for c in classes_in:
        cid = (c.get("class_id") or "").strip()
        if not cid:
            return JsonResponse({"message": "Each class needs class_id"}, status=400)
        building = (c.get("building") or "").strip()

        # Pull subjects from teacher_assignments for this class
        assigned = db.table("teacher_assignments") \
            .select("teacher_id, subject_id") \
            .eq("class_id", cid) \
            .execute().data or []
        if not assigned:
            skipped.append(cid)
            continue
        selected_class_ids.append(cid)

        # Optional per-subject periods_per_week override from request
        ppw_overrides = {}
        for s in (c.get("subjects") or []):
            sid = (s.get("subject_id") or "").strip()
            if sid:
                try:
                    ppw_overrides[sid] = int(s.get("periods_per_week") or DEFAULT_PERIODS_PER_WEEK)
                except (TypeError, ValueError):
                    pass

        subjects = []
        for a in assigned:
            sid = a["subject_id"]
            subjects.append({
                "subject_id": sid,
                "teacher_id": a["teacher_id"],
                "periods_per_week": ppw_overrides.get(sid, DEFAULT_PERIODS_PER_WEEK),
            })

        class_specs.append({
            "class_id": cid,
            "building": building,
            "subjects": subjects,
        })

    # Pull busy from non-selected classes
    all_teacher_ids = list({s["teacher_id"] for cs in class_specs for s in cs["subjects"]})
    busy_external = {}
    if all_teacher_ids:
        ext_rows = db.table("schedule") \
            .select("teacher_id, day_of_week, period, class_id") \
            .in_("teacher_id", all_teacher_ids) \
            .execute().data or []
        # Need building of OTHER classes — but we don't have it stored. Treat as unknown:
        # mark busy True; building constraint cannot apply to unknown buildings.
        for r in ext_rows:
            if r.get("class_id") in selected_class_ids:
                continue
            busy_external[(r["teacher_id"], r["day_of_week"], r["period"])] = True

    if not class_specs:
        return JsonResponse({
            "message": "None of the selected classes have teacher assignments yet. "
                       "Assign teachers to subjects in the admin panel first.",
        }, status=400)

    solution = _generate_joint(class_specs, busy_external, break_after, max_same)
    if solution is None:
        return JsonResponse({
            "message": f"Could not generate after {MAX_RESTARTS} attempts. "
                       "Try relaxing constraints, reducing classes, or check teacher availability.",
        }, status=409)

    # Generation is preview-only: do NOT persist. The frontend admin
    # confirms via /api/timetable/save-multi/ to commit the changes.

    # Build response with names
    subj_ids_all = list({m["subject_id"] for slots in solution.values() for m in slots.values()})
    teach_ids_all = list({m["teacher_id"] for slots in solution.values() for m in slots.values()})
    s_rows = db.table("subjects").select("id, name").in_("id", subj_ids_all or [""]).execute().data or []
    t_rows = db.table("teachers").select("id, name, surname").in_("id", teach_ids_all or [""]).execute().data or []
    s_map = {s["id"]: s["name"] for s in s_rows}
    t_map = {t["id"]: f"{t.get('name', '')} {t.get('surname', '')}".strip() for t in t_rows}
    c_rows = db.table("classes").select("id, class_name").in_("id", selected_class_ids or [""]).execute().data or []
    c_map = {c["id"]: c["class_name"] for c in c_rows}

    timetables = {}
    for cid, slots in solution.items():
        t = {str(d): {} for d in DAYS}
        for (d, p), meta in slots.items():
            t[str(d)][str(p)] = {
                "subject_id": meta["subject_id"],
                "subject_name": s_map.get(meta["subject_id"], ""),
                "teacher_id": meta["teacher_id"],
                "teacher_name": t_map.get(meta["teacher_id"], ""),
            }
        timetables[cid] = {
            "class_id": cid,
            "class_name": c_map.get(cid, ""),
            "timetable": t,
            "filled_slots": len(slots),
        }

    total_filled = sum(len(s) for s in solution.values())
    total_slots = len(selected_class_ids) * len(DAYS) * len(PERIODS)
    skipped_with_names = []
    if skipped:
        sk_rows = db.table("classes").select("id, class_name").in_("id", skipped).execute().data or []
        sk_map = {r["id"]: r["class_name"] for r in sk_rows}
        skipped_with_names = [{"class_id": cid, "class_name": sk_map.get(cid, cid)} for cid in skipped]

    return JsonResponse({
        "success": True,
        "preview": True,
        "timetables": timetables,
        "skipped": skipped_with_names,
        "stats": {
            "classes_count": len(selected_class_ids),
            "total_slots": total_slots,
            "filled_slots": total_filled,
            "free_slots": total_slots - total_filled,
        },
    })


@csrf_exempt
def multi_class_data(request):
    """Return per-class subject and student summary for a list of class_ids."""
    payload, err = _auth(request)
    if err:
        return err
    if request.method != "GET":
        return JsonResponse({"message": "Method not allowed"}, status=405)

    raw = (request.GET.get("class_ids") or "").strip()
    if not raw:
        return JsonResponse({"message": "class_ids required"}, status=400)
    ids = [x.strip() for x in raw.split(",") if x.strip()]
    if not ids:
        return JsonResponse({"message": "class_ids required"}, status=400)

    db = ediary()
    classes_rows = db.table("classes").select("id, class_name, grade_level").in_("id", ids).execute().data or []
    c_map = {c["id"]: c for c in classes_rows}

    out = []
    for cid in ids:
        if cid not in c_map:
            continue
        subjects = _fetch_class_subjects(db, cid)
        students = db.table("students").select("id").eq("class_id", cid).execute().data or []
        out.append({
            "class_id": cid,
            "class_name": c_map[cid]["class_name"],
            "grade_level": c_map[cid].get("grade_level"),
            "subjects": subjects,
            "student_count": len(students),
        })
    return JsonResponse({"classes": out})


@csrf_exempt
def save_multi(request):
    """Persist a previously-generated multi-class timetable. The body mirrors
    the shape generate_multi returned: { timetables: { class_id: { timetable:
    { day: { period: { subject_id, teacher_id, ... } } } } } }. Each listed
    class has its existing schedule rows wiped before the new rows are
    inserted so the operation is idempotent."""
    payload, err = _auth(request)
    if err:
        return err
    if request.method != "POST":
        return JsonResponse({"message": "Method not allowed"}, status=405)

    try:
        data = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"message": "Invalid JSON"}, status=400)

    timetables = data.get("timetables") or {}
    if not isinstance(timetables, dict) or not timetables:
        return JsonResponse({"message": "timetables required"}, status=400)

    db = ediary()
    bulk_rows = []
    class_ids = list(timetables.keys())

    for cid, block in timetables.items():
        tt = (block or {}).get("timetable") or {}
        for day_str, periods in tt.items():
            try:
                day = int(day_str)
            except (TypeError, ValueError):
                continue
            if not (1 <= day <= 5):
                continue
            for period_str, meta in (periods or {}).items():
                try:
                    period = int(period_str)
                except (TypeError, ValueError):
                    continue
                if not (1 <= period <= 8):
                    continue
                if not meta or not meta.get("subject_id") or not meta.get("teacher_id"):
                    continue
                bulk_rows.append({
                    "class_id": cid,
                    "subject_id": meta["subject_id"],
                    "teacher_id": meta["teacher_id"],
                    "day_of_week": day,
                    "period": period,
                })

    try:
        for cid in class_ids:
            db.table("schedule").delete().eq("class_id", cid).execute()
        if bulk_rows:
            db.table("schedule").insert(bulk_rows).execute()
    except Exception:
        logger.exception("Failed to save multi-class timetable")
        return JsonResponse({"message": "Failed to save timetables"}, status=500)

    return JsonResponse({"saved": True, "rows": len(bulk_rows)})


@csrf_exempt
def seed_from_json(request):
    """One-shot seeder for the upper-secondary timetable. Takes a payload of:
        {
          "wipe": true,
          "rows": [
            {"teacher_name": "Kantar Martina", "class_name": "10A",
             "subject_name": "English", "day_of_week": 5, "period": 1,
             "room": "S1", "group": "ENG 3"},
            ...
          ]
        }
    and:
      1. Creates any missing subjects (canonical set the parser uses).
      2. Creates any missing teachers (auth user + teachers row), generating
         an email and a default password automatically.
      3. Wires teacher_assignments for every (teacher, subject, class) the
         payload references.
      4. Optionally wipes existing schedule rows for the affected classes.
      5. Inserts the schedule rows.
    Returns counts plus per-step diagnostics. Requires admin with the
    `schedule` and `teachers` permissions."""
    payload, err = _auth(request)
    if err:
        return err
    if not _admin_has_perm(payload, "teachers"):
        return JsonResponse({"message": "Need teachers permission"}, status=403)
    if request.method != "POST":
        return JsonResponse({"message": "Method not allowed"}, status=405)

    try:
        data = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"message": "Invalid JSON"}, status=400)

    rows = data.get("rows") or []
    if not isinstance(rows, list) or not rows:
        return JsonResponse({"message": "rows (list) required"}, status=400)
    wipe = bool(data.get("wipe"))

    db = ediary()

    # 1) Subjects: ensure each unique subject_name exists.
    needed_subjects = sorted({(r.get("subject_name") or "").strip() for r in rows if r.get("subject_name")})
    existing = db.table("subjects").select("id, name").execute().data or []
    subj_map = {s["name"]: s["id"] for s in existing}
    created_subjects = []
    for name in needed_subjects:
        if name not in subj_map:
            res = db.table("subjects").insert({"name": name}).execute()
            if res.data:
                subj_map[name] = res.data[0]["id"]
                created_subjects.append(name)

    # 2) Classes: lookup only — we never create classes silently.
    classes_rows = db.table("classes").select("id, class_name").execute().data or []
    class_map = {c["class_name"]: c["id"] for c in classes_rows}
    missing_classes = sorted({(r.get("class_name") or "").strip() for r in rows
                              if (r.get("class_name") or "").strip() not in class_map})

    # 3) Teachers: create any missing.
    needed_teachers = sorted({(r.get("teacher_name") or "").strip() for r in rows if r.get("teacher_name")})
    existing_teachers = db.table("teachers").select("id, name, surname").execute().data or []
    def teacher_key(name: str, surname: str) -> str:
        return f"{name.strip().lower()} {surname.strip().lower()}"
    teacher_map: dict[str, str] = {}
    for t in existing_teachers:
        teacher_map[teacher_key(t.get("name", ""), t.get("surname", ""))] = t["id"]
        # Also accept "surname name" ordering as the PDF lists.
        teacher_map[teacher_key(t.get("surname", ""), t.get("name", ""))] = t["id"]

    created_teachers = []
    teacher_credentials = []  # for export in the response
    existing_emails = set()
    try:
        ulist = supabase_admin_auth.auth.admin.list_users()
        for u in (getattr(ulist, "users", None) or ulist or []):
            email = getattr(u, "email", None) or (u.get("email") if isinstance(u, dict) else None)
            if email:
                existing_emails.add(email.lower())
    except Exception:
        logger.exception("Failed to list auth users; emails may collide")

    for full_name in needed_teachers:
        # PDF is "Surname Name". Try that ordering first; fall back to space-split.
        parts = full_name.split()
        if len(parts) < 2:
            continue
        surname = parts[0]
        first = " ".join(parts[1:])
        if teacher_key(first, surname) in teacher_map or teacher_key(surname, first) in teacher_map:
            continue
        # Create auth user + teachers row.
        email = _generate_email(first, surname, existing_emails)
        existing_emails.add(email.lower())
        password = _generate_password(10)
        try:
            auth_response = supabase_admin_auth.auth.admin.create_user({
                "email": email,
                "password": password,
                "email_confirm": True,
            })
            uid = str(auth_response.user.id)
        except Exception:
            logger.exception("Failed to create auth user for %s", full_name)
            continue
        try:
            db.table("teachers").insert({
                "id": uid, "name": first, "surname": surname,
                "default_password": password,
            }).execute()
        except Exception:
            logger.exception("Failed to insert teachers row for %s", full_name)
            try:
                supabase_admin_auth.auth.admin.delete_user(uid)
            except Exception:
                pass
            continue
        teacher_map[teacher_key(first, surname)] = uid
        teacher_map[teacher_key(surname, first)] = uid
        created_teachers.append(full_name)
        teacher_credentials.append({"name": full_name, "email": email, "password": password})

    # 4) teacher_assignments: union of (teacher, subject, class) referenced.
    needed_assignments = set()
    skipped_rows = []
    for r in rows:
        cls_name = (r.get("class_name") or "").strip()
        subj_name = (r.get("subject_name") or "").strip()
        teacher_name = (r.get("teacher_name") or "").strip()
        cid = class_map.get(cls_name)
        sid = subj_map.get(subj_name)
        parts = teacher_name.split()
        if len(parts) >= 2:
            tid = teacher_map.get(teacher_key(parts[1] if len(parts) == 2 else " ".join(parts[1:]), parts[0])) \
                or teacher_map.get(teacher_key(parts[0], " ".join(parts[1:])))
        else:
            tid = None
        if not (cid and sid and tid):
            skipped_rows.append({"reason": "unresolved", "row": r,
                                  "have": {"class": bool(cid), "subject": bool(sid), "teacher": bool(tid)}})
            continue
        needed_assignments.add((tid, sid, cid))

    existing_assignments_rows = db.table("teacher_assignments").select("teacher_id, subject_id, class_id").execute().data or []
    existing_assignments = {(a["teacher_id"], a["subject_id"], a["class_id"]) for a in existing_assignments_rows}
    new_assignments = [{"teacher_id": t, "subject_id": s, "class_id": c}
                       for (t, s, c) in needed_assignments - existing_assignments]
    if new_assignments:
        chunk = 200
        for i in range(0, len(new_assignments), chunk):
            db.table("teacher_assignments").insert(new_assignments[i:i + chunk]).execute()

    # 5) Schedule rows. Wipe affected classes if requested.
    affected_class_ids = {class_map[c] for c in {r.get("class_name") for r in rows} if c in class_map}
    if wipe:
        for cid in affected_class_ids:
            db.table("schedule").delete().eq("class_id", cid).execute()

    # The schema enforces UNIQUE(teacher_id, day_of_week, period) — collapse
    # any duplicates the parser produced for the same (teacher, day, period)
    # before inserting.
    dedup: dict[tuple, dict] = {}
    insert_rows = []
    for r in rows:
        cls_name = (r.get("class_name") or "").strip()
        subj_name = (r.get("subject_name") or "").strip()
        teacher_name = (r.get("teacher_name") or "").strip()
        cid = class_map.get(cls_name)
        sid = subj_map.get(subj_name)
        parts = teacher_name.split()
        tid = None
        if len(parts) >= 2:
            tid = teacher_map.get(teacher_key(" ".join(parts[1:]), parts[0])) \
                or teacher_map.get(teacher_key(parts[0], " ".join(parts[1:])))
        try:
            day = int(r.get("day_of_week"))
            period = int(r.get("period"))
        except (TypeError, ValueError):
            continue
        if not (cid and sid and tid):
            continue
        if not (1 <= day <= 5) or not (1 <= period <= 8):
            continue
        # The unique constraint is per-teacher; if a teacher is wired to a
        # combined lesson across multiple classes, the original PDF is
        # showing one slot. Insert one row per class with the same teacher,
        # which would violate the unique. Pick first class only — i.e.
        # collapse combined lessons into a single canonical class for the
        # teacher's slot. We keep all classes' rows by inserting one row
        # per class but with distinct (teacher, day, period) combos: not
        # possible. So instead we use the FIRST class as canonical and
        # skip the rest. Combined lessons will still appear because the
        # frontend matches schedule by class_id.
        key = (tid, day, period)
        if key in dedup:
            continue
        row = {
            "teacher_id": tid, "subject_id": sid, "class_id": cid,
            "day_of_week": day, "period": period,
            "room": (r.get("room") or "").strip() or None,
        }
        dedup[key] = row
        insert_rows.append(row)

    inserted = 0
    if insert_rows:
        try:
            chunk = 200
            for i in range(0, len(insert_rows), chunk):
                db.table("schedule").insert(insert_rows[i:i + chunk]).execute()
                inserted += min(chunk, len(insert_rows) - i)
        except Exception:
            logger.exception("Failed to bulk insert schedule")
            return JsonResponse({"message": "Schedule insert failed", "inserted": inserted}, status=500)

    return JsonResponse({
        "subjects_created": created_subjects,
        "teachers_created": created_teachers,
        "teacher_credentials": teacher_credentials,
        "missing_classes": missing_classes,
        "assignments_created": len(new_assignments),
        "schedule_rows_inserted": inserted,
        "schedule_rows_skipped": len(rows) - inserted,
    })


@csrf_exempt
def import_schedule(request):
    """Bulk import schedule rows from a JSON payload that uses class_name and
    teacher initials/names instead of UUIDs. Useful for seeding a real-world
    timetable without having to look up every UUID by hand. Body shape:
        {
          "wipe": true|false,           // optional, default false
          "rows": [
            {
              "class_name": "10a",
              "subject_name": "Mathematics",
              "teacher_name": "Bakovic Ana",   // or "teacher_initials": "BA"
              "day_of_week": 1,
              "period": 4,
              "room": "R1"               // optional
            },
            ...
          ]
        }
    The endpoint resolves each row to UUIDs by querying classes / subjects /
    teachers and skips rows whose lookups fail, returning a per-row result
    array so the caller can spot mistakes."""
    payload, err = _auth(request)
    if err:
        return err
    if request.method != "POST":
        return JsonResponse({"message": "Method not allowed"}, status=405)

    try:
        data = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"message": "Invalid JSON"}, status=400)

    rows = data.get("rows") or []
    if not isinstance(rows, list) or not rows:
        return JsonResponse({"message": "rows (list) required"}, status=400)
    wipe = bool(data.get("wipe"))

    db = ediary()
    classes = db.table("classes").select("id, class_name").execute().data or []
    subjects = db.table("subjects").select("id, name").execute().data or []
    teachers = db.table("teachers").select("id, name, surname").execute().data or []

    class_map = {c["class_name"].lower(): c["id"] for c in classes}
    subject_map = {s["name"].lower(): s["id"] for s in subjects}
    teacher_by_name = {}
    teacher_by_initials = {}
    for t in teachers:
        full = f"{t.get('name', '')} {t.get('surname', '')}".strip().lower()
        rev = f"{t.get('surname', '')} {t.get('name', '')}".strip().lower()
        teacher_by_name[full] = t["id"]
        teacher_by_name[rev] = t["id"]
        first_i = (t.get("name", "")[:1] or "").upper()
        last_i = (t.get("surname", "")[:1] or "").upper()
        if first_i and last_i:
            teacher_by_initials[first_i + last_i] = t["id"]
            teacher_by_initials[last_i + first_i] = t["id"]

    valid_rows = []
    results = []
    affected_classes = set()

    for i, r in enumerate(rows):
        cls_name = (r.get("class_name") or "").strip().lower()
        subj_name = (r.get("subject_name") or "").strip().lower()
        teacher_name = (r.get("teacher_name") or "").strip().lower()
        teacher_initials = (r.get("teacher_initials") or "").strip().upper()
        try:
            day = int(r.get("day_of_week"))
            period = int(r.get("period"))
        except (TypeError, ValueError):
            results.append({"index": i, "ok": False, "error": "day_of_week and period must be integers"})
            continue
        if not (1 <= day <= 5) or not (1 <= period <= 8):
            results.append({"index": i, "ok": False, "error": "day_of_week 1-5, period 1-8"})
            continue

        cid = class_map.get(cls_name)
        sid = subject_map.get(subj_name)
        tid = teacher_by_name.get(teacher_name) or teacher_by_initials.get(teacher_initials)

        if not cid or not sid or not tid:
            results.append({
                "index": i, "ok": False,
                "error": f"unresolved: class={bool(cid)} subject={bool(sid)} teacher={bool(tid)}",
            })
            continue

        valid_rows.append({
            "class_id": cid,
            "subject_id": sid,
            "teacher_id": tid,
            "day_of_week": day,
            "period": period,
            "room": (r.get("room") or "").strip() or None,
        })
        affected_classes.add(cid)
        results.append({"index": i, "ok": True})

    try:
        if wipe:
            for cid in affected_classes:
                db.table("schedule").delete().eq("class_id", cid).execute()
        inserted = 0
        if valid_rows:
            # Insert in chunks to stay under HTTP body limits
            chunk = 200
            for start in range(0, len(valid_rows), chunk):
                batch = valid_rows[start:start + chunk]
                db.table("schedule").insert(batch).execute()
                inserted += len(batch)
    except Exception:
        logger.exception("Failed to import schedule")
        return JsonResponse({"message": "Failed to import schedule"}, status=500)

    return JsonResponse({
        "inserted": inserted,
        "skipped": sum(1 for r in results if not r.get("ok")),
        "results": results,
    })


@csrf_exempt
def generate_timetable(request):
    payload, err = _auth(request)
    if err:
        return err
    if request.method != "POST":
        return JsonResponse({"message": "Method not allowed"}, status=405)

    try:
        data = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"message": "Invalid JSON"}, status=400)

    class_id = (data.get("class_id") or "").strip()
    if not class_id:
        return JsonResponse({"message": "class_id required"}, status=400)

    constraints = data.get("constraints") or {}
    try:
        break_after = int(constraints.get("break_after", 4))
        max_same = int(constraints.get("max_same_subject_per_day", 2))
    except (TypeError, ValueError):
        return JsonResponse({"message": "Invalid constraints"}, status=400)
    if break_after < 1 or max_same < 1:
        return JsonResponse({"message": "Constraints must be >= 1"}, status=400)

    db = ediary()
    subjects = _fetch_class_subjects(db, class_id)
    if not subjects:
        return JsonResponse({"message": "No subjects assigned to this class"}, status=400)

    teacher_ids = list({s["teacher_id"] for s in subjects})
    busy = _fetch_teacher_busy(db, teacher_ids, exclude_class_id=class_id)

    slots = _generate(subjects, busy, break_after, max_same)
    if slots is None:
        return JsonResponse({
            "message": f"Could not generate a valid timetable after {MAX_RESTARTS} attempts. "
                       "Try relaxing constraints or check teacher availability."
        }, status=409)

    # Wipe existing schedule for this class, then insert new
    try:
        db.table("schedule").delete().eq("class_id", class_id).execute()
        rows_to_insert = [{
            "class_id": class_id,
            "subject_id": meta["subject_id"],
            "teacher_id": meta["teacher_id"],
            "day_of_week": d,
            "period": p,
        } for (d, p), meta in slots.items()]
        if rows_to_insert:
            db.table("schedule").insert(rows_to_insert).execute()
    except Exception:
        logger.exception("Failed to persist generated timetable")
        return JsonResponse({"message": "Failed to save timetable"}, status=500)

    # Build structured response
    s_map = {s["subject_id"]: s["subject_name"] for s in subjects}
    t_map = {s["teacher_id"]: s["teacher_name"] for s in subjects}
    timetable = {str(d): {} for d in DAYS}
    for (d, p), meta in slots.items():
        timetable[str(d)][str(p)] = {
            "subject_id": meta["subject_id"],
            "subject_name": s_map.get(meta["subject_id"], ""),
            "teacher_id": meta["teacher_id"],
            "teacher_name": t_map.get(meta["teacher_id"], ""),
        }

    total_slots = len(DAYS) * len(PERIODS)
    filled = len(slots)
    return JsonResponse({
        "success": True,
        "timetable": timetable,
        "stats": {
            "total_slots": total_slots,
            "filled_slots": filled,
            "free_slots": total_slots - filled,
            "subjects_count": len({s["subject_id"] for s in subjects}),
        },
    })


@csrf_exempt
def get_timetable(request):
    payload, err = _auth(request)
    if err:
        return err
    if request.method != "GET":
        return JsonResponse({"message": "Method not allowed"}, status=405)

    class_id = (request.GET.get("class_id") or "").strip()
    if not class_id:
        return JsonResponse({"message": "class_id required"}, status=400)

    db = ediary()
    rows = db.table("schedule") \
        .select("subject_id, teacher_id, day_of_week, period") \
        .eq("class_id", class_id) \
        .execute().data or []

    subj_ids = list({r["subject_id"] for r in rows}) or [""]
    teacher_ids = list({r["teacher_id"] for r in rows}) or [""]

    s_rows = db.table("subjects").select("id, name").in_("id", subj_ids).execute().data or []
    t_rows = db.table("teachers").select("id, name, surname").in_("id", teacher_ids).execute().data or []
    s_map = {s["id"]: s["name"] for s in s_rows}
    t_map = {t["id"]: f"{t.get('name', '')} {t.get('surname', '')}".strip() for t in t_rows}

    timetable = {str(d): {} for d in DAYS}
    for r in rows:
        d = r["day_of_week"]
        p = r["period"]
        timetable[str(d)][str(p)] = {
            "subject_id": r["subject_id"],
            "subject_name": s_map.get(r["subject_id"], ""),
            "teacher_id": r["teacher_id"],
            "teacher_name": t_map.get(r["teacher_id"], ""),
        }

    total_slots = len(DAYS) * len(PERIODS)
    filled = len(rows)
    return JsonResponse({
        "timetable": timetable,
        "stats": {
            "total_slots": total_slots,
            "filled_slots": filled,
            "free_slots": total_slots - filled,
            "subjects_count": len({r["subject_id"] for r in rows}),
        },
    })


@csrf_exempt
def update_slot(request):
    payload, err = _auth(request)
    if err:
        return err
    if request.method != "PUT":
        return JsonResponse({"message": "Method not allowed"}, status=405)

    try:
        data = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"message": "Invalid JSON"}, status=400)

    class_id = (data.get("class_id") or "").strip()
    try:
        day = int(data.get("day"))
        period = int(data.get("period"))
    except (TypeError, ValueError):
        return JsonResponse({"message": "day and period required"}, status=400)
    if not class_id or not (1 <= day <= 5) or not (1 <= period <= 8):
        return JsonResponse({"message": "class_id, day (1-5), period (1-8) required"}, status=400)

    subject_id = (data.get("subject_id") or "").strip()
    teacher_id = (data.get("teacher_id") or "").strip()

    db = ediary()
    # Always remove the existing slot at (class_id, day, period) before inserting
    db.table("schedule") \
        .delete() \
        .eq("class_id", class_id) \
        .eq("day_of_week", day) \
        .eq("period", period) \
        .execute()

    if not subject_id:
        return JsonResponse({"deleted": True})

    if not teacher_id:
        return JsonResponse({"message": "teacher_id required when subject_id is set"}, status=400)

    # Check teacher conflict in OTHER classes at same slot
    conflict = db.table("schedule") \
        .select("class_id") \
        .eq("teacher_id", teacher_id) \
        .eq("day_of_week", day) \
        .eq("period", period) \
        .execute().data or []
    if conflict:
        return JsonResponse({"message": "Teacher is already booked in another class for this slot"}, status=409)

    try:
        result = db.table("schedule").insert({
            "class_id": class_id,
            "subject_id": subject_id,
            "teacher_id": teacher_id,
            "day_of_week": day,
            "period": period,
        }).execute()
        return JsonResponse({"slot": result.data[0] if result.data else {}})
    except Exception:
        logger.exception("Failed to update slot")
        return JsonResponse({"message": "Failed to update slot"}, status=500)


@csrf_exempt
def get_class_data(request):
    payload, err = _auth(request)
    if err:
        return err
    if request.method != "GET":
        return JsonResponse({"message": "Method not allowed"}, status=405)

    class_id = (request.GET.get("class_id") or "").strip()
    if not class_id:
        return JsonResponse({"message": "class_id required"}, status=400)

    db = ediary()

    subjects = _fetch_class_subjects(db, class_id)

    students = db.table("students") \
        .select("id, name, surname") \
        .eq("class_id", class_id) \
        .execute().data or []
    students_out = [{
        "id": s["id"],
        "full_name": f"{s.get('name', '')} {s.get('surname', '')}".strip(),
    } for s in students]

    teacher_ids = list({s["teacher_id"] for s in subjects})
    busy = _fetch_teacher_busy(db, teacher_ids, exclude_class_id=class_id)
    teacher_conflicts = defaultdict(list)
    for (tid, d, p) in busy:
        teacher_conflicts[tid].append({"day": d, "period": p})

    return JsonResponse({
        "subjects": subjects,
        "students": students_out,
        "student_count": len(students_out),
        "teacher_conflicts": dict(teacher_conflicts),
    })


@csrf_exempt
def clear_timetable(request):
    payload, err = _auth(request)
    if err:
        return err
    if request.method != "DELETE":
        return JsonResponse({"message": "Method not allowed"}, status=405)

    class_id = (request.GET.get("class_id") or "").strip()
    if not class_id:
        return JsonResponse({"message": "class_id required"}, status=400)

    db = ediary()
    try:
        db.table("schedule").delete().eq("class_id", class_id).execute()
        return JsonResponse({"cleared": True})
    except Exception:
        logger.exception("Failed to clear timetable")
        return JsonResponse({"message": "Failed to clear timetable"}, status=500)
