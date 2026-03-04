document.addEventListener("DOMContentLoaded", async () => {
    if (!requireAuth()) return;

    // Teachers have their own dashboard
    const user = getUser();
    if (user && user.role === "teacher") {
        window.location.href = "teacher.html";
        return;
    }

    initNav();
    await Promise.all([loadAnnouncements(), loadRecentGrades()]);
});

// ---------- helper: grade code -> CSS class ----------
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
                <div class="announcement-meta">${formatDate(a.created_at)}${a.author ? " \u00b7 " + escHtml(a.author) : ""}</div>
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

        container.innerHTML = `
            <table>
                <thead>
                    <tr>
                        <th>Subject</th>
                        <th>Assessment</th>
                        <th>Grade</th>
                        <th>Date</th>
                    </tr>
                </thead>
                <tbody>
                    ${grades.map(g => `
                        <tr>
                            <td>${escHtml(g.subject)}</td>
                            <td>${escHtml(g.assessment || "\u2013")}</td>
                            <td><span class="grade-badge ${gradeClass(g.grade_code)}">${escHtml(g.grade_code || "\u2013")}</span></td>
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
