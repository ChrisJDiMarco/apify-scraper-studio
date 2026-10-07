# Live integration verification — September 27, 2026

The app now uses the four requested Apify Actors and Claude CLI as its default AI route. The exact reported model was `claude-opus-5-5` for both the findings answer and report. No fallback model was used.

| Collection | Actor | Requested / returned | Result |
| --- | --- | --- | --- |
| Reddit | trudax/reddit-scraper-lite | 10 / 7 | Succeeded after correcting the Actor minimum |
| X | apidojo/twitter-scraper-lite | 2 / 2 | Succeeded |
| LinkedIn keyword search | supreme_coder/linkedin-post | 2 / 2 | Succeeded |
| LinkedIn profile posts | harvestapi/linkedin-profile-posts | 2 / 2 | Succeeded; Apify company profile |

Each Actor run had a $0.25 cap and a five-minute timeout. The first Reddit request for two results failed input validation with reported usage $0; the corrected request returned seven posts and reported usage $0.0616. These are run-reported usage figures, not an invoice reconciliation. The two Claude analysis calls reported $0.166916 combined list cost; subscription billing may differ.

The findings answer used six records across three datasets and returned six validated source references. The market-scan report used the two X records and correctly declined to draw broad market conclusions from the tiny sample. These were functional checks, not a market research study.

Saved test datasets were re-normalized from their original raw records after verifying the Actors’ actual output fields. No recollection was needed. Historical AI outputs retain their original context and receipts.

## Evidence

- [Initial collection, Claude chat and report receipt](service-smoke-2026-09-27T19-18-27-624Z.json)
- [Successful Reddit retry receipt](service-smoke-2026-09-27T19-25-32-664Z.json)
- [Final native UI review receipt](service-smoke-2026-09-27T19-29-48-202Z.json)
- [Search UI](2026-09-27T19-29-48-202Z-search-with-results.png)
- [Formatted findings answer](2026-09-27T19-29-48-202Z-chat.png)
- [Validated source cards](2026-09-27T19-29-48-202Z-chat-sources.png)
- [Formatted report](2026-09-27T19-29-48-202Z-report.png)
- [Compact findings UI](2026-09-27T19-29-48-202Z-chat-with-findings-compact.png)

## Local checks

- 285 automated tests passed across 19 files.
- Production build passed; dependency audit reported zero vulnerabilities.
- Native first-run and fixture-data smoke checks passed using the real preload bridge.
- Final live-workspace screenshots were visually inspected, including formatted answers, sources, reports, and compact layouts.
- The app was reopened for normal use after verification.

## Boundaries

Four Actors have guided source adapters. Nine used Actors were discovered in the connected account; appearing in that catalog does not make every Actor a guided search source. Other platforms can be configured with the custom Actor/task builder. LinkedIn profile collection requires profile/company URLs and does not apply the keyword filter.

The app stores the token using Electron safeStorage; no plaintext Apify token was found in project source or receipts. Chat is bounded to eight datasets, 200 source records, 6,000 characters per record, and an 80,000-character context budget, with coverage disclosed. Sources can be missing, irrelevant, or unrepresentative. Google Sheets, enterprise collaboration, and every marketing report preset were not live-tested here.
