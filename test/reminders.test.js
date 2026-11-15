const test = require("node:test");
const assert = require("node:assert/strict");
const { importContacts, enable, nextReminder, createWorker, summary } = require("../src/services/reminderService");

const now = Date.parse("2030-01-01T10:00:00Z");
function fixture() {
    const players = [
        { id: "row-2", rowNumber: 2, name: "Alice", institute: "North" },
        { id: "row-3", rowNumber: 3, name: "Bob", institute: "South" }
    ];
    return {
        id: "draw", owner: "owner", name: "Singles",
        rounds: [[{ number: 1, roundName: "Final", players, complete: false, automatic: false }]],
        schedule: { matches: [{ matchNumber: 1, court: 1, startAt: "2030-01-01T10:50:00Z",
            originalStartAt: "2030-01-01T10:50:00Z", startedAt: null }] }
    };
}
const sheet = {
    headers: ["Name", "Institute", "Phone", "Consent"],
    rows: [["Alice", "North", "+14155552671", "YES"], ["Bob", "South", "+14155552672", "no"]]
};
const mapping = { name: 0, institute: 1, phone: 2, consent: 3 };

test("import only explicit consent, replace old contacts and reject mismatches atomically", () => {
    const draw = fixture();
    assert.equal(importContacts(draw, sheet, mapping), 1);
    assert.deepEqual(draw.reminders.contacts, { "row-2": "+14155552671" });
    const before = structuredClone(draw.reminders);
    const reordered = { ...sheet, rows: [...sheet.rows].reverse() };
    assert.throws(() => importContacts(draw, reordered, mapping), /row 2/);
    assert.deepEqual(draw.reminders, before);
    assert.throws(() => importContacts(draw, { ...sheet, rows: [["Alice", "North", "123", "true"], sheet.rows[1]] }, mapping), /row 2/);
    assert.throws(() => importContacts(draw, sheet, { ...mapping, phone: 0 }), /different valid/);
    importContacts(draw, { ...sheet, rows: [["Alice", "North", "", "no"], sheet.rows[1]] }, mapping);
    assert.deepEqual(draw.reminders.contacts, {});
});

test("only valid configuration can enable reminders; disabling always works", () => {
    const draw = fixture();
    importContacts(draw, sheet, mapping);
    assert.throws(() => enable(draw, true, "UTC", false), /Twilio/);
    assert.throws(() => enable(draw, true, "Invalid/Zone", true), /time zone/);
    enable(draw, true, "Asia/Colombo", true);
    assert.equal(draw.reminders.enabled, true);
    enable(draw, false, null, false);
    assert.equal(draw.reminders.enabled, false);
});

test("reminders respect one-hour window, original delay, known players and started matches", () => {
    const draw = fixture();
    importContacts(draw, sheet, mapping);
    enable(draw, true, "UTC", true);
    const entry = draw.schedule.matches[0];
    entry.startAt = "2030-01-01T11:01:00Z";
    assert.equal(nextReminder(draw, now), null);
    entry.startAt = "2030-01-01T10:50:00Z";
    assert.equal(nextReminder(draw, now).type, "reminder");
    draw.reminders.history["1:row-2"] = { reminder: { state: "accepted" } };
    entry.startAt = "2030-01-01T11:19:00Z";
    assert.equal(nextReminder(draw, now), null);
    entry.startAt = "2030-01-01T11:20:00Z";
    assert.equal(nextReminder(draw, now).type, "delay");
    draw.reminders.history["1:row-2"].delay = { state: "accepted" };
    assert.equal(nextReminder(draw, now), null);
    delete draw.reminders.history["1:row-2"].delay;
    entry.startedAt = "2030-01-01T10:00:00Z";
    assert.equal(nextReminder(draw, now), null);
});

test("worker persists attempts, coalesces existing delay and never retries uncertain sends", async () => {
    let stored = fixture();
    importContacts(stored, sheet, mapping);
    enable(stored, true, "UTC", true);
    stored.schedule.matches[0].originalStartAt = "2030-01-01T10:00:00Z";
    const store = {
        all: () => [structuredClone(stored)],
        get: () => structuredClone(stored),
        save: draw => { stored = structuredClone(draw); }
    };
    const messages = [];
    const worker = createWorker({ store, refresh: () => {}, send: async (phone, text) => {
        assert.equal(stored.reminders.history["1:row-2"].reminder.state, "pending");
        messages.push({ phone, text });
        throw new Error("network timeout");
    }, log: () => {} });
    await worker.tick(now);
    assert.equal(messages.length, 1);
    assert.match(messages[0].text, /Delayed match/);
    assert.match(messages[0].text, /UTC/);
    assert.equal(summary(stored, true).uncertain, 1);
    await worker.tick(now);
    assert.equal(messages.length, 1);
});

test("worker sends one reminder and one delay alert, excluding non-consenting players", async () => {
    let stored = fixture();
    importContacts(stored, sheet, mapping);
    enable(stored, true, "UTC", true);
    const store = {
        all: () => [structuredClone(stored)],
        get: () => structuredClone(stored),
        save: draw => { stored = structuredClone(draw); }
    };
    const sent = [];
    const worker = createWorker({ store, refresh: () => {}, send: async (phone, text) => sent.push({ phone, text }) });
    await worker.tick(now);
    assert.equal(sent.length, 1);
    assert.match(sent[0].text, /Match reminder/);
    await worker.tick(now);
    assert.equal(sent.length, 1);
    stored.schedule.matches[0].startAt = "2030-01-01T11:20:00Z";
    await worker.tick(now);
    assert.equal(sent.length, 2);
    assert.match(sent[1].text, /Delayed match/);
    assert.equal(sent[1].phone, "+14155552671");
    stored.schedule.matches[0].startAt = "2030-01-01T12:00:00Z";
    await worker.tick(now);
    assert.equal(sent.length, 2);
    assert.equal(summary(stored, true).accepted, 2);
});
