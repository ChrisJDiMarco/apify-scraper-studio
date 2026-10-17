# Roles and access

The developer handoff for people, roles and sign-in in Scraper Studio: the Mac app and the browser studio. The app
guide (`docs/app-guide.md`, which Ask AI reads) describes the same features for the people using them;
`docs/web-deploy.md` covers running the server. The manual acceptance checklist is
`docs/verification/roles-acceptance.md`.

## Roles and capabilities

Access is a capability model. Every method belongs to exactly one **capability** (`roles.json` `capabilities`), a
capability is granted per role, and each person can be adjusted on top with their own grants and denies (deny wins).

| Built-in role | id | Who | What they get by default |
| --- | --- | --- | --- |
| Admin | `admin` | The studio's owners | Every capability, always. Can't be adjusted, and there is no second admin type. |
| Editor | `editor` | The content and research leads | Finds trends, writes and edits reports, makes assets for any channel, sees and edits AI prompts, sees costs. No Settings, Brand knowledge, People & access, Analytics, research programs or schedules. |
| Channel owner | `channel` | One owner per channel (several may share one) | Sees new trends and their own channel's assets, says which trends they used and where. Never sees money, models or other channels. |

**Custom roles** (People & access › Roles › New role) are built on a **base**, Editor or Channel owner, which never
changes. A channel-based role gets the channel owner's shell, scopes and projection and can only ever call
`channelSafeMethods`. Templates: Viewer (reads reports, trends and evidence; no costs), Analyst (quick scans, Ask AI,
Sheets and data tools, with costs) and Channel reviewer (reads and marks trends used), plus the current Editor and
Channel owner. A studio has up to 12 custom roles.

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
6. A capability whose requirements are missing is removed, repeatedly: its `requires`, plus See costs for paid work
   (`spends`) on an editor base, because paid work shows its estimate first. A channel base never needs costs.

The methods are the union of the capabilities' methods (a channel base: intersected with `channelSafeMethods`). With
no policy edits this is exactly the old fixed matrix: admin 157 methods, editor 109, channel owner 13.

Channels are the ten asset-kit folders in `src/shared/asset-kit.js` `KIT_FOLDERS`: `blog, newsletter, paidmedia, pr,
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
| `src/main/web-secrets.js` | Reads `STUDIO_SECRET_KEY` and `STUDIO_PASSWORD` from `STUDIO_SECRETS_FD`. |
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
people`. The sidebar's group for prompts, analytics, people and settings is labelled **Studio**. The renderer shows a
control when `can(viewer, method)` (`roleAllowed || allowed`) and runs it only when
`canRun(viewer, method)` (`allowed`); write buttons spread `writeProps(viewer)` so a preview shows them turned off with
the title "Buttons that change things are off in a preview." An admin previewing an editor therefore sees the editor's
screens as the editor does.

## Capabilities

`capabilities` in `src/shared/roles.json` is the source of truth; `test/roles.test.js` checks every method in
`studio-api-channels.json` sits in exactly one. Defaults: A = Admin, E = Editor, C = Channel owner. Bases: which kinds
of role may ever hold it. “Spends” marks paid work (it needs See costs on an editor base).

