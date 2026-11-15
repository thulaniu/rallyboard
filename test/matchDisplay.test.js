const test = require("node:test");
const assert = require("node:assert/strict");
const { details } = require("../public/matchDisplay");

const pending = { automatic: false, complete: false };
const entry = { startAt: "2030-01-02T10:15:00Z", originalStartAt: "2030-01-02T09:30:00Z", court: 3 };
const format = value => new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

test("draw card shows current date, time and court with optional original time", () => {
    assert.deepEqual(details(pending, entry, true), {
        status: "PENDING",
        schedule: `Scheduled: ${format(entry.startAt)}\nCourt 3\nOriginal: ${format(entry.originalStartAt)}`
    });
    assert.equal(details(pending, entry).schedule, `Scheduled: ${format(entry.startAt)}\nCourt 3`);
    assert.match(details(pending, { ...entry, originalStartAt: null }, true).schedule, /Original: Unavailable/);
});

test("status and missing schedule distinguish pending, ongoing, completed and byes", () => {
    assert.deepEqual(details(pending, null), { status: "PENDING", schedule: "Not scheduled yet" });
    assert.equal(details(pending, { ...entry, startedAt: entry.startAt }).status, "ONGOING");
    assert.equal(details({ ...pending, complete: true }, { ...entry, startedAt: entry.startAt }).status, "COMPLETE");
    assert.deepEqual(details({ ...pending, complete: true }, null), {
        status: "COMPLETE", schedule: "Time and court not recorded"
    });
    assert.deepEqual(details({ automatic: true, complete: true }, null), {
        status: "BYE / ADVANCE", schedule: "No match scheduled (bye)"
    });
});
