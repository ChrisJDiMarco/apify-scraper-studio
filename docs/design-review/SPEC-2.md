# Studio redesign, wave 2: prompts, access, navigation, marketing team

> **Status: historical design record.** Written for the redesign in commit `eaa700d` (2026-10-17). The code,
> [`HANDOFF.md`](../../HANDOFF.md), [`ARCHITECTURE.md`](../../ARCHITECTURE.md) and
> [`docs/roles-and-access.md`](../roles-and-access.md) are current; where they disagree with this file, they win.

This spec builds on [`SPEC.md`](SPEC.md) (wave 1), and every ground rule in SPEC.md still applies. Wave 2 covers four requests:

- Admins, and editors when allowed, can see and change every prompt behind research, reports and assets. They can ask Ask AI about a prompt and have it update one.
- Admins set people, roles and each role's access.
- A redesigned left navigation.
- A UX pass for a Semrush marketing team that uses the studio every day.

The code-audit notes this spec was written from were working files and are not in the repo. This spec, together with
[`docs/roles-and-access.md`](../roles-and-access.md) for the access model, is the design record.

## Decisions (made; don't reopen)

- **Who can change prompts.** Editors can see and edit prompts by default, because the request covers both admins and editors. Admins can:
  - **lock** a single prompt so only admins can change it;
  - turn **Edit AI prompts** off for any role or person.
- **Prompt edits never break the output contract.**
  - Only the instruction blocks are editable. Scaffolding, data sections and schemas stay fixed and are shown read-only, each with a reason.
  - Every save is validated: required `{{variables}}` and required terms must be present, and no reserved markers or secrets are allowed.
  - Saves are versioned, attributed and reversible.
  - With no overrides, every prompt is **byte-identical** to the one before this change. A golden-output script proves this.
- **Prompts are snapshotted per run.** A run records the prompt versions it started with, so a mid-run edit can't change it. A retry may opt in to the newer prompts.
- **Access is a capability model.** `roles.json` maps every method to exactly one capability.
  - Capabilities are granted per role and adjusted per person: grants and denies, and **deny wins**.
  - Custom roles are supported. Each is built on the editor base or the channel base; there is no second admin type.
  - **Locked admin-only capabilities can never be granted**: Settings and connections, People and access (including role policy), and prompt locking.
  - The server enforces all of this. The UI only hides.
  - With no edits, the method sets are identical to today's (admin 140, editor 100, channel 13, plus the new methods).
- **Costs.** Any editor-base role that can spend money also gets **See costs**. A role without See costs never receives money fields; `projectState` strips them.
- **The sidebar's "Admin" group becomes "Studio".**
- **Nothing paid runs without a click and an estimate**, including prompt test runs and Ask AI prompt edits. Ask AI edits are free, but they still need an Apply click.

## New methods (plumbing is added before agents start)

| Method | Channel | Capability | Read? |
|---|---|---|---|
| listPrompts | studio:listPrompts | viewPrompts | yes |
| readPrompt | studio:readPrompt | viewPrompts | yes |
| previewPrompt | studio:previewPrompt | viewPrompts | yes |
| diffPromptVersions | studio:diffPromptVersions | viewPrompts | yes |
| estimatePromptTest | studio:estimatePromptTest | viewPrompts | yes |
| savePromptVersion | studio:savePromptVersion | editPrompts | no |
| revertPrompt | studio:revertPrompt | editPrompts | no |
| testPrompt | studio:testPrompt | editPrompts (spends) | no |
| setPromptLock | studio:setPromptLock | settings (locked admin) | no |
| setAssetStatus | studio:setAssetStatus | editReports | no |
| saveRolePolicy | team:role-policy | manageAccess (locked) | no |
| saveRole | team:save-role | manageAccess | no |
| deleteRole | team:delete-role | manageAccess | no |
| saveMemberAccess | team:member-access | manageAccess | no |
| inviteMembers | team:invite | manageAccess | no |
| readAccessLog | team:access-log | manageAccess | yes |
| previewAccess | team:preview-access | manageAccess | yes |

- `studio:*` methods are content-workspace api methods, auto-registered through `studioMethods`.
- `team:*` handlers live in index.js next to the existing `team:*` handlers.

---

## A. Prompt Library

