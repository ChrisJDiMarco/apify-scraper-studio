# Search source controls — September 27, 2026

## Delivered

Search platforms now uses three accessible steps: **Search brief**, **Sources & filters**, and **Review & run**. Selected sources each get a dedicated editor. Common controls stay visible and less common options sit in expandable sections. Small helper and review text has stronger contrast. The layout supports normal and compact desktop windows.

- **Reddit:** specific communities, a relative window or earliest post date, sort order, attached thread comments and their date/count limits, matching-comment search, media details, and mature-content inclusion.
- **X / Twitter:** handles or profile URLs, inclusive UTC start/end dates, reply and media filters, native repost choice, and conversation URLs.
- **LinkedIn search:** keywords, earliest date, bounded comments and liked-user details, and document details.
- **LinkedIn accounts:** profile/company URLs, a relative window or earliest date, bounded comments and reactions, comment age, quotes/reposts, and the supported country contexts. Topic text is labeled as research context rather than a post filter.

Targeted account/community collection can omit a topic. Drafts are stored locally and survive navigation. The review step compiles and validates the exact Actor inputs locally, identifies invalid fields, and shows canonical targets, date semantics, extra-row limits, and spending caps. It repeats validation immediately before a run.

Saved recipes and datasets retain their source settings. Separately emitted LinkedIn comments/reactions count against an explicit provider-row allowance instead of being silently truncated to the post allowance. Explicit nested LinkedIn search comments/replies become normal source items, with preserved parent relationships and honest parent-post URL labels. Analysis and findings chat receive the requested collection scope; those settings are not presented as proof of complete retrieval.

## Verification

- Final focused regressions: **84 source-adapter tests and 20 search UI tests passed**. They include matching Reddit comments independently of attached thread collection, bounded options, canonical URLs, dates, validation focus, and draft persistence.
- Final full regression run: **441 tests in 27 files passed** in 283.91 seconds using `./node_modules/.bin/vitest run --maxWorkers=1 --testTimeout=30000 --hookTimeout=30000`. Earlier parallel repeats hit five-second timeouts during heavy local CPU load. The final command used one worker and longer per-test/hook timeouts; no assertions or repository test configuration were changed.
- Main-process integration and source-evidence tests cover the no-cost preview, exact four-source mappings, rejected invalid input before writes or calls, nested comment evidence, provider-row coverage, and saved scope in AI context.
- `npm run test:desktop -- --with-data` passed with a disposable fixture workspace, including navigation, saved data, report rendering, exports, and compact layouts.
- The final production build passed after the Reddit comment semantics, validation focus, and contrast corrections.
- The final [native search receipt and screenshots](search-controls-fixture-2026-09-27/README.md) record **14 passed checks** through the actual renderer, preload, and main process, with a fixture Apify client. Preview inputs match the mocked run inputs exactly. Normal 1380×920 and compact 760×700 layouts were inspected visually.
- `git diff --check` passed.

The native search test recorded **zero network calls, zero CLI/AI calls, and zero other service calls**. No additional paid Actor or AI tests were started for this update. It did not read saved credentials or the real workspace. Earlier live-service receipts remain separate.

## Scope and limitations

The [source controls guide](../research/source-options-2026-09-27.md) links the official Actor schemas used for the mappings. Each source exposes its documented options: for example, X supports a complete custom start/end range, while the selected Reddit and LinkedIn Actors expose earliest-date controls without a custom end date. Matching Reddit comments do not share the post date filter; the comments-after date applies only to attached threads.

Local validation and fixture tests verify application wiring, bounds, rendering, and evidence preservation. They do not prove live provider coverage or that every optional filter is fulfilled by the upstream platform. Additional comments, reactions, or liked-user details may affect provider charges within the requested spend caps.
