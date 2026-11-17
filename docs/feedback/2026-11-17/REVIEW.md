# Workspace update review

Cold code review and rendered desktop/narrow review are part of the implementation. Findings were checked against actual callers and reproduced with disposable profiles before repair.

## Repaired and regression checked

- Bind both content and web async contexts before computing each viewer/broadcast; one session's old call must not change another session's view.
- Enforce workspace membership for RPCs, settings, imports, jobs, links, integration state and disk files.
- Preserve existing account identity, other memberships, Ask AI history and disabled-member recovery.
- Scope Ask AI conversations, personal memory, request reuse, progress, pictures and targeted events by workspace.
- Keep saved channel examples and descriptions in each image run's snapshot, and refuse providers that cannot accept the complete reference set before charging.
- Scope credential-dependent AI caches; readiness reads must not call routing previews recursively.
- Copy retained owned dataset payloads, related artifacts and collection checkpoints without overwriting original bytes or granting them to new workspaces.
- Write classic assets in the same namespace their reader validates; matching card/type IDs in two workspaces must not overwrite each other.
- Partition new scraper-history files and scope the projection cache.

## Visual fixes

- Image-example actions now use the shared quiet/primary buttons with dark, readable text.
- Tour replay instructions name the account menu. Workspace instructions work at both desktop and mobile widths.
- Compact mobile Programs label retains its full accessible name and minimum target size.

## Final closure

Retained scraper-version ownership migration and refreshed Mac/browser captures passed. The final suite passed 2,818 tests across 244 files; the independent reviewer passed 30 focused tests. The signed 0.4.0 Mac app was installed, its native window inspected, and Adobe/Firefly plus retained Semrush data and connections were verified after restart. Full evidence and remaining release limits are in the [implementation record](../2026-11-17-implementation.md#verification-record). No reviewer blockers remain. Hosted deployment and paid generation were not performed.
