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
    await Promise.all([loadHomework(), loadBehavioral(), loadClassStats()]);

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
    } catch (err) {
        container.innerHTML = '<p class="empty-state">Failed to load statistics.</p>';
    }
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

        return `
        <div class="stat-card">
            <div class="stat-card-header">
                <span class="stat-card-title">${escHtml(s.subject)} – ${escHtml(s.class_name)}</span>
                <span class="stat-card-students">${s.student_count} student${s.student_count !== 1 ? 's' : ''}</span>
            </div>
            <div class="stat-grid">
                <div class="stat-block">
                    <div class="stat-block-title">📅 Attendance</div>
                    <div class="stat-bar-row">
                        <div class="stat-bar" style="flex:1;">
                            <div class="stat-bar-fill stat-bar-present" style="width:${attRate}%" title="Present ${attRate}%"></div>
                            <div class="stat-bar-fill stat-bar-late" style="width:${lateRate}%" title="Late ${lateRate}%"></div>
                            <div class="stat-bar-fill stat-bar-absent" style="width:${absentRate}%" title="Absent ${absentRate}%"></div>
                        </div>
                    </div>
                    <div class="stat-legend">
                        <span class="stat-dot stat-dot-present"></span> ${s.attendance.present}
                        <span class="stat-dot stat-dot-late"></span> ${s.attendance.late}
                        <span class="stat-dot stat-dot-absent"></span> ${s.attendance.absent}
                        <span class="stat-dot stat-dot-excused"></span> ${s.attendance.excused}
                    </div>
                </div>
                <div class="stat-block">
                    <div class="stat-block-title">📊 Grades</div>
                    <div class="stat-big">${gradeAvg}</div>
                    <div class="stat-sub">${s.grades.count} grade${s.grades.count !== 1 ? 's' : ''} recorded</div>
                </div>
                <div class="stat-block">
                    <div class="stat-block-title">📝 Homework</div>
                    <div class="stat-sub">${s.homework.assigned} assigned</div>
                    ${hwTotal > 0 ? `
                    <div class="stat-hw-row">
                        <span class="stat-hw-chip stat-hw-done">✅ ${s.homework.completed}</span>
                        <span class="stat-hw-chip stat-hw-partial">⚠️ ${s.homework.partial}</span>
                        <span class="stat-hw-chip stat-hw-not">❌ ${s.homework.not_done}</span>
                    </div>` : '<div class="stat-sub">No completions yet</div>'}
                </div>
                <div class="stat-block">
                    <div class="stat-block-title">📋 Behavioral</div>
                    <div class="stat-hw-row">
                        <span class="stat-hw-chip stat-hw-done">👍 ${s.behavioral.positive}</span>
                        <span class="stat-hw-chip stat-hw-not">👎 ${s.behavioral.negative}</span>
                        <span class="stat-hw-chip stat-hw-partial">📝 ${s.behavioral.note}</span>
                    </div>
                </div>
            </div>
        </div>`;
    }).join("");
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
            if (!confirm("Delete this homework?")) return;
            try {
                await apiFetch("/teacher/homework/delete/", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ id: btn.dataset.id }),
                });
                await loadHomework();
            } catch (err) {
                alert("Failed to delete homework.");
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

    if (!title) { alert("Title is required."); return; }
    if (!due_date) { alert("Due date is required."); return; }

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
        alert("Failed to save homework.");
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
        alert("Failed to save completion status.");
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
            if (!confirm("Delete this behavioral note?")) return;
            try {
                await apiFetch("/teacher/behavioral/delete/", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ id: btn.dataset.id }),
                });
                await loadBehavioral();
            } catch (err) {
                alert("Failed to delete note.");
            }
        });
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
            .sort((a, b) => a.surname.localeCompare(b.surname))
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

    if (!student_id) { alert("Please select a student."); return; }
    if (!content) { alert("Please enter details."); return; }

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
        alert("Failed to save behavioral note.");
    } finally {
        btn.disabled = false;
        btn.textContent = "Save Note";
    }
}
