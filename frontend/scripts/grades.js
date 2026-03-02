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

        // Stats
        const avg = (grades.reduce((s, g) => s + g.value, 0) / grades.length).toFixed(2);
        document.getElementById("statAvg").textContent = avg;
        document.getElementById("statTotal").textContent = grades.length;

        // Group by subject
        const bySubject = {};
        for (const g of grades) {
            if (!bySubject[g.subject]) bySubject[g.subject] = [];
            bySubject[g.subject].push(g);
        }

        let html = "";
        for (const [subject, items] of Object.entries(bySubject)) {
            const subAvg = (items.reduce((s, g) => s + g.value, 0) / items.length).toFixed(2);
            html += `
                <div class="card">
                    <div class="card-title">
                        ${escHtml(subject)}
                        <span style="font-weight:400;color:#6b7280;font-size:0.85rem;margin-left:8px;">avg: ${subAvg}</span>
                    </div>
                    <table>
                        <thead>
                            <tr>
                                <th>Grade</th>
                                <th>Type</th>
                                <th>Date</th>
                                <th>Description</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${items.map(g => `
                                <tr>
                                    <td><span class="grade-badge grade-${g.value}">${g.value}</span></td>
                                    <td>${escHtml(g.grade_type)}</td>
                                    <td>${formatDate(g.date)}</td>
                                    <td>${escHtml(g.description || "")}</td>
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
