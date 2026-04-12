/* ================================================================
   marks.js – Teacher marks view: see, add, edit, delete grades
   with category weights, term filtering, and predicted grades
   ================================================================ */

let allGroups = [];
let activeGroupIdx = 0;
let editingGradeId = null;
let activeTerm = null; // null = both, 1 or 2

// Category weights (must sum to 1.0)
const CATEGORY_WEIGHTS = {
    exam:      0.25,
    test:      0.20,
    minitest:  0.15,
    quiz:      0.10,
    project:   0.15,
    homework:  0.05,
    classwork: 0.05,
    other:     0.05,
};

const CATEGORY_LABELS = {
    exam: "Exam", test: "Test", minitest: "Mini", quiz: "Quiz",
    project: "Project", homework: "HW", classwork: "CW", other: "Other",
};

// Grade → numeric value for weighted average
const GRADE_VALUES = {
    "A*": 9, "A": 8, "A-": 7,
    "B+": 6.5, "B": 6, "B-": 5.5,
    "C+": 5.5, "C": 5, "C-": 4.5,
    "D+": 4.5, "D": 4, "D-": 3.5,
    "E+": 3.5, "E": 3, "E-": 2.5,
    "U": 1,
};

// Numeric value → predicted grade
function numToGrade(val) {
    if (val >= 8.5) return "A*";
    if (val >= 7.5) return "A";
    if (val >= 6.5) return "A-";
    if (val >= 6.25) return "B+";
    if (val >= 5.75) return "B";
    if (val >= 5.25) return "B-";
    if (val >= 4.75) return "C+";
    if (val >= 4.5) return "C";
    if (val >= 4.25) return "C-";
    if (val >= 3.75) return "D+";
    if (val >= 3.5) return "D";
    if (val >= 3.25) return "D-";
    if (val >= 2.75) return "E+";
    if (val >= 2.25) return "E";
    if (val >= 1.75) return "E-";
    return "U";
}

// Auto-detect current term from month
function currentTerm() {
    const m = new Date().getMonth() + 1; // 1-12
    return (m >= 9 && m <= 12) ? 1 : 2;
}

async function initMarks() {
    if (!requireAuth()) return;
    const user = getUser();
    if (user && user.role !== "teacher") {
        window.location.href = "dashboard.html";
        return;
    }
    initNav();

    // Default to current term
    activeTerm = currentTerm();

    await loadMarks();

    document.getElementById("addGradeBtn").addEventListener("click", () => openGradeModal());

    // Modal wiring
    document.getElementById("gradeModalClose").addEventListener("click", closeGradeModal);
    document.getElementById("gradeModalCancel").addEventListener("click", closeGradeModal);
    document.getElementById("gradeModalSave").addEventListener("click", saveGrade);
    document.getElementById("gradeModalDelete").addEventListener("click", deleteGradeFromModal);
    document.getElementById("gradeModal").addEventListener("click", (e) => {
        if (e.target === document.getElementById("gradeModal")) closeGradeModal();
    });
}

// Initialize on DOMContentLoaded
document.addEventListener("DOMContentLoaded", () => {
    initMarks().catch(err => console.error("Marks init error:", err));
});

async function loadMarks() {
    const container = document.getElementById("marksContainer");
    const tabsEl = document.getElementById("tabsContainer");
    try {
        const res = await apiFetch("/teacher/marks/");
        const data = await res.json();
        allGroups = data.groups || [];

        if (allGroups.length === 0) {
            container.innerHTML = '<p class="empty-state">No marks to display.</p>';
            document.getElementById("addGradeBtn").style.display = "none";
            tabsEl.innerHTML = "";
            return;
        }

        if (activeGroupIdx >= allGroups.length) activeGroupIdx = 0;

        renderTabs(tabsEl, container);
        document.getElementById("addGradeBtn").style.display = "inline-block";
    } catch (err) {
        container.innerHTML = '<p class="empty-state">Failed to load marks.</p>';
    }
}

function renderTabs(tabsEl, container) {
    tabsEl.innerHTML = allGroups.map((g, i) => {
        let label;
        if (g.type === "class_overview") {
            label = `My Class (${escHtml(g.class_name)})`;
        } else {
            label = g.class_name
                ? `${escHtml(g.class_name)} – ${escHtml(g.subject)}`
                : `Year ${g.year_group} – ${escHtml(g.subject)}`;
        }
        const badge = g.type === "class_overview" ? ' <small style="color:#16a34a;">👥</small>' : '';
        return `<button class="tab-btn${i === activeGroupIdx ? ' active' : ''}" data-idx="${i}" data-tab-type="group">${label}${badge}</button>`;
    }).join("");

    tabsEl.querySelectorAll(".tab-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            tabsEl.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            activeGroupIdx = parseInt(btn.dataset.idx);
            renderActiveGroup(container);
        });
    });

    renderActiveGroup(container);
}

