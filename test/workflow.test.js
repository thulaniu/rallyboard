const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { google } = require("googleapis");

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "rallyboard-workflow-"));
process.env.DATA_DIR = directory;
process.env.APP_URL = "http://localhost:5000";
process.env.GOOGLE_CLIENT_ID = "test-client";
process.env.GOOGLE_CLIENT_SECRET = "test-secret";
process.env.TWILIO_ACCOUNT_SID = "test-sid";
process.env.TWILIO_AUTH_TOKEN = "test-token";
process.env.TWILIO_FROM_NUMBER = "+14155552670";

class FakeOAuth {
    generateAuthUrl({ state }) { return `https://accounts.example/authorize?state=${state}`; }
    async getToken(code) { return { tokens: { id_token: code, access_token: code } }; }
    async verifyIdToken({ idToken }) {
        return { getPayload: () => ({ sub: idToken, email: `${idToken}@example.test`, email_verified: true }) };
    }
    setCredentials(tokens) { this.tokens = tokens; }
    on() {}
}
google.auth.OAuth2 = FakeOAuth;
google.sheets = () => ({
    spreadsheets: {
        get: async () => ({ data: { properties: { title: "Registration" }, sheets: [{ properties: { title: "Responses" } }] } }),
        values: {
            get: async () => ({ data: { values: [
                ["Timestamp", "Event", "Name", "Institute", "Seed", "Email", "Phone", "SMS consent"],
                ["1", "Singles", "Alice", "A", "1", "alice@example.test", "+14155552671", "Yes"],
                ["2", "Singles", "Bob", "B", "2", "bob@example.test", "+14155552672", "No"],
                ["3", "Singles", "Chris", "C", "", "chris@example.test", "", ""],
                ["4", "Singles", "Dara", "D", "", "dara@example.test", "", ""],
                ["5", "Singles", "Ellis", "E", "", "ellis@example.test", "", ""],
                ["6", "Doubles", "Frank", "F", "", "frank@example.test"]
            ] } })
        }
    }
});
const app = require("../src/server");
test.after(() => fs.rmSync(directory, { recursive: true, force: true }));

