(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.matchDisplay = factory();
})(globalThis, function () {
    function details(match, entry, showOriginal = false) {
        const status = match.automatic ? "BYE / ADVANCE" : match.complete ? "COMPLETE" :
            entry?.startedAt ? "ONGOING" : "PENDING";
        if (!entry) {
            return {
                status,
                schedule: match.automatic ? "No match scheduled (bye)" :
                    match.complete ? "Time and court not recorded" : "Not scheduled yet"
            };
        }
        const format = value => new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
        const lines = [`Scheduled: ${format(entry.startAt)}`, `Court ${entry.court}`];
        if (showOriginal) {
            lines.push(entry.originalStartAt ? `Original: ${format(entry.originalStartAt)}` :
                "Original: Unavailable for this older schedule");
        }
        return { status, schedule: lines.join("\n") };
    }

    return { details };
});
