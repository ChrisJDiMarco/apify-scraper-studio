# Roles and access

The developer handoff for people, roles and sign-in in Scraper Studio: the Mac app and the browser studio. The app
guide (`docs/app-guide.md`, which Ask AI reads) describes the same features for the people using them;
`docs/web-deploy.md` covers running the server. The manual acceptance checklist is
`docs/verification/roles-acceptance.md`.

## The three roles

| Role | id | Who | What they get |
| --- | --- | --- | --- |
| Admin | `admin` | The studio's owners | Everything, including settings, people and analytics. |
| Editor | `editor` | The content and research leads | Finds trends, writes and edits reports, makes assets for any channel, sees the full channel list. No Settings, Brand knowledge, People, Analytics, research programs or schedules. |
| Channel owner | `channel` | One owner per channel (several may share one) | Sees new trends and their own channel's assets, says which trends they used and where. Never sees money, models or other channels. |

Someone signed in who isn't in People (or is disabled) has role `null` and sees only the No access screen.

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
| `src/shared/roles.json` | Policy data: roles, `methodRoles`, `identityMethods`, `readMethods`, nav, hidden pages, layouts, copy. |
| `src/main/roles.js` | Pure policy logic: `canCall`, `allowedMethods`, `effectiveRole`, `buildViewer`, `projectState`, `format`. Main process only. |
| `src/main/access.js` | The gate: `check` (deny by default, preview read-only, channel scopes), `after`, `rewriteError`, `project` (memoised per state object and view). |
| `src/main/team-store.js` | `content-studio/team.json`: members, sign-in links, adoptions, activity, prefs. Synchronous, atomic writes. |
| `src/main/channel-view.js` | What a channel owner sees: `readyTrends`, `publicKitRun`, `buildChannelView`, `kitChannelIds`. |
| `src/main/team-analytics.js` | `buildTrendAnalytics` for the Analytics page. |
| `src/main/markdown-html.js` | Safe Markdown → HTML for edited reports. |
| `src/main/web-secrets.js` | Reads `STUDIO_SECRET_KEY` and `STUDIO_PASSWORD` from `STUDIO_SECRETS_FD`. |
| `src/renderer/src/viewer.js` | `ViewerContext`, `can`, `canRun`, `writeProps`, labels. The renderer never imports CommonJS policy. |
| `src/renderer/src/studio-sidebar.jsx` | The one left sidebar for every layout: workspace, View as, Simple/Advanced, navs, drawer under 860px. |
| `src/renderer/src/channel-owner.jsx` | Channel owner screens: Trends and My assets. |
| `src/renderer/src/analytics-view.jsx`, `people-view.jsx`, `asset-editor.jsx`, `role-screens.jsx` | Analytics, People & roles, the report editor, NoAccess / PreviewBanner / dialogs. |

**The gate stays synchronous.** `gated()` never awaits before calling the handler, so synchronous handlers (`app-meta`,
`state`, `save-key`, `clear-key`, `save-recipe`) still return plain values (`core.test.js`,
`packaged-continuity.test.js`).

**Steps of `check(method, payload, viewer)`**:
1. On the web, a call with no signed-in person gets 403 (fail closed).
2. The role checked is the real role for identity methods (`appMeta`, `state`, `setViewAs`, `setViewPrefs`), else the effective role.
3. In a preview, anything but identity and read methods gets 403 `copy.preview`.
4. `canCall(role, method)` or 403 (`copy.adminOnly` / `copy.forbidden`). A method missing from `methodRoles` is admin-only.
5. For a channel owner, the method's scope rebuilds the payload from an allowlist (below).

Denials are logged with `teamStore.logEvent({ event: 'denied', identityId, role, method, reason })`.

**Channel owner scopes** (the payload is rebuilt, so nothing else rides along):

| Method | Rebuilt payload | Rule |
| --- | --- | --- |
| `planAssetKit`, `createAssetKit` | `{ source: { kind: 'report', assetId }, deliverableIds }` (+ `onlyIfIdle: true` on create) | The asset must be a trend brief in the active workspace; deliverables are the channel's, minus pictures when pictures are off; no budget (the server uses the estimate cap). |
| `readStudioAsset`, `openStudioAsset` | `{ assetId }` | Their channel's kit file or a trend brief. |
| `saveAssetKitFolder` | `{ runId }` | A kit run that includes their channel; the export is filtered to their channel. |
| `cancelStudioRun`, `retryStudioRun` | `{ runId }` (+ server cap on retry) | Only a set made for their channel alone, else `copy.sharedSet`. Retry cap: `min(1000, max(maxBudgetUsd, ceil(reservedUsd + 2 × unfinished)))`. |
| `setTrendAdoption` | `{ themeId, channelId: viewer.channelId, status, link?, note? }` | Their own channel only. |
| `setViewPrefs` | `uiMode` forced to `simple` | |

