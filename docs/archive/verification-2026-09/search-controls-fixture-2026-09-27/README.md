# Native search controls verification — September 27, 2026

**Passed: 14 recorded native workflow and layout checks.** The production build passed before this run. The harness used a disposable Electron user-data directory, the real renderer/preload/main process, and a fixture Apify client. It made **0 network calls, 0 CLI/AI calls, and 0 other service calls**; the four recorded Actor starts are local mocks. No saved credentials or real workspace files were read.

Run again from the project root after building:

```sh
npm run build
./node_modules/.bin/electron scripts/search-options-smoke.cjs
```

## What was verified

- Search brief → Sources & filters → Review & run, with all four social sources selected.
- Reddit subreddit names and URLs, relative time window, post/comment date cutoffs, attached thread comments, and matching-comment search.
- X handles/profile URLs, inclusive UTC start/end dates, reply exclusion, image filtering, and native repost exclusion.
- LinkedIn keyword search date, bounded comments, liked-user details, and document details; LinkedIn account URLs, earliest date, bounded comments/reactions, comment time window, and country context.
- A separate pure-preview regression confirms matching-comment search does not enable thread expansion: `searchComments: true`, `skipComments: true`, and no `commentDateLimit` when thread comments are disabled.
- Invalid X targets rejected by the offline main-process preview before any provider start. **Fix inputs** returns to the affected source.
- Canonical target names/URLs, per-source filters, engagement limits, provider warnings, and a $0.40 total fixture budget shown for review. Preview inputs exactly match the actual mocked Actor inputs.
- Draft topic, targets, dates, source selection, and limits retained after navigating away and returning.
- Normal 1380×920 and compact 760×700 windows render without horizontal overflow. The compact footer separates draft actions from run actions.
- Four fixture collections saved through the actual main-process run pipeline. LinkedIn accounts retain 12 fixture post/comment rows under a 10-post allowance with a separately bounded 110-provider-row ceiling; the allowance is not silently truncated to 10 rows.
- Explicit nested LinkedIn comments/replies become saved source items. The reply's parent relationship and parent-post URL basis are preserved, and the reply text is visible in the dataset table.

The final screenshots were visually inspected, including source editors, the canonical review summary, validation state, narrow footer, and saved comment evidence. They include the final contrast pass for helper text, review labels, and warnings. The captures and data are QA fixtures, not live source findings. This run verifies local wiring and rendering; provider availability, live search completeness, and the provider's fulfillment of optional filters were not exercised or claimed.

## Receipt and screenshots

- [Native receipt](receipt.json)
- [Search brief](screenshots/search-brief.png)
- [Reddit targets, dates, and comments](screenshots/reddit-targets-comments.png)
- [More Reddit options](screenshots/reddit-advanced-options.png)
- [X accounts and dates](screenshots/x-accounts-dates.png)
- [LinkedIn keyword search details](screenshots/linkedin-search-engagement.png)
- [LinkedIn account options](screenshots/linkedin-profile-options.png)
- [Offline validation](screenshots/invalid-target-preview.png)
- [Review summary](screenshots/search-review.png)
- [Compact source editor](screenshots/linkedin-targets-compact.png)
- [Compact review](screenshots/search-review-compact.png)
- [Compact limits and footer](screenshots/search-budget-compact.png)
- [Fixture collection results](screenshots/search-fixture-results.png)
- [Saved comment and reply evidence](screenshots/saved-comment-evidence.png)
