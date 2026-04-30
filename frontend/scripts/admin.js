// Chartwell E-Diary — Admin panel
// Authors: Vladislav Salii, Stepan Atroshkin

let currentSection = "overview";
let cachedClasses = [];
let cachedSubjects = [];
let cachedTeachers = [];
let cachedStudents = [];

/* Permission-key → tab-section mapping */
const TAB_PERMS = {
    overview: null,          // always visible
    classes: "classes",
    subjects: "subjects",
    teachers: "teachers",
    students: "students",
    admins: "__manage_admins__",  // special: super/master only
    assignments: "schedule",
    enrollments: "students",
    schedule: "schedule",
    events: "events",
    holidays: "holidays",
    attendance: "attendance",
    import: "import",
    "student-lookup": "students",
    exports: "exports",
};

const ALL_PERM_KEYS = [
    { key: "students",   label: "Students" },
    { key: "teachers",   label: "Teachers" },
    { key: "classes",    label: "Classes" },
    { key: "subjects",   label: "Subjects" },
    { key: "schedule",   label: "Timetable" },
    { key: "events",     label: "Events" },
    { key: "holidays",   label: "Holidays" },
    { key: "attendance", label: "Attendance" },
    { key: "import",     label: "Import" },
    { key: "exports",    label: "Exports" },
    { key: "impersonate", label: "Impersonate" },
];

function _adminLevel() { return (getUser() || {}).admin_level || "regular"; }
function _adminPerms() { return (getUser() || {}).permissions || {}; }

// Grade badge CSS class helper
function gradeClass(code) {
    if (!code) return "";
    const c = code.toUpperCase().replace("*", "").replace("+", "").replace("-", "");
    if (c === "A") return "grade-a";
    if (c === "B") return "grade-b";
    if (c === "C") return "grade-c";
    if (c === "D") return "grade-d";
    if (c === "E") return "grade-e";
    return "grade-u";
}

function _hasPerm(key) {
    const lvl = _adminLevel();
    if (lvl === "super" || lvl === "master") return true;
    return !!_adminPerms()[key];
}
function _canManageAdmins() { return ["super", "master"].includes(_adminLevel()); }

async function initAdmin() {
    if (!requireAuth()) return;
    const user = getUser();
    if (!user || user.role !== "admin") {
        window.location.href = "index.html";
        return;
    }
    initNav();
    filterAdminTabs();
    bindAdminTabs();
    await loadSection(currentSection);
}

function filterAdminTabs() {
    document.querySelectorAll("#adminTabs .admin-tab").forEach(btn => {
        const sec = btn.dataset.section;
        const permKey = TAB_PERMS[sec];
        if (permKey === null) return; // always visible
        if (permKey === "__manage_admins__") {
            btn.style.display = _canManageAdmins() ? "" : "none";
        } else {
            btn.style.display = _hasPerm(permKey) ? "" : "none";
        }
    });
}

function bindAdminTabs() {
    document.querySelectorAll("#adminTabs .admin-tab").forEach(btn => {
        btn.addEventListener("click", async () => {
            document.querySelectorAll("#adminTabs .admin-tab").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            currentSection = btn.dataset.section;
            await loadSection(currentSection);
        });
    });
}

/* ───── Chunked import helper ─────
   Sends `rows` to /admin/csv-import/ in batches so a single request
   never holds open long enough for Render to time out. Returns
   { created, errors, credentials } aggregated across batches. */
async function chunkedImport({ type, rows, chunkSize = 40, onProgress }) {
    const allErrors = [];
    const allCreds = [];
    let created = 0;
    for (let i = 0; i < rows.length; i += chunkSize) {
        const slice = rows.slice(i, i + chunkSize);
        if (typeof onProgress === "function") {
            onProgress({ done: i, total: rows.length });
        }
        let d;
        try {
            const res = await apiFetch("/admin/csv-import/", {
                method: "POST",
                body: JSON.stringify({ type, rows: slice }),
            });
            d = await res.json();
        } catch (err) {
            for (let j = 0; j < slice.length; j++) {
                allErrors.push({ row: i + j + 1, error: "Network error: " + err.message });
            }
            continue;
        }
        created += d.created || 0;
        if (Array.isArray(d.errors)) {
            for (const e of d.errors) {
                allErrors.push({ row: i + (e.row || 0), error: e.error });
            }
        }
        if (Array.isArray(d.credentials)) allCreds.push(...d.credentials);
    }
    if (typeof onProgress === "function") {
        onProgress({ done: rows.length, total: rows.length });
    }
    return { created, errors: allErrors, credentials: allCreds };
}

/* ───── Bulk-select helper ─────
   Decorates an admin-table inside `container` with a leading checkbox
   column + a floating action bar. Rows must carry data-bulk-id="…".
   `deleteOne(rowEl)` is awaited per selected row. */
function installBulkSelect(container, { label = "items", deleteOne, onDone }) {
    const table = container.querySelector("table.admin-table");
    if (!table) return;
    const headRow = table.querySelector("thead tr");
    const bodyRows = table.querySelectorAll("tbody tr[data-bulk-id]");
    if (!headRow || bodyRows.length === 0) return;

    // Prepend master checkbox header
    const masterTh = document.createElement("th");
    masterTh.style.width = "32px";
    masterTh.innerHTML = `<input type="checkbox" class="bulk-master" title="Select all">`;
    headRow.insertBefore(masterTh, headRow.firstChild);

    // Prepend per-row checkboxes
    bodyRows.forEach(tr => {
        const td = document.createElement("td");
        td.innerHTML = `<input type="checkbox" class="bulk-row">`;
        tr.insertBefore(td, tr.firstChild);
    });

    // Toolbar above table
    const bar = document.createElement("div");
    bar.className = "bulk-bar";
    bar.style.cssText = "display:none;align-items:center;gap:10px;padding:8px 12px;margin:0 0 10px;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.25);border-radius:8px;";
    bar.innerHTML = `
        <span class="bulk-bar-count" style="font-weight:600;color:#b91c1c;"></span>
        <button class="btn btn-sm btn-danger bulk-delete-btn" type="button">Delete selected</button>
        <button class="btn btn-sm btn-secondary bulk-clear-btn" type="button">Clear</button>
    `;
    table.parentNode.insertBefore(bar, table);

    const countEl = bar.querySelector(".bulk-bar-count");
    const master = headRow.querySelector(".bulk-master");
    const rowBoxes = () => container.querySelectorAll("tbody tr[data-bulk-id] .bulk-row");

    function refresh() {
        const boxes = rowBoxes();
        const checked = Array.from(boxes).filter(b => b.checked);
        const n = checked.length;
        bar.style.display = n > 0 ? "flex" : "none";
        countEl.textContent = `${n} ${label} selected`;
        master.checked = n > 0 && n === boxes.length;
        master.indeterminate = n > 0 && n < boxes.length;
    }

    master.addEventListener("change", () => {
        rowBoxes().forEach(b => { b.checked = master.checked; });
        refresh();
    });
    container.addEventListener("change", e => {
        if (e.target.classList && e.target.classList.contains("bulk-row")) refresh();
    });
    bar.querySelector(".bulk-clear-btn").addEventListener("click", () => {
        rowBoxes().forEach(b => { b.checked = false; });
        refresh();
    });
    bar.querySelector(".bulk-delete-btn").addEventListener("click", async () => {
        const checked = Array.from(rowBoxes()).filter(b => b.checked);
        if (checked.length === 0) return;
        const ok = await showConfirm(
            `Delete ${checked.length} ${label}? This cannot be undone.`,
            { title: `Delete ${checked.length} ${label}`, confirmText: "Delete all" }
        );
        if (!ok) return;
        const btn = bar.querySelector(".bulk-delete-btn");
        btn.disabled = true;
        btn.textContent = "Deleting…";
        let ok_count = 0, fail_count = 0;
        for (const box of checked) {
            const tr = box.closest("tr");
            try {
                const res = await deleteOne(tr);
                if (res === false) fail_count++;
                else ok_count++;
            } catch (err) {
                fail_count++;
            }
        }
        if (ok_count > 0) showToast(`${ok_count} ${label} deleted${fail_count ? `, ${fail_count} failed` : ""}`, fail_count ? "warning" : "success");
        else if (fail_count > 0) showToast(`Failed to delete ${fail_count} ${label}`, "error");
        if (typeof onDone === "function") await onDone();
    });

    refresh();
}

