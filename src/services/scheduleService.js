const MINUTE = 60 * 1000;
const REST = 20 * MINUTE;

class ScheduleError extends Error {}

function configureSchedule(draw, startAt, courts, now = Date.now()) {
    if (typeof startAt !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(startAt) ||
        !Number.isFinite(Date.parse(startAt))) {
        throw new ScheduleError("Select a valid start date and time.");
    }
    if (!Number.isInteger(courts) || courts < 1 || courts > 32) {
        throw new ScheduleError("Choose between 1 and 32 courts.");
    }
    if (draw.schedule?.matches.some(match => match.startedAt)) {
        throw new ScheduleError("A schedule cannot be replaced after a match has started.");
    }
    const hasPreviousResults = draw.rounds.flat().some(match => match.complete && !match.automatic);
    const candidate = {
        ...draw,
        schedule: {
            startAt: new Date(startAt).toISOString(), courts, matches: [],
            ...(hasPreviousResults ? { earliestStartAt: new Date(now + REST).toISOString() } : {})
        }
    };
    refreshSchedule(candidate, now);
    for (const entry of candidate.schedule.matches) {
        entry.originalStartAt = entry.startAt;
    }
    const finish = Math.max(...candidate.schedule.matches.map(entry => Date.parse(entry.endAt)));
    if (!Number.isFinite(finish)) throw new ScheduleError("There are no remaining matches to schedule.");
    candidate.schedule.originalFinishAt = new Date(finish).toISOString();
    draw.schedule = candidate.schedule;
}

function refreshSchedule(draw, now = Date.now()) {
    if (!draw.schedule) return;
    const schedule = draw.schedule;
    const old = new Map(schedule.matches.map(entry => [entry.matchNumber, entry]));
    const courtFree = Array(schedule.courts).fill(Date.parse(schedule.startAt));
    const lastPlayed = new Map();
    const matches = [];
    const outcomes = [];

    // Reserve all actual court usage before planning pending matches.
    for (const entry of schedule.matches) {
        if (!entry.startedAt) continue;
        const end = entry.finishedAt ? Date.parse(entry.finishedAt) :
            Math.max(Date.parse(entry.startedAt) + entry.durationMinutes * MINUTE, now + MINUTE);
        courtFree[entry.court - 1] = Math.max(courtFree[entry.court - 1], end);
    }

    for (let roundIndex = 0; roundIndex < draw.rounds.length; roundIndex++) {
        const current = [];
        for (let index = 0; index < draw.rounds[roundIndex].length; index++) {
            const match = draw.rounds[roundIndex][index];
            const sides = roundIndex === 0
                ? match.players.map(player => player ? [player.id] : [])
                : outcomes[roundIndex - 1].slice(index * 2, index * 2 + 2);
            const possible = [...new Set(sides.flat())];
            const previous = old.get(match.number);
            if (sides.every(side => side.length) && (!match.complete || previous?.startedAt)) {
                const durationMinutes = match.round === 1 ? 15 : 20;
                let entry;
                if (previous?.startedAt) {
                    entry = { ...previous, durationMinutes };
                } else {
                    const ready = Math.max(Date.parse(schedule.startAt),
                        schedule.earliestStartAt ? Date.parse(schedule.earliestStartAt) : 0,
                        previous ? Date.parse(previous.startAt) : 0,
                        ...possible.map(id => lastPlayed.has(id) ? lastPlayed.get(id) + REST : 0));
                    let court = 0;
                    for (let i = 1; i < courtFree.length; i++) {
                        if (Math.max(ready, courtFree[i]) < Math.max(ready, courtFree[court])) court = i;
                    }
                    const start = Math.max(ready, courtFree[court]);
                    entry = {
                        matchNumber: match.number, court: court + 1,
                        startAt: new Date(start).toISOString(),
                        endAt: new Date(start + durationMinutes * MINUTE).toISOString(),
                        ...(previous?.originalStartAt ? { originalStartAt: previous.originalStartAt } : {}),
                        durationMinutes, startedAt: null, finishedAt: null
                    };
                    courtFree[court] = start + durationMinutes * MINUTE;
                }
                const end = entry.finishedAt ? Date.parse(entry.finishedAt) : entry.startedAt
                    ? Math.max(Date.parse(entry.startedAt) + durationMinutes * MINUTE, now + MINUTE)
                    : Date.parse(entry.endAt);
                for (const id of possible) lastPlayed.set(id, end);
                matches.push(entry);
            }
            current.push(match.complete && match.winnerId ? [match.winnerId] : possible);
        }
        outcomes.push(current);
    }
    schedule.matches = matches;
}

