import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Activity, ArrowUp, FileText, Folder, Paperclip, Search, Square, TrendingUp, X } from 'lucide-react';
import { matchSlash } from './ask-slash.js';

// Ask AI's question box: it grows with what is typed (field-sizing where the browser has it, measured otherwise, up to
// 40% of the window), shows what is attached as chips, and has one button that is Send while idle and Stop while an
// answer is being written, at the same size so nothing moves. Typing "/" opens the commands; Enter sends (it queues the
// question while an answer is still coming), Shift+Enter adds a line, ↑ in an empty box edits the last question.
const ICONS = { report: FileText, 'asset-folder': Folder, trend: TrendingUp, run: Activity, note: FileText, queued: ArrowUp };
const supportsFieldSizing = (() => { try { return typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('field-sizing', 'content'); } catch { return false; } })();
const list = (value) => (Array.isArray(value) ? value : []);

// The line under the box. Money only for people who see costs, and only what the studio can stand behind: Codex isn't
// metered, so it shows no amount, and a route without an estimate says how questions are charged instead of guessing.
// estimate: { route, metered, firstUsd, followUpUsd } when the server sends one.
const usd = (value) => `$${value < 0.1 ? value.toFixed(2) : value.toFixed(2)}`;
export function askCostLine({ persisted = false, seesCosts = true, route = '', imagesReady = false, estimate = null } = {}) {
  const saved = persisted ? 'Saved for you only. ' : '';
  const pictures = imagesReady && seesCosts ? ' Pictures cost a few cents each.' : '';
  if (!seesCosts) return `${saved}AI can be mistaken.`;
  const via = estimate?.route || route;
  if (via === 'codex' || estimate?.metered === false) return `${saved}Codex isn’t metered, so the studio can’t show a cost.${pictures} AI can be mistaken.`;
  if (Number.isFinite(estimate?.followUpUsd)) {
    const first = Number.isFinite(estimate.firstUsd) && estimate.firstUsd > estimate.followUpUsd * 1.2 ? ` (${usd(estimate.firstUsd)} for the first in five minutes)` : '';
    return `${saved}About ${usd(estimate.followUpUsd)} a question${first}.${pictures} AI can be mistaken.`;
  }
  return `${saved}Each question is one AI call on the studio’s connection, two when it reads something first.${pictures} AI can be mistaken.`;
}

