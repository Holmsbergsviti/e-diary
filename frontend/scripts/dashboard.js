document.addEventListener("DOMContentLoaded", async () => {
    if (!requireAuth()) return;
    initNav();

    await Promise.all([loadAnnouncements(), loadRecentGrades()]);
});

// ---------- helper: percentage → CSS class ----------
function gradeClass(pct) {
    if (pct == null) return "";
    if (pct >= 80) return "grade-excellent";
    if (pct >= 60) return "grade-good";
    if (pct >= 50) return "grade-satisfactory";
    if (pct >= 30) return "grade-poor";
    return "grade-fail";
}

async function loadAnnouncements() {
    const container = document.getElementById("announcementsContainer");
    try {
        const res = await apiFetch("/announcements/");
        const data = await res.json();
        const items = data.announcements || [];
        if (items.length === 0) {
            container.innerHTML = '<p class="empty-state">No announcements.</p>';
            return;
        }
        container.innerHTML = items.map(a => `
            <div class="announcement">
                <div class="announcement-title">${escHtml(a.title)}</div>
                <div class="announcement-meta">${formatDate(a.created_at)}${a.author ? " · " + escHtml(a.author) : ""}</div>
                ${a.body ? `<div class="announcement-body">${escHtml(a.body)}</div>` : ""}
            </div>
        `).join("");
    } catch (err) {
        container.innerHTML = '<p class="empty-state">Failed to load announcements.</p>';
    }
}

async function loadRecentGrades() {
    const container = document.getElementById("recentGradesContainer");
    try {
        const res = await apiFetch("/grades/");
        const data = await res.json();
        const grades = (data.grades || []).slice(0, 10);

        if (grades.length === 0) {
            container.innerHTML = '<p class="empty-state">No grades recorded yet.</p>';
            return;
        }

        // Compute stats (only grades with a percentage)
        const withPct = grades.filter(g => g.percentage != null);
        const avg = withPct.length
            ? (withPct.reduce((s, g) => s + Number(g.percentage), 0) / withPct.length).toFixed(1)
            : "–";
        document.getElementById("statAvg").textContent = avg + (withPct.length ? "%" : "");
        document.getElementById("statCount").textContent = data.grades.length;

        container.innerHTML = `
            <table>
                <thead>
                    <tr>
                        <th>Subject</th>
                        <th>Grade</th>
                        <th>Assessment</th>
                        <th>Date</th>
                    </tr>
                </thead>
                <tbody>
                    ${grades.map(g => `
                        <tr>
                            <td>${escHtml(g.subject)}</td>
                            <td><span class="grade-badge ${gradeClass(g.percentage)}">${g.percentage != null ? g.percentage + "%" : escHtml(g.grade_code || "–")}</span></td>
                            <td>${escHtml(g.assessment_name)}</td>
                            <td>${formatDate(g.date)}</td>
                        </tr>
                    `).join("")}
                </tbody>
            </table>
        `;
    } catch (err) {
        container.innerHTML = '<p class="empty-state">Failed to load grades.</p>';
    }
}
