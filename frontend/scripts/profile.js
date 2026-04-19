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
        const wrapper = document.getElementById("avatarWrapper");
        
        if (avatarImg && wrapper) {
            // Clear any existing initials or emoji
            wrapper.querySelectorAll(".avatar-initials, .avatar-emoji").forEach(el => el.remove());
            
            if (user.profile_picture_url) {
                avatarImg.src = user.profile_picture_url;
                avatarImg.style.display = "";
            } else if (user.avatar_emoji) {
                // Show emoji avatar
                avatarImg.style.display = "none";
                const emojiEl = document.createElement("div");
                emojiEl.className = "avatar-emoji";
                emojiEl.textContent = user.avatar_emoji;
                emojiEl.style.fontSize = "4rem";
                emojiEl.style.backgroundColor = getEmojiBackgroundColor(user.avatar_emoji);
                wrapper.insertBefore(emojiEl, wrapper.firstChild);
            } else {
                // Show initials placeholder
                avatarImg.style.display = "none";
                const initEl = document.createElement("div");
                initEl.className = "avatar-initials";
                initEl.textContent = getInitials(user.full_name);
                initEl.style.backgroundColor = getAvatarColorFromName(user.full_name);
                wrapper.insertBefore(initEl, wrapper.firstChild);
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

    // Handle click on wrapper - show menu
    wrapper.addEventListener("click", (e) => {
        e.stopPropagation();
        showAvatarOptionsMenu(wrapper);
    });

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
                // Remove initials/emoji if showing
                wrapper.querySelectorAll(".avatar-initials, .avatar-emoji").forEach(el => el.remove());
                // Update cached user
                const u = getUser();
                if (u) {
                    u.profile_picture_url = data.profile_picture_url;
                    u.avatar_emoji = null; // Clear emoji when image is set
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
        if (navAvatar.tagName === "IMG") {
            navAvatar.src = url + "?t=" + Date.now();
        } else {
            // It's a div (emoji or initials), replace it with an image
            const img = document.createElement("img");
            img.id = "navAvatar";
            img.className = "nav-avatar";
            img.src = url + "?t=" + Date.now();
            img.alt = "";
            navAvatar.replaceWith(img);
        }
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
// AVATAR OPTIONS & EMOJI SELECTION
// ════════════════════════════════════════════════════════════

const AVATAR_EMOJIS = [
    "😀", "😊", "😄", "😂", "🤗", "😍", "😎", "🤓",
    "🧐", "😌", "😏", "😘", "😗", "😙", "🥰", "😚",
    "🐶", "🐱", "🐭", "🐹", "🐰", "🦊", "🐻", "🐼",
    "🐨", "🐯", "🦁", "🐮", "🐷", "🐸", "🐵", "🐔",
    "🦄", "🌈", "⭐", "✨", "💫", "🌟", "💥", "🔥",
    "❤️", "💙", "💚", "💛", "🧡", "💜", "💖", "💝",
    "🎓", "🎯", "🎨", "📚", "📖", "✏️", "📝", "🖊️",
    "🚀", "💡", "🔬", "🔭", "⚡", "🌙", "☀️", "🌻"
];

/**
 * Get background color for emoji avatar based on emoji type/category
 * @param {string} emoji - The emoji character
 * @returns {string} CSS color code
 */
function getEmojiBackgroundColor(emoji) {
    // Map emoji categories to colors
    const emojiColorMap = {
        // Smileys - Yellow/Orange
        "😀": "#FFD93D", "😊": "#FFD93D", "😄": "#FFD93D", "😂": "#FFD93D",
        "🤗": "#FFD93D", "😍": "#FF6B9D", "😎": "#4ECDC4", "🤓": "#4ECDC4",
        "🧐": "#FFD93D", "😌": "#A8E6CF", "😏": "#FFD93D", "😘": "#FF6B9D",
        "😗": "#FF6B9D", "😙": "#FF6B9D", "🥰": "#FF6B9D", "😚": "#FF6B9D",
        
        // Animals - Browns/Greens
        "🐶": "#8B7355", "🐱": "#8B6F47", "🐭": "#9E9E9E", "🐹": "#C4A747",
        "🐰": "#E8B4A2", "🦊": "#E97D3A", "🐻": "#8B4513", "🐼": "#000000",
        "🐨": "#9E9E9E", "🐯": "#E97D3A", "🦁": "#E97D3A", "🐮": "#BEBEBE",
        "🐷": "#E8B4A2", "🐸": "#4CAF50", "🐵": "#8B7355", "🐔": "#C4A747",
        
        // Mythical - Purple/Blue
        "🦄": "#D8BFD8", "🌈": "#FF69B4",
        
        // Stars/Sky - Blue/Gold
        "⭐": "#FFD700", "✨": "#FFD700", "💫": "#FFD700", "🌟": "#FFD700",
        "💥": "#FF6347", "🔥": "#FF6347",
        
        // Hearts - Red/Pink
        "❤️": "#FF0000", "💙": "#0000FF", "💚": "#008000", "💛": "#FFD700",
        "🧡": "#FF8C00", "💜": "#800080", "💖": "#FF1493", "💝": "#FF69B4",
        
        // Activities/Objects - Various
        "🎓": "#1A237E", "🎯": "#FF6347", "🎨": "#9C27B0", "📚": "#D2691E",
        "📖": "#8B4513", "✏️": "#FFD93D", "📝": "#FFD700", "🖊️": "#696969",
        
        // Science/Space - Blue
        "🚀": "#4169E1", "💡": "#FFD700", "🔬": "#4169E1", "🔭": "#4169E1",
        "⚡": "#FFD700", "🌙": "#191970", "☀️": "#FFD700", "🌻": "#FFD700"
    };
    
    return emojiColorMap[emoji] || "#2563eb"; // Fallback to primary color
}

let _avatarMenuOpen = false;

function showAvatarOptionsMenu(wrapper) {
    // Close existing menu
    const existing = document.getElementById("avatarOptionsMenu");
    if (existing) {
        existing.remove();
        _avatarMenuOpen = false;
        return;
    }
    
    _avatarMenuOpen = true;
    
    const menu = document.createElement("div");
    menu.id = "avatarOptionsMenu";
    menu.className = "avatar-options-menu";
    menu.innerHTML = `
        <div class="avatar-menu-item avatar-menu-upload" title="Upload a photo">
            📷 Upload Photo
        </div>
        <div class="avatar-menu-item avatar-menu-emoji" title="Choose an emoji">
            😊 Choose Emoji
        </div>
        <div class="avatar-menu-item avatar-menu-initial" title="Use name initials (auto-generated)">
            🔤 Use Initials
        </div>
    `;
    
    document.body.appendChild(menu);
    
    // Position the menu
    const rect = wrapper.getBoundingClientRect();
    menu.style.position = "fixed";
    menu.style.top = (rect.bottom + 8) + "px";
    menu.style.left = (rect.left + rect.width / 2 - 120) + "px";
    menu.style.zIndex = "1000";
    
    // Handle menu item clicks
    menu.querySelector(".avatar-menu-upload").addEventListener("click", () => {
        document.getElementById("avatarInput").click();
        closeAvatarMenu();
    });
    
    menu.querySelector(".avatar-menu-emoji").addEventListener("click", () => {
        showEmojiPicker();
        closeAvatarMenu();
    });
    
    menu.querySelector(".avatar-menu-initial").addEventListener("click", () => {
        clearAvatarAndUseInitials();
        closeAvatarMenu();
    });
    
    // Close menu on outside click
    setTimeout(() => {
        document.addEventListener("click", _closeAvatarMenuHandler);
    }, 0);
}

function _closeAvatarMenuHandler(e) {
    const menu = document.getElementById("avatarOptionsMenu");
    const wrapper = document.getElementById("avatarWrapper");
    if (menu && !menu.contains(e.target) && !wrapper.contains(e.target)) {
        closeAvatarMenu();
    }
}

function closeAvatarMenu() {
    const menu = document.getElementById("avatarOptionsMenu");
    if (menu) {
        menu.remove();
        _avatarMenuOpen = false;
    }
    document.removeEventListener("click", _closeAvatarMenuHandler);
}

function showEmojiPicker() {
    // Close any existing picker
    const existing = document.getElementById("emojiPickerModal");
    if (existing) existing.remove();
    
    const modal = document.createElement("div");
    modal.id = "emojiPickerModal";
    modal.className = "emoji-picker-modal";
    
    const grid = AVATAR_EMOJIS.map(emoji => 
        `<button class="emoji-option" title="${emoji}">${emoji}</button>`
    ).join("");
    
    modal.innerHTML = `
        <div class="emoji-picker-overlay"></div>
        <div class="emoji-picker-box">
            <div class="emoji-picker-header">
                <span>Choose an Avatar Emoji</span>
                <button class="emoji-picker-close" aria-label="Close">✕</button>
            </div>
            <div class="emoji-picker-grid">
                ${grid}
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Close button
    modal.querySelector(".emoji-picker-close").addEventListener("click", () => {
        modal.remove();
    });
    
    // Close on overlay click
    modal.querySelector(".emoji-picker-overlay").addEventListener("click", () => {
        modal.remove();
    });
    
    // Handle emoji selection
    modal.querySelectorAll(".emoji-option").forEach(btn => {
        btn.addEventListener("click", async (e) => {
            e.preventDefault();
            const emoji = btn.textContent;
            await setAvatarEmoji(emoji);
            modal.remove();
        });
    });
    
    // Close on Escape
    const closeHandler = (e) => {
        if (e.key === "Escape") {
            modal.remove();
            document.removeEventListener("keydown", closeHandler);
        }
    };
    document.addEventListener("keydown", closeHandler);
}

async function setAvatarEmoji(emoji) {
    if (!emoji) {
        showAvatarMsg("No emoji selected", true);
        return;
    }
    
    showAvatarMsg("Saving emoji…", false);
    
    try {
        const body = { avatar_emoji: emoji };

        const res = await apiFetch("/me/", {
            method: "PATCH",
            body: JSON.stringify(body),
        });

        const data = await res.json();

        if (res.ok) {
            showAvatarMsg("Emoji avatar updated!", false);
            
            // Update local user
            const user = getUser();
            if (user) {
                user.avatar_emoji = emoji;
                user.profile_picture_url = null;
                localStorage.setItem("user", JSON.stringify(user));
            }
            
            // Update display
            const wrapper = document.getElementById("avatarWrapper");
            const avatarImg = document.getElementById("profileAvatar");
            if (wrapper && avatarImg) {
                wrapper.querySelectorAll(".avatar-initials, .avatar-emoji, img").forEach(el => {
                    if (el !== avatarImg || avatarImg.style.display !== "none") {
                        el.style.display = "none";
                    }
                });
                
                const existing = wrapper.querySelector(".avatar-emoji");
                if (existing) existing.remove();
                
                const emojiEl = document.createElement("div");
                emojiEl.className = "avatar-emoji";
                emojiEl.textContent = emoji;
                emojiEl.style.fontSize = "4rem";
                emojiEl.style.backgroundColor = getEmojiBackgroundColor(emoji);
                wrapper.insertBefore(emojiEl, wrapper.firstChild);
                
                avatarImg.style.display = "none";
            }
            
            // Update nav
            const navAvatar = document.getElementById("navAvatar");
            if (navAvatar && navAvatar.id === "navAvatar") {
                // Replace with emoji avatar
                const emojiNav = document.createElement("div");
                emojiNav.id = "navAvatar";
                emojiNav.className = "nav-avatar-emoji";
                emojiNav.textContent = emoji;
                emojiNav.style.backgroundColor = getEmojiBackgroundColor(emoji);
                navAvatar.replaceWith(emojiNav);
            }
        } else {
            const errorMsg = data.message || data.detail || "Failed to save emoji";
            showAvatarMsg(errorMsg, true);
        }
    } catch (err) {
        const errorMsg = "Error saving emoji: " + (err.message || "Unknown error");
        showAvatarMsg(errorMsg, true);
    }
}

async function clearAvatarAndUseInitials() {
    showAvatarMsg("Clearing avatar…", false);
    
    try {
        const res = await apiFetch("/me/", {
            method: "PATCH",
            body: JSON.stringify({ avatar_emoji: null, clear_avatar: true }),
        });
        
        const data = await res.json();
        
        if (res.ok) {
            showAvatarMsg("Using name initials", false);
            
            // Update local user
            const user = getUser();
            if (user) {
                user.avatar_emoji = null;
                user.profile_picture_url = null;
                localStorage.setItem("user", JSON.stringify(user));
            }
            
            // Reload profile to show initials
            await loadProfile();
            
            // Update nav
            const navAvatar = document.getElementById("navAvatar");
            if (navAvatar) {
                const initials = getInitialsFromName(getUser()?.full_name || "");
                const color = getAvatarColorFromName(getUser()?.full_name || "");
                
                const initialsNav = document.createElement("div");
                initialsNav.id = "navAvatar";
                initialsNav.className = "nav-avatar-initials";
                initialsNav.textContent = initials;
                initialsNav.style.backgroundColor = color;
                navAvatar.replaceWith(initialsNav);
            }
        } else {
            const errorMsg = data.message || data.detail || "Failed to update avatar";
            showAvatarMsg(errorMsg, true);
            console.error("Avatar clear error:", res.status, data);
        }
    } catch (err) {
        showAvatarMsg("Error updating avatar: " + (err.message || "Unknown error"), true);
        console.error("Avatar clear exception:", err);
    }
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
                msg.textContent = "Theme applied";
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
