# Persistent workspace switching — September 27, 2026

Fixed the reported navigation dead end: the personal workspace had replaced the sidebar selector with a static label. The real selector now remains below the logo in every edition and on every page. Narrow layouts have a workspace selector above page navigation. General Content Studio retains its tabs while avoiding a duplicate workspace selector.

Verified with 28 focused renderer tests and 25 native fixture checks, including General Search → Semrush → General. The native harness made zero external network calls and zero AI CLI calls. Desktop and web builds passed. The regression test failed against the original behavior and passes with the fix.

The signed arm64 app and DMG were rebuilt. The actual installed app passed a Settings → Semrush → personal workspace round trip through the UI. Four datasets and existing connections passed the read-only continuity probe. The original personal workspace selection was restored. The app was then reopened normally from its existing Dock icon; the temporary debug port is closed, the process is unique, and existing Dock entries remain unchanged.

The installer integrity check passed, and its application ASAR matches the installed app. This remains the same signed local, unnotarized release channel.

- [Installed window](../assets/workspace-switch-installed.png)
- [General Search with persistent selector](../assets/workspace-switch-general-search.png)
- [Semrush after switching](../assets/workspace-switch-semrush-search.png)
- [Native workflow receipt](workspace-switch-native.json)
- [Actual installed interaction receipt](workspace-switch-installed.json)
- [Installed data continuity](macos-installed-continuity.json)
- [Package hashes](macos-package.json)
