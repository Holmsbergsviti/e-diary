function initProfile() {
    if (!requireAuth()) return;
    initNav();
    loadProfile();
    initAccountForm();
}

// Initialize immediately with slight delay to ensure sidebar is rendered
setTimeout(initProfile, 0);

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

// ════════════════════════════════════════════════════════════
// COLOR PALETTE SELECTOR
// ════════════════════════════════════════════════════════════

document.addEventListener("DOMContentLoaded", () => {
    initPaletteSelector();
    loadSavedTheme();
});

function initPaletteSelector() {
    const paletteButtons = document.querySelectorAll(".palette-btn");
    
    paletteButtons.forEach(btn => {
        btn.addEventListener("click", () => {
            const theme = btn.dataset.theme;
            setTheme(theme);
            
            // Update active state
            paletteButtons.forEach(b => b.classList.remove("palette-active"));
            btn.classList.add("palette-active");
            
            // Show confirmation message
            const msg = document.getElementById("paletteMsg");
            if (msg) {
                msg.textContent = "🎨 Theme updated!";
                msg.classList.remove("form-msg-error");
                msg.classList.add("form-msg-success");
                setTimeout(() => {
                    msg.textContent = "";
                    msg.classList.remove("form-msg-success");
                }, 2000);
            }
        });
    });
}

function setTheme(themeName) {
    const themeMap = {
        "bright-blue": "",
        "ocean": "ocean",
        "purple": "purple",
        "emerald": "emerald",
        "rose": "rose",
        "amber": "amber",
        "indigo": "indigo",
        "teal": "teal",
        "mint": "mint",
        "coral": "coral"
    };
    
    const themeAttribute = themeMap[themeName] || "";
    
    if (themeAttribute) {
        document.documentElement.setAttribute("data-theme", themeAttribute);
    } else {
        document.documentElement.removeAttribute("data-theme");
    }
    
    // Save to localStorage
    localStorage.setItem("selectedTheme", themeName);
}

function loadSavedTheme() {
    const savedTheme = localStorage.getItem("selectedTheme") || "bright-blue";
    setTheme(savedTheme);
    
    // Highlight the saved theme button
    const paletteButtons = document.querySelectorAll(".palette-btn");
    paletteButtons.forEach(btn => {
        if (btn.dataset.theme === savedTheme) {
            btn.classList.add("palette-active");
        } else {
            btn.classList.remove("palette-active");
        }
    });
}
