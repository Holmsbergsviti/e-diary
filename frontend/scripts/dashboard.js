document.addEventListener("DOMContentLoaded", async () => {
    if (!requireAuth()) return;
    initNav();

    await Promise.all([loadAnnouncements(), loadRecentGrades()]);
});

// ---------- helper: letter mark -> CSS class ----------
function markClass(mark) {
    if (!mark) return "";
    const m = mark.toUpperCase().charAt(0);
    if (m === "A") return "grade-a";
    if (m === "B") return "grade-b";
    if (m === "C") return "grade-c";
    if (m === "D") return "grade-d";
    if (m === "E") return "grade-e";
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

        document.getElementById("statCount").textContent = data.grades.length;

        container.innerHTML = `
            <table>
                <thead>
                    <tr>
                        <th>Subject</th>
                        <th>Mark</th>
                    </tr>
                </thead>
                <tbody>
                    ${grades.map(g => `
                        <tr>
                            <td>${escHtml(g.subject)}</td>
                            <td><span class="grade-badge ${markClass(g.mark)}">${escHtml(g.mark || "\u2013")}</span></td>
                        </tr>
                    `).join("")}
                </tbody>
            </table>
        `;
    } catch (err) {
        container.innerHTML = '<p class="empty-state">Failed to load grades.</p>';
    }
}
