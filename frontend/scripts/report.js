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

async function loadReports(term) {
    const container = document.getElementById("reportContainer");
    container.innerHTML = '<p class="loading">Loading reports…</p>';

    try {
        const res = await apiFetch(`/teacher/reports/?term=${term}`);
        const data = await res.json();
        const rows = data.reports || [];

        if (!res.ok) {
            container.innerHTML = `<p class="empty-state">${escHtml(data.message || "Failed to load reports")}</p>`;
            return;
        }

        if (rows.length === 0) {
            container.innerHTML = '<p class="empty-state">No students found for this term.</p>';
            return;
        }

        container.innerHTML = `
            <table>
                <thead>
                    <tr>
                        <th>#</th>
                        <th>Student</th>
                        <th>Class</th>
                        <th>Subject</th>
                        <th>Grade</th>
                        <th>Effort</th>
                        <th>Comment</th>
                        <th>Save</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows.map((r, i) => `
                    <tr>
                        <td>${i + 1}</td>
                        <td>${escHtml(r.student || "")}</td>
                        <td><span class="class-tag">${escHtml(r.class_name || "")}</span></td>
                        <td>${escHtml(r.subject || "")}</td>
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
        `;

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
                        alert(payload.message || "Failed to save report");
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
                    alert("Failed to save report");
                    btn.textContent = "Save";
                    btn.disabled = false;
                }
            });
        });

    } catch (err) {
        container.innerHTML = '<p class="empty-state">Failed to load reports.</p>';
    }
}

setTimeout(() => {
    initReports().catch(err => console.error("Reports init error:", err));
}, 100);
