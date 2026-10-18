import React, { useEffect, useId, useRef, useState } from 'react';
import { CircleAlert, Clock3, ExternalLink, MessageSquare, RefreshCw, SquareKanban, X } from 'lucide-react';
import { can as canCall, useViewer, writeProps } from './viewer.js';
import './monday.css';

// Monday.com on trend cards and pages (wave 3B; HANDOFF.md → Monday.com). The state comes from state.monday (the main
// process builds it per workspace; channel owners never receive it): { connected, account, link, items: { [cardKey]:
// { itemId, url, state, error?, owner?, date?, notes? } } }. Plain words only; no money is ever involved.
const list = (value) => (Array.isArray(value) ? value : []);
const plural = (count, word, many = `${word}s`) => `${new Intl.NumberFormat().format(Number(count) || 0)} ${Number(count) === 1 ? word : many}`;
export function timeAgo(value, now = Date.now()) {
  const ms = Date.parse(value || ''); if (!Number.isFinite(ms)) return '';
  const minutes = Math.round((now - ms) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60); if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
const shortDay = (value) => { const ms = Date.parse(value || ''); return Number.isFinite(ms) ? new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }) : ''; };
const clock = (value) => { const ms = Date.parse(value || ''); return Number.isFinite(ms) ? new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : ''; };
// Settings → Monday.com, through the #/settings/<section> link the shell already opens in both layouts.
export function openMondaySettings() { if (typeof window !== 'undefined') window.location.hash = '#/settings/monday'; }

// The stage label a synced item shows on Monday.
const labelFor = (monday, stage) => monday?.link?.statusLabels?.[stage] || '';

// One trend's Monday state. `card` gives the key and stage; `compact` drops the words around the chip (Simple cards).
// Editors get Retry on a failed item; anyone who may read research opens the Monday notes.
export function MondayChip({ monday, card, compact = false, api, disabled = false, interactive = true }) {
  const viewer = useViewer();
  const item = monday?.items?.[card?.key];
  const [open, setOpen] = useState(false);
  if (!monday?.link || !item) return null;
  const canSync = canCall(viewer, 'syncTrendBoardToMonday') && typeof api?.syncTrendBoardToMonday === 'function';
  const extras = [item.owner && `Owner: ${item.owner}`, item.date && `Due ${shortDay(item.date)}`].filter(Boolean).join(' · ');
  const notes = Number(item.notes) || 0;
  const retry = async () => { try { await api.syncTrendBoardToMonday({ keys: [card.key], force: true }); } catch (_) { /* the item keeps its error; the log says why */ } };
  let chip;
  if (item.state === 'synced' && item.url) {
    chip = interactive
      ? <a className="md-chip is-synced" href={item.url} target="_blank" rel="noreferrer noopener" title="Open in Monday"><SquareKanban size={12} aria-hidden="true" />{compact ? 'Monday' : `Monday · ${labelFor(monday, card.stage) || 'synced'}`}<ExternalLink size={11} aria-hidden="true" /><span className="md-sr">Open in Monday</span></a>
      : <span className="md-chip is-synced"><SquareKanban size={12} aria-hidden="true" />{compact ? 'On Monday' : `Monday · ${labelFor(monday, card.stage) || 'synced'}`}</span>;
  } else if (item.state === 'synced') chip = <span className="md-chip is-synced"><SquareKanban size={12} aria-hidden="true" />On Monday</span>;
  else if (item.state === 'waiting') chip = <span className="md-chip is-waiting"><Clock3 size={12} aria-hidden="true" />Waiting to send</span>;
  else if (item.state === 'failed') chip = <span className="md-chip is-failed" title={item.error || 'Couldn’t send to Monday.com'}><CircleAlert size={12} aria-hidden="true" />Couldn’t send{interactive && canSync && <button type="button" className="md-chip-action" {...writeProps(viewer, disabled)} onClick={retry}>Retry</button>}</span>;
  else if (item.state === 'removed') chip = <span className="md-chip is-removed">Removed on Monday</span>;
  else if (item.state === 'conflict') chip = <span className="md-chip is-conflict" title={item.error || 'Someone keeps changing this trend on Monday; press Sync now to send the studio’s stage again.'}><CircleAlert size={12} aria-hidden="true" />Changed on Monday</span>;
  else return null;
  return <span className={`md-chip-row${compact ? ' is-compact' : ''}`}>
    {chip}
    {!compact && extras && <span className="md-extra">{extras}</span>}
    {notes > 0 && interactive && typeof api?.readMondayItem === 'function' && <button type="button" className="md-notes-button" aria-expanded={open} onClick={() => setOpen((value) => !value)}><MessageSquare size={12} aria-hidden="true" />{plural(notes, 'Monday note')}</button>}
    {open && <MondayNotes api={api} cardKey={card.key} onClose={() => setOpen(false)} />}
  </span>;
}

