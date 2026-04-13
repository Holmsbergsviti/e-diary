/* ================================================================
   teacher.js – Teacher dashboard: schedule + attendance
   ================================================================ */

const DAYS  = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const PERIOD_TIMES = [
    "08:30–09:10", "09:15–10:00", "10:15–10:55", "11:00–11:45",
    "11:50–12:30", "13:15–13:55", "14:00–14:45", "14:50–15:30",
];

let allSlots = [];      // full schedule
let currentSlot = null; // slot being attended
let weekOffset = 0;     // 0 = this week, -1 = last week, etc.
let teacherHolidays = [];  // holidays
let teacherEvents = [];    // events
let currentTeacherId = null; // current teacher's user ID
let currentTeacherTab = "dashboard"; // active tab
let statsLoaded = false;   // lazy flag for statistics tab
let exportsLoaded = false; // lazy flag for exports tab
let teacherSubstitutes = []; // substitute lessons from schedule API

/* ---- Bootstrap ------------------------------------------------ */
async function initTeacher() {
    if (!requireAuth()) return;

    // Redirect students away from teacher page
    const user = getUser();
    if (user && user.role !== "teacher") {
        window.location.href = "dashboard.html";
        return;
    }
    currentTeacherId = user?.id || null;

    initNav();
    await Promise.all([loadSchedule(), loadHomework(), loadBehavioral(), loadStudyHall(), loadSubstitutes(), loadTeacherEvents()]);
    
    // Initialize card collapse functionality
    initCardCollapse();

    // Tab switching
    bindTeacherTabs();

    // Week navigation arrows
    document.getElementById("weekPrev").addEventListener("click", () => { weekOffset--; renderWeeklySchedule(); });
    document.getElementById("weekNext").addEventListener("click", () => { weekOffset++; renderWeeklySchedule(); });

    // Study hall button
    document.getElementById("openStudyHallBtn").addEventListener("click", openStudyHallModal);

    // Substitute button
    document.getElementById("openSubstituteBtn").addEventListener("click", openSubstituteModal);

    // Event button
    document.getElementById("addEventBtn").addEventListener("click", () => openEventModal());

    // Check if redirected from schedule page with an attendance slot to open
    const pending = sessionStorage.getItem("openAttendance");
    if (pending) {
        sessionStorage.removeItem("openAttendance");
        try {
            const slot = JSON.parse(pending);
            openAttendanceModal(slot);
        } catch (e) { /* ignore */ }
    }
}

// Initialize on DOMContentLoaded
document.addEventListener("DOMContentLoaded", () => {
    initTeacher().catch(err => console.error("Teacher init error:", err));
});

/* ---- Teacher tab switching ---- */
function bindTeacherTabs() {
    document.querySelectorAll("#teacherTabs .teacher-tab").forEach(btn => {
        btn.addEventListener("click", () => {
            switchTeacherTab(btn.dataset.tab);
        });
    });
}

function switchTeacherTab(tab) {
    currentTeacherTab = tab;
    // Update tab buttons
    document.querySelectorAll("#teacherTabs .teacher-tab").forEach(b => {
        b.classList.toggle("active", b.dataset.tab === tab);
    });
    // Show/hide tab content
    document.querySelectorAll(".teacher-tab-content").forEach(el => {
        el.classList.toggle("active", el.id === `tab-${tab}`);
    });
    // Lazy load stats
    if (tab === "statistics" && !statsLoaded) {
        statsLoaded = true;
        loadClassStats();
    }
    // Lazy load exports
    if (tab === "exports" && !exportsLoaded) {
        exportsLoaded = true;
        // Re-register export data from already-loaded sections, then render
        _reRegisterExports();
        renderExportCard();
    }
}

/** Re-register exports from data already loaded on the dashboard tab */
function _reRegisterExports() {
    // Schedule is always loaded
    if (allSlots.length > 0) {
        const scheduleRows = allSlots.map(s => ({
            day: DAYS[s.day_of_week - 1] || String(s.day_of_week),
            period: s.period,
            time: PERIOD_TIMES[s.period - 1] || "",
            subject: s.subject || "",
            class_name: s.class_name || "",
            room: s.room || "",
        }));
        _registerExport("expSchedule", scheduleRows,
            ["day","period","time","subject","class_name","room"],
            {day:"Day",period:"Period",time:"Time",subject:"Subject",class_name:"Class",room:"Room"},
            "my_schedule");
    }
}

/* ---- Load schedule from API ----------------------------------- */
async function loadSchedule() {
    try {
        const [schedRes, eventsRes] = await Promise.all([
            apiFetch("/schedule/"),
            apiFetch("/events/")
        ]);
        const data = await schedRes.json();
        allSlots = data.schedule || [];
        teacherSubstitutes = data.substitutes || [];

        // Load events/holidays
        try {
            if (eventsRes.ok) {
                const evData = await eventsRes.json();
                teacherHolidays = evData.holidays || [];
                teacherEvents = evData.events || [];
            }
        } catch (_) { /* ignore */ }

        renderTodayClasses();
        renderWeeklySchedule();

        // Register schedule export
        const scheduleRows = allSlots.map(s => ({
            day: DAYS[s.day_of_week - 1] || String(s.day_of_week),
            period: s.period,
            time: PERIOD_TIMES[s.period - 1] || "",
            subject: s.subject,
            class_name: s.class_name || "Year " + s.grade_level,
            room: s.room || "",
        }));
        _registerExport("expSchedule", scheduleRows,
            ["day", "period", "time", "subject", "class_name", "room"],
            { day: "Day", period: "Period", time: "Time", subject: "Subject", class_name: "Class", room: "Room" },
            "my_schedule");
    } catch (err) {
        console.error("[teacher.js] loadSchedule error:", err);
        document.getElementById("todayClasses").innerHTML =
            '<p class="empty-state">Failed to load schedule.</p>';
    }
}

/* ---- Today's classes (clickable cards) ------------------------ */
function renderTodayClasses() {
    const container = document.getElementById("todayClasses");

    // Check if today is a holiday
    const todayStr = new Date().toISOString().slice(0, 10);
    const todayHoliday = teacherHolidays.find(
        h => todayStr >= h.start_date && todayStr <= (h.end_date || h.start_date)
    );
    if (todayHoliday) {
        container.innerHTML = `<p class="empty-state">🏖 No school today — ${escHtml(todayHoliday.name)}</p>`;
        return;
    }

    // JS getDay(): 0=Sun, 1=Mon, …, 5=Fri, 6=Sat → our day_of_week is 1=Mon…5=Fri
    const jsDay = new Date().getDay();          // 0-6
    const todayDow = jsDay === 0 ? 7 : jsDay;   // 1-7 (7=Sun)

    const todaySlots = allSlots
        .filter(s => s.day_of_week === todayDow)
        .sort((a, b) => a.period - b.period);

    if (todaySlots.length === 0) {
        container.innerHTML = '<p class="empty-state">No classes today.</p>';
        return;
    }

    container.innerHTML = todaySlots.map(slot => {
        const time = PERIOD_TIMES[slot.period - 1] || `Period ${slot.period}`;
        const yearLabel = escHtml(slot.class_name || `Year ${slot.grade_level}`);
        return `
        <div class="class-card" data-slot='${JSON.stringify(slot)}'>
            <div class="class-card-period">${time}</div>
            <div class="class-card-info">
                <strong>${escHtml(slot.subject)}</strong>
                <span class="class-card-meta">${yearLabel}${slot.room ? " · Room " + escHtml(slot.room) : ""}</span>
            </div>
            <div class="class-card-action">
                <button class="btn btn-primary btn-sm">Take Attendance</button>
            </div>
        </div>`;
    }).join("");

    // Attach click handlers
    container.querySelectorAll(".class-card").forEach(card => {
        card.addEventListener("click", () => {
            const slot = JSON.parse(card.dataset.slot);
            openAttendanceModal(slot);
        });
    });
}

/* ---- Weekly schedule table ------------------------------------ */
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

