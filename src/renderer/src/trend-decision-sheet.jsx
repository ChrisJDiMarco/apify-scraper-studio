import React, { useId, useRef, useState } from 'react';
import { Check, ChevronDown, LoaderCircle, MessageSquarePlus } from 'lucide-react';
import { Dialog, DialogClose } from './role-screens.jsx';
import { useViewer, writeProps } from './viewer.js';
import { libraryChannels } from '../../shared/library-tree.js';
import KIT from '../../shared/kit-folders.json';
import './trend-board.css';

// Approving a trend with a note and the channels it is for. "Yes" stays one tap; its caret offers "Yes, with a note…",
// which opens this sheet: channel chips (All channels by default) and a note the channel owners read on the trend's
// card ("Suggested for Social by Riley: …"). The note and channels go to decideResearchTheme({ note, channels }).
export const NOTE_MAX = 280;

// The channels a trend can be routed to in this edition: { id, name, short }, in kit folder order.
export function routingChannels(editionId = 'general') {
  const edition = editionId === 'semrush' ? 'semrush' : 'general';
  const offered = new Set(libraryChannels(edition).map((channel) => channel.id));
  return KIT.folders.filter((folder) => offered.has(folder.id)).map((folder) => ({ id: folder.id, name: folder[edition], short: folder[`${edition}Short`] || folder[edition] }));
}
export const channelLabel = (channels, id) => channels.find((channel) => channel.id === id)?.short || channels.find((channel) => channel.id === id)?.name || id;
// "Fits Social": the person's own channels (prefs.focusChannels) a trend is open to, from its decision (run.decisionsBy):
// routed there, or to every channel. → short channel names.
export function fitsFor(by, focusChannels = [], channels = []) {
  const routed = Array.isArray(by?.channels) ? by.channels : [];
  return (Array.isArray(focusChannels) ? focusChannels : []).filter((id) => channels.some((channel) => channel.id === id) && (!routed.length || routed.includes(id))).map((id) => channelLabel(channels, id));
}

// trend: { name } (a board card or trend record). onConfirm({ note, channels }) may return a promise; a rejection is
// shown in the sheet and keeps it open. channels [] means every channel.
export function TrendDecisionSheet({ trend, channels = [], onConfirm, onClose }) {
  const viewer = useViewer();
  const titleId = useId(); const noteId = useId();
  const [picked, setPicked] = useState([]);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState('');
  const noteRef = useRef(null);
  const all = !picked.length;
  function toggle(id) { setProblem(''); setPicked((current) => { const next = current.includes(id) ? current.filter((value) => value !== id) : [...current, id]; return next.length === channels.length ? [] : next; }); }
  async function confirm(event) {
    event?.preventDefault();
    if (saving || viewer.preview) return;
    if (note.length > NOTE_MAX) { setProblem(`Keep the note under ${NOTE_MAX} characters.`); noteRef.current?.focus(); return; }
    setSaving(true); setProblem('');
    try { await onConfirm?.({ note: note.trim(), channels: picked }); setSaving(false); onClose?.(); }
    catch (failure) { setSaving(false); setProblem(failure?.message || 'That yes couldn’t be saved. Try again.'); }
  }
  return <Dialog labelledBy={titleId} onClose={onClose} closeDisabled={saving} className="td-sheet">
    <form onSubmit={confirm}>
      <header className="studio-dialog-head"><div><small>Yes, with a note</small><h2 id={titleId}>{trend?.name || 'This trend'}</h2></div><DialogClose onClose={onClose} disabled={saving} /></header>
      <div className="studio-dialog-body td-body">
        <fieldset className="td-channels">
          <legend>Which channels should pick this up?</legend>
          <div className="td-chips" role="group" aria-label="Channels">
            <button type="button" className="td-chip" aria-pressed={all} onClick={() => { setPicked([]); setProblem(''); }}>{all && <Check size={13} aria-hidden="true" />}All channels</button>
            {channels.map((channel) => { const on = picked.includes(channel.id); return <button type="button" key={channel.id} className="td-chip" aria-pressed={on} title={channel.name} onClick={() => toggle(channel.id)}>{on && <Check size={13} aria-hidden="true" />}{channel.short || channel.name}</button>; })}
          </div>
          <p className="studio-hint">{all ? 'Every channel sees it as new.' : `Only ${picked.map((id) => channelLabel(channels, id)).join(', ')} ${picked.length === 1 ? 'sees' : 'see'} it as new. The others can still find it under All.`}</p>
        </fieldset>
        <label className="studio-field td-note" htmlFor={noteId}><span>Note for the channels <em>(optional)</em></span>
          <textarea ref={noteRef} id={noteId} rows={3} maxLength={NOTE_MAX + 40} value={note} placeholder="Lead with the CTR data. Don’t name competitors." aria-describedby={`${noteId}-count`} onChange={(event) => { setNote(event.target.value); setProblem(''); }} />
        </label>
        <p id={`${noteId}-count`} className={`td-count${note.length > NOTE_MAX ? ' over' : ''}`}>{note.length} / {NOTE_MAX}</p>
        {problem && <p className="studio-error" role="alert">{problem}</p>}
      </div>
      <footer className="studio-dialog-foot">
        <button type="button" className="studio-quiet" disabled={saving} onClick={onClose}>Cancel</button>
        <button type="submit" className="studio-primary" {...writeProps(viewer, saving)}>{saving ? <LoaderCircle className="spin" size={15} aria-hidden="true" /> : <Check size={15} aria-hidden="true" />}{saving ? 'Saving…' : 'Say yes'}</button>
      </footer>
    </form>
  </Dialog>;
}

