// Shared authentication utilities
const API_BASE = "https://e-diary-backend-qsly.onrender.com/api";

// Load saved color theme on every page
(function loadTheme() {
    const savedTheme = localStorage.getItem("selectedTheme") || "bright-blue";
    const themeMap = {
        "bright-blue": "",
        "ocean": "ocean",
        "purple": "purple",
        "emerald": "emerald",
        "rose": "rose",
        "amber": "amber",
        "indigo": "indigo"
    };
    
    const themeAttr = themeMap[savedTheme] || "";
    if (themeAttr) {
        document.documentElement.setAttribute("data-theme", themeAttr);
    }
})();

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
    window.location.href = "index.html";
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

async function apiFetch(path, options = {}) {
    const token = getToken();
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
    return res;
}

// Populate the nav with the logged-in user's name
function initNav() {
    const user = getUser();
    const nameEl = document.getElementById("navUserName");
    if (nameEl && user) {
        nameEl.textContent = user.full_name || user.username;
    }
    const logoutBtn = document.getElementById("logoutBtn");
    if (logoutBtn) {
        logoutBtn.addEventListener("click", logout);
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

    // Update sidebar links based on role
    const sidebarEl = document.querySelector(".sidebar");
    console.log("[initNav] Looking for sidebar and profile link...");
    console.log("[initNav] Sidebar found:", !!sidebarEl);
    console.log("[initNav] User role:", user?.role);
    
    if (sidebarEl && user) {
        // Rewrite dashboard link for the correct role
        sidebarEl.querySelectorAll("a").forEach(a => {
            const href = a.getAttribute("href");
            if ((href === "dashboard.html" || href === "/dashboard" || href === "/teacher") && user.role === "teacher") {
                a.setAttribute("href", "/teacher");
            } else if ((href === "teacher.html" || href === "/teacher") && user.role !== "teacher") {
                a.setAttribute("href", "/dashboard");
            }
        });

        // Remove any existing grades/marks links first (clean slate)
        const existingLinks = sidebarEl.querySelectorAll('a[href="/grades"], a[href="/marks"], a[href="grades.html"], a[href="marks.html"]');
        console.log("[initNav] Removing existing links:", existingLinks.length);
        existingLinks.forEach(a => a.remove());

        // Inject the correct role-specific link before Profile
        const pLink = sidebarEl.querySelector('a[href="/profile"], a[href="profile.html"]');
        console.log("[initNav] Profile link found:", !!pLink);
        console.log("[initNav] All sidebar links:", Array.from(sidebarEl.querySelectorAll("a")).map(a => a.getAttribute("href")));
        
        if (pLink) {
            const newLink = document.createElement("a");
            if (user.role === "teacher") {
                newLink.href = "/marks";
                if (window.location.pathname.endsWith("marks") || window.location.pathname.endsWith("marks.html")) newLink.classList.add("active");
                newLink.innerHTML = '<span class="icon">📝</span> Marks';
                console.log("[initNav] ✅ Injected Marks tab");
            } else {
                newLink.href = "/grades";
                if (window.location.pathname.endsWith("grades") || window.location.pathname.endsWith("grades.html")) newLink.classList.add("active");
                newLink.innerHTML = '<span class="icon">📊</span> Grades';
                console.log("[initNav] ✅ Injected Grades tab");
            }
            sidebarEl.insertBefore(newLink, pLink);
        } else {
            console.error("[initNav] ❌ Profile link not found! Sidebar HTML:", sidebarEl.innerHTML);
        }
    } else {
        console.error("[initNav] ❌ Sidebar or user not found");
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