// Reports, folders and trends this person can attach, from the pushed state, newest first.
export function attachOptionsFrom(state) {
  const studio = state?.contentStudio || {}; const workspaceId = studio.activeWorkspaceId;
  const mine = (row) => !workspaceId || !row?.workspaceId || row.workspaceId === workspaceId;
  const newest = (a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
  const reports = list(studio.assets).filter((asset) => mine(asset) && asset.kind === 'text' && asset.title).sort(newest).map((asset) => ({ kind: 'report', ref: asset.title, id: asset.id }));
  const folders = []; const seen = new Set();
  for (const run of list(studio.contentRuns).filter((row) => mine(row) && row.kit?.sourceTitle).sort(newest)) { if (seen.has(run.kit.sourceTitle)) continue; seen.add(run.kit.sourceTitle); folders.push({ kind: 'asset-folder', ref: run.kit.sourceTitle, id: run.kit.sourceKey || run.id }); }
  const trends = []; const named = new Set();
  for (const run of list(studio.researchRuns).filter(mine).sort(newest)) {
    for (const theme of [...list(run.discoveredThemes), ...list(run.themes)]) { const name = String(theme?.name || '').trim(); if (!name || named.has(name.toLowerCase())) continue; named.add(name.toLowerCase()); trends.push({ kind: 'trend', ref: name, id: theme.id || name }); }
  }
  const unique = (rows) => { const keys = new Set(); return rows.filter((row) => { const key = row.ref.toLowerCase(); if (keys.has(key)) return false; keys.add(key); return true; }); };
  return { report: unique(reports).slice(0, 60), 'asset-folder': folders.slice(0, 40), trend: trends.slice(0, 60) };
}
const GROUPS = [['report', 'Reports'], ['asset-folder', 'Folders'], ['trend', 'Trends']];

// A popover to pick a report, folder or trend to attach. `only` limits it to one kind (/report, /trend); `query` starts
// the search. Esc closes it and returns focus to the attach button.
export function AskAttachPicker({ options, only = '', query: initial = '', onPick, onClose }) {
  const [query, setQuery] = useState(initial);
  const boxRef = useRef(null); const searchRef = useRef(null);
  const headingId = useId();
  useEffect(() => { searchRef.current?.focus(); }, []);
  useEffect(() => {
    const away = (event) => { if (!boxRef.current?.contains(event.target)) onClose(); };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [onClose]);
  const want = query.trim().toLowerCase();
  const groups = GROUPS.filter(([kind]) => !only || kind === only).map(([kind, label]) => [kind, label, list(options?.[kind]).filter((row) => !want || row.ref.toLowerCase().includes(want)).slice(0, 8)]).filter(([, , rows]) => rows.length);
  function keys(event) {
    const items = [...(boxRef.current?.querySelectorAll('[data-pick]') || [])]; const at = items.indexOf(document.activeElement);
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(true); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); items[Math.min(items.length - 1, at + 1)]?.focus(); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); if (at <= 0) searchRef.current?.focus(); else items[at - 1]?.focus(); }
  }
  return <div ref={boxRef} className="ask-picker" role="dialog" aria-labelledby={headingId} onKeyDown={keys}>
    <p id={headingId} className="ask-picker-title">{only === 'trend' ? 'Ask about a trend' : only === 'report' ? 'Ask about a report' : 'Attach to your question'}</p>
    <label className="ask-picker-search"><Search size={13} aria-hidden="true" /><input ref={searchRef} type="search" aria-label="Search reports, folders and trends" placeholder="Search" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
    <div className="ask-picker-list">
      {groups.length ? groups.map(([kind, label, rows]) => { const Icon = ICONS[kind]; return <section key={kind} aria-label={label}>
        <h4>{label}</h4>
        {rows.map((row) => <button type="button" data-pick key={`${kind}:${row.id || row.ref}`} onClick={() => onPick(row)}><Icon size={13} aria-hidden="true" /><span>{row.ref}</span></button>)}
      </section>; }) : <p className="ask-picker-empty">{want ? `Nothing matches “${query.trim()}”.` : 'Nothing to attach yet. Reports, folders and trends appear here once research has run.'}</p>}
    </div>
  </div>;
}

// The / commands menu: a listbox the box keeps focus in (aria-activedescendant), filtered as they type.
function AskSlashMenu({ id, items, active, onPick, onHover }) {
  return <div className="ask-slash" role="listbox" id={id} aria-label="Commands">
    {items.map((item, index) => <div key={item.id} id={`${id}-${item.id}`} role="option" aria-selected={index === active} className={index === active ? 'is-active' : ''} onMouseDown={(event) => { event.preventDefault(); onPick(item); }} onMouseEnter={() => onHover(index)}>
      <code>{item.usage}</code><span>{item.label}</span>{item.hint && <small>{item.hint}</small>}
    </div>)}
  </div>;
}

