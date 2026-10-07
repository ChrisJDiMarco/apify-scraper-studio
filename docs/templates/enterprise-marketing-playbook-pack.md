# Enterprise marketing playbook pack

Updated September 27, 2026. These are task specifications for useful marketing research, not claims of customer demand. Read the [research and source register](../research/enterprise-marketing-2026-09-27.md) for the rationale.

**All eight playbooks are available in the app.** Public-page collection supports competitor positioning, campaign messaging, launch research, ABM account research, and the supplied-page mode of content research. Voice-of-customer, SERP, and advertising workflows use existing datasets or authorized CSV/JSON/JSONL imports. Weekly change briefs use two comparable snapshots and their derived comparison dataset.

The app provides reusable brand/ICP context, mapping previews, duplicate counts, source provenance, bounded AI context, report review with source inspection, action ownership, and HTML/Markdown export packages. Review status is local and self-reported; it is not enterprise identity or team authorization. Live scraping and analysis remain separate explicit actions.

## Shared operating contract

For public-page starters, supply public page URLs rather than asking the tool to discover a whole market. Use a bounded sample: up to 15 pages per initial collection and a requested $2 Apify run-charge limit. Analysis costs are separate. Begin with one run and inspect the receipt before repeating. Provider support and enforcement need live verification; these numbers are configuration bounds, not a price guarantee.

The source-specific bounds below guide a first pilot. Local source check-ins do not start paid jobs or send notifications; collecting another snapshot remains an explicit action.

Every desired report should close with an **evidence register**: source URL or authorized imported-record reference, retrieval time, publication date when known, supporting excerpt, and claim supported. Mark the difference between observed fact, interpretation, and missing evidence. Display sample coverage and collection failures. The review gate now exposes coverage, sample identity, missing evidence, and source records; a reviewer must inspect generated claims and acknowledge limitations before approval. It does not automatically prove that every generated claim is correct. Do not infer that an inaccessible page was deleted or that an unobserved feature does not exist.

## 1. Competitor positioning — in-app starter

**Buyer:** Director of Product Marketing or a competitive-intelligence analyst.

**Minimum input:** own company and offering; target audience; decision to inform; own homepage/product page; one to three competitors with explicit product, pricing, or customer-story URLs.

**Run bounds:** one collection, no more than 15 pages, requested $2 Apify charge limit. Allocate pages across companies rather than letting one domain consume the sample.

**Desired report structure:**

1. Decision brief: three evidence-supported takeaways.
2. Comparison table: audience, promise, differentiation, proof, pricing language and CTA, with citations per cell.
3. Our strongest and weakest evidenced positions.
4. Three proposed positioning changes, each with supporting evidence and a disconfirming question.
5. Missing information and evidence register.

**Limitations:** competitor claims are claims, not verified product performance. Public pages cannot establish win rates, hidden enterprise terms or customer preference. This is a snapshot, not change detection.

## 2. Campaign message audit — in-app starter

**Buyer:** Campaign strategist, Head of Content or integrated marketing lead.

**Minimum input:** campaign objective; target audience; current offer/message; own landing-page URLs and a small set of comparable competitor pages; a specific decision such as choosing a headline or proof point.

**Run bounds:** one collection, up to 15 explicit pages, requested $2 Apify charge limit. Keep the audience and offer comparable across the sample.

**Desired report structure:**

1. Campaign goal and audience assumptions.
2. Message/benefit/proof/CTA matrix with cited examples.
3. Confusing language, unsupported claims, and missing buyer questions.
4. Three message hypotheses with suggested proof and a draft headline/CTA pair.
5. A proposed test: changed element, audience, success measure, and evidence register.

**Limitations:** page text cannot establish conversion rates, ad performance or buyer sentiment. Treat recommended copy as drafts. Actual effectiveness needs first-party analytics and a controlled test; the app does not launch campaigns.

## 3. Launch research — in-app starter

**Buyer:** Product marketing launch owner or content strategist.

**Minimum input:** product/launch description; audience; launch decision; own product context; selected category, competitor, release-note and customer-story URLs. State geography or segment when it affects comparability.

**Run bounds:** one collection, up to 15 pages, requested $2 Apify charge limit. Prefer recent, directly relevant sources; retain undated pages as undated.

**Desired report structure:**

1. Launch decision and market context, with date boundaries.
2. Current alternatives and their evidenced promises.
3. Underserved questions and differentiation hypotheses.
4. Launch brief: audience, problem, proposition, proof needed, objection, recommended asset and CTA.
5. Open research questions, owner-ready next steps, and evidence register.

**Limitations:** a competitor's case study is not independently validated demand. This sample cannot estimate market size, willingness to pay or launch ROI. Published dates and retrieval dates have different meanings.

## 4. Weekly competitor change brief — in-app workflow

**Buyer:** PMM/CI owner supporting a sales team.

