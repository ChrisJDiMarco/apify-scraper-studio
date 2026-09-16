# Apify Scraper Studio Production Readiness PRD

## Problem

Apify Scraper Studio is a working Electron/Vite/React prototype for running Apify recipes, normalizing datasets, launching Codex analysis, and turning outputs into campaign assets. It currently builds and passes unit tests, but it is not production-ready: dependency audit is dirty, Electron security is soft, IPC validation is thin, long-running jobs have limited controls, renderer failure states are fragile, accessibility is uneven, and the visual system is layered rather than designed.

## Success Criteria

- `npm test`, `npm run build`, and `npm audit --audit-level=moderate` pass.
- Electron uses current supported dependencies and safer browser-window defaults.
- All exposed preload/IPC actions validate inputs before touching files, secrets, Apify, Codex, or shell/Finder actions.
- API token handling never silently downgrades to plaintext storage.
- Long-running Apify/Codex jobs expose status, retry/cancel where feasible, and durable failure details.
- Renderer survives preload/API failures with a visible recovery path.
- Critical workflows are covered by tests: recipe save/delete, token/settings validation, dataset export/read path safety, Codex command/output validation, asset generation state, dashboard/render smoke.
- UI has a coherent modern system: one token layer, reusable local primitives, cleaner spacing, softer radius/shadow, minimal but useful motion, and no overlapping CSS worlds.
- Accessibility basics are fixed: native controls where possible, labeled fields, associated errors, visible focus, keyboard access, status announcements, and mobile navigation.
- Packaged app still runs as a local-first Mac app without adding backend infrastructure.

## Scope

### Security and Platform

- Upgrade Electron, electron-vite, Vite, Vitest, electron-builder, and React only as needed to clear audit and keep the app building.
- Add strict IPC validators using small local helpers, not a new schema library unless the upgrade path proves cheaper.
- Remove plaintext secret fallback. If macOS safeStorage is unavailable, block token saves with a clear error.
- Keep context isolation and nodeIntegration disabled; enable renderer sandbox if compatible with the preload bridge.
- Add navigation/window-open guards so the renderer cannot navigate to arbitrary external pages.
- Sanitize user-facing error formatting and avoid exposing unnecessary internal paths except in explicit local-file views.

### Reliability

- Add a job lifecycle model for running, succeeded, failed, cancelled where practical.
- Add Codex process cancellation and better timeout cleanup.
- Guard concurrent duplicate jobs where they can corrupt state.
- Keep JSON writes atomic; add tests for bad JSON recovery and path containment.
- Improve refresh/read-dataset race handling in the renderer.

### UI and Accessibility

- Consolidate CSS into a cleaner base plus product/workflow layer.
- Add local primitives: `Button`, `Panel`, `CardButton`, `Field`, `Toolbar`, `StatusBanner`, and `ConfirmBar/Dialog` if a native inline pattern is enough.
- Replace role-based clickable cards with native buttons where layout allows.
- Add mobile navigation instead of hiding the sidebar with no replacement.
- Improve visual styling toward modern minimal material/neumorphic hints: softer surfaces, floating panels, better typography, restrained accent use, consistent radii, and cleaner density.
- Keep motion under 200ms, compositor-only, with `prefers-reduced-motion`.

### Tests and Verification

- Expand Vitest coverage for shared validation, job state, renderer helpers, and IPC-adjacent pure functions.
- Add React component smoke tests if dependencies remain light enough.
- Add a minimal Electron/package smoke path if feasible without brittle GUI automation.
- Verify build, audit, tests, and package config.

## Out of Scope

- Cloud backend, accounts, multi-user auth, sync, billing, analytics, or hosted deployment.
- New design system dependency unless local primitives become more work than the dependency.
- Full drag-and-drop Kanban if button-based movement remains sufficient.
- Rewriting the app in TypeScript. Add types only where they directly reduce production risk.

## Constraints

- Keep the app local-first and Mac-packaged.
- Prefer deletion/consolidation over adding new architecture.
- Do not add dependencies for small helpers.
- Preserve existing data files and Application Support layout.
- Do not touch unrelated projects or workspace files.

## Build Plan

1. Upgrade dependencies and clear audit.
2. Add validation/security helpers, harden BrowserWindow/preload/IPC, and test those helpers.
3. Harden job lifecycle, Codex process cleanup/cancel, and state persistence.
4. Add renderer resilience: API guard, status banners, race-safe dataset reads, better errors.
5. Refactor UI primitives and consolidate CSS into a coherent modern visual system.
6. Fix accessibility and mobile navigation.
7. Expand tests around production-critical flows.
8. Run `npm test`, `npm run build`, `npm audit --audit-level=moderate`, and packaging smoke where practical.

## Sign-Off

Build work starts only after explicit approval.
