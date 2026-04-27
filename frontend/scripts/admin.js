/* ===== Admin Panel – E-Diary ===== */

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
        <label><input type="checkbox" id="mIsClassTeacher"> Class Teacher</label>
        <label>Class Teacher Of <select class="form-input" id="mClassTeacherOf"><option value="">— None —</option>${classOptions()}</select></label>
    `, async () => {
        const body = {
            role: "teacher", name: gv("mName"), surname: gv("mSurname"),
            is_class_teacher: document.getElementById("mIsClassTeacher").checked,
            class_teacher_of_class_id: gv("mClassTeacherOf"),
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
        <label><input type="checkbox" id="mIsClassTeacher" ${t.is_class_teacher ? "checked" : ""}> Class Teacher</label>
        <label>Class Teacher Of <select class="form-input" id="mClassTeacherOf"><option value="">— None —</option>${classOptions(t.class_teacher_of_class_id)}</select></label>
    `, async () => {
        const body = {
            id: t.id, role: "teacher", name: gv("mName"), surname: gv("mSurname"),
            is_class_teacher: document.getElementById("mIsClassTeacher").checked,
            class_teacher_of_class_id: gv("mClassTeacherOf"),
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
    const overlay = document.getElementById("adminModal");
    document.getElementById("adminModalTitle").textContent = "Remove Duplicate Students";
    document.getElementById("adminModalBody").innerHTML = '<p class="loading">Scanning…</p>';
    overlay.style.display = "flex";
    overlay.onclick = (e) => { if (e.target === overlay) closeAdminModal(); };
    const saveBtn = document.getElementById("adminModalSave");
    saveBtn.textContent = "Delete duplicates";
    saveBtn.disabled = true;

    let preview = null;
    try {
        const res = await apiFetch("/admin/dedupe-students/");
        preview = await res.json();
    } catch (err) {
        document.getElementById("adminModalBody").innerHTML = `<p class="empty-state">Failed to scan: ${escHtml(err.message)}</p>`;
        return;
    }

    const groups = preview.groups || [];
    const total = preview.duplicate_count || 0;
    if (groups.length === 0) {
        document.getElementById("adminModalBody").innerHTML = '<p class="empty-state">No duplicates found.</p>';
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
    saveBtn.disabled = false;

    modalSaveCallback = async () => {
        saveBtn.disabled = true;
        const ids = (preview && preview.duplicate_ids) || [];
        const total = ids.length;
        if (total === 0) { closeAdminModal(); return; }

        const CHUNK = 30;
        let totalDeleted = 0;
        let chunkErrors = 0;
        for (let i = 0; i < ids.length; i += CHUNK) {
            const slice = ids.slice(i, i + CHUNK);
            saveBtn.textContent = `Deleting… ${Math.min(i + slice.length, total)}/${total}`;
            try {
                const res = await apiFetch("/admin/dedupe-students/", {
                    method: "POST",
                    body: JSON.stringify({ ids: slice }),
                });
                const d = await res.json();
                totalDeleted += d.deleted || 0;
            } catch (err) {
                chunkErrors++;
            }
        }
        if (totalDeleted > 0) {
            showToast(`${totalDeleted} duplicates removed${chunkErrors ? ` (${chunkErrors} batches failed)` : ""}`,
                chunkErrors ? "warning" : "success");
        } else if (chunkErrors > 0) {
            showToast("Dedupe failed for all batches — try again", "error");
        }
        cachedStudents = null;
        saveBtn.textContent = "Delete duplicates";
        saveBtn.disabled = false;
        closeAdminModal();
        await loadSection("students");
    };
    saveBtn.onclick = async () => {
        try { await modalSaveCallback(); }
        catch (err) { showToast(err.message || "Error", "error"); }
    };
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
    await Promise.all([fetchClasses(), fetchSubjects(), fetchTeachers()]);
    const res = await apiFetch("/admin/teacher-assignments/");
    const d = await res.json();
    const assignments = (d.assignments || []).slice().sort((a, b) =>
        (a.teacher_name || "").localeCompare(b.teacher_name || "", undefined, { sensitivity: "base" }) ||
        (a.subject_name || "").localeCompare(b.subject_name || "", undefined, { sensitivity: "base" }) ||
        (a.class_name || "").localeCompare(b.class_name || "", undefined, { sensitivity: "base" })
    );
    container.innerHTML = `
        <div class="admin-section-header">
            <h3>Teacher Assignments</h3>
            <div class="section-header-actions">
                <button class="btn btn-primary btn-sm" onclick="openAddAssignment()">+ Add Assignment</button>
            </div>
        </div>
        ${assignments.length === 0 ? '<p class="empty-state">No assignments yet.</p>' : `
        <table class="admin-table">
            <thead><tr><th>Teacher</th><th>Subject</th><th>Class</th><th>Actions</th></tr></thead>
            <tbody>${assignments.map(a => `
                <tr>
                    <td>${escHtml(a.teacher_name)}</td>
                    <td>${escHtml(a.subject_name)}</td>
                    <td>${escHtml(a.class_name)}</td>
                    <td class="admin-actions">
                        <button class="btn btn-sm btn-danger" onclick="deleteAssignment('${a.teacher_id}','${a.subject_id}','${a.class_id}')">Delete</button>
                    </td>
                </tr>
            `).join("")}</tbody>
        </table>`}
    `;
}

function openAddAssignment() {
    openAdminModal("Add Teacher Assignment", `
        <label>Teacher <select class="form-input" id="mTeacher"><option value="">— Select —</option>${teacherOptions()}</select></label>
        <label>Subject <select class="form-input" id="mSubject"><option value="">— Select —</option>${subjectOptions()}</select></label>
        <label>Class <select class="form-input" id="mClass"><option value="">— Select —</option>${classOptions()}</select></label>
    `, async () => {
        const body = { teacher_id: gv("mTeacher"), subject_id: gv("mSubject"), class_id: gv("mClass") };
        if (!body.teacher_id || !body.subject_id || !body.class_id) { showToast("All fields required", "warning"); return; }
        const res = await apiFetch("/admin/teacher-assignments/", { method: "POST", body: JSON.stringify(body) });
        const d = await res.json();
        if (!res.ok) { showToast(d.message || "Failed", "error"); return; }
        closeAdminModal();
        showToast("Assignment created", "success");
        await loadSection("assignments");
    });
}

async function deleteAssignment(tid, sid, cid) {
    const ok = await showConfirm("Remove this teacher assignment?", { title: "Remove Assignment", confirmText: "Remove" });
    if (!ok) return;
    try {
        const res = await apiFetch(`/admin/teacher-assignments/delete/?teacher_id=${tid}&subject_id=${sid}&class_id=${cid}`, { method: "DELETE" });
        if (!res.ok) { const d = await res.json().catch(() => ({})); showToast(d.message || "Failed to remove assignment", "error"); return; }
        showToast("Assignment removed", "success");
        await loadSection("assignments");
    } catch (err) { showToast("Error: " + err.message, "error"); }
}

/* ═══════════════ STUDENT ENROLMENTS ═══════════════ */
async function loadEnrollments(container) {
    await Promise.all([fetchClasses(), fetchSubjects(), fetchStudents()]);
    const res = await apiFetch("/admin/student-subjects/");
    const d = await res.json();
    const enrollments = (d.enrollments || []).slice().sort((a, b) =>
        (a.student_name || "").localeCompare(b.student_name || "", undefined, { sensitivity: "base" }) ||
        (a.subject_name || "").localeCompare(b.subject_name || "", undefined, { sensitivity: "base" })
    );
    container.innerHTML = `
        <div class="admin-section-header">
            <h3>Student Subject Enrolments</h3>
            <div class="section-header-actions">
                <button class="btn btn-primary btn-sm" onclick="openAddEnrollment()">+ Add Enrolment</button>
            </div>
        </div>
        ${enrollments.length === 0 ? '<p class="empty-state">No enrolments yet.</p>' : `
        <table class="admin-table">
            <thead><tr><th>Student</th><th>Subject</th><th>Group Class</th><th>Actions</th></tr></thead>
            <tbody>${enrollments.map(e => `
                <tr>
                    <td>${escHtml(e.student_name)}</td>
                    <td>${escHtml(e.subject_name)}</td>
                    <td>${escHtml(e.group_class_name || "—")}</td>
                    <td class="admin-actions">
                        <button class="btn btn-sm btn-danger" onclick="deleteEnrollment('${e.student_id}','${e.subject_id}')">Delete</button>
                    </td>
                </tr>
            `).join("")}</tbody>
        </table>`}
    `;
}

function openAddEnrollment() {
    openAdminModal("Add Student Enrolment", `
        <label>Student <select class="form-input" id="mStudent"><option value="">— Select —</option>${studentOptions()}</select></label>
        <label>Subject <select class="form-input" id="mSubject"><option value="">— Select —</option>${subjectOptions()}</select></label>
        <label>Group Class (optional) <select class="form-input" id="mGroupClass"><option value="">— None —</option>${classOptions()}</select></label>
    `, async () => {
        const body = { student_id: gv("mStudent"), subject_id: gv("mSubject"), group_class_id: gv("mGroupClass") };
        if (!body.student_id || !body.subject_id) { showToast("Student and subject required", "warning"); return; }
        const res = await apiFetch("/admin/student-subjects/", { method: "POST", body: JSON.stringify(body) });
        const d = await res.json();
        if (!res.ok) { showToast(d.message || "Failed", "error"); return; }
        closeAdminModal();
        showToast("Enrolment created", "success");
        await loadSection("enrollments");
    });
}

async function deleteEnrollment(studentId, subjectId) {
    const ok = await showConfirm("Remove this enrolment?", { title: "Remove Enrolment", confirmText: "Remove" });
    if (!ok) return;
    try {
        const res = await apiFetch(`/admin/student-subjects/delete/?student_id=${studentId}&subject_id=${subjectId}`, { method: "DELETE" });
        if (!res.ok) { const d = await res.json().catch(() => ({})); showToast(d.message || "Failed to remove enrolment", "error"); return; }
        showToast("Enrolment removed", "success");
        await loadSection("enrollments");
    } catch (err) { showToast("Error: " + err.message, "error"); }
}

/* ═══════════════ SCHEDULE ═══════════════ */
const DAY_NAMES = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
async function loadSchedule(container) {
    await Promise.all([fetchClasses(), fetchSubjects(), fetchTeachers()]);
    const res = await apiFetch("/admin/schedule/");
    const d = await res.json();
    const slots = d.schedule || [];
    container.innerHTML = `
        <div class="admin-section-header">
            <h3>Timetable</h3>
            <div class="section-header-actions">
                <button class="btn btn-primary btn-sm" onclick="openAddScheduleSlot()">+ Add Time Slot</button>
            </div>
        </div>
        ${slots.length === 0 ? '<p class="empty-state">No schedule slots yet.</p>' : `
        <table class="admin-table">
            <thead><tr><th>Day</th><th>Period</th><th>Teacher</th><th>Subject</th><th>Class</th><th>Room</th><th>Actions</th></tr></thead>
            <tbody>${slots.map(s => `
                <tr>
                    <td>${DAY_NAMES[s.day_of_week] || s.day_of_week}</td>
                    <td>${s.period}</td>
                    <td>${escHtml(s.teacher_name)}</td>
                    <td>${escHtml(s.subject_name)}</td>
                    <td>${escHtml(s.class_name)}</td>
                    <td>${escHtml(s.room || "—")}</td>
                    <td class="admin-actions">
                        <button class="btn btn-sm btn-danger" onclick="deleteScheduleSlot('${s.id}')">Delete</button>
                    </td>
                </tr>
            `).join("")}</tbody>
        </table>`}
    `;
}

function openAddScheduleSlot() {
    openAdminModal("Add Schedule Slot", `
        <label>Teacher <select class="form-input" id="mTeacher"><option value="">— Select —</option>${teacherOptions()}</select></label>
        <label>Subject <select class="form-input" id="mSubject"><option value="">— Select —</option>${subjectOptions()}</select></label>
        <label>Class <select class="form-input" id="mClass"><option value="">— Select —</option>${classOptions()}</select></label>
        <label>Day <select class="form-input" id="mDay">
            <option value="1">Monday</option><option value="2">Tuesday</option>
            <option value="3">Wednesday</option><option value="4">Thursday</option><option value="5">Friday</option>
        </select></label>
        <label>Period <select class="form-input" id="mPeriod">
            ${[1,2,3,4,5,6,7,8].map(p => `<option value="${p}">Period ${p}</option>`).join("")}
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
        await loadSection("schedule");
    });
}

async function deleteScheduleSlot(id) {
    const ok = await showConfirm("Delete this schedule slot?", { title: "Delete Slot", confirmText: "Delete" });
    if (!ok) return;
    try {
        const res = await apiFetch(`/admin/schedule/detail/?id=${id}`, { method: "DELETE" });
        if (!res.ok) { const d = await res.json().catch(() => ({})); showToast(d.message || "Failed to delete slot", "error"); return; }
        showToast("Slot deleted", "success");
        await loadSection("schedule");
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
