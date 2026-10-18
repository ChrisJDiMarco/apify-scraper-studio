# Changelog

All notable changes to Scraper Studio, written from the git history. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). There are no git tags yet; each version lists its commits.
Version numbers come from `package.json`, and 0.3.0 covers two days of work (the roles release on Oct 16 and the
redesign on Oct 17), so a DMG labelled 0.3.0 may predate the redesign. Bump the version when the final build-out
below is merged (0.4.0 is suggested) and tag that commit.

## [Unreleased]: wave 3 (2026-10-17 to 2026-10-18)

Commits `eb5cf1c`, `aead244`, `844fe6d`, `5a43ee0`, `ccca103` and the Google Drive sync commit that follows them.
Design record: [docs/design-review/SPEC-3.md](docs/design-review/SPEC-3.md).

### Added
- **AI connections and model routing**: Claude Code and Codex through their subscription sign-in, and API keys for
  Anthropic, OpenAI, OpenRouter (any text model) and fal.ai (images and video). An admin **Model routing** page sets
  the connection, model and effort for every AI task (`src/shared/ai-tasks.json`, `src/main/ai-routing.js`); runs
  snapshot what they resolved.
- **Streaming Ask AI**: answers stream as they are written (IPC on the Mac, SSE on the web), with live progress.
- **Automatic scan reports**: a quick scan started from Ask AI writes a short trends report and posts it back into the
  conversation; full research runs started from chat post their trends for Yes / Skip.
- **Brand references on every picture**: every image path sends the brand reference set for that picture family.
- **Monday.com two-way sync**: connect, board picker, column and status mapping, webhooks, a sync log.
- **Workflows and Playbooks** rebuilt: a playbook catalog and a workflow engine with per-run and per-month budgets.
- **Settings section nav**, **single "Main" workspace** for the Semrush package, and an admin **Research programs**
  panel on Home with a quick-edit drawer.
- **Docs-style report editor**: rich text, live co-editing on the web, version history, and teammate notes anchored
  to text with threads, mentions and resolve. Markdown stays the saved form.
- **Google Drive folder sync**: an admin connects a service account and a folder; every new report (and optionally
  channel assets) is saved as a Google Doc in folders that mirror the Library and updated after edits, with
  backfill, a sync log and Retry (`src/main/drive-client.js`, `src/main/drive-sync.js`).
- **docs/how-it-works.pdf**: a one-page diagram of the studio for the handoff.

### Fixed
- A logic sweep fixed about 55 lost hand-offs and illogical flows, including Trend board → Create content opening
  without the trend (the page error boundary remounted the view; it now resets by key instead).

## [Unreleased]: final build-out for the handoff (2026-10-17, commit `db3448f`)

### Added
- **Browser studio operations**: `/healthz` and `/readyz`; drain on SIGTERM/SIGINT (`STUDIO_DRAIN_SECONDS`) with paid
  work refused as 503 `restarting`; JSON request logs with `X-Request-Id` (`src/main/server-log.js`,
  `STUDIO_LOG_LEVEL`); a reload notice after a deploy (`X-Studio-Build`); process-level error handlers; configurable
  live-update caps (`STUDIO_MAX_EVENT_STREAMS`, `STUDIO_MAX_STREAMS_PER_PERSON`) with a "paused" notice instead of
  silent staleness; SSE backpressure; upload and download quotas; keep-alive setting (`STUDIO_KEEPALIVE_SECONDS`).
- **Secrets and privilege**: `STUDIO_SECRETS_FILE` (Docker, Compose, Kubernetes secrets), `STUDIO_RUN_AS` (read a
  root-only secrets file as root, then switch user), `STUDIO_PROXY_SECRET`, umask 077 and 0700 data folders.
- **Backup and restore**: `npm run backup` / `npm run restore` (`scripts/studio-backup.cjs`,
  `scripts/studio-restore.cjs`) with a SHA-256 manifest, live-safe passes, checks and an undo copy.
