# Source controls verified September 27, 2026

The controls below were checked against the current public Actor input schemas and their maintainers' documentation. These were read-only checks; no Actor runs or paid requests were made. The app exposes the four existing Actors rather than claiming every platform has the same search capabilities.

## Reddit

[Input schema](https://apify.com/trudax/reddit-scraper-lite/input-schema), [maintainer guide](https://apify.com/trudax/reddit-scraper-lite), [Reddit search syntax](https://support.reddithelp.com/hc/en-us/articles/19696541895316-Available-search-features).

Subreddit names, r/name, and community URLs become explicit scope. One community with a topic uses `searchCommunityName`; multiple communities use grouped `subreddit:` filters in the `searches` query. A target-only search is supported. Start URLs are deliberately left empty because they would override search settings.

Relative windows use `time`; custom earliest post and thread-comment dates use `postDateLimit` and `commentDateLimit`. The Actor automatically uses New sorting for a custom post cutoff. No custom end date is advertised. Relative windows apply to posts, not matching comments.

Matching comments and collecting a post's thread comments are distinct controls. Matching-only search keeps `skipComments` enabled, so it does not collect unrequested thread comments. `commentDateLimit` is sent only for thread collection. Both use bounded counts. Posts and comments share `maxItems`. Media links/engagement detail, mature content and documented sorting options are available. The app preserves the previously verified minimum of 10 requested results.

## X / Twitter

[Input schema](https://apify.com/apidojo/twitter-scraper-lite/input-schema), [maintainer guide](https://apify.com/apidojo/twitter-scraper-lite), [operator reference linked by the maintainer](https://github.com/igorbrigadir/twitter-advanced-search).

Accounts and topic text are combined in `searchTerms` using grouped `from:` operators, so dates and content filters apply together. The provider's `twitterHandles` shortcut is not used because its date options do not apply there. Post URLs for threads become `conversation_id:` searches; topic and author filters also narrow those threads.

The UI's start and end dates include whole UTC calendar days. The adapter sends `since:` and the following day's exclusive `until:` value. Replies, media and native-repost controls use the provider-supported search language. Excluding native reposts leaves quoted posts eligible. Native repost availability is limited by X; enabling reposts is a request, not a guarantee. Latest + Top can produce duplicates. There is no unsupported “fetch all replies to every result” toggle.

## LinkedIn keyword search

[Input schema](https://apify.com/supreme_coder/linkedin-post/input-schema).

The existing content-search URL continues to carry safely encoded keywords. The earliest-date input maps to `scrapeUntil`, whose meaning is posts newer than the date despite the confusing provider field name. The provider does not document a custom end date.

Optional comments and liked-user details map to `numComments` and `numLikes` (provider range 0–100), with `deepScrape` enabled when needed. Document details use `fetchDocumentDetails`. Zero disables collection, and each enabled detail count must be 1–100. The UI calls out liked-user details instead of implying this Actor supplies every reaction type. The source remains a keyword search; direct profile/company collection has its own source tab.

## LinkedIn accounts

[Input schema](https://apify.com/harvestapi/linkedin-profile-posts/input-schema), [maintainer guide](https://apify.com/harvestapi/linkedin-profile-posts).

Profile and company URLs use `targetUrls`. The shared post allowance is divided evenly into `maxPosts` per account. Topic text is research context, not a keyword filter. Relative windows use `postedLimit`; a custom earliest date uses `postedLimitDate`. Choose one or the other. The earliest day is inclusive; there is no custom end date.

Comments, reactions, quote posts, reposts, comment age and the documented country contexts are available. Comments and reactions are separately billed dataset rows. Their count limits are 1–100 when enabled; zero is rejected because this Actor interprets it as unlimited. Legacy nested engagement flags are omitted, as the current schema discourages them.

## Application limits and receipts

Lists accept comma/newline text or arrays and deduplicate targets. At most 20 unique targets are allowed per source. LinkedIn account count cannot exceed its post allowance. URLs reject credentials, non-web schemes, custom ports, lookalike domains and unsupported paths.

Saved search context records the canonical options, targets, date semantics and warnings. `maxItems` is the source's base allowance, while `maxResultItems` includes the separately billed LinkedIn account comments/reactions. With 50 posts and both detail limits at 100, the maximum provider-row allowance is 10,050. The independent per-source spend cap remains in force. Reddit comments share its existing result limit; LinkedIn search details are nested within provider post rows.

Target-only searches are permitted when each selected source has explicit targets. LinkedIn keyword search still requires a topic. Unsupported fields, malformed dates, reversed date ranges, invalid enumerations and invalid option types fail before any run is started. The app does not manufacture cross-platform support for options a provider does not expose.
