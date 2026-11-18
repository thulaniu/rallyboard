require("dotenv").config();

const crypto = require("node:crypto");
const path = require("node:path");
const express = require("express");
const { google } = require("googleapis");
const { listWorksheets, readWorksheet, mapPlayers } = require("./services/googleSheetsService");
const { validatePlayers } = require("./services/validationService");
const { createSeededBracket } = require("./services/seedingService");
const { createMatches, recordResult } = require("./services/drawService");
const { ScheduleError, configureSchedule, refreshSchedule, startMatch, finishMatch, assertResultChangeAllowed, getScheduleProgress } = require("./services/scheduleService");
const { exportDraw } = require("./services/exportService");
const { participantDraw } = require("./services/participantService");
const reminders = require("./services/reminderService");
const sms = require("./services/smsService");
const store = require("./services/store");

const app = express();
const sessions = new Map();
const states = new Map();
const sessionLifetime = 8 * 60 * 60 * 1000;
const baseUrl = process.env.APP_URL || "http://localhost:5000";
const secure = new URL(baseUrl).protocol === "https:";
if (new URL(baseUrl).origin !== baseUrl || (process.env.NODE_ENV === "production" && !secure)) {
    throw new Error("APP_URL must be an origin without a trailing slash, and must use HTTPS in production.");
}
const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

function oauthClient() {
    if (!clientId || !clientSecret) throw new Error("Google sign-in is not configured on the server.");
    return new google.auth.OAuth2(clientId, clientSecret, `${baseUrl}/auth/callback`);
}

function cookie(name, value, maxAge) {
    return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

function cookieValue(req, name) {
    return (req.headers.cookie || "").split(";").map(item => item.trim())
        .find(item => item.startsWith(`${name}=`))?.slice(name.length + 1);
}

function purgeExpired() {
    const now = Date.now();
    for (const [key, value] of sessions) if (value.expires <= now) sessions.delete(key);
    for (const [key, value] of states) if (value <= now) states.delete(key);
}

app.disable("x-powered-by");
app.use((req, res, next) => {
    res.set("X-Content-Type-Options", "nosniff");
    res.set("X-Frame-Options", "DENY");
    res.set("Referrer-Policy", "no-referrer");
    res.set("Content-Security-Policy", "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    next();
});
app.use(express.json({ limit: "64kb" }));
app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (!["GET", "HEAD"].includes(req.method) && req.get("origin") !== baseUrl) {
        return res.status(403).json({ error: "Invalid request origin." });
    }
    next();
});

app.get("/health", (req, res) => res.json({ ok: true }));
app.get("/api/participant/draw", (req, res) => {
    const token = req.get("authorization")?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
    if (!token) return res.status(404).json({ error: "This draw is unavailable or the link has been revoked." });
    const draw = store.getPublished(token);
    if (!draw || !draw.schedule) return res.status(404).json({ error: "This draw is unavailable or the link has been revoked." });
    refreshSchedule(draw);
    res.json(participantDraw(drawResponse(draw)));
});
app.get("/api/participant/tournament", (req, res) => {
    const token = req.get("authorization")?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
    const tournament = token && store.getPublishedTournament(token);
    if (!tournament) return res.status(404).json({ error: "This tournament is unavailable or the link has been revoked." });
    const draws = store.list(tournament.owner).filter(draw => draw.tournamentId === tournament.id && draw.schedule)
        .map(draw => {
            refreshSchedule(draw);
            return { id: draw.id, ...participantDraw(drawResponse(draw)) };
        });
    res.json({ name: tournament.name, draws });
});
app.get("/auth/google", (req, res, next) => {
    try {
        purgeExpired();
        const state = crypto.randomBytes(32).toString("hex");
        states.set(state, Date.now() + 10 * 60 * 1000);
        res.setHeader("Set-Cookie", cookie("oauth_state", state, 600));
        res.redirect(oauthClient().generateAuthUrl({
            access_type: "offline", prompt: "consent",
            scope: ["openid", "email", "profile", "https://www.googleapis.com/auth/spreadsheets.readonly"],
            state
        }));
    } catch (error) { next(error); }
});

