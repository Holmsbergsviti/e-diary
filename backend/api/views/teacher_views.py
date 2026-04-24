import json
from datetime import datetime, timedelta

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from ..utils import (
    logger,
    _verify_token,
    _term_from_iso_date,
    ediary,
    supabase_admin_auth,
)

# Grade-code → numeric value (mirrors frontend GRADE_VALUES)
GRADE_VALUES = {
    "A*": 9, "A": 8, "A-": 7,
    "B+": 6.5, "B": 6, "B-": 5.5,
    "C+": 5.5, "C": 5, "C-": 4.5,
    "D+": 4.5, "D": 4, "D-": 3.5,
    "E+": 3.5, "E": 3, "E-": 2.5,
    "U": 1,
}

__all__ = [
    "teacher_class_students", "teacher_attendance", "teacher_marks",
    "teacher_add_grade", "teacher_edit_grade", "teacher_delete_grade",
    "teacher_add_homework", "teacher_delete_homework",
    "teacher_homework_completions",
    "teacher_add_behavioral", "teacher_delete_behavioral",
    "teacher_class_stats", "teacher_student_comments", "teacher_reports",
    "teacher_study_hall", "teacher_study_hall_students",
    "teacher_study_hall_attendance",
    "teacher_substitutes", "teacher_substitute_classes",
    "teacher_substitute_detail",
    "teacher_events", "teacher_event_detail",
]


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
            result = (
                db.table("attendance")
                .select("id, student_id, status, comment")
                .eq("class_id", class_id)
                .eq("subject_id", subject_id)
                .eq("date_recorded", date)
                .eq("recorded_by_teacher_id", teacher_id)
                .execute()
            )
        att_rows = result.data or []
        topic = att_rows[0].get("topic", "") if att_rows else ""

        # Check which students are on events this date
        event_student_ids = []
        try:
            all_ev = (db.table("events").select("*").lte("event_date", date).gte("event_end_date", date).execute()).data or []
            single_ev = (db.table("events").select("*").eq("event_date", date).is_("event_end_date", "null").execute()).data or []
            all_ev = {e["id"]: e for e in all_ev + single_ev}.values()

            for ev in all_ev:
                tt = ev.get("target_type", "all")
                if tt == "students":
                    ids = ev.get("target_student_ids") or []
                    event_student_ids.extend(ids)
            event_student_ids = list(set(event_student_ids))
        except Exception:
            pass

        return JsonResponse({"attendance": att_rows, "topic": topic, "event_student_ids": event_student_ids})

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

        db = ediary()
        db.table("attendance").delete()\
            .eq("class_id", class_id)\
            .eq("subject_id", subject_id)\
            .eq("date_recorded", date)\
            .eq("recorded_by_teacher_id", teacher_id)\
            .execute()

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
            for r in rows:
                r.pop("topic", None)
            result = db2.table("attendance").insert(rows).execute()

        return JsonResponse({"saved": len(result.data or [])}, status=201)

    return JsonResponse({"message": "Method not allowed"}, status=405)


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
    except Exception:
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
    except Exception:
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
    except Exception:
        logger.exception("teacher_delete_grade failed")
        return JsonResponse({"message": "Failed to delete grade"}, status=500)

    return JsonResponse({"deleted": True})


# ------------------------------------------------------------------
# Teacher: view marks for students they teach
# ------------------------------------------------------------------