function renderWeeklySchedule() {
    const container = document.getElementById("weeklySchedule");
    const mon = getMonday(weekOffset);
    const fri = new Date(mon); fri.setDate(mon.getDate() + 4);

    // Update week label
    const weekLabel = document.getElementById("weekLabel");
    weekLabel.textContent = `${shortDate(mon)} – ${shortDate(fri)}`;
    const today = new Date(); today.setHours(0,0,0,0);
    const isCurrentWeek = (today >= mon && today <= fri);
    weekLabel.classList.toggle("week-current", isCurrentWeek);

    if (allSlots.length === 0) {
        container.innerHTML = '<p class="empty-state">No schedule available.</p>';
        return;
    }

    // Holiday lookup
    function getHoliday(dateStr) {
        for (const h of teacherHolidays) {
            if (dateStr >= h.start_date && dateStr <= (h.end_date || h.start_date)) return h;
        }
        return null;
    }

    // Events by date
    const eventsByDate = {};
    for (const ev of teacherEvents) {
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

    // Build grid[day][period] = slot
    const grid = {};
    for (const s of allSlots) {
        if (!grid[s.day_of_week]) grid[s.day_of_week] = {};
        grid[s.day_of_week][s.period] = s;
    }

    // Collect week events
    const weekEvents = [];
    for (let d = 0; d < 5; d++) {
        const dayDate = new Date(mon); dayDate.setDate(mon.getDate() + d);
        const ds = isoDate(dayDate);
        for (const ev of (eventsByDate[ds] || [])) {
            if (!weekEvents.find(e => e.id === ev.id)) weekEvents.push(ev);
        }
    }

    // Table header with holidays/events badges
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

    // Event period overrides: eventPeriodMap[dateStr][period] = event
    const eventPeriodMap = {};
    for (const ev of teacherEvents) {
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

    const TEACHER_ROWS = [
        { type: "period", period: 1 },
        { type: "period", period: 2 },
        { type: "break",  label: "🥪 Snack Break" },
        { type: "period", period: 3 },
        { type: "period", period: 4 },
        { type: "period", period: 5 },
        { type: "break",  label: "🍽 Lunch Break" },
        { type: "period", period: 6 },
        { type: "period", period: 7 },
        { type: "period", period: 8 },
    ];

    // Build substitute lookup: tSubMap[dateStr][period] = sub
    const tSubMap = {};
    for (const sub of teacherSubstitutes) {
        if (!tSubMap[sub.date]) tSubMap[sub.date] = {};
        tSubMap[sub.date][sub.period] = sub;
    }

    for (const row of TEACHER_ROWS) {
        if (row.type === "break") {
            html += `<tr class="schedule-break-row">
                <td colspan="6" class="schedule-break-cell">
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
            const eventOverride = (eventPeriodMap[cellDateStr] || {})[p];
            const subOverride = (tSubMap[cellDateStr] || {})[p];

            if (holiday) {
                html += `<td class="lesson-holiday" title="${escHtml(holiday.name)}"><span class="holiday-label">${p === 1 ? escHtml(holiday.name) : ""}</span></td>`;
            } else if (eventOverride) {
                // Check if the teacher is assigned to this event
                const teacherAssigned = (eventOverride.target_teacher_ids || []).includes(currentTeacherId);
                html += `<td class="lesson-event" title="${escHtml(eventOverride.title)}">
                    <span class="event-cell-icon">🎉</span> ${escHtml(eventOverride.title)}
                    ${teacherAssigned ? '<br><span class="lesson-room" style="color:#2563eb">🧑‍🏫 Accompanying</span>' : ""}
                    ${eventOverride.start_time ? `<br><span class="lesson-room">${eventOverride.start_time}${eventOverride.end_time ? '–' + eventOverride.end_time : ''}</span>` : ""}
                </td>`;
            } else if (slot) {
                // Check for substitute override on this slot
                if (subOverride && subOverride.is_substitute_for_me) {
                    // Teacher is absent – someone else is covering – clickable to view details
                    const subJson = JSON.stringify(subOverride).replace(/'/g, "&#39;");
                    html += `<td class="lesson lesson-substitute clickable-sub" data-sub='${subJson}' title="You're absent – ${escHtml(subOverride.substitute_teacher || 'substitute')} is covering. Click to view.">
                        ${escHtml(subOverride.subject || slot.subject)} <small class="sub-badge sub-badge-out">Absent</small><br>
                        <span class="lesson-room">${escHtml(slot.class_name || '')}${subOverride.substitute_teacher ? ' · ' + escHtml(subOverride.substitute_teacher) : ''}</span>
                    </td>`;
                } else {
                // Check if this class is on an event (class-level or all-school) for this date
                const dayEvents = eventsByDate[cellDateStr] || [];
                let classOnTrip = null;
                for (const ev of dayEvents) {
                    const tt = ev.target_type || "all";
                    const periods = ev.affected_periods || [];
                    const affectsThisPeriod = periods.length === 0 || periods.includes(p);
                    if (!affectsThisPeriod) continue;
                    if (tt === "class" && (ev.target_class_ids || []).includes(slot.class_id)) {
                        classOnTrip = ev;
                        break;
                    }
                }
                if (classOnTrip) {
                    const yrLabel = escHtml(slot.class_name || `Year ${slot.grade_level}`);
                    html += `<td class="lesson-event lesson-class-trip" title="${escHtml(classOnTrip.title)}">
                        <span class="event-cell-icon">🚌</span> ${yrLabel}<br>
                        <span class="lesson-room">${escHtml(classOnTrip.title)}</span>
                    </td>`;
                } else {
                    const yrLabel = escHtml(slot.class_name || `Year ${slot.grade_level}`);
                    const slotWithDate = { ...slot, _date: cellDateStr };
                    html += `<td class="lesson clickable-lesson" data-slot='${JSON.stringify(slotWithDate)}'>
                        ${escHtml(slot.subject)}<br>
                        <span class="lesson-room">${yrLabel}${slot.room ? " · " + escHtml(slot.room) : ""}</span>
                    </td>`;
                }
                }
            } else {
                // Empty cell – check if teacher is covering for someone
                if (subOverride && !subOverride.is_substitute_for_me) {
                    const subJson = JSON.stringify(subOverride).replace(/'/g, "&#39;");
                    html += `<td class="lesson lesson-substitute clickable-sub" data-sub='${subJson}' title="Covering for ${escHtml(subOverride.original_teacher || '')}. Click to view.">
                        ${escHtml(subOverride.subject)} <small class="sub-badge sub-badge-in">Covering</small><br>
                        <span class="lesson-room">${escHtml(subOverride.class_name || '')}${subOverride.room ? ' · Room ' + escHtml(subOverride.room) : ''}</span>
                    </td>`;
                } else {
                html += "<td>–</td>";
                }
            }
        }
        html += "</tr>";
    }
    html += "</tbody></table>";

    // Week events/holidays summary below table
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

    container.innerHTML = html;

    // Clicking a lesson in the weekly grid also opens attendance
    container.querySelectorAll(".clickable-lesson").forEach(td => {
        td.addEventListener("click", () => {
            const slot = JSON.parse(td.dataset.slot);
            openAttendanceModal(slot);
        });
    });

    // Clicking a substitute cell opens the detail view
    container.querySelectorAll(".clickable-sub").forEach(td => {
        td.addEventListener("click", () => {
            const sub = JSON.parse(td.dataset.sub);
            viewSubstituteDetail(sub);
        });
    });
}

/* ---- Substitute detail view (read-only for original teacher) ---- */
async function viewSubstituteDetail(sub) {
    const modal = document.getElementById("subDetailModal");
    const title = document.getElementById("subDetailTitle");
    const subtitle = document.getElementById("subDetailSubtitle");
    const body = document.getElementById("subDetailBody");

    const time = PERIOD_TIMES[sub.period - 1] || `Period ${sub.period}`;
    title.textContent = `${sub.subject} – ${sub.class_name}`;
    subtitle.textContent = `${sub.date} · ${time}${sub.room ? " · Room " + sub.room : ""}`;
    body.innerHTML = '<p class="loading">Loading details…</p>';

    modal.style.display = "flex";
    document.getElementById("subDetailClose").onclick = () => { modal.style.display = "none"; };
    modal.onclick = (e) => { if (e.target === modal) modal.style.display = "none"; };

    try {
        const res = await apiFetch(`/teacher/substitutes/detail/?id=${sub.id}`);
        if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.message || `HTTP ${res.status}`); }
        const data = await res.json();
        const info = data.substitute;
        const students = data.students || [];
        const readOnly = data.is_read_only;

        let html = '<div class="sub-detail-info">';
        if (readOnly) {
            html += `<div class="sub-detail-row"><strong>Substitute Teacher:</strong> ${escHtml(info.substitute_teacher)}</div>`;
        } else {
            html += `<div class="sub-detail-row"><strong>Covering for:</strong> ${escHtml(info.original_teacher)}</div>`;
        }
        if (info.topic) html += `<div class="sub-detail-row"><strong>Topic:</strong> ${escHtml(info.topic)}</div>`;
        if (info.note) html += `<div class="sub-detail-row"><strong>Note:</strong> ${escHtml(info.note)}</div>`;
        html += '</div>';

        if (students.length === 0) {
            html += '<p class="empty-state" style="margin-top:12px;">No attendance recorded yet.</p>';
        } else {
            html += `<table class="attendance-table" style="margin-top:12px;">
                <thead><tr><th>#</th><th>Student</th><th>Class</th><th>Status</th><th>Comment</th></tr></thead>
                <tbody>${students.map((s, i) => {
                    const statusClass = "status-" + s.status.toLowerCase();
                    const statusIcon = s.status === "Present" ? "✅" : s.status === "Late" ? "⏰" : s.status === "Absent" ? "❌" : "📋";
                    return `<tr>
                        <td>${i + 1}</td>
                        <td>${escHtml(s.surname)} ${escHtml(s.name)}</td>
                        <td><span class="class-tag">${escHtml(s.class_name || "")}</span></td>
                        <td><span class="status-badge ${statusClass}">${statusIcon} ${escHtml(s.status)}</span></td>
                        <td>${escHtml(s.comment || "—")}</td>
                    </tr>`;
                }).join("")}</tbody>
            </table>`;
        }

        body.innerHTML = html;
    } catch (err) {
        body.innerHTML = `<p class="empty-state">Failed to load details: ${escHtml(err.message)}</p>`;
    }
}

/* ---- Attendance modal ----------------------------------------- */
async function openAttendanceModal(slot) {
    currentSlot = slot;
    const modal = document.getElementById("attendanceModal");
    const title = document.getElementById("modalTitle");
    const subtitle = document.getElementById("modalSubtitle");
    const dateInput = document.getElementById("attendanceDate");
    const studentList = document.getElementById("studentList");

    const yearLabel = slot.class_name || `Year ${slot.grade_level}`;
    title.textContent = `${slot.subject} – ${yearLabel}`;
    const time = PERIOD_TIMES[slot.period - 1] || `Period ${slot.period}`;
    subtitle.textContent = `${DAYS[slot.day_of_week - 1]} · ${time}${slot.room ? " · Room " + slot.room : ""}`;

    // Default date to the slot's date if available, otherwise today
    dateInput.value = slot._date || new Date().toISOString().slice(0, 10);

    modal.style.display = "flex";
    studentList.innerHTML = '<p class="loading">Loading students…</p>';

    // Wire close button
    document.getElementById("modalClose").onclick = closeModal;
    modal.onclick = (e) => { if (e.target === modal) closeModal(); };

    // Wire buttons
    document.getElementById("markAllPresent").onclick = markAllPresent;
    document.getElementById("saveAttendance").onclick = saveAttendance;

    // Load when date changes
    dateInput.onchange = () => loadStudentsAndAttendance(slot, dateInput.value);

    // Initial load
    await loadStudentsAndAttendance(slot, dateInput.value);
}

async function loadStudentsAndAttendance(slot, date) {
    const studentList = document.getElementById("studentList");
    try {
        // Load students and existing attendance in parallel
        const [studentsRes, attendanceRes] = await Promise.all([
            apiFetch(`/teacher/class-students/?class_id=${slot.class_id}&subject_id=${slot.subject_id}`),
            apiFetch(`/teacher/attendance/?class_id=${slot.class_id}&subject_id=${slot.subject_id}&date=${date}`),
        ]);
        const studentsData = await studentsRes.json();
        const attendanceData = await attendanceRes.json();

        const students = studentsData.students || [];
        const existing = attendanceData.attendance || [];
        const eventStudentIds = attendanceData.event_student_ids || [];

        // Populate topic field from existing data
        const topicInput = document.getElementById("lessonTopic");
        if (topicInput && attendanceData.topic) {
            topicInput.value = attendanceData.topic;
        } else if (topicInput && existing.length === 0) {
            topicInput.value = "";
        }

        // Build lookup: student_id -> record
        const attendanceMap = {};
        for (const rec of existing) {
            attendanceMap[rec.student_id] = rec;
        }

        if (students.length === 0) {
            studentList.innerHTML = '<p class="empty-state">No students enrolled in this subject for this class.</p>';
            return;
        }

        studentList.innerHTML = `
            <table class="attendance-table">
                <thead>
                    <tr>
                        <th>#</th>
                        <th>Student</th>
                        <th>Class</th>
                        <th>Status</th>
                        <th>Comment</th>
                    </tr>
                </thead>
                <tbody>
                    ${students.map((s, i) => {
                        const rec = attendanceMap[s.id] || {};
                        const onEvent = eventStudentIds.includes(s.id);
                        const status = rec.status || (onEvent ? "Excused" : "Present");
                        const comment = rec.comment || (onEvent && !rec.status ? "On school event" : "");
                        return `
                        <tr data-student-id="${s.id}"${onEvent ? ' class="student-on-event"' : ""}>
                            <td>${i + 1}</td>
                            <td>${escHtml(s.surname)} ${escHtml(s.name)}${onEvent ? ' <span class="on-event-badge" title="This student is on a school event today">🚌 On Event</span>' : ""}</td>
                            <td><span class="class-tag">${escHtml(s.class_name || "")}</span></td>
                            <td>
                                <select class="status-select status-${status.toLowerCase()}">
                                    <option value="Present" ${status === "Present" ? "selected" : ""}>✅ Present</option>
                                    <option value="Late" ${status === "Late" ? "selected" : ""}>⏰ Late</option>
                                    <option value="Absent" ${status === "Absent" ? "selected" : ""}>❌ Absent</option>
                                    <option value="Excused" ${status === "Excused" ? "selected" : ""}>📋 Excused</option>
                                </select>
                            </td>
                            <td>
                                <input type="text" class="comment-input" placeholder="Comment…" value="${escHtml(comment)}">
                            </td>
                        </tr>`;
                    }).join("")}
                </tbody>
            </table>
        `;

        // Update select styling on change
        studentList.querySelectorAll(".status-select").forEach(sel => {
            updateSelectStyle(sel);
            sel.addEventListener("change", () => updateSelectStyle(sel));
        });

    } catch (err) {
        studentList.innerHTML = '<p class="empty-state">Failed to load students.</p>';
    }
}

function updateSelectStyle(sel) {
    sel.className = "status-select status-" + sel.value.toLowerCase();
}

function markAllPresent() {
    document.querySelectorAll("#studentList .status-select").forEach(sel => {
        sel.value = "Present";
        updateSelectStyle(sel);
    });
}

async function saveAttendance() {
    const btn = document.getElementById("saveAttendance");
    const date = document.getElementById("attendanceDate").value;
    if (!date || !currentSlot) return;

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
                class_id: currentSlot.class_id,
                subject_id: currentSlot.subject_id,
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

function closeModal() {
    document.getElementById("attendanceModal").style.display = "none";
    currentSlot = null;
}

/* ================================================================
   CLASS STATISTICS SECTION
   ================================================================ */

async function loadClassStats() {
    const container = document.getElementById("classStatsList");
    try {
        const res = await apiFetch("/teacher/class-stats/");
        const data = await res.json();
        const stats = data.stats || [];
        renderClassStats(stats);

        // Register class stats export
        const statsRows = stats.map(s => {
            const attT = s.attendance.total;
            return {
                subject: s.subject,
                class_name: s.class_name,
                student_count: s.student_count,
                att_present: s.attendance.present,
                att_late: s.attendance.late,
                att_absent: s.attendance.absent,
                att_excused: s.attendance.excused,
                att_rate: attT ? Math.round((s.attendance.present / attT) * 100) + "%" : "N/A",
                grade_avg: s.grades.average !== null ? s.grades.average.toFixed(1) : "–",
                grade_count: s.grades.count,
                hw_assigned: s.homework.assigned,
                hw_completed: s.homework.completed,
                hw_partial: s.homework.partial,
                hw_not_done: s.homework.not_done,
                beh_positive: s.behavioral.positive,
                beh_negative: s.behavioral.negative,
                beh_note: s.behavioral.note,
            };
        });
        _registerExport("expClassStats", statsRows,
            ["subject", "class_name", "student_count", "att_present", "att_late", "att_absent", "att_excused", "att_rate", "grade_avg", "grade_count", "hw_assigned", "hw_completed", "hw_partial", "hw_not_done", "beh_positive", "beh_negative", "beh_note"],
            { subject: "Subject", class_name: "Class", student_count: "Students", att_present: "Present", att_late: "Late", att_absent: "Absent", att_excused: "Excused", att_rate: "Att. Rate", grade_avg: "Grade Avg", grade_count: "Grades", hw_assigned: "HW Assigned", hw_completed: "HW Done", hw_partial: "HW Partial", hw_not_done: "HW Not Done", beh_positive: "Positive", beh_negative: "Negative", beh_note: "Notes" },
            "class_statistics");
    } catch (err) {
        container.innerHTML = '<p class="empty-state">Failed to load statistics.</p>';
    }
}

// Auto-refresh class stats every 30 seconds (only when stats tab is visible)
let _statsInterval = setInterval(async () => {
    if (document.hidden || currentTeacherTab !== "statistics" || !statsLoaded) return;
    try {
        invalidateApiCache("/teacher/class-stats");
        const res = await apiFetch("/teacher/class-stats/");
        const data = await res.json();
        const stats = data.stats || [];
        renderClassStats(stats);
    } catch (err) {
        console.error("Failed to refresh class stats:", err);
    }
}, 30000);

/* ---- Ring diagram generators ---- */
function generateAttendanceRing(present, late, absent, excused, total) {
    if (total === 0) {
        return '<div class="stat-sub">No attendance data</div>';
    }
    
    const presentPct = (present / total) * 100;
    const latePct = (late / total) * 100;
    const absentPct = (absent / total) * 100;
    const excusedPct = (excused / total) * 100;
    
    const presentExact = Number(presentPct.toFixed(2));
    const lateExact = Number(latePct.toFixed(2));
    const absentExact = Number(absentPct.toFixed(2));
    const excusedExact = Number(excusedPct.toFixed(2));
    
    let offset = 0;
    const sectors = [];
    if (present > 0) {
        sectors.push(generateRingSector(offset, presentExact, '#10b981', 'Present', presentExact));
        offset += presentExact;
    }
    if (late > 0) {
        sectors.push(generateRingSector(offset, lateExact, '#fcd34d', 'Late', lateExact));
        offset += lateExact;
    }
    if (absent > 0) {
        sectors.push(generateRingSector(offset, absentExact, '#f87171', 'Absent', absentExact));
        offset += absentExact;
    }
    if (excused > 0) {
        sectors.push(generateRingSector(offset, excusedExact, '#60a5fa', 'Excused', excusedExact));
        offset += excusedExact;
    }
    
    return `
        <svg class="stat-ring" viewBox="0 0 100 100" width="120" height="120">
            ${sectors.join('')}
        </svg>
    `;
}

function generateRingSector(startPct, sizePct, color, label, percent) {
    if (sizePct <= 0) return '';
    
    const radius = 35;
    const circumference = 2 * Math.PI * radius;
    const dasharray = (sizePct / 100) * circumference;
    const offset = (startPct / 100) * circumference;
    
    return `
        <g class="stat-ring-sector-group" data-color="${color}">
            <circle class="stat-ring-sector" cx="50" cy="50" r="${radius}" 
                    fill="none" stroke="${color}" stroke-width="14"
                    stroke-dasharray="${dasharray} ${circumference}"
                    stroke-dashoffset="${-offset}"
                    stroke-linecap="round">
            </circle>
            <title>${label}: ${percent}%</title>
        </g>
    `;
}

function generateBehavioralRing(positive, negative, note) {
    const total = positive + negative + note;
    if (total === 0) return '<div class="stat-sub">No behavioral data</div>';
    
    const positivePct = (positive / total) * 100;
    const negativePct = (negative / total) * 100;
    const notePct = (note / total) * 100;
    
    const positiveExact = Number(positivePct.toFixed(2));
    const negativeExact = Number(negativePct.toFixed(2));
    const noteExact = Number(notePct.toFixed(2));
    
    let offset = 0;
    const sectors = [];
    if (positive > 0) {
        sectors.push(generateRingSector(offset, positiveExact, '#10b981', 'Positive', positiveExact));
        offset += positiveExact;
    }
    if (negative > 0) {
        sectors.push(generateRingSector(offset, negativeExact, '#f87171', 'Negative', negativeExact));
        offset += negativeExact;
    }
    if (note > 0) {
        sectors.push(generateRingSector(offset, noteExact, '#fbbf24', 'Note', noteExact));
        offset += noteExact;
    }
    
    return `
        <svg class="stat-ring" viewBox="0 0 100 100" width="120" height="120">
            ${sectors.join('')}
        </svg>
    `;
}

function statCardKey(stat) {
    return `stat-${String(stat.subject_id || '').replace(/[^a-zA-Z0-9_-]/g, '')}-${String(stat.class_id || '').replace(/[^a-zA-Z0-9_-]/g, '')}`;
}

function renderClassStats(stats) {
    const container = document.getElementById("classStatsList");
    if (stats.length === 0) {
        container.innerHTML = '<p class="empty-state">No class data yet.</p>';
        return;
    }

    container.innerHTML = stats.map(s => {
        const attTotal = s.attendance.total;
        const attRate = attTotal ? Math.round((s.attendance.present / attTotal) * 100) : 0;
        const lateRate = attTotal ? Math.round((s.attendance.late / attTotal) * 100) : 0;
        const absentRate = attTotal ? Math.round((s.attendance.absent / attTotal) * 100) : 0;

        const hwTotal = s.homework.completed + s.homework.partial + s.homework.not_done;

        const gradeAvg = s.grades.average !== null ? s.grades.average.toFixed(1) : "–";
        
        const classId = statCardKey(s);

        return `
        <div class="stat-card" data-class-id="${classId}" data-subject="${escHtml(s.subject)}" data-class-name="${escHtml(s.class_name)}">
            <div class="stat-card-header">
                <div style="display:flex;align-items:center;gap:8px;flex:1;">
                    <span class="stat-card-title">${escHtml(s.subject)} – ${escHtml(s.class_name)}</span>
                    <span class="stat-card-students">${s.student_count} student${s.student_count !== 1 ? 's' : ''}</span>
                </div>
                <button class="stat-collapse-btn" title="Hide/Show statistics" data-class-id="${classId}">−</button>
            </div>
            <div class="stat-card-content">
                <div class="stat-grid">
                    <div class="stat-block">
                        <div class="stat-block-title">📅 Attendance</div>
                        <div class="stat-ring-container" id="att-ring-${classId}">
                            ${generateAttendanceRing(s.attendance.present, s.attendance.late, s.attendance.absent, s.attendance.excused, attTotal)}
                        </div>
                        <div class="stat-legend">
                            <span class="stat-dot stat-dot-present"></span> <span class="att-present-${classId}">${s.attendance.present}</span>
                            <span class="stat-dot stat-dot-late"></span> <span class="att-late-${classId}">${s.attendance.late}</span>
                            <span class="stat-dot stat-dot-absent"></span> <span class="att-absent-${classId}">${s.attendance.absent}</span>
                            <span class="stat-dot stat-dot-excused"></span> <span class="att-excused-${classId}">${s.attendance.excused}</span>
                        </div>
                    </div>
                <div class="stat-block">
                    <div class="stat-block-title">📊 Grades</div>
                    <div class="stat-big grade-avg-${classId}">${gradeAvg}</div>
                    <div class="stat-sub grade-count-${classId}">${s.grades.count} grade${s.grades.count !== 1 ? 's' : ''} recorded</div>
                </div>
                <div class="stat-block">
                    <div class="stat-block-title">📝 Homework</div>
                    <div class="stat-sub hw-assigned-${classId}">${s.homework.assigned} assigned</div>
                    <div class="hw-content-${classId}">
                        ${hwTotal > 0 ? `
                        <div class="stat-hw-row">
                            <span class="stat-hw-chip stat-hw-done">✅ <span class="hw-completed-${classId}">${s.homework.completed}</span></span>
                            <span class="stat-hw-chip stat-hw-partial">⚠️ <span class="hw-partial-${classId}">${s.homework.partial}</span></span>
                            <span class="stat-hw-chip stat-hw-not">❌ <span class="hw-not-${classId}">${s.homework.not_done}</span></span>
                        </div>` : '<div class="stat-sub">No completions yet</div>'}
                    </div>
                </div>
                <div class="stat-block">
                    <div class="stat-block-title">📋 Behavioral</div>
                    <div class="stat-ring-container" id="behav-ring-${classId}">
                        ${generateBehavioralRing(s.behavioral.positive, s.behavioral.negative, s.behavioral.note)}
                    </div>
                    <div class="behav-legend-${classId}">
                        ${(s.behavioral.positive + s.behavioral.negative + s.behavioral.note) > 0 ? `
                        <div style="display:flex;gap:12px;justify-content:center;margin-top:8px;flex-wrap:wrap;font-size:0.85rem;">
                            <span><span style="display:inline-block;width:12px;height:12px;background:#10b981;border-radius:2px;margin-right:4px;"></span>👍 <span class="behav-positive-${classId}">${s.behavioral.positive}</span></span>
                            <span><span style="display:inline-block;width:12px;height:12px;background:#f87171;border-radius:2px;margin-right:4px;"></span>👎 <span class="behav-negative-${classId}">${s.behavioral.negative}</span></span>
                            <span><span style="display:inline-block;width:12px;height:12px;background:#fbbf24;border-radius:2px;margin-right:4px;"></span>📝 <span class="behav-note-${classId}">${s.behavioral.note}</span></span>
                        </div>` : '<div class="stat-sub">No behavioral data</div>'}
                    </div>
                </div>
                </div>
            </div>
        </div>`;
    }).join("");
    
    // Initialize collapse buttons for class stats
    container.querySelectorAll(".stat-collapse-btn").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.preventDefault();
            const classId = btn.getAttribute("data-class-id");
            const card = container.querySelector(`.stat-card[data-class-id="${classId}"]`);
            
            card.classList.toggle("stat-collapsed");
            
            // Save state to localStorage
            if (card.classList.contains("stat-collapsed")) {
                let collapsed = JSON.parse(localStorage.getItem("collapsedStats") || "[]");
                if (!collapsed.includes(classId)) {
                    collapsed.push(classId);
                }
                localStorage.setItem("collapsedStats", JSON.stringify(collapsed));
            } else {
                let collapsed = JSON.parse(localStorage.getItem("collapsedStats") || "[]");
                collapsed = collapsed.filter(id => id !== classId);
                localStorage.setItem("collapsedStats", JSON.stringify(collapsed));
            }
        });
    });
    
    // Restore collapsed state from localStorage
    const collapsedStats = JSON.parse(localStorage.getItem("collapsedStats") || "[]");
    collapsedStats.forEach(classId => {
        const card = container.querySelector(`.stat-card[data-class-id="${classId}"]`);
        if (card) {
            card.classList.add("stat-collapsed");
        }
    });
}

/* ---- Update class stats in real-time ---- */
function updateClassStats(stats) {
    const container = document.getElementById("classStatsList");
    if (!container) return;
    
    stats.forEach(s => {
        const classId = statCardKey(s);
        const card = container.querySelector(`.stat-card[data-class-id="${classId}"]`);
        
        if (!card) return; // Card doesn't exist, wasn't rendered
        
        const attTotal = s.attendance.total;
        const hwTotal = s.homework.completed + s.homework.partial + s.homework.not_done;
        const gradeAvg = s.grades.average !== null ? s.grades.average.toFixed(1) : "–";
        
        // Update attendance ring
        const attRingContainer = card.querySelector(`#att-ring-${classId}`);
        if (attRingContainer) {
            attRingContainer.innerHTML = generateAttendanceRing(s.attendance.present, s.attendance.late, s.attendance.absent, s.attendance.excused, attTotal);
        }
        
        // Update attendance numbers (with null checks)
        const attPresentEl = card.querySelector(`.att-present-${classId}`);
        if (attPresentEl) attPresentEl.textContent = s.attendance.present;
        const attLateEl = card.querySelector(`.att-late-${classId}`);
        if (attLateEl) attLateEl.textContent = s.attendance.late;
        const attAbsentEl = card.querySelector(`.att-absent-${classId}`);
        if (attAbsentEl) attAbsentEl.textContent = s.attendance.absent;
        const attExcusedEl = card.querySelector(`.att-excused-${classId}`);
        if (attExcusedEl) attExcusedEl.textContent = s.attendance.excused;
        
        // Update grades (with null checks)
        const gradeAvgEl = card.querySelector(`.grade-avg-${classId}`);
        if (gradeAvgEl) gradeAvgEl.textContent = gradeAvg;
        const gradeCountEl = card.querySelector(`.grade-count-${classId}`);
        if (gradeCountEl) gradeCountEl.textContent = `${s.grades.count} grade${s.grades.count !== 1 ? 's' : ''} recorded`;
        
        // Update homework numbers (with null checks)
        const hwAssignedEl = card.querySelector(`.hw-assigned-${classId}`);
        if (hwAssignedEl) hwAssignedEl.textContent = `${s.homework.assigned} assigned`;
        const hwCompletedEl = card.querySelector(`.hw-completed-${classId}`);
        if (hwCompletedEl) hwCompletedEl.textContent = s.homework.completed;
        const hwPartialEl = card.querySelector(`.hw-partial-${classId}`);
        if (hwPartialEl) hwPartialEl.textContent = s.homework.partial;
        const hwNotEl = card.querySelector(`.hw-not-${classId}`);
        if (hwNotEl) hwNotEl.textContent = s.homework.not_done;
        
        // Update behavioral ring
        const behavRingContainer = card.querySelector(`#behav-ring-${classId}`);
        if (behavRingContainer) {
            const behavTotal = s.behavioral.positive + s.behavioral.negative + s.behavioral.note;
            behavRingContainer.innerHTML = generateBehavioralRing(s.behavioral.positive, s.behavioral.negative, s.behavioral.note);
        }
        
        // Update behavioral numbers and visibility
        const behavLegend = card.querySelector(`.behav-legend-${classId}`);
        if (behavLegend) {
            const behavTotal = s.behavioral.positive + s.behavioral.negative + s.behavioral.note;
            if (behavTotal > 0) {
                behavLegend.innerHTML = `
                    <div style="display:flex;gap:12px;justify-content:center;margin-top:8px;flex-wrap:wrap;font-size:0.85rem;">
                        <span><span style="display:inline-block;width:12px;height:12px;background:#10b981;border-radius:2px;margin-right:4px;"></span>👍 <span class="behav-positive-${classId}">${s.behavioral.positive}</span></span>
                        <span><span style="display:inline-block;width:12px;height:12px;background:#f87171;border-radius:2px;margin-right:4px;"></span>👎 <span class="behav-negative-${classId}">${s.behavioral.negative}</span></span>
                        <span><span style="display:inline-block;width:12px;height:12px;background:#fbbf24;border-radius:2px;margin-right:4px;"></span>📝 <span class="behav-note-${classId}">${s.behavioral.note}</span></span>
                    </div>`;
            } else {
                behavLegend.innerHTML = '<div class="stat-sub">No behavioral data</div>';
            }
        }
    });
}

/* ================================================================
   HOMEWORK SECTION
   ================================================================ */

let homeworkAssignments = [];

async function loadHomework() {
    const container = document.getElementById("homeworkList");
    try {
        const res = await apiFetch("/announcements/");
        const data = await res.json();
        homeworkAssignments = data.announcements || [];
        renderHomework();
    } catch (err) {
        container.innerHTML = '<p class="empty-state">Failed to load homework.</p>';
    }
}

function renderHomework() {
    const container = document.getElementById("homeworkList");

    // Register homework export
    const hwRows = homeworkAssignments.map(hw => ({
        title: hw.title,
        subject: hw.subject || "",
        class_name: hw.class_name || "",
        due_date: hw.due_date || "",
        description: hw.body || "",
    }));
    _registerExport("expHomework", hwRows,
        ["title", "subject", "class_name", "due_date", "description"],
        { title: "Title", subject: "Subject", class_name: "Class", due_date: "Due Date", description: "Description" },
        "homework_assignments");

    if (homeworkAssignments.length === 0) {
        container.innerHTML = '<p class="empty-state">No homework assigned yet.</p>';
        return;
    }

    const today = new Date().toISOString().slice(0, 10);
    container.innerHTML = homeworkAssignments.map(hw => {
        const isPast = hw.due_date < today;
        const dueLbl = hw.due_date ? formatDate(hw.due_date) : "";
        return `
        <div class="hw-item${isPast ? ' hw-past' : ''}" data-hw-id="${hw.id}" data-subject-id="${hw.subject_id}" data-class-id="${hw.class_id}" style="cursor:pointer;">
            <div class="hw-item-main">
                <div class="hw-item-title">${escHtml(hw.title)}</div>
                <div class="hw-item-meta">
                    ${escHtml(hw.subject)}${hw.class_name ? ' · ' + escHtml(hw.class_name) : ''}
                    ${dueLbl ? ' · Due: ' + dueLbl : ''}
                </div>
                ${hw.body ? `<div class="hw-item-desc">${escHtml(hw.body)}</div>` : ""}
            </div>
            <button class="btn btn-danger btn-sm hw-delete-btn" data-id="${hw.id}" title="Delete">&times;</button>
        </div>`;
    }).join("");

    container.querySelectorAll(".hw-delete-btn").forEach(btn => {
        btn.addEventListener("click", async (e) => {
            e.stopPropagation();
            const ok = await showConfirm("Delete this homework? This cannot be undone.", { title: "Delete Homework", confirmText: "Delete" });
            if (!ok) return;
            try {
                await apiFetch("/teacher/homework/delete/", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ id: btn.dataset.id }),
                });
                await loadHomework();
            } catch (err) {
                showToast("Failed to delete homework", "error");
            }
        });
    });

    // Click on a homework item opens the completion modal
    container.querySelectorAll(".hw-item").forEach(item => {
        item.addEventListener("click", (e) => {
            if (e.target.closest(".hw-delete-btn")) return;
            const hwId = item.dataset.hwId;
            const hw = homeworkAssignments.find(h => h.id === hwId);
            if (hw) openHwCompletionModal(hw);
        });
    });
}

