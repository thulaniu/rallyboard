"use strict";

const $ = id => document.getElementById(id);
const fragment = location.hash.slice(1);
const tournamentLink = fragment.startsWith("t/");
const token = tournamentLink ? fragment.slice(2) : fragment;
let inFlight = false;
let revoked = false;
let currentDraw = null;
let tournamentDraws = [];
let participantPage = "draw";

function showPage(name) {
    participantPage = name;
    for (const page of ["draw", "schedule"]) {
        $(`participant-${page}-page`).classList.toggle("hidden", page !== name);
        const button = $(`participant-nav-${page}`);
        if (page === name) button.setAttribute("aria-current", "page");
        else button.removeAttribute("aria-current");
    }
}

$("participant-nav-draw").addEventListener("click", () => showPage("draw"));
$("participant-nav-schedule").addEventListener("click", () => showPage("schedule"));
$("participant-search").addEventListener("input", () => { if (currentDraw) render(currentDraw); });
$("participant-draw-select").addEventListener("change", event => {
    const draw = tournamentDraws.find(item => item.id === event.currentTarget.value);
    if (draw) {
        $("participant-search").value = "";
        render(draw);
    }
});
showPage(participantPage);

function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (className) node.className = className;
    return node;
}

function time(value) {
    return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function render(draw) {
    currentDraw = draw;
    $("participant-content").classList.remove("hidden");
    $("participant-title").textContent = draw.name;
    $("participant-meta").textContent = `${draw.playerCount} players · ${draw.bracketSize}-place bracket · ${draw.schedule.courts} courts`;
    const pace = draw.schedule.progress;
    const paceElement = $("participant-pace");
    paceElement.classList.toggle("hidden", !pace || pace.status === "unavailable");
    if (pace && pace.status !== "unavailable") {
        const total = Math.ceil(Math.abs(pace.differenceMs) / 60000);
        const duration = [Math.floor(total / 60) ? `${Math.floor(total / 60)} hr` : "", total % 60 ? `${total % 60} min` : ""].filter(Boolean).join(" ");
        paceElement.textContent = `${pace.status === "on-time" ? "On schedule" : `${duration} ${pace.status} schedule`} · ${pace.finished ? "Finished" : "Estimated finish"}: ${time(pace.projectedFinishAt)}`;
    }

    const matches = new Map(draw.rounds.flat().map(match => [match.number, match]));
    const groups = { Ongoing: [], Upcoming: [], Previous: [] };
    const scheduled = new Set();
    const query = $("participant-search").value;
    for (const entry of [...draw.schedule.matches].sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt) || a.court - b.court)) {
        const match = matches.get(entry.matchNumber);
        if (!match) continue;
        scheduled.add(match.number);
        if (!matchSearch.matches(match, entry, query)) continue;
        groups[entry.finishedAt ? "Previous" : entry.startedAt ? "Ongoing" : "Upcoming"].push({ match, entry });
    }
    for (const match of draw.rounds.flat()) {
        if (match.complete && !match.automatic && !scheduled.has(match.number) && matchSearch.matches(match, null, query)) groups.Previous.push({ match, entry: null });
    }
    const schedule = $("participant-schedule");
    schedule.replaceChildren();
    for (const [name, items] of Object.entries(groups)) {
        const section = element("section", null, "participant-group");
        section.append(element("h3", `${name} matches`, "schedule-group-title"));
        if (!items.length) section.append(element("p", query.trim() ? "No matching matches." : "No matches.", "fineprint"));
        for (const { match, entry } of items) {
            const row = element("article", null, "participant-match");
            const players = match.players.map(player => player?.name || "To be decided").join(" vs ");
            row.append(element("strong", players));
            const state = match.complete ? "Finished" : entry?.startedAt ? "Ongoing" : "Upcoming";
            row.append(element("span", `${match.roundName} · Match ${match.number} · ${state}`, "participant-match-meta"));
            row.append(element("span", entry ? `${time(entry.startAt)} · Court ${entry.court}` : "Time and court not recorded", "participant-match-meta"));
            if (match.complete) {
                const winner = match.players[match.winnerIndex];
                row.append(element("span", `${winner ? `Winner: ${winner.name}` : "Result recorded"}${match.score ? ` · ${match.score}` : ""}`, "participant-result"));
            }
            section.append(row);
        }
        schedule.append(section);
    }
    const rounds = $("participant-rounds");
    rounds.replaceChildren();
    let visibleMatches = 0;
    for (const round of draw.rounds) {
        const column = element("section", null, "round");
        column.append(element("h3", round[0].roundName));
        let visibleInRound = 0;
        for (const match of round) {
            const entry = draw.schedule.matches.find(item => item.matchNumber === match.number);
            if (!matchSearch.matches(match, entry, query)) continue;
            visibleMatches++;
            visibleInRound++;
            const card = element("article", null, "match");
            const display = matchDisplay.details(match, entry);
            card.append(element("div", `MATCH ${match.number} · ${display.status}`, "match-header"));
            card.append(element("p", display.schedule, "match-schedule"));
            match.players.forEach((player, index) => {
                const row = element("div", null, `player${index === match.winnerIndex ? " winner" : ""}`);
                const details = element("div", player?.name || (match.round === 1 ? "BYE" : "To be decided"));
                if (player) details.append(element("small", player.institute));
                row.append(details);
                if (player?.seed) row.append(element("span", `#${player.seed}`));
                card.append(row);
            });
            if (match.score) card.append(element("p", `Score: ${match.score}`, "fineprint"));
            column.append(card);
        }
        if (visibleInRound) rounds.append(column);
    }
    $("participant-draw-no-results").classList.toggle("hidden", !query.trim() || visibleMatches > 0);
}

