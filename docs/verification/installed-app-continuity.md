# Installed macOS app continuity check

The probe in `scripts/installed-app-continuity.cjs` attaches to the **already running signed installed app**. It does not launch Electron, import the app in a development executable, write user data, open the image credential file, or call a provider. It invokes only the real renderer's `appMeta()` and `state()` bridge methods, projects credential availability into booleans inside the renderer, and prints a sanitized JSON receipt.

An external development Electron harness cannot prove the installed app's Keychain access: its executable signature differs. This probe uses the installed process. Its clean launch environment is operator-attested, not independently observed. Quit all development/installed copies before the controlled launch. Check that there are no due schedules first; normal application startup performs recovery/migrations and starts its scheduler. The probe itself cannot disable those without mutating the application.

After development has closed, launch once with the credential environment variables removed. Use a free localhost port:

```sh
env -u ELECTRON_RUN_AS_NODE -u APIFY_API_TOKEN -u GOOGLE_SHEETS_WEBHOOK_URL -u GOOGLE_DOCS_ACCESS_TOKEN -u OPENAI_API_KEY -u APIFY_STUDIO_AUTO_UPDATE_URL '/Applications/Scraper Studio.app/Contents/MacOS/Scraper Studio' --remote-debugging-port=9338 --remote-debugging-address=127.0.0.1
```

In another terminal, from the repository, run:

```sh
node scripts/installed-app-continuity.cjs --app '/Applications/Scraper Studio.app' --port 9338 --clean-launch-confirmed --expected-datasets 4 --image-credential-file '/Users/chrisdimarco/Projects/apify-scraper-studio/.env.local'
```

Requires Node with built-in `fetch` and `WebSocket` (the current Node 26 runtime supports both). The script never starts another app or writes a receipt itself; save its stdout to a new verification artifact if desired. Quit the debugging launch and reopen the installed app normally after validation.

A passing receipt checks:

- The exact installed bundle renderer; bundle ID `com.chrisdimarco.apifyscraperstudio`; valid Developer ID signature from team `4X5MZ8MGH9`; hardened runtime; arm64 executable support.
- Existing `~/Library/Application Support/apify-scraper-studio` profile, all four indexed datasets, matching dataset IDs internally, both workspace identities, and an unchanged config/data/content-studio snapshot during the probe.
- All previously enabled encrypted credentials remain available; Apify and OpenAI are available. Google is optional: each previously configured, enabled Google credential must remain available, while an unconfigured Google integration truthfully reports `false` without failing continuity; the configured external image credential path exactly matches the approved path. No key, ciphertext, dataset ID/content, or credential file content is returned.
- No observed active jobs in either saved workspace or the runtime, and no enabled schedules. These are snapshots, not a concurrency lock or guarantee about events before/after the probe.

Fixture tests use only synthetic data and cover both unconfigured Google integrations and loss of an existing Google credential. Installed checks are recorded separately; do not rewrite a prior receipt to represent a new run.

## Packaging prerequisites and limits

`npm run dist:mac` builds the current icon and desktop bundle, then targets arm64. The package retains internal name `apify-scraper-studio`, display/product name `Scraper Studio`, and app ID above. The installed bundle path is `/Applications/Scraper Studio.app`; replacing a differently named old app is a separate installation step.

The package whitelist and explicit `.env` exclusions must be checked against the **actual ASAR entries** after building. The approved external `.env.local` stays outside the bundle and is referenced only by the existing profile's `imageCredentialFile` metadata. Do not copy it into the bundle or embed it in an archive. CLI execution still requires the user's existing Claude installation and authentication; the packaged PATH helper includes `~/.local/bin`, `/opt/homebrew/bin`, and `/usr/local/bin`.

The valid Developer ID identity can sign the local build. The notarization hook requires all three Apple notarization environment variables; without them it skips notarization. A valid signature/installed launch is not evidence of Apple notarization or Gatekeeper acceptance on a different Mac. The probe does not assess notarization. Keeping Electron's internal name preserves the Safe Storage service/account identity, but a newly signed executable may still trigger macOS Keychain access approval; do not weaken Keychain access controls to suppress that prompt.
