# Scraper Studio: developer handoff

This is the entry point for the team taking over Scraper Studio. Start here, then follow the links. Every command,
variable, path and count below was checked against the code on branch `redesign/ai-library-access` on 2026-10-17.

**Contents**

1. [What it is](#what-it-is)
2. [Who uses it](#who-uses-it)
3. [Status](#status)
4. [Quickstart for a new developer](#quickstart-for-a-new-developer)
5. [Architecture map](#architecture-map)
6. [Repository map](#repository-map)
7. [Feature tour](#feature-tour)
8. [Configuration reference](#configuration-reference)
9. [Data model and storage](#data-model-and-storage)
10. [AI routes and cost controls](#ai-routes-and-cost-controls)
11. [Security model](#security-model)
12. [Deployment](#deployment)
13. [Operations](#operations)
14. [Testing and CI](#testing-and-ci)
15. [Known limitations and follow-ups](#known-limitations-and-follow-ups)
16. [Decisions Semrush must make before go-live](#decisions-semrush-must-make-before-go-live)
17. [Glossary: UI term and code identifier](#glossary-ui-term-and-code-identifier)
18. [Document map](#document-map)

---

## What it is

Scraper Studio is a social-listening research and content studio for a marketing team. It collects public posts from
X, LinkedIn and Reddit through Apify, uses Claude (or Codex) to find the trends in them, lets people approve the ones
worth a report, writes an evidence-backed **trends report** and **editorial toolkit** per approved trend, and turns any
report into a full set of **channel assets** (blog, newsletter, paid media, PR, social, affiliate, enterprise sales,
Backlinko, Exploding Topics, Search Engine Land) with pictures.

For a one-page visual overview of the loop, Ask AI, automations and the architecture, open
[docs/how-it-works.pdf](docs/how-it-works.pdf) (source: `docs/how-it-works.html`; regenerate with
`npx electron scripts/render-how-it-works.cjs`).

The research pipeline is a port of the team's earlier n8n "Golden Thread" workflow (same Actors, batch sizes, scoring
and sheet layout; see [docs/n8n-parity.md](docs/n8n-parity.md)). Stages:

collect (4 Apify Actors) → prepare evidence → discover in batches → synthesize up to 6 themes → match against tracked
themes and score → **human review** (Yes / Skip) → tag every post → trends report + editorial toolkit per approved
trend → channel assets or one-off drafts → optional delivery to Google Drive, Google Sheets and Monday.com.

One main process (`src/main/index.js`) serves two editions of the same React app:

- **The Mac app** (Electron): one person per Mac, always the admin. Data and keys stay on that Mac.
- **The browser studio**: the same main process on a web runtime, served by `src/main/studio-server.js` to signed-in
  browsers. One shared studio for the team, with roles enforced on the server.

## Who uses it

Semrush marketing roles. Every person has one role; the server enforces it on every call.

| Role | Who | What they get |
| --- | --- | --- |
| **Admin** | The studio's owners | Everything: Settings and keys, People & access, Analytics, research programs and schedules, Brand knowledge, prompt locks. |
| **Editor** | Content and research leads | Find trends (research runs and quick scans), approve them, write and edit reports, make channel assets for any channel, Ask AI, Sheets, data tools, see and edit prompts, see costs. |
| **Channel owner** | One owner per channel (several may share one) | A small layout (Trends, My assets, My plan, Inbox and Ask AI): trends offered to their channel, their channel's drafts, "using / not for us" answers with links and planned dates, and Ask AI scoped to their channel. Never sees money, models or other channels. |

Admins can add up to 12 **custom roles** built on Editor or Channel owner, from the templates Viewer, Analyst and
Channel reviewer, and adjust any person's access per capability (deny wins). **Use Ask AI** is on by default for every
role and template; an admin can switch it off or on for any role or person in People & access (admins always have it).
The model is 28 capabilities over 188 RPC methods; with no policy edits the defaults are admin 188 methods, editor 117, channel owner 34. Details:
[docs/roles-and-access.md](docs/roles-and-access.md).

Two layouts, chosen per person: **Simple** (the default; Home, Trends, Reports, Assets, Inbox, Calendar, Ask AI) and
**Advanced** (`uiMode: 'classic'` in code; every page, including Research programs, Trend board, Sheets, Library,
Brand knowledge and the Data tools). Two **editions** of workspace, fixed at creation: `semrush` (Semrush branding,
prompts and formats) and `general`. The browser studio has one active workspace for everyone; only admins switch it.

## Status

| Item | State |
| --- | --- |
| Version | `0.3.0` (`package.json`). No git tags yet. |
| Branch | `redesign/ai-library-access`, 4 commits ahead of `main` at `62cb9da` plus the uncommitted final build-out. Merge to `main` and tag before handing out builds. |
| Last full test run | `npx vitest run` passed with 199 files and 2,357 tests on 2026-10-18 (macOS), on the uncommitted Windows work on top of `a944e67`. |
| Final build-out (2026-10-17) | Five workstreams (web server, data safety, Ask AI reach, UX flows, cleanup and CI) plus these docs. Each ran the Vitest suites for what it touched, and they passed; the full suite was not run afterwards (the machine was shared). **Run `npm run check` first.** |
| Prompt goldens | `node scripts/prompt-goldens.mjs --check`: 111 cases, 0 differences. |
| Lint | `npm run lint`: 0 errors, 79 warnings (mostly `react-hooks/exhaustive-deps`). |
| Production audit | `npm audit --omit=dev`: 0 vulnerabilities (10 dev-only advisories remain; see follow-ups). |
| Builds | `npm run build` and `npm run build:web` compile. An unsigned Windows x64 zip of the app, `dist/Scraper-Studio-0.3.0-Windows-x64.zip`, was built on this Mac on 2026-10-18 (`npx electron-builder --win zip --x64 --publish never`). The existing `dist/Scraper Studio-0.3.0-universal.dmg` (built 2026-10-17 11:44) predates the Ask AI schema fix `62cb9da` and the final build-out; rebuild before sharing. The Docker image has not been built since the Dockerfile changed (its launcher was tested in a `node:24-bookworm` container). |
| Windows | The Windows 10/11 x64 build is implemented (`npm run dist:win`, see [Windows desktop](#windows-desktop)), and its unit tests run on macOS with the platform faked. An unsigned x64 zip of the app was built on this Mac on 2026-10-18 (`Scraper Studio.exe` is PE32+ x86-64, the fuses read as configured, the app icon replaces Electron's), but it has not been run on Windows. No installer has been built yet: the NSIS step needs Rosetta on Apple silicon (`makensis` fails with error -86 without it), or the `windows-installer` CI job on windows-latest. It is unsigned until Semrush supplies signing. |
| Never verified live | Ask AI after the schema flattening (`62cb9da`) on any route; quick scans; prompt test runs; the Claude CLI and Codex routes end to end; X `since_time:` hour windows; a deployed Sheets bridge or Drive delivery; the deploy kit's oauth2-proxy options; the Windows app on a real Windows PC; notarization; Electron fuses on a built app; the new UI in a real browser (jsdom tests only). |
| Not switched on | Dark mode tokens exist but nothing enables them. Auto-update code exists but has no feed and nothing calls it. |

## Quickstart for a new developer

Prerequisites: macOS, Windows 10/11 or Linux, Node 24 (`.nvmrc`; `package.json` `engines` allows `>=22.13.0`), git. For
live AI you need either the Claude app (Claude Code, signed in) or an Anthropic API key; for collection, an Apify token.

```bash
git clone <internal repo URL> scraper-studio && cd scraper-studio
nvm use                 # Node 24
npm ci
npm test                # Vitest; offline, never spends money
npm run dev             # the desktop app with hot reload (electron-vite); downloads Electron the first time (predev)
```

`npm run dev` uses the same data folder as an installed desktop app (`~/Library/Application Support/apify-scraper-studio`
on macOS, `%APPDATA%\apify-scraper-studio` on Windows, from the package name), so quit the installed app first, and
never while it is running work: the data-folder lock refuses a second process.
`npm run start:semrush` builds and opens the app straight into the Semrush workspace.

**On Windows** use PowerShell and Git for Windows. nvm-windows ignores `.nvmrc`, so name the version: `nvm install 24`
then `nvm use 24` (or `fnm use`, which reads `.nvmrc`, or `volta install node@24`). Then `npm ci`, `npm test` and
`npm run dev` as above. Environment variables use PowerShell syntax, for example
`$env:STUDIO_WORKSPACE_MODE='multi'; npm run dev`. The repository's `.gitattributes` keeps every text file LF, so no
`core.autocrlf` change is needed. Run `scripts/make-handoff.sh` from Git Bash.

The browser studio locally (use a throwaway data folder):

```bash
npm run build:web
(umask 077; printf 'STUDIO_SECRET_KEY=%s\nSTUDIO_PASSWORD=%s\n' "$(openssl rand -hex 32)" 'a-long-admin-password' > ~/.scraper-studio-secrets)
STUDIO_DATA_DIR=~/.scraper-studio-web STUDIO_SECRETS_FD=0 npm run start:web < ~/.scraper-studio-secrets
```

Open http://127.0.0.1:4174 and sign in under **Admins** with the admin password. The secrets go in through standard
input, never the environment (see [Security model](#security-model)). Never point two studio processes at one data
folder: the second refuses to start.

**Free AI while developing.** Tests mock every provider; `test/helpers/research-ai-fixture.js` is a deterministic
stand-in for Claude across the research stages (it reads the real prompts and returns schema-valid answers), so the
real orchestration runs without provider calls. In the app itself, paid work always stops at a confirmation first,
and with no Apify token or AI key nothing can spend.

Before your first change, read [CONTRIBUTING.md](CONTRIBUTING.md): adding a method, capability, prompt, Ask AI action
or card type touches several files that tests keep in step.

## Architecture map

```
 Electron window (Mac)                         Browser (web)
 src/renderer (React, ESM)                     same src/renderer, via src/web/main.jsx
   window.apifyStudio (src/preload/index.js)     src/web/web-api.js  → POST /api/rpc, GET /api/events (SSE)
          │ ipcRenderer.invoke                           │
          ▼                                              ▼
 ┌──────────────────────── src/main/index.js (one main process) ─────────────────────────┐
 │ gated(channel, fn): access.check → handler → access.after → rewriteError  (roles.json) │
 │ generateStructuredOutput → ai-routes → claude CLI | Anthropic API | Codex (+ai-limits) │
 │ content-workspace.js: programs, research runs, quick scans, content runs, kits, prompts │
 │ stores: config.json · data.json · content-studio/{state,team}.json · ask/ · prompts/   │
 │ publicState/emitState → per-viewer projection → Mac push | web SSE broadcast           │
 └───────────────────────────────────────────────────────────────────────────────────────┘
   web only: scripts/studio-web.cjs (launcher) → web-runtime.js (stands in for Electron)
             → studio-server.js (sign-in, RPC, SSE, uploads, downloads, /healthz, /readyz)
```

Full detail: [ARCHITECTURE.md](ARCHITECTURE.md) (process model, the RPC registry and the add-a-method checklist, role
enforcement, data layout, the Ask AI pipeline and its schema limit, prompts, research pipeline, trend history, Library
tree, build outputs).

## Repository map

| Path | What it holds |
| --- | --- |
| `src/main/` | The main process (CommonJS, Node). `index.js` (about 3,900 lines: handlers, keys, state, Ask AI glue), `content-workspace.js` (about 1,800: the studio service), `studio-server.js` and `web-runtime.js` (browser studio), `access.js`/`roles.js`/`team-store.js` (roles), `help-assistant.js`/`ask-store.js` (Ask AI), `prompt-*.js` (Prompt Library), `ai-routes.js`/`ai-limits.js`, delivery and import modules. |
| `src/shared/` | Logic and data both sides use. JSON for data both main and renderer read (`roles.json`, `studio-api-channels.json`, `ask-actions.json`, `help-spots.json`, `kit-folders.json`, `quick-scan.json`, `prompt-*.json`); CommonJS for main-only logic (research pipeline, runners); ESM for renderer-only logic (`trend-board.js`, `library-tree.js`). |
| `src/renderer/src/` | The React app (ESM): `App.jsx` (shell, Advanced layout), `simple-mode.jsx`, `content-studio-view.jsx` (Advanced studio pages), `chat-cards.jsx`/`help-assistant.jsx`/`studio-actions.js` (Ask AI UI and its action runner), `weekly-briefing.jsx`, `next-steps.js`, `kit-creator.jsx`, people and roles screens. |
| `src/preload/index.js` | The Mac bridge (`window.apifyStudio`), written by hand. |
| `src/web/` | The browser entry: `main.jsx`, `web-api.js` (derived from the channel map). |
| `scripts/` | Launcher (`studio-web.cjs`), backup and restore, build helpers (`copy-main-modules.mjs`, `build-mac-icon.mjs`), prompt goldens, smoke tests (some paid; see [Testing and CI](#testing-and-ci)), the Sheets bridge (`google-sheets-webhook.gs`), `make-handoff.sh`. |
| `test/` | Vitest suites (199 files), fixtures (`test/fixtures/prompts/` holds the 111 prompt goldens), helpers. |
| `deploy/` | Docker Compose (Caddy + oauth2-proxy + studio) and systemd kits. |
| `docs/` | The app guide (Ask AI's runtime knowledge), web deploy guide, roles and access, design records, archive. See [docs/README.md](docs/README.md). |
| `resources/` | App icon and macOS entitlements. |

## Feature tour

Every feature below is described for end users, with exact labels, in [docs/app-guide.md](docs/app-guide.md) (which
Ask AI reads at runtime). This is the developer's view, with the code that owns each.

- **Simple and Advanced layouts, one sidebar.** `studio-sidebar.jsx`, `nav-model.js`, pages per role from
  `roles.json` `pages`/`navOrder`. New menu (⌥⌘N), Search palette (⌘K, `palette-content.js`), Ask AI (⌘J), rail
  (⌘\). Choices a person makes (last program, Trends layout, Reports and Inbox filters) are remembered per browser
  (`choices.js`, localStorage).
- **Home: the weekly briefing.** `weekly-briefing.jsx`. Needs your OK, What changed (trend history), Ready for
  channels, Shipped, Working now; **Next up** (ranked next steps per role, `next-steps.js`), an admin **Get the studio
  ready** checklist, and **Copy briefing for Slack** with deep links when a Studio web address exists. Admins who manage
  research programs also get a **Research programs** panel (`home-programs.jsx`, rows from `program-summary.js`):
  schedule, next and last run, sources, budgets (See costs only), Run now (the layout's estimate confirmation),
  Pause/Resume schedule (Resume confirms the caps) and **Edit**, a quick-edit drawer (`program-drawer.jsx`) holding every
  program setting in groups with jump chips, Save/Discard, the unsaved-change guard, a schedule-on confirmation with
  caps and estimate, and a conflict banner (`baseUpdatedAt`). The form itself is `program-editor.jsx`, shared with the
  Research programs page.
- **Settings.** `settings-view.jsx` with a left section nav (`settings-nav.jsx`): sticky beside the page, a **Jump to**
  menu under 860px, a status dot per section, scroll-spy (`section-spy.js`) and `#/settings/<section>` links
  (`deep-links.js`). The section list, page order and dot rules live in `settings-sections.js`; a new section is an entry
  there plus a renderer in `settings-view.jsx`. Connection diagnostics names keys the studio can't read (`keyProblems`)
  and data files it set aside (`storeRecovery`).
- **Trends.** Simple's Trends (List or Board) and Advanced's Trend board (`trend-board-view.jsx`, `trend-board.js`):
  stages Needs your OK → Approved → Being written → Ready, plus Skipped. Yes / Skip with Undo, **Yes, with a note…**
  routing to channels, **Show 2 real posts** (the free `readTrendPosts` read), momentum badges, **Write reports** with
  an estimate confirmation, and a "Research stopped" row with Try again.
- **Reports.** Simple's Reports and the Advanced Library reader: grouped by research run, one row per trend
  (trends report + toolkit) with its open-note count, the report editor (below), status pipeline (Draft → Published),
  share links (`deep-links.js`), Share (Google Docs copy, slide outline, Slack summary), How this was made.
- **Report editor and notes (renderer).** `src/renderer/src/report-editor/` (Tiptap 3.31.4 + Yjs; styles in
  `report-editor.css`): `ReportDocument.jsx` is one page for reading and editing, used inline by Simple's reader and the
  Library preview, read-only with notes in the channel owner's brief (`channel-owner.jsx`), and inside `AssetEditor`
  (`asset-editor.jsx`: brand check + Done) wherever a file is edited from a folder. Autosave (`sync.js`, ~1.5 s and a
  final save on close), a selection menu (Bold, Italic, Link, Heading, Add note), a "/" menu, Markdown shortcuts,
  presence and named carets on the web (y-protocols awareness), History (versions, preview through an optional
  `readReportVersion`, restore, Original). `markdown.js` converts with `@tiptap/markdown` (the canonical saved form);
  `ydoc.js` seeds a report with no live state under a client id derived from its Markdown and makes note anchors (Yjs
  relative positions, falling back to the quote); `NotesPanel.jsx` holds threads, replies, @mentions (web only, from
  `listReportNotes`' `mentionable`), edit/delete own, resolve/reopen. Without the report-doc methods (an older studio)
  readers keep the old reader and **Edit** opens the same editor saving through `editStudioAsset` with its conflict
  check. Inbox rows for mentions and replies: `inbox-model.js` (kind `note`, target `{ kind: 'report', id, noteId }`;
  `events.js` `requestNoteFocus` opens the note).
- **Report editor and notes (server).** `report-docs.js`: one Yjs document per report (`content-studio/report-docs/`),
  merged on the server from every browser's changes, the Markdown written through `writeReportMarkdown` (so kits,
  exports, Drive, brand check and Ask AI read it), a version per editor at most every 5 minutes and on close (50 kept
  plus the original), restore for everyone (the document starts over; stale browsers get 409 `docReset`), presence with
  timeouts, live events through `pushPersonEvent`. `report-notes.js`: notes, replies, mentions, resolve, and each
  person's Inbox items (`content-studio/report-notes.json`); `noteCounts` and `noteMentions` ride the state. Capability
  `commentReports` (Leave notes on reports); channel owners note on their own channel's files and the briefs, never
  edit. See [ARCHITECTURE.md → Report editor and notes](ARCHITECTURE.md#report-editor-and-notes).
- **Assets and the Library tree.** One folder model for Simple Assets, Simple Reports and the Advanced Library
  (`src/shared/library-tree.js`): research run → trend → report and toolkit, channel assets by team, drafts,
  pictures. **Make channel assets** (`kit-creator.jsx`, `asset-kit.js`, `kit-folders.json`) writes 12 assets and 9
  pictures per trend; it opens over the current page in any layout.
- **Ask AI.** `help-assistant.js` (main), `help-assistant.jsx` and `chat-cards.jsx` (renderer), `ask-store.js`
  (conversations and memory per person). Server-stored conversations with a rolling summary, long-term memory (300
  items per person), lookups (reports, folders, files, runs, trends, posts, find, spend, conversations, memory,
  prompts), grounded cards hydrated from studio state, **quick scans** (`research-quick-scan.js`, `quick-scan.json`),
  and 27 kinds of action buttons from one shared list (`src/shared/ask-actions.json`). Nothing runs without a click;
  paid work confirms with an estimate. See [ARCHITECTURE.md](ARCHITECTURE.md#ask-ai-pipeline).
- **Ask AI for channel owners.** The same capability (`askAi`) on the channel base, with an Ask AI entry (⌘J / Ctrl+J)
  in the channel layout's sidebar and phone bar (`nav-model.js`, `channel-ask.jsx`). Its answers are built only from
  that person's projected channel view (`ask-channel.js`: LIVE CONTEXT, lookups of their briefs and drafts, buttons,
  cards, links, their own conversations and memory in their channel's space), with its own prompt
  (`help-assistant.js` `channelPromptParts`) and the guide's channel owner sections. Buttons: Generate for my channel,
  Yes, I'm using this trend / Not for us, Stop and Finish the rest on a set made for their channel only, Save folder,
  and opening their trends, drafts, plan and inbox, each through the same API and gate as the channel screens. No
  costs anywhere; pictures only with Make channel assets. A View as preview opens the page but can't ask.
  Details: [docs/roles-and-access.md](docs/roles-and-access.md#roles-and-capabilities).
- **Prompt Library.** 36 prompts in 7 groups (`prompt-registry.json`): editable instruction blocks inside fixed
  scaffolding, validation, versions (200 per prompt), diffs, restore, admin locks, free previews and paid test runs
  (50 kept per prompt). Runs snapshot the prompt versions they start with. `prompt-template.js`, `prompt-store.js`,
  `prompt-lab.js`, `prompt-cases.js`, `prompt-library.jsx`.
- **People & access.** People, Roles (capability matrix, custom roles), Access log, Invite, View as / Preview as
  (read-only previews). `people-view.jsx`, `roles-matrix.jsx`, `team-store.js`, `access.js`.
- **Trend tracker.** `src/shared/trend-history.js` links the same trend across runs (theme id, then recorded
  matches and aliases, then name and keyword similarity ≥ 0.55) and labels momentum from share of posts. It drives
  momentum badges, What changed, Ask AI's trend memory and the Sheets **Trend tracker** workbook (Trend timeline,
  Weekly snapshot, Category momentum, Run log). Free and deterministic.
- **Inbox, Calendar and My plan.** `inbox-view.jsx`/`inbox-model.js` (last 30 days, unread count saved per person),
  `calendar-view.jsx` (planned dates from channel answers, `.ics` download).
- **Sheets.** `sheets-view.jsx`, `workbooks.js`: each research run as the Golden Thread workbook, the Trend tracker,
  imported spreadsheets, cell-by-cell merge of concurrent edits, exports to .xlsx/.csv or a Google Sheet (bridge).
- **Research programs, runs and schedules.** `content-workspace.js`, `research-*.js` in `src/shared`. Per-stage
  models and effort, estimates, budgets, retry that never pays twice, schedules (30-second tick while the process
  runs).
- **Create content.** One-off drafts from a source (`content-studio.js` deliverables), Advanced only.
- **Data tools** (legacy, Advanced, capability `dataTools`): Search platforms, Scrapers (recipes with Apify budget and
  timeout), Import research, Brief starters (formerly Playbooks; `marketing-templates.js`), Datasets, Dataset reports,
  Compare snapshots, Ask your datasets, Activity.
- **Workflows and playbooks** (Advanced › Automate; capabilities `readWorkflows`, `manageWorkflows`; budgets and
  playbook setup under `managePrograms`). A workflow is a trigger (schedule, every few hours for quick scans, whenever a
  program runs, or by hand) and ordered steps: Find trends or Quick scan → Approve trends (rules, wait for review, or
  all) → Write reports → Make channel assets → Update Monday.com → Tell the team. `workflow-engine.js` (30-second tick
  plus a debounced poke on every studio change) decides deterministically and starts the studio's own pipelines through
  `content-workspace.js` (`startResearchRunFor`, `startQuickScanFor`, `reviewSignals`, `closeReviewFor`,
  `reportAssetsForRun`, `createAssetKit`), credited to `workflow:<id>` (AsyncLocalStorage `actingAs` in index.js).
  Unattended spend needs an approved per-run and per-month budget bound to `budgetHash` (`workflow-core.js`); each paid
  step commits its child's hard cap, so a run can't commit more than its cap. The owner's access is re-checked before
  every step (`access.canIdentityCall`). Playbooks (`playbooks.json`, six built in plus team ones) set up a program and
  a workflow; program notes and an assets step's notes are added to prompts only when set. Store:
  `content-studio/workflows.json` (`workflow-store.js`). The old v5 missions, intent planner and action graphs are gone.
- **Analytics** (admins): funnel, channel table, trend × channel matrix, spend this month (`team-analytics.js`).
- **Integrations.** Apify (`apify-runner.js`, `research-collection.js`), Anthropic/Claude (`anthropic-runner.js`,
  `claude-runner.js`), Codex (`codex-runner.js`), OpenAI images (`image-provider.js`), Google Sheets bridge and Drive
  (`google-sheets-webhook.gs`, `bridge-delivery.js`, `google-delivery.js`), Monday.com (`monday-engine.js`,
  `monday-sync.js`, `monday-cards.js`, `monday-store.js`; instant updates: [docs/web-deploy.md](docs/web-deploy.md#instant-monday-updates)).
- **Monday.com** (Settings → Monday.com, admins). Connect with a token (tested with `me` before it is saved), pick or
  make a board, match each studio field to a column (`src/shared/monday.json` is the field catalog and pins the API
  version), choose sync rules, **Start syncing**. Two-way: the server builds the cards (`monday-cards.js` mirrors the
  Trend board's stage rules) and pushes only changed columns (per-field hashes) in aliased chunks of 10, at most 200
  changes per run; it reads changes back by webhook on the web (`POST /hooks/monday/<secret>`) or by polling, and takes
  Yes or Skip only while a trend waits for an OK, from an allowed person (`decideResearchTheme` with an internal
  Monday actor, `via: 'monday'`). Idempotent: a Studio key column, keys persisted `unsure` before creates and looked up
  before anything is created again, and only an `itemMissing` answer ever clears an item ID. Conflicts: the studio owns
  every field after review (Monday changes are changed back, three times an hour at most); comments are Monday's. Sync
  now is a cancellable `monday` job. Chips on Trends cards in both layouts; the sync log in Settings and on Trends.
- **Google Drive folder sync** (Settings → Google Drive, admins; `drive-settings.jsx`, `drive-sync.js`,
  `drive-client.js`). An admin connects once: a Google **service account** (the pasted JSON key is signed in with an
  RS256 JWT over `node:crypto`, exchanged at `oauth2.googleapis.com/token` for an hour-long token cached until a minute
  before expiry, then saved encrypted as `GOOGLE_DRIVE_SERVICE_ACCOUNT`; Settings shows its email to share the folder
  with, as Editor), or the Google Docs access token as a fallback; then a folder link (My Drive or a shared drive,
  checked for `canAddChildren`). One studio-wide switch, **Add every new report to Drive**, replaces the per-program
  `delivery.publishToDrive` (programs that had it turn the switch on once, `migratedPrograms`; their setting is kept and
  still runs the old `publishRun` route only while no folder is connected, `hooks.legacyDrivePublish`). Content writes
  call `hooks.onAssetChanged` (`saveTextAsset`, `persistImageVariant`, `editStudioAsset`, `restoreStudioAsset`,
  `writeReportMarkdown`, `clearReportEdits`): a new trends report, toolkit or quick scan report goes out ~10 s later,
  an edit ~60 s after the last change (queue persisted in `drive-sync.json`, one Drive call at a time). Folders mirror
  the Library (`<yyyy-mm-dd> · <program>/<trend>/`, `Quick scan · <topic>/`, channel assets in
  `…/<trend>/Channel assets · <date>/<channel team>/` when **Include channel assets** is on), found or made by name
  under the chosen folder and kept in an id map per folder; folders carry a `studioKey` tag and files a `studioAsset`
  tag, so a lost map never duplicates. The Doc is created from the report HTML (`safeGoogleDocHtml`, Drive converts it)
  and later edits PATCH the same file (a toolkit links its trends report's Doc). Drive v3 with `supportsAllDrives=true`,
  429/5xx retried with backoff (Retry-After honored; a create is never re-sent after a 5xx or lost answer, since Drive
  may have made it, and the next attempt finds the tagged copy), a temporary failure re-queued for 5 minutes up to
  three times (an edit saved mid-send stays queued; with the switch off or no sign-in the queue waits, rechecked each minute),
  errors in plain words (folder not shared, key refused, Drive API off, no storage). **Copy existing reports** is a
  cancellable `drive` job; the sync log keeps 200 rows with **Retry**. Readers show **Open in Drive** from
  `contentStudio.driveLinks` (`roles.js` empties it without Read reports and assets); Monday cards fall back to it.
  With the switch off, **Save to Drive** right after **Share** in both readers (`DriveSaveButton` in
  `simple-reports.jsx`; `saveReportToDrive` in Export and publish, so admins and editors) sends the open trends report,
  toolkit or quick scan report now through the same `syncAsset` and id map (`saveNow`, waits up to 60 s): the first save
  adds the Doc and later ones update it, never a second copy. It reads **Update in Drive** once
  `contentStudio.driveStale` lists the report (edited or restored after the version its Doc was made from, `sourceAt`, or
  a toolkit saved before its trends report's Doc existed); **Saved to Drive** can be pressed again and re-makes a Doc
  deleted in Drive. While the switch is on it is greyed out (`aria-disabled`, with a tooltip naming the folder) and the
  server refuses it with a 409; before Drive is connected it opens Settings → Google Drive for admins and is greyed out
  for everyone else.
  Server-side on the web; on the Mac only while the app is open. No AI spend.

## Configuration reference

Every environment variable the code reads. Secrets go in the secrets file, never the environment. The deploy guide
([docs/web-deploy.md](docs/web-deploy.md#configuration)) explains each server setting in depth; `.env.example` is a
commented template with the same variables (except the ones the tooling sets).

**Browser studio server** (read by `scripts/studio-web.cjs` and `src/main/studio-server.js`)

| Variable | Default | Purpose |
| --- | --- | --- |
| `STUDIO_DATA_DIR` | `~/.scraper-studio-web` (`/data` in the image) | The data folder. One process per folder. Created/tightened to 0700; files 0600. |
| `STUDIO_TRANSFER_DIR` | `<STUDIO_DATA_DIR>/web-transfers` | Browser uploads and downloads; emptied at every start. |
| `STUDIO_HOST`, `PORT` | `127.0.0.1`, `4174` (image: `0.0.0.0`) | Bind address and port. |
| `STUDIO_PUBLIC_ORIGIN` | — | The public `https://` address when a proxy rewrites `Host`; https also marks the cookie Secure. |
| `STUDIO_SECURE_COOKIES` | — | `1` behind HTTPS: Secure cookie and HSTS. |
| `STUDIO_TRUST_PROXY` | — | `1`: count admin-password tries per client from `X-Forwarded-For` (only when nothing but the proxy reaches the studio). |
| `STUDIO_LINK_DAYS` | `30` | How long a new personal sign-in link works; `0` = until replaced or turned off. |
| `STUDIO_DRAIN_SECONDS` | `25` | On SIGTERM/SIGINT, how long running work may finish. Keep the platform's stop grace period longer. |
| `STUDIO_KEEPALIVE_SECONDS` | `75` | Idle keep-alive for proxy connections; keep above the proxy's idle timeout. |
| `STUDIO_MAX_EVENT_STREAMS` | `200` | Live-update streams for the whole server. |
| `STUDIO_MAX_STREAMS_PER_PERSON` | `5` | Live-update streams per person (their newest tabs). |
| `STUDIO_MIN_FREE_MB` | `256` | `/readyz` fails below this much free disk in the data folder. |
| `STUDIO_LOG_LEVEL` | `info` | `error`, `warn`, `info` or `debug`; JSON lines on stdout. |
| `STUDIO_EXPORT_DAYS` | `7` | Leftover export copies older than this are removed at start (browser studio). |

**Secrets** (`src/main/web-secrets.js`; see [SECURITY.md](SECURITY.md))

| Variable | Purpose |
| --- | --- |
| `STUDIO_SECRETS_FD` | An open file descriptor (usually `0`) holding `NAME=value` secret lines. |
| `STUDIO_SECRETS_FILE` | A file path holding the same lines (Docker/Compose/Kubernetes secrets). Not both. |
| `STUDIO_RUN_AS` | When started as root: the `user[:group]` to switch to after reading the secrets. Without it the server refuses to run as root. The image sets `node`. |
| `STUDIO_SECRET_KEY` | **Secret.** 32+ random characters; encrypts keys saved in Settings (AES-256-GCM). Losing it means re-entering every saved key. |
| `STUDIO_PASSWORD` | **Secret.** The admin password (16+ characters), break-glass admin access. Not needed with company sign-in. |
| `STUDIO_PROXY_SECRET` | **Secret.** What the sign-in proxy sends as `X-Studio-Proxy-Secret`. |

**Company sign-in (SSO through a proxy)**

| Variable | Purpose |
| --- | --- |
| `STUDIO_TRUSTED_EMAIL_HEADER` | The header the proxy sets with the signed-in email (e.g. `x-forwarded-email`). |
| `STUDIO_ALLOWED_EMAIL_DOMAINS` | Required with the header: comma-separated allowed domains. |
| `STUDIO_TRUSTED_PROXY_CIDRS` | The proxy's addresses (IPs or CIDR ranges). The header is ignored from anyone else. Required unless `STUDIO_PROXY_SECRET` is set; the server won't start with neither. |
| `STUDIO_ADMIN_EMAILS` | Comma-separated emails that are always admins (also the recovery path). |

**AI limits** (`src/main/ai-limits.js`; both off unless set)

| Variable | Purpose |
| --- | --- |
| `STUDIO_AI_CONCURRENCY` | At most this many AI calls (text and pictures) at once across the studio; the rest queue (cancellable). |
| `STUDIO_DAILY_AI_BUDGET_USD` | Refuse new AI work once the day's recorded spend (UTC, kept in `<data>/ai-spend.json`) reaches this. Error code `dailyAiBudget` (429). Codex reports no spend and isn't counted. |
| `STUDIO_CODEX_USER_CONFIG` | `1` lets Codex load the operator's `~/.codex/config.toml`; `0` skips it. Default: skipped on the web, loaded on the Mac. |
| `CODEX_HOME` | Where Codex keeps its sign-in and model list (default `~/.codex`); Settings → Model routing reads Codex's models from `models_cache.json` there. |
| `STUDIO_FAL_MEDIA_HOSTS` | Comma-separated hosts the studio downloads fal.ai results from (default `fal.media`, `fal.run`, `fal.ai` and their subdomains). |

**Service keys** (fallbacks only; prefer Settings, which encrypts them). `KEY_NAMES` in `src/main/index.js`; a key
saved in Settings wins, and the studio removes these from the AI tools' environment.

| Variable | Used for |
| --- | --- |
| `APIFY_API_TOKEN` | Collection through Apify. |
| `ANTHROPIC_API_KEY` | The Anthropic API route. |
| `OPENAI_API_KEY` | Pictures (OpenAI Images). In dev runs also read from `<app folder>/.env.local`. |
| `GOOGLE_SHEETS_WEBHOOK_URL` | The Apps Script Sheets bridge URL. |
| `GOOGLE_DOCS_ACCESS_TOKEN` | Reading private Google Docs and Drive publishing without the bridge. |
| `MONDAY_API_TOKEN` | Monday.com board sync. |
| `OPENROUTER_API_KEY` | The OpenRouter connection (any model through one key; Settings → AI connections). |
| `FAL_KEY` | The fal.ai connection (pictures and short videos). |

`GOOGLE_DRIVE_SERVICE_ACCOUNT` (the Google Drive folder sync's service account key) is in `KEY_NAMES` but is a saved key
only: Settings → Google Drive saves it after Google accepts it, save-key refuses it, and there is no environment
fallback. No new environment variables.

**Workspaces** (`src/main/workspace-policy.js`; both builds)

The package.json field `studioWorkspace` (`{ "mode": "single", "id": "semrush", "editionId": "semrush", "name": "Main" }`,
on for the Semrush package) gives the studio exactly one workspace, shown as **Main**, with no workspace switcher and no
New workspace. Other workspaces are hidden (archived), never deleted. `studioDefaultWorkspace` still picks the first
workspace in multi mode. See [RUNBOOK.md](RUNBOOK.md#one-workspace-builds-semrush-package) for what the switch does to
existing data and how to undo it.

| Variable | Purpose |
| --- | --- |
| `STUDIO_WORKSPACE_MODE` | `single` or `multi`; overrides the package field (the browser studio and development). The test suite and `scripts/desktop-smoke.cjs` set `multi`. |
| `STUDIO_WORKSPACE_NAME` | The one workspace's name in single mode (1 to 60 characters, default `Main`). |

**Backups** (`scripts/studio-backup.cjs`)

| Variable | Purpose |
| --- | --- |
| `STUDIO_BACKUP_DIR` | Where backups go (default `./studio-backups`). |
| `STUDIO_BACKUP_KEEP` | Keep only the newest N backups (unset keeps all). |

**Desktop development and release**

| Variable | Purpose |
| --- | --- |
| `STUDIO_DISABLE_LOCAL_ENV` | `1`: in dev runs, don't read `OPENAI_API_KEY` from `.env.local`. Packaged builds never read it. |
| `APIFY_STUDIO_AUTO_UPDATE_URL` | Generic update feed URL. Auto-update is inert (nothing calls it); only release diagnostics read it. |
| `CLAUDE_MODEL` | Model for scripts that create a studio host directly; the app uses Settings. |
| `STUDIO_VERIFICATION_DIR` | Where `scripts/service-smoke.cjs` writes receipts (default: a fresh temp folder). |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | Notarization; runs only when all three are set, and only for a macOS build. |
| `CSC_NAME` | Signing identity for electron-builder (Mac). Windows signing is read by electron-builder from `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD`, or from Azure Trusted Signing options; never leave a Mac `CSC_LINK` set for a Windows build ([RUNBOOK.md](RUNBOOK.md#release-the-windows-app)). |

**Set by tooling** (don't set by hand): `STUDIO_RUNTIME` (`web`, set by the launcher; switches the main process to the
browser studio), `ELECTRON_RENDERER_URL` (electron-vite dev), and `SHELL`, `PATH`, `HOME`, `USER`, `LOGNAME`, `APPDATA`
(read from the OS to find the `claude` and `codex` tools and to reset the user after `STUDIO_RUN_AS`). On Windows also
`USERPROFILE` (the home folder, through `os.homedir()`), `SystemRoot` (where `taskkill.exe` is, to stop an AI tool and
its children) and `ProgramFiles` (the fallback `node.exe` for an npm-installed tool), all read from the OS.

**Settings stored in data** (`data.json` `settings`, validated in `src/shared/validation.js`): Model routing
(`aiRouting`, written only by `saveAiRouting`), the text route and model it mirrors for older readers (`aiProvider`,
`aiModel`, default `claude-opus-5-5`), the per-request budget,
`uiMode` per person, the Studio web address, `lastAiCheck` (the last Check connections result, which ticks Home's
setup checklist), and Data tools settings. Research program defaults
(`src/shared/research-program.js`): Opus 5.5 for discovery, synthesis and matching, Fable 5.1 for tagging and reports,
3,000 posts per platform, 10 per author, a 7-day window, up to 6 themes, budgets $10 collection and $25 AI. Quick-scan
presets: `src/shared/quick-scan.json`.

## Data model and storage

Everything lives in one data folder: `~/Library/Application Support/apify-scraper-studio` on the Mac and
`%APPDATA%\apify-scraper-studio` (Roaming) on Windows (the name is `INTERNAL_APP_NAME`; keep it), and `STUDIO_DATA_DIR`
on the server.

```
<data>/
  config.json            encrypted keys (keychain on the Mac, AES-256-GCM with STUDIO_SECRET_KEY on the web)
  data.json              settings and Data tools data (recipes, runs, datasets index, analyses, monitors)
  ai-spend.json          today's recorded AI spend (only with STUDIO_DAILY_AI_BUDGET_USD)
  datasets/ exports/ assets/ workspaces/ workbooks/      Data tools files, exports, Sheets imports and edits
  help/images/           Ask AI pictures          help/calls/  per-question temp folders
  v5/                    the retired v5 log: events.jsonl (only Scrapers' recipe versions are still read)
  content-studio/
    .studio-owner.json   the data-folder lock (process, host, boot, 30-second heartbeat)
    state.json           workspaces, programs, research and content runs, assets, trends (the studio service)
    team.json            people, custom roles, role policy, sign-in links, channel answers, activity, access log (v3)
    monday.json          Monday.com: account, a board link per workspace, the item map, people cache, today's calls
    workflows.json       workflows, their runs (100 kept each, 2,000 in all) and team playbooks (version 1)
    report-docs/         the report editor: <assetId>.json (Yjs state, versions list) and <assetId>.versions/
    report-notes.json    notes on reports, replies, mentions and each person's note Inbox items (version 1)
    monday-log.jsonl     the Monday.com sync log (newest 2,000 rows)
    drive-sync.json      Google Drive folder sync: folder, switches, an id map per folder, the queue, the log (200 rows)
    runs/<runId>/        input, evidence, assignments, theme-stats, *.validated.json, report and asset files
    collections/ datasets/ dataset-index.json            collected posts and their index
    ask/<sha256(identity)[0:32]>/   one person's Ask AI index, conversations (c/), memory.json
    prompts/<workspaceId>/<promptId>.json   prompt versions        prompt-tests/   test records
    brand-images/<workspaceId>/      brand reference images        exports/   run exports
    diagnostics/         AI replies the studio couldn't read: ai-invalid-<time>.json (keys redacted, newest 10, 30 days)
  web-transfers/         browser uploads and downloads (web only; short-lived)
```

- **Writes** are whole-file and atomic: a private temp file, fsync, rename, then fsync of the folder
  (`writeJson` in `index.js`). A damaged `data.json` or `config.json` is copied aside as `<file>.bad-<time>` and
  listed in `state.storeRecovery`; a file that can't be read stops startup rather than being overwritten.
- **One writer.** The owner lock keeps a second process off the folder. Synchronous stores (`team-store.js`) assume it.
- **Migrations.** `team.json` v1 → v2 → v3 upgrades on load (`MIGRATIONS[1]`, then `MIGRATIONS[2]`: Ask AI for every
  role); a newer `team.json` refuses to start, so a v3 file can't go back to a 0.3.0 build.
  The one-way Monday setup in `config.json` (`monday`) moves into `content-studio/monday.json` once at startup, item IDs
  kept and sync left manual until an admin turns it on (`migrateLegacy`).
  `migrateSemrushBrandDefaults` updates the Semrush brand preset in `state.json`. There are no downgrades: back up
  before upgrading.
- **Retention limits in code:** Ask AI 200 conversations and 300 active memory items per person; team activity
  5,000 rows and access log 2,000; 200 versions and 50 test records per prompt; 50 editor versions per report (plus the
  original), 500 notes per report, 200 note Inbox items per person for 60 days. Collected posts and run files are kept
  until someone deletes the run.
- Data layout, backup and restore procedures: [RUNBOOK.md](RUNBOOK.md#backup-and-restore).

## AI routes and cost controls

- **Connections, tasks and routing.** A *connection* is how the studio reaches a vendor (`src/shared/ai-providers.json`):
  `claude` (Claude Code CLI, the machine's Claude plan sign-in), `claude-api` (Anthropic key), `codex` (Codex CLI, the
  machine's ChatGPT sign-in, not metered), `openai`, `openrouter` (any model through one key) and `fal` (pictures and
  videos), plus the pseudo-route `auto` (Claude Code when installed, signed in and new enough, else the Anthropic key;
  the only automatic fallback). A *task* is one kind of AI work (`src/shared/ai-tasks.json`, every AI job the studio
  runs). `src/main/ai-routing.js` resolves a task's connection, model and effort: a run's snapshot (`run.ai.routing`,
  taken when it starts, so a retry never changes provider or price), then a research program's own stage choice
  (`program.ai.overrides`), then the admin's Settings → Model routing (`settings.aiRouting`), then the inherit chain and
  the defaults. A studio that never saved routing resolves exactly as before (its newest program's report model still
  drives channel assets). On the browser studio the subscription connections use the server's sign-in.
- **One entry point.** Every text call goes through `generateStructuredOutput` in `src/main/index.js` → `text-router.js`,
  with a strict JSON schema and a `taskId`. Runners: `cli-runners.js` (Claude Code with tools, MCP and session
  persistence off, prompt on stdin; Codex in an empty temp folder, read-only, tools off, `-m` and the reasoning level
  only when routed), `anthropic-runner.js` (prompt caching of the stable prefix), `openrouter-runner.js` and
  `openai-text-runner.js` (strict `json_schema`; schema-in-prompt fallback when a provider refuses it). `onStream`
  receives the answer field as it is written (`structured-stream.js`) on every route that streams, and the whole field
  once on the others. Pictures and videos go through `media-router.js` (OpenAI GPT Image or `fal-provider.js`).
- **Connections status and preflight.** `ai-connections.js` reads Claude Code (`claude auth status --json`), Codex
  (`codex login status`) and the four keys for Settings → AI connections (free, cached a minute). Before paid work
  starts, `STUDIO_PREFLIGHT` resolves the tasks the work uses and checks each connection and model ("Nothing was
  started." otherwise); an OpenRouter or fal.ai model without a known price is refused.
- **Estimates before spending.** Start research, Write reports, quick scans, channel assets, Finish the rest, Try
  again and prompt test runs show an estimate and caps in a confirmation; Create content shows its spending allowance
  (it has no per-draft estimate yet). The wording is shared between layouts and Ask AI (`studio-actions.js`,
  `cost-lines.js`).
- **Caps.** Each research run has a collection budget (Apify, split per job by worst case, sent to Apify as each
  job's cap) and an AI budget (each call reserves about 3× its estimate, at least $0.50, at most $100). Ask AI is capped
  at $0.75 per call, scaled by model price. Custom scrapers default to $5 and 15 minutes on Apify; a test sample to $1
  and 3 minutes. Studio-wide: `STUDIO_AI_CONCURRENCY` and `STUDIO_DAILY_AI_BUDGET_USD`.
- **Workflows spend only inside an approved budget.** A workflow runs on its own only with an admin-approved per-run
  and per-month budget whose `budgetHash` still matches its paid setup (program caps and models, quick scan, how many
  trends, channels and pictures, cadence). Before each paid step the engine adds the child's own hard cap (research:
  the program's AI + collection budgets; quick scan: its derived caps; each asset set: min(plan cap, what's left)) to
  what the run has committed and checks the month; otherwise the run waits (`waiting-budget`, an Inbox row for
  approvers). Manual runs confirm an estimate, and a workflow without a budget asks for a one-off cap. Model routing
  decides every model (the engine resolves the tasks for its preflight and estimate); the engine itself makes no AI
  calls. On Codex, estimates stand in for spend (`spentEstimated`).
- **Codex is not metered.** Codex reports no cost, so caps are guides there ("On Codex the studio can’t cap AI spend…")
  and the daily budget doesn't count it.
- **Ask AI cost.** Its prompt prefix (instructions, spots and the whole app guide) is about 185,000 characters (184K for an editor, 188K for an admin). On the
  API route the first question in five minutes costs about $0.35–0.40 (cache write), follow-ups about $0.07–0.10; on the
  Claude app about $0.30 a question; a lookup adds a second call. The app guide is under a 150,000-byte guard
  (`test/docs-consistency.test.js`) because every byte is paid for on every question.
- **Prices** for estimates: `src/shared/ai-models.json` (Fable 5.1 $10/$50, Opus 5.5 $4/$20, Sonnet 5.5 $2/$10, Haiku 5.5
  $0.10/$0.50 up to 100K prompt tokens and $0.50/$2.50 above, Haiku 4.5 $1/$5 per million tokens; GPT Image per picture;
  Seedance video per second), refined at runtime by OpenRouter's model list and fal.ai's pricing API
  (`src/main/ai-catalog.js`, cached in `<data>/ai-catalog/`).

## Security model

Summary; the full model is in [SECURITY.md](SECURITY.md).

- **Authorization**: deny by default. Every IPC and RPC call passes `gated()` → `access.check` against the person's
  capabilities (`roles.json`); previews are read-only; each browser receives only the state its role may see (money
  stripped for roles without See costs).
- **Authentication (web)**: company sign-in through a proxy header trusted only from `STUDIO_TRUSTED_PROXY_CIDRS`
  and/or with `STUDIO_PROXY_SECRET`, or the admin password plus personal sign-in links (32 random bytes, stored as
  SHA-256 hashes, compared timing-safely). Sessions are in memory.
- **Secrets**: read once from `STUDIO_SECRETS_FD`/`STUDIO_SECRETS_FILE`, kept out of `process.env`; the container
  reads a root-only file as root and switches to `node`. Keys in Settings are encrypted at rest. AI CLIs get an
  environment without `STUDIO_*` and key variables.
- **AI boundaries**: collected posts and lookups are marked "data, not instructions"; Ask AI acts only through buttons
  the person clicks; the Claude CLI runs with tools off; Codex runs isolated, but its read-only sandbox doesn't stop
  reads.
- **Known gaps**: the Sheets bridge has no authentication; sessions don't survive restarts; no audit trail for key or
  AI-route changes; the Google token is pasted by hand.

## Deployment

The browser studio is one Node process with a persistent volume, behind a TLS reverse proxy and (recommended) an SSO
proxy, on its own subdomain. One replica only.

- **Kit**: [deploy/README.md](deploy/README.md): Docker Compose (Caddy → oauth2-proxy → studio, with a fixed proxy
  address on an internal network) and systemd (service, nightly backup timer).
- **Image**: `docker build -t scraper-studio .` (Node 24 slim, tini, starts as root to read a root-only secrets file,
  then runs as `node`; `HEALTHCHECK` on `/readyz`; `STOPSIGNAL SIGTERM`).
- **Proxy requirements**: unbuffered SSE on `/api/events`, 30 MB request bodies, long read timeouts (Ask AI and
  reports can take minutes; Cloudflare cuts at 100 s), keep-alive below `STUDIO_KEEPALIVE_SECONDS`.
- **Two breaking changes in the final build-out**: company sign-in now needs `STUDIO_TRUSTED_PROXY_CIDRS` or
  `STUDIO_PROXY_SECRET`, and the launcher refuses to run as root without `STUDIO_RUN_AS`.
- Full guide: [docs/web-deploy.md](docs/web-deploy.md). Desktop release: [RUNBOOK.md](RUNBOOK.md#release-the-mac-app)
  and [the Windows app](RUNBOOK.md#release-the-windows-app).

## Operations

- **Health**: `GET /healthz` (liveness) and `GET /readyz` (data writable, disk free, lock held, not draining). No
  sign-in needed; nothing private in either.
- **Stopping**: SIGTERM drains (refuses new paid work with 503 `restarting`, lets running work finish for
  `STUDIO_DRAIN_SECONDS`, releases the lock last). A second signal stops now.
- **Logs**: one JSON line per request (`X-Request-Id`), plus lifecycle and sign-in events, never payloads or secrets.
- **Backups**: `npm run backup` / `npm run restore` (`scripts/studio-backup.cjs`, `scripts/studio-restore.cjs`):
  works while running, SHA-256 manifest, restore checks and keeps an undo copy. Keep the secrets file with the backups.
- **Stuck lock, key rotation, upgrades, incident checklist**: [RUNBOOK.md](RUNBOOK.md).

## Testing and CI

| Command | What it does | Spends money |
| --- | --- | --- |
| `npm test` | Vitest, every suite (mocks Electron, Claude, Codex, Apify, OpenAI, Google) | No |
| `npm run test:coverage` | The same with v8 coverage over `src/shared`, `src/main`, `src/web` | No |
| `npm run lint` | ESLint 10 flat config (`eslint.config.js`) | No |
| `npm run check` | `lint`, then `npm test`, then `build:web` | No |
| `node scripts/prompt-goldens.mjs --check` | Every prompt the studio sends, byte-compared with `test/fixtures/prompts/` | No |
| `npm run build:web` / `npm run build` | Browser bundle / desktop bundle (+ `copy-main-modules.mjs`) | No |
| `npm run test:desktop` (`-- --with-data`) | Desktop smoke test on disposable data, after `npm run build` | No |
| `npx electron scripts/service-smoke.cjs --review` | Screens of your saved workspace | No |
| `npx electron scripts/service-smoke.cjs --live` | Small live Apify and Claude run ($0.25 per source, $1 request budget) | **Yes** |
| `node scripts/content-studio-live.cjs`, `npx electron scripts/image-provider-live.cjs` | Live content run / live picture | **Yes** |

- **CI** (`.github/workflows/ci.yml`, never yet run on GitHub): on push and pull request, Ubuntu runs `npm ci`, lint,
  `npm test`, `build:web`, prompt goldens and `npm audit --omit=dev --audit-level=high`; macOS runs `npm ci` and
  `npm test`. Two Windows jobs on windows-latest: `windows-test` installs the real npm packages of Codex and Claude
  Code and checks that the studio finds and starts them without a shell, then runs lint, `npm test`, prompt goldens
  and both builds (not the desktop smoke test, which is out of date; see Known issues); `windows-installer` (not on pull requests) runs `npm run dist:win`, uploads
  the unsigned installer, installs it silently, launches it once and uploads a screenshot. Expect the first run to
  surface problems in every job. Dependabot (`.github/dependabot.yml`) updates npm and Actions weekly.
- **Guards worth knowing**: `test/roles.test.js` (every method in exactly one capability; method counts),
  `test/web-parity.test.js` (preload and web API expose the same methods), `test/build-modules.test.js` (every module
  main loads is copied into the build), `test/help-assistant-prompts.test.js` (Ask AI schema stays small),
  `test/no-native-dialogs.test.js`, `test/docs-consistency.test.js` (this file's config table, scripts and links;
  the app guide's size and wording), `test/windows-packaging.test.js` (the `dist:win` flags, the installer name, the
  notarize hook skipping Windows, `resources/installer.nsh`, `.gitattributes`).
- **Windows in the suite**: the suites that load `src/main/index.js` in a `vm` pass a fake `process.platform`, so every
  Windows branch reads the main process's own `process.platform` (or takes a `platform` option) and is tested on macOS.
  Tests that need POSIX file modes skip that one check on Windows, and symlink tests run only where
  `test/helpers/can-symlink.js` can make a link (Windows needs Developer Mode for that).
- **The report editor in jsdom**: suites that mount it import `test/helpers/prosemirror-dom.js` (Range rects and
  `elementFromPoint`, which ProseMirror measures with) and type through the editor's commands (`textbox.editor`), since
  jsdom has no real text input. `test/report-editor.test.jsx`, `report-editor-markdown.test.js` (round trip of every
  block), `asset-editor.test.jsx` and `simple-reports-live.test.jsx` cover the renderer.
- The manual per-role checklist: [docs/verification/roles-acceptance.md](docs/verification/roles-acceptance.md).

## Known limitations and follow-ups

Every item here was deliberately left for the Semrush team. Grouped by area; each says where the work lives.

### Large refactors recommended and deferred

- **Split `src/main/index.js`** (about 3,900 lines) along its existing seams: the IPC registry and gate; keys and
  encryption (`KEY_NAMES`, `getKey`, `encryptValue`); state assembly (`publicState`, `emitState`); the Ask AI section
  (`helpContext`, lookups, `helpResolveActions`, `hydrateCards`, `answerHelp`, about 1,000 lines); Data tools and the
  setup files; Google bridge and delivery glue. Move one seam at a time behind the same handlers.
- **Split `src/main/content-workspace.js`** (about 1,800 lines): research runs and the scheduler, quick scans,
  content runs and kits, exports, prompt-lab glue, trend-history sources, workspaces and brand knowledge.
- **An async job protocol** for long calls. Ask AI answers, dataset reports and scraper runs hold one HTTP request
  open for minutes, which proxies cut (Cloudflare at 100 s). Start → job id → result over SSE or polling, with the
  existing request ids for idempotency.
- **Incremental live updates.** Every change broadcasts the whole projected state (a few hundred KB, coalesced every
  750 ms). Versioned slices or patches would cut bandwidth and CPU on large workspaces.
- **Durable sessions.** Password and link sessions live in memory, so every restart signs those people out. Signed
  cookies with a server-side revocation list would survive deploys.
- **Slack (and email) notifications.** Notifications are in-app only (Inbox counts, Copy reminder, Copy briefing for
  Slack). The n8n workflow posted to Slack.
- **Scheduled dates.** The **Scheduled** status has no date, and a channel's **Planned for** date only fills the
  Calendar: nothing reminds, publishes or reports on it. Schedules run only while the process runs (30-second tick).

### Web server and operations

- Sessions that survive a deploy (above). Kubernetes manifests are not shipped; `deploy/README.md` gives the
  StatefulSet, probe, NetworkPolicy and Secret guidance.
- No Prometheus `/metrics` endpoint; JSON logs only.
- No audit trail for key, setting or AI-route changes (would live in `access.js` `AUDITED`, `team-store.js`
  `AUDIT_KINDS` and the `save-key`/`save-settings` handlers in `index.js`).
- `content-workspace.js` `launch().finally(save)` can reject unobserved; the server's `unhandledRejection` handler logs
  it instead of crashing. Wrap the save in try/catch.
- The research scheduler isn't paused when a drain starts; a scheduled run due during the drain could still start.
  Register a work provider (`require('./web-runtime').provide('work', { active: activeWorkSummary })`) and pause the
  scheduler at drain.
- `studio-host.js` `acquireCollectionLock` has no own-PID check; the startup cleanup in `studio-owner-lock.js`
  (`clearStaleCollectionLocks`) covers the crash case.
- The Docker image hasn't been built since the Dockerfile changed (tini via apt, root start + `STUDIO_RUN_AS`).
- The oauth2-proxy options `upstream_timeout` and `api_routes` in `deploy/compose/oauth2-proxy.cfg.example` were
  written for v7.6 from memory; check them against a live proxy.
- Browser downloads are zipped in memory (`web-runtime.js` `zipFolder`, bounded by the 300 MB cap); stream them.
- The browser page doesn't send request ids for `searchSources`, `runRecipe`, `testRecipe` and `analyzeDataset`
  (`src/web/web-api.js`), and long calls get no keep-alive bytes (`studio-server.js`); the server side is ready.
- `STUDIO_TRUST_PROXY` takes the last `X-Forwarded-For` hop; behind two proxies configure the inner one (nginx
  `real_ip`). The studio can't be hosted under a subpath. The Anthropic base URL is fixed (`anthropic-runner.js`), so
  an internal LLM gateway can't be used yet.

### Data safety

- Sheets (`sheets-view.jsx`) still saves whole snapshots; switch to `{ changes }` or `{ edits, base }` and show
  `result.conflicts`. The server already merges cell by cell and returns 409 `sheetConflict`.
- Scrapers (`automation-view.jsx`) have no Budget and Timeout fields yet, and the Test copy doesn't say "$1 and 3
  minutes"; the limits apply anyway.
- Settings doesn't show `state.keyProblems` (keys saved under another `STUDIO_SECRET_KEY`) or `state.storeRecovery`
  (damaged files copied aside), though the startup log says Settings does. Add a Clear action and a banner.
- `ask-store.js` and `prompt-store.js` move a file aside on any read error other than "not found", including a
  transient I/O error.
- Optional: debounce `emitState`.
- Workflows: Ask AI has no run-workflow / set-workflow buttons or workflows block in its live context yet; the program
  editor (`program-editor.jsx`) doesn't mount `ProgramNotesFields` (notes are set in playbook setup and kept on save);
  `trend-cards` parity lives in `monday-cards.js` (the Monday area's server cards) and `helpTrendStage` stays in
  index.js; desktop schedules run only while the app is open. Workflows run only in the active workspace.
- No per-person limit on Ask AI questions in flight.
- Codex's `web_search` tool stays on (turning it off risks a config error on older CLIs).

### Google Drive folder sync

- One way only: a Doc edited in Drive is overwritten by the next edit in the studio, and a report deleted in the studio
  stays in Drive. Drafts from Create content and short videos aren't copied; pictures go as PNG files.
- The folder layout is decided when a file is first copied; renaming a program or trend later doesn't move or rename
  folders already in Drive (the file is updated where it is).
- Only the active workspace is synced (single-workspace builds have one). The Mac app syncs only while it is open;
  what is queued goes out at the next start.
- Channel owners don't see **Open in Drive** (their view carries no report list). Older Drive receipts from
  **Save to Google Docs** (`publishRun`) are separate files from the folder sync's Docs.
- Uploads are multipart, so files over 5 MB are refused with a plain message (large pictures stay in the studio).

### Report editor and notes

- The Markdown written on each save is the saving browser's. It is checked against the server's document only when the
  browser sends `stateVector` (the studio's own editor always does, with `clientId` and `epoch`); without it, two people
  saving at once can leave out the other's last change until the next save or close.
- A browser that changes a report is retired when the document starts over (restore, or an edit outside the editor) and
  gets 409 `docReset`; one that only opened it, without a `clientId` or `epoch`, isn't, and its later change usually
  can't attach to the new document (it sits unused in the Yjs state).
- A version keeps its Yjs state only up to 2 MB; a larger one restores from its Markdown, and notes anchored in it fall
  back to their quoted text. Documents and notes of a deleted run's reports stay on disk until removed by hand.
- Presence lives in the server's memory; a restart forgets who had a report open until they save again. An open page
  checks in every 10 minutes (the server lets a quiet browser go after 30), so readers keep hearing edits and notes.
- An emptied report isn't saved (the studio never writes an empty report): the editor says so and saves again on the
  next keystroke.
- Renderer: the caret travels with each save and on its own at most every 0.8 s, only for people who may edit
  (readers' carets aren't shared). Remote carets disappear 30 s after their last move (y-protocols' timeout).
- Renderer: a report's Markdown that the converter doesn't model (images, raw HTML, footnotes, task lists) is read as
  text and written back that way on the first edit. Underline is off (not Markdown).
- Renderer: a version preview needs the version's Markdown (`version.markdown` or a `readReportVersion` method, neither
  in the contract yet); without it History says a preview isn't available and still restores.

### Ask AI

- Not built: an admin **edit-program** action (before/after of a program and schedule), **change-access** (staged in
  People's unsaved bar), **restore-prompt** and restore-report, a "mark used with this link" follow-up after
  Published, copying the briefing, and plan steps that wait for unfinished work (`after=ready:<trend>`).
- The spend lookup doesn't include Ask AI's own answer costs (receipts aren't stored centrally) or Apify charges.
- A channel owner's Ask AI sends no brand visual direction with pictures (it is a Prompt Library prompt, which channel
  roles can't read), so their pictures follow the brand reference images and their own words only. It has no Show me
  tours (the channel layout has no spots yet) and no quick scans. Asset status isn't one of its buttons: channel roles
  can't set it today.
- The Ask AI footer (`help-assistant.jsx`) still says "about $0.15 each on Claude"; the measured figures are in
  [AI routes and cost controls](#ai-routes-and-cost-controls).
- Page context: the server (`askPage` in `index.js`) keeps `report`, `folder`, `trend` and `prompt` but drops `run`,
  which the Advanced layout sends; Simple sends neither `trend` nor `prompt`, and neither layout sends `prompt` or the
  Next up titles.
- Content Studio, Trend board, Simple Assets and Channel owner screens still build their own confirmations instead of
  the hook's shared `confirmStartResearch`/`confirmWriteReports`/`confirmRetry`; `cost-lines.js` `reportCostLine`
  copies the hook's `reportCostLines` wording (keep them in step, or move both onto one helper).
- In Safari, Copy text / for Google Docs / Slack summary reads the report before writing the clipboard, so the click's
  permission can lapse; it falls back to `execCommand` and then says the window blocked copying.
- The prompt prefix grew by about 4,000 characters for the new actions and cards, and the app guide from 135,008 to
  about 142,000 bytes for the new features (about 2,500 more tokens per uncached question); the Claude CLI and Codex
  routes pay for it on every question. Splitting the app guide by section and sending only relevant sections (with a `guide`
  lookup for the rest) would cut the prefix by about two thirds.
- The quick-scan card's default program is the newest, not the person's last pick (`choices.js` `defaultProgram`).
- On an ambiguous trend name, the trend card shows the newest waiting run's copy while the choice card asks which run.
- A button whose target matches nothing is dropped (the next answer is told), so a model writing loose names loses
  buttons other than `open`.
- A reply whose JSON can't be read, even leniently (`src/shared/json-reply.js`: fences, prose around the object, raw
  line breaks, trailing commas), fails as before but keeps its text: `ai-diagnostics.js` saves it to
  `content-studio/diagnostics/ai-invalid-<time>.json` (keys redacted, 100 KB at most, owner-only, newest 10, none past
  30 days; not removed with a conversation, see SECURITY.md), and Ask AI keeps the answer field when it can read it
  (`salvageReply`, plus a reading round's lookups), with a note that cards and buttons couldn't be read.
  Other tasks still fail. The Claude Code and Codex routes don't pass the reply on, so they leave no diagnostic. The
  cause of the Oct 18 "not valid JSON" answer (several text blocks, or a refused grammar and free-written JSON) wasn't
  confirmed; the first diagnostics file will show which.

### UX flows

- Create content has no per-draft estimate; it needs a new `estimateContentRun` method (index.js, preload,
  `studio-api-channels.json`, `roles.json`). The confirmation shows what will be made and the allowance.
- `asset-editor.jsx` `createUnsavedGuard().confirmLeave` still uses `window.confirm` (a synchronous gate called from
  about 13 navigation paths); it is listed in `test/no-native-dialogs.test.js`.
- The palette's **People: <name>** opens People & access but `PeopleView` ignores the `{ kind: 'person' }` request, so
  the person's sheet doesn't open.
- The new UI (Next up, setup checklist, inline posts, the asset dialog in Advanced, Library reader tools) was verified
  only in jsdom and a scratch build, not in a browser. The Advanced asset dialog reuses Simple's sheet styles through
  `.simple-shell.kit-creator-host { display: contents }`; check it in both editions.
- A remembered Reports status filter falls back to "any" only when no report has that status.

### Cleanup, dependencies and release

- A few IPC methods have no UI caller (`saveAsset`, `exportAssetPack`, `readEvidence`, `openAssetsFolder`,
  `setThemeStatus`, `readReferenceDoc`, `readStudioRun`). The comment block above them in `index.js` says how to remove
  one safely. The v5 mission, intent and card methods (`generateAssets` among them) were removed with Workflows; the
  `data.workflow-asset-pack` prompt and AI task they used are still listed and now unused.
- Dead exports in used files (`Panel`, `isPreview`, `readyLine`, `findNavItem`, parts of `dashboard.js`) and about
  84 unused CSS classes in `styles.css`,
  `semrush-tools.css`, `premium.css` and `workflow.css`.
- Two ESLint rules-of-hooks false positives (`useReport` in `content-studio-view.jsx`, `useWorkbook` in
  `research-knowledge.jsx` are plain async functions); rename them and delete the override in `eslint.config.js`.
- Dev-only advisories: 2 high (`http-cache-semantics`, `source-map-js`; fixing moves electron-builder to 26.17.0) and 8
  moderate (through electron-builder → @electron/get → global-agent). None ship in the DMG or the image. The
  `basic-ftp` override can go once `get-uri` allows a patched version.
- Electron 42 is the oldest supported line; plan the move to 44 with the desktop smoke and keychain continuity checks.
- Fuses (`build.electronFuses`) haven't been read back from a built app. Turning off `NODE_OPTIONS` also disables
  `NODE_EXTRA_CA_CERTS`: test the DMG behind Semrush's TLS inspection. `enableCookieEncryption` is one-way.
- Notarization runs twice when the Apple variables are set (electron-builder 26 itself, plus the `afterSign` hook
  `scripts/notarize-if-configured.cjs`); delete the hook and its `afterSign` line. The hook already skips Windows builds.
- `npm run release:diagnostics` (`scripts/release-diagnostics.mjs`) fails on every OS with "buildReleaseDiagnostics is
  not a function": `src/shared/v5-core.js` no longer exports it. It was left in place for now. Restore the function, or
  delete the script, its npm script and its mentions in README.md, RUNBOOK.md and docs/macos-app.md together. To check
  a build meanwhile, read its fuses with `npx @electron/fuses read --app <app>`.
- Auto-update is dead code (`configureAutoUpdates` in `index.js`; nothing calls `checkForUpdates`, the mac target is
  DMG only, and the embedded `app-update.yml` points at a personal GitHub). Remove it, or make it real (DMG + zip
  targets, `build.publish` to an internal host, a check after start, install only when nothing runs).
- `index.js` loads `ELECTRON_RENDERER_URL` even in packaged builds; gate it on `!app.isPackaged`. Consider dropping
  `disable-library-validation` from the entitlements.
- CI has never run on GitHub, its Windows jobs included; the suite has only run on macOS. Actions are pinned to major
  tags, not SHAs. Docker base-image updates aren't in Dependabot.
- Windows (`npm run dist:win`): implemented, and its unit tests run on macOS; no installer built or installed on a real
  PC yet, and unsigned. See [Windows desktop](#windows-desktop).
- `scripts/content-studio-live.cjs` and `scripts/image-provider-live.cjs` still write receipts into
  `docs/verification/`, and `scripts/service-smoke.cjs --review` navigates by pre-redesign page names ("Chat with
  findings", "AI reports", "Search platforms" buttons), so it likely fails on the current UI. `npm run test:desktop`
  (`scripts/desktop-smoke.cjs`) has the same problem: it waits for `nav[aria-label=Primary]`, which the redesigned
  sidebar (`aria-label="Main"`) doesn't have, and times out on the Mac (checked Oct 18). It's left out of CI until it
  follows the redesign; RUNBOOK's release check and docs/macos-app.md still name it.
- `.dockerignore` doesn't exclude `docs/archive/` (about 38 MB of old screenshots sent as build context; the final
  image copies only `docs/app-guide.md`).
- Unused files: icon sources in `resources/` (`icon-source.png`, `icon-source-ai.png`,
  `scraper-studio-icon-orange-concept.png`). The September screenshots now sit in `docs/archive/assets/`; they could
  leave the tree entirely (git history keeps them).

### Windows desktop

- **State.** The Windows 10/11 x64 build is implemented: `npm run dist:win` builds an NSIS installer,
  `dist/Scraper-Studio-<version>-Windows-x64.exe` (per-user by default; the person can choose the folder). The unit
  tests for every Windows branch run on macOS with the platform injected. No installer has been built or installed on
  a real PC yet.
- **Building it.** electron-builder's bundled `makensis` is an Intel binary, so on Apple silicon the build needs
  Rosetta (`softwareupdate --install-rosetta --agree-to-license`, a one-time admin step), or the `windows-installer` CI
  job on windows-latest. Commands and checks: [RUNBOOK.md](RUNBOOK.md#release-the-windows-app).
- **Unsigned** until Semrush supplies signing: SmartScreen shows "Windows protected your PC" and "Unknown publisher"
  (More info → Run anyway), and WDAC, AppLocker or Smart App Control on managed PCs may block it outright. The routes
  are in [Decisions](#decisions-semrush-must-make-before-go-live).
- **What CI can't check** (one tester on real Windows 10/11, about 30 minutes): Settings → AI connections with Claude
  Code (native and npm installs) and Codex signed in shows no console windows and Check passes; one Ask AI answer, then
  Cancel during a Codex call leaves no `codex.exe` in Task Manager; closing the window during a run asks first and
  **Keep working** keeps the window; after restarting Windows with the app open, it opens again without an "already
  open" error; a CSV export opens in Excel with accents intact, and re-exporting while it is open works; AltGr on a
  Polish (Programmers) keyboard; snapping to half the screen at 150% scaling; the SmartScreen path.
- **Updates** are manual, as on the Mac: quit the app, run the new installer. The installer waits until the app is
  closed (`resources/installer.nsh`) instead of ending it mid-run. Uninstalling keeps the data folder.
- **Closing the window quits the app** on Windows, so research schedules and workflows run only while it is open.
- **Saved keys** are encrypted with DPAPI for the Windows user: any program running as that user can decrypt them
  ([SECURITY.md](SECURITY.md#secrets-at-rest-and-in-memory)).
- **Mac-only tools**: `npm run dist:mac`, `npm run icons:mac` and `scripts/installed-app-continuity.cjs`. Not built:
  Windows on Arm, a tray icon, and native Windows hosting of the browser studio (use Docker Desktop:
  [docs/web-deploy.md](docs/web-deploy.md#hosting-on-windows)).

### Security gaps to close before wider use

- **The Sheets bridge has no authentication** (`scripts/google-sheets-webhook.gs`): anyone with its URL can read any
  sheet the deploying account can open. Add a `BRIDGE_SECRET` script property checked in `doPost`, send it from
  `callSheetsWebhook` (a new `GOOGLE_SHEETS_BRIDGE_SECRET` key), and allowlist the sheets that may be changed.
  Interim steps: [docs/sheets-guide.md](docs/sheets-guide.md#deploy-the-bridge-and-what-it-can-reach).
- The Google Docs token is pasted by hand and expires; there is no OAuth flow.
- On the Codex route the AI can read what the server's user can read; prefer Claude on a shared server, or run
  `codex` as a separate OS user.

## Decisions Semrush must make before go-live

| Decision | Today | Consequence |
| --- | --- | --- |
| **IP ownership and license** | `package.json` `author` is the original developer, `license: "UNLICENSED"`, no LICENSE file; the About panel credits the same person (`setAboutPanelOptions` in `index.js`). | Settle the assignment in writing, add a LICENSE, update author and the About panel. `"private": true` already blocks `npm publish`. |
| **Repository** | Origin is a public repo on a personal GitHub account (`package.json` `repository`); electron-builder infers its publish target from it. | Move to a private Semrush repo (scan history with gitleaks first), update `repository`. Use `scripts/make-handoff.sh` for the source zip. |
| **Bundle id and signing** | `build.appId` is a personal reverse-domain id, and builds are signed with a personal Developer ID; `INTERNAL_APP_NAME` is `apify-scraper-studio`. | A new appId or Team ID re-prompts or loses the keychain "Safe Storage" item for existing installs. Keep `INTERNAL_APP_NAME` so the data folder stays. Ask testers to note keys first. |
| **SSO provider and hosting** | The kit ships oauth2-proxy (Google Workspace or Okta) behind Caddy; Cloudflare Access also works (100 s request limit). | Pick the provider, the subdomain, and whether the proxy secret or a fixed proxy address carries trust. |
| **AI provider keys** | Anthropic API key or Claude app; Codex optional. | Use a company Anthropic org key. If the org has zero data retention, Claude Fable 5.1 isn't available: set tagging and reports to Opus 5.5 per program. Decide whether Codex is allowed on the shared server. |
| **Spend caps** | Per-run budgets, Ask AI $0.75/call; studio-wide limits off. | Set `STUDIO_DAILY_AI_BUDGET_USD` and `STUDIO_AI_CONCURRENCY`, Apify account limits, and who may start research. Decide whether the Apify token may travel in setup files. |
| **Data retention** | Collected posts (third-party authors and text), Ask AI conversations and memory, activity and access logs are kept until deleted or trimmed by the limits above. | Write a retention policy; decide whether admins may read others' Ask AI conversations (today: no). |
| **Google account** | The Sheets bridge runs as whoever deployed it. | Use a dedicated Google account; schedule the bridge-auth follow-up. |
| **Windows release** | An unsigned x64 build exists ([Windows desktop](#windows-desktop)). `package.json` `author` is the original developer, there is no `build.copyright` (electron-builder then writes "Copyright © <year> <author>" into the installer and the exe), and `build.appId` is the personal reverse-domain id; all three were left as they are. | Before the first tester install: the publisher name for `author` and `build.copyright` (it should match the signing certificate's subject); the final `appId` (the installer's GUID and the taskbar identity derive from it, so changing it later means a second install and split taskbar icons); the signing route: Azure Trusted Signing (preferred; runs on windows-latest), the Adobe/Semrush signing service, or a `.pfx` in `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD`; the data folder (Roaming `%APPDATA%` today, or `%LOCALAPPDATA%`: ask IT about roaming profiles and folder redirection, and decide before testers have data); endpoint policy (per-user installs under `%LOCALAPPDATA%\Programs`, WDAC or AppLocker, Controlled Folder Access); how testers install Codex and Claude Code; which GitHub repository runs CI and holds the signing secrets. |
| **Open product questions** | From the design review. | Should quick scans count toward momentum fully? Should the trend linker feed back into paid runs? Is the shared admin-password identity (`owner`) acceptable? Is Windows in scope for go-live (the build exists; see the row above)? |

## Glossary: UI term and code identifier

| In the UI | In code |
| --- | --- |
| Advanced layout | `uiMode: 'classic'` (`validation.js`); Simple is `'simple'` |
| Trend | theme, `themeId`; one trend across runs is a `trendId` cluster (`trend-history.js`) |
| Needs your OK | run status `'awaiting-review'`; card stage `potential` (`trend-board.js`) |
| Yes / Skipped | decision `'approved'` / `'passed'` |
| Trends report / Editorial toolkit | deliverable ids `'evidence-report'` / `'editorial-toolkit'` |
| Channel assets | a content run with `run.kit` (`asset-kit.js`); a channel is a kit folder id (`kit-folders.json`) |
| Quick scan | a research run with `origin: 'quick-scan'` |
| Research program | `programs` in `state.json`; `research-program.js` |
| Edition | `editionId`: `'semrush'` or `'general'` |
| Scrapers / Brief starters / Activity | pages `automation` (recipes) / `templates` (`marketing-templates.js`) / `runs` |
| Workflows / Playbooks | pages `workflows` / `playbooks` (`missions` is an alias); `workflow-engine.js`, `playbooks.json` |
| Dataset reports / Ask your datasets | pages `reports` (under the `data-tools` page group; analyses) / `chat` (`askFindings`, `findings-chat.js`) |
| Ask AI | `help:*` channels, `help-assistant.js`, `askHelp` |
| Show me target | a `data-spot` attribute plus an entry in `help-spots.json` |
| Velocity vs Momentum | runs that detected a theme (NEW / EMERGING / ACCELERATING, `research-intel.js`) vs share of posts (`trend-history.js`) |
| Evidence | `runs/<id>/evidence.json` |
| Receipt | a per-call record `{ provider, requestedModel, actualModel, costUsd, … }` |
| Capability / method / role base | a group of RPC methods in `roles.json` / one channel in `studio-api-channels.json` / `admin`, `editor` or `channel` |
| People & access | `manageAccess` capability, `team:*` channels, `team-store.js` |
| View as / Preview as | `setViewAs`, `previewAccess`; `viewer.preview` |

## Document map

| Document | Audience | What it covers |
| --- | --- | --- |
| [README.md](README.md) | Everyone | The front door. |
| [HANDOFF.md](HANDOFF.md) | Developers taking over | This file. |
| [docs/how-it-works.pdf](docs/how-it-works.pdf) | Everyone | One-page diagram of how the studio works, end to end. |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Developers | Runtime model, contracts, extension points. |
| [RUNBOOK.md](RUNBOOK.md) | Operators | Install, release, deploy, back up, upgrade, recover. |
| [SECURITY.md](SECURITY.md) | Security reviewers, operators | Trust boundaries, data flows, hardening, gaps. |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Developers | Change checklists, tests, goldens, lint, conventions. |
| [CHANGELOG.md](CHANGELOG.md) | Everyone | What shipped when. |
| [docs/README.md](docs/README.md) | Everyone | Index of everything under `docs/`. |
| [docs/app-guide.md](docs/app-guide.md) | End users, Ask AI | Every page and control; Ask AI's runtime knowledge. |
| [docs/web-deploy.md](docs/web-deploy.md) | Operators | The browser studio: configuration, secrets, SSO, health, drain, logs, backups. |
| [docs/roles-and-access.md](docs/roles-and-access.md) | Developers | Capabilities, the gate, identity, team.json, API. |
| [deploy/README.md](deploy/README.md) | Operators | The Compose and systemd kits. |
