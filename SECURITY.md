# Scraper Studio security

The security model, what data goes where, the hardening already in place, and the gaps that remain. Operational
procedures (rotation, incidents) are in [RUNBOOK.md](RUNBOOK.md); configuration in
[docs/web-deploy.md](docs/web-deploy.md).

## Reporting an issue

Report suspected vulnerabilities privately to the Semrush owner of this repository (to be named at handoff; see
[HANDOFF.md](HANDOFF.md#decisions-semrush-must-make-before-go-live)), not in a public issue. Include the version, the
edition (Mac or browser), steps to reproduce and any log `ref`.

## Trust boundaries

```
 browser ──TLS──► reverse proxy ──► SSO proxy (oauth2-proxy / Cloudflare Access) ──► studio server (Node, one process)
                                     sets the email header                             │  data folder (0700)
                                                                                       ├─► Claude CLI / Codex CLI (child processes)
                                                                                       └─► Apify · Anthropic · OpenAI · Google · Monday
```

| Boundary | Trusted? | Control |
| --- | --- | --- |
| Browser → server | No | Session required on every API call (except `/healthz`, `/readyz`); same-origin check on state-changing requests; strict CSP; per-viewer state projection. |
| SSO proxy → server | Only the proxy | The email header is believed only from `STUDIO_TRUSTED_PROXY_CIDRS` and/or with `X-Studio-Proxy-Secret`; the server won't start with company sign-in and neither. The proxy must strip any client copy of the header. |
| Server → AI CLIs | Partly | CLIs run with an environment stripped of `STUDIO_*` and key variables (`studioCliEnv`, `studio-host.js`). The Claude CLI runs with tools, MCP, slash commands and session persistence off; Codex runs in an empty temp folder with a read-only sandbox and its tools off. A read-only sandbox still allows reads of anything the server's user can read. |
| Server → providers | Yes, over HTTPS | Keys sent only to their own provider. |
| Collected posts → prompts | **Untrusted data** | Prompts mark posts, lookups and memory "data, not instructions"; outputs are schema-validated and checked (quotes must match stored posts, ids must exist). |
| Ask AI → actions | Only through a click | The model can only propose buttons; the person clicks; paid work confirms again; the server checks the role on every call. |

## Authentication

- **Mac app**: the person at the Mac is the admin (`{ id: 'local', role: 'admin' }`).
- **Company sign-in** (recommended): `STUDIO_TRUSTED_EMAIL_HEADER` + `STUDIO_ALLOWED_EMAIL_DOMAINS`; people are matched
  to People by email, case-insensitively; `STUDIO_ADMIN_EMAILS` are always admins. The proxy owns the session.
- **Admin password + personal sign-in links** (no proxy): `STUDIO_PASSWORD` (16+ characters) signs in as an admin for
  12 hours; everyone else uses a link made in People & access (`/#signin=<64 hex>`: 32 random bytes, stored as a
  SHA-256 hash, compared timing-safely, the fragment never reaches the server's logs), giving a 30-day session; the
  link itself expires after `STUDIO_LINK_DAYS`. Making a new link, turning it off, disabling or removing the person ends
  every session that used it. Password tries are limited to ten a minute per client.
- Sessions live in memory (at most 1,000 password and link sessions); a restart signs those people out.

## Authorization

- **Deny by default.** Every IPC and RPC handler is wrapped by `gated()` (`src/main/index.js`) and checked by
  `access.check` against the person's capabilities (`src/shared/roles.json`). Unknown methods are refused.
- Two capabilities are locked to admins and can't be granted: **Settings and connections** and **People and access**.
- Channel-based roles can only ever call `channelSafeMethods`, with payloads rebuilt from an allowlist.
- **Previews** (View as) are read-only: only identity and read methods run.
- **Projection**: each viewer receives only the state its role may see; roles without See costs never receive money
  figures (`stripMoney`), and channel owners get only their channel.
- Errors that would expose providers, models, billing or settings become "Ask <admin>" lines for non-admins.
- During a drain, paid methods are refused with 503 `restarting`, and the workflow engine starts nothing new.
- **Workflows** run unattended but act with their owner's access, checked before every step
  (`access.canIdentityCall`); a lost capability pauses the workflow for an admin. Nothing they start spends outside an
  admin-approved per-run and per-month budget bound to a hash of the paid setup, and their decisions are credited to
  the workflow, not to a person. Only the engine may link a child run to a workflow (`createAssetKit` refuses a
  `workflow` field from any other caller).

## Secrets at rest and in memory

| Secret | Where |
| --- | --- |
| Provider keys saved in Settings | `config.json`: on the Mac encrypted with Electron `safeStorage` (the keychain; the app refuses to save when it isn't available); on Windows `safeStorage` uses DPAPI, which ties the keys to the Windows user account, not to the app, so any program running as that same user can decrypt them; on the web AES-256-GCM with `STUDIO_SECRET_KEY`. The page only ever learns whether a key is saved. |
| `STUDIO_SECRET_KEY`, `STUDIO_PASSWORD`, `STUDIO_PROXY_SECRET` | Read once from `STUDIO_SECRETS_FD` or `STUDIO_SECRETS_FILE`, deleted from `process.env`, kept in memory. Started as root with `STUDIO_RUN_AS`, the server reads a root-only file and then switches user, so neither the file nor (on Linux) its memory and starting environment are readable to its own user. Secrets set as environment variables still work, with a startup warning. |
| Sign-in links | SHA-256 hashes in `team.json`. |
| The Google Drive service account key | Saved like the provider keys (`config.json`, `GOOGLE_DRIVE_SERVICE_ACCOUNT`, encrypted), only after Google accepts it, and only five fields (type, email, private key, key id, project). No environment fallback, refused by save-key, never sent to the page (Settings shows the service account's email). Access tokens it gets live in memory only. `drive-sync.json` holds folder and file ids and the sync log, never the key. |
| The Apify token in setup files | Only when the exporter ticks **Include the shared Apify token**; such a file is written owner-only and is as sensitive as the token. |
| Dev-only | `.env.local` in a checkout may hold an `OPENAI_API_KEY` for `npm run dev` (git-ignored; never in a package; `STUDIO_DISABLE_LOCAL_ENV=1` turns it off). `.claude/launch.json` may hold preview passwords (git-ignored). |

Data folder: 0700, files 0600 (`umask 077`) on macOS and Linux. On Windows those modes do nothing: the data folder
(`%APPDATA%\apify-scraper-studio`) is protected only by the user profile's permissions, and an exported setup file
written "owner-only" is readable by whoever can read the folder it was saved in. Server logs never contain bodies,
passwords, link tokens, cookies or keys; messages written for people have server paths removed, and unexpected errors
reach the browser only as a ref.

## Data flows

| Data | Destination | When | Code |
| --- | --- | --- | --- |
| Program sources (accounts, subreddits, search terms), date window, caps | Apify (and the chosen Actors) | Every research run and quick scan collection; scraper runs | `research-collection.js`, `apify-runner.js` |
| Collected posts (text, authors, links, engagement) | The AI route (Anthropic, or OpenAI through Codex) | Discovery, synthesis, matching, tagging and reports | `research-prompts.js`, `research-reports.js` |
| Reports, brand knowledge, reference docs, up to 120 cited posts | The AI route | Channel assets and Create content | `asset-kit.js`, `content-studio.js` |
| The app guide, a studio summary (connections as yes/no only, programs, runs, trends, report and folder titles, the team for admins), the conversation, its summary and recalled memory | The AI route | Every Ask AI question | `helpContext`, `helpPromptParts` |
| Report text (up to 16,000 characters), run details, trend history, earlier conversations, a keyword search of collected posts (12 posts: platform, author, text up to 400 characters, link, date), spend | The AI route | Ask AI's second call, when a question needs a lookup | `helpLookup` |
| Art direction and brand reference images | OpenAI Images | Pictures (channel assets, Ask AI, Create content) | `image-provider.js` |
| Report and asset files, datasets | Google (Docs, Drive, Sheets through the bridge) | Only when someone publishes or exports | `bridge-delivery.js`, `google-delivery.js`, `workbooks.js` |
| Trends reports, editorial toolkits and quick scan reports (the rendered report page, edits included), plus channel assets (text as Docs, PNG pictures) when that option is on; folder names (run date, program name, trend name, quick scan topic, channel team); the asset id as a file tag | Google Drive (`www.googleapis.com`), into the one folder an admin chose | Automatically once an admin connects Settings → Google Drive and turns on **Add every new report to Drive** (a few seconds after a report is written, a minute after an edit), on **Copy existing reports**, and on **Retry** | `drive-sync.js`, `drive-client.js` |
| A signed JWT (the service account email, the Drive scope, an hour's expiry) | Google's token endpoint (`oauth2.googleapis.com`, fixed in code; a key file's own `token_uri` is ignored) | When the cached access token is within a minute of expiring | `drive-client.js` |
| Trend cards: name, stage, studio key, priority, category, momentum, sources count, program, date found, who decided (name and note), report and studio links, channel answers (channel, using or not, planned date, link), notes | Monday.com | Automatically when an admin turns sync on (as changes happen, hourly or daily), or on **Sync now** | `monday-engine.js`, `monday-cards.js`, `monday-sync.js` |
| From Monday: item status (Yes or Skip while a trend waits for an OK), owner, planned date, comments (plain text, ten per item, treated as data), deletions | The studio's `content-studio/monday.json` | On each check (webhook or poll) | `monday-engine.js` |
| Prompt versions, Ask AI memory | Stay in the data folder | — | `prompt-store.js`, `ask-store.js` |

Monday.com webhooks (`POST /hooks/monday/<64-hex secret>`) skip sign-in and the same-origin check: the 32-byte
random secret in the URL is the credential (only its sha256 is stored), the request log shows the route but never the
secret, bodies are capped at 64 KB and 1,200 events a minute, and payload values are never applied. A webhook only
queues a re-read of a linked item through the API with the studio's token, so a forged call can at most cause a re-read.
Yes or Skip from Monday counts only while a trend waits for an OK, from a studio member matched by email who may decide
trends (web default) or anyone who can edit the board (the Mac, which has no member list); it never starts paid work.

The Google Drive folder sync acts as the service account, which can reach only what was shared with it: give it Editor
on the one folder (or Contributor on a shared drive), nothing broader. Its scope is full Drive (`auth/drive`) because it
must write into a folder a person created; Google limits it to shared items. It never reads files it didn't make, never
deletes anything (a report deleted in the studio stays in Drive), and it spends no AI money. Open in Drive links reach
only roles with Read reports and assets; whether they open depends on Drive's own sharing.

API keys and tokens never enter prompts. Ask AI's memory refuses secret-shaped text (`looksSecret`). Collected posts
contain third-party personal data (names, handles, post text): see retention below.

## Prompt injection

Posts and documents are attacker-controllable text. Mitigations:

- Prompts wrap them as data, not instructions, and the studio checks every answer against a strict schema; report
  quotes must match stored post text; ids outside the input are dropped.
- The Claude CLI runs with no tools; Codex with tools off and a read-only sandbox in an empty folder.
- Ask AI can't act on its own: it proposes buttons, links and web addresses only from what it was given (unknown web
  links show as plain text; studio links must resolve to real items), and each click is re-checked against the role.
  It can't change settings, keys, people or roles, delete anything for good or send messages.
- Notes for the AI (a program's notes, a workflow's notes for channel assets) are admin-written text placed after the
  instructions and before any untrusted data, refuse key-shaped text and never override the prompt's rules.
- Workflow approval rules read only computed scores (momentum, priority, speed, counts), never post text, and make
  no AI calls, so a post can't talk a workflow into approving it.
- Residual risk: a crafted post could steer a report's wording or an Ask AI suggestion. Human review (Yes/Skip, the
  report editor, confirmations) is the backstop.

## Retention and deletion

| Data | Kept |
| --- | --- |
| Collected posts and run files | Until the run is deleted (no automatic expiry). |
| Ask AI | 200 conversations and 300 active memory items per person (oldest unpinned trimmed); deleting a conversation is permanent; removing a person deletes their conversations and memory. |
| Team activity / access log | 5,000 / 2,000 rows. |
| Browser transfers | Uploads and downloads expire after 10 minutes; the transfer folder is emptied at every start; export copies older than `STUDIO_EXPORT_DAYS` (7) are removed at start. |
| AI replies the studio couldn't read (`content-studio/diagnostics`) | The newest 10 files, none older than 30 days (keys redacted, owner-only, 100 KB each). Not removed when a conversation, run or person is deleted; delete the folder to clear them. |
| Backups | As long as the operator keeps them (`--keep`). They contain everything above. |
| Copies in Google Drive (folder sync) | In Drive, under the organization's Drive retention; the studio never deletes them. Disconnect stops new copies and removes the key; the id map in `drive-sync.json` stays so a reconnect doesn't copy twice. |
| Workspaces hidden by a one-workspace build | Kept on disk with all their records (hidden, not deleted), plus a one-time `content-studio/state.before-single-workspace.json` (0600, a copy of `state.json` from before the switch). Delete both deliberately if that data must go; see RUNBOOK. |

Semrush should set a retention policy for collected posts and conversations (see HANDOFF decisions).

## Hardening already in place (browser studio)

- Strict Content Security Policy, `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, no third-party
  scripts or fonts; HSTS with `STUDIO_SECURE_COOKIES=1`; the session cookie is `HttpOnly`, `SameSite=Strict`, and
  `Secure` behind HTTPS.
- Same-origin check on state-changing requests (`STUDIO_PUBLIC_ORIGIN` behind a Host-rewriting proxy).
- Upload limits (30 MB each, 10 unused per person, 1 GB server-wide), download limits (20 per person, 2 GB), single-use
  uploads owned by the uploader; only roles that can import files may upload.
- Live-update caps per person and server-wide; slow readers dropped; backpressure.
- Health endpoints reveal nothing private.
- The server refuses to run as root without `STUDIO_RUN_AS` (the AI it runs would otherwise have root).
- Electron fuses in the Mac build: no run-as-node, no `NODE_OPTIONS`, no inspector arguments, asar integrity,
  app only from asar, cookie encryption.
- CI fails on high-severity advisories in production dependencies (`npm audit --omit=dev --audit-level=high`).

## Hardening checklist for a deployment

- [ ] Company sign-in through an SSO proxy, with `STUDIO_TRUSTED_PROXY_CIDRS` or `STUDIO_PROXY_SECRET`; checked that a
      forged header is ignored.
- [ ] The studio port reachable only from the proxy (internal network or `127.0.0.1`).
- [ ] Secrets in a root-only file (0400) or a descriptor; nothing secret in the environment; no startup warning.
- [ ] Provider keys saved in Settings, not in the environment.
- [ ] `STUDIO_SECURE_COOKIES=1` and `STUDIO_PUBLIC_ORIGIN` set behind HTTPS.
- [ ] Codex off on the shared server, or `codex` run as an OS user that can't read `STUDIO_DATA_DIR`.
- [ ] A dedicated Google account for the Sheets bridge and Drive, with only the studio's folders shared; the bridge URL
      treated as a secret.
- [ ] `STUDIO_DAILY_AI_BUDGET_USD` and Apify account limits set.
- [ ] Backups scheduled, the secrets file stored separately, a restore practised.
- [ ] Log shipping for the JSON logs; alerts on `/readyz` and on `uncaught-exception`.
- [ ] Dependabot or the Semrush equivalent enabled; `npm audit --omit=dev` clean.

## Known gaps

- **The Sheets bridge has no authentication.** It must be deployed "Anyone" because the app sends no credential, so
  its URL is a bearer secret that can read any sheet the deploying account can open, clear tabs and create Drive files.
  Fix: a `BRIDGE_SECRET` script property checked in `doPost`, sent by `callSheetsWebhook` as a new saved key, plus an
  allowlist for actions that change existing sheets. Interim: [docs/sheets-guide.md](docs/sheets-guide.md#deploy-the-bridge-and-what-it-can-reach).
- **Codex reads.** Its read-only sandbox doesn't restrict reads; a future Codex tool under a new feature name would not
  be switched off automatically. `web_search` stays on.
- **No audit trail** for key, setting or AI-route changes (people and role changes are audited).
- **Sessions in memory**; the admin password is a shared identity (`owner`), so its users share one Ask AI history.
- **The Google Docs token** is pasted by hand and expires; there is no OAuth flow.
- **Setup files** can carry the Apify token.
- **Auto-update** code is dead but present; its embedded `app-update.yml` points at a personal GitHub.
- **The Windows installer is unsigned** until Semrush supplies signing: SmartScreen warns, and WDAC, AppLocker or Smart
  App Control may block it. Anyone could ship a look-alike installer, so hand it out only from a trusted location with
  its SHA-256. On Windows, saved keys are readable by any program running as the same user (DPAPI, above).
- `index.js` honours `ELECTRON_RENDERER_URL` in packaged builds; the entitlements include
  `disable-library-validation`.
- Dev-only dependency advisories remain (none ship).
- The repository was public and personally owned at handoff; scan the full history for secrets before moving it.
