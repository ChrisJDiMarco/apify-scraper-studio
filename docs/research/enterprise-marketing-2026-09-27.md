# Enterprise marketing opportunity — September 27, 2026

Build toward **a research workspace that turns market evidence into a useful marketing decision**. Lead with a finished brief, understandable inputs, and traceable sources. Scraper selection and JSON should remain available behind the guided path.

This is a product hypothesis informed by published evidence, not customer validation or established willingness to pay. The product is a local Mac application using Apify collection and Claude CLI analysis, with local datasets/reports and optional Sheets export. It is not a shared enterprise system. The public-page playbooks prepare saved recipes and report context; their specific website runs have not been live-tested in this update.

## Implementation follow-through

The same-day implementation now includes all eight playbooks, saved brand/ICP context, imports with provenance and exact-duplicate handling, SERP normalization, snapshot comparison and change-brief datasets, manual source check-ins, a coverage/review gate, evidence drawers, action ownership, and portable exports. Claude CLI is now the primary AI route. The four guided social Actors and Claude were live-tested separately; the new research workflow passed 11 native checks with disposable fixtures and no external calls ([verification](../verification/2026-09-27-research-upgrades.md)). The original prioritization below remains the rationale, not a claim that shared enterprise architecture or automated distribution is complete.

## What the research changes

Enterprise marketers are not simply asking for more output. CMI's 2026 enterprise study identifies resource constraints (42%), measurement (38%), and collaboration (33%) as leading challenges. Among users of AI content tools, 84% reported improved productivity but only 38% improved content performance. That gap favors helping a team decide what matters and approve a usable result. This is a mostly North American, mixed B2B/B2C enterprise sample; it does not represent every marketing organization. [CMI, January 2026](https://contentmarketinginstitute.com/enterprise-research/enterprise-content-marketing-research-findings)

There is spending, but little room for another vague tool. Gartner's 2026 survey of 401 leaders, mostly at companies above $1 billion revenue, reports 56% lack sufficient budget for their strategy and 70% lack mature processes to scale AI. These findings support visible limits and a repeatable workflow, not a claim that enterprises will buy this app. [Gartner, May 2026](https://www.gartner.com/en/newsroom/press-releases/2026-05-11-gartner-2026-cmo-spend-survey-finds-cmos-allocate-15-point-3-percent-of-marketing-budgets-to-ai-but-only-30-percent-are-ready-to-scale-ai-capabilities)