function openHomeworkModal() {
    // Populate the class/subject dropdown from schedule data
    const select = document.getElementById("hwClassSelect");
    const seen = new Set();
    const options = [];
    for (const s of allSlots) {
        const key = `${s.subject_id}|${s.class_id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const label = `${s.subject} – ${s.class_name || 'Year ' + s.grade_level}`;
        options.push({ key, label, subject_id: s.subject_id, class_id: s.class_id });
    }
    options.sort((a, b) => a.label.localeCompare(b.label));
    select.innerHTML = options.map(o =>
        `<option value="${o.key}" data-subject="${o.subject_id}" data-class="${o.class_id}">${escHtml(o.label)}</option>`
    ).join("");

    // Set default due date to tomorrow
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    document.getElementById("hwDueDate").value = tomorrow.toISOString().slice(0, 10);
    document.getElementById("hwTitle").value = "";
    document.getElementById("hwDesc").value = "";

    document.getElementById("homeworkModal").style.display = "flex";
}

async function saveHomework() {
    const select = document.getElementById("hwClassSelect");
    const opt = select.options[select.selectedIndex];
    const subject_id = opt.dataset.subject;
    const class_id = opt.dataset.class;
    const title = document.getElementById("hwTitle").value.trim();
    const description = document.getElementById("hwDesc").value.trim();
    const due_date = document.getElementById("hwDueDate").value;

    if (!title) { showToast("Title is required", "warning"); return; }
    if (!due_date) { showToast("Due date is required", "warning"); return; }

    const btn = document.getElementById("hwSave");
    btn.disabled = true;
    btn.textContent = "Saving…";

    try {
        await apiFetch("/teacher/homework/add/", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ subject_id, class_id, title, description, due_date }),
        });
        document.getElementById("homeworkModal").style.display = "none";
        await loadHomework();
    } catch (err) {
        showToast("Failed to save homework", "error");
    } finally {
        btn.disabled = false;
        btn.textContent = "Save Homework";
    }
}

/* ---- Homework completion modal -------------------------------- */
const HW_STATUS_OPTIONS = [
    { value: "", label: "— Not set —" },
    { value: "completed", label: "✅ Completed" },
    { value: "partial", label: "⚠️ Partial" },
    { value: "not_done", label: "❌ Not done" },
];

async function openHwCompletionModal(hw) {
    const modal = document.getElementById("hwCompletionModal");
    document.getElementById("hwCompTitle").textContent = hw.title;
    document.getElementById("hwCompSubtitle").textContent =
        `${hw.subject}${hw.class_name ? ' · ' + hw.class_name : ''}${hw.due_date ? ' · Due: ' + formatDate(hw.due_date) : ''}`;

    const listEl = document.getElementById("hwCompStudentList");
    listEl.innerHTML = '<p class="loading">Loading students…</p>';
    modal.style.display = "flex";

    // Close handlers
    document.getElementById("hwCompClose").onclick = () => { modal.style.display = "none"; };
    modal.onclick = (e) => { if (e.target === modal) modal.style.display = "none"; };

    try {
        const [studentsRes, compRes] = await Promise.all([
            apiFetch(`/teacher/class-students/?class_id=${hw.class_id}&subject_id=${hw.subject_id}`),
            apiFetch(`/teacher/homework/completions/?homework_id=${hw.id}`),
        ]);
        const studentsData = await studentsRes.json();
        const compData = await compRes.json();

        const students = studentsData.students || [];
        const completions = compData.completions || [];
        const compMap = {};
        for (const c of completions) compMap[c.student_id] = c.status;

        if (students.length === 0) {
            listEl.innerHTML = '<p class="empty-state">No students enrolled.</p>';
            return;
        }

        listEl.innerHTML = `
            <table class="attendance-table">
                <thead>
                    <tr><th>#</th><th>Student</th><th>Class</th><th>Status</th></tr>
                </thead>
                <tbody>
                    ${students.map((s, i) => {
                        const cur = compMap[s.id] || "";
                        return `
                        <tr data-student-id="${s.id}">
                            <td>${i + 1}</td>
                            <td>${escHtml(s.surname)} ${escHtml(s.name)}</td>
                            <td><span class="class-tag">${escHtml(s.class_name || "")}</span></td>
                            <td>
                                <select class="status-select hw-comp-select${cur ? ' hwc-' + cur : ''}">
                                    ${HW_STATUS_OPTIONS.map(o =>
                                        `<option value="${o.value}"${o.value === cur ? " selected" : ""}>${o.label}</option>`
                                    ).join("")}
                                </select>
                            </td>
                        </tr>`;
                    }).join("")}
                </tbody>
            </table>
        `;

        // Update select styling
        listEl.querySelectorAll(".hw-comp-select").forEach(sel => {
            updateHwCompStyle(sel);
            sel.addEventListener("change", () => updateHwCompStyle(sel));
        });

        // Save button
        document.getElementById("hwCompSave").onclick = () => saveHwCompletions(hw.id);

    } catch (err) {
        listEl.innerHTML = '<p class="empty-state">Failed to load students.</p>';
    }
}

function updateHwCompStyle(sel) {
    sel.className = "status-select hw-comp-select" + (sel.value ? " hwc-" + sel.value : "");
}

async function saveHwCompletions(homeworkId) {
    const btn = document.getElementById("hwCompSave");
    const rows = document.querySelectorAll("#hwCompStudentList tbody tr");
    const records = [];
    rows.forEach(row => {
        const studentId = row.dataset.studentId;
        const status = row.querySelector(".hw-comp-select").value;
        records.push({ student_id: studentId, status });
    });

    btn.disabled = true;
    btn.textContent = "Saving…";
    try {
        await apiFetch("/teacher/homework/completions/", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ homework_id: homeworkId, records }),
        });
        document.getElementById("hwCompletionModal").style.display = "none";
    } catch (err) {
        showToast("Failed to save completion status", "error");
    } finally {
        btn.disabled = false;
        btn.textContent = "Save Completion";
    }
}

// Wire up homework buttons after DOM ready
document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("addHomeworkBtn")?.addEventListener("click", openHomeworkModal);
    document.getElementById("hwModalClose")?.addEventListener("click", () => {
        document.getElementById("homeworkModal").style.display = "none";
    });
    document.getElementById("hwSave")?.addEventListener("click", saveHomework);

    // Behavioral buttons
    document.getElementById("addBehavioralBtn")?.addEventListener("click", openBehavioralModal);
    document.getElementById("behModalClose")?.addEventListener("click", () => {
        document.getElementById("behavioralModal").style.display = "none";
    });
    document.getElementById("behSave")?.addEventListener("click", saveBehavioral);
    document.getElementById("behClassSelect")?.addEventListener("change", loadStudentsForBehavioral);
});


/* ================================================================
   BEHAVIORAL NOTES SECTION
   ================================================================ */

let behavioralEntries = [];

async function loadBehavioral() {
    const container = document.getElementById("behavioralList");
    try {
        const res = await apiFetch("/behavioral/");
        const data = await res.json();
        behavioralEntries = data.entries || [];
        renderBehavioral();
    } catch (err) {
        container.innerHTML = '<p class="empty-state">Failed to load behavioral notes.</p>';
    }
}

const TYPE_ICONS = { positive: "👍", negative: "👎", note: "📝" };
const SEVERITY_LABELS = { low: "Low", medium: "Medium", high: "High" };

function renderBehavioral() {
    const container = document.getElementById("behavioralList");

    // Register behavioral export
    const behRows = behavioralEntries.map(e => ({
        student: e.student || "",
        entry_type: e.entry_type || "",
        severity: e.severity || "",
        subject: e.subject || "",
        content: e.content || "",
        date: e.created_at ? e.created_at.slice(0, 10) : "",
    }));
    _registerExport("expBehavioral", behRows,
        ["student", "entry_type", "severity", "subject", "content", "date"],
        { student: "Student", entry_type: "Type", severity: "Severity", subject: "Subject", content: "Details", date: "Date" },
        "behavioral_notes");

    if (behavioralEntries.length === 0) {
        container.innerHTML = '<p class="empty-state">No behavioral notes yet.</p>';
        return;
    }

    container.innerHTML = behavioralEntries.map(e => {
        const icon = TYPE_ICONS[e.entry_type] || "📝";
        const sevClass = e.severity === "high" ? "beh-high" : e.severity === "medium" ? "beh-medium" : "beh-low";
        const date = e.created_at ? formatDate(e.created_at.slice(0, 10)) : "";
        return `
        <div class="beh-item ${sevClass}">
            <div class="beh-item-main">
                <div class="beh-item-title">${icon} ${escHtml(e.student || "Unknown student")}</div>
                <div class="beh-item-meta">
                    ${e.entry_type ? escHtml(e.entry_type) : ""}${e.severity ? " · " + SEVERITY_LABELS[e.severity] : ""}${e.subject ? " · " + escHtml(e.subject) : ""}${date ? " · " + date : ""}
                </div>
                <div class="beh-item-content">${escHtml(e.content)}</div>
            </div>
            <button class="btn btn-danger btn-sm beh-delete-btn" data-id="${e.id}" title="Delete">&times;</button>
        </div>`;
    }).join("");

    container.querySelectorAll(".beh-delete-btn").forEach(btn => {
        btn.addEventListener("click", async (ev) => {
            ev.stopPropagation();
            const ok = await showConfirm("Delete this behavioral note? This cannot be undone.", { title: "Delete Note", confirmText: "Delete" });
            if (!ok) return;
            try {
                await apiFetch("/teacher/behavioral/delete/", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ id: btn.dataset.id }),
                });
                await loadBehavioral();
            } catch (err) {
                showToast("Failed to delete note", "error");
            }
        });
    });
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

function openBehavioralModal() {
    // Populate the class/subject dropdown from schedule data
    const select = document.getElementById("behClassSelect");
    const seen = new Set();
    const options = [];
    for (const s of allSlots) {
        const key = `${s.subject_id}|${s.class_id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const label = `${s.subject} – ${s.class_name || 'Year ' + s.grade_level}`;
        options.push({ key, label, subject_id: s.subject_id, class_id: s.class_id });
    }
    options.sort((a, b) => a.label.localeCompare(b.label));
    select.innerHTML = options.map(o =>
        `<option value="${o.key}" data-subject="${o.subject_id}" data-class="${o.class_id}">${escHtml(o.label)}</option>`
    ).join("");

    // Reset fields
    document.getElementById("behType").value = "positive";
    document.getElementById("behSeverity").value = "low";
    document.getElementById("behContent").value = "";

    document.getElementById("behavioralModal").style.display = "flex";

    // Trigger student loading for the first class
    loadStudentsForBehavioral();
}

async function loadStudentsForBehavioral() {
    const select = document.getElementById("behClassSelect");
    const stuSelect = document.getElementById("behStudentSelect");
    const opt = select.options[select.selectedIndex];
    if (!opt) return;

    const subject_id = opt.dataset.subject;
    const class_id = opt.dataset.class;

    stuSelect.innerHTML = '<option value="">Loading…</option>';

    try {
        const res = await apiFetch(`/teacher/class-students/?subject_id=${subject_id}&class_id=${class_id}`);
        const data = await res.json();
        const students = data.students || [];
        if (students.length === 0) {
            stuSelect.innerHTML = '<option value="">No students</option>';
            return;
        }
        stuSelect.innerHTML = students
            .sort((a, b) => a.surname.localeCompare(b.surname) || a.name.localeCompare(b.name))
            .map(s => `<option value="${s.id}">${escHtml(s.surname)} ${escHtml(s.name)}</option>`)
            .join("");
    } catch (err) {
        stuSelect.innerHTML = '<option value="">Failed to load</option>';
    }
}

async function saveBehavioral() {
    const classSelect = document.getElementById("behClassSelect");
    const classOpt = classSelect.options[classSelect.selectedIndex];
    const subject_id = classOpt.dataset.subject;
    const class_id = classOpt.dataset.class;
    const student_id = document.getElementById("behStudentSelect").value;
    const entry_type = document.getElementById("behType").value;
    const severity = document.getElementById("behSeverity").value;
    const content = document.getElementById("behContent").value.trim();

    if (!student_id) { showToast("Please select a student", "warning"); return; }
    if (!content) { showToast("Please enter details", "warning"); return; }

    const btn = document.getElementById("behSave");
    btn.disabled = true;
    btn.textContent = "Saving…";

    try {
        await apiFetch("/teacher/behavioral/add/", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ student_id, subject_id, class_id, entry_type, severity, content }),
        });
        document.getElementById("behavioralModal").style.display = "none";
        await loadBehavioral();
    } catch (err) {
        showToast("Failed to save behavioral note", "error");
    } finally {
        btn.disabled = false;
        btn.textContent = "Save Note";
    }
}