### Files
- `src/shared/prompt-registry.json` (main and renderer): `{ version, groups:[{ id, label }], prompts:[Prompt] }`.
  - `Prompt = { id, name, group, description, powers:[string], stage, editions:['semrush','general'], ai:{ stage, outputTokens }, blocks:[Block], enforced:[string], viewOnly:[{ label, reason }] }`
  - `Block = { id, label, help, editable:boolean, reason, variables:[{ name, description, example }], requiredVariables:[string], requiredTerms:[string], maxChars, lines:{ min, max }|null }`
  - Groups, in order: Research · Reports · Channel assets · Pictures · Assistant · Data tools · Behind every call.
- `src/shared/prompt-defaults.json` (main only): `{ [promptId]: { [blockId]: { all?:string, semrush?:string, general?:string } } }`.
- `src/shared/prompt-samples.json`: small synthetic fixtures for the free preview. Placeholder people only.
- `src/shared/prompt-template.js` (CommonJS, pure):
  - `fill(template, vars)`: one pass, values inserted raw.
  - `blocksFor(promptId, editionId, given)`
  - `validateBlocks(promptId, editionId, blocks)` returns `[{ blockId, message }]`.
  - `lineDiff(a, b)`
  - `hashOf(text)`
  - trace markers for the preview.
- `src/main/prompt-store.js`: `createPromptStore({ root, registry, defaults, now })`, rooted at `dataPath('content-studio', 'prompts')`.
  - Storage is per workspace and per edition: `prompts/<workspaceId>/<promptId>.json` = `{ version, locked, blocks (only those that differ from the default), defaultHashes, history:[{ version, at, by:{ id, name, role }, source:'library'|'ask-ai'|'restore', note, blocks, conversationId }], tests:[...] }`.
  - Methods:
    - `summary(workspaceId)`
    - `read(workspaceId, editionId, id)`
    - `save(…, { blocks, expectedVersion, note, by, source, conversationId })`: refuses on a version conflict (409), a locked prompt edited by a non-admin (403), or failed validation (400 with problems).
    - `revert`
    - `diff`
    - `setLock`
    - `snapshot(workspaceId, editionId, ids)`
    - `effective(workspaceId, editionId, id)`
    - `recordTest`
    - `purgeWorkspace`
- Builders are refactored to read editable blocks through `blocksFor`:
  - `research-prompts.js`: discovery, synthesis, matching, tagging, repair (view-only)
  - `research-reports.js`: trends report, editorial toolkit
  - `content-studio.js`: shared content rules, per-deliverable instruction, picture direction, content image
  - `asset-kit.js`: kit picture brief, kit image variation
  - `help-assistant.js`: Ask AI identity, how to answer, trend memory, pictures
  - `findings-chat.js`: Ask your datasets
  - `analysis.js`: dataset report presets
  - `claude-runner.js`: the system prompt, view-only
- **Goldens.** Before refactoring, `scripts/prompt-goldens.mjs` renders every builder with fixed fixtures into `test/fixtures/prompts/*.txt`. After refactoring, the same script with `--check` must report zero differences. This is a build-time script, not a test run. `test/prompt-golden.test.js` wraps the same check for CI.

### Runs
- New research, report, kit and Create content runs store `input.prompts = snapshot(...)` and `run.prompts = { [id]: { version, custom } }`. Builders read from the snapshot.
- `retryStudioRun({ runId, maxBudgetUsd, refreshPrompts })` re-snapshots only when asked, and only for unfinished stages.

### API (content-workspace)
- `listPrompts()` returns `{ groups, prompts:[{ id, name, group, description, powers, version, custom, locked, updatedAt, updatedBy, defaultChanged }] }`.
- `readPrompt({ id })` returns `{ prompt (registry entry), blocks (effective), defaults, version, locked, history (last 50, newest first), model, effort, route }`.
- `previewPrompt({ id, blocks?, sample:'latest'|'bundled' })` returns `{ text, segments:[{ start, end, blockId }], chars, tokens, estimateUsd, sampleLabel, problems }`. Free.
- `diffPromptVersions({ id, from, to, draft? })` returns `{ blocks:[{ blockId, label, lines:[{ op:'same'|'add'|'del', text }] }] }`.
- `savePromptVersion({ id, blocks, expectedVersion, note, source?, conversationId? })` returns `{ version, prompt summary }`.
- `revertPrompt({ id, toVersion, expectedVersion, note })`
- `estimatePromptTest({ id, blocks?, sample })` returns `{ model, effort, route, estimateUsd, capUsd, metered, fingerprint }`.
- `testPrompt({ id, blocks?, sample, fingerprint })` runs the real stage with its real validator. It returns `{ ok, problems, output, receipt }` and saves only a test record. It is cancellable and refuses when the fingerprint is stale.
- `setPromptLock({ id, locked })`
- The author comes from `who()` plus the caller's role, passed in from index.js.