function renderActiveGroup(container) {
    const group = allGroups[activeGroupIdx];
    if (!group) return;
    if (group.type === "class_overview") {
        renderClassOverview(container, group);
        document.getElementById("addGradeBtn").style.display = "none";
        _showExportBtns(false);
    } else {
        renderGroup(container, group);
        document.getElementById("addGradeBtn").style.display = "inline-block";
        _showExportBtns(true);
    }
}

/* ---- Helper: build collapsible homework detail list ---- */
function buildHwDetailHtml(hwDetail) {
    if (!hwDetail || hwDetail.length === 0) return '';
    const STATUS_ICON = { completed: '✅', partial: '🔶', not_done: '❌' };
    const STATUS_LABEL = { completed: 'Done', partial: 'Partial', not_done: 'Missing' };
    const rows = hwDetail.map(h => {
        const icon = STATUS_ICON[h.status] || '❌';
        const label = STATUS_LABEL[h.status] || 'Missing';
        const due = h.due_date || '–';
        const subj = h.subject ? `<span class="hw-detail-subj">${escHtml(h.subject)}</span>` : '';
        return `<div class="hw-detail-row hw-detail-${h.status}">
            <span class="hw-detail-icon">${icon}</span>
            <span class="hw-detail-title">${escHtml(h.title)}${subj}</span>
            <span class="hw-detail-due">${due}</span>
            <span class="hw-detail-status">${label}</span>
        </div>`;
    }).join('');
    return `<details class="hw-detail-toggle"><summary class="hw-detail-summary">View details (${hwDetail.length})</summary><div class="hw-detail-list">${rows}</div></details>`;
}

/* ---- Shared helper: build stats HTML for one student ---- */
function buildStatsHtml(stats) {
    const st = stats || {};
    if (!st.attendance && !st.grades && !st.homework && !st.behavioral) return '';

    const att = st.attendance || {};
    const attTotal = att.total || 0;
    const present = att.Present || 0;
    const late = att.Late || 0;
    const absent = att.Absent || 0;
    const excused = att.Excused || 0;

    const gr = st.grades || {};
    const hw = st.homework || {};
    const hwTotal = (hw.completed || 0) + (hw.partial || 0) + (hw.not_done || 0);
    const beh = st.behavioral || {};
    const behTotal = (beh.positive || 0) + (beh.negative || 0) + (beh.note || 0);

    return `<div class="student-stats-grid">
        <div class="student-stat-card">
            <div class="student-stat-label">📋 Attendance</div>
            ${attTotal > 0 ? `
            <div class="student-stat-bar">
                <div class="stat-bar-seg stat-bar-present" style="width:${(present/attTotal*100).toFixed(1)}%" title="Present: ${present}"></div>
                <div class="stat-bar-seg stat-bar-late" style="width:${(late/attTotal*100).toFixed(1)}%" title="Late: ${late}"></div>
                <div class="stat-bar-seg stat-bar-absent" style="width:${(absent/attTotal*100).toFixed(1)}%" title="Absent: ${absent}"></div>
                <div class="stat-bar-seg stat-bar-excused" style="width:${(excused/attTotal*100).toFixed(1)}%" title="Excused: ${excused}"></div>
            </div>
            <div class="student-stat-nums">
                <span class="stat-present">${present} present</span>
                <span class="stat-late">${late} late</span>
                <span class="stat-absent">${absent} absent</span>
                <span class="stat-excused">${excused} excused</span>
            </div>` : `<div class="student-stat-empty">No records</div>`}
        </div>
        <div class="student-stat-card">
            <div class="student-stat-label">📊 Grades</div>
            ${gr.count > 0 ? `
            ${gr.average != null ? `<div class="student-stat-big">${gr.average}%</div>` : ''}
            <div class="student-stat-sub">${gr.count} grade${gr.count !== 1 ? 's' : ''} total</div>` : `<div class="student-stat-empty">No grades</div>`}
        </div>
        <div class="student-stat-card">
            <div class="student-stat-label">📝 Homework</div>
            ${hwTotal > 0 ? `
            <div class="student-stat-hw">
                <span class="stat-hw-pill stat-hw-done">${hw.completed || 0} done</span>
                <span class="stat-hw-pill stat-hw-partial">${hw.partial || 0} partial</span>
                <span class="stat-hw-pill stat-hw-not">${hw.not_done || 0} missing</span>
            </div>
            ${buildHwDetailHtml(st.homework_detail)}` : `<div class="student-stat-empty">No records</div>`}
        </div>
        <div class="student-stat-card">
            <div class="student-stat-label">⭐ Behavioral</div>
            ${behTotal > 0 ? `
            <div class="student-stat-hw">
                <span class="stat-hw-pill" style="background:#d1fae5;color:#065f46;">👍 ${beh.positive || 0}</span>
                <span class="stat-hw-pill" style="background:#fee2e2;color:#991b1b;">👎 ${beh.negative || 0}</span>
                <span class="stat-hw-pill" style="background:#e0e7ff;color:#3730a3;">📝 ${beh.note || 0}</span>
            </div>` : `<div class="student-stat-empty">No entries</div>`}
        </div>
    </div>`;
}

