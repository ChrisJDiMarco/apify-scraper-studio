# Research and Content Studio

One implementation supports a configurable general edition and a Semrush workspace. Workspaces own their research programs, knowledge, approved product registries, run history and generated assets. This local workspace boundary is not organization-level multi-tenant authentication.

## Two starting points

**Research your market** saves source lists, dates, Actor options and collection/AI caps. A run collects sources or reuses saved datasets, normalizes and deduplicates evidence, discovers themes across all eligible batches, and pauses for approval. Classification then covers every eligible item and generates an evidence report plus an editorial activation toolkit for each approved theme. Unknown metrics stay unknown; period growth requires genuinely comparable cohorts. Report excerpts can be smaller than the cohort, and the coverage receipt states what was omitted.

**Create from a trend** accepts pasted text, TXT/Markdown/DOCX files, configured Google Docs imports, or a saved report. Select outputs, inspect the total budget, and start generation. Each output has its own status. Retry retains completed assets and may require a deliberate budget increase when the cost of an interrupted request is unknown.

## Repeat a research program

Open **Research programs → Edit program → When to run**. Choose **Every day**, **Every week**, or **Every month**, then choose the local run time and time zone. Weekly schedules include a weekday; monthly schedules include a day of the month (the 31st uses the last day of shorter months).

Under **What dates to search**, choose the number of complete UTC days to include before each run. For example, a Monday 9 a.m. schedule with a seven-day lookback collects the seven complete UTC days before Monday. The rolling window also applies when you manually start a program configured to repeat. Switching back to **Only when I start it** restores its saved fixed dates.

Review **Spending limits per run**, check **Enable scheduled runs**, and save. The program shows its next run time and offers **Pause schedule** and **Resume schedule**. Existing programs stay on demand until explicitly enabled. Sources, Actor options, and budgets are reused for each run; enabling a schedule authorizes repeated provider use under those per-run budgets.

The desktop app or web server must remain running. The scheduler does not wake a sleeping computer or run after the app quits. On resume, it processes only the latest missed occurrence. It skips an occurrence while that program has an active run or is waiting for theme review. Failed or interrupted scheduled runs pause the schedule for review rather than retrying automatically. Theme approval is still required before classification and report generation. A desktop app and web server cannot both own the same studio data folder.

## Included output contracts

1. Short news update.
2. Long-form article.
3. Newsletter summaries and three email directions.
4. Search-ad headlines, descriptions and keyword clusters.
5. LinkedIn/Facebook copy and an X thread.
6. Affiliate partner pack.
7. Enterprise sales brief.
8. Beginner video script / Backlinko preset.
9. Emerging-trend pack / Exploding Topics preset.
10. Editorial news and video / Search Engine Land preset.
11. PR research brief with verified journalist records only.
12. Responsive campaign landing-page HTML.
13. Comprehensive evidence report.
14. Editorial activation toolkit, including Enterprise and self-serve angles.
15–17. Brand campaign graphics, SEL social data graphics, and three distinct SEL editorial hero directions.

Written outputs use the configured Claude CLI model with source text treated as untrusted evidence. Semrush defaults include workflow-derived audience, voice and editorial policy. Add approved current products and capabilities under Brand knowledge; the app does not invent a registry from private document links. Missing journalist records, numerical evidence or product facts remain explicit limitations.

OpenAI image generation is connected through the host process using GPT Image 2.5 Flare. In Settings → Images, save your own OpenAI API key and use Check image access for a free model-access check. That check does not prove billing or generation works. Create content can then request one to three image directions, save each completed PNG immediately, and retain it across partial failure or retry. SVG handoffs embed raster pixels and do not claim editable vector artwork. The app enforces a local minimum dispatch allowance of $0.25 per remaining image; this is not a fixed image price or a guaranteed cap on an in-flight provider charge. Actual usage estimates and unknown-cost reservations are saved with each request. An ambiguous paid request is not repeated automatically. Prompts over 32,000 characters are rejected before dispatch with a request to shorten the source or brand context; automatic image-brief condensation is not implemented.

## Files and delivery

Library opens saved drafts, shows evidence and offers export packs organized by channel. Packs contain HTML, Markdown, JSON, image files when generated, original source/context and a manifest. Treat exports as internal material when their source documents are internal. Google document import requires an authorized OAuth access token; a token embedded only as an n8n credential reference is not usable. Tokens can expire and currently need manual reconnection. An explicit **Publish to Google Drive** action creates a campaign folder, channel folders and Google Docs from the rendered reports; images are delivered as PNG plus clearly labeled raster SVG when available. Publishing checkpoints each remote write and reconciles ambiguous failures before retrying. See [Google delivery setup](google-delivery.md). No Slack messages or public publishing happen automatically.

