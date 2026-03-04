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

    // Update sidebar links based on role
    const sidebar = document.querySelector(".sidebar");
    if (sidebar && user && !sidebar.dataset.navDone) {
        sidebar.dataset.navDone = "1";

        // Rewrite dashboard link for the correct role
        sidebar.querySelectorAll("a").forEach(a => {
            if (a.getAttribute("href") === "dashboard.html" && user.role === "teacher") {
                a.setAttribute("href", "teacher.html");
            } else if (a.getAttribute("href") === "teacher.html" && user.role !== "teacher") {
                a.setAttribute("href", "dashboard.html");
            }
        });

        // Remove any existing grades/marks links first (clean slate)
        sidebar.querySelectorAll('a[href="grades.html"], a[href="marks.html"]').forEach(a => a.remove());

        // Inject exactly one role-specific link before Profile
        const pLink = sidebar.querySelector('a[href="profile.html"]');
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
        if (pLink) sidebar.insertBefore(a, pLink);
        else sidebar.appendChild(a);
    }
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
