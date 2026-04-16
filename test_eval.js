const axios = require('axios');
async function test() {
    const targetUrl = 'http://127.0.0.1:11434/api/chat';
    const payload = {
        model: "gemma4:e2b",
        messages: [{ role: "user", content: "hello" }],
        stream: false
    };
    try {
        const res = await axios.post(targetUrl, payload);
        console.log("SUCCESS:", res.data);
    } catch(err) {
        console.log("ERROR:", err.response ? err.response.data : err.message);
    }
}
test();
