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

document.addEventListener("DOMContentLoaded", async () => {
    if (!requireAuth()) return;
    initNav();
    await fetchSchedule();

    document.getElementById("weekPrev").addEventListener("click", () => { weekOffset--; renderSchedule(); });
    document.getElementById("weekNext").addEventListener("click", () => { weekOffset++; renderSchedule(); });
});

async function fetchSchedule() {
    const container = document.getElementById("scheduleContainer");
    try {
        const res = await apiFetch("/schedule/");
        const data = await res.json();
        scheduleSlots = data.schedule || [];
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

function renderSchedule() {
    const container = document.getElementById("scheduleContainer");
    const user = getUser();
    const isTeacher = user && user.role === "teacher";
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

    // Build lookup: grid[day][period] = slot
    const grid = {};
    let maxPeriod = 0;
    for (const s of slots) {
        if (!grid[s.day_of_week]) grid[s.day_of_week] = {};
        grid[s.day_of_week][s.period] = s;
        if (s.period > maxPeriod) maxPeriod = s.period;
    }

    // Table header with day+date
    let html = '<table class="timetable"><thead><tr><th>Period</th>';
    for (let d = 0; d < 5; d++) {
        const dayDate = new Date(mon); dayDate.setDate(mon.getDate() + d);
        html += `<th>${DAYS[d]}<br><small class="day-date">${shortDate(dayDate)}</small></th>`;
    }
    html += "</tr></thead><tbody>";

    for (let p = 1; p <= Math.max(maxPeriod, 6); p++) {
        const time = PERIOD_TIMES[p - 1] || `Period ${p}`;
        html += `<tr><td><strong>${p}</strong><br><small style="color:#9ca3af">${time}</small></td>`;
        for (let d = 1; d <= 5; d++) {
            const slot = (grid[d] || {})[p];
            if (slot) {
                const yearLabel = (isTeacher && slot.grade_level)
                    ? `Year ${slot.grade_level}`
                    : (slot.room ? "Room " + escHtml(slot.room) : "");
                const cls = isTeacher ? "lesson clickable-lesson" : "lesson";
                // Attach the actual date for this cell
                const cellDate = new Date(mon); cellDate.setDate(mon.getDate() + d - 1);
                const slotWithDate = { ...slot, _date: isoDate(cellDate) };
                html += `<td class="${cls}" data-slot='${JSON.stringify(slotWithDate)}'>
                    ${escHtml(slot.subject)}<br>
                    <span class="lesson-room">${yearLabel}${isTeacher && slot.room ? " · " + escHtml(slot.room) : ""}</span>
                </td>`;
            } else {
                html += "<td>–</td>";
            }
        }
        html += "</tr>";
    }
    html += "</tbody></table>";
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