/* ---- Class Overview: student list with expandable all-subject grades ---- */
function renderClassOverview(container, group) {
    if (!group || !group.students || group.students.length === 0) {
        container.innerHTML = '<p class="empty-state">No students in this class.</p>';
        return;
    }

    // Term filter bar
    let html = `<div class="term-filter">
        <button class="term-btn${activeTerm === null ? ' active' : ''}" data-term="">Both Terms</button>
        <button class="term-btn${activeTerm === 1 ? ' active' : ''}" data-term="1">Term 1 <small>(Sep–Dec)</small></button>
        <button class="term-btn${activeTerm === 2 ? ' active' : ''}" data-term="2">Term 2 <small>(Jan–Jun)</small></button>
    </div>`;

    html += `<div class="class-overview-list">`;

    const sortedStudents = [...group.students].sort((a, b) => {
        const s1 = `${a.surname || ''} ${a.name || ''}`.toLowerCase();
        const s2 = `${b.surname || ''} ${b.name || ''}`.toLowerCase();
        return s1.localeCompare(s2);
    });

    sortedStudents.forEach((student, idx) => {
        let totalGrades = 0;
        let subjectCount = student.subjects ? student.subjects.length : 0;
        if (student.subjects) {
            for (const subj of student.subjects) {
                const filtered = activeTerm ? subj.grades.filter(g => g.term === activeTerm) : subj.grades;
                totalGrades += filtered.length;
            }
        }

        const st = student.stats || {};
        const att = st.attendance || {};
        const attRate = att.total > 0 ? Math.round(((att.Present || 0) + (att.Late || 0)) / att.total * 100) : null;

        const allCommentCount = student.stats?.comments?.all_count || student.stats?.comments?.count || 0;
        const hasNew = hasNewCommentForStudent(student.student_id, allCommentCount);
        const absentToday = student.stats?.absent_today || false;
        const conflictToday = student.stats?.attendance_conflict_today || false;

        const absentMark = absentToday ? ' <span class="absent-today-mark" title="Absent today">*</span>' : '';
        const conflictMark = conflictToday ? ' <span class="conflict-mark" title="Absent in one class but present in another today">⚠️</span>' : '';

        html += `<div class="overview-student${absentToday ? ' student-absent-today' : ''}" data-idx="${idx}">
            <div class="overview-student-header">
                <span class="overview-num">${idx + 1}</span>
                ${studentAvatarHtml(student)}
                <span class="overview-name">${escHtml(student.surname)} ${escHtml(student.name)}${absentMark}${conflictMark}${allCommentCount > 0 ? ` <span title="${allCommentCount} comments">💬</span>` : ''}${hasNew ? ' <span class="new-comment-dot" title="New comments">●</span>' : ''}</span>
                <span class="overview-meta">${subjectCount} subj · ${totalGrades} grades${attRate !== null ? ` · ${attRate}% att.` : ''}</span>
                <button class="btn btn-secondary btn-sm view-comments-btn" data-student-id="${student.student_id}" data-student-name="${escHtml(student.surname)} ${escHtml(student.name)}" style="margin-left:8px;">View Comments (${allCommentCount})</button>
                <span class="overview-expand">▸</span>
            </div>
            <div class="overview-student-detail" style="display:none;">`;

        // --- Per-student stat cards ---
        if (st.attendance || st.grades || st.homework || st.behavioral) {
            html += buildStatsHtml(st);
        }

        if (student.subjects && student.subjects.length > 0) {
            html += `<div class="student-grades-section-label">Subject Grades</div>`;
            for (const subj of student.subjects) {
                const filteredGrades = activeTerm
                    ? subj.grades.filter(g => g.term === activeTerm)
                    : subj.grades;
                const pred = predictGrade(filteredGrades);

                html += `<div class="overview-subject">
                    <div class="overview-subject-header">
                        <span class="subject-color-dot" style="background:${subj.subject_color}"></span>
                        <strong>${escHtml(subj.subject)}</strong>
                        <small style="margin-left:8px;color:#64748b;">T1: ${subj.stats?.attendance_by_term?.term_1?.attendance_pct ?? '–'}% · T2: ${subj.stats?.attendance_by_term?.term_2?.attendance_pct ?? '–'}%</small>
                        ${(subj.stats?.attendance_by_term?.term_1?.absent || 0) > 0 || (subj.stats?.attendance_by_term?.term_2?.absent || 0) > 0 ? '<small title="Has absences" style="margin-left:6px;color:#dc2626;">*</small>' : ''}
                        ${pred ? `<span class="grade-badge ${gradeClass(pred.grade)}" style="margin-left:auto;">${pred.grade} <small>(${pred.value})</small></span>` : '<span style="margin-left:auto;color:#94a3b8;font-size:0.85rem;">No grades</span>'}
                    </div>`;

                if (filteredGrades.length > 0) {
                    html += `<div class="overview-grades">`;
                    for (const g of filteredGrades) {
                        const catLabel = CATEGORY_LABELS[g.category] || g.category;
                        const pctStr = g.percentage != null ? ` <span class="grade-pct">${g.percentage}%</span>` : '';
                        html += `<div class="overview-grade-item">
                            <span class="grade-badge ${gradeClass(g.grade_code)}">${escHtml(g.grade_code)}</span>
                            <span class="overview-grade-info">${escHtml(g.assessment || 'Unnamed')} <small class="cat-label cat-${g.category}">${catLabel}</small></span>
                            ${pctStr}
                        </div>`;
                    }
                    html += `</div>`;
                }

                html += `</div>`;
            }
        } else {
            html += `<p class="empty-state" style="padding:8px;">No subjects enrolled.</p>`;
        }

        html += `</div></div>`;
    });

    html += `</div>`;
    container.innerHTML = html;

    // Wire term filter buttons
    container.querySelectorAll(".term-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const t = btn.dataset.term;
            activeTerm = t === "" ? null : parseInt(t);
            renderClassOverview(container, allGroups[activeGroupIdx]);
        });
    });

    // Wire expand/collapse
    container.querySelectorAll(".overview-student-header").forEach(header => {
        header.addEventListener("click", () => {
            const parent = header.closest(".overview-student");
            const detail = parent.querySelector(".overview-student-detail");
            const expand = parent.querySelector(".overview-expand");
            if (detail.style.display === "none") {
                detail.style.display = "block";
                expand.textContent = "▾";
                parent.classList.add("expanded");
            } else {
                detail.style.display = "none";
                expand.textContent = "▸";
                parent.classList.remove("expanded");
            }
        });
    });

    container.querySelectorAll(".view-comments-btn").forEach(btn => {
        btn.addEventListener("click", async (e) => {
            e.stopPropagation();
            await openCommentsModal(btn.dataset.studentId, btn.dataset.studentName);
        });
    });
}

