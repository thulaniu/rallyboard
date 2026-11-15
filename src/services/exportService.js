const ExcelJS = require("exceljs");

async function exportDraw(draw) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Rallyboard";
    workbook.created = new Date();
    const worksheet = workbook.addWorksheet("Tournament draw", {
        views: [{ state: "frozen", ySplit: 3 }]
    });
    worksheet.columns = [18, 8, 24, 24, 8, 24, 24, 8, 24, 18, 14].map(width => ({ width }));
    worksheet.addRow([draw.name]);
    worksheet.mergeCells("A1:K1");
    worksheet.getRow(1).height = 30;
    worksheet.getCell("A1").font = { name: "Calibri", size: 16, bold: true, color: { argb: "FFFFFFFF" } };
    worksheet.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF173228" } };
    worksheet.getCell("A1").alignment = { vertical: "middle", indent: 1 };
    worksheet.addRow([`Generated ${draw.createdAt} · ${draw.playerCount} players · ${draw.bracketSize}-place bracket`]);
    worksheet.mergeCells("A2:K2");
    worksheet.getCell("A2").font = { color: { argb: "FF607568" }, italic: true };
    const header = worksheet.addRow(["Round", "Match", "Player 1", "Institute 1", "Seed 1", "Player 2", "Institute 2", "Seed 2", "Winner", "Score", "Status"]);
    header.height = 24;
    header.eachCell(cell => {
        cell.font = { bold: true, color: { argb: "FF173228" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDDF1BE" } };
        cell.alignment = { vertical: "middle" };
    });
    for (const match of draw.rounds.flat()) {
        const [a, b] = match.players;
        const winner = match.players.find(player => player && player.id === match.winnerId);
        const display = player => player ? player.name : match.round === 1 ? "BYE" : "TBD";
        const row = worksheet.addRow([
            match.roundName, match.number, display(a), a?.institute || "", a?.seed || "",
            display(b), b?.institute || "", b?.seed || "", winner?.name || "",
            match.score, match.automatic ? "Automatic" : match.complete ? "Complete" : "Pending"
        ]);
        if (row.number % 2 === 0) {
            row.eachCell({ includeEmpty: true }, cell => {
                cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F8F2" } };
            });
        }
    }
    worksheet.autoFilter = { from: "A3", to: `K${worksheet.rowCount}` };
    if (draw.schedule) {
        const schedule = workbook.addWorksheet("Schedule", { views: [{ state: "frozen", ySplit: 1 }] });
        schedule.columns = [25, 25, 10, 10, 18, 24, 24, 14, 25, 25].map(width => ({ width }));
        const heading = schedule.addRow(["Scheduled start (UTC)", "Scheduled end (UTC)", "Court", "Match", "Round",
            "Player 1", "Player 2", "Status", "Actual start (UTC)", "Actual finish (UTC)"]);
        heading.eachCell(cell => {
            cell.font = { bold: true, color: { argb: "FF173228" } };
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDDF1BE" } };
        });
        const matches = new Map(draw.rounds.flat().map(match => [match.number, match]));
        for (const entry of [...draw.schedule.matches].sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt) || a.court - b.court)) {
            const match = matches.get(entry.matchNumber);
            schedule.addRow([entry.startAt, entry.endAt, entry.court, match.number, match.roundName,
                match.players[0]?.name || "TBD", match.players[1]?.name || "TBD",
                entry.finishedAt ? "Finished" : entry.startedAt ? "Ongoing" : "Scheduled",
                entry.startedAt || "", entry.finishedAt || ""]);
        }
        schedule.autoFilter = { from: "A1", to: `J${schedule.rowCount}` };
    }
    return workbook.xlsx.writeBuffer();
}

module.exports = { exportDraw };
