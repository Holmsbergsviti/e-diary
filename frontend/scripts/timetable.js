// Chartwell E-Diary - timetable generator page
// Requires auth.js (apiFetch, showToast, getUser, escHtml/etc.)

const TT_DAYS = [
    { id: 1, name: "Monday" },
    { id: 2, name: "Tuesday" },
    { id: 3, name: "Wednesday" },
    { id: 4, name: "Thursday" },
    { id: 5, name: "Friday" },
];
const TT_PERIODS = [1, 2, 3, 4, 5, 6, 7, 8];
const TT_COLORS = [
    "#fde68a", "#bfdbfe", "#fecaca", "#bbf7d0",
    "#ddd6fe", "#fed7aa", "#a7f3d0", "#fbcfe8",
];

const TT_State = {
    classes: [],
    classId: "",
    classData: null,   // { subjects, students, teacher_conflicts, student_count }
    timetable: {},     // { "1": { "1": {subject_id, subject_name, teacher_id, teacher_name} } }
    subjectColor: {},  // subject_id -> hex
    activeSlot: null,  // { day, period }
};

function ttEsc(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[c]);
}

function ttColorFor(subjectId) {
    if (!subjectId) return "transparent";
    if (TT_State.subjectColor[subjectId]) return TT_State.subjectColor[subjectId];
    const used = Object.values(TT_State.subjectColor);
    const next = TT_COLORS.find(c => !used.includes(c)) || TT_COLORS[used.length % TT_COLORS.length];
    TT_State.subjectColor[subjectId] = next;
    return next;
}

function ttAssignColors(subjects) {
    TT_State.subjectColor = {};
    subjects.forEach((s, i) => {
        TT_State.subjectColor[s.subject_id] = TT_COLORS[i % TT_COLORS.length];
    });
}

async function ttLoadClasses() {
    const sel = document.getElementById("ttClassSelect");
    try {
        const res = await apiFetch("/admin/classes/");
        if (!res.ok) {
            sel.innerHTML = '<option value="">Failed to load classes</option>';
            showToast("Failed to load classes", "error");
            return;
        }
        const data = await res.json();
        TT_State.classes = data.classes || [];
        sel.innerHTML = '<option value="">Select a class…</option>' +
            TT_State.classes.map(c => `<option value="${ttEsc(c.id)}">${ttEsc(c.class_name)}</option>`).join("");
    } catch (e) {
        console.error(e);
        sel.innerHTML = '<option value="">Failed to load</option>';
    }
}

async function ttSelectClass(classId) {
    TT_State.classId = classId;
    const generateBtn = document.getElementById("ttGenerateBtn");
    const exportBtn = document.getElementById("ttExportBtn");
    const clearBtn = document.getElementById("ttClearBtn");
    const subjectsCard = document.getElementById("ttSubjectsCard");
    const gridCard = document.getElementById("ttGridCard");
    const statsBox = document.getElementById("ttStats");

    if (!classId) {
        generateBtn.disabled = true;
        exportBtn.disabled = true;
        clearBtn.disabled = true;
        subjectsCard.style.display = "none";
        gridCard.style.display = "none";
        statsBox.style.display = "none";
        return;
    }

    generateBtn.disabled = true;
    exportBtn.disabled = true;
    clearBtn.disabled = true;

    try {
        const [cdRes, ttRes] = await Promise.all([
            apiFetch(`/timetable/class-data/?class_id=${encodeURIComponent(classId)}`),
            apiFetch(`/timetable/?class_id=${encodeURIComponent(classId)}`),
        ]);

        if (!cdRes.ok) {
            const j = await cdRes.json().catch(() => ({}));
            showToast(j.message || "Failed to load class data", "error");
            return;
        }
        const cd = await cdRes.json();
        TT_State.classData = cd;
        ttAssignColors(cd.subjects || []);
        ttRenderSubjects();
        subjectsCard.style.display = "";

        if (ttRes.ok) {
            const tt = await ttRes.json();
            TT_State.timetable = tt.timetable || {};
            ttRenderGrid();
            ttRenderStats(tt.stats);
            const hasData = (tt.stats?.filled_slots || 0) > 0;
            gridCard.style.display = hasData ? "" : "none";
            statsBox.style.display = hasData ? "" : "none";
            exportBtn.disabled = !hasData;
            clearBtn.disabled = !hasData;
        }
        generateBtn.disabled = (cd.subjects || []).length === 0;
    } catch (e) {
        console.error(e);
        showToast("Failed to load class data", "error");
    }
}

function ttRenderSubjects() {
    const cd = TT_State.classData;
    const list = document.getElementById("ttSubjectsList");
    const badge = document.getElementById("ttStudentBadge");
    if (!cd) { list.innerHTML = ""; badge.textContent = ""; return; }
    badge.textContent = `${cd.student_count || 0} student${(cd.student_count || 0) === 1 ? "" : "s"} enrolled`;
    if (!cd.subjects || cd.subjects.length === 0) {
        list.innerHTML = '<p class="empty-state">No subjects assigned to this class.</p>';
        return;
    }
    list.innerHTML = cd.subjects.map(s => `
        <div class="tt-subject-pill">
            <span class="tt-subject-dot" style="background:${ttColorFor(s.subject_id)}"></span>
            <span><strong>${ttEsc(s.subject_name)}</strong> · ${ttEsc(s.teacher_name)}</span>
        </div>
    `).join("");
}

