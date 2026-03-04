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

/* ---- Bootstrap ------------------------------------------------ */
document.addEventListener("DOMContentLoaded", async () => {
    if (!requireAuth()) return;

    // Redirect students away from teacher page
    const user = getUser();
    if (user && user.role !== "teacher") {
        window.location.href = "dashboard.html";
        return;
    }

    initNav();
    await loadSchedule();

    // Week navigation arrows
    document.getElementById("weekPrev").addEventListener("click", () => { weekOffset--; renderWeeklySchedule(); });
    document.getElementById("weekNext").addEventListener("click", () => { weekOffset++; renderWeeklySchedule(); });

    // Check if redirected from schedule page with an attendance slot to open
    const pending = sessionStorage.getItem("openAttendance");
    if (pending) {
        sessionStorage.removeItem("openAttendance");
        try {
            const slot = JSON.parse(pending);
            openAttendanceModal(slot);
        } catch (e) { /* ignore */ }
    }
});

/* ---- Load schedule from API ----------------------------------- */
async function loadSchedule() {
    try {
        const res = await apiFetch("/schedule/");
        const data = await res.json();
        allSlots = data.schedule || [];
        renderTodayClasses();
        renderWeeklySchedule();
    } catch (err) {
        console.error("[teacher.js] loadSchedule error:", err);
        document.getElementById("todayClasses").innerHTML =
            '<p class="empty-state">Failed to load schedule.</p>';
    }
}

/* ---- Today's classes (clickable cards) ------------------------ */
function renderTodayClasses() {
    const container = document.getElementById("todayClasses");
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
function isoDate(d) { return d.toISOString().slice(0, 10); }

function renderWeeklySchedule() {
    const container = document.getElementById("weeklySchedule");
    const mon = getMonday(weekOffset);
    const fri = new Date(mon); fri.setDate(mon.getDate() + 4);

    // Update week label
    const weekLabel = document.getElementById("weekLabel");
    weekLabel.textContent = `${shortDate(mon)} – ${shortDate(fri)}`;
    const today = new Date(); today.setHours(0,0,0,0);
    weekLabel.classList.toggle("week-current", today >= mon && today <= fri);

    if (allSlots.length === 0) {
        container.innerHTML = '<p class="empty-state">No schedule available.</p>';
        return;
    }

    // Build grid[day][period] = slot
    const grid = {};
    let maxPeriod = 0;
    for (const s of allSlots) {
        if (!grid[s.day_of_week]) grid[s.day_of_week] = {};
        grid[s.day_of_week][s.period] = s;
        if (s.period > maxPeriod) maxPeriod = s.period;
    }

    let html = '<table class="timetable"><thead><tr><th>Period</th>';
    for (let d = 0; d < 5; d++) {
        const dayDate = new Date(mon); dayDate.setDate(mon.getDate() + d);
        html += `<th>${DAYS[d]}<br><small class="day-date">${shortDate(dayDate)}</small></th>`;
    }
    html += "</tr></thead><tbody>";

    for (let p = 1; p <= 8; p++) {
        const time = PERIOD_TIMES[p - 1] || `Period ${p}`;
        html += `<tr><td><strong>${p}</strong><br><small style="color:#9ca3af">${time}</small></td>`;
        for (let d = 1; d <= 5; d++) {
            const slot = (grid[d] || {})[p];
            if (slot) {
                const yrLabel = escHtml(slot.class_name || `Year ${slot.grade_level}`);
                const cellDate = new Date(mon); cellDate.setDate(mon.getDate() + d - 1);
                const slotWithDate = { ...slot, _date: isoDate(cellDate) };
                html += `<td class="lesson clickable-lesson" data-slot='${JSON.stringify(slotWithDate)}'>
                    ${escHtml(slot.subject)}<br>
                    <span class="lesson-room">${yrLabel}${slot.room ? " · " + escHtml(slot.room) : ""}</span>
                </td>`;
            } else {
                html += "<td>–</td>";
            }
        }
        html += "</tr>";
    }
    html += "</tbody></table>";
    container.innerHTML = html;

    // Clicking a lesson in the weekly grid also opens attendance
    container.querySelectorAll(".clickable-lesson").forEach(td => {
        td.addEventListener("click", () => {
            const slot = JSON.parse(td.dataset.slot);
            openAttendanceModal(slot);
        });
    });
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

    try {
        const res = await apiFetch("/teacher/attendance/", {
            method: "POST",
            body: JSON.stringify({
                class_id: currentSlot.class_id,
                subject_id: currentSlot.subject_id,
                date: date,
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
            alert(data.message || "Failed to save attendance");
            btn.textContent = "Save Attendance";
            btn.disabled = false;
        }
    } catch (err) {
        alert("Error saving attendance");
        btn.textContent = "Save Attendance";
        btn.disabled = false;
    }
}

function closeModal() {
    document.getElementById("attendanceModal").style.display = "none";
    currentSlot = null;
}
