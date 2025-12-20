document.getElementById("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault(); // 🔥 stops page reload

    const username = document.getElementById("username").value;
    const password = document.getElementById("password").value;

    console.log("SENDING:", username, password); // DEBUG

    try {
        const res = await fetch("/.netlify/functions/login", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ username, password })
        });

        const data = await res.json();
        console.log("RESPONSE:", data); // DEBUG

        if (data.success) {
            alert("Login successful ✅");
        } else {
            alert(data.message || "Login failed ❌");
        }
    } catch (err) {
        console.error(err);
        alert("Network error");
    }
});
