# n8n workflow ↔ Studio parity notes

Reference: the "Golden Thread" n8n workflow (Google Sheet "Internal NEW - Golden Thread Data Sheet", tabs Twitter / LinkedIn / Reddit). Shared by Chris in sections on 2026-10-06.

## Phase 1 — Social scrape

### What n8n does
- **Form:** Start Date (required) and Posts per platform (default 3000). Per-author cap 10. If no date is given, the window falls back to 7 days.
- **Launch:** all three Apify runs start back to back, then each lane polls every 30s. A run that ends FAILED, TIMED-OUT or ABORTED still fetches whatever its dataset holds. A failed launch stops the whole execution.
- **X:** `apidojo/twitter-scraper-lite`, one `from:<handle> since:<YYYY-MM-DD>` term per handle, sorted Latest, `maxItems` 10000 (a cost ceiling only; a tight cap starves the handles at the end of the list). Replies are included. Timeout 20 min (client abort at 25).
- **LinkedIn:** `harvestapi/linkedin-profile-posts`, `maxPosts` 15 per profile, `postedLimitDate` = start, no comments or reactions. URLs are stripped of `?…` and given a trailing slash. Timeout 90 min (abort at 95).
- **Reddit:** `trudax/reddit-scraper-lite`, 18 subreddits via `/r/<sub>/new/`, `maxPostCount` **300 per sub**, `maxItems` = ceil(1.5 × target), `scrollTimeout` **90** (40 cut big subs short), `navigationTimeout` 60, comments off, residential proxy, NSFW off. Timeout 120 min (abort at 125).
- **Normalize → Dedupe + Cap (same for every lane):** drop rows without a URL. Dedupe by URL, then by a fingerprint of the **first 100 chars of text (whitespace stripped) + author**. Keep the start-date window, sort newest first, keep at most 10 per author, stop at target.
- **Sheet:** append to the cleared tab, then write a `prevalence_score` formula into each new row (batches of 500, 3 retries, then the batch is skipped).
- **Prevalence formulas** (LOG10, ROUND 2):
  - X: 10·likes + 15·retweets + 20·replies + 25·quotes + 15·bookmarks + 2·views
  - LinkedIn: 10·reactions + 25·comments
  - Reddit: 15·upvotes + 25·comments + (ratio < 0.6 ? 0 : 5·ratio)
- **Columns also reserved for later phases:** Theme, Confidence_Score, Reasoning, Entities_Tools / People / Companies, Pain_Point_Type, Urgency_Signal.

### Studio comparison
| Item | Studio | Status |
|---|---|---|
| Prevalence formulas | `engagementScore` in `src/shared/research-program.js` | ✅ Exact match |
| 3000/platform, 10/author, newest first, window filter | `research-program.js` evidence builder | ✅ Match |
| X per-handle `from:` terms, `since:`, Latest, replies included | `research-collection.js` + `source-catalog.js` | ✅ Match |
| LinkedIn 15 posts/profile | `ceil(perAuthorCap × 1.5)` = 15 | ✅ Match (Studio splits into jobs of ≤20 profiles) |
| Reddit `/new/` start URLs, comments off, residential proxy | `research-collection.js` | ✅ Match |
| Tagging fields (pain point, urgency, entities, reason) | `ASSIGNMENTS_SCHEMA` | ✅ Same enums/fields |
| X `maxItems` | Studio: 1.5 × target = 4500 | ⚠️ Lower than n8n's 10000; risks starving later handles |
| Reddit per-sub cap | Studio sets `maxPostCount` = whole allocation | ⚠️ n8n caps 300 per sub so big subs can't crowd out small ones |
| Reddit `scrollTimeout` | Not set (actor default) | ⚠️ n8n uses 90 |
| Reddit / LinkedIn run timeout | 60 min | ⚠️ n8n uses 120 / 90 (LinkedIn jobs are smaller in Studio, so Reddit matters most) |
| Near-duplicate fingerprint | Full normalized text + author | ⚠️ n8n uses first 100 chars + author (catches reposts with different endings) |
| Reddit text | Studio merges title + body into one text | ✅ Fine for AI (n8n keeps them separate) |
