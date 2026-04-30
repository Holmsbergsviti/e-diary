"""Generator v2: groups + group-aware constraint solver.

Endpoints:
  POST /admin/timetable/v2/groups/preview/   compute group_label proposal (no write)
  POST /admin/timetable/v2/groups/save/      persist group_label to student_subjects
  POST /admin/timetable/v2/generate/         build groups + run solver, return preview (no schedule write)
  POST /admin/timetable/v2/save/             commit a previewed schedule (wipes existing)

Class-bound mandatory subjects (year 10/11 Math/Phys/Chem/Bio/ICT) get
NULL group_label and are scheduled per actual class. English in year
10/11 is split by english_level (random for unknown), capped at 15 per
group. All other choice subjects are split by enrollment count, capped
at 15. Year 12/13 group labels are year-prefixed (e.g. "Math 12-2").
"""
import json
import random
import re
from collections import defaultdict

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from ..utils import _require_admin, _admin_has_perm, ediary
from ..enrollment_constants import (
    Y10_11_MANDATORY_CLASS, Y10_11_MANDATORY_LEVEL_SPLIT,
    GROUP_SIZE_MAX, periods_per_week,
)


__all__ = [
    "groups_preview", "groups_save",
    "generate_v2", "save_v2",
]


_YEAR_RE = re.compile(r"^(\d{1,2})")
DAYS = [1, 2, 3, 4, 5]
PERIODS = [1, 2, 3, 4, 5, 6, 7, 8]


def _year_from_class_name(name: str) -> int | None:
    if not name:
        return None
    m = _YEAR_RE.match(name.strip())
    return int(m.group(1)) if m else None


def _chunkify(lst: list, size: int) -> list[list]:
    if not lst:
        return []
    return [lst[i:i + size] for i in range(0, len(lst), size)]


# ----------------------------------------------------------------------
# Group assignment
# ----------------------------------------------------------------------


def _compute_group_assignments(db, *, seed: int | None = None) -> dict[tuple, str | None]:
    """Return {(student_id, subject_id): group_label_or_None}.
    None = whole-class lesson (year 10/11 mandatory class-bound)."""
    rng = random.Random(seed) if seed is not None else random
    students = db.table("students") \
        .select("id, class_id, english_level").execute().data or []
    classes = db.table("classes").select("id, class_name").execute().data or []
    subjects = db.table("subjects").select("id, name").execute().data or []
    enrolls = db.table("student_subjects") \
        .select("student_id, subject_id").execute().data or []

    class_year = {c["id"]: _year_from_class_name(c["class_name"]) for c in classes}
    student_year = {s["id"]: class_year.get(s.get("class_id")) for s in students}
    student_level = {s["id"]: s.get("english_level") for s in students}
    sname = {s["id"]: s["name"] for s in subjects}

    # (year, subject_id) -> [student_ids]
    enrollment_map: dict[tuple, list[str]] = defaultdict(list)
    for e in enrolls:
        sy = student_year.get(e["student_id"])
        if sy is None:
            continue
        enrollment_map[(sy, e["subject_id"])].append(e["student_id"])

    out: dict[tuple, str | None] = {}

    for (year, subj_id), stu_list in enrollment_map.items():
        subj_name = sname.get(subj_id, "?")

        # Year 10/11 mandatory class-bound — no group split.
        if year in (10, 11) and subj_name in Y10_11_MANDATORY_CLASS:
            for sid in stu_list:
                out[(sid, subj_id)] = None
            continue

        # Year 10/11 English — split by english_level, then chunk at GROUP_SIZE_MAX.
        if year in (10, 11) and subj_name in Y10_11_MANDATORY_LEVEL_SPLIT:
            by_level: dict[int, list[str]] = {1: [], 2: [], 3: [], 4: [], 5: []}
            unknowns: list[str] = []
            for sid in stu_list:
                lv = student_level.get(sid)
                if lv in (1, 2, 3, 4, 5):
                    by_level[lv].append(sid)
                else:
                    unknowns.append(sid)
            rng.shuffle(unknowns)
            for i, sid in enumerate(unknowns):
                lv = (i % 5) + 1
                by_level[lv].append(sid)
            for lv, slist in by_level.items():
                if not slist:
                    continue
                chunks = _chunkify(slist, GROUP_SIZE_MAX)
                if len(chunks) == 1:
                    label = f"Eng-L{lv}"
                    for sid in chunks[0]:
                        out[(sid, subj_id)] = label
                else:
                    for i, chunk in enumerate(chunks, 1):
                        label = f"Eng-L{lv}-{i}"
                        for sid in chunk:
                            out[(sid, subj_id)] = label
            continue

        # Generic split by count, cap GROUP_SIZE_MAX.
        sorted_list = sorted(stu_list)
        chunks = _chunkify(sorted_list, GROUP_SIZE_MAX)
        for i, chunk in enumerate(chunks, 1):
            if year in (10, 11):
                label = f"{subj_name}-{i}"
            else:
                label = f"{subj_name} {year}-{i}"
            for sid in chunk:
                out[(sid, subj_id)] = label

    return out


