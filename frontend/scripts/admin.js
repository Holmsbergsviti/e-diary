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
    import: "import",
};

const ALL_PERM_KEYS = [
    { key: "students",   label: "Students" },
    { key: "teachers",   label: "Teachers" },
    { key: "classes",    label: "Classes" },
    { key: "subjects",   label: "Subjects" },
    { key: "schedule",   label: "Schedule" },
    { key: "events",     label: "Events" },
    { key: "holidays",   label: "Holidays" },
    { key: "study_hall", label: "Study Hall" },
    { key: "import",     label: "Import / Export" },
];

function _adminLevel() { return (getUser() || {}).admin_level || "regular"; }
function _adminPerms() { return (getUser() || {}).permissions || {}; }
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

/* ───── Cache helpers ───── */
async function fetchClasses() {
    const res = await apiFetch("/admin/classes/");
    const d = await res.json();
    cachedClasses = d.classes || [];
    return cachedClasses;
}
async function fetchSubjects() {
    const res = await apiFetch("/admin/subjects/");
    const d = await res.json();
    cachedSubjects = d.subjects || [];
    return cachedSubjects;
}
async function fetchTeachers() {
    const res = await apiFetch("/admin/users/?role=teacher");
    const d = await res.json();
    cachedTeachers = d.users || [];
    return cachedTeachers;
}
async function fetchStudents() {
    const res = await apiFetch("/admin/users/?role=student");
    const d = await res.json();
    cachedStudents = d.users || [];
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
            case "import": renderImportSection(container); break;
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
    container.innerHTML = `
        <div class="admin-section-header"><h3>School Overview</h3></div>
        <div class="stats-grid">
            <div class="stat-card"><div class="stat-number">${stats.total_classes || 0}</div><div class="stat-label">Classes</div></div>
            <div class="stat-card"><div class="stat-number">${stats.total_subjects || 0}</div><div class="stat-label">Subjects</div></div>
            <div class="stat-card"><div class="stat-number">${stats.total_teachers || 0}</div><div class="stat-label">Teachers</div></div>
            <div class="stat-card"><div class="stat-number">${stats.total_students || 0}</div><div class="stat-label">Students</div></div>
            <div class="stat-card"><div class="stat-number">${stats.total_admins || 0}</div><div class="stat-label">Admins</div></div>
            <div class="stat-card"><div class="stat-number">${stats.total_assignments || 0}</div><div class="stat-label">Teacher Assignments</div></div>
            <div class="stat-card"><div class="stat-number">${stats.total_enrollments || 0}</div><div class="stat-label">Student Enrolments</div></div>
            <div class="stat-card"><div class="stat-number">${stats.total_schedule_slots || 0}</div><div class="stat-label">Schedule Slots</div></div>
        </div>
        ${stats.classes_breakdown && stats.classes_breakdown.length ? `
        <h4 style="margin:24px 0 12px;color:var(--text-primary)">Students per Class</h4>
        <table class="admin-table">
            <thead><tr><th>Class</th><th>Year</th><th>Students</th></tr></thead>
            <tbody>${stats.classes_breakdown.map(c => `
                <tr><td>${escHtml(c.class_name)}</td><td>${c.grade_level}</td><td>${c.student_count}</td></tr>
            `).join("")}</tbody>
        </table>` : ""}
    `;
}

