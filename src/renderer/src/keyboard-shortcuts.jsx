import React, { useId } from 'react';
import { Dialog, DialogClose } from './role-screens.jsx';
import { ASK_SHORTCUTS } from './ask-slash.js';
import { isMac, keyLabel } from './platform.js';

// The Keyboard shortcuts dialog, from the account menu. `shortcuts` comes from nav-model.js (buildNav().shortcuts): the
// page numbers in nav order first, then search, Ask AI, New, Settings, the sidebar and Esc, each only when this person
// has it. On Windows and Linux the studio takes Ctrl where the Mac takes ⌘, so the caps there read Ctrl, Alt and Shift
// (platform.js keyLabel). People who have Ask AI (⌘J is in their list) also get its own keys (ask-slash.js ASK_SHORTCUTS).
const KEY_WORDS = { '⌘': 'Command', '⌥': 'Option', '⇧': 'Shift', '⌃': 'Control', Ctrl: 'Control', '↑': 'Up arrow', '/': 'Slash' };
// "⌥⌘N" → ['⌥', '⌘', 'N'], each in its own key cap; "⇧Enter" → ['⇧', 'Enter']; screen readers hear "Option Command N".
// Off the Mac: "⌥⌘N" → ['Ctrl', 'Alt', 'N'], heard as "Control Alt N".
const capsOf = (keys, mac) => {
  if (!mac) { const label = keyLabel(keys, false); return label ? label.split('+') : []; }
  const text = String(keys || ''); const word = /(Enter|Esc|Tab|Space)$/.exec(text); return word ? [...text.slice(0, word.index), word[1]] : [...text];
};
const spoken = (keys, mac) => capsOf(keys, mac).map((key) => KEY_WORDS[key] || (key === '\\' ? 'Backslash' : key === ',' ? 'Comma' : key)).join(' ');

export function KeyboardShortcutsDialog({ shortcuts = [], onClose }) {
  const titleId = useId();
  const mac = isMac();
  const pages = shortcuts.filter((row) => /^⌘\d$/.test(row.keys));
  const rest = shortcuts.filter((row) => !/^⌘\d$/.test(row.keys));
  const section = (title, rows) => rows.length > 0 && <section className="sb-keys-section" aria-label={title}>
    <h3>{title}</h3>
    <dl className="sb-keys">{rows.map((row) => <div key={`${row.keys}-${row.label}`} className="sb-keys-row"><dt>{row.label}</dt><dd aria-label={spoken(row.keys, mac)}>{capsOf(row.keys, mac).map((key, index) => <kbd key={index} aria-hidden="true">{key}</kbd>)}</dd></div>)}</dl>
  </section>;
  return <Dialog labelledBy={titleId} className="sb-keys-dialog" onClose={onClose}>
    <div className="studio-dialog-head"><div><small>Account</small><h2 id={titleId}>Keyboard shortcuts</h2></div><div className="studio-dialog-tools"><DialogClose onClose={onClose} /></div></div>
    <div className="studio-dialog-body">
      {section('Pages, in sidebar order', pages)}
      {section('Everywhere', rest)}
      {shortcuts.some((row) => row.keys === '⌘J') && section('In Ask AI', ASK_SHORTCUTS)}
    </div>
    <div className="studio-dialog-foot"><button type="button" className="studio-quiet small" onClick={onClose}>Done</button></div>
  </Dialog>;
}
