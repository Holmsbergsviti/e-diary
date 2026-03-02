document.addEventListener("DOMContentLoaded", async () => {
    if (!requireAuth()) return;
    initNav();

    await Promise.all([loadAnnouncements(), loadRecentGrades()]);
});

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

        // Compute stats
        const avg = (grades.reduce((s, g) => s + g.value, 0) / grades.length).toFixed(2);
        document.getElementById("statAvg").textContent = avg;
        document.getElementById("statCount").textContent = data.grades.length;

        container.innerHTML = `
            <table>
                <thead>
                    <tr>
                        <th>Subject</th>
                        <th>Grade</th>
                        <th>Type</th>
                        <th>Date</th>
                        <th>Note</th>
                    </tr>
                </thead>
                <tbody>
                    ${grades.map(g => `
                        <tr>
                            <td>${escHtml(g.subject)}</td>
                            <td><span class="grade-badge grade-${g.value}">${g.value}</span></td>
                            <td>${escHtml(g.grade_type)}</td>
                            <td>${formatDate(g.date)}</td>
                            <td>${escHtml(g.description || "")}</td>
                        </tr>
                    `).join("")}
                </tbody>
            </table>
        `;
    } catch (err) {
        container.innerHTML = '<p class="empty-state">Failed to load grades.</p>';
    }
}