function gradeClass(code) {
    if (!code) return "";
    const c = code.toUpperCase().replace("*", "").replace("-", "").replace("+", "");
    if (c === "A") return "grade-a";
    if (c === "B") return "grade-b";
    if (c === "C") return "grade-c";
    if (c === "D") return "grade-d";
    if (c === "E") return "grade-e";
    return "grade-u";
}

/* Calculate weighted predicted grade from a list of grade objects */
function predictGrade(grades) {
    if (!grades || grades.length === 0) return null;

    // Group by category
    const byCat = {};
    for (const g of grades) {
        const cat = g.category || "other";
        if (!byCat[cat]) byCat[cat] = [];
        const val = GRADE_VALUES[g.grade_code];
        if (val != null) byCat[cat].push(val);
    }

    let weightedSum = 0;
    let totalWeight = 0;

    for (const [cat, vals] of Object.entries(byCat)) {
        if (vals.length === 0) continue;
        const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
        const w = CATEGORY_WEIGHTS[cat] || CATEGORY_WEIGHTS.other;
        weightedSum += avg * w;
        totalWeight += w;
    }

    if (totalWeight === 0) return null;

    const predicted = weightedSum / totalWeight;
    return { grade: numToGrade(predicted), value: predicted.toFixed(1) };
}

