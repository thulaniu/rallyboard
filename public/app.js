"use strict";

const $ = id => document.getElementById(id);
let worksheetData = null;
let currentDraw = null;

function currentPage() {
    return location.hash.split("/")[0] === "#schedule" ? "schedule" : "draw";
}

function updateNavigation() {
    const page = currentPage();
    $("draw-page").classList.toggle("hidden", page !== "draw");
    $("schedule-page").classList.toggle("hidden", page !== "schedule");
    for (const name of ["draw", "schedule"]) {
        const link = $(`nav-${name}`);
        link.href = `#${name}${currentDraw ? `/${currentDraw.id}` : ""}`;
        if (name === page) link.setAttribute("aria-current", "page");
        else link.removeAttribute("aria-current");
    }
}

window.addEventListener("hashchange", async () => {
    const id = location.hash.split("/")[1];
    if (id && id !== currentDraw?.id) {
        try { showDraw(await api(`/api/draws/${encodeURIComponent(id)}`)); }
        catch (error) { notice(error.message); }
    }
    updateNavigation();
});

async function api(url, options = {}) {
    const response = await fetch(url, {
        ...options,
        headers: options.body ? { "Content-Type": "application/json" } : {}
    });
    if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
        throw new Error(response.status === 404
            ? "The server does not support this request. Restart the application to load the latest version, then sign in again."
            : `The server returned an unexpected response (HTTP ${response.status}). Check the server and try again.`);
    }
    let result;
    try {
        result = await response.json();
    } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        throw new Error("The server returned invalid JSON. Check the server logs and try again.");
    }
    if (!response.ok) throw new Error([result.error, ...(result.details || [])].join("\n"));
    return result;
}

function notice(message) {
    $("notice").textContent = message;
    $("notice").classList.toggle("hidden", !message);
}

async function action(button, handler) {
    button.disabled = true;
    notice("");
    try { await handler(); } catch (error) { notice(error.message); }
    finally {
        button.disabled = button.id === "schedule-save" &&
            Boolean(currentDraw?.schedule?.matches.some(entry => entry.startedAt));
        if (button.id === "share-toggle") button.disabled = Boolean(currentDraw && !currentDraw.shareToken && !currentDraw.schedule);
        if (button.id === "reminder-toggle" && currentDraw) renderReminders(currentDraw);
    }
}

function fillSelect(select, options, placeholder) {
    select.replaceChildren();
    if (placeholder) select.add(new Option(placeholder, ""));
    options.forEach(([label, value]) => select.add(new Option(label, value)));
}

async function refreshDraws() {
    const draws = await api("/api/draws");
    const list = $("draw-list");
    list.replaceChildren();
    if (!draws.length) {
        const message = document.createElement("p");
        message.className = "fineprint";
        message.textContent = "No saved draws yet.";
        list.append(message);
    }
    for (const draw of draws) {
        const button = document.createElement("button");
        button.className = "draw-item";
        const title = document.createElement("strong");
        title.textContent = draw.name;
        const meta = document.createElement("small");
        meta.textContent = `${draw.playerCount} players · ${new Date(draw.createdAt).toLocaleDateString()}`;
        button.append(title, meta);
        button.addEventListener("click", () => action(button, async () => {
            showDraw(await api(`/api/draws/${draw.id}`));
            location.hash = `#${currentPage()}/${draw.id}`;
        }));
        list.append(button);
    }
}

function showDraw(draw) {
    if (currentDraw?.id !== draw.id) {
        $("organizer-search").value = "";
        $("reminder-sheet").value = "";
        $("reminder-mapping").classList.add("hidden");
        $("reminder-columns").classList.add("hidden");
    }
    currentDraw = draw;
    $("empty-bracket").classList.add("hidden");
    $("draw-view").classList.remove("hidden");
    $("draw-title").textContent = draw.name;
    $("draw-meta").textContent = `${draw.playerCount} players  /  ${draw.bracketSize}-place bracket`;
    $("export").href = `/api/draws/${draw.id}/export`;
    renderSharing(draw);
    renderReminders(draw);
    const warnings = [...draw.warnings];
    if (draw.institutePenalty) warnings.push("Some players from the same institute could meet in the first three rounds. The draw uses the best balance found, not a guaranteed optimum.");
    $("draw-warning").textContent = warnings.join(" ");
    $("draw-warning").classList.toggle("hidden", !warnings.length);
    const rounds = $("rounds");
    rounds.replaceChildren();
    for (const round of draw.rounds) {
        const column = document.createElement("section");
        column.className = "round";
        const heading = document.createElement("h3");
        heading.textContent = round[0].roundName;
        column.append(heading);
        round.forEach(match => column.append(renderMatch(match)));
        rounds.append(column);
    }
    renderSchedule(draw);
    applyMatchFilter();
    updateNavigation();
    if (draw.schedule) {
        const start = new Date(draw.schedule.startAt);
        const local = new Date(start.getTime() - start.getTimezoneOffset() * 60000);
        $("schedule-start").value = local.toISOString().slice(0, 16);
        $("schedule-courts").value = draw.schedule.courts;
    } else {
        $("schedule-start").value = "";
        $("schedule-courts").value = 4;
    }
}