@csrf_exempt
def teacher_marks(request):
    payload = _verify_token(request)
    if not payload or payload.get("role") != "teacher":
        return JsonResponse({"message": "Unauthorized"}, status=401)

    teacher_id = payload["sub"]

    db = ediary()
    teacher = db.table("teachers").select("*").eq("id", teacher_id).limit(1).execute()
    if not teacher.data:
        return JsonResponse({"message": "Teacher not found"}, status=404)
    t = teacher.data[0]

    db2 = ediary()
    assignments = db2.table("teacher_assignments").select("subject_id, class_id").eq("teacher_id", teacher_id).execute()

    db3 = ediary()
    all_classes = db3.table("classes").select("id, class_name, grade_level").execute()
    cls_map = {c["id"]: c for c in (all_classes.data or [])}

    teaching_pairs = []
    for a in (assignments.data or []):
        cls = cls_map.get(a["class_id"])
        if cls:
            teaching_pairs.append((a["subject_id"], a["class_id"]))

    grade_class_map = {}
    for c in (all_classes.data or []):
        grade_class_map.setdefault(c["grade_level"], []).append(c["id"])

    taught_class_ids = {cid for (_, cid) in teaching_pairs}
    year_levels_taught = {cls_map[cid]["grade_level"] for cid in taught_class_ids if cid in cls_map}

    class_teacher_class_id = t.get("class_teacher_of_class_id")
    class_teacher_grade = None
    if t.get("is_class_teacher") and class_teacher_class_id:
        cls_t = cls_map.get(class_teacher_class_id)
        if cls_t:
            class_teacher_grade = cls_t["grade_level"]

    relevant_class_ids = set()
    for gl in year_levels_taught:
        relevant_class_ids.update(grade_class_map.get(gl, []))

    if class_teacher_class_id:
        relevant_class_ids.add(class_teacher_class_id)

    relevant_class_ids = list(relevant_class_ids)
    if not relevant_class_ids:
        return JsonResponse({"groups": []})

    db4 = ediary()
    students = (
        db4.table("students")
        .select("id, name, surname, class_id, profile_picture_url")
        .in_("class_id", relevant_class_ids)
        .order("surname")
        .order("name")
        .execute()
    )
    student_map = {s["id"]: s for s in (students.data or [])}
    student_ids = list(student_map.keys())

    if not student_ids:
        return JsonResponse({"groups": []})

    db_ss = ediary()
    all_student_subjects = db_ss.table("student_subjects").select("student_id, subject_id, group_class_id").in_("student_id", student_ids).execute()
    ss_group_map = {}
    student_class_ids_map = {}  # student_id -> set of class_ids (homeroom + any teaching group)
    for ss in (all_student_subjects.data or []):
        ss_group_map[(ss["student_id"], ss["subject_id"])] = ss.get("group_class_id")
        gcid = ss.get("group_class_id")
        if gcid:
            student_class_ids_map.setdefault(ss["student_id"], set()).add(gcid)
    for sid_, s_ in student_map.items():
        if s_.get("class_id"):
            student_class_ids_map.setdefault(sid_, set()).add(s_["class_id"])

    db5 = ediary()
    subjects_result = db5.table("subjects").select("id, name, color_code").execute()
    subj_map = {s["id"]: s for s in (subjects_result.data or [])}

    db6 = ediary()
    grades_result = (
        db6.table("grades")
        .select("id, student_id, subject_id, assessment_name, grade_code, percentage, date_taken, comment, category, term")
        .in_("student_id", student_ids)
        .order("date_taken", desc=False)
        .execute()
    )

    # Fetch stats data for ALL students
    att_data = []
    hw_comp_data = []
    hw_all = []
    beh_data = []
    if student_ids:
        att_data = (
            ediary().table("attendance")
            .select("student_id, subject_id, class_id, date_recorded, status, comment")
            .in_("student_id", student_ids)
            .execute()
        ).data or []

        hw_class_ids = set(relevant_class_ids)
        if class_teacher_class_id:
            for sid_ in student_ids:
                if student_map.get(sid_, {}).get("class_id") == class_teacher_class_id:
                    hw_class_ids.update(student_class_ids_map.get(sid_, set()))
        hw_all = (
            ediary().table("homework")
            .select("id, class_id, subject_id, title, due_date")
            .in_("class_id", list(hw_class_ids))
            .execute()
        ).data or []
        hw_all_ids = [h["id"] for h in hw_all]

        if hw_all_ids:
            hw_comp_data = (
                ediary().table("homework_completions")
                .select("homework_id, student_id, status")
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

        # Absent-today and attendance-conflict detection (always unfiltered)
        today_statuses = {}
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

        # Comment counts from ALL 3 sources
        grade_comments_filtered = 0
        grade_comments_all = 0
        for g in (grades_result.data or []):
            if g["student_id"] == sid and (g.get("comment") or "").strip():
                grade_comments_all += 1
                if not subject_id or g.get("subject_id") == subject_id:
                    grade_comments_filtered += 1

        beh_comments_filtered = 0
        beh_comments_all = 0
        for b in beh_data:
            if b["student_id"] == sid and (b.get("content") or "").strip():
                beh_comments_all += 1
                if not subject_id or b.get("subject_id") == subject_id:
                    beh_comments_filtered += 1

        total_comments = att_comment_count + grade_comments_filtered + beh_comments_filtered
        total_comments_all = all_att_comments + grade_comments_all + beh_comments_all

        student_grades = [
            g for g in (grades_result.data or [])
            if g["student_id"] == sid
            and (not subject_id or g.get("subject_id") == subject_id)
        ]
        pcts = [g["percentage"] for g in student_grades if g.get("percentage") is not None]
        grade_avg = round(sum(pcts) / len(pcts), 1) if pcts else None
        grade_count = len(student_grades)

        hwc_c = {"completed": 0, "partial": 0, "not_done": 0}
        hw_detail = []
        student_hw_status = {}
        for h in hw_comp_data:
            if h["student_id"] == sid:
                student_hw_status[h.get("homework_id")] = h.get("status", "")

        student_class_id = student_map.get(sid, {}).get("class_id")
        student_all_classes = student_class_ids_map.get(sid, set())
        for hw in hw_all:
            hw_class = hw.get("class_id")
            hw_subj = hw.get("subject_id")
            if class_id and hw_class != class_id:
                continue
            if not class_id and student_all_classes and hw_class not in student_all_classes:
                continue
            if subject_id and hw_subj != subject_id:
                continue
            hw_id = hw["id"]
            status = student_hw_status.get(hw_id, "not_done")
            if status in hwc_c:
                hwc_c[status] += 1
            else:
                hwc_c["not_done"] += 1
            hw_detail.append({
                "title": hw.get("title", ""),
                "due_date": hw.get("due_date"),
                "subject": subj_map.get(hw_subj, {}).get("name", ""),
                "status": status,
            })
        hw_detail.sort(key=lambda x: x.get("due_date") or "", reverse=True)

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
            "grades": {"count": grade_count, "average": grade_avg},
            "homework": hwc_c,
            "homework_detail": hw_detail,
            "behavioral": beh_c,
        }

    # Build response
    groups = []

    # === CLASS TEACHER OVERVIEW (first tab) ===
    if class_teacher_class_id and t.get("is_class_teacher"):
        homeroom_students = [s for s in (students.data or []) if s["class_id"] == class_teacher_class_id]

        if homeroom_students:
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
                    "profile_picture_url": s.get("profile_picture_url") or None,
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

        group_students = []
        for s in (students.data or []):
            gc = ss_group_map.get((s["id"], subj_id))
            if gc == class_id:
                group_students.append(s)
            elif s["class_id"] == class_id and not gc:
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
                "profile_picture_url": s.get("profile_picture_url") or None,
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

        hw_check = db.table("homework").select("id").eq("id", homework_id).eq("teacher_id", payload["sub"]).execute()
        if not hw_check.data:
            return JsonResponse({"message": "Homework not found or not yours"}, status=403)

        db.table("homework_completions") \
            .delete() \
            .eq("homework_id", homework_id) \
            .execute()

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
# Teacher: class statistics
# ------------------------------------------------------------------