function renderGroup(container, group) {
    if (!group || !group.students || group.students.length === 0) {
        container.innerHTML = '<p class="empty-state">No students found for this group.</p>';
        return;
    }

    // Term filter bar
    let html = `<div class="term-filter">
        <button class="term-btn${activeTerm === null ? ' active' : ''}" data-term="">Both Terms</button>
        <button class="term-btn${activeTerm === 1 ? ' active' : ''}" data-term="1">Term 1 <small>(Sep–Dec)</small></button>
        <button class="term-btn${activeTerm === 2 ? ' active' : ''}" data-term="2">Term 2 <small>(Jan–Jun)</small></button>
    </div>`;

    // Filter grades by term
    const filteredStudents = group.students.map(s => ({
        ...s,
        grades: activeTerm ? s.grades.filter(g => g.term === activeTerm) : s.grades,
        allGrades: s.grades,
    }));

    // Find unique assessments from filtered grades
    const assessmentSet = new Set();
    for (const s of filteredStudents) {
        for (const g of s.grades) {
            assessmentSet.add(g.assessment);
        }
    }
    const assessments = Array.from(assessmentSet).sort();

    const colCount = 5 + (assessments.length > 0 ? assessments.length : 1) + 1; // #, Student, Class, Att%, Comments, assessments, Predicted

    html += `<table>
        <thead>
            <tr>
                <th>#</th>
                <th>Student</th>
                <th>Class</th>
                <th>Att %</th>
                <th>Comments</th>
                ${assessments.length > 0
                    ? assessments.map(a => {
                        let cat = "";
                        for (const s of filteredStudents) {
                            const g = s.grades.find(g => g.assessment === a);
                            if (g) { cat = g.category || ""; break; }
                        }
                        const catLabel = cat ? `<br><small class="cat-label cat-${cat}">${CATEGORY_LABELS[cat] || cat}</small>` : "";
                        return `<th>${escHtml(a || 'Unnamed')}${catLabel}</th>`;
                    }).join("")
                    : '<th>No grades yet</th>'}
                <th>Predicted</th>
            </tr>
        </thead>
        <tbody>`;

    filteredStudents
        .sort((a, b) => {
            const sa = `${a.surname || ''} ${a.name || ''}`.toLowerCase();
            const sb = `${b.surname || ''} ${b.name || ''}`.toLowerCase();
            return sa.localeCompare(sb);
        })
        .forEach((s, i) => {
            // Predicted grade for current term filter
            const pred = predictGrade(s.grades);

            const commentCount = s.stats?.comments?.count || 0;
            const allCommentCount = s.stats?.comments?.all_count || 0;
            const hasNew = hasNewCommentForStudent(s.student_id, allCommentCount);
            const absentToday = s.stats?.absent_today || false;
            const conflictToday = s.stats?.attendance_conflict_today || false;

            // Attendance % for active term
            const attByTerm = s.stats?.attendance_by_term || {};
            let attPct = null;
            if (activeTerm === 1) attPct = attByTerm.term_1?.attendance_pct;
            else if (activeTerm === 2) attPct = attByTerm.term_2?.attendance_pct;
            else {
                // Both terms: overall
                const att = s.stats?.attendance || {};
                const attTotal = att.total || 0;
                attPct = attTotal > 0 ? Math.round(((att.Present || 0) + (att.Late || 0)) / attTotal * 100) : null;
            }

            // Absent indicator
            const absentMark = absentToday ? ' <span class="absent-today-mark" title="Absent today">*</span>' : '';
            const conflictMark = conflictToday ? ' <span class="conflict-mark" title="Absent in one class but present in another today">⚠️</span>' : '';

            html += `<tr class="student-main-row${absentToday ? ' student-absent-today' : ''}" data-stats-target="stats-row-${i}">
                <td>${i + 1}</td>
                <td>
                    ${studentAvatarHtml(s)}
                    <span class="student-name-toggle" data-student-id="${s.student_id}" data-student-name="${escHtml(s.surname)} ${escHtml(s.name)}">${escHtml(s.surname)} ${escHtml(s.name)}${absentMark}${conflictMark}${hasNew ? ' <span class="new-comment-dot" title="New comments">●</span>' : ''}</span>
                    <button class="add-grade-inline-btn" data-student-id="${s.student_id}" title="Add grade">＋</button>
                </td>
                <td><span class="class-tag">${escHtml(s.class_name)}</span></td>
                <td class="att-pct-cell${attPct !== null && attPct < 80 ? ' att-low' : ''}">${attPct !== null ? attPct + '%' : '–'}<br><small class="att-terms" title="T1 / T2">${attByTerm.term_1?.attendance_pct ?? '–'}/${attByTerm.term_2?.attendance_pct ?? '–'}</small></td>
                <td><button class="btn btn-secondary btn-sm view-comments-btn" data-student-id="${s.student_id}" data-subject-id="${group.subject_id}" data-student-name="${escHtml(s.surname)} ${escHtml(s.name)}">Subject (${commentCount})</button></td>`;

            // Grades column with assessment names and grades together
            if (s.grades.length > 0) {
                const gradesHtml = s.grades.map(g => {
                    const pct = g.percentage != null ? ` ${g.percentage}%` : "";
                    const commentIcon = g.comment ? ' 💬' : "";
                    return `<div class="grade-item-compact grade-clickable" data-grade='${JSON.stringify(g).replace(/'/g, "&#39;")}' data-student-name="${escHtml(s.surname)} ${escHtml(s.name)}" style="cursor:pointer;margin:2px 0;padding:2px 4px;border-radius:3px;background:var(--bg-input);font-size:0.9rem;">
                        <strong>${escHtml(g.assessment || 'Unnamed')}:</strong>
                        <span class="grade-badge ${gradeClass(g.grade_code)}" style="margin-left:4px;">${escHtml(g.grade_code)}</span>${pct}${commentIcon}
                    </div>`;
                }).join("");
                html += `<td class="grades-column" style="padding:4px;">${gradesHtml}</td>`;
            } else {
                html += `<td class="grades-column">–</td>`;
            }

            // Predicted grade column
            if (pred) {
                html += `<td class="predicted-cell"><span class="grade-badge ${gradeClass(pred.grade)}">${pred.grade}</span><br><small class="grade-pct">${pred.value}</small></td>`;
            } else {
                html += `<td class="predicted-cell">–</td>`;
            }

            html += `</tr>`;

            const statsHtml = buildStatsHtml(s.stats);
            if (statsHtml) {
                html += `<tr class="student-stats-row" id="stats-row-${i}" style="display:none;">
                    <td colspan="${colCount}" class="stats-expansion-cell">${statsHtml}</td>
                </tr>`;
            }
        });

    html += `</tbody></table>`;
    container.innerHTML = html;

    // Wire term filter buttons
    container.querySelectorAll(".term-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const t = btn.dataset.term;
            activeTerm = t === "" ? null : parseInt(t);
            renderGroup(container, allGroups[activeGroupIdx]);
        });
    });

    // Wire clickable grade cells
    container.querySelectorAll(".grade-clickable").forEach(cell => {
        cell.addEventListener("click", () => {
            const gradeData = JSON.parse(cell.dataset.grade);
            const studentName = cell.dataset.studentName;
            openGradeModal(gradeData, studentName);
        });
    });

    // Wire student name toggles to expand/collapse stats row
    container.querySelectorAll(".student-name-toggle").forEach(el => {
        el.addEventListener("click", () => {
            const mainRow = el.closest(".student-main-row");
            const targetId = mainRow.dataset.statsTarget;
            const statsRow = document.getElementById(targetId);
            if (!statsRow) return;
            const isVisible = statsRow.style.display !== "none";
            statsRow.style.display = isVisible ? "none" : "table-row";
            mainRow.classList.toggle("stats-expanded", !isVisible);
        });
    });

    // Wire inline add-grade buttons
    container.querySelectorAll(".add-grade-inline-btn").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            openGradeModal(null, null, btn.dataset.studentId);
        });
    });

    container.querySelectorAll(".view-comments-btn").forEach(btn => {
        btn.addEventListener("click", async (e) => {
            e.stopPropagation();
            await openCommentsModal(btn.dataset.studentId, btn.dataset.studentName, btn.dataset.subjectId);
        });
    });
}

