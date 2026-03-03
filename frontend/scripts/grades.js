// ---------- helper: grade code → CSS class ----------
function gradeClass(code) {
    if (!code) return "";
    const c = code.toUpperCase().replace("*", "");
    if (c === "A") return "grade-a";
    if (c === "B") return "grade-b";
    if (c === "C") return "grade-c";
    if (c === "D") return "grade-d";
    if (c === "E") return "grade-e";
    return "grade-u";
}

document.addEventListener("DOMContentLoaded", async () => {
    if (!requireAuth()) return;
    initNav();
    await loadGrades();
});

async function loadGrades() {
    const container = document.getElementById("gradesContainer");
    try {
        const res = await apiFetch("/grades/");
        const data = await res.json();
        const grades = data.grades || [];

        if (grades.length === 0) {
            container.innerHTML = '<p class="empty-state">No grades recorded yet.</p>';
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
    } catch (err) {
        container.innerHTML = '<p class="empty-state">Failed to load grades.</p>';
    }
}
