# Rallyboard — badminton tournament draws

Rallyboard builds knockout draws from a Google Form response sheet. Organizers sign in with Google, select a worksheet and map its columns, optionally filter an event, generate a draw, record results, and export an Excel workbook. Each Google account can see only its own saved draws.

## Google Cloud setup

1. In a Google Cloud project, enable the **Google Sheets API**.
2. Configure the OAuth consent screen and create an OAuth 2.0 **Web application** client. Request `openid`, `email`, `profile`, and `https://www.googleapis.com/auth/spreadsheets.readonly`. Google may require verification for public use of the Sheets scope. While the app is in testing mode, add each organizer as a test user.
3. Add an authorized redirect URI exactly matching `<APP_URL>/auth/callback`, for example `http://localhost:5000/auth/callback` locally and `https://draws.example.com/auth/callback` in production.
4. Each organizer must be able to open the Google Sheet with their own Google account. No service-account key or public sheet sharing is needed. The older `credentials/credentials.json` is not used by the app; do not commit or include it in container images.

Do not post the client secret or credential files in issues, logs, or source control. If a credential has been exposed, rotate it in Google Cloud.

## Run locally

Requires Node.js 22 and npm.

```sh
npm ci
test -e .env || cp .env.example .env
# Add or update APP_URL, GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.
npm start
```

Open `http://localhost:5000`. `APP_URL` must be the exact origin in the browser, without a trailing slash. If changing `PORT`, also change `APP_URL` and the Google redirect URI. Run the tests with `npm test`.

## Create and manage a draw

1. Sign in with Google, enter a draw name and paste the Google Sheet URL or ID.
2. Choose the worksheet. The first row must contain headers. Select the player name and institute columns; seed and event columns are optional. Other columns are not sent to the browser or saved in the draw. Duplicate header names are distinguishable by their column numbers.
3. For an event-specific draw, select an event column and one of its nonblank values. Rows are matched by the whole trimmed value, so a response containing multiple events in one cell is not treated as multiple separate entries.
4. Generate the draw. Every selected row needs a name and institute. Seeds must be unique positive integers no greater than the player count; blank means unseeded. Correct any reported errors in the Sheet and generate again.
5. Select winners and optionally enter scores in the match center. BYEs advance automatically. Changing or clearing an earlier result clears downstream results when their participants change. Export Excel at any time for a formatted snapshot of the draw and results; changes made in Excel are **not** imported back into Rallyboard.

Draws support 2–128 players in brackets of 8, 16, 32, 64 or 128 slots. Fixed seed positions are used and higher seeds receive first-round BYE priority. Remaining players are shuffled, and a bounded search tries to minimize same-institute encounters in the first three rounds. This is a best-effort heuristic, not a guarantee of an optimal or conflict-free draw; warnings appear if conflicts remain. Generate a new draw to try a different arrangement.

## Organize and publish a tournament

Create a tournament in the organizer workspace. Choose it when generating a draw, or open an existing draw and use **Assign to tournament** to move it or make it unassigned. Saved draws are grouped by tournament. Tournament grouping does not combine schedules: each draw still has its own courts and schedule, so organizers must coordinate conflicts across draws themselves.

Select a tournament under **Manage tournament** and choose **Publish tournament** to create a private link. Participants can use it to switch between all scheduled draws assigned to that tournament, even if the draws are not individually published. Unscheduled draws are excluded automatically until scheduled. Draws assigned or scheduled later appear automatically; removing a draw from the tournament removes it from the tournament link. Anyone with the link can see all these draws, so obtain appropriate consent before publishing or adding draws. The link can be published before any draw is scheduled; viewers then see an empty state.

**Unpublish tournament** revokes only the tournament link; individual draw links remain active. Republishing creates a new tournament link. Conversely, unpublishing an individual draw does not remove it from a published tournament. Tournament links are private bearer links, not account-based access controls; anyone holding one can forward it. A viewer who already saw or copied data may retain it. Deleting a draw removes it from the tournament view.

## Schedule matches

