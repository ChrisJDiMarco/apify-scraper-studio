# Scraper Studio for macOS

The Mac app uses the same research, content and connection settings as the development app. Its display name is **Scraper Studio**; the internal storage identity remains `apify-scraper-studio` to preserve the existing profile and macOS Safe Storage key.

## Build

On macOS, run `npm ci`, then `npm run dist:mac`. This regenerates the native icon from the saved ImageGen asset, compiles the app, and produces an Apple Silicon application and DMG under `dist/`. Select a Developer ID Application certificate by setting `CSC_NAME` to its owner name without the `Developer ID Application:` prefix. The package allowlist excludes `.env`, `.env.*`, PEM and private-key files.

This build is for Apple Silicon. The existing builder target also supports x64 when explicitly requested. Windows packaging remains a separate build and was not verified by this Mac installation.

## Connect and use

Open **Scraper Studio** from Applications or the Dock. Choose **Semrush workspace** to use the official March 2026 wordmark, lavender/mint palette and refreshed content defaults. Custom brand knowledge is preserved. The General workspace retains its independent design.

The owner installation uses the existing profile at `~/Library/Application Support/apify-scraper-studio`. Existing encrypted credentials are preserved. This owner profile has Apify and OpenAI configured; Google delivery was unconfigured before installation and remains unconfigured. Its image connection refers to the explicitly approved `.env.local` file in the project through nonsecret `config.imageCredentialFile` metadata. That external file must stay in place; its contents are not bundled. A new installation should connect an image key through **Settings → Image generation** instead. The installed app discovers supported local AI CLIs through the user's local executable paths.

## Release status

A valid Developer ID signature verifies the signed bundle's identity and integrity. Apple notarization is a separate release step; this local installation is not notarized. Public downloads should go through the configured notarization hook with the owner's Apple release credentials and a distribution test before publication.

## Design and verification

- [Current Semrush brand sources](research/semrush-2026-brand.md)
- [Generated icon and design prompt](../resources/app-icon-prompt.md)
- [Mac installation receipt](verification/macos-app-2026-09-27.md)
