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

`src/shared/studio-api-channels.json` lists every method the UI calls (180) and the main-process channel it maps to
(`studio:*`, `help:*`, `team:*` and older ones such as `save-key`). Three things must agree with it:

1. `src/preload/index.js`: the Mac bridge, written by hand (`invoke('studio:x', payload)`).
2. `src/web/web-api.js`: derived from the JSON automatically, plus `FILE_PICKERS` for methods that take a file.
3. A handler in `src/main/index.js`: `handle(channel, fn)` (every `ipcMain.handle` goes through `gated`), or the
   `studioMethods` list, which auto-registers `studio:<name>` for each `contentWorkspace.<name>`.

`test/web-parity.test.js` keeps preload and web API in step; `test/roles.test.js` checks every method sits in exactly
one capability. **Checklist for a new method:** [CONTRIBUTING.md](CONTRIBUTING.md#a-new-rpc-method).

## Roles and the gate

- **Policy data**: `src/shared/roles.json`: 28 `capabilities` (each with methods, defaults, bases, `requires`,
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
| `content-studio/monday.json`, `monday-log.jsonl` | `monday-store.js` | Monday.com: per-workspace board link (setup saves check `rev`, 409 `mondaySetupChanged`), item map, people cache, calls today; the sync log (2,000 rows). Webhook secrets stored as sha256 only. |
| `content-studio/ask/` | `ask-store.js` | Per-person folders keyed by a hash of the identity id. |
| `content-studio/prompts/`, `prompt-tests/` | `prompt-store.js`, `prompt-lab.js` | Prompt versions per workspace. |
| `content-studio/.studio-owner.json` | `studio-owner-lock.js` | One process per folder; heartbeat every 30 s; stale-lock takeover rules in [RUNBOOK.md](RUNBOOK.md#recover-from-a-stuck-data-folder-lock). |
| `workbooks/` | `workbooks.js`, `workbook-import.js` | Sheets imports and per-cell edits. |
| `content-studio/report-docs/` | `report-docs.js` | The report editor's shared documents: `<assetId>.json` (Yjs state, epoch, version, version list, who wrote in this epoch) and `<assetId>.versions/<versionId>.json` (Markdown, plus the Yjs state up to 2 MB); 50 versions kept besides the original. The report itself stays the `.edited.md` written through `content-workspace.js` `writeReportMarkdown`. |
| `content-studio/report-notes.json` | `report-notes.js` | Notes on reports and each person's Inbox items. Synchronous, atomic, versioned (v1); a damaged file is put aside, a newer one refuses to start. |
| `content-studio/workflows.json` | `workflow-store.js` | Workflows, their runs and team playbooks. Synchronous, atomic, versioned (v1); a newer file refuses to start. Children carry `run.workflow` in `state.json`, written in the save that creates them, so `recover()` rebuilds a missed link. |
| `v5/` | `index.js` + `src/shared/v5-core.js` | The retired v5 event log; only `recipe-version-saved` (and legacy-import) events are read, for Scrapers' saved versions (`state.v5.recipeVersions`, cached by the file's size and time). |
| `ai-spend.json` | `ai-limits.js` | Today's recorded AI spend (only with a daily budget). |

All JSON writes go through a temp-file + fsync + rename helper; there is no database and no cross-file transaction.

**Workspace policy.** `src/main/workspace-policy.js` resolves one workspace or several from package.json
`studioWorkspace` and `STUDIO_WORKSPACE_MODE`/`STUDIO_WORKSPACE_NAME`; `index.js` passes it to `createContentWorkspace`.
In single mode `migrateWorkspacePolicy` (run once at start, idempotent) picks the main workspace, renames it (keeping
`previousName`), marks the others `archived: { reason: 'single-workspace' }` and records `state.workspacePolicy`; the
first change copies `state.json` to `state.before-single-workspace.json`. Archived workspaces stay in `state.json` but
are left out of `publicState().workspaces`, `selectContentWorkspace` refuses them (409 `singleWorkspace` for anything
but Main), the scheduler skips their programs, and unowned datasets fall back to Main instead of `general`.
`publicState().workspacePolicy` tells the renderer (`{ mode: 'single', name, editionId, archived: [{ id, name, programs,
runs, assets }] }` or `{ mode: 'multi' }`), which hides the switcher, New › Workspace and the workspace name field.
Multi mode reverses it.

## AI connections and model routing

```
src/shared/ai-providers.json   connections (claude, claude-api, codex, openai, openrouter, fal; pseudo auto), model id patterns
src/shared/ai-models.json      curated models and list prices (Claude incl. Haiku 5.5 tiers, GPT Image, fal fallbacks)
src/shared/ai-tasks.json       every AI task: group, kind (text|image|video), defaults, inherit chain, program stage, presets
src/main/ai-catalog.js         model lists and prices: the curated file, Codex models_cache.json, OpenRouter /models (6 h),
                               fal /v1/models + OpenAPI + /v1/models/pricing (24 h); cache in <data>/ai-catalog/
src/main/ai-routing.js         resolve(taskId, { run, program }): run snapshot → program override → Settings → Model routing
                               → inherit chain → kind defaults; validate, presets, preview (typical cost, warnings)
src/main/ai-connections.js     status (claude auth status --json, codex login status, keys), require(route), free tests, preflight
generateStructuredOutput ──► text-router.js ──► cli-runners.js (Claude Code, Codex) | anthropic-runner.js |
                                                openrouter-runner.js | openai-text-runner.js
                             onStream: { type: 'status' } and { type: 'text', delta } (structured-stream.js)
mediaRouter.generateImage / generateVideo ──► image-provider.js (GPT Image) | fal-provider.js (queue: submit, poll, download)
```

Runs snapshot what they resolved (`run.ai.routing`), so a retry keeps its provider and price. Every picture request
lists the brand reference images it sends (`deliverable.references`, an empty list when its set has none);
`test/brand-references.test.js` fails when a new picture path doesn't. The short social video is a kit deliverable
(`social-video`): a plan written once (`video.brief`), an optional first frame (`video.keyframe`) and one fal request,
checkpointed before it is sent and resumed by its request id after an interruption, saved as `<asset>.mp4` with
`<asset>.srt` and `<asset>.poster.png`.

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
| Deliver (optional) | `bridge-delivery.js`, `google-delivery.js`; Monday.com two-way sync `monday-engine.js` (cards from `monday-cards.js`, GraphQL in `monday-sync.js`) | Drive receipts, `content-studio/monday.json` |

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

## Report editor and notes

```
editor (renderer, Tiptap + Yjs) ──openReportDoc──► report-docs.js open: Markdown, yState ('' until a browser seeds it),
                                                    versions, editors; registers the browser (presence)
        ──pushReportDocUpdate { update, markdown, clientId, final?, epoch?, stateVector?, awareness? } (~1.5 s, on close)
            → strict base64, 2 MB per change, 8 MB per document → Y.applyUpdate on the server's Y.Doc
            → content-workspace writeReportMarkdown (the .edited.md/.html every kit, export, Drive and Ask AI read;
              state.json saved on the first edit, every minute and on close) unless stateVector shows the browser
              hasn't seen everyone's changes yet (markdownSaved: false)
            → a version per editor at most every 5 minutes, on close, or when a quiet browser times out
            → pushPersonEvent to everyone else with it open: { type: 'doc-update' } (and doc-presence for carets)
        ──restoreReportVersion / editStudioAsset / restoreStudioAsset (hooks.onAssetEdited)
            → keep what's there as a version, write the Markdown, start the document over (epoch + 1, the browsers that
              wrote before are retired: their pushes get 409 docReset), { type: 'doc-update', reset: true } to all
notes ──listReportNotes / saveReportNote / resolveReportNote / deleteReportNote──► report-notes.js
            → Inbox items for mentions and replies → { type: 'note-changed' } to people with the report open and the
              people notified → emitState: contentStudio.noteCounts (base) + noteMentions (per person, access.project)
```

**Live events** (`pushPersonEvent` beside `pushAskEvent` in `index.js`): the Mac sends `person:event` over IPC (preload
`onPersonEvent`); the web uses web-runtime `sendTo(…, 'person')`, which `studio-server.js` writes as `event: person`
to that person's streams at once (web-api `onPersonEvent`, which also hears `{ type: 'resync' }` after a drop).
**Presence** is in memory: a browser leaves on `closeReportDoc` (without a clientId, all of that person's), after 2
minutes without a change once they have no live-update stream (`runtime.provided('liveStreams')`), or after 30 minutes
without a change. Carets are y-protocols awareness updates the server relays without reading. **Seeding**: two browsers
opening a report with no Yjs state build identical seeds (a client id derived from the Markdown), so they merge as one.
**Roles**: Read reports and assets opens and reads notes, Edit reports edits, Leave notes on reports (`commentReports`)
notes; channel owners are scoped like `readStudioAsset` and never edit ([docs/roles-and-access.md](docs/roles-and-access.md#capabilities)).

**The renderer** (`src/renderer/src/report-editor/`, Tiptap 3 on the Yjs document; the server never sees ProseMirror):

| File | Role |
| --- | --- |
| `ReportDocument.jsx` | The page: opens a visit (`openReportDoc` with a new `clientId`, which is also the Y.Doc's client id), builds the editor (StarterKit without undo/underline/trailing node, tables, Collaboration, CollaborationCaret on the web, note highlights), the bar (presence, save state, Notes, History), the selection and "/" menus, the notes panel. A reset event, a 409 `docReset` or an epoch change reopens under a new `clientId` and closes the old one; `markdownSaved: false` and `resync` read the whole state again (`openReportDoc`) and merge it. |
| `sync.js` | Autosave: Yjs diff since the studio's last state vector, the Markdown, `epoch`, `stateVector`, `awareness`; 1.5 s debounce, 5 s retry, `final` on close; `sendCaret()` for caret-only pushes. `mode: 'plain'` saves through `editStudioAsset` (older studios). |
| `markdown.js` | `@tiptap/markdown` over the same extensions: `markdownToJSON`, `jsonToMarkdown` (blank lines tidied outside code). `CONVERTER_VERSION` is part of the seed id: bump it when the conversion changes. |
| `ydoc.js` | Seeding (`seedClientId(markdown)`), base64, anchors (`anchorFromSelection`, `resolveAnchor`: relative positions, then the quote, else "text was changed"). |
| `events.js` | `subscribePersonEvents` (`api.onPersonEvent`, else `onAskStream`), `requestNoteFocus` / `takeNoteFocus` (App's and Simple's `openTarget` call it for a note's Inbox row). |
| `NotesPanel.jsx`, `HistoryMenu.jsx`, `NoteCount.jsx` | Threads and the @mention picker; versions, preview, restore; the open-note count on report rows. |

Readers use the page inline when `liveDocsOn(api, viewer)` (the report-doc methods are there); otherwise they keep the
Markdown reader and **Edit** opens `AssetEditor`, which hosts the same page in plain mode.

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
- **Schedulers**: research schedules (30 s tick in `content-workspace.js`) and the workflow engine
  (`workflow-engine.js`: a 30 s tick plus a 500 ms debounced `poke()` from every studio `emit`), both only while the
  process runs. The engine starts due schedule-trigger workflows (missed occurrences are never made up; a busy program
  or a draining server records a skipped run), then advances every live run one step at a time. A program run a person
  starts reaches `hooks.onResearchRunStarted`, which starts "whenever this program runs" workflows attached to it.
  Children are started through `runAs(actor)` (an `AsyncLocalStorage` in index.js), so content-workspace's `who()`
  credits `workflow:<id>`; `createAssetKit` accepts a `workflow` link only under that actor. The web drain and quit
  call `stop()`.
- **Monday.com** (`monday-engine.js`): one serialized queue for every Monday call (a repeat of a queued run joins it).
  A 60 s tick sends hourly or daily pushes, polls, runs a full check every 6 hours and checks webhooks daily; `emitState`
  calls `noteChange()` so 'As changes happen' sends 15 s after the first change. Sync now is a `monday` job with its
  AbortController in `apiRequests` (Cancel stops it after the current chunk); an automatic run shows in
  `activeWorkSummary()` through `activeLine()`. On the web `studio-server.js` takes `POST /hooks/monday/<64-hex secret>`
  before the same-origin check and sign-in and dispatches to `runtime.provided('mondayHook')`; the engine only queues a
  re-read (3 s debounce). The client retries rate, concurrency, server and network failures only for idempotent
  requests, waits for Monday's complexity reset, and pauses the link on token, permission, daily-limit or missing-board
  errors. A link saved on a workspace a one-workspace build hides (`isWorkspaceHidden`) is never scheduled or run.

## Legacy Data tools

The Advanced **Data tools** group (capability `dataTools`) predates the studio: Search platforms, Scrapers (recipes,
`src/shared/recipe.js`), Import research, Datasets, Dataset reports, Compare snapshots, Ask your datasets
(`findings-chat.js`) and Brief starters (formerly Playbooks, `marketing-templates.js`). It stores in `data.json` and
`datasets/`. The v5 missions, intent planner and action graphs were removed when Workflows (Advanced › Automate) were
rebuilt on research programs; `v5-core.js` keeps the event helpers, recipe versions and dataset evidence. Research programs don't feed it (their posts open in
Sheets and Ask AI searches them).

## Extension points

| To add | Read |
| --- | --- |
| An RPC method, capability, prompt, Ask AI action, card type, Show me target, channel, environment variable | [CONTRIBUTING.md](CONTRIBUTING.md) |
| A Settings section | `src/renderer/src/settings-sections.js` (id, group, label, `when`, status rule) plus a renderer with the same id in `settings-view.jsx`; the nav, dots and `#/settings/<section>` links follow. |
| A role | People & access › Roles (no code). A new built-in base touches `roles.json` `roles`, `roles.js` `effectiveRole`/`pagesFor`/`projectState` and `viewer.js` `ROLE_LABELS`. |
| A deploy target | [docs/web-deploy.md](docs/web-deploy.md), [deploy/README.md](deploy/README.md) |
