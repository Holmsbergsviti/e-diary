// Ensure initialization happens when DOM is ready
async function initDashboard() {
    if (!requireAuth()) return;

    // Teachers have their own dashboard
    const user = getUser();
    if (user && user.role === "teacher") {
        window.location.href = "teacher.html";
        return;
    }

    // Call initNav FIRST to set up navigation, logout, and inject grades/marks tab
    initNav();
    
    // Initialize card collapse functionality
    initCardCollapse();
    
    // Load all data - use Promise.all to load in parallel
    try {
        await Promise.all([
            loadTodaySchedule(),
            loadUpcomingEvents(),
            loadAnnouncements(),
            loadRecentGrades(),
            loadAttendance(),
            loadBehavioral()
        ]);
    } catch (err) {
        console.error("Error loading dashboard data:", err);
    }
}

// Initialize immediately with slight delay to ensure sidebar is rendered
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

/* ---------- Today's Schedule ---------- */
const DASH_PERIOD_TIMES = [
    "08:30–09:10", "09:15–10:00", "10:15–10:55", "11:00–11:45",
    "11:50–12:30", "13:15–13:55", "14:00–14:45", "14:50–15:30",
];

function _dashIsoDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

async function loadTodaySchedule() {
    const container = document.getElementById("todayScheduleContainer");
    if (!container) return;
    try {
        const res = await apiFetch("/schedule/");
        if (!res.ok) { container.innerHTML = '<p class="empty-state">Could not load schedule.</p>'; return; }
        const data = await res.json();
        const slots = data.schedule || [];

        if (slots.length === 0) {
            container.innerHTML = '<p class="empty-state">No schedule available.</p>';
            return;
        }

        const now = new Date();
        let dow = now.getDay(); // 0=Sun, 1=Mon … 6=Sat
        if (dow === 0 || dow === 6) {
            container.innerHTML = '<p class="empty-state">No school today – enjoy your weekend! 🎉</p>';
            return;
        }

        const todayStr = _dashIsoDate(now);

        // Build today's slots sorted by period
        const todaySlots = slots.filter(s => s.day_of_week === dow).sort((a, b) => a.period - b.period);

        if (todaySlots.length === 0) {
            container.innerHTML = '<p class="empty-state">No classes today.</p>';
            return;
        }

        // Determine current period for highlighting
        const hour = now.getHours();
        const minute = now.getMinutes();
        const timeMin = hour * 60 + minute;
        const periodTimesMin = [
            { start: 8*60+30, end: 9*60+10 },
            { start: 9*60+15, end: 10*60 },
            { start: 10*60+15, end: 10*60+55 },
            { start: 11*60, end: 11*60+45 },
            { start: 11*60+50, end: 12*60+30 },
            { start: 13*60+15, end: 13*60+55 },
            { start: 14*60, end: 14*60+45 },
            { start: 14*60+50, end: 15*60+30 },
        ];
        let currentPeriod = null;
        for (let i = 0; i < periodTimesMin.length; i++) {
            if (timeMin >= periodTimesMin[i].start && timeMin < periodTimesMin[i].end) {
                currentPeriod = i + 1;
                break;
            }
        }

        let html = '<div class="today-schedule-list">';
        for (const slot of todaySlots) {
            const time = DASH_PERIOD_TIMES[slot.period - 1] || `Period ${slot.period}`;
            const isCurrent = currentPeriod === slot.period;
            const room = slot.room ? `Room ${escHtml(slot.room)}` : "";
            html += `<div class="today-schedule-item${isCurrent ? ' today-schedule-current' : ''}">
                <div class="today-schedule-period">${slot.period}</div>
                <div class="today-schedule-info">
                    <strong>${escHtml(slot.subject)}</strong>
                    <span class="today-schedule-meta">${time}${room ? ' · ' + room : ''}</span>
                </div>
                ${isCurrent ? '<span class="today-schedule-now">NOW</span>' : ''}
            </div>`;
        }
        html += '</div>';
        container.innerHTML = html;
    } catch (err) {
        container.innerHTML = '<p class="empty-state">Could not load schedule.</p>';
    }
}

async function loadUpcomingEvents() {
    const container = document.getElementById("upcomingEventsContainer");
    try {
        const res = await apiFetch("/events/");
        if (!res.ok) { container.innerHTML = '<p class="empty-state">Could not load events.</p>'; return; }
        const data = await res.json();
        const events = data.events || [];
        const holidays = data.holidays || [];
        const today = _dashIsoDate(new Date());

        // Combine upcoming events and holidays into one list
        const items = [];
        for (const ev of events) {
            const endDate = ev.event_end_date || ev.event_date;
            if (endDate >= today) {
                items.push({ type: "event", title: ev.title, description: ev.description, start: ev.event_date, end: ev.event_end_date });
            }
        }
        for (const h of holidays) {
            const endDate = h.end_date || h.start_date;
            if (endDate >= today) {
                items.push({ type: "holiday", title: h.name, start: h.start_date, end: h.end_date });
            }
        }
        items.sort((a, b) => a.start.localeCompare(b.start));

        if (items.length === 0) {
            container.innerHTML = '<p class="empty-state">No upcoming events or holidays.</p>';
            return;
        }

        container.innerHTML = items.slice(0, 10).map(item => {
            const icon = item.type === "holiday" ? "🏖" : "🎉";
            const badgeCls = item.type === "holiday" ? "schedule-holiday-badge" : "schedule-event-badge";
            const dateRange = item.end && item.end !== item.start
                ? `${formatDate(item.start)} – ${formatDate(item.end)}` : formatDate(item.start);
            return `<div class="dashboard-event-item">
                <span class="dashboard-event-icon">${icon}</span>
                <div class="dashboard-event-info">
                    <strong>${escHtml(item.title)}</strong>
                    <span class="${badgeCls}">${dateRange}</span>
                    ${item.description ? `<p style="margin:2px 0 0;font-size:0.84rem;color:var(--text-secondary)">${escHtml(item.description)}</p>` : ""}
                </div>
            </div>`;
        }).join("");
    } catch (err) {
        container.innerHTML = '<p class="empty-state">Could not load events.</p>';
    }
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
        const today = _dashIsoDate(new Date());
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
