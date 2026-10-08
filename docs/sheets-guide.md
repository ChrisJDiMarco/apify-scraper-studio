# Sheets

Sheets shows research the way the team already reviews it in Google Sheets. Every research run opens as a workbook with the same tabs, column headers and column order as the Golden Thread sheet. You can also bring an existing Google Sheet into the app and review it next to the app's own runs.

Open it from **Sheets** in the sidebar, from **Open in Sheets** on a research run, or with ⌘K → "Open Sheets".

## What each tab holds

| Tab | Where the data comes from |
| --- | --- |
| Theme Repository | Every theme discovery proposed: name, description, `matching_keywords`, matching and negative criteria, and novelty. Three columns are added: review status (approved, passed, or waiting), evidence count, and taxonomy category. |
| Twitter · Reddit · LinkedIn | One row per post the run kept after removing duplicates and applying its date window and limits, newest first, in the n8n column layout (`post_url`, `post_text`, engagement counts, `prevalence_score`, Theme, Confidence, Reasoning, entities, pain point, urgency). Reddit titles and subreddits, and LinkedIn headlines and profile links, come from the raw Apify rows. |
| Theme Summary Data | Per-theme post counts and engagement totals for each platform. A platform's prevalence score is the sum of its posts' `prevalence_score`. **Overall** adds the three platforms together. **Weighted** scales the top theme to 100. |
| Post Counts Reference | Posts per theme for each platform. |
| Trend Velocity | One row per theme the workspace tracks, across all of its runs, newest detections first. Each run adds or updates a row for every theme it finds. Date is when the theme was first detected. Count is the number of runs that detected it, and Velocity is NEW (1 run), EMERGING (2) or ACCELERATING (3 or more). The columns from Priority Tier to Gap Rationale come from scoring the theme in the latest run that detected it, with the n8n "Calculate Trend Velocity" formula and the workspace taxonomy. Trend Report Link and Strategy Report Link open the theme's trends report and editorial toolkit once they're published to Google Drive. Visual Report Link stays blank. |
| Taxonomy Lookup | The workspace taxonomy loaded in Brand knowledge → Research knowledge, one row per category: article count, % share, velocity, last 6 months, 6-month rate, saturation, zone, top keywords and phrases, timeline, gap analysis notes and editorial action, followed by a column of article counts for each month. New runs score theme priority against it. Until one is loaded, the tab is empty. Its **Import your Google Sheet** button brings your Golden Thread workbook into Sheets, and **Use its Taxonomy Lookup tab** in Research knowledge then loads the taxonomy from it. |
| Batch Analysis Log | One row per discovery batch: what it read, its platform breakdown, and the candidate themes it proposed. |

Theme tags and totals appear after you approve themes on the Trend board and the run continues into classification. Until then the posts are all there, and the empty tabs explain what fills them.

`prevalence_score` uses the same formulas as the n8n workflow (see [n8n-parity.md](n8n-parity.md)), so the numbers match the sheet.

## Working in a sheet

| Do this | How |
| --- | --- |
| Move around | Arrow keys, Tab, Page Up/Down, ⌘ + arrow to jump to an edge |
| Select a range | Shift + arrows, Shift-click, or drag. Click a column letter or row number to select the whole column or row. ⌘A selects everything. |
| Read a long post | Select the cell. The formula bar shows all of it, and the expand button makes the bar taller. Turn on **Wrap** to show four lines per row. |
| Copy to Google Sheets | ⌘C, then paste into Sheets. Cells keep their shape, and a whole column brings its header. **Export → Copy for Google Sheets** copies an entire tab. |
| Find | ⌘F, then Enter for the next match and Shift-Enter for the previous one |
| Sort and filter | Use the ▾ on any header: sort A→Z or Z→A, filter by values or by text, fit the column to its content, or hide it. Right-click a cell for **Show only "…"**. |
| Resize a column | Drag the edge of its letter. Double-click the edge to fit it to the content. |
| Totals | Select numbers. Sum, average, min, max and count appear beside the tabs. |
| Edit | Type, or press Enter, F2 or double-click. Enter saves the cell and Esc cancels. ⌫ clears a selection, ⌘V pastes a block of cells, and ⌘Z / ⇧⌘Z undo and redo. |
| Open a link | ⌘-click a URL, or use **Open link** in the formula bar |

Edits save automatically. Edited cells get a small orange corner. On a research run, edits stay in the workbook and never change the run itself. Widths, hidden columns, wrap and freeze are remembered on this Mac.

## Bring in a Google Sheet

- **From a file:** in Google Sheets choose File → Download → Microsoft Excel (.xlsx), then **Import → Spreadsheet file**. Every tab that has data comes in, hidden ones included, with the values the sheet showed. Dates and percentages keep their formats, and frozen columns stay frozen. CSV and TSV files come in as one tab each.
- **From a link:** **Import → Pull from a Google Sheets link** reads the tabs through the Sheets bridge configured in Settings. Redeploy the bridge from [`scripts/google-sheets-webhook.gs`](../scripts/google-sheets-webhook.gs) to pull every tab in its own order; older deployments pull the Golden Thread tab names.
- **Updating:** **Replace with a newer file…** or **Pull the latest** refreshes an imported workbook and keeps your edits. Rows are matched by `post_url` (or another unique ID or Theme column) when the sheet has one.