/* ---- Grade Modal (Add / Edit) ---- */
function openGradeModal(gradeData, studentName, preSelectedStudentId) {
    const group = allGroups[activeGroupIdx];
    if (!group) return;

    const isEdit = !!gradeData;
    editingGradeId = isEdit ? gradeData.id : null;

    const modal = document.getElementById("gradeModal");
    const title = document.getElementById("gradeModalTitle");
    const studentGroup = document.getElementById("gradeStudentGroup");
    const saveBtn = document.getElementById("gradeModalSave");
    const deleteBtn = document.getElementById("gradeModalDelete");

    if (isEdit) {
        title.textContent = `Edit Grade – ${studentName || 'Student'}`;
        studentGroup.style.display = "none";
        saveBtn.textContent = "Update Grade";
        deleteBtn.style.display = "inline-block";
        deleteBtn.dataset.gradeId = gradeData.id;

        document.getElementById("gradeAssessment").value = gradeData.assessment || "";
        document.getElementById("gradeCategory").value = gradeData.category || "other";
        document.getElementById("gradeTerm").value = gradeData.term || currentTerm();
        document.getElementById("gradeCode").value = gradeData.grade_code || "A";
        document.getElementById("gradePercent").value = gradeData.percentage != null ? gradeData.percentage : "";
        document.getElementById("gradeComment").value = gradeData.comment || "";
    } else {
        title.textContent = `Add Grade – ${group.subject} (Year ${group.year_group})`;
        studentGroup.style.display = "";
        saveBtn.textContent = "Save Grade";
        deleteBtn.style.display = "none";

        const sel = document.getElementById("gradeStudent");
        sel.innerHTML = group.students
            .sort((a, b) => a.surname.localeCompare(b.surname) || a.name.localeCompare(b.name))
            .map(s => `<option value="${s.student_id}">${escHtml(s.surname)} ${escHtml(s.name)} (${escHtml(s.class_name)})</option>`)
            .join("");

        // Pre-select student if provided
        if (preSelectedStudentId) {
            sel.value = preSelectedStudentId;
        }

        document.getElementById("gradeAssessment").value = "";
        document.getElementById("gradeCategory").value = "test";
        document.getElementById("gradeTerm").value = currentTerm();
        document.getElementById("gradeCode").value = "A";
        document.getElementById("gradePercent").value = "";
        document.getElementById("gradeComment").value = "";
    }

    modal.style.display = "flex";
}

