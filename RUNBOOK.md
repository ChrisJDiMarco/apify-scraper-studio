# Scraper Studio runbook

Procedures for building, releasing, deploying and running Scraper Studio. The browser studio's settings are explained
in [docs/web-deploy.md](docs/web-deploy.md) (keep that path: the launcher and the Dockerfile print it); this file is
the "what do I do" companion. Background: [HANDOFF.md](HANDOFF.md).

## Environments and prerequisites

| Environment | Needs |
| --- | --- |
| Development | macOS, Windows 10/11 or Linux, Node 24 (`nvm use` reads `.nvmrc`; on Windows see [HANDOFF.md](HANDOFF.md#quickstart-for-a-new-developer)), git. `npm run dev` downloads Electron the first time (`predev`). |
| Mac release | macOS with Xcode command-line tools, a Developer ID Application certificate, Apple notarization credentials. |
| Windows release | A Mac with Rosetta (Apple silicon) or an Intel Mac, or the `windows-installer` CI job on windows-latest. Signing (when Semrush supplies it) runs on windows-latest. |
| Browser studio | Linux with Docker (or Node 24 and systemd), a persistent volume, a TLS reverse proxy, an SSO proxy (recommended), outbound HTTPS to the providers below. |

Outbound hosts the server calls: `api.anthropic.com`, `api.apify.com` (and Apify dataset storage), `api.openai.com`,
`docs.googleapis.com`, `www.googleapis.com`, `docs.google.com` and `script.google.com` (Google delivery and the Sheets
bridge), `oauth2.googleapis.com` (the Google Drive folder sync's service account sign-in), `api.monday.com`. Corporate proxies: Node 24 honours `HTTPS_PROXY`/`NO_PROXY` with `NODE_USE_ENV_PROXY=1`
(check it on the Node patch you deploy); add an inspecting CA with `NODE_EXTRA_CA_CERTS`.

## Install for development

```bash
git clone <internal repo URL> scraper-studio && cd scraper-studio
nvm use && npm ci
npm test            # offline, free
npm run dev         # the Mac app
```

Never run `npm audit fix` or `npm install` with `--omit=dev` in a development checkout: it strips the dev
dependencies (Vite, Vitest, Electron) from `node_modules`.

`package.json` makes this a one-workspace build (`studioWorkspace`, below), and `npm run dev` uses your real data
folder. To keep a second workspace while developing, start with `STUDIO_WORKSPACE_MODE=multi npm run dev` (PowerShell:
`$env:STUDIO_WORKSPACE_MODE='multi'; npm run dev`).

## Release the Mac app

1. Merge to `main`, bump `version` in `package.json`, add a [CHANGELOG.md](CHANGELOG.md) entry, and run
   `npm run check` and `node scripts/prompt-goldens.mjs --check`.
2. Tag: `git tag -a v<version> -m "Scraper Studio <version>"`.
3. Build: `CSC_NAME="<Company> (<TEAMID>)" APPLE_ID=… APPLE_APP_SPECIFIC_PASSWORD=… APPLE_TEAM_ID=… npm run dist:mac`.
   This regenerates the icon (`scripts/build-mac-icon.mjs`), builds, and writes
   `dist/Scraper Studio-<version>-universal.dmg`. Without the Apple variables the build is signed but not notarized.
   Today notarization runs twice when they're set (electron-builder plus `scripts/notarize-if-configured.cjs`); remove
   the `afterSign` hook first (see [HANDOFF.md](HANDOFF.md#cleanup-dependencies-and-release)).
4. Check: `npx @electron/fuses read --app "dist/mac-universal/Scraper Studio.app"`; `xcrun stapler validate` and
   `spctl -a -vv` on the app when notarized; `npm run test:desktop -- --with-data`. (`npm run release:diagnostics`
   fails today; see [HANDOFF.md](HANDOFF.md#cleanup-dependencies-and-release).)
5. Install over the previous version on a clean Mac account and confirm saved keys still decrypt and the data folder
   (`~/Library/Application Support/apify-scraper-studio`) is unchanged. `scripts/installed-app-continuity.cjs` probes a
   running installed app (read the header comment first).
6. Record the tag, commit SHA and `shasum -a 256` of the DMG. Ship the DMG separately from the source zip.

There are no automatic updates: people quit the app (not during a run), open the new DMG and replace the app.
Details and signing caveats: [docs/macos-app.md](docs/macos-app.md).

### One-workspace builds (Semrush package)

`package.json` `studioWorkspace` (`{ "mode": "single", "id": "semrush", "editionId": "semrush", "name": "Main" }`) is on
for the Semrush package, on the Mac and the browser studio. On the browser studio `STUDIO_WORKSPACE_MODE=single|multi`
and `STUDIO_WORKSPACE_NAME` override it. In single mode:

- The studio has one workspace of the Semrush edition, shown as **Main**. The sidebar shows only its name (no switcher,
  no New workspace), and Brand knowledge keeps the name read-only. `--studio-workspace=` is ignored, with a warning.
- **First start after turning it on** (`src/main/content-workspace.js` `migrateWorkspacePolicy`): the Semrush-edition
  workspace that holds the data becomes Main (its old name is kept as `previousName`); every other workspace is
  archived. Archived workspaces disappear from the state, the switcher and the scheduler, but their programs, runs,
  reports, prompts, brand images and Ask AI memory all stay on disk. Before the first change, `content-studio/state.json`
  is copied once to `content-studio/state.before-single-workspace.json`. Settings → Files & workspace (Studio details on
  the web) lists what is kept and hidden. The startup log has a `workspace-policy` line.
- Setup files of the other edition are refused, and New workspace is refused by the server (409 `singleWorkspace`).
- **Undo**: start once with `STUDIO_WORKSPACE_MODE=multi` (or remove the field). Archived workspaces come back, Main gets
  its old name back, and their schedules start again at their next time, never all at once.

## Release the Windows app

The Windows 10/11 x64 installer is unsigned until Semrush supplies signing (see
[HANDOFF.md → Windows desktop](HANDOFF.md#windows-desktop)). Build it on a Mac or on CI:

- **On a Mac.** electron-builder's bundled `makensis` is an Intel binary, so Apple silicon needs Rosetta once (a system
  change; it asks for an admin password). Wine is not needed for an unsigned build.

  ```bash
  softwareupdate --install-rosetta --agree-to-license
  arch -x86_64 /usr/bin/true && echo "Rosetta OK"
  ```

  Build from a clean checkout of the release commit. The subshell drops the Apple and Mac signing variables, so
  neither notarization nor a Mac `.p12` touches the Windows build:

  ```bash
  (unset APPLE_ID APPLE_APP_SPECIFIC_PASSWORD APPLE_TEAM_ID CSC_LINK CSC_KEY_PASSWORD CSC_NAME WIN_CSC_LINK WIN_CSC_KEY_PASSWORD; npm run dist:win 2>&1 | tee dist-win.log)
  ```

  The first build downloads Electron for Windows into `~/Library/Caches/electron`, so it needs a network connection.

  Without Rosetta, a zip of the app (no installer) still builds, and it runs from the unzipped folder:
  `(unset …the same variables…; npm run build && npx electron-builder --win zip --x64 --publish never)` writes
  `dist/Scraper-Studio-<version>-Windows-x64.zip` and `dist/win-unpacked/`. `npm run dist:win` stops at the installer
  step with `Cannot spawn …/makensis: Error: spawn Unknown system error -86` (Intel binary, no Rosetta).
- **On CI.** The `windows-installer` job (`.github/workflows/ci.yml`, every push) builds the same installer, installs it
  silently, launches it once and uploads it as the `scraper-studio-windows-x64` artifact:
  `gh run download <run-id> -n scraper-studio-windows-x64`.

Check the output:

```bash
ls -la dist/*-Windows-x64.exe dist/*-Windows-x64.exe.blockmap dist/latest.yml
file "dist/win-unpacked/Scraper Studio.exe"      # expect PE32+ executable (GUI) x86-64; Aarch64 means the wrong arch
npx --no-install electron-fuses read --app "dist/win-unpacked/Scraper Studio.exe"
npx --no-install asar list "dist/win-unpacked/resources/app.asar" | grep -E "out/main/(index|studio-host|cli-runners)\.js|out/shared/(durable-write|text-decode)\.js"
grep -i "default Electron icon" dist-win.log     # expect no match (the icon comes from resources/icon.icns)
```

The installer is `dist/Scraper-Studio-<version>-Windows-x64.exe` (with its `.blockmap` and `dist/latest.yml`); the
unpacked app is `dist/win-unpacked/Scraper Studio.exe`. Record the commit SHA and `shasum -a 256` of the installer.

**Install and update.** Run the installer; SmartScreen warns about an unsigned one ("Windows protected your PC": More
info → Run anyway). It installs per user by default, and the person can choose the folder. A silent install for IT or
testing: `Scraper-Studio-<version>-Windows-x64.exe /S /D=C:\path\to\folder` (`/D=` must be last and unquoted). There
are no automatic updates: close the app's window (closing it quits the app on Windows, and it asks first if a run is
going), then run the new installer. If the app is still open, the installer waits and asks the person to close it
instead of ending it. The data folder,
`%APPDATA%\apify-scraper-studio`, is kept across updates and uninstalls.

**Signing** (once Semrush picks a route; the decision is in [HANDOFF.md](HANDOFF.md#decisions-semrush-must-make-before-go-live)):

- Azure Trusted Signing (preferred) runs on windows-latest, because electron-builder installs the `TrustedSigning`
  PowerShell module. With `AZURE_TENANT_ID`, `AZURE_CLIENT_ID` and `AZURE_CLIENT_SECRET` set as GitHub secrets, the job
  runs `npx electron-builder --win --x64 --publish never -c.forceCodeSigning=true` plus
  `-c.win.azureSignOptions.publisherName="<certificate subject CN>"`,
  `-c.win.azureSignOptions.endpoint="https://<region>.codesigning.azure.net"`,
  `-c.win.azureSignOptions.codeSigningAccountName="<account>"` and
  `-c.win.azureSignOptions.certificateProfileName="<profile>"`. `package.json` stays unsigned by default.
- A `.pfx` file: set `WIN_CSC_LINK` (a path, an https URL or base64) and `WIN_CSC_KEY_PASSWORD`, and add
  `-c.win.signtoolOptions.signingHashAlgorithms=sha256`. **Never rely on `CSC_LINK` for Windows**: without the `WIN_`
  variables electron-builder falls back to it and would sign the installer with the Mac Developer ID.

## Build and deploy the browser studio

```bash
docker build -t scraper-studio:<version> .
```

The image holds `out/web`, `src/`, the launcher, the backup and restore scripts and `docs/app-guide.md`. It has no
Claude Code or Codex CLI, so the web uses an Anthropic API key. It starts as root only to read a root-only secrets
file, then runs as `node` (`STUDIO_RUN_AS=node`); tini is PID 1.

**With the deploy kit** ([deploy/README.md](deploy/README.md)): Compose runs Caddy (TLS) → oauth2-proxy (Google
Workspace or Okta) → the studio on an internal network with a fixed proxy address
(`STUDIO_TRUSTED_PROXY_CIDRS=172.30.10.10/32`), 120 s of drain and 150 s of stop grace. systemd runs the studio
behind your own proxy on `127.0.0.1`, with the secrets file as standard input and a nightly backup timer.

**Rules the studio depends on**

- One replica per data folder; stop-then-start updates, never a start-first rollout.
- Secrets only in a root-only file (`STUDIO_SECRETS_FILE`) or a descriptor (`STUDIO_SECRETS_FD`).
- Only the sign-in proxy can reach the studio's port.
- Stop grace period longer than `STUDIO_DRAIN_SECONDS`.
- Proxy: no buffering on `/api/events`, 30 MB bodies, read timeouts of about 900 s, idle keep-alive below
  `STUDIO_KEEPALIVE_SECONDS` (75).

### Secrets

The secrets file holds `NAME=value` lines and nothing else:

```
STUDIO_SECRET_KEY=<openssl rand -hex 32>
STUDIO_PASSWORD=<16+ characters>        # password sign-in only
STUDIO_PROXY_SECRET=<random>            # optional
```

Create it root-owned, mode 0400 (`sudo install -m 400 -o root -g root /dev/null /etc/scraper-studio/secrets &&
sudoedit /etc/scraper-studio/secrets`). Back it up with the data (a restored studio without its `STUDIO_SECRET_KEY`
can't read its saved keys), but store it separately from the data backups. Per-platform recipes: [docs/web-deploy.md](docs/web-deploy.md#secrets).

### Company sign-in and proxy trust

Set `STUDIO_TRUSTED_EMAIL_HEADER`, `STUDIO_ALLOWED_EMAIL_DOMAINS`, `STUDIO_ADMIN_EMAILS` and at least one of
`STUDIO_TRUSTED_PROXY_CIDRS` (the proxy's addresses) or `STUDIO_PROXY_SECRET` (sent as `X-Studio-Proxy-Secret`); the
server refuses to start otherwise. After deploying, check that the proxy strips a forged header: signed in as
yourself, send a request with the header set to someone else's email and confirm the studio still names you
(`curl -s https://<studio>/api/session -H 'X-Forwarded-Email: someone-else@example.com' -b '<your proxy cookie>'`).
The startup line says what is trusted.

### Health checks

| Probe | Use |
| --- | --- |
| `GET /healthz` → 200 `{"ok":true}` | Liveness (restart on failure). |
| `GET /readyz` → 200, or 503 with `checks.data`, `disk`, `lock`, `draining` | Readiness and uptime monitors. |

The image's `HEALTHCHECK` probes `/readyz` every 30 s. Plain Docker doesn't restart unhealthy containers: alert on it.
Kubernetes ignores `HEALTHCHECK`: define the probes.

### Stopping and updating

`docker stop -t 150`, `systemctl stop` or a rollout sends SIGTERM: `/readyz` turns 503, tabs show "The studio is
restarting for an update.", new paid work gets 503 `restarting`, running work gets `STUDIO_DRAIN_SECONDS`, then the
server stops what's left (it shows as stopped and can be retried) and releases the data-folder lock last. A second
signal stops at once. After the restart, open tabs offer a reload, and link and password users sign in again (sessions
are in memory).

Workflows: the drain stops the workflow engine with the research scheduler; a scheduled workflow that comes due while
the server is draining or stopped is not made up later (its next time is computed from the restart), and a run that
was going shows **The studio stopped during this run** with **Try again**, which never pays twice.

**Update**: back up, then `docker compose up -d --build` (or pull the new image and recreate the container). Check
`/readyz`, sign in, open People & access and one report.

## Backup and restore

```bash
npm run backup -- --data /var/lib/scraper-studio --out /var/backups/scraper-studio --keep 14
npm run restore -- --from /var/backups/scraper-studio/scraper-studio-backup-<time>.tar.gz --data /var/lib/scraper-studio        # check only
npm run restore -- --from /var/backups/scraper-studio/scraper-studio-backup-<time>.tar.gz --data /var/lib/scraper-studio --yes  # restore
```

- **Backup** works while the server runs (it repeats passes until nothing changed and records whether it settled),
  skips the transfer area, the lock and temporary files, and writes a `manifest.json` with each file's SHA-256, the
  studio version and the team and state file versions. For a strict point-in-time copy, stop the server or take a
  filesystem snapshot.
- **Restore** refuses while a server holds the folder, rejects tampered files, links and backups from a newer studio,
  and moves the current data to `<data>/.pre-restore-<time>/` (move it back to undo).
- **In Docker**: `docker compose exec studio node scripts/studio-backup.cjs --out /backups --keep 14`; for a restore,
  `docker compose stop studio`, then
  `docker compose run --rm --no-deps studio node scripts/studio-restore.cjs --from /backups/<file> --yes`, then start.
- **After a restore**: start with the same `STUDIO_SECRET_KEY`; in People & access, people added since the backup are
  missing, people removed since are back, and links made since don't work. Runs that were in progress show as stopped.
- **The Mac app**: the same scripts take `--data "$HOME/Library/Application Support/apify-scraper-studio"`; quit the
  app before a restore. **The Windows app**: `--data "$env:APPDATA\apify-scraper-studio"` in PowerShell (Windows 10
  and 11 include `tar`).
- Practise a restore into a spare folder every quarter.

## Upgrades and migrations

- Always back up before an upgrade. There are no downgrades: `team.json` is migrated in place (v1 → v2 → v3) and a
  newer `team.json` makes an older build refuse to start ("This team file is from a newer Scraper Studio"). v3 (Ask AI
  for every role) is written at the first change after the upgrade, so a 0.3.0 build can't open that data folder
  afterwards; restore the pre-upgrade backup to go back.
- **Rollback**: stop, restore the pre-upgrade backup, start the previous image or app version.
- Damaged stores: a `data.json` or `config.json` that can't be parsed is copied to `<file>.bad-<time>` and the studio
  starts from defaults for that store (listed in `state.storeRecovery`); a file that can't be read at all stops startup.
  Inspect the `.bad-*` copy before deleting it.
- Moving the Mac app's data to the server: [docs/web-deploy.md](docs/web-deploy.md#moving-the-mac-apps-data-to-the-server).
- Workflows: `content-studio/workflows.json` (v1) is new; a newer file makes an older build refuse to start ("This
  workflows file is from a newer Scraper Studio"). Old Data tools missions in `v5/events.jsonl` are no longer read or
  run (the file stays; Scrapers still read their saved versions from it). The role policy moves to version 2: custom
  roles show **See workflows and playbooks** and **Build and run workflows** as New and off; Admin and Editor get them.
- Monday.com: the board setup in `config.json` (`monday`) moves to `content-studio/monday.json` on first start, with sync
  left manual; a damaged `monday.json` is copied aside and the next sync finds its items again by Studio key.
- Google Drive folder sync: `content-studio/drive-sync.json` (v1) is new. On first start, if any research program had
  **Publish reports to Google Drive** on, the studio-wide **Add every new report to Drive** switch is turned on once
  (`migratedPrograms`); the programs' own setting is kept and used only until a Drive folder is connected. A damaged
  `drive-sync.json` is copied aside; the next sync finds its files again by their `studioAsset` tag, so nothing is
  copied twice.

## Recover from a stuck data-folder lock

`content-studio/.studio-owner.json` keeps a second process off the folder. A lock left by a killed process is taken
over automatically when it names this process's own PID (a container's main process always gets the same PID), a PID
that no longer exists, or a boot that has ended; a lock from another host is taken over once its heartbeat is more
than two minutes old, or after watching it for 40 s without a beat. The installed desktop app also takes over a lock
that an earlier installed copy left on the same computer (after a crash, a restart or a Windows update), since only one
copy can run at a time; locks from `npm run dev`, a server or version 0.3.0 keep the checks above.

If startup still says "This studio data folder is already open in another server" and you are **sure** no other
studio process uses the folder (check `docker ps`, other hosts mounting the volume, a Mac app pointed at it):

1. Stop the studio.
2. Delete `content-studio/.studio-owner.json`, and `content-studio/.studio-owner-recovery` if present.
3. Start again. Stale Apify collection locks (`content-studio/collections/*.lock`) are cleared when ownership is taken.

On the desktop app (Mac or Windows), **Scraper Studio is already open** means another copy of the app (or a server)
has the folder: quit it. If no copy is running (it didn't close cleanly), delete the lock file the message names and
open the app again.

## Rotate keys and secrets

| What | How |
| --- | --- |
| A provider key (Apify, Anthropic, OpenAI, Google token) | Revoke it at the provider, then **Settings** → save the new one. Re-export setup files that carried the old Apify token. |
| The Monday.com token | Make a new token on Monday (ideally for a shared studio account), then Settings → Monday.com → **Disconnect…** → **Disconnect Monday.com completely** (keep the item map) → **Connect** with the new one. The board link and item map stay; to re-create the instant-update webhooks press **Edit setup** → **Save changes**. Revoke the old token on Monday last. |
| `STUDIO_PASSWORD` | Change it in the secrets file and restart. Every password session ends at restart. |
| A person's sign-in link | People & access → the person → **Make a new sign-in link** (ends the old one) or **Turn off link**. |
| `STUDIO_PROXY_SECRET` | Change it in the proxy's configuration and the secrets file together, then restart both. |
| `STUDIO_SECRET_KEY` | There is no re-encryption tool. Note which keys are saved, put the new value in the secrets file, restart: saved keys now show as saved under a different key (the startup `secrets-check` log line names them). In Settings choose **Clear** for each and save it again. |
| The Google Drive service account key | Google Cloud → IAM & Admin → Service accounts → the studio's account → **Keys** → **Add key** → **Create new key** → JSON. In the studio: Settings → Google Drive → **Replace key**, paste the new file, **Connect** (it is checked with Google before it replaces the old one), then **Test**. The folder, its sharing and every file id stay, because the account (its email) is the same. Then delete the old key in Google Cloud and the downloaded JSON file from wherever it was saved. A *new* service account has a new email: share the Drive folder with it as Editor before **Test**; files the old account made stay in place and are updated by the new one. |
| The Sheets bridge URL | Apps Script → **New deployment** (a new URL), archive the old deployment, paste the new URL in Settings. |
| A leaked source zip or folder | Rotate every key that was in it. A folder copy of a developer checkout can contain `.env.local` (a dev OpenAI key) and `.claude/launch.json` (preview passwords); use `scripts/make-handoff.sh` instead (below). |

## Logs

JSON lines on stdout (`docker compose logs -f studio`, `journalctl -u scraper-studio`): `request` (id, route,
channel, status, ms, identity id), `request-failed` (with the ref shown to the user), `started`, `draining`,
`stopping`, `start-failed`, `untrusted-proxy-header`, `stream-refused`, `stream-dropped`, `owner-lock-lost`,
`unhandled-rejection`, `uncaught-exception`, `secrets-check`, and `sign-in` / `sign-in-failed` / `denied` from the team
store. Never bodies, passwords, tokens, cookies or keys. `STUDIO_LOG_LEVEL=debug` adds reads and streams.

## Incident checklist

| Symptom | Likely cause | Action |
| --- | --- | --- |
| Container restarts in a loop; "already open in another server" | A lock from another live process, or one the takeover rules can't judge | [Recover from a stuck lock](#recover-from-a-stuck-data-folder-lock) |
| "ownership recovery is already in progress" | A crash mid-recovery left `.studio-owner-recovery` | Older than 30 s it is cleared automatically; otherwise delete it with the studio stopped |
| Server refuses to start: proxy trust | Company sign-in without `STUDIO_TRUSTED_PROXY_CIDRS` or `STUDIO_PROXY_SECRET` | Set one (see [Company sign-in](#company-sign-in-and-proxy-trust)) |
| Server refuses to start as root | No `STUDIO_RUN_AS` | Set it (the image does), or start as an ordinary user |
| `/readyz` 503 `disk: low` or `data: unwritable` | Volume full or read-only | Free space or fix the mount; `STUDIO_MIN_FREE_MB` sets the threshold |
| Everyone signed out after a deploy | Sessions are in memory | Expected for link and password users; they reopen their link |
| "Your company sign-in has expired" | The SSO session ended | Reload; check the proxy's session length and `api_routes` |
| "Live updates are paused: the studio has too many open tabs" | `STUDIO_MAX_EVENT_STREAMS` reached | Raise it or close tabs; pages catch up every 30 s |
| Long answers fail at about 100 s | Cloudflare's proxy limit (524) | Raise the limit (Enterprise) or use another proxy; Ask AI's Ask again joins the running answer |
| Ask AI says the answer wasn't valid JSON ("Claude returned structured output that is not valid JSON", "The model's answer wasn't valid JSON") | The model's reply had a mistake the studio couldn't repair, often after the API refused the answer format as too large and the schema went into the prompt | Read the newest file in `content-studio/diagnostics` in the data folder: the reply's text (keys redacted), the route, model and stop reason; the newest 10 are kept, none past 30 days. When the answer itself was readable, Ask AI keeps it and says some extras couldn't be read |
| "The app stopped during this run" | The process stopped mid-run | **Retry unfinished outputs**; finished work is kept |
| Apify job ended ABORTED, or a source stopped at its cap | Its share of the collection budget ran out, or the time limit | Raise the collection budget and retry; kept rows aren't paid for again |
| "This Claude app (…) is too old" | Outdated Claude Code on the host | `claude update`, then **Check Claude** |
| "Your Google Sheets bridge is an older version" | Bridge script out of date | Update it ([docs/sheets-guide.md](docs/sheets-guide.md#update-the-sheets-bridge)) |
| "Google Drive reconciliation required" | A Drive delivery stopped between steps | See [docs/google-delivery.md](docs/google-delivery.md) |
| "This step needs about $X but $Y of the run's AI budget is left" | The run's AI budget ran out | Raise **Total retry budget (USD)** and retry |
| "The studio’s daily AI budget … is used up for today" | `STUDIO_DAILY_AI_BUDGET_USD` reached | Wait until midnight UTC or raise it and restart |
| Saved keys unreadable after a restart | Different `STUDIO_SECRET_KEY` | Restart with the original key; otherwise Clear and re-enter (see rotation) |
| "Something went wrong on the studio server… ref …" | An unexpected server error | Search the logs for the ref (`request-failed`) |
| Nobody can manage People | Last admin left or was disabled | Add an email to `STUDIO_ADMIN_EMAILS` and restart; in password mode the admin password always works |
| A workflow says "Needs a bigger budget" | The next step's cap doesn't fit the run's or the month's approved budget | An approver raises it (**Raise budget** on the run, or **Change budget…**); the waiting run picks it up |
| A workflow was paused: "no longer has access to …" | Its owner's role or access changed | An approver opens it and **Take over**, then turns it on |
| A workflow was paused: "The setup changed since its budget was approved" | A program cap, model, channel or cadence changed | Check the cost and approve the budget again |
| "Monday.com sync is paused: … token" | The token's owner left or the token was revoked | Connect a new token (see rotation); nothing on Monday changes meanwhile |
| "Monday.com's daily API limit is used up" | The plan's daily calls ran out (1,000 on Free, Basic, Standard) | It resumes after midnight UTC; check less often or send hourly (Settings shows the estimate) |
| "Monday couldn't reach this studio" | Webhooks blocked by company sign-in or no public https address | Add the `/hooks/monday/` bypass ([docs/web-deploy.md](docs/web-deploy.md#instant-monday-updates)); it polls every 5 minutes meanwhile |
| Settings → Google Drive says "can see the folder but can't add files" or "can't see that folder" | The folder isn't shared with the service account, or only as Viewer | Share it with the address Settings shows, as Editor (shared drive: Contributor or higher), then **Test** and **Retry** in the sync log |
| "Google says there's no Drive storage left for these files" | A service account has no Drive storage of its own; files it makes in a My Drive folder count against it | Use a folder in a shared drive (recommended), then **Copy existing reports** |
| "Google didn't accept this service account key" | The key was deleted or disabled in Google Cloud, or the host clock is wrong | Check the clock (NTP), then rotate the key (see rotation) |
| "The Google Drive API is turned off …" | The service account's Cloud project doesn't have the Drive API enabled | APIs & Services → Library → Google Drive API → Enable; **Test** |
| "Changed back … on Monday" in the sync log | Someone (or a Monday automation) changed a stage the studio owns | Expected; after three in an hour the item shows **Changed on Monday** until **Sync now** |

## Live verification (costs money)

Run these only when paid checks are approved. Each uses the keys saved in the app.

| Command | What it spends |
| --- | --- |
| `npm run build && npx electron scripts/service-smoke.cjs --live` | Up to 10 results from each of 4 sources at $0.25 per source, plus one Claude findings answer and report ($1 request budget). `--live --reddit-only`: one $0.25 Reddit collection, no AI. |
| `node scripts/content-studio-live.cjs` | One content run, at most $1.50. |
| `npm run build && npx electron scripts/image-provider-live.cjs` | One OpenAI picture, at most $0.50. |

`service-smoke.cjs` writes its receipt and screenshots to a fresh temp folder (or `STUDIO_VERIFICATION_DIR`) and prints
it. The other two still write receipts into `docs/verification/`: don't commit those.

## Build the handoff bundle

```bash
scripts/make-handoff.sh ~/Desktop/scraper-studio-<version>-source.zip           # from HEAD
scripts/make-handoff.sh --ref v<version> ~/Desktop/scraper-studio-<version>-source.zip
```

On Windows, run it from Git Bash (Git for Windows ships `unzip`); a Windows path such as `C:\Users\<you>\Desktop\x.zip`
works as the output.

The script archives a committed git revision with `git archive` (never the working folder, so uncommitted files,
`.env.local`, `.claude/`, `node_modules/`, `dist/`, `out/` and `coverage/` can't get in), refuses to run with
uncommitted changes unless `--allow-dirty` is given, excludes `.env*` files other than `.env.example`, scans the archive
for key-shaped strings and secret file names (and fails if it finds one), adds a `HANDOFF-MANIFEST.txt` with the commit,
and prints the zip's size and SHA-256 (also written next to it as `<zip>.sha256`). Ship the DMG as a separate file with
its own checksum.

To include history, bundle named refs only, never `--all`: `--all` also packs `refs/original/` (the backup
`git filter-branch` left, which still holds the commits from before the history was scrubbed), the `refs/codex/`
checkpoints and the `claude/*` agent branches. First delete the filter-branch backup and scan what's left:

```bash
git update-ref -d refs/original/refs/heads/main     # if it exists (git for-each-ref refs/original)
gitleaks git                                         # the history scan HANDOFF.md's Decisions table recommends
git bundle create ~/Desktop/scraper-studio-<version>.bundle main v<version>   # leave out v<version> if it isn't tagged yet
```
