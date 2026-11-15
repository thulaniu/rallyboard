function roundName(round, total) {
    const remaining = total - round;
    if (remaining === 0) return "Final";
    if (remaining === 1) return "Semi-final";
    if (remaining === 2) return "Quarter-final";
    return `Round ${round}`;
}

function createMatches(slots) {
    const total = Math.log2(slots.length);
    const rounds = [];
    let number = 1;
    for (let round = 1; round <= total; round++) {
        const matches = [];
        for (let index = 0; index < slots.length / (2 ** round); index++) {
            matches.push({
                number: number++, round, roundName: roundName(round, total),
                players: round === 1 ? [slots[index * 2], slots[index * 2 + 1]] : [null, null],
                winnerId: null, score: "", complete: false, automatic: false
            });
        }
        rounds.push(matches);
    }
    return updateMatches(rounds);
}

function updateMatches(rounds) {
    for (let round = 0; round < rounds.length; round++) {
        for (let index = 0; index < rounds[round].length; index++) {
            const match = rounds[round][index];
            let ready = true;
            if (round > 0) {
                const sources = rounds[round - 1].slice(index * 2, index * 2 + 2);
                ready = sources.every(source => source.complete);
                const players = sources.map(source => source.complete
                    ? source.players.find(player => player && player.id === source.winnerId) || null
                    : null);
                if (players.some((player, i) => player?.id !== match.players[i]?.id)) {
                    match.winnerId = null;
                    match.score = "";
                }
                match.players = players;
            }
            const present = match.players.filter(Boolean);
            if (!ready) {
                match.complete = false;
                match.automatic = false;
                match.winnerId = null;
                match.score = "";
            } else if (present.length < 2) {
                match.winnerId = present[0]?.id || null;
                match.score = "";
                match.complete = true;
                match.automatic = true;
            } else {
                if (!present.some(player => player.id === match.winnerId)) {
                    match.winnerId = null;
                    match.score = "";
                }
                match.complete = Boolean(match.winnerId);
                match.automatic = false;
            }
        }
    }
    return rounds;
}

function recordResult(rounds, matchNumber, winnerId, score) {
    const match = rounds.flat().find(item => item.number === matchNumber);
    if (!match) throw new Error("Match not found.");
    if (match.automatic || match.players.filter(Boolean).length !== 2) {
        throw new Error("This match is not ready for a result.");
    }
    if (winnerId !== null && !match.players.some(player => player.id === winnerId)) {
        throw new Error("Winner must be one of the match players.");
    }
    match.winnerId = winnerId;
    match.score = winnerId ? score : "";
    updateMatches(rounds);
}

module.exports = { createMatches, updateMatches, recordResult };