function applyMatchFilter() {
    const query = $("organizer-search").value;
    let visibleCards = 0;
    for (const column of $("rounds").querySelectorAll(".round")) {
        let visible = 0;
        for (const card of column.querySelectorAll(".match")) {
            const match = currentDraw?.rounds.flat().find(item => item.number === Number(card.dataset.matchNumber));
            const entry = currentDraw?.schedule?.matches.find(item => item.matchNumber === match?.number);
            const show = Boolean(match && matchSearch.matches(match, entry, query));
            card.hidden = !show;
            if (show) visible++;
        }
        column.hidden = visible === 0;
        visibleCards += visible;
    }
    $("draw-no-results").classList.toggle("hidden", !query.trim() || visibleCards > 0);
    for (const id of ["ongoing-rows", "upcoming-rows", "previous-rows"]) {
        const rows = $(id);
        const dataRows = [...rows.querySelectorAll("tr[data-match-number]")];
        let visible = 0;
        for (const row of dataRows) {
            const match = currentDraw?.rounds.flat().find(item => item.number === Number(row.dataset.matchNumber));
            const entry = currentDraw?.schedule?.matches.find(item => item.matchNumber === match?.number);
            const show = Boolean(match && matchSearch.matches(match, entry, query));
            row.hidden = !show;
            if (show) visible++;
        }
        let empty = rows.querySelector(".search-empty");
        if (!empty) {
            empty = rows.insertRow();
            empty.className = "search-empty";
            empty.insertCell().colSpan = 5;
        }
        empty.hidden = visible > 0;
        empty.cells[0].textContent = query.trim() ? "No matching matches." : "No matches.";
    }
}

$("organizer-search").addEventListener("input", applyMatchFilter);

function renderReminders(draw) {
    const status = draw.reminderStatus;
    const button = $("reminder-toggle");
    if (!status) {
        button.textContent = "Enable SMS reminders";
        button.disabled = true;
        $("reminder-description").textContent = "Restart the application server to enable SMS reminder settings.";
        return;
    }
    button.textContent = status.enabled ? "Disable SMS reminders" : "Enable SMS reminders";
    button.disabled = !status.enabled && (!status.configured || !draw.schedule || !status.eligible);
    const availability = status.configured ? "" : " Twilio is not configured on the server.";
    const failures = status.uncertain ? ` ${status.uncertain} message attempt(s) could not be confirmed and will not be retried automatically; check Twilio.` : "";
    $("reminder-description").textContent =
        `${status.enabled ? "Enabled" : "Disabled"} · ${status.eligible} opted-in participant(s) · ${status.accepted} message(s) accepted by Twilio.${availability}${failures}`;
}

