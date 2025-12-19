const fs = require("fs");
const path = require("path");

exports.handler = async (event) => {
    console.log("EVENT:", event.httpMethod, event.body);

    if (event.httpMethod !== "POST") {
        return {
            statusCode: 405,
            body: "Method Not Allowed"
        };
    }

    let data;
    try {
        data = JSON.parse(event.body || "{}");
    } catch (e) {
        console.error("JSON PARSE ERROR:", e);
        return {
            statusCode: 400,
            body: JSON.stringify({ success: false, message: "Bad JSON" })
        };
    }

    const { username, password } = data;

    console.log("RECEIVED:", username, password);

    const filePath = path.join(__dirname, "users.csv");
    console.log("CSV PATH:", filePath);

    try {
        let csvData = fs.readFileSync(filePath, "utf8");

        csvData = csvData
            .replace(/^\uFEFF/, "")
            .replace(/\r/g, "");

        const lines = csvData.split("\n").slice(1);

        for (const line of lines) {
            if (!line.trim()) continue;

            const [csvUser, csvPass] = line.split(",");

            if (
                csvUser.trim() === username?.trim() &&
                csvPass.trim() === password?.trim()
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
        console.error("FILE ERROR:", err);
        return {
            statusCode: 500,
            body: JSON.stringify({
                success: false,
                message: "Server error"
            })
        };
    }
};
