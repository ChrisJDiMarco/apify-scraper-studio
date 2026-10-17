# Scraper Studio runbook

Procedures for building, releasing, deploying and running Scraper Studio. The browser studio's settings are explained
in [docs/web-deploy.md](docs/web-deploy.md) (keep that path: the launcher and the Dockerfile print it); this file is
the "what do I do" companion. Background: [HANDOFF.md](HANDOFF.md).

## Environments and prerequisites

| Environment | Needs |
| --- | --- |
| Development | macOS or Linux, Node 24 (`nvm use` reads `.nvmrc`), git. `npm ci` downloads Electron. |
| Mac release | macOS with Xcode command-line tools, a Developer ID Application certificate, Apple notarization credentials. |
| Browser studio | Linux with Docker (or Node 24 and systemd), a persistent volume, a TLS reverse proxy, an SSO proxy (recommended), outbound HTTPS to the providers below. |

Outbound hosts the server calls: `api.anthropic.com`, `api.apify.com` (and Apify dataset storage), `api.openai.com`,
`docs.googleapis.com`, `www.googleapis.com`, `docs.google.com` and `script.google.com` (Google delivery and the Sheets
bridge), `api.monday.com`. Corporate proxies: Node 24 honours `HTTPS_PROXY`/`NO_PROXY` with `NODE_USE_ENV_PROXY=1`
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

## Release the Mac app

1. Merge to `main`, bump `version` in `package.json`, add a [CHANGELOG.md](CHANGELOG.md) entry, and run
   `npm run check` and `node scripts/prompt-goldens.mjs --check`.
2. Tag: `git tag -a v<version> -m "Scraper Studio <version>"`.
3. Build: `CSC_NAME="<Company> (<TEAMID>)" APPLE_ID=… APPLE_APP_SPECIFIC_PASSWORD=… APPLE_TEAM_ID=… npm run dist:mac`.
   This regenerates the icon (`scripts/build-mac-icon.mjs`), builds, and writes
   `dist/Scraper Studio-<version>-universal.dmg`. Without the Apple variables the build is signed but not notarized.
   Today notarization runs twice when they're set (electron-builder plus `scripts/notarize-if-configured.cjs`); remove
   the `afterSign` hook first (see [HANDOFF.md](HANDOFF.md#cleanup-dependencies-and-release)).
4. Check: `npm run release:diagnostics`; `npx @electron/fuses read --app "dist/mac-universal/Scraper Studio.app"`;
   `xcrun stapler validate` and `spctl -a -vv` on the app when notarized; `npm run test:desktop -- --with-data`.
5. Install over the previous version on a clean Mac account and confirm saved keys still decrypt and the data folder
   (`~/Library/Application Support/apify-scraper-studio`) is unchanged. `scripts/installed-app-continuity.cjs` probes a
   running installed app (read the header comment first).
6. Record the tag, commit SHA and `shasum -a 256` of the DMG. Ship the DMG separately from the source zip.

There are no automatic updates: people quit the app (not during a run), open the new DMG and replace the app.
Details and signing caveats: [docs/macos-app.md](docs/macos-app.md).

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
  app before a restore.
- Practise a restore into a spare folder every quarter.

## Upgrades and migrations

- Always back up before an upgrade. There are no downgrades: `team.json` is migrated in place (v1 → v2) and a newer
  `team.json` makes an older build refuse to start ("This team file is from a newer Scraper Studio").
- **Rollback**: stop, restore the pre-upgrade backup, start the previous image or app version.
- Damaged stores: a `data.json` or `config.json` that can't be parsed is copied to `<file>.bad-<time>` and the studio
  starts from defaults for that store (listed in `state.storeRecovery`); a file that can't be read at all stops startup.
  Inspect the `.bad-*` copy before deleting it.
- Moving the Mac app's data to the server: [docs/web-deploy.md](docs/web-deploy.md#moving-the-mac-apps-data-to-the-server).

## Recover from a stuck data-folder lock

`content-studio/.studio-owner.json` keeps a second process off the folder. A lock left by a killed process is taken
over automatically when it names this process's own PID (a container's main process always gets the same PID), a PID
that no longer exists, or a boot that has ended; a lock from another host is taken over once its heartbeat is more
than two minutes old, or after watching it for 40 s without a beat.

If startup still says "This studio data folder is already open in another server" and you are **sure** no other
studio process uses the folder (check `docker ps`, other hosts mounting the volume, a Mac app pointed at it):

1. Stop the studio.
2. Delete `content-studio/.studio-owner.json`, and `content-studio/.studio-owner-recovery` if present.
3. Start again. Stale Apify collection locks (`content-studio/collections/*.lock`) are cleared when ownership is taken.

On the Mac, "Workspace already in use" means another copy of the app (or a server) has the folder: quit it.

## Rotate keys and secrets

| What | How |
| --- | --- |
| A provider key (Apify, Anthropic, OpenAI, Monday, Google token) | Revoke it at the provider, then **Settings** → save the new one. Re-export setup files that carried the old Apify token. |
| `STUDIO_PASSWORD` | Change it in the secrets file and restart. Every password session ends at restart. |
| A person's sign-in link | People & access → the person → **Make a new sign-in link** (ends the old one) or **Turn off link**. |
| `STUDIO_PROXY_SECRET` | Change it in the proxy's configuration and the secrets file together, then restart both. |
| `STUDIO_SECRET_KEY` | There is no re-encryption tool. Note which keys are saved, put the new value in the secrets file, restart: saved keys now show as saved under a different key (the startup `secrets-check` log line names them). In Settings choose **Clear** for each and save it again. |
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