$("reminder-load-sheet").addEventListener("click", event => action(event.currentTarget, async () => {
    $("reminder-mapping").classList.add("hidden");
    $("reminder-columns").classList.add("hidden");
    const query = new URLSearchParams({ id: $("reminder-sheet").value });
    const data = await api(`/api/sheets?${query}`);
    fillSelect($("reminder-worksheet"), data.worksheets.map(name => [name, name]), "Choose a worksheet");
    $("reminder-mapping").classList.remove("hidden");
}));
$("reminder-load-columns").addEventListener("click", event => action(event.currentTarget, async () => {
    $("reminder-columns").classList.add("hidden");
    const query = new URLSearchParams({ id: $("reminder-sheet").value, worksheet: $("reminder-worksheet").value });
    const data = await api(`/api/sheets/columns?${query}`);
    const options = data.headers.map((header, index) => [`${header || "(unnamed column)"} · column ${index + 1}`, String(index)]);
    for (const id of ["reminder-name", "reminder-institute", "reminder-phone", "reminder-consent"]) {
        fillSelect($(id), options, "Choose a column");
    }
    $("reminder-columns").classList.remove("hidden");
}));
$("reminder-sheet").addEventListener("input", () => $("reminder-mapping").classList.add("hidden"));
$("reminder-worksheet").addEventListener("change", () => $("reminder-columns").classList.add("hidden"));
$("reminder-import").addEventListener("click", event => action(event.currentTarget, async () => {
    const index = id => $(id).value === "" ? null : Number($(id).value);
    const draw = await api(`/api/draws/${currentDraw.id}/reminders/contacts`, {
        method: "POST",
        body: JSON.stringify({
            sheet: $("reminder-sheet").value, worksheet: $("reminder-worksheet").value,
            mapping: { name: index("reminder-name"), institute: index("reminder-institute"),
                phone: index("reminder-phone"), consent: index("reminder-consent") }
        })
    });
    showDraw(draw);
}));
$("reminder-toggle").addEventListener("click", event => action(event.currentTarget, async () => {
    const enabled = !currentDraw.reminderStatus.enabled;
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (enabled && !confirm(`Enable paid SMS reminders using time zone ${timeZone}? Only opted-in participants will be messaged.`)) return;
    showDraw(await api(`/api/draws/${currentDraw.id}/reminders`, {
        method: "PUT", body: JSON.stringify({ enabled, timeZone })
    }));
}));

function renderSharing(draw) {
    const published = Boolean(draw.shareToken);
    $("share-toggle").textContent = published ? "Unpublish draw" : "Publish draw";
    $("share-toggle").disabled = !published && !draw.schedule;
    $("share-description").textContent = published
        ? "This draw is available to anyone with its link."
        : draw.schedule ? "Publish to create a private viewing link." : "Create a schedule before publishing.";
    $("share-link-wrap").classList.toggle("hidden", !published);
    $("share-link").value = published ? `${location.origin}/participant.html#${draw.shareToken}` : "";
}

$("share-toggle").addEventListener("click", event => {
    const published = Boolean(currentDraw?.shareToken);
    if (published && !confirm("Unpublish this draw? The current participant link will stop working.")) return;
    action(event.currentTarget, async () => {
        const draw = await api(`/api/draws/${currentDraw.id}/share`, { method: published ? "DELETE" : "POST", body: "{}" });
        showDraw(draw);
    });
});

$("share-copy").addEventListener("click", event => action(event.currentTarget, async () => {
    if (!navigator.clipboard) throw new Error("Copy is unavailable here. Select the link and copy it manually.");
    await navigator.clipboard.writeText($("share-link").value);
    $("share-description").textContent = "Link copied. Share it only with intended participants.";
}));

