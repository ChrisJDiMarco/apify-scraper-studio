# Research and Content Studio — locked implementation contract

Status: LOCKED September27,2026. Existing app and user data must remain intact.

## Product

One shared service and interface, with General and Semrush workspace presets. Primary paths: Research program -> collect or reuse evidence -> discover and review themes -> classify -> paired reports; Immediate trend -> import/paste source document or select saved report -> choose channel deliverables and image directions -> generate -> review/export.

## Required behavior

1. Persist workspace-scoped programs, source documents, knowledge, product registries, runs, theme history, assets, and export receipts. The General workspace never lists Semrush-generated records.
2. Use real existing Claude Opus5.5 execution with structured schemas, bounded prompts, total run budgeting, explicit model receipts, and no fabrication when evidence/product knowledge is missing.
3. Process all eligible research evidence in explicit batches. Preserve raw/normalized metrics, stable evidence IDs, whole-cohort counts, sample counts, independent run IDs and theme identity.
4. Review discovered themes before classification/report generation. Up to six supported themes; insufficient evidence is a valid result. Replace rejected classifications instead of retaining stale positives.
5. Produce both evidence report and Enterprise/PLG toolkit contracts; validate quotes, source IDs and product policies in code. General edition uses configurable analogous segments.
6. Implement the twelve written channel families and image deliverables specified by the123-node workflow. Image output must be real PNG data with provenance. An SVG image handoff must disclose embedded raster instead of claiming generated pixels are editable vectors.
7. Support source text/Markdown, uploaded document text, previous reports and a configured Google document reader where available. External credentials are saved through the host secret mechanism, never in browser state or source control.
8. Generate independent selected outputs with progress, cancel, per-output failure and retry preserving completed outputs. Recovery after restart must not falsely show success.
9. Export organized run folders with readable HTML/Markdown, image files, source metadata and a manifest. Google publishing and notification actions are separate from generation and require a configured connection and an explicit user action.
10. Provide portable application-service boundaries and a browser-capable runtime; preserve local desktop operation. Configure Windows packaging and platform-aware CLI paths, and distinguish configured packaging from native Windows verification.

## Screens and visual direction

Workspace picker and edition identity, Overview, Research programs, Create content, Library, Brand knowledge. Create content uses Source brief -> Choose deliverables -> Review and generate. Advanced technical choices are collapsed. Normal/compact layouts, keyboard labels, readable helper text, no fake analytics or progress percentages. Generated design reference will be saved as docs/assets/content-studio-design.png; it governs hierarchy/feel, existing app layout conventions remain reusable.

## Data and runtime

Application entities: Workspace, Program, ResearchRun, EvidenceSnapshot, Theme, Assignment, ContentRun, Asset, ExportReceipt. Every record has workspaceId and IDs are validated at the service boundary. Use host-injected data store, AI execution, image execution and file/export adapters. Browser and desktop call the same service methods. The desktop process remains a local runtime; always-on deployment requires a running server worker.

## Acceptance

- General/Semrush isolation on read, mutation, retry and export.
- Full batch traversal, deterministic engagement/metrics, stable themes, missing-value handling, rejected-tag replacement and quote/product validation.
- Document/report-to-content -> independently generated text/images -> persisted reviewable asset -> export receipt.
- Cancel/retry/restart preserve successful outputs and avoid duplicate jobs.
- Missing provider key and malformed AI output produce actionable errors; no fabricated fallback outputs.
- Production desktop and browser builds, functional tests, normal/compact real-renderer interaction checks, meaningful native pipeline fixture checks, and live provider smoke where credentials and authorization exist.
- No embedded workflow secrets/privatesource lists in repository, no automatic Slack messages orpublicpublication.

## Boundary of this build

A sellable foundation is not a certification of enterprise compliance. Billing, procurement, organization SSO and platform-store review remain release work unless explicitly implemented and verified. No destructive clone/clear operation is needed for immutable run history. User-owned credentials and private knowledge require configuration/import; copied n8n credential references are not working tokens.
