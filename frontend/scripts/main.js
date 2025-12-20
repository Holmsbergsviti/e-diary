const API_BASE = "http://localhost:8000"; 
// CHANGE THIS after backend deployment

document.getElementById("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();

    const username = document.getElementById("username").value;
    const password = document.getElementById("password").value;

    try {
        const response = await fetch(`${API_BASE}/api/login/`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ username, password })
        });

        const data = await response.json();

        if (data.success) {
            alert("Login successful ✅");
        } else {
            alert(data.message);
        }

    } catch (err) {
        console.error(err);
        alert("Backend unreachable");
    }
});
