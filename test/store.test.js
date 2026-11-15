const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "rallyboard-test-"));
process.env.DATA_DIR = directory;
const store = require("../src/services/store");

test.after(() => fs.rmSync(directory, { recursive: true, force: true }));

test("draws persist and are isolated by Google account", () => {
    store.save({ id: "one", owner: "alice", name: "Alice's draw" });
    store.save({ id: "two", owner: "bob", name: "Bob's draw" });
    assert.equal(store.list("alice").length, 1);
    assert.equal(store.get("bob", "one"), undefined);
    assert.equal(store.remove("bob", "one"), false);
    store.save({ id: "one", owner: "alice", name: "Updated" });
    assert.equal(store.get("alice", "one").name, "Updated");
    assert.equal(store.remove("alice", "one"), true);
    assert.equal(store.list("bob").length, 1);
});