@csrf_exempt
def teacher_class_stats(request):
    payload = _verify_token(request)
    if not payload or payload.get("role") != "teacher":
        return JsonResponse({"message": "Unauthorized"}, status=401)

    teacher_id = payload["sub"]
    db = ediary()

    assignments = (
        db.table("teacher_assignments")
        .select("subject_id, class_id")
        .eq("teacher_id", teacher_id)
        .execute()
    )
    pairs = [(a["subject_id"], a["class_id"]) for a in (assignments.data or [])]
    if not pairs:
        return JsonResponse({"stats": []})

    subj_result = ediary().table("subjects").select("id, name").execute()
    subj_map = {s["id"]: s["name"] for s in (subj_result.data or [])}

    cls_result = ediary().table("classes").select("id, class_name, grade_level").execute()
    cls_map = {c["id"]: c for c in (cls_result.data or [])}

    subjects_in_pairs = sorted(list({sid for sid, _ in pairs}))

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

    class_ids_in_pairs = sorted(list({cid for _, cid in pairs}))

    att_result = (
        ediary().table("attendance")
        .select("class_id, subject_id, student_id, status")
        .in_("subject_id", subjects_in_pairs)
        .in_("class_id", class_ids_in_pairs)
        .execute()
    ) if subjects_in_pairs and class_ids_in_pairs else type('', (), {'data': []})()

    grades_result = (
        ediary().table("grades")
        .select("subject_id, student_id, percentage, grade_code")
        .in_("student_id", all_student_ids)
        .execute()
    ) if all_student_ids else type('', (), {'data': []})()

    hw_result = (
        ediary().table("homework")
        .select("id, subject_id, class_id")
        .eq("teacher_id", teacher_id)
        .execute()
    )
    hw_ids = [h["id"] for h in (hw_result.data or [])]

    hwc_result = (
        ediary().table("homework_completions")
        .select("homework_id, student_id, status")
        .in_("homework_id", hw_ids)
        .execute()
    ) if hw_ids else type('', (), {'data': []})()

    hw_pair_map = {h["id"]: (h["subject_id"], h["class_id"]) for h in (hw_result.data or [])}

    beh_result = (
        ediary().table("behavioral_entries")
        .select("subject_id, class_id, student_id, entry_type")
        .eq("teacher_id", teacher_id)
        .execute()
    )

    stats = []
    for subject_id, class_id in pairs:
        cl = cls_map.get(class_id)
        if not cl:
            continue

        class_enrolled = pair_enrolled_map.get((subject_id, class_id), set())
        student_count = len(class_enrolled)

        att_counts = {"Present": 0, "Late": 0, "Absent": 0, "Excused": 0}
        for a in (att_result.data or []):
            if a["subject_id"] == subject_id and a.get("class_id") == class_id and a.get("student_id") in class_enrolled:
                s = a.get("status", "Present")
                if s in att_counts:
                    att_counts[s] += 1
        att_total = sum(att_counts.values())

        grade_values = []
        grade_count = 0
        grade_dist = {"A*": 0, "A": 0, "B": 0, "C": 0, "D": 0, "E": 0, "U": 0}
        for g in (grades_result.data or []):
            if g["subject_id"] == subject_id and g.get("student_id") in class_enrolled:
                grade_count += 1
                pct = g.get("percentage")
                if pct is not None:
                    grade_values.append(float(pct))
                else:
                    gc = g.get("grade_code", "")
                    nv = GRADE_VALUES.get(gc)
                    if nv is not None:
                        grade_values.append(nv)
                gc_raw = (g.get("grade_code") or "").strip().upper()
                if gc_raw == "A*":
                    grade_dist["A*"] += 1
                else:
                    letter = gc_raw.rstrip("+-") if gc_raw else ""
                    if letter in grade_dist:
                        grade_dist[letter] += 1
        grade_avg = round(sum(grade_values) / len(grade_values), 2) if grade_values else None

        hw_for_pair = [h_id for h_id, (sid, cid) in hw_pair_map.items() if sid == subject_id and cid == class_id]
        hw_count = len(hw_for_pair)
        hwc_counts = {"completed": 0, "partial": 0, "not_done": 0}
        # Track which (homework, student) pairs have a completion record
        hwc_seen = set()
        for c in (hwc_result.data or []):
            if c["homework_id"] in hw_for_pair and c.get("student_id") in class_enrolled:
                st = c.get("status", "")
                if st in hwc_counts:
                    hwc_counts[st] += 1
                hwc_seen.add((c["homework_id"], c["student_id"]))
        # Students with no completion record at all count as missing
        for h_id in hw_for_pair:
            for sid in class_enrolled:
                if (h_id, sid) not in hwc_seen:
                    hwc_counts["not_done"] += 1

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
                "distribution": grade_dist,
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

    stats.sort(key=lambda s: (s["subject"], s["class_name"]))
    return JsonResponse({"stats": stats})


