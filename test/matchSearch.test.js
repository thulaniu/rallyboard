const test = require("node:test");
const assert = require("node:assert/strict");
const { matches } = require("../public/matchSearch");

const match = {
    number: 12,
    players: [{ name: "Alex Smith", institute: "North University" }, null]
};
const entry = { court: 4 };

test("match search handles names, institutes, match numbers and courts", () => {
    for (const query of ["", "  ", "alex", " NORTH   UNIVERSITY ", "12", "#12", "match 12", "match12", "court 4", "court4", "4"]) {
        assert.equal(matches(match, entry, query), true, query);
    }
    for (const query of ["other", "#4", "match 4", "court 12", "99"]) {
        assert.equal(matches(match, entry, query), false, query);
    }
});

test("match search tolerates unknown players and unrecorded courts", () => {
    const undecided = { number: 7, players: [null, null] };
    assert.equal(matches(undecided, null, ""), true);
    assert.equal(matches(undecided, null, "#7"), true);
    assert.equal(matches(undecided, null, "court 7"), false);
    assert.equal(matches(undecided, null, "undefined"), false);
});