function closeGradeModal() {
    document.getElementById("gradeModal").style.display = "none";
    editingGradeId = null;
}

async function saveGrade() {
    const group = allGroups[activeGroupIdx];
    if (!group) return;

    const assessment = document.getElementById("gradeAssessment").value.trim();
    const category = document.getElementById("gradeCategory").value;
    const term = parseInt(document.getElementById("gradeTerm").value);
    const gradeCode = document.getElementById("gradeCode").value;
    const percentage = document.getElementById("gradePercent").value;
    const comment = document.getElementById("gradeComment").value.trim();

    if (!gradeCode) {
        showToast("Please select a grade", "warning");
        return;
    }

    if (percentage !== "" && parseFloat(percentage) < 0) {
        showToast("Percentage cannot be negative", "warning");
        return;
    }

    const btn = document.getElementById("gradeModalSave");
    btn.disabled = true;
    btn.textContent = editingGradeId ? "Updating…" : "Saving…";

    try {
        if (editingGradeId) {
            const body = {
                id: editingGradeId,
                assessment_name: assessment,
                grade_code: gradeCode,
                comment: comment,
                category: category,
                term: term,
            };
            if (percentage !== "") {
                body.percentage = parseFloat(percentage);
            } else {
                body.percentage = null;
            }

            const res = await apiFetch("/teacher/grades/edit/", {
                method: "PATCH",
                body: JSON.stringify(body),
            });

            if (res.ok) {
                closeGradeModal();
                await loadMarks();
            } else {
                const d = await res.json();
                showToast(d.message || "Failed to update grade", "error");
            }
        } else {
            const studentId = document.getElementById("gradeStudent").value;
            if (!studentId) {
                showToast("Please select a student", "warning");
                btn.disabled = false;
                btn.textContent = "Save Grade";
                return;
            }

            const body = {
                student_id: studentId,
                subject_id: group.subject_id,
                grade_code: gradeCode,
                assessment_name: assessment,
                comment: comment,
                category: category,
                term: term,
            };
            if (percentage !== "") body.percentage = parseFloat(percentage);

            const res = await apiFetch("/teacher/grades/add/", {
                method: "POST",
                body: JSON.stringify(body),
            });

            if (res.ok) {
                closeGradeModal();
                await loadMarks();
            } else {
                const d = await res.json();
                showToast(d.message || "Failed to save grade", "error");
            }
        }
    } catch (err) {
        showToast("Error saving grade", "error");
    } finally {
        btn.disabled = false;
        btn.textContent = editingGradeId ? "Update Grade" : "Save Grade";
    }
}

async function deleteGradeFromModal() {
    const gradeId = document.getElementById("gradeModalDelete").dataset.gradeId;
    if (!gradeId) return;
    const ok = await showConfirm("Delete this grade? This cannot be undone.", { title: "Delete Grade", confirmText: "Delete" });
    if (!ok) return;

    const btn = document.getElementById("gradeModalDelete");
    btn.disabled = true;
    btn.textContent = "Deleting…";

    try {
        const res = await apiFetch(`/teacher/grades/delete/?id=${gradeId}`, { method: "DELETE" });
        if (res.ok) {
            closeGradeModal();
            await loadMarks();
        } else {
            const d = await res.json();
            showToast(d.message || "Failed to delete grade", "error");
        }
    } catch (err) {
        showToast("Error deleting grade", "error");
    } finally {
        btn.disabled = false;
        btn.textContent = "Delete";
    }
}

function hasNewCommentForStudent(studentId, currentCount) {
    const seen = JSON.parse(localStorage.getItem("seenCommentCounts") || "{}");
    const prev = seen[studentId] || 0;
    return currentCount > prev;
}

function markCommentsSeen(studentId, currentCount) {
    const seen = JSON.parse(localStorage.getItem("seenCommentCounts") || "{}");
    seen[studentId] = Math.max(seen[studentId] || 0, currentCount || 0);
    localStorage.setItem("seenCommentCounts", JSON.stringify(seen));
}

function ensureCommentsModal() {
    if (document.getElementById("commentsModal")) return;
    const wrap = document.createElement("div");
    wrap.innerHTML = `
        <div id="commentsModal" class="modal-overlay" style="display:none;">
            <div class="modal" style="max-width:760px;">
                <div class="modal-header">
                    <h2 id="commentsModalTitle">Student Comments</h2>
                    <button id="commentsModalClose" class="modal-close-btn">&times;</button>
                </div>
                <div class="modal-body">
                    <div id="commentsModalBody"><p class="loading">Loading comments…</p></div>
                </div>
            </div>
        </div>`;
    document.body.appendChild(wrap.firstElementChild);
    document.getElementById("commentsModalClose").addEventListener("click", () => {
        document.getElementById("commentsModal").style.display = "none";
    });
    document.getElementById("commentsModal").addEventListener("click", (e) => {
        if (e.target.id === "commentsModal") document.getElementById("commentsModal").style.display = "none";
    });
}