# ------------------------------------------------------------------
# Teacher: per-student comments timeline
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
            pass
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

    # Behavioral notes
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

        students = (
            db.table("students")
            .select("id, name, surname, class_id")
            .in_("class_id", taught_class_ids)
            .order("surname")
            .order("name")
            .execute()
        )
        student_rows = students.data or []
        student_map = {s["id"]: s for s in student_rows}

        ss_all = (
            db.table("student_subjects")
            .select("student_id, subject_id, group_class_id")
            .in_("subject_id", subjects_in_pairs)
            .execute()
        ) if subjects_in_pairs else type('', (), {'data': []})()
        ss_rows = ss_all.data or []

        ss_group_map = {}
        extra_student_ids = set()
        for row in ss_rows:
            sid = row.get("student_id")
            subj_id = row.get("subject_id")
            gc = row.get("group_class_id")
            ss_group_map[(sid, subj_id)] = gc
            if gc and gc in set(taught_class_ids) and sid not in student_map:
                extra_student_ids.add(sid)

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
        except Exception:
            logger.exception("Failed to save report")
            return JsonResponse({"message": "Failed to save report"}, status=500)

        return JsonResponse({"report": result.data[0] if result.data else {}})

    return JsonResponse({"message": "Method not allowed"}, status=405)