app.get("/auth/callback", async (req, res) => {
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const expiration = states.get(state);
    states.delete(state);
    res.setHeader("Set-Cookie", cookie("oauth_state", "", 0));
    if (!expiration || expiration <= Date.now() || cookieValue(req, "oauth_state") !== state) {
        return res.status(400).send("Sign-in expired or was invalid. Please try again.");
    }
    if (typeof req.query.code !== "string") return res.status(400).send("Google sign-in was not completed.");
    try {
        const client = oauthClient();
        const { tokens } = await client.getToken(req.query.code);
        if (!tokens.id_token || !tokens.access_token) throw new Error("Missing Google tokens.");
        const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: clientId });
        const profile = ticket.getPayload();
        if (!profile?.sub || !profile.email_verified) throw new Error("A verified Google account is required.");
        const sessionId = crypto.randomBytes(32).toString("hex");
        sessions.set(sessionId, {
            owner: profile.sub, email: profile.email, name: profile.name || profile.email,
            tokens, expires: Date.now() + sessionLifetime
        });
        res.append("Set-Cookie", cookie("session", sessionId, sessionLifetime / 1000));
        res.redirect("/");
    } catch (error) {
        console.error("Google sign-in failed.");
        res.status(401).send("Google sign-in failed. Check the OAuth configuration and try again.");
    }
});

app.get("/api/session", (req, res) => {
    purgeExpired();
    const session = sessions.get(cookieValue(req, "session"));
    res.json({ user: session ? { name: session.name, email: session.email } : null });
});
app.use("/api", (req, res, next) => {
    purgeExpired();
    const session = sessions.get(cookieValue(req, "session"));
    if (!session) return res.status(401).json({ error: "Please sign in with Google." });
    req.session = session;
    next();
});
app.post("/api/logout", (req, res) => {
    sessions.delete(cookieValue(req, "session"));
    res.setHeader("Set-Cookie", cookie("session", "", 0));
    res.json({ ok: true });
});

function sheetsAuth(session) {
    const client = oauthClient();
    client.setCredentials(session.tokens);
    client.on("tokens", tokens => { Object.assign(session.tokens, tokens); });
    return client;
}

function asyncRoute(handler) {
    return (req, res, next) => Promise.resolve(handler(req, res)).catch(next);
}

function drawResponse(draw) {
    const { reminders: privateReminders, ...publicDraw } = draw;
    return {
        ...publicDraw,
        ...(draw.schedule ? { schedule: { ...draw.schedule, progress: getScheduleProgress(draw) } } : {}),
        reminderStatus: reminders.summary(draw, sms.configured())
    };
}

