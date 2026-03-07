document.addEventListener("DOMContentLoaded", async () => {
    if (!requireAuth()) return;

    // Teachers have their own dashboard
    const user = getUser();
    if (user && user.role === "teacher") {
        window.location.href = "teacher.html";
        return;
    }

    initNav();
    await Promise.all([loadAnnouncements(), loadRecentGrades(), loadAttendance(), loadBehavioral()]);
});

// ---------- helper: grade code -> CSS class ----------
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

async function loadAnnouncements() {
    const container = document.getElementById("announcementsContainer");
    try {
        const res = await apiFetch("/announcements/");
        const data = await res.json();
        const items = data.announcements || [];
        if (items.length === 0) {
            container.innerHTML = '<p class="empty-state">No homework or tasks.</p>';
            return;
        }
        const today = new Date().toISOString().slice(0, 10);
        const COMP_BADGES = {
            completed: '<span class="hw-badge hw-badge-done">✅ Completed</span>',
            partial: '<span class="hw-badge hw-badge-partial">⚠️ Partial</span>',
            not_done: '<span class="hw-badge hw-badge-notdone">❌ Not done</span>',
        };
        container.innerHTML = items.map(a => {
            const isPast = a.due_date && a.due_date < today;
            const dueLbl = a.due_date ? formatDate(a.due_date) : "";
            const badge = a.completion_status ? COMP_BADGES[a.completion_status] || "" : "";
            return `
            <div class="announcement${isPast ? ' hw-past' : ''}">
                <div class="announcement-title">${escHtml(a.title)}${badge ? ' ' + badge : ''}</div>
                <div class="announcement-meta">
                    ${a.subject ? escHtml(a.subject) : ""}${a.author ? " · " + escHtml(a.author) : ""}${dueLbl ? " · Due: " + dueLbl : ""}
                </div>
                ${a.body ? `<div class="announcement-body">${escHtml(a.body)}</div>` : ""}
            </div>`;
        }).join("");
    } catch (err) {
        container.innerHTML = '<p class="empty-state">Failed to load announcements.</p>';
    }
}

async function loadRecentGrades() {
    const container = document.getElementById("recentGradesContainer");
    try {
        const res = await apiFetch("/grades/");
        const data = await res.json();
        const now = new Date();
        const weekAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6); // 7 days including today
        let grades = (data.grades || []).filter(g => {
            if (!g.date) return false;
            const d = new Date(g.date);
            return d >= weekAgo && d <= now;
        });
        grades = grades.slice(0, 7);

        if (grades.length === 0) {
            container.innerHTML = '<p class="empty-state">No grades recorded in the past week.</p>';
            return;
        }

        container.innerHTML = `
            <table>
                <thead>
                    <tr>
                        <th>Subject</th>
                        <th>Assessment</th>
                        <th>Grade</th>
                    </tr>
                </thead>
                <tbody>
                    ${grades.map(g => `
                        <tr>
                            <td>${escHtml(g.subject)}</td>
                            <td>${escHtml(g.assessment || "\u2013")}</td>
                            <td><span class="grade-badge ${gradeClass(g.grade_code)}">${escHtml(g.grade_code || "\u2013")}</span></td>
                        </tr>
                    `).join("")}
                </tbody>
            </table>
        `;
    } catch (err) {
        container.innerHTML = '<p class="empty-state">Failed to load grades.</p>';
    }
}

/* ---------- Attendance ---------- */
const ATT_ICONS = { Present: "✅", Late: "⏰", Absent: "❌", Excused: "📋" };

async function loadAttendance() {
    const container = document.getElementById("attendanceContainer");
    try {
        const res = await apiFetch("/attendance/");
        const data = await res.json();
        const records = (data.attendance || []).slice(0, 15);

        if (records.length === 0) {
            container.innerHTML = '<p class="empty-state">No attendance records.</p>';
            return;
        }

        container.innerHTML = `
            <table>
                <thead>
                    <tr>
                        <th>Date</th>
                        <th>Subject</th>
                        <th>Status</th>
                        <th>Comment</th>
                    </tr>
                </thead>
                <tbody>
                    ${records.map(r => `
                        <tr class="att-row att-${r.status.toLowerCase()}">
                            <td>${formatDate(r.date_recorded)}</td>
                            <td>${escHtml(r.subject || "–")}</td>
                            <td>${ATT_ICONS[r.status] || ""} ${escHtml(r.status)}</td>
                            <td>${r.comment ? escHtml(r.comment) : '<span style="color:#9ca3af;">—</span>'}</td>
                        </tr>
                    `).join("")}
                </tbody>
            </table>
        `;
    } catch (err) {
        container.innerHTML = '<p class="empty-state">Failed to load attendance.</p>';
    }
}

const BEH_TYPE_ICONS = { positive: "👍", negative: "👎", note: "📝" };
const BEH_SEVERITY_LABELS = { low: "Low", medium: "Medium", high: "High" };

async function loadBehavioral() {
    const container = document.getElementById("behavioralContainer");
    try {
        const res = await apiFetch("/behavioral/");
        const data = await res.json();
        const entries = data.entries || [];

        if (entries.length === 0) {
            container.innerHTML = '<p class="empty-state">No behavioral notes.</p>';
            return;
        }

        container.innerHTML = entries.map(e => {
            const icon = BEH_TYPE_ICONS[e.entry_type] || "📝";
            const sevClass = e.severity === "high" ? "beh-high" : e.severity === "medium" ? "beh-medium" : "beh-low";
            const date = e.created_at ? formatDate(e.created_at.slice(0, 10)) : "";
            return `
            <div class="beh-item ${sevClass}">
                <div class="beh-item-main">
                    <div class="beh-item-title">${icon} ${escHtml(e.entry_type || "")}</div>
                    <div class="beh-item-meta">
                        ${e.teacher ? "By " + escHtml(e.teacher) : ""}${e.subject ? " · " + escHtml(e.subject) : ""}${date ? " · " + date : ""}
                    </div>
                    <div class="beh-item-content">${escHtml(e.content)}</div>
                </div>
            </div>`;
        }).join("");
    } catch (err) {
        container.innerHTML = '<p class="empty-state">Failed to load behavioral notes.</p>';
    }
}

// ---------- Card collapse functionality ----------
document.addEventListener("DOMContentLoaded", () => {
    // Initialize card collapse buttons
    document.querySelectorAll(".card-collapse-btn").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.preventDefault();
            const card = btn.closest(".card");
            const cardId = card.getAttribute("data-card-id");
            
            card.classList.toggle("card-collapsed");
            
            // Save state to localStorage
            if (card.classList.contains("card-collapsed")) {
                // Add to collapsed list
                let collapsed = JSON.parse(localStorage.getItem("collapsedCards") || "[]");
                if (!collapsed.includes(cardId)) {
                    collapsed.push(cardId);
                }
                localStorage.setItem("collapsedCards", JSON.stringify(collapsed));
            } else {
                // Remove from collapsed list
                let collapsed = JSON.parse(localStorage.getItem("collapsedCards") || "[]");
                collapsed = collapsed.filter(id => id !== cardId);
                localStorage.setItem("collapsedCards", JSON.stringify(collapsed));
            }
        });
    });
    
    // Restore collapsed state from localStorage
    const collapsedCards = JSON.parse(localStorage.getItem("collapsedCards") || "[]");
    collapsedCards.forEach(cardId => {
        const card = document.querySelector(`.card[data-card-id="${cardId}"]`);
        if (card) {
            card.classList.add("card-collapsed");
        }
    });
});