# ------------------------------------------------------------------
# Teacher: study hall
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
    except Exception:
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

    try:
        dt = datetime.fromisoformat(date)
        day_of_week = dt.isoweekday()
    except Exception:
        return JsonResponse({"message": "Invalid date"}, status=400)

    if day_of_week > 5:
        return JsonResponse({"students": []})

    try:
        db = ediary()

        sched = (
            db.table("schedule")
            .select("class_id, subject_id")
            .eq("day_of_week", day_of_week)
            .eq("period", period)
            .execute()
        ).data or []

        busy_class_ids = {s["class_id"] for s in sched}

        all_students = (
            db.table("students")
            .select("id, name, surname, class_id")
            .not_.is_("class_id", "null")
            .order("surname")
            .order("name")
            .execute()
        ).data or []

        all_ss = (
            db.table("student_subjects")
            .select("student_id, subject_id, group_class_id")
            .execute()
        ).data or []
        ss_by_student = {}
        for ss in all_ss:
            ss_by_student.setdefault(ss["student_id"], []).append(ss)

        classes = (db.table("classes").select("id, class_name").execute()).data or []
        cls_map = {c["id"]: c["class_name"] for c in classes}

        free_students = []
        for s in all_students:
            home_class = s["class_id"]
            has_class = False

            if home_class in busy_class_ids:
                for slot in sched:
                    if slot["class_id"] == home_class:
                        has_class = True
                        break

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
    except Exception:
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

        db.table("study_hall_attendance").delete().eq("study_hall_id", session_id).execute()

        rows = []
        for r in records:
            rows.append({
                "study_hall_id": session_id,
                "student_id": r["student_id"],
                "status": r.get("status", "Absent"),
            })

        if rows:
            db.table("study_hall_attendance").insert(rows).execute()

        return JsonResponse({"saved": len(rows)}, status=201)
    except Exception:
        logger.exception("Server error")
        return JsonResponse({"message": "Internal server error"}, status=500)