app.get("/api/sheets", asyncRoute(async (req, res) => {
    res.json(await listWorksheets(sheetsAuth(req.session), req.query.id));
}));
app.get("/api/sheets/columns", asyncRoute(async (req, res) => {
    const data = await readWorksheet(sheetsAuth(req.session), req.query.id, req.query.worksheet);
    res.json({ headers: data.headers, rowCount: data.rows.length });
}));
app.get("/api/sheets/event-values", asyncRoute(async (req, res) => {
    const data = await readWorksheet(sheetsAuth(req.session), req.query.id, req.query.worksheet);
    const column = Number(req.query.column);
    if (!Number.isInteger(column) || column < 0 || column >= data.headers.length) {
        return res.status(400).json({ error: "Select a valid event column." });
    }
    const values = [...new Set(data.rows.map(row => String(row[column] || "").trim()).filter(Boolean))].sort();
    res.json({ values });
}));
app.get("/api/tournaments", (req, res) => {
    res.json(store.listTournaments(req.session.owner));
});
app.post("/api/tournaments", (req, res) => {
    const name = req.body?.name;
    if (typeof name !== "string" || !name.trim() || name.trim().length > 120) {
        return res.status(400).json({ error: "Enter a tournament name (up to 120 characters)." });
    }
    const tournament = { id: crypto.randomUUID(), owner: req.session.owner,
        name: name.trim(), createdAt: new Date().toISOString() };
    store.saveTournament(tournament);
    res.status(201).json(tournament);
});
app.post("/api/tournaments/:id/share", (req, res) => {
    const tournament = store.getTournament(req.session.owner, req.params.id);
    if (!tournament) return res.status(404).json({ error: "Tournament not found." });
    if (!tournament.shareToken) {
        tournament.shareToken = crypto.randomBytes(32).toString("base64url");
        store.saveTournament(tournament);
    }
    res.json(tournament);
});
app.delete("/api/tournaments/:id/share", (req, res) => {
    const tournament = store.getTournament(req.session.owner, req.params.id);
    if (!tournament) return res.status(404).json({ error: "Tournament not found." });
    if (tournament.shareToken) {
        delete tournament.shareToken;
        store.saveTournament(tournament);
    }
    res.json(tournament);
});
app.post("/api/draws", asyncRoute(async (req, res) => {
    const { sheet, worksheet, mapping, name, tournamentId } = req.body;
    if (typeof name !== "string" || !name.trim() || name.trim().length > 120) {
        return res.status(400).json({ error: "Enter a draw name (up to 120 characters)." });
    }
    if (tournamentId != null && (typeof tournamentId !== "string" || !store.getTournament(req.session.owner, tournamentId))) {
        return res.status(400).json({ error: "Choose one of your tournaments." });
    }
    const data = await readWorksheet(sheetsAuth(req.session), sheet, worksheet);
    const players = mapPlayers(data, mapping);
    const validation = validatePlayers(players);
    if (!validation.valid) return res.status(400).json({ error: "Check the player data.", details: validation.errors });
    const bracket = createSeededBracket(players);
    const draw = {
        id: crypto.randomUUID(), owner: req.session.owner, name: name.trim(),
        createdAt: new Date().toISOString(), playerCount: players.length,
        bracketSize: bracket.bracketSize, institutePenalty: bracket.institutePenalty,
        warnings: validation.warnings, rounds: createMatches(bracket.slots),
        ...(tournamentId ? { tournamentId } : {})
    };
    store.save(draw);
    res.status(201).json(drawResponse(draw));
}));
app.get("/api/draws", (req, res) => {
    res.json(store.list(req.session.owner).map(({ id, name, createdAt, playerCount, bracketSize, tournamentId }) =>
        ({ id, name, createdAt, playerCount, bracketSize, tournamentId })).reverse());
});
app.put("/api/draws/:id/tournament", (req, res) => {
    const draw = store.get(req.session.owner, req.params.id);
    if (!draw) return res.status(404).json({ error: "Draw not found." });
    const tournamentId = req.body?.tournamentId;
    if (tournamentId !== null && (typeof tournamentId !== "string" || !store.getTournament(req.session.owner, tournamentId))) {
        return res.status(400).json({ error: "Choose one of your tournaments or remove the assignment." });
    }
    if (tournamentId === null) delete draw.tournamentId;
    else draw.tournamentId = tournamentId;
    store.save(draw);
    res.json(drawResponse(draw));
});
app.get("/api/draws/:id", (req, res) => {
    const draw = store.get(req.session.owner, req.params.id);
    if (!draw) return res.status(404).json({ error: "Draw not found." });
    if (draw.schedule) {
        refreshSchedule(draw);
        store.save(draw);
    }
    res.json(drawResponse(draw));
});
app.post("/api/draws/:id/reminders/contacts", asyncRoute(async (req, res) => {
    if (!store.get(req.session.owner, req.params.id)) return res.status(404).json({ error: "Draw not found." });
    const { sheet, worksheet, mapping } = req.body || {};
    const data = await readWorksheet(sheetsAuth(req.session), sheet, worksheet);
    const draw = store.get(req.session.owner, req.params.id);
    if (!draw) return res.status(404).json({ error: "Draw not found." });
    try {
        reminders.importContacts(draw, data, mapping);
    } catch (error) {
        if (!(error instanceof reminders.ReminderError)) throw error;
        return res.status(400).json({ error: error.message });
    }
    store.save(draw);
    res.json(drawResponse(draw));
}));
app.put("/api/draws/:id/reminders", (req, res) => {
    const draw = store.get(req.session.owner, req.params.id);
    if (!draw) return res.status(404).json({ error: "Draw not found." });
    try {
        reminders.enable(draw, req.body?.enabled, req.body?.timeZone, sms.configured());
    } catch (error) {
        if (!(error instanceof reminders.ReminderError)) throw error;
        return res.status(400).json({ error: error.message });
    }
    store.save(draw);
    res.json(drawResponse(draw));
});
app.post("/api/draws/:id/share", (req, res) => {
    const draw = store.get(req.session.owner, req.params.id);
    if (!draw) return res.status(404).json({ error: "Draw not found." });
    if (!draw.schedule) return res.status(400).json({ error: "Create a schedule before publishing this draw." });
    if (!draw.shareToken) {
        draw.shareToken = crypto.randomBytes(32).toString("base64url");
        store.save(draw);
    }
    res.json(drawResponse(draw));
});
app.delete("/api/draws/:id/share", (req, res) => {
    const draw = store.get(req.session.owner, req.params.id);
    if (!draw) return res.status(404).json({ error: "Draw not found." });
    if (draw.shareToken) {
        delete draw.shareToken;
        store.save(draw);
    }
    res.json(drawResponse(draw));
});
app.put("/api/draws/:id/schedule", (req, res, next) => {
    const draw = store.get(req.session.owner, req.params.id);
    if (!draw) return res.status(404).json({ error: "Draw not found." });
    try {
        configureSchedule(draw, req.body?.startAt, req.body?.courts);
        store.save(draw);
        res.json(drawResponse(draw));
    } catch (error) { next(error); }
});
app.post("/api/draws/:id/matches/:number/start", (req, res, next) => {
    const draw = store.get(req.session.owner, req.params.id);
    if (!draw) return res.status(404).json({ error: "Draw not found." });
    try {
        startMatch(draw, Number(req.params.number), Date.now(), req.body?.court);
        store.save(draw);
        res.json(drawResponse(draw));
    } catch (error) { next(error); }
});
app.put("/api/draws/:id/matches/:number", (req, res, next) => {
    const draw = store.get(req.session.owner, req.params.id);
    if (!draw) return res.status(404).json({ error: "Draw not found." });
    const { winnerId, score } = req.body;
    if ((winnerId !== null && typeof winnerId !== "string") || typeof score !== "string" || score.length > 100) {
        return res.status(400).json({ error: "Enter a valid winner and score (up to 100 characters)." });
    }
    try {
        const number = Number(req.params.number);
        assertResultChangeAllowed(draw, number, winnerId);
        finishMatch(draw, number, winnerId);
        recordResult(draw.rounds, number, winnerId, score.trim());
        refreshSchedule(draw);
        store.save(draw);
        res.json(drawResponse(draw));
    } catch (error) {
        if (/^(Match not found|This match is not ready|Winner must be)/.test(error.message)) {
            return res.status(400).json({ error: error.message });
        }
        next(error);
    }
});
app.get("/api/draws/:id/export", asyncRoute(async (req, res) => {
    const draw = store.get(req.session.owner, req.params.id);
    if (!draw) return res.status(404).json({ error: "Draw not found." });
    if (draw.schedule) {
        refreshSchedule(draw);
        store.save(draw);
    }
    res.type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.attachment("tournament-draw.xlsx").send(Buffer.from(await exportDraw(draw)));
}));
app.delete("/api/draws/:id", (req, res) => {
    if (!store.remove(req.session.owner, req.params.id)) return res.status(404).json({ error: "Draw not found." });
    res.json({ ok: true });
});

