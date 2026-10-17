# Recurring research programs

Implemented daily, weekly, and monthly recurrence in the existing Research program editor for General and Semrush, using the same service in desktop and browser hosts. Existing programs stay manual/disabled. Scheduling is separate from the rolling completed-UTC-day search window and per-run collection/AI caps.

Validation:

- Full regression suite: 46 files, 724 tests passed.
- Desktop production build and browser production build passed.
- Native Electron fixture: 27 checks passed, including frequency changes, explicit enable, next run, pause/resume, fixed-date preservation, source options, and complete discovery/review/report flow. No network or AI CLI calls.
- Browser fixture: 10 checks passed, including a weekly schedule saved over the real local HTTP API and paused without creating a run. No external provider calls.
- Visually inspected daily/weekly/monthly, saved schedule, compact desktop, and Semrush browser layouts.
- Backend coverage includes DST gaps/folds/half-hour changes, month-end/leap-day clamping, latest-due catch-up, durable claims, active/review overlap, failed/interrupted pause, workspace isolation, budget/source preservation, and process ownership.
- Reviewer findings on cross-process duplicate dispatch and skipped-review wording were fixed and rechecked.
- Private workflow lists were imported only into the owner's existing Semrush profile: 18 Reddit communities, 382 X accounts, 515 LinkedIn profiles. Full normalized equality was verified. See `semrush-n8n-sources.json`.

Runtime limits: the app or server must stay running; it does not wake a sleeping computer. Missed runs do not accumulate. Theme approval is required before reports. A schedule must be explicitly enabled before automatic paid work starts. No real schedule was enabled during implementation or verification.

Receipts: `research-schedule-native.json`, `content-studio-web.json`, `research-schedule-package.json`. Installed-app continuity is recorded separately after replacement.

Installed release verified: signed arm64 app replaced atomically after native/disk idle checks. All saved programs and source arrays match the pre-update profile exactly; report/dataset/research IDs are preserved. Existing Semrush schedule is off. Installed editor exposes all four recurrence choices. Disk image integrity and installed/archive equality passed. Normal Dock relaunch has one process, one Dock entry, and the debugging port is closed. See `research-schedule-installed.json` and `macos-installed-continuity.json`.