async function openCommentsModal(studentId, studentName, subjectId) {
    ensureCommentsModal();
    const modal = document.getElementById("commentsModal");
    const body = document.getElementById("commentsModalBody");
    const titleSuffix = subjectId ? " (Subject)" : " (All Subjects)";
    document.getElementById("commentsModalTitle").textContent = `Comments – ${studentName || "Student"}${titleSuffix}`;
    modal.style.display = "flex";
    body.innerHTML = '<p class="loading">Loading comments…</p>';

    try {
        const res = await apiFetch(`/teacher/student-comments/?student_id=${encodeURIComponent(studentId)}${subjectId ? `&subject_id=${encodeURIComponent(subjectId)}` : ''}`);
        const data = await res.json();
        const comments = data.comments || [];
        if (comments.length === 0) {
            body.innerHTML = '<p class="empty-state">No comments found.</p>';
            markCommentsSeen(studentId, 0);
            return;
        }

        body.innerHTML = `<table>
            <thead><tr><th>Date</th><th>Period</th><th>Group</th><th>Subject</th><th>Teacher</th><th>Comment</th></tr></thead>
            <tbody>
                ${comments.map(c => `<tr>
                    <td>${escHtml(c.date || '')}</td>
                    <td>${c.period != null ? escHtml(String(c.period)) : '–'}</td>
                    <td>${escHtml(c.group || '')}</td>
                    <td>${escHtml(c.subject || '')}</td>
                    <td>${escHtml(c.teacher || '')}</td>
                    <td>${escHtml(c.comment || '')}</td>
                </tr>`).join('')}
            </tbody>
        </table>`;
        markCommentsSeen(studentId, comments.length);
    } catch (err) {
        body.innerHTML = '<p class="empty-state">Failed to load comments.</p>';
    }
}

/* ═══════════════ EXPORT ═══════════════ */
function _showExportBtns(show) {
    const csv = document.getElementById("exportGradesBtn");
    const xlsx = document.getElementById("exportGradesXlsxBtn");
    if (csv) csv.style.display = show ? "inline-block" : "none";
    if (xlsx) xlsx.style.display = show ? "inline-block" : "none";
}

function _buildExportRows(group) {
    if (!group || !group.students) return [];
    const rows = [];
    for (const stu of group.students) {
        const grades = stu.grades || [];
        if (grades.length === 0) {
            rows.push({
                student: `${stu.surname} ${stu.name}`,
                class_name: stu.class_name || group.class_name || "",
                subject: group.subject || "",
                assessment: "", category: "", grade: "", percentage: "", date: "", term: "", comment: ""
            });
        }
        for (const g of grades) {
            rows.push({
                student: `${stu.surname} ${stu.name}`,
                class_name: stu.class_name || group.class_name || "",
                subject: group.subject || "",
                assessment: g.assessment_name || "",
                category: g.category || "",
                grade: g.grade_code || "",
                percentage: g.percentage != null ? g.percentage : "",
                date: g.date_taken || "",
                term: g.term || "",
                comment: g.comment || ""
            });
        }
    }
    return rows;
}

const _gradeExportCols = ["student","class_name","subject","assessment","category","grade","percentage","date","term","comment"];
const _gradeExportHeaders = {
    student: "Student", class_name: "Class", subject: "Subject",
    assessment: "Assessment", category: "Category", grade: "Grade",
    percentage: "%", date: "Date", term: "Term", comment: "Comment"
};

function exportCurrentGroupCSV() {
    const group = allGroups[activeGroupIdx];
    if (!group) return;
    const rows = _buildExportRows(group);
    const fname = `Grades_${(group.class_name || "Year" + group.year_group)}_${group.subject || "Overview"}`.replace(/\s+/g, "_");
    exportCSV(fname + ".csv", rows, _gradeExportCols, _gradeExportHeaders);
}

function exportCurrentGroupExcel() {
    const group = allGroups[activeGroupIdx];
    if (!group) return;
    const rows = _buildExportRows(group);
    const fname = `Grades_${(group.class_name || "Year" + group.year_group)}_${group.subject || "Overview"}`.replace(/\s+/g, "_");
    exportExcel(fname + ".xlsx", rows, _gradeExportCols, _gradeExportHeaders, group.subject || "Grades");
}

function exportAllGroupsExcel() {
    const sheets = allGroups.filter(g => g.type !== "class_overview").map(g => ({
        name: `${g.class_name || "Y" + g.year_group} ${g.subject || ""}`.substring(0, 31),
        rows: _buildExportRows(g),
        columns: _gradeExportCols,
        headerMap: _gradeExportHeaders
    }));
    exportExcelMultiSheet("All_Grades.xlsx", sheets);
}
