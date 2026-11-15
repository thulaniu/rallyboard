function participantDraw(draw) {
    const player = value => value ? {
        name: value.name, institute: value.institute, seed: value.seed
    } : null;
    return {
        name: draw.name,
        playerCount: draw.playerCount,
        bracketSize: draw.bracketSize,
        rounds: draw.rounds.map(round => round.map(match => ({
            number: match.number,
            round: match.round,
            roundName: match.roundName,
            players: match.players.map(player),
            winnerIndex: match.winnerId == null ? null : match.players.findIndex(item => item?.id === match.winnerId),
            score: match.score,
            complete: match.complete,
            automatic: match.automatic
        }))),
        schedule: draw.schedule ? {
            startAt: draw.schedule.startAt,
            courts: draw.schedule.courts,
            progress: draw.schedule.progress,
            matches: draw.schedule.matches.map(entry => ({
                matchNumber: entry.matchNumber,
                court: entry.court,
                startAt: entry.startAt,
                endAt: entry.endAt,
                startedAt: entry.startedAt,
                finishedAt: entry.finishedAt
            }))
        } : null
    };
}

module.exports = { participantDraw };
