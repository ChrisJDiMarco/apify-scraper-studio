# Restructure plan: one page per thing (Nov 11, 2026)

Branch: `restructure-nov-11`, cut from `main` at `63667f6`. Recovery tag: `before-restructure-nov-11`.
Source: the Nov 10 UX review (proposals 3.1 to 3.11) and the follow-up discussion on Nov 11.

## What was asked

Make the app coherent: organise it around the things people work on, remove or merge superfluous tabs, and make the
pipeline read as one thing. Do it on a branch so today's app can be recovered.

## The design in one paragraph

Four objects each get exactly one page: a **trend**, a **research program**, a **channel** and a **file**. Everything
that configures the studio moves to one **Studio setup** page. One module decides a trend's stage and its next step, and
every card and page uses it. The sidebar shrinks to Home, Programs, Trends, Files, Calendar, Studio setup.

## Settled

- Scope is the unified layout (the Semrush edition and the browser studio). The General edition's layout and the
  channel-owner layout keep working; they adopt new pages only where noted.
- Old addresses keep working by redirecting to the new ones. Nobody's saved link breaks.
- Access rules don't change. A page hides what the viewer's role can't call, as today (`viewer.js`, `can`).
- No data migration. `state.json` keeps its shape; this is a renderer restructure.
- One branch, one commit per step, each step leaves tests, lint and the web build green.

## My calls (easy to overturn)

1. Channel owners keep their Inbox; for everyone else Inbox becomes the "Needs you" block on Home.
2. Workbench tools are hidden in the Semrush edition behind an admin setting "Show data tools" (default off), and stay
   findable in ⌘K when on.
3. Analytics stays as one page under Studio setup ("Spend & adoption"); its per-trend and per-channel parts also appear
   on the trend and channel pages.
4. Calendar draws the four-week grid with scheduled research runs and planned assets. Drag-to-plan is not in this work.
5. Ask AI becomes a docked panel in every layout; `#/ask` stays as conversation history.

## Will not do

Notifications, delete/archive, rewrite-with-a-note, review hand-off, drag planning, results tracking (review section 4).
No visual redesign beyond what the new pages need. No server or data-model changes.

## New addresses

| New | Shows | Old addresses that redirect here |
| --- | --- | --- |
| `#/trend/<themeId>` and `#/trend/<themeId>/<overview\|report\|toolkit\|assets>` | Trend page | `#/report/<assetId>` when the asset belongs to a trend (to its Report or Toolkit tab); `#/assets/theme:<id>` (Assets tab) |
| `#/files` | Table of every file | `#/assets` |
| `#/programs/<id>/<runs\|sources\|schedule\|budget\|ai\|automation\|advanced>` | Program page | `#/programs/<id>` (Runs); `#/programs/<id>/edit/<section>` (`basics`→runs header edit, `when`→schedule, `budgets`→budget, others same name) |
| `#/setup/<section>` | Studio setup | `#/studio/<prompts\|channels\|people\|knowledge\|analytics>`, `#/settings/<section>` |
| `#/setup/channels/<channelId>` | Channel page | none |
| `#/home` | Home with Needs you | `#/inbox` (not for channel owners) |

`#/report/<assetId>` for a report with no trend keeps opening the standalone reader.

## Files

New:
- `src/renderer/src/trend-stage.js`: `stageOf(card, ctx) → { id, label, tone, next: { id, label, disabled, why } | null }`.
  Stage ids: `needs-ok`, `approved`, `writing`, `report-ready`, `making-assets`, `assets-ready`, `skipped`, `stopped`.
  Pure; wraps the logic now spread across `next-steps.js`, `simple-mode.jsx` (SimpleTrends) and `channel-owner.jsx`.
- `src/renderer/src/trend-page.jsx`: `TrendPage({ themeId, tab, ... })` with header (name, strength, sources, program,
  stage chip, one next-step button) and tabs. Overview is new; Report and Toolkit embed the reader from
  `simple-reports.jsx`; Assets embeds the folder view from `simple-assets.jsx`.
- `src/renderer/src/trend-card.jsx`: the one trend card (from `channel-owner.jsx` TrendCard), used by Trends and Home.
- `src/renderer/src/files-view.jsx`: `FilesView` table: title, channel, type, status, trend, date; filters; row opens
  the file in its trend's Assets tab.
- `src/renderer/src/program-page.jsx`: header (name, schedule, last run, estimate, Run now) and tabs; each tab renders
  one group of `ProgramEditorFields` and saves on its own with an unsaved-changes bar.
- `src/renderer/src/studio-setup.jsx`: one frame with a left sub-menu; sections are the existing Brand knowledge,
  Channels, Prompts, People, Analytics and the Settings sections from `settings-sections.js`.
- `src/renderer/src/channel-page.jsx`: channels table (owner, filled-in %, last edited) and one channel's page (voice
  form from `channel-settings.jsx`, owner, its prompts, its adoption numbers).