### UI: Prompts page (`prompt-library.jsx` + `.css`)
- **Where:** in the sidebar's Studio group for admins, and for editors who hold viewPrompts. Its data-spot is `nav.prompts`, and it works in both layouts.
- **Left pane:** search, then prompts grouped by registry group. Each row shows the name, a "Used for" line, and badges: Customized · vN · who · when, Default updated, Locked.
- **Right pane header:** the prompt's name, its description, and "Runs on <model> · <effort>" (or "Codex: not metered"). It also has a button: **Ask AI about this prompt**.
- **Tabs:**
  - **Edit:** the prompt in layout order.
    - Fixed parts are grey rows with a lock and their reason.
    - Data parts read "Post data from the run goes here".
    - Editable blocks have variable chips (click to insert), live checks, and a Reset this block button.
    - A "Rules the studio enforces" panel lists the enforced checks.
    - Saving needs a note and creates a new version.
  - **Preview:** a sample picker; the rendered prompt with editable spans highlighted; characters, tokens and estimated cost; and **Test run…**, which confirms the estimate, model, route and cap before it runs.
  - **History:** versions showing who, when, source and note. Each version can be compared with the previous one or with the default, or restored (restoring creates a new version). Admins also get a Lock switch here.
- Editors on a locked prompt see it read-only, with "Locked by an admin".

### Ask AI
- New lookup kind: `prompt` (target = prompt name or id).
- New action kind: `edit-prompt`, with `prompt:{ promptId, blockId, text, note }`. *(Since `62cb9da` the model writes one top-level `edit` object `{ ref, part, text, note }` instead, shared with `edit-report`; see SPEC.md ground rules on schema size.)*
- New card type: `prompt-change`, with `data = { promptId, promptName, blockId, blockLabel, version, diff:[{ op, text }], problems:[string], canApply:boolean, locked }`.
- Prompt rules:
  - Answer about prompts only from a prompt lookup.
  - Offer at most one edit per reply.
  - Never claim a prompt was changed.
  - Keep every required placeholder.
  - If the prompt is locked and the person is an editor, tell them to ask an admin.
- On the card, **Apply as version N** calls `savePromptVersion({ …, source:'ask-ai', conversationId })` and records the outcome. **Open in Prompts** navigates to the prompt.
- `edit-prompt` actions and cards appear only for people who can call `savePromptVersion`.

---

## B. People, roles and access

### Model (`roles.json`)
- `capabilities`: `[{ id, label, description, group, methods:[], defaults:[roleIds], bases:['editor','channel'], spends?, requires?:[ids], lock?:'admin'|'always', projection?:'money' }]`. These replace `methodRoles`. Every method sits in exactly one capability.
- The capability list and its groups:

| Group | Capabilities |
|---|---|
| Everyone | core |
| Research | readResearch, startResearch, quickScans, approveTrends |
| Reports and channel assets | readAssets, writeReports, editReports, makeAssets, manageRuns, markTrendsUsed |
| AI and prompts | askAi, viewPrompts, editPrompts |
| Data and exports | sheets, dataTools, deleteScrapers, exportPublish |
| Studio setup | seeCosts, managePrograms, editBrand, manageWorkspaces, seeAnalytics |
| Admin only (locked) | settings, manageAccess |

- `channelSafeMethods`: a channel-base role can only ever call these methods.
- `pages`: maps each page to its capability. Nav and hidden pages are derived from capabilities.
- `roleTemplates`: Viewer, Analyst and Channel reviewer.
- New copy strings: capabilityOff, lockedCapability, notForChannelRoles, needsCapability, policyConflict, adminAccess, roleInUse, roleName, roleBase.

### Enforcement (`roles.js`, `access.js`)
- `compilePolicy` → `capabilitiesFor({ roleId, grants, denies })` → `methodsFor(base, caps)` → `canCallAs`, as specified in the access notes:
  - deny always wins;
  - locked capabilities and capabilities outside the role's base are dropped;
  - requirements are closed, so a capability missing a prerequisite is removed.
- `refusalFor` returns plain copy.
- `buildViewer` adds `base`, `roleLabel` and `capabilities`, and derives nav and hidden pages.
- `projectState` strips money fields when the role lacks seeCosts.
- Existing behaviour is preserved with no policy edits.

