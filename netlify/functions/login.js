const fs = require("fs");
const path = require("path");

exports.handler = async (event) => {
    if (event.httpMethod !== "POST") {
        return {
            statusCode: 405,
            body: "Method Not Allowed"
        };
    }

    const { username, password } = JSON.parse(event.body);

    // Path to CSV file (read-only)
    const filePath = path.join(__dirname, "../../data/users.csv");

    try {
        const csvData = fs.readFileSync(filePath, "utf8");

        const lines = csvData.split("\n").slice(1); // skip header

        for (let line of lines) {
            if (!line.trim()) continue;

            const [csvUser, csvPass] = line.trim().split(",");

            if (csvUser === username && csvPass === password) {
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
        console.error(err);

        return {
            statusCode: 500,
            body: JSON.stringify({
                success: false,
                message: "Server error"
            })
        };
    }
};