/* ================================================================
   Study Hall – duty teacher takes attendance of free students
   ================================================================ */

let studyHallSessionId = null;

async function loadStudyHall() {
    const container = document.getElementById("studyHallList");
    try {
        const res = await apiFetch("/teacher/study-hall/");
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.message || `HTTP ${res.status}`);
        }
        const data = await res.json();
        const sessions = data.sessions || [];

        if (sessions.length === 0) {
            container.innerHTML = '<p class="empty-state">No study hall sessions yet. Click "+ New Session" to create one.</p>';
            return;
        }

        container.innerHTML = `
            <table class="attendance-table">
                <thead><tr><th>Date</th><th>Period</th><th>Room</th><th>Actions</th></tr></thead>
                <tbody>${sessions.map(s => {
                    const time = PERIOD_TIMES[s.period - 1] || `Period ${s.period}`;
                    return `<tr>
                        <td>${escHtml(s.date)}</td>
                        <td>${s.period} <small style="color:var(--text-lighter)">(${time})</small></td>
                        <td>${escHtml(s.room || "—")}</td>
                        <td>
                            <button class="btn btn-sm btn-primary" onclick='openStudyHallSession(${JSON.stringify(s).replace(/'/g, "&#39;")})'>View / Edit</button>
                        </td>
                    </tr>`;
                }).join("")}</tbody>
            </table>
        `;
    } catch (err) {
        container.innerHTML = `<p class="empty-state">Failed to load study hall sessions: ${escHtml(err.message)}</p>`;
    }
}

