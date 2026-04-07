const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const PERIOD_TIMES = [
    "08:30–09:10",
    "09:15–10:00",
    "10:15–10:55",
    "11:00–11:45",
    "11:50–12:30",
    "13:15–13:55",
    "14:00–14:45",
    "14:50–15:30",
];

let scheduleSlots = [];
let weekOffset = 0;   // 0 = this week, -1 = last week, +1 = next week
let studentAttendance = []; // attendance records for students
let scheduleHolidays = []; // holidays
let scheduleEvents = [];   // events visible to this user

async function initSchedule() {
    if (!requireAuth()) return;
    initNav();
    await fetchSchedule();

    document.getElementById("weekPrev").addEventListener("click", () => { weekOffset--; renderSchedule(); });
    document.getElementById("weekNext").addEventListener("click", () => { weekOffset++; renderSchedule(); });
}

// Initialize on DOMContentLoaded
document.addEventListener("DOMContentLoaded", () => {
    initSchedule().catch(err => console.error("Schedule init error:", err));
});

async function fetchSchedule() {
    const container = document.getElementById("scheduleContainer");
    try {
        const user = getUser();
        const fetches = [apiFetch("/schedule/"), apiFetch("/events/")];
        // Students: also fetch attendance to highlight missed classes
        if (user && user.role === "student") {
            fetches.push(apiFetch("/attendance/"));
        }
        const results = await Promise.all(fetches);
        const schedData = await results[0].json();
        scheduleSlots = schedData.schedule || [];

        const evData = await results[1].json();
        scheduleHolidays = evData.holidays || [];
        scheduleEvents = evData.events || [];

        if (results[2]) {
            const attData = await results[2].json();
            studentAttendance = attData.attendance || [];
        }

        renderSchedule();
    } catch (err) {
        container.innerHTML = '<p class="empty-state">Failed to load schedule.</p>';
    }
}

/* Return Monday of the week that is `offset` weeks from this week */
function getMonday(offset) {
    const now = new Date();
    const day = now.getDay(); // 0=Sun
    const diff = (day === 0 ? -6 : 1 - day) + offset * 7;
    const mon = new Date(now);
    mon.setDate(now.getDate() + diff);
    mon.setHours(0, 0, 0, 0);
    return mon;
}

