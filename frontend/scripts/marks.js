/* ================================================================
   marks.js – Teacher marks view: see, add, edit, delete grades
   ================================================================ */

let allGroups = [];
let activeGroupIdx = 0;
let editingGradeId = null;   // non-null when editing

document.addEventListener("DOMContentLoaded", async () => {
    if (!requireAuth()) return;
    const user = getUser();
    if (user && user.role !== "teacher") {
        window.location.href = "dashboard.html";
        return;
    }
    initNav();
    await loadMarks();

    // Add grade button
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
        const label = `Year ${g.year_group} – ${escHtml(g.subject)}`;
        const badge = g.is_own_class ? ' <small style="color:#16a34a;">(Class Teacher)</small>' : '';
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

function renderGroup(container, group) {
    if (!group || !group.students || group.students.length === 0) {
        container.innerHTML = '<p class="empty-state">No students found for this group.</p>';
        return;
    }

    // Find all unique assessments across students
    const assessmentSet = new Set();
    for (const s of group.students) {
        for (const g of s.grades) {
            assessmentSet.add(g.assessment);
        }
    }
    const assessments = Array.from(assessmentSet).sort();

    let html = `<table>
        <thead>
            <tr>
                <th>#</th>
                <th>Student</th>
                <th>Class</th>
                ${assessments.length > 0
                    ? assessments.map(a => `<th>${escHtml(a || 'Unnamed')}</th>`).join("")
                    : '<th>No grades yet</th>'}
            </tr>
        </thead>
        <tbody>`;

    group.students
        .sort((a, b) => a.surname.localeCompare(b.surname))
        .forEach((s, i) => {
            const gradeMap = {};
            for (const g of s.grades) {
                gradeMap[g.assessment] = g;
            }

            html += `<tr>
                <td>${i + 1}</td>
                <td>${escHtml(s.surname)} ${escHtml(s.name)}</td>
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

            html += `</tr>`;
        });

    html += `</tbody></table>`;
    container.innerHTML = html;

    // Wire clickable grade cells to open edit modal
    container.querySelectorAll(".grade-clickable").forEach(cell => {
        cell.addEventListener("click", () => {
            const gradeData = JSON.parse(cell.dataset.grade);
            const studentName = cell.dataset.studentName;
            openGradeModal(gradeData, studentName);
        });
    });
}

/* ---- Grade Modal (Add / Edit) ---- */
function openGradeModal(gradeData, studentName) {
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

        document.getElementById("gradeAssessment").value = "";
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
    const gradeCode = document.getElementById("gradeCode").value;
    const percentage = document.getElementById("gradePercent").value;
    const comment = document.getElementById("gradeComment").value.trim();

    if (!gradeCode) {
        alert("Please select a grade.");
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
