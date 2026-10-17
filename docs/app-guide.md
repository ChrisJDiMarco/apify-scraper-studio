# Scraper Studio app guide

This guide explains how Scraper Studio works: every page, what each control does, what a research run does step by step, what things cost, and how to fix common problems. The in-app **Ask AI** assistant answers from this guide. It describes version 0.3 of Scraper Studio, both the Mac app and the browser studio (see [The browser studio](#the-browser-studio)).

Labels in **bold** are the exact words you see in the app.

## What Scraper Studio is for

Scraper Studio is a Mac app for social listening research and content. It collects public posts from X (Twitter), LinkedIn and Reddit through Apify, uses Claude to find the trends in those posts, writes an evidence-backed trends report and an editorial toolkit for each trend you approve, and turns them into channel content.

The research pipeline reproduces the team's earlier n8n "Golden Thread" workflow (same sources, batch sizes, scoring and sheet layout), so a few labels mention n8n.

### Workspaces and editions

- A **workspace** holds its own brand knowledge, approved products, taxonomy, reference documents, research programs, runs, trend history and Library. Workspaces share nothing.
- Each workspace has an **edition**, fixed at creation. **Semrush workspace** has Semrush branding, prompts tuned to SEO and search marketing, starter brand knowledge, and Semrush editorial formats (Backlinko, Exploding Topics, Search Engine Land). **General** (listed as **Your brand**) runs the same pipeline for any brand.
- A fresh install has **Semrush workspace** and **Your workspace** (General). Tester builds open in the Semrush workspace, where the sidebar shows the Semrush wordmark and "Research & content studio": the Semrush edition of Scraper Studio.
- Admins switch workspaces with the workspace switcher at the top of the left sidebar (the workspace's name, with your role and layout under it). Its list ends with **New workspace**, which opens a **Create a workspace** form in Brand knowledge; **New → Workspace** does the same. Editors and channel owners see the workspace name there and follow the studio's active workspace.
- Settings (keys, the Claude connection, Google and Monday.com) apply to every workspace on the Mac. Only admins see Settings.

### The flow, end to end

1. **Collect**: Apify gathers posts from the program's X accounts, LinkedIn profiles and subreddits, all platforms at once.
2. **Prepare evidence**: duplicates, out-of-window posts and excess posts per author are removed; each post gets an engagement score.
3. **Discover in batches**: Claude reads the more engaging posts, up to 200 per batch per platform, and proposes candidate trends.
4. **Identify themes**: candidates become up to six themes, matched against tracked themes and given a priority tier.
5. **You review**: the run pauses until you say **Yes** or **Skip** to each trend (unless **Approve themes automatically** is on). **Yes, with a note…** adds a note for the channels and can send the trend to some channels only.
6. **Tag every post**: each eligible post gets one approved theme or none.
7. **Write reports**: each approved trend gets a trends report, then an editorial toolkit built from it.
8. **Make channel assets** or **Create content**: any report can become every channel asset at once, or articles, social posts, sales briefs, ads and more.

A **quick scan**, started from Ask AI, is the short version: a few hours of posts from the program's best-matching accounts, collected and read for trends, and then it stops (see [Quick scans from Ask AI](#quick-scans-from-ask-ai)).

| What | Where you find it |
| --- | --- |
| Trends waiting for your OK, and their stage | **Trends** (Simple) or **Trend board** (Advanced) |
| Trends reports, editorial toolkits and drafts | **Reports** (Simple) or **Library** (Advanced) |
| Channel assets and pictures | **Assets** (Simple), and the **Library** folders (Advanced) |
| What needs you this week, and what changed | **Home** (the weekly briefing, in both layouts) and **Inbox** |
| How trends move across runs (new, rising, fading) | **What changed** on Home, and **Sheets → Trend tracker** |
| When each channel plans to use a trend | **Calendar** (channel owners: **My plan**) |
| The prompts behind research, reports and assets | **Prompts**, in the sidebar's **Studio** group |
| People, roles and what each role can do | **People & access** (admins) |
| Run progress, theme review, retry, run history | **Research programs** (Advanced) |
| Every collected post with its tags and theme totals | **Sheets** (one workbook per run) |
| New content from a report or brief | **Create content** (Advanced) |

## Getting around

### Navigation

One left sidebar serves both layouts and every role. Top to bottom:

- **The head**: the studio's wordmark, the collapse button (⌘\) and the workspace switcher, which shows the workspace with your role and layout under its name. Admins open it to switch workspaces or start a **New workspace**; for everyone else it's a label. It's turned off while an admin previews someone.
- **New** (⌥⌘N), **Search…** (⌘K) and **Ask AI** (⌘J). **New** lists what you can start: **Find new trends** (with a list of programs when there are several), **Quick scan**, **Channel assets**, **Content from a report** and **Picture**; admins also get **Research program**, **Person** and **Workspace** below a line. Paid work still shows its estimate before it starts. **Quick scan** and **Picture** open Ask AI with the first words typed for you to finish; **Channel assets** opens the Make channel assets dialog in Assets; **Content from a report** opens Create content (an Advanced page); **Person** opens the invite dialog in People & access. **Ask AI** opens the Ask AI page in Simple and the Ask AI drawer beside the page in Advanced (press it again to close the drawer).
- **The pages** of the layout you're in (see below), then the **Studio** group: **Prompts** (admins, and editors whose role can see prompts), **Analytics** and **People & access** (admins), and **Settings** (admins, ⌘,). Settings shows an amber dot while Apify isn't connected.
- **The footer**: **N running** while research, quick scans, channel assets or other jobs run (it opens **Working now**, each with **Open** and **Stop**); the **Simple | Advanced** switch; and your account (your name and role, and the app version). The account menu has **View as** (admins), **My channels…**, **Keyboard shortcuts** and, in the browser studio, **Sign out**.

Numbers on pages count only work waiting on you: **Trends** (and the **Trend board**) count trends that need your OK, and **Inbox** counts unread rows. A dot means something is running there: research, reports being written, or channel assets being made. Screen readers hear both in words ("Trends, 3 need your OK").

**The rail.** The collapse button or ⌘\ shrinks the sidebar to a narrow column of icons; hover or focus an icon to see its name, and press again to expand it. Counts become dots. Your choice is saved for you. Until you choose, windows between 861 and 1100 pixels wide get the rail. On a narrow window or a phone the sidebar opens from the **Menu** button at the top left instead.

**Keyboard shortcuts** (the account menu's **Keyboard shortcuts** lists the ones you have; outside the Mac, use Ctrl for ⌘ and Alt for ⌥):

| Keys | What it does |
| --- | --- |
| ⌘1 to ⌘9 | Open the pages in sidebar order, in every layout |
| ⌘K | Search reports, trends and pages |
| ⌘J | Ask AI |
| ⌥⌘N | New |
| ⌘, | Settings (admins) |
| ⌘\ | Collapse or expand the sidebar |
| Esc | Close the open menu, dialog or search |

The page numbers follow the sidebar. In Simple: Home ⌘1, Trends ⌘2, Reports ⌘3, Assets ⌘4, Inbox ⌘5, Calendar ⌘6, then the Studio pages. Data tools and Settings take no number.

**My channels.** **My channels…** in the account menu picks the channels you make content for (up to 6). Assets then shows those channels first, **Make channel assets** starts with only their files ticked, trend cards say which of them a trend fits ("Fits Social"), and the weekly briefing gets a **Ready for your channels** card. Choose none to see every channel the same way.

The layout switch is remembered per person. **Simple** shows the essentials; **Advanced** shows every tool, including research programs, sheets and scrapers. Links in Simple that go to an Advanced page (**See why**, research setup, a page button under an Ask AI answer, **Open the Trend tracker**, an Advanced page picked in Search) open it without changing your layout. A bar above that page says "You’re looking at an Advanced page. Your layout is still Simple.", with **Back to Simple** and **Keep Advanced** (which makes Advanced your layout).

Advanced layout, Semrush workspace: **Research** (**Home**, **Inbox**, **Research programs**, **Trend board**, **Sheets**) and **Content** (**Create content**, **Library**, **Calendar**, **Brand knowledge**).

Advanced layout, General workspace: **Workspace** (**Content studio**, with its own tabs for Overview, Research programs, Trend board, Create content, Library and Brand knowledge; **Overview**, the collection overview; **Sheets**; **Inbox**; **Calendar**).

Both editions then have **Data tools**, a group that opens and closes and stays as you left it on this computer: **Collect** (**Search platforms**, **Scrapers**, **Import research**), **Analyze** (**Datasets**, **Dataset reports**, **Compare snapshots**, **Ask your datasets**), **Automate** (**Playbooks**, **Workflows**), then **Activity**. It starts closed where the studio has a content workspace. While it's closed, its button names the Data tools page you have open. The Semrush sidebar has no Collection overview; its tools are all under Data tools. A role without data tools doesn't see the group.

In the Advanced layout, the top bar shows the workspace name and the page you're on (workspace › page), a working note while quick tasks run, and **Refresh workspace**. Search and Ask AI live in the sidebar.

**Search (⌘K), in both layouts.** One search for the studio, with results in groups:

- **Pages**: every page you can open. In Simple, Advanced pages are listed too, marked **Advanced layout**, and open with the Back to Simple bar.
- **Trends waiting for you**: **Review: <trend>** opens Trends (or the Trend board) at that trend's card.
- **Reports**: **Read: <trend>**, one per trend, opens its Trends report (in Simple's Reports, or the Advanced Library).
- **Research programs**: **Find new trends with <program>** shows the estimate and asks before it starts.
- **Create**: the same things as **New**.
- **Actions**: switch layout (or **Back to Simple**), **Open Ask AI**, **Create a new scraper** and saved workflows.
- Whatever you type can go to Ask AI: the last result is **Ask AI: <what you typed>**.

Pages show their ⌘ number. ↑ and ↓ move, Enter opens, Esc closes.

### Simple mode

Simple mode is on by default. It shows the studio as a few pages in the left sidebar, in the order the work happens; ⌘1 to ⌘6 follow them:

- **Home** (⌘1): the weekly briefing, with the **Ask anything** box under its title (see [Weekly briefing](#weekly-briefing)).
- **Trends** (⌘2): **List** or **Board** at the top right (remembered on this computer). **List**: **Needs your OK** cards (priority, sources and platforms) with **Yes** and **Skip**; each card has a **Why it matters** line (novelty, the momentum badge, "Seen in N runs", and "Fits Social" when the trend was sent to one of your channels) and **What people are saying**, which asks Ask AI to quote two short real posts from the research. The arrow beside **Yes** holds **Yes, with a note…** (see [Saying yes with a note](#saying-yes-with-a-note)); a bar to **Write reports** for approved trends; **Being written**; **Ready**. **Board**: one column per stage (**Needs your OK**, **Approved**, **Being written**, **Ready**, **Skipped**), with Yes / Skip, Write reports and Read on the cards; an empty column says what comes next. With more than one research program, a picker sits beside **Find new trends**; it's the same choice as on Home. **Find new trends** starts research after a confirmation that shows the estimate; if a search with the same program is still running or waiting for review, it says who started it and when, and asks before starting another. With no trends yet, the page offers **Start research with "<program>"** (or **Set up research**, or names the admin to ask). A card's momentum badge (**New**, **Rising**, **Steady** or **Fading**) comes from the Trend tracker. Decided cards say who decided and when ("Approved by Riley · Oct 14" or "Skipped by Sam · Oct 14", or "Approved automatically"), with the note and the channels it was sent to.
- **Reports** (⌘3): grouped by research run ("Oct 14 · <program>"), one row per trend, titled with the trend's name ("Trends report + editorial toolkit · <date>"), then **Other reports and drafts** grouped Today, Yesterday, This week, This month and Earlier. Search, and filter with **All**, **Trends reports**, **Toolkits** and **Drafts**. A trend's row opens its Trends report. In the reader, the **Trends report | Editorial toolkit** switch flips between the trend's two documents, a line shows where they are filed (research run › trend › document), and **Channel assets (N)** opens the trend's folder in Assets once assets were made. The reader has **Edit**, **Copy text**, **Open file** (Mac) or **Download** (browser), **Copy link** (see [Share links](#share-links)), **Share** (see [Sending a report to Google Docs, slides or Slack](#sending-a-report-to-google-docs-slides-or-slack)), **Make channel assets** and **Ask AI about this**, whose arrow holds **Next steps for my team**, **Summarize for Slack**, **3 headline options**, **PR pitch angle** and **What would we need to prove this?**; ← and → page through the rows and Esc returns to the list. A status filter beside the chips shows reports in one stage (see [Content status](#content-status)), and the status chip under the title changes it. **How this was made** closes every report (see [How this was made](#how-this-was-made)). Drafts from channel asset runs live in Assets, not here. Under the title, **Edited by** shows who last edited the report and when, and **Used by** names the channels whose owners said they used the trend; **Where it’s used** at the end lists their links.
- **Assets** (⌘4): a folder for each research run, newest first ("Oct 14 · <program>"; a quick scan gets one, "Quick scan · <topic>", only if it made files), with a folder per trend inside. A trend's folder holds **Trends report & toolkit**, **Channel assets** (each set, with a folder per channel team; see Channel asset kits below) and that trend's **Pictures**. Trends from research runs no longer in the workspace are listed under **Trends**; **Other sources** holds sets made from a Google Doc, a file or pasted text; a line counts research runs still running or waiting for review, whose folders appear once their reports are written; and **Pictures** holds every picture from channel asset runs, Create content and Ask AI, with filters. **Make channel assets** and **Make a picture** sit at the top right. Inside a set, your channels (from **My channels**) come first, with **Your channels** | **All channels**; written files carry a status chip, and a status filter narrows the list (see [Content status](#content-status)).
- **Inbox** (⌘5): what changed that needs you, with an unread count (see [Inbox](#inbox)).
- **Calendar** (⌘6): when each channel plans to use the trends it took (see [Calendar and My plan](#calendar-and-my-plan)).
- **Ask AI** (⌘J, from the top of the sidebar): the assistant as a full page (see Ask AI).
- The **Studio** pages, for admins (and **Prompts** for editors whose role can see prompts): **Prompts**, **Analytics**, **People & access** and **Settings** (⌘,): connections, Claude, images and brand reference images, Google and Monday.com. The layout switch is in the sidebar, not in Settings.

While work runs, **N running** at the bottom of the sidebar lists it, each with **Open** and **Stop**.

**Editing a report.** Admins and editors can press **Edit** in the reader (or on a written file in an asset folder) to change the text in place: **Write** and **Preview**, then **Save** (⌘S) or **Cancel**. Formatting is Markdown: # Heading, **bold**, - list, [text](https://…). Leaving with unsaved edits asks first. Everything made from the report afterwards uses the edited text: channel asset kits, Create content, exports, Google Drive and Ask AI. **Save to Google Drive** after an edit adds the edited version as a new Doc ending in "(edited)" next to the original, which Drive keeps as it was. Links in an edit need https://; an http:// address stays plain text. If someone else saved the report after you opened it, saving stops and says who and when; copy your text, reopen the report and try again. **Restore the original** removes the edits; drafts already made from the edited version stay as they are. While you edit, **Check against brand** beside the text lists things worth a second look before it goes out, and **Ask AI to review the voice** asks Ask AI to compare it with your brand voice (see [Brand check](#brand-check)); neither stops **Save**.

### Channel asset kits (Assets)

A channel asset kit is the Golden Thread "Generate All Channel Assets" n8n workflow inside the app: one report becomes every channel asset, filed the way n8n filed them in Drive.

- **Start**: **Assets → Make channel assets**, or **Make channel assets** in the report reader, or ask Ask AI. Step 1 picks the source: **Your reports** (a trend's trends report and editorial toolkit count as one choice and are read together, with the posts the report cites), **Google Doc link** (a doc shared as "Anyone with the link" needs no Google connection; private docs need the Google Docs token in Settings), or **Paste text** (with an optional title, or upload a .docx, .md or .txt file). Step 2 shows every channel folder and asset, ticked; untick what you don't need. If you've picked **My channels**, only your channels' files start ticked ("Ticked for your channels: …"); tick more if you need them. It shows the asset and picture counts, **About $X** with **Stops at $Y at most** (the run's cap, about twice the estimate so each asset can get one repair attempt; unspent budget isn't charged), the expected minutes, and the writing model. **Make N assets** starts it.
- **What it makes** (Semrush workspace folder names and n8n file names): **Semrush Blog** (Blog — Short News Update, Blog — Long-form Article), **Semrush Newsletter** (Newsletter — Teaser + Long-form), **Semrush Paid Media** (Paid Media — Search Ads + Keywords, Paid Media — Landing Page), **Semrush PR** (PR — Journalist Outreach Research), **Semrush Social Team** (Social Team — LinkedIn + X + FB Captions, Social Team — Hero Graphic ×3), **Affiliate Program** (Affiliate — Partner Promo Pack), **Enterprise Sales Enablement** (Enterprise — Sales Enablement Brief), **Backlinko** (Backlinko — Video Script), **Exploding Topics** (Exploding Topics — Social + Email + Trend Card), **Search Engine Land / MarTech** (Search Engine Land — News Update + Video Script, Editorial Hero ×3, Social Hero ×3). That is 12 written assets and 9 pictures. The general workspace uses plain folder names and has no Search Engine Land pictures. Pictures need an OpenAI key; without one they're left out.
- **How it runs**: writing goes through whichever way the app reaches AI (Settings → Writing & research): the Claude app on a subscription, an Anthropic API key, or Codex. On Claude it uses the report model and effort of the workspace's latest research program (Claude Fable 5.1 at high effort by default, as n8n used Fable). On Codex it uses Codex's own model and your Codex plan or OpenAI key; Codex doesn't report costs, so the dialog shows no price and the cap doesn't apply. It writes a few assets at a time, with pictures in their own lane. A draft that fails the checks gets one repair attempt. For each picture set, Claude first writes the art direction (headline, up to two facts with their sources, the visual idea), as n8n's image-prompt step did, then OpenAI draws three variations. When the set has **brand reference images** (Settings → Brand reference images), OpenAI gets them with every picture, as n8n sent its style examples and the SEL logo: style examples guide the look (palette, type, texture) and are never copied, and an approved logo is placed exactly as supplied in a clean footer, lower right. A set without a logo draws none and leaves the footer clean. Step 2 says how many picture sets send reference images, with a link to Settings; each reference image adds about $0.015 per picture to the estimate. A run keeps the reference images it started with, so **Finish the rest** sends the same ones even if Settings changed. A full kit from a trend is typically about $8–12 and 10–15 minutes.
- **Folders**: a set made from a trends report is filed in that trend's folder, inside the research run that reported it (**Assets** → the run → the trend → **Channel assets**), never with another run's report of the same trend. Sets made from a Google Doc, a file or pasted text are under **Other sources**. Each set is named like n8n's Drive folder, "Golden Thread — <trend> (<date>)". Open a trend's folder to see its sets, newest first, and the open set's channel folders (grouped by the channel team each asset belongs to), each file with its status (Waiting, Writing, Drawing, ready, or why it needs another try). Click a written asset to read it (Copy text, Open file or Download; ← and → page through the set). Click a picture to enlarge it. The Advanced **Library** files the same sets in the same folders.
- **Run actions**: **Save folder** (Mac: copies the run's folder, with a channel folder each and a Source file, into Downloads and shows it in Finder) or **Download folder** (browser: a .zip); **Save to Google Drive** when Google publishing is connected (the same folder and file names in Drive); **Stop** while it runs (finished assets are kept); **Finish the rest** for assets that didn't make it (asks to confirm what it can spend; finished assets aren't made again); **Make another set** and **Read the report** at the top of the folder.
- While a kit runs, Home shows it under **Working now** and a trend's card on the Trends tab shows **Creating assets**.
- Each written file has a status chip (Draft, In review, Approved, Scheduled, Published); see [Content status](#content-status).

### Ask AI

**Ask AI** answers questions, does work for you after you confirm, plans and prices quick scans, and can take you to a control and point at it, in both layouts. **Ask AI** sits at the top of the left sidebar (⌘J): in Simple mode it opens the Ask AI page; in the Advanced layout it opens a drawer beside the page. Both show the same saved conversations. Admins and editors have Ask AI (a custom role has it when its access includes **Use Ask AI**); it only points people at pages they can open. Channel owners don't have it.

- **What it sees**: this guide plus a picture of your studio: the layout, and the tab, page, report or folder you were on; your workspace; which connections are saved (yes or no only); the AI route and model; research programs; recent research runs and the last five quick scans; what's running now; every trend waiting for your OK or approved; the trend memory (what is new, rising and fading across all research runs, from the Trend tracker); every report title; every asset folder with its runs and what needs another try; and, for people who can see prompts, the list of prompts with their versions. It never sees API keys or tokens.
- **It reads when it needs to**: titles aren't contents, so for questions like "what does the AI citation report say about budgets?", "is AI search visibility still growing?" or "what are people saying about zero-click results?" it first looks up to three things, then answers: a report, an asset folder, a run, one trend's full history across runs, collected posts (a keyword search of this workspace's recent research runs and quick scans that returns the top 12 by engagement, with platform, author, text and link), your earlier conversations, older memory, or (for people who can see prompts) one prompt with its parts and its last five changes. The answer notes what it read. Reading adds a second AI call.
- **Cards**: answers can carry cards built from the studio's own data, so their numbers, statuses and links are the studio's, never the AI's: a trend (stage, momentum badge, posts per run, platforms, with **Open report**, **Yes** and **Skip** while it waits for your OK), a report (**Open**), an asset folder (channel chips and progress, **Open folder**), a run (its live status, with **Stop**, **Try again** and **Summarize what changed**), a research program (**See the program**), a chart of a trend's share of posts or post counts across runs (with a text summary for screen readers), a few numbers side by side, a short table, a checklist, a comparison, quoted posts with links (**What people are saying**), a quick-scan plan, and **Remembered**. A card whose subject can't be found in the studio is left out.
- **It does the work**: when you ask it to do something it can do, the answer offers buttons, in both layouts. Nothing happens until you click, and anything that spends money first shows a confirmation with the estimate and the caps. It can start research, run a quick scan, say yes or skip to a trend or to all waiting trends, write the reports, open a report, open the Make channel assets dialog on a report (you check the cost and press Make), open an asset folder, finish the rest of an asset run, save a run's folder, stop or retry a run, switch tabs and open the Trend tracker. In the Advanced layout, reports and asset folders open in the **Library**, and **Make channel assets** switches to the Simple layout's Assets, where the asset dialog is (switch back in the sidebar).
- **Show me**: when you ask where something is or how to do something, the answer can take you there: it switches tabs or pages, opens the report, folder or dialog it needs, and rings the exact control with a note on what to do. In Simple it covers every page, the sidebar, Settings and Ask AI itself; in Advanced, the sidebar, Ask AI, Settings, Inbox, Calendar, Prompts, People & access, the Library's folder tree and search, and the Trend tracker's momentum chips. Steps that exist only in the other layout are left out. Multi-step answers walk through each step; **Next** (or →) moves on, clicking the highlighted control does too, and **Back to chat** returns. When it isn't taking you there right away, the answer has a **Show me** button.
- **Stop**: while an answer is being written, **Stop** (beside "Looking at your studio…") stops it. Nothing is saved and nothing more is spent; **Ask again** asks the same question. If an answer fails, **Ask again** retries without paying twice for an answer that did arrive.
- **Cost**: each question uses the studio's AI connection (Settings → Writing & research). On the Claude app or the Anthropic API key it uses the **Default Claude model** at medium effort: about $0.15, capped at $0.75 per call; through the API key the fixed part of its instructions is cached, so follow-up questions cost a little less. The first question of a session on the Claude app also checks the model once (a few cents). On Codex it uses Codex's own model, and Codex doesn't report costs. Each answer shows the model and cost.
- **Prompts**: people who can see prompts can ask how a prompt works ("what does the trends report prompt tell Claude about quotes?"); Ask AI reads the prompt before it answers. People whose role can edit prompts can also ask for a change ("make the toolkit headlines shorter"). Ask AI then offers one edit at a time, on a card that shows the part it changes, the lines added and removed, and anything the studio's checks would refuse. Nothing changes until you press **Apply as version N** (free), which saves a new version marked as made with Ask AI (see [Prompts](#prompts)); **Open in Prompts** opens the prompt instead. If someone saved the prompt after the suggestion, or an admin locked it, **Apply** is off and the card says why. Ask AI never says a prompt was changed unless you applied it.
- If the AI can't be reached, the error offers **Open Settings** to admins; editors are told which admin to ask.
- AI answers can be mistaken. Check important numbers on the page itself.

**Saved conversations.** Every conversation is saved in the studio for you only: nobody else can open your conversations or your memory, admins included. A conversation survives a reload, a restart and a layout switch, and the one you had open reopens. In Simple, the left rail lists them: **New conversation**, **Search conversations**, then **Pinned** and **Recent**. Each one's **⋯** menu has **Pin to top** (or **Unpin**), **Rename** and **Delete** (it asks first, and deletion is for good). On a narrow window the rail opens from **Conversations**. In the Advanced drawer, the clock button shows the same list. Conversations belong to the workspace they were held in, so switching workspace starts a fresh thread and lists that workspace's conversations. Ask AI reads the last few messages of a conversation plus a running summary of the earlier ones, and knows what happened with its buttons ("Offered: Start research for X. Outcome: started."), so "do the same for the other one" works. In the browser studio, everyone who signs in with the admin password shares one set of conversations and memory; people with their own sign-in link each have their own.

**What Ask AI remembers.** Ask AI keeps a short memory per person, so answers fit you without being told twice: preferences (channels, tone, formats), decisions (on trends or programs), goals, and facts about this workspace. It keeps only what you said or decided, never keys, numbers the studio already knows, or text from reports and posts. When an answer remembered something, **Remembered** shows under it with **Undo**. The **Memory** button (the brain button in the Advanced drawer) opens **What Ask AI remembers**, in two groups, **About you** and **This workspace**: pin an item so it's used in every answer, edit it, forget it, or add something yourself (**Add something to remember**, then choose who it's about). Up to 300 items; past that, the oldest unpinned ones go first. Removing a person from the studio deletes their conversations and memory.

**Pictures in Ask AI.** Ask for a picture in plain words, for example "Create a hero image for my latest trend" or "a square LinkedIn graphic about AI Overviews in lavender and mint". Claude writes a detailed prompt and OpenAI draws it; a placeholder shows while it's drawn, usually under a minute.

- Pictures need an OpenAI API key in **Settings → Image generation** (the same key Create content uses). Without it, Ask AI explains how to add one to an admin, and tells an editor to ask an admin to turn pictures on.
- Brand and campaign pictures follow the workspace's visual direction (in the Semrush workspace, the Semrush brand palette). Describe your own style and it follows yours instead. It never draws company logos; it leaves space for one.
- Sizes: landscape (the default, for social and hero images), square or portrait. Ask for the shape you want.
- To change a picture, just say so ("make it bluer", "remove the text"): Ask AI rewrites the earlier prompt with your change and draws a new one.
- Click a picture to see it full size. **Download** saves the PNG. If drawing fails, **Try again** repeats it.
- Each picture costs a few cents of OpenAI usage on top of the answer; the cost shows under the picture. The app reserves at most $1 per picture.
- Pictures are saved in the studio's data folder and appear under **Assets → Pictures** (Made in Ask AI) and in the Advanced Library's **Pictures → Made in Ask AI** folder. A saved conversation shows its pictures again when you reopen it.

### Quick scans from Ask AI

A quick scan is a small, fast research run for questions like "do a small scrape, keep the cost low, and tell me what's going on in SEO in the last few hours". It borrows the accounts of a saved research program, picks the ones that fit the topic, collects a few hours of posts, finds the trends in them and stops. The saved program, its schedule and its next run are never changed. Admins and editors can run them.

- **Ask for one** in plain words. The answer offers a button such as **Run a small scan on SEO (last 6 hours)** and a **Quick scan plan** card. Nothing runs until you press **Start scan**.
- **The plan card** shows every setting, and you can change any of them: **Look for** (the topic), **Accounts from** (which program), **How deep** (**Small and cheap**, **Balanced** or **Thorough**), **Platforms** (X, LinkedIn, Reddit; at least one), accounts per platform, **Posts per platform**, **Comments per post**, **Posts from the last** (1h, 3h, 6h, 12h, 24h, 3d, 7d, or **Custom** hours up to 168), and the **AI cap** and **Apify cap**.

| How deep | Posts per platform | Accounts (X / LinkedIn / Reddit) | Comments per post | Window | AI cap | Apify cap |
| --- | --- | --- | --- | --- | --- | --- |
| **Small and cheap** | 60 | 8 / 6 / 4 | 0 | 12 hours | $1.50 | $1.50 |
| **Balanced** | 200 | 20 / 15 / 8 | 5 | 24 hours | $5 | $5 |
| **Thorough** | 600 | 50 / 40 / 20 | 10 | 72 hours | $15 | $15 |

- **Which accounts**: the program's accounts are ranked for the topic, at no cost: first by how many of their earlier posts matched it (recent runs count more), then by a topic word in the account's name, then by recent activity, then by saved order. LinkedIn keyword search uses the topic as its search. **Check cost** lists the chosen accounts with the reasons.
- **Check cost** prices the plan before anything is spent: the plan in words, the AI estimate against the AI cap, the Apify worst case against the Apify cap, and any warnings. Change anything and the check is out of date, so **Start scan** waits for a fresh one. If a cap is too low for the Actors to start, or another quick scan is already running in this workspace, **Start scan** stays off and says why. **Start scan** shows the plan once more in a confirmation, then starts. If the plan changed in between (a program edit, new accounts), it stops with "The plan changed; check the cost again."
- **On each AI route**: on the Claude app and the Anthropic API key, the AI cap is a hard limit, and the first scan of a session checks the model once (a few cents on the Claude app). **Small and cheap** uses Claude Sonnet 5.5 at low effort; the full preset is typically about $0.35 of AI and at most about $0.75 on Apify. On **Codex**, the studio can't measure or cap AI spend, so the AI estimate is only a guide and the plan says so ("On Codex the studio can’t cap AI spend…"). Apify spending is capped the same way on every route.
- **While it runs**, the card turns into a live run card, and Home shows it under **Working now**. It collects, finds trends and stops: no review, no tagging and no reports. One quick scan runs at a time per workspace; **Stop** stops it.
- **When it finishes** (**Scan complete**), the card lists the trends found, with **Summarize what changed** (Ask AI explains the scan from the real posts) and **Find full trends on this topic** (Ask AI helps you start a full research run). A window with no readable posts still finishes, with a message saying so.
- **Where it shows**: Research programs' run history (marked **Quick scan**, with the topic, the window and the platforms), Activity, the Library (as "Quick scan · <topic>" once it has files), and the Trend tracker's **Quick Scans** column. Quick scans never put cards on the Trend board and never change a research trend's momentum.

## Working as a team

These pages and tools are for a marketing team that uses the studio every day: what needs a decision, who decided, which channels take a trend, when it goes out and what shipped.

### Weekly briefing

**Home**, in both layouts, is the weekly briefing: "This week in <workspace>", covering the week since Monday (on a Monday, the week just gone, so a Monday meeting has something to talk about). Its cards:

- **Needs your OK**: the top three trends waiting for a decision, each with **Yes** (and **Yes, with a note…** under its arrow) and **Skip**, and **See all**. Only people who can approve trends see it.
- **What changed**: trends that are new, rising or fading since the last research run, with **Open the Trend tracker** (see [Trend tracking over time](#trend-tracking-over-time)).
- **Ready for channels**: trends whose reports were written this week, who approved each one, which channels said they're using it, and how many haven't answered yet. **All reports** opens Reports.
- **Ready for your channels**: once you've picked **My channels**, the newest reports open to those channels, with their answers.
- **Shipped**: channels that said this week they're using a trend, with the link to what went out, and files marked **Published**.
- **Working now**: what's running, while something runs.

**Copy briefing for Slack** (top right) copies the briefing as text to paste into a channel. **Find new trends** beside it starts research after showing the estimate (with a program picker when there are several). In Simple, the **Ask anything** box sits under the title. A week with nothing in it says "Quiet week so far."; before Apify is connected, a banner says setup isn't finished. Nothing on Home spends money: **Yes** and **Skip** only record a decision.

### Inbox

**Inbox** (every role, both layouts) lists what changed that needs you in the last 30 days, newest first (up to 60 rows): trends that need your OK, research runs that finished or stopped, channels that used or passed on a trend, edits to reports by someone else, files marked **Published**, and prompt changes by someone else (for people who can see prompts). Click a row to open what it's about: the trend's card, the report, the run, the asset folder or the prompt. **Show** filters by **All**, **Unread** or one kind of row.

The sidebar counts unread rows. **Mark all read** clears the count and is saved for you, so it holds on every device you sign in on. Until you first mark it, rows from the last 7 days count as unread. A channel owner's Inbox shows trends sent to their channel (with the note that came with them) and their drafts that finished or stopped.

### Saying yes with a note

The arrow beside **Yes** on a trend card (Simple's Trends, the Trend board and Home) opens **Yes, with a note…**: a sheet asking **Which channels should pick this up?** (a chip per channel, **All channels** by default) with a **Note for the channels** (up to 280 characters). **Say yes** approves the trend and saves both. A plain **Yes** is for every channel, as before.

- Channel owners read the note on the trend: "Suggested for Social by Riley: “Lead with the CTR data.”" Channels the trend was sent to see it as new and get a **For us** filter on Trends; the others can still find it under **All**.
- Trend cards say who decided ("Approved by Riley · Oct 14"), with the note and the channels it's for.
- **Analytics** counts a trend as offered to a channel only when it was sent to that channel or to all channels.

### Calendar and My plan

When a channel owner answers **Yes, I’m using this trend**, they can add **Planned for** with a date (optional; **Change** moves it). Those dates fill:

- **Calendar** (admins and editors): weeks across and channels down, starting this week, with arrows for earlier and later weeks and **Back to this week**. Each entry is the trend, its channel and the planned day, with **Open the post** once the link is saved. **Copy week as a table** copies the first week shown, ready to paste into a doc or a message, and each week has its own **Copy**. **Download .ics** saves every planned date as a calendar file for Google Calendar, Outlook or Apple Calendar. **Using, no date yet** lists trends a channel is using without a date. On a narrow window the weeks stack.
- **My plan** (channel owners): the same for their channel. A trend they're using without a date can get one right there: pick the day and press **Plan it**.

### Content status

Reports, drafts and channel assets move through **Draft**, **In review**, **Approved**, **Scheduled** and **Published**. The status chip, under a report's title in the reader, beside each file in Assets and on Library rows, is a menu for people whose role can edit reports; everyone else sees it read-only (drafts show no chip). Choosing **Published** asks **Where is it live?** (the link is optional) and keeps the link with the file. For a channel asset made from a trend, publishing also marks that trend as used by its channel, with the link, when your role can mark trends used; otherwise the studio says the channel's owner can mark it on Trends. Reports, Assets and the Library each have a status filter.

### Share links

**Copy link** gives a link that opens one thing after the person signs in: a report (in Simple's reader, or the Library in Advanced), a trend (its card on Trends or the Trend board; for a channel owner, its brief), an asset folder, or a prompt. It's in the report reader, the Library's preview, a channel owner's brief and Prompts. In the browser studio, links use the studio's own address. On the Mac, **Copy link** appears only once **Settings → Studio web address** holds the browser studio's address, so teammates open the link there. Access still applies: a link to something the person's role can't open, or that isn't in this workspace, opens the nearest page with a note saying so. A link opened while signed out is kept through sign-in.

### Sending a report to Google Docs, slides or Slack

**Share** in the report reader has:

- **Save to Google Docs**, when Google Drive publishing is set up (Settings → Google Sheets), for reports from a run; once saved, **Open in Google Docs** and **Save to Google Docs again**.
- **Copy for Google Docs**: copies the report with its headings, lists, links and tables, so a paste into a Google Doc keeps the formatting.
- **Copy as slide outline**: the title slide, then a slide per section with up to five points, to paste into Slides or Keynote.
- **Copy a Slack summary**: five short points, with the report's link when there is one.

None of these call AI or cost anything.

### Brand check

While you edit a report, **Check against brand** beside the text lists things worth a second look ("2 things to check"): phrases from the workspace's **Claims to avoid** (Brand knowledge) and numbers or percentages with no source nearby, and in the Semrush workspace also phrases the Semrush style avoids, headings in Title Case (Semrush headings use sentence case), British spellings (the Semrush voice writes American English) and exclamation marks. Pick a finding to select that spot in the text. The checks run on your computer, cost nothing and never block **Save** ("These are suggestions. Save works either way."). **Ask AI to review the voice** sends the saved text, your brand voice and your editorial rules to Ask AI, which quotes each line worth changing and suggests a rewrite; save your edits first so it reads the latest text.

### How this was made

Every report in the reader and the Library ends with **How this was made** (open it to see): how many posts it was built from, by platform, and the date window; the research program (or the quick scan); the model that wrote it (on Codex, a note that AI spend isn't reported there); and any custom prompts it used, with their versions and who edited them, each linked to Prompts. A report written with the studio's own prompts says **Studio default prompts**. It reads the run's records, so it costs nothing.

### Costs you see

Costs show where they help a decision: in the estimate before anything paid starts, on each run, on research programs (**Last run: $X**), and in Analytics' **Spent this month** tile for admins (the AI and Apify spend recorded on this workspace's runs since the 1st of the month). On Codex the studio can't measure AI spend, so those places say "AI spend isn’t reported on Codex". People whose role doesn't include **See costs and budgets** never receive money figures: estimates, caps and recorded costs are left out of what the studio sends them. Any role that can start paid work has **See costs and budgets** too.

## Prompts

**Prompts** (in the sidebar's **Studio** group, in both layouts) shows every instruction the studio sends to AI for research, reports, channel assets, pictures, Ask AI and the data tools, and lets you change the parts that are safe to change. Admins have it, and so do editors by default; an admin can turn **See AI prompts** or **Edit AI prompts** off for a role or one person. Channel owners don't have it.

**The list** (left) groups the prompts: **Research** (Find candidate trends, Merge candidates into trends, Match trends you already track, Tag every post to a trend), **Reports** (Trends report, Editorial toolkit), **Channel assets** (the rules for every channel asset, then one per kind of file), **Pictures**, **Assistant** (Ask AI, Ask your datasets), **Data tools**, and **Behind every call** (view only). **Search prompts** narrows it. Badges: **Customized** with the version, who saved it and when; **Default updated** when the studio's own text for a part you customized has changed since; **Locked**; **View only**.

**The open prompt** shows its name, what it's used for, and "Runs on <model> · <effort>" (or "Codex: not metered"), with **Ask AI about this prompt** and **Copy link**. It has three tabs:

- **Edit**: the prompt in the order it's sent. Grey parts are fixed (the structure, the data sections and the answer format the studio's checks rely on), each with its reason. "Data from the run goes here." marks where posts or other data go in. Editable parts are text boxes with value chips (click one to insert its {{value}} at the cursor; some are required), live checks in the same words the studio uses when it saves, and **Reset this block**. Parts the studio picks from per run, one per report type or kind of file, are grouped under **Used case by case**. **Rules the studio enforces** lists what every answer must pass whatever the prompt says; an edit that contradicts one makes the step fail. When a part has **Default updated**, **See the new default** shows it and **Use the new default** takes it. With changes, a bar at the bottom offers **Discard** and **Save as version N…**, which shows what changed and asks for a **Note for the history** before it saves.
- **Preview**: the whole prompt as it's sent, on the latest run's data or the bundled sample, with the editable parts highlighted, and its characters, tokens and the estimated cost of one call. **With my unsaved changes** previews your draft. Preview is free. **Test run…** runs that one step for real. It first shows the model, effort, route, estimate and cap (a text test is capped at three times its estimate, between $0.50 and $5; a picture test draws one picture, about $0.06, capped at $0.25), then runs with the same checks a run uses and shows the answer, whether it passed, and what it cost. **Stop** stops a text test. A test keeps only a test record (**Recent test runs**); it never saves a version and changes no run or report. If the prompt or the sample changed after the estimate, it asks you to check the cost again. On Codex the test isn't metered.
- **History**: every version with who saved it, when, whether it came from Prompts or Ask AI, and its note. Compare a version with the one before or with the studio's default, and **Restore** an older one (restoring saves it as a new version). Admins also get **Lock this prompt** here.

**What's protected.** Every save is checked: required {{values}} and required words must stay, no part may be empty or too long (40,000 characters for all the editable parts together), and keys or other secrets are refused. A note is required. If two people edit the same prompt, the second save stops and says who saved first; reload and try again. A **Locked** prompt is read-only for everyone but admins ("Locked by an admin"); a role that can see prompts but not change them gets the same read-only view, and **Test run…** is only for people who can edit.

**Runs keep their prompts.** Each research run, report, channel asset run and Create content run records the prompt versions it started with, so changing a prompt never changes work already going. **Try again**, **Finish the rest** and **Retry unfinished outputs** on a run whose prompts changed since it started ask **Use the newest prompts?**: yes uses the newest versions for the steps not finished yet, and finished steps keep theirs. Each workspace has its own prompt versions. With no changes, every prompt is exactly the studio's default text.

## The browser studio

Scraper Studio also runs as a website: the same pages and features as the Mac app, served from a company server. LIVE CONTEXT says which one the person is using ("edition").

- **Signing in:** with the company sign-in when the site sits behind it. Otherwise each person opens the personal sign-in link an admin sent them; it signs them in on that browser for 30 days. If a link stops working ("This sign-in link doesn’t work anymore"), ask the studio admin for a new one. Admins can also use the **Admin password** under **Admins** on the sign-in page. **Sign out** is in the account menu at the bottom of the sidebar.
- **Who can do what:** each person has a role, and possibly their own access changes, set by an admin in **People & access** (see Roles and access). Someone signed in but not added yet sees "You’re not in this studio yet", with **Check again** once an admin adds them.
- **One shared studio:** everyone works in the same workspaces, programs, runs and Library. Only admins switch the active workspace, and everyone, channel owners included, follows it. A run someone starts is visible to everyone who can see runs, and two people can't each have their own copy of a program. Ask AI conversations and memory are the exception: each person's are their own (people who sign in with the admin password share one set).
- **Keys live on the server:** keys saved in Settings are encrypted on the studio server and used for everyone. The server reaches Claude with an Anthropic API key (or Claude Code, if it's installed there). Nobody installs anything.
- **Files:** where the Mac app shows a file dialog, the browser opens its own file picker and uploads the file. Exports, **Open file**, and **Show in Finder** download the file instead; an export folder downloads as one .zip. **Open data folder** and **Open workspace** aren't available, because folders stay on the server.
- **Runs keep going** when a browser tab closes; they run on the server. Reopen the site to follow them. The Mac app's quit warning doesn't apply.
- **Share links** use the site's address, so **Copy link** always works here (see [Share links](#share-links)).
- **Not in the browser studio:** the Mac installer, "Open Anyway" and Claude Code on your own computer.

## Roles and access

Every person in the studio has a role, and a role is a set of things they can do. On the Mac you're the only user and always an admin; roles matter there only for **View as**, and **People & access** still lets you shape roles and read the access log.

**The built-in roles:**

- **Admin**: everything, including Settings, **People & access**, **Analytics**, research programs, Brand knowledge and locking prompts. There's no second kind of admin.
- **Editor**: finds trends (research runs and quick scans), approves them, writes and edits reports, makes channel assets for any channel, uses Ask AI, Sheets and data tools, and sees and edits prompts. Editors don't see Settings, Brand knowledge, People & access or Analytics, and can't change research programs or schedules; when something needs one of those, the app names the admin to ask.
- **Channel owner**: sees only trends offered to their channel and their own channel's assets, in a small layout: **Trends**, **My assets**, **My plan** and **Inbox**. They never see costs, other channels, Settings or research.

**What a role can do** is a list of capabilities, in groups: **Everyone** (**Open the studio**), **Research** (**See research and evidence**, **Start research**, **Run quick scans**, **Approve trends**), **Reports and channel assets** (**Read reports and assets**, **Write reports**, **Edit reports**, **Make channel assets**, **Stop and retry work**, **Mark trends used**), **AI and prompts** (**Use Ask AI**, **See AI prompts**, **Edit AI prompts**), **Data and exports** (**Use Sheets**, **Use data tools**, **Delete scrapers**, **Export and publish**), **Studio setup** (**See costs and budgets**, **Manage research programs**, **Edit brand knowledge**, **Switch workspaces**, **See team analytics**) and **Admin only** (**Settings and connections**, **People and access**). The rules:

- **Settings and connections** (which includes locking prompts) and **People and access** are admin only. They can never be given to another role or person.
- Some capabilities need others: turning one on turns on what it needs, and turning one off turns off what depends on it, with a note saying so. Anything that spends money brings **See costs and budgets** with it.
- A role built on the channel owner can only ever have what's safe for one channel.
- The studio checks every request against the person's capabilities; hiding a button is only the visible part.
- With no changes, Admin, Editor and Channel owner work exactly as described above.

**Custom roles.** Admins can add up to 12 roles of their own, each built on Editor or Channel owner, starting from a template: **Viewer** (reads reports, trends and evidence; sees no costs and changes nothing), **Analyst** (quick scans, Ask AI, prompts to read, Sheets and data tools, with costs) or **Channel reviewer** (reads their channel's trends and assets and says which trends they used). A custom role on the channel owner base gets the channel owner's layout and one channel per person.

**Per-person access.** On top of their role, each person can have their own changes: for each capability, **Role default**, **On** or **Off**. **Off** always wins. Admin-only rows can't be turned on for anyone, and rows that need something the person lacks say what. People with their own changes show a **Custom access** chip (for example "Custom access +1 −2"); click it to change their access.

**People & access (admins)** has three tabs, and remembers the one you had open:

- **People**: a strip showing each channel's owner (or **Assign** when a channel has none), then everyone with access, with **Search people** and **Role**, **Status**, **Channel** and **Sort** filters (cards instead of a table on a narrow window). Click a person, or use their row menu, to open their sheet: **Details** (name, email, role and channel), **Access** (Role default · On · Off per capability; things that cost money say so), **Sign-in** (their link, in the browser studio) and **Activity** (their entries in the access log). The row menu also has **Make a new sign-in link** (it ends the old link and signs out anyone using it), **Turn off link**, **Preview as <name>**, **Disable** (pauses their access; their answers and history stay) and **Remove**. Nobody can change their own access or remove the last admin, and admins listed in the server settings show **Set by the server**.
- **Invite people**: paste one or more work emails (up to 50), choose a role (and the channel for a channel role) and, if you like, **Adjust access** for them. In the browser studio with sign-in links you get each person's link to send (**Copy link**, **Copy all links**, **Copy invite message**); behind a company sign-in, they sign in with their company account. Addresses already in the studio or listed twice are skipped and listed.
- **Roles**: a table of what each role can do, a switch per role and capability, grouped as above. Admin is locked ("Everything. Can’t be changed."), and so are the admin-only rows. Changes collect in a bar ("3 changes · affects 5 people") with **Review and save**, which lists every change before one save; **Reset to defaults** puts a built-in role back. **New role** starts a custom role from a template; a custom role's menu has **Rename**, **Preview as this role** and **Delete** (people on it move to another role first). If someone else saved roles after you opened them, saving stops and asks you to reload. On a narrow window it shows one role at a time.
- **Access log**: every change to people, roles and access as a sentence, newest first, with who did it and when. Filter by **Person**, **Role** and **What**; **Load older** goes back further and **Download CSV** saves the rows loaded so far.

On the Mac, People & access has no invitations or sign-in links (people sign in to the browser studio); the People tab offers previews instead, and Roles and the Access log work as above.

**Preview what someone sees (admins).** **View as** in the account menu, or **Preview as…** in People & access, shows the studio as any role (a channel role for one channel) or as one person with their own changes. A preview is read-only: a banner says "Previewing what … sees. Buttons that change things are off." (for one person, for example "Previewing what Riley Jones (Editor, 2 changes) sees."), the buttons that person has are shown turned off (hover one to see why), and **Back to Admin** ends it. A preview lasts until you switch back, sign out or restart.

**What a channel owner does.**
- **Trends** lists each trend offered to their channel whose brief is written, newest first, with a count of new ones next to **Trends**. A trend sent to some channels only is offered to those; one approved with a plain **Yes** goes to every channel. Filters: **New**, **For us** (sent to this channel, when there are any), **Using**, **Not for us** and **All**. Trends from before they joined sit under **Earlier**. A trend sent with a note shows it: "Suggested for Social by Riley: “…”". Each card says who approved it.
- **Read the brief** opens the trend's report (with **Copy link** when share links are on). **Generate for my channel** makes this channel's drafts from it (the card shows progress; **Stop** stops it, and **Finish the rest** retries files that didn't finish). **Open my assets** jumps to the drafts, whichever set made them; **Generate a new set** makes another set after asking. A set made with other channels that didn't finish this channel's files says to ask an editor, and the card keeps showing an earlier set of yours that did finish. When only an admin can fix what stopped a set (a key, a sign-in, the account's credit), the card says "Ask an admin: the AI connection needs attention." instead of offering **Finish the rest**.
- **Yes, I’m using this trend** or **Not for us** answers for the channel; **Add the link when it’s live** saves where it was used, and **Planned for** adds the day it goes out (it shows in **My plan** and the team's **Calendar**). Owners of the same channel share one answer per trend, shown as "Answered by …".
- **My assets** groups the channel's drafts by trend: text opens in a reader with **Copy text**, pictures open full size, each file shows its status, and each set has **Save folder** (Mac) or **Download folder** (browser). A set made with other channels says **Made with other channels**; ask an editor to stop or finish it.
- **My plan** and **Inbox**: see [Calendar and My plan](#calendar-and-my-plan) and [Inbox](#inbox).

**Analytics (admins).** Which trends were found, approved, written up and used, by channel, over 7, 30, 90 or 365 days. Admins also see **Spent this month** (AI and Apify spend recorded this month, with a note when Codex was used, since Codex reports no AI cost). The **Channels** table shows each channel's answers and has **Copy reminder** for trends still waiting on that channel. A trend counts as offered to a channel only when it was sent to that channel or to all channels, and only if it was ready after the channel's owner joined. The **Trends × channels** table shows every answer; click a cell for details, and **Change answer** corrects one. **Show skipped and waiting** adds trends that were skipped or still need an OK, **Recent activity** lists the latest changes, and **Download CSV** exports the table. Decisions made before roles existed show **Not recorded**. With no trends in the range, it suggests a longer range or **Find new trends**.

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
8. **Follow the run.** Watch progress in Research programs (or on Home), say **Yes** to the trends you want on the Trend board (or Simple's Trends), click **Write reports**, then read the reports in Simple's Reports or the Advanced Library, and the posts in Sheets.

## Home in the Advanced layout

The Advanced layout's **Home** (the first page under **Research**; in the General workspace, the content studio's **Overview** tab) is the same weekly briefing as Simple's Home, titled "This week in <workspace>": **Needs your OK**, **What changed**, **Ready for channels**, **Ready for your channels**, **Shipped** and **Working now**, with **Copy briefing for Slack** and **Find new trends** (see [Weekly briefing](#weekly-briefing)). Its links open the matching Advanced pages: a trend opens the Trend board, a report opens in the Library, a run opens Research programs or Create content. Every other studio page starts with its own page title.

## Research programs

A research program is a saved listening brief: sources, date rules, budgets and AI settings. Each start creates a separate run with its own evidence snapshot.

**New program** (or **New → Research program** in the sidebar) opens a blank editor (with no programs yet, it opens straight away under the **Got a setup file from your team?** banner). **Saved programs** lists your programs; for people who see costs, each says what its last finished run cost (**Last run: $X**, or a note that AI spend isn't reported on Codex). Selecting one shows its sources, date window, schedule, **Evidence for this run**, the latest run and **Run history**. **Edit program** opens the editor.

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

**Estimated cost per run** updates as you edit: **Apify collection: up to $X** (the worst case, with the number of Actor jobs) and **AI (all stages): about $Y** (with planned posts, batches and a per-stage line), plus warnings when a budget is below the estimate or too low to start. It says **Estimating…** while the first estimate loads; after an edit, the last estimate stays on screen, dimmed, with **Updating…**, until the new one arrives. **Add sources to see an estimate.** shows only when no source is ticked with targets. See [Costs and budgets](#costs-and-budgets).

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

Click **Start research**. A confirmation shows the estimate against the caps, for example "about $4.20 AI (cap $25.00), up to $3.10 on Apify (cap $10.00)" (the AI figure is for finding trends; writing reports is confirmed when you write them, unless **Approve themes automatically** is on). Runs that reuse saved collections say nothing is spent on Apify, and on Codex it notes that the AI cap doesn't apply. Before anything is spent, the app also checks that Claude can use every model the program needs, that the AI budget is large enough to start, and that the collection budget covers every Actor's smallest cap; if not, it stops with a message ending "Nothing was started." and no run is created.

Quick scans appear in **Run history** too, marked **Quick scan** with the topic, the window and the platforms, and they don't count as the program's own search when you start research.

### Watching a run

The run panel shows the current message, a status (**Queued**, **Running**, **Awaiting review**, **Succeeded**, **Partial**, **Failed**, **Cancelled**), the start time, **Recorded cost** (Claude spend for the run and its reports) and **Reserved budget**. Counters show **Retained evidence items**, **Discovery batches** and **Classification batches**. **Open in Sheets** appears once posts are kept. Warnings appear as a list, errors in a red box.

Messages run from "Collecting X 2/4 · LinkedIn 1/1 · Reddit 0/3 (3 of 8 source jobs)" through "Discovering trends · Twitter batch 2" to "Review and approve themes before classifying evidence and generating reports.", then "Tagging posts · Reddit batch 3", "Writing the trends report · <theme>" and "Classification complete. Review the paired reports and any outputs needing attention."

### Reviewing themes

At **Awaiting review**, use the **Trend board** or the run panel (**Choose the themes worth taking forward.**). Each theme card has a **Select theme N** checkbox, a sources badge, score chips (tier and score, velocity, gap signal, taxonomy category and zone, **Matches tracked theme "…"**), name warnings such as "Name: too long 7w", editable **Theme name** and **Theme description**, and **Source references (N)**. Select one to six themes and click **Approve themes & build reports**. Unselected themes are passed. Edited names become the tracked names.

### Cancel, retry and outputs

- **Cancel run** works while a run is queued, running or awaiting review. Finished outputs are kept.
- Failed, partial and cancelled runs show **Total retry budget (USD)** and **Retry unfinished outputs**. The budget is the run's new total AI budget, including what it already spent, and can't be below what is reserved. To add $10 to a $25 run, enter 35.
- Retry resumes where the run stopped: finished Apify jobs, evidence, discovery and tagging batches, synthesis, matching and finished reports are kept. If a prompt the run used was changed since it started, retry asks **Use the newest prompts?** first (see [Prompts](#prompts)). Apify jobs still running when the run stopped are picked up from Apify, not paid for twice. Jobs you cancelled start again.
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
| Theme review | Run pauses (**Awaiting review**) | Trends / Trend board → Needs your OK |
| Tagging (classification) | Every eligible post gets a theme or none | Sheets theme columns and totals |
| Reports | Trends report, then toolkit, per approved theme | Reports (Simple), Library (Advanced); Trend board → Ready |
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

The Trend board (Advanced) shows one card per trend a research run found; Simple's **Trends** shows the same trends with the same stage names. Nothing is written or spent until you say yes to a trend. Quick scans never put cards here.

Columns:

- **Needs your OK**: waiting for your decision. Runs still collecting or discovering show status cards ("Collecting posts and conversations", "Finding trends · batch 3 of 9") with **View posts** once posts exist. A failed run shows its error and **Open run**; a failed run that found no trends leaves the board once a newer run of the same program finds trends, whether they're waiting for review or finished (it stays in run history).
- **Approved**: for each run, a box shows "N approved trends" and **Write reports**. Click it, read the confirmation ("Writes a trends report and an editorial toolkit for each approved trend, using up to $X of this run's AI budget…"), then **Write reports** or **Not yet**. Undecided trends in that run are skipped.
- **Being written**: "Queued for reports", "Sorting evidence · N of M", "Writing reports" or "Creating assets". "Needs attention" comes with **Open run**.
- **Ready**: **Read trends report** opens it in the Library. **Create assets** (or **Create more**) starts Create content with the report as the source.
- **Skipped**: hidden until you click **Show N skipped trends**. **Reconsider** moves a card back.

An empty column says what comes next. Cards show the priority tier (hover it to see the score), the momentum badge (**New**, **Rising**, **Steady** or **Fading**, from the Trend tracker), novelty, name, description, number of sources (posts cited during discovery), how many research runs found it ("Seen in N runs", or velocity **New** / **Seen twice** for a first or second sighting), a small chart of posts per run once it was seen more than once, taxonomy category, platforms, date and program. In Needs your OK, use **Yes** and **Skip**; the arrow beside **Yes** holds **Yes, with a note…** (see [Saying yes with a note](#saying-yes-with-a-note)), and **Why it matters** with **What people are saying** (Ask AI quotes two real posts) sits on each card. Decided cards say who decided and when, with any note and the channels it's for. In Approved, use **Undo**. You can also drag cards between Needs your OK, Approved and Skipped. Decisions are only possible while the run is awaiting review.

Newest runs come first, then higher tiers, then more evidence. **Find new trends** opens Research programs. With Monday.com connected, **Sync to <board>** sends every card to your board (see [Settings](#settings)); Monday items keep their own status names (Potential trend, Approved, In production, Ready to use, Passed).

## Trend tracking over time

The studio links the same trend across research runs, even when its name changes a little: by its theme id, then by the matches and aliases research recorded, then by similar names and keywords. Two trends from the same run are never merged. This history drives the momentum badges, the **What changed** card on Home, the **Trend tracker** workbook in Sheets, and what Ask AI knows about what's rising and fading.

**Momentum** compares a trend's share of the posts a run kept with its share in its previous run, so runs of different sizes compare fairly. It is directional, not a forecast: runs differ in sources and windows.

- **New**: first found in the latest research run.
- **Rising**: found in the latest run, with a share at least 25% higher than in its previous run (and at least a quarter of a point higher), or growing across the last three runs.
- **Fading**: its share fell below 70% of the previous run's, or the last two research runs didn't find it.
- **Steady**: everything else.

Quick scans show as their own **Quick Scans** count and never change a research trend's momentum.

**What changed** (on Home, in both layouts): since your last research run, which trends are new, rising and fading, compared with the run before it. Click a trend to open its Trends report (or Trends, when it has none yet); **Open the Trend tracker** opens the workbook. Before the second research run it explains what it will show; with no research yet it offers **Start research**.

## Sheets

Sheets shows each research run as a workbook laid out like the team's Golden Thread Google Sheet, plus the **Trend tracker** across runs, and lets you import spreadsheets to review alongside. Open it from the sidebar, **Open in Sheets** on a run, **View posts** on the Trend board, or **Open the Trend tracker** on Home's What changed card.

### Trend tracker (across runs)

The workbook menu lists it first, under **Across runs**, once any research run has found trends; its header says "All research runs · N runs". It has four tabs:

| Tab | What it holds |
| --- | --- |
| **Trend timeline** | One row per trend: Momentum, category and zone, first and last seen, runs seen, latest posts and share of posts with the change in points, posts per platform, priority tier, last decision, Quick Scans, aliases, keywords and its report links, then a posts column per run date (up to 60) |
| **Weekly snapshot** | One row per ISO week and trend: runs, posts, share, momentum and priority |
| **Category momentum** | One row per taxonomy category: momentum, how many of its trends are new, rising, steady and fading, posts this week and last, and the editorial action |
| **Run log** | One row per research run or quick scan: date, type, window, status, posts kept per platform, trends found, approved and reports |

Above the tabs, **Rising**, **New**, **Steady** and **Fading** chips count the trends, with "Since <date> · <run>"; press a chip to show only those trends on the Trend timeline, and press it again to show all. The tracker rebuilds itself when a run changes, and your edits stay on their rows through every rebuild (each row is keyed by its trend, week, category or run). It can't be removed or renamed. Empty tabs say what fills them, with **Open Research programs**.

A run that started since your last visit opens first; otherwise the workbook you last had open. An older run shows "This is the <date> run. A newer run of this program started <date>." with **Open the newer run**. Runs that are queued, running, awaiting review (**Review themes**), failed or partial (**Open run**) show a note.

### Research run tabs

| Tab | What it holds |
| --- | --- |
| **Theme Repository** | Every discovered theme: description, matching_keywords, criteria, Novelty, Status (Approved, Passed, Waiting for review), Evidence Count, Taxonomy Category |
| **Twitter**, **Reddit**, **LinkedIn** | One row per kept post, newest first: post_url, text, engagement columns, prevalence_score, Theme, Confidence, Reasoning, entities, Pain_Point_Type, Urgency_Signal. Reddit adds subreddit and title. LinkedIn adds headline and profile |
| **Theme Summary Data** | Per theme: post counts, engagement totals and prevalence per platform, **Overall Prevalence Score**, and **Weighted Prevalence Score** (top theme = 100) |
| **Post Counts Reference** | Posts per theme per platform |
| **Trend Velocity** | One row per tracked theme: **Trend Report** (the report's title), report links (once published to Drive), **Visual Report Link** (the channel assets' hero picture), first-seen date, Count (research runs that found it, linked across runs as in the Trend tracker), Velocity (from that count), **Momentum**, priority tier and score, gap signal, taxonomy details. Its note says how many runs have found trends so far, and that report links fill in when **Publish reports to Google Drive** is on for the program and Google Drive is set up |
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

Create content turns a source into drafts in three steps. **New → Content from a report** in the sidebar opens it (from Simple, as an Advanced page).

1. **Source brief** ("What is the story?"): **Paste a brief** (a **Source title** and **Source brief** of up to 250,000 characters), **Import document** (.txt, .md, .docx), **Use a report** (a finished report from this workspace), or **Google Doc** (needs a Google Docs token).

To make every channel asset from one report at once, in folders, use **Assets → Make channel assets** in Simple mode instead (see Channel asset kits).
2. **Choose deliverables**: filter by channel or **Images**, and tick formats. In the Semrush workspace the core formats show first (Trends report, Editorial toolkit, Long-form article, Social captions and thread, Enterprise sales brief, Brand campaign graphic). **Explore N more formats** shows the rest: Short news update, Newsletter pack, Search ads and keywords, Affiliate partner pack, Backlinko video script, Exploding Topics pack, Search Engine Land news and video, PR research brief, Campaign landing page, SEL social data graphics and SEL editorial heroes. Image formats need an image key, and **Image directions per selected image output** (1–3) sets how many images each one makes.
3. **Review & generate** ("Ready for a first draft?"): check the source, outputs and workspace context.

The **Campaign summary** panel shows your selections and the **Spending allowance (USD)** (default $5.00), which authorizes requests but is not a hard cap on provider charges. **Generate drafts** starts the run. Each output gets its own status, and **Recent content runs** lists earlier runs.

Drafts use the workspace's brand knowledge and approved products as they were at the start, and the **Default Claude model** from Settings. Nothing is published automatically. Retry works as it does for research runs and keeps completed outputs. Create content from a research report uses the report text plus up to 120 posts it cites.

## Library

**Your asset library** (Advanced) files this workspace's trends reports, toolkits, channel assets, drafts and pictures in folders, the same way Simple's Reports and Assets do.

- **The folder tree** (left): a folder for each research run, newest first ("Oct 14 · <program>", or "Quick scan · <topic>" once a quick scan has files). Inside it, a folder per trend that run reported, holding **Trends report** and **Editorial toolkit**, **Channel assets** (each set by date, then a folder per channel team: Blog, Newsletter, Social and the rest), **Drafts** (Create content made from the report) and **Pictures**. After the research runs: **Earlier research** (reports whose research run is gone), **Other sources** (sets made from a Google Doc, a file or pasted text), **Drafts without a trend**, **Other files**, **Pictures** (with **Made in Ask AI** inside) and, when there are any, **From the earlier content board**. Arrow keys move through the tree, → and ← open and close a folder, and Enter opens it. A line counts research runs still running or waiting for review; their folders appear once their reports are written, with **Open the Trend board**.
- **Search and filters**: **Search files, trends and runs**, an **Asset type** filter (Trends report, Editorial toolkit, Channel asset, Draft, Picture), a **Channel** filter and a **Status** filter (Draft, In review, Approved, Scheduled, Published). While any of them is on, matching files are listed flat, each with its folder path; **Clear filters** goes back to the folders.
- **The open folder** (right): a path at the top, folder cards (cover pictures, counts, a spinner while work is running, and **Used by** when a channel owner said they used the trend), the folder's files with a status chip on each (see [Content status](#content-status)), and the preview of the selected file.
- **The preview**: **Open file** opens the HTML (or PNG) in its default app (in the browser, downloads it); **Export pack** exports that file's run with a manifest to the data folder's `exports`; **Create from this** starts Create content with it as the source; **Save folder** (Mac: into Downloads; browser: a .zip) on channel asset files and sets; **Save picture** on Ask AI pictures. **Copy link** copies a share link to the file (see [Share links](#share-links)). The badge shows the file's status, the preview refreshes when someone edits the file, **How this was made** sits under a report, and **Generation receipt** shows the model and cost.

## Brand knowledge

Brand knowledge has two tabs: **Workspace knowledge** and **Research brand profiles** (profiles used by the Data tools pages).

**Workspace knowledge**:

- **Workspace identity**: **Workspace name** and **Edition**, which is fixed after creation.
- **The context behind good content**: **Audience**, **Positioning**, **Ideal customer profile**, **Brand voice**, **Editorial rules**, **Claims to avoid**, **Product context**. The Semrush workspace starts with an editable preset.
- **Approved product registry**: **Add product** with **Product name**, **Approved product URL**, **Product segment** (General, Enterprise, Self-serve / PLG), **What it does**, **Supported capabilities** and **Approved tools** (one per line), and **Approved for affiliate use** (self-serve only). **Remove product** deletes one.
- **Save brand knowledge** saves. Changes apply to new runs. Earlier runs keep the context they started with.

**Research knowledge** (below) feeds theme scoring and toolkits:

- **Taxonomy lookup**: **Use its Taxonomy Lookup tab** (from a workbook imported in Sheets), **Import spreadsheet (.xlsx, .csv)…** or **Remove**. The sheet needs **Category** and **Zone** columns. Velocity, keyword, phrase and monthly article-count columns improve scoring. Up to 200 categories.
- **Product & solution registry**: **Enterprise products** (exact names, comma-separated; everything else counts as self-serve; the Semrush workspace pre-fills its Enterprise names), **Registry document text** with **Load pasted registry**, **Import document (.docx, .md, .txt)…**, or a Google Doc link with **Read Google Doc**. Loading a registry replaces the product list.
- **Toolkit context documents**: **Document type** (ICP (ideal customer profile), Positioning, AI search positioning & glossary, Other background), **Title**, and **Paste text** with **Add pasted document**, **Import file…** or **Read Google Doc**. Up to 20 documents of 300,000 characters each.

## Data tools

The **Data tools** group in the Advanced sidebar holds the tools for collecting and analyzing datasets outside research programs.

- **Collect**
  - **Search platforms**: a quick topic or account search across Reddit, X and LinkedIn in three tabs: **Search brief**, **Sources & filters** and **Review & run**. **Results per source** defaults to 10 (maximum 50; Reddit needs at least 10). **Apify budget per source (USD)** defaults to $0.25. Click **Search selected sources**.
  - **Scrapers**: save and run your own Apify Actor or saved-task recipes.
  - **Import research**: bring in CSV, JSON or JSONL with column mapping.
- **Analyze**
  - **Datasets**: browse collections with the **Explorer**, **Signals**, **Conversations**, **Topics** and **Coverage** tabs. Export CSV or JSONL.
  - **Dataset reports** (formerly AI reports): AI reports written from one dataset, with a review and approval panel and exports. These are not the trends reports from research.
  - **Compare snapshots**: compare two collections of the same sources over time.
  - **Ask your datasets** (formerly Chat with findings): ask questions across up to eight datasets, with checked citations. Posts collected by research programs aren't datasets yet, so the page points you to Ask AI, which can search them.
- **Automate**
  - **Playbooks**: eight guided marketing briefs (Competitor positioning brief, Campaign message audit, Launch research pack, ABM account research, Voice of customer brief, Content and SERP opportunities, Advertising message research, Weekly competitor changes).
  - **Workflows**: describe a goal, preview the steps, then **Run reviewed plan**.
- **Activity**: a timeline of collections, research (quick scans included), content and AI work. It shows **Running now**, **Waiting on you**, **Needs attention** and **AI spend this week**. Select an entry for details, actions and **Technical details**.

In the General workspace, the sidebar's **Overview** is the collection overview: shortcuts to collections, playbooks, scrapers and recent activity. The Semrush sidebar leaves it out.

Collections from Search platforms, Scrapers and Import research live in Datasets and Ask your datasets. Posts collected by research programs open in Sheets instead, and Ask AI searches them.

## Settings

Sections, top to bottom:

- **Connect your tools**: badges for **Apify saved / Apify missing** and **Sheets saved / Sheets optional**.
- **Source collection** (first, in both editions; marked **Setup needed** until the Apify token is saved, and Settings in the sidebar shows an amber dot until then): **Apify API token** (**Save**, and **Clear**, which is off when nothing is saved) and **Maximum rows to download** (the most rows the studio downloads from one scraper run; each scraper's own settings decide how much it collects and what it costs, and research programs set their own limits).
- **Writing & research**:
  - **How to reach Claude**: **Automatic (recommended)**, the default for new installs, uses the Claude app when it is installed, signed in and up to date, and otherwise the API key. **Claude app (Claude Code)** uses this Mac's Claude Code sign-in and plan. **Anthropic API key** calls the API directly, billed to the key's account.
  - **Anthropic API key** (**Save key**, **Clear**) is stored encrypted in this Mac's keychain and sent only to Anthropic.
  - **Default Claude model** (`claude-opus-5-5`) is used for Ask your datasets, Dataset reports, Create content and Ask AI. Research programs choose models per stage. **Claude budget per request (USD)** (default $1) caps a single Ask your datasets or Dataset report request.
  - **Check Claude** shows the route in use and a ✓ or ✕ for each model research uses: one tiny request per model (a few cents) through the Claude app, free through the API. **Save AI settings** applies changes.
  - **Advanced writing provider** holds an optional Codex CLI switch. Research programs are tuned for Claude.
- **Image generation**: **OpenAI API key**, **Save image key**, **Remove saved key** and **Check image access** (free; it generates no image).
- **Brand reference images**: what channel asset pictures should look like. One set per kind of kit picture: in the Semrush workspace **Semrush campaign graphics** (Social Team — Hero Graphic), **Search Engine Land editorial heroes** and **Search Engine Land social graphics**; in the general workspace **Campaign graphics**. Each set holds up to 6 PNG, JPEG or WebP pictures under 10 MB: **Add style example…** and **Add approved logo…** (one logo per set; n8n's SEL hero used five style examples and the 2026 SEL logo). A picture's menu switches it between **Style example** and **Approved logo**, and the bin button removes it after you confirm. The pictures are kept in the studio's data folder (in the browser studio, on the studio server). New channel asset runs send them to OpenAI; Ask AI pictures and Create content don't use them.
- **Google Docs**: **Google Docs access token** with **Connect Docs** and **Disconnect**. Tokens expire.
- **Monday.com**: **Monday.com API token** (**Connect**, **Disconnect**) and **Board ID** (**Use this board**, **Forget board**). Each trend card becomes an item whose Status column follows the card's stage, in Monday's own words: Needs your OK is **Potential trend**, Approved is **Approved**, Being written is **In production**, Ready is **Ready to use**, and Skipped is **Passed**. A Long text column holds notes.
- **Google Sheets** (the Sheets bridge): **Apps Script webhook URL**, the working spreadsheet and tabs, **Google Drive folders** for trend reports, toolkits, other Docs and Sheets exports, plus **Save sheet settings**, **Test bridge**, **Archive + clear**, **Pull working sheet** and **Replay**.
- **Studio web address** (Mac only): the browser studio's address, so **Copy link** works on the Mac and links open in the browser studio. Leave it blank and Copy link stays hidden on the Mac.
- **Share your setup**:
  - **Export this workspace**: tick **Include the shared Apify token** if you want it, then **Export setup…**. This saves one JSON file ("<workspace> setup <date>.json", in Documents by default) with the active workspace's brand knowledge, approved products, Enterprise product list, taxonomy, reference documents and all its research programs. It leaves out runs, collected posts, themes and trend history, reports, Sheets edits, other settings and every other key.
  - **Import a setup file**: **Import setup…** previews the file: workspace, programs ("updates the existing program" when you already have it), what changes, and warnings. Then **Import this setup** or **Cancel**.
  - Importing replaces the brand knowledge, products, taxonomy and reference documents of the first workspace with the same edition, adds or updates the file's programs, keeps your other programs and run history, and switches to that workspace. Imported schedules arrive paused. **Save the Apify token from this file** stores the token if the file has one.
  - A file holding the token is like a password: anyone with it can spend on that Apify account. Share it only internally. A file holds up to 50 programs and 20 reference documents.
- **Connection diagnostics**: **Check connections** checks the AI route again (Claude or Codex) and, when an OpenAI key is saved, image access; through the Claude app this sends one tiny request per model (a few cents), and the API key check is free. Cards show the Apify token, the AI route, images, and the local data folder (in the browser studio, the studio server).
- **Local files & workspace details**: **Open data folder** and **Open workspace**.

In the browser studio, keys and tokens are saved on the studio server, and the fields say so ("Saved on the studio server").

### How the app reaches Claude

- **Automatic** checks the Claude app with `claude --version`, `claude --help` and `claude auth status`. An app missing any option Scraper Studio needs counts as too old. The app looks for `claude` where Terminal finds it and in the usual install folders.
- A working route is remembered for 10 minutes. **Check Claude** always looks again.
- Before anything that spends money starts (**Start research**, continuing after theme review, **Retry unfinished outputs**, **Generate drafts**, a quick scan's **Start scan**, and the first Ask AI question of a session), the app confirms the route and every model the work needs. If a model isn't available, it stops with a message ending "Nothing was started." Through the Claude app each model check is a tiny paid request, remembered until you quit.

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

**Other AI costs**: Create content splits its **Spending allowance** across the selected outputs. Ask your datasets and Dataset reports are capped by **Claude budget per request (USD)**. Ask AI is about $0.15 a question (cap $0.75). A quick scan has its own AI and Apify caps, set on its plan card (see [Quick scans from Ask AI](#quick-scans-from-ask-ai)). A prompt **Test run…** shows its estimate and cap first (see [Prompts](#prompts)); the prompt preview and Ask AI's prompt edits are free. Images reserve at least $0.25 each for OpenAI usage.

**Every paid step shows its estimate first.** Start research, Write reports, a quick scan, Finish the rest, Try again and a prompt test run each open a confirmation with what it should cost and its cap before anything is spent. On Codex, the studio can't measure or cap AI spend, so those confirmations say the AI cap is a guide, not a limit.

**Who sees costs.** Estimates, caps and recorded costs go only to roles with **See costs and budgets** (admins, editors, and any role that can start paid work). A role without it, such as **Viewer**, never receives money figures. Where costs help a decision they're shown plainly: see [Costs you see](#costs-you-see).

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
| "The plan changed; check the cost again." | A quick scan's plan changed after its cost check (the program, its accounts or a setting) | **Check cost** again, then **Start scan** |
| A quick scan's **Start scan** stays off | Another quick scan is running in this workspace, or a cap is below what the Actors need to start | Wait for the running scan (Home shows it), or raise the **Apify cap** and **Check cost** again |
| "Stopped. Nothing more is spent on that question." (Ask AI) | You pressed **Stop** while it was answering | **Ask again** asks the same question |
| "The prompt changed; check the cost again." (Prompts) | The prompt, its sample or the model changed after the test's cost check | **Check the cost again**, then run the test |
| A prompt save stops and names who saved it first | Someone saved the same prompt after you opened it | Reload the prompt (your edits stay), compare, and save again |
| "Locked by an admin" on a prompt | An admin locked it | Ask an admin to change it or unlock it |
| "Someone changed roles after you opened them. Reload to see the latest." | Another admin saved roles while you were editing | **Reload**, then make your changes again |
| "Prompts aren’t part of your role." | Your role doesn't include **See AI prompts** | Ask an admin to turn it on for your role or for you |
| **Copy link** is missing on the Mac | No **Studio web address** is saved | Add the browser studio's address in **Settings → Studio web address** |

### FAQ

**What's the difference between a quick scan and a research run?**
A research run collects a program's whole roster over days, pauses for your review, tags every post and writes a trends report and editorial toolkit for each trend you approve. A quick scan, from Ask AI, takes a few hours of posts from the accounts that fit one topic, finds the trends and stops: no review, tagging or reports, and a much smaller cost. Use **Find full trends on this topic** on a finished scan to go further.

**Why does a trend say Fading when it still has posts?**
Momentum compares its share of the posts each run kept, not raw counts: a trend with more posts in a much bigger run can still have a smaller share. It also fades when the last two research runs didn't find it. See [Trend tracking over time](#trend-tracking-over-time).

**Where did my Ask AI conversation go?**
Conversations are saved per person and per workspace. Open the conversation list (Simple: the left rail or **Conversations**; Advanced: the clock button in the drawer) and search for it. If an admin switched the workspace, switch back to see that workspace's conversations.

**How do I make Ask AI forget something?**
Press **Undo** under **Remembered** on the answer that saved it, or open **Memory** (What Ask AI remembers) and forget, edit or pin any item.

**How do I change what a prompt tells Claude?**
Open **Prompts**, pick the prompt and change an editable part on **Edit**. **Preview** shows the result for free; **Test run…** tries it for real after showing the cost. **Save as version N…** needs a short note. Every version stays in **History**, where you can compare or restore it, and runs already going keep the version they started with. You can also ask Ask AI to suggest the change and press **Apply as version N**.

**Why can't someone see costs, Settings or a page?**
Their role doesn't include it. An admin can check in **People & access**: the person's **Access** tab shows each capability as **Role default**, **On** or **Off**, and **Preview as** shows exactly what they see. Settings and People and access are for admins only.

**How do I tell a channel a trend is for them?**
Use the arrow beside **Yes** and pick **Yes, with a note…**: choose the channels and write a note. Those channel owners see it as new, under **For us**, with your note.

**How do I share a report with a teammate?**
**Copy link** in the reader gives a link that opens it after they sign in (on the Mac, set **Settings → Studio web address** first). To put it somewhere else, use **Share**: Google Docs, a slide outline or a Slack summary.

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
The trend was found by two research runs in this workspace (velocity EMERGING). Three or more is ACCELERATING, shown as "Seen in N runs". On the Mac, runs on other testers' Macs don't count; in the browser studio everyone's runs are one shared history. Quick scans don't count.

**A report has few or no quotes.**
Quotes come only from X and LinkedIn posts tagged to that theme, and must be exact excerpts. Reddit-heavy themes get evidence links instead. The report's Limitations section notes shortfalls, such as "Only 3 verified direct quotes (target 6–9)."

**A theme got no report.**
No posts were tagged to it. See the warning "No posts were tagged to…". Check its matching criteria, or approve a broader theme next time.

**The toolkit says "⚠️ TOOLKIT CHECK".**
It named tools that aren't listed under the chosen toolkit in your registry. Review before using, and update the registry in Brand knowledge if needed. "No product registry loaded" means both angles describe the gap.

**Can I export to Google Sheets or Google Docs?**
Only with the Sheets bridge (Settings → Google Sheets), which isn't set up for testers yet. Use **Export → Download workbook (.xlsx)** and open it in Google Sheets (File → Import). For reports, use **Export pack** or **Export run**, or **Copy text** in Reports or the Library.

**The app asked me before quitting.**
If a research run, content run, chat answer, scraper run or other AI work is running, quitting shows "Something is still running" with **Keep working** and **Quit anyway**. Quitting anyway stops the work and loses AI work in progress. Apify jobs already started finish on Apify's servers within their caps. Later, **Retry unfinished outputs** keeps every finished step. Closing the window instead keeps the app and schedules running.

**My scheduled run didn't happen.**
See [Schedules](#schedules): the app must be running and the Mac awake, runs are skipped while the previous run is active or awaiting review, and a failed scheduled run pauses the schedule. Imported schedules arrive paused: click **Resume schedule**.

**Import setup failed.**
"This is not a Scraper Studio setup file." means the wrong file. "…from a newer Scraper Studio. Update the app…" needs the newer app. "Program "…" already belongs to "…"" means that program lives in another workspace on your Mac. "This preview has expired." means open the file again. Nothing is imported unless the whole file passes.

**The app won't open a second copy.**
Only one copy runs at a time; opening it again brings the existing window forward. "Workspace already in use" means another copy or server is using the data folder. Quit it first.

**Where does my data live?**
In `~/Library/Application Support/apify-scraper-studio` (**Settings → Local files & workspace details → Open data folder**). `content-studio` holds workspaces, programs and runs (one folder per run with its evidence, batches and reports), `content-studio/ask` holds each person's Ask AI conversations and memory, `content-studio/prompts` holds each workspace's prompt versions, and `content-studio/exports` holds exports. `workbooks` holds Sheets imports and edits, and `data.json` holds settings and Data tools data. Keys are encrypted with the macOS keychain. Don't edit these files by hand.

**How do I report a problem?**
Ask AI first. Then send the team: what you did and expected; a screenshot of the page and any message; a screenshot of **Settings → Connection diagnostics** (expanded); the program name and run start time (the run ID, starting `research-`, is under **Activity** → select the run → **Technical details**); and the app version (bottom of the sidebar) and macOS version. Never send API keys, or a setup file that contains the Apify token.

## Glossary

- **Actor**: an Apify scraper. Each source uses one.
- **AI budget / Collection budget**: the most one run may spend on Claude / on Apify.
- **Batch**: posts sent to Claude in one call: up to 200 per platform for discovery, 40–50 for tagging.
- **Candidate**: a possible trend from one discovery batch, before merging.
- **Capability**: one thing a role can do, such as **Start research** or **See AI prompts**. A role is a set of capabilities; a person can have their own On or Off on top.
- **Classification / tagging**: assigning each post to one approved theme or none.
- **Custom role**: a role an admin made from a template, built on Editor or Channel owner.
- **Confidence**: how sure tagging is (0–1). 0.7+ accepted; 0.55–0.69 needs review; lower is no theme.
- **Channel assets**: everything a channel asset kit makes from one report, filed by channel team.
- **Deliverable / output / asset**: one generated item, such as a report, article or image. Saved items appear in Reports or Assets (Simple) and the Library (Advanced).
- **Edition**: Semrush or General. It sets a workspace's prompts, formats and branding.
- **Editorial toolkit**: the second document per theme (angles, headlines, hooks, CTAs), built from the trends report.
- **Evidence**: the posts a run kept after cleanup (**Retained evidence items**).
- **Gap signal**: how open a theme's topic is in your coverage, from NEW_TERRITORY to LOW_OPPORTUNITY.
- **Lane**: one platform's collection jobs. Lanes run in parallel.
- **Memory**: what Ask AI remembers about you and the workspace, under **What Ask AI remembers**.
- **My channels**: the channels you make content for, chosen in the account menu; Assets, the asset dialog, trend cards and Home use them.
- **Momentum**: whether a trend's share of posts is New, Rising, Steady or Fading compared with its previous research run.
- **prevalence_score**: a post's engagement score (log scale). Engagement thresholds use it.
- **Program**: a saved research brief: sources, dates, budgets and AI settings.
- **Prompt version**: one saved state of a prompt's editable parts, with who saved it, when and why. Runs record the versions they started with.
- **Quick scan**: a small run from Ask AI over the last few hours of a program's best-matching accounts; it finds trends and stops.
- **Registry**: approved products, segments, capabilities and tools that writers may name.
- **Route**: how the app reaches AI: the Claude app, an Anthropic API key, or Codex.
- **Run**: one execution of a program (research run) or of Create content (content run).
- **Setup file**: a JSON export of a workspace's knowledge and programs.
- **Share link**: a link that opens a report, trend, asset folder or prompt in the browser studio after sign-in.
- **Status**: where a report or asset stands: Draft, In review, Approved, Scheduled or Published.
- **Taxonomy**: your content categories with zones and coverage; it drives gap signals.
- **Theme**: a synthesized trend with name, description, keywords and criteria. Up to six per run.
- **Theme repository / tracked themes**: themes this workspace has seen across runs, used for matching and velocity.
- **Weekly briefing**: Home in both layouts: what needs your OK, what changed, what's ready for channels and what shipped this week.
- **Trend tracker**: the Sheets workbook that follows every trend across research runs (Trend timeline, Weekly snapshot, Category momentum, Run log).
- **Trends report**: the comprehensive evidence report per trend (the evidence-report deliverable).
- **Velocity**: how many runs detected a theme: NEW, EMERGING (Seen twice), ACCELERATING (3+).
- **Workspace**: a separate set of knowledge, programs, runs and assets.
- **Zone**: a taxonomy category's saturation (OPEN, MODERATE, SATURATED).

## Limits and what the app doesn't do yet

- **On the Mac, everything is local to that Mac.** Runs, collected posts, trends and their history, Sheets edits, the Library and Ask AI conversations stay on the Mac that made them, and velocity and momentum count only its runs. Share setups with **Share your setup**, and results by exporting. The browser studio is one shared studio for everyone who signs in (see [The browser studio](#the-browser-studio)).
- **Google delivery is pending for testers.** Create Google Sheet, Pull from a Google Sheets link, Publish to Google Drive and Save to Google Drive need the Sheets bridge, which isn't set up for testers yet. Docs shared by link import without Google; private docs need a manually pasted token that expires.
- **The Mac build isn't notarized yet**, so macOS asks you to confirm it once (System Settings → Privacy & Security → **Open Anyway**) the first time you open it. There are no automatic updates. Install new builds by hand.
- **Schedules run only while the app is open** and the Mac is awake (in the browser studio, while the server runs).
- **Ask AI acts only through buttons you click**, and paid work always asks first. It can't change settings, programs, people or keys; it can suggest one prompt edit at a time, which saves only when you press **Apply as version N**. It reads collected posts only through its post search (the top 12 matches), and its Show me tours cover the places listed under Ask AI; other Advanced pages get Open buttons.
- **Prompts change only their editable parts.** The structure, the data sections and the answer format stay fixed, and the studio's checks on every answer apply whatever a prompt says. Prompt changes aren't part of setup files yet.
- **Quick scans** stop after finding trends: they never go through review, tagging or reports, and one runs at a time per workspace.
- **Collection is a sample**, not the whole platform. Spending caps, time limits, private accounts and the per-author cap all reduce coverage. Counts and momentum describe your sample, not market prevalence.
- **Research collections don't appear in Datasets or Ask your datasets.** Use Sheets, or ask Ask AI.
- **The app doesn't track blog coverage on its own.** Priority scoring uses the taxonomy you import.
- **Images need your own OpenAI key.** Windows is not yet tested.