function ttRenderStats(stats) {
    const box = document.getElementById("ttStats");
    if (!stats) { box.innerHTML = ""; return; }
    box.innerHTML = `
        <div class="tt-stat"><strong>${stats.filled_slots}</strong>Filled slots</div>
        <div class="tt-stat"><strong>${stats.free_slots}</strong>Free slots</div>
        <div class="tt-stat"><strong>${stats.subjects_count}</strong>Subjects scheduled</div>
    `;
}

function ttRenderGrid() {
    const grid = document.getElementById("ttGrid");
    const breakAfter = parseInt(document.getElementById("ttBreakAfter").value, 10) || 4;

    let html = "<thead><tr><th class='tt-period-cell'>P</th>";
    for (const d of TT_DAYS) html += `<th>${d.name}</th>`;
    html += "</tr></thead><tbody>";

    for (const p of TT_PERIODS) {
        if (p === breakAfter + 1) {
            html += `<tr class="tt-break-row"><td colspan="${TT_DAYS.length + 1}">— BREAK —</td></tr>`;
        }
        html += `<tr><td class="tt-period-cell">${p}</td>`;
        for (const d of TT_DAYS) {
            const slot = (TT_State.timetable[String(d.id)] || {})[String(p)];
            if (slot) {
                const bg = ttColorFor(slot.subject_id);
                html += `<td class="tt-cell" style="background:${bg}" data-day="${d.id}" data-period="${p}">
                    <div class="tt-cell-subject">${ttEsc(slot.subject_name)}</div>
                    <div class="tt-cell-teacher">${ttEsc(slot.teacher_name)}</div>
                </td>`;
            } else {
                html += `<td class="tt-cell tt-cell-empty" data-day="${d.id}" data-period="${p}">+ add</td>`;
            }
        }
        html += "</tr>";
    }
    html += "</tbody>";
    grid.innerHTML = html;

    grid.querySelectorAll("td.tt-cell").forEach(td => {
        td.addEventListener("click", () => {
            const day = parseInt(td.dataset.day, 10);
            const period = parseInt(td.dataset.period, 10);
            ttOpenSlotModal(day, period);
        });
    });
}

async function ttGenerate() {
    if (!TT_State.classId) return;
    const breakAfter = parseInt(document.getElementById("ttBreakAfter").value, 10) || 4;
    const maxSame = parseInt(document.getElementById("ttMaxSame").value, 10) || 2;
    const btn = document.getElementById("ttGenerateBtn");
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Generating…";

    try {
        const res = await apiFetch("/timetable/generate/", {
            method: "POST",
            body: JSON.stringify({
                class_id: TT_State.classId,
                constraints: { break_after: breakAfter, max_same_subject_per_day: maxSame },
            }),
        });
        const data = await res.json();
        if (!res.ok) {
            showToast(data.message || "Generation failed", "error");
            return;
        }
        TT_State.timetable = data.timetable || {};
        ttRenderGrid();
        ttRenderStats(data.stats);
        document.getElementById("ttGridCard").style.display = "";
        document.getElementById("ttStats").style.display = "";
        document.getElementById("ttExportBtn").disabled = false;
        document.getElementById("ttClearBtn").disabled = false;
        showToast("Timetable generated", "success");
    } catch (e) {
        console.error(e);
        showToast("Generation failed", "error");
    } finally {
        btn.disabled = false;
        btn.textContent = originalText;
    }
}

function ttOpenSlotModal(day, period) {
    const cd = TT_State.classData;
    if (!cd) return;
    TT_State.activeSlot = { day, period };
    const existing = (TT_State.timetable[String(day)] || {})[String(period)] || null;

    const dayName = TT_DAYS.find(d => d.id === day)?.name || day;
    document.getElementById("ttSlotModalTitle").textContent = `${dayName} · Period ${period}`;

    const subjectOpts = '<option value="">— None —</option>' +
        (cd.subjects || []).map(s =>
            `<option value="${ttEsc(s.subject_id)}" data-teacher="${ttEsc(s.teacher_id)}" data-teacher-name="${ttEsc(s.teacher_name)}"
                ${existing && existing.subject_id === s.subject_id ? "selected" : ""}>
                ${ttEsc(s.subject_name)} (${ttEsc(s.teacher_name)})
             </option>`
        ).join("");

    document.getElementById("ttSlotModalBody").innerHTML = `
        <div class="form-group">
            <label for="ttSlotSubject">Subject &amp; teacher</label>
            <select id="ttSlotSubject" class="form-input">${subjectOpts}</select>
        </div>
        <p style="font-size:0.8rem;color:var(--text-light);">
            Teachers already booked elsewhere at this slot will be rejected by the server.
        </p>
    `;

    document.getElementById("ttSlotModalDelete").style.display = existing ? "" : "none";
    document.getElementById("ttSlotModal").style.display = "flex";
}

