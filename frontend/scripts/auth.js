// Shared authentication utilities
const API_BASE = "https://e-diary-1.onrender.com/api";

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
    const sidebar = document.querySelector(".sidebar");
    if (topnav && sidebar && !document.querySelector(".hamburger-btn")) {
        // Create hamburger button
        const hamBtn = document.createElement("button");
        hamBtn.className = "hamburger-btn";
        hamBtn.setAttribute("aria-label", "Menu");
        hamBtn.innerHTML = "&#9776;";
        topnav.insertBefore(hamBtn, topnav.firstChild);

        // Create overlay
        const overlay = document.createElement("div");
        overlay.className = "sidebar-overlay";
        document.body.appendChild(overlay);

        function toggleSidebar() {
            sidebar.classList.toggle("open");
            overlay.classList.toggle("open");
        }
        function closeSidebar() {
            sidebar.classList.remove("open");
            overlay.classList.remove("open");
        }

        hamBtn.addEventListener("click", toggleSidebar);
        overlay.addEventListener("click", closeSidebar);

        // Close sidebar when a link is clicked (mobile)
        sidebar.querySelectorAll("a").forEach(a => {
            a.addEventListener("click", closeSidebar);
        });
    }

    // Update sidebar links based on role
    const sidebarEl = document.querySelector(".sidebar");
    if (sidebarEl && user && !sidebarEl.dataset.navDone) {
        sidebarEl.dataset.navDone = "1";

        // Rewrite dashboard link for the correct role
        sidebarEl.querySelectorAll("a").forEach(a => {
            if (a.getAttribute("href") === "dashboard.html" && user.role === "teacher") {
                a.setAttribute("href", "teacher.html");
            } else if (a.getAttribute("href") === "teacher.html" && user.role !== "teacher") {
                a.setAttribute("href", "dashboard.html");
            }
        });

        // Remove any existing grades/marks links first (clean slate)
        sidebarEl.querySelectorAll('a[href="grades.html"], a[href="marks.html"]').forEach(a => a.remove());

        // Inject exactly one role-specific link before Profile
        const pLink = sidebarEl.querySelector('a[href="profile.html"]');
        const a = document.createElement("a");
        if (user.role === "teacher") {
            a.href = "marks.html";
            if (window.location.pathname.endsWith("marks.html")) a.classList.add("active");
            a.innerHTML = '<span class="icon">📝</span> Marks';
        } else {
            a.href = "grades.html";
            if (window.location.pathname.endsWith("grades.html")) a.classList.add("active");
            a.innerHTML = '<span class="icon">📊</span> Grades';
        }
        if (pLink) sidebarEl.insertBefore(a, pLink);
        else sidebarEl.appendChild(a);
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
