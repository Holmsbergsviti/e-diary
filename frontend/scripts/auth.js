// Shared authentication utilities
const API_BASE = "https://e-diary-backend-qsly.onrender.com/api";

function getToken() {
    return localStorage.getItem("token");
}

function getUser() {
    try {
        return JSON.parse(localStorage.getItem("user") || "null");
    } catch {
        return null;
    }
}

function logout() {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    localStorage.removeItem("admin_token");
    localStorage.removeItem("admin_user");
    window.location.href = "index.html";
}

function exitImpersonation() {
    const adminToken = localStorage.getItem("admin_token");
    const adminUser = localStorage.getItem("admin_user");
    if (adminToken && adminUser) {
        localStorage.setItem("token", adminToken);
        localStorage.setItem("user", adminUser);
        localStorage.removeItem("admin_token");
        localStorage.removeItem("admin_user");
        window.location.href = "admin.html";
    }
}

function isTokenExpired() {
    const token = getToken();
    if (!token) return true;
    try {
        const payload = JSON.parse(atob(token.split(".")[1]));
        return typeof payload.exp === "number" && payload.exp * 1000 < Date.now();
    } catch (e) {
        console.warn("Could not parse JWT payload:", e);
        return true;
    }
}

// Redirect to login if not authenticated or session has expired
function requireAuth() {
    const token = getToken();
    if (!token) {
        window.location.href = "index.html";
        return false;
    }
    if (isTokenExpired()) {
        logout();
        return false;
    }
    return true;
}

const _apiCache = {};
const API_CACHE_TTL = 30000; // 30 seconds

async function apiFetch(path, options = {}) {
    const token = getToken();
    const method = (options.method || "GET").toUpperCase();

    // Serve GET requests from short-lived cache
    if (method === "GET") {
        const cacheKey = path;
        const cached = _apiCache[cacheKey];
        if (cached && Date.now() - cached.ts < API_CACHE_TTL) {
            return cached.response.clone();
        }
    }

    // Mutations invalidate the entire GET cache so subsequent reloads see fresh data
    if (method !== "GET") {
        for (const key of Object.keys(_apiCache)) delete _apiCache[key];
    }

    const res = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(options.headers || {}),
        },
    });
    if (res.status === 401) {
        logout();
        throw new Error("Session expired");
    }

    // Cache successful GET responses
    if (method === "GET" && res.ok) {
        _apiCache[path] = { ts: Date.now(), response: res.clone() };
    }

    return res;
}

/** Invalidate cached GET responses (call after mutations). */
function invalidateApiCache(pathPrefix) {
    if (pathPrefix) {
        for (const key of Object.keys(_apiCache)) {
            if (key.startsWith(pathPrefix)) delete _apiCache[key];
        }
    } else {
        for (const key of Object.keys(_apiCache)) delete _apiCache[key];
    }
}