function ttCloseSlotModal() {
    document.getElementById("ttSlotModal").style.display = "none";
    TT_State.activeSlot = null;
}

async function ttSaveSlot() {
    if (!TT_State.activeSlot) return;
    const sel = document.getElementById("ttSlotSubject");
    const opt = sel.options[sel.selectedIndex];
    const subjectId = sel.value;
    const teacherId = opt ? opt.dataset.teacher : "";
    const { day, period } = TT_State.activeSlot;

    try {
        const res = await apiFetch("/timetable/slot/", {
            method: "PUT",
            body: JSON.stringify({
                class_id: TT_State.classId,
                day, period,
                subject_id: subjectId,
                teacher_id: teacherId,
            }),
        });
        const data = await res.json();
        if (!res.ok) {
            showToast(data.message || "Failed to save slot", "error");
            return;
        }
        // Update local model
        if (!TT_State.timetable[String(day)]) TT_State.timetable[String(day)] = {};
        if (subjectId) {
            const subj = (TT_State.classData.subjects || []).find(s => s.subject_id === subjectId);
            TT_State.timetable[String(day)][String(period)] = {
                subject_id: subjectId,
                subject_name: subj ? subj.subject_name : "",
                teacher_id: teacherId,
                teacher_name: subj ? subj.teacher_name : "",
            };
        } else {
            delete TT_State.timetable[String(day)][String(period)];
        }
        ttRenderGrid();
        ttCloseSlotModal();
        showToast("Slot updated", "success");
    } catch (e) {
        console.error(e);
        showToast("Failed to save slot", "error");
    }
}

async function ttDeleteSlot() {
    if (!TT_State.activeSlot) return;
    const { day, period } = TT_State.activeSlot;
    try {
        const res = await apiFetch("/timetable/slot/", {
            method: "PUT",
            body: JSON.stringify({
                class_id: TT_State.classId,
                day, period,
                subject_id: "",
                teacher_id: "",
            }),
        });
        const data = await res.json();
        if (!res.ok) {
            showToast(data.message || "Failed to delete slot", "error");
            return;
        }
        if (TT_State.timetable[String(day)]) delete TT_State.timetable[String(day)][String(period)];
        ttRenderGrid();
        ttCloseSlotModal();
        showToast("Slot cleared", "success");
    } catch (e) {
        console.error(e);
        showToast("Failed to delete slot", "error");
    }
}

async function ttClear() {
    if (!TT_State.classId) return;
    const ok = await showConfirm("Delete the entire timetable for this class?", {
        title: "Clear Timetable", confirmText: "Clear",
    });
    if (!ok) return;

    try {
        const res = await apiFetch(`/timetable/clear/?class_id=${encodeURIComponent(TT_State.classId)}`, {
            method: "DELETE",
        });
        const data = await res.json();
        if (!res.ok) {
            showToast(data.message || "Failed to clear", "error");
            return;
        }
        TT_State.timetable = {};
        ttRenderGrid();
        document.getElementById("ttStats").style.display = "none";
        document.getElementById("ttGridCard").style.display = "none";
        document.getElementById("ttExportBtn").disabled = true;
        document.getElementById("ttClearBtn").disabled = true;
        showToast("Timetable cleared", "success");
    } catch (e) {
        console.error(e);
        showToast("Failed to clear", "error");
    }
}

function ttExportCsv() {
    const cls = TT_State.classes.find(c => c.id === TT_State.classId);
    const className = cls ? cls.class_name : "class";
    const today = new Date().toISOString().slice(0, 10);

    const headers = ["Period", ...TT_DAYS.map(d => d.name)];
    const lines = [headers.join(",")];
    for (const p of TT_PERIODS) {
        const cells = [String(p)];
        for (const d of TT_DAYS) {
            const slot = (TT_State.timetable[String(d.id)] || {})[String(p)];
            const text = slot ? `${slot.subject_name} (${slot.teacher_name})` : "";
            cells.push('"' + text.replace(/"/g, '""') + '"');
        }
        lines.push(cells.join(","));
    }

    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `timetable_${className}_${today}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

document.addEventListener("DOMContentLoaded", () => {
    const user = getUser?.();
    if (!user || user.role !== "admin") {
        showToast("Admin access required", "error");
        setTimeout(() => { window.location.href = "index.html"; }, 800);
        return;
    }

    ttLoadClasses();

    document.getElementById("ttClassSelect").addEventListener("change", e => ttSelectClass(e.target.value));
    document.getElementById("ttGenerateBtn").addEventListener("click", ttGenerate);
    document.getElementById("ttExportBtn").addEventListener("click", ttExportCsv);
    document.getElementById("ttClearBtn").addEventListener("click", ttClear);
    document.getElementById("ttBreakAfter").addEventListener("change", ttRenderGrid);

    document.getElementById("ttSlotModalSave").addEventListener("click", ttSaveSlot);
    document.getElementById("ttSlotModalDelete").addEventListener("click", ttDeleteSlot);
    document.getElementById("ttSlotModalCancel").addEventListener("click", ttCloseSlotModal);
    document.getElementById("ttSlotModalClose").addEventListener("click", ttCloseSlotModal);
});