Editors' `saveResearchReview` is signed with the editor's name on the web. Results that return a kit run become
`publicKitRun`; `planAssetKit` and `readStudioAsset` results lose dollar fields, models, receipts and evidence.

**Error rewriting.** For editors and channel owners, errors that send people to Settings, keys or connections, or that
come from a provider (Claude, Anthropic, Codex, OpenAI, Apify: model ids, credit, billing, API errors), become one plain
line naming the admins: pictures → `askPictures`, Google Drive → `askDrive`, everything else → `askConnection`. A channel
owner's budget errors become `askBudget`. Refusals already written for people (a copy key in `code`) pass through.

**State projection.** `projectState(base, viewer, extras)` builds a new object with `viewer` and `team: { admins }`:
admins and editors get the full state plus `contentStudio.adoptionsByTheme`; a channel owner gets only `viewer`, `team`,
`settings: { uiMode: 'simple' }`, `keys: {}` and `contentStudio: { activeWorkspaceId, workspaces: [active],
capabilities: { imagesConfigured }, channelView }`; role `null` gets nothing but the viewer and admins. The Mac pushes
the projected state on every `state-changed`, so View as survives pushes. On the web each `/api/events` stream writes
`people.view(base, identity, session)`, memoised per state object and view key, and closes when its person signs out,
loses access or has their link replaced.

**The viewer** (`state.viewer`): who (`id, name, email, role, realRole, channelId, channelName, via, web, disabled,
memberSince`), preview (`preview, viewAs`), prefs (`uiMode, welcomedAt`), navigation (`nav, modes, hiddenPages,
allowed`), `askAdmin`, `channels` for real admins, and in a preview `roleAllowed`: the previewed role's methods. The
renderer shows a control when `can(viewer, method)` (`roleAllowed || allowed`) and runs it only when
`canRun(viewer, method)` (`allowed`); write buttons spread `writeProps(viewer)` so a preview shows them turned off with
the title "Buttons that change things are off in a preview." An admin previewing an editor therefore sees the editor's
screens as the editor does.

## Roles matrix

`methodRoles` in `src/shared/roles.json` is the source of truth; `test/roles.test.js` checks every method in
`studio-api-channels.json` appears exactly once.

| Methods | Admin | Editor | Channel owner |
| --- | :-: | :-: | :-: |
| `appMeta, state, contentCatalog, openSourceUrl, planAssetKit, createAssetKit, saveAssetKitFolder, readStudioAsset, openStudioAsset, cancelStudioRun, retryStudioRun, setViewPrefs` | yes | yes | yes, scoped |
| `setTrendAdoption` | yes (any channel, logged) | no | own channel |
| Research, reports, edits, Ask AI, Sheets, imports, scrapers, missions, exports (`publishStudioRun, startResearchRun, approveResearchThemes, decideResearchTheme, continueResearchRun, createContentRun, editStudioAsset, restoreStudioAsset, askHelp, …`) | yes | yes | no |
| Settings, keys, workspaces, brand knowledge and images, research programs and schedules, setup files, data folders, people, sign-in links, analytics, View as (`saveSettings, saveKey, saveResearchProgram, scheduleMission, selectContentWorkspace, getTeam, saveMember, createSignInLink, getTrendAnalytics, setViewAs, …`) | yes | no | no |
| Role `null` | `appMeta`, `state` only | | |

While previewing, only identity methods and `readMethods` run. The renderer hides pages per `hiddenPages`
(editors: settings, knowledge, analytics, people) and offers the layouts in `viewModes` (channel owners: Simple only).

## Identity and sign-in

`identity = { id, name, email, role, channelId, via, disabled, memberSince }`, `via` ∈ `desktop | password | proxy | link`.

