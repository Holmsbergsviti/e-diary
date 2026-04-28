// Chartwell E-Diary — multi-year timetable generator
// Flow: 1) define buildings + assign year levels  2) pick years to generate
//       3) constraints  4) per-class results

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
    classes: [],          // [{id, class_name, grade_level}] all classes
    years: [],            // sorted distinct grade_level values
    buildings: [],        // [{ id (local), name, years: [int] }]
    selectedYears: [],    // years user picked in step 2
    classData: {},        // class_id -> {class_name, grade_level, subjects, student_count}
    timetables: {},       // class_id -> { class_name, timetable }
    subjectColor: {},
    activeSlot: null,
    nextBuildingId: 1,
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

// ----- year helpers -----

function ttBuildingForYear(year) {
    return TT.buildings.find(b => b.years.includes(year));
}

function ttClassesForYear(year) {
    return TT.classes.filter(c => c.grade_level === year);
}

// ----- Initial load -----

async function ttLoadClasses() {
    try {
        const res = await apiFetch("/admin/classes/");
        if (!res.ok) {
            const j = await res.json().catch(() => ({}));
            ttShowError(j.message || `Failed to load classes (HTTP ${res.status}).`);
            document.getElementById("ttBuildingsList").innerHTML = `<p class="empty-state">Failed to load classes.</p>`;
            return;
        }
        const data = await res.json();
        TT.classes = (data.classes || []).slice().sort((a, b) => {
            const g = (a.grade_level || 0) - (b.grade_level || 0);
            return g !== 0 ? g : (a.class_name || "").localeCompare(b.class_name || "");
        });
        const yearSet = new Set(TT.classes.map(c => c.grade_level).filter(y => y != null));
        TT.years = Array.from(yearSet).sort((a, b) => a - b);

        if (TT.years.length === 0) {
            document.getElementById("ttBuildingsList").innerHTML =
                '<p class="empty-state">No classes exist yet. Create classes in the admin panel first.</p>';
            return;
        }

        // Seed with one empty building so users know to start
        if (TT.buildings.length === 0) ttAddBuilding();
        ttRenderBuildings();
    } catch (e) {
        console.error(e);
        ttShowError("Could not reach the server. Backend may be cold-starting; retry in 30s.");
    }
}

// ----- Step 1: buildings -----

function ttAddBuilding() {
    TT.buildings.push({ id: TT.nextBuildingId++, name: "", years: [] });
    ttRenderBuildings();
}

function ttRemoveBuilding(id) {
    TT.buildings = TT.buildings.filter(b => b.id !== id);
    if (TT.buildings.length === 0) ttAddBuilding();
    ttRenderBuildings();
}

function ttRenderBuildings() {
    const list = document.getElementById("ttBuildingsList");
    if (TT.years.length === 0) { list.innerHTML = ""; return; }

    let html = "";
    for (const b of TT.buildings) {
        const yearChecks = TT.years.map(y => {
            const owner = ttBuildingForYear(y);
            const taken = owner && owner.id !== b.id;
            const checked = b.years.includes(y);
            const cls = "tt-year-check" + (checked ? " active" : "") + (taken ? " taken" : "");
            const tip = taken ? `Already in "${ttEsc(owner.name || "(unnamed)")}"` : "";
            const count = TT.classes.filter(c => c.grade_level === y).length;
            return `
                <label class="${cls}" title="${tip}">
                    <input type="checkbox" data-building="${b.id}" data-year="${y}"
                           ${checked ? "checked" : ""} ${taken ? "disabled" : ""}>
                    <span>Year ${y} <small style="opacity:.7">(${count} cls)</small></span>
                </label>
            `;
        }).join("");

        html += `
            <div class="tt-building-row">
                <div class="tt-building-head">
                    <div class="form-group">
                        <label>Building name</label>
                        <input type="text" class="form-input" placeholder="e.g. Main, Annex"
                               data-building="${b.id}" data-field="name" value="${ttEsc(b.name)}">
                    </div>
                    <button type="button" class="tt-remove-btn" data-remove="${b.id}">Remove</button>
                </div>
                <div>
                    <div style="font-size:0.78rem;color:var(--text-light);margin-bottom:4px;">Year levels in this building</div>
                    <div class="tt-year-checks">${yearChecks}</div>
                </div>
            </div>
        `;
    }
    list.innerHTML = html;

    list.querySelectorAll('input[data-field="name"]').forEach(inp => {
        inp.addEventListener("input", e => {
            const id = parseInt(e.target.dataset.building, 10);
            const b = TT.buildings.find(x => x.id === id);
            if (b) b.name = e.target.value;
        });
    });
    list.querySelectorAll('input[data-year]').forEach(cb => {
        cb.addEventListener("change", e => {
            const id = parseInt(e.target.dataset.building, 10);
            const yr = parseInt(e.target.dataset.year, 10);
            const b = TT.buildings.find(x => x.id === id);
            if (!b) return;
            if (e.target.checked) {
                if (!b.years.includes(yr)) b.years.push(yr);
            } else {
                b.years = b.years.filter(y => y !== yr);
            }
            ttRenderBuildings();
        });
    });
    list.querySelectorAll('[data-remove]').forEach(btn => {
        btn.addEventListener("click", () => {
            ttRemoveBuilding(parseInt(btn.dataset.remove, 10));
        });
    });
}