// "Yes" with a caret: Yes approves at once (onDecide(card, 'approved')); the caret's "Yes, with a note…" opens the
// sheet and calls onDecideWithNote(card, { note, channels }). Without onDecideWithNote it is the plain Yes button.
// `className` styles the Yes half the way the surrounding layout styles its buttons (simple-yes, tb-ok…).
export function TrendYesButton({ card, channels = [], disabled = false, className = '', size = 15, label = 'Yes', ariaLabel = '', spot, onDecide, onDecideWithNote }) {
  const viewer = useViewer();
  const [menu, setMenu] = useState(false);
  const [sheet, setSheet] = useState(false);
  const caret = useRef(null); const item = useRef(null);
  const write = writeProps(viewer, disabled);
  const yes = <button type="button" className={className} data-spot={spot} data-spot-item={spot ? card.name : undefined} aria-label={ariaLabel || `Yes, use it: ${card.name}`} {...write} onClick={() => onDecide?.(card, 'approved')}><Check size={size} aria-hidden="true" />{label}</button>;
  if (!onDecideWithNote) return yes;
  function openMenu() { setMenu(true); requestAnimationFrame(() => item.current?.focus()); }
  function closeMenu(refocus = true) { setMenu(false); if (refocus) caret.current?.focus(); }
  return <span className="td-yes" role="group" aria-label={`Approve ${card.name}`}>
    {yes}
    <span className="td-caret-wrap" onBlur={(event) => { if (menu && !event.currentTarget.contains(event.relatedTarget)) setMenu(false); }}>
      <button ref={caret} type="button" className={`td-caret ${className}`.trim()} aria-label={`More ways to say yes to ${card.name}`} aria-haspopup="menu" aria-expanded={menu} {...write} onClick={() => (menu ? closeMenu(false) : openMenu())} onKeyDown={(event) => { if (event.key === 'ArrowDown' && !menu) { event.preventDefault(); openMenu(); } }}><ChevronDown size={size - 1} aria-hidden="true" /></button>
      {menu && <span className="studio-menu td-menu" role="menu" aria-label={`Yes to ${card.name}`} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeMenu(); } else if (event.key === 'Tab') setMenu(false); }}>
        <button ref={item} type="button" role="menuitem" onClick={() => { setMenu(false); setSheet(true); }}><MessageSquarePlus size={15} aria-hidden="true" />Yes, with a note…</button>
      </span>}
    </span>
    {sheet && <TrendDecisionSheet trend={card} channels={channels} onClose={() => setSheet(false)} onConfirm={(choice) => onDecideWithNote(card, choice)} />}
  </span>;
}

// "My channels" (the account menu): the channels this person makes content for, saved in their prefs (focusChannels,
// at most 6). Assets opens on them, Make channel assets pre-ticks their files, trend cards say "Fits Social", and the
// briefing gets a "Ready for your channels" card.
export const FOCUS_MAX = 6;
export function MyChannelsDialog({ api, editionId = 'general', onClose, onSaved }) {
  const viewer = useViewer();
  const titleId = useId();
  const channels = routingChannels(editionId);
  const [picked, setPicked] = useState(() => (Array.isArray(viewer.prefs?.focusChannels) ? viewer.prefs.focusChannels : []).filter((id) => channels.some((channel) => channel.id === id)));
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState('');
  const toggle = (id) => { setProblem(''); setPicked((current) => (current.includes(id) ? current.filter((value) => value !== id) : current.length >= FOCUS_MAX ? current : [...current, id])); };
  async function save(event) {
    event?.preventDefault();
    if (saving || viewer.preview || typeof api?.setViewPrefs !== 'function') return;
    setSaving(true); setProblem('');
    try { await api.setViewPrefs({ focusChannels: picked }); setSaving(false); onSaved?.(picked); onClose?.(); }
    catch (failure) { setSaving(false); setProblem(failure?.message || 'Your channels couldn’t be saved. Try again.'); }
  }
  return <Dialog labelledBy={titleId} onClose={onClose} closeDisabled={saving} className="td-sheet">
    <form onSubmit={save}>
      <header className="studio-dialog-head"><div><small>Your account</small><h2 id={titleId}>My channels</h2></div><DialogClose onClose={onClose} disabled={saving} /></header>
      <div className="studio-dialog-body td-body">
        <p className="studio-hint">Pick the channels you make content for. Assets opens on them, Make channel assets ticks their files, and trend cards say which ones a trend fits.</p>
        <div className="td-chips" role="group" aria-label="Channels">{channels.map((channel) => { const on = picked.includes(channel.id); return <button type="button" key={channel.id} className="td-chip" aria-pressed={on} title={channel.name} disabled={!on && picked.length >= FOCUS_MAX} onClick={() => toggle(channel.id)}>{on && <Check size={13} aria-hidden="true" />}{channel.short || channel.name}</button>; })}</div>
        <p className="studio-hint" aria-live="polite">{picked.length ? `${picked.length} of up to ${FOCUS_MAX} chosen.` : 'None chosen: every channel shows the same.'}</p>
        {problem && <p className="studio-error" role="alert">{problem}</p>}
      </div>
      <footer className="studio-dialog-foot">
        {picked.length > 0 && <button type="button" className="studio-quiet" disabled={saving} onClick={() => setPicked([])}>Clear</button>}
        <button type="button" className="studio-quiet" disabled={saving} onClick={onClose}>Cancel</button>
        <button type="submit" className="studio-primary" {...writeProps(viewer, saving || typeof api?.setViewPrefs !== 'function')}>{saving ? <LoaderCircle className="spin" size={15} aria-hidden="true" /> : <Check size={15} aria-hidden="true" />}{saving ? 'Saving…' : 'Save'}</button>
      </footer>
    </form>
  </Dialog>;
}
