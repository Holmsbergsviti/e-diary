async function initProfile() {
    if (!requireAuth()) return;
    initNav();
    await loadProfile();
    initAccountForm();
    initAvatarUpload();
}

// Initialize on DOMContentLoaded
document.addEventListener("DOMContentLoaded", () => {
    initProfile().catch(err => console.error("Profile init error:", err));
});

function getInitials(name) {
    if (!name) return "?";
    return name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
}

async function loadProfile() {
    const container = document.getElementById("profileContainer");
    try {
        const res = await apiFetch("/me/");
        const user = await res.json();

        // Pre-fill email field
        const emailInput = document.getElementById("newEmail");
        if (emailInput) emailInput.placeholder = user.email || "New email";

        // Set avatar
        const avatarImg = document.getElementById("profileAvatar");
        if (avatarImg) {
            if (user.profile_picture_url) {
                avatarImg.src = user.profile_picture_url;
                avatarImg.style.display = "";
            } else {
                // Show initials placeholder
                avatarImg.style.display = "none";
                const wrapper = document.getElementById("avatarWrapper");
                if (wrapper && !wrapper.querySelector(".avatar-initials")) {
                    const initEl = document.createElement("div");
                    initEl.className = "avatar-initials";
                    initEl.textContent = getInitials(user.full_name);
                    wrapper.insertBefore(initEl, wrapper.firstChild);
                }
            }
        }

        // Cache avatar URL for nav
        const u = getUser();
        if (u) {
            u.profile_picture_url = user.profile_picture_url || null;
            localStorage.setItem("user", JSON.stringify(u));
        }

        const rows = [
            ["Full name", user.full_name],
            ["Email", user.email || "—"],
            ["Role", capitalize(user.role || "student")],
            ["Class", user.class_name || "—"],
        ];
        if (user.contact_email) {
            rows.push(["Contact Email", user.contact_email]);
        }

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

function initAvatarUpload() {
    const wrapper = document.getElementById("avatarWrapper");
    const input = document.getElementById("avatarInput");
    if (!wrapper || !input) return;

    wrapper.addEventListener("click", () => input.click());

    input.addEventListener("change", async () => {
        const file = input.files[0];
        if (!file) return;

        if (file.size > 2 * 1024 * 1024) {
            showAvatarMsg("Image must be under 2 MB", true);
            return;
        }

        const msg = document.getElementById("avatarMsg");
        msg.textContent = "Uploading…";
        msg.className = "form-msg form-msg-success";

        const formData = new FormData();
        formData.append("avatar", file);

        try {
            const token = localStorage.getItem("token");
            const res = await fetch(`${API_BASE}/me/avatar/`, {
                method: "POST",
                headers: { Authorization: `Bearer ${token}` },
                body: formData,
            });
            const data = await res.json();
            if (res.ok) {
                showAvatarMsg("Photo updated!", false);
                // Update avatar image
                const avatarImg = document.getElementById("profileAvatar");
                if (avatarImg) {
                    avatarImg.src = data.profile_picture_url + "?t=" + Date.now();
                    avatarImg.style.display = "";
                }
                // Remove initials if showing
                const initEl = document.querySelector(".avatar-initials");
                if (initEl) initEl.remove();
                // Update cached user
                const u = getUser();
                if (u) {
                    u.profile_picture_url = data.profile_picture_url;
                    localStorage.setItem("user", JSON.stringify(u));
                }
                // Update nav avatar
                updateNavAvatar(data.profile_picture_url);
            } else {
                showAvatarMsg(data.message || "Upload failed", true);
            }
        } catch (err) {
            showAvatarMsg("Could not reach the server.", true);
        }
        input.value = "";
    });
}

function showAvatarMsg(text, isError) {
    const msg = document.getElementById("avatarMsg");
    if (!msg) return;
    msg.textContent = text;
    msg.className = "form-msg " + (isError ? "form-msg-error" : "form-msg-success");
    if (!isError) setTimeout(() => { msg.textContent = ""; msg.className = "form-msg"; }, 2500);
}

function updateNavAvatar(url) {
    const navAvatar = document.getElementById("navAvatar");
    if (navAvatar && url) {
        navAvatar.src = url + "?t=" + Date.now();
        navAvatar.style.display = "";
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

        if (password && password.length < 8) {
            msg.textContent = "Password must be at least 8 characters.";
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
