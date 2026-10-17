# Native research workflow fixture verification

This folder contains **synthetic QA fixtures only**. It is not customer research, a live Apify collection, or an AI-generated report. All content and the reviewer name identify themselves as QA fixtures. No live service or network request ran.

The final run used the real built Electron application, preload bridge, import/comparison/review IPC handlers, and a disposable user-data directory. External-service entrypoints and HTTP(S) requests were blocked. The native export reveal was stubbed to avoid opening Finder.

Verified: all 8 playbooks; brand profile creation and reuse; CSV preview, acknowledgment, duplicate exclusion and import; changed/unchanged/unavailable snapshot comparison; derived comparison collection and weekly-report selection; report coverage and saved evidence drawer; rejected approval without checks; blocked export while edits are unsaved; approved local review; Markdown and HTML bundles; repeated-comparison reuse; and five compact layouts at 760 × 700 with no page overflow.

Screenshots were visually inspected at normal and compact sizes. The source-list contrast defect found during the first pass was corrected and verified in the final pass. The approved HTML export was rendered offline and inspected at its header and evidence register. Approval is explicitly self-reported local review, not authenticated enterprise sign-off.

- [Final native receipt](fixture-receipt.json): passed; 11 recorded workflow/layout checks; 0 external-service calls; 0 network calls.
- [Approved HTML fixture](approved-html-fixture/research-brief.html)
- [Approved Markdown fixture](approved-markdown-fixture/research-brief.md)
- [Playbooks](screenshots/fixture-playbooks.png)
- [Brand profile](screenshots/fixture-brand-profile.png)
- [Import preview](screenshots/fixture-import-preview.png)
- [Snapshot comparison](screenshots/fixture-comparison.png)
- [Report and coverage](screenshots/fixture-report-body.png)
- [Source drawer](screenshots/fixture-report-source-drawer.png)
- [Local approval](screenshots/fixture-report-approved.png)
- [HTML export](screenshots/fixture-approved-export-html.png)
- [HTML evidence register](screenshots/fixture-approved-export-evidence.png)

Reproduce after building:

```sh
npm run build
node_modules/.bin/electron scripts/research-upgrades-smoke.cjs
```

The script prints the disposable data directory, screenshots directory and receipt path. The logged approval rejection is an expected negative test, not a failed run. Each export folder includes the evidence CSV and its saved review and receipt.