function renderMatch(match) {
    const card = document.createElement("article");
    card.className = "match";
    card.dataset.matchNumber = match.number;
    const header = document.createElement("div");
    header.className = "match-header";
    const number = document.createElement("span");
    number.textContent = `MATCH ${match.number}`;
    const status = document.createElement("span");
    const scheduled = currentDraw.schedule?.matches.find(entry => entry.matchNumber === match.number);
    const display = matchDisplay.details(match, scheduled, true);
    status.className = "match-status";
    status.textContent = display.status;
    header.append(number, status);
    card.append(header);
    const time = document.createElement("p");
    time.className = "match-schedule";
    time.textContent = display.schedule;
    card.append(time);
    for (const player of match.players) {
        const row = document.createElement("div");
        row.className = `player${player && player.id === match.winnerId ? " winner" : ""}`;
        const info = document.createElement("div");
        info.textContent = player ? player.name : match.round === 1 ? "BYE" : "To be decided";
        if (player) {
            const institute = document.createElement("small");
            institute.textContent = player.institute;
            info.append(institute);
        }
        row.append(info);
        if (player?.seed) {
            const seed = document.createElement("span");
            seed.textContent = `#${player.seed}`;
            row.append(seed);
        }
        card.append(row);
    }
    if (scheduled && !scheduled.startedAt && !match.automatic && match.players.every(Boolean)) {
        const court = document.createElement("select");
        court.setAttribute("aria-label", `Court for match ${match.number}`);
        fillSelect(court, Array.from({ length: currentDraw.schedule.courts }, (_, index) =>
            [`Court ${index + 1}`, String(index + 1)]));
        court.value = String(scheduled.court);
        court.dataset.initialValue = court.value;
        const button = document.createElement("button");
        button.className = "button primary full";
        button.textContent = "Start match";
        button.addEventListener("click", () => action(button, async () => {
            showDraw(await api(`/api/draws/${currentDraw.id}/matches/${match.number}/start`, {
                method: "POST", body: JSON.stringify({ court: Number(court.value) })
            }));
        }));
        card.append(court, button);
    }
    if (!match.automatic && match.players.every(Boolean) && (!currentDraw.schedule || scheduled?.startedAt || match.complete)) {
        const form = document.createElement("form");
        const select = document.createElement("select");
        select.setAttribute("aria-label", `Winner of match ${match.number}`);
        fillSelect(select, match.players.map(player => [player.name, player.id]), "Select winner");
        select.value = match.winnerId || "";
        select.dataset.initialValue = select.value;
        const score = document.createElement("input");
        score.placeholder = "Score (optional)";
        score.setAttribute("aria-label", `Score for match ${match.number}`);
        score.maxLength = 100;
        score.value = match.score;
        score.dataset.initialValue = score.value;
        const button = document.createElement("button");
        button.className = "button secondary full";
        button.textContent = "Save result";
        form.append(select, score, button);
        form.addEventListener("submit", event => {
            event.preventDefault();
            if (match.winnerId && select.value !== match.winnerId &&
                !confirm("Changing this result may clear later match results. Continue?")) return;
            action(button, async () => {
                const updated = await api(`/api/draws/${currentDraw.id}/matches/${match.number}`, {
                    method: "PUT", body: JSON.stringify({ winnerId: select.value || null, score: score.value })
                });
                showDraw(updated);
            });
        });
        card.append(form);
    }
    return card;
}

function renderSchedule(draw) {
    const schedule = draw.schedule;
    renderScheduleProgress(schedule);
    $("schedule-empty").classList.toggle("hidden", Boolean(schedule));
    $("schedule-table").classList.toggle("hidden", !schedule);
    const locked = Boolean(schedule?.matches.some(entry => entry.startedAt));
    $("schedule-start").disabled = locked;
    $("schedule-courts").disabled = locked;
    $("schedule-save").disabled = locked;
    $("schedule-save").textContent = schedule ? "Update schedule" : "Create schedule";
    const hasPreviousResults = draw.rounds.flat().some(match => match.complete && !match.automatic);
    $("schedule-locked").classList.toggle("hidden", !locked && !hasPreviousResults);
    $("schedule-locked").textContent = locked
        ? "Schedule settings are locked after a scheduled match starts."
        : "Previously saved results will be preserved. Remaining matches will start no earlier than 20 minutes after you save these settings.";
    const groups = { ongoing: $("ongoing-rows"), upcoming: $("upcoming-rows"), previous: $("previous-rows") };
    Object.values(groups).forEach(rows => rows.replaceChildren());
    if (!schedule) return;
    const matches = new Map(draw.rounds.flat().map(match => [match.number, match]));
    const sorted = [...schedule.matches].sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt) || a.court - b.court);
    const format = value => new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    for (const entry of sorted) {
        const match = matches.get(entry.matchNumber);
        const row = document.createElement("tr");
        row.dataset.matchNumber = match.number;
        const winner = match.players.find(player => player?.id === match.winnerId);
        const status = entry.finishedAt
            ? `Finished${winner ? ` · Winner: ${winner.name}` : ""}${match.score ? ` · ${match.score}` : ""}`
            : entry.startedAt ? "Ongoing" : "Scheduled";
        const playerText = match.players.map(player => player?.name || "To be decided").join(" vs ");
        const actual = entry.startedAt ? ` · Started: ${format(entry.startedAt)}${entry.finishedAt ? ` · Finished: ${format(entry.finishedAt)}` : ""}` : "";
        const values = [`${format(entry.startAt)} – ${format(entry.endAt)}${actual}`, `Court ${entry.court}`,
            `${match.roundName} · #${match.number}`, playerText, status];
        for (const text of values) {
            const cell = document.createElement("td");
            cell.textContent = text;
            row.append(cell);
        }
        const group = entry.finishedAt ? "previous" : entry.startedAt ? "ongoing" : "upcoming";
        groups[group].append(row);
    }
    const scheduledNumbers = new Set(schedule.matches.map(entry => entry.matchNumber));
    for (const match of draw.rounds.flat()) {
        if (!match.complete || match.automatic || scheduledNumbers.has(match.number)) continue;
        const row = groups.previous.insertRow();
        row.dataset.matchNumber = match.number;
        const winner = match.players.find(player => player?.id === match.winnerId);
        const values = ["Not recorded", "Not recorded", `${match.roundName} · #${match.number}`,
            match.players.map(player => player?.name || "To be decided").join(" vs "),
            `Finished${winner ? ` · Winner: ${winner.name}` : ""}${match.score ? ` · ${match.score}` : ""}`];
        for (const text of values) row.insertCell().textContent = text;
    }
    applyMatchFilter();
}

