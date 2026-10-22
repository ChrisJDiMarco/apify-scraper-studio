# Roles and access

The developer handoff for people, roles and sign-in in Golden Thread: the Mac app and the browser studio. The app
guide (`docs/app-guide.md`, which Ask AI reads) describes the same features for the people using them;
`docs/web-deploy.md` covers running the server. The manual acceptance checklist is
`docs/verification/roles-acceptance.md`.

## Roles and capabilities

Access is a capability model. Every method belongs to exactly one **capability** (`roles.json` `capabilities`), a
capability is granted per role, and each person can be adjusted on top with their own grants and denies (deny wins).

| Built-in role | id | Who | What they get by default |
| --- | --- | --- | --- |
| Admin | `admin` | The studio's owners | Every capability, always. Can't be adjusted, and there is no second admin type. |
| Editor | `editor` | The content and research leads | Finds trends, writes and edits reports, makes assets for any channel, uses Ask AI, sees and edits AI prompts, sees costs. No Settings, Brand knowledge, People & access, Analytics, research programs or schedules. |
| Channel owner | `channel` | One owner per channel (several may share one) | Sees new trends and their own channel's assets, says which trends they used and where, and uses Ask AI scoped to their channel. Never sees money, models or other channels. |

**Custom roles** (People & access › Roles › New role) are built on a **base**, Editor or Channel owner, which never
changes. A channel-based role gets the channel owner's shell, scopes and projection and can only ever call
`channelSafeMethods`. Templates: Viewer (reads reports, trends and evidence, and Ask AI; no costs), Analyst (quick
scans, Ask AI, Sheets and data tools, with costs) and Channel reviewer (reads and marks trends used, and Ask AI), plus
the current Editor and Channel owner. A studio has up to 12 custom roles.

**Ask AI for every role.** `askAi` (Use Ask AI) is on by default for Admin, Editor, Channel owner and every template,
and an admin can switch it off or on for any other role (Roles tab) or person (Access tab). It is one capability with
the same 15 methods for every base, made role-aware rather than split in two:

- `requiresByBase: { channel: ['readAssets'] }` replaces `requires` (`readAssets, readResearch`) on a channel base, so
  holding it never brings See research and evidence (or anything else studio-wide) to a channel role. Its methods are
  in `channelSafeMethods`, each with a channel scope in `access.js` (`ASK_SCOPES`) that rebuilds the payload, and every
  result goes through `stripMoney` (`RESULTS`).
- `costsOptional: true`: it spends but doesn't need See costs on an editor base. Each answer is small and capped
  (`ai-limits.js` still applies, and spend is recorded as usual). A role without See costs gets no cost line under the
  composer ("Saved for you only. AI can be mistaken.") and a LIVE CONTEXT and lookups with money stripped.