**Minimum input:** an approved competitor source registry, prior successful snapshot, company positioning, recipient and material-change criteria.

**Proposed bounds:** three competitors, 15 stable URLs, one manual check per week, $2 collection limit per check. First collection establishes a baseline; it generates no historical change claims.

**Desired report structure:**

1. Coverage: observed, unchanged, changed, and unavailable URLs.
2. At most five material changes with before/after excerpts and both dates.
3. Why each may matter to our positioning or sales conversation.
4. Proposed collateral edits requiring review.
5. No-action observations, unresolved changes, and evidence register.

**Implemented:** saved snapshots, canonical URL matching, normalized-text comparison, dated before/after excerpts centered on the first difference, a derived dataset for a change brief, and manual daily/weekly check-ins. **Limits:** this is text comparison; navigation or banner changes may still appear. A reviewer decides materiality. Retrieval failure is not removal. Distribution uses reviewed local exports.

## 5. Voice of customer to campaign brief — in-app workflow

**Buyer:** Customer insights, brand research or content lead.

**Minimum input:** a research question; audience; an authorized discussion/review source or approved interview/support export; time window and inclusion rules.

**Proposed bounds:** one source family, one 30-day window, up to 100 records; at most $2 collection spend when applicable. Record source coverage and excluded duplicates before analysis.

**Desired report structure:**

1. Sample composition and limitations.
2. Needs, objections and desired outcomes, each with frequency within the sample and representative record citations.
3. Contradictions and minority views.
4. Three campaign hypotheses and the supporting customer language.
5. Validation questions and evidence register.

**Implemented:** existing source datasets and authorized CSV/JSON/JSONL import, mapping preview, exact-record deduplication, and source-row references. **Limits:** there is no direct CRM/support-system connector in this release. Public discussion is not a representative customer survey. Do not infer demographics or publish identifiable customer material from an internal import.

## 6. Content and SERP opportunity brief — in-app workflow

**Buyer:** Content strategy or search lead.

**Minimum input:** audience; own content URLs; three explicit queries; language, country/device context; authorized search-result source.

**Proposed bounds:** first 10 organic results for each of three queries, then at most 15 selected landing pages; separate $2 limits for search collection and page collection, subject to provider support.

**Desired report structure:**

1. Query/date/location coverage.
2. Result table: query, rank, title, URL and observed page type.
3. Repeated answers, missing proof and neglected buyer questions.
4. Three differentiated content briefs with intended reader, argument, evidence needed and CTA.
5. Validation plan and evidence register.

**Implemented:** nested organic-result flattening, explicit query/rank/locale preservation, and a separate supplied-page collection route. Missing ranks remain unknown. **Limits:** search-result imports and page collections are separate evidence; the app does not fetch a SERP automatically. A gap is a hypothesis, not guaranteed traffic. No search-volume, ranking or AI-visibility claims without the appropriate measured data.

## 7. ABM account research brief — in-app workflow

**Buyer:** ABM program manager with a Marketing Operations partner.

**Minimum input:** three named account domains; ICP criteria; offer; decision to support; explicit public company/news/careers URLs, plus optional authorized account context.

**Proposed bounds:** three accounts, five pages per account, one manual collection, requested $2 collection limit. Do not expand into contact discovery by default.

**Desired report structure:**

1. Account facts with direct citations and dates.
2. Fit against explicit criteria, including unknowns.
3. Observed business developments and separately labeled implications.
4. Relevant problem hypothesis, supporting proof asset and discovery questions.
5. Disqualifying evidence and evidence register.

**Implemented:** reusable explicit ICP/brand context and grouping by collected source domains, with names for known competitors. **Limits:** public-page evidence does not reveal private buying plans or internal account truth. A hiring notice does not prove purchase intent or budget. Output prepares a conversation; it neither scores hidden intent nor sends outreach.

## 8. Advertising message research — in-app workflow

**Buyer:** Paid media creative strategist or integrated campaign lead.

**Minimum input:** authorized public ad-library source; three advertiser identities; market/time window; own offer; explicit research question.

**Proposed bounds:** up to 30 observed ads and 10 landing pages; one manual pass; requested $2 per collection stage where supported. Keep each platform's coverage separate.

**Desired report structure:**

1. Coverage, advertiser identity and observation dates.
2. Creative-angle table: promise, audience language, offer, proof, format and CTA, with ad and landing-page links.
3. Repeated patterns and contrasting approaches.
4. Three original creative hypotheses and a proposed test for each.
5. Evidence register with unavailable assets clearly identified.

**Implemented:** an ad-message playbook with authorized ad-library text imports, advertiser/account mapping and provenance. **Limits:** advertiser identity still needs review; there is no direct ad-library collector or automatic media inspection. Text scraping cannot analyze unseen video or imagery. An ad being active or long-running does not prove performance, spend or ROAS; do not manufacture those metrics.
