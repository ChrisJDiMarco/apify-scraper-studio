# Golden Thread demo: capability and incorporation assessment

Reviewed 27 September 2026. This is a source review, not a browser or provider test. The supplied attachment is a 13,328-line React component (`GoldenThreadHarmony`, beginning at line 861), with imported API, storage, upload, export and Markdown helpers whose implementations are absent. It was read as untrusted text and was not executed. References to **Demo L…** below identify lines in the supplied `Pasted text.txt` attachment ending in `989cc8cd-c993-448d-8b75-4fe38089cbb5`.

The strongest contribution is an editorial operating model: turn a signal into a reviewed opportunity, a brief, a chosen content package, and an accountable review queue. Our app already has much of the underlying research and generation machinery, and even an older copy of the eight-column board and twenty-format catalog. We should integrate the useful interactions into the current workspace-scoped Content studio, not import the component or create a third set of records.

## Capability inventory

| Surface | What the supplied source actually implements | What should carry over |
| --- | --- | --- |
| Dashboard | Pipeline counts, backlog suggestions, a heuristic health score, recent activity and launch actions; some figures come from static demo arrays. | A small action queue: themes awaiting decisions, failed jobs, drafts awaiting review. Each number should be computed from saved events. |
| Trend Pipeline | Eight columns; card detail, table view, triage view, search/channel filters, multi-select moves, drag/drop, undo, card comments, merge and snooze handlers. | One shared campaign board with explicit transitions, source lineage and per-asset state. |
| Sources & Signals | Source creation/edit/removal, source priority tiers, scan settings, URL extraction, platform research, per-source progress and manual promotion of a signal to a card. | Put actual Apify evidence beside editorial triage. Keep web research as a separately identified optional source type. |
| Topic Clusters | Topic/subtopic CRUD, colored clusters, coverage displays and detail views; seeded clusters in demo mode. | Stable theme IDs already produced by our research engine, with user-managed grouping and coverage based on retained evidence. |
| Content Calendar | Month/day views, channel events and a card scheduling modal. Scheduling writes display metadata; no publishing worker is shown. | An editorial due-date calendar, clearly separate from provider publishing schedules. |
| Asset Library and editor | Search/filter, Markdown preview, manual edits, AI revision, up to five previous versions, claim checklist, length guidance and Markdown export through a helper. | A durable revision workbench with evidence visible next to the draft and approvals tied to an exact version. |
| Context Library / onboarding | Website scraping, brand-context extraction, channel guidelines, competitive suggestions, listening-source suggestions, uploaded files, images, and an eight-step wizard. | A shorter setup that turns extracted information into reviewable suggestions for our approved knowledge and product registry. |
| Performance | Static impressions/clicks/charts plus AI analysis of published-card summaries and manually captured learnings. No analytics collection is shown. | Operational throughput first; outcome analytics only after connecting actual platform measurements. |
| Competitive Intel | Seeded competitor metrics and AI-generated positioning/gap suggestions. | Labeled competitor research with sources; no numerical share-of-voice claims without a measured denominator. |
| Automation Rules | Rule creation/toggles; a manual executor recognizes broad categories and moves matching cards. Most settings are configuration UI, not an execution engine. | Later, a few typed rules backed by the same durable job service, with preview, budget and receipts. |
| Productivity | Command palette, keyboard shortcuts, saved filtered views, bulk actions, comments, responsive layouts, undo and prompt-library editing. | Saved views and keyboard-accessible actions after the records and transitions are unified. |
| Image/video helpers | Calls to `aiApi.generateImage` and `generateVideo`; results are passed to host persistence. External implementation, capabilities and billing are unverified. | Reuse our configured image adapter; consider video only as a separate, proven capability. |

Source locations: navigation at Demo L10522; view renderers at L5295, L6902, L8360, L8556, L8693, L8938, L9042, L9212, L9432, L9563, L9687 and L9801; saved views at L2996; imports at L59–64.

## The proposed lifecycle, and the actual code

The board declares `Detected → In Review → Generating → Ready for Review → In Edit → Approved → Posted`, with `Rejected` as a retained side branch (Demo L285). Legacy aliases migrate listening/trend/review/live labels (L763). Cards mix opportunity data, aggregate signal displays, a brief, generation progress, editorial status and publication metadata in one object. Assets and asset content live in separate maps/arrays, connected largely through concatenated keys.

A configured source is scraped or researched; AI summaries become trend cards; an editor can flag, triage or reject them; the generation modal selects formats; assets are generated and added to the library; an editor can revise and save versions; a pasted live URL changes the card to Posted. This is a useful user journey, but several apparent guarantees are not implemented:

