const fs = require("node:fs");
const path = require("node:path");

const directory = process.env.DATA_DIR || path.join(process.cwd(), "data");
const filename = path.join(directory, "draws.json");

function read() {
    if (!fs.existsSync(filename)) return [];
    const data = JSON.parse(fs.readFileSync(filename, "utf8"));
    if (!Array.isArray(data)) throw new Error("Invalid draw storage format.");
    return data;
}

function write(draws) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const temporary = `${filename}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(draws), { mode: 0o600 });
    fs.renameSync(temporary, filename);
}

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

module.exports = { all: read, list, get, getPublished, save, remove };
