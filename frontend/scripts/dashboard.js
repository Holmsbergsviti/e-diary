/* ================================================================
   dashboard.js – Student dashboard
   ================================================================ */

function isoDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

/* ---- Bootstrap ---- */
async function initDashboard() {
    if (!requireAuth()) return;
    const user = getUser();
    if (user && user.role === "teacher") { window.location.href = "teacher.html"; return; }
    initNav();
    initCardCollapse();

    try {
        await Promise.all([
            loadAnnouncements(),
            loadRecentGrades(),
            loadBehavioral()
        ]);
    } catch (err) { console.error("Error loading dashboard data:", err); }
}

document.addEventListener("DOMContentLoaded", () => {
    initDashboard().catch(err => console.error("Dashboard init error:", err));
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
        const today = isoDate(new Date());
        const COMP_BADGES = {
            completed: '<span class="hw-badge hw-badge-done">✅ Completed</span>',
            partial: '<span class="hw-badge hw-badge-partial">⚠️ Partial</span>',
            not_done: '<span class="hw-badge hw-badge-notdone">❌ Not done</span>',
        };

        const upcoming = items.filter(a => !a.due_date || a.due_date >= today);
        const past = items.filter(a => a.due_date && a.due_date < today);
        
        // Calculate completion percentage
        const totalTasks = items.length;
        const completedTasks = items.filter(a => a.completion_status === 'completed').length;
        const completionPercentage = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
        
        const progressClass = completionPercentage >= 80 ? 'success' : 
                             completionPercentage >= 60 ? 'warning' : 'danger';

        function renderItem(a) {
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
        }

        let html = '';
        if (totalTasks > 0) {
            html += `
                <div class="homework-progress" style="display: flex; align-items: center; gap: 16px; margin-bottom: 20px; padding: 16px; background: var(--bg-card); border-radius: 12px; border: 1px solid rgba(var(--primary-blue-rgb), 0.1);">
                    <div class="circular-progress ${progressClass}" style="--progress: ${completionPercentage * 3.6}deg;">
                        <div class="progress-text">${completionPercentage}%</div>
                    </div>
                    <div>
                        <div style="font-weight: 600; color: var(--text-dark); margin-bottom: 4px;">Homework Completion</div>
                        <div style="color: var(--text-muted); font-size: 0.9rem;">${completedTasks} of ${totalTasks} tasks completed</div>
                    </div>
                </div>
            `;
        }
        if (upcoming.length > 0) {
            html += upcoming.map(renderItem).join("");
        } else {
            html += '<p class="empty-state">No upcoming homework or tasks.</p>';
        }

        if (past.length > 0) {
            html += `<div class="hw-past-section">
                <button class="hw-past-toggle" onclick="this.parentElement.classList.toggle('hw-past-open'); this.textContent = this.parentElement.classList.contains('hw-past-open') ? '▲ Hide past homework (${past.length})' : '▼ Show past homework (${past.length})'">
                    ▼ Show past homework (${past.length})
                </button>
                <div class="hw-past-list">
                    ${past.map(renderItem).join("")}
                </div>
            </div>`;
        }

        container.innerHTML = html;
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
function initCardCollapse() {
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
}