- **Mac app**: always `{ id: 'local', role: 'admin', via: 'desktop' }`. View as lives in process memory and clears on quit.
- **Admin password** (web, `STUDIO_PASSWORD`): break-glass admin, `{ id: 'owner', name: 'Studio admin' }`. Sessions last 12 hours; each browser session keeps its own View as.
- **Company sign-in** (`STUDIO_TRUSTED_EMAIL_HEADER` + `STUDIO_ALLOWED_EMAIL_DOMAINS`): the member is found by email, case-insensitive. `STUDIO_ADMIN_EMAILS` is authoritative: a listed email is always an enabled admin (created or re-promoted at sign-in), shown as "Set by the server", and can't be changed in People. Unknown emails get role `null`. No sign-in links and no Sign out button: the proxy owns the session.
- **Personal sign-in link** (password mode only): `<origin>/#signin=<64 hex>`. The page reads the fragment, removes it from the address bar first, then posts `/api/login { linkToken }`. The server compares SHA-256 hashes timing-safely against every member, refuses expired links and disabled members, ends any session the browser arrived with, and starts a 30-day link session bound to the link id. Making a new link, turning the link off, disabling or removing the person ends every session that used it. Sessions are in memory, so a restart signs people out (they reopen their link).
- **Effective role**: View as only lowers a real admin's role (`editor` or `channel` + channelId); `admin` clears it. A demoted admin's old View as is ignored.

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
2. Restart, sign in as an admin, and add editors and channel owners in **People & roles** (one channel each).
3. In password mode, send each person their sign-in link.
4. Announce the studio's address.

**Recovery**: add your email to `STUDIO_ADMIN_EMAILS` and restart; in password mode the admin password always signs in
as an admin.

## Data model and member lifecycle

`content-studio/team.json` (next to `state.json`, in the folder the owner lock protects), version 1:

```json
{ "version": 1,
  "members": [{ "id": "member-<uuid>", "name": "", "email": "", "role": "admin|editor|channel", "channelId": null,
                "disabled": false, "createdAt": "", "updatedAt": "", "createdBy": { "id": "", "name": "" }, "lastSeenAt": "",
                "link": { "id": "", "hash": "<sha256>", "createdAt": "", "expiresAt": null, "lastUsedAt": "" } }],
  "adoptions": [{ "id": "adoption-<uuid>", "workspaceId": "", "themeId": "", "channelId": "", "status": "using|not-using",
                  "link": "", "note": "", "trendName": "", "by": { "id": "", "name": "" }, "at": "", "updatedAt": "" }],
  "activity": [{ "id": "", "workspaceId": "", "at": "", "by": { "id": "", "name": "" },
                 "kind": "trend-decision|adoption|kit-created|report-edited|report-restored|member-changed|link-issued|research-started", "detail": {} }],
  "prefs": { "<identity id>": { "uiMode": "simple|classic", "welcomedAt": "" } } }
```

- Loaded once, written through on every change (temp file, fsync, rename). Synchronous end to end; one process owns the
  folder, so no horizontal scaling. Answers and decisions are last-write-wins, and the UI shows who answered.
- A missing file is an empty team (created on the first write); an unreadable file or a newer version refuses to start.
- `lastSeenAt` is written at most every 5 minutes per member; activity keeps the newest 5,000 rows.
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
| `getTeam` | `team:list` | — | `{ members, channels, signIn: { web, sso, links, linkDays } }` | admin only |
| `saveMember` | `team:save-member` | `{ id?, name, email, role, channelId, disabled }` | `{ member }` | name, role, email (unique; required on the web), channel; `selfChange`, `lastAdmin`, `serverAdmin` |
| `removeMember` | `team:remove-member` | `{ id }` | `{ ok: true }` | `selfChange`, `lastAdmin`, `serverAdmin`, 404 |
| `createSignInLink` | `team:sign-in-link` | `{ id }` | `{ url, expiresAt }` | `linksWebOnly` on the Mac; 400 with company sign-in; 409 for a disabled person |
| `revokeSignInLink` | `team:revoke-link` | `{ id }` | `{ ok: true }` | 404 |
| `setViewAs` | `team:view-as` | `{ role, channelId? }` | `{ viewer }` | admin (real role) only; 400 for an unknown role or channel |
| `setViewPrefs` | `team:prefs` | `{ uiMode?, welcomedAt? }` | `{ viewer }` | allowlist only |
| `setTrendAdoption` | `team:adoption` | `{ themeId, channelId?, status: 'using'\|'not-using'\|'clear', link?, note? }` | `{ adoption \| null }` | 404 unless the trend's brief is ready; `badLink`; note ≤ 500 |
| `getTrendAnalytics` | `team:analytics` | `{ days?: 7\|30\|90\|365, includeAll? }` | see Analytics | admin only |
| `editStudioAsset` | `studio:editStudioAsset` | `{ assetId, markdown, baseEditedAt }` | `{ asset }` | 409 `editConflict`; pictures and landing pages; 250,000 characters |
| `restoreStudioAsset` | `studio:restoreStudioAsset` | `{ assetId }` | `{ asset }` | text assets only |
| `createAssetKit` (channel owner) | `studio:createAssetKit` | scoped, `onlyIfIdle` | `publicKitRun` | 409 `alreadyMaking`, `outOfScope` |
| `startResearchRun` | `studio:startResearchRun` | `{ programId, datasetIds, again? }` | the run | 409 `researchRunning` unless `again: true` |