function shortDate(d) {
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function isoDate(d) {
    return d.toISOString().slice(0, 10);
}

function getCurrentPeriod() {
    const now = new Date();
    const hour = now.getHours();
    const minute = now.getMinutes();
    const time = hour * 60 + minute;
    
    const periodTimesInMinutes = [
        { start: 8 * 60 + 30, end: 9 * 60 + 10 },   // 08:30–09:10
        { start: 9 * 60 + 15, end: 10 * 60 + 0 },   // 09:15–10:00
        { start: 10 * 60 + 15, end: 10 * 60 + 55 }, // 10:15–10:55
        { start: 11 * 60 + 0, end: 11 * 60 + 45 },  // 11:00–11:45
        { start: 11 * 60 + 50, end: 12 * 60 + 30 }, // 11:50–12:30
        { start: 13 * 60 + 15, end: 13 * 60 + 55 }, // 13:15–13:55
        { start: 14 * 60 + 0, end: 14 * 60 + 45 },  // 14:00–14:45
        { start: 14 * 60 + 50, end: 15 * 60 + 30 }, // 14:50–15:30
    ];
    
    for (let i = 0; i < periodTimesInMinutes.length; i++) {
        if (time >= periodTimesInMinutes[i].start && time < periodTimesInMinutes[i].end) {
            return i + 1; // Return period number (1-8)
        }
    }
    return null;
}


function renderSchedule() {
    const container = document.getElementById("scheduleContainer");
    const user = getUser();
    const isTeacher = user && user.role === "teacher";
    const isStudent = user && user.role === "student";
    const slots = scheduleSlots;

    // Update week label
    const mon = getMonday(weekOffset);
    const fri = new Date(mon); fri.setDate(mon.getDate() + 4);
    document.getElementById("weekLabel").textContent = `${shortDate(mon)} – ${shortDate(fri)}`;

    // Highlight today arrow
    const today = new Date(); today.setHours(0,0,0,0);
    const isCurrentWeek = (today >= mon && today <= fri);
    document.getElementById("weekLabel").classList.toggle("week-current", isCurrentWeek);

    if (slots.length === 0) {
        container.innerHTML = '<p class="empty-state">No schedule available.</p>';
        return;
    }

    // Build holiday lookup: check if a date falls within any holiday range
    function getHoliday(dateStr) {
        for (const h of scheduleHolidays) {
            if (dateStr >= h.start_date && dateStr <= (h.end_date || h.start_date)) return h;
        }
        return null;
    }

    // Build event lookup: date -> [events]
    const eventsByDate = {};
    for (const ev of scheduleEvents) {
        const start = ev.event_date;
        const end = ev.event_end_date || start;
        // Iterate each day in range
        const d = new Date(start);
        const dEnd = new Date(end);
        while (d <= dEnd) {
            const ds = isoDate(d);
            if (!eventsByDate[ds]) eventsByDate[ds] = [];
            eventsByDate[ds].push(ev);
            d.setDate(d.getDate() + 1);
        }
    }

    // Build attendance lookup for students: "YYYY-MM-DD|subject_id" -> status
    const attLookup = {};
    if (isStudent && studentAttendance.length > 0) {
        for (const a of studentAttendance) {
            const key = `${a.date_recorded}|${a.subject_id || ''}`;
            const prev = attLookup[key];
            if (!prev || a.status === "Absent" || (a.status === "Late" && prev !== "Absent")) {
                attLookup[key] = a.status;
            }
        }
    }

    // Build lookup: grid[day][period] = slot
    const grid = {};
    let maxPeriod = 0;
    for (const s of slots) {
        if (!grid[s.day_of_week]) grid[s.day_of_week] = {};
        grid[s.day_of_week][s.period] = s;
        if (s.period > maxPeriod) maxPeriod = s.period;
    }

    // Collect events for this week to show below the table
    const weekEvents = [];
    for (let d = 0; d < 5; d++) {
        const dayDate = new Date(mon); dayDate.setDate(mon.getDate() + d);
        const ds = isoDate(dayDate);
        const dayEvs = eventsByDate[ds] || [];
        for (const ev of dayEvs) {
            if (!weekEvents.find(e => e.id === ev.id)) weekEvents.push(ev);
        }
    }

    // Table header with day+date
    let html = '<table class="timetable"><thead><tr><th>Period</th>';
    for (let d = 0; d < 5; d++) {
        const dayDate = new Date(mon); dayDate.setDate(mon.getDate() + d);
        const ds = isoDate(dayDate);
        const holiday = getHoliday(ds);
        const dayEvs = eventsByDate[ds] || [];
        const hasBadge = holiday || dayEvs.length > 0;
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

    // Get current period only if viewing current week and it's a weekday
    let currentPeriod = null;
    if (isCurrentWeek) {
        const today = new Date();
        const dayOfWeek = today.getDay();
        if (dayOfWeek >= 1 && dayOfWeek <= 5) {
            currentPeriod = getCurrentPeriod();
        }
    }

    for (let p = 1; p <= 8; p++) {
        const time = PERIOD_TIMES[p - 1] || `Period ${p}`;
        const rowClass = (p === currentPeriod) ? 'period-current' : '';
        html += `<tr ${rowClass ? `class="${rowClass}"` : ''}><td><strong>${p}</strong><br><small style="color:#9ca3af">${time}</small></td>`;
        for (let d = 1; d <= 5; d++) {
            const slot = (grid[d] || {})[p];
            const cellDate = new Date(mon); cellDate.setDate(mon.getDate() + d - 1);
            const cellDateStr = isoDate(cellDate);
            const holiday = getHoliday(cellDateStr);

            if (holiday) {
                // Holiday cell – greyed out
                html += `<td class="lesson-holiday" title="${escHtml(holiday.name)}"><span class="holiday-label">${p === 1 ? escHtml(holiday.name) : ""}</span></td>`;
            } else if (slot) {
                const yearLabel = isTeacher
                    ? escHtml(slot.class_name || `Year ${slot.grade_level}`)
                    : (slot.room ? "Room " + escHtml(slot.room) : "");
                const cls = isTeacher ? "lesson clickable-lesson" : "lesson";
                const slotWithDate = { ...slot, _date: cellDateStr };

                // Student attendance highlighting
                let attClass = "";
                let attBadge = "";
                if (isStudent && cellDate <= today) {
                    const attKey = `${cellDateStr}|${slot.subject_id || ''}`;
                    const attStatus = attLookup[attKey];
                    if (attStatus === "Absent") {
                        attClass = " lesson-absent";
                        attBadge = '<span class="att-badge att-badge-absent" title="Absent">✗</span>';
                    } else if (attStatus === "Late") {
                        attClass = " lesson-late";
                        attBadge = '<span class="att-badge att-badge-late" title="Late">⏰</span>';
                    } else if (attStatus === "Excused") {
                        attClass = " lesson-excused";
                        attBadge = '<span class="att-badge att-badge-excused" title="Excused">📋</span>';
                    }
                }

                html += `<td class="${cls}${attClass}" data-slot='${JSON.stringify(slotWithDate)}'>
                    ${escHtml(slot.subject)}${attBadge}<br>
                    <span class="lesson-room">${yearLabel}${isTeacher && slot.room ? " · " + escHtml(slot.room) : ""}</span>
                </td>`;
            } else {
                html += "<td>–</td>";
            }
        }
        html += "</tr>";
    }
    html += "</tbody></table>";

    // Show week events below the timetable
    if (weekEvents.length > 0) {
        html += '<div class="schedule-week-events"><h4>📅 Events This Week</h4>';
        html += weekEvents.map(ev => {
            const dateRange = ev.event_end_date && ev.event_end_date !== ev.event_date
                ? `${ev.event_date} – ${ev.event_end_date}` : ev.event_date;
            return `<div class="schedule-event-item">
                <strong>${escHtml(ev.title)}</strong>
                <span class="schedule-event-date">${dateRange}</span>
                ${ev.description ? `<p>${escHtml(ev.description)}</p>` : ""}
            </div>`;
        }).join("");
        html += "</div>";
    }

    container.innerHTML = html;

    // For teachers: clicking a lesson opens the attendance modal on teacher.html
    if (isTeacher) {
        container.querySelectorAll(".clickable-lesson").forEach(td => {
            td.addEventListener("click", () => {
                const slot = JSON.parse(td.dataset.slot);
                sessionStorage.setItem("openAttendance", JSON.stringify(slot));
                window.location.href = "teacher.html";
            });
        });
    }
}