- **Deploy kit** (`deploy/`): Docker Compose with Caddy and oauth2-proxy, systemd service and nightly backup timer.
- **Studio-wide AI limits** (`src/main/ai-limits.js`): `STUDIO_AI_CONCURRENCY` and `STUDIO_DAILY_AI_BUDGET_USD`.
- **Ask AI reach**: one shared action list (`src/shared/ask-actions.json`, 27 kinds) for the server prompt and the
  renderer; server-side target resolution with a choice card for ambiguous names; new actions (undo a decision, say
  yes to several trends, set a file's status, mark a trend used, suggest a report change, open anything, copy links
  and text, export, send to Google Docs, draft a program, invite people, View as, lock a prompt); new cards (Check
  before saving, choice, plan, draft, suggested report change); `find`, `asset` and `spend` lookups; an attention
  digest, channels, decision history and team in its context; recall of related conversations; studio links in
  answers; "Needs you now" starters; queued questions while an answer is being written.
- **UX**: Home's **Next up** rail and an admin **Get the studio ready** checklist; **Show 2 real posts** on trend cards
  (free, new `readTrendPosts` method); Undo after Yes or Skip, an approved list with Undo and a Skipped list with
  Reconsider; a "Research stopped" row with Try again; **Make channel assets** opens over the current page in every
  layout; the Advanced Library reader gets Simple's tools; remembered program, layout and filters per person; one
  default-program rule; role-aware Ask AI starters; Slack briefing with links; more palette groups and actions.
- **Data safety**: cell-by-cell merge of concurrent Sheets edits (409 `sheetConflict`); request ids that make retried
  paid requests join the original; Apify budget and timeout defaults for custom scrapers and test samples; spreadsheet
  import cell limits; damaged `data.json`/`config.json` copied aside instead of overwritten; fsync'd atomic writes;
  detection of keys saved under a different `STUDIO_SECRET_KEY` (409 `keyMismatch`); Codex isolated in an empty temp
  folder with a read-only sandbox and its tools off; a queued, timed Monday.com sync; temporary browser export copies.
- **Project hygiene**: ESLint 10 flat config (`npm run lint`), `npm run check`, a CI workflow and Dependabot, `.nvmrc`
  (24), `engines`, `"private": true`, `.env.example`, Electron fuses, a `basic-ftp` override (production audit clean).
- **Docs**: `HANDOFF.md`, `ARCHITECTURE.md`, `RUNBOOK.md`, `SECURITY.md`, `CONTRIBUTING.md`, this changelog,
  `docs/README.md`, the docs archive, `scripts/make-handoff.sh` and `test/docs-consistency.test.js`.
- **Settings section nav** (wave 3): a left nav grouped Collection, AI, Brand, Integrations and Studio, sticky on wide
  screens and a **Jump to** menu on narrow ones, with a status dot per section, scroll-spy, keyboard support and
  `#/settings/<section>` links (`settings-sections.js`, `settings-nav.jsx`, `section-spy.js`). Setup steps open their
  section. Connection diagnostics names saved keys that can't be read and data files that were set aside.
- **One-workspace builds** (wave 3): package.json `studioWorkspace` (on for the Semrush package) and
  `STUDIO_WORKSPACE_MODE` / `STUDIO_WORKSPACE_NAME` give the studio one workspace, **Main**, with no switcher. Other
  workspaces are hidden, never deleted (backup `state.before-single-workspace.json`; undo with
  `STUDIO_WORKSPACE_MODE=multi`).
- **Home → Research programs** (wave 3, admins): schedule, next and last run, sources and budgets per program, with Run
  now, Pause/Resume schedule and a quick-edit drawer holding every program setting (`home-programs.jsx`,
  `program-drawer.jsx`, `program-editor.jsx`). The program form gains Theme match confidence and Accept matches
  automatically at; saving an edited program now sends `baseUpdatedAt`, so a save over someone else's is refused.
