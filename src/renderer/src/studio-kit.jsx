import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { LoaderCircle, TriangleAlert } from 'lucide-react';
import './studio-kit.css';

// Studio setup's shared page parts (design review, 2026-11-23): one save bar, one status label, one empty block. Every
// Studio setup page uses these, so a page saves, shows status and says "nothing here yet" the same way.

// The save bar: it appears only when something changed ("2 changes · Discard · Save …"). Inside Studio setup it is drawn
// into the slot above the section menu (simple-mode.jsx `setup-savebar-slot`): it covers that menu instead of pushing
// the page down, and stays pinned to the top while the page scrolls. Elsewhere it sits at the top of its own page.
// `form` names a <form> for Save to submit; otherwise Save calls onSave. `always` keeps it up with nothing changed (a
// create step, where Save is the only way forward).
export function SaveBar({ changes = 0, always = false, saving = false, problems = 0, note = '', saveLabel = 'Save', savingLabel = 'Saving…', discardLabel = 'Discard', onSave, onDiscard, form, disabled = false }) {
  const [slot, setSlot] = useState(null);
  useEffect(() => { setSlot(typeof document !== 'undefined' ? document.getElementById('setup-savebar-slot') : null); }, []);
  if (!always && !(changes > 0)) return null;
  const text = note || (changes > 0 ? `${changes} unsaved ${changes === 1 ? 'change' : 'changes'}` : '');
  const bar = <div className="kit-savebar" role="region" aria-label="Unsaved changes">
    <span className="kit-savebar-text"><strong>{text}</strong>{problems > 0 && <small className="kit-savebar-problems"><TriangleAlert size={13} aria-hidden="true" />{problems === 1 ? '1 thing to fix first' : `${problems} things to fix first`}</small>}</span>
    <span className="kit-savebar-buttons">
      {onDiscard && <button type="button" className="kit-quiet" disabled={saving} onClick={onDiscard}>{discardLabel}</button>}
      <button type={form ? 'submit' : 'button'} form={form} className="kit-primary" disabled={saving || disabled || problems > 0} onClick={form ? undefined : onSave}>{saving && <LoaderCircle className="spin" size={15} aria-hidden="true" />}{saving ? savingLabel : saveLabel}</button>
    </span>
  </div>;
  return slot ? createPortal(bar, slot) : <div className="kit-savebar-inline">{bar}</div>;
}

// One set of statuses with fixed words and colours. The same check drives a section's dot, its label and its card.
export const STATUS_WORDS = Object.freeze({ ready: 'Ready', attention: 'Needs attention', unset: 'Not set up' });
export function StatusLabel({ status = 'unset', children, title }) {
  const kind = STATUS_WORDS[status] ? status : 'unset';
  return <span className={`kit-status is-${kind}`} title={title}><span className="kit-status-dot" aria-hidden="true" />{children || STATUS_WORDS[kind]}</span>;
}
// The tones older code speaks (Badge tones, settings-sections.js) mapped onto the three statuses.
export const statusOfTone = (tone) => (tone === 'ready' || tone === 'success' ? 'ready' : tone === 'warning' || tone === 'attention' || tone === 'problem' || tone === 'danger' ? 'attention' : 'unset');

// One empty block: what goes here, and the button that adds the first one.
export function EmptyBlock({ title, children, action = null }) {
  return <div className="kit-empty">{title && <strong>{title}</strong>}{children && <p>{children}</p>}{action}</div>;
}
