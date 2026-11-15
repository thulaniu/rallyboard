const test = require("node:test");
const assert = require("node:assert/strict");
const ExcelJS = require("exceljs");
const { createMatches, recordResult } = require("../src/services/drawService");
const { configureSchedule, refreshSchedule, startMatch, finishMatch, assertResultChangeAllowed, getScheduleProgress } = require("../src/services/scheduleService");
const { exportDraw } = require("../src/services/exportService");

const start = Date.parse("2030-01-01T09:00:00Z");
const minute = 60000;
function makeDraw(size, count = size) {
    const slots = Array.from({ length: size }, (_, i) => i < count
        ? { id: `p${i}`, name: `Player ${i}`, institute: `Institute ${i}`, seed: null } : null);
    return { name: "Test", createdAt: new Date(start).toISOString(), playerCount: count, bracketSize: size, rounds: createMatches(slots) };
}
function configure(draw, courts = 4) {
    configureSchedule(draw, new Date(start).toISOString(), courts);
}
function endResult(draw, number, winner, time) {
    finishMatch(draw, number, winner, time);
    recordResult(draw.rounds, number, winner, "");
    refreshSchedule(draw, time);
}

test("all possible players get 20 minutes rest and courts never overlap across bracket sizes", () => {
    for (const [size, count] of [[8, 2], [8, 5], [8, 8], [16, 11], [32, 32], [64, 51], [128, 128]]) {
        for (const courts of [1, 4, 9]) {
            const draw = makeDraw(size, count);
            configure(draw, courts);
            const entries = new Map(draw.schedule.matches.map(entry => [entry.matchNumber, entry]));
            const history = [];
            const outcomes = [];
            for (let r = 0; r < draw.rounds.length; r++) {
                outcomes[r] = [];
                draw.rounds[r].forEach((match, index) => {
                    const sides = r === 0 ? match.players.map(player => player ? [player.id] : []) :
                        outcomes[r - 1].slice(index * 2, index * 2 + 2);
                    const possible = sides.flat();
                    const entry = entries.get(match.number);
                    if (sides.every(side => side.length)) {
                        assert.ok(entry);
                        assert.equal((Date.parse(entry.endAt) - Date.parse(entry.startAt)) / minute, r === 0 ? 15 : 20);
                        for (const earlier of history) {
                            if (earlier.possible.some(id => possible.includes(id))) {
                                assert.ok(Date.parse(entry.startAt) - Date.parse(earlier.entry.endAt) >= 20 * minute);
                            }
                            if (entry.court === earlier.entry.court) {
                                assert.ok(Date.parse(entry.startAt) >= Date.parse(earlier.entry.endAt));
                            }
                        }
                        history.push({ entry, possible });
                    } else assert.equal(entry, undefined);
                    outcomes[r].push(possible);
                });
            }
        }
    }
});

test("late finishes push dependent matches back and enforce actual rest", () => {
    const draw = makeDraw(8);
    configure(draw, 4);
    const first = draw.rounds[0][0];
    const second = draw.rounds[0][1];
    const before = draw.schedule.matches.find(entry => entry.matchNumber === 5).startAt;
    startMatch(draw, first.number, start);
    startMatch(draw, second.number, start);
    endResult(draw, second.number, second.players[0].id, start + 15 * minute);
    endResult(draw, first.number, first.players[0].id, start + 40 * minute);
    const semifinal = draw.schedule.matches.find(entry => entry.matchNumber === 5);
    assert.ok(Date.parse(semifinal.startAt) >= start + 60 * minute);
    assert.ok(Date.parse(semifinal.startAt) > Date.parse(before));
    assert.throws(() => startMatch(draw, 5, start + 59 * minute), /scheduled time|rest/);
    startMatch(draw, 5, start + 60 * minute);
    assert.throws(() => assertResultChangeAllowed(draw, 1, first.players[1].id), /later match has already started/);
});

