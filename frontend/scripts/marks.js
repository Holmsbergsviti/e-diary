/* ================================================================
   marks.js – Teacher marks view: see, add, delete grades
   ================================================================ */

let allGroups = [];
let activeGroupIdx = 0;

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
    document.getElementById("addGradeBtn").addEventListener("click", openAddGradeModal);

    // Modal wiring
    document.getElementById("gradeModalClose").addEventListener("click", closeGradeModal);
    document.getElementById("gradeModalCancel").addEventListener("click", closeGradeModal);
    document.getElementById("gradeModalSave").addEventListener("click", saveGrade);
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
                    ? assessments.map(a => `<th>${escHtml(a)}</th>`).join("")
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
                        html += `<td class="grade-cell">
                            <span class="grade-badge ${gradeClass(g.grade_code)}">${escHtml(g.grade_code)}</span>${pct}
                            <button class="grade-delete-btn" data-grade-id="${g.id}" title="Delete grade">&times;</button>
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

    // Wire delete buttons
    container.querySelectorAll(".grade-delete-btn").forEach(btn => {
        btn.addEventListener("click", async (e) => {
            e.stopPropagation();
            const gradeId = btn.dataset.gradeId;
            if (!confirm("Delete this grade?")) return;
            btn.disabled = true;
            btn.textContent = "…";
            try {
                const res = await apiFetch(`/teacher/grades/delete/?id=${gradeId}`, { method: "DELETE" });
                if (res.ok) {
                    await loadMarks(); // Refresh
                } else {
                    const d = await res.json();
                    alert(d.message || "Failed to delete grade");
                }
            } catch (err) {
                alert("Error deleting grade");
            }
        });
    });
}

/* ---- Add Grade Modal ---- */
function openAddGradeModal() {
    const group = allGroups[activeGroupIdx];
    if (!group) return;

    const modal = document.getElementById("gradeModal");
    document.getElementById("gradeModalTitle").textContent = `Add Grade – ${group.subject} (Year ${group.year_group})`;

    // Populate student dropdown
    const sel = document.getElementById("gradeStudent");
    sel.innerHTML = group.students
        .sort((a, b) => a.surname.localeCompare(b.surname))
        .map(s => `<option value="${s.student_id}">${escHtml(s.surname)} ${escHtml(s.name)} (${escHtml(s.class_name)})</option>`)
        .join("");

    // Default date to today
    document.getElementById("gradeDate").value = new Date().toISOString().slice(0, 10);
    document.getElementById("gradeAssessment").value = "";
    document.getElementById("gradePercent").value = "";
    document.getElementById("gradeCode").value = "A";

    modal.style.display = "flex";
}

function closeGradeModal() {
    document.getElementById("gradeModal").style.display = "none";
}

async function saveGrade() {
    const group = allGroups[activeGroupIdx];
    if (!group) return;

    const studentId = document.getElementById("gradeStudent").value;
    const assessment = document.getElementById("gradeAssessment").value.trim();
    const gradeCode = document.getElementById("gradeCode").value;
    const percentage = document.getElementById("gradePercent").value;
    const date = document.getElementById("gradeDate").value;

    if (!studentId || !gradeCode) {
        alert("Please select a student and grade.");
        return;
    }

    const btn = document.getElementById("gradeModalSave");
    btn.disabled = true;
    btn.textContent = "Saving…";

    try {
        const body = {
            student_id: studentId,
            subject_id: group.subject_id,
            grade_code: gradeCode,
            assessment_name: assessment,
            date: date,
        };
        if (percentage !== "") body.percentage = parseFloat(percentage);

        const res = await apiFetch("/teacher/grades/add/", {
            method: "POST",
            body: JSON.stringify(body),
        });

        if (res.ok) {
            closeGradeModal();
            await loadMarks(); // Refresh
        } else {
            const d = await res.json();
            alert(d.message || "Failed to save grade");
        }
    } catch (err) {
        alert("Error saving grade");
    } finally {
        btn.disabled = false;
        btn.textContent = "Save Grade";
    }
}