function openStudyHallModal() {
    // Block if today is a holiday
    const todayStr = new Date().toISOString().slice(0, 10);
    const hol = teacherHolidays.find(
        h => todayStr >= h.start_date && todayStr <= (h.end_date || h.start_date)
    );
    if (hol) {
        showToast(`Cannot create a study hall session — today is a holiday (${hol.name}).`, "warning");
        return;
    }

    const modal = document.getElementById("studyHallModal");
    const dateInput = document.getElementById("shDate");
    const periodSelect = document.getElementById("shPeriod");
    const roomInput = document.getElementById("shRoom");
    const studentList = document.getElementById("shStudentList");

    studyHallSessionId = null;
    dateInput.value = new Date().toISOString().slice(0, 10);
    periodSelect.value = "";
    roomInput.value = "";
    studentList.innerHTML = '<p class="empty-state">Select a date and period to load free students.</p>';

    document.getElementById("shModalTitle").textContent = "Study Hall Attendance";
    document.getElementById("shModalSubtitle").textContent = "";

    modal.style.display = "flex";

    // Wire events
    document.getElementById("shModalClose").onclick = () => { modal.style.display = "none"; };
    modal.onclick = (e) => { if (e.target === modal) modal.style.display = "none"; };

    const loadFreeStudents = () => {
        if (dateInput.value && periodSelect.value) {
            fetchFreeStudents(dateInput.value, periodSelect.value);
        }
    };
    dateInput.onchange = loadFreeStudents;
    periodSelect.onchange = loadFreeStudents;

    document.getElementById("shMarkAllPresent").onclick = () => {
        document.querySelectorAll("#shStudentList .status-select").forEach(sel => {
            sel.value = "Present";
            sel.className = "status-select status-present";
        });
    };
    document.getElementById("shSaveAttendance").onclick = saveStudyHallAttendance;
}

