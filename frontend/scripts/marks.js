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
    "A*": 9, "A": 8, "A-": 7, "B": 6, "C": 5, "D": 4, "E": 3, "U": 1,
};

// Numeric value → predicted grade
function numToGrade(val) {
    if (val >= 8.5) return "A*";
    if (val >= 7.5) return "A";
    if (val >= 6.5) return "A-";
    if (val >= 5.5) return "B";
    if (val >= 4.5) return "C";
    if (val >= 3.5) return "D";
    if (val >= 2.0) return "E";
    return "U";
}

// Auto-detect current term from month
function currentTerm() {
    const m = new Date().getMonth() + 1; // 1-12
    return (m >= 9 && m <= 12) ? 1 : 2;
}

document.addEventListener("DOMContentLoaded", async () => {
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
        const label = g.class_name
            ? `${escHtml(g.class_name)} – ${escHtml(g.subject)}`
            : `Year ${g.year_group} – ${escHtml(g.subject)}`;
        const badge = g.is_own_class ? ' <small style="color:#16a34a;">(CT)</small>' : '';
        return `<button class="tab-btn${i === activeGroupIdx ? ' active' : ''}" data-idx="${i}">${label}${badge}</button>`;
    }).join("");

    tabsEl.querySelectorAll(".tab-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            tabsEl.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            activeGroupIdx = parseInt(btn.dataset.idx);
            renderGroup(container, allGroups[activeGroupIdx]);
        });
    });

    renderGroup(container, allGroups[activeGroupIdx]);
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

    html += `<table>
        <thead>
            <tr>
                <th>#</th>
                <th>Student</th>
                <th>Class</th>
                ${assessments.length > 0
                    ? assessments.map(a => {
                        // Find category of first grade with this assessment
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
        .sort((a, b) => a.surname.localeCompare(b.surname))
        .forEach((s, i) => {
            const gradeMap = {};
            for (const g of s.grades) {
                gradeMap[g.assessment] = g;
            }

            // Predicted grade for current term filter
            const pred = predictGrade(s.grades);

            html += `<tr>
                <td>${i + 1}</td>
                <td class="student-name-clickable" data-student-id="${s.student_id}" data-student-name="${escHtml(s.surname)} ${escHtml(s.name)}">${escHtml(s.surname)} ${escHtml(s.name)}</td>
                <td><span class="class-tag">${escHtml(s.class_name)}</span></td>`;

            if (assessments.length > 0) {
                for (const a of assessments) {
                    const g = gradeMap[a];
                    if (g) {
                        const pct = g.percentage != null ? `<br><small class="grade-pct">${g.percentage}%</small>` : "";
                        const commentIcon = g.comment ? ' <span class="grade-comment-icon" title="' + escHtml(g.comment) + '">💬</span>' : "";
                        html += `<td class="grade-cell grade-clickable" data-grade='${JSON.stringify(g).replace(/'/g, "&#39;")}' data-student-name="${escHtml(s.surname)} ${escHtml(s.name)}">
                            <span class="grade-badge ${gradeClass(g.grade_code)}">${escHtml(g.grade_code)}</span>${pct}${commentIcon}
                        </td>`;
                    } else {
                        html += `<td>–</td>`;
                    }
                }
            } else {
                html += `<td>–</td>`;
            }

            // Predicted grade column
            if (pred) {
                html += `<td class="predicted-cell"><span class="grade-badge ${gradeClass(pred.grade)}">${pred.grade}</span><br><small class="grade-pct">${pred.value}</small></td>`;
            } else {
                html += `<td class="predicted-cell">–</td>`;
            }

            html += `</tr>`;
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

    // Wire clickable student names to open Add Grade with student pre-selected
    container.querySelectorAll(".student-name-clickable").forEach(cell => {
        cell.addEventListener("click", () => {
            openGradeModal(null, null, cell.dataset.studentId);
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
            .sort((a, b) => a.surname.localeCompare(b.surname))
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
        alert("Please select a grade.");
        return;
    }

    if (percentage !== "" && (parseFloat(percentage) < 0 || parseFloat(percentage) > 100)) {
        alert("Percentage must be between 0 and 100.");
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
                alert(d.message || "Failed to update grade");
            }
        } else {
            const studentId = document.getElementById("gradeStudent").value;
            if (!studentId) {
                alert("Please select a student.");
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
                alert(d.message || "Failed to save grade");
            }
        }
    } catch (err) {
        alert("Error saving grade");
    } finally {
        btn.disabled = false;
        btn.textContent = editingGradeId ? "Update Grade" : "Save Grade";
    }
}

async function deleteGradeFromModal() {
    const gradeId = document.getElementById("gradeModalDelete").dataset.gradeId;
    if (!gradeId) return;
    if (!confirm("Delete this grade? This cannot be undone.")) return;

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
            alert(d.message || "Failed to delete grade");
        }
    } catch (err) {
        alert("Error deleting grade");
    } finally {
        btn.disabled = false;
        btn.textContent = "Delete";
    }
}
