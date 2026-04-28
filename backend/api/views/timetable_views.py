# Chartwell E-Diary - timetable generation API
import json
import random
from collections import defaultdict

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from ..utils import logger, _require_admin, _admin_has_perm, ediary

__all__ = [
    "generate_timetable",
    "generate_multi",
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

    # Validate inputs and build class_specs
    class_specs = []
    selected_class_ids = []
    name_lookup = {}
    for c in classes_in:
        cid = (c.get("class_id") or "").strip()
        if not cid:
            return JsonResponse({"message": "Each class needs class_id"}, status=400)
        selected_class_ids.append(cid)
        building = (c.get("building") or "").strip()

        # Pull subjects from teacher_assignments for this class
        assigned = db.table("teacher_assignments") \
            .select("teacher_id, subject_id") \
            .eq("class_id", cid) \
            .execute().data or []
        if not assigned:
            return JsonResponse({"message": f"Class {cid} has no teacher assignments"}, status=400)

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

    solution = _generate_joint(class_specs, busy_external, break_after, max_same)
    if solution is None:
        return JsonResponse({
            "message": f"Could not generate after {MAX_RESTARTS} attempts. "
                       "Try relaxing constraints, reducing classes, or check teacher availability.",
        }, status=409)

    # Persist: wipe selected classes' rows, insert new
    try:
        for cid in selected_class_ids:
            db.table("schedule").delete().eq("class_id", cid).execute()
        bulk_rows = []
        for cid, slots in solution.items():
            for (d, p), meta in slots.items():
                bulk_rows.append({
                    "class_id": cid,
                    "subject_id": meta["subject_id"],
                    "teacher_id": meta["teacher_id"],
                    "day_of_week": d,
                    "period": p,
                })
        if bulk_rows:
            db.table("schedule").insert(bulk_rows).execute()
    except Exception:
        logger.exception("Failed to persist multi-class timetable")
        return JsonResponse({"message": "Failed to save timetables"}, status=500)

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
    return JsonResponse({
        "success": True,
        "timetables": timetables,
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