function openStudyHallSession(session) {
    const modal = document.getElementById("studyHallModal");
    const dateInput = document.getElementById("shDate");
    const periodSelect = document.getElementById("shPeriod");
    const roomInput = document.getElementById("shRoom");

    studyHallSessionId = session.id;
    dateInput.value = session.date;
    periodSelect.value = String(session.period);
    roomInput.value = session.room || "";

    document.getElementById("shModalTitle").textContent = "Edit Study Hall";
    const time = PERIOD_TIMES[session.period - 1] || `Period ${session.period}`;
    document.getElementById("shModalSubtitle").textContent = `${session.date} · ${time}`;

    modal.style.display = "flex";

    document.getElementById("shModalClose").onclick = () => { modal.style.display = "none"; };
    modal.onclick = (e) => { if (e.target === modal) modal.style.display = "none"; };

    const loadFreeStudents = () => {
        if (dateInput.value && periodSelect.value) {
            fetchFreeStudents(dateInput.value, periodSelect.value);
        }
    };
    dateInput.onchange = loadFreeStudents;
    periodSelect.onchange = loadFreeStudents;

    document.getElementById("shMarkAllPresent").onclick = () => {
        document.querySelectorAll("#shStudentList .status-select").forEach(sel => {
            sel.value = "Present";
            sel.className = "status-select status-present";
        });
    };
    document.getElementById("shSaveAttendance").onclick = saveStudyHallAttendance;

    // Load students immediately
    fetchFreeStudents(session.date, session.period);
}

async function fetchFreeStudents(date, period) {
    const studentList = document.getElementById("shStudentList");
    studentList.innerHTML = '<p class="loading">Loading free students…</p>';

    try {
        const res = await apiFetch(`/teacher/study-hall/students/?date=${date}&period=${period}`);
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.message || `HTTP ${res.status}`);
        }
        const data = await res.json();
        const students = data.students || [];
        const existing = data.attendance || [];

        if (students.length === 0) {
            studentList.innerHTML = '<p class="empty-state">No students are free during this period.</p>';
            return;
        }

        // Build lookup for existing attendance
        const attMap = {};
        for (const a of existing) {
            attMap[a.student_id] = a.status;
        }

        studentList.innerHTML = `
            <p style="color:var(--text-lighter);margin-bottom:8px;font-size:0.88rem">${students.length} student${students.length !== 1 ? "s" : ""} without a class this period</p>
            <table class="attendance-table">
                <thead><tr><th>#</th><th>Student</th><th>Class</th><th>Status</th></tr></thead>
                <tbody>${students.map((s, i) => {
                    const status = attMap[s.id] || "Absent";
                    return `<tr data-student-id="${s.id}">
                        <td>${i + 1}</td>
                        <td>${escHtml(s.surname)} ${escHtml(s.name)}</td>
                        <td><span class="class-tag">${escHtml(s.class_name || "")}</span></td>
                        <td>
                            <select class="status-select status-${status.toLowerCase()}">
                                <option value="Present" ${status === "Present" ? "selected" : ""}>✅ Present</option>
                                <option value="Absent" ${status === "Absent" ? "selected" : ""}>❌ Absent</option>
                            </select>
                        </td>
                    </tr>`;
                }).join("")}</tbody>
            </table>
        `;

        studentList.querySelectorAll(".status-select").forEach(sel => {
            sel.addEventListener("change", () => {
                sel.className = "status-select status-" + sel.value.toLowerCase();
            });
        });

    } catch (err) {
        studentList.innerHTML = `<p class="empty-state">Failed to load students: ${escHtml(err.message)}</p>`;
    }
}

async function saveStudyHallAttendance() {
    const btn = document.getElementById("shSaveAttendance");
    const date = document.getElementById("shDate").value;
    const period = document.getElementById("shPeriod").value;
    const room = document.getElementById("shRoom").value.trim();

    if (!date || !period) { showToast("Date and period required", "warning"); return; }

    const rows = document.querySelectorAll("#shStudentList tbody tr");
    if (rows.length === 0) { showToast("No students to save", "warning"); return; }

    btn.disabled = true;
    btn.textContent = "Saving…";

    try {
        // Step 1: Create or update the study hall session
        const sessionRes = await apiFetch("/teacher/study-hall/", {
            method: "POST",
            body: JSON.stringify({ date, period: parseInt(period), room }),
        });
        const sessionData = await sessionRes.json();
        const sessionId = sessionData.session_id || studyHallSessionId;

        if (!sessionId) {
            showToast("Failed to create session", "error");
            btn.disabled = false;
            btn.textContent = "Save Attendance";
            return;
        }

        studyHallSessionId = sessionId;

        // Step 2: Save attendance records
        const records = [];
        rows.forEach(row => {
            const studentId = row.dataset.studentId;
            const status = row.querySelector(".status-select").value;
            records.push({ student_id: studentId, status });
        });

        await apiFetch("/teacher/study-hall/attendance/", {
            method: "POST",
            body: JSON.stringify({ session_id: sessionId, records }),
        });

        btn.textContent = "✓ Saved!";
        btn.classList.add("btn-success");
        showToast("Study hall attendance saved", "success");

        setTimeout(() => {
            btn.textContent = "Save Attendance";
            btn.classList.remove("btn-success");
            btn.disabled = false;
        }, 2000);

        // Refresh the study hall list
        loadStudyHall();

    } catch (err) {
        showToast("Failed to save: " + err.message, "error");
        btn.textContent = "Save Attendance";
        btn.disabled = false;
    }
}

/* ================================================================
   Substitutes – substitute teacher records covering a class
   ================================================================ */

let _subEditId = null; // when editing an existing substitute

async function loadSubstitutes() {
    const container = document.getElementById("substituteList");
    try {
        const res = await apiFetch("/teacher/substitutes/");
        if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.message || `HTTP ${res.status}`); }
        const data = await res.json();
        const subs = data.substitutions || [];

        if (subs.length === 0) {
            container.innerHTML = '<p class="empty-state">No substitute lessons yet. Click "+ Add Substitute" when you cover for another teacher.</p>';
            return;
        }

        container.innerHTML = `
            <table class="attendance-table">
                <thead><tr><th>Date</th><th>Period</th><th>Subject / Class</th><th>For</th><th>Topic</th><th></th></tr></thead>
                <tbody>${subs.map(s => {
                    const time = PERIOD_TIMES[s.period - 1] || `P${s.period}`;
                    return `<tr>
                        <td>${escHtml(s.date)}</td>
                        <td>${s.period} <small style="color:var(--text-lighter)">(${time})</small></td>
                        <td>${escHtml(s.subject)} · ${escHtml(s.class_name)}</td>
                        <td>${escHtml(s.original_teacher)}</td>
                        <td>${escHtml(s.topic || "—")}</td>
                        <td>
                            <button class="btn btn-sm btn-primary" onclick='openSubstituteEdit(${JSON.stringify(s).replace(/'/g, "&#39;")})'>Edit</button>
                            <button class="btn btn-sm btn-danger" onclick="deleteSubstitute('${s.id}')">✕</button>
                        </td>
                    </tr>`;
                }).join("")}</tbody>
            </table>`;
    } catch (err) {
        container.innerHTML = `<p class="empty-state">Failed to load substitutes: ${escHtml(err.message)}</p>`;
    }
}

