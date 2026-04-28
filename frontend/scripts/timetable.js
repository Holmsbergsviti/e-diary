// Chartwell E-Diary — multi-class timetable generator
// Requires auth.js (apiFetch, getUser, requireAuth, initNav, showToast, showConfirm)

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
    "#fcd34d", "#93c5fd", "#fca5a5", "#86efac",
];

const TT = {
    classes: [],          // [{id, class_name, grade_level}]
    selectedIds: [],      // [class_id]
    classData: {},        // class_id -> { class_name, subjects, student_count }
    config: {},           // class_id -> { building, subjects: [{subject_id, periods_per_week}] }
    timetables: {},       // class_id -> { class_name, timetable: {day: {period: meta}} }
    subjectColor: {},     // subject_id -> color
    activeSlot: null,     // {class_id, day, period}
};

function ttEsc(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[c]);
}

function ttColorFor(subjectId) {
    if (!subjectId) return "transparent";
    if (TT.subjectColor[subjectId]) return TT.subjectColor[subjectId];
    const idx = Object.keys(TT.subjectColor).length;
    const c = TT_COLORS[idx % TT_COLORS.length];
    TT.subjectColor[subjectId] = c;
    return c;
}

function ttShowError(msg) {
    const box = document.getElementById("ttErrorBox");
    if (!msg) { box.style.display = "none"; box.textContent = ""; return; }
    box.style.display = "";
    box.textContent = msg;
}

function ttGoStep(n) {
    document.querySelectorAll(".tt-step").forEach(el => {
        el.classList.toggle("active", el.dataset.step === String(n));
    });
    document.querySelectorAll(".tt-step-pill").forEach(el => {
        const p = parseInt(el.dataset.pill, 10);
        el.classList.toggle("active", p === n);
        el.classList.toggle("done", p < n);
    });
    ttShowError("");
}

// ---------- Step 1: load + pick classes ----------

async function ttLoadClasses() {
    const container = document.getElementById("ttClassGrid");
    try {
        const res = await apiFetch("/admin/classes/");
        if (!res.ok) {
            const j = await res.json().catch(() => ({}));
            container.innerHTML = `<p class="empty-state">Failed to load classes: ${ttEsc(j.message || res.status)}</p>`;
            ttShowError(j.message || `Failed to load classes (HTTP ${res.status}).`);
            return;
        }
        const data = await res.json();
        TT.classes = (data.classes || []).slice().sort((a, b) => {
            const g = (a.grade_level || 0) - (b.grade_level || 0);
            return g !== 0 ? g : (a.class_name || "").localeCompare(b.class_name || "");
        });
        if (TT.classes.length === 0) {
            container.innerHTML = '<p class="empty-state">No classes exist yet. Create classes in the admin panel first.</p>';
            return;
        }
        container.innerHTML = TT.classes.map(c => `
            <label class="tt-class-pick" data-id="${ttEsc(c.id)}">
                <input type="checkbox" value="${ttEsc(c.id)}">
                <span><strong>${ttEsc(c.class_name)}</strong>${c.grade_level ? ` <small style="opacity:.7">(Y${c.grade_level})</small>` : ""}</span>
            </label>
        `).join("");

        container.querySelectorAll("input[type=checkbox]").forEach(cb => {
            cb.addEventListener("change", ttOnClassToggle);
        });
    } catch (e) {
        console.error(e);
        container.innerHTML = '<p class="empty-state">Failed to reach the server.</p>';
        ttShowError("Could not reach the server. Backend may be cold-starting; retry in 30s.");
    }
}

function ttOnClassToggle() {
    TT.selectedIds = Array.from(document.querySelectorAll("#ttClassGrid input:checked")).map(cb => cb.value);
    document.querySelectorAll("#ttClassGrid .tt-class-pick").forEach(lbl => {
        const cb = lbl.querySelector("input");
        lbl.classList.toggle("checked", cb.checked);
    });
    document.getElementById("ttBtnNext1").disabled = TT.selectedIds.length === 0;
}

// ---------- Step 2: buildings + per-subject periods ----------

