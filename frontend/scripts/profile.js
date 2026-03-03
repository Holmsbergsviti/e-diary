document.addEventListener("DOMContentLoaded", async () => {
    if (!requireAuth()) return;
    initNav();
    await loadProfile();
    initAccountForm();
});

async function loadProfile() {
    const container = document.getElementById("profileContainer");
    try {
        const res = await apiFetch("/me/");
        const user = await res.json();

        // Pre-fill email field
        const emailInput = document.getElementById("newEmail");
        if (emailInput) emailInput.placeholder = user.email || "New email";

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

function initAccountForm() {
    const form = document.getElementById("accountForm");
    if (!form) return;

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const msg = document.getElementById("accountMsg");
        const btn = document.getElementById("saveAccountBtn");
        const email = document.getElementById("newEmail").value.trim();
        const password = document.getElementById("newPassword").value;
        const confirm = document.getElementById("confirmPassword").value;

        msg.textContent = "";
        msg.className = "form-msg";

        if (!email && !password) {
            msg.textContent = "Enter a new email or password to update.";
            msg.classList.add("form-msg-error");
            return;
        }

        if (password && password !== confirm) {
            msg.textContent = "Passwords do not match.";
            msg.classList.add("form-msg-error");
            return;
        }

        if (password && password.length < 4) {
            msg.textContent = "Password must be at least 4 characters.";
            msg.classList.add("form-msg-error");
            return;
        }

        const body = {};
        if (email) body.email = email;
        if (password) body.password = password;

        btn.disabled = true;
        btn.textContent = "Saving…";

        try {
            const res = await apiFetch("/me/", {
                method: "PATCH",
                body: JSON.stringify(body),
            });
            const data = await res.json();
            if (res.ok) {
                msg.textContent = "Account updated successfully!";
                msg.classList.add("form-msg-success");
                // Update local storage email if changed
                if (email) {
                    const user = getUser();
                    if (user) {
                        user.email = email;
                        localStorage.setItem("user", JSON.stringify(user));
                    }
                }
                // Clear form
                document.getElementById("newEmail").value = "";
                document.getElementById("newPassword").value = "";
                document.getElementById("confirmPassword").value = "";
                // Reload profile info
                await loadProfile();
            } else {
                msg.textContent = data.message || "Update failed.";
                msg.classList.add("form-msg-error");
            }
        } catch (err) {
            msg.textContent = "Could not reach the server.";
            msg.classList.add("form-msg-error");
        } finally {
            btn.disabled = false;
            btn.textContent = "Save Changes";
        }
    });
}

function capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
}