Imported workbooks belong to the workspace you imported them into and are stored under `workbooks/` in the app's data folder. Removing one doesn't touch the original file.

## Export

Workbooks stay in the app. **Export** turns them into files and Google Sheets when you need to share them. Every export includes your edits.

| Choose | What you get |
| --- | --- |
| **Download workbook (.xlsx)** | One Excel file with every tab, saved where you choose (Downloads by default) as `<workbook name> <YYYY-MM-DD>.xlsx`. It opens in Excel, Numbers and Google Sheets (File → Import). |
| **Download this tab (.xlsx)** | The open tab on its own, named `<workbook name> - <tab> <YYYY-MM-DD>.xlsx`. |
| **Download this tab (.csv)** | The open tab as CSV. **Download what's shown (.csv)** appears when filters or hidden columns hide part of the tab. |
| **Copy for Google Sheets** | The whole tab on the clipboard. Paste it into cell A1 of any Google Sheet. |
| **Create Google Sheet…** | A new Google Sheet in your Drive with every tab, made through the Sheets bridge. Name it and choose **Create Google Sheet**, then **Open in Google Sheets**. |

In .xlsx files and new Google Sheets, the header row is bold and frozen, and frozen columns stay frozen. Numbers stay numbers when they read back exactly, so `100` and `0.86` add up. Everything else stays text exactly as shown, including `007`, long IDs and dates. Nothing is ever written as a formula. A cell that starts with `=`, `+`, `-` or `@`, such as a post that begins with a mention, stays text. Excel holds up to 32,767 characters in a cell, so longer cells are cut in an .xlsx file and the confirmation says how many.

**Create Google Sheet** needs the Sheets bridge (Settings → Google Sheets). The spreadsheet is created in the **Google Sheets exports folder** set there, or in My Drive when that's blank. Large tabs are sent 2,000 rows at a time. Each export leaves a receipt under Settings → Google Sheets with a link to the new sheet. If an export stops part-way, choose **Replay** on its receipt. Replay finishes the same spreadsheet and never writes a row twice. The bridge creates a new spreadsheet each time. It doesn't update a sheet that already exists.

Export limits: 20 tabs, 50,000 rows and 60 columns per tab, 50,000 characters per cell, and 5,000,000 cells per .xlsx file. A Google Sheet export can have up to 2,000,000 cells. For more than that, download the .xlsx and import it into Google Sheets.

## Update the Sheets bridge

Create Google Sheet and publishing reports as Google Docs need the current [`scripts/google-sheets-webhook.gs`](../scripts/google-sheets-webhook.gs). An older bridge answers with "Your Google Sheets bridge is an older version". To update it:

1. Open the bridge's Apps Script project and replace its code with the current file.
2. Choose `authorizeBridge` in the function menu and click **Run**, then accept the permissions. The bridge now also creates files in Drive and uploads reports to the Drive API, so Google asks again.
3. Choose **Deploy → Manage deployments**, click the pencil, set **Version** to **New version** and click **Deploy**. Editing the deployment keeps the web app URL that's saved in the app. A **New deployment** gets a new URL, which you'd then paste into Settings.

The bridge uses three permissions. If your project pins `oauthScopes` in `appsscript.json`, list all of them:

- `https://www.googleapis.com/auth/spreadsheets`
- `https://www.googleapis.com/auth/drive`
- `https://www.googleapis.com/auth/script.external_request`

The bridge runs as the account that deployed it, so new Sheets and Docs belong to that account's Drive. Anyone who has the web app URL can use the bridge, so keep the URL private.

| Action | What it does |
| --- | --- |
| `ping` | Checks the connection. It also returns `bridgeVersion` (3) and the actions it supports. |
| `readTabs` | Reads named tabs, or every tab in order (`allTabs`). |
| `writeDatasetRows` | Writes collected rows to a working tab in chunks. |
| `archiveAndClear` | Copies the working spreadsheet to the archive folder, then clears its working tabs. |
| `createSpreadsheet` | `{ requestId, title, folderId?, tabs: [{ name, columns, rows, frozenColumns? }] }` creates a spreadsheet with one tab per entry and a bold, frozen header. It returns `{ ok, spreadsheetId, url }`. |
| `appendRows` | `{ requestId, spreadsheetId, tabName, rows, startRow? }` adds a chunk of rows. With `startRow`, sending a chunk twice writes the same rows. |
| `createDoc` | `{ requestId, title, folderId?, html }` turns HTML into a native Google Doc with one Drive upload (shared drives work). It returns `{ ok, documentId, url }`. |
| `createFile` | `{ requestId, name, folderId?, mimeType, base64 }` stores a PNG or SVG image. It returns `{ ok, fileId, url }`. |

The four create actions run once for each `requestId`. The bridge remembers the result of its last 400 creates and returns it when a request is repeated. Apps Script's lock makes a retry that arrives while the first attempt is still running wait for it, so retries never make a second copy. A spreadsheet that stopped part-way is rebuilt in place on the next try.

## Limits

- Formulas aren't recalculated. Imports show the last value the spreadsheet calculated.
- Each sheet can have up to 60,000 rows and 256 columns. Each file can be up to 50 MB.
- Create Google Sheet always makes a new spreadsheet. Edits made later in Google Sheets don't come back to the app unless you pull or import that sheet.
