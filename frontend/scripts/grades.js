// ---------- helper: letter mark → CSS class ----------
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

        document.getElementById("statTotal").textContent = grades.length;

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
                                <th>Mark</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${items.map(g => `
                                <tr>
                                    <td><span class="grade-badge ${markClass(g.mark)}">${escHtml(g.mark || "\u2013")}</span></td>
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
