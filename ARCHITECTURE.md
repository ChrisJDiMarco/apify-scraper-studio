# Scraper Studio architecture

How a click becomes a gated handler, a paid AI call and a state push, and where to extend it. Function and file names
are given instead of line numbers, because the big files move. Start with [HANDOFF.md](HANDOFF.md) if you haven't.

## Process model

One main process, two hosts.

| | Mac app | Browser studio |
| --- | --- | --- |
| Entry | `out/main/index.js` (built from `src/main/index.js` by electron-vite) | `scripts/studio-web.cjs`, which sets `STUDIO_RUNTIME=web` and then requires `src/main/index.js` |
| Electron APIs | real `app`, `BrowserWindow`, `dialog`, `shell`, `safeStorage`, `ipcMain` | `src/main/web-runtime.js` stands in for each: file dialogs read browser uploads, saves and "open" become downloads (folders as one .zip), `safeStorage` is AES-256-GCM with `STUDIO_SECRET_KEY`, `ipcMain.handle` registers RPC handlers |
| UI | `src/renderer` in a `BrowserWindow`, talking through `window.apifyStudio` (`src/preload/index.js`) | the same `src/renderer` bundled by `vite.web.config.mjs` from `src/web/main.jsx`, talking through `src/web/web-api.js` |
| Transport | `ipcRenderer.invoke(channel, payload)`; state pushed on `state-changed` | `POST /api/rpc { channel, payload }`; state over server-sent events on `GET /api/events` |
| Identity | always `{ id: 'local', role: 'admin', via: 'desktop' }` | from `studio-server.js` `identify(req)`: proxy email header, admin password session or personal sign-in link |

`index.js` checks `WEB_RUNTIME` in a few places (key fallbacks, the secrets check, temporary exports). Everything else
runs unchanged in both, which is what `test/web-host.test.js` (the real main process served over HTTP) and
`test/web-parity.test.js` verify.