// The comments people left on the item on Monday (plain text, never instructions), loaded when opened.
function MondayNotes({ api, cardKey, onClose }) {
  const [item, setItem] = useState(null); const [error, setError] = useState('');
  const titleId = useId(); const ref = useRef(null);
  useEffect(() => { let live = true; api.readMondayItem({ key: cardKey }).then((value) => { if (live) setItem(value || { notes: [] }); }, (err) => { if (live) setError(err?.message || 'The notes couldn’t be loaded.'); }); return () => { live = false; }; }, [api, cardKey]);
  useEffect(() => { const onKey = (event) => { if (event.key === 'Escape') onClose(); }; window.addEventListener('keydown', onKey); ref.current?.focus(); return () => window.removeEventListener('keydown', onKey); }, [onClose]);
  return <div className="md-notes" role="dialog" aria-labelledby={titleId} tabIndex={-1} ref={ref}>
    <header><strong id={titleId}>Notes from Monday.com</strong><button type="button" className="md-icon" aria-label="Close" onClick={onClose}><X size={14} aria-hidden="true" /></button></header>
    {error ? <p className="md-muted">{error}</p> : !item ? <p className="md-muted">Loading…</p> : !list(item.notes).length ? <p className="md-muted">No notes yet.</p>
      : <ul>{list(item.notes).slice().reverse().map((note, index) => <li key={index}><strong>{note.by}</strong><span className="md-muted"> · {timeAgo(note.at)}</span><p>{note.text}</p></li>)}</ul>}
    {item?.url && <a href={item.url} target="_blank" rel="noreferrer noopener">Open in Monday<ExternalLink size={11} aria-hidden="true" /></a>}
  </div>;
}