### Store (`team-store.js`, v2 migration)
- Members gain `grants` and `denies`.
- New fields on the store: `roles:[{ id, label, description, base, capabilities, createdAt, by }]`, `rolePolicy:{ rev, builtIn:{ editor:{ grant, deny }, channel:{ grant, deny } } }`, and `audit:[…]` (a ring of 2,000 entries).
- Adoptions gain `plannedFor` (an ISO date), for the calendar in section D.
- Prefs gain `inboxSeenAt`, `focusChannels:[channelId]` and `navRail:boolean`.
- `src/main/access-log.js` turns audit rows into sentences.

### UI: People & access (`people-view.jsx` and new parts)
- **Tabs:** People · Roles · Access log. The open tab is remembered.
- **People tab:**
  - A channel-coverage strip.
  - Toolbar: search, plus Role, Status, Channel and Sort filters.
  - A table of people: avatar, name, email, role, custom-access chip, channel, last active and sign-in status, each with a row menu.
  - The **Person sheet** has four tabs: Details, Access (a three-way control per capability: Role default · On · Off, with locked rows explained), Sign-in, and Activity.
  - **Invite people:** paste emails, choose a role and channel, and optionally adjust access. The result shows links or a message, depending on sign-in mode.
- **Roles tab:**
  - A capability matrix with roles as columns (Admin is locked) and capabilities as rows, grouped. Cells are accessible switches.
  - Dependency cascades show inline notes.
  - **+ New role** starts from a template.
  - A dirty bar shows "N changes · affects M people" and leads to a review, then one save.
  - Below 860px the matrix shows one role at a time.
- **Access log tab:** filters, sentence rows, Load older, Download CSV.
- **Preview as** works for any role, custom role or person.
- On the Mac, sign-in links are hidden, but roles and the access log still work.

---

## C. Left navigation (`studio-sidebar.jsx` rewrite, `nav-model.js`, `studio-sidebar.css`)

### Structure, every role and layout
- **Head:** wordmark, collapse button (⌘\\), and workspace switcher. The switcher shows the workspace tile, name, role and layout. Its popover lists workspaces and **New workspace** (admin only).
- **Actions:**
  - **New**: a menu (⌥⌘N) with Find new trends, Quick scan, Channel assets, Content from a report and Picture, plus Research program, Person and Workspace for admins.
  - **Search…** (⌘K)
  - **Ask AI** (⌘J): navigates in Simple, opens the drawer in Advanced.
- **Groups:**
  - **Simple:** Home · Trends (badge: needs your OK) · Reports · Assets (live dot) · Inbox (unread badge) · Calendar.
  - **Advanced:**
    - **Research:** Home · Research programs · Trend board · Sheets
    - **Content:** Create content · Library · Brand knowledge
    - **Data tools:** collapsible and remembered; sub-labels Collect / Analyze / Automate, plus Activity
  - **Studio** (admin, and whatever capabilities allow): Prompts · Analytics · People & access · Settings. Settings shows an amber dot when Apify is missing.
- **Footer:**
  - A **Working** button (only while runs are live) that opens a popover of live runs with Open and Stop.
  - A Simple | Advanced switch.
  - An **account** menu: View as (radio list), My channels, Keyboard shortcuts, Sign out.
- **Rail mode** (icon-only): 64px wide, with tooltips, sr-only labels and badges shrunk to dots. The choice is saved in the person's prefs (`navRail`), with localStorage as a fallback. It is the default at 861–1100px.
- **Channel owners:** Trends · My assets · My plan. No New, Search or Ask AI unless their capabilities allow them.
- **Keyboard shortcuts:**

| Keys | Action |
|---|---|
| ⌘1–9 | Pages, in nav order, in every layout |
| ⌘K | Search |
| ⌘J | Ask AI |
| ⌘, | Settings |
| ⌘\\ | Collapse the sidebar to a rail |
| ⌥⌘N | New |
| Esc | Close the open menu |

  A Keyboard shortcuts dialog lists them all.
