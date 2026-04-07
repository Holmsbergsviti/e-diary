/* ================================================================
   dashboard.js – Student dashboard with full weekly schedule
   ================================================================ */

/* ---- Schedule constants ---- */
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const PERIOD_TIMES = [
    "08:30–09:10", "09:15–10:00", "10:15–10:55", "11:00–11:45",
    "11:50–12:30", "13:15–13:55", "14:00–14:45", "14:50–15:30",
];
const SCHEDULE_ROWS = [
    { type: "period", period: 1 },
    { type: "period", period: 2 },
    { type: "break",  label: "🥪 Snack Break", time: "10:00–10:10" },
    { type: "period", period: 3 },
    { type: "period", period: 4 },
    { type: "period", period: 5 },
    { type: "break",  label: "🍽 Lunch Break", time: "12:30–13:10" },
    { type: "period", period: 6 },
    { type: "period", period: 7 },
    { type: "period", period: 8 },
];

/* ---- Schedule state ---- */
let dashScheduleSlots = [];
let dashStudyHall = [];
let dashWeekOffset = 0;
let dashAttendance = [];
let dashHolidays = [];
let dashEvents = [];

/* ---- Schedule helpers ---- */
function getMonday(offset) {
    const now = new Date();
    const day = now.getDay();
    const diff = (day === 0 ? -6 : 1 - day) + offset * 7;
    const mon = new Date(now);
    mon.setDate(now.getDate() + diff);
    mon.setHours(0, 0, 0, 0);
    return mon;
}
function shortDate(d) { return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }); }
function isoDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}
function parseLocalDate(str) {
    const [y, m, d] = str.split('-').map(Number);
    return new Date(y, m - 1, d);
}
function getCurrentPeriod() {
    const now = new Date();
    const time = now.getHours() * 60 + now.getMinutes();
    const periods = [
        { start: 510, end: 550 }, { start: 555, end: 600 },
        { start: 615, end: 655 }, { start: 660, end: 705 },
        { start: 710, end: 750 }, { start: 795, end: 835 },
        { start: 840, end: 885 }, { start: 890, end: 930 },
    ];
    for (let i = 0; i < periods.length; i++) {
        if (time >= periods[i].start && time < periods[i].end) return { type: "period", period: i + 1 };
    }
    if (time >= 600 && time < 610) return { type: "snack-break" };
    if (time >= 750 && time < 790) return { type: "lunch-break" };
    return null;
}

/* ---- Bootstrap ---- */
async function initDashboard() {
    if (!requireAuth()) return;
    const user = getUser();
    if (user && user.role === "teacher") { window.location.href = "teacher.html"; return; }
    initNav();
    initCardCollapse();

    // Week navigation
    document.getElementById("dashWeekPrev").addEventListener("click", () => { dashWeekOffset--; renderDashboardSchedule(); });
    document.getElementById("dashWeekNext").addEventListener("click", () => { dashWeekOffset++; renderDashboardSchedule(); });

    try {
        await Promise.all([
            loadDashboardSchedule(),
            loadAnnouncements(),
            loadRecentGrades(),
            loadAttendance(),
            loadBehavioral()
        ]);
    } catch (err) { console.error("Error loading dashboard data:", err); }
}

document.addEventListener("DOMContentLoaded", () => {
    initDashboard().catch(err => console.error("Dashboard init error:", err));
});

/* ---- Load schedule data ---- */
async function loadDashboardSchedule() {
    const container = document.getElementById("dashScheduleContainer");
    try {
        const fetches = [apiFetch("/schedule/"), apiFetch("/events/"), apiFetch("/attendance/")];
        const results = await Promise.all(fetches);
        const schedData = await results[0].json();
        dashScheduleSlots = schedData.schedule || [];
        dashStudyHall = schedData.study_hall || [];
        try {
            if (results[1].ok) {
                const evData = await results[1].json();
                dashHolidays = evData.holidays || [];
                dashEvents = evData.events || [];
            }
        } catch (_) { /* ignore */ }
        if (results[2]) {
            const attData = await results[2].json();
            dashAttendance = attData.attendance || [];
        }
        renderDashboardSchedule();
    } catch (err) {
        container.innerHTML = '<p class="empty-state">Failed to load schedule.</p>';
    }
}