def _summarise_groups(assignments: dict[tuple, str | None],
                      db) -> list[dict]:
    """Return per-group rows: subject, year, label, size."""
    subjects = db.table("subjects").select("id, name").execute().data or []
    classes = db.table("classes").select("id, class_name").execute().data or []
    students = db.table("students").select("id, class_id").execute().data or []
    sname = {s["id"]: s["name"] for s in subjects}
    class_year = {c["id"]: _year_from_class_name(c["class_name"]) for c in classes}
    student_year = {s["id"]: class_year.get(s.get("class_id")) for s in students}

    counts: dict[tuple, int] = defaultdict(int)
    for (sid, subj_id), label in assignments.items():
        yr = student_year.get(sid)
        counts[(yr, subj_id, label)] += 1

    rows = []
    for (yr, subj_id, label), n in sorted(counts.items(),
            key=lambda x: (x[0][0] or 0, sname.get(x[0][1], ""), x[0][2] or "")):
        rows.append({
            "year": yr,
            "subject_name": sname.get(subj_id, "?"),
            "group_label": label or "(class-wide)",
            "size": n,
        })
    return rows


@csrf_exempt
def groups_preview(request):
    payload = _require_admin(request)
    if not payload:
        return JsonResponse({"message": "Unauthorized"}, status=401)
    if not _admin_has_perm(payload, "schedule"):
        return JsonResponse({"message": "No permission"}, status=403)
    if request.method != "POST":
        return JsonResponse({"message": "Method not allowed"}, status=405)

    data = json.loads(request.body or "{}")
    seed = data.get("seed")
    db = ediary()
    assignments = _compute_group_assignments(db, seed=seed)
    rows = _summarise_groups(assignments, db)
    # Pack assignments compactly for the client to round-trip.
    compact = [{"student_id": k[0], "subject_id": k[1], "group_label": v}
               for k, v in assignments.items()]
    return JsonResponse({"groups": rows, "assignments": compact,
                         "total": len(compact)})


@csrf_exempt
def groups_save(request):
    payload = _require_admin(request)
    if not payload:
        return JsonResponse({"message": "Unauthorized"}, status=401)
    if not _admin_has_perm(payload, "schedule"):
        return JsonResponse({"message": "No permission"}, status=403)
    if request.method != "POST":
        return JsonResponse({"message": "Method not allowed"}, status=405)

    data = json.loads(request.body)
    assignments = data.get("assignments")
    if not assignments:
        # Recompute from scratch.
        db = ediary()
        amap = _compute_group_assignments(db)
        assignments = [{"student_id": k[0], "subject_id": k[1], "group_label": v}
                       for k, v in amap.items()]

    db = ediary()
    # Apply via per-row updates (no upsert needed; PK is (student, subject)).
    chunk = 500
    updated = 0
    for i in range(0, len(assignments), chunk):
        batch = assignments[i:i + chunk]
        for a in batch:
            db.table("student_subjects").update({"group_label": a.get("group_label")}) \
                .eq("student_id", a["student_id"]) \
                .eq("subject_id", a["subject_id"]).execute()
            updated += 1
    return JsonResponse({"saved": True, "updated": updated})