- `src/renderer/src/ask-dock.jsx`: the docked Ask AI panel (wraps `help-assistant.jsx`).
- Tests beside each: `test/trend-stage.test.js`, `test/trend-page.test.jsx`, `test/files-view.test.jsx`,
  `test/program-page.test.jsx`, `test/studio-setup.test.jsx`, `test/channel-page.test.jsx`.

Changed:
- `deep-links.js`: new routes and redirects above; `parseRoute` / `hashForRoute` stay the only place addresses are built.
- `nav-model.js`: unified sidebar becomes Home, Programs, Trends, Files, Calendar, Studio setup; Workbench behind the
  setting; `PROGRAM_SECTIONS` items leave Workbench.
- `App.jsx`: route handling for the new pages; Settings and admin pages open inside Studio setup.
- `simple-mode.jsx`: Trends uses `trend-card.jsx` and stage chips with counts; Home gets the Needs you block (rows from
  `inbox-model.js` and `next-steps.js`) and the one-line setup checklist.
- `simple-reports.jsx`, `simple-assets.jsx`: export their reader and folder bodies for embedding; toolbar shrinks to one
  row with a Share menu.
- `calendar-view.jsx`: always draws the grid; adds scheduled runs.
- `activity-view.jsx` + `studio-sidebar.jsx`: Activity opens from the working indicator; the page stays for General.
- `docs/app-guide.md`, the Ask AI prompt and its goldens, `palette-content.js`, spot ids (`nav.*`).

## Steps

Each step ends with: `npm test` green, `npm run lint` 0 errors, `npm run build:web` succeeds, and a headless walk of
the pages touched (method in the Nov 10 review) with screenshots saved to `docs/review/restructure/`.

1. **Stage module.** Write `trend-stage.js` and its test from the three existing implementations; switch
   `next-steps.js` to call it. Expected: existing next-step and inbox tests still pass unchanged.
2. **Trend page.** `trend-card.jsx`, `trend-page.jsx`, routes and redirects. Trends list uses the card and stage chips.
   Expected: opening a trend from Trends lands on `#/trend/<id>`; `#/report/<assetId>` of a trend report lands on its
   Report tab; the header button reads Approve, Write reports or Make channel assets by stage.
3. **Files.** `files-view.jsx`; sidebar item Assets → Files; `#/assets` redirects. Expected: every asset in the sandbox
   data appears once; filtering by channel narrows the rows; a row opens the file.
4. **Program page.** `program-page.jsx`; remove the seven Workbench items; old edit links redirect. Expected: each tab
   saves alone; leaving a tab with edits shows the unsaved bar; Run now starts the same call as today.
5. **Channel page and Studio setup.** `channel-page.jsx`, `studio-setup.jsx`; Brand, Channels, Prompts, People,
   Analytics and Settings open inside it. Expected: `#/studio/prompts` and `#/settings/models` land in the right
   section; the sidebar shows one Studio setup row.
6. **Home.** Needs you block, this week's trends, programs column, one-line checklist; `#/inbox` redirects for
   non-channel viewers. Expected: every row an admin's Inbox shows today appears under Needs you with its action.
7. **Activity and Ask AI.** Activity from the working indicator; `ask-dock.jsx` in every layout, ⌘J toggles it.
   Expected: the page narrows instead of being covered; "Ask AI about this" on a trend page opens the dock with context.
8. **Calendar grid.** Expected: an empty month still shows four weeks; a scheduled program appears on its day.
9. **Sidebar and frame.** Final sidebar, "Show data tools" setting, one page frame (same left edge and title size),
   no breadcrumb bar. Expected: six rows for an admin in the Semrush edition; titles start at the same x on every page.
10. **Guide and goldens.** `docs/app-guide.md`, Ask AI prompt, palette, spot list. Expected: prompt goldens
    regenerated and reviewed; no test asserts a page name that no longer exists.

## Where this breaks

- **A saved link stops resolving.** Caught by a table-driven test in the deep-links test: every old address in the
  table above maps to its new route.
- **A role sees a button it can't use, or loses a page it had.** Caught by rendering each new page as admin, editor and
  channel owner in tests, and by the role walk in the headless check.
- **The General edition or channel-owner layout regresses.** `nav-model` tests for those layouts must pass unchanged;
  walk both in the headless check at steps 2, 5 and 9.
- **Ask AI gives directions to pages that are gone.** Caught by the prompt goldens and the spot-id test in step 10;
  until then the guide lags the branch, which is why this is not merged before step 10.
- **Unsaved edits lost when switching program or setup tabs.** Caught by the unsaved-guard tests (`UnsavedContext`)
  extended to tab changes.

## After the cold read (Nov 11)

A second reader checked this plan against the code. What changed, all my calls:

1. **A trend page is one theme.** A recurring theme has one card per research run. `#/trend/<themeId>` opens the card
   today's rule picks (waiting first, then newest with reports); `?run=<runId>` picks another, from a run menu in the header.