/* ───── Cache helpers ───── */
function _byPersonName(a, b) {
    return (`${a.surname || ''} ${a.name || ''}`)
        .localeCompare(`${b.surname || ''} ${b.name || ''}`, undefined, { sensitivity: "base" });
}
function _byClassName(a, b) {
    const ga = a.grade_level || 0, gb = b.grade_level || 0;
    if (ga !== gb) return ga - gb;
    return (a.class_name || "").localeCompare(b.class_name || "", undefined, { sensitivity: "base" });
}
function _byName(a, b) {
    return (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" });
}

async function fetchClasses() {
    const res = await apiFetch("/admin/classes/");
    const d = await res.json();
    cachedClasses = (d.classes || []).slice().sort(_byClassName);
    return cachedClasses;
}
async function fetchSubjects() {
    const res = await apiFetch("/admin/subjects/");
    const d = await res.json();
    cachedSubjects = (d.subjects || []).slice().sort(_byName);
    return cachedSubjects;
}
async function fetchTeachers() {
    const res = await apiFetch("/admin/users/?role=teacher");
    const d = await res.json();
    cachedTeachers = (d.users || []).slice().sort(_byPersonName);
    return cachedTeachers;
}
async function fetchStudents() {
    const res = await apiFetch("/admin/users/?role=student");
    const d = await res.json();
    cachedStudents = (d.users || []).slice().sort((a, b) => {
        const ga = a.grade_level || 0, gb = b.grade_level || 0;
        if (ga !== gb) return ga - gb;
        const cn = (a.class_name || "").localeCompare(b.class_name || "", undefined, { sensitivity: "base" });
        if (cn !== 0) return cn;
        return _byPersonName(a, b);
    });
    return cachedStudents;
}

function classOptions(selectedId) {
    return cachedClasses.map(c =>
        `<option value="${c.id}" ${c.id === selectedId ? "selected" : ""}>${escHtml(c.class_name)} (Year ${c.grade_level})</option>`
    ).join("");
}
function homeroomOptions(selectedId) {
    const re = /^\d{1,2}[A-Za-z]$/;
    return cachedClasses
        .filter(c => re.test((c.class_name || "").trim()))
        .map(c => `<option value="${c.id}" ${c.id === selectedId ? "selected" : ""}>${escHtml(c.class_name)} (Year ${c.grade_level})</option>`)
        .join("");
}
function subjectOptions(selectedId) {
    return cachedSubjects.map(s =>
        `<option value="${s.id}" ${s.id === selectedId ? "selected" : ""}>${escHtml(s.name)}</option>`
    ).join("");
}
function teacherOptions(selectedId) {
    return cachedTeachers.map(t =>
        `<option value="${t.id}" ${t.id === selectedId ? "selected" : ""}>${escHtml(t.surname)} ${escHtml(t.name)}</option>`
    ).join("");
}
function studentOptions(selectedId) {
    return cachedStudents.map(s =>
        `<option value="${s.id}" ${s.id === selectedId ? "selected" : ""}>${escHtml(s.surname)} ${escHtml(s.name)}</option>`
    ).join("");
}

/* ───── Section router ───── */
async function loadSection(section) {
    const container = document.getElementById("adminContent");
    container.innerHTML = '<p class="loading">Loading…</p>';
    try {
        switch (section) {
            case "overview": await loadOverview(container); break;
            case "student-lookup": await loadStudentLookup(container); break;
            case "classes": await loadClasses(container); break;
            case "subjects": await loadSubjects(container); break;
            case "teachers": await loadTeachers(container); break;
            case "students": await loadStudents(container); break;
            case "admins": await loadAdmins(container); break;
            case "assignments": await loadAssignments(container); break;
            case "enrollments": await loadEnrollments(container); break;
            case "schedule": await loadSchedule(container); break;
            case "events": await loadEvents(container); break;
            case "holidays": await loadHolidays(container); break;
            case "attendance": await loadAttendanceFlags(container); break;
            case "import": renderImportSection(container); break;
            case "exports": await loadExports(container); break;
            default: container.innerHTML = '<p class="empty-state">Unknown section.</p>';
        }
    } catch (err) {
        container.innerHTML = `<p class="empty-state">Error loading: ${escHtml(err.message)}</p>`;
    }
}

/* ═══════════════ OVERVIEW ═══════════════ */
async function loadOverview(container) {
    const res = await apiFetch("/admin/stats/");
    if (!res.ok) {
        container.innerHTML = '<p class="empty-state">Could not load overview. The backend may still be deploying.</p>';
        return;
    }
    let stats;
    try {
        stats = await res.json();
    } catch (e) {
        container.innerHTML = '<p class="empty-state">Could not load overview. The backend may still be deploying.</p>';
        return;
    }
    const attRate = stats.att_rate_week == null ? "–" : `${stats.att_rate_week}%`;
    container.innerHTML = `
        <div class="admin-section-header"><h3>School Overview</h3></div>
        <div class="stats-grid">
            <div class="stat-card"><div class="stat-number">${stats.total_classes || 0}</div><div class="stat-label">Classes</div></div>
            <div class="stat-card"><div class="stat-number">${stats.total_teachers || 0}</div><div class="stat-label">Teachers</div></div>
            <div class="stat-card"><div class="stat-number">${stats.total_students || 0}</div><div class="stat-label">Students</div></div>
            <div class="stat-card"><div class="stat-number">${attRate}</div><div class="stat-label">Attendance This Week</div></div>
            <div class="stat-card"><div class="stat-number">${stats.pending_events_week || 0}</div><div class="stat-label">Events This Week</div></div>
        </div>
    `;
}

/* ═══════════════ STUDENT LOOKUP ═══════════════ */
async function loadStudentLookup(container) {
    await fetchStudents();
    container.innerHTML = `
        <div class="admin-section-header"><h3>Student Lookup</h3></div>
        <p style="color:var(--text-light);margin-bottom:12px;">Search for a student to view their full profile — grades, attendance, homework, behavioral notes, and enrolled subjects.</p>
        <div style="display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap;align-items:center;">
            <input type="text" id="studentSearchInput" class="form-control" placeholder="Type student name…" style="max-width:320px;">
            <select id="studentSearchSelect" class="form-control" style="max-width:360px;"><option value="">— or pick from list —</option>${cachedStudents.sort((a,b)=>(`${a.surname} ${a.name}`).localeCompare(`${b.surname} ${b.name}`)).map(s=>`<option value="${s.id}">${escHtml(s.surname)} ${escHtml(s.name)} (${escHtml(s.class_name||'')})</option>`).join('')}</select>
            <button class="btn btn-primary btn-sm" id="studentSearchBtn">Search</button>
        </div>
        <div id="studentLookupResult"></div>
    `;

    const input = document.getElementById("studentSearchInput");
    const select = document.getElementById("studentSearchSelect");
    const btn = document.getElementById("studentSearchBtn");

    // Auto-filter dropdown as user types
    input.addEventListener("input", () => {
        const q = input.value.trim().toLowerCase();
        const opts = select.querySelectorAll("option");
        let firstMatch = null;
        opts.forEach(o => {
            if (!o.value) return;
            const vis = o.textContent.toLowerCase().includes(q);
            o.style.display = vis ? "" : "none";
            if (vis && !firstMatch) firstMatch = o.value;
        });
        if (firstMatch) select.value = firstMatch;
    });

    const doSearch = async () => {
        const sid = select.value;
        if (!sid) { showToast("Please select a student", "error"); return; }
        const result = document.getElementById("studentLookupResult");
        result.innerHTML = '<p class="loading">Loading student data…</p>';
        try {
            const res = await apiFetch(`/admin/student-lookup/?student_id=${sid}`);
            if (!res.ok) throw new Error("Failed to load");
            const data = await res.json();
            renderStudentProfile(result, data);
        } catch (err) {
            result.innerHTML = `<p class="empty-state">Error: ${escHtml(err.message)}</p>`;
        }
    };
    btn.addEventListener("click", doSearch);
    select.addEventListener("change", doSearch);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") doSearch(); });
}

function renderStudentProfile(container, data) {
    const s = data.student;
    const att = data.attendance;
    const hw = data.homework;
    const beh = data.behavioral;

    // Attendance bar
    const attTotal = att.total || 0;
    const attBar = attTotal > 0 ? `
        <div class="student-stat-bar" style="margin:8px 0;">
            <div class="stat-bar-seg stat-bar-present" style="width:${((att.summary.Present||0)/attTotal*100).toFixed(1)}%" title="Present: ${att.summary.Present||0}"></div>
            <div class="stat-bar-seg stat-bar-late" style="width:${((att.summary.Late||0)/attTotal*100).toFixed(1)}%" title="Late: ${att.summary.Late||0}"></div>
            <div class="stat-bar-seg stat-bar-absent" style="width:${((att.summary.Absent||0)/attTotal*100).toFixed(1)}%" title="Absent: ${att.summary.Absent||0}"></div>
            <div class="stat-bar-seg stat-bar-excused" style="width:${((att.summary.Excused||0)/attTotal*100).toFixed(1)}%" title="Excused: ${att.summary.Excused||0}"></div>
        </div>
        <div class="student-stat-nums">
            <span class="stat-present">${att.summary.Present||0} present</span>
            <span class="stat-late">${att.summary.Late||0} late</span>
            <span class="stat-absent">${att.summary.Absent||0} absent</span>
            <span class="stat-excused">${att.summary.Excused||0} excused</span>
        </div>
        <small style="color:var(--text-light);">T1: ${att.by_term.term_1.rate ?? '–'}% · T2: ${att.by_term.term_2.rate ?? '–'}%</small>
    ` : '<span style="color:#94a3b8;">No attendance records</span>';

    // Subjects list
    const subjHtml = data.enrolled_subjects.length > 0
        ? data.enrolled_subjects.map(es => `<span class="lookup-subj-chip" style="border-left:3px solid ${es.color};">${escHtml(es.subject)}${es.group_class ? ` <small>(${escHtml(es.group_class)})</small>` : ''}</span>`).join('')
        : '<span style="color:#94a3b8;">No subjects enrolled</span>';

    // Subject grades
    let gradesHtml = '';
    if (data.subject_grades.length > 0) {
        gradesHtml = data.subject_grades.map(sg => {
            if (sg.grades.length === 0) {
                return `<div class="lookup-subject-block">
                    <div class="lookup-subject-header" style="border-left:3px solid ${sg.color};">
                        <strong>${escHtml(sg.subject)}</strong>
                        <span style="color:#94a3b8;font-size:0.82rem;">No grades</span>
                    </div>
                </div>`;
            }
            const avgStr = sg.average != null ? `Avg: ${sg.average}%` : '';
            const gradeItems = sg.grades.map(g => {
                const pct = g.percentage != null ? `<small class="grade-pct">${g.percentage}%</small>` : '';
                const cat = g.category ? `<small class="cat-label cat-${g.category}">${g.category}</small>` : '';
                const cmt = g.comment ? `<span class="grade-comment-icon" title="${escHtml(g.comment)}">💬</span>` : '';
                return `<div class="lookup-grade-item">
                    <span class="grade-badge ${gradeClass(g.grade_code)}">${escHtml(g.grade_code)}</span>
                    <span>${escHtml(g.assessment || 'Unnamed')} ${cat}</span>
                    ${pct}
                    <small style="color:#94a3b8;">T${g.term} · ${g.date || '–'}</small>
                    <small style="color:#94a3b8;">${escHtml(g.teacher)}</small>
                    ${cmt}
                </div>`;
            }).join('');
            return `<div class="lookup-subject-block">
                <div class="lookup-subject-header" style="border-left:3px solid ${sg.color};">
                    <strong>${escHtml(sg.subject)}</strong>
                    <span style="font-size:0.82rem;color:var(--text-light);">${sg.grade_count} grade${sg.grade_count!==1?'s':''} ${avgStr}</span>
                </div>
                <div class="lookup-grade-list">${gradeItems}</div>
            </div>`;
        }).join('');
    } else {
        gradesHtml = '<p class="empty-state">No grades recorded.</p>';
    }

    // Homework
    const hwTotal = (hw.counts.completed||0) + (hw.counts.partial||0) + (hw.counts.not_done||0);
    let hwHtml = '';
    if (hwTotal > 0) {
        const STATUS_ICON = { completed: '✅', partial: '🔶', not_done: '❌' };
        const STATUS_LABEL = { completed: 'Done', partial: 'Partial', not_done: 'Missing' };
        hwHtml = `<div class="student-stat-hw" style="margin-bottom:8px;">
            <span class="stat-hw-pill stat-hw-done">${hw.counts.completed||0} done</span>
            <span class="stat-hw-pill stat-hw-partial">${hw.counts.partial||0} partial</span>
            <span class="stat-hw-pill stat-hw-not">${hw.counts.not_done||0} missing</span>
        </div>
        <div class="hw-detail-list" style="max-height:none;">
            ${hw.items.map(h => `<div class="hw-detail-row hw-detail-${h.status}">
                <span class="hw-detail-icon">${STATUS_ICON[h.status]||'❌'}</span>
                <span class="hw-detail-title">${escHtml(h.title)} <span class="hw-detail-subj">${escHtml(h.subject)}</span></span>
                <span class="hw-detail-due">${h.due_date||'–'}</span>
                <small style="color:#94a3b8;">${escHtml(h.teacher)}</small>
                <span class="hw-detail-status">${STATUS_LABEL[h.status]||'Missing'}</span>
            </div>`).join('')}
        </div>`;
    } else {
        hwHtml = '<span style="color:#94a3b8;">No homework assigned.</span>';
    }

    // Behavioral
    const behTotal = (beh.counts.positive||0) + (beh.counts.negative||0) + (beh.counts.note||0);
    let behHtml = '';
    if (behTotal > 0) {
        behHtml = `<div class="student-stat-hw" style="margin-bottom:8px;">
            <span class="stat-hw-pill" style="background:#d1fae5;color:#065f46;">👍 ${beh.counts.positive||0}</span>
            <span class="stat-hw-pill" style="background:#fee2e2;color:#991b1b;">👎 ${beh.counts.negative||0}</span>
            <span class="stat-hw-pill" style="background:#e0e7ff;color:#3730a3;">📝 ${beh.counts.note||0}</span>
        </div>
        <div class="lookup-beh-list">
            ${beh.records.map(b => {
                const typeIcon = b.type === 'positive' ? '👍' : b.type === 'negative' ? '👎' : '📝';
                return `<div class="lookup-beh-row">
                    <span>${typeIcon}</span>
                    <span style="flex:1;">${escHtml(b.content)}</span>
                    <small style="color:#94a3b8;">${escHtml(b.subject)}</small>
                    <small style="color:#94a3b8;">${b.date}</small>
                    <small style="color:#94a3b8;">${escHtml(b.teacher)}</small>
                </div>`;
            }).join('')}
        </div>`;
    } else {
        behHtml = '<span style="color:#94a3b8;">No behavioral entries.</span>';
    }

    // Recent attendance
    let attRecHtml = '';
    if (att.records.length > 0) {
        attRecHtml = `<details class="lookup-att-details"><summary style="cursor:pointer;font-size:0.82rem;color:var(--primary-blue);font-weight:600;">Recent attendance records (${att.records.length})</summary>
        <table class="admin-table" style="margin-top:8px;font-size:0.82rem;">
            <thead><tr><th>Date</th><th>Subject</th><th>Status</th><th>Teacher</th><th>Comment</th></tr></thead>
            <tbody>${att.records.map(r => `<tr>
                <td>${r.date}</td>
                <td>${escHtml(r.subject)}</td>
                <td><span class="status-${r.status.toLowerCase()}">${r.status}</span></td>
                <td>${escHtml(r.teacher)}</td>
                <td>${r.comment ? escHtml(r.comment) : '–'}</td>
            </tr>`).join('')}</tbody>
        </table></details>`;
    }

    container.innerHTML = `
        <div class="lookup-profile-card">
            <div class="lookup-header">
                <div style="display:flex;align-items:center;gap:14px;">
                    <div class="lookup-avatar-wrapper">
                        ${s.profile_picture_url
                            ? `<img src="${escHtml(s.profile_picture_url)}" alt="">`
                            : `<span class="lookup-avatar-initials">${escHtml((s.name||'')[0]||'')}${escHtml((s.surname||'')[0]||'')}</span>`}
                    </div>
                    <div>
                        <h3 style="margin:0">${escHtml(s.surname)} ${escHtml(s.name)}</h3>
                        <span class="class-tag">${escHtml(s.class_name)}</span>
                        <span style="color:var(--text-light);font-size:0.85rem;">Year ${s.grade_level}</span>
                    </div>
                </div>
                ${s.default_password ? `<span class="lookup-pw-badge" title="Default password"><span style="font-size:0.75rem;color:var(--text-light);">🔑</span> <code class="default-pw">${escHtml(s.default_password)}</code></span>` : ''}
            </div>

            <div class="lookup-section">
                <h4>📚 Enrolled Subjects (${data.enrolled_subjects.length})</h4>
                <div class="lookup-subj-list">${subjHtml}</div>
            </div>

            <div class="lookup-section">
                <h4>📋 Attendance${att.rate != null ? ` — ${att.rate}%` : ''}</h4>
                ${attBar}
                ${attRecHtml}
            </div>

            <div class="lookup-section">
                <h4>📊 Grades</h4>
                ${gradesHtml}
            </div>

            <div class="lookup-section">
                <h4>📝 Homework</h4>
                ${hwHtml}
            </div>

            <div class="lookup-section">
                <h4>⭐ Behavioral Notes</h4>
                ${behHtml}
            </div>
        </div>
    `;
}

/* ═══════════════ EXPORTS ═══════════════ */
async function loadExports(container) {
    container.innerHTML = `
        <div class="admin-section-header"><h3>Exports</h3></div>
        <p style="color:var(--text-light);margin-bottom:16px;">Download data from any section as CSV or Excel. Click a category to fetch and export.</p>
        <div class="export-grid">
            <div class="export-card" onclick="doExport('classes')">
                <div class="export-card-icon">🏫</div>
                <div class="export-card-label">Classes</div>
            </div>
            <div class="export-card" onclick="doExport('subjects')">
                <div class="export-card-icon">📚</div>
                <div class="export-card-label">Subjects</div>
            </div>
            <div class="export-card" onclick="doExport('teachers')">
                <div class="export-card-icon">🧑‍🏫</div>
                <div class="export-card-label">Teachers</div>
            </div>
            <div class="export-card" onclick="doExport('students')">
                <div class="export-card-icon">🧑‍🎓</div>
                <div class="export-card-label">Students</div>
            </div>
            <div class="export-card" onclick="doExport('admins')">
                <div class="export-card-icon">🔑</div>
                <div class="export-card-label">Admins</div>
            </div>
            <div class="export-card" onclick="doExport('assignments')">
                <div class="export-card-icon">📋</div>
                <div class="export-card-label">Assignments</div>
            </div>
            <div class="export-card" onclick="doExport('enrollments')">
                <div class="export-card-icon">📝</div>
                <div class="export-card-label">Enrolments</div>
            </div>
            <div class="export-card" onclick="doExport('schedule')">
                <div class="export-card-icon">📅</div>
                <div class="export-card-label">Timetable</div>
            </div>
            <div class="export-card" onclick="doExport('events')">
                <div class="export-card-icon">🎉</div>
                <div class="export-card-label">Events</div>
            </div>
            <div class="export-card" onclick="doExport('holidays')">
                <div class="export-card-icon">🏖</div>
                <div class="export-card-label">Holidays</div>
            </div>
        </div>
    `;
}

async function doExport(type) {
    // Show format picker modal
    openAdminModal("Export " + type.charAt(0).toUpperCase() + type.slice(1), `
        <p style="margin-bottom:16px">Choose export format:</p>
        <div style="display:flex;gap:12px;justify-content:center">
            <button class="btn btn-primary" id="expCSV">📄 CSV</button>
            <button class="btn btn-primary" id="expXLSX">📊 Excel</button>
        </div>
    `, null);
    // Hide the default Save button
    const footer = document.querySelector("#adminModal .admin-modal-footer");
    if (footer) footer.style.display = "none";

    document.getElementById("expCSV").onclick = () => { closeAdminModal(); footer.style.display = ""; _fetchAndExport(type, "csv"); };
    document.getElementById("expXLSX").onclick = () => { closeAdminModal(); footer.style.display = ""; _fetchAndExport(type, "xlsx"); };
}

async function _fetchAndExport(type, fmt) {
    showToast("Fetching data…", "info");
    try {
        let rows, columns, headerMap, filename;
        switch (type) {
            case "classes": {
                const classes = await fetchClasses();
                rows = classes; columns = ["class_name","grade_level"];
                headerMap = { class_name:"Class Name", grade_level:"Year Level" }; filename = "Classes";
                break;
            }
            case "subjects": {
                const subjects = await fetchSubjects();
                rows = subjects; columns = ["name","color_code"];
                headerMap = { name:"Subject Name", color_code:"Color Code" }; filename = "Subjects";
                break;
            }
            case "teachers": {
                const teachers = await fetchTeachers();
                rows = teachers.map(t => ({
                    surname: t.surname, name: t.name, email: t.email || "",
                    is_class_teacher: t.is_class_teacher ? "Yes" : "No",
                    class_teacher_of: t.class_teacher_class_name || ""
                }));
                columns = ["surname","name","email","is_class_teacher","class_teacher_of"];
                headerMap = { surname:"Surname", name:"Name", email:"Email", is_class_teacher:"Class Teacher", class_teacher_of:"Class" };
                filename = "Teachers"; break;
            }
            case "students": {
                const students = await fetchStudents();
                rows = students.map(s => ({
                    surname: s.surname, name: s.name, email: s.email || "", class_name: s.class_name || ""
                }));
                columns = ["surname","name","email","class_name"];
                headerMap = { surname:"Surname", name:"Name", email:"Email", class_name:"Class" };
                filename = "Students"; break;
            }
            case "admins": {
                const res = await apiFetch("/admin/users/?role=admin");
                const d = await res.json();
                const admins = (d.users || []).filter(a => a.admin_level !== "super").sort(_byPersonName);
                rows = admins.map(a => {
                    const perms = a.permissions || {};
                    const permStr = (a.admin_level === "master") ? "All" : ALL_PERM_KEYS.filter(p => perms[p.key]).map(p => p.label).join(", ") || "None";
                    return { surname: a.surname, name: a.name, email: a.email || "", permissions: permStr };
                });
                columns = ["surname","name","email","permissions"];
                headerMap = { surname:"Surname", name:"Name", email:"Email", permissions:"Permissions" };
                filename = "Admins"; break;
            }
            case "assignments": {
                const res = await apiFetch("/admin/teacher-assignments/");
                const d = await res.json();
                rows = (d.assignments || []).map(a => ({
                    teacher_name: a.teacher_name, subject_name: a.subject_name, class_name: a.class_name
                }));
                columns = ["teacher_name","subject_name","class_name"];
                headerMap = { teacher_name:"Teacher", subject_name:"Subject", class_name:"Class" };
                filename = "Assignments"; break;
            }
            case "enrollments": {
                const res = await apiFetch("/admin/student-subjects/");
                const d = await res.json();
                rows = (d.enrollments || []).map(e => ({
                    student_name: e.student_name, subject_name: e.subject_name, group_class_name: e.group_class_name || ""
                }));
                columns = ["student_name","subject_name","group_class_name"];
                headerMap = { student_name:"Student", subject_name:"Subject", group_class_name:"Group Class" };
                filename = "Enrollments"; break;
            }
            case "schedule": {
                const res = await apiFetch("/admin/schedule/");
                const d = await res.json();
                rows = (d.schedule || []).map(s => ({
                    day: DAY_NAMES[s.day_of_week] || s.day_of_week, period: s.period,
                    teacher_name: s.teacher_name, subject_name: s.subject_name,
                    class_name: s.class_name, room: s.room || ""
                }));
                columns = ["day","period","teacher_name","subject_name","class_name","room"];
                headerMap = { day:"Day", period:"Period", teacher_name:"Teacher", subject_name:"Subject", class_name:"Class", room:"Room" };
                filename = "Timetable"; break;
            }
            case "events": {
                const res = await apiFetch("/admin/events/");
                const d = await res.json();
                rows = (d.events || []).map(ev => ({
                    title: ev.title, description: ev.description || "",
                    event_date: ev.event_date, event_end_date: ev.event_end_date || "",
                    start_time: ev.start_time || "", end_time: ev.end_time || "",
                    affected_periods: (ev.affected_periods || []).join(", "),
                    target_type: ev.target_type || "all"
                }));
                columns = ["title","description","event_date","event_end_date","start_time","end_time","affected_periods","target_type"];
                headerMap = { title:"Title", description:"Description", event_date:"Start Date", event_end_date:"End Date",
                    start_time:"Start Time", end_time:"End Time", affected_periods:"Periods", target_type:"Target" };
                filename = "Events"; break;
            }
            case "holidays": {
                const res = await apiFetch("/admin/holidays/");
                const d = await res.json();
                rows = (d.holidays || []).map(h => ({
                    name: h.name, start_date: h.start_date, end_date: h.end_date || h.start_date
                }));
                columns = ["name","start_date","end_date"];
                headerMap = { name:"Name", start_date:"Start Date", end_date:"End Date" };
                filename = "Holidays"; break;
            }
            default: showToast("Unknown export type", "error"); return;
        }
        if (fmt === "csv") exportCSV(filename + ".csv", rows, columns, headerMap);
        else exportExcel(filename + ".xlsx", rows, columns, headerMap, filename);
        showToast(`${filename} exported as ${fmt.toUpperCase()}`, "success");
    } catch (err) {
        showToast("Export failed: " + err.message, "error");
    }
}

/* ═══════════════ CLASSES ═══════════════ */
async function loadClasses(container) {
    const classes = await fetchClasses();
    container.innerHTML = `
        <div class="admin-section-header">
            <h3>Classes</h3>
            <div class="section-header-actions">
                <button class="btn btn-primary btn-sm" onclick="openAddClass()">+ Add Class</button>
            </div>
        </div>
        ${classes.length === 0 ? '<p class="empty-state">No classes yet.</p>' : `
        <table class="admin-table">
            <thead><tr><th>Class Name</th><th>Year Level</th><th>Actions</th></tr></thead>
            <tbody>${classes.map(c => `
                <tr data-bulk-id="${c.id}">
                    <td>${escHtml(c.class_name)}</td>
                    <td>${c.grade_level}</td>
                    <td class="admin-actions">
                        <button class="btn btn-sm btn-secondary" onclick='editClass(${JSON.stringify(c)})'>Edit</button>
                        <button class="btn btn-sm btn-danger" onclick="deleteClass('${c.id}')">Delete</button>
                    </td>
                </tr>
            `).join("")}</tbody>
        </table>`}
    `;
    installBulkSelect(container, {
        label: "classes",
        deleteOne: async (tr) => {
            const id = tr.dataset.bulkId;
            const res = await apiFetch(`/admin/classes/detail/?id=${id}`, { method: "DELETE" });
            return res.ok;
        },
        onDone: () => loadSection("classes"),
    });
}

function openAddClass() {
    openAdminModal("Add Class", `
        <label>Class Name <input class="form-input" id="mClassName" placeholder="e.g. 12A"></label>
        <label>Year Level <input class="form-input" id="mGradeLevel" type="number" min="1" max="13" placeholder="e.g. 12"></label>
    `, async () => {
        const class_name = document.getElementById("mClassName").value.trim();
        const grade_level = document.getElementById("mGradeLevel").value.trim();
        if (!class_name || !grade_level) { showToast("All fields required", "warning"); return; }
        const res = await apiFetch("/admin/classes/", { method: "POST", body: JSON.stringify({ class_name, grade_level }) });
        if (!res.ok) { const d = await res.json().catch(() => ({})); showToast(d.message || "Failed to create class", "error"); return; }
        closeAdminModal();
        showToast("Class created", "success");
        await loadSection("classes");
    });
}

function editClass(c) {
    openAdminModal("Edit Class", `
        <label>Class Name <input class="form-input" id="mClassName" value="${escHtml(c.class_name)}"></label>
        <label>Year Level <input class="form-input" id="mGradeLevel" type="number" value="${c.grade_level}"></label>
    `, async () => {
        const res = await apiFetch("/admin/classes/detail/", { method: "PATCH", body: JSON.stringify({
            id: c.id, class_name: document.getElementById("mClassName").value.trim(),
            grade_level: document.getElementById("mGradeLevel").value.trim(),
        })});
        if (!res.ok) { const d = await res.json().catch(() => ({})); showToast(d.message || "Failed to update class", "error"); return; }
        closeAdminModal();
        showToast("Class updated", "success");
        await loadSection("classes");
    });
}

async function downloadClassCredentials(classId, className) {
    try {
        const res = await apiFetch(`/admin/classes/credentials/?class_id=${encodeURIComponent(classId)}`);
        if (!res.ok) {
            const d = await res.json().catch(() => ({}));
            showToast(d.message || "Failed to download credentials", "error");
            return;
        }
        const blob = await res.blob();
        const safe = (className || "class").replace(/[\\/:*?"<>|\s]/g, "_");
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `credentials_${safe}.txt`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        showToast("Credentials downloaded", "success");
    } catch (err) {
        showToast("Error: " + err.message, "error");
    }
}

async function deleteClass(id) {
    const ok = await showConfirm("Delete this class? This may affect students and schedules.", { title: "Delete Class", confirmText: "Delete" });
    if (!ok) return;
    try {
        const res = await apiFetch(`/admin/classes/detail/?id=${id}`, { method: "DELETE" });
        if (!res.ok) { const d = await res.json().catch(() => ({})); showToast(d.message || "Failed to delete class", "error"); return; }
        showToast("Class deleted", "success");
        await loadSection("classes");
    } catch (err) { showToast("Error: " + err.message, "error"); }
}

/* ═══════════════ SUBJECTS ═══════════════ */
async function loadSubjects(container) {
    const subjects = await fetchSubjects();
    container.innerHTML = `
        <div class="admin-section-header">
            <h3>Subjects</h3>
            <div class="section-header-actions">
                <button class="btn btn-primary btn-sm" onclick="openAddSubject()">+ Add Subject</button>
            </div>
        </div>
        ${subjects.length === 0 ? '<p class="empty-state">No subjects yet.</p>' : `
        <table class="admin-table">
            <thead><tr><th>Subject Name</th><th>Color</th><th>Actions</th></tr></thead>
            <tbody>${subjects.map(s => `
                <tr data-bulk-id="${s.id}">
                    <td>${escHtml(s.name)}</td>
                    <td>${s.color_code ? `<span style="display:inline-block;width:18px;height:18px;border-radius:50%;background:${s.color_code};vertical-align:middle;"></span> ${escHtml(s.color_code)}` : "—"}</td>
                    <td class="admin-actions">
                        <button class="btn btn-sm btn-secondary" onclick='editSubject(${JSON.stringify(s)})'>Edit</button>
                        <button class="btn btn-sm btn-danger" onclick="deleteSubject('${s.id}')">Delete</button>
                    </td>
                </tr>
            `).join("")}</tbody>
        </table>`}
    `;
    installBulkSelect(container, {
        label: "subjects",
        deleteOne: async (tr) => {
            const id = tr.dataset.bulkId;
            const res = await apiFetch(`/admin/subjects/detail/?id=${id}`, { method: "DELETE" });
            return res.ok;
        },
        onDone: () => loadSection("subjects"),
    });
}

function openAddSubject() {
    openAdminModal("Add Subject", `
        <label>Name <input class="form-input" id="mSubjName" placeholder="e.g. Mathematics"></label>
        <label>Color Code <input class="form-input" id="mSubjColor" placeholder="#3b82f6 (optional)"></label>
    `, async () => {
        const name = document.getElementById("mSubjName").value.trim();
        if (!name) { showToast("Name required", "warning"); return; }
        const res = await apiFetch("/admin/subjects/", { method: "POST", body: JSON.stringify({
            name, color_code: document.getElementById("mSubjColor").value.trim(),
        })});
        if (!res.ok) { const d = await res.json().catch(() => ({})); showToast(d.message || "Failed to create subject", "error"); return; }
        closeAdminModal();
        showToast("Subject created", "success");
        await loadSection("subjects");
    });
}

function editSubject(s) {
    openAdminModal("Edit Subject", `
        <label>Name <input class="form-input" id="mSubjName" value="${escHtml(s.name)}"></label>
        <label>Color Code <input class="form-input" id="mSubjColor" value="${escHtml(s.color_code || "")}"></label>
    `, async () => {
        const res = await apiFetch("/admin/subjects/detail/", { method: "PATCH", body: JSON.stringify({
            id: s.id, name: document.getElementById("mSubjName").value.trim(),
            color_code: document.getElementById("mSubjColor").value.trim(),
        })});
        if (!res.ok) { const d = await res.json().catch(() => ({})); showToast(d.message || "Failed to update subject", "error"); return; }
        closeAdminModal();
        showToast("Subject updated", "success");
        await loadSection("subjects");
    });
}

async function deleteSubject(id) {
    const ok = await showConfirm("Delete this subject? This cannot be undone.", { title: "Delete Subject", confirmText: "Delete" });
    if (!ok) return;
    try {
        const res = await apiFetch(`/admin/subjects/detail/?id=${id}`, { method: "DELETE" });
        if (!res.ok) { const d = await res.json().catch(() => ({})); showToast(d.message || "Failed to delete subject", "error"); return; }
        showToast("Subject deleted", "success");
        await loadSection("subjects");
    } catch (err) { showToast("Error: " + err.message, "error"); }
}

/* ═══════════════ TEACHERS ═══════════════ */
async function loadTeachers(container) {
    await fetchClasses();
    const teachers = await fetchTeachers();
    container.innerHTML = `
        <div class="admin-section-header">
            <h3>Teachers</h3>
            <div class="section-header-actions">
                <button class="btn btn-secondary btn-sm" onclick="openBulkImportTeachers()">⬆ Bulk Import</button>
                <button class="btn btn-primary btn-sm" onclick="openAddTeacher()">+ Add Teacher</button>
            </div>
        </div>
        ${teachers.length === 0 ? '<p class="empty-state">No teachers yet.</p>' : `
        <table class="admin-table">
            <thead><tr><th>Name</th><th>Class Teacher</th><th>Default Password</th><th>Actions</th></tr></thead>
            <tbody>${teachers.map(t => `
                <tr data-bulk-id="${t.id}">
                    <td>${studentAvatarHtml(t)}${escHtml(t.surname)} ${escHtml(t.name)}</td>
                    <td>${t.is_class_teacher
                        ? `✓ ${escHtml(t.class_teacher_class_name || "")} <button class="btn btn-sm btn-secondary" style="margin-left:6px;" onclick="downloadClassCredentials('${t.class_teacher_of_class_id}','${escHtml(t.class_teacher_class_name || "")}')" title="Download login letters for parents">📄 Credentials</button>`
                        : "—"}</td>
                    <td>${t.default_password ? `<code class="default-pw pw-hidden" onclick="this.classList.toggle('pw-hidden')" title="Click to reveal">${escHtml(t.default_password)}</code>` : '<span style="color:#94a3b8;">—</span>'}</td>
                    <td class="admin-actions">
                        ${_hasPerm("impersonate") ? `<button class="btn btn-sm btn-impersonate" onclick="impersonateUser('${t.id}')" title="Login as this teacher">Login as</button>` : ""}
                        <button class="btn btn-sm btn-secondary" onclick='editTeacher(${JSON.stringify(t).replace(/'/g, "&#39;")})'>Edit</button>
                        <button class="btn btn-sm btn-danger" onclick="deleteUser('${t.id}','teacher')">Delete</button>
                    </td>
                </tr>
            `).join("")}</tbody>
        </table>`}
    `;
    installBulkSelect(container, {
        label: "teachers",
        deleteOne: async (tr) => {
            const id = tr.dataset.bulkId;
            const res = await apiFetch(`/admin/users/detail/?id=${id}&role=teacher`, { method: "DELETE" });
            return res.ok;
        },
        onDone: () => loadSection("teachers"),
    });
}

function openAddTeacher() {
    openAdminModal("Add Teacher", `
        <label>Name <input class="form-input" id="mName" placeholder="First name"></label>
        <label>Surname <input class="form-input" id="mSurname" placeholder="Last name"></label>
        <label>Email <input class="form-input" id="mEmail" type="email" placeholder="Auto-generated if empty"></label>
        <label>Password <input class="form-input" id="mPassword" type="text" placeholder="Auto-generated if empty"></label>
        <label>Class Teacher Of <select class="form-input" id="mClassTeacherOf"><option value="">— None —</option>${homeroomOptions()}</select></label>
    `, async () => {
        const ctClass = gv("mClassTeacherOf");
        const body = {
            role: "teacher", name: gv("mName"), surname: gv("mSurname"),
            is_class_teacher: !!ctClass,
            class_teacher_of_class_id: ctClass,
        };
        const email = gv("mEmail"); if (email) body.email = email;
        const pw = gv("mPassword"); if (pw) body.password = pw;
        if (!body.name || !body.surname) { showToast("Name and surname required", "warning"); return; }
        const res = await apiFetch("/admin/users/", { method: "POST", body: JSON.stringify(body) });
        const d = await res.json();
        if (!res.ok) { showToast(d.message || "Failed", "error"); return; }
        closeAdminModal();
        if (d.default_password) {
            showToast(`Teacher created — password: ${d.default_password}`, "success");
        } else {
            showToast("Teacher created", "success");
        }
        await loadSection("teachers");
    });
}

function editTeacher(t) {
    openAdminModal("Edit Teacher", `
        <label>Name <input class="form-input" id="mName" value="${escHtml(t.name)}"></label>
        <label>Surname <input class="form-input" id="mSurname" value="${escHtml(t.surname)}"></label>
        <label>New Email <input class="form-input" id="mEmail" placeholder="Leave blank to keep"></label>
        <label>New Password <input class="form-input" id="mPassword" placeholder="Leave blank to keep"></label>
        <label>Class Teacher Of <select class="form-input" id="mClassTeacherOf"><option value="">— None —</option>${homeroomOptions(t.class_teacher_of_class_id)}</select></label>
    `, async () => {
        const ctClass = gv("mClassTeacherOf");
        const body = {
            id: t.id, role: "teacher", name: gv("mName"), surname: gv("mSurname"),
            is_class_teacher: !!ctClass,
            class_teacher_of_class_id: ctClass,
        };
        const email = gv("mEmail"); if (email) body.email = email;
        const pw = gv("mPassword"); if (pw) body.password = pw;
        const res = await apiFetch("/admin/users/detail/", { method: "PATCH", body: JSON.stringify(body) });
        const d = await res.json();
        if (!res.ok) { showToast(d.message || "Failed", "error"); return; }
        closeAdminModal();
        showToast("Teacher updated", "success");
        await loadSection("teachers");
    });
}

/* ── Bulk-import teachers (simplified CSV: name, surname) ── */
function openBulkImportTeachers() {
    const overlay = document.getElementById("adminModal");
    document.getElementById("adminModalTitle").textContent = "Bulk Import Teachers";
    document.getElementById("adminModalBody").innerHTML = `
        <p style="color:var(--text-light);margin-bottom:12px;">Upload a <strong>CSV</strong> or <strong>Excel (.xlsx)</strong> file with columns: <code>name</code>, <code>surname</code>.<br>
        Email and password will be <strong>generated automatically</strong>.</p>
        <input type="file" id="bulkFile" accept=".csv,.xlsx,.xls" class="form-input">
        <div id="bulkPreview" style="margin-top:12px;"></div>
        <div id="bulkResult" style="margin-top:12px;"></div>
    `;
    overlay.style.display = "flex";
    overlay.onclick = (e) => { if (e.target === overlay) closeAdminModal(); };

    const saveBtn = document.getElementById("adminModalSave");
    saveBtn.textContent = "Import";
    saveBtn.disabled = true;

    let parsedRows = [];

    document.getElementById("bulkFile").addEventListener("change", async () => {
        const file = document.getElementById("bulkFile").files[0];
        if (!file) return;
        try {
            const parsed = await parseTabularFile(file);
            parsedRows = parsed.rows.filter(r => r.name || r.surname);
            const cols = ['name', 'surname'];
            const preview = document.getElementById("bulkPreview");
            if (parsedRows.length === 0) { preview.innerHTML = '<p class="empty-state">No valid rows found.</p>'; saveBtn.disabled = true; return; }
            preview.innerHTML = `
                <p><strong>${parsedRows.length}</strong> teachers to import:</p>
                <table class="admin-table" style="font-size:0.85rem;">
                    <thead><tr>${cols.map(c => `<th>${escHtml(c)}</th>`).join('')}</tr></thead>
                    <tbody>
                        ${parsedRows.slice(0, 8).map(r => `<tr>${cols.map(c => `<td>${escHtml(r[c] || '—')}</td>`).join('')}</tr>`).join('')}
                        ${parsedRows.length > 8 ? `<tr><td colspan="${cols.length}" style="text-align:center;color:var(--text-lighter)">… and ${parsedRows.length - 8} more</td></tr>` : ''}
                    </tbody>
                </table>
            `;
            saveBtn.disabled = false;
        } catch (err) {
            showToast("Failed to read file: " + err.message, "error");
        }
    });

    modalSaveCallback = async () => {
        if (parsedRows.length === 0) { showToast("No data to import", "warning"); return; }
        saveBtn.disabled = true;
        const resultDiv = document.getElementById("bulkResult");
        try {
            const d = await chunkedImport({
                type: "teachers",
                rows: parsedRows,
                onProgress: ({ done, total }) => {
                    saveBtn.textContent = `Importing… ${done}/${total}`;
                    resultDiv.innerHTML = `<p style="color:var(--text-light);">Imported ${done} of ${total}…</p>`;
                },
            });
            let html = `<div class="import-result ${d.errors.length ? 'import-result-partial' : 'import-result-success'}">
                <p><strong>${d.created}</strong> teachers imported.</p>`;
            if (d.errors.length) {
                html += `<p><strong>${d.errors.length}</strong> rows failed:</p>
                <ul>${d.errors.slice(0, 20).map(e => `<li>Row ${e.row}: ${escHtml(e.error)}</li>`).join("")}${d.errors.length > 20 ? `<li>… and ${d.errors.length - 20} more</li>` : ""}</ul>`;
            }
            html += '</div>';
            if (d.credentials.length > 0) {
                html += `<button class="btn btn-primary" style="margin-top:12px;" onclick="downloadCredentials(window._bulkCredentials)">⬇ Download Credentials CSV</button>`;
                window._bulkCredentials = d.credentials;
            }
            resultDiv.innerHTML = html;
            if (d.created > 0) showToast(`${d.created} teachers imported`, "success");
        } catch (err) {
            showToast("Import failed: " + err.message, "error");
        } finally {
            saveBtn.textContent = "Import";
            saveBtn.disabled = false;
        }
    };
    saveBtn.onclick = async () => {
        saveBtn.disabled = true;
        try { await modalSaveCallback(); }
        catch (err) { showToast(err.message || "Error", "error"); }
        finally { saveBtn.disabled = false; }
    };
}

/* ═══════════════ STUDENTS ═══════════════ */
async function loadStudents(container) {
    await fetchClasses();
    const students = await fetchStudents();
    container.innerHTML = `
        <div class="admin-section-header">
            <h3>Students</h3>
            <div class="section-header-actions">
                <button class="btn btn-secondary btn-sm" onclick="openDedupeStudents()" title="Find and remove duplicate students">🧹 Remove Duplicates</button>
                <button class="btn btn-secondary btn-sm" onclick="openBulkImportStudents()">⬆ Bulk Import</button>
                <button class="btn btn-primary btn-sm" onclick="openAddStudent()">+ Add Student</button>
            </div>
        </div>
        ${students.length === 0 ? '<p class="empty-state">No students yet.</p>' : `
        <table class="admin-table">
            <thead><tr><th>Name</th><th>Class</th><th>Default Password</th><th>Actions</th></tr></thead>
            <tbody>${students.map(s => `
                <tr data-bulk-id="${s.id}">
                    <td>${studentAvatarHtml(s)}${escHtml(s.surname)} ${escHtml(s.name)}</td>
                    <td>${escHtml(s.class_name || "—")}</td>
                    <td>${s.default_password ? `<code class="default-pw pw-hidden" onclick="this.classList.toggle('pw-hidden')" title="Click to reveal">${escHtml(s.default_password)}</code>` : '<span style="color:#94a3b8;">—</span>'}</td>
                    <td class="admin-actions">
                        ${_hasPerm("impersonate") ? `<button class="btn btn-sm btn-impersonate" onclick="impersonateUser('${s.id}')" title="Login as this student">Login as</button>` : ""}
                        <button class="btn btn-sm btn-secondary" onclick='editStudent(${JSON.stringify(s).replace(/'/g, "&#39;")})'>Edit</button>
                        <button class="btn btn-sm btn-danger" onclick="deleteUser('${s.id}','student')">Delete</button>
                    </td>
                </tr>
            `).join("")}</tbody>
        </table>`}
    `;
    installBulkSelect(container, {
        label: "students",
        deleteOne: async (tr) => {
            const id = tr.dataset.bulkId;
            const res = await apiFetch(`/admin/users/detail/?id=${id}&role=student`, { method: "DELETE" });
            return res.ok;
        },
        onDone: () => loadSection("students"),
    });
}

async function openDedupeStudents() {
    console.log("[dedupe] click");
    showToast("Scanning for duplicates…", "info");
    // Defensive: stop any stale openAdminModal save handler from firing
    modalSaveCallback = async () => {};
    const overlay = document.getElementById("adminModal");
    if (!overlay) {
        showToast("Admin modal not found on page", "error");
        return;
    }
    document.getElementById("adminModalTitle").textContent = "Remove Duplicate Students";
    document.getElementById("adminModalBody").innerHTML = '<p class="loading">Scanning… (this can take up to 30 s on the first request after the backend wakes up)</p>';
    overlay.style.display = "flex";
    overlay.onclick = (e) => { if (e.target === overlay) closeAdminModal(); };
    const saveBtn = document.getElementById("adminModalSave");
    saveBtn.textContent = "Delete duplicates";
    saveBtn.disabled = true;

    let preview = null;
    try {
        const res = await apiFetch("/admin/dedupe-students/");
        if (!res.ok) {
            const txt = await res.text().catch(() => "");
            document.getElementById("adminModalBody").innerHTML =
                `<p class="empty-state">Scan failed (HTTP ${res.status}). ${escHtml(txt.slice(0, 200))}</p>`;
            showToast(`Scan failed: HTTP ${res.status}`, "error");
            return;
        }
        preview = await res.json();
    } catch (err) {
        document.getElementById("adminModalBody").innerHTML = `<p class="empty-state">Failed to scan: ${escHtml(err.message)}</p>`;
        showToast("Scan failed: " + err.message, "error");
        return;
    }

    const groups = preview.groups || [];
    const total = preview.duplicate_count || 0;
    if (groups.length === 0) {
        document.getElementById("adminModalBody").innerHTML = '<p class="empty-state">No duplicates found.</p>';
        showToast("No duplicates found", "success");
        return;
    }

    document.getElementById("adminModalBody").innerHTML = `
        <p style="margin-bottom:10px;">Found <strong>${groups.length}</strong> name+class groups with duplicates. <strong>${total}</strong> rows will be deleted (oldest record kept in each group).</p>
        <table class="admin-table" style="font-size:0.85rem;">
            <thead><tr><th>Name</th><th>Class</th><th>Total rows</th><th>Will delete</th></tr></thead>
            <tbody>
                ${groups.map(g => `<tr>
                    <td>${escHtml(g.surname || "")} ${escHtml(g.name || "")}</td>
                    <td>${escHtml(g.class_name || "—")}</td>
                    <td>${g.count}</td>
                    <td>${g.duplicate_ids.length}</td>
                </tr>`).join("")}
            </tbody>
        </table>
    `;
    // Replace the Save button with a clone so any stale listeners
    // (from a prior openAdminModal call) are detached cleanly.
    const freshSave = saveBtn.cloneNode(true);
    saveBtn.parentNode.replaceChild(freshSave, saveBtn);
    const saveBtnRef = freshSave;
    saveBtnRef.textContent = "Delete duplicates";
    saveBtnRef.disabled = false;

    saveBtnRef.addEventListener("click", async (ev) => {
        ev?.preventDefault?.();
        ev?.stopPropagation?.();
        console.log("[dedupe] delete clicked", preview);

        let total = (preview && (preview.duplicate_count || (preview.duplicate_ids || []).length)) || 0;
        if (total === 0) {
            showToast("Nothing to delete", "info");
            closeAdminModal();
            return;
        }

        saveBtnRef.disabled = true;
        const body = document.getElementById("adminModalBody");
        body.innerHTML = `
            <p style="margin-bottom:10px;font-weight:600;">Deleting duplicates…</p>
            <div class="dedupe-progress" style="background:rgba(148,163,184,0.15);border-radius:6px;height:14px;overflow:hidden;margin-bottom:8px;">
                <div class="dedupe-progress-fill" style="background:var(--primary-blue,#2563eb);height:100%;width:0%;transition:width 0.25s ease;"></div>
            </div>
            <p class="dedupe-progress-text" style="font-size:0.9rem;color:var(--text-light);">0 of ${total} removed…</p>
        `;
        const fillEl = body.querySelector(".dedupe-progress-fill");
        const textEl = body.querySelector(".dedupe-progress-text");

        // Poll the POST endpoint repeatedly. Each call deletes up to 50
        // duplicates and reports `remaining`; loop until remaining is 0
        // or we've made too many round-trips. This keeps working even
        // when the GET response did not include duplicate_ids (older
        // backend) because the backend itself picks ids each call.
        let totalDeleted = 0;
        let chunkErrors = 0;
        let remaining = total;
        const MAX_ROUNDS = Math.max(1, Math.ceil(total / 50) + 5);
        for (let round = 0; round < MAX_ROUNDS && remaining > 0; round++) {
            saveBtnRef.textContent = `Deleting… ${totalDeleted}/${total}`;
            try {
                const res = await apiFetch("/admin/dedupe-students/", {
                    method: "POST",
                    body: JSON.stringify({}),
                });
                if (!res.ok) {
                    chunkErrors++;
                    const txt = await res.text().catch(() => "");
                    console.error("[dedupe] batch failed", res.status, txt);
                    if (chunkErrors >= 3) break;
                    continue;
                }
                const d = await res.json();
                const justNow = d.deleted || 0;
                totalDeleted += justNow;
                if (typeof d.remaining === "number") {
                    remaining = d.remaining;
                } else {
                    remaining = Math.max(0, remaining - justNow);
                }
                if (justNow === 0) break;
            } catch (err) {
                chunkErrors++;
                console.error("[dedupe] batch error", err);
                if (chunkErrors >= 3) break;
            }
            const pct = Math.min(100, Math.round((totalDeleted / total) * 100));
            if (fillEl) fillEl.style.width = pct + "%";
            if (textEl) textEl.textContent = `${totalDeleted} of ${total} removed${chunkErrors ? ` · ${chunkErrors} batches failed` : ""}`;
        }
        if (textEl) textEl.textContent = `Done — ${totalDeleted} of ${total} removed${chunkErrors ? `, ${chunkErrors} batches failed` : ""}.`;
        if (fillEl) fillEl.style.width = "100%";
        if (totalDeleted > 0) {
            showToast(`${totalDeleted} duplicates removed${chunkErrors ? ` (${chunkErrors} batches failed)` : ""}`,
                chunkErrors ? "warning" : "success");
        } else if (chunkErrors > 0) {
            showToast("Dedupe failed — try again", "error");
        }
        cachedStudents = null;
        saveBtnRef.textContent = "Close";
        saveBtnRef.disabled = false;
        const closeAfter = async (e) => {
            e?.preventDefault?.();
            closeAdminModal();
            await loadSection("students");
        };
        saveBtnRef.replaceWith(saveBtnRef.cloneNode(true));
        document.getElementById("adminModalSave").addEventListener("click", closeAfter);
    });
}

function openAddStudent() {
    openAdminModal("Add Student", `
        <label>Name <input class="form-input" id="mName" placeholder="First name"></label>
        <label>Surname <input class="form-input" id="mSurname" placeholder="Last name"></label>
        <label>Email <input class="form-input" id="mEmail" type="email" placeholder="Auto-generated if empty"></label>
        <label>Password <input class="form-input" id="mPassword" type="text" placeholder="Auto-generated if empty"></label>
        <label>Class <select class="form-input" id="mClassId"><option value="">— Select —</option>${classOptions()}</select></label>
    `, async () => {
        const body = {
            role: "student", name: gv("mName"), surname: gv("mSurname"),
            class_id: gv("mClassId"),
        };
        const email = gv("mEmail"); if (email) body.email = email;
        const pw = gv("mPassword"); if (pw) body.password = pw;
        if (!body.name || !body.surname) { showToast("Name and surname required", "warning"); return; }
        const res = await apiFetch("/admin/users/", { method: "POST", body: JSON.stringify(body) });
        const d = await res.json();
        if (!res.ok) { showToast(d.message || "Failed", "error"); return; }
        closeAdminModal();
        if (d.default_password) {
            showToast(`Student created — password: ${d.default_password}`, "success");
        } else {
            showToast("Student created", "success");
        }
        cachedStudents = null;
        await loadSection("students");
    });
}

function editStudent(s) {
    openAdminModal("Edit Student", `
        <label>Name <input class="form-input" id="mName" value="${escHtml(s.name)}"></label>
        <label>Surname <input class="form-input" id="mSurname" value="${escHtml(s.surname)}"></label>
        <label>New Email <input class="form-input" id="mEmail" placeholder="Leave blank to keep"></label>
        <label>New Password <input class="form-input" id="mPassword" placeholder="Leave blank to keep"></label>
        <label>Class <select class="form-input" id="mClassId"><option value="">— None —</option>${classOptions(s.class_id)}</select></label>
    `, async () => {
        const body = { id: s.id, role: "student", name: gv("mName"), surname: gv("mSurname"), class_id: gv("mClassId") };
        const email = gv("mEmail"); if (email) body.email = email;
        const pw = gv("mPassword"); if (pw) body.password = pw;
        const res = await apiFetch("/admin/users/detail/", { method: "PATCH", body: JSON.stringify(body) });
        const d = await res.json();
        if (!res.ok) { showToast(d.message || "Failed", "error"); return; }
        closeAdminModal();
        showToast("Student updated", "success");
        cachedStudents = null;
        await loadSection("students");
    });
}

/* ── Bulk-import students (simplified CSV: name, surname, class_name) ── */
function openBulkImportStudents() {
    const overlay = document.getElementById("adminModal");
    document.getElementById("adminModalTitle").textContent = "Bulk Import Students";
    document.getElementById("adminModalBody").innerHTML = `
        <p style="color:var(--text-light);margin-bottom:12px;">Upload a <strong>CSV</strong> or <strong>Excel (.xlsx)</strong> file with columns: <code>name</code>, <code>surname</code>, <code>class_name</code>.<br>
        Email and password will be <strong>generated automatically</strong>.</p>
        <input type="file" id="bulkFile" accept=".csv,.xlsx,.xls" class="form-input">
        <div id="bulkPreview" style="margin-top:12px;"></div>
        <div id="bulkResult" style="margin-top:12px;"></div>
    `;
    overlay.style.display = "flex";
    overlay.onclick = (e) => { if (e.target === overlay) closeAdminModal(); };

    const saveBtn = document.getElementById("adminModalSave");
    saveBtn.textContent = "Import";
    saveBtn.disabled = true;

    let parsedRows = [];

    document.getElementById("bulkFile").addEventListener("change", async () => {
        const file = document.getElementById("bulkFile").files[0];
        if (!file) return;
        try {
            const parsed = await parseTabularFile(file);
            parsedRows = parsed.rows.filter(r => r.name || r.surname);
            showBulkPreview(parsedRows, parsed.headers);
            saveBtn.disabled = parsedRows.length === 0;
        } catch (err) {
            showToast("Failed to read file: " + err.message, "error");
        }
    });

    modalSaveCallback = async () => {
        if (parsedRows.length === 0) { showToast("No data to import", "warning"); return; }
        saveBtn.disabled = true;
        const resultDiv = document.getElementById("bulkResult");
        try {
            const d = await chunkedImport({
                type: "students",
                rows: parsedRows,
                onProgress: ({ done, total }) => {
                    saveBtn.textContent = `Importing… ${done}/${total}`;
                    resultDiv.innerHTML = `<p style="color:var(--text-light);">Imported ${done} of ${total}…</p>`;
                },
            });
            let html = `<div class="import-result ${d.errors.length ? 'import-result-partial' : 'import-result-success'}">
                <p><strong>${d.created}</strong> students imported.</p>`;
            if (d.errors.length) {
                html += `<p><strong>${d.errors.length}</strong> rows failed:</p>
                <ul>${d.errors.slice(0, 20).map(e => `<li>Row ${e.row}: ${escHtml(e.error)}</li>`).join("")}${d.errors.length > 20 ? `<li>… and ${d.errors.length - 20} more</li>` : ""}</ul>`;
            }
            html += '</div>';
            if (d.credentials.length > 0) {
                html += `<button class="btn btn-primary" style="margin-top:12px;" onclick="downloadCredentials(window._bulkCredentials)">⬇ Download Credentials CSV</button>`;
                window._bulkCredentials = d.credentials;
            }
            resultDiv.innerHTML = html;
            if (d.created > 0) {
                showToast(`${d.created} students imported`, "success");
                cachedStudents = null;
            }
        } catch (err) {
            showToast("Import failed: " + err.message, "error");
        } finally {
            saveBtn.textContent = "Import";
            saveBtn.disabled = false;
        }
    };
    saveBtn.onclick = async () => {
        saveBtn.disabled = true;
        try { await modalSaveCallback(); }
        catch (err) { showToast(err.message || "Error", "error"); }
        finally { saveBtn.disabled = false; }
    };
}

function showBulkPreview(rows, headers) {
    const preview = document.getElementById("bulkPreview");
    if (rows.length === 0) { preview.innerHTML = '<p class="empty-state">No valid rows found.</p>'; return; }
    const cols = ['name', 'surname', 'class_name'];
    preview.innerHTML = `
        <p><strong>${rows.length}</strong> students to import:</p>
        <table class="admin-table" style="font-size:0.85rem;">
            <thead><tr>${cols.map(c => `<th>${escHtml(c)}</th>`).join('')}</tr></thead>
            <tbody>
                ${rows.slice(0, 8).map(r => `<tr>${cols.map(c => `<td>${escHtml(r[c] || '—')}</td>`).join('')}</tr>`).join('')}
                ${rows.length > 8 ? `<tr><td colspan="${cols.length}" style="text-align:center;color:var(--text-lighter)">… and ${rows.length - 8} more</td></tr>` : ''}
            </tbody>
        </table>
    `;
}

function downloadCredentials(creds) {
    if (!creds || creds.length === 0) return;
    let csv = 'Name,Surname,Class,Email,Password\n';
    for (const c of creds) {
        csv += `"${(c.name||'').replace(/"/g,'""')}","${(c.surname||'').replace(/"/g,'""')}","${(c.class_name||'').replace(/"/g,'""')}","${(c.email||'').replace(/"/g,'""')}","${(c.password||'').replace(/"/g,'""')}"\n`;
    }
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `student_credentials_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

/* ═══════════════ ADMINS ═══════════════ */
async function loadAdmins(container) {
    if (!_canManageAdmins()) {
        container.innerHTML = '<p class="empty-state">You do not have access to this section.</p>';
        return;
    }
    const res = await apiFetch("/admin/users/?role=admin");
    const d = await res.json();
    // Filter out super admins on the client side too (safety net)
    const admins = (d.users || []).filter(a => a.admin_level !== "super").sort(_byPersonName);
    const isSuperAdmin = _adminLevel() === "super";
    container.innerHTML = `
        <div class="admin-section-header">
            <h3>Admins</h3>
            <div class="section-header-actions">
                <button class="btn btn-primary btn-sm" onclick="openAddAdmin()">+ Add Admin</button>
            </div>
        </div>
        ${admins.length === 0 ? '<p class="empty-state">No admins yet.</p>' : `
        <table class="admin-table">
            <thead><tr><th>Name</th><th>Email</th><th>Permissions</th><th>Actions</th></tr></thead>
            <tbody>${admins.map(a => {
                const lvl = a.admin_level || "regular";
                const perms = a.permissions || {};
                const permTags = (lvl === "master" || lvl === "super") ? '<span class="perm-tag perm-all">All</span>' :
                    ALL_PERM_KEYS.filter(p => perms[p.key]).map(p => `<span class="perm-tag">${escHtml(p.label)}</span>`).join("") || '<span class="perm-tag perm-none">None</span>';
                const isHighLevel = lvl === "master" || lvl === "super";
                const canEdit = isSuperAdmin || !isHighLevel;
                const canDelete = isSuperAdmin || !isHighLevel;
                const levelBadge = isHighLevel && isSuperAdmin ? ` <span class="admin-level-badge level-${lvl}">${lvl}</span>` : '';
                return `<tr>
                    <td>${escHtml(a.surname)} ${escHtml(a.name)}${levelBadge}</td>
                    <td>${escHtml(a.email || "")}</td>
                    <td class="perm-cell">${permTags}</td>
                    <td class="admin-actions">
                        ${canEdit ? `<button class="btn btn-sm btn-secondary" onclick='editAdmin(${JSON.stringify(a).replace(/'/g, "&#39;")})'>Edit</button>` : ""}
                        ${canDelete ? `<button class="btn btn-sm btn-danger" onclick="deleteUser('${a.id}','admin')">Delete</button>` : ""}
                    </td>
                </tr>`;
            }).join("")}</tbody>
        </table>`}
    `;
}

function _permCheckboxes(perms) {
    return `<div class="perm-grid">${ALL_PERM_KEYS.map(p =>
        `<label class="perm-toggle"><input type="checkbox" data-perm="${p.key}" ${perms[p.key] ? "checked" : ""}> ${p.label}</label>`
    ).join("")}</div>`;
}
function _collectPerms() {
    const perms = {};
    document.querySelectorAll(".perm-grid input[data-perm]").forEach(cb => {
        perms[cb.dataset.perm] = cb.checked;
    });
    return perms;
}

function openAddAdmin() {
    const defaultPerms = {};
    ALL_PERM_KEYS.forEach(p => { defaultPerms[p.key] = true; });
    const isSuperAdmin = _adminLevel() === "super";
    openAdminModal("Add Admin", `
        <label>Name <input class="form-input" id="mName" placeholder="First name"></label>
        <label>Surname <input class="form-input" id="mSurname" placeholder="Last name"></label>
        <label>Email <input class="form-input" id="mEmail" type="email" placeholder="admin@school.edu"></label>
        <label>Password <input class="form-input" id="mPassword" type="text" value="changeme"></label>
        ${isSuperAdmin ? `<label>Admin Level <select class="form-input" id="mAdminLevel">
            <option value="regular" selected>Regular</option>
            <option value="master">Master</option>
            <option value="super">Super</option>
        </select></label>` : ''}
        <fieldset class="perm-fieldset"><legend>Permissions</legend>${_permCheckboxes(defaultPerms)}</fieldset>
    `, async () => {
        const perms = _collectPerms();
        const body = { role: "admin", name: gv("mName"), surname: gv("mSurname"), email: gv("mEmail"), password: gv("mPassword"), permissions: perms };
        if (isSuperAdmin) body.admin_level = document.getElementById("mAdminLevel")?.value || "regular";
        if (!body.name || !body.surname || !body.email) { showToast("All fields required", "warning"); return; }
        const res = await apiFetch("/admin/users/", { method: "POST", body: JSON.stringify(body) });
        const d = await res.json();
        if (!res.ok) { showToast(d.message || "Failed", "error"); return; }
        closeAdminModal();
        showToast("Admin created", "success");
        await loadSection("admins");
    });
}

function editAdmin(a) {
    const existingPerms = a.permissions || {};
    const isHighLevel = a.admin_level === "master" || a.admin_level === "super";
    const isSuperAdmin = _adminLevel() === "super";
    openAdminModal("Edit Admin", `
        <label>Name <input class="form-input" id="mName" value="${escHtml(a.name)}"></label>
        <label>Surname <input class="form-input" id="mSurname" value="${escHtml(a.surname)}"></label>
        <label>New Email <input class="form-input" id="mEmail" placeholder="Leave blank to keep"></label>
        <label>New Password <input class="form-input" id="mPassword" placeholder="Leave blank to keep"></label>
        ${isSuperAdmin ? `<label>Admin Level <select class="form-input" id="mAdminLevel">
            <option value="regular"${a.admin_level === 'regular' ? ' selected' : ''}>Regular</option>
            <option value="master"${a.admin_level === 'master' ? ' selected' : ''}>Master</option>
            <option value="super"${a.admin_level === 'super' ? ' selected' : ''}>Super</option>
        </select></label>` : ''}
        ${isHighLevel && !isSuperAdmin ? '' : `<fieldset class="perm-fieldset"><legend>Permissions</legend>${_permCheckboxes(existingPerms)}</fieldset>`}
    `, async () => {
        const body = { id: a.id, role: "admin", name: gv("mName"), surname: gv("mSurname") };
        const email = gv("mEmail"); if (email) body.email = email;
        const pw = gv("mPassword"); if (pw) body.password = pw;
        if (isSuperAdmin) body.admin_level = document.getElementById("mAdminLevel")?.value || a.admin_level;
        if (!(isHighLevel && !isSuperAdmin)) body.permissions = _collectPerms();
        const res = await apiFetch("/admin/users/detail/", { method: "PATCH", body: JSON.stringify(body) });
        const d = await res.json();
        if (!res.ok) { showToast(d.message || "Failed", "error"); return; }
        closeAdminModal();
        showToast("Admin updated", "success");
        await loadSection("admins");
    });
}

async function deleteUser(id, role) {
    const ok = await showConfirm(`Delete this ${role}? This cannot be undone.`, { title: `Delete ${role.charAt(0).toUpperCase() + role.slice(1)}`, confirmText: "Delete" });
    if (!ok) return;
    const res = await apiFetch(`/admin/users/detail/?id=${id}&role=${role}`, { method: "DELETE" });
    if (res.ok) {
        showToast(`${role.charAt(0).toUpperCase() + role.slice(1)} deleted`, "success");
        await loadSection(currentSection);
    } else {
        showToast("Failed to delete", "error");
    }
}

/* ═══════════════ TEACHER ASSIGNMENTS ═══════════════ */
async function loadAssignments(container) {
    await Promise.all([fetchSubjects(), fetchTeachers()]);
    const res = await apiFetch("/admin/teacher-subjects/");
    const d = await res.json();
    const rows = (d.rows || []);
    // teacher_id -> { years, subjects: [{id, name}] }
    const byTeacher = {};
    for (const r of rows) {
        if (!byTeacher[r.teacher_id]) byTeacher[r.teacher_id] = { years: new Set(), subjects: [] };
        byTeacher[r.teacher_id].subjects.push({
            subject_id: r.subject_id,
            subject_name: (cachedSubjects.find(s => s.id === r.subject_id) || {}).name || "?",
        });
        for (const y of (r.years_allowed || [])) byTeacher[r.teacher_id].years.add(y);
    }
    const teacherList = cachedTeachers.slice().sort(_byPersonName);

    container.innerHTML = `
        <div class="admin-section-header">
            <h3>Teacher Subjects</h3>
            <div class="section-header-actions">
                <button class="btn btn-secondary btn-sm" onclick="reseedTeacherSubjects()">Reseed from current schedule</button>
            </div>
        </div>
        <p style="color:var(--text-light);font-size:0.88rem;margin:0 0 12px;">
            Which subjects each teacher can be scheduled for, and which year groups they can teach. Used by the new generator.
        </p>
        <table class="admin-table">
            <thead><tr><th>Teacher</th><th>Years</th><th>Subjects</th><th>Actions</th></tr></thead>
            <tbody>${teacherList.map(t => {
                const info = byTeacher[t.id] || { years: new Set(), subjects: [] };
                const years = Array.from(info.years).sort();
                const chips = info.subjects.map(s => `<span class="ts-chip">${escHtml(s.subject_name)}</span>`).join(" ");
                return `<tr>
                    <td>${escHtml(t.surname)} ${escHtml(t.name)}</td>
                    <td>${years.length ? years.join(", ") : '<span style="color:var(--text-lighter);">—</span>'}</td>
                    <td>${chips || '<span style="color:var(--text-lighter);">—</span>'}</td>
                    <td class="admin-actions">
                        <button class="btn btn-sm btn-secondary" onclick="openTeacherSubjectsModal('${t.id}')">Edit</button>
                    </td>
                </tr>`;
            }).join("")}</tbody>
        </table>
        <style>
            .ts-chip { display:inline-block; padding:2px 8px; border-radius:10px; background:rgba(var(--primary-blue-rgb),0.10); color:var(--primary-blue); font-size:0.78rem; margin:2px 2px 2px 0; }
        </style>
    `;
}

async function openTeacherSubjectsModal(teacherId) {
    const t = cachedTeachers.find(x => x.id === teacherId);
    if (!t) { showToast("Teacher not found", "error"); return; }
    const res = await apiFetch(`/admin/teacher-subjects/?teacher_id=${teacherId}`);
    const d = await res.json();
    const cur = (d.rows || []);
    const curIds = new Set(cur.map(r => r.subject_id));
    // Use most-common years_allowed from existing rows; default all 4 years.
    let curYears = new Set();
    for (const r of cur) for (const y of (r.years_allowed || [])) curYears.add(y);
    if (curYears.size === 0) ["10","11","12","13"].forEach(y => curYears.add(y));

    const subjList = cachedSubjects.slice().sort((a, b) => a.name.localeCompare(b.name));
    openAdminModal(`Edit ${t.surname} ${t.name}`, `
        <div class="form-group">
            <label>Years allowed</label>
            <div style="display:flex;gap:10px;flex-wrap:wrap;">
                ${["10","11","12","13"].map(y => `
                    <label style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border:1px solid rgba(var(--primary-blue-rgb),0.2);border-radius:8px;background:var(--bg-button);">
                        <input type="checkbox" class="ts-year" value="${y}" ${curYears.has(y) ? "checked" : ""}> Year ${y}
                    </label>
                `).join("")}
            </div>
        </div>
        <div class="form-group">
            <label>Subjects</label>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:6px;max-height:340px;overflow-y:auto;border:1px solid rgba(var(--primary-blue-rgb),0.15);border-radius:8px;padding:8px;">
                ${subjList.map(s => `
                    <label style="display:inline-flex;align-items:center;gap:6px;font-size:0.85rem;">
                        <input type="checkbox" class="ts-sub" value="${s.id}" ${curIds.has(s.id) ? "checked" : ""}> ${escHtml(s.name)}
                    </label>
                `).join("")}
            </div>
        </div>
    `, async () => {
        const sids = Array.from(document.querySelectorAll(".ts-sub:checked")).map(c => c.value);
        const yrs = Array.from(document.querySelectorAll(".ts-year:checked")).map(c => c.value);
        if (yrs.length === 0) { showToast("Pick at least one year", "warning"); return; }
        const r = await apiFetch("/admin/teacher-subjects/", {
            method: "POST",
            body: JSON.stringify({ teacher_id: teacherId, subject_ids: sids, years_allowed: yrs }),
        });
        if (!r.ok) { const e = await r.json().catch(() => ({})); showToast(e.message || "Failed", "error"); return; }
        closeAdminModal();
        showToast("Teacher subjects saved", "success");
        await loadSection("assignments");
    });
}

async function reseedTeacherSubjects() {
    const ok = await showConfirm(
        "Wipe teacher_subjects and rebuild from the current schedule? Year restrictions for each teacher will be re-applied automatically.",
        { title: "Reseed teacher subjects", confirmText: "Reseed" }
    );
    if (!ok) return;
    const r = await apiFetch("/admin/seed-teacher-subjects/", { method: "POST", body: "{}" });
    const d = await r.json();
    if (!r.ok) { showToast(d.message || "Failed", "error"); return; }
    showToast(`Reseeded: ${d.rows} rows / ${d.teachers} teachers`, "success");
    await loadSection("assignments");
}

/* ═══════════════ STUDENT ENROLMENTS ═══════════════ */
async function loadEnrollments(container) {
    const res = await apiFetch("/admin/enrollments/list/");
    const d = await res.json();
    if (!res.ok) {
        container.innerHTML = `<p class="empty-state">${escHtml(d.message || "Failed to load")}</p>`;
        return;
    }
    window._enrollRows = d.rows || [];
    container.innerHTML = `
        <div class="admin-section-header">
            <h3>Enrollments</h3>
            <div class="section-header-actions">
                <button class="btn btn-secondary btn-sm" onclick="openImportEnrollmentsModal()">Import CSV</button>
            </div>
        </div>
        <p style="color:var(--text-light);font-size:0.88rem;margin:0 0 10px;">
            Click a student to edit their subject choices. Year 10/11 students must pick exactly 2 humanities, 1 of PE/Art/Psy/ML, 1 language. Year 12/13 students pick at least 3; IELTS auto-added if neither English nor English Literature is taken.
        </p>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px;">
            <select id="enrollFilterYear" class="form-input" style="max-width:160px;" onchange="renderEnrollTable()">
                <option value="">All years</option>
                <option value="10">Year 10</option>
                <option value="11">Year 11</option>
                <option value="12">Year 12</option>
                <option value="13">Year 13</option>
            </select>
            <input id="enrollFilterSearch" class="form-input" style="max-width:240px;" placeholder="Search by name…" oninput="renderEnrollTable()">
        </div>
        <div id="enrollTableWrap"></div>
    `;
    renderEnrollTable();
}

function renderEnrollTable() {
    const yr = document.getElementById("enrollFilterYear")?.value || "";
    const q = (document.getElementById("enrollFilterSearch")?.value || "").trim().toLowerCase();
    const wrap = document.getElementById("enrollTableWrap");
    if (!wrap) return;
    let rows = (window._enrollRows || []);
    if (yr) rows = rows.filter(r => String(r.year) === yr);
    if (q) rows = rows.filter(r =>
        `${r.surname} ${r.name}`.toLowerCase().includes(q) ||
        (r.class_name || "").toLowerCase().includes(q));
    if (!rows.length) { wrap.innerHTML = '<p class="empty-state">No students match.</p>'; return; }
    wrap.innerHTML = `
        <table class="admin-table">
            <thead><tr>
                <th>Class</th><th>Surname</th><th>Name</th><th>Year</th>
                <th>English Lvl</th><th># Subjects</th><th>Actions</th>
            </tr></thead>
            <tbody>${rows.map(r => `
                <tr>
                    <td>${escHtml(r.class_name || "—")}</td>
                    <td>${escHtml(r.surname || "")}</td>
                    <td>${escHtml(r.name || "")}</td>
                    <td>${r.year ?? "—"}</td>
                    <td>${r.english_level ?? "—"}</td>
                    <td>${(r.subjects || []).length}</td>
                    <td class="admin-actions">
                        <button class="btn btn-sm btn-secondary" onclick="openEnrollEditor('${r.id}')">Edit</button>
                    </td>
                </tr>`).join("")}</tbody>
        </table>
    `;
}

async function openEnrollEditor(studentId) {
    const stud = (window._enrollRows || []).find(r => r.id === studentId);
    if (!stud) { showToast("Student not found", "error"); return; }
    const year = stud.year;
    if (!year) { showToast("Student has no class assigned", "warning"); return; }
    const optsRes = await apiFetch(`/admin/enrollments/options/?year=${year}`);
    const opts = await optsRes.json();
    if (!optsRes.ok) { showToast(opts.message || "Could not load options", "error"); return; }

    const chosen = new Set((stud.subjects || []).map(s => s.subject_name));

    let body;
    if (year === 10 || year === 11) {
        body = `
            <p style="font-size:0.85rem;color:var(--text-light);">
                <strong>${escHtml(stud.surname)} ${escHtml(stud.name)}</strong> · Class ${escHtml(stud.class_name)} · Year ${year}
            </p>
            <div class="form-group">
                <label>English level</label>
                <select id="enrollEnglish" class="form-input" style="max-width:160px;">
                    <option value="">Unknown</option>
                    ${[1,2,3,4,5].map(l => `<option value="${l}" ${stud.english_level === l ? "selected" : ""}>Level ${l}</option>`).join("")}
                </select>
            </div>
            <div class="form-group">
                <label>Mandatory (auto-enrolled)</label>
                <div style="font-size:0.85rem;color:var(--text-light);">${[...opts.mandatory_class, ...opts.mandatory_level_split].map(escHtml).join(", ")}</div>
            </div>
            ${enrollGroupCheckboxes("Pick exactly 2 humanities", "hum", opts.humanities_pick_2, chosen)}
            ${enrollGroupCheckboxes("Pick exactly 1 of PE / Art / Psychology / ML", "pe", opts.pe_bucket_pick_1, chosen)}
            ${enrollGroupCheckboxes("Pick exactly 1 language", "lang", opts.languages_pick_1, chosen)}
        `;
    } else {
        // Year 12/13
        const ielts = chosen.has("English") || chosen.has("English Literature") ? "Not required" : "Required (auto-added)";
        body = `
            <p style="font-size:0.85rem;color:var(--text-light);">
                <strong>${escHtml(stud.surname)} ${escHtml(stud.name)}</strong> · Class ${escHtml(stud.class_name)} · Year ${year}
            </p>
            <p style="font-size:0.82rem;color:var(--text-light);margin-bottom:6px;">
                Pick at least ${opts.min_subjects} subjects. <span id="ieltsIndicator">IELTS: ${ielts}</span>
            </p>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:6px;max-height:380px;overflow-y:auto;border:1px solid rgba(var(--primary-blue-rgb),0.15);border-radius:8px;padding:8px;">
                ${opts.all_choices.map(s => `
                    <label style="display:inline-flex;align-items:center;gap:6px;font-size:0.85rem;">
                        <input type="checkbox" class="enroll-pick" data-name="${escHtml(s)}" ${chosen.has(s) ? "checked" : ""} onchange="updateIeltsIndicator()"> ${escHtml(s)}
                    </label>`).join("")}
            </div>
        `;
    }

    openAdminModal(`Edit enrollment`, body, async () => {
        let chosenNames = [];
        let englishLevel = null;
        if (year === 10 || year === 11) {
            const hum = Array.from(document.querySelectorAll('input.enroll-pick[data-group="hum"]:checked')).map(c => c.dataset.name);
            const pe = Array.from(document.querySelectorAll('input.enroll-pick[data-group="pe"]:checked')).map(c => c.dataset.name);
            const lang = Array.from(document.querySelectorAll('input.enroll-pick[data-group="lang"]:checked')).map(c => c.dataset.name);
            if (hum.length !== 2) { showToast("Pick exactly 2 humanities", "warning"); return; }
            if (pe.length !== 1) { showToast("Pick exactly 1 of PE/Art/Psy/ML", "warning"); return; }
            if (lang.length !== 1) { showToast("Pick exactly 1 language", "warning"); return; }
            chosenNames = [...hum, ...pe, ...lang];
            const lv = document.getElementById("enrollEnglish").value;
            englishLevel = lv === "" ? null : parseInt(lv);
        } else {
            chosenNames = Array.from(document.querySelectorAll('input.enroll-pick:checked')).map(c => c.dataset.name);
            if (chosenNames.length < (opts.min_subjects || 3)) {
                showToast(`Pick at least ${opts.min_subjects} subjects`, "warning");
                return;
            }
        }
        const r = await apiFetch("/admin/enrollments/", {
            method: "POST",
            body: JSON.stringify({
                student_id: studentId,
                subjects: chosenNames,
                english_level: englishLevel,
            }),
        });
        const dd = await r.json();
        if (!r.ok) { showToast(dd.message || "Failed", "error"); return; }
        closeAdminModal();
        showToast("Enrollment saved", "success");
        await loadSection("enrollments");
    });
}

function enrollGroupCheckboxes(title, group, options, chosen) {
    return `
        <div class="form-group">
            <label>${escHtml(title)}</label>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
                ${(options || []).map(s => `
                    <label style="display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border:1px solid rgba(var(--primary-blue-rgb),0.2);border-radius:8px;background:var(--bg-button);font-size:0.85rem;">
                        <input type="checkbox" class="enroll-pick" data-group="${group}" data-name="${escHtml(s)}" ${chosen.has(s) ? "checked" : ""}> ${escHtml(s)}
                    </label>`).join("")}
            </div>
        </div>
    `;
}

function updateIeltsIndicator() {
    const ind = document.getElementById("ieltsIndicator");
    if (!ind) return;
    const checked = Array.from(document.querySelectorAll('input.enroll-pick:checked')).map(c => c.dataset.name);
    const hasEng = checked.includes("English") || checked.includes("English Literature");
    ind.textContent = `IELTS: ${hasEng ? "Not required" : "Required (auto-added)"}`;
}

function openImportEnrollmentsModal() {
    openAdminModal("Import enrollments from CSV", `
        <p style="font-size:0.85rem;color:var(--text-light);margin:0 0 10px;">
            Upload a CSV with one row per student. Recognised columns:
            <code>email</code>, <code>english_level</code> (optional), and the subject choices in any of:
        </p>
        <ul style="font-size:0.82rem;color:var(--text-light);margin:0 0 10px 16px;padding:0;">
            <li><strong>Wide:</strong> <code>email, english_level, subject1, subject2, …</code></li>
            <li><strong>Long:</strong> separate <code>subject</code> column repeated per student row (one row per choice)</li>
        </ul>
        <p style="font-size:0.82rem;color:var(--text-light);margin:0 0 10px;">
            Mandatory year 10/11 subjects are auto-added. IELTS auto-added for year 12/13 without English/English Literature.
        </p>
        <div class="form-group">
            <label>CSV file</label>
            <input type="file" id="enrollCsvFile" accept=".csv,text/csv" class="form-input">
        </div>
        <div class="form-group">
            <label style="display:inline-flex;align-items:center;gap:6px;">
                <input type="checkbox" id="enrollWipe"> Wipe all existing enrollments before importing
            </label>
        </div>
        <div id="enrollImportPreview" style="font-size:0.82rem;color:var(--text-light);"></div>
    `, async () => {
        const f = document.getElementById("enrollCsvFile").files[0];
        if (!f) { showToast("Pick a CSV file", "warning"); return; }
        const wipe = document.getElementById("enrollWipe").checked;
        const text = await f.text();
        const parsed = parseEnrollCsv(text);
        if (!parsed.rows.length) { showToast("No rows parsed", "warning"); return; }

        const r = await apiFetch("/admin/enrollments/bulk/", {
            method: "POST",
            body: JSON.stringify({ rows: parsed.rows, wipe_existing: wipe }),
        });
        const d = await r.json();
        if (!r.ok) { showToast(d.message || "Failed", "error"); return; }
        const s = d.summary || {};
        const errLines = (s.errors || []).slice(0, 10).map(e =>
            `Row ${e.row}: ${e.email || ""} — ${e.error}`).join("\n");
        closeAdminModal();
        showToast(`Imported ${s.imported || 0}, skipped ${s.skipped || 0}`,
            (s.skipped > 0 ? "warning" : "success"));
        if (errLines) console.warn("Enrollment import errors:\n" + errLines);
        await loadSection("enrollments");
    });
}

function parseEnrollCsv(text) {
    // Support both wide and long formats. Header row required.
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length);
    if (!lines.length) return { rows: [] };
    const header = lines[0].split(",").map(c => c.trim().toLowerCase());
    const rest = lines.slice(1).map(l => splitCsvLine(l));
    const emailIdx = header.findIndex(h => h === "email");
    const levelIdx = header.findIndex(h => h === "english_level" || h === "level");
    const subjectIdx = header.findIndex(h => h === "subject");
    if (emailIdx < 0) return { rows: [] };

    if (subjectIdx >= 0) {
        // Long format: aggregate by email.
        const byEmail = {};
        for (const cells of rest) {
            const email = (cells[emailIdx] || "").trim().toLowerCase();
            if (!email) continue;
            if (!byEmail[email]) byEmail[email] = { email, subjects: [], english_level: null };
            const subj = (cells[subjectIdx] || "").trim();
            if (subj) byEmail[email].subjects.push(subj);
            if (levelIdx >= 0 && cells[levelIdx]) {
                const lv = parseInt(cells[levelIdx]);
                if (!isNaN(lv)) byEmail[email].english_level = lv;
            }
        }
        return { rows: Object.values(byEmail) };
    }

    // Wide format: every column except email + english_level is a subject choice.
    const subjectCols = header.map((h, i) => ({ h, i }))
        .filter(x => x.i !== emailIdx && x.i !== levelIdx)
        .map(x => x.i);
    const out = [];
    for (const cells of rest) {
        const email = (cells[emailIdx] || "").trim().toLowerCase();
        if (!email) continue;
        const subjects = [];
        for (const i of subjectCols) {
            const v = (cells[i] || "").trim();
            if (v) subjects.push(v);
        }
        let lv = null;
        if (levelIdx >= 0 && cells[levelIdx]) {
            const n = parseInt(cells[levelIdx]);
            if (!isNaN(n)) lv = n;
        }
        out.push({ email, subjects, english_level: lv });
    }
    return { rows: out };
}

function splitCsvLine(line) {
    // Minimal CSV splitter that handles quoted values containing commas.
    const out = [];
    let cur = "", inQ = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') {
            if (inQ && line[i+1] === '"') { cur += '"'; i++; }
            else inQ = !inQ;
        } else if (c === "," && !inQ) {
            out.push(cur); cur = "";
        } else {
            cur += c;
        }
    }
    out.push(cur);
    return out;
}

/* ═══════════════ SCHEDULE ═══════════════ */
const DAY_NAMES = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const SCHED_DAY_LABELS = ["", "Mon", "Tue", "Wed", "Thu", "Fri"];
const SCHED_DAY_FULL  = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

function _schedExtractYear(className) {
    const m = String(className || "").match(/^(\d+)/);
    return m ? parseInt(m[1]) : 999;
}

function _schedRenderTeacherGrid(teacher, slots) {
    const byDayPeriod = {};
    for (const s of slots) {
        const key = `${s.day_of_week}_${s.period}`;
        if (!byDayPeriod[key]) byDayPeriod[key] = [];
        byDayPeriod[key].push(s);
    }
    const days = [1,2,3,4,5];
    const periods = [1,2,3,4,5,6,7,8];
    let html = `<div style="margin-bottom:20px;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
            <strong style="font-size:0.95rem;color:var(--primary-blue);">${escHtml(teacher)}</strong>
        </div>
        <div style="overflow-x:auto;">
        <table style="border-collapse:collapse;font-size:0.78rem;min-width:500px;width:100%;">
            <thead><tr>
                <th style="border:1px solid rgba(var(--primary-blue-rgb),0.15);padding:4px 6px;background:var(--bg-table-header);width:44px;text-align:center;">Per.</th>
                ${days.map(d => `<th style="border:1px solid rgba(var(--primary-blue-rgb),0.15);padding:4px 8px;background:var(--bg-table-header);text-align:center;">${SCHED_DAY_LABELS[d]}</th>`).join("")}
            </tr></thead>
            <tbody>`;
    for (const p of periods) {
        html += `<tr><td style="border:1px solid rgba(var(--primary-blue-rgb),0.15);padding:4px 6px;text-align:center;font-weight:700;background:var(--bg-table-header);">${p}</td>`;
        for (const d of days) {
            const cells = byDayPeriod[`${d}_${p}`] || [];
            if (!cells.length) {
                const tName = (teacher || "").replace(/'/g, "\\'");
                html += `<td onclick="addScheduleSlotPrefill(${d}, ${p}, '${tName}')" title="Add slot" style="border:1px solid rgba(var(--primary-blue-rgb),0.12);padding:3px 5px;color:var(--text-lighter);font-style:italic;text-align:center;cursor:pointer;" onmouseover="this.style.background='rgba(var(--primary-blue-rgb),0.08)';this.innerHTML='+ add';" onmouseout="this.style.background='';this.innerHTML='—';">—</td>`;
            } else {
                const inner = cells.map(c => `
                    <div onclick="openEditScheduleSlot('${c.id}')" title="Edit slot" style="margin-bottom:${cells.length>1?'4px':'0'};padding:2px 4px;border-radius:4px;background:rgba(var(--primary-blue-rgb),0.07);cursor:pointer;">
                        <span style="font-weight:700;">${escHtml(c.subject_name||"")}</span>
                        <span style="color:var(--text-light);margin-left:4px;">${escHtml(c.class_name||"")}</span>
                        ${c.room ? `<span style="color:var(--text-lighter);margin-left:3px;">${escHtml(c.room)}</span>` : ""}
                        <button onclick="event.stopPropagation();deleteScheduleSlot('${c.id}')" title="Delete" style="float:right;background:none;border:none;color:#b91c1c;cursor:pointer;padding:0 2px;font-size:0.85rem;">✕</button>
                    </div>`).join("");
                html += `<td style="border:1px solid rgba(var(--primary-blue-rgb),0.15);padding:3px 5px;vertical-align:top;">${inner}</td>`;
            }
        }
        html += `</tr>`;
    }
    html += `</tbody></table></div></div>`;
    return html;
}

function _schedRenderClassGrid(className, slots) {
    const days = [1,2,3,4,5];
    const periods = [1,2,3,4,5,6,7,8];
    const byKey = {};
    for (const s of slots) {
        const k = `${s.day_of_week}_${s.period}`;
        if (!byKey[k]) byKey[k] = [];
        byKey[k].push(s);
    }
    let html = `<div style="margin-bottom:20px;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
            <strong style="font-size:0.95rem;color:var(--primary-blue);">${escHtml(className)}</strong>
        </div>
        <div style="overflow-x:auto;">
        <table style="border-collapse:collapse;font-size:0.78rem;min-width:500px;width:100%;">
            <thead><tr>
                <th style="border:1px solid rgba(var(--primary-blue-rgb),0.15);padding:4px 6px;background:var(--bg-table-header);width:44px;text-align:center;">Per.</th>
                ${days.map(d => `<th style="border:1px solid rgba(var(--primary-blue-rgb),0.15);padding:4px 8px;background:var(--bg-table-header);text-align:center;">${SCHED_DAY_LABELS[d]}</th>`).join("")}
            </tr></thead><tbody>`;
    for (const p of periods) {
        html += `<tr><td style="border:1px solid rgba(var(--primary-blue-rgb),0.15);padding:4px 6px;text-align:center;font-weight:700;background:var(--bg-table-header);">${p}</td>`;
        for (const d of days) {
            const cells = byKey[`${d}_${p}`] || [];
            if (!cells.length) {
                html += `<td onclick="addScheduleSlotPrefill(${d}, ${p}, '')" title="Add slot" style="border:1px solid rgba(var(--primary-blue-rgb),0.12);padding:3px 5px;color:var(--text-lighter);font-style:italic;text-align:center;cursor:pointer;" onmouseover="this.style.background='rgba(var(--primary-blue-rgb),0.08)';" onmouseout="this.style.background='';">—</td>`;
            } else {
                const inner = cells.map(c => `
                    <div onclick="openEditScheduleSlot('${c.id}')" title="Edit slot" style="margin-bottom:${cells.length>1?'4px':'0'};padding:2px 4px;border-radius:4px;background:rgba(var(--primary-blue-rgb),0.07);cursor:pointer;">
                        <span style="font-weight:700;">${escHtml(c.subject_name||"")}</span>
                        ${c.room ? `<span style="color:var(--text-lighter);margin-left:3px;">${escHtml(c.room)}</span>` : ""}
                        <button onclick="event.stopPropagation();deleteScheduleSlot('${c.id}')" title="Delete" style="float:right;background:none;border:none;color:#b91c1c;cursor:pointer;padding:0 2px;font-size:0.85rem;">✕</button>
                        <div style="font-size:0.7rem;color:var(--text-light);">${escHtml(c.teacher_name||"")}</div>
                    </div>`).join("");
                html += `<td style="border:1px solid rgba(var(--primary-blue-rgb),0.15);padding:3px 5px;vertical-align:top;">${inner}</td>`;
            }
        }
        html += `</tr>`;
    }
    html += `</tbody></table></div></div>`;
    return html;
}

function _schedRenderYearBucketGrid(label, slots) {
    const days = [1,2,3,4,5];
    const periods = [1,2,3,4,5,6,7,8];
    const byKey = {};
    for (const s of slots) {
        const k = `${s.day_of_week}_${s.period}`;
        if (!byKey[k]) byKey[k] = [];
        byKey[k].push(s);
    }
    let html = `<div style="margin-bottom:30px;">
        <div style="font-size:1.1rem;font-weight:800;color:var(--primary-blue);border-bottom:2px solid rgba(var(--primary-blue-rgb),0.25);padding-bottom:4px;margin-bottom:10px;">${escHtml(label)}</div>
        <div style="overflow-x:auto;">
        <table style="border-collapse:collapse;font-size:0.74rem;min-width:700px;width:100%;">
            <thead><tr>
                <th style="border:1px solid rgba(var(--primary-blue-rgb),0.15);padding:4px 6px;background:var(--bg-table-header);width:44px;text-align:center;">Per.</th>
                ${days.map(d => `<th style="border:1px solid rgba(var(--primary-blue-rgb),0.15);padding:4px 8px;background:var(--bg-table-header);text-align:center;">${SCHED_DAY_LABELS[d]}</th>`).join("")}
            </tr></thead><tbody>`;
    for (const p of periods) {
        html += `<tr><td style="border:1px solid rgba(var(--primary-blue-rgb),0.15);padding:4px 6px;text-align:center;font-weight:700;background:var(--bg-table-header);">${p}</td>`;
        for (const d of days) {
            const cells = (byKey[`${d}_${p}`] || []).slice().sort((a, b) => (a.class_name || "").localeCompare(b.class_name || ""));
            if (!cells.length) {
                html += `<td onclick="addScheduleSlotPrefill(${d}, ${p}, '')" title="Add slot" style="border:1px solid rgba(var(--primary-blue-rgb),0.12);padding:3px 5px;color:var(--text-lighter);font-style:italic;text-align:center;cursor:pointer;" onmouseover="this.style.background='rgba(var(--primary-blue-rgb),0.08)';" onmouseout="this.style.background='';">—</td>`;
            } else {
                const inner = cells.map(c => `
                    <div onclick="openEditScheduleSlot('${c.id}')" title="Edit slot" style="margin-bottom:3px;padding:2px 4px;border-radius:4px;background:rgba(var(--primary-blue-rgb),0.07);line-height:1.25;cursor:pointer;">
                        <span style="font-weight:700;color:var(--primary-blue);">${escHtml(c.class_name || "")}</span>
                        <span style="margin-left:4px;">${escHtml(c.subject_name || "")}</span>
                        <div style="font-size:0.66rem;color:var(--text-light);">
                            ${escHtml(c.teacher_name || "")}${c.room ? ` · <span style="color:var(--text-lighter);">${escHtml(c.room)}</span>` : ""}
                            <button onclick="event.stopPropagation();deleteScheduleSlot('${c.id}')" title="Delete" style="float:right;background:none;border:none;color:#b91c1c;cursor:pointer;padding:0 2px;font-size:0.8rem;">✕</button>
                        </div>
                    </div>`).join("");
                html += `<td style="border:1px solid rgba(var(--primary-blue-rgb),0.15);padding:3px 5px;vertical-align:top;">${inner}</td>`;
            }
        }
        html += `</tr>`;
    }
    html += `</tbody></table></div></div>`;
    return html;
}

async function reloadScheduleKeepScroll() {
    const y = window.scrollY || window.pageYOffset || 0;
    const view = window._schedViewMode || "year";
    window._schedRestoreView = view;
    window._schedRestoreScroll = y;
    await loadSection("schedule");
    // Restore view mode if needed (loadSchedule defaults to "year")
    if (view !== "year" && typeof schedSetView === "function") schedSetView(view);
    requestAnimationFrame(() => window.scrollTo(0, y));
}

async function loadSchedule(container) {
    await Promise.all([fetchClasses(), fetchSubjects(), fetchTeachers()]);
    const res = await apiFetch("/admin/schedule/");
    const d = await res.json();
    const slots = d.schedule || [];

    // Group by year → teacher
    const byYear = {};
    for (const s of slots) {
        const yr = _schedExtractYear(s.class_name);
        if (!byYear[yr]) byYear[yr] = {};
        const t = s.teacher_name || "Unknown";
        if (!byYear[yr][t]) byYear[yr][t] = [];
        byYear[yr][t].push(s);
    }
    const years = Object.keys(byYear).map(Number).sort((a, b) => a - b);

    let bodyHtml;
    if (!slots.length) {
        bodyHtml = `<p class="empty-state">No schedule slots yet.</p>`;
    } else {
        // View toggle state
        bodyHtml = `
        <div style="margin-bottom:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            <span style="font-size:0.85rem;color:var(--text-light);">Group by:</span>
            <button class="btn btn-sm" id="schedViewByYear" onclick="schedSetView('year')" style="background:var(--primary-blue);color:#fff;">By year group</button>
            <button class="btn btn-sm" id="schedViewByTeacher" onclick="schedSetView('teacher')">By teacher</button>
        </div>
        <div id="schedBody"></div>`;
    }

    container.innerHTML = `
        <div class="admin-section-header">
            <h3>Timetable</h3>
            <div class="section-header-actions">
                <button class="btn btn-secondary btn-sm" id="seedPdfBtn" onclick="seedFromPdf()">⬆ Import PDF timetable</button>
                <button class="btn btn-primary btn-sm" onclick="openAddScheduleSlot()">+ Add Time Slot</button>
            </div>
        </div>
        <div id="seedResultBox" style="display:none;"></div>
        ${bodyHtml}
    `;

    if (slots.length) {
        window._schedSlots = slots;
        window._schedByYear = byYear;
        window._schedYears = years;
        schedSetView("year");
    }
}

function schedSetView(mode) {
    window._schedViewMode = mode;
    const slots = window._schedSlots || [];
    const byYear = window._schedByYear || {};
    const years = window._schedYears || [];

    const btnYear = document.getElementById("schedViewByYear");
    const btnTeacher = document.getElementById("schedViewByTeacher");
    const body = document.getElementById("schedBody");
    if (!body) return;

    if (btnYear) { btnYear.style.background = mode === "year" ? "var(--primary-blue)" : ""; btnYear.style.color = mode === "year" ? "#fff" : ""; }
    if (btnTeacher) { btnTeacher.style.background = mode === "teacher" ? "var(--primary-blue)" : ""; btnTeacher.style.color = mode === "teacher" ? "#fff" : ""; }

    if (mode === "year") {
        // Group by class, show per-class timetables under year headers.
        // Year 10: 10A..10F (each own grid), Year 11: 11A..11E, Year 12: one, Year 13: one.
        const byClass = {};
        for (const s of slots) {
            const c = s.class_name || "—";
            if (!byClass[c]) byClass[c] = [];
            byClass[c].push(s);
        }
        const yearGroups = { 10: [], 11: [], 12: [], 13: [] };
        for (const cName of Object.keys(byClass)) {
            const yr = _schedExtractYear(cName);
            if (yearGroups[yr]) yearGroups[yr].push(cName);
        }
        for (const yr of Object.keys(yearGroups)) yearGroups[yr].sort();

        let html = "";
        for (const yr of [10, 11, 12, 13]) {
            const classes = yearGroups[yr];
            if (!classes.length) continue;
            html += `<div style="margin-bottom:30px;">
                <div style="font-size:1.1rem;font-weight:800;color:var(--primary-blue);border-bottom:2px solid rgba(var(--primary-blue-rgb),0.25);padding-bottom:4px;margin-bottom:12px;">Year ${yr}</div>`;
            for (const cName of classes) {
                html += _schedRenderClassGrid(cName, byClass[cName]);
            }
            html += `</div>`;
        }
        body.innerHTML = html;
    } else {
        // All teachers across all years
        const byTeacher = {};
        for (const s of slots) {
            const t = s.teacher_name || "Unknown";
            if (!byTeacher[t]) byTeacher[t] = [];
            byTeacher[t].push(s);
        }
        const teachers = Object.keys(byTeacher).sort();
        let html = "";
        for (const t of teachers) {
            html += _schedRenderTeacherGrid(t, byTeacher[t]);
        }
        body.innerHTML = html;
    }
}

async function seedFromPdf() {
    const btn = document.getElementById("seedPdfBtn");
    const box = document.getElementById("seedResultBox");
    if (btn) { btn.disabled = true; btn.textContent = "Importing…"; }
    if (box) { box.style.display = "none"; }

    try {
        // Fetch the committed seed JSON from GitHub raw
        const jsonRes = await fetch("https://raw.githubusercontent.com/Holmsbergsviti/e-diary/main/docs/timetable_seed.json");
        if (!jsonRes.ok) throw new Error("Could not fetch timetable_seed.json from GitHub");
        const seed = await jsonRes.json();
        const rows = seed.rows || [];
        if (!rows.length) throw new Error("seed JSON has no rows");

        const apiRes = await apiFetch("/timetable/seed-from-json/", {
            method: "POST",
            body: JSON.stringify({ wipe: true, rows }),
        });
        const data = await apiRes.json();

        if (!apiRes.ok) {
            throw new Error(data.message || `HTTP ${apiRes.status}`);
        }

        const teachersCreated = Array.isArray(data.teachers_created) ? data.teachers_created.length : (data.teachers_created ?? 0);
        const subjectsCreated = Array.isArray(data.subjects_created) ? data.subjects_created.length : (data.subjects_created ?? 0);
        const lines = [
            `✅ Import complete`,
            `Schedule rows inserted: <strong>${data.schedule_rows_inserted ?? "?"}</strong>`,
            `Teachers created: <strong>${teachersCreated}</strong>`,
            `Subjects created: <strong>${subjectsCreated}</strong>`,
            `Assignments wired: <strong>${data.assignments_created ?? 0}</strong>`,
        ];
        if (data.missing_classes && data.missing_classes.length) {
            lines.push(`⚠️ Missing classes (not in DB, rows skipped): <em>${escHtml(data.missing_classes.join(", "))}</em>`);
        }
        const creds = data.teacher_credentials || data.teachers_credentials || [];
        if (creds.length) {
            const cred = creds.map(c => `${escHtml(c.name)} — ${escHtml(c.email)} / ${escHtml(c.password)}`).join("<br>");
            lines.push(`<details style="margin-top:6px;"><summary style="cursor:pointer;">New teacher credentials (${creds.length})</summary><div style="font-family:monospace;font-size:0.8rem;margin-top:6px;">${cred}</div></details>`);
        }
        // Re-render the section, then re-show result
        const resultHtml = lines.join("<br>");
        await reloadScheduleKeepScroll();
        const newBox = document.getElementById("seedResultBox");
        if (newBox) {
            newBox.style.cssText = "display:block;padding:12px 14px;border-radius:8px;background:#d1fae5;color:#065f46;border:1px solid #6ee7b7;font-size:0.88rem;margin-bottom:12px;";
            newBox.innerHTML = resultHtml;
        }
    } catch (err) {
        const currentBox = document.getElementById("seedResultBox");
        if (currentBox) {
            currentBox.style.cssText = "display:block;padding:12px 14px;border-radius:8px;background:#fee2e2;color:#991b1b;border:1px solid #fecaca;font-size:0.88rem;margin-bottom:12px;";
            currentBox.innerHTML = `❌ ${escHtml(err.message)}`;
        }
        showToast("Import failed: " + err.message, "error");
    } finally {
        const currentBtn = document.getElementById("seedPdfBtn");
        if (currentBtn) { currentBtn.disabled = false; currentBtn.textContent = "⬆ Import PDF timetable"; }
    }
}

function _teacherIdByName(fullName) {
    if (!fullName) return "";
    const norm = fullName.trim().toLowerCase();
    for (const t of cachedTeachers) {
        const a = `${(t.name||"").trim()} ${(t.surname||"").trim()}`.trim().toLowerCase();
        const b = `${(t.surname||"").trim()} ${(t.name||"").trim()}`.trim().toLowerCase();
        if (a === norm || b === norm) return t.id;
    }
    return "";
}

function openAddScheduleSlot(prefill) {
    prefill = prefill || {};
    const teacherId = prefill.teacher_id || (prefill.teacher_name ? _teacherIdByName(prefill.teacher_name) : "");
    const day = prefill.day_of_week || 1;
    const period = prefill.period || 1;
    openAdminModal("Add Schedule Slot", `
        <label>Teacher <select class="form-input" id="mTeacher"><option value="">— Select —</option>${teacherOptions(teacherId)}</select></label>
        <label>Subject <select class="form-input" id="mSubject"><option value="">— Select —</option>${subjectOptions()}</select></label>
        <label>Class <select class="form-input" id="mClass"><option value="">— Select —</option>${classOptions()}</select></label>
        <label>Day <select class="form-input" id="mDay">
            ${[1,2,3,4,5].map(d => `<option value="${d}" ${d===day?"selected":""}>${["","Monday","Tuesday","Wednesday","Thursday","Friday"][d]}</option>`).join("")}
        </select></label>
        <label>Period <select class="form-input" id="mPeriod">
            ${[1,2,3,4,5,6,7,8].map(p => `<option value="${p}" ${p===period?"selected":""}>Period ${p}</option>`).join("")}
        </select></label>
        <label>Room <input class="form-input" id="mRoom" placeholder="e.g. Room 201 (optional)"></label>
    `, async () => {
        const body = {
            teacher_id: gv("mTeacher"), subject_id: gv("mSubject"), class_id: gv("mClass"),
            day_of_week: parseInt(gv("mDay")), period: parseInt(gv("mPeriod")), room: gv("mRoom"),
        };
        if (!body.teacher_id || !body.subject_id || !body.class_id) { showToast("Teacher, subject, class required", "warning"); return; }
        const res = await apiFetch("/admin/schedule/", { method: "POST", body: JSON.stringify(body) });
        const d = await res.json();
        if (!res.ok) { showToast(d.message || "Failed", "error"); return; }
        closeAdminModal();
        showToast("Slot created", "success");
        await reloadScheduleKeepScroll();
    });
}

function addScheduleSlotPrefill(day, period, teacherName) {
    openAddScheduleSlot({ day_of_week: day, period: period, teacher_name: teacherName });
}

function openEditScheduleSlot(slotId) {
    const slots = window._schedSlots || [];
    const s = slots.find(x => x.id === slotId);
    if (!s) { showToast("Slot not found", "error"); return; }

    const teacherId = s.teacher_id || _teacherIdByName(s.teacher_name);
    const subjId = s.subject_id || (cachedSubjects.find(x => x.name === s.subject_name) || {}).id || "";
    const classId = s.class_id || (cachedClasses.find(x => x.class_name === s.class_name) || {}).id || "";

    openAdminModal("Edit Schedule Slot", `
        <label>Teacher <select class="form-input" id="mTeacher"><option value="">— Select —</option>${teacherOptions(teacherId)}</select></label>
        <label>Subject <select class="form-input" id="mSubject"><option value="">— Select —</option>${subjectOptions(subjId)}</select></label>
        <label>Class <select class="form-input" id="mClass"><option value="">— Select —</option>${classOptions(classId)}</select></label>
        <label>Day <select class="form-input" id="mDay">
            ${[1,2,3,4,5].map(d => `<option value="${d}" ${d===s.day_of_week?"selected":""}>${["","Monday","Tuesday","Wednesday","Thursday","Friday"][d]}</option>`).join("")}
        </select></label>
        <label>Period <select class="form-input" id="mPeriod">
            ${[1,2,3,4,5,6,7,8].map(p => `<option value="${p}" ${p===s.period?"selected":""}>Period ${p}</option>`).join("")}
        </select></label>
        <label>Room <input class="form-input" id="mRoom" value="${escHtml(s.room || "")}" placeholder="e.g. Room 201 (optional)"></label>
        <div style="margin-top:10px;">
            <button class="btn btn-danger btn-sm" onclick="(async () => { if (await showConfirm('Delete this slot?', { title: 'Delete Slot', confirmText: 'Delete' })) { closeAdminModal(); await deleteScheduleSlot('${slotId}'); } })()">Delete this slot</button>
        </div>
    `, async () => {
        const body = {
            id: slotId,
            teacher_id: gv("mTeacher"), subject_id: gv("mSubject"), class_id: gv("mClass"),
            day_of_week: parseInt(gv("mDay")), period: parseInt(gv("mPeriod")), room: gv("mRoom"),
        };
        if (!body.teacher_id || !body.subject_id || !body.class_id) { showToast("Teacher, subject, class required", "warning"); return; }
        const res = await apiFetch("/admin/schedule/detail/", { method: "PATCH", body: JSON.stringify(body) });
        const d = await res.json();
        if (!res.ok) { showToast(d.message || "Failed", "error"); return; }
        closeAdminModal();
        showToast("Slot updated", "success");
        await reloadScheduleKeepScroll();
    });
}

async function deleteScheduleSlot(id) {
    const ok = await showConfirm("Delete this schedule slot?", { title: "Delete Slot", confirmText: "Delete" });
    if (!ok) return;
    try {
        const res = await apiFetch(`/admin/schedule/detail/?id=${id}`, { method: "DELETE" });
        if (!res.ok) { const d = await res.json().catch(() => ({})); showToast(d.message || "Failed to delete slot", "error"); return; }
        showToast("Slot deleted", "success");
        await reloadScheduleKeepScroll();
    } catch (err) { showToast("Error: " + err.message, "error"); }
}

/* ═══════════════ EVENTS ═══════════════ */
async function loadEvents(container) {
    const res = await apiFetch("/admin/events/");
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `HTTP ${res.status}`);
    }
    const d = await res.json();
    const events = d.events || [];
    container.innerHTML = `
        <div class="admin-section-header">
            <h3>Events</h3>
            <div class="section-header-actions">
                <button class="btn btn-primary btn-sm" onclick="openAddEvent()">+ Add Event</button>
            </div>
        </div>
        ${events.length === 0 ? '<p class="empty-state">No events yet.</p>' : `
        <table class="admin-table">
            <thead><tr><th>Title</th><th>Date</th><th>Time / Periods</th><th>Target</th><th>Actions</th></tr></thead>
            <tbody>${events.map(ev => {
                let targetLabel = "All";
                if (ev.target_type === "class") {
                    const ids = ev.target_class_ids || [];
                    targetLabel = ids.length + " class" + (ids.length !== 1 ? "es" : "");
                } else if (ev.target_type === "students") {
                    const ids = ev.target_student_ids || [];
                    targetLabel = ids.length + " student" + (ids.length !== 1 ? "s" : "");
                }
                const dateRange = ev.event_end_date && ev.event_end_date !== ev.event_date
                    ? `${escHtml(ev.event_date)} – ${escHtml(ev.event_end_date)}`
                    : escHtml(ev.event_date || "");
                const timeStr = ev.start_time
                    ? `${ev.start_time}${ev.end_time ? "–" + ev.end_time : ""}`
                    : "";
                const periodsStr = (ev.affected_periods || []).length > 0
                    ? "P" + ev.affected_periods.join(", P")
                    : "";
                const timePeriod = [timeStr, periodsStr].filter(Boolean).join(" · ") || "All day";
                return `<tr>
                    <td><strong>${escHtml(ev.title)}</strong>${ev.description ? `<br><small style="color:var(--text-lighter)">${escHtml(ev.description.substring(0, 60))}${ev.description.length > 60 ? "…" : ""}</small>` : ""}</td>
                    <td>${dateRange}</td>
                    <td><small>${escHtml(timePeriod)}</small></td>
                    <td><span class="event-target-badge event-target-${ev.target_type || 'all'}">${escHtml(targetLabel)}</span></td>
                    <td class="admin-actions">
                        <button class="btn btn-sm btn-secondary" onclick='openEditEvent(${JSON.stringify(ev).replace(/'/g, "&#39;")})'>Edit</button>
                        <button class="btn btn-sm btn-danger" onclick="deleteEvent('${ev.id}')">Delete</button>
                    </td>
                </tr>`;
            }).join("")}</tbody>
        </table>`}
    `;
}

async function openAddEvent() {
    await Promise.all([fetchClasses(), fetchStudents(), fetchTeachers()]);
    const body = buildEventFormHtml();
    openAdminModal("Add Event", body, async () => {
        const payload = collectEventForm();
        if (!payload) return;
        const res = await apiFetch("/admin/events/", { method: "POST", body: JSON.stringify(payload) });
        const d = await res.json();
        if (!res.ok) { showToast(d.message || "Failed", "error"); return; }
        closeAdminModal();
        showToast("Event created", "success");
        await loadSection("events");
    });
    bindEventTargetToggle();
}

async function openEditEvent(ev) {
    await Promise.all([fetchClasses(), fetchStudents(), fetchTeachers()]);
    const body = buildEventFormHtml(ev);
    openAdminModal("Edit Event", body, async () => {
        const payload = collectEventForm();
        if (!payload) return;
        const res = await apiFetch(`/admin/events/detail/?id=${ev.id}`, { method: "PATCH", body: JSON.stringify(payload) });
        const d = await res.json();
        if (!res.ok) { showToast(d.message || "Failed", "error"); return; }
        closeAdminModal();
        showToast("Event updated", "success");
        await loadSection("events");
    });
    bindEventTargetToggle();
}

function buildEventFormHtml(ev) {
    const tt = ev ? ev.target_type || "all" : "all";
    const selClassIds = ev ? (ev.target_class_ids || []) : [];
    const selStudentIds = ev ? (ev.target_student_ids || []) : [];
    const selTeacherIds = ev ? (ev.target_teacher_ids || []) : [];
    const selPeriods = ev ? (ev.affected_periods || []) : [];
    return `
        <div class="event-form">
            <div class="event-form-section">
                <div class="event-form-section-label">📝 Details</div>
                <label>Title <input class="form-input" id="mEvTitle" value="${escHtml(ev ? ev.title : "")}" placeholder="e.g. School Trip"></label>
                <label>Description <textarea class="form-input" id="mEvDesc" rows="2" placeholder="Optional details">${escHtml(ev ? ev.description || "" : "")}</textarea></label>
            </div>
            <div class="event-form-section">
                <div class="event-form-section-label">📅 Dates & Time</div>
                <div class="form-row-2col">
                    <label>Start Date <input class="form-input" id="mEvDate" type="date" value="${ev ? ev.event_date || "" : ""}"></label>
                    <label>End Date <input class="form-input" id="mEvEndDate" type="date" value="${ev && ev.event_end_date !== ev.event_date ? ev.event_end_date || "" : ""}"></label>
                </div>
                <div class="form-row-2col">
                    <label>Start Time <input class="form-input" id="mEvStartTime" type="time" value="${ev ? ev.start_time || "" : ""}"></label>
                    <label>End Time <input class="form-input" id="mEvEndTime" type="time" value="${ev ? ev.end_time || "" : ""}"></label>
                </div>
                <div class="event-period-section">
                    <label class="picker-label">Affected Periods <small style="color:var(--text-lighter)">(which timetable periods this event replaces)</small></label>
                    <div class="event-period-grid" id="mEvPeriods">
                        ${[1,2,3,4,5,6,7,8].map(p => {
                            const times = ["08:30–09:10","09:15–10:00","10:15–10:55","11:00–11:45","11:50–12:30","13:15–13:55","14:00–14:45","14:50–15:30"];
                            return `<button type="button" class="period-toggle-btn${selPeriods.includes(p) ? ' active' : ''}" data-period="${p}"><strong>P${p}</strong><small>${times[p-1]}</small></button>`;
                        }).join("")}
                        <button type="button" class="period-toggle-btn period-all-btn" id="mEvPeriodsAll">All Day</button>
                    </div>
                </div>
            </div>
            <div class="event-form-section">
                <div class="event-form-section-label">🎯 Target Audience</div>
                <div class="event-target-toggle" id="mEvTargetToggle">
                    <button type="button" class="target-btn${tt === "all" ? " active" : ""}" data-value="all">👥 All Students</button>
                    <button type="button" class="target-btn${tt === "class" ? " active" : ""}" data-value="class">🏫 Classes</button>
                    <button type="button" class="target-btn${tt === "students" ? " active" : ""}" data-value="students">🧑‍🎓 Students</button>
                </div>
                <input type="hidden" id="mEvTarget" value="${tt}">
                <div id="mEvClassPicker" class="checkbox-picker" style="display:${tt === "class" ? "block" : "none"}">
                    <label class="picker-label">Select Classes:</label>
                    <div class="checkbox-list">${cachedClasses.map(c =>
                        `<label class="checkbox-item"><input type="checkbox" value="${c.id}" ${selClassIds.includes(c.id) ? "checked" : ""}> ${escHtml(c.class_name)} (Year ${c.grade_level})</label>`
                    ).join("")}</div>
                </div>
                <div id="mEvStudentPicker" class="checkbox-picker" style="display:${tt === "students" ? "block" : "none"}">
                    <label class="picker-label">Select Students:</label>
                    <input class="form-input" id="mEvStudentSearch" placeholder="🔍 Search students…" oninput="filterEventStudents()">
                    <div class="checkbox-list checkbox-list-tall" id="mEvStudentList">${cachedStudents.map(s =>
                        `<label class="checkbox-item" data-name="${escHtml((s.surname + ' ' + s.name).toLowerCase())}"><input type="checkbox" value="${s.id}" ${selStudentIds.includes(s.id) ? "checked" : ""}> ${escHtml(s.surname)} ${escHtml(s.name)}${s.class_name ? ` <small>(${escHtml(s.class_name)})</small>` : ""}</label>`
                    ).join("")}</div>
                </div>
            </div>
            <div class="event-form-section">
                <div class="event-form-section-label">🧑‍🏫 Accompanying Teachers <small style="color:var(--text-lighter)">(optional – teachers going on the trip)</small></div>
                <input class="form-input" id="mEvTeacherSearch" placeholder="🔍 Search teachers…" oninput="filterEventTeachers()">
                <div class="checkbox-list" id="mEvTeacherList">${cachedTeachers.map(t =>
                    `<label class="checkbox-item" data-name="${escHtml((t.surname + ' ' + t.name).toLowerCase())}"><input type="checkbox" value="${t.id}" ${selTeacherIds.includes(t.id) ? "checked" : ""}> ${escHtml(t.surname)} ${escHtml(t.name)}</label>`
                ).join("")}</div>
            </div>
        </div>
    `;
}

function bindEventTargetToggle() {
    const toggle = document.getElementById("mEvTargetToggle");
    const hidden = document.getElementById("mEvTarget");
    if (!toggle || !hidden) return;
    toggle.querySelectorAll(".target-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            toggle.querySelectorAll(".target-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            hidden.value = btn.dataset.value;
            document.getElementById("mEvClassPicker").style.display = btn.dataset.value === "class" ? "block" : "none";
            document.getElementById("mEvStudentPicker").style.display = btn.dataset.value === "students" ? "block" : "none";
        });
    });

    // Period toggle buttons
    const periodGrid = document.getElementById("mEvPeriods");
    if (periodGrid) {
        periodGrid.querySelectorAll(".period-toggle-btn:not(.period-all-btn)").forEach(btn => {
            btn.addEventListener("click", () => {
                btn.classList.toggle("active");
            });
        });
        const allBtn = document.getElementById("mEvPeriodsAll");
        if (allBtn) {
            allBtn.addEventListener("click", () => {
                const periodBtns = periodGrid.querySelectorAll(".period-toggle-btn:not(.period-all-btn)");
                const allActive = [...periodBtns].every(b => b.classList.contains("active"));
                periodBtns.forEach(b => b.classList.toggle("active", !allActive));
            });
        }
    }
}

function filterEventStudents() {
    const q = (document.getElementById("mEvStudentSearch")?.value || "").toLowerCase();
    document.querySelectorAll("#mEvStudentList .checkbox-item").forEach(lbl => {
        lbl.style.display = !q || lbl.dataset.name.includes(q) ? "" : "none";
    });
}

function filterEventTeachers() {
    const q = (document.getElementById("mEvTeacherSearch")?.value || "").toLowerCase();
    document.querySelectorAll("#mEvTeacherList .checkbox-item").forEach(lbl => {
        lbl.style.display = !q || lbl.dataset.name.includes(q) ? "" : "none";
    });
}

function collectEventForm() {
    const title = gv("mEvTitle");
    const event_date = gv("mEvDate");
    if (!title || !event_date) { showToast("Title and start date required", "warning"); return null; }
    const start_time = gv("mEvStartTime") || null;
    const end_time = gv("mEvEndTime") || null;
    const affected_periods = [...document.querySelectorAll("#mEvPeriods .period-toggle-btn.active:not(.period-all-btn)")].map(b => parseInt(b.dataset.period));
    const target_type = gv("mEvTarget");
    let target_class_ids = [];
    let target_student_ids = [];
    if (target_type === "class") {
        target_class_ids = [...document.querySelectorAll("#mEvClassPicker input:checked")].map(cb => cb.value);
        if (target_class_ids.length === 0) { showToast("Select at least one class", "warning"); return null; }
    } else if (target_type === "students") {
        target_student_ids = [...document.querySelectorAll("#mEvStudentPicker input[type=checkbox]:checked")].map(cb => cb.value);
        if (target_student_ids.length === 0) { showToast("Select at least one student", "warning"); return null; }
    }
    const target_teacher_ids = [...document.querySelectorAll("#mEvTeacherList input[type=checkbox]:checked")].map(cb => cb.value);
    return {
        title, description: gv("mEvDesc"), event_date,
        event_end_date: gv("mEvEndDate") || event_date,
        start_time, end_time, affected_periods,
        target_type, target_class_ids, target_student_ids,
        target_teacher_ids,
    };
}

async function deleteEvent(id) {
    const ok = await showConfirm("Delete this event? This cannot be undone.", { title: "Delete Event", confirmText: "Delete" });
    if (!ok) return;
    try {
        const res = await apiFetch(`/admin/events/detail/?id=${id}`, { method: "DELETE" });
        if (!res.ok) { const d = await res.json().catch(() => ({})); showToast(d.message || "Failed to delete event", "error"); return; }
        showToast("Event deleted", "success");
        await loadSection("events");
    } catch (err) { showToast("Error: " + err.message, "error"); }
}

/* ═══════════════ HOLIDAYS ═══════════════ */
async function loadHolidays(container) {
    const res = await apiFetch("/admin/holidays/");
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `HTTP ${res.status}`);
    }
    const d = await res.json();
    const holidays = d.holidays || [];
    container.innerHTML = `
        <div class="admin-section-header">
            <h3>Holidays</h3>
            <div class="section-header-actions">
                <button class="btn btn-primary btn-sm" onclick="openAddHoliday()">+ Add Holiday</button>
            </div>
        </div>
        ${holidays.length === 0 ? '<p class="empty-state">No holidays yet.</p>' : `
        <table class="admin-table">
            <thead><tr><th>Name</th><th>Start Date</th><th>End Date</th><th>Duration</th><th>Actions</th></tr></thead>
            <tbody>${holidays.map(h => {
                const start = new Date(h.start_date);
                const end = new Date(h.end_date || h.start_date);
                const days = Math.round((end - start) / 86400000) + 1;
                return `<tr>
                    <td>${escHtml(h.name)}</td>
                    <td>${escHtml(h.start_date)}</td>
                    <td>${h.end_date !== h.start_date ? escHtml(h.end_date) : "—"}</td>
                    <td>${days} day${days !== 1 ? "s" : ""}</td>
                    <td class="admin-actions">
                        <button class="btn btn-sm btn-secondary" onclick='openEditHoliday(${JSON.stringify(h).replace(/'/g, "&#39;")})'>Edit</button>
                        <button class="btn btn-sm btn-danger" onclick="deleteHoliday('${h.id}')">Delete</button>
                    </td>
                </tr>`;
            }).join("")}</tbody>
        </table>`}
    `;
}

function openAddHoliday() {
    openAdminModal("Add Holiday", `
        <div class="event-form">
            <div class="event-form-section">
                <div class="event-form-section-label">🏖 Holiday Details</div>
                <label>Name <input class="form-input" id="mHolName" placeholder="e.g. Christmas Break"></label>
            </div>
            <div class="event-form-section">
                <div class="event-form-section-label">📅 Dates</div>
                <div class="form-row-2col">
                    <label>Start Date <input class="form-input" id="mHolStart" type="date"></label>
                    <label>End Date <input class="form-input" id="mHolEnd" type="date"></label>
                </div>
            </div>
        </div>
    `, async () => {
        const name = gv("mHolName");
        const start_date = gv("mHolStart");
        if (!name || !start_date) { showToast("Name and start date required", "warning"); return; }
        const res = await apiFetch("/admin/holidays/", {
            method: "POST",
            body: JSON.stringify({ name, start_date, end_date: gv("mHolEnd") || start_date }),
        });
        const d = await res.json();
        if (!res.ok) { showToast(d.message || "Failed", "error"); return; }
        closeAdminModal();
        showToast("Holiday created", "success");
        await loadSection("holidays");
    });
}

function openEditHoliday(h) {
    openAdminModal("Edit Holiday", `
        <div class="event-form">
            <div class="event-form-section">
                <div class="event-form-section-label">🏖 Holiday Details</div>
                <label>Name <input class="form-input" id="mHolName" value="${escHtml(h.name)}"></label>
            </div>
            <div class="event-form-section">
                <div class="event-form-section-label">📅 Dates</div>
                <div class="form-row-2col">
                    <label>Start Date <input class="form-input" id="mHolStart" type="date" value="${h.start_date}"></label>
                    <label>End Date <input class="form-input" id="mHolEnd" type="date" value="${h.end_date || h.start_date}"></label>
                </div>
            </div>
        </div>
    `, async () => {
        const name = gv("mHolName");
        const start_date = gv("mHolStart");
        if (!name || !start_date) { showToast("Name and start date required", "warning"); return; }
        const res = await apiFetch(`/admin/holidays/detail/?id=${h.id}`, {
            method: "PATCH",
            body: JSON.stringify({ name, start_date, end_date: gv("mHolEnd") || start_date }),
        });
        const d = await res.json();
        if (!res.ok) { showToast(d.message || "Failed", "error"); return; }
        closeAdminModal();
        showToast("Holiday updated", "success");
        await loadSection("holidays");
    });
}

async function deleteHoliday(id) {
    const ok = await showConfirm("Delete this holiday? This cannot be undone.", { title: "Delete Holiday", confirmText: "Delete" });
    if (!ok) return;
    try {
        const res = await apiFetch(`/admin/holidays/detail/?id=${id}`, { method: "DELETE" });
        if (!res.ok) { const d = await res.json().catch(() => ({})); showToast(d.message || "Failed to delete holiday", "error"); return; }
        showToast("Holiday deleted", "success");
        await loadSection("holidays");
    } catch (err) { showToast("Error: " + err.message, "error"); }
}

/* ═══════════════ ATTENDANCE FLAGS ═══════════════ */
async function loadAttendanceFlags(container) {
    // Default: last 7 days
    const today = new Date();
    const weekAgo = new Date(today); weekAgo.setDate(today.getDate() - 7);
    const defaultFrom = weekAgo.toISOString().slice(0, 10);
    const defaultTo = today.toISOString().slice(0, 10);

    container.innerHTML = `
        <div class="admin-section-header">
            <h3>⚠ Attendance Flags</h3>
            <p style="color:var(--text-secondary);margin:4px 0 0;font-size:0.85rem">
                Students marked <strong>absent</strong> in one subject but <strong>present / late</strong> in another on the same day.
            </p>
        </div>
        <div style="display:flex;gap:12px;align-items:center;margin-bottom:16px;flex-wrap:wrap">
            <label style="font-size:0.85rem;color:var(--text-secondary)">From
                <input type="date" id="flagsFrom" value="${defaultFrom}" class="modal-input" style="width:auto;margin-left:4px">
            </label>
            <label style="font-size:0.85rem;color:var(--text-secondary)">To
                <input type="date" id="flagsTo" value="${defaultTo}" class="modal-input" style="width:auto;margin-left:4px">
            </label>
            <button class="btn btn-primary btn-sm" onclick="fetchAttendanceFlags()">Search</button>
        </div>
        <div id="flagsResult"><p class="loading">Loading…</p></div>
    `;
    await fetchAttendanceFlags();
}

async function fetchAttendanceFlags() {
    const from = document.getElementById("flagsFrom")?.value || "";
    const to = document.getElementById("flagsTo")?.value || "";
    const resultDiv = document.getElementById("flagsResult");
    if (!resultDiv) return;
    resultDiv.innerHTML = '<p class="loading">Loading…</p>';

    try {
        const res = await apiFetch(`/admin/attendance-flags/?from=${from}&to=${to}`);
        if (!res.ok) {
            resultDiv.innerHTML = '<p class="empty-state">Failed to load attendance flags.</p>';
            return;
        }
        const data = await res.json();
        const flags = data.flags || [];

        if (flags.length === 0) {
            resultDiv.innerHTML = `<p class="empty-state">No suspicious attendance found between ${escHtml(data.date_from)} and ${escHtml(data.date_to)}. ✅</p>`;
            return;
        }

        let html = `<p style="margin-bottom:12px;color:var(--text-secondary);font-size:0.85rem">
            Found <strong>${flags.length}</strong> flag(s) between ${escHtml(data.date_from)} and ${escHtml(data.date_to)}
        </p>`;
        html += `<table class="admin-table"><thead><tr>
            <th>Date</th><th>Student</th><th>Class</th><th>Absent In</th><th>Present In</th>
        </tr></thead><tbody>`;

        for (const f of flags) {
            html += `<tr>
                <td>${escHtml(f.date)}</td>
                <td>${escHtml(f.student_name)}</td>
                <td>${escHtml(f.class_name || "–")}</td>
                <td><span class="flag-absent">${f.absent_in.map(s => escHtml(s)).join(", ")}</span></td>
                <td><span class="flag-present">${f.present_in.map(s => escHtml(s)).join(", ")}</span></td>
            </tr>`;
        }
        html += "</tbody></table>";
        resultDiv.innerHTML = html;
    } catch (err) {
        resultDiv.innerHTML = `<p class="empty-state">Error: ${escHtml(err.message)}</p>`;
    }
}

/* ═══════════════ CSV / EXCEL IMPORT ═══════════════ */
function renderImportSection(container) {
    container.innerHTML = `
        <div class="admin-section-header">
            <h3>Bulk Import (CSV / Excel)</h3>
        </div>
        <p class="import-instructions">Upload a CSV or Excel (.xlsx) file to bulk-import data. The first row must be the header row with column names.</p>
        <div class="import-grid">
            <div class="import-card">
                <h4>Import Type</h4>
                <select class="form-input" id="csvType">
                    <option value="classes">Classes (class_name, grade_level)</option>
                    <option value="subjects">Subjects (name, color_code)</option>
                    <option value="students">Students (name, surname, class_name — email &amp; password auto-generated)</option>
                    <option value="teachers">Teachers (name, surname — email &amp; password auto-generated)</option>
                    <option value="admins">Admins (email, password, name, surname)</option>
                    <option value="teacher_assignments">Teacher Assignments (teacher_name, subject_name, class_name)</option>
                    <option value="student_subjects">Student Enrolments (student_name, subject_name, group_class_name)</option>
                    <option value="schedule">Schedule (teacher_name, subject_name, class_name, day_of_week, period, room)</option>
                </select>
            </div>
            <div class="import-card">
                <h4>File</h4>
                <input type="file" id="csvFile" accept=".csv,.xlsx,.xls" class="form-input">
            </div>
        </div>
        <div id="csvPreview" class="csv-preview"></div>
        <div class="import-actions">
            <button class="btn btn-secondary" onclick="previewCSV()">Preview</button>
            <button class="btn btn-primary" id="csvImportBtn" onclick="executeCSVImport()" disabled>Import</button>
        </div>
        <div id="csvResult"></div>
    `;
}

let csvParsedRows = [];

async function previewCSV() {
    const file = document.getElementById("csvFile").files[0];
    if (!file) { showToast("Select a CSV or Excel file first", "warning"); return; }

    try {
        const parsed = await parseTabularFile(file);
        if (parsed.rows.length === 0) { showToast("No data rows found", "warning"); return; }
        csvParsedRows = parsed.rows;
        const headers = parsed.headers;

        const preview = document.getElementById("csvPreview");
        preview.innerHTML = `
            <p><strong>${csvParsedRows.length} rows</strong> parsed. Columns: ${headers.map(h => `<code>${escHtml(h)}</code>`).join(", ")}</p>
            <table class="admin-table">
                <thead><tr>${headers.map(h => `<th>${escHtml(h)}</th>`).join("")}</tr></thead>
                <tbody>${csvParsedRows.slice(0, 5).map(r => `<tr>${headers.map(h => `<td>${escHtml(r[h] || "")}</td>`).join("")}</tr>`).join("")}
                ${csvParsedRows.length > 5 ? `<tr><td colspan="${headers.length}" style="text-align:center;color:var(--text-lighter)">… and ${csvParsedRows.length - 5} more rows</td></tr>` : ""}
                </tbody>
            </table>
        `;
        document.getElementById("csvImportBtn").disabled = false;
    } catch (err) {
        showToast("Failed to read file: " + err.message, "error");
    }
}

/* Parse a tabular file (.csv / .xlsx / .xls) into an array of
   {headerLowercase: cellString} row objects. Uses SheetJS for Excel.
   Returns { headers, rows }. */
async function parseTabularFile(file) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (ext === 'xlsx' || ext === 'xls') {
        if (typeof XLSX === 'undefined') {
            throw new Error("Excel parser not loaded");
        }
        const data = await file.arrayBuffer();
        const wb = XLSX.read(data, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: "" });
        if (!matrix.length) return { headers: [], rows: [] };
        const headers = matrix[0].map(h => String(h || '').trim().toLowerCase());
        const rows = [];
        for (let i = 1; i < matrix.length; i++) {
            const vals = matrix[i] || [];
            if (!vals.length) continue;
            const row = {};
            headers.forEach((h, idx) => { row[h] = String(vals[idx] ?? '').trim(); });
            if (Object.values(row).some(v => v)) rows.push(row);
        }
        return { headers, rows };
    }
    // CSV path
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 1) return { headers: [], rows: [] };
    const headers = parseCSVLine(lines[0]).map(h => h.trim().toLowerCase());
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const vals = parseCSVLine(lines[i]);
        const row = {};
        headers.forEach((h, idx) => { row[h] = (vals[idx] || '').trim(); });
        if (Object.values(row).some(v => v)) rows.push(row);
    }
    return { headers, rows };
}

function parseCSVLine(line) {
    const result = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
            if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
            else if (ch === '"') { inQuotes = false; }
            else { current += ch; }
        } else {
            if (ch === '"') { inQuotes = true; }
            else if (ch === ',') { result.push(current); current = ""; }
            else { current += ch; }
        }
    }
    result.push(current);
    return result;
}

async function executeCSVImport() {
    if (csvParsedRows.length === 0) { showToast("No data to import", "warning"); return; }
    const importType = document.getElementById("csvType").value;
    const btn = document.getElementById("csvImportBtn");
    const resultDiv = document.getElementById("csvResult");
    btn.disabled = true;

    try {
        const d = await chunkedImport({
            type: importType,
            rows: csvParsedRows,
            onProgress: ({ done, total }) => {
                btn.textContent = `Importing… ${done}/${total}`;
                resultDiv.innerHTML = `<p style="color:var(--text-light);">Imported ${done} of ${total}…</p>`;
            },
        });
        let resultHtml = `
            <div class="import-result ${d.errors.length ? "import-result-partial" : "import-result-success"}">
                <p><strong>${d.created}</strong> rows imported successfully.</p>
                ${d.errors.length ? `
                <p><strong>${d.errors.length}</strong> rows failed:</p>
                <ul>${d.errors.slice(0, 20).map(e => `<li>Row ${e.row}: ${escHtml(e.error)}</li>`).join("")}
                ${d.errors.length > 20 ? `<li>… and ${d.errors.length - 20} more errors</li>` : ""}
                </ul>` : ""}
            </div>
        `;
        if (d.credentials.length > 0) {
            resultHtml += `<button class="btn btn-primary" style="margin-top:12px;" onclick="downloadCredentials(window._bulkCredentials)">⬇ Download Credentials CSV</button>`;
            window._bulkCredentials = d.credentials;
        }
        resultDiv.innerHTML = resultHtml;
        if (d.created > 0) {
            showToast(`${d.created} rows imported`, "success");
            if (importType === "students") cachedStudents = null;
        }
        if (d.errors.length) showToast(`${d.errors.length} rows failed`, "warning");
    } catch (err) {
        showToast("Import failed: " + err.message, "error");
    } finally {
        btn.textContent = "Import";
        btn.disabled = false;
    }
}

/* ═══════════════ Modal helpers ═══════════════ */
let modalSaveCallback = null;

function openAdminModal(title, bodyHtml, onSave) {
    document.getElementById("adminModalTitle").textContent = title;
    document.getElementById("adminModalBody").innerHTML = bodyHtml;
    const overlay = document.getElementById("adminModal");
    overlay.style.display = "flex";
    overlay.onclick = (e) => { if (e.target === overlay) closeAdminModal(); };
    modalSaveCallback = onSave;
    const saveBtn = document.getElementById("adminModalSave");
    saveBtn.onclick = async () => {
        saveBtn.disabled = true;
        saveBtn.textContent = "Saving…";
        try {
            await modalSaveCallback();
        } catch (err) {
            showToast(err.message || "Error", "error");
        } finally {
            saveBtn.disabled = false;
            saveBtn.textContent = "Save";
        }
    };
}

function closeAdminModal() {
    document.getElementById("adminModal").style.display = "none";
    modalSaveCallback = null;
}

function gv(id) { return (document.getElementById(id)?.value || "").trim(); }

/* ═══════════════ Impersonation ═══════════════ */
async function impersonateUser(userId) {
    try {
        const res = await apiFetch("/admin/impersonate/", {
            method: "POST",
            body: JSON.stringify({ user_id: userId }),
        });
        const d = await res.json();
        if (!res.ok) { showToast(d.message || "Failed to impersonate", "error"); return; }

        // Save admin session so we can return later
        localStorage.setItem("admin_token", localStorage.getItem("token"));
        localStorage.setItem("admin_user", localStorage.getItem("user"));

        // Switch to the target user's session
        localStorage.setItem("token", d.token);
        localStorage.setItem("user", JSON.stringify(d.user));

        // Redirect to the appropriate page
        if (d.user.role === "teacher") {
            window.location.href = "teacher.html";
        } else {
            window.location.href = "dashboard.html";
        }
    } catch (err) {
        showToast("Impersonation failed: " + err.message, "error");
    }
}

/* ═══════════════ Init ═══════════════ */
/* --- Admin export wiring --- */
/* Exports are now handled on-demand via the Exports tab (_fetchAndExport) */

document.addEventListener("DOMContentLoaded", () => {
    initAdmin().catch(err => console.error("Admin init error:", err));
});
