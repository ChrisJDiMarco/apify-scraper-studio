# Research workflow upgrades — September 27, 2026

Implemented the research recommendations that fit the current local desktop product.

## Delivered

- Eight searchable marketing playbooks: competitor positioning, campaign message audit, launch research, account research, voice of customer, content opportunities, advertising messages, and weekly competitor changes.
- Reusable brand profiles with offering, audience, positioning, competitors, ICP, voice, and claims to avoid. Collection and analysis records retain the applied context.
- CSV/JSON/JSONL imports with preview, field mapping, exact duplicate removal, source metadata, and an authorization acknowledgement. Nested search results preserve supplied ranks, queries, and locale; missing rank stays unknown.
- Dated snapshot comparison, changed/new/unchanged/unavailable source states, comparison datasets for change briefs, and local daily/weekly manual check-ins.
- Coverage and source review tied to the actual report sample. Missing snapshots block approval; changes to report content or evidence invalidate previous checks.
- Local reviewer notes, evidence-linked actions with owners/status/dates, and Overview follow-ups.
- Printable HTML and Markdown review packages with evidence CSV, review JSON, and model/cost/context receipts. Draft exports remain clearly marked.

## Verification

- `npm test`: **361 tests passed in 26 files**.
- Production build: passed.
- `npm audit --omit=dev`: **0 vulnerabilities**.
- `git diff --check`: passed.
- New native research smoke: **11 recorded workflow/layout checks passed**, through the actual Electron preload and research IPC, with **0 external-service calls and 0 network calls**. This covers playbook discovery, brand save/reuse, import acknowledgement and duplicates, comparison-derived briefs, source coverage, blocked premature approval, successful local approval, and both export formats. Compact screens fit a 760×700 window.
- Existing native dataset/export regression smoke: passed with disposable fixture data.
- Existing real-workspace UI regression: passed; saved social collections, chat sources, and the Claude report still display. This did not repeat any paid requests.
- Visually inspected normal/compact workflows, repaired source-drawer contrast, and rendered the exported HTML including its evidence register.

See the [native fixture receipt, screenshots, and sample export bundles](research-fixture-2026-09-27/README.md), the [saved-workspace UI receipt](service-smoke-2026-09-27T19-54-01-879Z.json), and the [earlier live integration verification](2026-09-27-live-integration.md).

## Scope

This update adds local research and review workflows. It does not add authenticated team approval, shared tenancy/permissions, hosted scheduling, automatic distribution, direct internal-data connectors, or ad-image/video analysis. Check-ins are manual reminders and do not start paid runs. Fixture reports are explicitly labeled and are not real market findings. Prior live verification covers the four guided social Actors and the exact Claude model on one configured account; the additional public-page playbooks and imported-data presets have offline workflow coverage, not a new live run for each template.
