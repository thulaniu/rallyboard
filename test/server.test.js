const test = require("node:test");
const assert = require("node:assert/strict");
const app = require("../src/server");

test("private APIs require a session and writes require the configured origin", async () => {
    const server = app.listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    try {
        assert.equal((await fetch(`${url}/health`)).status, 200);
        assert.equal((await fetch(`${url}/api/draws`)).status, 401);
        assert.equal((await fetch(`${url}/api/draws`, { method: "POST", headers: { Origin: "https://evil.example" } })).status, 403);
        assert.deepEqual(await (await fetch(`${url}/api/session`)).json(), { user: null });
        const page = await fetch(url);
        assert.equal(page.status, 200);
        assert.match(page.headers.get("content-security-policy"), /frame-ancestors 'none'/);
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
});
