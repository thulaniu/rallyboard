const crypto = require("node:crypto");
const { refreshSchedule } = require("./scheduleService");

const HOUR = 60 * 60 * 1000;
const DELAY = 30 * 60 * 1000;
const PHONE = /^\+[1-9]\d{1,14}$/;
class ReminderError extends Error {}

function importContacts(draw, data, mapping) {
    const keys = ["name", "institute", "phone", "consent"];
    if (!mapping || keys.some(key => !Number.isInteger(mapping[key]) ||
        mapping[key] < 0 || mapping[key] >= data.headers.length) ||
        new Set(keys.map(key => mapping[key])).size !== keys.length) {
        throw new ReminderError("Select different valid name, institute, phone and consent columns.");
    }
    const players = draw.rounds[0].flatMap(match => match.players.filter(Boolean));
    const contacts = {};
    const identities = new Set();
    for (const player of players) {
        const identity = JSON.stringify([player.name, player.institute]);
        if (identities.has(identity)) {
            throw new ReminderError("Cannot safely import contacts when multiple players have the same name and institute.");
        }
        identities.add(identity);
        if (!Number.isInteger(player.rowNumber) || player.id !== `row-${player.rowNumber}`) {
            throw new ReminderError("This draw cannot be matched safely to sheet rows.");
        }
        const row = data.rows[player.rowNumber - 2];
        if (!row || String(row[mapping.name] || "").trim() !== player.name ||
            String(row[mapping.institute] || "").trim() !== player.institute) {
            throw new ReminderError(`Sheet row ${player.rowNumber} no longer matches the original player name and institute.`);
        }
        const consent = String(row[mapping.consent] ?? "").trim().toLowerCase();
        if (!["yes", "true"].includes(consent)) continue;
        const phone = String(row[mapping.phone] ?? "").trim();
        if (!PHONE.test(phone)) throw new ReminderError(`Enter a valid international phone number (e.g. +14155552671) at row ${player.rowNumber}.`);
        contacts[player.id] = phone;
    }
    draw.reminders = { ...draw.reminders, enabled: draw.reminders?.enabled || false,
        contacts, history: draw.reminders?.history || {} };
    return Object.keys(contacts).length;
}

function summary(draw, configured) {
    const reminders = draw.reminders;
    const attempts = [...new Map(Object.values(reminders?.history || {}).flatMap(item =>
        Object.values(item)).map(item => [item.attemptId, item])).values()];
    return {
        enabled: Boolean(reminders?.enabled),
        configured,
        eligible: Object.keys(reminders?.contacts || {}).length,
        timeZone: reminders?.timeZone || null,
        accepted: attempts.filter(item => item.state === "accepted").length,
        uncertain: attempts.filter(item => item.state !== "accepted").length
    };
}

function enable(draw, enabled, timeZone, configured) {
    if (typeof enabled !== "boolean") throw new ReminderError("Choose whether reminders are enabled.");
    if (!enabled) {
        if (draw.reminders) draw.reminders.enabled = false;
        return;
    }
    if (!configured) throw new ReminderError("Configure Twilio before enabling SMS reminders.");
    if (!draw.schedule) throw new ReminderError("Create a schedule before enabling SMS reminders.");
    if (!Object.keys(draw.reminders?.contacts || {}).length) throw new ReminderError("Import opted-in phone numbers before enabling SMS reminders.");
    if (typeof timeZone !== "string" || !timeZone) throw new ReminderError("Choose a valid tournament time zone.");
    try { new Intl.DateTimeFormat("en", { timeZone }).format(); }
    catch (error) {
        if (!(error instanceof RangeError)) throw error;
        throw new ReminderError("Choose a valid tournament time zone.");
    }
    draw.reminders.enabled = true;
    draw.reminders.timeZone = timeZone;
}

function nextReminder(draw, now) {
    if (!draw.reminders?.enabled || !draw.schedule) return null;
    const history = draw.reminders.history;
    const matches = new Map(draw.rounds.flat().map(match => [match.number, match]));
    for (const entry of draw.schedule.matches) {
        const match = matches.get(entry.matchNumber);
        const start = Date.parse(entry.startAt);
        if (!match || match.complete || match.automatic || entry.startedAt || start <= now) continue;
        const original = Date.parse(entry.originalStartAt);
        const delayed = Number.isFinite(original) && start - original >= DELAY;
        for (const player of match.players) {
            if (!player || !draw.reminders.contacts[player.id]) continue;
            const key = `${match.number}:${player.id}`;
            const previous = history[key] || {};
            const type = !previous.reminder && start <= now + HOUR ? "reminder" :
                previous.reminder && delayed && !previous.delay ? "delay" : null;
            if (type) return { match, entry, player, key, type, delayed };
        }
    }
    return null;
}

function message(draw, candidate) {
    const { entry, match, type, delayed } = candidate;
    const time = new Intl.DateTimeFormat("en", {
        dateStyle: "medium", timeStyle: "short", timeZone: draw.reminders.timeZone
    }).format(new Date(entry.startAt));
    const prefix = type === "delay" || delayed ? "Delayed match" : "Match reminder";
    return `${prefix}: ${draw.name}, ${match.roundName}, match ${match.number}. Scheduled ${time} (${draw.reminders.timeZone}), court ${entry.court}. Reply STOP to opt out.`;
}

function createWorker({ store, send, log = console.error, refresh = refreshSchedule }) {
    let running = false;
    async function tick(now = Date.now()) {
        if (running) return;
        running = true;
        try {
            for (const item of store.all()) {
                if (!item.reminders?.enabled || !item.schedule) continue;
                let draw = store.get(item.owner, item.id);
                refresh(draw, now);
                store.save(draw);
                while (true) {
                    draw = store.get(item.owner, item.id);
                    if (!draw) break;
                    const candidate = nextReminder(draw, now);
                    if (!candidate) break;
                    const attemptId = crypto.randomUUID();
                    const record = draw.reminders.history[candidate.key] ||= {};
                    record[candidate.type] = { attemptId, state: "pending" };
                    if (candidate.type === "reminder" && candidate.delayed) {
                        record.delay = { attemptId, state: "pending" };
                    }
                    const phone = draw.reminders.contacts[candidate.player.id];
                    const body = message(draw, candidate);
                    store.save(draw);
                    let state = "accepted";
                    try { await send(phone, body); }
                    catch (error) {
                        state = "uncertain";
                        log(`SMS reminder could not be confirmed for draw ${item.id}; check provider logs.`);
                    }
                    draw = store.get(item.owner, item.id);
                    if (!draw?.reminders) break;
                    const latest = draw.reminders.history[candidate.key];
                    for (const attempt of Object.values(latest || {})) {
                        if (attempt.attemptId === attemptId) attempt.state = state;
                    }
                    store.save(draw);
                }
            }
        } finally {
            running = false;
        }
    }
    return { tick };
}

module.exports = { ReminderError, importContacts, summary, enable, nextReminder, message, createWorker };