- A channel asker's answer is built only from their projected state (`access.project`, exactly what their `state` call
  returns): `src/main/ask-channel.js` turns `contentStudio.channelView` and their `noteMentions` into the LIVE CONTEXT,
  the lookups (a trend's brief, their drafts, find, their own conversations and memory), the button resolver, the
  cards and the [[Trend]] links. File text is read only for files that view lists (`helpChannelFiles`). The prompt is
  its own (`help-assistant.js` `channelPromptParts`), with the guide's channel owner sections only (`channelGuide`).
  Prompts, settings, people, analytics, research runs, posts, other channels and money never reach it.
- Its buttons are the `ask-actions.json` kinds whose `layouts` include `channel` (Generate for my channel, Yes, I'm
  using this trend / Not for us, Stop and Finish the rest on a set made for their channel only, Save folder, open a
  trend, drafts, plan or inbox), offered only when the role holds every method, run by `channel-ask.jsx` through the
  same API and gate as the channel screens' buttons. Asset status isn't one: channel roles can't set it.
- Conversations and memory made from a channel role carry that `channelId` in `ask-store.js`, and a channel asker reads
  and writes only those (`askSpace` in `index.js`). Live progress (`ask-progress.js`) keeps the same space: a channel
  asker's `readAskProgress` returns only answers asked from their channel, and a repeated request id from another space
  isn't joined. Pictures need Make channel assets; each picture keeps its `ownerId`, and a channel owner lists and opens
  only their own.
- No model or connection names either: a channel asker's progress step reads "Writing the answer" instead of the
  route's "Writing with <model> · <connection>", and a new picture's result drops `model` and `provider` (`RESULTS`).
- A preview (View as) reads the previewed role's Ask AI page but never asks: `askHelp` isn't a read method, so the gate
  refuses it with the preview copy and the composer is off with "Buttons that change things are off in a preview." (the
  established preview rule, kept as it is for Ask AI everywhere).

Someone signed in who isn't in People (or is disabled, or whose role no longer exists) has role `null` and sees only
the No access screen.

**How a person's capabilities are worked out** (`roles.js` `capabilitiesFor`):
1. Unknown role: nothing. Admin: every capability.
2. Built-in Editor or Channel owner: its defaults, plus the team's `rolePolicy.builtIn[base].grant`, minus its `deny`.
   A custom role: its own list.
3. Plus the person's `grants`, minus their `denies` (deny wins).
4. Only capabilities the base may hold survive (`bases`), and never a `lock: 'admin'` one, so a hand-edited team.json
   can't grant Settings or People & access.
5. `core` (lock `always`) is added.
6. A capability whose requirements are missing is removed, repeatedly: its `requires` (or `requiresByBase[base]`),
   plus See costs for paid work (`spends`) on an editor base, because paid work shows its estimate first, unless it is
   `costsOptional` (Ask AI). A channel base never needs costs.

The methods are the union of the capabilities' methods (a channel base: intersected with `channelSafeMethods`). With
no policy edits this is exactly the old fixed matrix plus Ask AI for channel owners: admin 188 methods, editor 117, channel owner 34
(`test/roles.test.js` and `test/docs-consistency.test.js` check these numbers).

Channels are the ten asset-kit folders in `src/shared/kit-folders.json` `folders` (main reads them through
`asset-kit.js` `KIT_FOLDERS`, a frozen copy; the renderer and `library-tree.js` import the JSON directly): `blog, newsletter, paidmedia, pr,
social, affiliate, enterprise, backlinko, explodingtopics, searchengineland`. Display names come from the active
workspace's edition (`kitFolders(editionId)` returns `{ id, name, short, deliverableIds }`); members store only the id.
A file's channel is `kitFolderFor(asset.deliverableId, editionId).id`, and a kit run's channels are derived from its job
ids (`kitChannelIds`), never stored.

## Architecture

```
 browser / Mac window
        │  RPC (web: POST /api/rpc · Mac: ipcRenderer.invoke)
        ▼
 studio-server.js (web only)              ┌───────────────────────────── main process (src/main/index.js) ─┐
  identify(req) → identity + session ───► │ gated(channel, fn)   (one synchronous wrapper per ipcMain.handle) │
  /api/login: password · sign-in link     │   viewer = access.viewerFor(identity, session)                  │
  /api/events: per-viewer projection      │   payload = access.check(method, payload, viewer)  → 403 / scoped│
                                          │   result  = handler(event, payload)                              │
                                          │   access.after(method, result, viewer)  → activity log, channel  │
                                          │                                            result projection     │
                                          │   errors  → access.rewriteError(error, viewer)                   │
                                          │ emitState(): base = publicState() once                           │
                                          │   Mac: send access.project(base, desktopViewer)                  │
                                          │   web: broadcast base → each stream renders people.view(base, …) │
                                          └──────────────────────────────────────────────────────────────────┘
```

| File | What it holds |
| --- | --- |
| `src/shared/roles.json` | Policy data: roles, `capabilities` (and their groups), `channelSafeMethods`, `identityMethods`, `readMethods`, `pages`, `pageGroups`, `channelPages`, `navOrder`, `roleTemplates`, copy. |
| `src/main/roles.js` | Pure policy logic: `compilePolicy`, `capabilitiesFor`, `methodsFor`, `canCallAs`, `refusalFor`, `effectiveRole`, `pagesFor`, `buildViewer`, `projectState` (with `stripMoney`), `validateCapabilities`, `format`; `canCall`/`allowedMethods`/`navFor` for the built-in defaults. Main process only. |
| `src/main/access.js` | The gate: `check` (deny by default, preview read-only, scopes by base), `after` (activity and access logs, result projections, money stripped), `rewriteError`, `project` (memoised per state object and viewer), plus `canUpload`, `effectiveFor`, `viewKeyFor` for the browser server. |
| `src/main/team-store.js` | `content-studio/team.json`: members (with their own grants and denies), custom roles, the role policy (with `rev`), sign-in links, adoptions, activity, the access log, prefs. Synchronous, atomic writes. |
| `src/main/access-log.js` | Access-log rows as sentences ("Alex turned off Edit AI prompts for Editor"). |
| `src/main/channel-view.js` | What a channel owner sees: `readyTrends`, `publicKitRun`, `buildChannelView`, `kitChannelIds`. |
| `src/main/team-analytics.js` | `buildTrendAnalytics` for the Analytics page. |
| `src/main/markdown-html.js` | Safe Markdown → HTML for edited reports. |
| `src/main/web-secrets.js` | Reads `STUDIO_SECRET_KEY`, `STUDIO_PASSWORD` and `STUDIO_PROXY_SECRET` from `STUDIO_SECRETS_FD` or `STUDIO_SECRETS_FILE` (environment values still work, with a warning). |
| `src/renderer/src/viewer.js` | `ViewerContext`, `can`, `canRun`, `hasCapability`, `isChannelBase`, `writeProps`, `roleLabel`, `previewWho`. The renderer never imports CommonJS policy. |
| `src/renderer/src/studio-sidebar.jsx` | The one left sidebar for every layout: workspace, View as, Simple/Advanced, navs, drawer under 860px. |
| `src/renderer/src/channel-owner.jsx` | Channel owner screens: Trends and My assets. |
| `src/renderer/src/people-view.jsx` | People & access: the People, Roles and Access log tabs, Preview as. |
| `people-table.jsx`, `person-sheet.jsx`, `invite-dialog.jsx`, `roles-matrix.jsx` (+ `.css`), `access-log.jsx` | The people table and channel coverage; one person's sheet (Details, Access, Sign-in, Activity) and the shared capability rules; Invite people; the role matrix; the access log. |
| `src/renderer/src/analytics-view.jsx`, `asset-editor.jsx`, `role-screens.jsx` | Analytics, the report editor, NoAccess / PreviewBanner / dialogs / the "…" menu. |

**The gate stays synchronous.** `gated()` never awaits before calling the handler, so synchronous handlers (`app-meta`,
`state`, `save-key`, `clear-key`, `save-recipe`) still return plain values (`core.test.js`,
`packaged-continuity.test.js`).

**Steps of `check(method, payload, viewer)`**:
1. On the web, a call with no signed-in person gets 403 (fail closed).
2. The person checked is the real one for identity methods (`appMeta`, `state`, `setViewAs`, `setViewPrefs`), else who the session looks like (a preview).
3. In a preview, anything but identity and read methods gets 403 `copy.preview`.
4. The method must be in `viewer.allowed` (built from the compiled policy), else 403 with `refusalFor`: `copy.adminOnly` for a locked capability or a method no capability lists, `copy.forbidden` for one the base can never hold, otherwise `copy.capabilityOff` naming the capability and the admins to ask. An admin may call anything.
5. For a channel base, the method's scope rebuilds the payload from an allowlist (below). Scopes are keyed by base, so a custom channel role gets them too.

Denials are logged with `teamStore.logEvent({ event: 'denied', identityId, role, method, reason })`.

**Channel owner scopes** (the payload is rebuilt, so nothing else rides along):

| Method | Rebuilt payload | Rule |
| --- | --- | --- |
| `planAssetKit`, `createAssetKit` | `{ source: { kind: 'report', assetId }, deliverableIds }` (+ `onlyIfIdle: true` on create) | The asset must be a trend brief in the active workspace; deliverables are the channel's, minus pictures when pictures are off; no budget (the server uses the estimate cap). |
| `readStudioAsset`, `openStudioAsset` | `{ assetId }` | Their channel's kit file or a trend brief. |
| `saveAssetKitFolder` | `{ runId }` | A kit run that includes their channel; the export is filtered to their channel. |
| `cancelStudioRun`, `retryStudioRun` | `{ runId }` (+ server cap on retry) | Only a set made for their channel alone, else `copy.sharedSet`. Retry cap: `min(1000, max(maxBudgetUsd, ceil(reservedUsd + 2 × unfinished)))`. |
| `setTrendAdoption` | `{ themeId, channelId: viewer.channelId, status, link?, note?, plannedFor? }` | Their own channel only. |
| `setViewPrefs` | `uiMode` forced to `simple`; `welcomedAt`, `inboxSeenAt`, `navRail` pass; `focusChannels` is dropped | |

Editors' `saveResearchReview` is signed with the editor's name on the web. Results that return a kit run become
`publicKitRun`; `planAssetKit` and `readStudioAsset` results lose dollar fields, models, receipts and evidence. For an
editor-based role without See costs, every result (not only state) goes through `stripMoney`.

**Logs.** Handlers that change people report `activity` (the analytics log, as before) and `audit` (rows for the
access log); `after()` writes both and removes them from the result. Audited: `saveMember`, `removeMember`,
`createSignInLink`, `revokeSignInLink` (as `link-revoked`), `saveRolePolicy`, `saveRole`, `deleteRole`,
`saveMemberAccess`, `inviteMembers`. Refused calls still go only to stdout (`denied` events).

**Error rewriting.** For editors and channel owners, errors that send people to Settings, keys or connections, or that
come from a provider (Claude, Anthropic, Codex, OpenAI, Apify: model ids, credit, billing, API errors), become one plain
line naming the admins: pictures → `askPictures`, Google Drive → `askDrive`, everything else → `askConnection`. A channel
owner's budget errors become `askBudget`. Refusals already written for people (a copy key in `code`, or one of the
app's own prompt and memory codes: `promptConflict`, `promptLocked`, `promptNote`, `promptInvalid`, `promptEmpty`,
`promptUnknown`, `promptTestChanged`, `promptTestRunning`, `askMemorySecret`) pass through.