test("ongoing matches reserve their court and push pending matches while overdue", () => {
    const draw = makeDraw(8);
    configure(draw, 1);
    startMatch(draw, 1, start);
    refreshSchedule(draw, start + 30 * minute);
    const pending = draw.schedule.matches.find(entry => entry.matchNumber === 2);
    assert.ok(Date.parse(pending.startAt) >= start + 31 * minute);
    assert.throws(() => startMatch(draw, 2, start + 30 * minute), /scheduled time|ongoing/);
    endResult(draw, 1, draw.rounds[0][0].players[0].id, start + 35 * minute);
    assert.ok(Date.parse(draw.schedule.matches.find(entry => entry.matchNumber === 2).startAt) >= start + 35 * minute);
});

test("starting on another court keeps original times and moves affected matches", () => {
    const draw = makeDraw(8);
    configure(draw, 2);
    const originalTimes = new Map(draw.schedule.matches.map(entry => [entry.matchNumber, entry.originalStartAt]));
    const first = draw.schedule.matches.find(entry => entry.matchNumber === 1);
    assert.equal(first.court, 1);
    assert.throws(() => startMatch(draw, 1, start, 3), /valid court/);
    assert.throws(() => startMatch(draw, 1, start, "2"), /valid court/);
    startMatch(draw, 1, start, 2);
    assert.equal(draw.schedule.matches.find(entry => entry.matchNumber === 1).court, 2);
    const second = draw.schedule.matches.find(entry => entry.matchNumber === 2);
    assert.ok(Date.parse(second.startAt) >= start + 15 * minute || second.court !== 2);
    for (const entry of draw.schedule.matches) assert.equal(entry.originalStartAt, originalTimes.get(entry.matchNumber));
    endResult(draw, 1, draw.rounds[0][0].players[0].id, start + 30 * minute);
    for (const entry of draw.schedule.matches) assert.equal(entry.originalStartAt, originalTimes.get(entry.matchNumber));
});

test("cannot start on a court occupied by an ongoing match", () => {
    const draw = makeDraw(8);
    configure(draw, 2);
    startMatch(draw, 1, start, 2);
    assert.throws(() => startMatch(draw, 2, start + 20 * minute, 2), /ongoing match/);
    startMatch(draw, 2, start + 20 * minute, 1);
    assert.equal(draw.schedule.matches.find(entry => entry.matchNumber === 2).court, 1);
});

test("schedule requires valid configuration and a started match before finishing", () => {
    const draw = makeDraw(8);
    assert.throws(() => configureSchedule(draw, "invalid", 4), /valid start/);
    assert.throws(() => configureSchedule(draw, new Date(start).toISOString(), 0), /32 courts/);
    configure(draw);
    assert.throws(() => finishMatch(draw, 1, "p0", start), /Start this match/);
    startMatch(draw, 1, start);
    assert.throws(() => finishMatch(draw, 1, null, start), /Choose a winner/);
    assert.throws(() => configure(draw), /after a match has started/);
    endResult(draw, 1, "p0", start + minute);
    assert.throws(() => configure(draw), /after a match has started/);
});

test("scheduling a draw with earlier results preserves them and reserves 20 minutes for all remaining matches", () => {
    const draw = makeDraw(8);
    recordResult(draw.rounds, 1, "p0", "21-12");
    const savedResult = structuredClone(draw.rounds[0][0]);
    configureSchedule(draw, new Date(start - 60 * minute).toISOString(), 4, start);
    assert.deepEqual(draw.rounds[0][0], savedResult);
    assert.equal(draw.schedule.matches.some(entry => entry.matchNumber === 1), false);
    assert.equal(Date.parse(draw.schedule.earliestStartAt), start + 20 * minute);
    for (const entry of draw.schedule.matches) assert.ok(Date.parse(entry.startAt) >= start + 20 * minute);
    assert.equal(draw.schedule.matches.find(entry => entry.matchNumber === 5).durationMinutes, 20);
    assert.throws(() => startMatch(draw, 2, start + 19 * minute), /scheduled time/);
    finishMatch(draw, 1, "p0", start);
    recordResult(draw.rounds, 1, "p0", "21-13");
    assert.equal(draw.rounds[0][0].score, "21-13");
    assert.throws(() => finishMatch(draw, 1, "p1", start), /before the schedule/);
    configureSchedule(draw, new Date(start).toISOString(), 2, start + 5 * minute);
    assert.equal(draw.schedule.courts, 2);
    assert.ok(draw.schedule.matches.every(entry => Date.parse(entry.startAt) >= start + 25 * minute));
    startMatch(draw, 2, start + 25 * minute);
    assert.throws(() => configureSchedule(draw, new Date(start).toISOString(), 4, start + 30 * minute), /after a match has started/);
});

