const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const PERIOD_TIMES = [
    "08:00–08:45",
    "08:50–09:35",
    "09:40–10:25",
    "10:40–11:25",
    "11:30–12:15",
    "12:20–13:05",
    "13:30–14:15",
    "14:20–15:05",
];

document.addEventListener("DOMContentLoaded", async () => {
    if (!requireAuth()) return;
    initNav();
    await loadSchedule();
});

async function loadSchedule() {
    const container = document.getElementById("scheduleContainer");
    const user = getUser();
    const isTeacher = user && user.role === "teacher";

    try {
        const res = await apiFetch("/schedule/");
        const data = await res.json();
        const slots = data.schedule || [];

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

        // Table header
        let html = '<table class="timetable"><thead><tr><th>Period</th>';
        for (const day of DAYS) html += `<th>${day}</th>`;
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
                    html += `<td class="${cls}"${isTeacher ? ` data-slot='${JSON.stringify(slot)}'` : ""}>
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
                    // Store the slot and redirect to teacher.html with attendance trigger
                    const slot = JSON.parse(td.dataset.slot);
                    sessionStorage.setItem("openAttendance", JSON.stringify(slot));
                    window.location.href = "teacher.html";
                });
            });
        }
    } catch (err) {
        container.innerHTML = '<p class="empty-state">Failed to load schedule.</p>';
    }
}
