const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const PERIOD_TIMES = [
    "08:30–09:10",   // Period 1
    "09:15–10:00",   // Period 2
    "10:15–10:55",   // Period 3
    "11:00–11:45",   // Period 4
    "11:50–12:30",   // Period 5
    "13:15–13:55",   // Period 6
    "14:00–14:45",   // Period 7
    "14:50–15:30",   // Period 8
];

// Rows in display order: periods with break rows inserted
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

let scheduleSlots = [];
let studyHallSessions = []; // study hall sessions (date-specific)
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
        studyHallSessions = schedData.study_hall || [];

        // Events/holidays – don't let a failure break the whole schedule
        try {
            if (results[1].ok) {
                const evData = await results[1].json();
                scheduleHolidays = evData.holidays || [];
                scheduleEvents = evData.events || [];
            }
        } catch (_) { /* ignore events fetch failure */ }

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
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

/* Parse "YYYY-MM-DD" as local midnight (not UTC) */
function parseLocalDate(str) {
    const [y, m, d] = str.split('-').map(Number);
    return new Date(y, m - 1, d);
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
            return { type: "period", period: i + 1 };
        }
    }

    // Check break times
    if (time >= 10 * 60 && time < 10 * 60 + 10) return { type: "snack-break" };
    if (time >= 12 * 60 + 30 && time < 13 * 60 + 10) return { type: "lunch-break" };

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
        const d = parseLocalDate(start);
        const dEnd = parseLocalDate(end);
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

    // Get current period + today's column index for cell-level highlighting
    let currentInfo = null;
    let todayCol = null; // 1-based day_of_week (1=Mon)
    if (isCurrentWeek) {
        const now = new Date();
        const dow = now.getDay(); // 0=Sun, 1=Mon … 5=Fri
        if (dow >= 1 && dow <= 5) {
            currentInfo = getCurrentPeriod();
            todayCol = dow;
        }
    }

    // Build event-period lookup: for each day, which periods are overridden by events
    // eventPeriodMap[dateStr][period] = event object
    const eventPeriodMap = {};
    for (const ev of scheduleEvents) {
        const periods = ev.affected_periods || [];
        if (periods.length === 0) continue;
        const start = ev.event_date;
        const end = ev.event_end_date || start;
        const d = parseLocalDate(start);
        const dEnd = parseLocalDate(end);
        while (d <= dEnd) {
            const ds = isoDate(d);
            if (!eventPeriodMap[ds]) eventPeriodMap[ds] = {};
            for (const p of periods) {
                eventPeriodMap[ds][p] = ev;
            }
            d.setDate(d.getDate() + 1);
        }
    }

    // Build study-hall lookup: shMap[dateStr][period] = session
    const shMap = {};
    for (const sh of studyHallSessions) {
        if (!shMap[sh.date]) shMap[sh.date] = {};
        shMap[sh.date][sh.period] = sh;
    }

    for (const row of SCHEDULE_ROWS) {
        if (row.type === "break") {
            // Break row spans all columns
            const isSnack = row.label.includes("Snack");
            const breakType = isSnack ? "snack-break" : "lunch-break";
            const isNowBreak = currentInfo && currentInfo.type === breakType && todayCol;
            html += `<tr class="schedule-break-row${isNowBreak ? ' break-current' : ''}">
                <td colspan="${5 + 1}" class="schedule-break-cell">
                    <span class="break-label">${row.label}</span>
                </td>
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

            // Check if this period is overridden by an event
            const eventOverride = (eventPeriodMap[cellDateStr] || {})[p];

            if (holiday) {
                // Holiday cell – greyed out
                html += `<td class="lesson-holiday" title="${escHtml(holiday.name)}"><span class="holiday-label">${p === 1 ? escHtml(holiday.name) : ""}</span></td>`;
            } else if (eventOverride) {
                // Event overrides this period
                const nowClass = isNowCell ? " cell-current" : "";
                html += `<td class="lesson-event${nowClass}" title="${escHtml(eventOverride.title)}${eventOverride.start_time ? '\n' + eventOverride.start_time + (eventOverride.end_time ? '–' + eventOverride.end_time : '') : ''}">
                    <span class="event-cell-icon">🎉</span> ${escHtml(eventOverride.title)}
                    ${eventOverride.start_time ? `<br><span class="lesson-room">${eventOverride.start_time}${eventOverride.end_time ? '–' + eventOverride.end_time : ''}</span>` : ""}
                </td>`;
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
                    } else if (attStatus === "Present") {
                        attClass = " lesson-present";
                        attBadge = '<span class="att-badge att-badge-present" title="Present">✓</span>';
                    }
                }

                const nowClass = isNowCell ? " cell-current" : "";
                const teacherLine = (!isTeacher && slot.teacher_name)
                    ? (slot.teacher_email
                        ? `<a href="mailto:${escHtml(slot.teacher_email)}" class="lesson-teacher" title="${escHtml(slot.teacher_email)}">${escHtml(slot.teacher_name)}</a>`
                        : `<span class="lesson-teacher">${escHtml(slot.teacher_name)}</span>`)
                    : "";
                html += `<td class="${cls}${attClass}${nowClass}" data-slot='${JSON.stringify(slotWithDate)}'>
                    ${escHtml(slot.subject)}${attBadge}<br>
                    <span class="lesson-room">${yearLabel}${isTeacher && slot.room ? " · " + escHtml(slot.room) : ""}${teacherLine ? "<br>" + teacherLine : ""}</span>
                </td>`;
            } else {
                const shSession = (shMap[cellDateStr] || {})[p];
                const nowClass = isNowCell ? " cell-current" : "";
                if (shSession) {
                    const roomInfo = shSession.room ? `Room ${escHtml(shSession.room)}` : "";
                    const teacherInfo = shSession.teacher_name ? escHtml(shSession.teacher_name) : "";
                    const detail = isStudent ? teacherInfo : "";
                    html += `<td class="lesson-study-hall${nowClass}" title="Study Hall${shSession.room ? ' – Room ' + shSession.room : ''}">
                        📖 Study Hall<br>
                        <span class="lesson-room">${roomInfo}${roomInfo && detail ? " · " : ""}${detail}</span>
                    </td>`;
                } else {
                    html += `<td class="${nowClass}">${isNowCell ? '<span style="color:var(--text-lighter)">Free</span>' : "–"}</td>`;
                }
            }
        }
        html += "</tr>";
    }
    html += "</tbody></table>";

    // Show week events + holidays below the timetable
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
                const timeStr = ev.start_time
                    ? `${ev.start_time}${ev.end_time ? ' – ' + ev.end_time : ''}`
                    : "";
                const periodsStr = (ev.affected_periods || []).length > 0
                    ? "Periods " + ev.affected_periods.join(", ")
                    : "";
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

    // Upcoming events & holidays (beyond this week) for students
    if (isStudent) {
        const todayStr = isoDate(new Date());
        const friStr = isoDate(fri);
        const upcoming = [];
        const monStr = isoDate(mon);
        for (const ev of scheduleEvents) {
            const start = ev.event_date;
            // Only show if it starts after this week (not already active)
            if (start > friStr) {
                upcoming.push({ type: "event", title: ev.title, description: ev.description, start: ev.event_date, end: ev.event_end_date });
            }
        }
        for (const h of scheduleHolidays) {
            // Only show if it starts after this week (not already active)
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
    }

    container.innerHTML = html;

    // For teachers: clicking a lesson opens the attendance modal inline
    if (isTeacher) {
        container.querySelectorAll(".clickable-lesson").forEach(td => {
            td.addEventListener("click", () => {
                const slot = JSON.parse(td.dataset.slot);
                openScheduleAttendanceModal(slot);
            });
        });
    }
}

/* ═══════════════════════════════════════════════════════
   Inline Attendance Modal (for teachers on schedule page)
   ═══════════════════════════════════════════════════════ */
let _schedCurrentSlot = null;

async function openScheduleAttendanceModal(slot) {
    _schedCurrentSlot = slot;
    const modal = document.getElementById("attendanceModal");
    if (!modal) return; // not a teacher or modal not present
    const title = document.getElementById("modalTitle");
    const subtitle = document.getElementById("modalSubtitle");
    const dateInput = document.getElementById("attendanceDate");
    const studentList = document.getElementById("studentList");

    const yearLabel = slot.class_name || `Year ${slot.grade_level}`;
    title.textContent = `${slot.subject} – ${yearLabel}`;
    const time = PERIOD_TIMES[slot.period - 1] || `Period ${slot.period}`;
    subtitle.textContent = `${DAYS[slot.day_of_week - 1]} · ${time}${slot.room ? " · Room " + slot.room : ""}`;

    dateInput.value = slot._date || isoDate(new Date());
    modal.style.display = "flex";
    studentList.innerHTML = '<p class="loading">Loading students…</p>';

    document.getElementById("modalClose").onclick = _schedCloseModal;
    modal.onclick = (e) => { if (e.target === modal) _schedCloseModal(); };

    document.getElementById("markAllPresent").onclick = _schedMarkAllPresent;
    document.getElementById("saveAttendance").onclick = _schedSaveAttendance;

    dateInput.onchange = () => _schedLoadStudents(slot, dateInput.value);
    await _schedLoadStudents(slot, dateInput.value);
}

function _schedCloseModal() {
    const modal = document.getElementById("attendanceModal");
    if (modal) modal.style.display = "none";
    _schedCurrentSlot = null;
}

async function _schedLoadStudents(slot, date) {
    const studentList = document.getElementById("studentList");
    try {
        const [studentsRes, attendanceRes] = await Promise.all([
            apiFetch(`/teacher/class-students/?class_id=${slot.class_id}&subject_id=${slot.subject_id}`),
            apiFetch(`/teacher/attendance/?class_id=${slot.class_id}&subject_id=${slot.subject_id}&date=${date}`),
        ]);
        const studentsData = await studentsRes.json();
        const attendanceData = await attendanceRes.json();
        const students = studentsData.students || [];
        const existing = attendanceData.attendance || [];

        const topicInput = document.getElementById("lessonTopic");
        if (topicInput && attendanceData.topic) {
            topicInput.value = attendanceData.topic;
        } else if (topicInput && existing.length === 0) {
            topicInput.value = "";
        }

        const attendanceMap = {};
        for (const rec of existing) attendanceMap[rec.student_id] = rec;

        if (students.length === 0) {
            studentList.innerHTML = '<p class="empty-state">No students enrolled in this subject for this class.</p>';
            return;
        }

        studentList.innerHTML = `
            <table class="attendance-table">
                <thead><tr><th>#</th><th>Student</th><th>Class</th><th>Status</th><th>Comment</th></tr></thead>
                <tbody>
                    ${students.map((s, i) => {
                        const rec = attendanceMap[s.id] || {};
                        const status = rec.status || "Present";
                        const comment = rec.comment || "";
                        return `
                        <tr data-student-id="${s.id}">
                            <td>${i + 1}</td>
                            <td>${escHtml(s.surname)} ${escHtml(s.name)}</td>
                            <td><span class="class-tag">${escHtml(s.class_name || "")}</span></td>
                            <td>
                                <select class="status-select status-${status.toLowerCase()}">
                                    <option value="Present" ${status === "Present" ? "selected" : ""}>✅ Present</option>
                                    <option value="Late" ${status === "Late" ? "selected" : ""}>⏰ Late</option>
                                    <option value="Absent" ${status === "Absent" ? "selected" : ""}>❌ Absent</option>
                                    <option value="Excused" ${status === "Excused" ? "selected" : ""}>📋 Excused</option>
                                </select>
                            </td>
                            <td><input type="text" class="comment-input" placeholder="Comment…" value="${escHtml(comment)}"></td>
                        </tr>`;
                    }).join("")}
                </tbody>
            </table>`;

        studentList.querySelectorAll(".status-select").forEach(sel => {
            _schedUpdateSelectStyle(sel);
            sel.addEventListener("change", () => _schedUpdateSelectStyle(sel));
        });
    } catch (err) {
        studentList.innerHTML = '<p class="empty-state">Failed to load students.</p>';
    }
}

function _schedUpdateSelectStyle(sel) {
    sel.className = "status-select status-" + sel.value.toLowerCase();
}

function _schedMarkAllPresent() {
    document.querySelectorAll("#studentList .status-select").forEach(sel => {
        sel.value = "Present";
        _schedUpdateSelectStyle(sel);
    });
}

async function _schedSaveAttendance() {
    const btn = document.getElementById("saveAttendance");
    const date = document.getElementById("attendanceDate").value;
    if (!date || !_schedCurrentSlot) return;

    const rows = document.querySelectorAll("#studentList tbody tr");
    const records = [];
    rows.forEach(row => {
        const studentId = row.dataset.studentId;
        const status = row.querySelector(".status-select").value;
        const comment = row.querySelector(".comment-input").value.trim();
        records.push({ student_id: studentId, status, comment });
    });
    if (records.length === 0) return;

    btn.disabled = true;
    btn.textContent = "Saving…";

    const topic = (document.getElementById("lessonTopic")?.value || "").trim();

    try {
        const res = await apiFetch("/teacher/attendance/", {
            method: "POST",
            body: JSON.stringify({
                class_id: _schedCurrentSlot.class_id,
                subject_id: _schedCurrentSlot.subject_id,
                date: date,
                topic: topic,
                records: records,
            }),
        });
        const data = await res.json();
        if (res.ok) {
            btn.textContent = "✓ Saved!";
            btn.classList.add("btn-success");
            setTimeout(() => {
                btn.textContent = "Save Attendance";
                btn.classList.remove("btn-success");
                btn.disabled = false;
            }, 2000);
        } else {
            showToast(data.message || "Failed to save attendance", "error");
            btn.textContent = "Save Attendance";
            btn.disabled = false;
        }
    } catch (err) {
        showToast("Error saving attendance", "error");
        btn.textContent = "Save Attendance";
        btn.disabled = false;
    }
}
