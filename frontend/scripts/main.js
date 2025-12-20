document.getElementById("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();

    const username = document.getElementById("username").value;
    const password = document.getElementById("password").value;

    try {
        const res = await fetch(
            "https://e-diary-backend-lwpj.onrender.com/api/login/",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ username, password }),
            }
        );

        const data = await res.json();

        if (res.ok) {
            alert("Login successful ✅");
            // later: save token / redirect
        } else {
            alert(data.message || "Login failed ❌");
        }
    } catch (err) {
        console.error(err);
        alert("Backend unreachable ❌");
    }
});
