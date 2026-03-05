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
let activeTerm = null;

document.addEventListener("DOMContentLoaded", async () => {
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
});

async function loadGrades() {
    const container = document.getElementById("gradesContainer");
    try {
        const res = await apiFetch("/grades/");
        const data = await res.json();
        allGrades = data.grades || [];

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

    if (grades.length === 0) {
        container.innerHTML = '<p class="empty-state">No grades recorded yet.</p>';
        document.getElementById("statTotal").textContent = "0";
        return;
    }

    const bySubject = {};
    for (const g of grades) {
        const key = g.subject;
        if (!bySubject[key]) bySubject[key] = { items: [], color: g.subject_color || "#607D8B" };
        bySubject[key].items.push(g);
    }

    const subjectCount = Object.keys(bySubject).length;
    document.getElementById("statTotal").textContent = subjectCount;

    let html = '<div class="grades-grid">';
    for (const [subject, { items, color }] of Object.entries(bySubject)) {
        // Compute average
        const pts = items.map(g => GRADE_POINTS[g.grade_code]).filter(v => v != null);
        const avg = pts.length ? (pts.reduce((a, b) => a + b, 0) / pts.length) : null;
        const avgLabel = avg != null ? avg.toFixed(1) : "–";

        // Compute average percentage
        const pcts = items.map(g => g.percentage).filter(v => v != null);
        const avgPct = pcts.length ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : null;

        html += `
        <div class="grade-subject-card">
            <div class="grade-subject-header" style="border-left: 4px solid ${color};">
                <div class="grade-subject-name">${escHtml(subject)}</div>
                <div class="grade-subject-summary">
                    <span class="grade-subject-avg">${avgLabel} pts</span>
                    ${avgPct != null ? `<span class="grade-subject-pct">${avgPct}%</span>` : ""}
                    <span class="grade-subject-count">${items.length} grade${items.length !== 1 ? "s" : ""}</span>
                </div>
            </div>
            <div class="grade-items-list">
                ${items.map(g => `
                    <div class="grade-item-row">
                        <div class="grade-item-badge">
                            <span class="grade-badge ${gradeClass(g.grade_code)}">${escHtml(g.grade_code || "–")}</span>
                        </div>
                        <div class="grade-item-info">
                            <div class="grade-item-name">${escHtml(g.assessment || "–")}</div>
                            <div class="grade-item-meta">
                                ${catLabel(g.category)}
                                <span class="grade-item-date">${formatDate(g.date)}</span>
                            </div>
                        </div>
                        <div class="grade-item-pct">${g.percentage != null ? g.percentage + "%" : ""}</div>
                    </div>
                `).join("")}
            </div>
        </div>`;
    }
    html += '</div>';
    container.innerHTML = html;
}
