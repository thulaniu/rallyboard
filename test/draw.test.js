const test = require("node:test");
const assert = require("node:assert/strict");
const ExcelJS = require("exceljs");
const { createSeededBracket, generateBracketPositions } = require("../src/services/seedingService");
const { getFirstPossibleMeetingRound } = require("../src/services/instituteBalancer");
const { createMatches, recordResult } = require("../src/services/drawService");
const { mapPlayers, spreadsheetId } = require("../src/services/googleSheetsService");
const { validatePlayers } = require("../src/services/validationService");
const { exportDraw } = require("../src/services/exportService");

function players(count) {
    return Array.from({ length: count }, (_, i) => ({
        id: `p${i + 1}`, name: `Player ${i + 1}`, institute: `Institute ${i + 1}`,
        seed: i < Math.min(count, 8) ? i + 1 : null
    }));
}

test("supports bracket sizes, seed positions and priority BYEs without losing players", () => {
    for (const count of [2, 3, 5, 7, 8, 9, 15, 16, 17, 32, 63, 64, 65, 127, 128]) {
        const input = players(count);
        const bracket = createSeededBracket(input);
        const slots = bracket.slots;
        const byes = bracket.bracketSize - count;
        assert.equal(slots.filter(Boolean).length, count);
        assert.equal(new Set(slots.filter(Boolean).map(player => player.id)).size, count);
        assert.equal(slots.filter(player => !player).length, byes);
        for (const player of input.filter(player => player.seed)) {
            const index = generateBracketPositions(bracket.bracketSize).indexOf(player.seed);
            assert.equal(slots[index].id, player.id);
            if (player.seed <= byes) assert.equal(slots[index ^ 1], null);
        }
        if (count >= bracket.bracketSize / 2) {
            for (let i = 0; i < slots.length; i += 2) assert.ok(slots[i] || slots[i + 1]);
        }
    }
});

test("calculates the final meeting round in a 128-player bracket", () => {
    assert.equal(getFirstPossibleMeetingRound(1, 128), 7);
    assert.equal(getFirstPossibleMeetingRound(1, 2), 1);
});

test("BYEs advance automatically and changed results invalidate dependent results", () => {
    const [a, b, c, d] = players(4);
    const rounds = createMatches([a, b, c, d, null, null, null, null]);
    assert.equal(rounds[0][2].complete, true);
    assert.equal(rounds[1][1].complete, true);
    recordResult(rounds, 1, a.id, "21-10");
    recordResult(rounds, 2, c.id, "21-15");
    recordResult(rounds, 5, a.id, "21-19");
    assert.equal(rounds[2][0].winnerId, a.id);
    assert.equal(rounds[2][0].automatic, true);
    recordResult(rounds, 1, b.id, "21-11");
    assert.equal(rounds[1][0].winnerId, null);
    assert.equal(rounds[1][0].score, "");
    assert.equal(rounds[2][0].complete, false);
    assert.throws(() => recordResult(rounds, 5, d.id, ""), /one of the match players/);
});

test("maps selected headers and exact event values while retaining source row numbers", () => {
    const data = {
        headers: ["Timestamp", "Event", "Player", "University", "Seed", "Email"],
        rows: [["now", "Singles", "Alice", "A", "1", "x"], ["now", "Doubles", "Bob", "B", "", "y"], [], ["now", "Singles", "Chris", "C", "", "z"]]
    };
    const mapped = mapPlayers(data, { name: 2, institute: 3, seed: 4, event: 1, eventValue: "Singles" });
    assert.deepEqual(mapped.map(player => [player.name, player.rowNumber, player.seed]), [["Alice", 2, 1], ["Chris", 5, null]]);
    assert.equal(validatePlayers(mapped).valid, true);
    assert.throws(() => mapPlayers(data, { name: 2, institute: 2 }), /different column/);
    assert.throws(() => mapPlayers(data, { name: 2, institute: 3, event: 1, eventValue: "" }), /event value/);
    assert.equal(spreadsheetId("https://docs.google.com/spreadsheets/d/abc-123/edit#gid=0"), "abc-123");
    assert.throws(() => spreadsheetId("https://example.com/sheet"), /valid Google Sheet/);
});

test("validation rejects too few players and invalid seeds but allows identical names", () => {
    assert.equal(validatePlayers(players(1)).valid, false);
    const input = players(2);
    input[1].name = input[0].name;
    assert.equal(validatePlayers(input).valid, true);
    input[1].seed = Number("bad");
    assert.equal(validatePlayers(input).valid, false);
});

test("Excel export includes all rounds and treats player names as text", async () => {
    const input = players(2);
    input[0].name = "=1+1";
    const rounds = createMatches([input[0], null, input[1], null, null, null, null, null]);
    const buffer = await exportDraw({ name: "Singles", createdAt: "2026-01-01", playerCount: 2, bracketSize: 8, rounds });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.getWorksheet("Tournament draw");
    assert.equal(sheet.getCell("C4").value, "=1+1");
    assert.equal(sheet.getRow(3).getCell(1).font.bold, true);
    assert.equal(sheet.rowCount, 10);
});
