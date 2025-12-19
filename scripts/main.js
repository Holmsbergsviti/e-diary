document.getElementById("loginForm").addEventListener("submit", function (e) {
    e.preventDefault();
    logIn();
});

function logIn() {
    const username = document.getElementById("username").value;
    const password = document.getElementById("password").value;

    fetch("/.netlify/functions/login", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ username, password })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            alert("Login successful ✅");
        } else {
            alert("Invalid username or password ❌");
        }
    })
    .catch(err => {
        console.error(err);
        alert("Server error");
    });
}