Open a saved draw and use the top navigation to open **Schedule**. Choose a start date and time in your browser's local time zone and the number of courts (default four, maximum 32). The separate schedule view groups ongoing, upcoming, and previous matches with court assignments and scheduled start/end times. It reserves 15 minutes for first-round matches and 20 minutes for later matches. The initial schedule allows at least 20 minutes between the scheduled end of a match and the next match for every possible advancing player; BYEs are not scheduled as matches and do not themselves require rest.

Return to **Draw** to start a match once its players are known and its scheduled time has arrived. Draw cards on both dashboards show the current scheduled date, time, court and match status in the viewer's local time zone; organizer cards also show the original scheduled time. BYEs, unscheduled matches and older results without recorded times are identified separately. Choose the suggested court or another free court before starting. A court cannot host two ongoing matches, and the server prevents players from starting until 20 minutes after their previous actual finish. Saving a winner and optional score on the same match card finishes the match. The schedule view refreshes while the page is open. If a match runs late or starts on a different court, pending assignments are pushed back as needed; an overdue ongoing match also blocks its court and pushes the projected schedule back as it is refreshed. Schedule times are estimates, not automatic match starts. The server clock is used for actual start and finish times. A schedule made before original per-match times were recorded shows those original times as unavailable; if play has not started, updating the schedule establishes new originals.

The tournament pace banner compares the projected final finish with the original finish recorded when the schedule was created. It estimates overdue unstarted matches from the current time, respects existing scheduled starts and projected court and rest constraints, and uses the actual final finish once recorded. Differences are rounded up to whole minutes. This is a forecast, not a guarantee: planned matches are not moved earlier just because preceding matches finish early. Schedules created before pace tracking do not have a recoverable original finish; if play has not started, update the schedule to establish a baseline.

Schedule settings can be changed until the first scheduled match starts. A schedule can also be added after results have been recorded: those results are preserved, their unknown times and courts are shown as not recorded, and all remaining matches are scheduled at least 20 minutes after the settings are saved. Saving settings again before play starts restarts that safety buffer. The buffer cannot guarantee real rest if a previously recorded match was actually still being played; record its result only after it finishes. Scores for those earlier matches can be corrected, but their winners cannot be changed after scheduling. After a later scheduled match has started, earlier winners feeding into it cannot be changed. A workbook exported from a scheduled draw includes a separate **Schedule** sheet with UTC timestamps.

## Participant dashboard

After creating a schedule, select **Publish draw** in the organizer workspace and copy the private link. Participants can open it without signing in to view the read-only bracket, player names, institutes, seeds, scores and the current schedule, including ongoing, upcoming and previous matches. The dashboard refreshes every 30 seconds while visible; times are displayed in the viewer's device time zone. Organizers retain exclusive control over results and scheduling.

Use **Draw** and **Schedule** in the navigation bar to switch views on either dashboard. The match search filters both views as you type by player name, institute, match number (for example, `#4` or `match 4`) or assigned court (for example, `court 4`). A number alone matches either a match number or court. Clear the search to restore all matches. Search applies to the selected draw and does not change saved results.

On a phone, swipe sideways through the bracket rounds. The organizer's schedule displays each match as a compact card; the navigation buttons jump to the selected view.

Publishing is opt-in per draw. Anyone with the link can view and forward it, so share it only with intended participants and obtain any required consent before publishing player information. Select **Unpublish draw** to immediately revoke the link; republishing creates a different link. Deleting the draw also revokes access. A viewer who already saw or copied data may retain it. Links use a secret fragment and the dashboard sends it in an authorization header: configure reverse proxies and monitoring not to log authorization headers. Use HTTPS for any deployed instance. Localhost links work only on the same device, so participants need the deployed HTTPS address for remote access.

## Optional SMS reminders

SMS is disabled until an organizer enables it for a draw. Configure `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_FROM_NUMBER` in the server environment and restart the app. The sender must be a Twilio SMS-capable number in international E.164 format, and the account must be authorized to send to the destination countries. Twilio charges apply; trial accounts and local regulations may impose additional restrictions. Configure and verify Twilio's STOP/opt-out handling for the sender before using this feature. Never put credentials in the sheet or source control. Compose forwards these optional environment variables.

