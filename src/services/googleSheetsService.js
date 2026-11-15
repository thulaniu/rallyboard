const { google } = require("googleapis");

function spreadsheetId(value) {
    if (typeof value !== "string") throw new Error("Enter a Google Sheet URL or ID.");
    const input = value.trim();
    const match = input.match(/^https:\/\/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)(?:[/?#]|$)/);
    const id = match ? match[1] : input;
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("Enter a valid Google Sheet URL or ID.");
    return id;
}

async function listWorksheets(auth, id) {
    const response = await google.sheets({ version: "v4", auth }).spreadsheets.get({
        spreadsheetId: spreadsheetId(id),
        fields: "properties(title),sheets(properties(title))"
    });
    return {
        title: response.data.properties.title,
        worksheets: response.data.sheets.map(sheet => sheet.properties.title)
    };
}

async function readWorksheet(auth, id, worksheet) {
    if (typeof worksheet !== "string" || !worksheet || worksheet.length > 200) {
        throw new Error("Select a worksheet.");
    }
    const response = await google.sheets({ version: "v4", auth }).spreadsheets.values.get({
        spreadsheetId: spreadsheetId(id),
        range: `'${worksheet.replace(/'/g, "''")}'`
    });
    const rows = response.data.values || [];
    if (!rows.length) throw new Error("The selected worksheet is empty.");
    return { headers: rows[0], rows: rows.slice(1) };
}

function mapPlayers(data, mapping) {
    if (!mapping || typeof mapping !== "object") throw new Error("Select the required columns.");
    const { headers, rows } = data;
    const required = ["name", "institute"];
    for (const key of required) {
        if (!Number.isInteger(mapping[key]) || mapping[key] < 0 || mapping[key] >= headers.length) {
            throw new Error(`Select a valid ${key} column.`);
        }
    }
    for (const key of ["seed", "event"]) {
        if (mapping[key] != null && (!Number.isInteger(mapping[key]) || mapping[key] < 0 || mapping[key] >= headers.length)) {
            throw new Error(`Select a valid ${key} column.`);
        }
    }
    const selected = [mapping.name, mapping.institute, mapping.seed, mapping.event].filter(value => value != null);
    if (new Set(selected).size !== selected.length) throw new Error("Choose a different column for each field.");
    if (mapping.event != null && (typeof mapping.eventValue !== "string" || !mapping.eventValue.trim())) {
        throw new Error("Select an event value.");
    }
    return rows.flatMap((row, index) => {
        if (row.every(value => !String(value).trim())) return [];
        if (mapping.event != null && String(row[mapping.event] || "").trim() !== mapping.eventValue.trim()) return [];
        const seed = mapping.seed == null ? "" : String(row[mapping.seed] || "").trim();
        return [{
            id: `row-${index + 2}`,
            rowNumber: index + 2,
            name: String(row[mapping.name] || "").trim(),
            institute: String(row[mapping.institute] || "").trim(),
            seed: seed ? Number(seed) : null
        }];
    });
}

module.exports = { spreadsheetId, listWorksheets, readWorksheet, mapPlayers };