**State projection.** `projectState(base, viewer, extras)` builds a new object with `viewer` and `team: { admins }`:
admin and editor bases get the state plus `contentStudio.adoptionsByTheme` (each answer with `plannedFor`). An admin
gets all of it. An editor-based role loses what a read capability it lacks covers: without See research and evidence,
`researchRuns` are cut to names, dates, counts and report links (themes to `{ id, name }`), `themes` to
`{ id, workspaceId, name, status }`, research reviews are empty and `v5.evidence`/`v5.evidenceSummary` are empty;
without data tools, `recipes`, `runs`, `datasets`, `analyses`, `conversations`, `monitors`, `comparisons`,
`intentRuns`, `cards`, `assets`, `apifyCatalog`, `intelligence` and every list in `v5` are empty, and so is
`contentStudio.availableDatasets` unless the role can manage research programs. An editor-based role without See costs
then gets it through `stripMoney` (every `*Usd` key, `receipts`, `receipt`, `estimate`, `budgets` and `imageCalls`,
wherever they appear, and any `message`, `warnings`, `error` or `lastError` text quoting a dollar amount becomes one
line without it); a channel base gets only `viewer`, `team`,
`settings: { uiMode: 'simple' }`, `keys: {}` and `contentStudio: { activeWorkspaceId, workspaces: [active],
capabilities: { imagesConfigured }, channelView }`; role `null` gets nothing but the viewer and admins. The Mac pushes
the projected state on every `state-changed`, so View as survives pushes. On the web each `/api/events` stream writes
`people.view(base, identity, session)`, memoised per state object and view key, and closes when its person signs out,
loses access or has their link replaced.

**The viewer** (`state.viewer`):
- who: `id, name, email, via, web, disabled, memberSince, channelId, channelName`;
- role: `role` and `base` (the effective base: `admin | editor | channel | null`, so every "is this a channel owner"
  check holds for custom roles), `roleId` (`editor` or `role-…`), `roleLabel`, `roleDescription`, `realRole` /
  `realBase` (the real base) and `realRoleId`;
- access: `capabilities` (sorted capability ids), `allowed` (methods), `nav: { main, admin, bottom }`, `hiddenPages`,
  `modes`, all derived from the capabilities (`pagesFor`);
