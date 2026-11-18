const fs = require("node:fs");
const path = require("node:path");

const directory = process.env.DATA_DIR || path.join(process.cwd(), "data");
const filename = path.join(directory, "draws.json");
const tournamentFilename = path.join(directory, "tournaments.json");

function readFile(file) {
    if (!fs.existsSync(file)) return [];
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!Array.isArray(data)) throw new Error("Invalid storage format.");
    return data;
}

function writeFile(file, data) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(data), { mode: 0o600 });
    fs.renameSync(temporary, file);
}

function read() { return readFile(filename); }
function write(draws) { writeFile(filename, draws); }

function list(owner) {
    return read().filter(draw => draw.owner === owner);
}

function get(owner, id) {
    return list(owner).find(draw => draw.id === id);
}

function getPublished(token) {
    return read().find(draw => draw.shareToken === token);
}

function save(draw) {
    const draws = read();
    const index = draws.findIndex(item => item.id === draw.id && item.owner === draw.owner);
    if (index < 0) draws.push(draw);
    else draws[index] = draw;
    write(draws);
}

function remove(owner, id) {
    const draws = read();
    const filtered = draws.filter(draw => !(draw.id === id && draw.owner === owner));
    if (filtered.length === draws.length) return false;
    write(filtered);
    return true;
}

function listTournaments(owner) {
    return readFile(tournamentFilename).filter(item => item.owner === owner);
}

function getTournament(owner, id) {
    return listTournaments(owner).find(item => item.id === id);
}

function getPublishedTournament(token) {
    return readFile(tournamentFilename).find(item => item.shareToken === token);
}

function saveTournament(tournament) {
    const tournaments = readFile(tournamentFilename);
    const index = tournaments.findIndex(item => item.id === tournament.id && item.owner === tournament.owner);
    if (index < 0) tournaments.push(tournament);
    else tournaments[index] = tournament;
    writeFile(tournamentFilename, tournaments);
}

module.exports = { all: read, list, get, getPublished, save, remove,
    listTournaments, getTournament, getPublishedTournament, saveTournament };