app.use("/api", (req, res) => res.status(404).json({ error: "API endpoint not found. Make sure the application server is up to date." }));
app.use(express.static(path.join(__dirname, "../public")));
app.use((error, req, res, next) => {
    console.error("Request failed:", error.message);
    if (res.headersSent) return next(error);
    if (error instanceof ScheduleError) return res.status(400).json({ error: error.message });
    const code = error.response?.status || error.code;
    if (code === 403) return res.status(403).json({ error: "Google denied access. Check that your account can open the sheet." });
    if (code === 404) return res.status(404).json({ error: "Sheet or worksheet not found." });
    if (code === 401) return res.status(401).json({ error: "Google authorization expired. Please sign out and sign in again." });
    if (/^(Enter |Select |Choose |The selected worksheet)/.test(error.message)) {
        return res.status(400).json({ error: error.message });
    }
    if (error.status === 413) return res.status(413).json({ error: "Request is too large." });
    res.status(500).json({ error: "Unable to complete the request. Check the server logs." });
});

if (require.main === module) {
    const port = process.env.PORT || 5000;
    app.listen(port, "0.0.0.0", () => console.log(`Server listening on port ${port}`));
    const worker = reminders.createWorker({ store, send: sms.sendSms });
    const tick = () => {
        if (sms.configured()) worker.tick().catch(() => console.error("SMS reminder processing failed. Check storage and server configuration."));
    };
    tick();
    setInterval(tick, 30000);
}

module.exports = app;