- **Transitions are unrestricted.** `handleMoveProdCard` accepts any target column (L3273), as do drag/drop and bulk actions (L4031, L4064). Approving does not require successful assets or completed verification. Moving to Generating does not by itself start work.
- **Breaking triage claims more than it does.** `handleTriageDecision` changes state and says assets are auto-generating, without calling the generation function (L3848). The scan auto-triage and rule executor likewise move cards only (L1397, L4465).
- **Partial failure becomes apparent success.** Generation is sequential despite the “in parallel” message; errors increment `completedCount`, and the final branch always announces all assets generated and moves to Ready (L4276, L4322–4390). There is no durable execution/resume receipt in this component.
- **Stage clocks and snooze are incomplete.** Regular moves do not update `stageEnteredAt`. The snooze handler writes a timestamp and badge; the triage view filters snoozed cards by the flag, without an elapsed-time check to restore them (L3273, L3980, L8360).
- **Publication is a manual assertion.** Pasteback stores an arbitrary non-empty string as a URL and announces tracking within 24 hours (L3901); no tracking integration is shown. Scheduling keeps the part of a slot before the separator, losing its time (L9396).
- **Review is a local checklist, not verification.** Claims are selected by a sentence regex and limited to six (L807). Checkboxes are transient state (L991, L12001), not evidence-linked approval records. The explanatory text says claims must be verified, but the transition handlers do not enforce that.
- **Lineage is lost between steps.** Synthesis asks for `evidenceSources` and confidence, but the card mapper does not retain those fields (L1326, L1360). Generation mainly receives title, brief and brand context (L4286, L4344). Merging sums displayed counts, boosts a score and removes the old cards from the active list; it does not deduplicate source evidence (L4154).

The integration should separate **research state**, **job state**, **editorial state** and **delivery state**. A failed generation job is not an editorial rejection, a successful generation is not approval, and an exported file is not a published post.

## Working interactions versus simulated or unverified behavior

**Present in source:** CRUD and UI state updates; persistence requests through `updateContent(TQL…)`; actual calls to imported AI/scraping/image/video APIs; AI-assisted brand setup, generation and revision; export/upload hook invocation. These are real code paths, not merely painted buttons. Their remote success and persistence durability cannot be established from the attachment alone.

**Provider routing:** Some research calls explicitly pass `model: "sonar"` (for example L4729). Many synthesis/content calls pass only a prompt (L1333, L1644), so the claimed Claude route depends on the absent API helper. Model/temperature/concurrency/image-style controls mostly do not reach those calls. `workflowConfig.research` and `.notifications` have no execution references. Do not infer working providers from labels.

**Simulated or unsupported measurements:**

- If AI omits values, production trend mapping inserts random mention counts and relevance scores; velocity labels become canned `+200%+`/`+100%+` growth claims (L1366–1369).
- Source counters change randomly every 3.2 seconds without a production-mode guard (L2598). Card sparklines use random values (L7585).
- Once production has any card, the analytics screen leaves its empty state and displays fixed 18.5K impressions, 1,213 clicks, 6.6% CTR and 48 live assets (L9432, L9475), followed by static weekly arrays.
- The AI “performance” prompt receives card titles, tags, signal counts and urgency—not measured impressions, conversions or revenue—then asks for what is performing well (L1756). That cannot substantiate content-outcome recommendations.
- “Source authority” is an engagement bucket multiplied by a hardcoded platform weight (L2986). “Product fit” is derived from tag count; the visible weighted breakdown can disagree with the displayed AI relevance score (L2492).

**Other boundaries:** The Firecrawl “interact” mode explicitly asks an AI to simulate a plan (L2097); its search mode asks a general AI call to act as search (L2136). This does not prove browser interaction or search execution. The main scan has a more substantial orchestration path with per-source progress and fallback research, but fallback research must not be presented as directly scraped social posts. The team wizard lists roles and allows continuing without issuing an invitation or enforcing roles (L6668). No multi-user authorization is established by this component.

## Comparison with the current app