async function openSubstituteModal() {
    _subEditId = null;
    const modal = document.getElementById("substituteModal");
    const dateInput = document.getElementById("subDate");
    const periodSelect = document.getElementById("subPeriod");
    const classSelect = document.getElementById("subClassSelect");

    document.getElementById("subModalTitle").textContent = "Add Substitute";
    document.getElementById("subModalSubtitle").textContent = "";
    dateInput.value = new Date().toISOString().slice(0, 10);
    periodSelect.value = "";
    classSelect.innerHTML = '<option value="">Select date & period first…</option>';
    document.getElementById("subTopic").value = "";
    document.getElementById("subRoom").value = "";
    document.getElementById("subNote").value = "";
    document.getElementById("subStudentList").innerHTML = "";

    // When date or period changes, fetch available classes
    const fetchClasses = () => {
        if (dateInput.value && periodSelect.value) {
            _loadSubstituteClasses(dateInput.value, periodSelect.value);
        }
    };
    dateInput.onchange = fetchClasses;
    periodSelect.onchange = fetchClasses;

    // When class changes, load students
    classSelect.onchange = () => {
        if (classSelect.value) {
            const opt = classSelect.selectedOptions[0];
            const classId = opt.dataset.classId;
            const subjectId = opt.dataset.subjectId;
            document.getElementById("subRoom").value = opt.dataset.room || "";
            _loadSubstituteStudents(classId, subjectId, dateInput.value);
        } else {
            document.getElementById("subStudentList").innerHTML = "";
        }
    };

    modal.style.display = "flex";
    document.getElementById("subModalClose").onclick = () => { modal.style.display = "none"; };
    modal.onclick = (e) => { if (e.target === modal) modal.style.display = "none"; };
    document.getElementById("subMarkAllPresent").onclick = () => {
        document.querySelectorAll("#subStudentList .status-select").forEach(sel => {
            sel.value = "Present";
            sel.className = "status-select status-present";
        });
    };
    document.getElementById("subSaveBtn").onclick = saveSubstitute;
}

async function openSubstituteEdit(sub) {
    await openSubstituteModal();
    _subEditId = sub.id;
    document.getElementById("subModalTitle").textContent = "Edit Substitute";
    const time = PERIOD_TIMES[sub.period - 1] || `Period ${sub.period}`;
    document.getElementById("subModalSubtitle").textContent = `${sub.date} · ${time} · ${sub.subject} · ${sub.class_name}`;
    document.getElementById("subDate").value = sub.date;
    document.getElementById("subPeriod").value = String(sub.period);
    document.getElementById("subTopic").value = sub.topic || "";
    document.getElementById("subRoom").value = sub.room || "";
    document.getElementById("subNote").value = sub.note || "";

    // Load students for attendance
    _loadSubstituteStudents(sub.class_id, sub.subject_id, sub.date);
}

async function _loadSubstituteClasses(date, period) {
    const classSelect = document.getElementById("subClassSelect");
    classSelect.innerHTML = '<option value="">Loading…</option>';
    try {
        const res = await apiFetch(`/teacher/substitutes/classes/?date=${date}&period=${period}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const classes = data.classes || [];

        if (classes.length === 0) {
            classSelect.innerHTML = '<option value="">No classes available for this slot</option>';
            document.getElementById("subStudentList").innerHTML = "";
            return;
        }

        classSelect.innerHTML = '<option value="">Select class…</option>' +
            classes.map(c =>
                `<option value="${c.schedule_id}" data-class-id="${c.class_id}" data-subject-id="${c.subject_id}" data-room="${escHtml(c.room)}">${escHtml(c.subject)} · ${escHtml(c.class_name)} (${escHtml(c.original_teacher)})</option>`
            ).join("");
    } catch (err) {
        classSelect.innerHTML = '<option value="">Failed to load classes</option>';
    }
}

async function _loadSubstituteStudents(classId, subjectId, date) {
    const container = document.getElementById("subStudentList");
    container.innerHTML = '<p class="loading">Loading students…</p>';
    try {
        // Load students and any existing attendance in parallel
        const [studentsRes, attendanceRes] = await Promise.all([
            apiFetch(`/teacher/class-students/?class_id=${classId}&subject_id=${subjectId}`),
            apiFetch(`/teacher/attendance/?class_id=${classId}&subject_id=${subjectId}&date=${date}`),
        ]);
        const studentsData = await studentsRes.json();
        const attendanceData = await attendanceRes.json();
        const students = studentsData.students || [];
        const existing = attendanceData.attendance || [];

        // Build lookup
        const attMap = {};
        for (const rec of existing) attMap[rec.student_id] = rec;

        if (students.length === 0) {
            container.innerHTML = '<p class="empty-state">No students found for this class/subject.</p>';
            return;
        }

        container.innerHTML = `
            <table class="attendance-table">
                <thead><tr><th>#</th><th>Student</th><th>Class</th><th>Status</th><th>Comment</th></tr></thead>
                <tbody>${students.map((s, i) => {
                    const rec = attMap[s.id] || {};
                    const status = rec.status || "Present";
                    const comment = rec.comment || "";
                    return `<tr data-student-id="${s.id}">
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
                }).join("")}</tbody>
            </table>`;

        container.querySelectorAll(".status-select").forEach(sel => {
            sel.addEventListener("change", () => { sel.className = "status-select status-" + sel.value.toLowerCase(); });
        });
    } catch (err) {
        container.innerHTML = `<p class="empty-state">Failed to load students: ${escHtml(err.message)}</p>`;
    }
}

async function saveSubstitute() {
    const btn = document.getElementById("subSaveBtn");
    const date = document.getElementById("subDate").value;
    const period = document.getElementById("subPeriod").value;
    const classSelect = document.getElementById("subClassSelect");
    const scheduleId = classSelect.value;
    const topic = document.getElementById("subTopic").value.trim();
    const room = document.getElementById("subRoom").value.trim();
    const note = document.getElementById("subNote").value.trim();

    // For edit mode we may not have schedule_id, use _subEditId
    if (!_subEditId && (!date || !period || !scheduleId)) {
        showToast("Please select date, period, and class", "warning");
        return;
    }

    btn.disabled = true;
    btn.textContent = "Saving…";

    try {
        // 1. Save the substitute record
        if (!_subEditId) {
            const res = await apiFetch("/teacher/substitutes/", {
                method: "POST",
                body: JSON.stringify({ date, period: parseInt(period), schedule_id: scheduleId, room, note, topic }),
            });
            if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.message || `HTTP ${res.status}`); }
        }

        // 2. Save attendance (use existing attendance endpoint)
        const opt = _subEditId ? null : classSelect.selectedOptions[0];
        const classId = _subEditId ? null : opt?.dataset.classId;
        const subjectId = _subEditId ? null : opt?.dataset.subjectId;

        const rows = document.querySelectorAll("#subStudentList tbody tr[data-student-id]");
        if (rows.length > 0) {
            const records = [];
            rows.forEach(row => {
                records.push({
                    student_id: row.dataset.studentId,
                    status: row.querySelector(".status-select").value,
                    comment: row.querySelector(".comment-input").value.trim(),
                });
            });

            // We need class_id and subject_id for attendance
            // For edit mode, get from the substitute data
            let attClassId = classId;
            let attSubjectId = subjectId;
            if (_subEditId) {
                // Get from the subtitle or stored data
                const subRes = await apiFetch("/teacher/substitutes/");
                if (subRes.ok) {
                    const subData = await subRes.json();
                    const mySub = (subData.substitutions || []).find(s => s.id === _subEditId);
                    if (mySub) {
                        attClassId = mySub.class_id;
                        attSubjectId = mySub.subject_id;
                    }
                }
            }

            if (attClassId && attSubjectId) {
                await apiFetch("/teacher/attendance/", {
                    method: "POST",
                    body: JSON.stringify({
                        records,
                        class_id: attClassId,
                        subject_id: attSubjectId,
                        date,
                        topic,
                    }),
                });
            }
        }

        showToast("Substitute saved", "success");
        document.getElementById("substituteModal").style.display = "none";
        loadSubstitutes();
    } catch (err) {
        showToast("Failed: " + err.message, "error");
    } finally {
        btn.disabled = false;
        btn.textContent = "Save Substitute";
    }
}

async function deleteSubstitute(id) {
    const ok = await showConfirm("Remove this substitute lesson?", { title: "Remove Substitute", confirmText: "Remove" });
    if (!ok) return;
    try {
        const res = await apiFetch(`/teacher/substitutes/?id=${id}`, { method: "DELETE" });
        if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.message || `HTTP ${res.status}`); }
        showToast("Substitute removed", "success");
        loadSubstitutes();
    } catch (err) {
        showToast("Failed: " + err.message, "error");
    }
}

/* ================================================================
   TEACHER EVENTS (create / list / edit / delete)
   ================================================================ */

let _teacherOwnEvents = [];
let _editingEventId = null;

async function loadTeacherEvents() {
    const container = document.getElementById("eventsList");
    if (!container) return;

    try {
        const res = await apiFetch("/teacher/events/");
        if (!res.ok) throw new Error("HTTP " + res.status);
        const data = await res.json();
        _teacherOwnEvents = data.events || [];
        renderTeacherEvents();
    } catch (err) {
        console.error("[teacher.js] loadTeacherEvents error:", err);
        container.innerHTML = '<p class="empty-state">Failed to load events.</p>';
    }
}

function renderTeacherEvents() {
    const container = document.getElementById("eventsList");
    if (!container) return;

    if (_teacherOwnEvents.length === 0) {
        container.innerHTML = '<p class="empty-state">No events created yet.</p>';
        return;
    }

    const sorted = [..._teacherOwnEvents].sort((a, b) => (a.event_date || "").localeCompare(b.event_date || ""));
    const rows = sorted.map(ev => {
        const dateStr = ev.event_date || "";
        const endStr = ev.event_end_date && ev.event_end_date !== ev.event_date ? ` – ${ev.event_end_date}` : "";
        const periods = (ev.affected_periods || []).length > 0
            ? ev.affected_periods.map(p => `P${p}`).join(", ")
            : (ev.start_time ? `${ev.start_time}${ev.end_time ? " – " + ev.end_time : ""}` : "All day");
        const target = ev.target_type === "all" ? "Everyone"
            : ev.target_type === "students" ? `${(ev.target_student_ids || []).length} students`
            : `${(ev.target_class_ids || []).length} class(es)`;

        return `<tr>
            <td>${escHtml(ev.title)}</td>
            <td>${dateStr}${endStr}</td>
            <td>${periods}</td>
            <td>${target}</td>
            <td style="white-space:nowrap;">
                <button class="btn btn-sm btn-secondary" onclick="editTeacherEvent('${ev.id}')">Edit</button>
                <button class="btn btn-sm" style="background:var(--danger);color:#fff;" onclick="deleteTeacherEvent('${ev.id}')">Delete</button>
            </td>
        </tr>`;
    }).join("");

    container.innerHTML = `<table class="data-table"><thead><tr>
        <th>Title</th><th>Date</th><th>Time / Periods</th><th>Target</th><th>Actions</th>
    </tr></thead><tbody>${rows}</tbody></table>`;
}