// chips: [{ key, kind, label, title?, onRemove }]. queued: the question waiting for the answer to finish, or ''.
export function AskComposer({ inputRef, value, onChange, onSubmit, onStop, running = false, stopping = false, canStop = false, sendDisabled = false, sendTitle, placeholder, label = 'Question about Scraper Studio', chips = [], queued = '', onCancelQueued, slash = [], onSlash, attachOptions = null, picker = null, onPicker, onAttach, onArrowUp, compact = false, foot = '', spot }) {
  const listId = useId();
  const [active, setActive] = useState(0);
  const [closedFor, setClosedFor] = useState(null); // Esc closes the menu until the text changes
  const attachRef = useRef(null);
  const matches = closedFor === value ? null : matchSlash(value, slash);
  const menuOpen = Boolean(matches?.length);
  useEffect(() => { setActive(0); }, [value]);
  useLayoutEffect(() => {
    const box = inputRef?.current; if (!box || supportsFieldSizing) return;
    box.style.height = 'auto';
    const max = Math.max(96, Math.round((typeof window !== 'undefined' ? window.innerHeight : 800) * 0.4));
    const height = box.scrollHeight || 0;
    if (height) { box.style.height = `${Math.min(max, height)}px`; box.style.overflowY = height > max ? 'auto' : 'hidden'; }
  }, [value, inputRef]);
  function keys(event) {
    if (event.nativeEvent?.isComposing) return;
    if (menuOpen) {
      if (event.key === 'ArrowDown') { event.preventDefault(); setActive((index) => (index + 1) % matches.length); return; }
      if (event.key === 'ArrowUp') { event.preventDefault(); setActive((index) => (index - 1 + matches.length) % matches.length); return; }
      if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') { event.preventDefault(); onSlash?.(matches[Math.min(active, matches.length - 1)], { picked: true }); return; }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setClosedFor(value); return; }
    }
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); onSubmit(); return; }
    if (event.key === 'ArrowUp' && !value && onArrowUp) { event.preventDefault(); onArrowUp(); }
  }
  const closePicker = (refocus) => { onPicker?.(null); if (refocus) requestAnimationFrame(() => attachRef.current?.focus()); };
  const shownChips = chips.slice(0, 4);
  return <><form className={`help-composer ask-composer${compact ? ' is-compact' : ''}${running ? ' is-running' : ''}`} data-spot={spot} onSubmit={(event) => { event.preventDefault(); if (running) return; onSubmit(); }}>
    {(shownChips.length > 0 || queued) && <div className="ask-chips" role="group" aria-label="With your question">
      {shownChips.map((chip) => { const Icon = ICONS[chip.kind] || FileText; return <span key={chip.key} className="ask-chip" title={chip.title || chip.label}>
        <Icon size={12} aria-hidden="true" /><span>{chip.label}</span>
        {chip.onRemove && <button type="button" aria-label={`Remove ${chip.label}`} onClick={chip.onRemove}><X size={12} aria-hidden="true" /></button>}
      </span>; })}
      {queued && <span className="ask-chip is-queued" title={queued}><ArrowUp size={12} aria-hidden="true" /><span>Sends when this answer is done</span>{onCancelQueued && <button type="button" aria-label="Don’t send the waiting question" onClick={onCancelQueued}><X size={12} aria-hidden="true" /></button>}</span>}
    </div>}
    <div className="ask-composer-row">
      {onAttach && attachOptions && <button ref={attachRef} type="button" className="ask-attach" aria-label="Attach a report, folder or trend" aria-haspopup="dialog" aria-expanded={Boolean(picker)} title="Attach a report, folder or trend" onClick={() => onPicker?.(picker ? null : { only: '', query: '' })}><Paperclip size={15} aria-hidden="true" /></button>}
      <textarea ref={inputRef} rows={1} value={value} aria-label={label} placeholder={placeholder} aria-autocomplete="list" aria-controls={menuOpen ? listId : undefined} aria-activedescendant={menuOpen ? `${listId}-${matches[Math.min(active, matches.length - 1)].id}` : undefined}
        onChange={(event) => onChange(event.target.value)} onKeyDown={keys} />
      <button type={running ? 'button' : 'submit'} className="ask-send" data-state={running ? 'stop' : 'send'} aria-label={running ? 'Stop answering' : 'Send question'} title={running ? (stopping ? 'Stopping…' : 'Stop (Esc)') : sendTitle || 'Send (Enter)'}
        disabled={running ? !canStop || stopping : sendDisabled || !value.trim()} onClick={running ? onStop : undefined}>
        {running ? <Square size={11} fill="currentColor" aria-hidden="true" /> : <ArrowUp size={16} aria-hidden="true" />}
      </button>
    </div>
    {menuOpen && <AskSlashMenu id={listId} items={matches} active={Math.min(active, matches.length - 1)} onHover={setActive} onPick={(item) => onSlash?.(item, { picked: true })} />}
    {picker && attachOptions && <AskAttachPicker options={attachOptions} only={picker.only} query={picker.query} onClose={closePicker} onPick={(row) => { onAttach(row); closePicker(true); }} />}
  </form>
  {!compact && <p className="ask-hint" aria-hidden="true">Enter to send · Shift+Enter for a new line · / for commands</p>}
  {foot && <p className="help-foot">{foot}</p>}
  </>;
}