// Populate the nav with the logged-in user's name
function initNav() {
    const user = getUser();
    const nameEl = document.getElementById("navUserName");
    if (nameEl && user) {
        nameEl.textContent = user.full_name || user.username;
    }

    // Nav avatar
    const navRight = document.querySelector(".topnav-right");
    if (navRight && user && !document.getElementById("navAvatar")) {
        if (user.profile_picture_url) {
            const img = document.createElement("img");
            img.id = "navAvatar";
            img.className = "nav-avatar";
            img.src = user.profile_picture_url;
            img.alt = "";
            navRight.insertBefore(img, navRight.firstChild);
        } else if (user.avatar_emoji) {
            // Show emoji avatar in nav
            const emoji = document.createElement("div");
            emoji.id = "navAvatar";
            emoji.className = "nav-avatar-emoji";
            emoji.textContent = user.avatar_emoji;
            emoji.style.backgroundColor = getEmojiBackgroundColor(user.avatar_emoji);
            emoji.title = user.full_name || user.username;
            navRight.insertBefore(emoji, navRight.firstChild);
        } else {
            // Show initials in nav
            const initials = document.createElement("div");
            initials.id = "navAvatar";
            initials.className = "nav-avatar-initials";
            initials.textContent = getInitialsFromName(user.full_name);
            initials.style.backgroundColor = getAvatarColorFromName(user.full_name);
            initials.title = user.full_name || user.username;
            navRight.insertBefore(initials, navRight.firstChild);
        }
    }

    const logoutBtn = document.getElementById("logoutBtn");
    if (logoutBtn) {
        logoutBtn.addEventListener("click", logout);
    }

    // ---------- Impersonation banner ----------
    if (localStorage.getItem("admin_token")) {
        const banner = document.createElement("div");
        banner.className = "impersonation-banner";
        const targetUser = user ? (user.full_name || user.email) : "user";
        banner.innerHTML = `<span>👁️ Viewing as <strong>${targetUser}</strong> (${user?.role || ""})</span><button onclick="exitImpersonation()" class="btn btn-sm" style="margin-left:12px;background:#fff;color:#7c3aed;font-weight:600;">Back to Admin</button>`;
        document.body.prepend(banner);
    }

    // ---------- Mobile hamburger menu ----------
    const topnav = document.querySelector(".topnav");
    const topnavLeft = document.querySelector(".topnav-left");
    const sidebar = document.querySelector(".sidebar");
    if (topnav && topnavLeft && sidebar && !document.querySelector(".hamburger-btn")) {
        // Create hamburger button
        const hamBtn = document.createElement("button");
        hamBtn.className = "hamburger-btn";
        hamBtn.setAttribute("aria-label", "Menu");
        hamBtn.setAttribute("aria-expanded", "false");
        hamBtn.innerHTML = "&#9776;";
        topnavLeft.insertBefore(hamBtn, topnavLeft.firstChild);

        // Create overlay
        const overlay = document.createElement("div");
        overlay.className = "sidebar-overlay";
        document.body.appendChild(overlay);

        function toggleSidebar() {
            const isOpen = sidebar.classList.contains("open");
            sidebar.classList.toggle("open");
            overlay.classList.toggle("open");
            hamBtn.setAttribute("aria-expanded", !isOpen);
        }
        function closeSidebar() {
            sidebar.classList.remove("open");
            overlay.classList.remove("open");
            hamBtn.setAttribute("aria-expanded", "false");
        }

        hamBtn.addEventListener("click", toggleSidebar);
        overlay.addEventListener("click", closeSidebar);

        // Close sidebar when a link is clicked (mobile)
        sidebar.querySelectorAll("a").forEach(a => {
            a.addEventListener("click", closeSidebar);
        });

        // Close sidebar when Escape key is pressed
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && sidebar.classList.contains("open")) {
                closeSidebar();
                hamBtn.focus();
            }
        });
    }

    // ---------- Build sidebar links from role ----------
    const sidebarEl = document.querySelector(".sidebar");

    if (sidebarEl && user) {
        // Clear all existing links — we rebuild from scratch per role
        sidebarEl.querySelectorAll("a").forEach(a => a.remove());

        const path = window.location.pathname;
        const isPage = (names) => names.some(n => path.endsWith(n) || path.endsWith(n.replace(".html", "")));

        const links = [];

        if (user.role === "admin") {
            links.push({ href: "admin.html", icon: "⚙️", label: "Admin Panel", active: isPage(["admin.html"]) });
        } else if (user.role === "teacher") {
            links.push({ href: "teacher.html", icon: "🏠", label: "Dashboard", active: isPage(["teacher.html"]) });
            links.push({ href: "marks.html", icon: "📝", label: "Marks", active: isPage(["marks.html"]) });
            links.push({ href: "report.html", icon: "🧾", label: "Reports", active: isPage(["report.html"]) });
            links.push({ href: "schedule.html", icon: "📅", label: "Schedule", active: isPage(["schedule.html"]) });
        } else {
            // student
            links.push({ href: "dashboard.html", icon: "🏠", label: "Dashboard", active: isPage(["dashboard.html"]) });
            links.push({ href: "grades.html", icon: "📊", label: "Grades", active: isPage(["grades.html"]) });
            links.push({ href: "schedule.html", icon: "📅", label: "Schedule", active: isPage(["schedule.html"]) });
        }

        // Profile always last
        links.push({ href: "profile.html", icon: "👤", label: "Profile", active: isPage(["profile.html"]) });

        links.forEach(l => {
            const a = document.createElement("a");
            a.href = l.href;
            if (l.active) a.classList.add("active");
            a.innerHTML = `<span class="icon">${l.icon}</span> ${l.label}`;
            sidebarEl.appendChild(a);
        });
    }

    // Initialize sidebar collapse toggle
    const sidebarToggleBtn = document.getElementById("sidebarToggleBtn");
    const pageLayout = document.querySelector(".page-layout");
    if (sidebarToggleBtn && pageLayout) {
        // Load saved state
        const isCollapsed = localStorage.getItem("sidebarCollapsed") === "true";
        if (isCollapsed) {
            pageLayout.classList.add("sidebar-collapsed");
        }

        sidebarToggleBtn.addEventListener("click", () => {
            pageLayout.classList.toggle("sidebar-collapsed");
            const collapsed = pageLayout.classList.contains("sidebar-collapsed");
            localStorage.setItem("sidebarCollapsed", collapsed);
        });
    }
}

