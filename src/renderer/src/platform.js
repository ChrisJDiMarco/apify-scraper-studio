// Which computer the studio is drawn on, read from navigator.platform. It works the same in the desktop app and in the
// browser studio; the main process never sends it (the preload bridge's keys must match studio-api-channels.json).
// Tests pin navigator.platform to MacIntel (test/setup-platform.js), so they see the Mac wording on every OS.
//
// Shortcut data stays in Mac form everywhere (nav-model.js's ⌘1 and ⌥⌘N, Sheets' ⇧⌘Z); keyLabel and ariaKey convert it
// only when it is drawn. Each helper takes `mac` so a caller that already knows can pass it.
export const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || '');

// Windows order: Ctrl, then Alt, then Shift, then the key.
const MODIFIERS = [['⌃', 'Ctrl'], ['⌘', 'Ctrl'], ['⌥', 'Alt'], ['⇧', 'Shift']];
// "⌥⌘N" → "Ctrl+Alt+N", "⇧⌘Z" → "Ctrl+Shift+Z", "⌘-click" → "Ctrl+click", "⌫" → "Delete". Unchanged on the Mac.
export function keyLabel(keys, mac = isMac()) {
  const text = String(keys || '');
  if (mac || !text) return text;
  const held = [...new Set(MODIFIERS.filter(([glyph]) => text.includes(glyph)).map(([, word]) => word))];
  const key = text.replace(/[⌃⌘⌥⇧]/g, '').replace(/^-/, '').replace('⌫', 'Delete');
  return [...held, key].filter(Boolean).join('+');
}
// The aria-keyshortcuts name of the key that ⌘ stands for. "Meta" on Windows is the Windows key, so it is Control there.
export const ariaKey = (mac = isMac()) => (mac ? 'Meta' : 'Control');
// "Draft saved on this Mac" / "on this PC".
export const place = (mac = isMac()) => (mac ? 'this Mac' : 'this PC');
// shell.showItemInFolder opens Finder on the Mac and File Explorer on Windows.
export const revealLabel = (mac = isMac()) => (mac ? 'Show in Finder' : 'Show in File Explorer');
