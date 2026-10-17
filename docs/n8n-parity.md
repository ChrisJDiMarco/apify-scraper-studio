# n8n workflow ↔ Studio parity notes

Reference: the "Golden Thread" n8n workflow (239 nodes; Google Sheet "Internal NEW - Golden Thread Data Sheet" with tabs Theme Repository, Twitter, LinkedIn, Reddit, Theme Summary Data, Post Counts Reference, Trend Velocity, Taxonomy Lookup, Batch Analysis Log). The workflow JSON was shared on 2026-10-06; the 2026-10-07 port follows its nodes one by one.

Studio keeps the workbook local (Sheets view) and can download it as .xlsx or create a Google Sheet from it. Reports can be published as Google Docs through the Apps Script bridge.

## Phase 1 — Social scrape

| n8n node(s) | Studio | Status |
|---|---|---|
| `Config`: window = form Start Date, else the last 7 days; 3,000 posts per platform; 10 per author; over-fetch 1.5× | `resolveResearchWindow` + program `lookbackDays` (default 7), `targetPerPlatform`, `perAuthorCap` (`src/shared/research-program.js`) | ✅ Match |
| `[TW] Sources`: one `from:<handle> since:<date>` term per handle, `sort: Latest`, `maxItems` as a cost ceiling only | `xJobs` in `src/shared/research-collection.js`; handles split into runs of 5 (cheapest Apify item tier), 50 tweets per handle as the ceiling | ✅ Match (split is a cost optimization; per-author cap still applies after) |
| `[LI] Sources`: profile URLs stripped of `?…` with a trailing slash, `maxPosts` 15, `postedLimitDate` = start, no comments/reactions | `linkedinProfileJobs`; runs of up to 100 profiles | ✅ Match |
| `[RD] Sources`: `/r/<sub>/new/`, `maxPostCount` 300 per sub, `maxItems` 1.5 × target, `scrollTimeout` 90, `navigationTimeout` 60, comments off, residential proxy, NSFW off | `redditJobs`: same input object, except subreddits run in parallel groups of 6 (`redditSubsPerJob`), each with the full `maxItems`, and `scrollTimeout` is 300. On the first live run, n8n's 90s reached only 3–4 days back in busy subreddits (472 posts from 18 subreddits in 1h40m) | ⚠️ Deliberate change |
| Research topic | Guides the AI only. Collection is never filtered by it unless "Also filter account and community collection" is on | ✅ Match (n8n has no topic filter) |
| Launch all three Actors, then collect each lane | All lanes run concurrently; up to 4 Apify runs at once per lane (`studio-host.collect`) | ✅ Match |
| Server timeouts 20 / 90 / 120 min; client abort at 25 / 95 / 125 min | `LANE_TIMEOUTS` + `abortAfterSecs`; `waitForStartedRun` aborts gracefully at the deadline | ✅ Match |
| Any terminal status (FAILED, TIMED-OUT, ABORTED) still fetches the dataset | `runRecipe({ salvage: true })`; job marked `partial`, rows kept, warning on the run | ✅ Match |
| A failed poll keeps waiting | Up to 8 consecutive poll errors with back-off | ✅ Match |
| `Dedupe + Cap`: URL, then first 100 characters (whitespace removed) + author; window; newest first; ≤10 per author; stop at target | `prepareResearchEvidence` (author = X userName / LinkedIn publicIdentifier / Reddit username) | ✅ Match |
| `prevalence_score` formulas (LOG10, ROUND 2) | `engagementScore` | ✅ Exact match |
| Spend control | n8n has none; Studio gives each Actor a share of the collection budget weighted by its worst-case cost (never below the Actor's minimum charge) and shows the worst case before a run. Reddit's worst case is the smaller of `maxItems` and subreddits × `maxPostCount`, because each `/new/` listing stops at 300 posts | ➕ Studio addition |

## Phase 2 — AI theme identification

| n8n | Studio | Status |
|---|---|---|
| Prevalence filters: X > 40, LinkedIn > 25, Reddit > 15 | `thresholds.discovery` | ✅ Match |
| Per platform, 200-post batches, posts sorted by engagement inside the batch | `buildDiscoveryBatches` (per platform), `discoveryPost` + `batchEngagementScore` | ✅ Match |
| "Analyze <Platform> Batch" prompt (Opus 4.8): elite SEO data miner, zero noise, friction, emerging over evergreen, intent over keywords; up to 10 candidates with pain point, 5–8 semantic intent signals, evidence count, actionability | `discoveryPrompt` (`src/shared/research-prompts.js`), Claude Opus 5.5 by default | ✅ Match (current Opus); candidates also cite their evidence IDs |
| Every batch logged | Each batch result is cached; Sheets → Batch Analysis Log | ✅ Match |

## Phase 3 — Distilling the top six themes

| n8n | Studio | Status |
|---|---|---|
| Read Taxonomy Lookup | Workspace taxonomy (Brand knowledge → Research knowledge; import the Taxonomy Lookup tab or a spreadsheet) | ✅ Match |
| "Aggregate Batch Candidates": merge by name, union intent signals, sum evidence, taxonomy summary lines | `mergeCandidates`, `taxonomySummary` | ✅ Match |
| Synthesis prompt (Opus 4.8): exactly six themes, 3–6 word names (concrete subject + tension word), taxonomy categories, 12–15 keywords, match/negative criteria, content gap, recent trend | `synthesisPrompt`, `THEMES_SCHEMA`, `validateThemes` | ✅ Match (asks for six; fewer only if evidence can't support six) |
| "To Rows (6)": rank by name quality, cross-platform, evidence; hard cap 6 | `rankThemes` | ✅ Match |
| "Match Themes" agent vs Trend Velocity history with NAME QUALITY OVERRIDE | `matchingPrompt` + `validateThemeMatches` + `preferredThemeName` (a clean name always wins) | ✅ Match; matched themes keep their tracked ID |
| "Calculate Trend Velocity": count, NEW/EMERGING/ACCELERATING, taxonomy cross-reference, gap signal, recent editorial trend, phrase overlap, priority score and FAST-TRACK/STRONG/MONITOR/LOW | `scoreTheme` (`src/shared/research-intel.js`) | ✅ Exact port |
| Theme Repository / Trend Velocity sheets | Local workbook tabs; Trend Velocity has one row per tracked theme | ✅ Match (local) |
| n8n renames a matched theme to a new row when the name changes | Studio keeps the theme's ID across renames, so its count keeps accruing | ➕ Fix |

## Phase 4 — Post tagging

| n8n | Studio | Status |
|---|---|---|
| Tagging filters: X > 20, LinkedIn > 1, Reddit > 1 | `thresholds.tagging` | ✅ Match |
| Batches: X 50, Reddit 50, LinkedIn 40 | `taggingBatchSizes` | ✅ Match |
| "Theme Matching (<Platform>)" prompt (Fable 5): semantic intent, theme blocks with MATCH IF / DO NOT MATCH IF, outlier rule, confidence rubric, reason first | `taggingPrompt`, Claude Fable 5.1 at low effort by default | ✅ Match (current Fable) |
| High ≥ 0.7, medium ≥ 0.5 flagged for review, low discarded | Accepted ≥ 0.7, needs review ≥ 0.55, rejected below | ⚠️ Studio's medium floor follows the prompt's own rubric (0.55) |
| Parser never throws; truncated output salvaged | Missing posts get one focused retry, then are recorded as unclassified; the run continues | ✅ Match |
| (Studio) Short IDs in prompts | Prompts show `p1…pN` for posts, `T1…Tn` for themes, `c1…cN` for candidates and `E1…EN` for report evidence, and the validators map them back. A live run showed models mis-copying 24-character hex IDs (7 of 78 citations). An unknown ID drops that row or citation instead of failing the batch | ➕ Studio addition |
| (Studio) Prompt caching off for CLI calls | Each call is one-shot, so the Claude CLI's 1-hour cache write (2× input price) bought nothing. `DISABLE_PROMPT_CACHING=1` is set for every CLI call | ➕ Studio addition |
| Tags written back to the platform tabs | Local workbook tabs (Theme, Confidence, Reasoning, entities, pain point, urgency) | ✅ Match (local) |

## Phase 5 — Reports, toolkit, delivery

| n8n | Studio | Status |
|---|---|---|
| Loop over themes; "Prepare Report Request" (500 posts, top 30 full text, pre-calculated metrics and signals, strict format, banned phrases) | `selectThemeEvidence` + `buildTrendReportRequest` (`src/shared/research-reports.js`); quotes and links verified against the posts | ✅ Match |
| "Prepare AI Prompt3" v6.1 toolkit: Enterprise + self-serve angles, Key Tools from the headline toolkit's table, Semrush One rule, 5 headlines/subheads/hooks, 2 [ENT] + 3 [PLG] CTAs, pre-calculated evidence | `buildToolkitRequest` + `validateToolkit`, generated from the finished trend report | ✅ Match |
| "Check Toolkit Alignment" guard (⚠️ TOOLKIT CHECK line) | Ported into `validateToolkit` | ✅ Match |
| ICP, Positioning, Registry and AI Visibility Google Docs | Workspace reference documents + registry import (tables kept as `Tool | Function | Tags` rows) | ✅ Match |
| Create Docs in "New Trends Output" / "Toolkit Doc Output", n8n doc names, toolkit links to its trends doc | Publish to Google Drive (bridge or token); folder settings; `Priority_Trends_<Theme>_<date>` and `<Theme>__<date>`; reports published first so the toolkit links its report | ✅ Match (automatic after a run when "Publish reports to Google Drive" is on) |
| Update Master Sheet with links and timestamps | Trend Velocity tab shows the Doc links; export the workbook to Google Sheets or .xlsx | ✅ Match (local + export) |
| Archive clone of the data sheet, then clear tabs | Not needed: each run keeps its own evidence and workbook. "Archive and clear" remains available for the Google working sheet | ✅ By design |
| Fully automated weekly run | Schedules + "Approve themes automatically" | ✅ Match (opt-in; review stays the default) |

## Golden Thread v2 — Generate All Channel Assets

The second n8n workflow (shared 2026-10-16) turns one trend document into every channel asset. In Studio it is **Assets → Make channel assets** in Simple mode (`src/shared/asset-kit.js`, `createAssetKit` in `src/main/content-workspace.js`, `src/renderer/src/simple-assets.jsx`).

| n8n | Studio | Status |
|---|---|---|
| Form or Google Form row: a Google Doc link, or an uploaded PDF/DOCX | A report from the library, a Google Doc link (read through its share link, or the Google Docs token for private docs), pasted text, or an uploaded .docx/.md/.txt | ⚠️ No PDF upload; no Google Form trigger |
| "Parse Trend with Claude" (Fable 5) into seven normalized fields, then each prompt gets the fields | Every prompt gets the whole report: for a trend, its editorial toolkit and comprehensive report together, plus the posts the report cites (short IDs E1…) | ➕ More context, cited sources |
| Folder "Golden Thread — <trend> (<date>)" with 10 channel folders | Report folder → run folder with the same name → the same 10 channel folders and n8n file names; **Save folder** (Downloads), **Download folder** (.zip in the browser), **Save to Google Drive** | ✅ Match |
| 12 channel prompts on Claude Fable 5, all at once | The same 12 deliverables (`CONTENT_DELIVERABLES`), the workspace's report model (Fable 5.1, high effort), 3 at a time, schema-checked with one repair attempt | ✅ Match, validated |
| PR journalist table from the model's knowledge, blanks when unsure | Journalist rows only from supplied evidence that names the journalist, outlet and article; otherwise an explicit gap | ⚠️ Deliberate: no invented contacts |
| Landing page written as HTML by Claude | Structured sections rendered into a branded HTML page | ⚠️ Template-rendered |
| Claude writes each image prompt, then gpt-image-1 edits with reference images (style examples, the SEL lockup), 3 variations | Claude writes an art-direction brief per picture set (headline, up to two sourced facts, visual idea), then gpt-image-2.5-flare draws 3 variations; PNG plus an SVG wrapper | ✅ Match, at medium quality (n8n: high) |
| Reference images from GitHub (`ChrisJDiMarco/Assets`): the SEL hero got 5 style examples + the exact 2026 SEL logo; the social graphic got `style.png` + `brand.png` with the lockup. Prompts: examples are one visual family, never layouts to copy; merge the logo exactly in the footer, never redrawn or recolored | **Settings → Brand reference images**: up to 6 per picture set (Semrush campaign, SEL editorial, SEL social), each a style example or the approved logo, kept in local app data. Each picture goes to `/v1/images/edits` with them as multipart `image[]` parts, style examples first and the logo last, and the prompt numbers them with the same rules. A set without a logo keeps "draw no logos, leave a clean footer". A run keeps the images it started with, so a retry sends the same ones | ✅ Match (uploaded in Settings instead of fetched from GitHub) |
| Figma-editable SVG; the Social Team hero's SVG also carried the true SEL lockup as an optional repair layer | SVG that wraps the PNG | ⚠️ No logo repair layer |
| Slack message with every link | Status in Assets, Home ("Working now") and the trend's card | ❌ No Slack |

## Models

n8n: Opus 4.8 (discovery, synthesis, matching), Fable 5 (tagging, report, toolkit), Haiku 4.5 (AI-SEO classifier). Studio defaults: Claude Opus 5.5 for discovery/synthesis/matching and Claude Fable 5.1 for tagging and reports, each changeable per program with an effort level. Fable costs about 2.5× Opus 5.5 per token. Switching tagging to Opus 5.5 is the biggest single saving. The program form shows an estimate before each run.