- prefs: `uiMode, welcomedAt, inboxSeenAt, focusChannels, navRail` (`navRail: null` follows the window width);
- preview: `preview`, `viewAs` (`{ role, channelId }` or `{ memberId, role, channelId }`), and only in a preview
  `roleAllowed` (the previewed methods), `roleCapabilities` (the role before the person's own changes), `previewName`
  (the person's name, or '') and `previewChanges` (how many capabilities their own changes add or remove);
- `askAdmin`; real admins also get `channels` and `roles: [{ id, label, base }]` for View as.

Nav: `navOrder.full` (`main: home, trends, reports, assets, inbox, calendar, ask`; `admin: prompts, analytics,
people`; `bottom: settings`) filtered by `pages` (each page's capability); a channel base uses `navOrder.channel`
(`trends, assets, plan, inbox`) filtered by `channelPages`. `hiddenPages` lists, in `pages` order, the pages whose
capability is missing, then `data-tools` when Use data tools is (the `pageGroups` entry, so Simple Reports and the
Advanced Dataset reports page don't collide); a default editor still gets exactly `settings, knowledge, analytics,
people`. The sidebar's group for prompts, analytics, people and settings is labelled **Studio**. In the Simple layout,
Brand knowledge is its own page in the Studio group (Advanced keeps it under Content), shown to anyone without
`knowledge` in `hiddenPages` (the renderer's `nav-model.js`). The renderer shows a
control when `can(viewer, method)` (`roleAllowed || allowed`) and runs it only when
`canRun(viewer, method)` (`allowed`); write buttons spread `writeProps(viewer)` so a preview shows them turned off with
the title "Buttons that change things are off in a preview." An admin previewing an editor therefore sees the editor's
screens as the editor does.

## Capabilities

`capabilities` in `src/shared/roles.json` is the source of truth; `test/roles.test.js` checks every method in
`studio-api-channels.json` sits in exactly one. Defaults: A = Admin, E = Editor, C = Channel owner. Bases: which kinds
of role may ever hold it. “Spends” marks paid work (it needs See costs on an editor base, except Ask AI, which is
`costsOptional`).

| Group | Capability | Defaults | Bases | Requires | Methods |
| --- | --- | --- | --- | --- | --- |
| Everyone | `core` Open the studio (lock `always`) | A E C | editor, channel | | `appMeta, state, contentCatalog, openSourceUrl, setViewPrefs` |
| Research | `readResearch` See research and evidence | A E | editor | | `readStudioRun, readTrendHistory, readTrendPosts, readResearchReview, searchEvidence, readEvidence, readReferenceDoc, readMondayItem` |
| | `startResearch` Start research (spends) | A E | editor | readResearch | `startResearchRun, continueResearchRun, estimateResearchProgram` |
| | `quickScans` Run quick scans (spends) | A E | editor | readResearch | `estimateQuickScan, startQuickScan` |
| | `approveTrends` Approve trends | A E | editor | readResearch | `approveResearchThemes, decideResearchTheme, setThemeStatus` |
| Reports and channel assets | `readAssets` Read reports and assets (and their notes) | A E C | editor, channel | | `readStudioAsset, openStudioAsset, openReportDoc, closeReportDoc, listReportNotes` |
| | `writeReports` Write reports (spends) | A E | editor | readResearch, readAssets | `createContentRun, importStudioSource` |
| | `editReports` Edit reports | A E | editor | readAssets | `editStudioAsset, restoreStudioAsset, saveResearchReview, setAssetStatus, pushReportDocUpdate, restoreReportVersion` |
| | `commentReports` Leave notes on reports (since policy 3) | A E C | editor, channel | readAssets | `saveReportNote, resolveReportNote, deleteReportNote` |
| | `makeAssets` Make channel assets (spends) | A E C | editor, channel | readAssets | `planAssetKit, createAssetKit, saveAssetKitFolder` |
| | `manageRuns` Stop and retry work (spends) | A E C | editor, channel | | `cancelStudioRun, retryStudioRun, cancelJob` |
| | `markTrendsUsed` Mark trends used | A C | editor, channel | readAssets | `setTrendAdoption` |
| Automation | `readWorkflows` See workflows and playbooks (since policy 2) | A E | editor | readResearch | `estimateWorkflow, readWorkflowRun, previewPlaybook` |
| | `manageWorkflows` Build and run workflows (spends, since policy 2) | A E | editor | readWorkflows, startResearch, quickScans, approveTrends, writeReports, makeAssets, manageRuns, seeCosts | `saveWorkflow, setWorkflowStatus, deleteWorkflow, runWorkflow, cancelWorkflowRun, retryWorkflowRun` |
| AI and prompts | `askAi` Use Ask AI (spends, `costsOptional`) | A E C | editor, channel | readAssets, readResearch; on a channel base readAssets only (`requiresByBase`) | `askHelp`, the conversation and memory methods, `createHelpImage, saveHelpImage, listHelpImages, readHelpImage` (all channel-scoped for a channel base; pictures there also need Make channel assets) |
| | `viewPrompts` See AI prompts | A E | editor | | `listPrompts, readPrompt, previewPrompt, diffPromptVersions, estimatePromptTest` |
| | `editPrompts` Edit AI prompts (spends) | A E | editor | viewPrompts | `savePromptVersion, revertPrompt, testPrompt` |
| Data and exports | `sheets` Use Sheets | A E | editor | | workbooks, including `exportWorkbookXlsx, exportWorkbookToGoogle` |
| | `dataTools` Use data tools (spends) | A E | editor | manageRuns | imports, datasets, dataset reports, scrapers, brief starters, brand profiles, `exportDatasetToSheets` |
| | `deleteScrapers` Delete scrapers | A | editor | dataTools | `deleteRecipe` |
| | `exportPublish` Export and publish | A E | editor | readAssets, readResearch | `publishStudioRun, saveReportToDrive, exportStudioRun, exportResearchReview, syncTrendBoardToMonday, readMondaySyncLog` |
| Studio setup | `seeCosts` See costs and budgets (projection `money`) | A E | editor | | none |
| | `managePrograms` Manage research programs | A | editor | readResearch, seeCosts | `listAiModels, saveResearchProgram`; workflow budgets and playbooks: `approveWorkflowBudget, applyPlaybook, savePlaybook, deletePlaybook` |
| | `editBrand` Edit brand knowledge (Advanced: Content › Brand knowledge; Simple: Studio › Brand knowledge) | A | editor | | taxonomy, reference docs, brand images, product registry, `deleteBrandProfile` |
| | `manageWorkspaces` Switch workspaces | A | editor | | `selectContentWorkspace, saveContentWorkspace` |
| | `seeAnalytics` See team analytics | A | editor | | `getTrendAnalytics` |
| Admin only (locked) | `settings` Settings and connections | A | none | | keys, settings, AI and connection checks, Monday.com setup (`connectMonday`, `saveMondayLink`, `disconnectMonday` …), the Google Drive folder sync (`connectDriveSync`, `saveDriveSync`, `startDriveBackfill`, `readDriveSyncLog` …), data folders, setup files, sheet maintenance, `setPromptLock` |
| | `manageAccess` People and access | A | none | | `getTeam, saveMember, removeMember, createSignInLink, revokeSignInLink, setViewAs, saveRolePolicy, saveRole, deleteRole, saveMemberAccess, inviteMembers, readAccessLog, previewAccess` |

`channelSafeMethods` = the core methods plus every method with a channel scope in `access.js` (`SCOPE_METHODS.channel`):
a channel-based role reaches nothing else, whatever it is granted. That keeps `cancelJob` (in Stop and retry work)
and every workflow method away from channel owners, who never see workflows or their money. A composite method's capability is the same as, or requires, the
capability of everything it runs (or is locked admin). Role `null` may call `appMeta` and `state` only.

While previewing, only identity methods and `readMethods` run. Channel owners get the Simple layout only.

**The report editor and notes** (`report-docs.js`, `report-notes.js`). Opening a report, closing it and reading its
notes need Read reports and assets (`readMethods`, so they work in a preview); editing and restoring versions need Edit
reports; adding, replying to, resolving and deleting notes need Leave notes on reports. A channel owner's
`openReportDoc`, `closeReportDoc`, `listReportNotes`, `saveReportNote`, `resolveReportNote` and `deleteReportNote` are
scoped like `readStudioAsset` (their own channel's kit files and the trend briefs; anything else is `outOfScope`), and
they never edit: `pushReportDocUpdate` and `restoreReportVersion` aren't channel-safe. People change or delete only their
own notes (403 `notYourNote`); admins may delete anyone's. Mentions are kept only for members who can read the report
(on the Mac, none). The state carries `contentStudio.noteCounts` and each person's own `noteMentions` (their Inbox rows), a channel owner's
cut to the same files; a role without Read reports and assets gets neither.

**What the page shows each role** (`report-editor/ReportDocument.jsx`; the server decides, the page only hides). The
text is editable when the role holds `pushReportDocUpdate` and `openReportDoc` says `canEdit` (never in a preview, a
detached report or a channel owner's brief); otherwise it is the same page read-only. The Notes button and highlights
need `listReportNotes`; **Add note**, Reply, Resolve and the note menus need `saveReportNote` and `canNote`; a note's
Edit is offered only on your own, Delete on your own or, for admins, anyone's. History's restore needs
`restoreReportVersion`. @mentions are on the web only and list `listReportNotes`' `mentionable`. The channel owner reads
the brief in this page (read-only, with notes); their asset files keep the plain reader.

**Workflows act as their owner.** A workflow's runs call the studio's pipelines directly (the engine, not the gate), so
before every step `access.canIdentityCall(ownerId, method)` checks the owner may still call each of that step's methods
(`workflow-steps.json` lists them); 'local' (the Mac) and 'owner' (the web admin password) are admins. A refusal pauses
the workflow with `needsAdmin`, and an approver can **Take over** (`approveWorkflowBudget` with `takeOver`). Children
are credited to `{ id: 'workflow:<id>', name }`; analytics mark those decisions `automatic`, and the engine writes its
own `workflow-run` / `workflow-changed` activity rows. Without `readWorkflows` the state's `workflows`, `workflowRuns`,
`playbooks` and `workflowSummary` are empty; without `seeCosts` their `*Usd` fields and budgets are stripped.

## Identity and sign-in

`identity = { id, name, email, role, roleId, channelId, via, disabled, memberSince }`, `via` ∈ `desktop | password | proxy | google | link`.
`role` is the role's base (`admin | editor | channel | null`) and `roleId` the role itself (a custom role's id), so
studio-server's checks keep working; `teamStore.identityFor` fills both, and an identity without `roleId` uses `role`.

- **Mac app**: always `{ id: 'local', role: 'admin', via: 'desktop' }`. View as lives in process memory and clears on quit.
- **Admin password** (web, `STUDIO_PASSWORD`): break-glass admin, `{ id: 'owner', name: 'Studio admin' }`. Sessions last 12 hours; each browser session keeps its own View as.
- **Company sign-in** (`STUDIO_TRUSTED_EMAIL_HEADER` + `STUDIO_ALLOWED_EMAIL_DOMAINS`): the member is found by email, case-insensitive. `STUDIO_ADMIN_EMAILS` is authoritative: a listed email is always an enabled admin (created or re-promoted at sign-in), shown as "Set by the server", and can't be changed in People. Unknown emails get role `null`. No sign-in links and no Sign out button: the proxy owns the session.
- **Google sign-in** (password mode, `STUDIO_GOOGLE_CLIENT_ID` + `STUDIO_GOOGLE_CLIENT_SECRET`): `GET /api/auth/google/start` → Google (code flow, PKCE S256, `state` in a Lax cookie scoped to `/api/auth/google`, a nonce) → `/api/auth/google/callback`, which exchanges the code over TLS, checks issuer, audience, expiry, nonce and `email_verified`, optionally the domain (`STUDIO_GOOGLE_ALLOWED_DOMAINS`), and signs in the enabled member with that email (`teamStore.signInByEmail`; `STUDIO_ADMIN_EMAILS` are made admins as with company sign-in). Anyone else goes back to `/#signin-error=<code>`.
- **One-time sign-in link** (password mode): `<origin>/#signin=<64 hex>`, one per member (`member.link`, `purpose` `invite` or `email`). The page reads the fragment and removes it from the address bar first, then posts `/api/login/link { linkToken }`, which answers whose link it is (name, masked email) and who the browser is signed in as now, without using it. Only when the person confirms does it post `/api/login { linkToken }`, which uses the link up (`teamStore.useLinkToken` clears `member.link`). The server compares SHA-256 hashes timing-safely against every member and refuses expired links and disabled members. Invite links last `STUDIO_LINK_DAYS` (default 7, at most 30; links from before one-time links get one more use within 30 days of being made); **Email me a sign-in link** (`POST /api/login/email`, rate-limited, the same answer for any address) sends one that lasts 20 minutes. With email on, `team:sign-in-link` emails the link and returns `{ emailed, to }`, never the URL.
- **Member sessions** (Google or a link): `{ kind: 'member', memberId, epoch, via }`, 30 days from last use (renewed on `/api/session` at most daily), at most 10 per member. `epoch` is the member's `sessionEpoch` when the session began; disabling them or **Sign out everywhere** (`team:revoke-link`, which also clears an unused link) bumps it and ends every session. Sessions are kept by the SHA-256 of their cookie in `<data>/web-sessions.json` (0600, durable writes), so restarts and deploys sign nobody out.
- **Effective role**: View as only lowers a real admin's role: any non-admin role (`{ role }`, a channel-based one with a
  `channelId`) or one person (`{ memberId }`, with their own grants and denies, read fresh on every call). `admin`
  clears it. A demoted admin's old View as is ignored.

**Sign-in limits.** Admin-password tries are limited to ten a minute per client address; with `STUDIO_TRUST_PROXY=1`
the client address is the last `X-Forwarded-For` entry (what the proxy appended). Link tokens aren't rate limited:
they're 32 random bytes, and counting them against a shared limiter would let anyone lock every link user out behind
the proxy. Each person gets at most `STUDIO_MAX_STREAMS_PER_PERSON` (default 5) live-update streams (the oldest is
told it was replaced and closes); the server keeps `STUDIO_MAX_EVENT_STREAMS` (default 200) in all, and a tab past that
is told live updates are paused and catches up every 30 seconds.

**Company sign-in trusts the proxy only.** With `STUDIO_TRUSTED_EMAIL_HEADER`, the header is believed only from
`STUDIO_TRUSTED_PROXY_CIDRS` and/or on requests carrying `X-Studio-Proxy-Secret` equal to `STUDIO_PROXY_SECRET`; the
server refuses to start with neither (`studio-server.js` `proxyAllowList`).

## Environment variables

| Variable | Purpose |
| --- | --- |
| `STUDIO_SECRETS_FD` | Descriptor (usually `0`) the server reads its secrets from, as `NAME=value` lines. |
| `STUDIO_SECRETS_FILE` | A file holding the same lines (a Docker, Compose or Kubernetes secret). Set this or `STUDIO_SECRETS_FD`, not both. |
| `STUDIO_RUN_AS` | When started as root: the user (or `user:group`) to switch to after reading the secrets. The server refuses to run as root without it; the image sets `node`. |
| `STUDIO_SECRET_KEY` | 32+ characters; encrypts keys saved in Settings. A secret: in the secrets file. |
| `STUDIO_PASSWORD` | The admin password (16+ characters). A secret: in the secrets file. |
| `STUDIO_PROXY_SECRET` | Optional secret the sign-in proxy sends as `X-Studio-Proxy-Secret`. A secret: in the secrets file. |
| `STUDIO_TRUSTED_EMAIL_HEADER`, `STUDIO_ALLOWED_EMAIL_DOMAINS` | Company sign-in through a proxy. The proxy must strip any copy of the header the browser sends. |
| `STUDIO_TRUSTED_PROXY_CIDRS` | With the header: the addresses (IPs or CIDR ranges) the proxy connects from. Required unless `STUDIO_PROXY_SECRET` is set. |
| `STUDIO_ADMIN_EMAILS` | Comma-separated emails that are always admins (company or Google sign-in). Also the recovery path. |
| `STUDIO_LINK_DAYS` | How long an unused invite link works. Default 7, at most 30, fractions allowed (0.5 = 12 hours). Every link works once. |
| `STUDIO_GOOGLE_CLIENT_ID`, `STUDIO_GOOGLE_CLIENT_SECRET` | Sign in with Google (password mode). The secret is a secret; needs `STUDIO_PUBLIC_ORIGIN`. |
| `STUDIO_GOOGLE_ALLOWED_DOMAINS` | Optional: the only email domains Google sign-in accepts. |
| `STUDIO_PUBLIC_ORIGIN` | The public https address; used for sign-in link URLs when the request has no Origin, and makes the cookie Secure. |
| `STUDIO_TRUST_PROXY` | `1` when only the proxy reaches the server: password tries count per forwarded client. |
| `STUDIO_SECURE_COOKIES`, `STUDIO_DATA_DIR`, `STUDIO_HOST`, `PORT`, `STUDIO_MAX_EVENT_STREAMS`, `STUDIO_MAX_STREAMS_PER_PERSON` and the rest | As in `docs/web-deploy.md` (the full table) and `HANDOFF.md`. |

## Secrets and the AI's environment

On the Codex route the AI is a command-line agent running as the server's user. The studio runs it in a private, empty
folder under the system temp directory (outside the data folder), with the prompt on standard input, a read-only
sandbox and its tools switched off (`src/shared/codex-runner.js`), but a read-only sandbox still lets it read files its
user can read. These layers keep the studio's secrets from it:

1. `studioCliEnv()` (`src/main/studio-host.js`) gives every AI CLI an environment without `STUDIO_*` variables or
   saved-key variables (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `APIFY_API_TOKEN`, `MONDAY_API_TOKEN`, `GOOGLE_*TOKEN`,
   `GOOGLE_SHEETS_WEBHOOK_URL`). Test: `test/cli-env.test.js`, and the Codex spawn check in `test/roles-gate.test.js`.
2. That can't hide the **server's own starting environment**, which any same-user process can read
   (`/proc/<pid>/environ`, `ps eww`, `sysctl KERN_PROCARGS2`; confirmed from inside the macOS Codex sandbox). So
   `scripts/studio-web.cjs` reads the secrets from `STUDIO_SECRETS_FD` or `STUDIO_SECRETS_FILE`, keeps them in memory
   and out of `process.env`, and tells the web runtime only that password sign-in is on. Started as root with
   `STUDIO_RUN_AS` (the container), it reads a root-only secrets file and then switches user, so neither the file nor
   (on Linux) its own memory and starting environment are readable afterwards. Secrets still supplied as environment
   variables work, with a startup warning. Test: `test/web-secrets.test.js` reads a child's own
   environment block after it took its secrets from standard input.
3. Keys saved in Settings are encrypted (AES-256-GCM) with the secret key, so the AI can read `config.json` but not the
   keys in it, as long as the secret key never sat in an environment it can read.

Server-wide API keys set as environment variables are exposed the same way; save keys in Settings instead.

## Rollout

1. Set `STUDIO_ADMIN_EMAILS` (plus `STUDIO_TRUSTED_PROXY_CIDRS` or `STUDIO_PROXY_SECRET`) for company sign-in, or a
   **new** `STUDIO_PASSWORD` known only to admins, passed through the secrets file. Anyone with the old shared password would otherwise sign in as an admin.
2. Restart, sign in as an admin, and invite editors and channel owners in **People & access** (one channel each).
   Adjust what roles can do on the Roles tab if the defaults don't fit.
3. In password mode, invite each person: the invite emails them a one-time link (or, with Google sign-in, tells them to sign in with Google). With email off, copy each link to them.
4. Announce the studio's address.

**Recovery**: add your email to `STUDIO_ADMIN_EMAILS` and restart; in password mode the admin password always signs in
as an admin.

## Data model and member lifecycle

`content-studio/team.json` (next to `state.json`, in the folder the owner lock protects), version 3. A version 1 file is
upgraded on load (`MIGRATIONS[1]`): members get empty `grants` and `denies`, and empty `roles`, `rolePolicy` and
`audit` are added, so everyone keeps exactly the access they had. A version 2 file then gets Ask AI on by default
(`MIGRATIONS[2]`, `askAiForEveryRole`): each custom role that lacks `askAi` gets it, once, when it already holds what
Ask AI needs on its base and the access log doesn't show an admin turning it off for that role; each change is an
Automatic `policy-changed` row in the access log. The built-in roles need no step: Channel owner gets it from the new
`roles.json` default, and an admin's own Off (`rolePolicy.builtIn.<role>.deny`) is kept. One kind of Off isn't an
admin's choice: before v3, Ask AI on an editor base needed See costs, so turning See costs off turned Ask AI off in the
same save (one access-log row with both, or rows with the same `at`). v3 ignores that Off when it reads the log, and
removes it from `builtIn.editor.deny` and from a person's own `denies` when See costs is denied there too and the role
or person still has what Ask AI needs (Automatic `policy-changed` and `member-access` rows). The admin role, other
capabilities and people's other access are never touched. The version reached is written with the next change, so an
admin who later turns Ask AI off for a role keeps it off through restarts and upgrades (`test/team-store.test.js`).

```json
{ "version": 3,
  "members": [{ "id": "member-<uuid>", "name": "", "email": "", "role": "admin|editor|channel|role-<slug>-<4hex>", "channelId": null,
                "grants": ["<capability>"], "denies": ["<capability>"], "accessUpdatedAt": "", "accessUpdatedBy": { "id": "", "name": "" },
                "disabled": false, "createdAt": "", "updatedAt": "", "createdBy": { "id": "", "name": "" }, "lastSeenAt": "",
                "link": { "id": "", "hash": "<sha256>", "createdAt": "", "expiresAt": null, "lastUsedAt": "" } }],
  "roles": [{ "id": "role-<slug>-<4hex>", "label": "≤ 40, unique", "description": "≤ 160", "base": "editor|channel",
              "capabilities": ["<capability>"], "template": "|editor|channel|viewer|analyst|channel-reviewer", "policyVersion": 2,
              "createdAt": "", "updatedAt": "", "createdBy": { "id": "", "name": "" } }],
  "rolePolicy": { "rev": 0, "updatedAt": "", "updatedBy": null, "builtIn": { "editor": { "grant": [], "deny": [] }, "channel": { "grant": [], "deny": [] } } },
  "adoptions": [{ "id": "adoption-<uuid>", "workspaceId": "", "themeId": "", "channelId": "", "status": "using|not-using",
                  "link": "", "note": "", "plannedFor": "YYYY-MM-DD or ''", "trendName": "", "by": { "id": "", "name": "" }, "at": "", "updatedAt": "" }],
  "activity": [{ "id": "", "workspaceId": "", "at": "", "by": { "id": "", "name": "" },
                 "kind": "trend-decision|adoption|kit-created|report-edited|report-restored|member-changed|link-issued|research-started", "detail": {} }],
  "audit": [{ "id": "audit-<uuid>", "at": "", "by": { "id": "", "name": "" },
              "kind": "member-added|member-changed|member-disabled|member-enabled|member-removed|member-access|link-issued|link-revoked|role-created|role-changed|role-deleted|policy-changed",
              "target": { "type": "member|role", "id": "", "name": "" },
              "changes": [{ "field": "name|email|role|channelId|grant|deny|capability|label|description|base", "capability": "", "from": "", "to": "", "fromLabel": "", "toLabel": "" }],
              "affected": 0 }],
  "prefs": { "<identity id>": { "uiMode": "simple|classic", "welcomedAt": "", "inboxSeenAt": "", "focusChannels": ["<channel id>"], "navRail": true } } }
```

- `rolePolicy.rev` goes up with every role or policy change; `saveRolePolicy`, `saveRole` and `deleteRole` carry the
  `rev` the page loaded and are refused with 409 `policyConflict` when someone saved first.
- A member's own `grants`/`denies` are cleared when their role changes to another base (or to Admin).
- Deleting a custom role moves its people to `moveTo` (a role with the same base) in the same write.
- The access log is its own ring of 2,000 rows, so busy trend activity never pushes it out. Role labels are stored in
  the rows, so a deleted role still reads by name.

- Loaded once, written through on every change (temp file, fsync, rename). Synchronous end to end; one process owns the
  folder, so no horizontal scaling. Answers and decisions are last-write-wins, and the UI shows who answered.
- A missing file is an empty team (created on the first write); an unreadable file or a newer version refuses to start.
- `lastSeenAt` is written at most every 5 minutes per member; activity keeps the newest 5,000 rows, the access log 2,000.
- **Remove**: adoptions and activity stay (they snapshot names); prefs and the link go; sessions end. **Disable**: the
  same, but the record stays and the person sees "Your access to this studio is paused." Re-adding an email creates a
  new id. A channel change leaves old answers with the channel. Owners of the same channel share one answer per trend.
- Attribution in `state.json`: `run.createdBy`, `run.decisionsBy[themeId]`, `asset.edited = { at, by }`,
  `asset.restored`. Old records without it show "Not recorded".

**Edited reports.** `editStudioAsset` writes `<id>.edited.md` and `<id>.edited.html` beside the generated files
(https links only; http:// addresses stay text because Drive delivery accepts https only). Everything reading a
report's text or page goes through `assetFile` / `assetResult`, so kits, Create content, exports, Ask AI and Drive use
the edit. A save carries the version it was loaded from (`baseEditedAt`); if someone saved since, it's refused with
409 `copy.editConflict` and the text stays on screen. Drive never replaces a file it already has: an edited report or
draft is delivered as a new Doc ending in "(edited)" under the id `<asset id>-edited-<edit time>`, and a toolkit keeps
linking the first trends doc Drive got for its report. The report editor (`pushReportDocUpdate`) writes the same two
files through `writeReportMarkdown`, without the `baseEditedAt` check (its shared document already merged everyone's
changes), and credits `asset.edited.by` to whoever saved last; `editStudioAsset` and `restoreStudioAsset` tell the
editor (`hooks.onAssetEdited`), whose document then starts over from the new text.

**Notes** live in `content-studio/report-notes.json` (`{ v: 1, notes: { [assetId]: [note] }, inbox: { [identityId]:
[item] } }`; one atomic file, a damaged one is put aside as `.bad-<time>`, a newer version refuses to start). Each
person keeps up to 200 Inbox items for 60 days; the state shows the last 30 days, 60 at most. Removing a member keeps
their notes (they are the team's), with the name they had.

## API

| Method | Channel | Payload | Returns | Errors |
| --- | --- | --- | --- | --- |
| `getTeam` | `team:list` | — | `{ members, channels, signIn: { web, sso, links, linkDays }, access }`; members carry `roleLabel, base, grants, denies, capabilities`; `access` is `{ rev, updatedAt, updatedBy, groups, capabilities, roles: [{ id, label, description, base, builtIn, template, capabilities, memberCount, overrides?, newCapabilities? }], templates, limits }` | admin only |
| `saveMember` | `team:save-member` | `{ id?, name, email, role, channelId, disabled }` (`role` any role id) | `{ member }` | name, role, email (unique; required on the web), channel; `selfChange`, `lastAdmin`, `serverAdmin` |
| `removeMember` | `team:remove-member` | `{ id }` | `{ ok: true }` | `selfChange`, `lastAdmin`, `serverAdmin`, 404 |
| `inviteMembers` | `team:invite` | `{ people: [{ email, name? }] (1–50), role, channelId?, grants?, denies?, makeLinks? }` | `{ members, links: [{ id, url, expiresAt }], skipped: [{ email, reason }], signIn }` | role, channel; `adminAccess`, `lockedCapability`, `notForChannelRoles`, `needsCapability`. Links only in web password mode. A missing name comes from the email (`pat.lee` → Pat Lee). |
| `saveMemberAccess` | `team:member-access` | `{ id, grants, denies }` | `{ member }` | `adminAccess`, `selfChange`, `serverAdmin`, `lockedCapability`, `notForChannelRoles`, `needsCapability`, 404 |
| `saveRolePolicy` | `team:role-policy` | `{ rev, builtIn?: { editor?: { grant, deny }, channel?: { grant, deny } }, custom?: [{ id, capabilities }] }` | `{ access, affected }` | 409 `policyConflict`; `adminAccess` for an `admin` key; `lockedCapability`, `notForChannelRoles`, `needsCapability`, unknown capability |
| `saveRole` | `team:save-role` | `{ id?, label, description?, base, template?, capabilities?, rev }` | `{ role, access }` | `roleName`, `roleBase`, 409 `policyConflict`, 12 roles at most |
| `deleteRole` | `team:delete-role` | `{ id, moveTo?, rev }` | `{ ok, moved, access }` | 409 `roleInUse` without `moveTo`; built-ins refused; 409 `policyConflict` |
| `readAccessLog` | `team:access-log` | `{ before?: audit id or ISO, limit?: 1–200, memberId?, roleId?, kinds? }` | `{ rows: [{ id, at, by: { name }, kind, text, target, changes, affected }], more, next }` | admin only (a read) |
| `previewAccess` | `team:preview-access` | `{ role, grants?, denies? }` · `{ memberId, grants?, denies? }` · `{ base, capabilities }` | `{ base, capabilities, nav, hiddenPages, modes, can, cannot, possible }` | a dry run of the gate's merge (a read) |
| `createSignInLink` | `team:sign-in-link` | `{ id }` | `{ url, expiresAt }` | `linksWebOnly` on the Mac; 400 with company sign-in; 409 for a disabled person |
| `revokeSignInLink` | `team:revoke-link` | `{ id }` | `{ ok: true }` | 404 |
| `setViewAs` | `team:view-as` | `{ role, channelId? }` (any role id) or `{ memberId }` | `{ viewer }` | admin (real role) only; 400 for an unknown role, a channel role without a channel, or an admin member; 409 for a disabled member |
| `setViewPrefs` | `team:prefs` | `{ uiMode?, welcomedAt?, inboxSeenAt?, focusChannels?, navRail? }` | `{ viewer }` | allowlist only; dates must parse; channels must be kit folder ids; `navRail` boolean or null |
| `setTrendAdoption` | `team:adoption` | `{ themeId, channelId?, status: 'using'\|'not-using'\|'clear', link?, note?, plannedFor?: 'YYYY-MM-DD'\|'' }` | `{ adoption \| null }` (with `plannedFor`) | 404 unless the trend's brief is ready; `badLink`; note ≤ 500; a real date; Not for us clears the date |
| `getTrendAnalytics` | `team:analytics` | `{ days?: 7\|30\|90\|365, includeAll? }` | see Analytics | admin only |
| `editStudioAsset` | `studio:editStudioAsset` | `{ assetId, markdown, baseEditedAt }` | `{ asset }` | 409 `editConflict`; pictures and landing pages; 250,000 characters |
| `restoreStudioAsset` | `studio:restoreStudioAsset` | `{ assetId }` | `{ asset }` | text assets only |
| `openReportDoc` | `studio:openReportDoc` | `{ assetId, clientId? }` | `{ assetId, title, markdown, yState, version, epoch, savedAt, versions: [{ id, at, by, label }], canEdit, canNote, editors: [{ id, name, color }], awareness: [base64] }` | text assets only; `outOfScope` |
| `pushReportDocUpdate` | `studio:pushReportDocUpdate` | `{ assetId, update?, markdown?, clientId, final?, epoch?, stateVector?, awareness? }` (base64) | `{ version, savedAt, epoch, markdownSaved }` | 400 `docUpdateInvalid`, 413 `docTooLarge`, 409 `docReset`; landing pages; 250,000 characters |
| `restoreReportVersion` | `studio:restoreReportVersion` | `{ assetId, versionId }` (`original` or a kept version) | as `openReportDoc` | 404 for a version no longer kept |
| `closeReportDoc` | `studio:closeReportDoc` | `{ assetId, clientId? }` | `{ ok: true }` | — |
| `listReportNotes` | `studio:listReportNotes` | `{ assetId }` | `{ notes, mentionable: [{ id, name }] }`; marks your Inbox items for it read | text assets only; `outOfScope` |
| `saveReportNote` | `studio:saveReportNote` | new `{ assetId, anchor: { yStart, yEnd, quote }, body, mentions? }`; reply `{ assetId, replyTo, body, mentions? }`; edit `{ assetId, noteId, replyId?, body, mentions? }` | `{ note }` | 403 `notYourNote`; body ≤ 4,000; 500 notes per report, 200 replies per note |
| `resolveReportNote` | `studio:resolveReportNote` | `{ assetId, noteId, resolved }` | `{ note }` | 404 |
| `deleteReportNote` | `studio:deleteReportNote` | `{ assetId, noteId, replyId? }` | `{ ok: true }` | 403 `notYourNote` (admins may delete any), 404 |
| `createAssetKit` (channel owner) | `studio:createAssetKit` | scoped, `onlyIfIdle` | `publicKitRun` | 409 `alreadyMaking`, `outOfScope` |
| `startResearchRun` | `studio:startResearchRun` | `{ programId, datasetIds, again? }` | the run | 409 `researchRunning` unless `again: true` |

HTTP: `/api/login` (`{ password }` or `{ linkToken }`; 401 `{ error, signIn: 'link-invalid' }`), `/api/session`
(`{ ok, user, signOut, viewer: { name, email, role, channelId, disabled } }` with the real role), `/api/events`
(projected state; 403 for role `null`), `/api/upload` (anyone whose access opens a method that reads a file, never in a
preview: `people.canUpload`, else admins and editors). Lower-case error codes travel to the page as `code`.

## Adding things

- **A method**: add it to `studio-api-channels.json` (and preload), register its handler (the gate wraps it), and put
  it in exactly one capability (`test/roles.test.js` fails otherwise). Add it to `readMethods` only if it never
  writes. If a channel owner may call it, add a scope in `access.js` `SCOPES` that rebuilds the payload, list it in
  `SCOPE_METHODS.channel` and `channelSafeMethods`, and add a result projection in `RESULTS`. Gate the renderer control
  with `can()` and spread `writeProps(viewer)` on write buttons.
- **A capability**: add it to `capabilities` with its group, label, description, defaults (built-in role ids, admin
  always), bases, and `requires`/`spends`/`lock` as needed; give it `since` above `policyVersion` (and raise
  `policyVersion`) so existing custom roles show it as New and off. Pages it shows go in `pages`.
- **A role**: admins make custom roles in People & access › Roles; nothing in code changes. A new built-in base would
  touch `roles`, `effectiveRole`, `pagesFor`, `projectState` and `ROLE_LABELS` in `viewer.js`.
- **A channel**: add an entry to `src/shared/kit-folders.json` `folders` (never to `asset-kit.js`, whose `KIT_FOLDERS`
  is derived from it). Give it `id`, `semrush`, `general`, `semrushShort`, `generalShort` and `deliverables`. Every
  deliverable id must exist in `content-studio.js` `CONTENT_DELIVERABLES`; one limited to an edition goes in
  `editionOnly`, or main and the renderer disagree on whether the folder is offered. Array order is the display order.
  Ids are permanent because members, answers and analytics store them.

## Analytics definitions

All windows are UTC, over the last `days`. `readyTrends` (channel-view.js) is the single "brief is ready" rule.

- **decision** comes from the newest research run that recorded a decision for the theme (approved or passed); a ready theme with no recorded decision counts as approved; otherwise `pending`. **decidedBy** comes from `decisionsBy` ("Not recorded" when missing).
- **trendsFound / approved / passed / pending**: themes first detected in the window.
- **briefsReady**: ready themes whose `readyAt` is in the window. Matrix rows are these; `includeAll` adds found themes that aren't ready.
- **ownerSince**: the earliest owner's `createdAt` (owners are enabled members whose role is built on Channel owner); **offered**: `readyAt ≥ ownerSince − 14 days` (false with no owner).
- **generated**: a succeeded job for the channel in a kit run for the theme. **Cell status**: the answer, else `generated`, else `none`.
- **inUse**: briefsReady themes with a `using` answer; **linksAdded**: `using` answers with a link; **assetsGenerated**: succeeded kit assets created in the window.
- **byChannel** counts are over offered briefsReady themes (`noAnswer` is null with no owner). **recent**: the newest 50 activity rows in plain words.

## Copy

| key | text |
| --- | --- |
| forbidden | Only editors and admins can do that. Ask an admin if you need it. |
| adminOnly | Only an admin can do that. |
| outOfScope | That belongs to another channel. |
| sharedSet | This set was made with other channels. Ask an editor. |
| preview | You’re previewing as {who}. Switch back to Admin to make changes. |
| alreadyMaking | Your {channel} assets for this trend are already being made. |
| linkInvalid | This sign-in link doesn’t work anymore: each link works once, and only for a few days. Go to the sign-in page to sign in another way, or ask your studio admin for a new link. |
| editConflict | {name} saved this report at {time}, after you opened it. Copy your text, reopen the report and try again. |
| researchRunning | {name} started a search with this program at {time}. It’s still running. |
| selfChange | You can’t change your own access. Ask another admin. |
| lastAdmin | The studio needs at least one admin. |
| serverAdmin | This person is an admin in the server settings. |
| paused | Your access to this studio is paused. |
| linksWebOnly | Sign-in links are for the web version. |
| badLink | That doesn’t look like a web link. |
| askPictures | Pictures aren’t set up for your team. Ask {admin} to turn them on. |
| askDrive | Google Drive isn’t connected. Ask {admin} to connect it. |
| askConnection | The studio’s AI or data connection needs attention. Ask {admin}. |
| askBudget | This needs an admin to finish. Ask {admin}. |
| capabilityOff | Your access doesn’t include “{what}”. Ask {admin} if you need it. |
| lockedCapability | Only admins can have “{what}”. |
| notForChannelRoles | Channel owners see only their channel, so they can’t have “{what}”. |
| needsCapability | “{what}” also needs {needs}. |
| policyConflict | {name} changed roles at {time}, after you opened them. Reload to see the latest. |
| adminAccess | Admins can do everything, so their access can’t be adjusted. |
| roleInUse | This role has {count}. Choose a role to move them to first. |
| roleName | Choose a role name that isn’t already used. |
| roleBase | A role’s type can’t change after it’s made. |

A channel owner's kit run message comes from a fixed set: "Starting…", "Writing N of M…", "All N files are ready.",
"Some files didn’t finish. Try again.", "Stopped." and "Ask an admin: the AI connection needs attention." (with
`needsAdmin: true`, when only an admin can fix it, so the card offers no retry).

## Test map

| Area | Tests |
| --- | --- |
| Policy, capabilities, merge rules, viewer, projection (money) | `test/roles.test.js` |
| Gate logic, refusals, scopes by base, previews, audit, result projection, error rewriting | `test/access.test.js` |
| The real main process on the web runtime and the Mac (sync gate, View as pushes, Codex env) | `test/roles-gate.test.js` |
| Provider errors through the real gate (scripted Claude CLI) | `test/roles-errors.test.js` |
| team.json (v2 and v3, role policy, custom roles, member access, invites, the access log, prefs, Ask AI on once for every role) | `test/team-store.test.js` |
| Ask AI for channel owners (the context, lookups, buttons and cards from the channel view only; the gate's scopes; their own conversations, memory and pictures; the sidebar entry; previews) | `test/ask-channel.test.js`, `test/ask-channel-web.test.js`, `test/channel-ask.test.jsx` |
| Channel view and `readyTrends` parity with the trend board | `test/channel-view.test.js` |
| Analytics definitions | `test/team-analytics.test.js` |
| Workflow owners' access and the workflows' share of the state | `test/access-workflow.test.js` |
| The report editor and notes: merges, Markdown write-through, versions, presence, notes, Inbox, who may do what, events | `test/report-docs.test.js`, `test/report-notes.test.js`, `test/report-editor-gate.test.js`, `test/ask-transport.test.js` |
| The editor page per role: read-only without edit, notes-only for channel owners, off in a preview | `test/report-editor.test.jsx`, `test/simple-reports-live.test.jsx`, `test/asset-editor.test.jsx` |
| Attribution, edits, Drive after an edit, kit exports, retries | `test/content-workspace-roles.test.js` |
| Edited-report HTML | `test/markdown-html.test.js` |
| Server: sign-in, links, limits, streams, projection | `test/studio-server.test.js`, `test/web-host.test.js`, `test/web-runtime.test.js` |
| Secrets and the AI's environment | `test/web-secrets.test.js`, `test/cli-env.test.js` |
| Renderer | `test/app-roles.test.jsx`, `test/studio-sidebar.test.jsx`, `test/channel-owner.test.jsx`, `test/analytics-view.test.jsx`, `test/people-view.test.jsx`, `test/asset-editor.test.jsx`, `test/role-screens.test.jsx`, `test/web-signin.test.jsx` |

## Known limits and open questions

- One channel per owner (`channelIds: []` would be the change). Several owners may share a channel.
- No bulk actions in People yet; Invite covers adding many people at once.
- Custom channel-based roles are previewed from the Roles tab (they need a channel); the sidebar's View as offers them
  on the first channel.
- Channel owners can't call `setAssetStatus` (it is in Edit reports, an editor-base capability); their status chip is
  read-only.
- Editors see per-channel usage in the report reader, not on Trends cards.
- Notifications are in-app only: the Trends count and Copy reminder. No email or Slack.
- One active workspace for everyone; only admins switch it, and switching moves everyone (an open report edit stays on
  screen with Copy my text). The selected brand profile is also shared.
- Sessions live in memory: a deploy signs out link and password users.
- Editors read private Google Docs and Sheets, and publish to Drive and Monday, through the account connected in
  Settings. Connect a dedicated studio account with only the team folders shared.
- On the Codex route the AI runs outside the data folder with its tools off, but its read-only sandbox doesn't stop
  reads, so treat anything the server's user can read as readable by it. Keep secrets in the secrets file and keys in
  Settings (see Secrets); the strongest setup runs `codex` as a user that can't read `STUDIO_DATA_DIR`.
- On the web the browser keeps its own ⌘1–9.