// Shared utilities used across page scripts
function escHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function formatDate(dateStr) {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    return isNaN(d) ? dateStr : d.toLocaleDateString("en-GB");
}

// Global modal escape key handler for better mobile UX
function initGlobalModalEscapeSupport() {
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            // Find any visible modal and close it
            const visibleModals = document.querySelectorAll(".modal-overlay");
            for (const modal of visibleModals) {
                // Check if modal is visible (not display: none)
                if (modal.style.display !== "none" && modal.offsetParent !== null) {
                    // Try common close button selectors
                    const closeBtn = modal.querySelector(".modal-close-btn, [data-dismiss='modal']");
                    if (closeBtn) {
                        closeBtn.click();
                        e.preventDefault();
                        return;
                    }
                }
            }
        }
    });
}

// Initialize on page load
document.addEventListener("DOMContentLoaded", initGlobalModalEscapeSupport);

/* ───────── Toast notification system ───────── */
function showToast(message, type = "error", duration = 4000) {
    let container = document.getElementById("toast-container");
    if (!container) {
        container = document.createElement("div");
        container.id = "toast-container";
        document.body.appendChild(container);
    }

    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;

    const icons = { error: "✕", success: "✓", warning: "⚠", info: "ℹ" };
    toast.innerHTML = `
        <span class="toast-icon">${icons[type] || icons.info}</span>
        <span class="toast-message">${escHtml(message)}</span>
        <button class="toast-close" aria-label="Close">×</button>
    `;

    toast.querySelector(".toast-close").addEventListener("click", () => dismissToast(toast));

    container.appendChild(toast);
    // Trigger entrance animation
    requestAnimationFrame(() => toast.classList.add("toast-visible"));

    const timer = setTimeout(() => dismissToast(toast), duration);
    toast._timer = timer;
}

function dismissToast(toast) {
    if (toast._dismissed) return;
    toast._dismissed = true;
    clearTimeout(toast._timer);
    toast.classList.remove("toast-visible");
    toast.classList.add("toast-exit");
    toast.addEventListener("transitionend", () => toast.remove(), { once: true });
    // Fallback removal if transitionend doesn't fire
    setTimeout(() => toast.remove(), 400);
}

// ════════════════════════════════════════════════════════════
// CONFIRMATION DIALOG (replaces native confirm())
// ════════════════════════════════════════════════════════════

/**
 * Show a styled confirmation dialog. Returns a Promise<boolean>.
 * @param {string} message  – the question / warning text
 * @param {Object} [opts]
 * @param {string} [opts.title]       – modal heading (default "Confirm")
 * @param {string} [opts.confirmText] – label for the confirm button (default "Confirm")
 * @param {string} [opts.cancelText]  – label for the cancel button (default "Cancel")
 * @param {string} [opts.type]        – "danger" | "warning" | "info" (default "danger")
 */
function showConfirm(message, opts = {}) {
    return new Promise(resolve => {
        const { title = "Confirm", confirmText = "Confirm", cancelText = "Cancel", type = "danger" } = opts;

        // Remove any existing dialog first
        document.getElementById("confirm-dialog-overlay")?.remove();

        const overlay = document.createElement("div");
        overlay.id = "confirm-dialog-overlay";
        overlay.className = "confirm-overlay";

        const icons = { danger: "⚠", warning: "⚠", info: "ℹ" };
        overlay.innerHTML = `
            <div class="confirm-dialog confirm-${type}">
                <div class="confirm-icon">${icons[type] || icons.info}</div>
                <h3 class="confirm-title">${escHtml(title)}</h3>
                <p class="confirm-message">${escHtml(message)}</p>
                <div class="confirm-actions">
                    <button class="btn btn-secondary confirm-cancel">${escHtml(cancelText)}</button>
                    <button class="btn btn-${type === "danger" ? "danger" : "primary"} confirm-ok">${escHtml(confirmText)}</button>
                </div>
            </div>
        `;

        function close(result) {
            overlay.classList.add("confirm-exit");
            overlay.addEventListener("animationend", () => overlay.remove(), { once: true });
            setTimeout(() => overlay.remove(), 300);
            resolve(result);
        }

        overlay.querySelector(".confirm-cancel").addEventListener("click", () => close(false));
        overlay.querySelector(".confirm-ok").addEventListener("click", () => close(true));
        overlay.addEventListener("click", e => { if (e.target === overlay) close(false); });

        document.body.appendChild(overlay);
        overlay.querySelector(".confirm-ok").focus();
    });
}