| Group | Capability | Defaults | Bases | Requires | Methods |
| --- | --- | --- | --- | --- | --- |
| Everyone | `core` Open the studio (lock `always`) | A E C | editor, channel | | `appMeta, state, contentCatalog, openSourceUrl, setViewPrefs` |
| Research | `readResearch` See research and evidence | A E | editor | | `readStudioRun, readTrendHistory, readResearchReview, searchEvidence, readEvidence, readReferenceDoc` |
| | `startResearch` Start research (spends) | A E | editor | readResearch | `startResearchRun, continueResearchRun, estimateResearchProgram` |
| | `quickScans` Run quick scans (spends) | A E | editor | readResearch | `estimateQuickScan, startQuickScan` |
| | `approveTrends` Approve trends | A E | editor | readResearch | `approveResearchThemes, decideResearchTheme, setThemeStatus` |
| Reports and channel assets | `readAssets` Read reports and assets | A E C | editor, channel | | `readStudioAsset, openStudioAsset` |
| | `writeReports` Write reports (spends) | A E | editor | readResearch, readAssets | `createContentRun, importStudioSource` |
| | `editReports` Edit reports | A E | editor | readAssets | `editStudioAsset, restoreStudioAsset, saveResearchReview, setAssetStatus` |
| | `makeAssets` Make channel assets (spends) | A E C | editor, channel | readAssets | `planAssetKit, createAssetKit, saveAssetKitFolder` |
| | `manageRuns` Stop and retry work (spends) | A E C | editor, channel | | `cancelStudioRun, retryStudioRun, cancelJob, getJob, readJobLog` |
| | `markTrendsUsed` Mark trends used | A C | editor, channel | readAssets | `setTrendAdoption` |
| AI and prompts | `askAi` Use Ask AI (spends) | A E | editor | readAssets, readResearch | `askHelp`, the conversation and memory methods, `createHelpImage, saveHelpImage, listHelpImages, readHelpImage` |
| | `viewPrompts` See AI prompts | A E | editor | | `listPrompts, readPrompt, previewPrompt, diffPromptVersions, estimatePromptTest` |
| | `editPrompts` Edit AI prompts (spends) | A E | editor | viewPrompts | `savePromptVersion, revertPrompt, testPrompt` |
| Data and exports | `sheets` Use Sheets | A E | editor | | workbooks, including `exportWorkbookXlsx, exportWorkbookToGoogle` |
| | `dataTools` Use data tools (spends) | A E | editor | manageRuns | imports, datasets, dataset reports, scrapers, playbooks, workflows, brand profiles, `exportDatasetToSheets` |
| | `deleteScrapers` Delete scrapers | A | editor | dataTools | `deleteRecipe` |
| | `exportPublish` Export and publish | A E | editor | readAssets, readResearch | `publishStudioRun, exportStudioRun, exportResearchReview, syncTrendBoardToMonday` |
| Studio setup | `seeCosts` See costs and budgets (projection `money`) | A E | editor | | none |
| | `managePrograms` Manage research programs | A | editor | readResearch, seeCosts | `saveResearchProgram, scheduleMission` |
| | `editBrand` Edit brand knowledge | A | editor | | taxonomy, reference docs, brand images, product registry, `deleteBrandProfile` |
| | `manageWorkspaces` Switch workspaces | A | editor | | `selectContentWorkspace, saveContentWorkspace` |
| | `seeAnalytics` See team analytics | A | editor | | `getTrendAnalytics` |
| Admin only (locked) | `settings` Settings and connections | A | none | | keys, settings, AI and connection checks, Monday, data folders, setup files, sheet maintenance, `setPromptLock` |
| | `manageAccess` People and access | A | none | | `getTeam, saveMember, removeMember, createSignInLink, revokeSignInLink, setViewAs, saveRolePolicy, saveRole, deleteRole, saveMemberAccess, inviteMembers, readAccessLog, previewAccess` |

`channelSafeMethods` = the core methods plus every method with a channel scope in `access.js` (`SCOPE_METHODS.channel`):
a channel-based role reaches nothing else, whatever it is granted. That keeps `cancelJob`, `getJob` and `readJobLog`
(in Stop and retry work) away from channel owners. A composite method's capability is the same as, or requires, the
capability of everything it runs (or is locked admin). Role `null` may call `appMeta` and `state` only.

While previewing, only identity methods and `readMethods` run. Channel owners get the Simple layout only.

## Identity and sign-in

