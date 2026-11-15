(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.matchSearch = factory();
})(globalThis, function () {
    function normalize(value) {
        return String(value ?? "").normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
    }

    function matches(match, entry, query) {
        const term = normalize(query);
        if (!term) return true;
        const fields = match.players.flatMap(player => player ? [player.name, player.institute] : []);
        fields.push(String(match.number), `#${match.number}`, `match ${match.number}`, `match${match.number}`);
        if (entry?.court != null) fields.push(`court ${entry.court}`, `court ${entry.court}`.replace(" ", ""));
        return fields.some(field => normalize(field).includes(term));
    }

    return { matches };
});