function startMatch(draw, number, now = Date.now(), selectedCourt) {
    if (!draw.schedule) throw new ScheduleError("Create a schedule before starting a match.");
    refreshSchedule(draw, now);
    const match = draw.rounds.flat().find(item => item.number === number);
    const entry = draw.schedule.matches.find(item => item.matchNumber === number);
    if (!match || !entry) throw new ScheduleError("Scheduled match not found.");
    const court = selectedCourt === undefined ? entry.court : selectedCourt;
    if (!Number.isInteger(court) || court < 1 || court > draw.schedule.courts) {
        throw new ScheduleError("Choose a valid court.");
    }
    if (entry.startedAt || match.complete || match.automatic || !match.players.every(Boolean)) {
        throw new ScheduleError("This match is not ready to start.");
    }
    if (now < Date.parse(entry.startAt)) throw new ScheduleError("This match cannot start before its scheduled time.");
    if (draw.schedule.matches.some(item => item.court === court && item.startedAt && !item.finishedAt)) {
        throw new ScheduleError("This court has an ongoing match.");
    }
    const ids = new Set(match.players.map(player => player.id));
    for (const item of draw.schedule.matches) {
        if (!item.startedAt || item.matchNumber === number) continue;
        const other = draw.rounds.flat().find(candidate => candidate.number === item.matchNumber);
        if (!other.players.some(player => player && ids.has(player.id))) continue;
        if (!item.finishedAt) throw new ScheduleError("A player is already playing another match.");
        if (now < Date.parse(item.finishedAt) + REST) {
            throw new ScheduleError("Players must rest at least 20 minutes after their previous match.");
        }
    }
    entry.court = court;
    entry.startedAt = new Date(now).toISOString();
    refreshSchedule(draw, now);
}

function finishMatch(draw, number, winnerId, now = Date.now()) {
    if (!draw.schedule) return;
    const entry = draw.schedule.matches.find(item => item.matchNumber === number);
    const match = draw.rounds.flat().find(item => item.number === number);
    if (!entry && match?.complete && !match.automatic) {
        if (winnerId !== match.winnerId) {
            throw new ScheduleError("Cannot change a result recorded before the schedule was created.");
        }
        return;
    }
    if (!entry?.startedAt) throw new ScheduleError("Start this match before saving its result.");
    if (!winnerId) throw new ScheduleError("Choose a winner to finish a scheduled match.");
    if (!entry.finishedAt) entry.finishedAt = new Date(now).toISOString();
}

function assertResultChangeAllowed(draw, number, winnerId) {
    if (!draw.schedule) return;
    const rounds = draw.rounds;
    const roundIndex = rounds.findIndex(round => round.some(match => match.number === number));
    if (roundIndex < 0) return;
    let index = rounds[roundIndex].findIndex(match => match.number === number);
    if (rounds[roundIndex][index].winnerId === winnerId) return;
    for (let round = roundIndex + 1; round < rounds.length; round++) {
        index = Math.floor(index / 2);
        const dependent = rounds[round][index];
        if (draw.schedule.matches.some(entry => entry.matchNumber === dependent.number && entry.startedAt)) {
            throw new ScheduleError("Cannot change this winner because a later match has already started.");
        }
    }
}

function getScheduleProgress(draw, now = Date.now()) {
    if (!draw.schedule) return null;
    const baseline = Date.parse(draw.schedule.originalFinishAt);
    if (!Number.isFinite(baseline)) return { status: "unavailable" };
    // Project overdue unstarted matches from now without changing the saved schedule.
    const projected = {
        ...draw,
        schedule: {
            ...draw.schedule,
            matches: draw.schedule.matches.map(entry => entry.startedAt ? { ...entry } : {
                ...entry, startAt: new Date(Math.max(Date.parse(entry.startAt), now)).toISOString()
            })
        }
    };
    refreshSchedule(projected, now);
    const projectedFinish = Math.max(...projected.schedule.matches.map(entry =>
        entry.finishedAt ? Date.parse(entry.finishedAt) : entry.startedAt
            ? Math.max(Date.parse(entry.startedAt) + entry.durationMinutes * MINUTE, now + MINUTE)
            : Date.parse(entry.endAt)));
    if (!Number.isFinite(projectedFinish)) return { status: "unavailable" };
    const differenceMs = projectedFinish - baseline;
    return {
        status: differenceMs < 0 ? "ahead" : differenceMs > 0 ? "behind" : "on-time",
        differenceMs,
        originalFinishAt: draw.schedule.originalFinishAt,
        projectedFinishAt: new Date(projectedFinish).toISOString(),
        finished: projected.schedule.matches.length > 0 && projected.schedule.matches.every(entry => entry.finishedAt)
    };
}

module.exports = { ScheduleError, configureSchedule, refreshSchedule, startMatch, finishMatch, assertResultChangeAllowed, getScheduleProgress };