async function refresh() {
    if (inFlight || revoked || document.hidden) return;
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
        $("participant-error").textContent = "This participant link is invalid. Ask your organizer for a current link.";
        $("participant-error").classList.remove("hidden");
        return;
    }
    inFlight = true;
    try {
        const response = await fetch(tournamentLink ? "/api/participant/tournament" : "/api/participant/draw", {
            headers: { Authorization: `Bearer ${token}` }, cache: "no-store", credentials: "omit"
        });
        if (response.status === 404) {
            revoked = true;
            currentDraw = null;
            $("participant-content").classList.add("hidden");
            $("participant-tournament").classList.add("hidden");
            throw new Error("This link is unavailable or has been revoked. Ask your organizer for a current link.");
        }
        if (!response.ok) throw new Error(`Unable to update the dashboard (HTTP ${response.status}). Please try again.`);
        const data = await response.json();
        if (tournamentLink) {
            tournamentDraws = data.draws;
            $("participant-tournament").classList.remove("hidden");
            $("participant-tournament-title").textContent = data.name;
            const select = $("participant-draw-select");
            const selected = select.value;
            select.replaceChildren();
            for (const draw of tournamentDraws) select.add(new Option(draw.name, draw.id));
            const chosen = tournamentDraws.find(draw => draw.id === selected) || tournamentDraws[0];
            $("participant-tournament-empty").classList.toggle("hidden", Boolean(chosen));
            $("participant-tournament-select-wrap").classList.toggle("hidden", !chosen);
            if (chosen) {
                if (selected && selected !== chosen.id) $("participant-search").value = "";
                select.value = chosen.id;
                render(chosen);
            } else {
                currentDraw = null;
                $("participant-content").classList.add("hidden");
            }
        } else render(data);
        $("participant-error").classList.add("hidden");
    } catch (error) {
        $("participant-error").textContent = error.message;
        $("participant-error").classList.remove("hidden");
    } finally {
        inFlight = false;
    }
}

document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
refresh();
setInterval(refresh, 30000);