// ════════════════════════════════════════════════════════════
// TEACHER POPOVER CARD
// ════════════════════════════════════════════════════════════

function _teacherInitials(name) {
    if (!name) return "?";
    return name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
}

/**
 * Create a small teacher badge (avatar + name) that shows a popover on click.
 * @param {Object} teacher - {id, full_name, profile_picture_url, email, subjects}
 * @returns {HTMLElement}
 */
function createTeacherBadge(teacher) {
    if (!teacher || !teacher.full_name) return document.createTextNode("");
    const badge = document.createElement("span");
    badge.className = "teacher-badge";
    badge.title = teacher.full_name;

    if (teacher.profile_picture_url) {
        badge.innerHTML = `<img class="teacher-badge-avatar" src="${teacher.profile_picture_url}" alt="">`;
    } else {
        badge.innerHTML = `<span class="teacher-badge-initials">${_teacherInitials(teacher.full_name)}</span>`;
    }
    badge.innerHTML += `<span class="teacher-badge-name">${escHtml(teacher.full_name)}</span>`;

    badge.addEventListener("click", (e) => {
        e.stopPropagation();
        showTeacherPopover(teacher, badge);
    });

    return badge;
}

let _activePopover = null;

function showTeacherPopover(teacher, anchor) {
    // Remove any existing popover
    closeTeacherPopover();

    const pop = document.createElement("div");
    pop.className = "teacher-popover";

    const avatarHtml = teacher.profile_picture_url
        ? `<img class="teacher-popover-avatar" src="${teacher.profile_picture_url}" alt="">`
        : `<div class="teacher-popover-avatar teacher-popover-initials">${_teacherInitials(teacher.full_name)}</div>`;

    const subjectsHtml = teacher.subjects && teacher.subjects.length
        ? `<div class="teacher-popover-subjects">${teacher.subjects.map(s => `<span class="teacher-popover-subj">${escHtml(s)}</span>`).join(" ")}</div>`
        : "";

    const emailHtml = teacher.email
        ? `<div class="teacher-popover-email">
            <span class="teacher-popover-email-text" title="Click to copy">${escHtml(teacher.email)}</span>
            <button class="teacher-popover-copy" title="Copy email">📋</button>
           </div>`
        : "";

    pop.innerHTML = `
        <div class="teacher-popover-header">
            ${avatarHtml}
            <div class="teacher-popover-info">
                <div class="teacher-popover-name">${escHtml(teacher.full_name)}</div>
                ${subjectsHtml}
            </div>
        </div>
        ${emailHtml}
    `;

    document.body.appendChild(pop);

    // Position near the anchor
    const rect = anchor.getBoundingClientRect();
    const popW = 280;
    let left = rect.left + rect.width / 2 - popW / 2;
    let top = rect.bottom + 8;

    // Keep within viewport
    if (left < 8) left = 8;
    if (left + popW > window.innerWidth - 8) left = window.innerWidth - popW - 8;
    if (top + 200 > window.innerHeight) top = rect.top - 8;

    pop.style.left = left + "px";
    pop.style.top = top + "px";

    // Copy email handler
    const copyBtn = pop.querySelector(".teacher-popover-copy");
    const emailText = pop.querySelector(".teacher-popover-email-text");
    if (copyBtn && emailText) {
        const copyHandler = () => {
            navigator.clipboard.writeText(teacher.email).then(() => {
                emailText.textContent = "Copied!";
                emailText.classList.add("copied");
                setTimeout(() => {
                    emailText.textContent = teacher.email;
                    emailText.classList.remove("copied");
                }, 1500);
            });
        };
        copyBtn.addEventListener("click", (e) => { e.stopPropagation(); copyHandler(); });
        emailText.addEventListener("click", (e) => { e.stopPropagation(); copyHandler(); });
    }

    _activePopover = pop;

    // Close on outside click
    setTimeout(() => {
        document.addEventListener("click", _closePopoverHandler);
    }, 0);

    // Animate in
    requestAnimationFrame(() => pop.classList.add("teacher-popover-visible"));
}

