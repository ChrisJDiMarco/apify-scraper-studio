# Documentation index

Start with [HANDOFF.md](../HANDOFF.md) at the repo root. This index lists everything under `docs/` and who it is for.
Three paths are referenced by code and must not move: `docs/app-guide.md` (copied into every build; Ask AI's runtime
knowledge), `docs/web-deploy.md` (named by the launcher and the Dockerfile) and `docs/roles-and-access.md` (named in
code comments).

| Document | Audience | What it covers |
| --- | --- | --- |
| [app-guide.md](app-guide.md) | End users, Ask AI | Every page, control, cost and error message, in the app's own words. Ask AI sends it with every question, so keep it accurate and short. |
| [web-deploy.md](web-deploy.md) | Operators | The browser studio: configuration table, secrets per platform, company sign-in and proxy trust, health checks, drain, the data-folder lock, timeouts, limits, logs, backups. |
| [roles-and-access.md](roles-and-access.md) | Developers | The capability model, the gate, identity and sign-in, `team.json`, the People API, analytics definitions, error copy, the test map. |
| [macos-app.md](macos-app.md) | Release engineers | Building, signing, notarizing and installing the Mac app. |
| [sheets-guide.md](sheets-guide.md) | Users, operators | The Sheets view, exports, imports, and deploying and updating the Apps Script Sheets bridge (including what an exposed bridge URL can reach). |
| [google-delivery.md](google-delivery.md) | Operators, developers | Publishing reports and assets to Google Drive: the bridge and token routes, checkpoints, reconciliation. |
| [n8n-parity.md](n8n-parity.md) | Developers | Node-by-node mapping from the Golden Thread n8n workflow to the studio, with the known gaps. |
| [research/semrush-2026-brand.md](research/semrush-2026-brand.md) | Designers | The Semrush 2026 brand sources the Semrush edition follows. |
| [research/source-options-2026-09-27.md](research/source-options-2026-09-27.md) | Developers | The Apify Actor options researched in September (the four in use are in the app guide's cost tables). |
| [verification/roles-acceptance.md](verification/roles-acceptance.md) | QA | The manual per-role acceptance checklist; run it when roles, sign-in or navigation change. |
| [verification/content-studio-live-source.md](verification/content-studio-live-source.md) | Developers | The input brief for the paid `scripts/content-studio-live.cjs` check. |
| [design-review/REVIEW.md](design-review/REVIEW.md), [SPEC.md](design-review/SPEC.md), [SPEC-2.md](design-review/SPEC-2.md) | Developers | Historical design records of the October 2026 redesign (status headers say what changed since), with before and after screenshots in `design-review/screens/`. |
| [archive/](archive/README.md) | Anyone curious | Superseded September documents, receipts and screenshots, each with a one-line note. |

Root documents: [README.md](../README.md), [HANDOFF.md](../HANDOFF.md), [ARCHITECTURE.md](../ARCHITECTURE.md),
[RUNBOOK.md](../RUNBOOK.md), [SECURITY.md](../SECURITY.md), [CONTRIBUTING.md](../CONTRIBUTING.md),
[CHANGELOG.md](../CHANGELOG.md), and the deploy kit's [deploy/README.md](../deploy/README.md).
