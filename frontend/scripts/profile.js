document.addEventListener("DOMContentLoaded", async () => {
    if (!requireAuth()) return;
    initNav();
    await loadProfile();
});

async function loadProfile() {
    const container = document.getElementById("profileContainer");
    try {
        const res = await apiFetch("/me/");
        const user = await res.json();

        const rows = [
            ["Full name", user.full_name],
            ["Email", user.email || "—"],
            ["Role", capitalize(user.role || "student")],
            ["Class", user.class_name || "—"],
        ];

        container.innerHTML = `
            <table>
                <tbody>
                    ${rows.map(([label, value]) => `
                        <tr>
                            <td style="font-weight:600;color:#6b7280;width:120px;">${escHtml(label)}</td>
                            <td>${escHtml(String(value || ""))}</td>
                        </tr>
                    `).join("")}
                </tbody>
            </table>
        `;
    } catch (err) {
        container.innerHTML = '<p class="empty-state">Failed to load profile.</p>';
    }
}

function capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
}