function _closePopoverHandler(e) {
    if (_activePopover && !_activePopover.contains(e.target)) {
        closeTeacherPopover();
    }
}

function closeTeacherPopover() {
    if (_activePopover) {
        _activePopover.remove();
        _activePopover = null;
    }
    document.removeEventListener("click", _closePopoverHandler);
}

/**
 * Helper to render a small student avatar (img or initials) for use in lists.
 * @param {Object} student - must have name, surname, profile_picture_url
 * @returns {string} HTML string
 */
function studentAvatarHtml(student) {
    if (!student) return "";
    if (student.profile_picture_url) {
        return `<img class="avatar-sm" src="${student.profile_picture_url}" alt="">`;
    }
    const initials = ((student.name || "")[0] || "") + ((student.surname || "")[0] || "");
    return `<span class="avatar-sm-initials">${initials.toUpperCase()}</span>`;
}

/* ═══════════════════════════════════════════════════════════
   ENHANCED AVATAR SYSTEM - Support for Images, Emojis, & Initials
   ═══════════════════════════════════════════════════════════ */

/**
 * Generate a color based on user name for initials background.
 * Uses a consistent hash function so same names get same colors.
 * @param {string} name - User's name
 * @returns {string} Color code (e.g., "#FF6B6B")
 */
function getAvatarColorFromName(name) {
    if (!name) return "#2563eb"; // fallback to primary color
    
    const colors = [
        "#FF6B6B", // Red
        "#4ECDC4", // Teal
        "#45B7D1", // Blue
        "#FFA07A", // Salmon
        "#98D8C8", // Mint
        "#F7DC6F", // Yellow
        "#BB8FCE", // Purple
        "#85C1E2", // Light Blue
        "#F8B88B", // Peach
        "#A8D8EA"  // Sky
    ];
    
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = ((hash << 5) - hash) + name.charCodeAt(i);
        hash = hash & hash; // Convert to 32-bit integer
    }
    
    return colors[Math.abs(hash) % colors.length];
}

/**
 * Get background color for emoji avatar based on emoji type/category
 * Uses darker/saturated colors for better contrast with emoji
 * @param {string} emoji - The emoji character
 * @returns {string} CSS color code
 */
function getEmojiBackgroundColor(emoji) {
    // Map emoji to darker, saturated background colors for good contrast
    const emojiColorMap = {
        // Smileys - Dark backgrounds so yellow stands out
        "😀": "#1E3A8A", "😊": "#1E3A8A", "😄": "#1E3A8A", "😂": "#1E3A8A",
        "🤗": "#1E3A8A", "😍": "#7C2D12", "😎": "#082F49", "🤓": "#082F49",
        "🧐": "#1F2937", "😌": "#164E63", "😏": "#1E3A8A", "😘": "#831843",
        "😗": "#831843", "😙": "#831843", "🥰": "#831843", "😚": "#831843",
        
        // Animals - Dark browns and greens
        "🐶": "#44280D", "🐱": "#3E2817", "🐭": "#404040", "🐹": "#5A4A1E",
        "🐰": "#5A3A30", "🦊": "#7C2B0B", "🐻": "#3D1E0A", "🐼": "#1A1A1A",
        "🐨": "#4A4A4A", "🐯": "#7C2B0B", "🦁": "#7C2B0B", "🐮": "#5A5A5A",
        "🐷": "#6A3D34", "🐸": "#1B4332", "🐵": "#4A3220", "🐔": "#5A4A1E",
        
        // Mythical - Dark purple/pink
        "🦄": "#6B21A8", "🌈": "#831843",
        
        // Stars/Sky - Dark blue
        "⭐": "#1E3A8A", "✨": "#1E3A8A", "💫": "#1E3A8A", "🌟": "#1E3A8A",
        "💥": "#7C1D12", "🔥": "#7C1D12",
        
        // Hearts - Dark reds/blues/purples
        "❤️": "#7C1D12", "💙": "#0C1E3A", "💚": "#134E4A", "💛": "#1E3A8A",
        "🧡": "#7C2B0B", "💜": "#4C1D95", "💖": "#831843", "💝": "#831843",
        
        // Activities/Objects - Various dark colors
        "🎓": "#0F172A", "🎯": "#7C1D12", "🎨": "#4C1D95", "📚": "#5A2110",
        "📖": "#3D2414", "✏️": "#1E3A8A", "📝": "#7C2B0B", "🖊️": "#282828",
        
        // Science/Space - Dark blue
        "🚀": "#0C1E3A", "💡": "#7C2B0B", "🔬": "#0C1E3A", "🔭": "#0C1E3A",
        "⚡": "#7C2B0B", "🌙": "#0F172A", "☀️": "#7C2B0B", "🌻": "#7C2B0B"
    };
    
    return emojiColorMap[emoji] || "#1F2937"; // Fallback to dark gray
}

