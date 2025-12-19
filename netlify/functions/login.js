exports.handler = async (event) => {
    if (event.httpMethod !== "POST") {
        return {
            statusCode: 405,
            body: "Method Not Allowed"
        };
    }

    const { username, password } = JSON.parse(event.body);

    // TEMP TEST LOGIN (replace later with DB + hashing)
    if (username === "admin" && password === "1234") {
        return {
            statusCode: 200,
            body: JSON.stringify({ success: true })
        };
    }

    return {
        statusCode: 401,
        body: JSON.stringify({ success: false })
    };
};