The academically led CMO Survey reinforces the integration problem: budget, data architecture, time/bandwidth, and talent lead reported martech barriers. It also challenges an acquisition-only roadmap: 43.7% shifted emphasis toward retention in response to economic conditions. A public-web app cannot solve those internal customer-data needs alone. [The CMO Survey, 2026](https://cmosurvey-new.fuqua.duke.edu/wp-content/uploads/2026/03/The_CMO_Survey-Highlights_and_Insights_Report-2026.pdf)

Research should help teams earn consideration before a sales conversation. In 6sense's retrospective study of substantial B2B purchases, 95% of winning vendors were on the initial shortlist. Its sample and commercial incentives limit generalization. Separately, Edelman–LinkedIn's survey supports useful thought leadership for buying-group members outside the primary user function. Neither study proves generated content improves sales. [6sense, November 2025](https://6sense.com/science-of-b2b/buyer-experience-report-2025/), [Edelman–LinkedIn, 2025](https://www.edelman.com/sites/g/files/aatuss191/files/2025-07/2025%20Edelman-LinkedIn%20B2B%20Thought%20Leadership%20Impact%20Report_FINAL.pdf)

## Ranked buyers and outcomes to validate

| Rank | Buyer / daily user | Outcome they could purchase | First measurable proof |
| --- | --- | --- | --- |
| 1 | Director of Product Marketing; CI analyst | An accurate competitor brief and proposed positioning updates | Time to reviewed brief; useful findings accepted; actual sales usage |
| 2 | Head of Content Strategy; campaign strategist | A defensible campaign or launch brief with differentiated angles | Time to approved brief; source quality; editor acceptance |
| 3 | Head of Brand/Social Insights | Customer themes and emerging issues that inform decisions | Reviewer-validated themes; actions assigned and completed |
| 4 | ABM lead, with Marketing Operations | An evidence-based account brief | Account coverage and research time, not scraped contact count |

Marketing Operations and IT become gatekeepers as distribution and internal data expand. Interview them before promising enterprise controls. These rankings are our judgment about product fit, not market-share estimates.

## Alternatives and useful design patterns

| Alternative | Observed pattern | Implication for this app |
| --- | --- | --- |
| Sprout Social | Five listening topic templates organize setup around a job | Put desired outcomes first; avoid a catalog of Actors as the home screen. [Documentation](https://support.sproutsocial.com/hc/en-us/articles/360017807291-Social-Listening-Query-Builder) |
| Clay | Templates describe concrete research/enrichment outcomes | Show required inputs, resulting artifact, and dependencies before setup. [Template library](https://www.clay.com/templates) |
| Semrush | Brand reports expose full AI responses in a contextual drawer | Let a reviewer inspect supporting evidence without losing the report. The implemented evidence drawer applies this interaction pattern to saved source records. [Documentation](https://www.semrush.com/kb/1595-brand-performance-reports) |
| Crayon / Klue | Competitive research is delivered into sellers' workflows | A useful brief needs an owner and a destination. Crayon's cadence/revenue relationships are correlations; Klue's customer stories are vendor-selected. [Crayon survey](https://www.crayon.co/state-of-competitive-intelligence-2026?no_head=1), [Huntress case study](https://klue.com/case-study/how-huntress-scaled-competitive-intelligence) |
| Existing browser + spreadsheet + AI assistant | Flexible manual baseline | Beat the team's current process on verified quality and effort before adding infrastructure. This baseline is a proposed pilot comparison. |

Do not imitate these entire platforms. The present opportunity is a small, understandable research workflow; competitive monitoring, sales enablement, social listening and customer analytics are different products with different data requirements.

## Implemented priorities and remaining product decisions

**Guided outcomes:** all eight playbooks now explain their required evidence, scope, and resulting brief. Public-page collection remains bounded to 15 supplied pages, a default $2 Apify run-charge limit, and a five-minute timeout. Saving a recipe does not start a paid run. Imported data unlocks customer feedback, search-result, and advertising-text workflows without claiming unavailable native connectors.

**Research quality and reuse:** saved brand/ICP context, duplicate handling and import provenance, comparable source snapshots, dated change evidence, explicit coverage, report review, source inspection, owned actions, and HTML/Markdown evidence packages are implemented locally. Approval checks are tied to the saved report/evidence fingerprint and reset when that evidence changes.

**Still a team-product decision:** shared identity, permissions, authenticated approval, tamper-resistant audit history, tenancy, internal-system connectors, automated distribution, and hosted scheduling need a separate architecture. Daily/weekly source check-ins in this release are manual reminders; they do not start paid collection. Local review labels and append-only review events do not provide enterprise access controls.

The counterpoint is important: competitor research can encourage imitation, and public discussion can distort customer understanding. Require a decision and the team's own context; preserve conflicting evidence. More sources and longer reports are not success measures.

## Four-week reversible pilot proposal

Use three teams: two PMM teams and one content/campaign team. Each chooses one decision and up to three competitors. No outreach or paid activity is authorized by this proposal.

- **Week 1:** document the existing manual workflow and preparation time; establish a source baseline; produce one reviewed starter brief per team.
- **Weeks 2–3:** repeat the same bounded research manually once weekly; compare freshness, corrections, and accepted actions. Keep delivery in existing team tools through reviewed exports.
- **Week 4:** measure repeated use, time saved, useful decisions and actual willingness to pay for continuation; interview both the user and budget owner.

Cap at 12 collections total, 15 pages and $2 Apify limit per collection: at most $24 in requested collection limits, with a separately agreed analysis allowance. Use no unattended schedule; stop on unexpected billing, persistent source failure, or misleading output. Pilot success targets: two of three teams voluntarily reuse it, at least 30% lower median preparation time without lower reviewed accuracy, and one budget owner agrees to a paid continuation. These thresholds are proposed tests, not forecast results. If they fail, narrow or stop; retained recipes and exported briefs remain useful.

## Source register

All sources accessed September 27, 2026. Survey results are self-reported; product documentation demonstrates advertised behavior, not effectiveness. No community anecdotes or vendor ROI claims are treated as independent validation.

| Source / date | Method and evidence class | URL |
| --- | --- | --- |
| CMI, Enterprise Content and Marketing Trends / Jan 21, 2026 | CMI/MarketingProfs survey, sponsored ON24/Canto; Jun 24–Aug 14, 2025; 296 enterprise respondents from 1,229 total, mostly North America; sponsored original research | [Source](https://contentmarketinginstitute.com/enterprise-research/enterprise-content-marketing-research-findings) |
| Gartner, CMO Spend Survey / May 11, 2026 | Jan–Mar 2026; 401 leaders, mostly $1B+ organizations; original commercial research | [Source](https://www.gartner.com/en/newsroom/press-releases/2026-05-11-gartner-2026-cmo-spend-survey-finds-cmos-allocate-15-point-3-percent-of-marketing-budgets-to-ai-but-only-30-percent-are-ready-to-scale-ai-capabilities) |
| The CMO Survey / 2026 edition | Jan 7–29, 2026; 308 US leaders, 14.6% response rate, 97% VP+; Duke/Deloitte/AMA sponsored original research; data not shared with sponsors | [PDF](https://cmosurvey-new.fuqua.duke.edu/wp-content/uploads/2026/03/The_CMO_Survey-Highlights_and_Insights_Report-2026.pdf) |
| 6sense, Buyer Experience / Nov 12, 2025 | Nearly 4,000 main responses plus 766 companion responses; purchases ≥$25K; vendor original research | [Source](https://6sense.com/science-of-b2b/buyer-experience-report-2025/) |
| Edelman–LinkedIn, Thought Leadership Impact / 2025 | 1,934 executives; Mar 17–Apr 3, 2025; LinkedIn recruitment, methodology specifies US; co-sponsored original research | [PDF](https://www.edelman.com/sites/g/files/aatuss191/files/2025-07/2025%20Edelman-LinkedIn%20B2B%20Thought%20Leadership%20Impact%20Report_FINAL.pdf) |
| Crayon, State of CI / 2026 | Annual CI/sales/revenue leader survey; sample size absent from public page; vendor original survey, correlational | [Source](https://www.crayon.co/state-of-competitive-intelligence-2026?no_head=1) |
| Klue, Huntress case study / undated | Named customer Dustin Ray, Head of Competitive and Market Intelligence; vendor-selected testimony | [Source](https://klue.com/case-study/how-huntress-scaled-competitive-intelligence) |
| Sprout, Social Listening Query Builder / undated | Official product documentation; capability/design evidence | [Source](https://support.sproutsocial.com/hc/en-us/articles/360017807291-Social-Listening-Query-Builder) |
| Clay, template library / current catalog | Official product catalog; capability/design evidence | [Source](https://www.clay.com/templates) |
| Semrush, Brand Performance Reports / undated | Official product documentation; capability/design evidence | [Source](https://www.semrush.com/kb/1595-brand-performance-reports) |
