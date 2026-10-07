# Sheets

Sheets shows research the way the team already reviews it in Google Sheets. Every research run opens as a workbook with the same tabs, column headers and column order as the Golden Thread sheet. You can also bring an existing Google Sheet into the app and review it next to the app's own runs.

Open it from **Sheets** in the sidebar, from **Open in Sheets** on a research run, or with ⌘K → "Open Sheets".

## What each tab holds

| Tab | Where the data comes from |
| --- | --- |
| Theme Repository | Every theme discovery proposed: name, description, `matching_keywords`, matching and negative criteria, and novelty. Three columns are added: review status (approved, passed, or waiting), evidence count, and taxonomy category. |
| Twitter · Reddit · LinkedIn | One row per collected post, newest first, in the n8n column layout (`post_url`, `post_text`, engagement counts, `prevalence_score`, Theme, Confidence, Reasoning, entities, pain point, urgency). Reddit titles and subreddits, and LinkedIn headlines and profile links, come from the raw Apify rows. |
| Theme Summary Data | Per-theme post counts and engagement totals for each platform. A platform's prevalence score is the sum of its posts' `prevalence_score`. **Overall** adds the three platforms together. **Weighted** scales the top theme to 100. |
| Post Counts Reference | Posts per theme for each platform. |
| Trend Velocity | One row per theme per run. Count is the number of matched posts. Velocity is only filled when two runs cover comparable, back-to-back periods. Report links appear once the reports are published to Google Drive. Priority, gap and editorial columns are left blank for reviewers to fill in. |
| Taxonomy Lookup | The app doesn't track Semrush blog coverage yet. To review this tab, import your Golden Thread workbook. |
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

- **From a file:** in Google Sheets choose File → Download → Microsoft Excel (.xlsx), then **Import → Spreadsheet file**. Every visible tab comes in with the values the sheet showed. Dates and percentages keep their formats, and frozen columns stay frozen. CSV and TSV files come in as one tab each.
- **From a link:** **Import → Pull from a Google Sheets link** reads the tabs through the Sheets bridge configured in Settings. Redeploy the bridge from [`scripts/google-sheets-webhook.gs`](../scripts/google-sheets-webhook.gs) to pull every tab in its own order; older deployments pull the Golden Thread tab names.
- **Updating:** **Replace with a newer file…** or **Pull the latest** refreshes an imported workbook and keeps your edits. Rows are matched by `post_url` (or another unique ID or Theme column) when the sheet has one.

Imported workbooks belong to the workspace you imported them into and are stored under `workbooks/` in the app's data folder. Removing one doesn't touch the original file.

## Limits

- Formulas aren't recalculated. Imports show the last value the spreadsheet calculated.
- Each sheet can have up to 60,000 rows and 256 columns. Each file can be up to 50 MB.
- There's no direct write-back to Google Sheets yet. Use Copy for Google Sheets or Download (.csv).