/* ═══════════════ CLASSES ═══════════════ */
async function loadClasses(container) {
    const classes = await fetchClasses();
    container.innerHTML = `
        <div class="admin-section-header">
            <h3>Classes</h3>
            <button class="btn btn-primary btn-sm" onclick="openAddClass()">+ Add Class</button>
        </div>
        ${classes.length === 0 ? '<p class="empty-state">No classes yet.</p>' : `
        <table class="admin-table">
            <thead><tr><th>Class Name</th><th>Year Level</th><th>Actions</th></tr></thead>
            <tbody>${classes.map(c => `
                <tr>
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
}

function openAddClass() {
    openAdminModal("Add Class", `
        <label>Class Name <input class="form-input" id="mClassName" placeholder="e.g. 12A"></label>
        <label>Year Level <input class="form-input" id="mGradeLevel" type="number" min="1" max="13" placeholder="e.g. 12"></label>
    `, async () => {
        const class_name = document.getElementById("mClassName").value.trim();
        const grade_level = document.getElementById("mGradeLevel").value.trim();
        if (!class_name || !grade_level) { showToast("All fields required", "warning"); return; }
        await apiFetch("/admin/classes/", { method: "POST", body: JSON.stringify({ class_name, grade_level }) });
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
        await apiFetch("/admin/classes/detail/", { method: "PATCH", body: JSON.stringify({
            id: c.id, class_name: document.getElementById("mClassName").value.trim(),
            grade_level: document.getElementById("mGradeLevel").value.trim(),
        })});
        closeAdminModal();
        showToast("Class updated", "success");
        await loadSection("classes");
    });
}

async function deleteClass(id) {
    if (!confirm("Delete this class? This may affect students and schedules.")) return;
    await apiFetch(`/admin/classes/detail/?id=${id}`, { method: "DELETE" });
    showToast("Class deleted", "success");
    await loadSection("classes");
}

/* ═══════════════ SUBJECTS ═══════════════ */
async function loadSubjects(container) {
    const subjects = await fetchSubjects();
    container.innerHTML = `
        <div class="admin-section-header">
            <h3>Subjects</h3>
            <button class="btn btn-primary btn-sm" onclick="openAddSubject()">+ Add Subject</button>
        </div>
        ${subjects.length === 0 ? '<p class="empty-state">No subjects yet.</p>' : `
        <table class="admin-table">
            <thead><tr><th>Subject Name</th><th>Color</th><th>Actions</th></tr></thead>
            <tbody>${subjects.map(s => `
                <tr>
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
}

function openAddSubject() {
    openAdminModal("Add Subject", `
        <label>Name <input class="form-input" id="mSubjName" placeholder="e.g. Mathematics"></label>
        <label>Color Code <input class="form-input" id="mSubjColor" placeholder="#3b82f6 (optional)"></label>
    `, async () => {
        const name = document.getElementById("mSubjName").value.trim();
        if (!name) { showToast("Name required", "warning"); return; }
        await apiFetch("/admin/subjects/", { method: "POST", body: JSON.stringify({
            name, color_code: document.getElementById("mSubjColor").value.trim(),
        })});
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
        await apiFetch("/admin/subjects/detail/", { method: "PATCH", body: JSON.stringify({
            id: s.id, name: document.getElementById("mSubjName").value.trim(),
            color_code: document.getElementById("mSubjColor").value.trim(),
        })});
        closeAdminModal();
        showToast("Subject updated", "success");
        await loadSection("subjects");
    });
}

async function deleteSubject(id) {
    if (!confirm("Delete this subject?")) return;
    await apiFetch(`/admin/subjects/detail/?id=${id}`, { method: "DELETE" });
    showToast("Subject deleted", "success");
    await loadSection("subjects");
}

/* ═══════════════ TEACHERS ═══════════════ */
async function loadTeachers(container) {
    await fetchClasses();
    const teachers = await fetchTeachers();
    container.innerHTML = `
        <div class="admin-section-header">
            <h3>Teachers</h3>
            <button class="btn btn-primary btn-sm" onclick="openAddTeacher()">+ Add Teacher</button>
        </div>
        ${teachers.length === 0 ? '<p class="empty-state">No teachers yet.</p>' : `
        <table class="admin-table">
            <thead><tr><th>Name</th><th>Class Teacher</th><th>Actions</th></tr></thead>
            <tbody>${teachers.map(t => `
                <tr>
                    <td>${escHtml(t.surname)} ${escHtml(t.name)}</td>
                    <td>${t.is_class_teacher ? `✓ ${escHtml(t.class_teacher_class_name || "")}` : "—"}</td>
                    <td class="admin-actions">
                        <button class="btn btn-sm btn-impersonate" onclick="impersonateUser('${t.id}')" title="Login as this teacher">Login as</button>
                        <button class="btn btn-sm btn-secondary" onclick='editTeacher(${JSON.stringify(t).replace(/'/g, "&#39;")})'>Edit</button>
                        <button class="btn btn-sm btn-danger" onclick="deleteUser('${t.id}','teacher')">Delete</button>
                    </td>
                </tr>
            `).join("")}</tbody>
        </table>`}
    `;
}

function openAddTeacher() {
    openAdminModal("Add Teacher", `
        <label>Name <input class="form-input" id="mName" placeholder="First name"></label>
        <label>Surname <input class="form-input" id="mSurname" placeholder="Last name"></label>
        <label>Email <input class="form-input" id="mEmail" type="email" placeholder="teacher@school.edu"></label>
        <label>Password <input class="form-input" id="mPassword" type="text" value="changeme"></label>
        <label><input type="checkbox" id="mIsClassTeacher"> Class Teacher</label>
        <label>Class Teacher Of <select class="form-input" id="mClassTeacherOf"><option value="">— None —</option>${classOptions()}</select></label>
    `, async () => {
        const body = {
            role: "teacher", name: gv("mName"), surname: gv("mSurname"),
            email: gv("mEmail"), password: gv("mPassword"),
            is_class_teacher: document.getElementById("mIsClassTeacher").checked,
            class_teacher_of_class_id: gv("mClassTeacherOf"),
        };
        if (!body.name || !body.surname || !body.email) { showToast("Name, surname, email required", "warning"); return; }
        const res = await apiFetch("/admin/users/", { method: "POST", body: JSON.stringify(body) });
        const d = await res.json();
        if (!res.ok) { showToast(d.message || "Failed", "error"); return; }
        closeAdminModal();
        showToast("Teacher created", "success");
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

/* ═══════════════ STUDENTS ═══════════════ */
async function loadStudents(container) {
    await fetchClasses();
    const students = await fetchStudents();
    container.innerHTML = `
        <div class="admin-section-header">
            <h3>Students</h3>
            <button class="btn btn-primary btn-sm" onclick="openAddStudent()">+ Add Student</button>
        </div>
        ${students.length === 0 ? '<p class="empty-state">No students yet.</p>' : `
        <table class="admin-table">
            <thead><tr><th>Name</th><th>Class</th><th>Actions</th></tr></thead>
            <tbody>${students.map(s => `
                <tr>
                    <td>${escHtml(s.surname)} ${escHtml(s.name)}</td>
                    <td>${escHtml(s.class_name || "—")}</td>
                    <td class="admin-actions">
                        <button class="btn btn-sm btn-impersonate" onclick="impersonateUser('${s.id}')" title="Login as this student">Login as</button>
                        <button class="btn btn-sm btn-secondary" onclick='editStudent(${JSON.stringify(s).replace(/'/g, "&#39;")})'>Edit</button>
                        <button class="btn btn-sm btn-danger" onclick="deleteUser('${s.id}','student')">Delete</button>
                    </td>
                </tr>
            `).join("")}</tbody>
        </table>`}
    `;
}

function openAddStudent() {
    openAdminModal("Add Student", `
        <label>Name <input class="form-input" id="mName" placeholder="First name"></label>
        <label>Surname <input class="form-input" id="mSurname" placeholder="Last name"></label>
        <label>Email <input class="form-input" id="mEmail" type="email" placeholder="student@school.edu"></label>
        <label>Password <input class="form-input" id="mPassword" type="text" value="changeme"></label>
        <label>Class <select class="form-input" id="mClassId"><option value="">— Select —</option>${classOptions()}</select></label>
    `, async () => {
        const body = {
            role: "student", name: gv("mName"), surname: gv("mSurname"),
            email: gv("mEmail"), password: gv("mPassword"), class_id: gv("mClassId"),
        };
        if (!body.name || !body.surname || !body.email) { showToast("Name, surname, email required", "warning"); return; }
        const res = await apiFetch("/admin/users/", { method: "POST", body: JSON.stringify(body) });
        const d = await res.json();
        if (!res.ok) { showToast(d.message || "Failed", "error"); return; }
        closeAdminModal();
        showToast("Student created", "success");
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
        await loadSection("students");
    });
}

/* ═══════════════ ADMINS ═══════════════ */
async function loadAdmins(container) {
    if (!_canManageAdmins()) {
        container.innerHTML = '<p class="empty-state">You do not have access to this section.</p>';
        return;
    }
    const res = await apiFetch("/admin/users/?role=admin");
    const d = await res.json();
    const admins = d.users || [];
    const isSuperAdmin = _adminLevel() === "super";
    container.innerHTML = `
        <div class="admin-section-header">
            <h3>Admins</h3>
            <button class="btn btn-primary btn-sm" onclick="openAddAdmin()">+ Add Admin</button>
        </div>
        ${admins.length === 0 ? '<p class="empty-state">No admins yet.</p>' : `
        <table class="admin-table">
            <thead><tr><th>Name</th><th>Email</th><th>Level</th><th>Permissions</th><th>Actions</th></tr></thead>
            <tbody>${admins.map(a => {
                const lvl = a.admin_level || "regular";
                const perms = a.permissions || {};
                const permTags = lvl === "master" ? '<span class="perm-tag perm-all">All</span>' :
                    ALL_PERM_KEYS.filter(p => perms[p.key]).map(p => `<span class="perm-tag">${escHtml(p.label)}</span>`).join("") || '<span class="perm-tag perm-none">None</span>';
                const isMaster = lvl === "master";
                const canEdit = isSuperAdmin || !isMaster;
                const canDelete = isSuperAdmin || !isMaster;
                return `<tr>
                    <td>${escHtml(a.surname)} ${escHtml(a.name)}</td>
                    <td>${escHtml(a.email || "")}</td>
                    <td><span class="admin-level-badge level-${lvl}">${lvl}</span></td>
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
    openAdminModal("Add Admin", `
        <label>Name <input class="form-input" id="mName" placeholder="First name"></label>
        <label>Surname <input class="form-input" id="mSurname" placeholder="Last name"></label>
        <label>Email <input class="form-input" id="mEmail" type="email" placeholder="admin@school.edu"></label>
        <label>Password <input class="form-input" id="mPassword" type="text" value="changeme"></label>
        <fieldset class="perm-fieldset"><legend>Permissions</legend>${_permCheckboxes(defaultPerms)}</fieldset>
    `, async () => {
        const perms = _collectPerms();
        const body = { role: "admin", name: gv("mName"), surname: gv("mSurname"), email: gv("mEmail"), password: gv("mPassword"), permissions: perms };
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
    const isMaster = a.admin_level === "master";
    openAdminModal("Edit Admin", `
        <label>Name <input class="form-input" id="mName" value="${escHtml(a.name)}"></label>
        <label>Surname <input class="form-input" id="mSurname" value="${escHtml(a.surname)}"></label>
        <label>New Email <input class="form-input" id="mEmail" placeholder="Leave blank to keep"></label>
        <label>New Password <input class="form-input" id="mPassword" placeholder="Leave blank to keep"></label>
        ${isMaster ? '' : `<fieldset class="perm-fieldset"><legend>Permissions</legend>${_permCheckboxes(existingPerms)}</fieldset>`}
    `, async () => {
        const body = { id: a.id, role: "admin", name: gv("mName"), surname: gv("mSurname") };
        const email = gv("mEmail"); if (email) body.email = email;
        const pw = gv("mPassword"); if (pw) body.password = pw;
        if (!isMaster) body.permissions = _collectPerms();
        const res = await apiFetch("/admin/users/detail/", { method: "PATCH", body: JSON.stringify(body) });
        const d = await res.json();
        if (!res.ok) { showToast(d.message || "Failed", "error"); return; }
        closeAdminModal();
        showToast("Admin updated", "success");
        await loadSection("admins");
    });
}

async function deleteUser(id, role) {
    if (!confirm(`Delete this ${role}? This cannot be undone.`)) return;
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
    const assignments = d.assignments || [];
    container.innerHTML = `
        <div class="admin-section-header">
            <h3>Teacher Assignments</h3>
            <button class="btn btn-primary btn-sm" onclick="openAddAssignment()">+ Add Assignment</button>
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
    if (!confirm("Remove this assignment?")) return;
    await apiFetch(`/admin/teacher-assignments/delete/?teacher_id=${tid}&subject_id=${sid}&class_id=${cid}`, { method: "DELETE" });
    showToast("Assignment removed", "success");
    await loadSection("assignments");
}

/* ═══════════════ STUDENT ENROLMENTS ═══════════════ */
async function loadEnrollments(container) {
    await Promise.all([fetchClasses(), fetchSubjects(), fetchStudents()]);
    const res = await apiFetch("/admin/student-subjects/");
    const d = await res.json();
    const enrollments = d.enrollments || [];
    container.innerHTML = `
        <div class="admin-section-header">
            <h3>Student Subject Enrolments</h3>
            <button class="btn btn-primary btn-sm" onclick="openAddEnrollment()">+ Add Enrolment</button>
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
    if (!confirm("Remove this enrolment?")) return;
    await apiFetch(`/admin/student-subjects/delete/?student_id=${studentId}&subject_id=${subjectId}`, { method: "DELETE" });
    showToast("Enrolment removed", "success");
    await loadSection("enrollments");
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
            <h3>Schedule</h3>
            <button class="btn btn-primary btn-sm" onclick="openAddScheduleSlot()">+ Add Time Slot</button>
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
    if (!confirm("Delete this schedule slot?")) return;
    await apiFetch(`/admin/schedule/detail/?id=${id}`, { method: "DELETE" });
    showToast("Slot deleted", "success");
    await loadSection("schedule");
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
            <button class="btn btn-primary btn-sm" onclick="openAddEvent()">+ Add Event</button>
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
    await Promise.all([fetchClasses(), fetchStudents()]);
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
    await Promise.all([fetchClasses(), fetchStudents()]);
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
    return {
        title, description: gv("mEvDesc"), event_date,
        event_end_date: gv("mEvEndDate") || event_date,
        start_time, end_time, affected_periods,
        target_type, target_class_ids, target_student_ids,
    };
}

async function deleteEvent(id) {
    if (!confirm("Delete this event?")) return;
    await apiFetch(`/admin/events/detail/?id=${id}`, { method: "DELETE" });
    showToast("Event deleted", "success");
    await loadSection("events");
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
            <button class="btn btn-primary btn-sm" onclick="openAddHoliday()">+ Add Holiday</button>
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
    if (!confirm("Delete this holiday?")) return;
    await apiFetch(`/admin/holidays/detail/?id=${id}`, { method: "DELETE" });
    showToast("Holiday deleted", "success");
    await loadSection("holidays");
}

/* ═══════════════ CSV IMPORT ═══════════════ */
function renderImportSection(container) {
    container.innerHTML = `
        <div class="admin-section-header">
            <h3>CSV Bulk Import</h3>
        </div>
        <p class="import-instructions">Upload a CSV file to bulk-import data. The first row must be the header row with column names.</p>
        <div class="import-grid">
            <div class="import-card">
                <h4>Import Type</h4>
                <select class="form-input" id="csvType">
                    <option value="classes">Classes (class_name, grade_level)</option>
                    <option value="subjects">Subjects (name, color_code)</option>
                    <option value="students">Students (email, password, name, surname, class_name)</option>
                    <option value="teachers">Teachers (email, password, name, surname)</option>
                    <option value="admins">Admins (email, password, name, surname)</option>
                    <option value="teacher_assignments">Teacher Assignments (teacher_name, subject_name, class_name)</option>
                    <option value="student_subjects">Student Enrolments (student_name, subject_name, group_class_name)</option>
                    <option value="schedule">Schedule (teacher_name, subject_name, class_name, day_of_week, period, room)</option>
                </select>
            </div>
            <div class="import-card">
                <h4>CSV File</h4>
                <input type="file" id="csvFile" accept=".csv" class="form-input">
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

function previewCSV() {
    const file = document.getElementById("csvFile").files[0];
    if (!file) { showToast("Select a CSV file first", "warning"); return; }

    const reader = new FileReader();
    reader.onload = (e) => {
        const text = e.target.result;
        const lines = text.split(/\r?\n/).filter(l => l.trim());
        if (lines.length < 2) { showToast("CSV must have a header row and at least one data row", "warning"); return; }

        const headers = parseCSVLine(lines[0]);
        csvParsedRows = [];
        for (let i = 1; i < lines.length; i++) {
            const values = parseCSVLine(lines[i]);
            const row = {};
            headers.forEach((h, idx) => { row[h.trim()] = (values[idx] || "").trim(); });
            csvParsedRows.push(row);
        }

        const preview = document.getElementById("csvPreview");
        preview.innerHTML = `
            <p><strong>${csvParsedRows.length} rows</strong> parsed. Columns: ${headers.map(h => `<code>${escHtml(h.trim())}</code>`).join(", ")}</p>
            <table class="admin-table">
                <thead><tr>${headers.map(h => `<th>${escHtml(h.trim())}</th>`).join("")}</tr></thead>
                <tbody>${csvParsedRows.slice(0, 5).map(r => `<tr>${headers.map(h => `<td>${escHtml(r[h.trim()] || "")}</td>`).join("")}</tr>`).join("")}
                ${csvParsedRows.length > 5 ? `<tr><td colspan="${headers.length}" style="text-align:center;color:var(--text-lighter)">… and ${csvParsedRows.length - 5} more rows</td></tr>` : ""}
                </tbody>
            </table>
        `;
        document.getElementById("csvImportBtn").disabled = false;
    };
    reader.readAsText(file);
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
    btn.disabled = true;
    btn.textContent = "Importing…";

    try {
        const res = await apiFetch("/admin/csv-import/", {
            method: "POST",
            body: JSON.stringify({ type: importType, rows: csvParsedRows }),
        });
        const d = await res.json();
        const resultDiv = document.getElementById("csvResult");
        resultDiv.innerHTML = `
            <div class="import-result ${d.errors && d.errors.length ? "import-result-partial" : "import-result-success"}">
                <p><strong>${d.created || 0}</strong> rows imported successfully.</p>
                ${d.errors && d.errors.length ? `
                <p><strong>${d.errors.length}</strong> rows failed:</p>
                <ul>${d.errors.slice(0, 20).map(e => `<li>Row ${e.row}: ${escHtml(e.error)}</li>`).join("")}
                ${d.errors.length > 20 ? `<li>… and ${d.errors.length - 20} more errors</li>` : ""}
                </ul>` : ""}
            </div>
        `;
        if (d.created > 0) showToast(`${d.created} rows imported`, "success");
        if (d.errors && d.errors.length) showToast(`${d.errors.length} rows failed`, "warning");
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
document.addEventListener("DOMContentLoaded", () => {
    initAdmin().catch(err => console.error("Admin init error:", err));
});
