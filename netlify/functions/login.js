const fs = require("fs");
const path = require("path");

exports.handler = async (event) => {
    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: "Method Not Allowed" };
    }

    const { username, password } = JSON.parse(event.body);

    // IMPORTANT: robust path
    const filePath = path.join(process.cwd(), "data", "users.csv");

    try {
        let csvData = fs.readFileSync(filePath, "utf8");

        // 🔥 FIX ALL COMMON CSV ISSUES
        csvData = csvData
            .replace(/^\uFEFF/, "") // remove UTF-8 BOM
            .replace(/\r/g, "");     // remove Windows CR

        const lines = csvData.split("\n").slice(1); // skip header

        for (const line of lines) {
            if (!line.trim()) continue;

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
                message: "Invalid username or password"
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
