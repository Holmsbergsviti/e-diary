#!/usr/bin/env python3
"""Parse the aSc Timetables PDF (one page per teacher) and emit a JSON file
of (teacher, class, subject, day, period, room) lessons.

The PDF puts overlapping text in two different font sizes inside each grid
cell: the canonical subject name in a larger font and the group label in a
smaller font, sharing the same line. pdfplumber's `extract_table` interleaves
those characters into garbled strings (e.g. "ChemstrCy_hBemistry"), so we
work directly off the character stream and split by font size.

Run: python3 backend/parse_timetable_pdf.py docs/new_final_teachers.pdf docs/timetable_seed.json
"""
import json
import re
import sys
from pathlib import Path

import pdfplumber

ROW_TO_PERIOD = {3: 1, 4: 2, 6: 3, 7: 4, 8: 5, 10: 6, 11: 7, 12: 8}
# pdfplumber's `columns` attribute is unreliable here (returns overlapping
# bboxes). The aSc renderer uses fixed x positions per day column on every
# page, so we hard-code them.
DAY_X_RANGES = [
    (1, 88.5, 227.0),   # Mo
    (2, 227.0, 365.3),  # Tu
    (3, 365.3, 503.4),  # We
    (4, 503.4, 641.5),  # Th
    (5, 641.5, 779.8),  # Fr
]

SUBJECTS = [
    "Computer Science",
    "English Literature",
    "Media Studies",
    "Mathematics",
    "Chemistry",
    "Physics",
    "Biology",
    "History",
    "Geography",
    "Sociology",
    "Economics",
    "Business",
    "Psychology",
    "French",
    "German",
    "Spanish",
    "Chinese",
    "English",
    "IELTS",
    "ICT",
    "Art",
    "PE",
]

# Many cells in the PDF tag the subject as "Media studies" (lowercase s) or
# just "Media"; collapse them to the canonical form.
SUBJECT_ALIAS = {
    "Media studies": "Media Studies",
    "Media": "Media Studies",
}

# Group-label aliases → canonical subject (used when only the group label is
# legible).
GROUP_TO_SUBJECT = {
    "Eng_Lit": "English Literature",
    "Eng_AS": "English",
    "ENG_AS": "English",
    "Eng_IeltsA": "IELTS",
    "ENG 1": "English", "ENG 2": "English", "ENG 3": "English",
    "ENG 4": "English", "ENG 5": "English", "ENG 6": "English",
    "IELTS A": "IELTS", "IELTS B": "IELTS", "IELTS C": "IELTS",
    "Math1": "Mathematics", "Math2": "Mathematics", "Math3": "Mathematics",
    "Math4": "Mathematics", "MathA": "Mathematics", "Math_B": "Mathematics",
    "MAth_C": "Mathematics",
    "Phys1": "Physics", "Phys2": "Physics", "Phy2": "Physics",
    "Physics_A": "Physics", "Physics_B": "Physics",
    "Chem1": "Chemistry", "Chem2": "Chemistry",
    "Chemistry_A": "Chemistry", "Chemstry_B": "Chemistry",
    "Bio1": "Biology", "Bio2": "Biology",
    "His": "History", "His 1": "History", "His 2": "History", "His 3": "History",
    "Geo": "Geography", "Geo 1": "Geography", "Geo 2": "Geography",
    "Soc 1": "Sociology", "Soc 2": "Sociology", "Soc_1": "Sociology",
    "Bus 1": "Business", "Bus 2": "Business", "Bus 3": "Business",
    "Bus 4": "Business", "Bus 5": "Business",
    "Bus1": "Business", "Bus2": "Business",
    "Economy": "Economics", "Economy1": "Economics", "Econimy2": "Economics",
    "Fre": "French",
    "Ger": "German",
    "Spa": "Spanish", "Spa1": "Spanish", "Spa2": "Spanish",
    "M Lang": "Spanish",
    "Chi": "Chinese",
    "CS": "Computer Science",
    "Psy": "Psychology",
}

