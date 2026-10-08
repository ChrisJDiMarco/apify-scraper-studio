# Scraper Studio app guide

This guide explains how Scraper Studio works: every page, what each control does, what a research run does step by step, what things cost, and how to fix common problems. The in-app **Ask AI** assistant answers from this guide. It describes version 0.2 of the desktop app for Mac.

Labels in **bold** are the exact words you see in the app.

## What Scraper Studio is for

Scraper Studio is a Mac app for social listening research and content. It collects public posts from X (Twitter), LinkedIn and Reddit through Apify, uses Claude to find the trends in those posts, writes an evidence-backed trends report and an editorial toolkit for each trend you approve, and turns them into channel content.

The research pipeline reproduces the team's earlier n8n "Golden Thread" workflow (same sources, batch sizes, scoring and sheet layout), so a few labels mention n8n.

### Workspaces and editions

- A **workspace** holds its own brand knowledge, approved products, taxonomy, reference documents, research programs, runs, trend history and Library. Workspaces share nothing.
- Each workspace has an **edition**, fixed at creation. **Semrush workspace** has Semrush branding, prompts tuned to SEO and search marketing, starter brand knowledge, and Semrush editorial formats (Backlinko, Exploding Topics, Search Engine Land). **General** (listed as **Your brand**) runs the same pipeline for any brand.
- A fresh install has **Semrush workspace** and **Your workspace** (General). Tester builds open in the Semrush workspace, where the sidebar shows the Semrush wordmark and "Research & content studio": the Semrush edition of Scraper Studio.
- Switch workspaces with the dropdown under the logo. **+ New workspace** opens a **Create a workspace** form in Brand knowledge.
- Settings (keys, the Claude connection, Google and Monday.com) apply to every workspace on the Mac.

### The flow, end to end

1. **Collect**: Apify gathers posts from the program's X accounts, LinkedIn profiles and subreddits, all platforms at once.
2. **Prepare evidence**: duplicates, out-of-window posts and excess posts per author are removed; each post gets an engagement score.
3. **Discover in batches**: Claude reads the more engaging posts, up to 200 per batch per platform, and proposes candidate trends.
4. **Identify themes**: candidates become up to six themes, matched against tracked themes and given a priority tier.
5. **You review**: the run pauses until you approve or pass each theme (unless **Approve themes automatically** is on).
6. **Tag every post**: each eligible post gets one approved theme or none.
7. **Write reports**: each approved theme gets a trends report, then an editorial toolkit built from it.
8. **Create content**: any report can become articles, social posts, sales briefs, ads and more.

| What | Where you find it |
| --- | --- |
| Run progress, theme review, retry, run history | **Research programs** |
| Every collected post with its tags, theme totals, trend history | **Sheets** |
| Discovered themes and their stage | **Trend board** |
| Trends reports, toolkits and drafts | **Library** |
| New content from a report or brief | **Create content** |

## Getting around

### Navigation

Semrush workspace sidebar: **Overview**, **Research programs**, **Sheets**, **Trend board**, **Create content**, **Library**, **Brand knowledge**. Below them, **More tools** expands to: **Collection overview**, **Playbooks**, **Search platforms**, **Chat with findings**, **Scrapers**, **Datasets**, **AI reports**, **Activity**, **Import research**, **Compare snapshots**, **Workflows**. **Settings** is at the bottom.

General workspace sidebar: **Content studio** (tabs for Overview, Research programs, Trend board, Create content, Library, Brand knowledge), **Overview**, **Sheets**, **Playbooks**, **Search platforms**, **Chat with findings**, **Scrapers**, **Datasets**, **AI reports**, **Activity**; **More tools** holds **Import research**, **Compare snapshots** and **Workflows**.

The header on every page has **Ask AI** (⌘J), **Search or jump to…** (⌘K, a command palette for pages and actions), a working indicator while tasks run, and **Refresh workspace**. ⌘, opens Settings. The sidebar footer shows how many runs are in progress, or "Local workspace", and the app version.

### Ask AI

**Ask AI** in the header opens a help panel on any page. Ask how something works, what a run will cost, why a run stopped, or what to do next. You can also ask it for a picture.

- It answers from this guide plus a summary of your setup: current page, workspace, product and taxonomy counts, reference document titles, which connections are saved (yes or no only), Claude route and model, up to 10 programs' settings, your last three research runs (status, message, cost, warnings), and what is running now.
- It also sees the names of your latest trends (so "an image for my latest trend" works) and the workspace's visual direction. It never sees API keys, tokens, collected posts or report text.
- It can't click, change settings, or start or stop runs. Answers can include **Open** buttons for the right pages and suggested follow-up questions.
- Each question uses your Claude connection (Settings → Writing & research) and **Default Claude model** at low effort: about $0.10 a question, capped at $0.50. Each answer shows the model and cost.
- The conversation lasts until you quit. The round-arrow button starts a new one. Esc closes the panel. If Claude isn't reachable, the error offers **Open Settings → Writing & research**.
- AI answers can be mistaken. Check important numbers on the page itself.

**Pictures in Ask AI.** Ask for a picture in plain words, for example "Create a hero image for my latest trend" or "a square LinkedIn graphic about AI Overviews in lavender and mint". Claude writes a detailed prompt and OpenAI draws it; a placeholder shows while it's drawn, usually under a minute.

- Pictures need an OpenAI API key in **Settings → Image generation** (the same key Create content uses). Without it, Ask AI explains how to add one.
- Brand and campaign pictures follow the workspace's visual direction (in the Semrush workspace, the Semrush brand palette). Describe your own style and it follows yours instead. It never draws company logos; it leaves space for one.
- Sizes: landscape (the default, for social and hero images), square or portrait. Ask for the shape you want.
- To change a picture, just say so ("make it bluer", "remove the text"): Ask AI rewrites the earlier prompt with your change and draws a new one.
- Click a picture to see it full size. **Download** saves the PNG. If drawing fails, **Try again** repeats it.
- Each picture costs a few cents of OpenAI usage on top of the answer (about $0.10 of Claude); the cost shows under the picture. The app reserves at most $1 per picture.
- Pictures are saved in the studio's data folder. They don't appear in **Library**; use **Create content** for campaign images that belong with a report.

## The browser studio

Scraper Studio also runs as a website: the same pages and features as the Mac app, served from a company server. LIVE CONTEXT says which one the person is using ("edition").