test("authenticated sheet-to-results workflow and account isolation", async () => {
    const server = app.listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    async function signIn(name) {
        const start = await fetch(`${base}/auth/google`, { redirect: "manual" });
        const state = new URL(start.headers.get("location")).searchParams.get("state");
        const stateCookie = start.headers.getSetCookie()[0].split(";")[0];
        const callback = await fetch(`${base}/auth/callback?state=${state}&code=${name}`, {
            redirect: "manual", headers: { Cookie: stateCookie }
        });
        assert.equal(callback.status, 302);
        return callback.headers.getSetCookie().find(value => value.startsWith("session=")).split(";")[0];
    }
    async function request(url, cookie, options = {}) {
        return fetch(`${base}${url}`, {
            ...options,
            headers: { Cookie: cookie, Origin: "http://localhost:5000", "Content-Type": "application/json" }
        });
    }
    try {
        const alice = await signIn("alice");
        const bob = await signIn("bob");
        const missingEndpoint = await request("/api/unknown", alice);
        assert.equal(missingEndpoint.status, 404);
        assert.match(missingEndpoint.headers.get("content-type"), /application\/json/);
        assert.match((await missingEndpoint.json()).error, /endpoint not found/i);
        const sheets = await request("/api/sheets?id=sheet123", alice);
        assert.deepEqual((await sheets.json()).worksheets, ["Responses"]);
        const columns = await request("/api/sheets/columns?id=sheet123&worksheet=Responses", alice);
        const columnData = await columns.json();
        assert.equal(columnData.headers[2], "Name");
        assert.equal(columnData.rowCount, 6);
        assert.equal(columnData.rows, undefined);
        const events = await request("/api/sheets/event-values?id=sheet123&worksheet=Responses&column=1", alice);
        assert.deepEqual((await events.json()).values, ["Doubles", "Singles"]);
        const created = await request("/api/draws", alice, {
            method: "POST",
            body: JSON.stringify({
                name: "Singles", sheet: "sheet123", worksheet: "Responses",
                mapping: { name: 2, institute: 3, seed: 4, event: 1, eventValue: "Singles" }
            })
        });
        assert.equal(created.status, 201);
        const draw = await created.json();
        assert.equal(draw.playerCount, 5);
        assert.equal((await request(`/api/draws/${draw.id}/share`, alice, { method: "POST", body: "{}" })).status, 400);
        assert.equal((await request(`/api/draws/${draw.id}/share`, bob, { method: "POST", body: "{}" })).status, 404);
        assert.equal((await (await request("/api/draws", bob)).json()).length, 0);
        assert.equal((await request(`/api/draws/${draw.id}`, bob)).status, 404);
        assert.equal((await request(`/api/draws/${draw.id}/export`, bob)).status, 404);
        const match = draw.rounds[0].find(item => !item.automatic);
        const result = await request(`/api/draws/${draw.id}/matches/${match.number}`, alice, {
            method: "PUT", body: JSON.stringify({ winnerId: match.players[0].id, score: "21-12" })
        });
        assert.equal(result.status, 200);
        assert.equal((await result.json()).rounds[0].find(item => item.number === match.number).score, "21-12");
        const exportResponse = await request(`/api/draws/${draw.id}/export`, alice);
        assert.equal(exportResponse.status, 200);
        assert.equal(Buffer.from(await exportResponse.arrayBuffer()).subarray(0, 2).toString(), "PK");
        const beforeSchedule = Date.now();
        const afterResults = await request(`/api/draws/${draw.id}/schedule`, alice, {
            method: "PUT",
            body: JSON.stringify({ startAt: new Date(beforeSchedule - 3600000).toISOString(), courts: 3 })
        });
        assert.equal(afterResults.status, 200);
        const remainingPlan = await afterResults.json();
        assert.equal(remainingPlan.rounds[0].find(item => item.number === match.number).score, "21-12");
        assert.ok(!remainingPlan.schedule.matches.some(item => item.matchNumber === match.number));
        assert.ok(remainingPlan.schedule.matches.every(item => Date.parse(item.startAt) >= beforeSchedule + 20 * 60000));
        assert.equal((await request(`/api/draws/${draw.id}/matches/${match.number}`, alice, {
            method: "PUT", body: JSON.stringify({ winnerId: match.players[0].id, score: "21-13" })
        })).status, 200);
        assert.equal((await request(`/api/draws/${draw.id}/matches/${match.number}`, alice, {
            method: "PUT", body: JSON.stringify({ winnerId: match.players[1].id, score: "21-13" })
        })).status, 400);
        const secondDrawResponse = await request("/api/draws", alice, {
            method: "POST",
            body: JSON.stringify({
                name: "Scheduled", sheet: "sheet123", worksheet: "Responses",
                mapping: { name: 2, institute: 3, seed: 4, event: 1, eventValue: "Singles" }
            })
        });
        const scheduledDraw = await secondDrawResponse.json();
        const scheduleUrl = `/api/draws/${scheduledDraw.id}/schedule`;
        const config = JSON.stringify({ startAt: new Date(Date.now() - 3600000).toISOString(), courts: 4 });
        assert.equal((await request(scheduleUrl, bob, { method: "PUT", body: config })).status, 404);
        const scheduled = await request(scheduleUrl, alice, { method: "PUT", body: config });
        assert.equal(scheduled.status, 200);
        const plan = await scheduled.json();
        assert.equal(plan.schedule.progress.status, "behind");
        assert.equal(plan.schedule.progress.originalFinishAt, plan.schedule.originalFinishAt);
        assert.ok(plan.schedule.progress.differenceMs > 0);
        const contactsUrl = `/api/draws/${scheduledDraw.id}/reminders/contacts`;
        const contactBody = JSON.stringify({ sheet: "sheet123", worksheet: "Responses",
            mapping: { name: 2, institute: 3, phone: 6, consent: 7 } });
        assert.equal((await request(contactsUrl, bob, { method: "POST", body: contactBody })).status, 404);
        const imported = await request(contactsUrl, alice, { method: "POST", body: contactBody });
        assert.equal(imported.status, 200);
        const importedText = await imported.text();
        assert.equal(JSON.parse(importedText).reminderStatus.eligible, 1);
        assert.ok(!importedText.includes("+14155552671"));
        const enableUrl = `/api/draws/${scheduledDraw.id}/reminders`;
        assert.equal((await request(enableUrl, bob, { method: "PUT", body: JSON.stringify({ enabled: true, timeZone: "UTC" }) })).status, 404);
        const enabled = await request(enableUrl, alice, { method: "PUT", body: JSON.stringify({ enabled: true, timeZone: "UTC" }) });
        assert.equal((await enabled.json()).reminderStatus.enabled, true);
        const publish = await request(`/api/draws/${scheduledDraw.id}/share`, alice, { method: "POST", body: "{}" });
        assert.equal(publish.status, 200);
        const shared = await publish.json();
        const token = shared.shareToken;
        assert.match(token, /^[A-Za-z0-9_-]{43}$/);
        const participant = () => fetch(`${base}/api/participant/draw`, { headers: { Authorization: `Bearer ${token}` } });
        const participantResponse = await participant();
        assert.equal(participantResponse.status, 200);
        assert.match(participantResponse.headers.get("cache-control"), /no-store/);
        const publicDraw = await participantResponse.json();
        assert.ok(!JSON.stringify(publicDraw).includes("+14155552671"));
        assert.equal(publicDraw.reminders, undefined);
        assert.equal(publicDraw.reminderStatus, undefined);
        assert.equal(publicDraw.name, "Scheduled");
        assert.equal(publicDraw.playerCount, 5);
        assert.equal(publicDraw.owner, undefined);
        assert.equal(publicDraw.shareToken, undefined);
        assert.equal(publicDraw.rounds.flat().flatMap(item => item.players).filter(Boolean)[0].id, undefined);
        assert.equal(publicDraw.rounds.flat().flatMap(item => item.players).filter(Boolean)[0].rowNumber, undefined);
        assert.ok(publicDraw.schedule.matches.length > 0);
        assert.equal((await fetch(`${base}/api/participant/draw`)).status, 404);
        assert.equal((await fetch(`${base}/api/participant/draw`, { headers: { Authorization: "Bearer invalid" } })).status, 404);
        assert.equal((await fetch(`${base}/api/draws/${scheduledDraw.id}`)).status, 401);
        assert.equal((await fetch(`${base}/api/draws/${scheduledDraw.id}/matches/1/start`, {
            method: "POST", headers: { Origin: "http://localhost:5000", Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: "{}"
        })).status, 401);
        const scheduledMatch = plan.rounds[0].find(item => !item.automatic);
        const matchUrl = `/api/draws/${scheduledDraw.id}/matches/${scheduledMatch.number}`;
        assert.equal((await request(matchUrl, alice, { method: "PUT", body: JSON.stringify({
            winnerId: scheduledMatch.players[0].id, score: "21-12"
        }) })).status, 400);
        assert.equal((await request(`${matchUrl}/start`, bob, { method: "POST", body: "{}" })).status, 404);
        const scheduledEntry = plan.schedule.matches.find(item => item.matchNumber === scheduledMatch.number);
        assert.ok(scheduledEntry.originalStartAt);
        const invalidCourt = await request(`${matchUrl}/start`, alice, { method: "POST", body: JSON.stringify({ court: 9 }) });
        assert.equal(invalidCourt.status, 400);
        const selectedCourt = scheduledEntry.court === 4 ? 3 : 4;
        const started = await request(`${matchUrl}/start`, alice, { method: "POST", body: JSON.stringify({ court: selectedCourt }) });
        assert.equal(started.status, 200);
        const startedEntry = (await started.json()).schedule.matches.find(item => item.matchNumber === scheduledMatch.number);
        assert.ok(startedEntry.startedAt);
        assert.equal(startedEntry.court, selectedCourt);
        assert.equal(startedEntry.originalStartAt, scheduledEntry.originalStartAt);
        assert.ok((await (await participant()).json()).schedule.matches.find(item => item.matchNumber === scheduledMatch.number).startedAt);
        const finished = await request(matchUrl, alice, { method: "PUT", body: JSON.stringify({
            winnerId: scheduledMatch.players[0].id, score: "21-12"
        }) });
        assert.equal(finished.status, 200);
        assert.ok((await finished.json()).schedule.matches.find(item => item.matchNumber === scheduledMatch.number).finishedAt);
        const participantFinished = await (await participant()).json();
        assert.equal(participantFinished.rounds.flat().find(item => item.number === scheduledMatch.number).score, "21-12");
        const reloaded = await (await request(`/api/draws/${scheduledDraw.id}`, alice)).json();
        assert.equal(reloaded.rounds[0].find(item => item.number === scheduledMatch.number).score, "21-12");
        assert.ok(reloaded.schedule.matches.find(item => item.matchNumber === scheduledMatch.number).finishedAt);
        assert.equal(reloaded.schedule.matches.find(item => item.matchNumber === scheduledMatch.number).court, selectedCourt);
        assert.equal(reloaded.schedule.progress.originalFinishAt, plan.schedule.originalFinishAt);
        const tournamentResponse = await request("/api/tournaments", alice, {
            method: "POST", body: JSON.stringify({ name: "Championship" })
        });
        assert.equal(tournamentResponse.status, 201);
        const tournament = await tournamentResponse.json();
        assert.equal((await (await request("/api/tournaments", bob)).json()).length, 0);
        const otherTournament = await (await request("/api/tournaments", bob, {
            method: "POST", body: JSON.stringify({ name: "Other owner" })
        })).json();
        assert.equal((await request(`/api/draws/${scheduledDraw.id}/tournament`, alice, {
            method: "PUT", body: JSON.stringify({ tournamentId: otherTournament.id })
        })).status, 400);
        assert.equal((await request("/api/draws", alice, {
            method: "POST", body: JSON.stringify({ name: "Invalid", tournamentId: otherTournament.id })
        })).status, 400);
        assert.equal((await request(`/api/tournaments/${tournament.id}/share`, bob, { method: "POST", body: "{}" })).status, 404);
        assert.equal((await request(`/api/draws/${scheduledDraw.id}/tournament`, bob, {
            method: "PUT", body: JSON.stringify({ tournamentId: tournament.id })
        })).status, 404);
        assert.equal((await request(`/api/draws/${scheduledDraw.id}/tournament`, alice, {
            method: "PUT", body: JSON.stringify({ tournamentId: "unknown" })
        })).status, 400);
        assert.equal((await request(`/api/draws/${scheduledDraw.id}/tournament`, alice, {
            method: "PUT", body: JSON.stringify({ tournamentId: tournament.id })
        })).status, 200);
        const newDraw = await (await request("/api/draws", alice, {
            method: "POST", body: JSON.stringify({
                name: "Unscheduled", sheet: "sheet123", worksheet: "Responses", tournamentId: tournament.id,
                mapping: { name: 2, institute: 3, seed: 4, event: 1, eventValue: "Singles" }
            })
        })).json();
        assert.equal(newDraw.tournamentId, tournament.id);
        const tournamentShared = await (await request(`/api/tournaments/${tournament.id}/share`, alice, {
            method: "POST", body: "{}"
        })).json();
        const tournamentToken = tournamentShared.shareToken;
        const participantTournament = () => fetch(`${base}/api/participant/tournament`, {
            headers: { Authorization: `Bearer ${tournamentToken}` }
        });
        let tournamentView = await (await participantTournament()).json();
        assert.equal(tournamentView.name, "Championship");
        assert.deepEqual(tournamentView.draws.map(item => item.id), [scheduledDraw.id]);
        assert.equal(tournamentView.draws[0].rounds.flat().find(item => item.number === scheduledMatch.number).score, "21-12");
        assert.ok(!JSON.stringify(tournamentView).includes("+14155552671"));
        assert.ok(!JSON.stringify(tournamentView).includes(token));
        assert.equal((await request(`/api/draws/${scheduledDraw.id}/share`, alice, { method: "DELETE", body: "{}" })).status, 200);
        assert.equal((await participant()).status, 404);
        assert.deepEqual((await (await participantTournament()).json()).draws.map(item => item.id), [scheduledDraw.id]);
        const restoredShare = await (await request(`/api/draws/${scheduledDraw.id}/share`, alice, { method: "POST", body: "{}" })).json();
        const restoredParticipant = () => fetch(`${base}/api/participant/draw`, {
            headers: { Authorization: `Bearer ${restoredShare.shareToken}` }
        });
        assert.equal((await request(`/api/draws/${newDraw.id}/schedule`, alice, {
            method: "PUT", body: JSON.stringify({ startAt: new Date(Date.now() + 3600000).toISOString(), courts: 2 })
        })).status, 200);
        tournamentView = await (await participantTournament()).json();
        assert.equal(tournamentView.draws.length, 2);
        assert.equal((await request(`/api/draws/${scheduledDraw.id}/tournament`, alice, {
            method: "PUT", body: JSON.stringify({ tournamentId: null })
        })).status, 200);
        assert.deepEqual((await (await participantTournament()).json()).draws.map(item => item.id), [newDraw.id]);
        assert.equal((await restoredParticipant()).status, 200);
        assert.equal((await request(`/api/tournaments/${tournament.id}/share`, alice, { method: "DELETE", body: "{}" })).status, 200);
        assert.equal((await participantTournament()).status, 404);
        assert.equal((await restoredParticipant()).status, 200);
        const tournamentRepublished = await (await request(`/api/tournaments/${tournament.id}/share`, alice, {
            method: "POST", body: "{}"
        })).json();
        assert.notEqual(tournamentRepublished.shareToken, tournamentToken);
        assert.equal((await participantTournament()).status, 404);
        assert.equal((await request(`/api/draws/${newDraw.id}`, alice, { method: "DELETE" })).status, 200);
        const emptyTournament = await fetch(`${base}/api/participant/tournament`, {
            headers: { Authorization: `Bearer ${tournamentRepublished.shareToken}` }
        });
        assert.deepEqual((await emptyTournament.json()).draws, []);
        assert.equal((await request(`/api/draws/${scheduledDraw.id}/share`, bob, { method: "DELETE", body: "{}" })).status, 404);
        assert.equal((await request(`/api/draws/${scheduledDraw.id}/share`, alice, { method: "DELETE", body: "{}" })).status, 200);
        assert.equal((await participant()).status, 404);
        const republished = await (await request(`/api/draws/${scheduledDraw.id}/share`, alice, { method: "POST", body: "{}" })).json();
        assert.notEqual(republished.shareToken, token);
        assert.equal((await participant()).status, 404);
        assert.equal((await request(`/api/draws/${scheduledDraw.id}`, alice, { method: "DELETE" })).status, 200);
        assert.equal((await fetch(`${base}/api/participant/draw`, { headers: { Authorization: `Bearer ${republished.shareToken}` } })).status, 404);
        assert.equal((await request(`/api/draws/${draw.id}`, bob, { method: "DELETE" })).status, 404);
        assert.equal((await request(`/api/draws/${draw.id}`, alice, { method: "DELETE" })).status, 200);
        assert.equal((await request(`/api/draws/${draw.id}`, alice)).status, 404);
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
});