`identity = { id, name, email, role, roleId, channelId, via, disabled, memberSince }`, `via` ∈ `desktop | password | proxy | link`.
`role` is the role's base (`admin | editor | channel | null`) and `roleId` the role itself (a custom role's id), so
studio-server's checks keep working; `teamStore.identityFor` fills both, and an identity without `roleId` uses `role`.

- **Mac app**: always `{ id: 'local', role: 'admin', via: 'desktop' }`. View as lives in process memory and clears on quit.
- **Admin password** (web, `STUDIO_PASSWORD`): break-glass admin, `{ id: 'owner', name: 'Studio admin' }`. Sessions last 12 hours; each browser session keeps its own View as.
- **Company sign-in** (`STUDIO_TRUSTED_EMAIL_HEADER` + `STUDIO_ALLOWED_EMAIL_DOMAINS`): the member is found by email, case-insensitive. `STUDIO_ADMIN_EMAILS` is authoritative: a listed email is always an enabled admin (created or re-promoted at sign-in), shown as "Set by the server", and can't be changed in People. Unknown emails get role `null`. No sign-in links and no Sign out button: the proxy owns the session.
- **Personal sign-in link** (password mode only): `<origin>/#signin=<64 hex>`. The page reads the fragment, removes it from the address bar first, then posts `/api/login { linkToken }`. The server compares SHA-256 hashes timing-safely against every member, refuses expired links and disabled members, ends any session the browser arrived with, and starts a 30-day link session bound to the link id. Making a new link, turning the link off, disabling or removing the person ends every session that used it. Sessions are in memory, so a restart signs people out (they reopen their link).
- **Effective role**: View as only lowers a real admin's role: any non-admin role (`{ role }`, a channel-based one with a
  `channelId`) or one person (`{ memberId }`, with their own grants and denies, read fresh on every call). `admin`
  clears it. A demoted admin's old View as is ignored.

**Sign-in limits.** Admin-password tries are limited to ten a minute per client address; with `STUDIO_TRUST_PROXY=1`
the client address is the last `X-Forwarded-For` entry (what the proxy appended). Link tokens aren't rate limited:
they're 32 random bytes, and counting them against a shared limiter would let anyone lock every link user out behind
the proxy. Each person gets at most five live-update streams (the oldest is told it was replaced and closes); the
server keeps 50 in all.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `STUDIO_SECRETS_FD` | Descriptor (usually `0`) the server reads `STUDIO_SECRET_KEY` and `STUDIO_PASSWORD` from, as `NAME=value` lines. |
| `STUDIO_SECRET_KEY` | 32+ characters; encrypts keys saved in Settings. Pass through `STUDIO_SECRETS_FD`. |
| `STUDIO_PASSWORD` | The admin password (16+ characters). Pass through `STUDIO_SECRETS_FD`. |
| `STUDIO_TRUSTED_EMAIL_HEADER`, `STUDIO_ALLOWED_EMAIL_DOMAINS` | Company sign-in through a proxy. The proxy must strip any copy of the header the browser sends. |
| `STUDIO_ADMIN_EMAILS` | Comma-separated emails that are always admins (company sign-in). Also the recovery path. |
| `STUDIO_LINK_DAYS` | How long a new sign-in link works. Default 30, fractions allowed (0.5 = 12 hours), 0 = until replaced or turned off. |
| `STUDIO_PUBLIC_ORIGIN` | The public https address; used for sign-in link URLs when the request has no Origin, and makes the cookie Secure. |
| `STUDIO_TRUST_PROXY` | `1` when only the proxy reaches the server: password tries count per forwarded client. |
| `STUDIO_SECURE_COOKIES`, `STUDIO_DATA_DIR`, `STUDIO_HOST`, `PORT` | As in `docs/web-deploy.md`. |

## Secrets and the AI's environment

On the Codex route the AI runs shell commands as the server's user, inside the data folder. Three layers keep the
studio's secrets from it:

