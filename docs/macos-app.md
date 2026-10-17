# Scraper Studio for macOS

The Mac app is the same studio as the browser version, packaged with Electron for one person per Mac (who is always
the admin). Its display name is **Scraper Studio**; its internal storage identity stays `apify-scraper-studio`
(`INTERNAL_APP_NAME` in `src/main/index.js`), so existing profiles and the macOS "Safe Storage" keychain item carry over.
Keep that name.

## Build

```bash
nvm use            # Node 24, from .nvmrc
npm ci
npm run dist:mac   # icon, build, then a universal (arm64 + x64) app and DMG
```

`npm run dist:mac` always builds universal (package.json passes `--universal`) and writes
`dist/Scraper Studio-<version>-universal.dmg`. Plain `npm run dist` builds only this Mac's architecture; don't ship
that. `npm run dist:win` builds an NSIS installer for x64; Windows is untested.

- **Signing**: set `CSC_NAME` to the Developer ID Application identity (the name without the
  `Developer ID Application:` prefix). The package excludes `.env`, `.env.*`, PEM, P12, P8 and key files.
- **Notarization**: runs only when `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` are set. Today two
  things notarize when they are: electron-builder 26 itself, and the `afterSign` hook
  `scripts/notarize-if-configured.cjs`. Remove the hook (and its `afterSign` line) before a real release so Apple is
  asked once (see [HANDOFF.md](../HANDOFF.md#known-limitations-and-follow-ups)).
- **Electron fuses** are set in `package.json` `build.electronFuses` (no run-as-node, no `NODE_OPTIONS`, no inspector,
  asar integrity, cookie encryption). Check them on the built app with
  `npx @electron/fuses read --app "dist/mac-universal/Scraper Studio.app"`. With `NODE_OPTIONS` off,
  `NODE_EXTRA_CA_CERTS` doesn't work either: test the DMG on a network with TLS inspection before rollout.
- `npm run release:diagnostics` prints what a release build will contain and what it still needs.
- After building, `npm run test:desktop` (and `-- --with-data`) runs the desktop smoke test on disposable data.

Record the commit SHA and `shasum -a 256` of each DMG you hand out.

## Install and update

Open the DMG and drag **Scraper Studio** into Applications. A build that isn't notarized is stopped once at first
launch: System Settings → Privacy & Security → **Open Anyway**. There are no automatic updates (the updater code has no
feed and nothing calls it): quit the app when nothing is running, open the new DMG and replace the app. Data in
`~/Library/Application Support/apify-scraper-studio` is kept.

Re-signing under a different Apple Team ID or changing `build.appId` changes the code requirement on the keychain's
Safe Storage item: people who installed an earlier build are asked for keychain access again or lose their saved keys.
Ask them to note their keys (or export a setup file) first.

## Connect and use

Open **Scraper Studio** from Applications. A fresh profile opens in the **Semrush workspace**. Save the Apify token in
**Settings → Source collection**, connect Claude in **Settings → Writing & research** (the Claude app or an Anthropic
API key), and add an OpenAI key under **Settings → Image generation** for pictures. Keys are encrypted with the
keychain (Electron `safeStorage`); the app refuses to save a key when that isn't available. The installed app finds the
`claude` and `codex` command-line tools through your login shell's `PATH`.

`config.imageCredentialFile` is a legacy, owner-only pointer to an external env file (`src/main/local-image-key.js`).
No screen sets it; don't use it for new installs. Development runs (`npm run dev`) also read `OPENAI_API_KEY` from the
project's `.env.local` unless `STUDIO_DISABLE_LOCAL_ENV=1`; packaged builds never do.

## Design and verification history

- [Semrush brand sources](research/semrush-2026-brand.md)
- [Mac installation receipt, September 2026](archive/verification-2026-09/macos-app-2026-09-27.md)