| Existing app foundation | Current location | Integration implication |
| --- | --- | --- |
| The same eight columns, twenty asset formats and five generation presets already exist. | `src/shared/asset-workflow.json:2`, `:54`, `:76` | This is partly a refinement of an existing feature, not an entirely new product direction. Reuse format intent, but reconcile it with the structured catalog. |
| Legacy board builds cards from global datasets and saved cards, with an Asset Factory and separate editable library. | `src/renderer/src/pipeline-view.jsx:7`, `:33`, `:92`, `:174`, `:240` | Do not add another legacy board. The existing one needs workspace-scoped lineage and the current generation service. |
| Legacy mutations use global `data.cards` / `data.assets`; moves check only known columns. Legacy asset generation passes an 80-item dataset slice. | `src/main/index.js:827`, `:844`, `:863`, `:1207`, `:1255` | A visual refresh alone would preserve incompatible state and weaker evidence handling. Move editorial records into Content studio before promoting this board. |
| Portable studio has scoped workspaces, source/report handoff, durable jobs, partial states, retry/cancel, immutable generation inputs and paired reports. | `src/main/content-workspace.js:25`, `:33`, `:35`, `:55`, `:62`, `:72`, `:142`, `:195`, `:203` | This is the canonical execution and ownership boundary. Add editorial APIs here; both desktop and browser should use them. |
| Research validates source lists, full-cohort batching, source IDs, classification thresholds, stable themes, recurrence and comparable-period growth. | `src/shared/research-program.js:71`, `:161`, `:203`, `:234`, `:247`, `:265`, `:297`, `:339` | Use these metrics in triage; retain unknown values and coverage limitations. Do not replace them with demo scores. |
| Structured deliverables, approved knowledge/products, evidence validation, exact quotes and export rendering are already present. | `src/shared/content-studio.js:54`, `:71`, `:120`, `:150`, `:230` | Templates should choose existing deliverable IDs and approved context, rather than embedding a second prompt library. |
| Modern Content studio already has guided creation, theme approval, scoped library, report-to-content handoff and brand editing. | `src/renderer/src/content-studio-view.jsx:7`, `:89`, `:144`, `:184`, `:219`, `:281`, `:304` | Enrich these surfaces. The clearest gap is a unified editorial board and durable revision/approval workflow, not another generation form. |
| Studio can export or deliver a campaign through configured Google integration. | `src/main/content-workspace.js:209`, `:227` | A Drive delivery receipt should remain distinct from CMS/social publication and measured outcomes. |

These locations describe the inspected working tree; other development may shift line numbers. Stored output validation does not prove every generated assertion is factually correct, and workspace separation is not a substitute for team authentication and permissions.

## Recommended order

1. **Unify the campaign and editorial records first.** Add a campaign record in the portable studio with `workspaceId`, research run/theme IDs, source snapshot ID, content run IDs and asset IDs. Keep immutable references instead of copied briefs. Project current job status onto cards; add editorial status separately. Start with a readable list/board toggle and a detail drawer; use fewer visible columns by default, with rejected/deferred items in filters. Preserve existing records through an explicit migration or leave the old tool labeled legacy until migration is ready.
2. **Make triage evidence-first.** Each proposed theme should show the time window, collected/retained/tagged counts, source diversity, representative linked evidence, limitations, recurrence and growth only when comparable. Provide Accept, Defer and Reject with a reason. Allow an approved theme to open the existing content wizard with the same evidence snapshot. Merging must retain source IDs and lineage and recompute deduplicated totals.
3. **Offer outcome presets with an honest generation review.** Add editable preset selection to the existing three-step Create content flow: “Weekly market brief,” “Campaign starter,” “PR response,” “Paid campaign” and edition-specific editorial packs. Show exact deliverables, source, brand, available providers and total budget before starting. Default to a small useful package, not all twenty assets. Save preset IDs and versions in run inputs. Add missing deliverables only with explicit schemas and validation.
4. **Build the review workbench.** Bring preview, source evidence, draft editing, AI revision, version comparison and review decisions into Studio Library. Persist revisions separately from the generated original. Store reviewer/actor, timestamp, reason, reviewed version and evidence references. Editing invalidates prior approval. A missing quote/source ID is an actionable error; a heuristic claim checklist should be described as an aid, never proof. Failed outputs remain visible and retry only unfinished jobs.
5. **Shorten setup and add saved operational views.** Use three steps: brand facts, source lists/window, outputs/budget. Website-derived context should be proposed facts the owner accepts, with URLs and retrieval dates. Reuse the current knowledge and product validators. Then add “Needs my review,” “Due this week” and channel views, comments, owner/due-date metadata, keyboard-accessible moves and undo. Team identities/roles require actual authenticated users before assignees can represent access or approval authority.

Next tier: a due-date calendar backed by persisted dates/timezones, SLA badges derived from transition events, source-health history, topic coverage and workflow cycle time. These are useful without claiming audience performance. Only then add publishing adapters, verifiable publication receipts, analytics imports and narrowly typed automation rules. Keep “unknown,” “not connected” and “requires review” as legitimate states.

## What not to copy

- The 13,328-line single component, duplicate modal/settings implementations, hundreds of local state values, inline styling and host-specific `@/…` dependencies.
- Mock data in production views, random live counters, invented percentages, brand-only “trend discovery,” or source authority equated with engagement.
- Free-text rules portrayed as general automation, model controls that are not passed to providers, browser timers used as a durable queue, or success messages issued before an operation is verified.
- Arbitrary drag-to-approve/post behavior, five-version truncation as an audit trail, concatenated/substr-matched content keys, merged-card deletion, or generation without full source lineage.
- An eight-step mandatory setup, ten equal-weight navigation destinations, dense decorative dashboards or claims of team roles before authorization exists. The source also globally removes input focus outlines (L10505); do not inherit that accessibility regression.

A good first implementation slice would be one approved research theme → one workspace-scoped campaign → a small preset → durable generation → source-backed review → version-specific approval → export/Drive receipt. It is small enough to validate end to end while establishing the records every later board, calendar and automation feature needs. This assessment itself makes no product changes and does not authorize a paid run, publication or team invitation.