**The web launcher** (`scripts/studio-web.cjs`), in order: read secrets (`web-secrets.js`) and delete them from
`process.env`; if root, switch to `STUDIO_RUN_AS`; `umask 077`; `web-runtime.configure()` (data and transfer folders,
encryption key); `studio-owner-lock.releaseOnlyAtExit()`; require `index.js` (registers handlers, takes the data-folder
lock, starts schedulers); `createStudioServer()`; listen. On SIGTERM/SIGINT it drains (see [RUNBOOK.md](RUNBOOK.md#stopping-and-updating)).

**`studio-server.js` routes:** `GET /healthz`, `GET /readyz` (no sign-in), `POST /api/login`, `GET /api/session`,
`POST /api/logout`, `GET /api/events` (SSE, per-viewer projection, coalesced every 750 ms, keep-alive every 25 s),
`POST /api/rpc`, `POST /api/upload` (30 MB, single use), `GET /api/download/:id` (10 minutes), and static files from
`out/web` with a strict CSP. Every response carries `X-Request-Id` and `X-Studio-Build`; the page shows a reload notice
when the build changes. Errors the server didn't expect reach the browser as "Something went wrong… ref <id>".

## The RPC method registry

`src/shared/studio-api-channels.json` lists every method the UI calls (158) and the main-process channel it maps to
(`studio:*`, `help:*`, `team:*` and older ones such as `save-key`). Three things must agree with it:

1. `src/preload/index.js`: the Mac bridge, written by hand (`invoke('studio:x', payload)`).
2. `src/web/web-api.js`: derived from the JSON automatically, plus `FILE_PICKERS` for methods that take a file.
3. A handler in `src/main/index.js`: `handle(channel, fn)` (every `ipcMain.handle` goes through `gated`), or the
   `studioMethods` list, which auto-registers `studio:<name>` for each `contentWorkspace.<name>`.

`test/web-parity.test.js` keeps preload and web API in step; `test/roles.test.js` checks every method sits in exactly
one capability. **Checklist for a new method:** [CONTRIBUTING.md](CONTRIBUTING.md#a-new-rpc-method).

## Roles and the gate

- **Policy data**: `src/shared/roles.json`: 25 `capabilities` (each with methods, defaults, bases, `requires`,
  `spends`, `lock`), `channelSafeMethods`, `identityMethods`, `readMethods`, `pages`, `pageGroups`, `navOrder`,
  `roleTemplates`, copy.
- **Policy logic**: `src/main/roles.js` (`capabilitiesFor`, `methodsFor`, `projectState`, `stripMoney`, `pagesFor`).
- **The gate**: `gated()` in `index.js` → `access.check(method, payload, viewer)` (deny by default; 403 with a plain
  refusal; previews allow only identity and read methods; channel bases get their payload rebuilt from an allowlist)
  → the handler → `access.after()` (activity and access logs, result projections, money stripped) → errors through
  `access.rewriteError` (provider and settings errors become "Ask <admin>" lines for non-admins).
- **The gate stays synchronous**: `gated()` never awaits before calling the handler, so synchronous handlers keep
  returning plain values.
- **State projection**: `publicState()` builds the base once; `emitState()` sends `access.project(base, viewer)` on
  the Mac, or broadcasts the base so each SSE stream renders `people.view(base, identity, session)` (memoised per state
  object and view key).
- **Renderer**: `src/renderer/src/viewer.js` `can(viewer, method)` decides whether a control shows, `canRun` whether it
  runs; write buttons spread `writeProps(viewer)` so previews show them disabled. Hiding is never the only guard.

Full matrix, identity rules, team.json schema and API: [docs/roles-and-access.md](docs/roles-and-access.md).

## Data folder layout

See [HANDOFF.md → Data model and storage](HANDOFF.md#data-model-and-storage) for the tree. Ownership:

| Store | Module | Notes |
| --- | --- | --- |
| `config.json` | `index.js` (`loadConfig`, `encryptValue`) | Encrypted keys, `KEY_NAMES`. |
| `data.json` | `index.js` (`loadData`, `saveData`), validated by `src/shared/validation.js` | Settings and Data tools records. |
| `content-studio/state.json` and `runs/` | `content-workspace.js` | The studio service: workspaces, programs, runs, assets. |
| `content-studio/team.json` | `team-store.js` | Synchronous, atomic, versioned (v2). |
| `content-studio/ask/` | `ask-store.js` | Per-person folders keyed by a hash of the identity id. |
| `content-studio/prompts/`, `prompt-tests/` | `prompt-store.js`, `prompt-lab.js` | Prompt versions per workspace. |
| `content-studio/.studio-owner.json` | `studio-owner-lock.js` | One process per folder; heartbeat every 30 s; stale-lock takeover rules in [RUNBOOK.md](RUNBOOK.md#recover-from-a-stuck-data-folder-lock). |
| `workbooks/` | `workbooks.js`, `workbook-import.js` | Sheets imports and per-cell edits. |
| `v5/` | `index.js` + `src/shared/v5-core.js` | The Workflows engine's event log and projection. |
| `ai-spend.json` | `ai-limits.js` | Today's recorded AI spend (only with a daily budget). |

All JSON writes go through a temp-file + fsync + rename helper; there is no database and no cross-file transaction.

## Ask AI pipeline

```
help-assistant.jsx ──help:ask { question, conversationId, requestId, page }──► index.js help:ask handler
  askInConversation: ask-store history (last 8 turns + rolling summary), memory recall (BM25-lite, 12 items),
                     related conversations (searchConversations, minScore 3); idempotent by requestId
  answerHelp: a cancellable 'chat' job; a temp folder under help/calls; cap $0.75 × model price ratio
    helpPromptParts (help-assistant.js)
      prefix (same for every question from a role; cached on the API route):
        instructions + PAGES + ACTIONS (from ask-actions.json, filtered by role) + SPOTS (help-spots.json)
        + APP GUIDE (docs/app-guide.md, read once by appGuide(), copied to out/main/app-guide.md at build)
      body: LIVE CONTEXT (helpContext: page, attention digest, programs, runs, trends, reports, folders,
            channels, team for admins, prompts) + memory + conversation + question
    → generateStructuredOutput (strict schema, helpSchema)
    → up to 3 lookups (helpLookup: report, asset-folder, asset, run, trend, posts, find, conversation, memory,
      plus spend and prompt by role) → a second call with LOOKUP RESULTS (data, not instructions)
    → cleanReply (drops unknown pages, spots, kinds; cleanParams checks key=value params)
    → helpResolveActions (target → real ids; two equal matches → a choice card; no match → dropped, noted)
    → hydrateCards (studio cards built from state; model cards from their lines)
    → memory writes (secret-shaped text refused) → stored message → reply
studio-actions.js runs a clicked button: role check, confirmation with estimate for paid work, the executor.
```

**The schema size limit.** The Anthropic API compiles the structured-output schema into a grammar and refuses one it
judges too large. So the answer schema is flat: one top-level `scan`, one top-level `edit`, actions with `params` as
`key=value` strings, cards as `{ type, ref, title, note, items: [string], actionIndexes }`, and long lists (pages,
spots, action kinds, card types, lookup kinds) as plain strings the prompt lists and `cleanReply` checks.
`test/help-assistant-prompts.test.js` holds it to 11 objects, 10 values per enum and 40 in total. If the API still
refuses a grammar, `anthropic-runner.js` retries once with the schema written into the prompt (nothing is billed for
the refused call); treat that as a fallback.

**The action catalog.** `src/shared/ask-actions.json` lists 27 action kinds (plus 3 old names as aliases): label,
target type, params, the methods a role must hold (all of them), `needs` (prompt view/edit, Google Drive), `spends`,
`confirm` and the prompt line. Main (`help-assistant.js`) builds the prompt from it and gates buttons; the renderer
(`studio-actions.js`) imports the same JSON to run them. `test/ask-actions-registry.test.js` checks it.

**Cards.** Studio cards (trend, report, asset-folder, run, program, chart, posts, scan-plan, prompt-change,
report-change, action, choice) are hydrated from state on the server, so their numbers are the studio's. Model cards
(metric, table, checklist, compare, choice, draft, plan) come from the model's lines and are checked. Rendering:
`src/renderer/src/chat-cards.jsx`. Contract history: [docs/design-review/SPEC.md](docs/design-review/SPEC.md) §3.

**Storage and privacy.** Conversations and memory are per person (`ask/<hash>/`); admins can't read them; removing a
member purges theirs; everyone signed in with the admin password shares the `owner` identity.

## Prompts: registry, store and snapshots

- `src/shared/prompt-registry.json`: 36 prompts in 7 groups (research 4, reports 2, assets 15, pictures 5, assistant
  2, data 5, system 3). Each prompt is a list of blocks: fixed scaffolding, data slots and editable instruction
  blocks, with required `{{variables}}` and terms.
- `src/shared/prompt-defaults.json` (default block texts) and `prompt-samples.json` (preview data).
- `src/shared/prompt-template.js`: fills variables, validates every saved edit (required values and words, length,
  no secrets), and renders a prompt for a stage. With no saved versions, every prompt is byte-identical to the
  studio's default; `scripts/prompt-goldens.mjs` proves it against `test/fixtures/prompts/` (99 cases).
- `src/main/prompt-store.js`: versions per workspace (200 per prompt), admin locks, test records (50).
  `prompt-lab.js` serves the Prompt Library API; `prompt-cases.js` builds previews and test runs.
- **Snapshots**: each run records the prompt versions it started with; a retry asks whether to use newer ones for
  unfinished steps.

## Research pipeline and quick scans

| Stage | Code | Writes |
| --- | --- | --- |
| Plan collection | `buildCollectionPlan` (`src/shared/research-collection.js`): Actor jobs per platform, per-job caps from the budget | the run |
| Collect | `apify-runner.js` via `studio-host.js` (Apify client, collection locks under `collections/`) | `collections/`, `runs/<id>/input.json` |
| Prepare evidence | `prepareResearchEvidence`, `resolveResearchWindow` (`research-program.js`) | `runs/<id>/evidence.json` |
| Discover, synthesize, match | `discoveryPrompt`, `synthesisPrompt`, `matchingPrompt` (`research-prompts.js`), orchestrated in `content-workspace.js` | batch files, `*.validated.json`, the run's themes |
| Score | `scoreTheme`, `rankThemes` (`research-intel.js`) | themes' priority tier |
| Review | run status `awaiting-review`; `decideResearchTheme`, `approveResearchThemes` | decisions, `decisionsBy` |
| Tag | `taggingPrompt` | `runs/<id>/assignments.json`, `theme-stats.json` |
| Reports | `buildTrendReportRequest`, `buildToolkitRequest` (`research-reports.js`) | report assets |
| Deliver (optional) | `bridge-delivery.js`, `google-delivery.js`, `monday-sync.js` | Drive receipts |

Retry resumes from saved stages: finished Apify jobs, batches and reports are never paid for twice. Schedules
(`research-schedule.js`) tick every 30 seconds while the process runs.

**Quick scans** (`src/shared/research-quick-scan.js`, `quick-scan.json`): `normalizeScan` → `rankTargetsForTopic`
(deterministic, free) → `deriveQuickScanProgram` (a new program object; the saved one is never touched) →
`scanFingerprint`. `content-workspace.js` `estimateQuickScan` prices it; `startQuickScan` refuses if the fingerprint
changed, then runs collect → discover → synthesize and stops (`origin: 'quick-scan'`). One per workspace at a time.

## Trend history

`src/shared/trend-history.js` `buildTrendHistory` links (run, theme) appearances with union-find: same theme id, then
recorded matches and aliases, then a similarity score (0.55 × name overlap + 0.35 × keywords + 0.10 same category, at
least 0.55); two themes from one run never merge. Momentum compares share of posts with the previous run (`MOMENTUM`:
rising ×1.25 and +0.25 points or a three-run streak; fading below ×0.7 or two missed runs). It feeds the trend
badges, What changed, Ask AI's digest (`trendMemoryDigest`) and `buildTrendTrackerWorkbook` (the Sheets Trend tracker).
Per-run stats are cached in `runs/<id>/theme-stats.json`. Free and deterministic.

## Library tree

`src/shared/library-tree.js` `buildLibraryTree` (ESM, renderer) files every studio file once: research run → trend
→ trends report and toolkit, channel assets (by kit run date, then by channel from `kit-folders.json`), drafts,
pictures; then Earlier research, Other sources, Drafts without a trend, Pictures. Join rules: run → trends via
`reportRunIds`; report → kits via `kit.reportAssetId` (never `sourceKey` alone); drafts → trend via `sourceAssetId`.
Simple Reports, Simple Assets and the Advanced Library all read it.

## Build outputs and copy-main-modules

- `npm run build`: electron-vite builds `out/main`, `out/preload`, `out/renderer`, then
  `scripts/copy-main-modules.mjs` copies files main loads **lazily** (by a path electron-vite can't see) into
  `out/main` and `out/shared`, including `docs/app-guide.md` → `out/main/app-guide.md`. A new lazily required file
  must be listed there; `test/build-modules.test.js` walks every module main loads and fails if one is missing.
- `npm run build:web`: Vite builds `out/web` (the page) from `vite.web.config.mjs`. The server runs `src/main`
  directly (no bundle), which is why the Dockerfile copies `src/` and `docs/app-guide.md`.
- `npm run dist:mac`: electron-builder packs `out/`, production `node_modules`, `package.json`, `README.md` and the
  Sheets bridge script into a universal DMG (`.env*`, PEM and key files excluded).

**Module rules.** Main is CommonJS. The renderer is ESM and **cannot import CommonJS from `src/shared`** (the Vite
build fails), so data both sides need lives in JSON, renderer-only pure logic is ESM (`trend-board.js`,
`library-tree.js`), main-only logic is CommonJS (`research-workbook.js`). ESLint parses each `src/shared` file by its
content (`eslint.config.js`).

## Concurrency and background work

- **Jobs**: long work registers a job (`startJob`, the `N running` tray); `cancelJob` and quitting abort it.
  `activeWorkSummary()` lists what's running; the Mac asks before quitting during work; the web drain waits for it.
- **AI limits**: `ai-limits.js` queues AI calls beyond `STUDIO_AI_CONCURRENCY` (cancellable while waiting) and refuses
  new ones past `STUDIO_DAILY_AI_BUDGET_USD`.
- **Locks**: the data-folder owner lock; Apify collection locks under `content-studio/collections/*.lock` (stale ones
  are cleared when ownership is taken).
- **Idempotency**: Ask AI by `requestId`; `searchSources`, `runRecipe`, `testRecipe` and `analyzeDataset` accept one
  too (a repeat joins the work in flight or returns its result for 30 minutes; a different payload under the same id
  is 409 `requestIdReused`).
- **Schedulers**: research schedules (30 s tick in `content-workspace.js`) and the Workflows mission scheduler in
  `index.js`, both only while the process runs.

## Legacy Data tools

The Advanced **Data tools** group (capability `dataTools`) predates the studio: Search platforms, Scrapers (recipes,
`src/shared/recipe.js`), Import research, Datasets, Dataset reports, Compare snapshots, Ask your datasets
(`findings-chat.js`), Playbooks (`marketing-templates.js`) and Workflows (the v5 mission engine, `v5-core.js`, events in
`v5/events.jsonl`). It stores in `data.json` and `datasets/`. Research programs don't feed it (their posts open in
Sheets and Ask AI searches them).

## Extension points

| To add | Read |
| --- | --- |
| An RPC method, capability, prompt, Ask AI action, card type, Show me target, channel, environment variable | [CONTRIBUTING.md](CONTRIBUTING.md) |
| A role | People & access › Roles (no code). A new built-in base touches `roles.json` `roles`, `roles.js` `effectiveRole`/`pagesFor`/`projectState` and `viewer.js` `ROLE_LABELS`. |
| A deploy target | [docs/web-deploy.md](docs/web-deploy.md), [deploy/README.md](deploy/README.md) |