CLASS_RE = re.compile(r"\d{1,2}[a-fA-F]?(?:/\d{1,2}[a-fA-F]?)*")


def normalise_class(label: str) -> list[str]:
    parts = [s.strip() for s in label.split("/") if s.strip()]
    out = []
    for p in parts:
        m = re.match(r"^(\d+)([a-fA-F]?)$", p)
        if not m:
            continue
        num, suffix = m.group(1), m.group(2)
        out.append(num + suffix.upper())
    return out


def cluster_lines(chars: list, y_tol: float = 3.0) -> list[list]:
    """Group chars into horizontal lines based on `top` proximity."""
    if not chars:
        return []
    chars = sorted(chars, key=lambda c: (c["top"], c["x0"]))
    lines = [[chars[0]]]
    for c in chars[1:]:
        if abs(c["top"] - lines[-1][-1]["top"]) <= y_tol:
            lines[-1].append(c)
        else:
            lines.append([c])
    return [sorted(l, key=lambda c: c["x0"]) for l in lines]


def chars_to_text(chars: list, gap: float = 1.5) -> str:
    """Concat chars in x-order, inserting a single space when the horizontal
    gap between consecutive chars exceeds `gap` × char width."""
    if not chars:
        return ""
    chars = sorted(chars, key=lambda c: c["x0"])
    out = [chars[0]["text"]]
    for prev, cur in zip(chars, chars[1:]):
        cw = max(prev["x1"] - prev["x0"], 1.0)
        if cur["x0"] - prev["x1"] > cw * gap:
            out.append(" ")
        out.append(cur["text"])
    return "".join(out).strip()


def split_by_size(chars: list, threshold: float):
    big = [c for c in chars if c.get("size", 0) >= threshold]
    small = [c for c in chars if c.get("size", 0) < threshold]
    return big, small


def parse_cell_chars(chars: list) -> dict | None:
    """Return {class_labels, subject, room, group, initials} or None."""
    if not chars:
        return None
    lines = cluster_lines(chars, y_tol=4.0)
    if not lines:
        return None

    # First line = class label + (optional) room. Both small font (~9-10).
    first_text = chars_to_text(lines[0])
    cm = CLASS_RE.match(first_text.strip())
    class_label = cm.group(0) if cm else ""
    room = first_text[cm.end():].strip() if cm else ""

    # PE special: cell starts with "PE" and class is on the next line.
    if not class_label and first_text.upper().startswith("PE"):
        if len(lines) >= 2:
            second = chars_to_text(lines[1])
            cm2 = CLASS_RE.match(second.strip())
            if cm2:
                return {
                    "class_labels": normalise_class(cm2.group(0)),
                    "subject": "PE",
                    "room": "",
                    "group": "PE",
                    "initials": "",
                }

    classes = normalise_class(class_label) if class_label else []

    # Lesson body lives on the remaining lines. Subject is the larger font;
    # group is the smaller font; teacher initials sit in the smallest font
    # (often on the last line, top-right).
    body_chars = [c for ln in lines[1:] for c in ln]
    if not body_chars:
        return None

    sizes = sorted({round(c.get("size", 0), 1) for c in body_chars})
    # Heuristic: largest size = subject, mid = group, smallest = initials.
    if len(sizes) >= 2:
        subj_size = sizes[-1]
        small_size = sizes[0]
    else:
        subj_size = sizes[-1] if sizes else 0
        small_size = subj_size

    subj_chars = [c for c in body_chars if round(c.get("size", 0), 1) == subj_size]
    other_chars = [c for c in body_chars if round(c.get("size", 0), 1) != subj_size]

    subject_text = chars_to_text(subj_chars)
    other_text = chars_to_text(other_chars)

    # Initials are the smallest font tokens, almost always uppercase pair
    # near the right edge. Pull them out of `other_chars` first.
    init_chars = [c for c in other_chars if round(c.get("size", 0), 1) == small_size and c["text"].isupper()]
    # But "small_size" might be the group size if no separate initial size.
    # Disambiguate by looking at top: initials sit lower than group label.
    if init_chars:
        max_top = max(c["top"] for c in init_chars)
        # Initials are the bottom-right cluster, take chars near max_top.
        init_chars = [c for c in init_chars if abs(c["top"] - max_top) <= 2]
    initials = "".join(c["text"] for c in sorted(init_chars, key=lambda c: c["x0"]))[:3]

    # Group = other_chars minus initials.
    init_ids = {id(c) for c in init_chars}
    group_chars = [c for c in other_chars if id(c) not in init_ids]
    group_text = chars_to_text(group_chars)

    # Pick subject. Prefer matching the larger-font text to a known subject.
    subject = ""
    # Try the legacy short aliases first ("Media studies", "Media") so they
    # are picked up before falling through to the canonical list.
    for alias, mapped in SUBJECT_ALIAS.items():
        if alias.lower() in subject_text.lower():
            subject = mapped
            break
    if not subject:
        for s in SUBJECTS:
            if s.lower() in subject_text.lower():
                subject = s
                break
    if not subject:
        # Fall back to group → subject map.
        for token, mapped in GROUP_TO_SUBJECT.items():
            if token in group_text:
                subject = mapped
                break

    # Validate subject: only emit rows whose subject made it onto the
    # canonical list. Garbled merged-cell artifacts (e.g. "AArrtt") do not
    # match and are dropped to keep the import clean.
    if subject not in SUBJECTS:
        return None

    if not classes or not subject:
        return None

    return {
        "class_labels": classes,
        "subject": subject,
        "room": room,
        "group": group_text,
        "initials": initials,
    }


