const fs = require("fs");
const path = require("path");

exports.handler = async (event) => {
    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: "Method Not Allowed" };
    }

    const { username, password } = JSON.parse(event.body);

    const filePath = path.join(__dirname, "../../data/users.csv");

    try {
        const csvData = fs.readFileSync(filePath, "utf8");

        const lines = csvData
            .split("\n")
            .map(line => line.replace("\r", "").trim())
            .slice(1); // skip header

        for (const line of lines) {
            if (!line) continue;

            const [csvUser, csvPass] = line.split(",");

            if (
                csvUser.trim() === username.trim() &&
                csvPass.trim() === password.trim()
            ) {
                return {
                    statusCode: 200,
                    body: JSON.stringify({ success: true })
                };
            }
        }

        return {
            statusCode: 401,
            body: JSON.stringify({
                success: false,
                message: "Wrong username or password"
            })
        };

    } catch (err) {
        console.error("LOGIN ERROR:", err);

        return {
            statusCode: 500,
            body: JSON.stringify({
                success: false,
                message: "Server error"
            })
        };
    }
};