# ------------------------------------------------------------------
# Substitute lessons
# ------------------------------------------------------------------

@csrf_exempt
def teacher_substitutes(request):
    """GET → list, POST → create, DELETE → remove substitute lesson."""
    payload = _verify_token(request)
    if not payload or payload.get("role") != "teacher":
        return JsonResponse({"message": "Unauthorized"}, status=401)

    teacher_id = payload["sub"]
    db = ediary()

    if request.method == "GET":
        mine = (
            db.table("substitutes")
            .select("*")
            .eq("substitute_teacher_id", teacher_id)
            .order("date", desc=True)
            .execute()
        )

        subj_map = {s["id"]: s["name"] for s in (ediary().table("subjects").select("id, name").execute().data or [])}
        cls_map = {c["id"]: c["class_name"] for c in (ediary().table("classes").select("id, class_name").execute().data or [])}
        tch_rows = ediary().table("teachers").select("id, name, surname").execute().data or []
        tch_map = {t["id"]: f"{t['name']} {t['surname']}" for t in tch_rows}

        def enrich(row):
            return {
                "id": row["id"],
                "date": row["date"],
                "period": row["period"],
                "subject": subj_map.get(row.get("subject_id"), ""),
                "subject_id": row.get("subject_id"),
                "class_name": cls_map.get(row.get("class_id"), ""),
                "class_id": row.get("class_id"),
                "original_teacher": tch_map.get(row.get("original_teacher_id"), ""),
                "original_teacher_id": row.get("original_teacher_id"),
                "substitute_teacher": tch_map.get(row.get("substitute_teacher_id"), ""),
                "substitute_teacher_id": row.get("substitute_teacher_id"),
                "room": row.get("room") or "",
                "note": row.get("note") or "",
                "topic": row.get("topic") or "",
            }

        return JsonResponse({"substitutions": [enrich(r) for r in (mine.data or [])]})

    if request.method == "POST":
        try:
            data = json.loads(request.body)
        except json.JSONDecodeError:
            return JsonResponse({"message": "Invalid JSON"}, status=400)

        date_str = data.get("date", "").strip()
        period = data.get("period")
        schedule_id = data.get("schedule_id", "").strip()
        room = data.get("room", "").strip()
        note = data.get("note", "").strip()
        topic = data.get("topic", "").strip()

        if not date_str or not period or not schedule_id:
            return JsonResponse({"message": "date, period, and schedule_id are required"}, status=400)

        slot = db.table("schedule").select("*").eq("id", schedule_id).limit(1).execute()
        if not slot.data:
            return JsonResponse({"message": "Schedule slot not found"}, status=404)
        slot = slot.data[0]

        original_teacher_id = slot["teacher_id"]
        subject_id = slot["subject_id"]
        class_id = slot["class_id"]

        if original_teacher_id == teacher_id:
            return JsonResponse({"message": "You cannot substitute for yourself"}, status=400)

        existing = (
            db.table("substitutes")
            .select("id")
            .eq("date", date_str).eq("period", int(period)).eq("class_id", class_id)
            .limit(1)
            .execute()
        )
        payload_data = {
            "date": date_str,
            "period": int(period),
            "original_teacher_id": original_teacher_id,
            "substitute_teacher_id": teacher_id,
            "subject_id": subject_id,
            "class_id": class_id,
            "room": room or slot.get("room", ""),
            "note": note,
            "topic": topic,
        }
        if existing.data:
            db.table("substitutes").update(payload_data).eq("id", existing.data[0]["id"]).execute()
            sub_id = existing.data[0]["id"]
        else:
            ins = db.table("substitutes").insert(payload_data).execute()
            sub_id = ins.data[0]["id"] if ins.data else None

        return JsonResponse({"message": "Substitute saved", "id": sub_id}, status=201)

    if request.method == "DELETE":
        sub_id = request.GET.get("id", "").strip()
        if not sub_id:
            return JsonResponse({"message": "id required"}, status=400)
        db.table("substitutes").delete().eq("id", sub_id).eq("substitute_teacher_id", teacher_id).execute()
        return JsonResponse({"message": "Deleted"})

    return JsonResponse({"message": "Method not allowed"}, status=405)