function formatDuration(milliseconds) {
    const total = Math.ceil(Math.abs(milliseconds) / 60000);
    const hours = Math.floor(total / 60);
    const minutes = total % 60;
    return [hours && `${hours} hr${hours === 1 ? "" : "s"}`, minutes && `${minutes} min`]
        .filter(Boolean).join(" ");
}

function renderScheduleProgress(schedule) {
    const container = $("schedule-progress");
    container.className = "schedule-progress";
    if (!schedule) {
        container.classList.add("hidden");
        return;
    }
    const progress = schedule.progress;
    if (!progress || progress.status === "unavailable") {
        container.classList.add("progress-unavailable");
        $("progress-title").textContent = "Original schedule unavailable";
        $("progress-message").textContent = "This schedule was created before finish-time tracking was added. If play has not started, update the schedule to establish a baseline; otherwise the original finish cannot be recovered.";
        return;
    }
    container.classList.add(`progress-${progress.status}`);
    const difference = formatDuration(progress.differenceMs);
    $("progress-title").textContent = progress.status === "on-time" ? "On schedule" :
        `${difference} ${progress.status === "ahead" ? "ahead of schedule" : "behind schedule"}`;
    const format = value => new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    const finishLabel = progress.finished ? "Finished" : "Estimated finish";
    const message = progress.finished
        ? "The tournament has finished."
        : progress.status === "behind" ? "Matches are projected to finish later than originally planned." :
            progress.status === "ahead" ? "Matches are projected to finish earlier than originally planned." :
                "Matches are expected to finish on time.";
    $("progress-message").textContent = `${message} ${finishLabel}: ${format(progress.projectedFinishAt)} · Original finish: ${format(progress.originalFinishAt)}.`;
}

$("schedule-form").addEventListener("submit", event => {
    event.preventDefault();
    action($("schedule-save"), async () => {
        const date = new Date($("schedule-start").value);
        if (!Number.isFinite(date.getTime())) throw new Error("Select a valid start date and time.");
        const draw = await api(`/api/draws/${currentDraw.id}/schedule`, {
            method: "PUT",
            body: JSON.stringify({ startAt: date.toISOString(), courts: Number($("schedule-courts").value) })
        });
        showDraw(draw);
    });
});

setInterval(async () => {
    if (!currentDraw?.schedule || document.hidden) return;
    const id = currentDraw.id;
    try {
        const draw = await api(`/api/draws/${id}`);
        if (currentDraw?.id === id) {
            currentDraw = draw;
            renderSchedule(draw);
            renderSharing(draw);
            renderReminders(draw);
            const rounds = $("rounds");
            const hasUnsavedInput = [...rounds.querySelectorAll("[data-initial-value]")]
                .some(input => input.value !== input.dataset.initialValue);
            if (!rounds.contains(document.activeElement) && !hasUnsavedInput) {
                rounds.replaceChildren();
                for (const round of draw.rounds) {
                    const column = document.createElement("section");
                    column.className = "round";
                    const heading = document.createElement("h3");
                    heading.textContent = round[0].roundName;
                    column.append(heading);
                    round.forEach(match => column.append(renderMatch(match)));
                    rounds.append(column);
                }
                applyMatchFilter();
            } else {
                const matches = new Map(draw.rounds.flat().map(match => [match.number, match]));
                const entries = new Map(draw.schedule.matches.map(entry => [entry.matchNumber, entry]));
                for (const card of rounds.querySelectorAll(".match")) {
                    const match = matches.get(Number(card.dataset.matchNumber));
                    if (!match) continue;
                    const display = matchDisplay.details(match, entries.get(match.number), true);
                    card.querySelector(".match-status").textContent = display.status;
                    card.querySelector(".match-schedule").textContent = display.schedule;
                }
            }
        }
    } catch (error) {
        notice(`Unable to refresh the schedule: ${error.message}`);
    }
}, 30000);