- **Monday.com, plug and play and two-way** (wave 3B): Settings → Monday.com connects with a tested token, picks or
  makes a board, matches columns and stage labels, and sets sync rules with a call-budget estimate. The server builds
  the cards and sends only changed columns, on its own (as changes happen, hourly or daily) or on Sync now (a background
  job); changes come back by webhook on the web (`POST /hooks/monday/<secret>`) or polling, with Yes/Skip accepted only
  while a trend waits for an OK. Studio key lookups and persisted `unsure` creates stop duplicates; a sync log, chips on
  Trends cards in both layouts, Open in Monday, comments, owner and dates (`monday-engine.js`, `monday-cards.js`,
  `monday-store.js`, `src/shared/monday.json`, `monday-settings.jsx`, `monday-ui.jsx`). New methods: `connectMonday`,
  `testMondayConnection`, `listMondayBoards`, `readMondayBoard`, `createMondayBoard`, `fixMondayBoard`,
  `saveMondayLink`, `disconnectMonday`, `readMondaySyncLog`, `readMondayItem`.
- **Workflows and playbooks, rebuilt** (wave 3B, Advanced › Automate): workflows are saved automations over research
  programs and quick scans: a schedule (or every few hours for quick scans), whenever a program runs, or by hand; then
  Find trends or Quick scan → Approve trends (rules on momentum when found, priority and speed; wait for review; or all)
  → Write reports → Make channel assets → Update Monday.com → Tell the team. A step rail, run history with links,
  Pause/Resume/Stop/Try again, Pause all for admins, approved per-run and per-month budgets bound to a hash of the paid
  setup, owner access re-checked per step, auto-pause after three failures (`workflow-engine.js`, `workflow-store.js`,
  `src/shared/workflow-core.js`, `workflow-steps.json`, `workflows-view.jsx`, `workflow-editor.jsx`). Playbooks
  (`playbooks.json`: Weekly SEO trend watch, Competitor launch watch, Product launch pulse, Newsletter prep, PR angle
  finder, Start from scratch, plus team playbooks) set up a program and a workflow in a six-step sheet with the cost
  (`playbooks-view.jsx`, `playbook-setup.jsx`). Program **notes for the AI** and an assets step's notes go into the
  prompts only when set. Home **Automations** card, Inbox rows (waiting for an OK, needs a budget, draft to approve,
  finished, stopped), Activity entries, palette **Run <workflow>…**, New › Playbook. Capabilities `readWorkflows` and
  `manageWorkflows` (policy version 2); 13 new methods: `estimateWorkflow`, `readWorkflowRun`, `previewPlaybook`,
  `saveWorkflow`, `setWorkflowStatus`, `deleteWorkflow`, `runWorkflow`, `cancelWorkflowRun`, `retryWorkflowRun`,
  `approveWorkflowBudget`, `applyPlaybook`, `savePlaybook`, `deletePlaybook`.

### Changed
- Data tools' **Playbooks** are now **Brief starters** (under Collect); Data tools has no Automate group.
- **Removed** the v5 mission engine, the intent planner and the action graphs (and their second scheduler, onboarding,
  evals and release diagnostics), with 16 methods: `listMissions`, `saveMission`, `runMission`, `runActionGraph`,
  `pauseMission`, `scheduleMission`, `exportMissionBundle`, `planIntent`, `runIntent`, `runIntentAction`, `retryJob`,
  `generateAssets`, `saveCard`, `moveCard`, `getJob`, `readJobLog`. `state.v5` is `{ recipeVersions }`, read from
  `v5/events.jsonl` only when it changes; the folder stays on disk. `mission-command.jsx` became `command-palette.jsx`.
- `syncTrendBoardToMonday` takes `{ keys?, full? }` and returns `{ jobId, queued }`; the renderer no longer sends cards.
  `saveMondayBoard` and `clearMondayBoard` are replaced by `saveMondayLink` and `disconnectMonday`. The Monday board
  setup moves from `config.json` to `content-studio/monday.json` on first start (sync stays manual until turned on).
- **Breaking (browser studio)**: company sign-in requires `STUDIO_TRUSTED_PROXY_CIDRS` or `STUDIO_PROXY_SECRET`;
  the launcher refuses to run as root without `STUDIO_RUN_AS`.