function openEventModal(existingEvent) {
    _editingEventId = existingEvent ? existingEvent.id : null;
    const modal = document.getElementById("eventModal");
    document.getElementById("evModalTitle").textContent = existingEvent ? "Edit Event" : "Add Event";

    // Reset fields
    document.getElementById("evTitle").value = existingEvent ? existingEvent.title || "" : "";
    document.getElementById("evDesc").value = existingEvent ? existingEvent.description || "" : "";
    document.getElementById("evDate").value = existingEvent ? existingEvent.event_date || "" : new Date().toISOString().slice(0, 10);
    document.getElementById("evEndDate").value = existingEvent ? existingEvent.event_end_date || "" : "";
    document.getElementById("evStartTime").value = existingEvent ? existingEvent.start_time || "" : "";
    document.getElementById("evEndTime").value = existingEvent ? existingEvent.end_time || "" : "";

    // Period toggles
    const selectedPeriods = new Set((existingEvent?.affected_periods || []).map(String));
    document.querySelectorAll(".ev-period-btn").forEach(btn => {
        const p = btn.dataset.period;
        const active = p === "all" ? selectedPeriods.size === 8 : selectedPeriods.has(p);
        btn.classList.toggle("btn-primary", active);
        btn.classList.toggle("btn-secondary", !active);
    });

    // Target type
    const targetType = existingEvent ? existingEvent.target_type || "class" : "class";
    document.getElementById("evTargetType").value = targetType;

    // Build class checkboxes from schedule
    const seen = new Set();
    const classes = [];
    for (const s of allSlots) {
        const key = s.class_id;
        if (seen.has(key)) continue;
        seen.add(key);
        classes.push({ id: s.class_id, label: s.class_name || "Year " + s.grade_level });
    }
    classes.sort((a, b) => a.label.localeCompare(b.label));

    const selClassIds = new Set((existingEvent?.target_class_ids || []).map(String));
    document.getElementById("evClassList").innerHTML = classes.map(c =>
        `<label style="display:block;padding:2px 0;cursor:pointer;">
            <input type="checkbox" class="ev-class-cb" value="${c.id}" ${selClassIds.has(c.id) ? "checked" : ""}>
            ${escHtml(c.label)}
        </label>`
    ).join("");

    // Build student checkboxes – group by class from allSlots
    _buildEventStudentPicker(existingEvent);

    // Show/hide pickers
    _toggleEventTargetPickers(targetType);

    // Bind target type change
    document.getElementById("evTargetType").onchange = (e) => _toggleEventTargetPickers(e.target.value);

    // Period toggle clicks
    document.querySelectorAll(".ev-period-btn").forEach(btn => {
        btn.onclick = () => {
            if (btn.dataset.period === "all") {
                // Toggle all periods
                const allActive = btn.classList.contains("btn-primary");
                document.querySelectorAll(".ev-period-btn").forEach(b => {
                    b.classList.toggle("btn-primary", !allActive);
                    b.classList.toggle("btn-secondary", allActive);
                });
            } else {
                btn.classList.toggle("btn-primary");
                btn.classList.toggle("btn-secondary");
                // Update "All Day" button state
                const allPeriods = document.querySelectorAll('.ev-period-btn:not([data-period="all"])');
                const allActive = [...allPeriods].every(b => b.classList.contains("btn-primary"));
                const allDayBtn = document.querySelector('.ev-period-btn[data-period="all"]');
                if (allDayBtn) {
                    allDayBtn.classList.toggle("btn-primary", allActive);
                    allDayBtn.classList.toggle("btn-secondary", !allActive);
                }
            }
        };
    });

    // Modal close
    document.getElementById("evModalClose").onclick = () => { modal.style.display = "none"; };
    modal.onclick = (e) => { if (e.target === modal) modal.style.display = "none"; };

    // Save handler
    document.getElementById("evSave").onclick = () => saveTeacherEvent();

    modal.style.display = "flex";
}

async function _buildEventStudentPicker(existingEvent) {
    // Fetch students for all teacher classes
    const seen = new Set();
    const classIds = [];
    for (const s of allSlots) {
        if (seen.has(s.class_id)) continue;
        seen.add(s.class_id);
        classIds.push({ class_id: s.class_id, subject_id: s.subject_id, class_name: s.class_name || "Year " + s.grade_level });
    }

    const container = document.getElementById("evStudentList");
    container.innerHTML = '<p class="loading">Loading students…</p>';

    try {
        const fetches = classIds.map(c =>
            apiFetch(`/teacher/class-students/?class_id=${c.class_id}&subject_id=${c.subject_id}`)
                .then(r => r.json())
                .then(d => ({ class_name: c.class_name, students: d.students || [] }))
        );
        const results = await Promise.all(fetches);

        const selStudentIds = new Set((existingEvent?.target_student_ids || []).map(String));
        const studentSeen = new Set();
        let html = "";
        for (const r of results) {
            const uniqueStudents = r.students.filter(st => {
                if (studentSeen.has(st.id)) return false;
                studentSeen.add(st.id);
                return true;
            });
            if (uniqueStudents.length === 0) continue;
            html += `<div style="margin-bottom:6px;"><strong>${escHtml(r.class_name)}</strong></div>`;
            for (const st of uniqueStudents) {
                const name = `${st.first_name || ""} ${st.last_name || ""}`.trim();
                html += `<label style="display:block;padding:2px 0 2px 12px;cursor:pointer;">
                    <input type="checkbox" class="ev-student-cb" value="${st.id}" ${selStudentIds.has(st.id) ? "checked" : ""}>
                    ${escHtml(name)}
                </label>`;
            }
        }
        container.innerHTML = html || '<p class="empty-state">No students found.</p>';
    } catch (err) {
        console.error("[teacher.js] _buildEventStudentPicker error:", err);
        container.innerHTML = '<p class="empty-state">Failed to load students.</p>';
    }
}

function _toggleEventTargetPickers(targetType) {
    document.getElementById("evClassPicker").style.display = targetType === "class" ? "" : "none";
    document.getElementById("evStudentPicker").style.display = targetType === "students" ? "" : "none";
}

async function saveTeacherEvent() {
    const title = document.getElementById("evTitle").value.trim();
    const description = document.getElementById("evDesc").value.trim();
    const event_date = document.getElementById("evDate").value;
    const event_end_date = document.getElementById("evEndDate").value || event_date;
    const start_time = document.getElementById("evStartTime").value || null;
    const end_time = document.getElementById("evEndTime").value || null;

    if (!title || !event_date) {
        showToast("Title and start date are required", "warning");
        return;
    }

    // Collect affected periods
    const affected_periods = [];
    document.querySelectorAll('.ev-period-btn.btn-primary:not([data-period="all"])').forEach(btn => {
        affected_periods.push(parseInt(btn.dataset.period));
    });

    const target_type = document.getElementById("evTargetType").value;
    const target_class_ids = target_type === "class"
        ? [...document.querySelectorAll(".ev-class-cb:checked")].map(cb => cb.value)
        : [];
    const target_student_ids = target_type === "students"
        ? [...document.querySelectorAll(".ev-student-cb:checked")].map(cb => cb.value)
        : [];

    const payload = { title, description, event_date, event_end_date, start_time, end_time, affected_periods, target_type, target_class_ids, target_student_ids };

    try {
        let res;
        if (_editingEventId) {
            res = await apiFetch(`/teacher/events/detail/?id=${_editingEventId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
        } else {
            res = await apiFetch("/teacher/events/", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
        }
        if (!res.ok) {
            const e = await res.json().catch(() => ({}));
            throw new Error(e.message || `HTTP ${res.status}`);
        }
        showToast(_editingEventId ? "Event updated" : "Event created", "success");
        document.getElementById("eventModal").style.display = "none";
        loadTeacherEvents();
    } catch (err) {
        showToast("Failed: " + err.message, "error");
    }
}

async function editTeacherEvent(eventId) {
    const ev = _teacherOwnEvents.find(e => e.id === eventId);
    if (!ev) return;
    openEventModal(ev);
}

async function deleteTeacherEvent(eventId) {
    if (!confirm("Delete this event?")) return;
    try {
        const res = await apiFetch(`/teacher/events/detail/?id=${eventId}`, { method: "DELETE" });
        if (!res.ok) {
            const e = await res.json().catch(() => ({}));
            throw new Error(e.message || `HTTP ${res.status}`);
        }
        showToast("Event deleted", "success");
        loadTeacherEvents();
    } catch (err) {
        showToast("Failed: " + err.message, "error");
    }
}

/* ================================================================
   EXPORT FUNCTIONALITY
   ================================================================ */

const _exportData = {};

function _registerExport(key, rows, columns, headerMap, filename) {
    _exportData[key] = { rows, columns, headerMap, filename };
    renderExportCard();
}

/** Render the Export card content */
function renderExportCard() {
    const container = document.getElementById("exportCardContent");
    if (!container) return;

    const sections = [
        { key: "expSchedule", label: "My Schedule", icon: "📅" },
        { key: "expClassStats", label: "Class Statistics", icon: "📋" },
        { key: "expHomework", label: "Homework / Tasks", icon: "📝" },
        { key: "expBehavioral", label: "Behavioral Notes", icon: "📋" },
    ];

    container.innerHTML = `
        <div class="export-section-list">
            ${sections.map(s => {
                const d = _exportData[s.key];
                const count = d ? d.rows.length : 0;
                const disabled = count === 0 ? 'disabled' : '';
                return `
                <div class="export-row">
                    <div class="export-row-info">
                        <span class="export-row-icon">${s.icon}</span>
                        <span class="export-row-label">${s.label}</span>
                        <span class="export-row-count">${count} record${count !== 1 ? 's' : ''}</span>
                    </div>
                    <div class="export-row-actions">
                        <button class="btn btn-sm btn-outline" ${disabled} onclick="_doExport('${s.key}','csv')">CSV</button>
                        <button class="btn btn-sm btn-primary" ${disabled} onclick="_doExport('${s.key}','excel')">Excel</button>
                    </div>
                </div>`;
            }).join("")}
        </div>
    `;
}

function _doExport(key, format) {
    const d = _exportData[key];
    if (!d || d.rows.length === 0) { showToast("No data to export", "warning"); return; }
    if (format === "csv") exportCSV(d.filename + ".csv", d.rows, d.columns, d.headerMap);
    else exportExcel(d.filename + ".xlsx", d.rows, d.columns, d.headerMap);
}

function _doExportAll(format) {
    const keys = ["expSchedule", "expClassStats", "expHomework", "expBehavioral"];
    const available = keys.filter(k => _exportData[k] && _exportData[k].rows.length > 0);
    if (available.length === 0) { showToast("No data to export", "warning"); return; }

    if (format === "csv") {
        // Export each individually
        available.forEach(k => {
            const d = _exportData[k];
            exportCSV(d.filename + ".csv", d.rows, d.columns, d.headerMap);
        });
    } else {
        // Multi-sheet Excel
        const sheets = available.map(k => {
            const d = _exportData[k];
            return { name: d.filename, rows: d.rows, columns: d.columns, headerMap: d.headerMap };
        });
        exportExcelMultiSheet("teacher_export.xlsx", sheets);
    }
}