- **Signing in:** a team password, or the company sign-in when the site sits behind it. **Sign out** is at the bottom of the sidebar, next to the version.
- **One shared studio:** everyone who signs in works in the same workspaces, programs, runs, Library and Settings. A run someone starts is visible to everyone, and two people can't each have their own copy of a program.
- **Keys live on the server:** keys saved in Settings are encrypted on the studio server and used for everyone. The server reaches Claude with an Anthropic API key (or Claude Code, if it's installed there). Nobody installs anything.
- **Files:** where the Mac app shows a file dialog, the browser opens its own file picker and uploads the file. Exports, **Open file**, and **Show in Finder** download the file instead; an export folder downloads as one .zip. **Open data folder** and **Open workspace** aren't available, because folders stay on the server.
- **Runs keep going** when a browser tab closes; they run on the server. Reopen the site to follow them. The Mac app's quit warning doesn't apply.
- **Not in the browser studio:** the Mac installer, "Open Anyway" and Claude Code on your own computer.

## First-time setup checklist

Use this list for a new tester install.

1. **Install and open.** Open the DMG and drag **Scraper Studio** into Applications. Tester builds are signed but not yet notarized by Apple, so macOS stops the first launch once: open the app, click **Done** when macOS says it can't verify it, then open System Settings → Privacy & Security, scroll to Security and click **Open Anyway** next to the Scraper Studio message, and confirm with your password. Alternatively, run `xattr -dr com.apple.quarantine "/Applications/Scraper Studio.app"` once in Terminal before opening it.
2. **Connect Claude.** Open **Settings → Writing & research**. Under **How to reach Claude**, keep **Automatic (recommended)**. Then do one of these:
   - Install the Claude app (Claude Code) and sign in by running `claude auth login` in Terminal. If you already have it, run `claude update`.
   - Or paste an Anthropic API key (it starts with `sk-ant-`, from console.anthropic.com) in **Anthropic API key** and click **Save key**. Usage is billed to that key's account.
3. **Check Claude.** Click **Check Claude**. You want **Ready · using …** with a ✓ next to `claude-opus-5-5` and `claude-fable-5-1`. If you changed the route, click **Save AI settings**.
4. **Add the Apify token.** Testers share one team Apify account. Paste the team token in **Settings → Source collection → Apify API token** and click **Save**, or save it from the team setup file in the next step.
5. **Import the team setup file.** In **Settings → Share your setup**, click **Import setup…** and choose the JSON file (or use the **Got a setup file from your team?** banner on Research programs). Review the preview. If the file carries the Apify token, **Save the Apify token from this file** is ticked when this Mac has no token yet. Click **Import this setup**.
6. **Check Claude again**, as the confirmation suggests.
7. **Do a small first run.** In **Research programs**, select the program and click **Edit program**. For a cheap first run, set a short window (**Search the last (days)**, or **Look back (days)** on a scheduled program: 3), and under **Advanced research controls** lower **Target items per platform** (for example 300) and set **Maximum themes** to 2 or 3. Check that both budgets cover **Estimated cost per run**, click **Save research program**, then **Start research**. Your edits stay on your Mac. Importing the team file again restores the team's version.
8. **Follow the run.** Watch progress in Research programs, approve themes on the Trend board, click **Generate reports**, then read reports in Library and posts in Sheets.

## Overview

In the Semrush workspace, two entry cards: **Research your market** (opens Research programs) and **Create from a trend** (opens Create content). Below them: an activity strip (**Active runs**, **Need your attention** for runs awaiting review, partial or failed, and **Saved assets**); **Recent activity** with the five latest runs; **Your brand, built in.**, showing whether Audience, Brand voice and Editorial rules are saved, with **Edit brand knowledge**; and **A report can become your next campaign**, with **Create content** on recent reports.

## Research programs

A research program is a saved listening brief: sources, date rules, budgets and AI settings. Each start creates a separate run with its own evidence snapshot.

**New program** opens a blank editor (with no programs yet, it opens straight away under the **Got a setup file from your team?** banner). **Saved programs** lists your programs. Selecting one shows its sources, date window, schedule, **Evidence for this run**, the latest run and **Run history**. **Edit program** opens the editor.

### The program editor

**Program name** is required.

**Research focus (optional)** guides what the AI looks for. It doesn't filter collection: accounts and communities are collected in full. LinkedIn keyword search uses it as its search term. Keep it under 500 characters. With a focus entered, **Also filter account and community collection by this focus** adds the focus to each X search and switches Reddit from newest posts to a keyword search inside your subreddits. Leave it off to match the n8n workflow.

**Choose your sources**: tick a source and paste a list, one per line. Entries are cleaned and deduplicated on save. Limits: 1,000 targets per source, 2,000 per program.

| Source | Paste |
| --- | --- |
| **Reddit communities** | `r/name`, `name` or the community URL |
| **X accounts** | `@handle`, `handle` or an x.com profile URL |
| **LinkedIn accounts** | Full profile or company URLs (`linkedin.com/in/…`, `/company/…`) |
| **LinkedIn keyword search** | Nothing: it searches the research focus |

Each ticked source has **Collection options**:

- X: **Replies**, **Sort order**, **Media filter**, **Include native reposts**.
- Reddit: **Include thread comments** (with **Comments per post**). Programs always read each community newest first back to the window start, like the n8n workflow. With the focus filter on, Reddit switches to a keyword search inside the communities and also offers **Search matching comments**.
- LinkedIn accounts: **Include thread comments**, **Include reactions**, **Include quote posts**, **Include reposts**. Comments and reactions are extra paid rows; reactions are never used as evidence.
- LinkedIn keyword search: **Include thread comments**, **Include liked-user details**, **Include document details**.

**When to run**: **Repeat** is **Only when I start it**, **Every day**, **Every week** or **Every month**, plus **Day of the week** or **Day of the month** (short months use their last day), **Run time** and **Time zone**. See [Schedules](#schedules).

**What dates to search**:

- On demand: **Last few days (n8n default)** with **Search the last (days)** (default 7, up to now), or **Custom dates** with **Start date** and optional **End date** (inclusive, UTC).
- Scheduled: **Look back (days)** searches that many complete UTC days before the run, excluding today (defaults: 1 daily, 7 weekly, 30 monthly). Runs you start yourself on a scheduled program use the same rolling window.

**Spending limits per run**: **Collection budget (USD)** (default $10) caps Apify; **AI budget (USD)** (default $25) caps Claude. Both apply to every run.

**Estimated cost per run** updates as you edit: **Apify collection: up to $X** (the worst case, with the number of Actor jobs) and **AI (all stages): about $Y** (with planned posts, batches and a per-stage line), plus warnings when a budget is below the estimate or too low to start. See [Costs and budgets](#costs-and-budgets).

**Approve themes automatically**: the run goes straight from discovery to tagging and reports without pausing for review, spending up to the AI budget.

**Publish reports to Google Drive when they are ready**: creates each trends report and toolkit as a Google Doc. Needs the Google Sheets bridge or a Drive token in Settings.

**AI models and effort per stage** (expand):

| Stage | What it does | Default model | Default effort |
| --- | --- | --- | --- |
| **Trend discovery** | Reads 200-post batches per platform | Claude Opus 5.5 | medium |
| **Theme synthesis** | Distills the top six themes | Claude Opus 5.5 | high |
| **Theme matching** | Compares with tracked themes | Claude Opus 5.5 | medium |
| **Post tagging** | Classifies every post | Claude Fable 5.1 | low |
| **Reports & toolkits** | Writes the paired documents | Claude Fable 5.1 | high |

Models: Claude Fable 5.1, Claude Opus 5.5, Claude Sonnet 5.5, Claude Haiku 4.5. Effort: low, medium, high, xhigh, max (higher costs more). **Batches at once** (1–6, default 3) sets how many discovery or tagging batches run in parallel.

**Enable scheduled runs** appears for recurring programs and summarizes the schedule and per-run limits.

**Advanced research controls** (expand):

| Field | Default | What it does |
| --- | --- | --- |
| **Target items per platform** | 3,000 | Most posts kept per platform |
| **Maximum evidence items** | 10,000 | Most posts kept in total |
| **Maximum items per author** | 10 | Newest posts kept per author, per platform |
| **Maximum themes** | 6 | Themes synthesis may return (1–6) |
| **Discovery batch size (per platform)** | 200 | Posts per discovery batch (40–200) |
| **Discovery engagement thresholds** | X 40, LinkedIn 25, Reddit 15 | Minimum score to be read by discovery |
| **Classification engagement thresholds** | X 20, LinkedIn 1, Reddit 1 | Minimum score to be tagged |
| **X handles per Apify run** | 5 | Fewer is cheaper per tweet |
| **X tweet ceiling per handle** | 50 | A cost ceiling; the per-author cap applies after |
| **LinkedIn posts per profile** | 15 | Posts requested per profile |
| **LinkedIn profiles per Apify run** | 100 | Profiles per LinkedIn job |
| **Reddit posts per subreddit** | 300 | A listing stops after this many posts |
| **Reddit scroll time (seconds)** | 300 | How long each listing scrolls back |
| **Reddit communities per Apify run** | 6 | Smaller groups run in parallel and finish sooner |
| **Apify runs at once per platform** | 4 | Parallel Apify jobs per platform |
| **Tagging batch size per platform** | X 50, LinkedIn 40, Reddit 50 | Posts per tagging batch |
| **Include undated evidence in a dated search** | Off | Keep posts with no date |

**Save research program** never starts a run. With **Enable scheduled runs** ticked, it schedules the next run.

### Starting a run

Under **Evidence for this run**, choose **Collect configured sources** (runs Apify; shows the estimate and "Collection cap $X · AI budget $Y") or **Use saved collections** (reuse up to 50 earlier collections; in the Semrush workspace, these are collections from earlier research runs in this workspace). The program's date window still applies to reused posts.

Click **Start research**. Before anything is spent, the app confirms Claude can use every model the program needs and that the AI budget is large enough to start.

### Watching a run

The run panel shows the current message, a status (**Queued**, **Running**, **Awaiting review**, **Succeeded**, **Partial**, **Failed**, **Cancelled**), the start time, **Recorded cost** (Claude spend for the run and its reports) and **Reserved budget**. Counters show **Retained evidence items**, **Discovery batches** and **Classification batches**. **Open in Sheets** appears once posts are kept. Warnings appear as a list, errors in a red box.

Messages run from "Collecting X 2/4 · LinkedIn 1/1 · Reddit 0/3 (3 of 8 source jobs)" through "Discovering trends · Twitter batch 2" to "Review and approve themes before classifying evidence and generating reports.", then "Tagging posts · Reddit batch 3", "Writing the trends report · <theme>" and "Classification complete. Review the paired reports and any outputs needing attention."

### Reviewing themes

At **Awaiting review**, use the **Trend board** or the run panel (**Choose the themes worth taking forward.**). Each theme card has a **Select theme N** checkbox, a sources badge, score chips (tier and score, velocity, gap signal, taxonomy category and zone, **Matches tracked theme "…"**), name warnings such as "Name: too long 7w", editable **Theme name** and **Theme description**, and **Source references (N)**. Select one to six themes and click **Approve themes & build reports**. Unselected themes are passed. Edited names become the tracked names.

### Cancel, retry and outputs

- **Cancel run** works while a run is queued, running or awaiting review. Finished outputs are kept.
- Failed, partial and cancelled runs show **Total retry budget (USD)** and **Retry unfinished outputs**. The budget is the run's new total AI budget, including what it already spent, and can't be below what is reserved. To add $10 to a $25 run, enter 35.
- Retry resumes where the run stopped: finished Apify jobs, evidence, discovery and tagging batches, synthesis, matching and finished reports are kept. Apify jobs still running when the run stopped are picked up from Apify, not paid for twice. Jobs you cancelled start again.
- **Saved outputs** lists the run's reports and toolkits, each with **Create content**. **Export run** writes them (Markdown, HTML, JSON, images) with a manifest to the data folder's exports. **Publish to Google Drive**, when set up, creates Docs named `Priority_Trends_<Theme>_<date>` (trends reports) and `<Theme>__<date>` (toolkits).

### Schedules

The schedule box shows **Run on demand**, **Schedule is on** or **Schedule is paused**, the summary (for example "Every Monday at 09:00 · America/New_York") and **Next run**. **Pause schedule** and **Resume schedule** toggle it; pausing doesn't cancel a running run.

- The app must be open and the Mac awake. Closing the window keeps the app running; quitting stops schedules.
- After sleep, only the latest missed time runs.
- A time is skipped while the program's previous run is active or awaiting review ("The previous run is still active." / "The previous run is waiting for theme review.").
- A failed, partial or cancelled scheduled run pauses the schedule with "Schedule paused: <reason>". Fix it, then **Resume schedule**.
- Themes still need your review unless **Approve themes automatically** is on.

## How a research run works

| Stage | What happens | Where results land |
| --- | --- | --- |
| Collecting | Apify jobs run for every source, all platforms at once | Sheets platform tabs |
| Evidence preparation | Dedupe, date window, caps, engagement score (**Retained evidence items**) | Sheets |
| Discovery | Batches of up to 200 posts per platform; up to 10 candidates each | Sheets → Batch Analysis Log |
| Synthesis | Candidates merged into up to six themes | Sheets → Theme Repository |
| Matching and scoring | Compared with tracked themes; priority tier assigned | Trend board, Trend Velocity |
| Theme review | Run pauses (**Awaiting review**) | Trend board → Potential trends |
| Tagging (classification) | Every eligible post gets a theme or none | Sheets theme columns and totals |
| Reports | Trends report, then toolkit, per approved theme | Library; Trend board → Ready to use |
| Delivery (optional) | Google Docs created | Google Drive |

### Collection

- **X** searches each handle's posts since the window start, newest first. Time limit 20 minutes.
- **LinkedIn accounts** collects each profile's or company's posts newer than the window start. Time limit 90 minutes.
- **Reddit** scrolls each subreddit's newest posts back toward the window start, in parallel groups of subreddits. Each group may return up to 1.5× **Target items per platform** results. Time limit 120 minutes.
- **LinkedIn keyword search** searches the focus. Time limit 60 minutes.
- Per-job sizes come from **Advanced research controls**. If a job fails, times out or hits its spending cap, the posts it already collected are kept, with a warning such as "reddit job ended ABORTED (time limit); kept the 412 rows it collected."
- If some jobs fail, the run stops with "N of M source jobs failed; K finished and are saved for the retry." Retry reuses the finished jobs.

### Evidence preparation

- Duplicates are removed by URL, then by the first 100 characters plus author (this catches reposts).
- Posts outside the date window are dropped. Undated posts are dropped from dated searches unless **Include undated evidence in a dated search** is on.
- Newest posts are kept first, up to **Maximum items per author**, **Target items per platform** and **Maximum evidence items**.
- Each post gets a **prevalence_score**, a log-scale engagement score (n8n formula) from likes, reposts, replies, quotes, bookmarks and views on X, reactions and comments on LinkedIn, and upvotes, comments and upvote ratio on Reddit.
- Discovery reads only posts above the **Discovery engagement thresholds**. Tagging covers posts above the **Classification engagement thresholds**. Posts with no engagement numbers are not eligible for either, but they still appear in Sheets.

### Discovery, synthesis and matching

- **Discovery**: each batch holds one platform's posts, sorted by engagement. Claude proposes up to 10 specific, emerging candidate trends per batch, each with a summary, pain point, 5–8 examples of how people talk about it, actionability and its supporting posts. Every finished batch is saved, so a retry never repeats it.
- **Synthesis**: same-name candidates are merged, then Claude distills up to **Maximum themes** themes. Each has a 3–6 word name (a concrete subject plus a tension word), description, 12–15 matching keywords, match and do-not-match criteria, taxonomy category, novelty label and content-gap zone. Clean names rank first, then cross-platform reach, then evidence.
- **Matching**: new themes are compared with the workspace's tracked themes (up to the 150 most recently seen). A theme covering exactly the same topic keeps the tracked theme's identity, so its detection count grows. The cleaner name wins.

### Theme scoring

Every theme gets a **priority tier**, the n8n "Calculate Trend Velocity" formula:

| Part | Values | Points |
| --- | --- | --- |
| Gap signal (×2) | NEW_TERRITORY 5, HIGH_OPPORTUNITY 4, REFRESH_OPPORTUNITY 3, CHECK_RECENCY 2, LOW_OPPORTUNITY 1 | 2–10 |
| Velocity (×1.5) | NEW 1, EMERGING 2, ACCELERATING 3 | 1.5–4.5 |
| Novelty | NEW TOPIC 3, NEW ANGLE 2, EVERGREEN 1 | 1–3 |
| Recency bonus | DORMANT +1, SPORADIC +0.5, unknown +0.5, ACTIVE 0 | 0–1 |
| Phrase overlap penalty | −2 when the theme repeats the category's top phrases and the gap is LOW_OPPORTUNITY | 0 or −2 |

Tiers: **FAST-TRACK** 14 or more, **STRONG** 10–13.9, **MONITOR** 7–9.9, **LOW** under 7. The maximum is 18.5.

- **Gap signal** comes from the taxonomy category the theme matches (Brand knowledge → Research knowledge). No match: NEW_TERRITORY. Zone OPEN: HIGH_OPPORTUNITY. MODERATE: HIGH_OPPORTUNITY if coverage is dormant, otherwise CHECK_RECENCY. SATURATED: REFRESH_OPPORTUNITY if dormant, otherwise LOW_OPPORTUNITY.
- **Recent coverage** comes from the category's last three monthly article counts: 10 or more is ACTIVE, 3–9 SPORADIC, fewer DORMANT.
- **Velocity** counts the runs in this workspace, on this Mac, that detected the theme: NEW (first time), EMERGING (shown as **Seen twice**), ACCELERATING (3 or more, shown as "Seen in N runs").
- **Novelty**: **New topic** (not covered by the taxonomy yet), **New angle** (a fresh angle on a covered category), **Evergreen** (well covered and recurring).
- The category is the one Claude assigned during synthesis, or else the closest match by keywords and top phrases. Without a taxonomy, every theme counts as new territory, so most themes score FAST-TRACK or STRONG.

### Tagging

- Posts above the classification threshold are tagged in batches (X 50, LinkedIn 40, Reddit 50).
- For each post, Claude writes a reason, then picks one theme or none. It also gives a confidence from 0 to 1, a pain point (Loss of Traffic/Visibility, Proving ROI/Attribution, Workflow/Resource Overload, Technical Complexity, Platform Frustration, None), an urgency (Immediate Crisis, Strategic Planning, Passive Observation, None) and the tools, people and companies mentioned.
- Confidence 0.7 or higher is accepted. 0.55–0.69 counts but is marked "(needs review)" in Sheets. Below 0.55 the post gets no theme.
- Posts the model skips get one focused retry. Posts still missing are marked unclassified, with a warning.

### Reports and the editorial toolkit

Reports are written one theme at a time. Each theme gets a pair: **Comprehensive trends report** and **Editorial toolkit brief**. A theme with no tagged posts is skipped, with the warning "No posts were tagged to "<theme>", so its reports were skipped."

**Trends report** ("<Theme> — Comprehensive Trends Report"):

- Built from up to 500 tagged posts, split across platforms in proportion and ranked by confidence, then engagement; the top 30 per platform include full text. Metrics cover every tagged post.
- Sections: Executive Summary, Method Note, Trend Summary, Evidence & Validation (aggregate engagement, 6–9 direct quotes, 8–10 evidence links), Top 3 Pain Points, Opportunities & Requests, Technical Details, Top Performing Content, Key Takeaways, Limitations.
- Direct quotes come only from X and LinkedIn and must match the post text exactly. Reddit appears in evidence links. Authors, dates, URLs and metrics come from the stored posts, never from the model.

**Editorial toolkit** ("TREND: <Theme>"), built from the finished trends report and your reference documents:

- Sections: WHAT HAPPENED, WHY THIS MATTERS TO MARKETERS, HOW TO TALK ABOUT IT, ENTERPRISE ANGLE, SELF-SERVE ANGLE (PLG), POTENTIAL HEADLINES & HOOKS (5 headlines, 5 subheads, 5 hooks, 2 [ENT] and 3 [PLG] CTAs), EVIDENCE & VALIDATION (linking the trends report), Editor notes.
- The Enterprise angle names only Enterprise products from your registry. The self-serve angle names only self-serve toolkits and their tools, and is marked affiliate-safe. Headlines, hooks and talking points stay product-agnostic. Without a registry, both angles state the gap.
- "⚠️ TOOLKIT CHECK — review before publishing" flags tools not listed under the chosen toolkit in your registry.

## Trend board

The Trend board shows one card per discovered theme. Nothing is written or spent until you approve a theme.

Columns:

- **Potential trends**: waiting for your OK. Runs still collecting or discovering show status cards ("Collecting posts and conversations", "Finding trends · batch 3 of 9") with **View posts** once posts exist. A failed run shows its error and **Open run**; a failed run that found no trends leaves the board once a newer run of the same program finds themes, whether they're waiting for review or finished (it stays in run history).
- **Approved**: for each run, a box shows "N approved trends" and **Generate reports**. Click it, read the confirmation ("Writes an evidence report and editorial toolkit for each approved trend, using up to $X of this run's AI budget…"), then **Generate reports** or **Not yet**. Undecided trends in that run are passed.
- **In production**: "Queued for reports", "Sorting evidence · N of M", "Writing reports" or "Creating assets". "Needs attention" comes with **Open run**.
- **Ready to use**: **Read report** opens it in Library. **Create assets** (or **Create more**) starts Create content with the report as the source.
- **Passed**: hidden until you click **Show N passed trends**. **Reconsider** moves a card back.

Cards show the priority tier (hover it to see the score), novelty, name, description, number of sources (posts cited during discovery), velocity (**New**, **Seen twice**, "Seen in N runs"), taxonomy category, platforms, date and program. In Potential, use **Approve** and **Pass**. In Approved, use **Undo**. You can also drag cards between Potential, Approved and Passed. Decisions are only possible while the run is awaiting review.

Newest runs come first, then higher tiers, then more evidence. **Find new trends** opens Research programs. With Monday.com connected, **Sync to <board>** sends every card to your board (see [Settings](#settings)).

## Sheets

Sheets shows each research run as a workbook laid out like the team's Golden Thread Google Sheet, and lets you import spreadsheets to review alongside. Open it from the sidebar, **Open in Sheets** on a run, or **View posts** on the Trend board.

A run that started since your last visit opens first; otherwise the workbook you last had open. An older run shows "This is the <date> run. A newer run of this program started <date>." with **Open the newer run**. Runs that are queued, running, awaiting review (**Review themes**), failed or partial (**Open run**) show a note.

### Research run tabs

| Tab | What it holds |
| --- | --- |
| **Theme Repository** | Every discovered theme: description, matching_keywords, criteria, Novelty, Status (Approved, Passed, Waiting for review), Evidence Count, Taxonomy Category |
| **Twitter**, **Reddit**, **LinkedIn** | One row per kept post, newest first: post_url, text, engagement columns, prevalence_score, Theme, Confidence, Reasoning, entities, Pain_Point_Type, Urgency_Signal. Reddit adds subreddit and title. LinkedIn adds headline and profile |
| **Theme Summary Data** | Per theme: post counts, engagement totals and prevalence per platform, **Overall Prevalence Score**, and **Weighted Prevalence Score** (top theme = 100) |
| **Post Counts Reference** | Posts per theme per platform |
| **Trend Velocity** | One row per tracked theme: report links (once published to Drive), first-seen date, Count (runs that detected it), Velocity, priority tier and score, gap signal, taxonomy details |
| **Taxonomy Lookup** | Your workspace taxonomy, if loaded |
| **Batch Analysis Log** | One row per discovery batch: candidates proposed, timestamp, batch number, posts read, platform breakdown, status |

Theme columns and totals fill in only after themes are approved and tagging runs. Before that, those tabs explain what fills them.

### Working in a sheet

- Move with arrow keys and Tab; select with Shift, Shift-click or drag. The formula bar shows the full cell. **Wrap** shows more of long posts, **Freeze** keeps the first column in view, **Columns** hides or shows columns.
- ⌘F finds text (Enter for next, Shift-Enter for previous). Each header's ▾ menu sorts, filters (by values or **Text contains**), fits or hides the column. Right-click a cell for **Show only "…"** and **Open link**; ⌘-click opens a URL. Selected numbers show Sum, Avg, Min, Max and Count.
- Edit by typing, Enter, F2 or double-click; ⌘Z and ⇧⌘Z undo and redo. Edits save automatically, get an orange corner and never change the run itself.

### Export and Import

**Export** (includes your edits): **Download workbook (.xlsx)**, **Download this tab (.xlsx)**, **Download this tab (.csv)**, **Download what's shown (.csv)** (when filtered), **Copy "<tab>" for Google Sheets** (paste into cell A1 of any Google Sheet), and **Create Google Sheet…**, which needs the Sheets bridge. Excel cells over 32,767 characters are shortened.

**Import**: **Spreadsheet file (.xlsx, .csv)…** (from Google Sheets, use File → Download → Microsoft Excel to bring every tab) or **Pull from a Google Sheets link** (needs the Sheets bridge). The workbook menu offers **Rename this workbook**, **Replace with a newer file…**, **Pull the latest from Google Sheets** and **Remove from Sheets** for imports. Removing never touches the original file.

## Create content

Create content turns a source into drafts in three steps.

1. **Source brief** ("What is the story?"): **Paste a brief** (a **Source title** and **Source brief** of up to 250,000 characters), **Import document** (.txt, .md, .docx), **Use a report** (a finished report from this workspace), or **Google Doc** (needs a Google Docs token).
2. **Choose deliverables**: filter by channel or **Images**, and tick formats. In the Semrush workspace the core formats show first (Evidence report, Editorial toolkit, Long-form article, Social captions and thread, Enterprise sales brief, Brand campaign graphic). **Explore N more formats** shows the rest: Short news update, Newsletter pack, Search ads and keywords, Affiliate partner pack, Backlinko video script, Exploding Topics pack, Search Engine Land news and video, PR research brief, Campaign landing page, SEL social data graphics and SEL editorial heroes. Image formats need an image key, and **Image directions per selected image output** (1–3) sets how many images each one makes.
3. **Review & generate** ("Ready for a first draft?"): check the source, outputs and workspace context.

The **Campaign summary** panel shows your selections and the **Spending allowance (USD)** (default $5.00), which authorizes requests but is not a hard cap on provider charges. **Generate drafts** starts the run. Each output gets its own status, and **Recent content runs** lists earlier runs.

Drafts use the workspace's brand knowledge and approved products as they were at the start, and the **Default Claude model** from Settings. Nothing is published automatically. Retry works as it does for research runs and keeps completed outputs. Create content from a research report uses the report text plus up to 120 posts it cites.

## Library

**Your asset library** holds this workspace's trends reports, toolkits, drafts and images.

- Search with **Search assets**, and filter by **All assets**, **Written content** or **Images**.
- The asset list and the open asset's title and buttons stay pinned while you scroll a long report.
- **Open file** opens the HTML (or PNG) in its default app. **Export pack** exports that asset's run with a manifest to the data folder's `exports`. **Create from this** starts Create content with the asset as the source.
- **Generation receipt** shows the model and cost.
- Items from the earlier content board appear under **From the earlier content board**.

## Brand knowledge

Brand knowledge has two tabs: **Workspace knowledge** and **Research brand profiles** (profiles used by the More tools pages).

**Workspace knowledge**:

- **Workspace identity**: **Workspace name** and **Edition**, which is fixed after creation.
- **The context behind good content**: **Audience**, **Positioning**, **Ideal customer profile**, **Brand voice**, **Editorial rules**, **Claims to avoid**, **Product context**. The Semrush workspace starts with an editable preset.
- **Approved product registry**: **Add product** with **Product name**, **Approved product URL**, **Product segment** (General, Enterprise, Self-serve / PLG), **What it does**, **Supported capabilities** and **Approved tools** (one per line), and **Approved for affiliate use** (self-serve only). **Remove product** deletes one.
- **Save brand knowledge** saves. Changes apply to new runs. Earlier runs keep the context they started with.

**Research knowledge** (below) feeds theme scoring and toolkits:

- **Taxonomy lookup**: **Use its Taxonomy Lookup tab** (from a workbook imported in Sheets), **Import spreadsheet (.xlsx, .csv)…** or **Remove**. The sheet needs **Category** and **Zone** columns. Velocity, keyword, phrase and monthly article-count columns improve scoring. Up to 200 categories.
- **Product & solution registry**: **Enterprise products** (exact names, comma-separated; everything else counts as self-serve; the Semrush workspace pre-fills its Enterprise names), **Registry document text** with **Load pasted registry**, **Import document (.docx, .md, .txt)…**, or a Google Doc link with **Read Google Doc**. Loading a registry replaces the product list.
- **Toolkit context documents**: **Document type** (ICP (ideal customer profile), Positioning, AI search positioning & glossary, Other background), **Title**, and **Paste text** with **Add pasted document**, **Import file…** or **Read Google Doc**. Up to 20 documents of 300,000 characters each.

## More tools

- **Collection overview**: shortcuts to collections, playbooks, scrapers and recent activity.
- **Playbooks**: eight guided marketing briefs (Competitor positioning brief, Campaign message audit, Launch research pack, ABM account research, Voice of customer brief, Content and SERP opportunities, Advertising message research, Weekly competitor changes).
- **Search platforms**: a quick topic or account search across Reddit, X and LinkedIn in three tabs: **Search brief**, **Sources & filters** and **Review & run**. **Results per source** defaults to 10 (maximum 50; Reddit needs at least 10). **Apify budget per source (USD)** defaults to $0.25. Click **Search selected sources**.
- **Chat with findings**: ask questions across up to eight datasets, with checked citations.
- **Scrapers**: save and run your own Apify Actor or saved-task recipes.
- **Datasets**: browse collections with the **Explorer**, **Signals**, **Conversations**, **Topics** and **Coverage** tabs. Export CSV or JSONL.
- **AI reports**: AI reports on a dataset, with a review and approval panel and exports.
- **Activity**: a timeline of collections, research, content and AI work. It shows **Running now**, **Waiting on you**, **Needs attention** and **AI spend this week**. Select an entry for details, actions and **Technical details**.
- **Import research**: bring in CSV, JSON or JSONL with column mapping.
- **Compare snapshots**: compare two collections of the same sources over time.
- **Workflows**: describe a goal, preview the steps, then **Run reviewed plan**.

Collections from Search platforms, Scrapers and Import research live in Datasets and Chat with findings. Posts collected by research programs open in Sheets instead.

## Settings

Sections, top to bottom:

- **Connect your tools**: badges for **Apify saved / Apify missing** and **Sheets saved / Sheets optional**.
- **Share your setup**:
  - **Export this workspace**: tick **Include the shared Apify token** if you want it, then **Export setup…**. This saves one JSON file ("<workspace> setup <date>.json", in Documents by default) with the active workspace's brand knowledge, approved products, Enterprise product list, taxonomy, reference documents and all its research programs. It leaves out runs, collected posts, themes and trend history, reports, Sheets edits, other settings and every other key.
  - **Import a setup file**: **Import setup…** previews the file: workspace, programs ("updates the existing program" when you already have it), what changes, and warnings. Then **Import this setup** or **Cancel**.
  - Importing replaces the brand knowledge, products, taxonomy and reference documents of the first workspace with the same edition, adds or updates the file's programs, keeps your other programs and run history, and switches to that workspace. Imported schedules arrive paused. **Save the Apify token from this file** stores the token if the file has one.
  - A file holding the token is like a password: anyone with it can spend on that Apify account. Share it only internally. A file holds up to 50 programs and 20 reference documents.
- **Source collection**: **Apify API token** (**Save**, **Clear**) and **Maximum rows to download** (for Scrapers). In the General workspace these fields sit lower, after Connection diagnostics.
- **Writing & research**:
  - **How to reach Claude**: **Automatic (recommended)**, the default for new installs, uses the Claude app when it is installed, signed in and up to date, and otherwise the API key. **Claude app (Claude Code)** uses this Mac's Claude Code sign-in and plan. **Anthropic API key** calls the API directly, billed to the key's account.
  - **Anthropic API key** (**Save key**, **Clear**) is stored encrypted in this Mac's keychain and sent only to Anthropic.
  - **Default Claude model** (`claude-opus-5-5`) is used for chat, AI reports, Create content and Ask AI. Research programs choose models per stage. **Claude budget per request (USD)** (default $1) caps a single chat or AI report request.
  - **Check Claude** shows the route in use and a ✓ or ✕ for each model research uses: one tiny request per model (a few cents) through the Claude app, free through the API. **Save AI settings** applies changes.
  - **Advanced writing provider** holds an optional Codex CLI switch. Research programs are tuned for Claude.
- **Image generation**: **OpenAI API key**, **Save image key**, **Remove saved key** and **Check image access** (free; it generates no image).
- **Connection diagnostics**: the Apify token, the Claude route, and the local data folder.
- **Google Docs**: **Google Docs access token** with **Connect Docs** and **Disconnect**. Tokens expire.
- **Monday.com**: **Monday.com API token** (**Connect**, **Disconnect**) and **Board ID** (**Use this board**, **Forget board**). Each trend card becomes an item whose Status column follows the card's stage (Potential trend, Approved, In production, Ready to use, Passed). A Long text column holds notes.
- **Google Sheets** (the Sheets bridge): **Apps Script webhook URL**, the working spreadsheet and tabs, **Google Drive folders** for trend reports, toolkits, other Docs and Sheets exports, plus **Save sheet settings**, **Test bridge**, **Archive + clear**, **Pull working sheet** and **Replay**.
- **Local files & workspace details**: **Open data folder** and **Open workspace**.

### How the app reaches Claude

- **Automatic** checks the Claude app with `claude --version`, `claude --help` and `claude auth status`. An app missing any option Scraper Studio needs counts as too old. The app looks for `claude` where Terminal finds it and in the usual install folders.
- A working route is remembered for 10 minutes. **Check Claude** always looks again.
- Before anything that spends money starts (**Start research**, continuing after theme review, **Retry unfinished outputs**, **Generate drafts**), the app confirms the route and every model the work needs. If a model isn't available, it stops with a message ending "Nothing was started." Through the Claude app each model check is a tiny paid request, remembered until you quit.

## Costs and budgets

A research run has two separate budgets: **Collection budget** (Apify) and **AI budget** (Claude). The program editor shows an **Estimated cost per run** before you start. Actual costs are recorded on each run.

### Apify (collection)

Planning uses Apify list prices (checked October 2026):

| Source and Actor | Price basis | Smallest cap per job |
| --- | --- | --- |
| X: `apidojo/twitter-scraper-lite` | $0.016 per handle searched, plus $0.0004 per tweet when a job has 5 or fewer handles (up to $0.002 per tweet above 100 handles) | $0.02 |
| LinkedIn accounts: `harvestapi/linkedin-profile-posts` | $0.002 per post, comment or reaction | $0.01 |
| Reddit: `trudax/reddit-scraper-lite` | $0.004 per result, plus $0.02 per job | $0.04 |
| LinkedIn keyword search: `supreme_coder/linkedin-post` | about $0.005 per result | $0.01 |

- **Worst case** assumes every account and subreddit returns its maximum: 50 tweets per handle, 15 posts per profile, and for Reddit the smaller of 1.5× the target and 300 posts per subreddit, per group. Typical runs cost less, because many accounts post less and listings stop at the window start.
- **Budget split**: each Apify job gets a share of the collection budget in proportion to its worst-case cost, never below the smallest cap above and at most $100. The share is sent to Apify as that job's spending cap. When it runs out, Apify stops the job and its posts are kept.
- Below the worst case you see "The $X collection budget is below the worst-case Apify cost of about $Y. Each source stops when its share runs out; typical weeks cost less than the worst case."
- If the budget can't cover every job's smallest cap, the run won't start: "This source roster needs N Actor jobs and at least $X so every Actor can start. Raise the collection budget."

### Claude (AI)

List prices per million tokens, used for estimates and budgets:

| Model | Input | Output | Relative cost |
| --- | --- | --- | --- |
| Claude Fable 5.1 | $10 | $50 | 2.5× Opus 5.5 |
| Claude Opus 5.5 | $4 | $20 | baseline |
| Claude Sonnet 5.5 | $2 | $10 | half of Opus 5.5 |
| Claude Haiku 4.5 | $1 | $5 | a quarter of Opus 5.5 |

Higher effort adds thinking, so it costs more. The estimate assumes about 1.3× the output at low effort and up to 5× at max.

Rough planning costs with default settings:

- **Trend discovery** (Opus 5.5, medium): about $0.50 per 200-post batch.
- **Synthesis** and **matching** (Opus 5.5): under $1 together per run.
- **Post tagging**: about $0.011 per post on Fable 5.1 (the default), $0.0044 on Opus 5.5, $0.0022 on Sonnet 5.5 and $0.0011 on Haiku 4.5. That is about $11, $4.40, $2.20 or $1.10 per 1,000 tagged posts.
- **Reports & toolkits** (Fable 5.1, high): about $2.50–$4.50 per theme, so six themes are about $15–27.

Example estimates from the program editor:

| Program | Apify worst case | AI estimate |
| --- | --- | --- |
| 100 X accounts, 100 LinkedIn profiles, 4 subreddits, 1,000 posts per platform, defaults | about $11.40 | about $56 (tagging $30, reports $21, discovery $4.50) |
| Same, with Post tagging on Opus 5.5 | about $11.40 | about $38 |
| Same, with Post tagging on Sonnet 5.5 | about $11.40 | about $32 |
| Same, with every stage on Sonnet 5.5 | about $11.40 | about $13 |
| 20 X accounts, 20 LinkedIn profiles, 2 subreddits, 300 posts per platform, 3 themes | about $3 | about $17 |

Estimates run a little high. The first live run of the 1,000-posts-per-platform size cost roughly $11 in Apify and $41 in Claude. Switching **Post tagging** to Opus 5.5 is the biggest single saving. Fewer themes cut report costs.

### How AI spending is controlled

- **Start check**: a run that collects new posts won't start if the AI budget is below half of the estimate for discovery, synthesis and matching (or half of the whole estimate when themes are approved automatically): "This program's AI budget ($X) is far below the estimated $Y to discover themes…". Runs that reuse saved collections skip this check.
- **Per-call caps**: each Claude call reserves about three times its own estimate (at least $0.50, at most $100, never more than what's left). A call that hits its cap is retried once with a larger cap; an answer that fails the app's checks gets one repair attempt.
- **Running out**: when less is left than the next step needs, the run stops there: "This step needs about $X but $Y of the run's AI budget is left. Raise the budget and retry; finished steps are kept." Raise **Total retry budget (USD)** and click **Retry unfinished outputs**.
- **Reports**: each theme's report pair gets its own share of the run budget; unused money returns to the run.
- **Reserved budget** is held for calls in progress. An interrupted call with an unknown cost keeps its reservation.
- **Recorded cost**: through the API, list-price usage billed to your key; through the Claude app, Claude Code's reported list cost (your plan's billing may differ).

**Other AI costs**: Create content splits its **Spending allowance** across the selected outputs. Chat with findings and AI reports are capped by **Claude budget per request (USD)**. Ask AI is about $0.10 a question (cap $0.50). Images reserve at least $0.25 each for OpenAI usage.

## Troubleshooting

### Run messages and what they mean

| Message (start) | Cause | Fix |
| --- | --- | --- |
| "The Claude app (Claude Code) is not installed." | No Claude Code and no API key | Install Claude Code, or add an API key in Settings → Writing & research |
| "This Claude app (…) is too old for Scraper Studio; it lacks …" | Outdated Claude Code | Run `claude update` in Terminal, then **Check Claude** |
| "The Claude app is not signed in." | Signed out | Run `claude auth login`, then **Check Claude** |
| "… can't use claude-…: … Nothing was started." | Your account or key can't use a stage's model | Pick another model under **AI models and effort per stage**, or use an account with access |
| "This program's AI budget (…) is far below the estimated …" | AI budget below the start minimum | Raise **AI budget (USD)**, choose lighter models or reduce sources |
| "Missing APIFY_API_TOKEN." | No Apify token saved | Settings → Source collection, save the token, then **Retry** |
| "This source roster needs N Actor jobs and at least $X…" | Collection budget below the Actors' minimums | Raise **Collection budget (USD)** |
| "N of M source jobs failed; K finished and are saved for the retry. …" | Apify jobs failed (credit, private or invalid accounts, Apify errors); the text names the source (x, reddit, linkedin-profile, linkedin-search) | Fix the cause, then **Retry**. Finished jobs are reused |
| "An Actor start was attempted but its run ID was not saved…" | The app stopped while starting an Apify job | Check recent runs in the Apify console before retrying, so nothing is paid twice |
| "The cancelled Apify run has not stopped yet…" | A cancelled Apify job is still stopping | Retry once Apify shows it aborted |
| "No evidence met the discovery engagement thresholds…" | Too few engaging posts | Widen the window, add sources or lower **Discovery engagement thresholds**, then start a new run |
| "Discovery found no specific, evidence-backed trends in this window." | Finished, but no themes | Use a wider window, more sources or a clearer focus |
| "Theme synthesis exceeds the context budget…" | Too much evidence | Use a shorter window or fewer sources |
| "This step needs about $X but $Y of the run's AI budget is left…", "Claude stopped at this step's spending cap…", "Run budget exhausted.", "Not enough AI budget remains for the paired reports…" | The AI budget ran out | Raise **Total retry budget (USD)**, then **Retry unfinished outputs** |
| "The app stopped during this run. Retry resumes saved stages and keeps completed assets." | The app quit or crashed mid-run | **Retry unfinished outputs** |
| "Claude stopped before finishing (exit code N)…" | The Claude app failed | **Check Claude**, then retry |
| "Claude returned an unverified or different model…" | The account answered with another model | Choose a model the account can use |
| "The Anthropic API key was rejected…", "…billing problem…", "…rate limit…", "…temporarily overloaded…" | Key, account or API limits | Fix the key or account in the Anthropic Console, or wait and retry (lower **Batches at once** for rate limits) |
| "Google Drive publishing needs attention: …" | Publishing failed after reports finished | Fix the Google setup, then **Publish to Google Drive** |

### FAQ

**How do I run my first research program?**
Follow the [first-time setup checklist](#first-time-setup-checklist), steps 7 and 8.

**Why did my run stop?**
Find the red message from the run panel (or **Activity**) in the table above. Fix the cause, then use **Retry unfinished outputs**; its **Total retry budget (USD)** includes what the run already spent. Finished jobs, batches and reports aren't paid for again.

**A platform returned no posts. Why?**
Sheets shows "No <platform> posts in this run" on that tab. Check: the source is ticked with a valid list; the accounts posted inside the date window (a 1-day look-back often finds little); that platform's budget share didn't run out (collection-budget or "ended … kept the N rows" warnings); the focus filter isn't narrowing X or Reddit; and no "source jobs failed" error. Private, suspended or misspelled accounts return nothing.

**Claude Code works in Terminal, but the app says it isn't installed.**
The app looks for `claude` the way Terminal does and in the usual install folders. Quit and reopen the app, then click **Check Claude**. Or switch to **Anthropic API key**.

**Reddit coverage looks thin.**
Each subreddit's newest posts are scrolled back toward the window start, so busy subreddits can stop at **Reddit posts per subreddit** (300) or at the scroll time first. Under Advanced research controls, check **Reddit scroll time (seconds)** (300; programs saved before this release may still have the old 90) and **Reddit communities per Apify run** (6). Also check Reddit's share of the collection budget and the 120-minute limit.

**I reused a saved collection and lost most posts.**
The program's date window still applies. Choose **Custom dates** covering the collection, or a longer **Search the last (days)**.

**Sheets tabs or rows look empty.**
Theme columns, Theme Summary Data and Post Counts Reference fill only after you approve themes and tagging runs. Trend Velocity builds up across runs. Taxonomy Lookup needs a taxonomy. A run opens in Sheets only once collection finishes. For missing rows, check the filter chips (**Clear all**) and **Columns**.

**Why is a theme LOW?**
Usually it matched a SATURATED taxonomy category where the blog publishes actively (LOW_OPPORTUNITY), or a MODERATE one with recent coverage (CHECK_RECENCY), it was first seen in this run (NEW), and it is EVERGREEN. Repeating the category's top phrases costs 2 more points. LOW is advice, not a block: you can still approve the theme.

**Why is every theme FAST-TRACK or STRONG?**
No taxonomy is loaded, so every theme counts as new territory. Load one in **Brand knowledge → Research knowledge → Taxonomy lookup**.

**What does "Seen twice" mean?**
The theme was detected by two runs in this workspace on this Mac (velocity EMERGING). Three or more is ACCELERATING. Runs on other testers' Macs don't count.

**A report has few or no quotes.**
Quotes come only from X and LinkedIn posts tagged to that theme, and must be exact excerpts. Reddit-heavy themes get evidence links instead. The report's Limitations section notes shortfalls, such as "Only 3 verified direct quotes (target 6–9)."

**A theme got no report.**
No posts were tagged to it. See the warning "No posts were tagged to…". Check its matching criteria, or approve a broader theme next time.

**The toolkit says "⚠️ TOOLKIT CHECK".**
It named tools that aren't listed under the chosen toolkit in your registry. Review before using, and update the registry in Brand knowledge if needed. "No product registry loaded" means both angles describe the gap.

**Can I export to Google Sheets or Google Docs?**
Only with the Sheets bridge (Settings → Google Sheets), which isn't set up for testers yet. Use **Export → Download workbook (.xlsx)** and open it in Google Sheets (File → Import). For reports, use **Export pack** or **Export run**, or copy from Library.

**The app asked me before quitting.**
If a research run, content run, chat answer, scraper run or other AI work is running, quitting shows "Something is still running" with **Keep working** and **Quit anyway**. Quitting anyway stops the work and loses AI work in progress. Apify jobs already started finish on Apify's servers within their caps. Later, **Retry unfinished outputs** keeps every finished step. Closing the window instead keeps the app and schedules running.

**My scheduled run didn't happen.**
See [Schedules](#schedules): the app must be running and the Mac awake, runs are skipped while the previous run is active or awaiting review, and a failed scheduled run pauses the schedule. Imported schedules arrive paused: click **Resume schedule**.

**Import setup failed.**
"This is not a Scraper Studio setup file." means the wrong file. "…from a newer Scraper Studio. Update the app…" needs the newer app. "Program "…" already belongs to "…"" means that program lives in another workspace on your Mac. "This preview has expired." means open the file again. Nothing is imported unless the whole file passes.

**The app won't open a second copy.**
Only one copy runs at a time; opening it again brings the existing window forward. "Workspace already in use" means another copy or server is using the data folder. Quit it first.

**Where does my data live?**
In `~/Library/Application Support/apify-scraper-studio` (**Settings → Local files & workspace details → Open data folder**). `content-studio` holds workspaces, programs and runs (one folder per run with its evidence, batches and reports), and `content-studio/exports` holds exports. `workbooks` holds Sheets imports and edits, and `data.json` holds settings and More tools data. Keys are encrypted with the macOS keychain. Don't edit these files by hand.

**How do I report a problem?**
Ask AI first. Then send the team: what you did and expected; a screenshot of the page and any message; a screenshot of **Settings → Connection diagnostics** (expanded); the program name and run start time (the run ID, starting `research-`, is under **Activity** → select the run → **Technical details**); and the app version (bottom of the sidebar) and macOS version. Never send API keys, or a setup file that contains the Apify token.

## Glossary

- **Actor**: an Apify scraper. Each source uses one.
- **AI budget / Collection budget**: the most one run may spend on Claude / on Apify.
- **Batch**: posts sent to Claude in one call: up to 200 per platform for discovery, 40–50 for tagging.
- **Candidate**: a possible trend from one discovery batch, before merging.
- **Classification / tagging**: assigning each post to one approved theme or none.
- **Confidence**: how sure tagging is (0–1). 0.7+ accepted; 0.55–0.69 needs review; lower is no theme.
- **Deliverable / output / asset**: one generated item, such as a report, article or image. Saved items appear in Library.
- **Edition**: Semrush or General. It sets a workspace's prompts, formats and branding.
- **Editorial toolkit**: the second document per theme (angles, headlines, hooks, CTAs), built from the trends report.
- **Evidence**: the posts a run kept after cleanup (**Retained evidence items**).
- **Gap signal**: how open a theme's topic is in your coverage, from NEW_TERRITORY to LOW_OPPORTUNITY.
- **Lane**: one platform's collection jobs. Lanes run in parallel.
- **prevalence_score**: a post's engagement score (log scale). Engagement thresholds use it.
- **Program**: a saved research brief: sources, dates, budgets and AI settings.
- **Registry**: approved products, segments, capabilities and tools that writers may name.
- **Route**: how the app reaches Claude (Claude app or API key).
- **Run**: one execution of a program (research run) or of Create content (content run).
- **Setup file**: a JSON export of a workspace's knowledge and programs.
- **Taxonomy**: your content categories with zones and coverage; it drives gap signals.
- **Theme**: a synthesized trend with name, description, keywords and criteria. Up to six per run.
- **Theme repository / tracked themes**: themes this workspace has seen across runs, used for matching and velocity.
- **Trends report**: the comprehensive evidence report per theme.
- **Velocity**: how many runs detected a theme: NEW, EMERGING (Seen twice), ACCELERATING (3+).
- **Workspace**: a separate set of knowledge, programs, runs and assets.
- **Zone**: a taxonomy category's saturation (OPEN, MODERATE, SATURATED).

## Limits and what the app doesn't do yet

- **Everything is local to each Mac.** Runs, collected posts, themes, trend history, Sheets edits and Library items stay on the Mac that made them. There is no shared history or team sync. Velocity counts only your own runs. Share setups with **Share your setup**, and share results by exporting.
- **Google delivery is pending for testers.** Create Google Sheet, Pull from a Google Sheets link, and Publish to Google Drive need the Sheets bridge, which isn't set up for testers yet. Google Doc imports need a manually pasted token that expires.
- **The build isn't notarized yet**, so macOS asks you to confirm it once (System Settings → Privacy & Security → **Open Anyway**) the first time you open it. There are no automatic updates. Install new builds by hand.
- **Schedules run only while the app is open** and the Mac is awake.
- **Ask AI can't act**: it can't click, change settings, start runs, or read posts and reports.
- **Collection is a sample**, not the whole platform. Spending caps, time limits, private accounts and the per-author cap all reduce coverage. Counts describe your sample, not market prevalence.
- **Research collections don't appear in Datasets or Chat with findings.** Use Sheets.
- **The app doesn't track blog coverage on its own.** Priority scoring uses the taxonomy you import.
- **Images need your own OpenAI key.** There are no user accounts or permissions, and Windows is not yet tested.
