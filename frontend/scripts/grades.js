// ---------- helper: grade code → CSS class ----------
function gradeClass(code) {
    if (!code) return "";
    const c = code.toUpperCase().replace("*", "").replace("+", "").replace("-", "");
    if (c === "A") return "grade-a";
    if (c === "B") return "grade-b";
    if (c === "C") return "grade-c";
    if (c === "D") return "grade-d";
    if (c === "E") return "grade-e";
    return "grade-u";
}

const GRADE_POINTS = {"A*":9,"A":8,"A-":7,"B+":6.5,"B":6,"B-":5.5,"C+":5.5,"C":5,"C-":4.5,"D+":4.5,"D":4,"D-":3.5,"E+":3.5,"E":3,"E-":2.5,"U":1};

function currentTerm() {
    const m = new Date().getMonth() + 1;
    return (m >= 9 && m <= 12) ? 1 : 2;
}

function catLabel(cat) {
    const cls = `cat-${cat || "other"}`;
    const name = (cat || "other").charAt(0).toUpperCase() + (cat || "other").slice(1);
    return `<span class="cat-label ${cls}">${escHtml(name)}</span>`;
}

let allGrades = [];
let enrolledSubjects = [];
let activeTerm = null;
let _teacherCache = {};  // subject -> teacher object (first encountered)

async function initGrades() {
    if (!requireAuth()) return;
    initNav();

    activeTerm = currentTerm();

    document.querySelectorAll("#termFilter .term-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const t = btn.dataset.term;
            activeTerm = t === "" ? null : parseInt(t);
            document.querySelectorAll("#termFilter .term-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            renderGrades();
        });
    });

    await loadGrades();
}

// Initialize on DOMContentLoaded
document.addEventListener("DOMContentLoaded", () => {
    initGrades().catch(err => console.error("Grades init error:", err));
});

async function loadGrades() {
    const container = document.getElementById("gradesContainer");
    try {
        const res = await apiFetch("/grades/");
        const data = await res.json();
        allGrades = data.grades || [];
        enrolledSubjects = data.enrolled_subjects || [];

        // Build teacher cache: per subject, pick the first teacher we see
        _teacherCache = {};
        for (const g of allGrades) {
            if (g.teacher && g.teacher.full_name && g.subject && !_teacherCache[g.subject]) {
                _teacherCache[g.subject] = g.teacher;
            }
        }

        document.querySelectorAll("#termFilter .term-btn").forEach(btn => {
            const t = btn.dataset.term;
            const val = t === "" ? null : parseInt(t);
            btn.classList.toggle("active", val === activeTerm);
        });

        renderGrades();
    } catch (err) {
        container.innerHTML = '<p class="empty-state">Failed to load grades.</p>';
    }
}

function renderGrades() {
    const container = document.getElementById("gradesContainer");
    const grades = activeTerm ? allGrades.filter(g => g.term === activeTerm) : allGrades;

    // Group grades by subject
    const bySubject = {};
    for (const g of grades) {
        if (!bySubject[g.subject]) bySubject[g.subject] = { grades: [], color: g.subject_color || "#607D8B" };
        bySubject[g.subject].grades.push(g);
    }

    // Also include enrolled subjects with no grades
    for (const s of enrolledSubjects) {
        if (!bySubject[s.subject]) {
            bySubject[s.subject] = { grades: [], color: s.subject_color || "#607D8B" };
        }
    }

    const subjectNames = Object.keys(bySubject).sort();
    const subjectCount = subjectNames.length;
    document.getElementById("statTotal").textContent = subjectCount;

    if (subjectCount === 0) {
        container.innerHTML = '<p class="empty-state">No subjects enrolled yet.</p>';
        return;
    }

    let html = "";
    for (const subject of subjectNames) {
        const { grades: items, color } = bySubject[subject];
        const colorDot = `<span class="subject-color-dot" style="background:${color};display:inline-block;width:12px;height:12px;border-radius:50%;margin-right:6px;vertical-align:middle;"></span>`;
        const teacher = _teacherCache[subject];

        if (items.length === 0) {
            html += `
                <div class="card">
                    <div class="card-title grade-card-title">${colorDot}${escHtml(subject)}<span class="grade-teacher-slot" data-subject="${escHtml(subject)}"></span></div>
                    <p class="empty-state">No grades recorded yet.</p>
                </div>
            `;
        } else {
            html += `
                <div class="card">
                    <div class="card-title grade-card-title">${colorDot}${escHtml(subject)}<span class="grade-teacher-slot" data-subject="${escHtml(subject)}"></span></div>
                    <table>
                        <thead>
                            <tr>
                                <th>Assessment</th>
                                <th>Grade</th>
                                <th>%</th>
                                <th>Date</th>
                                <th>Comment</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${items.map(g => `
                                <tr>
                                    <td>${escHtml(g.assessment || "\u2013")}</td>
                                    <td><span class="grade-badge ${gradeClass(g.grade_code)}">${escHtml(g.grade_code || "\u2013")}</span></td>
                                    <td class="${g.percentage != null ? '' : 'cell-empty'}">${g.percentage != null ? g.percentage + "%" : "\u2013"}</td>
                                    <td>${formatDate(g.date)}</td>
                                    <td class="${g.comment ? '' : 'cell-empty'}">${g.comment ? escHtml(g.comment) : "\u2013"}</td>
                                </tr>
                            `).join("")}
                        </tbody>
                    </table>
                </div>
            `;
        }
    }
    container.innerHTML = html;

    // Attach teacher badges (must do after innerHTML since they are DOM elements)
    document.querySelectorAll(".grade-teacher-slot").forEach(slot => {
        const subj = slot.dataset.subject;
        const teacher = _teacherCache[subj];
        if (teacher && teacher.full_name) {
            slot.appendChild(createTeacherBadge(teacher));
        }
    });
}