// The page-header line beside Find new trends. Admins without a board get Connect or Choose a board; editors without one
// see nothing; channel owners never get here (state.monday isn't in their state).
export function MondayStatusLine({ monday, api, compact = false, canSetup = false, disabled = false }) {
  const viewer = useViewer();
  const [showLog, setShowLog] = useState(false);
  const [note, setNote] = useState('');
  if (!monday) return null;
  const link = monday.link;
  const canSync = canCall(viewer, 'syncTrendBoardToMonday') && typeof api?.syncTrendBoardToMonday === 'function';
  const canLog = canCall(viewer, 'readMondaySyncLog') && typeof api?.readMondaySyncLog === 'function';
  if (!link?.boardId) {
    if (!canSetup) return null;
    return <div className={`md-status${compact ? ' is-compact' : ''}`} data-spot="trends.monday"><button type="button" className="md-quiet" onClick={openMondaySettings}><SquareKanban size={14} aria-hidden="true" />{monday.connected ? 'Choose a Monday board' : 'Connect Monday.com'}</button></div>;
  }
  if (!canSync && !canLog) return null;
  const counts = link.counts || {};
  const sync = async () => {
    setNote('');
    try { const result = await api.syncTrendBoardToMonday({}); setNote(result?.joined ? 'Already syncing.' : 'Syncing with Monday.com…'); }
    catch (error) { setNote(error?.message || 'Monday.com sync didn’t start.'); }
  };
  const words = !link.active ? 'Monday.com sync is off'
    : link.paused ? `Monday.com sync is paused: ${link.paused.message}`
    : link.progress && link.progress.total > 20 ? `Sending ${plural(link.progress.done, 'change')} of ${new Intl.NumberFormat().format(link.progress.total)}…`
    : [`Monday.com${link.lastSentAt ? ` · sent ${timeAgo(link.lastSentAt)}` : ''}`, counts.failed ? `${plural(counts.failed, 'trend')} couldn’t send` : '', counts.conflict ? `${counts.conflict} changed on Monday` : ''].filter(Boolean).join(' · ');
  const attention = Boolean(link.paused || counts.failed || counts.conflict);
  return <div className={`md-status${compact ? ' is-compact' : ''}${attention ? ' is-attention' : ''}`} data-spot="trends.monday">
    <span className="md-status-words" role="status"><SquareKanban size={14} aria-hidden="true" />{words}{note && <span className="md-muted"> · {note}</span>}</span>
    {link.boardUrl && !compact && <a className="md-quiet" href={link.boardUrl} target="_blank" rel="noreferrer noopener">Open board<ExternalLink size={12} aria-hidden="true" /></a>}
    {canSync && link.active && <button type="button" className="md-quiet" {...writeProps(viewer, disabled)} onClick={sync}><RefreshCw size={13} aria-hidden="true" />Sync now</button>}
    {canLog && <button type="button" className="md-quiet" aria-expanded={showLog} onClick={() => setShowLog((value) => !value)}>{showLog ? 'Hide log' : 'See log'}</button>}
    {link.paused && canSetup && <button type="button" className="md-quiet" onClick={openMondaySettings}>Settings</button>}
    {showLog && <div className="md-status-log"><MondaySyncLog api={api} /></div>}
  </div>;
}

const FILTERS = [['all', 'Everything', {}], ['problems', 'Problems', { problemsOnly: true }], ['in', 'From Monday', { direction: 'in' }], ['out', 'To Monday', { direction: 'out' }]];
// The sync log: newest first, 50 at a time, with plain sentences and a link to each item.
export function MondaySyncLog({ api }) {
  const [filter, setFilter] = useState('all');
  const [rows, setRows] = useState([]); const [more, setMore] = useState(false); const [error, setError] = useState(''); const [loading, setLoading] = useState(false);
  const load = async (before = '') => {
    if (typeof api?.readMondaySyncLog !== 'function') return;
    setLoading(true); setError('');
    try {
      const result = await api.readMondaySyncLog({ limit: 50, ...(before ? { before } : {}), ...FILTERS.find(([id]) => id === filter)[2] });
      setRows((current) => (before ? [...current, ...list(result?.rows)] : list(result?.rows))); setMore(Boolean(result?.more));
    } catch (err) { setError(err?.message || 'The log couldn’t be loaded.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [filter]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div className="md-log">
    <div className="md-chips" role="group" aria-label="Show in the sync log">{FILTERS.map(([id, label]) => <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>)}</div>
    {error && <p className="md-muted">{error}</p>}
    {!error && !rows.length && <p className="md-muted">{loading ? 'Loading…' : 'Nothing here yet.'}</p>}
    {rows.length > 0 && <ul className="md-log-rows">{rows.map((row, index) => <li key={`${row.at}-${index}`} className={row.ok === false ? 'is-problem' : ''}><time dateTime={row.at}>{clock(row.at)}<span className="md-muted"> {shortDay(row.at)}</span></time><span>{row.text}</span>{row.url && <a href={row.url} target="_blank" rel="noreferrer noopener">Open item<ExternalLink size={11} aria-hidden="true" /></a>}</li>)}</ul>}
    {more && <button type="button" className="md-quiet" disabled={loading} onClick={() => load(rows.at(-1)?.at || '')}>Load more</button>}
  </div>;
}
