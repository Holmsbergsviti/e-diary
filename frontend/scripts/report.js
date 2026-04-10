let activeReportTerm = 1;

async function initReports() {
    if (!requireAuth()) return;
    const user = getUser();
    if (user && user.role !== "teacher") {
        window.location.href = "dashboard.html";
        return;
    }

    initNav();
    bindReportTabs();
    await loadReports(activeReportTerm);
}

function bindReportTabs() {
    document.querySelectorAll("#reportTermTabs .term-btn").forEach(btn => {
        btn.addEventListener("click", async () => {
            document.querySelectorAll("#reportTermTabs .term-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            activeReportTerm = parseInt(btn.dataset.term);
            await loadReports(activeReportTerm);
        });
    });
}

function groupReportsByClassAndSubject(reports) {
    const grouped = {};
    
    reports.forEach(r => {
        const className = r.class_name || "Unknown";
        if (!grouped[className]) {
            grouped[className] = {};
        }
        
        const subject = r.subject || "Unknown";
        if (!grouped[className][subject]) {
            grouped[className][subject] = [];
        }
        
        grouped[className][subject].push(r);
    });
    
    return grouped;
}

async function loadReports(term) {
    const container = document.getElementById("reportContainer");
    container.innerHTML = '<p class="loading">Loading reports…</p>';

    try {
        const res = await apiFetch(`/teacher/reports/?term=${term}`);
        const data = await res.json();
        console.log("Reports API response:", res.status, data);
        const rows = data.reports || [];

        if (!res.ok) {
            container.innerHTML = `<p class="empty-state">${escHtml(data.message || "Failed to load reports")}${data.details ? '<br><small>' + escHtml(data.details) + '</small>' : ''}</p>`;
            return;
        }

        if (rows.length === 0) {
            container.innerHTML = '<p class="empty-state">No students found for this term.</p>';
            return;
        }

        const grouped = groupReportsByClassAndSubject(rows);
        const classNames = Object.keys(grouped).sort();
        
        const sectionsHtml = classNames.map(className => {
            const classSubjects = grouped[className];
            const subjectNames = Object.keys(classSubjects).sort();
            const classId = `class-section-${className.replace(/\s+/g, "-")}`;
            
            return `
            <div class="report-class-section">
                <div class="report-class-header" onclick="toggleClassSection('${classId}')">
                    <span class="expand-icon">▶</span>
                    <span class="class-name">${escHtml(className)}</span>
                </div>
                <div class="report-class-content" id="${classId}">
                    ${subjectNames.map(subject => {
                        const students = classSubjects[subject];
                        return `
                        <div class="report-subject-group">
                            <div class="report-subject-title">${escHtml(subject)}</div>
                            <table class="report-table">
                                <thead>
                                    <tr>
                                        <th>Student</th>
                                        <th>Grade</th>
                                        <th>Effort</th>
                                        <th>Comment</th>
                                        <th>Save</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${students.map(r => `
                                    <tr>
                                        <td>${escHtml(r.student || "")}</td>
                                        <td><input class="form-input report-grade" value="${escHtml(r.report_grade || "")}" placeholder="e.g. B+"></td>
                                        <td><input class="form-input report-effort" value="${escHtml(r.effort || "")}" placeholder="e.g. Strong"></td>
                                        <td><input class="form-input report-comment" value="${escHtml(r.comment || "")}" placeholder="Comment"></td>
                                        <td>
                                            <button class="btn btn-primary btn-sm report-save-btn"
                                                data-term="${term}"
                                                data-student-id="${r.student_id}"
                                                data-subject-id="${r.subject_id}"
                                                data-class-id="${r.class_id}">Save</button>
                                        </td>
                                    </tr>
                                    `).join("")}
                                </tbody>
                            </table>
                        </div>
                        `;
                    }).join("")}
                </div>
            </div>
            `;
        }).join("");

        container.innerHTML = sectionsHtml;

        // Bind save buttons
        container.querySelectorAll(".report-save-btn").forEach(btn => {
            btn.addEventListener("click", async () => {
                const row = btn.closest("tr");
                const report_grade = row.querySelector(".report-grade").value.trim();
                const effort = row.querySelector(".report-effort").value.trim();
                const comment = row.querySelector(".report-comment").value.trim();

                btn.disabled = true;
                btn.textContent = "Saving…";
                try {
                    const resp = await apiFetch("/teacher/reports/", {
                        method: "POST",
                        body: JSON.stringify({
                            student_id: btn.dataset.studentId,
                            subject_id: btn.dataset.subjectId,
                            class_id: btn.dataset.classId,
                            term: parseInt(btn.dataset.term),
                            report_grade,
                            effort,
                            comment,
                        }),
                    });

                    const payload = await resp.json();
                    if (!resp.ok) {
                        showToast(payload.message || "Failed to save report", "error");
                        btn.textContent = "Save";
                        btn.disabled = false;
                        return;
                    }

                    btn.textContent = "✓";
                    setTimeout(() => {
                        btn.textContent = "Save";
                        btn.disabled = false;
                    }, 1000);
                } catch (err) {
                    showToast("Failed to save report", "error");
                    btn.textContent = "Save";
                    btn.disabled = false;
                }
            });
        });

    } catch (err) {
        console.error("Reports load error:", err);
        container.innerHTML = `<p class="empty-state">Failed to load reports: ${escHtml(err.message || String(err))}</p>`;
    }
}

function toggleClassSection(classId) {
    const section = document.getElementById(classId);
    const header = section.previousElementSibling;
    const icon = header.querySelector(".expand-icon");
    
    section.classList.toggle("collapsed");
    icon.classList.toggle("expanded");
}

document.addEventListener("DOMContentLoaded", () => {
    initReports().catch(err => console.error("Reports init error:", err));
});
