"""Subject availability, mandatory rules, periods/week, teacher year
restrictions. Single source of truth for the new enrollment + generator
flow. All names match the canonical strings in the subjects table.
"""

# ----------------------------------------------------------------------
# Year 10/11 rules
# ----------------------------------------------------------------------

# Whole-class mandatory (every student in the year takes these,
# scheduled per class, no group split).
Y10_11_MANDATORY_CLASS = [
    "Mathematics", "Physics", "Chemistry", "Biology", "ICT",
]

# Mandatory but split by english_level into 5 groups.
Y10_11_MANDATORY_LEVEL_SPLIT = ["English"]

# Choice — pick exactly 2.
Y10_11_HUMANITIES = ["History", "Geography", "Sociology", "Business"]

# Choice — pick exactly 1.
Y10_11_PE_BUCKET = ["PE", "Art", "Psychology", "ML"]

# Choice — pick exactly 1.
Y10_11_LANGUAGES = ["French", "German", "Spanish", "Chinese"]

# ----------------------------------------------------------------------
# Year 12/13 rules
# ----------------------------------------------------------------------

# Subjects not offered to year 12/13.
Y12_13_NOT_OFFERED = {"ICT", "PE", "ML"}

# Subjects offered ONLY to year 12/13.
Y12_13_ONLY = {"Computer Science", "Economics", "English Literature",
               "IELTS", "Media Studies"}

# If a year 12/13 student takes neither of these, IELTS is auto-mandatory.
ENGLISH_OR_LIT = {"English", "English Literature"}

# Minimum number of subjects a year 12/13 student must pick.
Y12_13_MIN_SUBJECTS = 3

# ----------------------------------------------------------------------
# Group sizing
# ----------------------------------------------------------------------

GROUP_SIZE_MAX = 15      # cap per group
GROUP_SIZE_MIN_RUN = 1   # group runs even with 1 student (user choice)


# ----------------------------------------------------------------------
# Periods per week
# ----------------------------------------------------------------------

def periods_per_week(subject_name: str, year: int) -> int:
    """How many periods/week a subject runs in a given year."""
    if year in (12, 13):
        return 5 if subject_name == "IELTS" else 6
    # Year 10 / 11
    table = {
        "Mathematics": 5,
        "English": 5,
        "ICT": 4,
        "Biology": 3, "Chemistry": 3, "Physics": 3,
        "History": 3, "Geography": 3, "Sociology": 3, "Business": 3,
        "PE": 4, "Art": 4, "Psychology": 4, "ML": 4,  # 2 doubles → 4 periods
        "French": 4, "German": 4, "Spanish": 4, "Chinese": 4,
    }
    return table.get(subject_name, 4)


# ----------------------------------------------------------------------
# Teacher year restrictions (names exactly as stored in teachers table:
# "Surname Name").
# ----------------------------------------------------------------------

TEACHER_ONLY_10_11 = {
    "Bakovic Ana",
    "Jedoksic Natalija",
    "Damnjanovic Nikola",
    "Mrvic Aleksandra",
    "Kojic Katarina",
    "Mazin Vladimir",
    "Raicevic Nikola",
    "Maric Vlada",
    "Jeumovic Filip",
    "Sesartic Marija",
    "Vasilic Svetlana",
    "Kosanovic Dejana",
    "Stoiljkovic Ivan",
    "Mojovic Zorica",
    "Borozan Djordje",
    "Pesic Vesna",
    "S Gorana",
}

TEACHER_ONLY_12_13 = {
    "Blazek Barbara",
    "Simic Aleksandra",
    "Klikovac Vesna",
    "Cvijovic Milan",
    "Djuric Jovan",
}


def years_allowed_for_teacher(full_name: str) -> list[str]:
    """Return year-allowed list given 'Surname Name'."""
    if full_name in TEACHER_ONLY_10_11:
        return ["10", "11"]
    if full_name in TEACHER_ONLY_12_13:
        return ["12", "13"]
    return ["10", "11", "12", "13"]


# ----------------------------------------------------------------------
# Subject → years it is offered in
# ----------------------------------------------------------------------

def subject_years(subject_name: str) -> list[int]:
    """Years in which this subject is offered."""
    if subject_name in Y12_13_ONLY:
        return [12, 13]
    if subject_name in Y12_13_NOT_OFFERED:
        return [10, 11]
    return [10, 11, 12, 13]


def is_subject_allowed_for_year(subject_name: str, year: int) -> bool:
    return year in subject_years(subject_name)


# ----------------------------------------------------------------------
# Validators
# ----------------------------------------------------------------------

def validate_year_10_11_choices(subject_names: list[str]) -> tuple[bool, str]:
    """Validate the choice subjects only (mandatory not included).
    Returns (ok, error_message)."""
    chosen = set(subject_names)
    humanities = chosen & set(Y10_11_HUMANITIES)
    pe_bucket = chosen & set(Y10_11_PE_BUCKET)
    languages = chosen & set(Y10_11_LANGUAGES)

    extras = chosen - set(Y10_11_HUMANITIES) - set(Y10_11_PE_BUCKET) \
             - set(Y10_11_LANGUAGES)
    if extras:
        return False, f"Not a year 10/11 choice subject: {', '.join(sorted(extras))}"

    if len(humanities) != 2:
        return False, f"Must pick exactly 2 of: {', '.join(Y10_11_HUMANITIES)}"
    if len(pe_bucket) != 1:
        return False, f"Must pick exactly 1 of: {', '.join(Y10_11_PE_BUCKET)}"
    if len(languages) != 1:
        return False, f"Must pick exactly 1 of: {', '.join(Y10_11_LANGUAGES)}"
    return True, ""


def validate_year_12_13_choices(subject_names: list[str]) -> tuple[bool, str]:
    chosen = set(subject_names)
    bad = {s for s in chosen if not is_subject_allowed_for_year(s, 12)}
    if bad:
        return False, f"Not offered in year 12/13: {', '.join(sorted(bad))}"
    if len(chosen) < Y12_13_MIN_SUBJECTS:
        return False, f"Must pick at least {Y12_13_MIN_SUBJECTS} subjects"
    return True, ""


def needs_ielts(subject_names: list[str]) -> bool:
    """Year 12/13 — IELTS mandatory if neither English nor English Literature."""
    return not (set(subject_names) & ENGLISH_OR_LIT)
