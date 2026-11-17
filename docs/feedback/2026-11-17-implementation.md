# Golden Thread: workspace and channel update

Owner brief: implement the seven requirements approved in this chat in both the Mac and web versions.

## Settled decisions

- Adobe is a separate General-edition workspace; Adobe Firefly is a research program inside it. Existing Semrush data stays intact.
- Retain research-program visibility assignments. Channel owners receive a read-only, safe program summary, without costs, model configuration or other channels' data.
- A Super Admin is a global authority; Admin remains a workspace role. Desktop owner and server owner bootstrap the Super Admin authority. Existing invited admins are migrated into their existing workspace, not automatically into future workspaces.
- Workspace selection belongs to the browser session. Switching must not move other users or background runs to another workspace.
- Channel boards use the existing per-workspace/per-channel trend adoption records: Ready to review, Using, Not for us. Workspace trend approval stays separate.
- Asset creation reuses the existing estimate/confirmation flow. No paid research or generation runs as part of this update.
- Channel image examples require a description and must be isolated by workspace/channel, persisted, and included in image-generation guidance.
- First-use tours are tracked per person, workspace and role; previews do not mark the real person's tour complete.
- Use the established Golden Thread component styles, CSS tokens and responsive behavior. Preserve the navigation and forms outside the requested changes.

## Implementation and evidence

1. `src/main/team-store.js`, `access.js`, `roles.js`, `content-workspace.js`, `index.js`, web session handling and shared RPC policy: additive membership migration, Super Admin enforcement, independent workspace selection and scoped state/results. Expected: workspace isolation, cross-workspace denial, existing-account assignment and migration tests pass.
2. `studio-sidebar.jsx`, existing workspace/people forms and a workspace access dialog: clickable picker for accessible workspaces, Super Admin creation and existing-account assignment. Expected: role-based UI tests and actual Mac/web walkthrough.
3. `programs-page.jsx`, `nav-model.js`, `App.jsx`, safe channel projection: explain research as the pipeline origin, permit read-only program browsing and compose an admin request. Expected: no create/edit control or sensitive program settings for channel owners.
4. `channel-owner.jsx` and its CSS: channel board and generation entry point in Assets. Expected: shared adoption status, no global approval operation, working generation confirmation.
5. Channel settings and a channel-reference store: validated uploads with descriptions, scoped retrieval/deletion and image generation input. Expected: persistence, malicious input and cross-channel/workspace tests.
6. Onboarding component, `App.jsx` and preferences: role/workspace-specific walkthrough and replay. Expected: new workspace/role receives its own tour; other users' completion and previews are independent.
7. App guide/handoff and focused regression suites, full lint/tests/web build, desktop build, offline Mac/web checks and cold review. Expected: every requirement traced to evidence; install the rebuilt Mac app with a data backup and verify the installed app. Hosted deployment is reported separately if a deployment target is not available.

## Main failure cases

- A cached broadcast leaks another workspace: exercise two simultaneous sessions and switching.
- Legacy accounts gain access to a new workspace: verify migration and explicit membership enforcement.
- A channel owner sees money/models or another channel: inspect actual projections and malicious RPCs.
- Images are accepted but never used: assert the saved description and bytes reach the image adapter.
- Reinstall resets data or hides retained workspaces: snapshot existing data, use the existing bundle/data identifiers and verify after relaunch.

## Verification record

- All requirements above are implemented in the shared Mac/web application. Hosted production remains a separate publishing step; it has not been updated by this local installation.
- Final full suite: `npm test` passed 244 files / 2,818 tests. Lint: zero errors, 70 existing hook warnings. Prompt goldens: 114 cases, zero differences. Production dependency audit: no high/critical findings; five moderate advisories remain.
- Main/native and browser builds passed. The Developer ID signed arm64 Mac package passed deep/strict signature verification and was installed as version 0.4.0. This local package was not notarized.
- Actual disposable-profile renderer checks passed on both transports: six Mac checks with nine captures, and 18 browser checks with 14 captures, no renderer errors. Coverage includes concurrent workspace sessions/SSE, shared channel decisions, membership roles, all four tour types, restricted sign-in controls, image references, generation confirmation and narrow layouts. No provider requests or messages were sent.
- Cold review findings were reproduced and repaired, including async-context isolation, legacy scraper-version ownership and the routing-readiness recursion. Final independent review passed 30 focused tests across three files.
- The installed app was backed up with its original profile before replacement. Native window capture was inspected without activating the app. Adobe and its Adobe Firefly research program were created in the installed profile; the program is manual with scheduling disabled.
- After a clean restart, Adobe remained separate with zero datasets/runs. Semrush retained its existing program, four datasets, six research runs, 16 content runs and all three previously saved API connections. No jobs were started. Detailed local receipts and the original app/profile remain alongside the private backup.
- Adobe intentionally starts with its own connection settings. Existing Semrush credentials were retained in Semrush rather than copied into the new workspace.