$("load-sheet").addEventListener("click", event => action(event.currentTarget, async () => {
    $("mapping").classList.add("hidden");
    $("columns").classList.add("hidden");
    const query = new URLSearchParams({ id: $("sheet").value });
    const data = await api(`/api/sheets?${query}`);
    fillSelect($("worksheet"), data.worksheets.map(name => [name, name]), "Choose a worksheet");
    $("mapping").classList.remove("hidden");
}));

$("load-columns").addEventListener("click", event => action(event.currentTarget, async () => {
    $("columns").classList.add("hidden");
    if (!$("worksheet").value) throw new Error("Choose a worksheet first.");
    const query = new URLSearchParams({ id: $("sheet").value, worksheet: $("worksheet").value });
    worksheetData = await api(`/api/sheets/columns?${query}`);
    const options = worksheetData.headers.map((header, index) => [`${header || "(unnamed column)"} · column ${index + 1}`, String(index)]);
    fillSelect($("name-column"), options, "Choose player name column");
    fillSelect($("institute-column"), options, "Choose institute column");
    fillSelect($("seed-column"), options, "No seed column");
    fillSelect($("event-column"), options, "No event filter");
    $("event-wrap").classList.add("hidden");
    $("row-count").textContent = `${worksheetData.rowCount} response rows found. Blank rows are ignored.`;
    $("columns").classList.remove("hidden");
}));

$("worksheet").addEventListener("change", () => $("columns").classList.add("hidden"));
$("sheet").addEventListener("input", () => $("mapping").classList.add("hidden"));
$("event-column").addEventListener("change", event => action(event.currentTarget, async () => {
    const selected = $("event-column").value;
    $("event-wrap").classList.toggle("hidden", selected === "");
    if (selected !== "") {
        fillSelect($("event-value"), [], "Loading events…");
        const query = new URLSearchParams({ id: $("sheet").value, worksheet: $("worksheet").value, column: selected });
        const data = await api(`/api/sheets/event-values?${query}`);
        fillSelect($("event-value"), data.values.map(value => [value, value]), "Choose an event");
    }
}));

$("draw-form").addEventListener("submit", event => {
    event.preventDefault();
    action($("generate"), async () => {
        if (!worksheetData || $("columns").classList.contains("hidden")) throw new Error("Load and map the sheet columns first.");
        const index = id => $(id).value === "" ? null : Number($(id).value);
        const draw = await api("/api/draws", {
            method: "POST",
            body: JSON.stringify({
                name: $("draw-name").value, sheet: $("sheet").value, worksheet: $("worksheet").value,
                mapping: {
                    name: index("name-column"), institute: index("institute-column"), seed: index("seed-column"),
                    event: index("event-column"), eventValue: $("event-value").value
                }
            })
        });
        showDraw(draw);
        location.hash = `#draw/${draw.id}`;
        await refreshDraws();
    });
});
$("delete").addEventListener("click", event => {
    if (!currentDraw || !confirm("Permanently delete this draw and its results?")) return;
    action(event.currentTarget, async () => {
        await api(`/api/draws/${currentDraw.id}`, { method: "DELETE" });
        currentDraw = null;
        location.hash = `#${currentPage()}`;
        updateNavigation();
        $("draw-view").classList.add("hidden");
        $("empty-bracket").classList.remove("hidden");
        await refreshDraws();
    });
});
$("logout").addEventListener("click", event => action(event.currentTarget, async () => {
    await api("/api/logout", { method: "POST" });
    location.reload();
}));

async function init() {
    try {
        const session = await api("/api/session");
        if (session.user) {
            $("welcome").classList.add("hidden");
            $("workspace").classList.remove("hidden");
            $("account").classList.remove("hidden");
            $("main-nav").classList.remove("hidden");
            $("account-name").textContent = session.user.email;
            await refreshDraws();
            const id = location.hash.split("/")[1];
            if (id) showDraw(await api(`/api/draws/${encodeURIComponent(id)}`));
            updateNavigation();
        }
    } catch (error) {
        $("welcome").innerText = `Unable to load the application: ${error.message}`;
    }
}
init();