# ----------------------------------------------------------------------
# Lesson list + solver
# ----------------------------------------------------------------------


def _build_lessons(db, group_assignments: dict[tuple, str | None]) -> list[dict]:
    """Convert group_assignments into a list of lessons-to-place."""
    students = db.table("students").select("id, class_id").execute().data or []
    classes = db.table("classes").select("id, class_name").execute().data or []
    subjects = db.table("subjects").select("id, name").execute().data or []
    teacher_subjects = db.table("teacher_subjects") \
        .select("teacher_id, subject_id, years_allowed").execute().data or []

    class_year = {c["id"]: _year_from_class_name(c["class_name"]) for c in classes}
    student_class = {s["id"]: s.get("class_id") for s in students}
    sname = {s["id"]: s["name"] for s in subjects}
    sid_by_name = {s["name"]: s["id"] for s in subjects}

    # (subject_id, year) -> set of teacher_ids
    cands: dict[tuple, set[str]] = defaultdict(set)
    for ts in teacher_subjects:
        for yr_str in (ts.get("years_allowed") or []):
            try:
                yr = int(yr_str)
            except ValueError:
                continue
            cands[(ts["subject_id"], yr)].add(ts["teacher_id"])

    # Class-wide year 10/11 mandatory: per (class, subject)
    lessons: list[dict] = []

    # Build student set per class.
    students_in_class: dict[str, set[str]] = defaultdict(set)
    for s in students:
        if s.get("class_id"):
            students_in_class[s["class_id"]].add(s["id"])

    for year in (10, 11):
        for cls in classes:
            if class_year.get(cls["id"]) != year:
                continue
            cls_students = students_in_class.get(cls["id"], set())
            if not cls_students:
                continue
            for subj_name in Y10_11_MANDATORY_CLASS:
                sid = sid_by_name.get(subj_name)
                if not sid:
                    continue
                lessons.append({
                    "lid": f"cls-{cls['class_name']}-{subj_name}",
                    "subject_id": sid,
                    "subject_name": subj_name,
                    "group_label": None,
                    "class_id": cls["id"],
                    "class_name": cls["class_name"],
                    "year": year,
                    "students": set(cls_students),
                    "periods_per_week": periods_per_week(subj_name, year),
                    "is_double": False,
                    "candidates": cands.get((sid, year), set()),
                })

    # Group lessons (everything else)
    by_group: dict[tuple, set[str]] = defaultdict(set)
    student_year = {s["id"]: class_year.get(s.get("class_id")) for s in students}
    for (stu_id, subj_id), label in group_assignments.items():
        if label is None:
            continue
        yr = student_year.get(stu_id)
        if yr is None:
            continue
        by_group[(yr, subj_id, label)].add(stu_id)

    for (yr, subj_id, label), stuset in by_group.items():
        subj_name = sname.get(subj_id, "?")
        is_double = (yr in (10, 11) and
                     subj_name in {"PE", "Art", "Psychology", "ML"})
        lessons.append({
            "lid": f"grp-{yr}-{subj_name}-{label}",
            "subject_id": subj_id,
            "subject_name": subj_name,
            "group_label": label,
            "class_id": None,
            "class_name": None,
            "year": yr,
            "students": set(stuset),
            "periods_per_week": periods_per_week(subj_name, yr),
            "is_double": is_double,
            "candidates": cands.get((subj_id, yr), set()),
        })

    return lessons


