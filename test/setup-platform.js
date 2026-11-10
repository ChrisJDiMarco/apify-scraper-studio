// Runs before every test file (vitest.config.mjs setupFiles). Shortcut labels and "this Mac" copy follow
// navigator.platform (src/renderer/src/platform.js). Node reports MacIntel on a Mac and Win32 on a Windows runner, and
// jsdom reports '', so it is pinned to the Mac here and the suites that check ⌘, Meta and "this Mac" pass on every OS.
// test/win-labels.test.jsx sets Win32 for its own checks.
if (typeof navigator !== 'undefined') Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true });

// The app keeps the page on screen in the address bar (deep-links.js useRoutes), and jsdom keeps the address between
// tests in a file, so each test starts at the bare address, as a fresh window would.
import { afterEach } from 'vitest';
if (typeof window !== 'undefined') afterEach(() => { try { window.history.replaceState(null, '', '/'); } catch { /* no history */ } });
