/* ================================================================
   marks.js – Teacher marks view: see grades of all students
   ================================================================ */

let allGroups = [];

document.addEventListener("DOMContentLoaded", async () => {
    if (!requireAuth()) return;
    const user = getUser();
    if (user && user.role !== "teacher") {
        window.location.href = "dashboard.html";
        return;
    }
    initNav();
    await loadMarks();
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
            return;
        }

        // Build tabs from unique groups
        renderTabs(tabsEl, container);
    } catch (err) {
        container.innerHTML = '<p class="empty-state">Failed to load marks.</p>';
    }
}

function renderTabs(tabsEl, container) {
    // Create a tab for each group (Year X – Subject)
    tabsEl.innerHTML = allGroups.map((g, i) => {
        const label = `Year ${g.year_group} – ${escHtml(g.subject)}`;
        const badge = g.is_own_class ? ' <small style="color:#16a34a;">(Class Teacher)</small>' : '';
        return `<button class="tab-btn${i === 0 ? ' active' : ''}" data-idx="${i}">${label}${badge}</button>`;
    }).join("");

    // Wire tab clicks
    tabsEl.querySelectorAll(".tab-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            tabsEl.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            renderGroup(container, allGroups[parseInt(btn.dataset.idx)]);
        });
    });

    // Show first tab
    renderGroup(container, allGroups[0]);
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
            // Build assessment -> grade lookup
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
                        html += `<td><span class="grade-badge ${gradeClass(g.grade_code)}">${escHtml(g.grade_code)}</span></td>`;
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
}