function ttValidateBuildings() {
    const used = TT.buildings.filter(b => b.years.length > 0);
    if (used.length === 0) return "Add at least one building with a year assigned.";
    for (const b of used) {
        if (!b.name.trim()) return "Every building needs a name.";
    }
    return null;
}

// ----- Step 2: pick years -----

function ttRenderYearPicker() {
    const grid = document.getElementById("ttYearGrid");
    const assignedYears = TT.buildings.flatMap(b => b.years.map(y => ({ year: y, building: b.name })));
    if (assignedYears.length === 0) {
        grid.innerHTML = '<p class="empty-state">No years assigned to a building.</p>';
        return;
    }
    assignedYears.sort((a, b) => a.year - b.year);

    grid.innerHTML = assignedYears.map(({ year, building }) => {
        const classes = ttClassesForYear(year);
        const checked = TT.selectedYears.includes(year);
        return `
            <label class="tt-year-pick ${checked ? "checked" : ""}" data-year="${year}">
                <input type="checkbox" value="${year}" ${checked ? "checked" : ""}>
                <span>
                    <strong>Year ${year}</strong>
                    <small>${classes.length} class${classes.length === 1 ? "" : "es"} · ${ttEsc(building || "(unnamed building)")}</small>
                </span>
            </label>
        `;
    }).join("");

    grid.querySelectorAll("input[type=checkbox]").forEach(cb => {
        cb.addEventListener("change", () => {
            TT.selectedYears = Array.from(grid.querySelectorAll("input:checked")).map(c => parseInt(c.value, 10));
            grid.querySelectorAll(".tt-year-pick").forEach(lbl => {
                const inp = lbl.querySelector("input");
                lbl.classList.toggle("checked", inp.checked);
            });
            document.getElementById("ttBtnNext2").disabled = TT.selectedYears.length === 0;
        });
    });
    document.getElementById("ttBtnNext2").disabled = TT.selectedYears.length === 0;
}

// ----- Step 3 → 4: load metadata, generate -----

async function ttLoadSelectedClassData() {
    const classIds = TT.selectedYears.flatMap(y => ttClassesForYear(y).map(c => c.id));
    if (classIds.length === 0) return classIds;
    const qs = encodeURIComponent(classIds.join(","));
    const res = await apiFetch(`/timetable/multi-class-data/?class_ids=${qs}`);
    if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message || `HTTP ${res.status}`);
    }
    const data = await res.json();
    TT.classData = {};
    for (const c of (data.classes || [])) {
        TT.classData[c.class_id] = c;
    }
    return classIds;
}

