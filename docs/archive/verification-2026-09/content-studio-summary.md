# Content Studio verification — September 27, 2026

- Complete regression suite: 640 tests passed across 40 files (bounded to four workers after an existing pagination case timed out under concurrent builds).
- Desktop production build: passed.
- Browser production build: passed.
- Native desktop smoke: 19 workflow/layout checks, zero external network or CLI calls, no renderer errors. Providers in this smoke are explicit fixtures.
- Browser smoke: seven full/compact screen checks plus sign-out, zero external provider calls, no renderer errors.
- Screenshots visually inspected for the Semrush output selector, theme review, General/Semrush overview and compact layouts.
- The normal desktop app was refreshed after verifying no active collection or analysis jobs. Existing four datasets remained intact. Both workspace editions initialized.
- Google delivery: fixture-verified folder creation, native Docs conversion, PNG/SVG upload, explicit invocation, durable checkpoints and ambiguous-write reconciliation. No real Drive files were created.
- Apify enterprise collection: fixture-verified 915-target planning, full 10,000-row batching, provider-run reuse, unknown-start protection and comment expansion. No paid collection calls were made in this implementation turn.
- The owner explicitly approved a $1.50 live Claude test. It passed: two saved outputs (evidence report and social pack), both using claude-opus-5-5, with $0.197248 total CLI-reported usage. The outputs use only the approved internal brief and explicitly disclose the absence of external market evidence. See content-studio-live.json and live-content/.
- The owner selected the OpenAI project and approved the ignored local env destination. The new key was created securely. OpenAI images are connected on desktop and backend, with a separate no-charge model-access check. A real native one-image test passed at low quality, saving a 1536×1024 PNG and raster SVG with $0.00718 usage-estimated cost. See image-provider-live.json and live-image/.
- Windows installer configuration exists; no Windows build/install verification or signing was performed. No public web deployment, billing, SSO or tenant-isolated SaaS release was performed.

Receipts: content-studio-desktop.json and content-studio-web.json. Native harness: scripts/content-studio-smoke.cjs. Browser harness: scripts/content-studio-web-smoke.cjs.

## Live output review

Both live JSON outputs passed the source-aware output validator. All six report quotations match the original brief. LinkedIn: 142 words; Facebook: 94 words; X: seven posts, longest 158 characters. No fabricated market statistics or demand claims were found. The report repeats caveats because its single internal source cannot support market analysis; this test establishes a grounded generation path, not market-research quality.

## Semrush visual refresh

The entire desktop shell now follows the orange reference, with a workspace selector and five primary destinations. Six common deliverables appear first, with eleven more behind progressive disclosure. Native checks cover the 760-pixel Semrush layout and prevent an unfinished source brief from crossing workspace boundaries. New header art is bundled locally. The normal application was relaunched in Semrush; all four existing datasets were retained. Actual normal-app window: docs/assets/semrush-running.png. The full output-selector fixture is docs/assets/content-studio-semrush.png.

## Image integration verification

One real image request passed through the built desktop preload/IPC/service/provider path with a public synthetic creative brief. The test made no CLI, Apify, or Drive calls and no paid retries. Saved PNG bytes were validated, exported and visually inspected. The campaign preset added a headline despite the source suggesting no words; exact creative-constraint compliance is not claimed. The live Claude and image tests total $0.204428 in CLI-reported / image-usage-estimated cost, below the approved $1.50 test allocation. Provider billing remains authoritative.

Tests cover partial variation persistence, durable pre-dispatch receipts, reuse after restart, cancellation, rejected-request retry, unknown-charge blocking, workspace isolation, credential input handling and host-only credential loading. fal.ai and direct Codex image generation are not connected.