/**
 * Extract initials from a name.
 * @param {string} name - Full name or first/last name
 * @returns {string} Up to 2 character initials in uppercase
 */
function getInitialsFromName(name) {
    if (!name) return "?";
    const parts = name.trim().split(/\s+/);
    let initials = parts.map(p => p[0]).join("").toUpperCase();
    return initials.slice(0, 2);
}

/**
 * Create avatar HTML element.
 * Supports image URL, emoji, or automatic initials.
 * @param {Object} options - Configuration object
 * @param {string} options.name - User's full name (for initials/color)
 * @param {string} options.imageUrl - Profile picture URL (optional)
 * @param {string} options.emoji - Custom emoji (optional)
 * @param {string} options.size - 'sm' (32px), 'md' (100px), 'lg' (120px) - default 'sm'
 * @param {string} options.className - Additional CSS classes (optional)
 * @param {string} options.title - Tooltip title (optional)
 * @returns {HTMLElement} Avatar element (returns div or img)
 */
function createAvatarElement(options = {}) {
    const {
        name = "",
        imageUrl = null,
        emoji = null,
        size = "sm",
        className = "",
        title = ""
    } = options;
    
    // If image exists, return image element
    if (imageUrl) {
        const img = document.createElement("img");
        img.className = `avatar-img avatar-${size} ${className}`.trim();
        img.src = imageUrl;
        img.alt = name || "Avatar";
        if (title) img.title = title;
        return img;
    }
    
    // If emoji, return emoji in a div
    if (emoji) {
        const div = document.createElement("div");
        div.className = `avatar-emoji avatar-${size} ${className}`.trim();
        div.textContent = emoji;
        div.style.display = "flex";
        div.style.alignItems = "center";
        div.style.justifyContent = "center";
        div.style.fontWeight = "700";
        div.style.cursor = "default";
        if (title) div.title = title;
        return div;
    }
    
    // Otherwise use initials
    const initials = getInitialsFromName(name);
    const color = getAvatarColorFromName(name);
    const div = document.createElement("div");
    div.className = `avatar-initials avatar-${size} ${className}`.trim();
    div.textContent = initials;
    div.style.backgroundColor = color;
    div.style.color = "#ffffff";
    div.style.display = "flex";
    div.style.alignItems = "center";
    div.style.justifyContent = "center";
    div.style.fontWeight = "700";
    div.style.userSelect = "none";
    div.style.cursor = "default";
    if (title) div.title = title;
    return div;
}

/**
 * Generate avatar HTML as a string (for use in innerHTML).
 * @param {Object} options - Same as createAvatarElement
 * @returns {string} HTML string
 */
function avatarHtmlString(options = {}) {
    const {
        name = "",
        imageUrl = null,
        emoji = null,
        size = "sm",
        className = ""
    } = options;
    
    if (imageUrl) {
        return `<img class="avatar-img avatar-${size} ${className}".trim() src="${escHtml(imageUrl)}" alt="${escHtml(name || "Avatar")}">`;
    }
    
    if (emoji) {
        return `<div class="avatar-emoji avatar-${size} ${className}".trim()>${emoji}</div>`;
    }
    
    const initials = getInitialsFromName(name);
    const color = getAvatarColorFromName(name);
    return `<div class="avatar-initials avatar-${size} ${className}".trim() style="background-color: ${color}; color: #ffffff;">${escHtml(initials)}</div>`;
}
