const API_BASE = "https://e-diary-backend-lwpj.onrender.com/api";

document.getElementById("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();

    const username = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value;
    const errorMsg = document.getElementById("errorMsg");
    const submitBtn = document.getElementById("submitBtn");

    errorMsg.textContent = "";
    submitBtn.disabled = true;
    submitBtn.textContent = "Logging in…";

    try {
        const res = await fetch(`${API_BASE}/login/`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password }),
        });

        const data = await res.json();

        if (res.ok) {
            localStorage.setItem("token", data.token);
            localStorage.setItem("user", JSON.stringify(data.user));
            window.location.href = "dashboard.html";
        } else {
            errorMsg.textContent = data.message || "Login failed.";
        }
    } catch (err) {
        console.error(err);
        errorMsg.textContent = "Could not reach the server. Please try again.";
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "LOG IN";
    }
});