## Web and desktop

The desktop and browser clients call the same portable service. The browser runtime is a password-protected, single-team pilot, not a multi-tenant SaaS. It has same-origin request enforcement, an HttpOnly session cookie, login throttling, scoped export downloads and static path confinement. A server process must remain running for background jobs.

Build the browser client with `npm run build:web`. Set `STUDIO_PASSWORD` to a unique secret of at least 16 characters and run `npm run start:web`. It binds to loopback by default. Configure `STUDIO_DATA_DIR` for persistent storage and `APIFY_API_TOKEN` for collection; install and authenticate Claude Code on that host. Set `OPENAI_API_KEY` on the backend to enable images. Optional `GOOGLE_DOCS_ACCESS_TOKEN` enables document import. Put TLS and restricted ingress in front before remote use, set `STUDIO_SECURE_COOKIES=1`, and keep secrets in the hosting platform's secret store. Exports use the host's `tar` executable. Each customer should receive an isolated deployment until tenant isolation and individual accounts are implemented.

macOS uses the existing Electron build and signing/notarization configuration. Windows NSIS/x64 packaging is configured with `npm run dist:win`, and CLI path discovery uses the platform path delimiter and home directory. A Windows machine/CI build is still needed to validate installation, CLI discovery, credential encryption and updates. Source compatibility is not a Windows release receipt.

Engineering estimates for one experienced developer, after credentials and release accounts are available:

| Distribution | Current state | Remaining difficulty |
| --- | --- | --- |
| Private hosted web pilot | Browser/runtime implemented and locally exercised | Medium: roughly 2–5 days for hosting, TLS, secrets, backups and real provider checks. |
| Public subscription SaaS | Shared core exists; billing, user accounts, org roles, tenant storage and worker operations remain | High: roughly 4–8+ weeks, depending on enterprise requirements. |
| macOS app | Existing Electron app plus the new studio | Low–medium: roughly 3–7 days for signed release QA, onboarding and distribution. |
| Windows app | Cross-platform service and NSIS configuration | Medium: roughly 5–10 days for native testing, signing, installer and update QA. |

These estimates are implementation judgments, not delivery promises. SSO, procurement requirements, billing, usage enforcement across tenants and platform-store reviews can extend them.

## Open the Semrush 2026 edition

Run `npm run start:semrush` from this project to build and open the native app with Semrush selected. In the app, use the workspace selector in the sidebar to switch editions. Semrush uses its March 2026 lavender, mint and near-black palette with the official current wordmark and shows Overview, Research programs, Create content, Library and Brand knowledge. Additional collection and legacy editorial tools remain under More tools. General keeps its own navigation and green theme. The selected workspace persists across normal restarts.

## Image credentials and provider choices

Installed desktop builds store keys entered in Settings using OS-backed encryption. This development checkout also reads the approved ignored `.env.local` image key on the host only; it never loads that key into a renderer or CLI child environment. Removing a saved key disables credential fallback until you connect again. Hosted editions read image credentials only from the server environment, not from browser local storage or a bundled key.

Claude remains the default text engine. Codex text access is available under Advanced writing provider. Codex/ChatGPT sign-in is not treated as a general OpenAI API key. A fal.ai integration and built-in Codex image route are researched but not connected in this app. See [provider onboarding research](research/provider-onboarding.md).

## Semrush workspace design

The overview has two clear entry points: lavender **Research your market** and dark **Create from a trend**. Its activity shortcuts show actual workspace counts, and Brand knowledge shows which guidance is saved. Working tabs have compact headings, so your source lists, dates, comments, deliverables and results stay prominent. Source collection comes first in Semrush Settings, followed by writing and images. Search, reports, playbooks and the content board share the current palette. Switching to General restores its own design.

## Switch workspaces from any page

Use the workspace dropdown beneath the logo in the sidebar to switch between Your workspace, Semrush, and other saved workspaces. It stays available on Search, Reports, Settings, and Content Studio in both editions. At narrow widths, use the Workspace dropdown above the page navigation. Switching updates the selected workspace and its branding; it does not create a second workspace.
