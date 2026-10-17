# Changelog

All notable changes to Scraper Studio, written from the git history. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). There are no git tags yet; each version lists its commits.
Version numbers come from `package.json`, and 0.3.0 covers two days of work (the roles release on Oct 16 and the
redesign on Oct 17), so a DMG labelled 0.3.0 may predate the redesign. Bump the version when the final build-out
below is merged (0.4.0 is suggested) and tag that commit.

## [Unreleased]: final build-out for the handoff (2026-10-17, uncommitted at the time of writing)

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

### Changed
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
