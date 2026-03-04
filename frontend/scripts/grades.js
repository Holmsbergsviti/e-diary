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

function currentTerm() {
    const m = new Date().getMonth() + 1;
    return (m >= 9 && m <= 12) ? 1 : 2;
}

let allGrades = [];
let activeTerm = null;

document.addEventListener("DOMContentLoaded", async () => {
    if (!requireAuth()) return;
    initNav();

    // Set initial active term
    activeTerm = currentTerm();

    // Wire up term filter buttons
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

        // Activate the correct term button
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

    // Count unique subjects
    const subjectSet = new Set(grades.map(g => g.subject));
    document.getElementById("statTotal").textContent = subjectSet.size;

    // Group by subject
    const bySubject = {};
    for (const g of grades) {
        if (!bySubject[g.subject]) bySubject[g.subject] = [];
        bySubject[g.subject].push(g);
    }

    let html = "";
    for (const [subject, items] of Object.entries(bySubject)) {
        html += `
            <div class="card">
                <div class="card-title">${escHtml(subject)}</div>
                <table>
                    <thead>
                        <tr>
                            <th>Assessment</th>
                            <th>Grade</th>
                            <th>%</th>
                            <th>Date</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${items.map(g => `
                            <tr>
                                <td>${escHtml(g.assessment || "\u2013")}</td>
                                <td><span class="grade-badge ${gradeClass(g.grade_code)}">${escHtml(g.grade_code || "\u2013")}</span></td>
                                <td>${g.percentage != null ? g.percentage + "%" : "\u2013"}</td>
                                <td>${formatDate(g.date)}</td>
                            </tr>
                        `).join("")}
                    </tbody>
                </table>
            </div>
        `;
    }
    container.innerHTML = html;
}
