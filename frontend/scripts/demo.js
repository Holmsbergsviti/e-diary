// Chartwell E-Diary — Demo mode
// Authors: Vladislav Salii, Stepan Atroshkin
//
// Lets anyone explore the app without an account. When demo mode is on,
// every request to the real API is answered in the browser by a small
// mock backend that mirrors the Django endpoints, backed by a generated
// sample school stored in localStorage. Nothing is sent to the server.
//
// Entry points:
//   index.html?demo=student | teacher | admin   → start demo as that role
//   demo.html                                  → landing page with role picker
//   EDiaryDemo.start(role) / .exit() / .reset()

(function () {
    "use strict";

    const API_MATCH = "e-diary-backend-qsly.onrender.com/api";
    const FLAG_KEY = "ediary_demo";
    const DB_KEY = "ediary_demo_db_v1";
    const LATENCY_MS = 120;

    const ALL_PERMS = {
        students: true, teachers: true, classes: true, subjects: true, schedule: true,
        events: true, holidays: true, import: true, impersonate: true, attendance: true, exports: true,
    };

    const DEMO_ACCOUNTS = {
        student: "s1",
        teacher: "t1",
        admin: "a1",
    };

    function isActive() {
        try { return localStorage.getItem(FLAG_KEY) === "1"; } catch { return false; }
    }

    /* ================================================================
       Helpers
       ================================================================ */

    function mulberry32(a) {
        return function () {
            a |= 0; a = (a + 0x6D2B79F5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function pad(n) { return String(n).padStart(2, "0"); }
    function iso(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
    function parseIso(s) { const [y, m, d] = String(s).slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d); }
    function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
    function today0() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
    function todayIso() { return iso(new Date()); }
    function isoWeekday(d) { const w = d.getDay(); return w === 0 ? 7 : w; } // Mon=1..Sun=7
    function termOf(dateStr) { const m = parseIso(dateStr).getMonth() + 1; return (m >= 9 && m <= 12) ? 1 : 2; }
    function nowStamp() { return new Date().toISOString(); }

    /** Nearest weekday on or after `d` (or on/before when back=true). */
    function weekdayFrom(d, back) {
        let x = new Date(d);
        while (isoWeekday(x) > 5) x = addDays(x, back ? -1 : 1);
        return x;
    }

    function pick(rnd, arr) { return arr[Math.floor(rnd() * arr.length)]; }
    function shuffle(rnd, arr) {
        const a = arr.slice();
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(rnd() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }
    function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

    function pctToGrade(p) {
        if (p >= 90) return "A*";
        if (p >= 82) return "A";
        if (p >= 76) return "A-";
        if (p >= 71) return "B+";
        if (p >= 66) return "B";
        if (p >= 61) return "B-";
        if (p >= 57) return "C+";
        if (p >= 53) return "C";
        if (p >= 49) return "C-";
        if (p >= 45) return "D+";
        if (p >= 41) return "D";
        if (p >= 37) return "D-";
        if (p >= 33) return "E";
        return "U";
    }

    function fullName(p) { return `${p.name} ${p.surname}`; }

    /* ================================================================
       Timetable solver (used for seeding and the admin generator)
       ================================================================ */

    /**
     * lessons: [{class_id, subject_id, teacher_id, count, room, ...extra}]
     * Returns { placements: [{...lesson, day, period}], unplaced: [lesson] }
     */
    function solveTimetable(lessons, seedNum) {
        for (let attempt = 0; attempt < 40; attempt++) {
            const rnd = mulberry32(seedNum + attempt * 7919);
            const res = _solveOnce(lessons, rnd);
            if (res.unplaced.length === 0 || attempt === 39) return res;
        }
    }

    function _solveOnce(lessons, rnd) {
        const classBusy = {}, teacherBusy = {}, subjDay = {};
        const teacherLoad = {};
        for (const l of lessons) teacherLoad[l.teacher_id] = (teacherLoad[l.teacher_id] || 0) + l.count;

        let units = [];
        lessons.forEach((l, li) => { for (let i = 0; i < l.count; i++) units.push({ l, li }); });
        units = shuffle(rnd, units).sort((a, b) => teacherLoad[b.l.teacher_id] - teacherLoad[a.l.teacher_id]);

        const placements = [], unplaced = [];
        for (const { l, li } of units) {
            const maxPerDay = Math.ceil(l.count / 5);
            let best = null, bestScore = Infinity;
            for (let d = 1; d <= 5; d++) {
                const sdKey = `${li}_${d}`;
                const sameDay = subjDay[sdKey] || 0;
                for (let p = 1; p <= 8; p++) {
                    if (classBusy[`${l.class_id}_${d}_${p}`]) continue;
                    if (teacherBusy[`${l.teacher_id}_${d}_${p}`]) continue;
                    let score = sameDay * 10 + rnd() * 3;
                    if (sameDay >= maxPerDay) score += 100;
                    if (p === 8) score += 4;
                    if (score < bestScore) { bestScore = score; best = { d, p }; }
                }
            }
            if (!best) { unplaced.push(l); continue; }
            classBusy[`${l.class_id}_${best.d}_${best.p}`] = true;
            teacherBusy[`${l.teacher_id}_${best.d}_${best.p}`] = true;
            subjDay[`${li}_${best.d}`] = (subjDay[`${li}_${best.d}`] || 0) + 1;
            placements.push({ ...l, day: best.d, period: best.p });
        }
        return { placements, unplaced };
    }

    function periodsPerWeek(subjectName, year) {
        if (year >= 12) return 6;
        const table = {
            Mathematics: 5, English: 5, ICT: 4, Biology: 3, Chemistry: 3, Physics: 3,
            History: 3, Geography: 3, PE: 4, Spanish: 4,
        };
        return table[subjectName] || 3;
    }

    /* ================================================================
       Sample school
       ================================================================ */

    const SUBJECTS = [
        ["sub_math", "Mathematics", "#2563eb"],
        ["sub_eng", "English", "#8e24aa"],
        ["sub_phy", "Physics", "#f4511e"],
        ["sub_chem", "Chemistry", "#43a047"],
        ["sub_bio", "Biology", "#00acc1"],
        ["sub_ict", "ICT", "#5e35b1"],
        ["sub_hist", "History", "#6d4c41"],
        ["sub_geo", "Geography", "#7cb342"],
        ["sub_pe", "PE", "#e53935"],
        ["sub_spa", "Spanish", "#f9a825"],
        ["sub_cs", "Computer Science", "#00897b"],
        ["sub_econ", "Economics", "#546e7a"],
        ["sub_lit", "English Literature", "#ab47bc"],
        ["sub_art", "Art", "#d81b60"],
        ["sub_fre", "French", "#3949ab"],
    ];

    const CLASSES = [
        ["c10a", "10A", 10],
        ["c10b", "10B", 10],
        ["c11a", "11A", 11],
        ["c12a", "12A", 12],
    ];

    const Y1011 = ["c10a", "c10b", "c11a"];
    const ALL4 = ["c10a", "c10b", "c11a", "c12a"];

    // id, name, surname, room, homeroom, [[subject, classes]]
    const TEACHERS = [
        ["t1", "Emma", "Clarke", "M1", "c10a", [["sub_math", ALL4]]],
        ["t2", "James", "Whitaker", "E2", "c12a", [["sub_eng", Y1011], ["sub_lit", ["c12a"]]]],
        ["t3", "Sofia", "Romero", "Lab 1", "c10b", [["sub_phy", ALL4]]],
        ["t4", "Daniel", "Okafor", "Lab 2", null, [["sub_chem", Y1011]]],
        ["t5", "Hannah", "Lee", "Lab 3", "c11a", [["sub_bio", Y1011]]],
        ["t6", "Marco", "Bianchi", "IT1", null, [["sub_ict", Y1011], ["sub_cs", ["c12a"]]]],
        ["t7", "Olivia", "Grant", "H4", null, [["sub_hist", Y1011], ["sub_geo", Y1011]]],
        ["t8", "Lucas", "Martin", "Gym", null, [["sub_pe", Y1011], ["sub_spa", Y1011]]],
        ["t9", "Priya", "Shah", "B3", null, [["sub_econ", ["c12a"]]]],
    ];

    const STUDENTS = {
        c10a: [["s1", "Alex", "Morgan", 78], ["s2", "Mia", "Thompson", 88], ["s3", "Noah", "Patel", 71], ["s4", "Ella", "Novak", 64], ["s5", "Leo", "Fischer", 83], ["s6", "Zara", "Ahmed", 92]],
        c10b: [["s7", "Lily", "Chen", 86], ["s8", "Oscar", "Silva", 59], ["s9", "Ava", "Kowalski", 75], ["s10", "Ethan", "Brooks", 68], ["s11", "Isla", "Murphy", 81], ["s12", "Ravi", "Kumar", 90]],
        c11a: [["s13", "Grace", "Kim", 84], ["s14", "Samuel", "Adeyemi", 73], ["s15", "Chloe", "Dubois", 79], ["s16", "Jacob", "Weber", 62], ["s17", "Amelia", "Rossi", 87], ["s18", "Finn", "Byrne", 70]],
        c12a: [["s19", "Sophie", "Laurent", 91], ["s20", "Max", "Petrov", 76], ["s21", "Hana", "Sato", 85], ["s22", "Luca", "Moretti", 67], ["s23", "Nina", "Ivanova", 80], ["s24", "Tom", "Harris", 72]],
    };

    const ASSESSMENTS = {
        sub_math: ["Algebra quiz", "Quadratics worksheet", "Unit 1 test: Functions", "Problem-solving classwork", "Trigonometry mini-test", "Statistics project"],
        sub_eng: ["Spelling & grammar quiz", "Persuasive letter", "Reading comprehension test", "Debate classwork", "Poetry mini-test", "Short story project"],
        sub_lit: ["Gothic fiction quiz", "Close reading essay", "Shakespeare test", "Seminar contribution", "Unseen poetry mini-test", "Comparative essay"],
        sub_phy: ["Forces quiz", "Motion graphs homework", "Unit test: Energy", "Practical write-up", "Electricity mini-test", "Renewable energy project"],
        sub_chem: ["Periodic table quiz", "Bonding homework", "Unit test: Atomic structure", "Titration practical", "Rates of reaction mini-test", "Polymers project"],
        sub_bio: ["Cells quiz", "Microscopy homework", "Unit test: Organisation", "Enzymes practical", "Genetics mini-test", "Ecosystem project"],
        sub_ict: ["Spreadsheets quiz", "Database homework", "Networks test", "Web page classwork", "Cyber security mini-test", "Website project"],
        sub_cs: ["Python basics quiz", "Algorithms homework", "Data structures test", "Pair programming classwork", "Boolean logic mini-test", "Programming project"],
        sub_hist: ["Industrial Revolution quiz", "Source analysis homework", "Unit test: World War I", "Timeline classwork", "Cold War mini-test", "Local history project"],
        sub_geo: ["Map skills quiz", "Rivers homework", "Unit test: Tectonics", "Fieldwork classwork", "Climate mini-test", "Urban planning project"],
        sub_pe: ["Fitness test", "Training diary homework", "Rules & tactics test", "Team sport assessment", "Anatomy mini-test", "Coaching project"],
        sub_spa: ["Vocabulary quiz", "Writing homework", "Listening test", "Speaking classwork", "Grammar mini-test", "Culture project"],
        sub_econ: ["Supply & demand quiz", "Market failure essay", "Unit test: Microeconomics", "Case study classwork", "Macro indicators mini-test", "Research project"],
    };
    const ASSESSMENT_CATS = ["quiz", "homework", "test", "classwork", "minitest", "project"];
    const ASSESSMENT_DAYS_AGO = [61, 47, 33, 22, 11, 2];

    const GRADE_COMMENTS = {
        high: ["Excellent work, well done!", "Outstanding effort and clear reasoning.", "Superb, keep it up.", "Very thorough answers."],
        mid: ["Good work, check your method in Q3.", "Solid effort; review the key terms.", "Nice progress since last time.", "Good, but show your working."],
        low: ["Please come to catch-up session on Thursday.", "Review the unit notes and retry the practice set.", "Needs more revision on the basics.", "Let's discuss this after class."],
    };

    const TOPICS = {
        sub_math: ["Simultaneous equations", "Pythagoras theorem", "Probability trees", "Linear graphs", "Circle theorems"],
        sub_eng: ["Persuasive techniques", "Of Mice and Men ch. 3", "Paragraph structure", "Creative writing", "Speech practice"],
        sub_lit: ["Macbeth Act 2", "Gothic conventions", "Poetry anthology", "Essay planning"],
        sub_phy: ["Newton's laws", "Specific heat capacity", "Circuits", "Waves", "Density practical"],
        sub_chem: ["Ionic bonding", "Moles", "Electrolysis", "Acids and alkalis"],
        sub_bio: ["Cell division", "Photosynthesis", "Heart and lungs", "Inheritance"],
        sub_ict: ["Spreadsheet formulas", "HTML basics", "Network topologies", "Data protection"],
        sub_cs: ["Recursion", "Sorting algorithms", "Binary and hex", "OOP basics"],
        sub_hist: ["Causes of WWI", "The Treaty of Versailles", "Industrial cities", "Source evaluation"],
        sub_geo: ["River landforms", "Plate boundaries", "Urban growth", "Map skills"],
        sub_pe: ["Basketball drills", "Fitness circuit", "Football tactics", "Athletics"],
        sub_spa: ["Daily routine", "Past tense", "Food and drink", "Holidays"],
        sub_econ: ["Elasticity", "Market structures", "Inflation", "Fiscal policy"],
    };

    const HOMEWORK = {
        sub_math: ["Exercise 4B: quadratic equations", "Past paper questions 1-10", "Probability worksheet", "Simultaneous equations practice", "Circle theorems sheet"],
        sub_eng: ["Write a 300-word persuasive letter", "Read chapter 4 and annotate", "Vocabulary list 6"],
        sub_lit: ["Essay plan: ambition in Macbeth", "Annotate two anthology poems", "Read Act 3"],
        sub_phy: ["Forces worksheet", "Revise for the energy test", "Circuit diagrams practice"],
        sub_chem: ["Balancing equations sheet", "Moles calculations", "Revise atomic structure"],
        sub_bio: ["Label the cell diagram", "Photosynthesis summary", "Genetics crosses practice"],
        sub_ict: ["Build a budget spreadsheet", "Research a data breach case", "Design a home page wireframe"],
        sub_cs: ["Implement bubble sort", "Binary conversion exercises", "Project milestone: class diagram"],
        sub_hist: ["Source analysis: propaganda poster", "Timeline of 1914", "Revise the causes of WWI"],
        sub_geo: ["Case study: a river flood", "Annotated map of your town", "Revise plate boundaries"],
        sub_pe: ["Log three training sessions", "Research a sports injury", "Warm-up routine plan"],
        sub_spa: ["Describe your daily routine (Spanish)", "Learn vocabulary set 5", "Listening exercise online"],
        sub_econ: ["Diagram practice: supply shifts", "Read the inflation article", "Data response question"],
    };

    const BEHAVIOR = {
        positive: ["Helped a classmate understand the task", "Excellent participation in today's discussion", "Showed great leadership in group work", "Consistently strong effort this week", "Volunteered to present the group's findings"],
        negative: ["Distracted others during the lesson", "Homework not handed in again", "Phone out during the lesson", "Late to class without a reason"],
        note: ["Seemed tired today, worth checking in", "Asked for extra practice material", "Missed the start of the lesson for a club meeting", "Will be absent next week for a competition"],
    };

    function buildSeed() {
        const rnd = mulberry32(20261114);
        const T = today0();
        const db = {
            meta: { seq: 1, seeded: todayIso() },
            emails: {}, classes: [], subjects: [], teachers: [], students: [], admins: [],
            teacher_assignments: [], teacher_subjects: [], student_subjects: [], grades: [],
            attendance: [], behavioral_entries: [], schedule: [], homework: [], homework_completions: [],
            teacher_reports: [], events: [], holidays: [], study_hall: [], study_hall_attendance: [], substitutes: [],
        };
        const nid = (p) => `${p}${db.meta.seq++}`;

        for (const [id, name, color_code] of SUBJECTS) db.subjects.push({ id, name, color_code });
        for (const [id, class_name, grade_level] of CLASSES) db.classes.push({ id, class_name, grade_level, created_at: nowStamp() });
        const clsById = Object.fromEntries(db.classes.map(c => [c.id, c]));
        const subjById = Object.fromEntries(db.subjects.map(s => [s.id, s]));

        // Admins
        db.admins.push({ id: "a1", name: "Rachel", surname: "Adams", admin_level: "super", permissions: ALL_PERMS, profile_picture_url: null, avatar_emoji: "🛡️" });
        db.admins.push({ id: "a2", name: "Tom", surname: "Price", admin_level: "regular", permissions: { ...ALL_PERMS, import: false, impersonate: false }, profile_picture_url: null });
        db.emails.a1 = "rachel.adams@demo.school";
        db.emails.a2 = "tom.price@demo.school";

        // Teachers + assignments
        const roomOf = {};
        for (const [id, name, surname, room, homeroom, teaches] of TEACHERS) {
            db.teachers.push({
                id, name, surname, is_class_teacher: !!homeroom, class_teacher_of_class_id: homeroom,
                default_password: "Demo-" + surname.slice(0, 3) + "2026", profile_picture_url: null, avatar_emoji: null,
                contact_email: `${name}.${surname}@demo.school`.toLowerCase(), created_at: nowStamp(),
            });
            db.emails[id] = `${name}.${surname}@demo.school`.toLowerCase();
            roomOf[id] = room;
            const years = new Set();
            for (const [subject_id, classIds] of teaches) {
                for (const class_id of classIds) {
                    db.teacher_assignments.push({ teacher_id: id, subject_id, class_id, created_at: nowStamp() });
                    years.add(String(clsById[class_id].grade_level));
                }
            }
            for (const [subject_id] of teaches) {
                db.teacher_subjects.push({ teacher_id: id, subject_id, years_allowed: [...years].sort() });
            }
        }
        db.teachers.find(t => t.id === "t1").avatar_emoji = "👩‍🏫";

        // Students + enrollments
        const ability = {};
        for (const [class_id, list] of Object.entries(STUDENTS)) {
            for (const [id, name, surname, ab] of list) {
                const year = clsById[class_id].grade_level;
                db.students.push({
                    id, name, surname, class_id, default_password: "Demo-" + name.slice(0, 3) + "2026",
                    profile_picture_url: null, avatar_emoji: null, english_level: year <= 11 ? 1 + Math.floor(rnd() * 5) : null,
                    created_at: nowStamp(),
                });
                db.emails[id] = `${name}.${surname}@demo.school`.toLowerCase();
                ability[id] = ab;
                for (const a of db.teacher_assignments.filter(a => a.class_id === class_id)) {
                    db.student_subjects.push({ student_id: id, subject_id: a.subject_id, group_class_id: null, group_label: null, created_at: nowStamp() });
                }
            }
        }
        db.students.find(s => s.id === "s1").avatar_emoji = "🦊";

        // Timetable
        const lessons = db.teacher_assignments.map(a => ({
            class_id: a.class_id, subject_id: a.subject_id, teacher_id: a.teacher_id, room: roomOf[a.teacher_id],
            count: periodsPerWeek(subjById[a.subject_id].name, clsById[a.class_id].grade_level),
        }));
        const solved = solveTimetable(lessons, 42);
        for (const p of solved.placements) {
            db.schedule.push({ id: nid("sl"), teacher_id: p.teacher_id, subject_id: p.subject_id, class_id: p.class_id, day_of_week: p.day, period: p.period, room: p.room });
        }

        const teacherOf = (class_id, subject_id) => (db.teacher_assignments.find(a => a.class_id === class_id && a.subject_id === subject_id) || {}).teacher_id;

        // Grades
        for (const s of db.students) {
            const subjects = db.student_subjects.filter(e => e.student_id === s.id).map(e => e.subject_id);
            for (const subject_id of subjects) {
                const bias = (rnd() - 0.5) * 14;
                const names = ASSESSMENTS[subject_id] || ASSESSMENTS.sub_math;
                ASSESSMENT_CATS.forEach((category, i) => {
                    let daysAgo = ASSESSMENT_DAYS_AGO[i] + Math.floor(rnd() * 4);
                    if (i === 5) daysAgo = 1 + Math.floor(rnd() * 5);
                    const date = iso(weekdayFrom(addDays(T, -daysAgo), true));
                    const pct = Math.round(clamp(ability[s.id] + bias + (rnd() - 0.5) * 22, 18, 100));
                    let comment = "";
                    if (rnd() < 0.35) comment = pick(rnd, pct >= 80 ? GRADE_COMMENTS.high : pct >= 55 ? GRADE_COMMENTS.mid : GRADE_COMMENTS.low);
                    db.grades.push({
                        id: nid("g"), student_id: s.id, subject_id, assessment_name: names[i], percentage: pct,
                        grade_code: pctToGrade(pct), date_taken: date, comment, category, term: termOf(date),
                        created_by_teacher_id: teacherOf(s.class_id, subject_id), created_at: nowStamp(),
                    });
                });
            }
        }

        // Attendance: last 10 school days, plus the first periods of today
        const days = [];
        let cursor = addDays(T, -1);
        while (days.length < 10) {
            if (isoWeekday(cursor) <= 5) days.push(iso(cursor));
            cursor = addDays(cursor, -1);
        }
        days.reverse();
        const todayIsWeekday = isoWeekday(T) <= 5;
        if (todayIsWeekday) days.push(iso(T));

        days.forEach((date, dayIdx) => {
            const dow = isoWeekday(parseIso(date));
            const isToday = date === iso(T);
            const slots = db.schedule.filter(sl => sl.day_of_week === dow && (!isToday || sl.period <= 2));
            const absentAllDay = {};
            for (const s of db.students) absentAllDay[s.id] = rnd() < 0.035 ? (rnd() < 0.5 ? "Absent" : "Excused") : null;
            if (dayIdx === 4) absentAllDay.s1 = null;
            for (const sl of slots) {
                const topic = pick(rnd, TOPICS[sl.subject_id] || ["Revision"]);
                for (const s of db.students.filter(st => st.class_id === sl.class_id)) {
                    let status = "Present", comment = "", minutes_late = null;
                    if (absentAllDay[s.id]) {
                        status = absentAllDay[s.id];
                        if (status === "Excused") comment = pick(rnd, ["Medical appointment", "Family emergency", "School trip"]);
                    } else {
                        const r = rnd();
                        if (r < 0.04) { status = "Late"; minutes_late = 3 + Math.floor(rnd() * 13); if (rnd() < 0.5) comment = "Arrived after the bell"; }
                        else if (r < 0.046) { status = "Absent"; }
                    }
                    if (s.id === "s1") {
                        status = "Present"; comment = ""; minutes_late = null;
                        if (dayIdx === 2 && sl.period === Math.min(...slots.filter(x => x.class_id === "c10a").map(x => x.period))) { status = "Late"; minutes_late = 8; comment = "Bus was delayed"; }
                        if (dayIdx === 6 && sl.subject_id === "sub_hist") { status = "Absent"; }
                    }
                    db.attendance.push({
                        id: nid("at"), student_id: s.id, class_id: sl.class_id, subject_id: sl.subject_id, date_recorded: date,
                        status, comment, topic, minutes_late, period: sl.period, recorded_by_teacher_id: sl.teacher_id, created_at: nowStamp(),
                    });
                }
            }
        });

        // Homework + completions
        for (const a of db.teacher_assignments) {
            const titles = HOMEWORK[a.subject_id] || ["Revision tasks"];
            const dues = [-9, -2, 4];
            if (a.teacher_id === "t1") dues.push(8);
            const shift = ALL4.indexOf(a.class_id) + 1;
            dues.forEach((off, i) => {
                const due = iso(weekdayFrom(addDays(T, off), off < 0));
                const hw = {
                    id: nid("hw"), teacher_id: a.teacher_id, subject_id: a.subject_id, class_id: a.class_id,
                    title: titles[(i + shift) % titles.length], description: i === 0 ? "Show all your working. Submit on paper at the start of the lesson." : i === 2 ? "Bring questions to the next lesson if anything is unclear." : "",
                    due_date: due, created_at: addDays(parseIso(due), -7).toISOString(),
                };
                db.homework.push(hw);
                if (off < 0) {
                    for (const s of db.students.filter(st => st.class_id === a.class_id)) {
                        const r = rnd();
                        let status = r < 0.74 ? "completed" : r < 0.9 ? "partial" : "not_done";
                        if (s.id === "s1") status = (i === 0 && a.subject_id === "sub_geo") ? "partial" : "completed";
                        db.homework_completions.push({ id: nid("hc"), homework_id: hw.id, student_id: s.id, status, recorded_by_teacher_id: a.teacher_id });
                    }
                }
            });
        }

        // Behavioural entries
        const behSeed = [
            ["s1", "t1", "positive", "low", 0], ["s1", "t7", "positive", "low", 1], ["s1", "t2", "note", "low", 2],
            ["s3", "t1", "negative", "medium", 0], ["s6", "t1", "positive", "low", 1], ["s4", "t1", "note", "low", 3],
            ["s9", "t1", "positive", "low", 2], ["s16", "t1", "negative", "medium", 1], ["s20", "t1", "positive", "low", 4],
            ["s8", "t3", "negative", "high", 1], ["s12", "t3", "positive", "low", 2], ["s14", "t5", "note", "low", 0],
            ["s22", "t9", "negative", "medium", 3], ["s17", "t2", "positive", "low", 0], ["s10", "t8", "negative", "low", 2],
        ];
        behSeed.forEach(([student_id, teacher_id, entry_type, severity, k], i) => {
            const st = db.students.find(s => s.id === student_id);
            const a = db.teacher_assignments.find(x => x.teacher_id === teacher_id && x.class_id === st.class_id);
            db.behavioral_entries.push({
                id: nid("b"), teacher_id, student_id, class_id: st.class_id, subject_id: a ? a.subject_id : null,
                entry_type, content: BEHAVIOR[entry_type][k % BEHAVIOR[entry_type].length], severity,
                created_at: addDays(T, -(2 + i * 2)).toISOString(), updated_at: nowStamp(),
            });
        });

        // Events + holidays
        const d = (off) => iso(weekdayFrom(addDays(T, off), false));
        const s1Classmates = ["s1", "s2", "s6", "s12", "s19"];
        db.events.push(
            { id: nid("ev"), title: "Science Fair", description: "Year 10–12 projects on display in the main hall. Lessons after lunch are cancelled.", event_date: d(5), event_end_date: d(5), start_time: "13:15", end_time: "15:30", affected_periods: [6, 7, 8], target_type: "all", target_class_ids: [], target_student_ids: [], target_teacher_ids: [], created_by_teacher_id: null, created_at: nowStamp() },
            { id: nid("ev"), title: "Year 10 Museum Trip", description: "Natural History Museum. Packed lunch required; meet at the front gate.", event_date: d(9), event_end_date: d(9), start_time: "08:30", end_time: "12:30", affected_periods: [1, 2, 3, 4, 5], target_type: "class", target_class_ids: ["c10a", "c10b"], target_student_ids: [], target_teacher_ids: ["t7"], created_by_teacher_id: null, created_at: nowStamp() },
            { id: nid("ev"), title: "Maths Olympiad Training", description: "Extra session for the regional competition team.", event_date: d(2), event_end_date: d(2), start_time: "14:50", end_time: "15:30", affected_periods: [8], target_type: "students", target_class_ids: [], target_student_ids: s1Classmates, target_teacher_ids: ["t1"], created_by_teacher_id: "t1", created_at: nowStamp() },
            { id: nid("ev"), title: "Parent-Teacher Evening", description: "Appointments from 16:00 in the library.", event_date: d(12), event_end_date: d(12), start_time: "16:00", end_time: "19:00", affected_periods: [], target_type: "all", target_class_ids: [], target_student_ids: [], target_teacher_ids: [], created_by_teacher_id: null, created_at: nowStamp() },
            { id: nid("ev"), title: "Sports Day", description: "Whole-school athletics at the stadium.", event_date: iso(weekdayFrom(addDays(T, -13), true)), event_end_date: iso(weekdayFrom(addDays(T, -13), true)), start_time: "08:30", end_time: "15:30", affected_periods: [1, 2, 3, 4, 5, 6, 7, 8], target_type: "all", target_class_ids: [], target_student_ids: [], target_teacher_ids: [], created_by_teacher_id: null, created_at: nowStamp() },
        );
        db.holidays.push(
            { id: nid("h"), name: "Teacher Training Day", start_date: d(16), end_date: d(16), created_at: nowStamp() },
            { id: nid("h"), name: "Winter Break", start_date: iso(addDays(T, 38)), end_date: iso(addDays(T, 53)), created_at: nowStamp() },
        );

        // Study hall: a past session run by Emma when 12A was free
        const emmaBusy = new Set(db.schedule.filter(s => s.teacher_id === "t1").map(s => `${s.day_of_week}_${s.period}`));
        const busy12 = new Set(db.schedule.filter(s => s.class_id === "c12a").map(s => `${s.day_of_week}_${s.period}`));
        const shDate = days[days.length - (todayIsWeekday ? 2 : 1)];
        const shDow = isoWeekday(parseIso(shDate));
        for (let p = 1; p <= 8; p++) {
            const k = `${shDow}_${p}`;
            if (!emmaBusy.has(k) && !busy12.has(k)) {
                const sh = { id: nid("sh"), teacher_id: "t1", date: shDate, period: p, room: "Library", created_at: nowStamp() };
                db.study_hall.push(sh);
                for (const s of db.students.filter(x => x.class_id === "c12a")) {
                    db.study_hall_attendance.push({ id: nid("sha"), study_hall_id: sh.id, student_id: s.id, status: s.id === "s22" ? "Absent" : "Present" });
                }
                break;
            }
        }

        // Substitutes in the coming days
        const upcoming = [];
        for (let i = 1; upcoming.length < 5; i++) { const x = addDays(T, i); if (isoWeekday(x) <= 5) upcoming.push(x); }
        const subForEmma = (() => {
            for (const day of upcoming) {
                const dow = isoWeekday(day);
                const slot = db.schedule.find(s => s.teacher_id === "t2" && s.day_of_week === dow && !emmaBusy.has(`${dow}_${s.period}`));
                if (slot) return { day, slot };
            }
        })();
        if (subForEmma) {
            db.substitutes.push({ id: nid("sub"), date: iso(subForEmma.day), period: subForEmma.slot.period, original_teacher_id: "t2", substitute_teacher_id: "t1", subject_id: subForEmma.slot.subject_id, class_id: subForEmma.slot.class_id, room: subForEmma.slot.room, note: "James is at an exam board meeting. Worksheets are on his desk.", topic: "Independent reading", created_at: nowStamp() });
        }
        const lucasBusy = new Set(db.schedule.filter(s => s.teacher_id === "t8").map(s => `${s.day_of_week}_${s.period}`));
        for (const day of upcoming.slice(1)) {
            const dow = isoWeekday(day);
            const slot = db.schedule.find(s => s.teacher_id === "t1" && s.day_of_week === dow && !lucasBusy.has(`${dow}_${s.period}`) && !(subForEmma && iso(subForEmma.day) === iso(day) && subForEmma.slot.period === s.period));
            if (slot) {
                db.substitutes.push({ id: nid("sub"), date: iso(day), period: slot.period, original_teacher_id: "t1", substitute_teacher_id: "t8", subject_id: slot.subject_id, class_id: slot.class_id, room: slot.room, note: "Emma is at a training course. Textbook exercise 5C.", topic: "Practice exercises", created_at: nowStamp() });
                break;
            }
        }

        // A few reports already written by Emma
        const term = termOf(iso(T));
        const reportSeed = [["s1", "A", "Excellent", "Alex works hard and asks thoughtful questions. Keep challenging yourself with the extension tasks."], ["s2", "A*", "Excellent", "Mia is a natural problem solver and a pleasure to teach."], ["s3", "B", "Good", "Noah has improved steadily this term; more practice on algebra will help."]];
        for (const [student_id, report_grade, effort, comment] of reportSeed) {
            db.teacher_reports.push({ id: nid("r"), teacher_id: "t1", student_id, subject_id: "sub_math", class_id: "c10a", term, report_grade, effort, comment, created_at: nowStamp(), updated_at: nowStamp() });
        }

        return db;
    }

    /* ================================================================
       Persistence
       ================================================================ */

    let _db = null;
    function db() {
        if (_db) return _db;
        try {
            const raw = localStorage.getItem(DB_KEY);
            if (raw) _db = JSON.parse(raw);
        } catch { _db = null; }
        if (!_db) { _db = buildSeed(); save(); }
        return _db;
    }
    function save() {
        try { localStorage.setItem(DB_KEY, JSON.stringify(_db)); } catch (e) { console.warn("[demo] could not persist", e); }
    }
    function nid(prefix) { const d = db(); return `${prefix}${d.meta.seq++}`; }

    /* ================================================================
       Session helpers
       ================================================================ */

    function b64(obj) { return btoa(unescape(encodeURIComponent(JSON.stringify(obj)))); }
    function makeToken(userId, role) {
        const payload = { sub: userId, role, email: db().emails[userId] || "", exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30, demo: true };
        return `${b64({ alg: "none", typ: "JWT" })}.${b64(payload)}.demo`;
    }
    function readToken(headers) {
        let auth = "";
        if (headers instanceof Headers) auth = headers.get("Authorization") || "";
        else if (headers) auth = headers.Authorization || headers.authorization || "";
        const tok = auth.replace(/^Bearer\s+/i, "") || localStorage.getItem("token") || "";
        try { return JSON.parse(decodeURIComponent(escape(atob(tok.split(".")[1])))); } catch { return null; }
    }

    function findPerson(id) {
        const d = db();
        let p = d.students.find(x => x.id === id);
        if (p) return { role: "student", p };
        p = d.teachers.find(x => x.id === id);
        if (p) return { role: "teacher", p };
        p = d.admins.find(x => x.id === id);
        if (p) return { role: "admin", p };
        return null;
    }

    function userPayload(id) {
        const d = db();
        const found = findPerson(id);
        if (!found) return null;
        const { role, p } = found;
        const cls = role === "student" ? d.classes.find(c => c.id === p.class_id) : null;
        const u = {
            id, email: d.emails[id] || "", full_name: fullName(p), role,
            class_name: cls ? cls.class_name : "",
            profile_picture_url: p.profile_picture_url || null,
            avatar_emoji: p.avatar_emoji || null,
        };
        if (role === "teacher") u.contact_email = p.contact_email || "";
        if (role === "admin") { u.admin_level = p.admin_level; u.permissions = p.permissions || ALL_PERMS; }
        return u;
    }

    /* ================================================================
       Lookups
       ================================================================ */

    const L = {
        subj(id) { return db().subjects.find(s => s.id === id) || {}; },
        cls(id) { return db().classes.find(c => c.id === id) || {}; },
        teacherName(id) { const t = db().teachers.find(x => x.id === id); return t ? fullName(t) : ""; },
        studentName(id) { const s = db().students.find(x => x.id === id); return s ? fullName(s) : ""; },
        enrolled(subject_id, class_id) {
            const d = db();
            const ids = new Set();
            for (const ss of d.student_subjects.filter(e => e.subject_id === subject_id)) {
                const st = d.students.find(s => s.id === ss.student_id);
                if (!st) continue;
                if (ss.group_class_id ? ss.group_class_id === class_id : st.class_id === class_id) ids.add(st.id);
            }
            return d.students.filter(s => ids.has(s.id)).sort(byPerson);
        },
    };
    function byPerson(a, b) { return `${a.surname} ${a.name}`.localeCompare(`${b.surname} ${b.name}`); }

    function scheduleRow(slot) {
        const s = L.subj(slot.subject_id), c = L.cls(slot.class_id);
        return {
            id: slot.id, subject: s.name || "Unknown", subject_color: s.color_code || "#607D8B", subject_id: slot.subject_id,
            class_id: slot.class_id, class_name: c.class_name || "", grade_level: c.grade_level || 0,
            day_of_week: slot.day_of_week, period: slot.period, room: slot.room || "",
            teacher_name: L.teacherName(slot.teacher_id), teacher_email: db().emails[slot.teacher_id] || "",
            teacher_id: slot.teacher_id,
        };
    }

    function subRow(r, me, role) {
        return {
            id: r.id, date: r.date, period: r.period,
            subject: L.subj(r.subject_id).name || "", subject_id: r.subject_id,
            class_name: L.cls(r.class_id).class_name || "", class_id: r.class_id,
            original_teacher: L.teacherName(r.original_teacher_id), original_teacher_id: r.original_teacher_id,
            substitute_teacher: L.teacherName(r.substitute_teacher_id), substitute_teacher_id: r.substitute_teacher_id,
            room: r.room || "", note: r.note || "", topic: r.topic || "",
            is_substitute: true, is_substitute_for_me: role === "teacher" && r.original_teacher_id === me,
        };
    }

    /* ================================================================
       Endpoint handlers
       ================================================================ */

    function ok(body, status) { return { status: status || 200, body }; }
    function err(message, status) { return { status: status || 400, body: { message } }; }

    function pickKeys(src, keys) {
        const out = {};
        for (const k of keys) if (k in src) out[k] = src[k];
        return out;
    }

    const routes = {};
    function route(path, fn) { routes[path] = fn; }

    /* ---------- Auth ---------- */
    route("/login/", ({ body }) => {
        const email = String(body.email || "").toLowerCase();
        const d = db();
        const id = Object.keys(d.emails).find(k => d.emails[k] === email);
        if (!id) return err("Demo mode: use the demo buttons, or log in as e.g. alex.morgan@demo.school", 401);
        return ok({ token: makeToken(id, findPerson(id).role), user: userPayload(id) });
    });

    route("/me/", ({ method, me, body }) => {
        if (method === "PATCH" || method === "PUT") {
            const found = findPerson(me.sub);
            if (!found) return err("Profile not found", 404);
            if (body.password && String(body.password).length < 8) return err("Password must be at least 8 characters");
            if ("avatar_emoji" in body) { found.p.avatar_emoji = body.avatar_emoji || null; if (body.avatar_emoji) found.p.profile_picture_url = null; }
            if (body.clear_avatar) { found.p.avatar_emoji = null; found.p.profile_picture_url = null; }
            if (body.email) db().emails[me.sub] = String(body.email).trim().toLowerCase();
            save();
            return ok({ message: "Updated successfully" });
        }
        const u = userPayload(me.sub);
        return u ? ok(u) : err("Profile not found", 404);
    });

    route("/me/avatar/", () => err("Photo uploads are turned off in the demo. Try picking an emoji avatar instead!"));

    /* ---------- Student ---------- */
    route("/grades/", ({ me }) => {
        const d = db();
        const teacherSubjects = {};
        for (const a of d.teacher_assignments) (teacherSubjects[a.teacher_id] ||= new Set()).add(L.subj(a.subject_id).name);
        const rows = d.grades.filter(g => g.student_id === me.sub).sort((a, b) => a.date_taken.localeCompare(b.date_taken)).map(g => {
            const s = L.subj(g.subject_id);
            const t = d.teachers.find(x => x.id === g.created_by_teacher_id);
            return {
                id: g.id, subject: s.name || "Unknown", subject_id: g.subject_id, subject_color: s.color_code || "#607D8B",
                assessment: g.assessment_name || "", percentage: g.percentage, grade_code: g.grade_code || "", date: g.date_taken,
                comment: g.comment || "", category: g.category || "other", term: g.term || 1,
                teacher: {
                    id: t ? t.id : null, full_name: t ? fullName(t) : "", profile_picture_url: t ? t.profile_picture_url : null,
                    email: t ? d.emails[t.id] : "", subjects: t ? [...(teacherSubjects[t.id] || [])].sort() : [],
                },
            };
        });
        const enrolled = d.student_subjects.filter(e => e.student_id === me.sub).map(e => {
            const s = L.subj(e.subject_id);
            return { subject_id: s.id, subject: s.name, subject_color: s.color_code };
        });
        return ok({ grades: rows, enrolled_subjects: enrolled });
    });

    route("/subjects/", ({ me }) => {
        const d = db();
        const ids = new Set(d.student_subjects.filter(e => e.student_id === me.sub).map(e => e.subject_id));
        return ok({ subjects: d.subjects.filter(s => ids.has(s.id)) });
    });

    route("/diary/", () => ok({ entries: [] }));

    route("/attendance/", ({ me }) => {
        const rows = db().attendance.filter(a => a.student_id === me.sub)
            .sort((a, b) => b.date_recorded.localeCompare(a.date_recorded))
            .map(a => ({
                id: a.id, date_recorded: a.date_recorded, status: a.status, class_id: a.class_id, subject_id: a.subject_id,
                subject: L.subj(a.subject_id).name || "", comment: a.comment || "", period: a.period, minutes_late: a.minutes_late,
            }));
        return ok({ attendance: rows });
    });

    route("/announcements/", ({ me }) => {
        const d = db();
        let list;
        if (me.role === "teacher") {
            list = d.homework.filter(h => h.teacher_id === me.sub);
        } else {
            const st = d.students.find(s => s.id === me.sub);
            if (!st) return ok({ announcements: [] });
            const ss = d.student_subjects.filter(e => e.student_id === me.sub);
            const subjects = new Set(ss.map(e => e.subject_id));
            const classIds = new Set([st.class_id, ...ss.map(e => e.group_class_id).filter(Boolean)]);
            list = d.homework.filter(h => classIds.has(h.class_id) && subjects.has(h.subject_id));
        }
        list = list.slice().sort((a, b) => b.due_date.localeCompare(a.due_date));
        const rows = list.map(h => {
            const r = {
                id: h.id, subject_id: h.subject_id, class_id: h.class_id, title: h.title, body: h.description || "",
                subject: L.subj(h.subject_id).name || "", class_name: L.cls(h.class_id).class_name || "",
                due_date: h.due_date, created_at: h.created_at, author: me.role === "teacher" ? "" : L.teacherName(h.teacher_id),
            };
            if (me.role !== "teacher") {
                const c = d.homework_completions.find(x => x.homework_id === h.id && x.student_id === me.sub);
                r.completion_status = c ? c.status : "";
            }
            return r;
        });
        return ok({ announcements: rows });
    });

    route("/behavioral/", ({ me }) => {
        const d = db();
        const list = d.behavioral_entries.filter(b => me.role === "teacher" ? b.teacher_id === me.sub : b.student_id === me.sub)
            .sort((a, b) => b.created_at.localeCompare(a.created_at));
        return ok({
            entries: list.map(b => ({
                id: b.id, entry_type: b.entry_type, content: b.content, severity: b.severity || "",
                subject: L.subj(b.subject_id).name || "", student: L.studentName(b.student_id),
                teacher: L.teacherName(b.teacher_id), created_at: b.created_at,
            })),
        });
    });

    /* ---------- Schedule & events ---------- */
    route("/schedule/", ({ me }) => {
        const d = db();
        let slots;
        if (me.role === "teacher") {
            slots = d.schedule.filter(s => s.teacher_id === me.sub);
        } else {
            const st = d.students.find(s => s.id === me.sub);
            if (!st) return ok({ schedule: [] });
            slots = d.schedule.filter(s => s.class_id === st.class_id);
            const groupIds = d.student_subjects.filter(e => e.student_id === me.sub && e.group_class_id).map(e => e.group_class_id);
            const taken = new Set(slots.map(s => `${s.day_of_week}_${s.period}`));
            for (const s of d.schedule.filter(x => groupIds.includes(x.class_id))) {
                const k = `${s.day_of_week}_${s.period}`;
                if (!taken.has(k)) { slots.push(s); taken.add(k); }
            }
        }
        slots = slots.slice().sort((a, b) => a.day_of_week - b.day_of_week || a.period - b.period);
        const rows = slots.map(scheduleRow);

        const shName = (tid) => { const t = d.teachers.find(x => x.id === tid); return t ? `${t.surname} ${t.name}` : "Study Hall"; };
        let study_hall;
        if (me.role === "teacher") {
            study_hall = d.study_hall.filter(s => s.teacher_id === me.sub);
        } else {
            const ids = new Set(d.study_hall_attendance.filter(a => a.student_id === me.sub && a.status === "Present").map(a => a.study_hall_id));
            study_hall = d.study_hall.filter(s => ids.has(s.id));
        }
        study_hall = study_hall.map(s => ({ date: s.date, period: s.period, room: s.room || "", teacher_name: shName(s.teacher_id), is_study_hall: true }));

        let subs;
        if (me.role === "teacher") {
            subs = d.substitutes.filter(r => r.original_teacher_id === me.sub || r.substitute_teacher_id === me.sub);
        } else {
            const classIds = new Set(rows.map(r => r.class_id));
            subs = d.substitutes.filter(r => classIds.has(r.class_id));
        }
        return ok({ schedule: rows, study_hall, substitutes: subs.map(r => subRow(r, me.sub, me.role)) });
    });

    route("/events/", ({ me }) => {
        const d = db();
        const st = me.role === "student" ? d.students.find(s => s.id === me.sub) : null;
        const events = d.events.slice().sort((a, b) => a.event_date.localeCompare(b.event_date)).filter(ev => {
            if (me.role !== "student") return true;
            if (ev.target_type === "all") return true;
            if (ev.target_type === "class") return st && (ev.target_class_ids || []).includes(st.class_id);
            if (ev.target_type === "students") return (ev.target_student_ids || []).includes(me.sub);
            return false;
        });
        return ok({ events, holidays: d.holidays.slice().sort((a, b) => a.start_date.localeCompare(b.start_date)) });
    });

    /* ---------- Teacher ---------- */
    function teacherOnly(me) { return me.role === "teacher"; }

    route("/teacher/class-students/", ({ me, q }) => {
        if (!teacherOnly(me)) return err("Unauthorized", 403);
        const class_id = q.get("class_id"), subject_id = q.get("subject_id");
        if (!class_id || !subject_id) return err("class_id and subject_id required");
        return ok({ students: L.enrolled(subject_id, class_id).map(s => ({ id: s.id, name: s.name, surname: s.surname, class_name: L.cls(s.class_id).class_name || "" })) });
    });

    function eventStudentIdsOn(date) {
        const ids = new Set();
        for (const ev of db().events) {
            const end = ev.event_end_date || ev.event_date;
            if (ev.event_date <= date && date <= end && ev.target_type === "students") (ev.target_student_ids || []).forEach(i => ids.add(i));
        }
        return [...ids];
    }

    route("/teacher/attendance/", ({ me, method, q, body }) => {
        if (!teacherOnly(me)) return err("Unauthorized", 403);
        const d = db();
        if (method === "GET") {
            const class_id = q.get("class_id"), subject_id = q.get("subject_id"), date = q.get("date");
            const pr = q.get("period");
            const period = pr && pr !== "null" ? parseInt(pr, 10) : null;
            if (!class_id || !subject_id || !date) return err("class_id, subject_id, and date required");
            const rows = d.attendance.filter(a => a.class_id === class_id && a.subject_id === subject_id && a.date_recorded === date &&
                a.recorded_by_teacher_id === me.sub && (period == null || a.period === period))
                .map(a => pickKeys(a, ["id", "student_id", "status", "comment", "topic", "minutes_late", "period"]));
            return ok({ attendance: rows, topic: rows[0] ? rows[0].topic || "" : "", event_student_ids: eventStudentIdsOn(date) });
        }
        const { records, class_id, subject_id, date } = body;
        const topic = String(body.topic || "").trim();
        const period = body.period ? parseInt(body.period, 10) : null;
        if (!records || !records.length || !class_id || !subject_id || !date) return err("records, class_id, subject_id, and date required");
        d.attendance = d.attendance.filter(a => !(a.class_id === class_id && a.subject_id === subject_id && a.date_recorded === date &&
            a.recorded_by_teacher_id === me.sub && (period == null || a.period === period || a.period == null)));
        for (const r of records) {
            const status = r.status || "Present";
            d.attendance.push({
                id: nid("at"), student_id: r.student_id, class_id, subject_id, date_recorded: date, status, comment: r.comment || "",
                topic, minutes_late: status === "Late" && r.minutes_late ? parseInt(r.minutes_late, 10) : null, period,
                recorded_by_teacher_id: me.sub, created_at: nowStamp(),
            });
        }
        save();
        return ok({ saved: records.length }, 201);
    });

    route("/teacher/grades/add/", ({ me, body }) => {
        if (!teacherOnly(me)) return err("Unauthorized", 403);
        if (!body.student_id || !body.subject_id || !body.grade_code) return err("student_id, subject_id, and grade_code are required");
        const date = body.date || todayIso();
        const g = {
            id: nid("g"), student_id: body.student_id, subject_id: body.subject_id, assessment_name: body.assessment_name || "",
            grade_code: body.grade_code, percentage: body.percentage === "" || body.percentage == null ? null : parseFloat(body.percentage),
            comment: body.comment || "", date_taken: date, category: body.category || "other",
            term: body.term != null ? parseInt(body.term, 10) : termOf(date), created_by_teacher_id: me.sub, created_at: nowStamp(),
        };
        db().grades.push(g); save();
        return ok({ grade: g }, 201);
    });

    route("/teacher/grades/edit/", ({ me, body }) => {
        if (!teacherOnly(me)) return err("Unauthorized", 403);
        const g = db().grades.find(x => x.id === body.id);
        if (!g) return err("Grade not found", 404);
        Object.assign(g, pickKeys(body, ["assessment_name", "grade_code", "percentage", "comment", "category", "term"]));
        save();
        return ok({ grade: g });
    });

    route("/teacher/grades/delete/", ({ me, q }) => {
        if (!teacherOnly(me)) return err("Unauthorized", 403);
        const d = db();
        d.grades = d.grades.filter(g => g.id !== q.get("id")); save();
        return ok({ deleted: true });
    });

    route("/teacher/marks/", ({ me }) => {
        if (!teacherOnly(me)) return err("Unauthorized", 403);
        return ok({ groups: buildMarks(me.sub) });
    });

    route("/teacher/homework/add/", ({ me, body }) => {
        if (!teacherOnly(me)) return err("Unauthorized", 403);
        if (!body.subject_id || !body.class_id || !body.title || !body.due_date) return err("subject_id, class_id, title and due_date are required");
        const hw = { id: nid("hw"), teacher_id: me.sub, subject_id: body.subject_id, class_id: body.class_id, title: body.title.trim(), description: (body.description || "").trim(), due_date: body.due_date, created_at: nowStamp() };
        db().homework.push(hw); save();
        return ok({ homework: hw }, 201);
    });

    route("/teacher/homework/update/", ({ me, body }) => {
        if (!teacherOnly(me)) return err("Unauthorized", 403);
        const hw = db().homework.find(h => h.id === body.id && h.teacher_id === me.sub);
        if (!hw) return err("Homework not found or not owned by you", 404);
        Object.assign(hw, pickKeys(body, ["title", "description", "due_date", "subject_id", "class_id"]));
        save();
        return ok({ homework: hw });
    });

    route("/teacher/homework/delete/", ({ me, body }) => {
        if (!teacherOnly(me)) return err("Unauthorized", 403);
        const d = db();
        d.homework = d.homework.filter(h => !(h.id === body.id && h.teacher_id === me.sub));
        d.homework_completions = d.homework_completions.filter(c => c.homework_id !== body.id);
        save();
        return ok({ deleted: true });
    });

    route("/teacher/homework/completions/", ({ me, method, q, body }) => {
        if (!teacherOnly(me)) return err("Unauthorized", 403);
        const d = db();
        if (method === "GET") {
            return ok({ completions: d.homework_completions.filter(c => c.homework_id === q.get("homework_id")).map(c => pickKeys(c, ["id", "homework_id", "student_id", "status"])) });
        }
        const hwId = body.homework_id;
        d.homework_completions = d.homework_completions.filter(c => c.homework_id !== hwId);
        let n = 0;
        for (const r of body.records || []) {
            if (!r.status) continue;
            d.homework_completions.push({ id: nid("hc"), homework_id: hwId, student_id: r.student_id, status: r.status, recorded_by_teacher_id: me.sub });
            n++;
        }
        save();
        return ok({ saved: n }, 201);
    });

    route("/teacher/behavioral/add/", ({ me, body }) => {
        if (!teacherOnly(me)) return err("Unauthorized", 403);
        if (!body.student_id || !body.entry_type || !body.content) return err("student_id, entry_type and content are required");
        const e = {
            id: nid("b"), teacher_id: me.sub, student_id: body.student_id, class_id: body.class_id || null, subject_id: body.subject_id || null,
            entry_type: body.entry_type, content: body.content, severity: body.severity || null, created_at: nowStamp(), updated_at: nowStamp(),
        };
        db().behavioral_entries.push(e); save();
        return ok({ entry: e }, 201);
    });

    route("/teacher/behavioral/delete/", ({ me, body }) => {
        if (!teacherOnly(me)) return err("Unauthorized", 403);
        const d = db();
        d.behavioral_entries = d.behavioral_entries.filter(b => !(b.id === body.id && b.teacher_id === me.sub)); save();
        return ok({ deleted: true });
    });

    route("/teacher/class-stats/", ({ me }) => {
        if (!teacherOnly(me)) return err("Unauthorized", 403);
        const d = db();
        const stats = d.teacher_assignments.filter(a => a.teacher_id === me.sub).map(({ subject_id, class_id }) => {
            const enrolled = L.enrolled(subject_id, class_id);
            const ids = new Set(enrolled.map(s => s.id));
            const att = d.attendance.filter(a => a.subject_id === subject_id && a.class_id === class_id && ids.has(a.student_id));
            const count = (st) => att.filter(a => a.status === st).length;
            const grades = d.grades.filter(g => g.subject_id === subject_id && ids.has(g.student_id));
            const pcts = grades.map(g => g.percentage).filter(p => p != null);
            const dist = { "A*": 0, A: 0, B: 0, C: 0, D: 0, E: 0, U: 0 };
            for (const g of grades) {
                const code = g.grade_code || "";
                if (code.startsWith("A*")) dist["A*"]++;
                else { const letter = code.charAt(0); if (letter in dist) dist[letter]++; }
            }
            const hws = d.homework.filter(h => h.subject_id === subject_id && h.class_id === class_id);
            const hwc = { completed: 0, partial: 0, not_done: 0 };
            for (const h of hws) {
                if (h.due_date > todayIso()) continue;
                for (const sid of ids) {
                    const c = d.homework_completions.find(x => x.homework_id === h.id && x.student_id === sid);
                    hwc[c && c.status in hwc ? c.status : "not_done"]++;
                }
            }
            const beh = d.behavioral_entries.filter(b => b.subject_id === subject_id && b.class_id === class_id && ids.has(b.student_id));
            const bc = (t) => beh.filter(b => b.entry_type === t).length;
            return {
                subject_id, class_id, subject: L.subj(subject_id).name || "", class_name: L.cls(class_id).class_name || "",
                student_count: enrolled.length,
                attendance: { total: att.length, present: count("Present"), late: count("Late"), absent: count("Absent"), excused: count("Excused") },
                grades: { count: grades.length, average: pcts.length ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length * 10) / 10 : null, distribution: dist },
                homework: { assigned: hws.length, ...hwc },
                behavioral: { positive: bc("positive"), negative: bc("negative"), note: bc("note") },
            };
        });
        stats.sort((a, b) => a.subject.localeCompare(b.subject) || a.class_name.localeCompare(b.class_name));
        return ok({ stats });
    });

    route("/teacher/student-comments/", ({ me, q }) => {
        if (!teacherOnly(me)) return err("Unauthorized", 403);
        const d = db();
        const sid = q.get("student_id"), subjectId = q.get("subject_id");
        const st = d.students.find(s => s.id === sid);
        const homeroom = st ? L.cls(st.class_id).class_name : "";
        const comments = [];
        for (const a of d.attendance.filter(a => a.student_id === sid && (a.comment || "").trim() && (!subjectId || a.subject_id === subjectId))) {
            comments.push({ source: "attendance", date: a.date_recorded, subject: L.subj(a.subject_id).name || "", group: L.cls(a.class_id).class_name || "", period: a.period, teacher: L.teacherName(a.recorded_by_teacher_id), comment: a.comment });
        }
        for (const g of d.grades.filter(g => g.student_id === sid && (g.comment || "").trim() && (!subjectId || g.subject_id === subjectId))) {
            comments.push({ source: "grade", date: g.date_taken, subject: L.subj(g.subject_id).name || "", group: homeroom, period: null, teacher: L.teacherName(g.created_by_teacher_id), comment: g.comment });
        }
        for (const b of d.behavioral_entries.filter(b => b.student_id === sid && (!subjectId || b.subject_id === subjectId))) {
            comments.push({ source: "behavioral", date: b.created_at.slice(0, 10), subject: L.subj(b.subject_id).name || "", group: L.cls(b.class_id).class_name || "", period: null, teacher: L.teacherName(b.teacher_id), comment: b.content });
        }
        comments.sort((a, b) => b.date.localeCompare(a.date));
        return ok({ comments });
    });

    route("/teacher/reports/", ({ me, method, q, body }) => {
        if (!teacherOnly(me)) return err("Unauthorized", 403);
        const d = db();
        if (method === "GET") {
            const term = parseInt(q.get("term") || "1", 10);
            const reports = [];
            for (const { subject_id, class_id } of d.teacher_assignments.filter(a => a.teacher_id === me.sub)) {
                for (const s of L.enrolled(subject_id, class_id)) {
                    const ex = d.teacher_reports.find(r => r.teacher_id === me.sub && r.student_id === s.id && r.subject_id === subject_id && r.class_id === class_id && r.term === term) || {};
                    reports.push({
                        id: ex.id || null, student_id: s.id, student: `${s.surname} ${s.name}`, subject_id, subject: L.subj(subject_id).name || "",
                        class_id, class_name: L.cls(class_id).class_name || "", term, report_grade: ex.report_grade || "", effort: ex.effort || "", comment: ex.comment || "",
                    });
                }
            }
            reports.sort((a, b) => a.class_name.localeCompare(b.class_name) || a.subject.localeCompare(b.subject) || a.student.localeCompare(b.student));
            return ok({ reports });
        }
        const term = parseInt(body.term || 1, 10);
        let r = d.teacher_reports.find(x => x.teacher_id === me.sub && x.student_id === body.student_id && x.subject_id === body.subject_id && x.class_id === body.class_id && x.term === term);
        if (!r) {
            r = { id: nid("r"), teacher_id: me.sub, student_id: body.student_id, subject_id: body.subject_id, class_id: body.class_id, term, created_at: nowStamp() };
            d.teacher_reports.push(r);
        }
        Object.assign(r, { report_grade: body.report_grade || "", effort: body.effort || "", comment: body.comment || "", updated_at: nowStamp() });
        save();
        return ok({ report: r });
    });

    route("/teacher/study-hall/", ({ me, method, body }) => {
        if (!teacherOnly(me)) return err("Unauthorized", 403);
        const d = db();
        if (method === "GET") return ok({ sessions: d.study_hall.filter(s => s.teacher_id === me.sub).sort((a, b) => b.date.localeCompare(a.date)) });
        if (!body.date || !body.period) return err("date and period required");
        let s = d.study_hall.find(x => x.teacher_id === me.sub && x.date === body.date && x.period === parseInt(body.period, 10));
        if (s) s.room = body.room || "";
        else { s = { id: nid("sh"), teacher_id: me.sub, date: body.date, period: parseInt(body.period, 10), room: body.room || "", created_at: nowStamp() }; d.study_hall.push(s); }
        save();
        return ok({ session_id: s.id }, 201);
    });

    route("/teacher/study-hall/students/", ({ me, q }) => {
        if (!teacherOnly(me)) return err("Unauthorized", 403);
        const d = db();
        const date = q.get("date"), period = parseInt(q.get("period"), 10);
        const dow = isoWeekday(parseIso(date));
        if (dow > 5) return ok({ students: [], attendance: [] });
        const busy = new Set(d.schedule.filter(s => s.day_of_week === dow && s.period === period).map(s => s.class_id));
        const free = d.students.filter(s => s.class_id && !busy.has(s.class_id)).sort(byPerson)
            .map(s => ({ id: s.id, name: s.name, surname: s.surname, class_name: L.cls(s.class_id).class_name || "" }));
        const sess = d.study_hall.find(x => x.teacher_id === me.sub && x.date === date && x.period === period);
        const attendance = sess ? d.study_hall_attendance.filter(a => a.study_hall_id === sess.id).map(a => ({ student_id: a.student_id, status: a.status })) : [];
        return ok({ students: free, attendance });
    });

    route("/teacher/study-hall/attendance/", ({ me, body }) => {
        if (!teacherOnly(me)) return err("Unauthorized", 403);
        const d = db();
        d.study_hall_attendance = d.study_hall_attendance.filter(a => a.study_hall_id !== body.session_id);
        for (const r of body.records || []) d.study_hall_attendance.push({ id: nid("sha"), study_hall_id: body.session_id, student_id: r.student_id, status: r.status || "Absent" });
        save();
        return ok({ saved: (body.records || []).length }, 201);
    });

    route("/teacher/substitutes/", ({ me, method, q, body }) => {
        if (!teacherOnly(me)) return err("Unauthorized", 403);
        const d = db();
        if (method === "GET") {
            const mine = d.substitutes.filter(s => s.substitute_teacher_id === me.sub).sort((a, b) => b.date.localeCompare(a.date));
            return ok({ substitutions: mine.map(r => { const x = subRow(r, me.sub, "teacher"); delete x.is_substitute; delete x.is_substitute_for_me; return x; }) });
        }
        if (method === "DELETE") {
            d.substitutes = d.substitutes.filter(s => !(s.id === q.get("id") && s.substitute_teacher_id === me.sub)); save();
            return ok({ message: "Deleted" });
        }
        const slot = d.schedule.find(s => s.id === body.schedule_id);
        if (!body.date || !body.period || !slot) return err("date, period, and schedule_id are required");
        if (slot.teacher_id === me.sub) return err("You cannot substitute for yourself");
        const data = {
            date: body.date, period: parseInt(body.period, 10), original_teacher_id: slot.teacher_id, substitute_teacher_id: me.sub,
            subject_id: slot.subject_id, class_id: slot.class_id, room: body.room || slot.room || "", note: body.note || "", topic: body.topic || "",
        };
        let ex = d.substitutes.find(s => s.date === data.date && s.period === data.period && s.class_id === data.class_id);
        if (ex) Object.assign(ex, data);
        else { ex = { id: nid("sub"), ...data, created_at: nowStamp() }; d.substitutes.push(ex); }
        save();
        return ok({ message: "Substitute saved", id: ex.id }, 201);
    });

    route("/teacher/substitutes/classes/", ({ me, q }) => {
        if (!teacherOnly(me)) return err("Unauthorized", 403);
        const d = db();
        const date = q.get("date"), period = parseInt(q.get("period"), 10);
        const dow = isoWeekday(parseIso(date));
        if (dow > 5) return ok({ classes: [] });
        const covered = new Set(d.substitutes.filter(s => s.date === date && s.period === period).map(s => s.class_id));
        const classes = d.schedule.filter(s => s.day_of_week === dow && s.period === period && s.teacher_id !== me.sub && !covered.has(s.class_id)).map(s => ({
            schedule_id: s.id, subject: L.subj(s.subject_id).name || "", subject_id: s.subject_id, class_name: L.cls(s.class_id).class_name || "",
            class_id: s.class_id, original_teacher: L.teacherName(s.teacher_id), original_teacher_id: s.teacher_id, room: s.room || "",
        }));
        return ok({ classes });
    });

    route("/teacher/substitutes/detail/", ({ me, q }) => {
        if (!teacherOnly(me)) return err("Unauthorized", 403);
        const d = db();
        const sub = d.substitutes.find(s => s.id === q.get("id"));
        if (!sub) return err("Not found", 404);
        const att = d.attendance.filter(a => a.class_id === sub.class_id && a.subject_id === sub.subject_id && a.date_recorded === sub.date && a.recorded_by_teacher_id === sub.substitute_teacher_id);
        const students = att.map(a => {
            const s = d.students.find(x => x.id === a.student_id) || {};
            return { name: s.name || "", surname: s.surname || "", class_name: L.cls(s.class_id).class_name || "", status: a.status, comment: a.comment || "" };
        }).sort(byPerson);
        return ok({
            substitute: {
                id: sub.id, date: sub.date, period: sub.period, subject: L.subj(sub.subject_id).name || "", class_name: L.cls(sub.class_id).class_name || "",
                original_teacher: L.teacherName(sub.original_teacher_id), substitute_teacher: L.teacherName(sub.substitute_teacher_id),
                room: sub.room || "", note: sub.note || "", topic: att[0] ? att[0].topic : (sub.topic || ""),
            },
            students, is_read_only: sub.original_teacher_id === me.sub,
        });
    });

    const EVENT_KEYS = ["title", "description", "event_date", "event_end_date", "start_time", "end_time", "affected_periods", "target_type", "target_class_ids", "target_student_ids", "target_teacher_ids"];

    route("/teacher/events/", ({ me, method, body }) => {
        if (!teacherOnly(me)) return err("Unauthorized", 403);
        const d = db();
        if (method === "GET") return ok({ events: d.events.filter(e => e.created_by_teacher_id === me.sub).sort((a, b) => b.event_date.localeCompare(a.event_date)) });
        if (!body.title || !body.event_date) return err("title and event_date required");
        const ev = {
            id: nid("ev"), description: "", event_end_date: body.event_date, start_time: null, end_time: null, affected_periods: [],
            target_type: "class", target_class_ids: [], target_student_ids: [], ...pickKeys(body, EVENT_KEYS),
            target_teacher_ids: [me.sub], created_by_teacher_id: me.sub, created_at: nowStamp(),
        };
        if (!ev.event_end_date) ev.event_end_date = ev.event_date;
        d.events.push(ev); save();
        return ok({ event: ev }, 201);
    });

    route("/teacher/events/detail/", ({ me, method, q, body }) => {
        if (!teacherOnly(me)) return err("Unauthorized", 403);
        const d = db();
        const ev = d.events.find(e => e.id === q.get("id") && e.created_by_teacher_id === me.sub);
        if (!ev) return err("Not found or not yours", 404);
        if (method === "DELETE") { d.events = d.events.filter(e => e !== ev); save(); return ok({ deleted: true }); }
        Object.assign(ev, pickKeys(body, EVENT_KEYS)); save();
        return ok({ updated: true });
    });

    function buildMarks(teacherId) {
        const d = db();
        const T = today0(), todayStr = iso(T);
        const weekStart = iso(addDays(T, -((T.getDay() + 6) % 7)));
        const teacher = d.teachers.find(t => t.id === teacherId);
        const pairs = d.teacher_assignments.filter(a => a.teacher_id === teacherId);
        const yearLevels = new Set(pairs.map(p => L.cls(p.class_id).grade_level));
        const relevant = new Set(d.classes.filter(c => yearLevels.has(c.grade_level)).map(c => c.id));
        if (teacher.class_teacher_of_class_id) relevant.add(teacher.class_teacher_of_class_id);
        const students = d.students.filter(s => relevant.has(s.class_id)).sort(byPerson);
        const sids = new Set(students.map(s => s.id));
        const grades = d.grades.filter(g => sids.has(g.student_id)).sort((a, b) => a.date_taken.localeCompare(b.date_taken));
        const att = d.attendance.filter(a => sids.has(a.student_id));
        const beh = d.behavioral_entries.filter(b => sids.has(b.student_id));

        const gradeOut = (g) => ({ id: g.id, assessment: g.assessment_name || "", grade_code: g.grade_code || "", percentage: g.percentage, date: g.date_taken, comment: g.comment || "", category: g.category || "other", term: g.term || 1 });

        function stats(sid, subjectId, classId) {
            const c = { Present: 0, Late: 0, Absent: 0, Excused: 0 };
            const byTerm = { 1: { total: 0, ok: 0, absent: 0 }, 2: { total: 0, ok: 0, absent: 0 } };
            const trend = { today: { total: 0, ok: 0, absent: 0 }, week: { total: 0, ok: 0, absent: 0 } };
            let attComments = 0;
            for (const a of att) {
                if (a.student_id !== sid) continue;
                if (subjectId && a.subject_id !== subjectId) continue;
                if (classId && a.class_id !== classId) continue;
                c[a.status] = (c[a.status] || 0) + 1;
                const good = a.status === "Present" || a.status === "Late";
                const t = byTerm[termOf(a.date_recorded)];
                t.total++; if (good) t.ok++; if (a.status === "Absent") t.absent++;
                if ((a.comment || "").trim()) attComments++;
                for (const [k, cond] of [["today", a.date_recorded === todayStr], ["week", a.date_recorded >= weekStart && a.date_recorded <= todayStr]]) {
                    if (!cond) continue;
                    trend[k].total++; if (good) trend[k].ok++; if (a.status === "Absent") trend[k].absent++;
                }
            }
            const todays = att.filter(a => a.student_id === sid && a.date_recorded === todayStr).map(a => a.status);
            const absentToday = todays.includes("Absent");
            const presentToday = todays.some(s => s === "Present" || s === "Late");
            const allAttComments = att.filter(a => a.student_id === sid && (a.comment || "").trim()).length;
            const myGrades = grades.filter(g => g.student_id === sid);
            const gcAll = myGrades.filter(g => (g.comment || "").trim()).length;
            const gcF = myGrades.filter(g => (g.comment || "").trim() && (!subjectId || g.subject_id === subjectId)).length;
            const myBeh = beh.filter(b => b.student_id === sid);
            const bcF = myBeh.filter(b => !subjectId || b.subject_id === subjectId).length;
            const filtered = myGrades.filter(g => !subjectId || g.subject_id === subjectId);
            const pcts = filtered.map(g => g.percentage).filter(p => p != null);

            const st = d.students.find(s => s.id === sid);
            const hwc = { completed: 0, partial: 0, not_done: 0 };
            const detail = [];
            for (const h of d.homework) {
                if (classId ? h.class_id !== classId : h.class_id !== st.class_id) continue;
                if (subjectId && h.subject_id !== subjectId) continue;
                const comp = d.homework_completions.find(x => x.homework_id === h.id && x.student_id === sid);
                const status = comp ? comp.status : "not_done";
                hwc[status in hwc ? status : "not_done"]++;
                detail.push({ title: h.title, due_date: h.due_date, subject: L.subj(h.subject_id).name || "", status });
            }
            detail.sort((a, b) => (b.due_date || "").localeCompare(a.due_date || ""));
            const bc = { positive: 0, negative: 0, note: 0, detention: 0, suspension: 0 };
            for (const b of myBeh) if (b.entry_type in bc) bc[b.entry_type]++;
            const pct = (o) => o.total ? Math.round(o.ok / o.total * 1000) / 10 : null;
            return {
                attendance: { total: c.Present + c.Late + c.Absent + c.Excused, ...c },
                attendance_by_term: {
                    term_1: { total: byTerm[1].total, attendance_pct: pct(byTerm[1]), absent: byTerm[1].absent },
                    term_2: { total: byTerm[2].total, attendance_pct: pct(byTerm[2]), absent: byTerm[2].absent },
                },
                absent_today: absentToday,
                attendance_conflict_today: absentToday && presentToday,
                comments: { count: attComments + gcF + bcF, all_count: allAttComments + gcAll + myBeh.length },
                attendance_trends: {
                    today: { attendance_pct: pct(trend.today), absent: trend.today.absent },
                    week: { attendance_pct: pct(trend.week), absent: trend.week.absent },
                },
                grades: { count: filtered.length, average: pcts.length ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length * 10) / 10 : null },
                homework: hwc, homework_detail: detail, behavioral: bc,
            };
        }

        const groups = [];
        const homeroomId = teacher.is_class_teacher ? teacher.class_teacher_of_class_id : null;
        if (homeroomId) {
            const hr = students.filter(s => s.class_id === homeroomId);
            groups.push({
                type: "class_overview", class_name: L.cls(homeroomId).class_name, year_group: L.cls(homeroomId).grade_level,
                students: hr.map(s => ({
                    student_id: s.id, name: s.name, surname: s.surname, class_name: L.cls(s.class_id).class_name,
                    profile_picture_url: s.profile_picture_url || null,
                    subjects: d.student_subjects.filter(e => e.student_id === s.id).map(e => L.subj(e.subject_id)).sort((a, b) => a.name.localeCompare(b.name)).map(subj => ({
                        subject_id: subj.id, subject: subj.name, subject_color: subj.color_code,
                        stats: stats(s.id, subj.id, homeroomId),
                        grades: grades.filter(g => g.student_id === s.id && g.subject_id === subj.id).map(gradeOut),
                    })),
                    stats: stats(s.id),
                })),
            });
        }
        const sortedPairs = pairs.slice().sort((a, b) => L.cls(a.class_id).grade_level - L.cls(b.class_id).grade_level || L.cls(a.class_id).class_name.localeCompare(L.cls(b.class_id).class_name));
        for (const { subject_id, class_id } of sortedPairs) {
            const subj = L.subj(subject_id), cls = L.cls(class_id);
            groups.push({
                type: "subject_group", year_group: cls.grade_level, subject: subj.name, subject_id, subject_color: subj.color_code,
                class_id, class_name: cls.class_name, is_own_class: homeroomId === class_id,
                students: L.enrolled(subject_id, class_id).map(s => ({
                    student_id: s.id, name: s.name, surname: s.surname, class_name: L.cls(s.class_id).class_name,
                    profile_picture_url: s.profile_picture_url || null,
                    grades: grades.filter(g => g.student_id === s.id && g.subject_id === subject_id).map(gradeOut),
                    stats: stats(s.id, subject_id, class_id),
                })),
            });
        }
        return groups;
    }

    /* ---------- Admin ---------- */
    function adminOnly(me) { return me.role === "admin"; }

    route("/admin/stats/", ({ me }) => {
        if (!adminOnly(me)) return err("Unauthorized", 401);
        const d = db();
        const T = today0(), todayStr = iso(T);
        const weekStart = iso(addDays(T, -((T.getDay() + 6) % 7)));
        const att = d.attendance.filter(a => a.date_recorded >= weekStart && a.date_recorded <= todayStr);
        const weekAhead = iso(addDays(T, 7));
        return ok({
            total_classes: d.classes.length, total_subjects: d.subjects.length, total_teachers: d.teachers.length,
            total_students: d.students.length, total_admins: d.admins.filter(a => a.id !== "a1").length,
            total_assignments: d.teacher_assignments.length, total_enrollments: d.student_subjects.length, total_schedule_slots: d.schedule.length,
            classes_breakdown: d.classes.map(c => ({ class_name: c.class_name, grade_level: c.grade_level, student_count: d.students.filter(s => s.class_id === c.id).length })),
            att_rate_week: att.length ? Math.round(att.filter(a => a.status === "Present" || a.status === "Late").length / att.length * 1000) / 10 : null,
            pending_events_week: d.events.filter(e => e.event_date >= todayStr && e.event_date <= weekAhead).length,
        });
    });

    route("/admin/impersonate/", ({ me, body }) => {
        if (!adminOnly(me)) return err("Unauthorized", 401);
        const found = findPerson(body.user_id);
        if (!found) return err("User not found", 404);
        return ok({ token: makeToken(body.user_id, found.role), user: userPayload(body.user_id) });
    });

    function crud(listPath, detailPath, table, listKey, itemKey, keys, prefix, opts = {}) {
        route(listPath, ({ me, method, body }) => {
            if (!adminOnly(me)) return err("Unauthorized", 401);
            const d = db();
            if (method === "GET") return ok({ [listKey]: opts.list ? opts.list(d[table]) : d[table] });
            const row = { id: nid(prefix), ...(opts.defaults || {}), ...pickKeys(body, keys), created_at: nowStamp() };
            if (opts.validate) { const m = opts.validate(row); if (m) return err(m); }
            d[table].push(row); save();
            return ok({ [itemKey]: row }, opts.createStatus || 200);
        });
        route(detailPath, ({ me, method, q, body }) => {
            if (!adminOnly(me)) return err("Unauthorized", 401);
            const d = db();
            const id = q.get("id") || body.id;
            const row = d[table].find(r => r.id === id);
            if (!row) return err("Not found", 404);
            if (method === "DELETE") { d[table] = d[table].filter(r => r !== row); if (opts.onDelete) opts.onDelete(id); save(); return ok({ deleted: true }); }
            Object.assign(row, pickKeys(body, keys)); save();
            return ok(opts.patchReply ? opts.patchReply : { [itemKey]: row });
        });
    }

    crud("/admin/classes/", "/admin/classes/detail/", "classes", "classes", "class", ["class_name", "grade_level"], "c", {
        list: rows => rows.slice().sort((a, b) => a.grade_level - b.grade_level || a.class_name.localeCompare(b.class_name)),
        validate: r => (!r.class_name ? "class_name required" : null),
    });
    crud("/admin/subjects/", "/admin/subjects/detail/", "subjects", "subjects", "subject", ["name", "color_code"], "sub", {
        list: rows => rows.slice().sort((a, b) => a.name.localeCompare(b.name)),
        validate: r => (!r.name ? "name required" : null),
    });
    crud("/admin/events/", "/admin/events/detail/", "events", "events", "event", EVENT_KEYS, "ev", {
        list: rows => rows.slice().sort((a, b) => b.event_date.localeCompare(a.event_date)),
        defaults: { description: "", affected_periods: [], target_type: "all", target_class_ids: [], target_student_ids: [], target_teacher_ids: [], created_by_teacher_id: null },
        createStatus: 201, patchReply: { updated: true },
    });
    crud("/admin/holidays/", "/admin/holidays/detail/", "holidays", "holidays", "holiday", ["name", "start_date", "end_date"], "h", {
        list: rows => rows.slice().sort((a, b) => a.start_date.localeCompare(b.start_date)),
        createStatus: 201, patchReply: { updated: true },
    });

    route("/admin/users/", ({ me, method, q, body }) => {
        if (!adminOnly(me)) return err("Unauthorized", 401);
        const d = db();
        if (method === "GET") {
            const role = q.get("role") || "student";
            if (role === "teacher") {
                return ok({ users: d.teachers.slice().sort(byPerson).map(t => ({ ...t, email: d.emails[t.id] || "", class_teacher_class_name: L.cls(t.class_teacher_of_class_id).class_name || "" })) });
            }
            if (role === "admin") {
                return ok({ users: d.admins.filter(a => a.id !== me.sub && a.admin_level !== "super").map(a => ({ ...a, email: d.emails[a.id] || "" })) });
            }
            return ok({ users: d.students.slice().sort(byPerson).map(s => ({ ...s, email: d.emails[s.id] || "", class_name: L.cls(s.class_id).class_name || "", grade_level: L.cls(s.class_id).grade_level || 0 })) });
        }
        const role = body.role || "student";
        if (!body.name || !body.surname) return err("name and surname required");
        const prefix = role === "teacher" ? "t" : role === "admin" ? "a" : "s";
        const id = nid(prefix);
        const pw = body.password || `Demo-${body.name.slice(0, 3)}${Math.floor(1000 + Math.random() * 9000)}`;
        const base = { id, name: body.name, surname: body.surname, default_password: pw, profile_picture_url: null, avatar_emoji: null, created_at: nowStamp() };
        if (role === "teacher") d.teachers.push({ ...base, is_class_teacher: !!body.is_class_teacher, class_teacher_of_class_id: body.class_teacher_of_class_id || null, contact_email: "" });
        else if (role === "admin") d.admins.push({ ...base, admin_level: body.admin_level || "regular", permissions: body.permissions || ALL_PERMS });
        else {
            d.students.push({ ...base, class_id: body.class_id || null, english_level: null });
            for (const a of d.teacher_assignments.filter(a => a.class_id === body.class_id)) {
                d.student_subjects.push({ student_id: id, subject_id: a.subject_id, group_class_id: null, group_label: null, created_at: nowStamp() });
            }
        }
        d.emails[id] = (body.email || `${body.name}.${body.surname}@demo.school`).toLowerCase().replace(/\s+/g, "");
        save();
        return ok({ user: { id, email: d.emails[id], role }, default_password: pw }, 201);
    });

    route("/admin/users/detail/", ({ me, method, q, body }) => {
        if (!adminOnly(me)) return err("Unauthorized", 401);
        const d = db();
        const id = q.get("id") || body.id;
        const found = findPerson(id);
        if (!found) return err("User not found", 404);
        if (method === "DELETE") {
            const table = { student: "students", teacher: "teachers", admin: "admins" }[found.role];
            d[table] = d[table].filter(x => x.id !== id);
            d.student_subjects = d.student_subjects.filter(e => e.student_id !== id);
            d.teacher_assignments = d.teacher_assignments.filter(a => a.teacher_id !== id);
            d.schedule = d.schedule.filter(s => s.teacher_id !== id);
            delete d.emails[id];
            save();
            return ok({ deleted: true });
        }
        Object.assign(found.p, pickKeys(body, ["name", "surname", "class_id", "is_class_teacher", "class_teacher_of_class_id", "admin_level", "permissions"]));
        if (found.p.class_teacher_of_class_id === "") found.p.class_teacher_of_class_id = null;
        if (body.email) d.emails[id] = body.email.toLowerCase();
        if (body.password) found.p.default_password = body.password;
        save();
        return ok({ updated: true });
    });

    route("/admin/teacher-assignments/", ({ me, method, body }) => {
        if (!adminOnly(me)) return err("Unauthorized", 401);
        const d = db();
        if (method === "GET") {
            return ok({ assignments: d.teacher_assignments.map(a => ({ ...a, teacher_name: (() => { const t = d.teachers.find(x => x.id === a.teacher_id); return t ? `${t.surname} ${t.name}` : ""; })(), subject_name: L.subj(a.subject_id).name || "", class_name: L.cls(a.class_id).class_name || "" })) });
        }
        const row = { teacher_id: body.teacher_id, subject_id: body.subject_id, class_id: body.class_id, created_at: nowStamp() };
        d.teacher_assignments.push(row); save();
        return ok({ assignment: row });
    });
    route("/admin/teacher-assignments/delete/", ({ body }) => {
        const d = db();
        d.teacher_assignments = d.teacher_assignments.filter(a => !(a.teacher_id === body.teacher_id && a.subject_id === body.subject_id && a.class_id === body.class_id)); save();
        return ok({ deleted: true });
    });

    route("/admin/student-subjects/", ({ me, method, body }) => {
        if (!adminOnly(me)) return err("Unauthorized", 401);
        const d = db();
        if (method === "GET") {
            return ok({ enrollments: d.student_subjects.map(e => ({ ...e, student_name: (() => { const s = d.students.find(x => x.id === e.student_id); return s ? `${s.surname} ${s.name}` : ""; })(), subject_name: L.subj(e.subject_id).name || "", group_class_name: L.cls(e.group_class_id).class_name || "" })) });
        }
        const row = { student_id: body.student_id, subject_id: body.subject_id, group_class_id: body.group_class_id || null, created_at: nowStamp() };
        d.student_subjects.push(row); save();
        return ok({ enrollment: row });
    });
    route("/admin/student-subjects/delete/", ({ body }) => {
        const d = db();
        d.student_subjects = d.student_subjects.filter(e => !(e.student_id === body.student_id && e.subject_id === body.subject_id)); save();
        return ok({ deleted: true });
    });

    route("/admin/schedule/", ({ me, method, body }) => {
        if (!adminOnly(me)) return err("Unauthorized", 401);
        const d = db();
        if (method === "GET") {
            return ok({
                schedule: d.schedule.slice().sort((a, b) => a.day_of_week - b.day_of_week || a.period - b.period).map(s => {
                    const t = d.teachers.find(x => x.id === s.teacher_id);
                    return { ...s, teacher_name: t ? `${t.surname} ${t.name}` : "", subject_name: L.subj(s.subject_id).name || "", class_name: L.cls(s.class_id).class_name || "" };
                }),
            });
        }
        const row = { id: nid("sl"), ...pickKeys(body, ["teacher_id", "subject_id", "class_id", "room"]), day_of_week: parseInt(body.day_of_week, 10), period: parseInt(body.period, 10) };
        if (d.schedule.some(s => s.teacher_id === row.teacher_id && s.day_of_week === row.day_of_week && s.period === row.period)) return err("That teacher already has a lesson in this slot");
        d.schedule.push(row); save();
        return ok({ slot: row });
    });
    route("/admin/schedule/detail/", ({ me, method, q, body }) => {
        if (!adminOnly(me)) return err("Unauthorized", 401);
        const d = db();
        const id = q.get("id") || body.id;
        const row = d.schedule.find(s => s.id === id);
        if (!row) return err("Not found", 404);
        if (method === "DELETE") { d.schedule = d.schedule.filter(s => s !== row); save(); return ok({ deleted: true }); }
        Object.assign(row, pickKeys(body, ["teacher_id", "subject_id", "class_id", "room"]));
        if (body.day_of_week) row.day_of_week = parseInt(body.day_of_week, 10);
        if (body.period) row.period = parseInt(body.period, 10);
        save();
        return ok({ updated: true });
    });

    route("/admin/attendance-flags/", ({ me, q }) => {
        if (!adminOnly(me)) return err("Unauthorized", 401);
        const d = db();
        const from = q.get("from") || iso(addDays(today0(), -7)), to = q.get("to") || todayIso();
        const byKey = {};
        for (const a of d.attendance) if (a.date_recorded >= from && a.date_recorded <= to) (byKey[`${a.student_id}|${a.date_recorded}`] ||= []).push(a);
        const flags = [];
        for (const [k, entries] of Object.entries(byKey)) {
            const sts = new Set(entries.map(e => e.status));
            if (!sts.has("Absent") || !["Present", "Late", "Excused"].some(s => sts.has(s))) continue;
            const [sid, date] = k.split("|");
            const s = d.students.find(x => x.id === sid) || {};
            flags.push({
                student_id: sid, student_name: `${s.name || ""} ${s.surname || ""}`.trim(), class_name: L.cls(s.class_id).class_name || "", date,
                absent_in: entries.filter(e => e.status === "Absent").map(e => L.subj(e.subject_id).name),
                present_in: entries.filter(e => e.status !== "Absent").map(e => L.subj(e.subject_id).name),
            });
        }
        flags.sort((a, b) => b.date.localeCompare(a.date) || b.student_name.localeCompare(a.student_name));
        return ok({ flags, date_from: from, date_to: to });
    });

    route("/admin/student-lookup/", ({ me, q }) => {
        if (!adminOnly(me)) return err("Unauthorized", 401);
        const d = db();
        const sid = q.get("student_id");
        const s = d.students.find(x => x.id === sid);
        if (!s) return err("Student not found", 404);
        const cls = L.cls(s.class_id);
        const enrolled = d.student_subjects.filter(e => e.student_id === sid).map(e => {
            const subj = L.subj(e.subject_id);
            return { subject_id: e.subject_id, subject: subj.name || "Unknown", color: subj.color_code || "#607D8B", group_class: L.cls(e.group_class_id).class_name || "" };
        }).sort((a, b) => a.subject.localeCompare(b.subject));
        const grades = d.grades.filter(g => g.student_id === sid).sort((a, b) => b.date_taken.localeCompare(a.date_taken));
        const att = d.attendance.filter(a => a.student_id === sid).sort((a, b) => b.date_recorded.localeCompare(a.date_recorded));
        const summary = { Present: 0, Late: 0, Absent: 0, Excused: 0 };
        const byTerm = { 1: { total: 0, ok: 0 }, 2: { total: 0, ok: 0 } };
        for (const a of att) {
            summary[a.status]++;
            const t = byTerm[termOf(a.date_recorded)]; t.total++; if (a.status === "Present" || a.status === "Late") t.ok++;
        }
        const total = att.length;
        const hw = d.homework.filter(h => h.class_id === s.class_id);
        const hwCounts = { completed: 0, partial: 0, not_done: 0 };
        const hwItems = hw.map(h => {
            const c = d.homework_completions.find(x => x.homework_id === h.id && x.student_id === sid);
            const status = c ? c.status : "not_done";
            hwCounts[status]++;
            return { title: h.title, due_date: h.due_date, subject: L.subj(h.subject_id).name || "", teacher: L.teacherName(h.teacher_id), status };
        }).sort((a, b) => b.due_date.localeCompare(a.due_date));
        const beh = d.behavioral_entries.filter(b => b.student_id === sid).sort((a, b) => b.created_at.localeCompare(a.created_at));
        const behCounts = { positive: 0, negative: 0, note: 0 };
        for (const b of beh) if (b.entry_type in behCounts) behCounts[b.entry_type]++;
        const rate = (o) => o.total ? Math.round(o.ok / o.total * 1000) / 10 : null;
        return ok({
            student: { id: s.id, name: s.name, surname: s.surname, class_name: cls.class_name || "", grade_level: cls.grade_level || "", default_password: s.default_password || null, profile_picture_url: s.profile_picture_url || null },
            enrolled_subjects: enrolled,
            subject_grades: enrolled.map(es => {
                const sg = grades.filter(g => g.subject_id === es.subject_id).map(g => ({ assessment: g.assessment_name, grade_code: g.grade_code, percentage: g.percentage, date: g.date_taken, category: g.category, term: g.term, teacher: L.teacherName(g.created_by_teacher_id), comment: g.comment || "" }));
                const pcts = sg.map(g => g.percentage).filter(p => p != null);
                return { subject: es.subject, color: es.color, grade_count: sg.length, average: pcts.length ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length * 10) / 10 : null, grades: sg };
            }),
            attendance: {
                summary, total, rate: total ? Math.round((summary.Present + summary.Late) / total * 1000) / 10 : null,
                by_term: { term_1: { total: byTerm[1].total, rate: rate(byTerm[1]) }, term_2: { total: byTerm[2].total, rate: rate(byTerm[2]) } },
                records: att.slice(0, 50).map(a => ({ date: a.date_recorded, subject: L.subj(a.subject_id).name || "", status: a.status, comment: (a.comment || "").trim() || null, teacher: L.teacherName(a.recorded_by_teacher_id) })),
            },
            homework: { counts: hwCounts, items: hwItems },
            behavioral: { counts: behCounts, records: beh.map(b => ({ type: b.entry_type, subject: L.subj(b.subject_id).name || "", content: b.content, date: b.created_at.slice(0, 10), teacher: L.teacherName(b.teacher_id) })) },
        });
    });

    route("/admin/classes/credentials/", ({ me, q }) => {
        if (!adminOnly(me)) return err("Unauthorized", 401);
        const d = db();
        const cls = L.cls(q.get("class_id"));
        const lines = [`Class ${cls.class_name || ""} — demo credentials (sample data only)`, ""];
        for (const s of d.students.filter(x => x.class_id === cls.id).sort(byPerson)) lines.push(`${s.surname} ${s.name}\t${d.emails[s.id]}\t${s.default_password}`);
        return { status: 200, text: lines.join("\n"), contentType: "text/plain" };
    });

    route("/admin/dedupe-students/", ({ method }) => method === "GET"
        ? ok({ groups: [], total_duplicates: 0, deletable: 0 })
        : ok({ deleted: 0, groups: [], remaining: 0 }));

    route("/admin/csv-import/", ({ body }) => ok({
        created: 0,
        errors: (body.rows || []).map((_, i) => ({ row: i + 1, error: "Bulk import is turned off in the demo. Use Add Student / Add Teacher instead." })),
        credentials: [],
    }));

    /* ---------- Enrollments ---------- */
    const Y1011_RULES = {
        mandatory_class: ["Mathematics", "Physics", "Chemistry", "Biology", "ICT"],
        mandatory_level_split: ["English"],
        humanities_pick_2: ["History", "Geography"],
        pe_bucket_pick_1: ["PE", "Art"],
        languages_pick_1: ["Spanish", "French"],
    };

    route("/admin/enrollments/list/", ({ me }) => {
        if (!adminOnly(me)) return err("Unauthorized", 401);
        const d = db();
        const rows = d.students.map(s => {
            const cn = L.cls(s.class_id).class_name || "";
            const m = cn.match(/^(\d{1,2})/);
            return {
                id: s.id, name: s.name, surname: s.surname, class_id: s.class_id, class_name: cn, year: m ? parseInt(m[1], 10) : null,
                english_level: s.english_level ?? null,
                subjects: d.student_subjects.filter(e => e.student_id === s.id).map(e => ({ subject_id: e.subject_id, subject_name: L.subj(e.subject_id).name || "?", group_label: e.group_label || null })),
            };
        }).sort((a, b) => (a.class_name || "ZZ").localeCompare(b.class_name || "ZZ") || a.surname.localeCompare(b.surname));
        return ok({ rows });
    });

    route("/admin/enrollments/options/", ({ q }) => {
        const year = parseInt(q.get("year") || "0", 10);
        if (year === 10 || year === 11) return ok({ year, ...Y1011_RULES, english_levels: [1, 2, 3, 4, 5] });
        if (year === 12 || year === 13) return ok({ year, min_subjects: 3, all_choices: ["Chemistry", "Computer Science", "Economics", "English Literature", "Mathematics", "Physics", "Biology", "History"].sort(), ielts_auto: "IELTS auto-added if neither English nor English Literature is chosen" });
        return err(`Year ${year} not supported`);
    });

    route("/admin/enrollments/", ({ me, body }) => {
        if (!adminOnly(me)) return err("Unauthorized", 401);
        const d = db();
        const s = d.students.find(x => x.id === body.student_id);
        if (!s) return err("Student not found", 404);
        const year = L.cls(s.class_id).grade_level;
        let names = body.subjects || [];
        if (year <= 11) { names = [...Y1011_RULES.mandatory_class, ...Y1011_RULES.mandatory_level_split, ...names]; s.english_level = body.english_level ?? s.english_level; }
        const ids = names.map(n => (d.subjects.find(x => x.name === n) || {}).id).filter(Boolean);
        d.student_subjects = d.student_subjects.filter(e => e.student_id !== s.id);
        for (const subject_id of new Set(ids)) d.student_subjects.push({ student_id: s.id, subject_id, group_class_id: null, group_label: null, created_at: nowStamp() });
        save();
        return ok({ saved: true, subjects: names });
    });

    route("/admin/enrollments/bulk/", () => ok({ summary: { updated: 0, skipped: 0, errors: ["Bulk enrollment import is turned off in the demo."] } }));

    route("/admin/teacher-subjects/", ({ me, method, q, body }) => {
        if (!adminOnly(me)) return err("Unauthorized", 401);
        const d = db();
        if (method === "GET") {
            const tid = q.get("teacher_id");
            return ok({ rows: d.teacher_subjects.filter(r => !tid || r.teacher_id === tid) });
        }
        d.teacher_subjects = d.teacher_subjects.filter(r => r.teacher_id !== body.teacher_id);
        for (const subject_id of body.subject_ids || []) d.teacher_subjects.push({ teacher_id: body.teacher_id, subject_id, years_allowed: body.years_allowed || [] });
        save();
        return ok({ saved: true, count: (body.subject_ids || []).length });
    });

    route("/admin/seed-teacher-subjects/", ({ me }) => {
        if (!adminOnly(me)) return err("Unauthorized", 401);
        const d = db();
        const map = {};
        for (const s of d.schedule) {
            const k = `${s.teacher_id}|${s.subject_id}`;
            (map[k] ||= new Set()).add(String(L.cls(s.class_id).grade_level));
        }
        d.teacher_subjects = Object.entries(map).map(([k, years]) => { const [teacher_id, subject_id] = k.split("|"); return { teacher_id, subject_id, years_allowed: [...years].sort() }; });
        save();
        return ok({ rows: d.teacher_subjects.length, teachers: new Set(d.teacher_subjects.map(r => r.teacher_id)).size });
    });

    /* ---------- Timetable generator v2 ---------- */
    function demoLessons() {
        const d = db();
        const tByName = {};
        for (const t of d.teachers) tByName[t.id] = t;
        return d.teacher_assignments.filter(a => tByName[a.teacher_id]).map(a => {
            const subj = L.subj(a.subject_id), cls = L.cls(a.class_id);
            const firstSlot = d.schedule.find(s => s.teacher_id === a.teacher_id);
            return {
                lid: `${a.subject_id}_${a.class_id}`, class_id: a.class_id, subject_id: a.subject_id, teacher_id: a.teacher_id,
                room: firstSlot ? firstSlot.room : "", count: periodsPerWeek(subj.name, cls.grade_level),
                year: cls.grade_level, class_name: cls.class_name, class_names: [cls.class_name], subject_name: subj.name,
                teacher_name: L.teacherName(a.teacher_id), group_label: "",
            };
        });
    }

    route("/admin/timetable/v2/groups/preview/", () => {
        const d = db();
        const groups = d.teacher_assignments.map(a => {
            const cls = L.cls(a.class_id), subj = L.subj(a.subject_id);
            return { year: cls.grade_level, subject_name: subj.name, group_label: `${cls.class_name} ${subj.name}`, size: L.enrolled(a.subject_id, a.class_id).length };
        });
        return ok({ groups });
    });
    route("/admin/timetable/v2/groups/save/", () => ok({ updated: db().student_subjects.length }));
    route("/admin/timetable/v2/generate/", ({ body }) => {
        const res = solveTimetable(demoLessons(), Number(body.seed) || 1);
        return ok({
            placements: res.placements.map(p => ({ ...p, count: undefined })),
            unplaced: res.unplaced.map(u => ({ subject_name: u.subject_name, class_name: u.class_name, group_label: u.group_label, year: u.year, reason: "no free slot for teacher and class" })),
        });
    });
    route("/admin/timetable/v2/save/", ({ body }) => {
        const d = db();
        const placements = body.placements || [];
        d.schedule = placements.map(p => ({ id: nid("sl"), teacher_id: p.teacher_id, subject_id: p.subject_id, class_id: p.class_id, day_of_week: p.day, period: p.period, room: p.room || "" }));
        save();
        return ok({ inserted: d.schedule.length });
    });

    route("/timetable/seed-from-json/", () => err("PDF timetable import is turned off in the demo."));

    /* ================================================================
       fetch interception
       ================================================================ */

    const realFetch = window.fetch.bind(window);

    async function handle(url, init) {
        const u = new URL(url, location.href);
        let path = u.pathname.slice(u.pathname.indexOf("/api") + 4);
        if (!path.endsWith("/")) path += "/";
        const method = String((init && init.method) || "GET").toUpperCase();
        let body = {};
        if (init && typeof init.body === "string" && init.body) { try { body = JSON.parse(init.body); } catch { body = {}; } }

        const fn = routes[path];
        let result;
        if (path === "/login/") {
            result = fn({ method, body, q: u.searchParams });
        } else {
            const me = readToken(init && init.headers);
            if (!me || !findPerson(me.sub)) result = err("Unauthorized", 401);
            else if (!fn) result = ok({ message: "This feature is not available in the demo." });
            else {
                try { result = fn({ method, body, q: u.searchParams, me }); }
                catch (e) { console.error("[demo] handler error", path, e); result = err("Demo backend error: " + e.message, 500); }
            }
        }
        await new Promise(r => setTimeout(r, LATENCY_MS));
        if (result.text != null) return new Response(result.text, { status: result.status, headers: { "Content-Type": result.contentType || "text/plain" } });
        return new Response(JSON.stringify(result.body), { status: result.status, headers: { "Content-Type": "application/json" } });
    }

    window.fetch = function (input, init) {
        const url = typeof input === "string" ? input : (input && input.url) || String(input);
        if (isActive() && url.includes(API_MATCH)) return handle(url, init);
        if (isActive() && url.includes("raw.githubusercontent.com") && url.includes("timetable_seed")) {
            return Promise.resolve(new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }));
        }
        return realFetch(input, init);
    };

    /* ================================================================
       Public API + UI
       ================================================================ */

    const HOME = { student: "dashboard.html", teacher: "teacher.html", admin: "admin.html" };

    function start(role) {
        const id = DEMO_ACCOUNTS[role] || DEMO_ACCOUNTS.student;
        localStorage.setItem(FLAG_KEY, "1");
        db();
        const found = findPerson(id);
        localStorage.removeItem("admin_token");
        localStorage.removeItem("admin_user");
        localStorage.setItem("token", makeToken(id, found.role));
        localStorage.setItem("user", JSON.stringify(userPayload(id)));
        window.location.href = HOME[found.role];
    }

    function exit() {
        ["token", "user", "admin_token", "admin_user", FLAG_KEY].forEach(k => localStorage.removeItem(k));
        window.location.href = "demo.html";
    }

    function reset() {
        localStorage.removeItem(DB_KEY);
        _db = null;
        const u = JSON.parse(localStorage.getItem("user") || "null");
        start(u ? u.role : "student");
    }

    window.EDiaryDemo = { start, exit, reset, isActive };

    function injectStyles() {
        const css = `
        .demo-bar{position:fixed;left:0;right:0;margin:0 auto;width:max-content;bottom:14px;z-index:9999;display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:center;
            max-width:calc(100vw - 24px);padding:8px 12px;border-radius:14px;background:rgba(15,23,42,.92);color:#fff;font:500 13px/1.3 Inter,system-ui,sans-serif;
            box-shadow:0 10px 30px rgba(0,0,0,.25);backdrop-filter:blur(6px)}
        .demo-bar b{color:#93c5fd;font-weight:700;margin-right:2px}
        .demo-bar button{border:0;border-radius:8px;padding:5px 10px;font:600 12px Inter,system-ui,sans-serif;cursor:pointer;background:rgba(255,255,255,.12);color:#fff}
        .demo-bar button:hover{background:rgba(255,255,255,.22)}
        .demo-bar button.on{background:#2563eb}
        .demo-bar .demo-sep{width:1px;height:18px;background:rgba(255,255,255,.2)}
        .demo-bar .demo-x{background:transparent;padding:4px 6px;opacity:.7}
        .demo-bar.min{padding:6px 10px}.demo-bar.min > :not(.demo-keep){display:none}
        @media (max-width:640px){.demo-bar{font-size:12px;bottom:8px;gap:5px;padding:6px 8px;flex-wrap:nowrap}.demo-bar .demo-label,.demo-bar .demo-sep{display:none}.demo-bar button{padding:4px 7px;font-size:11px}}`;
        const s = document.createElement("style");
        s.textContent = css;
        document.head.appendChild(s);
    }

    function injectBar() {
        let user = null;
        try { user = JSON.parse(localStorage.getItem("user") || "null"); } catch { }
        const role = user ? user.role : "";
        const impersonating = !!localStorage.getItem("admin_token");
        const bar = document.createElement("div");
        bar.className = "demo-bar";
        bar.setAttribute("role", "region");
        bar.setAttribute("aria-label", "Demo mode");
        bar.innerHTML = `
            <span class="demo-keep"><b>DEMO</b><span class="demo-label"> Sample data, nothing is saved to a server.</span></span>
            <span class="demo-sep"></span>
            <span class="demo-label">View as:</span>
            <button data-role="student" class="${role === "student" && !impersonating ? "on" : ""}">Student</button>
            <button data-role="teacher" class="${role === "teacher" && !impersonating ? "on" : ""}">Teacher</button>
            <button data-role="admin" class="${role === "admin" ? "on" : ""}">Admin</button>
            <span class="demo-sep"></span>
            <button data-act="reset" title="Restore the original sample data">Reset data</button>
            <button data-act="exit" title="Leave the demo">Exit</button>
            <button data-act="min" class="demo-x demo-keep" title="Minimise" aria-label="Minimise demo bar">▾</button>`;
        bar.addEventListener("click", (e) => {
            const b = e.target.closest("button");
            if (!b) return;
            if (b.dataset.role) start(b.dataset.role);
            else if (b.dataset.act === "reset") reset();
            else if (b.dataset.act === "exit") exit();
            else if (b.dataset.act === "min") {
                bar.classList.toggle("min");
                b.textContent = bar.classList.contains("min") ? "▴" : "▾";
                try { sessionStorage.setItem("demoBarMin", bar.classList.contains("min") ? "1" : ""); } catch { }
            }
        });
        try { if (sessionStorage.getItem("demoBarMin")) { bar.classList.add("min"); bar.querySelector('[data-act="min"]').textContent = "▴"; } } catch { }
        document.body.appendChild(bar);
    }

    function injectLoginButtons() {
        const card = document.querySelector(".login-card");
        if (!card || document.getElementById("demoLogin")) return;
        const box = document.createElement("div");
        box.id = "demoLogin";
        box.innerHTML = `
            <div style="display:flex;align-items:center;gap:10px;margin:22px 0 12px;color:var(--text-lighter);font-size:.8rem;">
                <span style="flex:1;height:1px;background:var(--border-color)"></span>or try the demo<span style="flex:1;height:1px;background:var(--border-color)"></span>
            </div>
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;">
                ${["student", "teacher", "admin"].map(r => `<button type="button" data-demo-role="${r}" style="padding:10px 4px;border-radius:10px;border:1px solid var(--border-color);background:var(--bg-button);color:var(--primary-blue);font:600 .85rem Inter,system-ui,sans-serif;cursor:pointer;">${r.charAt(0).toUpperCase() + r.slice(1)}</button>`).join("")}
            </div>
            <p style="margin-top:10px;text-align:center;font-size:.75rem;color:var(--text-lighter);">No account needed. Runs on sample data in your browser.</p>`;
        box.addEventListener("click", (e) => {
            const b = e.target.closest("[data-demo-role]");
            if (b) start(b.dataset.demoRole);
        });
        card.appendChild(box);
    }

    function onReady(fn) {
        if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
        else fn();
    }

    const page = location.pathname.split("/").pop() || "index.html";
    const isLogin = page === "" || page === "index.html" || page === "index";
    if (isLogin) {
        const want = new URLSearchParams(location.search).get("demo");
        if (want) { start(want); return; }
        // Coming back to the login page ends the demo session
        if (isActive()) ["token", "user", "admin_token", "admin_user", FLAG_KEY].forEach(k => localStorage.removeItem(k));
        onReady(injectLoginButtons);
    } else if (isActive() && page !== "demo.html") {
        onReady(() => { injectStyles(); injectBar(); });
    }
})();