- The data-folder lock records host, boot and a 30-second heartbeat and takes over locks left by killed processes
  (fixes a crash loop for containers restarted after an unclean stop); it is released only at process exit.
- The Advanced run panel starts its ticks from the team's decisions and uses the shared Write reports estimate;
  every confirmation is an in-app dialog (no native dialogs); Ask AI's quick-scan finish offers
  **Full research with “<program>”**; trend stages match the board everywhere.
- The Dockerfile uses tini, a `/readyz` health check and `STOPSIGNAL SIGTERM`.
- The app guide drops tester-era statements, gives measured Ask AI costs and covers the new features.

### Removed
- Dead modules `src/renderer/src/pipeline-view.jsx`, `src/shared/assets.js`, `src/shared/run-view.js` and their tests.

### Fixed
- Raw filesystem errors and server paths no longer reach browsers; an expired SSO session shows a sign-in notice
  instead of "Failed to fetch"; Ask AI buttons report failures under the button; editors without Settings rights are
  never offered admin-only work.

## [0.3.0]: 2026-10-14 to 2026-10-17

### Added
- **Simple mode, on by default** (`5deacd9`): Home, Reports, Trends and Ask AI as a full page; Ask AI action buttons
  that run only on a click, with paid steps confirmed.
- **Channel asset kits** (`79e1930`): the n8n "Generate All Channel Assets" workflow as one dialog (12 written assets
  and 3 picture sets, filed in n8n's 10 channel folders); Ask AI reads reports, folders and runs before answering and
  runs Show me tours.
- **Brand reference images** for kit pictures (`cbc280e`, `f43c9ed`).
- **Roles** (`b43e2ae`): Admin, Editor and Channel owner, one synchronous deny-by-default gate, per-viewer state
  projection, View as, personal sign-in links, company sign-in with `STUDIO_ADMIN_EMAILS`, secrets through
  `STUDIO_SECRETS_FD`, Analytics, an in-place report editor, one left sidebar for every layout.
- **Trends as a board** in Simple mode (`613b7b5`).
- **The redesign** (`eaa700d`): Ask AI conversations and long-term memory per person, quick scans, grounded chat
  cards; the Library folder tree; the Trend tracker and momentum; the Prompt Library (editable blocks, versions,
  locks, previews, test runs, Ask AI prompt edits); capability-based roles with custom roles, per-person access,
  invites and an access log; a new sidebar, New menu, Search palette and rail; weekly briefing, Inbox, Calendar and
  My plan; approve with a note; share links; content status; brand check; How this was made.

### Changed
- Test expectations refreshed for the redesign; `npm test` passed with 111 files and 1,537 tests (`3d11204`).
- Ask AI's answer schema kept small enough for the Anthropic API: long enums became plain strings (`e267106`), then
  the scan and edit moved to single top-level objects and cards became one flat shape, with a one-time retry when the
  API refuses a grammar (`62cb9da`).

## [0.2.0]: 2026-10-07 to 2026-10-08

### Added
- Content Studio, the research workspace, the standalone web server (password login, `/api/rpc`) and the Semrush
  shell (`5b42921`).
- The Sheets workbook view with the Golden Thread tabs, imports and exports (`57d424b`, `b38a29a`, `01f94e0`).
- The Golden Thread n8n pipeline port: Actors, windows, batches, scoring, tagging, paired reports, per-stage models and
  estimates (`fdf1f22`).
- Tester build (`af50172`): Share your setup, three Claude routes with preflight, Ask AI in the header, quit
  protection during runs, a universal Mac build.
- Browser parity with the Mac app (`8d99a1b`): the shared channel table, the web runtime, the studio server with SSO
  header sign-in, the Dockerfile and `docs/web-deploy.md`; SSO header names documented (`ef033a1`).
- Pictures in the Ask AI drawer (`03de4ca`).

## [0.1.0]: 2026-09-16

### Added
- First public version (`284d983`): Search platforms, Scrapers, Datasets, Chat with findings, Playbooks, AI reports and
  Mac packaging, with a setup guide.
