# Semrush workspace design — September 27, 2026

The expanded Semrush design is installed at `/Applications/Scraper Studio.app` and was reopened through the existing Dock icon. The selected workspace is Semrush. This record supersedes the earlier palette-only UI screenshots.

## Delivered

- Official current Semrush lockup and lavender, mint, near-black and aqua palette.
- Mint navigation, lavender selected states, quieter toolbar and consistent form/button styling.
- Overview with distinct research and content actions, real workspace activity counts and compact brand-readiness details.
- Compact headings on working pages, with clearer research configuration, content steps, saved assets and brand knowledge.
- Source collection first in Semrush Settings, followed by writing and image provider cards.
- Matching search, datasets, reports, review, playbooks, findings chat and content board styling.
- Semrush-specific styles are edition-scoped; existing data and provider behavior are preserved.

## Verification

- All 682 tests passed across 43 files. Desktop and web builds passed.
- 24 offline native checks and 8 browser checks passed. The fixture harnesses made no external provider calls.
- Normal and compact layouts were visually inspected. The actual final installed window was captured by CoreGraphics window ID without bringing it forward solely for the screenshot. Native traffic-light clearance, the official logo, card contrast and activity labels were checked.
- Installed continuity passed: original profile, four matching datasets, General and Semrush workspaces, saved Apify connection and the existing approved image-key file connection. Google remains unconfigured. The probe made no provider or AI CLI calls and no configuration writes.
- The updated arm64 app passes strict recursive signature verification with Developer ID and hardened runtime. The normal Dock launch has one installed main process, one Dock entry and no temporary debugging port. All original Dock entries remain in order.
- The generated icon is unchanged and matches the installed ICNS. The package audit found no credential files or matches for the checked secret patterns.
- The DMG passes integrity verification; its ASAR matches the installed app. Current hashes are in the package receipt.

Static screenshot inspection does not establish every hover or populated report state. Paid scraping, image generation and AI inference were not repeated for this visual update. This local Mac build is signed but remains unnotarized; no new public release, Windows build or Intel build is claimed.

## Evidence

- [Actual installed window](../assets/semrush-design-installed.png)
- [Compact overview](../assets/semrush-design-semrush-compact.png)
- [Source and provider settings](../assets/semrush-design-settings-images.png)
- [Native workflow receipt](content-studio-desktop.json)
- [Browser workflow receipt](content-studio-web.json)
- [Installed continuity](macos-installed-continuity.json)
- [Dock launch](macos-dock.json)
- [Package checks and hashes](macos-package.json)
- [Official brand sources and design rationale](../research/semrush-2026-brand.md)