On a saved draw, open **SMS reminders** and load the original registration sheet and worksheet. Map name, institute, phone and SMS-consent columns, then import contacts. This works for existing and new draws. The import verifies each original row's name and institute, rejects duplicate name/institute combinations and refuses mismatches rather than guessing. Numbers must be in E.164 format, for example `+14155552671`; only `Yes` or `TRUE` (case-insensitive) counts as consent. Blank or other consent values are not opted in. Correct invalid opted-in numbers in the sheet before importing. Other sheet columns are not stored.

Create a schedule, then enable reminders. The app captures the organizer's browser time zone for SMS times; check that it is the tournament's time zone in the confirmation. Each known, opted-in player receives one reminder at most one hour before their current scheduled match. If the match is subsequently at least 30 minutes later than its original scheduled time, the player receives at most one delay alert; court-only changes do not trigger an alert. If the first reminder is already for a delayed match, it also serves as the delay alert. BYEs, completed or started matches and matches whose scheduled start has passed are not messaged. Old schedules without original match times cannot trigger delay alerts.

The app must be running to send reminders. It checks approximately every 30 seconds; after downtime it sends still-relevant reminders only if the match has not started and its scheduled time has not passed. A provider acceptance is not proof of delivery. Attempts that fail or have an uncertain outcome are shown to the organizer and are **not retried automatically**, to reduce duplicate messages; check Twilio before taking further action. Disabling reminders prevents future attempts but cannot cancel a request already being sent. This JSON-backed worker is designed for one app process only; do not run multiple instances against the same data.

The import is a snapshot, not a live subscription to the sheet. When consent is withdrawn or contact details change, disable reminders and re-import immediately; also honor STOP requests through Twilio. The organizer is responsible for obtaining and documenting consent and complying with applicable messaging rules. Phone numbers are stored unencrypted in the private draw data file, are not included in participant views or Excel exports, and are deleted when the draw is deleted. Restrict access to the data volume and its backups, and remove backups according to your retention policy.

## Deploy with Docker

The Compose configuration runs **one** application instance and binds it to localhost only. Provide a reverse proxy with HTTPS and a domain; Google OAuth production redirects require HTTPS. Point the domain at the server, configure the proxy to forward requests to `127.0.0.1:5000`, and enable automatic TLS certificate renewal. Set the Google redirect URI to `https://your-domain/auth/callback`.

On the server, configure `.env` with:

```dotenv
APP_URL=https://your-domain
GOOGLE_CLIENT_ID=your-oauth-client-id
GOOGLE_CLIENT_SECRET=your-oauth-client-secret
```

Then run:

```sh
docker compose up --build -d
docker compose ps
curl -fsS http://127.0.0.1:5000/health
```

The application requires a production HTTPS `APP_URL`, and only accepts browser write requests from that origin. `/health` is a liveness check, not a check of Google authorization or storage availability. After deploying, visit the HTTPS URL and verify Google sign-in, sheet access, draw creation, result entry, and export.

Saved draws are stored in the `draw-data` Docker volume at `/app/data/draws.json`; back up and protect that volume because it contains player data. Restoring it requires stopping the application and restoring the file to the volume before restarting. Avoid running multiple instances or writing to the data file externally: the file store is designed for a single process, not concurrent servers. Deleting a draw permanently removes it from the application, but not from backups or exported files.

Sign-in sessions and Google tokens are held in server memory, not in the volume. Sessions expire after eight hours and are lost on restart; organizers must sign in again. Google access is checked when reading a sheet, but already-created draws remain available to their owner until deleted, even if sheet access is subsequently revoked. Protect server access and backups accordingly.

## Limitations

- One knockout event per draw; doubles pairs must already be represented as a single name/institute in a row.
- No shared court scheduling across different draws, tie-breaking, consolation brackets, shared draw ownership, or automatic import of Excel results. Each draw assumes exclusive use of its numbered courts.
- Match scores are free text, not validated against badminton scoring rules.
- The application takes a snapshot at draw creation; subsequent Sheet edits do not update a saved draw.
- The Compose file does not configure a reverse proxy, TLS certificates, OAuth credentials, or backups. Those are deployment operator responsibilities.