1. `studioCliEnv()` (`src/main/studio-host.js`) gives every AI CLI an environment without `STUDIO_*` variables or
   saved-key variables (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `APIFY_API_TOKEN`, `MONDAY_API_TOKEN`, `GOOGLE_*TOKEN`,
   `GOOGLE_SHEETS_WEBHOOK_URL`). Test: `test/cli-env.test.js`, and the Codex spawn check in `test/roles-gate.test.js`.
2. That can't hide the **server's own starting environment**, which any same-user process can read
   (`/proc/<pid>/environ`, `ps eww`, `sysctl KERN_PROCARGS2`; confirmed from inside the macOS Codex sandbox). So
   `scripts/studio-web.cjs` reads the secret key and the admin password from `STUDIO_SECRETS_FD`, keeps them in memory
   and out of `process.env`, and tells the web runtime only that password sign-in is on. Secrets still supplied as
   environment variables work, with a startup warning. Test: `test/web-secrets.test.js` reads a child's own
   environment block after it took its secrets from standard input.
3. Keys saved in Settings are encrypted (AES-256-GCM) with the secret key, so the AI can read `config.json` but not the
   keys in it, as long as the secret key never sat in an environment it can read.

Server-wide API keys set as environment variables are exposed the same way; save keys in Settings instead.

## Rollout

1. Set `STUDIO_ADMIN_EMAILS` for company sign-in, or a **new** `STUDIO_PASSWORD` known only to admins, passed through
   `STUDIO_SECRETS_FD`. Anyone with the old shared password would otherwise sign in as an admin.
2. Restart, sign in as an admin, and invite editors and channel owners in **People & access** (one channel each).
   Adjust what roles can do on the Roles tab if the defaults don't fit.
3. In password mode, send each person their sign-in link (Invite makes them in the same step).
4. Announce the studio's address.

**Recovery**: add your email to `STUDIO_ADMIN_EMAILS` and restart; in password mode the admin password always signs in
as an admin.

## Data model and member lifecycle

`content-studio/team.json` (next to `state.json`, in the folder the owner lock protects), version 2. A version 1 file is
upgraded on load (`MIGRATIONS[1]`): members get empty `grants` and `denies`, and empty `roles`, `rolePolicy` and
`audit` are added, so everyone keeps exactly the access they had.

```json
{ "version": 2,
  "members": [{ "id": "member-<uuid>", "name": "", "email": "", "role": "admin|editor|channel|role-<slug>-<4hex>", "channelId": null,
                "grants": ["<capability>"], "denies": ["<capability>"], "accessUpdatedAt": "", "accessUpdatedBy": { "id": "", "name": "" },
                "disabled": false, "createdAt": "", "updatedAt": "", "createdBy": { "id": "", "name": "" }, "lastSeenAt": "",
                "link": { "id": "", "hash": "<sha256>", "createdAt": "", "expiresAt": null, "lastUsedAt": "" } }],
  "roles": [{ "id": "role-<slug>-<4hex>", "label": "≤ 40, unique", "description": "≤ 160", "base": "editor|channel",
              "capabilities": ["<capability>"], "template": "|editor|channel|viewer|analyst|channel-reviewer", "policyVersion": 1,
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
linking the first trends doc Drive got for its report.

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
- **A channel**: add the folder to `KIT_FOLDERS` with `semrushShort` and `generalShort`; ids are permanent because
  members, answers and analytics store them.

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
| linkInvalid | This sign-in link doesn’t work anymore. Ask your studio admin for a new one. |
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
| team.json (v2, role policy, custom roles, member access, invites, the access log, prefs) | `test/team-store.test.js` |
| Channel view and `readyTrends` parity with the trend board | `test/channel-view.test.js` |
| Analytics definitions | `test/team-analytics.test.js` |
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
- On the Codex route the AI can read the data folder and anything the server's user can read. Keep secrets on
  `STUDIO_SECRETS_FD` and keys in Settings (see Secrets).
- On the web the browser keeps its own ⌘1–9.