test("a completed tournament cannot create a schedule and retains its previous state", () => {
    const draw = makeDraw(8);
    for (const round of draw.rounds) {
        for (const match of round) recordResult(draw.rounds, match.number, match.players[0].id, "");
    }
    const previous = structuredClone(draw);
    assert.throws(() => configureSchedule(draw, new Date(start).toISOString(), 4, start), /no remaining matches/);
    assert.deepEqual(draw, previous);
});

test("scheduled workbook contains a separate schedule with UTC times", async () => {
    const draw = makeDraw(8);
    configure(draw);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await exportDraw(draw));
    const sheet = workbook.getWorksheet("Schedule");
    assert.equal(sheet.getCell("A1").value, "Scheduled start (UTC)");
    assert.equal(sheet.getCell("A2").value, new Date(start).toISOString());
    assert.equal(sheet.rowCount, draw.schedule.matches.length + 1);
});

test("pace compares the original finish with projections without changing the saved schedule", () => {
    const draw = makeDraw(8);
    configure(draw, 4);
    const original = draw.schedule.originalFinishAt;
    const before = JSON.stringify(draw.schedule);
    const initial = getScheduleProgress(draw, start - minute);
    assert.equal(initial.status, "on-time");
    assert.equal(initial.differenceMs, 0);
    assert.equal(initial.originalFinishAt, original);
    const overdue = getScheduleProgress(draw, start + 90 * minute);
    assert.equal(overdue.status, "behind");
    assert.equal(overdue.differenceMs, 90 * minute);
    assert.equal(JSON.stringify(draw.schedule), before);
    refreshSchedule(draw, start + 90 * minute);
    assert.equal(draw.schedule.originalFinishAt, original);
    configureSchedule(draw, new Date(start + 60 * minute).toISOString(), 4);
    assert.equal(Date.parse(draw.schedule.originalFinishAt), Date.parse(original) + 60 * minute);
});

test("pace uses actual final completion including early, late and exact finishes", () => {
    for (const [offset, status] of [[-90 * minute, "ahead"], [0, "on-time"], [125 * minute, "behind"]]) {
        const draw = makeDraw(8);
        configure(draw);
        const finish = Date.parse(draw.schedule.originalFinishAt);
        const final = draw.schedule.matches.find(entry => entry.matchNumber === draw.rounds.at(-1)[0].number);
        for (const entry of draw.schedule.matches) {
            entry.startedAt = new Date(finish - 150 * minute).toISOString();
            entry.finishedAt = new Date(finish - 100 * minute).toISOString();
        }
        final.startedAt = new Date(finish - 100 * minute).toISOString();
        final.finishedAt = new Date(finish + offset).toISOString();
        const progress = getScheduleProgress(draw, finish + 200 * minute);
        assert.equal(progress.status, status);
        assert.equal(progress.differenceMs, offset);
        assert.equal(progress.finished, true);
        assert.equal(Date.parse(progress.projectedFinishAt), finish + offset);
    }
});

test("pace reflects ongoing finals and handles older schedules without an original baseline", () => {
    const draw = makeDraw(8);
    assert.equal(getScheduleProgress(draw, start), null);
    configure(draw);
    const finish = Date.parse(draw.schedule.originalFinishAt);
    const final = draw.schedule.matches.find(entry => entry.matchNumber === draw.rounds.at(-1)[0].number);
    for (const entry of draw.schedule.matches) {
        if (entry === final) continue;
        entry.startedAt = new Date(finish - 60 * minute).toISOString();
        entry.finishedAt = new Date(finish - 40 * minute).toISOString();
    }
    final.startedAt = new Date(finish - 20 * minute).toISOString();
    assert.equal(getScheduleProgress(draw, finish - 10 * minute).status, "on-time");
    assert.equal(getScheduleProgress(draw, finish + 4 * minute).differenceMs, 5 * minute);
    delete draw.schedule.originalFinishAt;
    assert.deepEqual(getScheduleProgress(draw, finish), { status: "unavailable" });
});