- **Badges** count only work waiting on this person. Dots mark live work. The aria-labels say it in words.
- **Visual:** built on the `--s-*` tokens. One saturated element, the New button. The active state is a soft background with a 3px accent bar. Rows are 36px (44px on coarse pointers). Dark-mode tokens are defined. Legacy sidebar CSS is scoped or removed.
- The Advanced Header drops its Ask AI and Search buttons, which now live in the sidebar. It keeps the breadcrumb (workspace name › page), working status and Refresh.
- `nav-model.js` (ESM, pure): `buildNav({ viewer, layout, state, counts, edition })` → `{ groups:[{ id, label, collapsible, items:[{ id, label, icon, shortcut, badge, live, warn, spot }] }], actions, footer }`. Both the sidebar and the palette use it.

---

## D. Marketing team refinements

1. **Weekly briefing as Home, in both layouts** (`weekly-briefing.jsx`)
   - Title: "This week in <workspace>".
   - Cards: Needs your OK (inline Yes/Skip for the top 3), What changed (`WhatChanged`), Ready for channels (with Using / No answer chips per channel), Shipped (adoptions with links), and Working now.
   - **Copy briefing for Slack** copies Markdown.
   - Empty state: "Quiet week so far."
   - Advanced Home is the same briefing; the campaign hero is removed.
2. **Approve with a note and route to channels.**
   - Yes gets a caret menu with "Yes, with a note…". It opens a sheet with channel chips (default All channels) and a note field.
   - `decideResearchTheme` accepts `{ note, channels }` and stores them in `run.decisionsBy[themeId]`.
   - Channel views show "Suggested for Social by Riley: '…'" and get a "For us" filter.
   - Analytics counts a channel as offered only when the trend was routed to it, or routed to all channels.
3. **Who decided** ("Approved by Riley · Oct 14") appears on Simple trend cards, Trend board cards and the channel brief. The vocabulary pass also covers Analytics: "Skipped" and "Needs your OK".
4. **Share links:**
   - Hash routes `#/report/<assetId>`, `#/trend/<themeId>`, `#/assets/<sourceKey>` and `#/prompt/<promptId>`, resolved after sign-in.
   - **Copy link** in the report reader, Library, the channel brief and Prompts.
   - On the Mac, Copy link appears only when a "Studio web address" is set in Settings.
5. **Google Docs handoff from the reader:**
   - **Save to Google Docs** when Drive publishing is configured.
   - Otherwise **Copy for Google Docs**, rich HTML through ClipboardItem.
   - **Copy as slide outline**.
6. **Empty states that teach**, on Trends, Home, the channel owner views and Analytics. The copy is in the notes.
7. **Inbox** (every role):
   - Derived on the client from state: trends needing an OK, channel adoptions, edits to reports, finished or stopped runs, and prompt changes.
   - An unread badge from `prefs.inboxSeenAt`, and **Mark all read**.
   - Each row opens its target.
8. **Content status pipeline:**
   - Assets move through Draft · In review · Approved · Scheduled · Published (`setAssetStatus`).
   - The status chip is a menu on Library rows, Assets files and channel My assets.
   - Choosing Published asks for the live link and sets the channel adoption to Using, with that link.
   - Library and Assets get a status filter.
9. **Why it matters, on trend cards:** novelty, MomentumBadge, "Seen in N runs", and two short real posts. *(Built as **Show 2 real posts**, a free read through `readTrendPosts`, plus **Ask AI for more**.)*
10. **My channels focus:**
    - People choose their channels in the account menu (`prefs.focusChannels`).
    - Assets opens on those channels, Make channel assets pre-ticks their deliverables, trend cards say "Fits Social", and the briefing gains a "Ready for your channels" section.
11. **Calendar** (admins and editors) and **My plan** (channel owners):
    - After "Yes, I'm using this trend" comes an optional "Planned for <date>" (`setTrendAdoption` plannedFor).
    - The calendar shows weeks × channels.
    - **Download .ics** and **Copy week as a table**.
12. **Brand check in the report editor:**
    - Local, deterministic checks: claims to avoid, Title Case headings, spelling rules, and numbers without a source.
    - The result reads "2 things to check" and never blocks Save.
    - An optional **Ask AI to review the voice** button.
13. **Marketer actions on a report:** "Ask AI about this" becomes a menu: Summarize for Slack · 3 headline options · PR pitch angle · What would we need to prove this? · Next steps for my team.
14. **How this was made**, a collapsible footer on every report: post counts per platform, the window, the program, the model, and the custom prompts it used (linked to Prompts).
15. **Costs only where they help a decision.** Analytics gets an admin-only **Spent this month** tile, program cards get "Last run: $X", and wherever costs show there is a Codex note: "AI spend isn't reported on Codex".