@csrf_exempt
def teacher_substitute_classes(request):
    """GET → list classes that can be substituted for a given date+period."""
    payload = _verify_token(request)
    if not payload or payload.get("role") != "teacher":
        return JsonResponse({"message": "Unauthorized"}, status=401)

    teacher_id = payload["sub"]
    date_str = request.GET.get("date", "").strip()
    period = request.GET.get("period", "").strip()

    if not date_str or not period:
        return JsonResponse({"message": "date and period required"}, status=400)

    try:
        from datetime import date as dt_date
        d = dt_date.fromisoformat(date_str)
        dow = d.isoweekday()
        if dow > 5:
            return JsonResponse({"classes": []})
    except ValueError:
        return JsonResponse({"message": "Invalid date"}, status=400)

    db = ediary()
    slots = (
        db.table("schedule")
        .select("id, teacher_id, subject_id, class_id, room")
        .eq("day_of_week", dow)
        .eq("period", int(period))
        .neq("teacher_id", teacher_id)
        .execute()
    )

    if not slots.data:
        return JsonResponse({"classes": []})

    existing_subs = (
        db.table("substitutes")
        .select("class_id")
        .eq("date", date_str)
        .eq("period", int(period))
        .execute()
    )
    already_covered = {s["class_id"] for s in (existing_subs.data or [])}

    subj_map = {s["id"]: s["name"] for s in (ediary().table("subjects").select("id, name").execute().data or [])}
    cls_map = {c["id"]: c["class_name"] for c in (ediary().table("classes").select("id, class_name").execute().data or [])}
    tch_rows = ediary().table("teachers").select("id, name, surname").execute().data or []
    tch_map = {t["id"]: f"{t['name']} {t['surname']}" for t in tch_rows}

    classes = []
    for s in slots.data:
        if s["class_id"] in already_covered:
            continue
        classes.append({
            "schedule_id": s["id"],
            "subject": subj_map.get(s["subject_id"], ""),
            "subject_id": s["subject_id"],
            "class_name": cls_map.get(s["class_id"], ""),
            "class_id": s["class_id"],
            "original_teacher": tch_map.get(s["teacher_id"], ""),
            "original_teacher_id": s["teacher_id"],
            "room": s.get("room") or "",
        })

    return JsonResponse({"classes": classes})