async function ttGenerate() {
    const breakAfter = parseInt(document.getElementById("ttBreakAfter").value, 10) || 4;
    const maxSame = parseInt(document.getElementById("ttMaxSame").value, 10) || 2;
    const btn = document.getElementById("ttBtnGenerate");
    const orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Generating…";
    ttShowError("");

    try {
        const classIds = await ttLoadSelectedClassData();
        if (classIds.length === 0) {
            ttShowError("No classes found in the selected years.");
            return;
        }

        // Map every class to its building based on year → building assignment
        const yearBuilding = {};
        for (const b of TT.buildings) for (const y of b.years) yearBuilding[y] = b.name;

        const payload = {
            classes: classIds.map(cid => {
                const cd = TT.classData[cid] || TT.classes.find(c => c.id === cid);
                const yr = cd?.grade_level;
                return {
                    class_id: cid,
                    building: yearBuilding[yr] || "",
                    subjects: [], // backend uses default 4 periods/week
                };
            }),
            constraints: { break_after: breakAfter, max_same_subject_per_day: maxSame },
        };

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
        TT.subjectColor = {};
        for (const cid of Object.keys(TT.timetables)) {
            const t = TT.timetables[cid].timetable || {};
            for (const d of Object.keys(t)) for (const p of Object.keys(t[d])) ttColorFor(t[d][p].subject_id);
        }
        ttRenderResults(data.stats);
        ttGoStep(4);
        showToast("Timetables generated", "success");
    } catch (e) {
        console.error(e);
        ttShowError(e.message || "Generation failed.");
        showToast("Generation failed", "error");
    } finally {
        btn.disabled = false;
        btn.textContent = orig;
    }
}

function ttRenderResults(stats) {
    const statsBox = document.getElementById("ttStats");
    statsBox.innerHTML = stats ? `
        <div class="tt-stat"><strong>${stats.classes_count}</strong>Classes</div>
        <div class="tt-stat"><strong>${stats.filled_slots}</strong>Filled slots</div>
        <div class="tt-stat"><strong>${stats.free_slots}</strong>Free slots</div>
        <div class="tt-stat"><strong>${stats.total_slots}</strong>Total slots</div>
    ` : "";

    const wrap = document.getElementById("ttResults");
    // Group by year
    const byYear = {};
    for (const cid of Object.keys(TT.timetables)) {
        const cd = TT.classData[cid] || TT.classes.find(c => c.id === cid) || {};
        const yr = cd.grade_level || 0;
        (byYear[yr] = byYear[yr] || []).push(cid);
    }
    const years = Object.keys(byYear).map(n => parseInt(n, 10)).sort((a, b) => a - b);

    let html = "";
    for (const yr of years) {
        html += `<h3 style="margin:18px 0 6px;color:var(--primary-blue);">Year ${yr}</h3>`;
        for (const cid of byYear[yr]) {
            const block = TT.timetables[cid];
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
    }
    wrap.innerHTML = html || '<p class="empty-state">No timetables produced.</p>';
    ttBindResultEvents();
}

function ttBindResultEvents() {
    const wrap = document.getElementById("ttResults");
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

// ----- Slot modal -----

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
        if (!res.ok) { showToast(data.message || "Failed", "error"); return; }
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
        const block = document.querySelector(`.tt-result-block[data-class="${class_id}"] table.tt-grid`);
        if (block) block.innerHTML = ttGridBody(class_id);
        ttBindResultEvents();
        ttCloseSlotModal();
        showToast("Slot updated", "success");
    } catch (e) {
        console.error(e);
        showToast("Failed", "error");
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
        ttBindResultEvents();
        ttCloseSlotModal();
        showToast("Slot cleared", "success");
    } catch (e) {
        console.error(e);
        showToast("Failed", "error");
    }
}

// ----- Per-class clear + export -----

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
            ttBindResultEvents();
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
    for (const cid of Object.keys(TT.timetables)) ttExportCsv(cid);
}

// ----- Init -----

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

    document.getElementById("ttAddBuildingBtn").addEventListener("click", ttAddBuilding);
    document.getElementById("ttBtnNext1").addEventListener("click", () => {
        const err = ttValidateBuildings();
        if (err) { ttShowError(err); return; }
        // Drop empty buildings
        TT.buildings = TT.buildings.filter(b => b.years.length > 0);
        ttGoStep(2);
        ttRenderYearPicker();
    });
    document.getElementById("ttBtnBack2").addEventListener("click", () => {
        ttGoStep(1);
        ttRenderBuildings();
    });
    document.getElementById("ttBtnNext2").addEventListener("click", () => {
        if (TT.selectedYears.length === 0) { ttShowError("Pick at least one year."); return; }
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