def parse_pdf(pdf_path: str) -> tuple[list, list]:
    rows, skipped = [], []
    with pdfplumber.open(pdf_path) as pdf:
        for page_idx, page in enumerate(pdf.pages):
            words = [w for w in page.extract_words() if w["top"] < 50]
            if not words or words[0]["text"] != "Teacher":
                continue
            teacher_name = " ".join(w["text"] for w in words[1:])
            tables = page.find_tables()
            if not tables:
                continue
            t = tables[0]
            row_bboxes = {i: r.bbox for i, r in enumerate(t.rows)}
            chars = page.chars

            for ri, period in ROW_TO_PERIOD.items():
                rb = row_bboxes.get(ri)
                if not rb:
                    continue
                top0, bot0 = rb[1], rb[3]
                for day, x0, x1 in DAY_X_RANGES:
                    cell_chars = [
                        c for c in chars
                        if x0 <= c["x0"] < x1 and top0 <= c["top"] < bot0
                    ]
                    if not cell_chars:
                        continue
                    parsed = parse_cell_chars(cell_chars)
                    if not parsed:
                        skipped.append({
                            "page": page_idx + 1,
                            "teacher": teacher_name,
                            "day": day, "period": period,
                            "raw": chars_to_text(cell_chars),
                        })
                        continue
                    for cls in parsed["class_labels"]:
                        rows.append({
                            "teacher_name": teacher_name,
                            "class_name": cls,
                            "subject_name": parsed["subject"],
                            "day_of_week": day,
                            "period": period,
                            "room": parsed["room"] or "",
                            "group": parsed["group"] or "",
                        })
    return rows, skipped


def main() -> int:
    if len(sys.argv) < 3:
        print("usage: parse_timetable_pdf.py <pdf> <out.json>")
        return 1
    rows, skipped = parse_pdf(sys.argv[1])
    Path(sys.argv[2]).write_text(json.dumps({
        "rows": rows,
        "skipped": skipped,
    }, indent=2, ensure_ascii=False))
    print(f"Parsed {len(rows)} schedule rows; {len(skipped)} cells skipped.")
    if skipped:
        print("First 5 skipped:")
        for s in skipped[:5]:
            print(" ", s)
    return 0


if __name__ == "__main__":
    sys.exit(main())