@csrf_exempt
def teacher_substitute_detail(request):
    """GET → view substitute lesson details + attendance."""
    payload = _verify_token(request)
    if not payload or payload.get("role") != "teacher":
        return JsonResponse({"message": "Unauthorized"}, status=401)

    teacher_id = payload["sub"]
    sub_id = request.GET.get("id", "").strip()
    if not sub_id:
        return JsonResponse({"message": "id required"}, status=400)

    db = ediary()
    result = db.table("substitutes").select("*").eq("id", sub_id).limit(1).execute()
    if not result.data:
        return JsonResponse({"message": "Not found"}, status=404)
    sub = result.data[0]

    if sub["original_teacher_id"] != teacher_id and sub["substitute_teacher_id"] != teacher_id:
        return JsonResponse({"message": "Unauthorized"}, status=403)

    subj_map = {s["id"]: s["name"] for s in (ediary().table("subjects").select("id, name").execute().data or [])}
    cls_map = {c["id"]: c["class_name"] for c in (ediary().table("classes").select("id, class_name").execute().data or [])}
    tch_rows = ediary().table("teachers").select("id, name, surname").execute().data or []
    tch_map = {t["id"]: f"{t['name']} {t['surname']}" for t in tch_rows}

    try:
        att_result = (
            ediary().table("attendance")
            .select("student_id, status, comment, topic")
            .eq("class_id", sub["class_id"])
            .eq("subject_id", sub["subject_id"])
            .eq("date_recorded", sub["date"])
            .eq("recorded_by_teacher_id", sub["substitute_teacher_id"])
            .execute()
        )
        attendance = att_result.data or []
    except Exception:
        attendance = []

    student_ids = [a["student_id"] for a in attendance]
    student_info = {}
    if student_ids:
        st_rows = ediary().table("students").select("id, name, surname, class_id").in_("id", student_ids).execute()
        for s in (st_rows.data or []):
            student_info[s["id"]] = {
                "name": s["name"], "surname": s["surname"],
                "class_name": cls_map.get(s.get("class_id"), ""),
            }

    topic = attendance[0].get("topic", "") if attendance else (sub.get("topic") or "")

    students = []
    for a in attendance:
        si = student_info.get(a["student_id"], {})
        students.append({
            "name": si.get("name", ""),
            "surname": si.get("surname", ""),
            "class_name": si.get("class_name", ""),
            "status": a["status"],
            "comment": a.get("comment", ""),
        })
    students.sort(key=lambda s: (s["surname"], s["name"]))

    return JsonResponse({
        "substitute": {
            "id": sub["id"],
            "date": sub["date"],
            "period": sub["period"],
            "subject": subj_map.get(sub.get("subject_id"), ""),
            "class_name": cls_map.get(sub.get("class_id"), ""),
            "original_teacher": tch_map.get(sub.get("original_teacher_id"), ""),
            "substitute_teacher": tch_map.get(sub.get("substitute_teacher_id"), ""),
            "room": sub.get("room") or "",
            "note": sub.get("note") or "",
            "topic": topic,
        },
        "students": students,
        "is_read_only": sub["original_teacher_id"] == teacher_id,
    })


# ------------------------------------------------------------------
# Teacher: events (create / list / edit / delete)
# ------------------------------------------------------------------

@csrf_exempt
def teacher_events(request):
    """Teachers can create events targeted at classes they teach."""
    payload = _verify_token(request)
    if not payload or payload.get("role") != "teacher":
        return JsonResponse({"message": "Unauthorized"}, status=401)

    teacher_id = payload["sub"]
    db = ediary()

    try:
        if request.method == "GET":
            # Return events created by this teacher
            result = (
                db.table("events")
                .select("*")
                .eq("created_by_teacher_id", teacher_id)
                .order("event_date", desc=True)
                .execute()
            )
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
            target_type = data.get("target_type", "class")
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
                "target_teacher_ids": [teacher_id],
                "created_by_teacher_id": teacher_id,
            }
            result = db.table("events").insert(row).execute()
            return JsonResponse({"event": (result.data or [None])[0]}, status=201)

        return JsonResponse({"message": "Method not allowed"}, status=405)
    except Exception:
        logger.exception("Server error")
        return JsonResponse({"message": "Internal server error"}, status=500)


@csrf_exempt
def teacher_event_detail(request):
    """Edit or delete an event created by this teacher."""
    payload = _verify_token(request)
    if not payload or payload.get("role") != "teacher":
        return JsonResponse({"message": "Unauthorized"}, status=401)

    teacher_id = payload["sub"]
    event_id = request.GET.get("id")
    if not event_id:
        return JsonResponse({"message": "id required"}, status=400)

    try:
        db = ediary()

        # Verify ownership
        ev = db.table("events").select("created_by_teacher_id").eq("id", event_id).limit(1).execute()
        if not ev.data or ev.data[0].get("created_by_teacher_id") != teacher_id:
            return JsonResponse({"message": "Not found or not yours"}, status=404)

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
                        "target_type", "target_class_ids", "target_student_ids"):
                if key in data:
                    updates[key] = data[key]
            if updates:
                db.table("events").update(updates).eq("id", event_id).execute()
            return JsonResponse({"updated": True})

        return JsonResponse({"message": "Method not allowed"}, status=405)
    except Exception:
        logger.exception("Server error")
        return JsonResponse({"message": "Internal server error"}, status=500)