/* ---- Render full weekly timetable (same as schedule page) ---- */
function renderDashboardSchedule() {
    const container = document.getElementById("dashScheduleContainer");
    const slots = dashScheduleSlots;
    const mon = getMonday(dashWeekOffset);
    const fri = new Date(mon); fri.setDate(mon.getDate() + 4);

    const weekLabel = document.getElementById("dashWeekLabel");
    weekLabel.textContent = `${shortDate(mon)} – ${shortDate(fri)}`;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const isCurrentWeek = (today >= mon && today <= fri);
    weekLabel.classList.toggle("week-current", isCurrentWeek);

    if (slots.length === 0) {
        container.innerHTML = '<p class="empty-state">No schedule available.</p>';
        return;
    }

    // Holiday lookup
    function getHoliday(dateStr) {
        for (const h of dashHolidays) {
            if (dateStr >= h.start_date && dateStr <= (h.end_date || h.start_date)) return h;
        }
        return null;
    }

    // Events by date
    const eventsByDate = {};
    for (const ev of dashEvents) {
        const start = ev.event_date;
        const end = ev.event_end_date || start;
        const d = parseLocalDate(start);
        const dEnd = parseLocalDate(end);
        while (d <= dEnd) {
            const ds = isoDate(d);
            if (!eventsByDate[ds]) eventsByDate[ds] = [];
            eventsByDate[ds].push(ev);
            d.setDate(d.getDate() + 1);
        }
    }

    // Attendance lookup: "YYYY-MM-DD|subject_id" -> status
    const attLookup = {};
    for (const a of dashAttendance) {
        const key = `${a.date_recorded}|${a.subject_id || ''}`;
        const prev = attLookup[key];
        if (!prev || a.status === "Absent" || (a.status === "Late" && prev !== "Absent")) {
            attLookup[key] = a.status;
        }
    }

    // Grid: grid[day][period] = slot
    const grid = {};
    for (const s of slots) {
        if (!grid[s.day_of_week]) grid[s.day_of_week] = {};
        grid[s.day_of_week][s.period] = s;
    }

    // Week events
    const weekEvents = [];
    for (let d = 0; d < 5; d++) {
        const dayDate = new Date(mon); dayDate.setDate(mon.getDate() + d);
        const ds = isoDate(dayDate);
        for (const ev of (eventsByDate[ds] || [])) {
            if (!weekEvents.find(e => e.id === ev.id)) weekEvents.push(ev);
        }
    }

    // Table header
    let html = '<table class="timetable"><thead><tr><th>Period</th>';
    for (let d = 0; d < 5; d++) {
        const dayDate = new Date(mon); dayDate.setDate(mon.getDate() + d);
        const ds = isoDate(dayDate);
        const holiday = getHoliday(ds);
        const dayEvs = eventsByDate[ds] || [];
        let headerExtra = "";
        if (holiday) {
            headerExtra += `<br><span class="schedule-holiday-badge" title="${escHtml(holiday.name)}">🏖 ${escHtml(holiday.name)}</span>`;
        }
        if (dayEvs.length > 0) {
            headerExtra += `<br><span class="schedule-event-badge" title="${dayEvs.map(e => e.title).join(', ')}">🎉 ${dayEvs.length === 1 ? escHtml(dayEvs[0].title) : dayEvs.length + " events"}</span>`;
        }
        html += `<th${holiday ? ' class="schedule-holiday-col"' : ""}>${DAYS[d]}<br><small class="day-date">${shortDate(dayDate)}</small>${headerExtra}</th>`;
    }
    html += "</tr></thead><tbody>";

    // Current period + today's column
    let currentInfo = null;
    let todayCol = null;
    if (isCurrentWeek) {
        const now = new Date();
        const dow = now.getDay();
        if (dow >= 1 && dow <= 5) { currentInfo = getCurrentPeriod(); todayCol = dow; }
    }

    // Event period overrides: eventPeriodMap[dateStr][period] = event
    const eventPeriodMap = {};
    for (const ev of dashEvents) {
        const periods = ev.affected_periods || [];
        if (periods.length === 0) continue;
        const start = ev.event_date;
        const end = ev.event_end_date || start;
        const d = parseLocalDate(start);
        const dEnd = parseLocalDate(end);
        while (d <= dEnd) {
            const ds = isoDate(d);
            if (!eventPeriodMap[ds]) eventPeriodMap[ds] = {};
            for (const p of periods) eventPeriodMap[ds][p] = ev;
            d.setDate(d.getDate() + 1);
        }
    }

    // Study hall lookup: shMap[dateStr][period] = session
    const shMap = {};
    for (const sh of dashStudyHall) {
        if (!shMap[sh.date]) shMap[sh.date] = {};
        shMap[sh.date][sh.period] = sh;
    }

    for (const row of SCHEDULE_ROWS) {
        if (row.type === "break") {
            const isSnack = row.label.includes("Snack");
            const breakType = isSnack ? "snack-break" : "lunch-break";
            const isNowBreak = currentInfo && currentInfo.type === breakType && todayCol;
            html += `<tr class="schedule-break-row${isNowBreak ? ' break-current' : ''}">
                <td colspan="6" class="schedule-break-cell"><span class="break-label">${row.label}</span></td>
            </tr>`;
            continue;
        }

        const p = row.period;
        const time = PERIOD_TIMES[p - 1] || `Period ${p}`;
        html += `<tr><td><strong>${p}</strong><br><small style="color:#9ca3af">${time}</small></td>`;

        for (let d = 1; d <= 5; d++) {
            const slot = (grid[d] || {})[p];
            const cellDate = new Date(mon); cellDate.setDate(mon.getDate() + d - 1);
            const cellDateStr = isoDate(cellDate);
            const holiday = getHoliday(cellDateStr);
            const isNowCell = (currentInfo && currentInfo.type === "period" && p === currentInfo.period && d === todayCol);
            const eventOverride = (eventPeriodMap[cellDateStr] || {})[p];

            if (holiday) {
                html += `<td class="lesson-holiday" title="${escHtml(holiday.name)}"><span class="holiday-label">${p === 1 ? escHtml(holiday.name) : ""}</span></td>`;
            } else if (eventOverride) {
                const nowClass = isNowCell ? " cell-current" : "";
                html += `<td class="lesson-event${nowClass}" title="${escHtml(eventOverride.title)}">
                    <span class="event-cell-icon">🎉</span> ${escHtml(eventOverride.title)}
                    ${eventOverride.start_time ? `<br><span class="lesson-room">${eventOverride.start_time}${eventOverride.end_time ? '–' + eventOverride.end_time : ''}</span>` : ""}
                </td>`;
            } else if (slot) {
                const yearLabel = slot.room ? "Room " + escHtml(slot.room) : "";
                // Attendance highlighting
                let attClass = "";
                let attBadge = "";
                if (cellDate <= today) {
                    const attKey = `${cellDateStr}|${slot.subject_id || ''}`;
                    const attStatus = attLookup[attKey];
                    if (attStatus === "Absent") { attClass = " lesson-absent"; attBadge = '<span class="att-badge att-badge-absent" title="Absent">✗</span>'; }
                    else if (attStatus === "Late") { attClass = " lesson-late"; attBadge = '<span class="att-badge att-badge-late" title="Late">⏰</span>'; }
                    else if (attStatus === "Excused") { attClass = " lesson-excused"; attBadge = '<span class="att-badge att-badge-excused" title="Excused">📋</span>'; }
                    else if (attStatus === "Present") { attClass = " lesson-present"; attBadge = '<span class="att-badge att-badge-present" title="Present">✓</span>'; }
                }
                const nowClass = isNowCell ? " cell-current" : "";
                html += `<td class="lesson${attClass}${nowClass}">
                    ${escHtml(slot.subject)}${attBadge}<br>
                    <span class="lesson-room">${yearLabel}</span>
                </td>`;
            } else {
                const shSession = (shMap[cellDateStr] || {})[p];
                const nowClass = isNowCell ? " cell-current" : "";
                if (shSession) {
                    const roomInfo = shSession.room ? `Room ${escHtml(shSession.room)}` : "";
                    const teacherInfo = shSession.teacher_name ? escHtml(shSession.teacher_name) : "";
                    html += `<td class="lesson-study-hall${nowClass}" title="Study Hall${shSession.room ? ' – Room ' + shSession.room : ''}">
                        📖 Study Hall<br>
                        <span class="lesson-room">${roomInfo}${roomInfo && teacherInfo ? " · " : ""}${teacherInfo}</span>
                    </td>`;
                } else {
                    html += `<td class="${nowClass}">${isNowCell ? '<span style="color:var(--text-lighter)">Free</span>' : "–"}</td>`;
                }
            }
        }
        html += "</tr>";
    }
    html += "</tbody></table>";

    // Week events/holidays below the timetable
    const weekHolidays = [];
    for (let d = 0; d < 5; d++) {
        const dayDate = new Date(mon); dayDate.setDate(mon.getDate() + d);
        const ds = isoDate(dayDate);
        const h = getHoliday(ds);
        if (h && !weekHolidays.find(wh => wh.name === h.name)) weekHolidays.push(h);
    }

    if (weekEvents.length > 0 || weekHolidays.length > 0) {
        html += '<div class="schedule-week-events">';
        if (weekHolidays.length > 0) {
            html += '<h4>🏖 Holidays This Week</h4>';
            html += weekHolidays.map(h => {
                const dateRange = h.end_date && h.end_date !== h.start_date
                    ? `${h.start_date} – ${h.end_date}` : h.start_date;
                return `<div class="schedule-event-item schedule-holiday-item">
                    <strong>${escHtml(h.name)}</strong>
                    <span class="schedule-event-date">${dateRange}</span>
                </div>`;
            }).join("");
        }
        if (weekEvents.length > 0) {
            html += '<h4>🎉 Events This Week</h4>';
            html += weekEvents.map(ev => {
                const dateRange = ev.event_end_date && ev.event_end_date !== ev.event_date
                    ? `${ev.event_date} – ${ev.event_end_date}` : ev.event_date;
                const timeStr = ev.start_time ? `${ev.start_time}${ev.end_time ? ' – ' + ev.end_time : ''}` : "";
                const periodsStr = (ev.affected_periods || []).length > 0
                    ? "Periods " + ev.affected_periods.join(", ") : "";
                const extra = [timeStr, periodsStr].filter(Boolean).join(" · ");
                return `<div class="schedule-event-item">
                    <strong>${escHtml(ev.title)}</strong>
                    <span class="schedule-event-date">${dateRange}${extra ? ' · ' + extra : ''}</span>
                    ${ev.description ? `<p>${escHtml(ev.description)}</p>` : ""}
                </div>`;
            }).join("");
        }
        html += "</div>";
    }

    // Upcoming events & holidays (beyond this week)
    const friStr = isoDate(fri);
    const upcoming = [];
    for (const ev of dashEvents) {
        if (ev.event_date > friStr) {
            upcoming.push({ type: "event", title: ev.title, description: ev.description, start: ev.event_date, end: ev.event_end_date });
        }
    }
    for (const h of dashHolidays) {
        if (h.start_date > friStr) {
            upcoming.push({ type: "holiday", title: h.name, start: h.start_date, end: h.end_date });
        }
    }
    upcoming.sort((a, b) => a.start.localeCompare(b.start));

    if (upcoming.length > 0) {
        html += '<div class="schedule-upcoming-section"><h4>📅 Upcoming Events & Holidays</h4>';
        html += upcoming.slice(0, 10).map(item => {
            const icon = item.type === "holiday" ? "🏖" : "🎉";
            const cls = item.type === "holiday" ? "schedule-holiday-item" : "";
            const dateRange = item.end && item.end !== item.start
                ? `${item.start} – ${item.end}` : item.start;
            return `<div class="schedule-event-item ${cls}">
                <span class="schedule-event-icon">${icon}</span>
                <div class="schedule-event-details">
                    <strong>${escHtml(item.title)}</strong>
                    <span class="schedule-event-date">${dateRange}</span>
                    ${item.description ? `<p>${escHtml(item.description)}</p>` : ""}
                </div>
            </div>`;
        }).join("");
        html += "</div>";
    }

    container.innerHTML = html;
}

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