HTTP: `/api/login` (`{ password }` or `{ linkToken }`; 401 `{ error, signIn: 'link-invalid' }`), `/api/session`
(`{ ok, user, signOut, viewer: { name, email, role, channelId, disabled } }` with the real role), `/api/events`
(projected state; 403 for role `null`), `/api/upload` (admins and editors). Lower-case error codes travel to the page as
`code`.

## Adding things

- **A method**: add it to `studio-api-channels.json` (and preload), register its handler (the gate wraps it), and put
  it in exactly one `methodRoles` group (`test/roles.test.js` fails otherwise). Add it to `readMethods` only if it never
  writes. If a channel owner may call it, add a scope in `access.js` `SCOPES` that rebuilds the payload, and a result
  projection in `RESULTS`. Gate the renderer control with `can()` and spread `writeProps(viewer)` on write buttons.
- **A role**: add it to `roles`, `methodRoles`, `simpleNav`, `hiddenPages`, `viewModes`, `effectiveRole` (what View as
  may lower to), `projectState` (what it receives), `ROLE_LABELS` in `viewer.js`, and People's role cards.
- **A channel**: add the folder to `KIT_FOLDERS` with `semrushShort` and `generalShort`; ids are permanent because
  members, answers and analytics store them.

## Analytics definitions

All windows are UTC, over the last `days`. `readyTrends` (channel-view.js) is the single "brief is ready" rule.

- **decision** comes from the newest research run that recorded a decision for the theme (approved or passed); a ready theme with no recorded decision counts as approved; otherwise `pending`. **decidedBy** comes from `decisionsBy` ("Not recorded" when missing).
- **trendsFound / approved / passed / pending**: themes first detected in the window.
- **briefsReady**: ready themes whose `readyAt` is in the window. Matrix rows are these; `includeAll` adds found themes that aren't ready.
- **ownerSince**: the earliest owner's `createdAt`; **offered**: `readyAt ≥ ownerSince − 14 days` (false with no owner).
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

A channel owner's kit run message comes from a fixed set: "Starting…", "Writing N of M…", "All N files are ready.",
"Some files didn’t finish. Try again.", "Stopped." and "Ask an admin: the AI connection needs attention." (with
`needsAdmin: true`, when only an admin can fix it, so the card offers no retry).

## Test map

| Area | Tests |
| --- | --- |
| Policy, viewer, projection | `test/roles.test.js` |
| Gate logic, scopes, result projection, error rewriting | `test/access.test.js` |
| The real main process on the web runtime and the Mac (sync gate, View as pushes, Codex env) | `test/roles-gate.test.js` |
| Provider errors through the real gate (scripted Claude CLI) | `test/roles-errors.test.js` |
| team.json | `test/team-store.test.js` |
| Channel view and `readyTrends` parity with the trend board | `test/channel-view.test.js` |
| Analytics definitions | `test/team-analytics.test.js` |
| Attribution, edits, Drive after an edit, kit exports, retries | `test/content-workspace-roles.test.js` |
| Edited-report HTML | `test/markdown-html.test.js` |
| Server: sign-in, links, limits, streams, projection | `test/studio-server.test.js`, `test/web-host.test.js`, `test/web-runtime.test.js` |
| Secrets and the AI's environment | `test/web-secrets.test.js`, `test/cli-env.test.js` |
| Renderer | `test/app-roles.test.jsx`, `test/studio-sidebar.test.jsx`, `test/channel-owner.test.jsx`, `test/analytics-view.test.jsx`, `test/people-view.test.jsx`, `test/asset-editor.test.jsx`, `test/role-screens.test.jsx`, `test/web-signin.test.jsx` |

## Known limits and open questions

- One channel per owner (`channelIds: []` would be the change). Several owners may share a channel.
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