async function ttLoadConfig() {
    const list = document.getElementById("ttClassConfigList");
    list.innerHTML = '<p class="loading">Loading subjects…</p>';
    try {
        const qs = encodeURIComponent(TT.selectedIds.join(","));
        const res = await apiFetch(`/timetable/multi-class-data/?class_ids=${qs}`);
        if (!res.ok) {
            const j = await res.json().catch(() => ({}));
            list.innerHTML = `<p class="empty-state">Failed: ${ttEsc(j.message || res.status)}</p>`;
            ttShowError(j.message || "Failed to load class data.");
            return;
        }
        const data = await res.json();
        TT.classData = {};
        for (const c of (data.classes || [])) {
            TT.classData[c.class_id] = c;
            // Pre-seed config from previous values if any
            if (!TT.config[c.class_id]) {
                TT.config[c.class_id] = {
                    building: "",
                    subjects: c.subjects.map(s => ({ subject_id: s.subject_id, periods_per_week: 4 })),
                };
            } else {
                // Sync subjects in case assignments changed
                const knownIds = new Set(TT.config[c.class_id].subjects.map(s => s.subject_id));
                for (const s of c.subjects) {
                    if (!knownIds.has(s.subject_id)) {
                        TT.config[c.class_id].subjects.push({ subject_id: s.subject_id, periods_per_week: 4 });
                    }
                }
            }
        }
        ttRenderConfig();
    } catch (e) {
        console.error(e);
        list.innerHTML = '<p class="empty-state">Failed to reach the server.</p>';
    }
}

function ttRenderConfig() {
    const list = document.getElementById("ttClassConfigList");
    if (TT.selectedIds.length === 0) { list.innerHTML = ""; return; }

    let html = "";
    for (const cid of TT.selectedIds) {
        const cd = TT.classData[cid];
        if (!cd) continue;
        const cfg = TT.config[cid];
        const subjRows = cd.subjects.map(s => {
            const cur = cfg.subjects.find(x => x.subject_id === s.subject_id) || { periods_per_week: 4 };
            return `
                <div style="display:flex;align-items:center;gap:8px;font-size:0.85rem;padding:4px 0;">
                    <span style="flex:1;"><strong>${ttEsc(s.subject_name)}</strong> · <span style="color:var(--text-light)">${ttEsc(s.teacher_name)}</span></span>
                    <input type="number" min="1" max="10" value="${cur.periods_per_week}"
                           data-class="${ttEsc(cid)}" data-subject="${ttEsc(s.subject_id)}" data-field="ppw"
                           class="form-input" style="width:64px;padding:4px 6px;font-size:0.85rem;text-align:center;">
                    <span style="font-size:0.75rem;color:var(--text-lighter);">/week</span>
                </div>
            `;
        }).join("") || '<p class="empty-state" style="margin:6px 0">No subjects assigned to this class.</p>';

        html += `
            <div class="tt-class-config">
                <div class="tt-class-config-title">${ttEsc(cd.class_name)}${cd.grade_level ? ` <small style="opacity:.7;font-weight:400;">Year ${cd.grade_level} · ${cd.student_count} student${cd.student_count === 1 ? "" : "s"}</small>` : ""}</div>
                <div class="tt-class-config-row">
                    <div class="form-group" style="margin:0;max-width:240px;">
                        <label style="font-size:0.78rem;">Building</label>
                        <input type="text" placeholder="e.g. Main, Annex, Building A"
                               data-class="${ttEsc(cid)}" data-field="building"
                               value="${ttEsc(cfg.building || "")}"
                               class="form-input">
                    </div>
                </div>
                <div class="tt-class-config-row">
                    ${subjRows}
                </div>
            </div>
        `;
    }
    list.innerHTML = html;

    list.querySelectorAll("input[data-field=building]").forEach(inp => {
        inp.addEventListener("input", e => {
            const cid = e.target.dataset.class;
            TT.config[cid].building = e.target.value;
        });
    });
    list.querySelectorAll("input[data-field=ppw]").forEach(inp => {
        inp.addEventListener("change", e => {
            const cid = e.target.dataset.class;
            const sid = e.target.dataset.subject;
            const v = Math.max(1, Math.min(10, parseInt(e.target.value, 10) || 4));
            e.target.value = v;
            const subj = TT.config[cid].subjects.find(s => s.subject_id === sid);
            if (subj) subj.periods_per_week = v;
        });
    });
}

// ---------- Step 3 → 4: generate ----------