def _place(lessons: list[dict], rng: random.Random,
           max_attempts: int = 30) -> tuple[list[dict] | None, list[dict]]:
    """Run a randomized placer. Return (placements, unplaced_lessons).
    placements: [{lid, subject_id, subject_name, teacher_id, day, period,
                  class_id, year, group_label, students[]}]
    unplaced_lessons: lessons that ran out of slots even after retries.
    """
    best_placements: list[dict] | None = None
    best_unplaced: list[dict] = lessons[:]

    for attempt in range(max_attempts):
        # Sort: largest student set first, then doubles before singles.
        order = lessons[:]
        rng.shuffle(order)
        order.sort(key=lambda l: (-len(l["students"]),
                                   0 if l["is_double"] else 1,
                                   -l["periods_per_week"]))

        teacher_busy: set[tuple] = set()      # (teacher_id, day, period)
        student_busy: set[tuple] = set()      # (student_id, day, period)
        teacher_load: dict[str, int] = {}
        # (lesson_id, day) -> count, to spread same lesson across days.
        per_lesson_per_day: dict[tuple, int] = {}
        placements: list[dict] = []
        unplaced: list[dict] = []

        for lesson in order:
            cands = list(lesson["candidates"])
            if not cands:
                unplaced.append({**_lesson_meta(lesson),
                                 "reason": "no qualified teacher"})
                continue
            rng.shuffle(cands)
            # Prefer least-loaded teacher.
            cands.sort(key=lambda t: teacher_load.get(t, 0))

            target = lesson["periods_per_week"]
            placed_for_this = 0
            chosen_tid: str | None = None
            local_placements: list[dict] = []

            for tid in cands:
                local_placements = []
                placed_for_this = 0
                tb_local = set()
                sb_local = set()
                pl_lp_local: dict[tuple, int] = {}

                if lesson["is_double"]:
                    # Need target/2 sessions of 2 consecutive periods on
                    # different days.
                    sessions_needed = target // 2
                    pairs = [(d, p) for d in DAYS for p in range(1, 8)]
                    rng.shuffle(pairs)
                    used_days = set()
                    sessions_placed = 0
                    for (d, p) in pairs:
                        if sessions_placed >= sessions_needed:
                            break
                        if d in used_days:
                            continue
                        ok1 = _can_place(teacher_busy | tb_local,
                                         student_busy | sb_local,
                                         tid, lesson["students"], d, p)
                        ok2 = _can_place(teacher_busy | tb_local,
                                         student_busy | sb_local,
                                         tid, lesson["students"], d, p + 1)
                        if ok1 and ok2:
                            for pp in (p, p + 1):
                                tb_local.add((tid, d, pp))
                                for st in lesson["students"]:
                                    sb_local.add((st, d, pp))
                                local_placements.append({
                                    **_lesson_meta(lesson),
                                    "teacher_id": tid,
                                    "day": d, "period": pp,
                                })
                            placed_for_this += 2
                            sessions_placed += 1
                            used_days.add(d)
                    if placed_for_this >= target:
                        chosen_tid = tid
                        break
                else:
                    slots = [(d, p) for d in DAYS for p in PERIODS]
                    rng.shuffle(slots)
                    spread = max(1, (target + len(DAYS) - 1) // len(DAYS))
                    for (d, p) in slots:
                        if placed_for_this >= target:
                            break
                        if pl_lp_local.get((lesson["lid"], d), 0) >= spread + 1:
                            continue
                        if _can_place(teacher_busy | tb_local,
                                      student_busy | sb_local,
                                      tid, lesson["students"], d, p):
                            tb_local.add((tid, d, p))
                            for st in lesson["students"]:
                                sb_local.add((st, d, p))
                            local_placements.append({
                                **_lesson_meta(lesson),
                                "teacher_id": tid,
                                "day": d, "period": p,
                            })
                            pl_lp_local[(lesson["lid"], d)] = \
                                pl_lp_local.get((lesson["lid"], d), 0) + 1
                            placed_for_this += 1
                    if placed_for_this >= target:
                        chosen_tid = tid
                        break

            if chosen_tid is None or placed_for_this < target:
                unplaced.append({**_lesson_meta(lesson),
                                 "reason": "no slot pattern fits"})
                continue

            for pl in local_placements:
                teacher_busy.add((pl["teacher_id"], pl["day"], pl["period"]))
                for st in lesson["students"]:
                    student_busy.add((st, pl["day"], pl["period"]))
                placements.append(pl)
            teacher_load[chosen_tid] = teacher_load.get(chosen_tid, 0) + placed_for_this

        if len(unplaced) < len(best_unplaced):
            best_placements = placements[:]
            best_unplaced = unplaced[:]
            if not unplaced:
                return placements, []

    return best_placements, best_unplaced


def _lesson_meta(lesson: dict) -> dict:
    return {
        "lid": lesson["lid"],
        "subject_id": lesson["subject_id"],
        "subject_name": lesson["subject_name"],
        "group_label": lesson["group_label"],
        "class_id": lesson["class_id"],
        "class_name": lesson.get("class_name"),
        "year": lesson["year"],
    }


def _can_place(teacher_busy: set, student_busy: set,
               tid: str, students: set[str], d: int, p: int) -> bool:
    if (tid, d, p) in teacher_busy:
        return False
    for st in students:
        if (st, d, p) in student_busy:
            return False
    return True


@csrf_exempt
def generate_v2(request):
    payload = _require_admin(request)
    if not payload:
        return JsonResponse({"message": "Unauthorized"}, status=401)
    if not _admin_has_perm(payload, "schedule"):
        return JsonResponse({"message": "No permission"}, status=403)
    if request.method != "POST":
        return JsonResponse({"message": "Method not allowed"}, status=405)

    data = json.loads(request.body or "{}")
    seed = data.get("seed")
    db = ediary()
    assignments = _compute_group_assignments(db, seed=seed)
    lessons = _build_lessons(db, assignments)
    rng = random.Random(seed) if seed is not None else random.Random()
    placements, unplaced = _place(lessons, rng)

    teachers = db.table("teachers").select("id, name, surname").execute().data or []
    tname = {t["id"]: f'{t["surname"]} {t["name"]}' for t in teachers}

    out_placements = []
    for pl in (placements or []):
        out_placements.append({
            **pl,
            "teacher_name": tname.get(pl["teacher_id"], "?"),
        })

    return JsonResponse({
        "placements": out_placements,
        "unplaced": unplaced or [],
        "groups_preview": _summarise_groups(assignments, db),
        "lesson_count": len(lessons),
    })


@csrf_exempt
def save_v2(request):
    payload = _require_admin(request)
    if not payload:
        return JsonResponse({"message": "Unauthorized"}, status=401)
    if not _admin_has_perm(payload, "schedule"):
        return JsonResponse({"message": "No permission"}, status=403)
    if request.method != "POST":
        return JsonResponse({"message": "Method not allowed"}, status=405)

    data = json.loads(request.body)
    placements = data.get("placements") or []
    save_groups = bool(data.get("save_groups", True))
    if not placements:
        return JsonResponse({"message": "placements required"}, status=400)

    db = ediary()

    if save_groups:
        # Persist current group assignments back to student_subjects so the
        # saved schedule lines up with student_subjects.group_label.
        amap = _compute_group_assignments(db)
        for (sid, subj_id), label in amap.items():
            db.table("student_subjects").update({"group_label": label}) \
                .eq("student_id", sid).eq("subject_id", subj_id).execute()

    # Wipe existing schedule.
    db.table("schedule").delete() \
        .neq("id", "00000000-0000-0000-0000-000000000000").execute()

    rows = []
    for pl in placements:
        row = {
            "teacher_id": pl["teacher_id"],
            "subject_id": pl["subject_id"],
            "day_of_week": pl["day"],
            "period": pl["period"],
            "group_label": pl.get("group_label"),
            "year_group": pl.get("year"),
        }
        if pl.get("class_id"):
            row["class_id"] = pl["class_id"]
        rows.append(row)

    chunk = 500
    inserted = 0
    for i in range(0, len(rows), chunk):
        res = db.table("schedule").insert(rows[i:i + chunk]).execute()
        inserted += len(res.data or [])

    return JsonResponse({"saved": True, "inserted": inserted})
