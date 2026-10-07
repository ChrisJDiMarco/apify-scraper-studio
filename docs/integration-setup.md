# Integration setup

Scraper Studio keeps datasets and receipts on your Mac. Collection uses Apify; AI requests send selected evidence to the provider you choose. Claude Opus 5.5 is the default. Existing marketing starters remain available on Overview for public website research.

## Connect the accounts

1. Save your Apify token in **Settings**. The app uses macOS-backed Electron secure storage and refuses to save it when that storage is unavailable.
2. Install [Claude Code](https://code.claude.com/docs/en/setup), sign in with `claude auth login`, and check Claude in Settings. This connection check does not generate a report or prove model access.
3. Save `claude-opus-5-5` as the model and choose an AI budget. The default is $1 per request. A completed Claude request records its actual model; a missing or different model receipt is rejected for that exact model ID.

The implementation was verified with Claude Code 2.1.281. It uses constrained print mode, structured JSON output, no session persistence, disabled file/browser/connector tools, and evidence supplied through standard input. It does not fall back to Codex automatically. Selecting Codex in Settings uses its existing CLI configuration; the Claude model and budget fields apply to Claude.

## Guided sources

**Search platforms** prepares the following Actor inputs. You still need access through your own Apify account.

| Source | Actor | What the input means |
| --- | --- | --- |
| Reddit | [`trudax/reddit-scraper-lite`](https://apify.com/trudax/reddit-scraper-lite/input-schema) | Keyword search sorted by relevance. Requests posts, excludes comment threads, and requires at least 10 requested results. |
| X / Twitter | [`apidojo/twitter-scraper-lite`](https://apify.com/apidojo/twitter-scraper-lite/input-schema) | Keyword search sorted by latest posts. |
| LinkedIn search | [`supreme_coder/linkedin-post`](https://apify.com/supreme_coder/linkedin-post/input-schema) | Builds a LinkedIn content-search URL from the topic. Detailed comments and likes are not requested. |
| LinkedIn profiles | [`harvestapi/linkedin-profile-posts`](https://apify.com/harvestapi/linkedin-profile-posts/input-schema) | Collects recent posts from supplied profile/company URLs. **The topic is research context; it does not filter these posts.** |

The default is 10 results per source, with a maximum of 50. If Reddit is selected, limits below 10 are rejected before a run starts. For LinkedIn profiles, the allowance is divided evenly across URLs and rounded down; there may be fewer total requested posts than the selected allowance. Comment and reaction expansion is disabled.

**Refresh Apify catalog** shows your account's recent Actor catalog. Nine Actors were observed in the development account on September 27, 2026, including the four above. That observation is not a promise that every account has nine Actors, that every listed Actor is a guided integration, or that a provider will return results. Use **New scraper** for a different Actor or saved Task.

## Limits, failures, and costs

Each selected source starts an independent paid Apify run, with a default $0.25 maximum charge and a five-minute timeout. The app shows the sum of the selected source limits before collection. Provider start/search/result fees and account terms still apply; the cap is not a price estimate. Returned rows are also limited locally, and fewer or zero results are possible.

One source failing does not discard successful datasets from other sources. The results view shows a separate error for the failed source; run history retains its Apify run ID so you can inspect it in Apify. Successful datasets retain their topic, source, requested limits, and collection receipt.

AI runs have a separate budget. Claude's reported dollar amount is a CLI list-cost receipt, which can differ from subscription billing or your invoice. Apify usage reported at completion is also a service receipt, not a reconciled invoice. Check the provider's billing records for actual charges.

## Chat with findings

Choose one to eight datasets. Chat uses a bounded sample: at most 200 source records, up to 6,000 text characters per record, within an 80,000-character context budget. Records are sampled across selected datasets in stored row order. Each answer shows how many records were included and whether excerpts were shortened.

Citations must match a supplied item ID and its quoted text; unmatched references are omitted and surfaced as caveats. Source links come from collected records. This validates the reference, not the truth of a claim or an inference. A small sample cannot establish platform-wide sentiment or market prevalence.

Questions and completed answers are saved locally with source coverage and provider receipts. Retrying a failed question reuses its request ID to avoid duplicate conversations or repeated completed requests. Changing the selected evidence starts a new conversation.

## Verification

`npm test` runs offline unit and integration tests; it does not start paid Apify or AI requests. After building, `npm run test:desktop` and its `--with-data` mode use disposable fixture data.

The manual service script is deliberately separate:

```bash
npm run build
npx electron scripts/service-smoke.cjs --review
```

`--review` opens the existing saved workspace and captures its normal and compact screens. It does not collect data or generate AI responses.

```bash
npx electron scripts/service-smoke.cjs --live
```

Run `--live` only when you intend to start paid requests. It uses the saved Apify token and current Claude login, sets the saved AI selection to Claude Opus 5.5 with a $1 request budget, collects up to 10 results from each of the four guided sources at a $0.25 cap per source, then requests one findings answer and one report when usable evidence exists. It saves datasets, conversations, reports, screenshots, and a verification receipt. `--live --reddit-only` runs only the Reddit collection with a $0.25 cap and skips AI generation.

The [first live receipt](verification/service-smoke-2026-09-27T19-18-27-624Z.json) confirms two returned posts each from X, LinkedIn search, and LinkedIn profiles, then an actual `claude-opus-5-5` findings answer and report. Reddit's initial two-result request failed because the Actor requires a minimum request of 10. The [isolated retry](verification/service-smoke-2026-09-27T19-25-32-664Z.json) succeeded with seven posts and $0.0616 in provider-reported usage under its $0.25 cap. The app now enforces that minimum before starting a run. `--review` checks saved results and formatting without repeating paid requests. These checks do not verify Google Sheets or every custom Actor and marketing starter.