async function ttGenerate() {
    const breakAfter = parseInt(document.getElementById("ttBreakAfter").value, 10) || 4;
    const maxSame = parseInt(document.getElementById("ttMaxSame").value, 10) || 2;

    const payload = {
        classes: TT.selectedIds.map(cid => ({
            class_id: cid,
            building: (TT.config[cid]?.building || "").trim(),
            subjects: TT.config[cid]?.subjects || [],
        })),
        constraints: { break_after: breakAfter, max_same_subject_per_day: maxSame },
    };

    const btn = document.getElementById("ttBtnGenerate");
    const orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Generating…";
    ttShowError("");

    try {
        const res = await apiFetch("/timetable/generate-multi/", {
            method: "POST",
            body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) {
            ttShowError(data.message || "Generation failed.");
            showToast(data.message || "Generation failed", "error");
            return;
        }
        TT.timetables = data.timetables || {};
        // Pre-assign colors based on the union of subject ids encountered, in stable order
        TT.subjectColor = {};
        for (const cid of TT.selectedIds) {
            const t = TT.timetables[cid]?.timetable || {};
            for (const d of Object.keys(t)) {
                for (const p of Object.keys(t[d])) {
                    ttColorFor(t[d][p].subject_id);
                }
            }
        }
        ttRenderResults(data.stats);
        ttGoStep(4);
        showToast("Timetables generated", "success");
    } catch (e) {
        console.error(e);
        ttShowError("Network error. Backend may be cold-starting.");
        showToast("Generation failed", "error");
    } finally {
        btn.disabled = false;
        btn.textContent = orig;
    }
}

function ttRenderResults(stats) {
    const statsBox = document.getElementById("ttStats");
    if (stats) {
        statsBox.innerHTML = `
            <div class="tt-stat"><strong>${stats.classes_count}</strong>Classes</div>
            <div class="tt-stat"><strong>${stats.filled_slots}</strong>Filled slots</div>
            <div class="tt-stat"><strong>${stats.free_slots}</strong>Free slots</div>
            <div class="tt-stat"><strong>${stats.total_slots}</strong>Total slots</div>
        `;
    } else {
        statsBox.innerHTML = "";
    }

    const wrap = document.getElementById("ttResults");
    let html = "";
    for (const cid of TT.selectedIds) {
        const block = TT.timetables[cid];
        if (!block) continue;
        html += `
            <div class="tt-result-block" data-class="${ttEsc(cid)}">
                <div class="tt-result-header">
                    <div class="tt-result-title">${ttEsc(block.class_name)}</div>
                    <div>
                        <button class="btn btn-secondary btn-sm" data-export="${ttEsc(cid)}">Export CSV</button>
                        <button class="btn btn-danger btn-sm" data-clear="${ttEsc(cid)}">Clear</button>
                    </div>
                </div>
                <div class="tt-grid-wrap">
                    <table class="tt-grid">${ttGridBody(cid)}</table>
                </div>
            </div>
        `;
    }
    wrap.innerHTML = html || '<p class="empty-state">No timetables produced.</p>';

    wrap.querySelectorAll("td.tt-cell").forEach(td => {
        td.addEventListener("click", () => {
            ttOpenSlotModal(td.dataset.class, parseInt(td.dataset.day, 10), parseInt(td.dataset.period, 10));
        });
    });
    wrap.querySelectorAll("[data-export]").forEach(btn => {
        btn.addEventListener("click", () => ttExportCsv(btn.dataset.export));
    });
    wrap.querySelectorAll("[data-clear]").forEach(btn => {
        btn.addEventListener("click", () => ttClearOne(btn.dataset.clear));
    });
}

function ttGridBody(cid) {
    const breakAfter = parseInt(document.getElementById("ttBreakAfter").value, 10) || 4;
    const tt = TT.timetables[cid]?.timetable || {};
    let html = "<thead><tr><th class='tt-period-cell'>P</th>";
    for (const d of TT_DAYS) html += `<th>${d.name}</th>`;
    html += "</tr></thead><tbody>";
    for (const p of TT_PERIODS) {
        if (p === breakAfter + 1) {
            html += `<tr class="tt-break-row"><td colspan="${TT_DAYS.length + 1}">— BREAK —</td></tr>`;
        }
        html += `<tr><td class="tt-period-cell">${p}</td>`;
        for (const d of TT_DAYS) {
            const slot = (tt[String(d.id)] || {})[String(p)];
            if (slot) {
                const bg = ttColorFor(slot.subject_id);
                html += `<td class="tt-cell" style="background:${bg}" data-class="${ttEsc(cid)}" data-day="${d.id}" data-period="${p}">
                    <div class="tt-cell-subject">${ttEsc(slot.subject_name)}</div>
                    <div class="tt-cell-teacher">${ttEsc(slot.teacher_name)}</div>
                </td>`;
            } else {
                html += `<td class="tt-cell tt-cell-empty" data-class="${ttEsc(cid)}" data-day="${d.id}" data-period="${p}">+ add</td>`;
            }
        }
        html += "</tr>";
    }
    html += "</tbody>";
    return html;
}

// ---------- Slot modal ----------

function ttOpenSlotModal(cid, day, period) {
    const cd = TT.classData[cid];
    if (!cd) return;
    TT.activeSlot = { class_id: cid, day, period };
    const existing = (TT.timetables[cid]?.timetable[String(day)] || {})[String(period)] || null;
    const dayName = TT_DAYS.find(d => d.id === day)?.name || day;

    document.getElementById("ttSlotModalTitle").textContent = `${cd.class_name} · ${dayName} · Period ${period}`;
    const opts = '<option value="">— None —</option>' +
        cd.subjects.map(s =>
            `<option value="${ttEsc(s.subject_id)}" data-teacher="${ttEsc(s.teacher_id)}"
                ${existing && existing.subject_id === s.subject_id ? "selected" : ""}>
                ${ttEsc(s.subject_name)} (${ttEsc(s.teacher_name)})
             </option>`
        ).join("");

    document.getElementById("ttSlotModalBody").innerHTML = `
        <div class="form-group">
            <label>Subject &amp; teacher</label>
            <select id="ttSlotSubject" class="form-input">${opts}</select>
        </div>
        <p style="font-size:0.78rem;color:var(--text-light);margin-top:6px;">
            Server rejects teacher conflicts in other classes at this slot.
        </p>
    `;
    document.getElementById("ttSlotModalDelete").style.display = existing ? "" : "none";
    document.getElementById("ttSlotModal").style.display = "flex";
}

function ttCloseSlotModal() {
    document.getElementById("ttSlotModal").style.display = "none";
    TT.activeSlot = null;
}

async function ttSaveSlot() {
    if (!TT.activeSlot) return;
    const sel = document.getElementById("ttSlotSubject");
    const opt = sel.options[sel.selectedIndex];
    const subjectId = sel.value;
    const teacherId = opt ? (opt.dataset.teacher || "") : "";
    const { class_id, day, period } = TT.activeSlot;

    try {
        const res = await apiFetch("/timetable/slot/", {
            method: "PUT",
            body: JSON.stringify({ class_id, day, period, subject_id: subjectId, teacher_id: teacherId }),
        });
        const data = await res.json();
        if (!res.ok) { showToast(data.message || "Failed to save", "error"); return; }

        const tt = TT.timetables[class_id]?.timetable || {};
        if (!tt[String(day)]) tt[String(day)] = {};
        if (subjectId) {
            const subj = TT.classData[class_id].subjects.find(s => s.subject_id === subjectId);
            tt[String(day)][String(period)] = {
                subject_id: subjectId,
                subject_name: subj ? subj.subject_name : "",
                teacher_id: teacherId,
                teacher_name: subj ? subj.teacher_name : "",
            };
        } else {
            delete tt[String(day)][String(period)];
        }
        // Re-render only the affected class block
        const block = document.querySelector(`.tt-result-block[data-class="${class_id}"] table.tt-grid`);
        if (block) block.innerHTML = ttGridBody(class_id);
        document.querySelectorAll(`.tt-result-block[data-class="${class_id}"] td.tt-cell`).forEach(td => {
            td.addEventListener("click", () => {
                ttOpenSlotModal(td.dataset.class, parseInt(td.dataset.day, 10), parseInt(td.dataset.period, 10));
            });
        });
        ttCloseSlotModal();
        showToast("Slot updated", "success");
    } catch (e) {
        console.error(e);
        showToast("Failed to save", "error");
    }
}

async function ttDeleteSlot() {
    if (!TT.activeSlot) return;
    const { class_id, day, period } = TT.activeSlot;
    try {
        const res = await apiFetch("/timetable/slot/", {
            method: "PUT",
            body: JSON.stringify({ class_id, day, period, subject_id: "", teacher_id: "" }),
        });
        const data = await res.json();
        if (!res.ok) { showToast(data.message || "Failed", "error"); return; }
        const tt = TT.timetables[class_id]?.timetable || {};
        if (tt[String(day)]) delete tt[String(day)][String(period)];
        const block = document.querySelector(`.tt-result-block[data-class="${class_id}"] table.tt-grid`);
        if (block) block.innerHTML = ttGridBody(class_id);
        document.querySelectorAll(`.tt-result-block[data-class="${class_id}"] td.tt-cell`).forEach(td => {
            td.addEventListener("click", () => {
                ttOpenSlotModal(td.dataset.class, parseInt(td.dataset.day, 10), parseInt(td.dataset.period, 10));
            });
        });
        ttCloseSlotModal();
        showToast("Slot cleared", "success");
    } catch (e) {
        console.error(e);
        showToast("Failed", "error");
    }
}

// ---------- Per-class clear + export ----------

async function ttClearOne(cid) {
    const ok = await showConfirm(`Delete the timetable for ${TT.classData[cid]?.class_name || "this class"}?`,
        { title: "Clear Timetable", confirmText: "Clear" });
    if (!ok) return;
    try {
        const res = await apiFetch(`/timetable/clear/?class_id=${encodeURIComponent(cid)}`, { method: "DELETE" });
        const data = await res.json();
        if (!res.ok) { showToast(data.message || "Failed", "error"); return; }
        if (TT.timetables[cid]) {
            TT.timetables[cid].timetable = {};
            const block = document.querySelector(`.tt-result-block[data-class="${cid}"] table.tt-grid`);
            if (block) block.innerHTML = ttGridBody(cid);
            document.querySelectorAll(`.tt-result-block[data-class="${cid}"] td.tt-cell`).forEach(td => {
                td.addEventListener("click", () => {
                    ttOpenSlotModal(td.dataset.class, parseInt(td.dataset.day, 10), parseInt(td.dataset.period, 10));
                });
            });
        }
        showToast("Timetable cleared", "success");
    } catch (e) {
        console.error(e);
        showToast("Failed", "error");
    }
}

function ttExportCsv(cid) {
    const block = TT.timetables[cid];
    if (!block) return;
    const className = block.class_name || cid;
    const today = new Date().toISOString().slice(0, 10);
    const headers = ["Period", ...TT_DAYS.map(d => d.name)];
    const lines = [headers.join(",")];
    const tt = block.timetable || {};
    for (const p of TT_PERIODS) {
        const cells = [String(p)];
        for (const d of TT_DAYS) {
            const slot = (tt[String(d.id)] || {})[String(p)];
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

function ttExportAll() {
    for (const cid of TT.selectedIds) {
        if (TT.timetables[cid]) ttExportCsv(cid);
    }
}

// ---------- Init ----------

document.addEventListener("DOMContentLoaded", () => {
    if (typeof requireAuth === "function" && !requireAuth()) return;
    if (typeof initNav === "function") initNav();

    const user = (typeof getUser === "function") ? getUser() : null;
    if (!user || user.role !== "admin") {
        showToast("Admin access required", "error");
        setTimeout(() => { window.location.href = "index.html"; }, 800);
        return;
    }

    ttLoadClasses();

    document.getElementById("ttBtnNext1").addEventListener("click", () => {
        ttGoStep(2);
        ttLoadConfig();
    });
    document.getElementById("ttBtnBack2").addEventListener("click", () => ttGoStep(1));
    document.getElementById("ttBtnNext2").addEventListener("click", () => {
        // Validate every selected class has a building
        const missing = TT.selectedIds.filter(cid => !(TT.config[cid]?.building || "").trim());
        if (missing.length > 0) {
            ttShowError("Set a building for every selected class.");
            return;
        }
        ttGoStep(3);
    });
    document.getElementById("ttBtnBack3").addEventListener("click", () => ttGoStep(2));
    document.getElementById("ttBtnGenerate").addEventListener("click", ttGenerate);
    document.getElementById("ttBtnBack4").addEventListener("click", () => ttGoStep(3));
    document.getElementById("ttBtnExportAll").addEventListener("click", ttExportAll);

    document.getElementById("ttSlotModalSave").addEventListener("click", ttSaveSlot);
    document.getElementById("ttSlotModalDelete").addEventListener("click", ttDeleteSlot);
    document.getElementById("ttSlotModalCancel").addEventListener("click", ttCloseSlotModal);
    document.getElementById("ttSlotModalClose").addEventListener("click", ttCloseSlotModal);
});