2. **`trend-card.jsx` is built from the SimpleTrends row**, using board cards. The channel owner's `TrendCard` stays as
   it is (it renders server `channelView` rows the rest of the team doesn't have).
3. **Both editions get the new sidebar.** Everyone except channel owners is already on the unified layout. The General
   edition keeps Workbench visible because it has the `dataTools` capability.
4. **A program has one draft and one save bar across its tabs**, not a save per tab. Save sends the whole program and
   validation crosses groups, so per-tab saves would be a rewrite for no gain. Leaving the page with edits still warns.
5. **Program tab ids stay `basics, sources, when, budgets, ai, automation, advanced` in addresses**, plus `runs`. Labels
   are what change. "Research & report prompts" opens Studio setup › Prompts filtered to the program;
   `#/programs/<id>/edit/prompts` redirects there. The runs list and run detail move out of `content-studio-view.jsx`.
6. **TrendPage mounts inside SimpleMode**, which owns the reader and folder state. The route gets `trend` and `tab`
   ahead of `report`, so the address stays `#/trend/…`. A report's trend comes from its content run's `themeId`.
7. **Files with no trend open as they do today** (the standalone reader or folder). `#/assets/<key>` redirects only for
   `theme:` keys. Ask AI pictures are listed in Files from `useHelpImages`.
8. **One Ask AI instance**, hoisted to the frame, shared by the dock and `#/ask`.
9. **Studio setup has one "Settings" entry** that embeds the existing Settings page with its own sub-menu. People see
   only the sections their role already allows. `#/setup` must not collide with the `setup` settings alias: the
   alias is checked only under `#/settings/…`.
10. **Stage ids** map from the board: `potential`→needs-ok, `approved`→approved, `production`→writing or making-assets
    (by activity), `ready`→report-ready or assets-ready (by asset count), `passed`→skipped. `stopped` is a run state,
    shown on the card of each trend in that run. Write reports acts on the whole run; the button says so
    ("Write reports for this run").
11. **No new setting for data tools.** The existing `dataTools` capability and per-device toggle already do it.
12. **Role-gated data is shown only to roles that can load it**: per-trend adoption needs `getTrendAnalytics`; quotes
    load on demand with `readTrendPosts`; the channels table loads channel settings in one batch on open.
    Home shows "Needs you" (things to act on) and below it "Recent" (finished runs, edits, answers) with the unread dot.
    "Ask AI about this" on the trend page uses the existing drawer until step 7.

## Progress

- **Step 1, stage module: done.** `next-steps.js` keeps its own cross-trend rules (it ranks work across trends; the
  stage module describes one trend), so it was not switched over.
- **Step 2, trend page: done.** Differences from the plan: the page's address always names its tab
  (`#/trend/<id>/overview`); the bare `#/trend/<id>` share link keeps today's behaviour (the report when there is
  one, else Trends), because that link's handling of skipped and re-found trends is covered by tests worth keeping.
  Trends still lists trends in its sections; the stage chips with counts and the single card are not built yet.
  The embedded reader keeps its full toolbar (Make channel assets appears there and in the header).
- **Step 3, files: done as "All files"** on Assets (a third choice beside By trend and By research run, remembered per
  person). A trend's folder anywhere in Assets opens the trend page's Channel assets tab. Not done yet: making All
  files the default and renaming the sidebar item to Files; both wait for step 9 and 10, when the Ask AI tours that
  point at Assets folders are reworked.
- One test, `ask-store › caps messages per conversation`, failed once in a full run and passes alone and on `main`;
  it looks load-sensitive, not related to this work.
- **Step 4, program page: done.** `#/programs/<id>` is the program's Runs tab and `#/programs/<id>/edit/<section>`
  its settings tabs, on the Research programs page for anyone who has it. Edit, Runs and results, Ask AI's program
  cards and links all open it. One draft, one save bar. Not done yet: Workbench's seven "Edit research program" links
  still open the older editor (they name no program); they go away with the sidebar in step 9. A run's row opens the
  older run detail (review, results, Open in Sheets), which has not moved. The quick-edit drawer on Home is unchanged
  and duplicates the page's save logic; one of the two should go once Home is redone in step 6.
- **Step 5, Studio setup and channels: done, in a lighter form than planned.** Brand knowledge, Prompts, Channels,
  Analytics, People & access and Settings share one "Studio setup" section menu above the page (the sections this role
  has); each keeps its address, so nothing redirects. A top menu rather than a left one, because Settings already has
  its own left menu. Channels opens on a table of every channel (owner, knowledge filled in, prompts, last saved) with
  a line saying how many are empty or ownerless; a row opens the channel. Not done: a channel's own prompts and
  adoption numbers on its page, and `#/setup/…` addresses (the existing `#/studio/…` ones were kept instead).
  The sidebar still lists the six pages separately until step 9.
