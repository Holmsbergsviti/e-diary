// Chartwell E-Diary — Timetable Generator v2
// Steps: 1) preview/save groups   2) generate + confirm save

const V2_DAYS_SHORT = ["", "Mon", "Tue", "Wed", "Thu", "Fri"];
const V2_DAY_FULL = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const V2_PERIODS = [1, 2, 3, 4, 5, 6, 7, 8];
const V2_DAYS = [1, 2, 3, 4, 5];

const V2 = {
    placements: null,    // last generated (in-memory)
    groupsLoaded: false,
    lastSeed: null,
};

// ─────────────────────────── helpers ───────────────────────────

function v2Esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;",
        "\"": "&quot;", "'": "&#39;",
    }[c]));
}

function v2ShowError(msg) {
    const box = document.getElementById("v2ErrorBox");
    if (!box) return;
    if (!msg) { box.style.display = "none"; box.textContent = ""; return; }
    box.style.display = "";
    box.textContent = msg;
}

function v2GoStep(n) {
    document.querySelectorAll(".v2-step").forEach(s => {
        s.classList.toggle("active", parseInt(s.dataset.step) === n);
    });
    document.querySelectorAll(".v2-pill").forEach(p => {
        const i = parseInt(p.dataset.pill);
        p.classList.toggle("active", i === n);
        p.classList.toggle("done", i < n);
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
}

function v2BtnLoading(btn, isLoading, label) {
    if (!btn) return;
    if (isLoading) {
        btn.dataset.origLabel = btn.textContent;
        btn.disabled = true;
        btn.textContent = label || "Working…";
    } else {
        btn.disabled = false;
        btn.textContent = btn.dataset.origLabel || label || "Done";
    }
}

// ─────────────────────────── step 1: groups ───────────────────────────

async function v2PreviewGroups() {
    v2ShowError("");
    const btn = document.getElementById("v2BtnPreview");
    v2BtnLoading(btn, true, "Computing…");
    try {
        const res = await apiFetch("/admin/timetable/v2/groups/preview/", {
            method: "POST", body: "{}",
        });
        const d = await res.json();
        if (!res.ok) {
            v2ShowError(d.message || "Failed to preview groups");
            return;
        }
        v2RenderGroups(d.groups || []);
        V2.groupsLoaded = true;
        document.getElementById("v2BtnSaveGroups").disabled = false;
        document.getElementById("v2BtnNext1").disabled = false;
    } finally {
        v2BtnLoading(btn, false);
    }
}

function v2RenderGroups(groups) {
    const box = document.getElementById("v2GroupsBox");
    if (!groups.length) {
        box.innerHTML = `<p class="empty-state">No groups computed. Make sure students have enrollments.</p>`;
        return;
    }
    // Section by year.
    const byYear = {};
    for (const g of groups) {
        const y = g.year ?? 0;
        if (!byYear[y]) byYear[y] = [];
        byYear[y].push(g);
    }
    const yearKeys = Object.keys(byYear).sort();
    let html = "";
    for (const y of yearKeys) {
        html += `<div class="v2-section-head">Year ${y}</div>`;
        const rows = byYear[y].slice().sort((a, b) =>
            (a.subject_name || "").localeCompare(b.subject_name || "") ||
            (a.group_label || "").localeCompare(b.group_label || ""));
        // Group by subject for readability
        const bySub = {};
        for (const r of rows) (bySub[r.subject_name] ||= []).push(r);
        for (const subj of Object.keys(bySub).sort()) {
            html += `<div class="v2-sub-head">${v2Esc(subj)}</div>`;
            html += `<table class="v2-table"><thead><tr><th>Group</th><th>Size</th></tr></thead><tbody>`;
            for (const r of bySub[subj]) {
                html += `<tr><td>${v2Esc(r.group_label)}</td><td>${r.size}</td></tr>`;
            }
            html += `</tbody></table>`;
        }
    }
    box.innerHTML = html;
}

async function v2SaveGroups() {
    v2ShowError("");
    const btn = document.getElementById("v2BtnSaveGroups");
    v2BtnLoading(btn, true, "Saving…");
    try {
        const res = await apiFetch("/admin/timetable/v2/groups/save/", {
            method: "POST", body: "{}",
        });
        const d = await res.json();
        if (!res.ok) {
            v2ShowError(d.message || "Failed to save groups");
            return;
        }
        showToast(`Saved ${d.updated || 0} group labels`, "success");
    } finally {
        v2BtnLoading(btn, false);
    }
}

// ─────────────────────────── step 2: generate ───────────────────────────

async function v2Generate() {
    v2ShowError("");
    const btn = document.getElementById("v2BtnRegen") || document.getElementById("v2BtnNext1");
    v2BtnLoading(btn, true, "Generating…");
    try {
        V2.lastSeed = Math.floor(Math.random() * 1e9);
        const res = await apiFetch("/admin/timetable/v2/generate/", {
            method: "POST",
            body: JSON.stringify({ seed: V2.lastSeed }),
        });
        const d = await res.json();
        if (!res.ok) {
            v2ShowError(d.message || "Failed to generate");
            return;
        }
        V2.placements = d.placements || [];
        v2RenderResults(d);
        v2GoStep(2);
    } finally {
        v2BtnLoading(btn, false);
    }
}

function v2RenderResults(d) {
    const stats = document.getElementById("v2Stats");
    const placements = d.placements || [];
    const unplaced = d.unplaced || [];
    const teacherCount = new Set(placements.map(p => p.teacher_id)).size;
    const lessonCount = new Set(placements.map(p => p.lid)).size;
    stats.innerHTML = `
        <div class="v2-stat"><strong>${placements.length}</strong>Placed periods</div>
        <div class="v2-stat"><strong>${lessonCount}</strong>Lessons</div>
        <div class="v2-stat"><strong>${teacherCount}</strong>Teachers used</div>
        <div class="v2-stat"><strong>${unplaced.length}</strong>Unplaced</div>
    `;

    const upBox = document.getElementById("v2Unplaced");
    if (unplaced.length) {
        upBox.innerHTML = `
            <div class="v2-error-box">
                <strong>${unplaced.length} lesson(s) could not be placed:</strong>
                <ul style="margin:6px 0 0 18px;">
                    ${unplaced.slice(0, 12).map(u =>
                        `<li>${v2Esc(u.subject_name)} ${v2Esc(u.group_label || u.class_name || "")} (year ${u.year}) — ${v2Esc(u.reason || "no slot")}</li>`).join("")}
                </ul>
                ${unplaced.length > 12 ? `<small>… and ${unplaced.length - 12} more.</small>` : ""}
            </div>
        `;
    } else {
        upBox.innerHTML = "";
    }

    // Render per-year per-class grids and per-group grids.
    const results = document.getElementById("v2Results");
    const byYear = {};
    for (const p of placements) (byYear[p.year] ||= []).push(p);
    let html = "";
    for (const year of Object.keys(byYear).sort()) {
        html += `<div class="v2-section-head">Year ${year}</div>`;
        const yearP = byYear[year];
        // Class-wide lessons grouped by class_name.
        const byClass = {};
        const byGroup = {};
        for (const p of yearP) {
            if (p.class_id) {
                (byClass[p.class_name || p.class_id] ||= []).push(p);
            } else {
                const k = `${p.subject_name} ${p.group_label || ""}`;
                (byGroup[k] ||= []).push(p);
            }
        }
        for (const cn of Object.keys(byClass).sort()) {
            html += v2RenderGrid(`Class ${v2Esc(cn)}`, byClass[cn], { showClass: false, showTeacher: true });
        }
        for (const k of Object.keys(byGroup).sort()) {
            html += v2RenderGrid(v2Esc(k), byGroup[k], { showClass: false, showTeacher: true });
        }
    }
    results.innerHTML = html || `<p class="empty-state">No placements.</p>`;
}

function v2RenderGrid(title, slots, opts) {
    opts = opts || {};
    const byKey = {};
    for (const s of slots) {
        const k = `${s.day}_${s.period}`;
        (byKey[k] ||= []).push(s);
    }
    let html = `<div class="v2-sub-head">${title}</div>
        <div class="v2-grid-wrap"><table class="v2-grid">
            <thead><tr>
                <th class="v2-period">Per.</th>
                ${V2_DAYS.map(d => `<th>${V2_DAYS_SHORT[d]}</th>`).join("")}
            </tr></thead><tbody>`;
    for (const p of V2_PERIODS) {
        html += `<tr><td class="v2-period">${p}</td>`;
        for (const d of V2_DAYS) {
            const cells = byKey[`${d}_${p}`] || [];
            if (!cells.length) {
                html += `<td class="v2-cell v2-cell-empty">—</td>`;
            } else {
                const inner = cells.map(c => `
                    <div>
                        <div class="v2-cell-subject">${v2Esc(c.subject_name)}</div>
                        ${c.group_label ? `<div class="v2-cell-meta">${v2Esc(c.group_label)}</div>` : ""}
                        ${opts.showTeacher && c.teacher_name ? `<div class="v2-cell-meta">${v2Esc(c.teacher_name)}</div>` : ""}
                    </div>`).join("");
                html += `<td class="v2-cell">${inner}</td>`;
            }
        }
        html += "</tr>";
    }
    html += "</tbody></table></div>";
    return html;
}

async function v2Confirm() {
    if (!V2.placements || !V2.placements.length) {
        v2ShowError("Nothing to save — generate first.");
        return;
    }
    const ok = await showConfirm(
        "This will wipe the live schedule and replace it with the previewed timetable. Group labels on student_subjects will also be updated. Continue?",
        { title: "Save new timetable", confirmText: "Save" }
    );
    if (!ok) return;
    const btn = document.getElementById("v2BtnConfirm");
    v2BtnLoading(btn, true, "Saving…");
    try {
        const res = await apiFetch("/admin/timetable/v2/save/", {
            method: "POST",
            body: JSON.stringify({ placements: V2.placements, save_groups: true }),
        });
        const d = await res.json();
        if (!res.ok) {
            v2ShowError(d.message || "Failed to save");
            return;
        }
        showToast(`Saved ${d.inserted || 0} schedule rows`, "success");
    } finally {
        v2BtnLoading(btn, false);
    }
}

// ─────────────────────────── wiring ───────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
    if (!requireAuth()) return;
    initNav();

    document.getElementById("v2BtnPreview").addEventListener("click", v2PreviewGroups);
    document.getElementById("v2BtnSaveGroups").addEventListener("click", v2SaveGroups);
    document.getElementById("v2BtnNext1").addEventListener("click", () => v2Generate());
    document.getElementById("v2BtnBack2").addEventListener("click", () => v2GoStep(1));
    document.getElementById("v2BtnRegen").addEventListener("click", () => v2Generate());
    document.getElementById("v2BtnConfirm").addEventListener("click", v2Confirm);
});
