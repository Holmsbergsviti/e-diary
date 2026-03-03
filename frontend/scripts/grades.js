// ---------- helper: percentage → CSS class ----------
function gradeClass(pct) {
    if (pct == null) return "";
    if (pct >= 80) return "grade-excellent";
    if (pct >= 60) return "grade-good";
    if (pct >= 50) return "grade-satisfactory";
    if (pct >= 30) return "grade-poor";
    return "grade-fail";
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

        // Stats (only grades with a percentage)
        const withPct = grades.filter(g => g.percentage != null);
        const avg = withPct.length
            ? (withPct.reduce((s, g) => s + Number(g.percentage), 0) / withPct.length).toFixed(1)
            : "\u2013";
        document.getElementById("statAvg").textContent = avg + (withPct.length ? "%" : "");
        document.getElementById("statTotal").textContent = grades.length;

        // Group by subject
        const bySubject = {};
        for (const g of grades) {
            if (!bySubject[g.subject]) bySubject[g.subject] = [];
            bySubject[g.subject].push(g);
        }

        let html = "";
        for (const [subject, items] of Object.entries(bySubject)) {
            const subWithPct = items.filter(g => g.percentage != null);
            const subAvg = subWithPct.length
                ? (subWithPct.reduce((s, g) => s + Number(g.percentage), 0) / subWithPct.length).toFixed(1)
                : "\u2013";
            html += `
                <div class="card">
                    <div class="card-title">
                        ${escHtml(subject)}
                        <span style="font-weight:400;color:#6b7280;font-size:0.85rem;margin-left:8px;">avg: ${subAvg}${subWithPct.length ? "%" : ""}</span>
                    </div>
                    <table>
                        <thead>
                            <tr>
                                <th>Grade</th>
                                <th>Assessment</th>
                                <th>Date</th>
                                <th>Code</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${items.map(g => `
                                <tr>
                                    <td><span class="grade-badge ${gradeClass(g.percentage)}">${g.percentage != null ? g.percentage + "%" : "\u2013"}</span></td>
                                    <td>${escHtml(g.assessment_name)}</td>
                                    <td>${formatDate(g.date)}</td>
                                    <td>${escHtml(g.grade_code || "")}</td>
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
