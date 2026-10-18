import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Activity, ArrowRight, Brain, Check, CircleAlert, CircleStop, Download, Ellipsis, FileText, FolderOpen, History, Image as ImageIcon, LayoutGrid, LoaderCircle, MessagesSquare, MousePointerClick, Pencil, Pin, PinOff, Plus, Radar, RefreshCw, RotateCcw, ScrollText, Search, Sparkles, Trash2, TrendingUp, X } from 'lucide-react';
import { BUTTON, CARD_TYPES, ChatCards, MemoryCard, ReplyCard, actionIcon, cardActionIndexes, isQuietAction, primaryCard, primaryPicker } from './chat-cards.jsx';
import { useConfirm } from './confirm-dialog.jsx';
import { aiActionAllowed } from './studio-actions.js';
import { PREVIEW_TITLE, formatDay, formatTime, useCan, useViewer, writeProps } from './viewer.js';
import { firstSentence, studioLinks } from './ask-markdown.js';
import { createAskStreamStore, isFinal, usePrefersReducedMotion } from './ask-stream.js';
import { AskThread } from './ask-thread.jsx';
import { AskComposer, askCostLine, attachOptionsFrom } from './ask-composer.jsx';
import { REF_LABEL, SLASH_COMMANDS, currentStudioDrag, dragHasFiles, dragHasStudioRef, parseSlash, readStudioRef, slashAction, slashCommandsFor } from './ask-slash.js';
import { DEFAULT_STARTERS, smartStarters } from './ask-starters.js';
import './help-assistant.css';
import './ask-chat.css';
import './ask-reply.css';

export { studioLinks };

// "Ask AI": questions about the app and the person's studio, answered from the app guide and live state, with buttons
// for work it can do (nothing runs until the person clicks and confirms), cards built from real studio data, "Show me"
// tours and pictures on request. Conversations are saved on the server, per person (listAskConversations and friends),
// so a thread survives a reload, a layout switch and a role change; Ask AI also keeps a small long-term memory the
// person can read, pin, edit and forget. Against an older server (no conversation methods) it keeps the thread in the
// page and sends the history itself, as before.
//
// Answers stream: each question is a request (requestId) the main process reports on as it works (api.onAskStream,
// ask-stream.js), and its answer is written into the thread as it arrives (ask-thread.jsx). The reply from askHelp and
// the stream's "done" both finish the same turn in place, whichever comes first. Stop, Retry, Edit of the last question,
// / commands, dropped reports and two questions at once (in two conversations) all live here; the thread, the steps
// line and the question box are their own files.
const STARTERS = DEFAULT_STARTERS;
const ratio = (size) => String(size || '1536x1024').replace('x', ' / ');
const list = (value) => (Array.isArray(value) ? value : []);
const money = (value) => (Number.isFinite(value) ? `$${value < 0.01 ? value.toFixed(3) : value.toFixed(2)}` : '');
const errorText = (failure) => String(failure?.message || failure || 'Something went wrong. Try again.');
const clip = (value, max = 60) => { const text = String(value || '').trim(); return text.length > max ? `${text.slice(0, max - 1)}…` : text; };
// The server registers each question as job "help-<requestId>", so Stop can cancel it; ids are uuids (job ids allow [a-z0-9-]).
const newRequestId = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`);
const nowMs = () => (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now());
const isLocal = (id) => !id || String(id).startsWith('local-');
const rowsOf = (result) => list(Array.isArray(result) ? result : result?.conversations).filter((row) => row?.id);
const memoryOf = (result) => list(Array.isArray(result) ? result : result?.items).filter((row) => row?.id && row.status !== 'forgotten');
const savedOf = (result) => (result?.item?.id ? result.item : result?.id ? result : null);
const byPinThenNewest = (a, b) => (Number(Boolean(b.pinned)) - Number(Boolean(a.pinned))) || String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
const when = (value) => { const date = new Date(value || 0); if (!value || Number.isNaN(date.getTime())) return ''; return date.toDateString() === new Date().toDateString() ? formatTime(value) : formatDay(value); };
// A call that never reached the server's answer (the connection dropped, a proxy cut a long call): the answer may still
// be coming, so the panel keeps following it rather than calling it failed.
const dropped = (failure) => [0, 502, 504, 524].includes(Number(failure?.status));
const isField = (target) => Boolean(target?.closest?.('input, textarea, select, [contenteditable="true"], [role="textbox"]'));
// Which conversation was open, per person, for this window's session: a layout switch or reload reopens it.
const threadKey = (identity) => `ask.thread.${identity}`;
function readThread(identity) { try { return sessionStorage.getItem(threadKey(identity)) || ''; } catch { return ''; } }
function keepThread(identity, id) { try { if (id) sessionStorage.setItem(threadKey(identity), id); else sessionStorage.removeItem(threadKey(identity)); } catch { /* a convenience only */ } }
// When this browser last looked at each conversation, so one the studio posted a follow-up into (row.lastFollowUpAt)
// stays marked after a reload. A per-browser convenience: without storage, only this session's marks show.
const seenKey = (identity) => `ask.seenFollowUps.${identity}`;
function readSeen(identity) { try { const value = JSON.parse(localStorage.getItem(seenKey(identity)) || 'null'); if (value && typeof value === 'object') return value; } catch { /* starts fresh */ } return { _since: new Date().toISOString() }; }
function keepSeen(identity, seen) { try { const ids = Object.keys(seen).filter((key) => key !== '_since').slice(-200); localStorage.setItem(seenKey(identity), JSON.stringify(Object.fromEntries([['_since', seen._since], ...ids.map((key) => [key, seen[key]])]))); } catch { /* a convenience only */ } }
function useMedia(query) {
  const [match, setMatch] = useState(() => { try { return Boolean(window.matchMedia?.(query).matches); } catch { return false; } });
  useEffect(() => {
    let media = null; try { media = window.matchMedia?.(query) || null; } catch { media = null; }
    if (!media) return undefined;
    const update = () => setMatch(media.matches); update();
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, [query]);
  return match;
}

// A stored or fresh picture request. Fresh ones are drawn now; a stored one with an imageId is read back; a stored one
// without (the app closed while drawing) offers Try again rather than paying for it unasked.
function imageFrom(image, { stored = false } = {}) {
  if (!image || typeof image !== 'object' || (!image.prompt && !image.imageId)) return null;
  // family: which brand reference set goes with the picture (Ask AI chooses it; 'none' sends no reference images).
  const base = { title: image.title || 'Ask AI picture', prompt: image.prompt || '', size: image.size || '1536x1024', family: image.family || 'none' };
  const imageId = image.imageId || '';
  if (imageId) return { ...base, id: imageId, imageId, status: image.dataUrl ? 'ready' : 'loading', dataUrl: image.dataUrl || '', costUsd: image.costUsd ?? null };
  return stored ? { ...base, status: 'failed', error: image.error || 'It wasn’t finished.' } : { ...base, status: 'creating' };
}
function assistantFrom(message = {}, options = {}) {
  return {
    id: message.id, role: 'assistant', content: String(message.content ?? message.answer ?? ''), pages: list(message.pages), followUps: list(message.followUps).filter(Boolean), actions: list(message.actions),
    receipt: message.receipt || null, read: list(message.read), show: message.show?.steps?.length ? message.show : null, image: imageFrom(message.image, options), cards: list(message.cards),
    remembered: list(message.remembered).filter((row) => row?.id && row.text), createdAt: message.createdAt || '',
    ...(message.stopped ? { stopped: true } : {}), ...(list(message.versions).length ? { versions: list(message.versions) } : {}), ...(message.followUp ? { followUp: message.followUp } : {}),
  };
}
// A stored conversation as the panel shows it, plus the outcomes recorded for its buttons. A plan step that was skipped
// was recorded as cancelled with its words; a plain "no" (cancelled, no words) brings the button back.
function threadFrom(messages) {
  const states = {};
  const rows = list(messages).map((message) => {
    if (message?.role === 'user') return { id: message.id, role: 'user', content: String(message.content || ''), context: String(message.context || ''), attachments: list(message.attachments), createdAt: message.createdAt || '', ...(message.editedAt ? { editedAt: message.editedAt } : {}) };
    list(message?.actions).forEach((action, index) => {
      const outcome = action?.outcome || message?.outcomes?.[index];
      if (outcome && ['done', 'failed'].includes(outcome.status)) states[`${message.id}:${index}`] = { status: outcome.status, text: outcome.text || (outcome.status === 'done' ? 'Done.' : 'That didn’t work.'), ...(outcome.runId ? { runId: outcome.runId } : {}) };
      else if (outcome?.status === 'cancelled' && outcome.text) states[`${message.id}:${index}`] = { status: 'cancelled', text: outcome.text };
    });
    return assistantFrom(message, { stored: true });
  }).filter((row) => row.id);
  return { rows, states };
}
// What an older server needs: the conversation so far, with picture prompts so "make it bluer" can revise them.
const legacyHistory = (messages) => messages.flatMap(({ role, content, image, context: earlier }) => [...(earlier ? [{ role: 'user', content: earlier }] : []), { role, content: image?.prompt ? `${content}\n[Picture created from this prompt: ${image.prompt}]` : content }]);
// Rows that are part of the conversation (not an answer still coming, or one that failed and was never saved).
const settledRow = (message) => !message.pending && !message.failed;

// What needs this person now, from the pushed state and the board's rules, as free one-click starters (no AI call):
// trends waiting for an OK, an asset set that needs another try, a run that didn't finish. Each is a button the
// shared runner takes, so it is gated and confirmed like any other. Opening Trends needs no method, so the trends row
// asks `can` for Approve trends itself.
export function attentionStarters(state, can = () => true) {
  const studio = state?.contentStudio || {}; const workspaceId = studio.activeWorkspaceId;
  const mine = (row) => !workspaceId || !row.workspaceId || row.workspaceId === workspaceId;
  const research = list(studio.researchRuns).filter(mine); const content = list(studio.contentRuns).filter(mine);
  const themesOf = (run) => (list(run.discoveredThemes).length ? run.discoveredThemes : list(run.themes));
  const out = [];
  const waiting = research.filter((run) => run.status === 'awaiting-review' && run.origin !== 'quick-scan').reduce((sum, run) => sum + themesOf(run).filter((theme) => !run.decisions?.[theme.id]).length, 0);
  if (waiting && can('decideResearchTheme')) out.push({ label: `Review ${waiting} ${waiting === 1 ? 'trend' : 'trends'} waiting for your OK`, request: { kind: 'open-tab', label: 'Open Trends', target: 'trends' } });
  const seen = new Set();
  for (const run of [...content].filter((row) => row.kit).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))) {
    if (seen.has(run.kit.sourceKey)) continue; seen.add(run.kit.sourceKey);
    const left = list(run.jobs).filter((job) => job.status !== 'succeeded').length;
    if (['partial', 'failed'].includes(run.status) && left) { out.push({ label: `${left} ${left === 1 ? 'asset' : 'assets'} in “${run.kit.sourceTitle}” need another try`, request: { kind: 'finish-assets', label: 'Finish them', target: run.kit.sourceTitle, folderKey: run.kit.sourceKey } }); break; }
  }
  const week = Date.now() - 7 * 86400000;
  const failed = [...research, ...content.filter((row) => !row.kit)].filter((row) => ['failed', 'partial'].includes(row.status) && Date.parse(row.updatedAt || row.createdAt || '') >= week).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0];
  if (failed) out.push({ label: `“${failed.title}” didn’t finish. Try it again`, request: { kind: 'retry-run', label: 'Try again', target: failed.title, runId: failed.id } });
  return out.slice(0, 3);
}

// What a picture sent besides its prompt: " · 2 style examples and the logo from Semrush campaign graphics" ('' for none).
function referencesLine(image) {
  const refs = image?.references; if (!refs || (!refs.style && !refs.logo)) return '';
  const parts = [refs.style ? `${refs.style} style example${refs.style === 1 ? '' : 's'}` : '', refs.logo ? 'the logo' : ''].filter(Boolean).join(' and ');
  return ` · ${parts}${refs.label ? ` from ${refs.label}` : ''}`;
}

// A picture made in the chat, in the same card shell as every other card: a sized placeholder while it's drawn, then the
// picture (click to enlarge), what it cost and Download.
// The drawer's left edge: drag (or arrow keys) to widen it; double-click resets. The width is remembered per browser.
const DRAWER_KEY = 'studio.ask.drawerWidth';
const DRAWER_DEFAULT = 440; const DRAWER_MIN = 360; const DRAWER_MAX = 900;
const clampDrawer = (value) => Math.round(Math.max(DRAWER_MIN, Math.min(value, DRAWER_MAX, (typeof window !== 'undefined' ? window.innerWidth : 1440) - 320)));
function readDrawerWidth() { try { const saved = Number(window.localStorage.getItem(DRAWER_KEY)); return saved ? clampDrawer(saved) : DRAWER_DEFAULT; } catch { return DRAWER_DEFAULT; } }
function saveDrawerWidth(value) { try { window.localStorage.setItem(DRAWER_KEY, String(value)); } catch { /* a blocked store just forgets */ } }
function DrawerResizer({ width, onWidth }) {
  const start = (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget; handle.setPointerCapture?.(event.pointerId);
    document.body.classList.add('is-resizing-drawer');
    let last = width;
    const move = (moved) => { last = clampDrawer(window.innerWidth - moved.clientX); onWidth(last); };
    const end = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', end); handle.removeEventListener('pointercancel', end); document.body.classList.remove('is-resizing-drawer'); saveDrawerWidth(last); };
    handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end);
  };
  const key = (event) => {
    const step = event.shiftKey ? 80 : 24;
    const next = event.key === 'ArrowLeft' ? width + step : event.key === 'ArrowRight' ? width - step : event.key === 'Home' ? DRAWER_MIN : event.key === 'End' ? DRAWER_MAX : null;
    if (next == null) return;
    event.preventDefault(); const value = clampDrawer(next); onWidth(value); saveDrawerWidth(value);
  };
  return <div className="help-resizer" role="separator" aria-orientation="vertical" aria-label="Resize Ask AI" aria-valuemin={DRAWER_MIN} aria-valuemax={DRAWER_MAX} aria-valuenow={width} tabIndex={0}
    title="Drag to resize · double-click to reset" onPointerDown={start} onKeyDown={key} onDoubleClick={() => { onWidth(DRAWER_DEFAULT); saveDrawerWidth(DRAWER_DEFAULT); }}>
    <span className="help-resizer-grip" aria-hidden="true" />
  </div>;
}

function Picture({ image, onRetry, onDownload, onEnlarge, onOpenAssets }) {
  const pending = image.status === 'creating' || image.status === 'loading';
  return <ReplyCard type="picture" kicker="Picture" title={image.title} icon={ImageIcon}>
    {pending ? <div className="reply-picture-pending" style={{ aspectRatio: ratio(image.size) }} role="status"><LoaderCircle className="spin" size={18} aria-hidden="true" /><span>{image.status === 'creating' ? 'Creating the picture… usually under a minute' : 'Loading the picture…'}</span></div>
      : image.status === 'failed' ? <>
        <p className="reply-failed" role="alert">The picture wasn't created. {image.error}</p>
        {onRetry && <div className="reply-card-foot"><button type="button" className={BUTTON.quiet} onClick={onRetry}><RefreshCw size={14} aria-hidden="true" />Try again</button></div>}
      </> : <>
        <button type="button" className="reply-picture-frame" onClick={onEnlarge} aria-label={`Enlarge ${image.title}`}><img src={image.dataUrl} alt={image.title} style={{ aspectRatio: ratio(image.size) }} /></button>
        {(image.costUsd != null || onOpenAssets) && <small className="reply-muted help-receipt">{image.costUsd != null ? `${image.provider === 'fal' ? 'fal.ai' : 'OpenAI'} image · ${money(image.costUsd)}${referencesLine(image)}` : ''}{onOpenAssets && <>{image.costUsd != null ? ' · ' : ''}Saved to <button type="button" className="help-inline-link" onClick={onOpenAssets}>Assets</button></>}</small>}
        {image.family && image.family !== 'none' && image.references && !image.references.style && !image.references.logo && <small className="reply-muted help-receipt">No reference images in {image.references.label || 'this set'} yet, so this picture follows the brand colors only. Reference images in Settings → Brand reference images make pictures match the brand.</small>}
        <div className="reply-card-foot"><button type="button" className={BUTTON.quiet} onClick={onDownload}><Download size={14} aria-hidden="true" />Download</button></div>
      </>}
  </ReplyCard>;
}
// The kind of studio item a reference chip opens (studio: links in the answer, Open buttons for one item, and pages).
const REF_ICONS = { report: FileText, trend: TrendingUp, folder: FolderOpen, run: Activity, program: Radar, prompt: ScrollText, page: LayoutGrid };
// A reference chip names the item ("Open “Zero-click report”" shows as Zero-click report): its arrow says Open, and the
// button's full words stay its accessible name.
function refName(label) {
  const name = String(label || '').trim().replace(/^open\s+/i, '').replace(/^[“"](.+)[”"]$/, '$1').trim();
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : String(label || '');
}

// The ⋯ menu on a conversation: pin, rename, delete. Arrow keys move, Esc closes and returns to the button.
function RowMenu({ title, pinned, open, onOpenChange, onPin, onRename, onDelete, deleteDisabled = false }) {
  const id = useId(); const buttonRef = useRef(null); const menuRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    menuRef.current?.querySelector('[role="menuitem"]')?.focus();
    const away = (event) => { if (!menuRef.current?.contains(event.target) && !buttonRef.current?.contains(event.target)) onOpenChange(false); };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);
  function keys(event) {
    const items = [...(menuRef.current?.querySelectorAll('[role="menuitem"]:not(:disabled)') || [])]; const at = items.indexOf(document.activeElement);
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onOpenChange(false); buttonRef.current?.focus(); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); items[(at + 1) % items.length]?.focus(); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); items[(at - 1 + items.length) % items.length]?.focus(); }
    else if (event.key === 'Tab') onOpenChange(false);
  }
  const pick = (work) => () => { onOpenChange(false); buttonRef.current?.focus(); work(); };
  return <div className="help-menu-wrap">
    <button ref={buttonRef} type="button" className="help-icon help-row-menu" aria-label={`Options for “${clip(title)}”`} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => onOpenChange(!open)}><Ellipsis size={15} aria-hidden="true" /></button>
    {open && <div ref={menuRef} id={id} className="help-menu" role="menu" aria-label={`Options for “${clip(title)}”`} onKeyDown={keys}>
      <button type="button" role="menuitem" onClick={pick(onPin)}>{pinned ? <PinOff size={14} aria-hidden="true" /> : <Pin size={14} aria-hidden="true" />}{pinned ? 'Unpin' : 'Pin to top'}</button>
      <button type="button" role="menuitem" onClick={pick(onRename)}><Pencil size={14} aria-hidden="true" />Rename</button>
      <button type="button" role="menuitem" className="is-danger" disabled={deleteDisabled} title={deleteDisabled ? 'Wait for the answer, or stop it' : undefined} onClick={pick(onDelete)}><Trash2 size={14} aria-hidden="true" />Delete</button>
    </div>}
  </div>;
}

// Saved conversations: New conversation, search, pinned first then newest, and each one's ⋯ menu. A conversation with an
// answer being written says "Answering…" (and can't be deleted until it's done); one that got an answer while it wasn't
// open is bold until opened. `pendingRows` are new conversations whose first answer is still coming.
function ConversationList({ rows, pendingRows = [], status, error, note, activeId, answering, unread, canWrite, onOpen, onOpenPending, onNew, onRename, onPin, onDelete, onRetry }) {
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState('');
  const [renaming, setRenaming] = useState('');
  const [title, setTitle] = useState('');
  const want = query.trim().toLowerCase();
  const shown = rows.filter((row) => !want || `${row.title || ''} ${row.preview || ''}`.toLowerCase().includes(want));
  const pinned = shown.filter((row) => row.pinned); const recent = shown.filter((row) => !row.pinned);
  function commit(row) { const next = title.trim(); setRenaming(''); if (next && next !== row.title) onRename(row, next); }
  const line = (row) => (answering.has(row.id) ? <small className="is-answering"><span className="ask-live-dot" aria-hidden="true" />Answering…</small> : <small>{[when(row.updatedAt), row.preview].filter(Boolean).join(' · ')}</small>);
  const group = (label, items) => items.length > 0 && <section className="help-history-group" aria-label={label || 'Conversations'}>
    {label && <h3>{label}</h3>}
    <ul>{items.map((row) => <li key={row.id} className={`help-history-row${row.id === activeId ? ' is-active' : ''}${unread.has(row.id) ? ' is-unread' : ''}`}>
      {renaming === row.id
        ? <form className="help-rename" onSubmit={(event) => { event.preventDefault(); commit(row); }}><input aria-label="Conversation name" value={title} maxLength={80} autoFocus onChange={(event) => setTitle(event.target.value)} onBlur={() => commit(row)} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setRenaming(''); } }} /></form>
        : <button type="button" className="help-history-open" aria-current={row.id === activeId ? 'true' : undefined} aria-label={unread.has(row.id) ? `${row.title || 'Untitled conversation'}, new answer` : undefined} onClick={() => onOpen(row)}>
          <span className="help-history-title">{row.pinned && <Pin size={11} aria-label="Pinned" />}{row.title || 'Untitled conversation'}</span>
          {line(row)}
        </button>}
      {canWrite && renaming !== row.id && <RowMenu title={row.title || 'Untitled conversation'} pinned={Boolean(row.pinned)} open={menu === row.id} deleteDisabled={answering.has(row.id)} onOpenChange={(next) => setMenu(next ? row.id : '')} onPin={() => onPin(row)} onRename={() => { setTitle(row.title || ''); setRenaming(row.id); }} onDelete={() => onDelete(row)} />}
    </li>)}</ul>
  </section>;
  return <div className="help-history">
    <div className="help-history-tools">
      <button type="button" className="help-new" onClick={onNew}><Plus size={14} aria-hidden="true" />New conversation</button>
      <label className="help-search"><Search size={14} aria-hidden="true" /><input type="search" aria-label="Search conversations" placeholder="Search conversations" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
    </div>
    <div className="help-history-list">
      {pendingRows.length > 0 && !want && <section className="help-history-group" aria-label="Being answered"><ul>{pendingRows.map((row) => <li key={row.id} className={`help-history-row${row.active ? ' is-active' : ''}`}>
        <button type="button" className="help-history-open" aria-current={row.active ? 'true' : undefined} onClick={() => onOpenPending(row)}><span className="help-history-title">{row.title || 'New conversation'}</span><small className="is-answering"><span className="ask-live-dot" aria-hidden="true" />Answering…</small></button>
      </li>)}</ul></section>}
      {status === 'loading' && !rows.length ? <p className="help-history-note" role="status"><LoaderCircle className="spin" size={13} aria-hidden="true" />Loading conversations…</p>
        : status === 'error' && !rows.length ? <div className="help-history-note" role="alert"><span>Conversations couldn’t be loaded. {error}</span><button type="button" className="help-text-button" onClick={onRetry}>Try again</button></div>
        : !rows.length ? (!pendingRows.length && <p className="help-history-note">No conversations yet. What you ask is saved here, for you only.</p>)
        : !shown.length ? <p className="help-history-note">No conversations match “{query.trim()}”.</p>
        : <>{group(pinned.length ? 'Pinned' : '', pinned)}{group(pinned.length ? 'Recent' : '', recent)}</>}
    </div>
    {note && <p className="help-history-note" role="status">{note}</p>}
  </div>;
}

// What Ask AI remembers about this person and this workspace: pin, edit, forget, or add something.
const KIND_LABEL = { preference: 'Preference', fact: 'Fact', decision: 'Decision', goal: 'Goal' };
function MemoryPanel({ api, workspaceId, onClose }) {
  const can = useCan(); const viewer = useViewer();
  const headingId = useId();
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [editing, setEditing] = useState('');
  const [editText, setEditText] = useState('');
  const [draft, setDraft] = useState('');
  const [scope, setScope] = useState('me');
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const canSave = typeof api.saveAskMemory === 'function' && can('saveAskMemory');
  const canForget = typeof api.forgetAskMemory === 'function' && can('forgetAskMemory');
  async function load() {
    setStatus('loading'); setError('');
    try { setItems(memoryOf(await api.listAskMemory({ workspaceId: workspaceId || '' }))); setStatus('ready'); }
    catch (failure) { setError(errorText(failure)); setStatus('error'); }
  }
  useEffect(() => { load(); }, [workspaceId]);
  const merge = (row) => setItems((current) => (current.some((item) => item.id === row.id) ? current.map((item) => (item.id === row.id ? { ...item, ...row } : item)) : [row, ...current]));
  async function save(item, patch) {
    setBusy(item.id); setNote('');
    try { merge(savedOf(await api.saveAskMemory({ id: item.id, ...patch })) || { ...item, ...patch }); if (patch.text != null) setEditing(''); }
    catch (failure) { setNote(errorText(failure)); }
    finally { setBusy(''); }
  }
  async function forget(item) {
    setBusy(item.id); setNote('');
    try { await api.forgetAskMemory({ id: item.id }); setItems((current) => current.filter((row) => row.id !== item.id)); setNote(`Forgot “${clip(item.text)}”.`); }
    catch (failure) { setNote(errorText(failure)); }
    finally { setBusy(''); }
  }
  async function add(event) {
    event.preventDefault();
    const text = draft.trim(); if (!text || busy) return;
    setBusy('new'); setNote('');
    try {
      const saved = savedOf(await api.saveAskMemory({ text, scope, kind: scope === 'me' ? 'preference' : 'fact', workspaceId: scope === 'workspace' ? workspaceId || '' : '' }));
      if (saved) merge(saved); else await load();
      setDraft(''); setNote('Saved. Ask AI uses it from your next question.');
    } catch (failure) { setNote(errorText(failure)); }
    finally { setBusy(''); }
  }
  const groups = [['me', 'About you'], ['workspace', 'This workspace']].map(([id, label]) => [id, label, items.filter((item) => (item.scope || 'me') === id && (id === 'me' || !workspaceId || !item.workspaceId || item.workspaceId === workspaceId)).sort(byPinThenNewest)]);
  return <section className="help-sheet help-memory" aria-labelledby={headingId}>
    <div className="help-sheet-head"><h3 id={headingId}><Brain size={16} aria-hidden="true" />What Ask AI remembers</h3><button type="button" className="help-icon" onClick={onClose} aria-label="Back to the conversation" title="Back (Esc)"><X size={16} aria-hidden="true" /></button></div>
    <p className="help-sheet-intro">Things you said or decided that help later answers: channels you prefer, tone, budget habits, decisions on trends. It never keeps keys or passwords, and only you see it.</p>
    {status === 'loading' ? <p className="help-history-note" role="status"><LoaderCircle className="spin" size={13} aria-hidden="true" />Loading…</p>
      : status === 'error' ? <div className="help-history-note" role="alert"><span>Memory couldn’t be loaded. {error}</span><button type="button" className="help-text-button" onClick={load}>Try again</button></div>
      : groups.map(([id, label, rows]) => <section key={id} className="help-memory-group" aria-label={label}>
        <h4>{label}</h4>
        {!rows.length ? <p className="help-history-note">{id === 'me' ? 'Nothing about you yet.' : 'Nothing about this workspace yet.'}</p>
          : <ul>{rows.map((item) => <li key={item.id} className={item.pinned ? 'is-pinned' : ''}>
            {editing === item.id
              ? <form className="help-memory-edit" onSubmit={(event) => { event.preventDefault(); if (editText.trim()) save(item, { text: editText.trim() }); }}>
                <textarea aria-label="Edit what Ask AI remembers" rows={2} maxLength={280} value={editText} autoFocus onChange={(event) => setEditText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setEditing(''); } }} />
                <div><button type="submit" className="help-chip-button is-primary" disabled={busy === item.id || !editText.trim()}>Save</button><button type="button" className="help-chip-button" onClick={() => setEditing('')}>Cancel</button></div>
              </form>
              : <>
                <p>{item.text}<small>{[KIND_LABEL[item.kind], item.pinned ? 'Pinned' : '', item.updatedAt ? `Updated ${when(item.updatedAt)}` : ''].filter(Boolean).join(' · ')}</small></p>
                <div className="help-memory-tools">
                  {canSave && <button type="button" className="help-icon" {...writeProps(viewer, busy === item.id)} aria-pressed={Boolean(item.pinned)} aria-label={item.pinned ? `Unpin “${clip(item.text)}”` : `Pin “${clip(item.text)}”`} title={item.pinned ? 'Unpin' : 'Pin: always use it'} onClick={() => save(item, { pinned: !item.pinned })}>{item.pinned ? <PinOff size={14} aria-hidden="true" /> : <Pin size={14} aria-hidden="true" />}</button>}
                  {canSave && <button type="button" className="help-icon" {...writeProps(viewer, busy === item.id)} aria-label={`Edit “${clip(item.text)}”`} title="Edit" onClick={() => { setEditText(item.text); setEditing(item.id); }}><Pencil size={14} aria-hidden="true" /></button>}
                  {canForget && <button type="button" className="help-icon" {...writeProps(viewer, busy === item.id)} aria-label={`Forget “${clip(item.text)}”`} title="Forget" onClick={() => forget(item)}><Trash2 size={14} aria-hidden="true" /></button>}
                </div>
              </>}
          </li>)}</ul>}
      </section>)}
    {canSave && status === 'ready' && <form className="help-memory-add" onSubmit={add}>
      <label htmlFor={`${headingId}-add`}>Add something to remember</label>
      <textarea id={`${headingId}-add`} rows={2} maxLength={280} value={draft} placeholder="For example: “Keep LinkedIn posts under 150 words.”" onChange={(event) => setDraft(event.target.value)} />
      <div className="help-memory-add-row">
        <select aria-label="Who it’s about" value={scope} onChange={(event) => setScope(event.target.value)}><option value="me">About you</option><option value="workspace">This workspace</option></select>
        <button type="submit" className="help-chip-button is-primary" {...writeProps(viewer, !draft.trim() || busy === 'new')}>{busy === 'new' ? <LoaderCircle className="spin" size={13} aria-hidden="true" /> : <Plus size={13} aria-hidden="true" />}Remember</button>
      </div>
    </form>}
    {note && <p className="help-history-note" role="status">{note}</p>}
  </section>;
}

// variant "page" fills Simple mode's Ask AI tab (with a conversation rail); "drawer" is the Advanced right-hand panel
// (with a History view). seed ({ text, context, attachments, key } or { draft, key }) asks a question sent from
// elsewhere, with optional background (a report being read, as text or as an attachment the server reads) that travels
// with the question but isn't shown as a bubble.
// onAction runs a button the answer offered (studio-actions.js runAiAction) and resolves to a short result line, false
// when the person said no, or throws; onShow starts a "Show me" tour. state (the pushed studio state) lets cards follow
// runs live; nav (studio-actions.js StudioNav) lets cards open reports and folders. page.layout ('simple' or 'classic')
// tells Ask AI which layout the person is in. onOpenSettings is passed only to people who may open Settings, so the
// "Open Settings" button on an error never shows an editor a door they can't use; copy.noPictures replaces the Settings
// hint when pictures are off for someone else to turn on.
// needs ((state, can) → [{ label, request }]) replaces the "Needs you now" rules: a channel owner's come from their
// channel's view (channel-ask.jsx).
export function HelpAssistant({ api, open, onClose, page, onOpenPage, onOpenSettings, imagesReady = false, variant = 'drawer', seed = null, onAction, onShow, starters = STARTERS, copy = {}, onOpenAssets, state = null, nav = null, workspaceId: workspaceIn, needs = attentionStarters }) {
  const viewer = useViewer(); // an admin previewing another role sees Ask AI as they would, but can't send
  const can = useCan();
  const confirm = useConfirm();
  const reduced = usePrefersReducedMotion();
  const inline = variant === 'page';
  const identity = viewer.id || 'local';
  const workspaceId = workspaceIn ?? state?.contentStudio?.activeWorkspaceId ?? '';
  const persisted = typeof api?.listAskConversations === 'function' && typeof api?.readAskConversation === 'function' && can('listAskConversations');
  const memoryOn = typeof api?.listAskMemory === 'function' && can('listAskMemory');
  const liveStream = typeof api?.onAskStream === 'function';
  const store = useMemo(() => createAskStreamStore(api), [api]);
  useEffect(() => () => store.dispose(), [store]);
  const [messages, setMessages] = useState([]);
  const [conversation, setConversation] = useState(null); // { id, title } once the server has the thread
  const [conversations, setConversations] = useState([]);
  const [listStatus, setListStatus] = useState('idle');
  const [listError, setListError] = useState('');
  const [listNote, setListNote] = useState('');
  const [opening, setOpening] = useState(''); // the id of a conversation being read
  const [draft, setDraft] = useState('');
  const [inflight, setInflight] = useState({}); // requestId → the question still being answered (see ask())
  const [stopping, setStopping] = useState('');
  const [notice, setNotice] = useState('');
  const [enlarged, setEnlarged] = useState(null);
  const [drawerWidth, setDrawerWidth] = useState(readDrawerWidth);
  const [actionState, setActionState] = useState({});
  const [panel, setPanel] = useState(''); // '' | 'history' (drawer) | 'memory'
  const [railOpen, setRailOpen] = useState(false);
  const [viewKey, setViewKey] = useState('n:0'); // which thread is on screen: c:<conversation id>, or n:<n> for a new one
  const [queued, setQueued] = useState(null); // { text, context, attachments, source } waiting for this thread's answer
  const [chips, setChips] = useState([]); // [{ kind, ref, id }] attached to the next question
  const [note, setNote] = useState(null); // { name, text } a dropped .md or .txt file, sent as the question's context
  const [picker, setPicker] = useState(null); // { only, query } the attach popover
  const [editingKey, setEditingKey] = useState('');
  const [pinned, setPinned] = useState({ key: '', signal: 0 });
  const [announcement, setAnnouncement] = useState('');
  const [unread, setUnread] = useState(() => new Set());
  const [seenAt, setSeenAt] = useState(() => readSeen(identity));
  const [dropping, setDropping] = useState('');
  const [commandsOpen, setCommandsOpen] = useState(false);
  const narrow = useMedia('(max-width: 899px)');
  const inputRef = useRef(null);
  const asideRef = useRef(null);
  const seedKey = useRef(null);
  const threadRef = useRef(0); // bumps on every New conversation or switch, so a late read never lands in another thread
  const viewCounter = useRef(0);
  const viewKeyRef = useRef(viewKey);
  const conversationRef = useRef(null); conversationRef.current = conversation;
  const messagesRef = useRef(messages); messagesRef.current = messages;
  const inflightRef = useRef(inflight);
  const finished = useRef(new Set()); // requests already finished in place (the reply and the stream's done both arrive)
  const stoppedRef = useRef(new Set());
  const failedView = useRef(''); // the thread whose last question failed: a waiting question goes to the box, not the AI
  const announced = useRef({ at: 0, text: '' });
  const listToken = useRef(0);
  const images = useRef(new Map()); // imageId -> dataUrl, so switching back to a thread doesn't read pictures again
  const seen = useRef({ identity: null, workspaceId: null });
  const openRef = useRef(open); openRef.current = open;
  const workspaceRef = useRef(workspaceId); workspaceRef.current = workspaceId;
  const handlers = useRef({});

  const setInflightMap = (next) => { inflightRef.current = next; setInflight(next); };
  const addInflight = (request) => setInflightMap({ ...inflightRef.current, [request.requestId]: request });
  const dropInflight = (requestId) => { if (!inflightRef.current[requestId]) return; const { [requestId]: _gone, ...rest } = inflightRef.current; setInflightMap(rest); };
  const requestIn = (key) => Object.values(inflightRef.current).find((request) => request.viewKey === key) || null;
  const viewRequest = Object.values(inflight).find((request) => request.viewKey === viewKey) || null;
  const switchView = (key) => { viewKeyRef.current = key; setViewKey(key); };
  const announce = (text) => { if (!text) return; announced.current = { at: Date.now(), text }; setAnnouncement(text); };

  useEffect(() => {
    if (!seed?.key || seed.key === seedKey.current) return;
    seedKey.current = seed.key;
    // A draft fills the box for the person to finish; text asks right away.
    if (seed.draft) { setPanel(''); setDraft(seed.draft); requestAnimationFrame(() => { const input = inputRef.current; if (input) { input.focus(); input.setSelectionRange(seed.draft.length, seed.draft.length); } }); }
    // A report sent as an attachment is read whole by the server, so its text excerpt (the fallback for older servers)
    // stays behind rather than being paid for twice.
    else if (seed.text) { setPanel(''); const attachments = list(seed.attachments); ask(seed.text, { context: attachments.length && liveStream ? '' : seed.context || '', attachments, source: 'seed' }); }
  }, [seed?.key]);
  // A question waiting for this thread's answer goes once the answer is in; after an error (or in a preview) it waits in
  // the box instead, so the error stays readable and nothing is sent unasked.
  useEffect(() => {
    if (!queued || opening || viewRequest) return;
    const next = queued; setQueued(null);
    if (failedView.current === viewKeyRef.current || viewer.preview) { failedView.current = ''; setDraft(next.text); setChips(list(next.attachments)); setNotice(''); return; }
    ask(next.text, { context: next.context, attachments: next.attachments });
  }, [queued, opening, viewRequest]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (open && !panel) requestAnimationFrame(() => inputRef.current?.focus()); }, [open]);
  // Esc: the enlarged picture, then the attach popover, then a running answer (when focus is in Ask AI), then an open
  // panel or rail, then (drawer only) the drawer itself. "/" outside a field jumps to the question box.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.defaultPrevented) return;
      if (event.key === 'Escape') {
        const running = requestIn(viewKeyRef.current);
        if (enlarged) { event.stopPropagation(); setEnlarged(null); }
        else if (picker) { event.stopPropagation(); setPicker(null); }
        else if (running && ((typeof api?.cancelAsk === 'function' && can('cancelAsk')) || (typeof api?.cancelJob === 'function' && can('cancelJob'))) && asideRef.current?.contains(document.activeElement)) { event.stopPropagation(); event.preventDefault(); stop(); }
        else if (panel) { event.stopPropagation(); closePanel(); }
        else if (inline && railOpen && narrow) { event.stopPropagation(); setRailOpen(false); }
        else if (!inline) { event.stopPropagation(); onClose(); }
      } else if (event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey && !panel && !isField(event.target) && !document.querySelector('[role="dialog"][aria-modal="true"]')) {
        event.preventDefault(); inputRef.current?.focus(); if (!draft) setDraft('/');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // re-bound each render: it reads the current panel, picker and answer
  // The person's saved conversations: on mount and whenever who they are, their role or the workspace changes. A
  // different person or workspace starts clean; otherwise the thread that was open in this window opens again.
  useEffect(() => {
    if (!api?.askHelp) return;
    const changed = seen.current.identity !== null && (seen.current.identity !== identity || seen.current.workspaceId !== workspaceId);
    seen.current = { identity, workspaceId };
    if (changed) { reset(); setInflightMap({}); setSeenAt(readSeen(identity)); setUnread(new Set()); }
    if (persisted) refreshList({ reopen: true });
  }, [identity, viewer.role, workspaceId, persisted]);
  // Answers still being written when this window opened (a reload, a layout switch): follow them again.
  useEffect(() => {
    if (!persisted || !liveStream || typeof api?.readAskProgress !== 'function') return;
    Promise.resolve(api.readAskProgress({})).then((result) => { for (const snapshot of list(result?.active)) handlers.current.adoptRemote?.(snapshot, { snapshot: true }); }).catch(() => {});
  }, [store, persisted]); // eslint-disable-line react-hooks/exhaustive-deps
  // The stream: finishes turns, mirrors answers another tab of this person is getting here, announces steps, and
  // shows follow-up messages the studio posts into a conversation.
  useEffect(() => store.onAny((event, progress) => handlers.current.onStream?.(event, progress)), [store]);
  const attachOptions = useMemo(() => attachOptionsFrom(state), [state]);
  if (!api?.askHelp) return null;

  const scoped = (rows) => rows.filter((row) => !workspaceId || !row.workspaceId || row.workspaceId === workspaceId).sort(byPinThenNewest);
  async function refreshList({ reopen = false } = {}) {
    if (!persisted) return;
    const token = ++listToken.current; const thread = threadRef.current;
    setListStatus((current) => (current === 'ready' ? 'ready' : 'loading'));
    try {
      const rows = scoped(rowsOf(await api.listAskConversations({ workspaceId })));
      if (token !== listToken.current) return;
      setConversations(rows); setListStatus('ready'); setListError('');
      const remembered = reopen ? readThread(identity) : '';
      if (remembered && thread === threadRef.current && !messagesRef.current.length && !requestIn(viewKeyRef.current) && rows.some((row) => row.id === remembered)) openConversation(rows.find((row) => row.id === remembered));
    } catch (failure) { if (token === listToken.current) { setListStatus('error'); setListError(errorText(failure)); } }
  }
  function reset(key = '') {
    threadRef.current += 1;
    setQueued(null); setEditingKey(''); setPinned({ key: '', signal: 0 }); setCommandsOpen(false); setPicker(null);
    setMessages([]); messagesRef.current = []; setConversation(null); conversationRef.current = null;
    setActionState({}); setNotice(''); setOpening(''); setEnlarged(null);
    switchView(key || `n:${++viewCounter.current}`);
  }
  function startNew() {
    reset(); keepThread(identity, ''); setPanel(''); setRailOpen(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  }
  function closePanel() { setPanel(''); requestAnimationFrame(() => inputRef.current?.focus()); }
  const upsertRow = (row) => setConversations((rows) => scoped([{ ...(rows.find((item) => item.id === row.id) || {}), ...row }, ...rows.filter((item) => item.id !== row.id)]));
  const markUnread = (id) => setUnread((current) => (current.has(id) ? current : new Set([...current, id])));
  const markRead = (id) => {
    setUnread((current) => { if (!current.has(id)) return current; const next = new Set(current); next.delete(id); return next; });
    setSeenAt((current) => { const next = { ...current, [id]: new Date().toISOString() }; keepSeen(identity, next); return next; });
  };
  const updateImage = (id, image) => setMessages((current) => current.map((message) => (message.id === id && message.image ? { ...message, image: { ...message.image, ...image } } : message)));
  function readPictures(rows, thread) {
    for (const row of rows) {
      const imageId = row.image?.imageId; if (!imageId || row.image.status !== 'loading') continue;
      if (images.current.has(imageId)) { updateImage(row.id, { dataUrl: images.current.get(imageId), status: 'ready' }); continue; }
      if (typeof api.readHelpImage !== 'function') { updateImage(row.id, { status: 'failed', error: 'Pictures can’t be shown here.' }); continue; }
      Promise.resolve(api.readHelpImage({ id: imageId })).then((result) => {
        if (thread !== threadRef.current || !result?.dataUrl) throw new Error('That picture is no longer available.');
        images.current.set(imageId, result.dataUrl); updateImage(row.id, { dataUrl: result.dataUrl, status: 'ready' });
      }).catch((failure) => { if (thread === threadRef.current) updateImage(row.id, { status: 'failed', error: errorText(failure) }); });
    }
  }
  // A question still being answered, as the thread shows it: its bubble and the answer placeholder.
  const placeholderFor = (request) => ({ key: request.turnKey, id: `pending-${request.requestId}`, role: 'assistant', pending: true, requestId: request.requestId, createdAt: request.createdAt, startedMs: request.startedMs });
  // The stored messages of a conversation plus any of its questions still being answered (a Retry or Edit replaces the
  // last answer; a new question goes at the end).
  function withInflight(rows, key) {
    let out = rows;
    for (const request of Object.values(inflightRef.current).filter((row) => row.viewKey === key)) {
      if (request.mode) {
        const at = out.findIndex((row) => row.role === 'user' && row.id === request.replaces);
        if (at >= 0) { out = [...out.slice(0, at), { ...out[at], key: request.userKey, content: request.question }, placeholderFor(request)]; continue; }
      }
      out = [...out, request.userMessage, placeholderFor(request)];
    }
    return out;
  }
  async function openConversation(row) {
    if (!row?.id) return;
    setPanel(''); setRailOpen(false);
    if (conversationRef.current?.id === row.id && messagesRef.current.length) return;
    reset(`c:${row.id}`); const thread = threadRef.current;
    const opened = { id: row.id, title: row.title || '' }; setConversation(opened); conversationRef.current = opened;
    setOpening(row.id); keepThread(identity, row.id); markRead(row.id);
    try {
      const result = await api.readAskConversation({ id: row.id, conversationId: row.id });
      if (thread !== threadRef.current) return;
      const record = result?.conversation?.messages ? result.conversation : result || {};
      const { rows, states } = threadFrom(record.messages);
      for (const message of rows) if (message.image?.imageId && images.current.has(message.image.imageId)) message.image = { ...message.image, dataUrl: images.current.get(message.image.imageId), status: 'ready' };
      const loaded = { id: record.id || row.id, title: record.title || row.title || '' }; setConversation(loaded); conversationRef.current = loaded;
      setMessages(withInflight(rows, `c:${loaded.id}`)); setActionState(states);
      readPictures(rows, thread);
    } catch (failure) {
      if (thread !== threadRef.current) return;
      keepThread(identity, ''); setConversation(null); conversationRef.current = null;
      setNotice(`That conversation couldn’t be opened. ${errorText(failure)}`);
    } finally { if (thread === threadRef.current) setOpening(''); }
  }
  // A new conversation whose first answer is still coming (it has no saved id yet).
  function openPending(row) {
    const request = inflightRef.current[row.requestId]; if (!request) return;
    setPanel(''); setRailOpen(false);
    if (viewKeyRef.current === request.viewKey && messagesRef.current.length) return;
    reset(request.viewKey);
    setMessages([request.userMessage, placeholderFor(request)]);
  }
  async function renameConversation(row, title) {
    const next = title.slice(0, 80);
    setConversations((rows) => rows.map((item) => (item.id === row.id ? { ...item, title: next } : item)));
    if (conversationRef.current?.id === row.id) setConversation((current) => ({ ...current, title: next }));
    setListNote('');
    try { await api.renameAskConversation({ id: row.id, conversationId: row.id, title: next }); }
    catch (failure) { setListNote(`It couldn’t be renamed. ${errorText(failure)}`); refreshList(); }
  }
  // Pinning rides renameAskConversation ({ conversationId, pinned }); the index keeps `pinned` per conversation.
  async function pinConversation(row) {
    setConversations((rows) => scoped(rows.map((item) => (item.id === row.id ? { ...item, pinned: !row.pinned } : item))));
    setListNote('');
    try { await api.renameAskConversation({ id: row.id, conversationId: row.id, pinned: !row.pinned }); }
    catch (failure) { setListNote(`That couldn’t be changed. ${errorText(failure)}`); refreshList(); }
  }
  async function deleteConversation(row) {
    if (requestIn(`c:${row.id}`)) { setListNote('Wait for the answer, or stop it, before deleting this conversation.'); return; }
    const ok = await confirm({ title: 'Delete this conversation?', lines: [`“${clip(row.title || 'Untitled conversation', 80)}” and its answers are deleted for good. Anything Ask AI remembered stays until you forget it under Memory.`], confirmLabel: 'Delete', tone: 'danger' });
    if (!ok) return;
    setListNote('');
    try {
      await api.deleteAskConversation({ id: row.id, conversationId: row.id });
      setConversations((rows) => rows.filter((item) => item.id !== row.id));
      if (conversationRef.current?.id === row.id) startNew();
    } catch (failure) { setListNote(`It couldn’t be deleted. ${errorText(failure)}`); }
  }
  // Outcomes go back to the server so the next answer knows what happened (and a reload shows it). Best effort.
  function record(conversationId, messageId, payload) {
    if (!conversationId || isLocal(messageId) || typeof api.recordAskOutcome !== 'function') return;
    Promise.resolve(api.recordAskOutcome({ conversationId, messageId, ...payload })).catch(() => {});
  }
  async function drawPicture(id, request, conversationId) {
    updateImage(id, { ...request, status: 'creating', error: '' });
    try {
      const made = await api.createHelpImage(request);
      if (made?.id && made.dataUrl) images.current.set(made.id, made.dataUrl);
      updateImage(id, { ...made, imageId: made?.id || '', status: 'ready' });
      if (made?.id) record(conversationId, id, { outcome: { kind: 'image', imageId: made.id } });
    } catch (failure) {
      updateImage(id, { status: 'failed', error: errorText(failure) });
      record(conversationId, id, { outcome: { kind: 'image', status: 'failed', text: errorText(failure) } });
    }
  }

  // One question. options: { context, attachments, mode: 'regenerate' | 'edit', replaces (the last question's id),
  // again (a failed turn asked again), source: 'seed' | 'typed' }. The question's bubble and an answer placeholder go
  // in at once and the question is pinned near the top; the answer streams into the placeholder, and the reply (or the
  // stream's done) finishes it in place. While this thread is still answering, a new question waits its turn.
  async function ask(question = draft, options = {}) {
    if (viewer.preview) { setNotice(PREVIEW_TITLE); return; }
    const text = String(question ?? '').trim();
    if (!text) return;
    const context = String(options.context ?? '').slice(0, 3900);
    const attachments = list(options.attachments).filter((row) => row?.kind && row.ref).slice(0, 3);
    if ((requestIn(viewKeyRef.current) || opening) && !options.again && !options.mode) {
      setQueued({ text, context, attachments, source: options.source || 'typed' });
      if (options.source === 'seed') setNotice('Your question will be asked as soon as this answer is done.');
      else { setDraft(''); setChips([]); setNote(null); }
      return;
    }
    const requestId = options.again?.requestId || newRequestId();
    finished.current.delete(requestId); stoppedRef.current.delete(requestId);
    const conversationId = conversationRef.current?.id || '';
    const mode = conversationId && ['regenerate', 'edit'].includes(options.mode) ? options.mode : '';
    const replaces = mode ? String(options.replaces || '') : '';
    const createdAt = new Date().toISOString();
    const before = messagesRef.current.filter(settledRow);
    const editing = mode ? messagesRef.current.find((row) => row.role === 'user' && row.id === replaces) : null;
    const userKey = options.again?.userKey || (editing ? editing.key || editing.id : `u-${requestId}`);
    const request = {
      requestId, viewKey: viewKeyRef.current, workspaceId: workspaceRef.current, conversationId, question: text, context, attachments, mode, replaces, userKey, turnKey: `turn-${requestId}`, startedMs: nowMs(), createdAt,
      userMessage: { key: userKey, id: options.again?.localId || editing?.id || `local-${requestId}`, role: 'user', content: text, context, attachments, createdAt: editing?.createdAt || createdAt },
    };
    const placeholder = placeholderFor(request);
    if (options.again?.turnKey) setMessages((current) => current.map((row) => (row.key === options.again.turnKey ? placeholder : row)));
    else if (editing) setMessages((current) => { const at = current.findIndex((row) => row.role === 'user' && row.id === replaces); return at < 0 ? current : [...current.slice(0, at), { ...current[at], key: userKey, ...(mode === 'edit' ? { content: text, editedAt: createdAt } : {}) }, placeholder]; });
    else setMessages((current) => [...current, request.userMessage, placeholder]);
    addInflight(request);
    store.track(requestId, { question: text, conversationId, startedAt: createdAt, mode });
    setPinned((current) => ({ key: userKey, signal: current.signal + 1 }));
    if (!options.again) setDraft('');
    setChips([]); setNote(null); setNotice(''); setEditingKey(''); setPicker(null); setCommandsOpen(false); failedView.current = '';
    const payload = { question: text, requestId, page, ...(conversationId ? { conversationId } : { history: legacyHistory(before) }), ...(context ? { context } : {}), ...(attachments.length ? { attachments: attachments.map(({ kind, ref }) => ({ kind, ref })) } : {}), ...(mode ? { mode, replaces } : {}) };
    request.payload = payload;
    try {
      const reply = await api.askHelp(payload);
      finalize(request, reply);
    } catch (failure) {
      if (finished.current.has(requestId)) return;
      // The call was cut while the answer was still being written (a proxy's time limit, a dropped connection): keep
      // following it, then ask once more with the same request id, which returns the saved reply without paying again.
      if (dropped(failure) && liveStream && !isFinal(store.get(requestId)?.status) && !stoppedRef.current.has(requestId)) { recover(request); return; }
      fail(request, failure);
    }
  }
  async function recover(request) {
    const { requestId } = request;
    for (let tries = 0; tries < 90 && !finished.current.has(requestId); tries++) {
      await new Promise((resolve) => setTimeout(resolve, 4000));
      if (finished.current.has(requestId) || isFinal(store.get(requestId)?.status)) break;
      try { const result = await api.readAskProgress?.({ requestId }); if (result?.progress) { store.adopt(result.progress); if (isFinal(result.progress.status)) break; } } catch { /* the next try reads it again */ }
    }
    if (finished.current.has(requestId)) return;
    const progress = store.get(requestId);
    if (progress?.final && ['done', 'stopped'].includes(progress.status)) { finalize(request, progress.final); return; }
    try { finalize(request, await api.askHelp(request.payload)); } catch (failure) { fail(request, failure); }
  }
  // The reply landed: the placeholder becomes the answer under the same key (no remount, no jump), the conversation is
  // named and listed, and a picture or tour starts. A question asked in a thread that isn't on screen any more marks its
  // conversation unread instead.
  function finalize(request, reply) {
    const { requestId } = request;
    if (finished.current.has(requestId)) return;
    finished.current.add(requestId); dropInflight(requestId);
    store.settle(requestId, reply?.message?.stopped ? 'stopped' : 'done', reply);
    const server = Boolean(reply?.message);
    const message = { ...assistantFrom(server ? reply.message : { ...reply, id: `local-a-${requestId}` }), key: request.turnKey, requestId, startedMs: request.startedMs, streamed: liveStream && Boolean(store.get(requestId)?.text) };
    if (!message.id) message.id = `local-a-${requestId}`;
    if (message.image?.status === 'creating' && typeof api.createHelpImage !== 'function') message.image = null;
    const convo = server && reply.conversation?.id ? reply.conversation : null;
    const visible = viewKeyRef.current === request.viewKey;
    // An answer that finished after a switch to another workspace belongs to its own workspace's list, not this one.
    const here = (request.workspaceId ?? workspaceRef.current) === workspaceRef.current;
    if (convo && here) upsertRow({ id: convo.id, title: convo.title || clip(request.question, 60), updatedAt: convo.updatedAt || new Date().toISOString(), workspaceId: workspaceRef.current, preview: clip(message.content.replace(/[#*_`>]/g, ''), 120) });
    if (visible) {
      if (convo) {
        const named = { id: convo.id, title: convo.title || conversationRef.current?.title || '' };
        conversationRef.current = named; setConversation(named); keepThread(identity, convo.id); switchView(`c:${convo.id}`);
      }
      const userId = server ? reply.userMessage?.id || request.userMessage.id : request.userMessage.id;
      setMessages((current) => current.map((row) => (row.key === request.userKey ? { ...row, id: userId, ...(server && reply.userMessage?.editedAt ? { editedAt: reply.userMessage.editedAt } : {}) } : row.key === request.turnKey ? message : row)));
      if (message.image?.status === 'creating') drawPicture(message.id, { title: message.image.title, prompt: message.image.prompt, size: message.image.size, family: message.image.family || 'none' }, convo?.id || request.conversationId);
      else if (message.image?.status === 'loading') readPictures([message], threadRef.current);
      if (onShow && message.show?.autoStart) onShow(message.show.steps);
      announce(message.stopped ? 'Stopped. What was written so far is kept.' : `Answer ready. ${firstSentence(message.content)}`);
    } else if (convo && here) markUnread(convo.id);
    if (!openRef.current && !inline) { try { window.dispatchEvent(new CustomEvent('ask-answer-ready', { detail: { conversationId: convo?.id || '' } })); } catch { /* a courtesy */ } }
  }
  // No answer: the turn keeps what was written so far (greyed) with the reason and Try again. Nothing was saved.
  function fail(request, failure) {
    const { requestId } = request;
    if (finished.current.has(requestId)) return;
    finished.current.add(requestId); dropInflight(requestId);
    const stopped = stoppedRef.current.has(requestId); stoppedRef.current.delete(requestId); setStopping((current) => (current === requestId ? '' : current));
    store.settle(requestId, stopped ? 'stopped' : 'failed');
    const text = errorText(failure);
    // Errors are asked again with the same id, so a reply that did arrive isn't paid for twice; a stop or a busy refusal
    // gets a new one.
    const retry = { question: request.question, context: request.context, attachments: request.attachments, mode: request.mode, replaces: request.replaces, requestId: stopped || failure?.code === 'askBusy' ? newRequestId() : requestId, userKey: request.userKey, turnKey: request.turnKey, localId: request.userMessage.id };
    const visible = viewKeyRef.current === request.viewKey;
    if (visible) {
      setMessages((current) => current.map((row) => (row.key === request.turnKey ? { ...row, pending: false, failed: true, stoppedEmpty: stopped, error: stopped ? '' : text, code: failure?.code || '', retry } : row)));
      failedView.current = request.viewKey;
      announce(stopped ? 'Stopped. Nothing more is spent on that question.' : `Ask AI couldn’t answer. ${text}`);
    } else setNotice(stopped ? '' : `A question in another conversation didn’t get an answer: ${text}`);
  }
  async function stop() {
    const request = requestIn(viewKeyRef.current);
    if (!request || stopping === request.requestId) return;
    stoppedRef.current.add(request.requestId); setStopping(request.requestId);
    try {
      if (typeof api.cancelAsk === 'function') { const result = await api.cancelAsk({ requestId: request.requestId }); if (result && result.stopped === false) throw new Error('Nearly done.'); }
      else await api.cancelJob(`help-${request.requestId}`);
    } catch {
      stoppedRef.current.delete(request.requestId); setStopping('');
      setNotice('It’s nearly done, so it couldn’t be stopped. The answer will appear in a moment.');
    }
  }
  // Ask again: a saved last answer is replaced (mode regenerate, keeping the old one as an earlier version); a turn that
  // failed before anything was saved is simply asked again.
  function retryAnswer(message, user) {
    if (message.failed && message.retry) { ask(message.retry.question, { context: message.retry.context, attachments: message.retry.attachments, again: message.retry, mode: message.retry.mode, replaces: message.retry.replaces }); return; }
    if (user && !isLocal(user.id)) ask(user.content, { mode: 'regenerate', replaces: user.id });
  }
  function editQuestion(user, text) {
    if (!user || isLocal(user.id)) return;
    if (text.trim() === String(user.content || '').trim()) { setEditingKey(''); ask(user.content, { mode: 'regenerate', replaces: user.id }); return; }
    ask(text, { mode: 'edit', replaces: user.id });
  }
  async function download(image) {
    try { const saved = await api.saveHelpImage({ id: image.id || image.imageId }); if (saved && !saved.cancelled) setNotice(`Saved ${saved.fileName || 'the picture'}.`); }
    catch (failure) { setNotice(errorText(failure)); }
  }
  async function runAction(message, index) {
    const action = message.actions[index]; if (!action || !onAction) return;
    const key = `${message.id}:${index}`; const conversationId = conversationRef.current?.id || '';
    // A plan's "ask" step asks its question here (a normal Ask AI answer, with its own cost line).
    if (action.kind === 'ask') {
      if (requestIn(viewKeyRef.current) || opening || viewer.preview || !String(action.target || '').trim()) { setNotice(viewer.preview ? PREVIEW_TITLE : 'Ask AI is still answering. Try this step once it’s done.'); return; }
      const done = { status: 'done', text: 'Asked.' };
      setActionState((current) => ({ ...current, [key]: done })); record(conversationId, message.id, { index, outcome: done });
      ask(action.target);
      return;
    }
    setActionState((current) => ({ ...current, [key]: { status: 'running' } }));
    try {
      // A prompt edit is credited to this conversation (the Prompts page's History links back to it), and work started
      // from an answer names where it came from (`ask`), so a scan or research run can post its follow-up back here.
      const from = conversationId && !isLocal(message.id) ? { ask: { conversationId, messageId: message.id, actionIndex: index } } : {};
      const result = await onAction(action.kind === 'edit-prompt' ? { ...action, conversationId, ...from } : { ...action, ...from });
      const done = result === false ? undefined : { status: 'done', text: typeof result === 'string' ? result : 'Done.' };
      setActionState((current) => ({ ...current, [key]: done }));
      record(conversationId, message.id, { index, outcome: done ? { status: 'done', text: done.text } : { status: 'cancelled', text: '' } });
    } catch (failure) {
      const text = errorText(failure);
      setActionState((current) => ({ ...current, [key]: { status: 'failed', text } }));
      record(conversationId, message.id, { index, outcome: { status: 'failed', text } });
    }
  }
  // A card that did its action's work itself (the scan plan's Start scan) reports what happened here.
  function cardOutcome(message, index, outcome) {
    setActionState((current) => ({ ...current, [`${message.id}:${index}`]: outcome }));
    record(conversationRef.current?.id || '', message.id, { index, outcome });
  }
  const statesFor = (message) => Object.fromEntries(message.actions.map((_, index) => [index, actionState[`${message.id}:${index}`]]).filter(([, value]) => value));
  // An in-answer link: the layout opens the item (openTarget), else the nearest place it has.
  function openLink(link) {
    try {
      // A page link carries an Ask AI page id (HELP_PAGES: `reports` is Dataset reports), the same as the page buttons
      // under an answer, so it opens the same way they do; openTarget's pages are Simple's tab ids.
      if (link.kind === 'page' && typeof onOpenPage === 'function') { onOpenPage(link.id); return; }
      if (typeof nav?.openTarget === 'function') { nav.openTarget({ kind: link.kind, id: link.id, ...(link.kind === 'page' ? { page: link.id } : {}) }); return; }
      const ways = { report: () => nav?.openReport?.(link.id), folder: () => nav?.openFolder?.(link.id), prompt: () => nav?.openPrompt?.(link.id), page: () => onOpenPage?.(link.id), program: () => onOpenPage?.('research'), trend: () => nav?.openTab?.('trends'), run: () => nav?.openTab?.('home') };
      const way = { report: nav?.openReport, folder: nav?.openFolder, prompt: nav?.openPrompt, page: onOpenPage, program: onOpenPage, trend: nav?.openTab, run: nav?.openTab }[link.kind];
      if (typeof way !== 'function') { setNotice('That isn’t available in this layout.'); return; }
      ways[link.kind]();
    } catch (failure) { setNotice(errorText(failure)); }
  }
  // A "needs you now" starter runs its button straight away (no AI call); its result or error shows as a note.
  async function runStarter(request) {
    if (!onAction || viewer.preview) return;
    setNotice('');
    try { const result = await onAction(request); if (typeof result === 'string') setNotice(result); }
    catch (failure) { setNotice(errorText(failure)); }
  }

  // ── The stream, follow-ups and answers from another tab ──
  // A question this person is getting an answer to in another tab (or that was running before a reload): followed
  // here, finished from the stream (there is no call of ours to wait for).
  function adoptRemote(progress, { snapshot = false } = {}) {
    const requestId = progress?.requestId;
    if (!requestId || inflightRef.current[requestId] || finished.current.has(requestId) || isFinal(progress.status)) return;
    const key = progress.conversationId ? `c:${progress.conversationId}` : `r:${requestId}`;
    const createdAt = progress.startedAt || new Date().toISOString();
    const request = { requestId, viewKey: key, conversationId: progress.conversationId || '', question: progress.question || '', context: '', attachments: [], mode: progress.mode || '', replaces: '', userKey: `u-${requestId}`, turnKey: `turn-${requestId}`, startedMs: nowMs(), createdAt, remote: true, userMessage: { key: `u-${requestId}`, id: `local-${requestId}`, role: 'user', content: progress.question || '', createdAt } };
    if (request.mode) { const last = [...messagesRef.current].reverse().find((row) => row.role === 'user'); if (last) { request.replaces = last.id; request.userKey = last.key || last.id; } }
    // Listed first, so the events the store replays below find it as a known request.
    addInflight(request);
    if (snapshot) store.adopt(progress);
    store.track(requestId, { question: progress.question, conversationId: progress.conversationId });
    if (viewKeyRef.current === key && !opening) setMessages((current) => withInflight(current.filter(settledRow), key));
  }
  async function showFollowUp(event) {
    const id = event.conversationId; if (!id) return;
    refreshList();
    if (conversationRef.current?.id !== id || opening) { markUnread(id); return; }
    try {
      const thread = threadRef.current;
      const result = await api.readAskConversation({ id, conversationId: id });
      if (thread !== threadRef.current) return;
      const recordRow = result?.conversation?.messages ? result.conversation : result || {};
      const { rows, states } = threadFrom(recordRow.messages);
      const have = new Set(messagesRef.current.map((row) => row.id));
      const fresh = rows.filter((row) => !have.has(row.id));
      if (!fresh.length) return;
      setMessages((current) => [...current.filter(settledRow), ...fresh, ...current.filter((row) => !settledRow(row))]);
      setActionState((current) => ({ ...states, ...current }));
      readPictures(fresh, thread); markRead(id);
      announce('A new message from the studio.');
    } catch { markUnread(id); }
  }
  function onStream(event, progress) {
    if (event?.type === 'followup') { showFollowUp(event); return; }
    const requestId = event?.requestId; if (!requestId || !progress) return;
    const request = inflightRef.current[requestId];
    if (!request) {
      // Another tab of this person asked in the conversation open here: mirror it.
      if (!isFinal(progress.status) && progress.conversationId && progress.conversationId === conversationRef.current?.id && !finished.current.has(requestId)) adoptRemote(progress);
      return;
    }
    if (progress.final && ['done', 'stopped'].includes(progress.status)) { finalize(request, progress.final); return; }
    if (request.remote && isFinal(progress.status)) { fail(request, progress.error || { message: 'That answer didn’t finish.' }); return; }
    // Steps, for screen readers: at most one every 2 s.
    if (viewKeyRef.current === request.viewKey && !isFinal(progress.status)) {
      const running = [...list(progress.steps)].reverse().find((step) => step.status === 'running' && step.kind !== 'thinking');
      if (running?.label && running.label !== announced.current.text && Date.now() - announced.current.at > 2000) announce(running.label);
    }
  }
  handlers.current = { onStream, adoptRemote };

  // ── / commands, attachments and drops ──
  const slashCommands = slashCommandsFor({ can, imagesReady, memoryOn });
  const addChip = (item) => {
    if (!item?.ref) return;
    setChips((current) => (current.some((row) => row.kind === item.kind && row.ref.toLowerCase() === item.ref.toLowerCase()) ? current : [...current, { kind: item.kind, ref: item.ref, id: item.id || '' }].slice(-3)));
    requestAnimationFrame(() => inputRef.current?.focus());
  };
  function runSlash(parsed) {
    const action = slashAction(parsed, { attached: chips[0]?.ref || '' });
    if (!action) return false;
    setNotice(''); setCommandsOpen(false);
    if (action.needs) { setDraft(`/${parsed.command.id} `); setNotice(action.needs); return true; }
    if (action.ask) { setDraft(''); ask(action.ask, { context: note?.text || '', attachments: chips }); return true; }
    if (action.attach) {
      setDraft('');
      const want = action.attach.query.toLowerCase();
      const exact = want && list(attachOptions[action.attach.kind]).find((row) => row.ref.toLowerCase() === want);
      if (exact) addChip(exact); else setPicker({ only: action.attach.kind, query: action.attach.query });
      return true;
    }
    if (action.remember) {
      setDraft('');
      if (typeof api.saveAskMemory !== 'function') { setNotice('Memory isn’t available here.'); return true; }
      Promise.resolve(api.saveAskMemory({ text: action.remember, scope: 'me', kind: 'preference', workspaceId: '' })).then(() => setNotice('Remembered. Ask AI uses it from your next question.')).catch((failure) => setNotice(errorText(failure)));
      return true;
    }
    if (action.open === 'memory') { setDraft(''); setPanel('memory'); return true; }
    if (action.reset) { setDraft(''); startNew(); return true; }
    if (action.help) { setDraft(''); setCommandsOpen(true); return true; }
    return false;
  }
  function onSlashPick(command) {
    if (command.attach) { setDraft(''); setPicker({ only: command.attach, query: '' }); return; }
    if (command.arg) { setDraft(`/${command.id} `); requestAnimationFrame(() => { const input = inputRef.current; if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); } }); return; }
    runSlash({ command, rest: '' });
  }
  function submit() {
    const text = draft.trim(); if (!text) return;
    const parsed = parseSlash(text, slashCommands);
    if (parsed && runSlash(parsed)) return;
    if (text.startsWith('/') && !parsed && /^\/[a-z]+$/i.test(text) && SLASH_COMMANDS.some((row) => row.id === text.slice(1).toLowerCase())) { setNotice('That command isn’t available to you here.'); return; }
    ask(text, { context: note?.text || '', attachments: chips });
  }
  function onDragOver(event) {
    const studioRef = dragHasStudioRef(event.dataTransfer); const files = dragHasFiles(event.dataTransfer);
    if (!studioRef && !files) return;
    event.preventDefault();
    try { event.dataTransfer.dropEffect = 'copy'; } catch { /* read-only in some browsers */ }
    const item = currentStudioDrag();
    const label = item ? `Drop to ask about “${clip(item.ref, 60)}”` : files ? 'Drop a .md or .txt file to ask about it' : 'Drop to ask about it';
    if (label !== dropping) setDropping(label);
  }
  function onDragLeave(event) { if (!event.currentTarget.contains(event.relatedTarget)) setDropping(''); }
  async function onDrop(event) {
    setDropping('');
    const item = readStudioRef(event.dataTransfer);
    if (item) { event.preventDefault(); setPanel(''); addChip(item); return; }
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    event.preventDefault();
    if (!/\.(md|markdown|txt)$/i.test(file.name || '') && !/^text\/(plain|markdown)/.test(file.type || '')) { setNotice('Ask AI can take reports, folders and trends from the studio, or a .md or .txt file.'); return; }
    try {
      const text = typeof file.text === 'function' ? await file.text() : await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || '')); reader.onerror = () => reject(reader.error); reader.readAsText(file); });
      setNote({ name: file.name || 'notes.txt', text: text.slice(0, 3900) }); setPanel('');
      requestAnimationFrame(() => inputRef.current?.focus());
    } catch (failure) { setNotice(`That file couldn’t be read. ${errorText(failure)}`); }
  }

  // ── What the panel shows ──
  const allNeeds = onAction && !messages.length ? list(needs(state, can)).filter((row) => aiActionAllowed(row.request.kind, can)) : [];
  const questions = starters === STARTERS ? smartStarters({ state, can, fallback: STARTERS, imagesReady }) : starters.filter((question) => imagesReady || !/image/i.test(question));
  const running = Boolean(viewRequest);
  const canStop = running && ((typeof api.cancelAsk === 'function' && can('cancelAsk')) || (typeof api.cancelJob === 'function' && can('cancelJob')));
  const canEditList = !viewer.preview && can('renameAskConversation') && typeof api.renameAskConversation === 'function' && typeof api.deleteAskConversation === 'function';
  const canRedo = persisted && !viewer.preview && can('askHelp') && Boolean(conversation?.id);
  const title = conversation?.title || '';
  const seesCosts = viewer.base === 'admin' || viewer.role === 'admin' || !Array.isArray(viewer.capabilities) || viewer.capabilities.includes('seeCosts');
  // What a question costs (main's ask-estimate.js; the amounts are stripped for people without See costs).
  const estimate = state?.help?.estimate || null;
  const retryTitle = seesCosts && Number.isFinite(estimate?.followUpUsd) ? `Ask again · about $${estimate.followUpUsd.toFixed(2)}` : 'Ask again';
  const followedUp = conversations.filter((row) => row.id !== conversation?.id && row.lastFollowUpAt && row.lastFollowUpAt > (seenAt[row.id] || '') && row.lastFollowUpAt > (seenAt._since || '')).map((row) => row.id);
  const unreadIds = followedUp.length ? new Set([...unread, ...followedUp]) : unread;
  const answeringIds = new Set(Object.values(inflight).map((request) => (request.viewKey.startsWith('c:') ? request.viewKey.slice(2) : '')).filter(Boolean));
  const pendingRows = Object.values(inflight).filter((request) => !request.viewKey.startsWith('c:') && request.question).map((request) => ({ id: `pending:${request.requestId}`, requestId: request.requestId, title: clip(request.question, 60), active: request.viewKey === viewKey }));
  const history = persisted && <ConversationList rows={conversations} pendingRows={pendingRows} status={listStatus} error={listError} note={listNote} activeId={conversation?.id || ''} answering={answeringIds} unread={unreadIds} canWrite={canEditList}
    onOpen={openConversation} onOpenPending={openPending} onNew={startNew} onRename={renameConversation} onPin={pinConversation} onDelete={deleteConversation} onRetry={() => refreshList()} />;
  const memoryButton = memoryOn && <button type="button" data-spot="ask.memory" className={inline ? 'help-tool' : 'help-icon'} aria-pressed={panel === 'memory'} onClick={() => setPanel((current) => (current === 'memory' ? '' : 'memory'))} aria-label="What Ask AI remembers" title="Memory"><Brain size={inline ? 14 : 16} aria-hidden="true" />{inline && <span>Memory</span>}</button>;

  const welcome = <div className="help-welcome">
    {inline && <span className="help-welcome-mark" aria-hidden="true"><Sparkles size={24} /></span>}
    <h3>{copy.title || 'What can I help with?'}</h3>
    <p>{copy.intro || 'Ask about your trends, reports and runs, or how anything in the studio works. Answers use the app guide and your current setup.'} {imagesReady ? 'Ask for a picture and it appears right here.' : copy.noPictures || 'Add an OpenAI key in Settings → Image generation to make pictures here too.'}</p>
    {allNeeds.length > 0 && <div className="help-starters help-needs" role="group" aria-label="Needs you now">{allNeeds.map((row) => <button type="button" key={row.label} {...writeProps(viewer)} onClick={() => runStarter(row.request)}><span>{row.label}</span><CircleAlert size={14} aria-hidden="true" /></button>)}</div>}
    <div className="help-starters" role="group" aria-label="Try asking">{questions.map((question) => <button type="button" key={question} {...writeProps(viewer)} onClick={() => ask(question)}><span>{question}</span>{/image|picture/i.test(question) ? <ImageIcon size={14} aria-hidden="true" /> : <ArrowRight size={14} aria-hidden="true" />}</button>)}</div>
  </div>;
  // Under a finished answer, in the reply's order (ask-reply.css): the cards (with what was remembered and the picture),
  // the references (in-answer links, Open buttons for one studio item, and pages, as link chips: each item once), then
  // the actions row (the buttons no card or chip draws, and Show me). A reply has one primary button at most: the first
  // card with open work takes it, else the first button here that does the work; every other button is quiet.
  const renderExtras = (message, { links = [] } = {}) => {
    const carded = cardActionIndexes(message.cards, message.actions);
    const memoryCarded = message.cards.some((card) => card?.type === 'memory');
    const states = statesFor(message);
    // The references, the first of each item kept: a page linked in the text and also listed in pages, or a trend the
    // text links and an Open button names, is one chip. An Open button runs through the shared runner as before (so its
    // outcome is recorded); it simply sits with the other links instead of in the actions row.
    const refs = []; const refKeys = new Set(); const chipped = new Set();
    const addRef = (ref) => { if (refKeys.has(ref.key)) return false; refKeys.add(ref.key); refs.push(ref); return true; };
    for (const link of links) addRef({ key: `${link.kind}:${link.id}`, kind: link.kind, label: link.label, open: () => openLink(link) });
    if (onAction) message.actions.forEach((action, index) => {
      if (action?.kind !== 'open' || !REF_ICONS[action.ref?.kind] || !action.ref.id || carded.has(index)) return;
      chipped.add(index);
      addRef({ key: `${action.ref.kind}:${action.ref.id}`, kind: action.ref.kind, label: refName(action.label), name: action.label, index, open: () => runAction(message, index) });
    });
    for (const link of message.pages) addRef({ key: `page:${link.page}`, kind: 'page', label: refName(link.label), name: link.label, open: () => onOpenPage(link.page) });
    const plain = onAction ? message.actions.map((action, index) => [action, index]).filter(([action, index]) => action && !carded.has(index) && !chipped.has(index)) : [];
    const refFailures = refs.map((ref) => (ref.index != null ? actionState[`${message.id}:${ref.index}`] : null)).filter((status) => status?.status === 'failed');
    const pick = primaryPicker(primaryCard(message.cards, message.actions, states, state, { canAct: Boolean(onAction), canRunAction: Boolean(onAction), canAsk: true, can, api }) < 0);
    const hasCards = message.cards.some((card) => CARD_TYPES.includes(card?.type)) || (message.remembered.length > 0 && !memoryCarded) || Boolean(message.image);
    const showMe = Boolean(message.show && onShow);
    let rise = 0; const riseStyle = () => ({ '--i': rise++ });
    return <>
      {hasCards && <div className="ask-reply-cards ask-rise" style={riseStyle()} data-reply-group="cards">
        {message.cards.length > 0 && <ChatCards cards={message.cards} actions={message.actions} actionState={states} onAction={onAction ? (index) => runAction(message, index) : undefined} onRunAction={onAction} onOutcome={(index, outcome) => cardOutcome(message, index, outcome)} onAsk={(text) => ask(text)} onNav={nav || {}} api={api} state={state} conversationId={conversation?.id || conversationRef.current?.id || ''} messageId={isLocal(message.id) ? '' : message.id} />}
        {message.remembered.length > 0 && !memoryCarded && <MemoryCard card={{ type: 'memory', title: 'Remembered', data: { items: message.remembered } }} api={api} />}
        {message.image && <Picture image={message.image} onRetry={typeof api.createHelpImage === 'function' && !viewer.preview ? () => drawPicture(message.id, { title: message.image.title, prompt: message.image.prompt, size: message.image.size, family: message.image.family || 'none' }, conversation?.id || '') : null} onDownload={() => download(message.image)} onEnlarge={() => setEnlarged(message.image)} onOpenAssets={onOpenAssets} />}
      </div>}
      {refs.length > 0 && <div className="ask-reply-refs ask-rise" style={riseStyle()} data-reply-group="refs" role="group" aria-label="In this answer">
        {refs.map((ref) => {
          const Icon = REF_ICONS[ref.kind] || ArrowRight; const running = ref.index != null && actionState[`${message.id}:${ref.index}`]?.status === 'running';
          return <button type="button" key={ref.key} className="reply-ref" aria-label={ref.name && ref.name !== ref.label ? ref.name : undefined} disabled={running} onClick={ref.open}><Icon size={14} aria-hidden="true" /><span>{ref.label}</span><ArrowRight size={13} aria-hidden="true" /></button>;
        })}
        {refFailures.map((status, at) => <small key={at} className="reply-failed" role="alert">{status.text}</small>)}
      </div>}
      {(plain.length > 0 || showMe) && <div className="ask-reply-actions ask-rise" style={riseStyle()} data-reply-group="actions">
        {plain.map(([action, index]) => {
          const status = actionState[`${message.id}:${index}`]; const Icon = actionIcon(action.kind);
          return <div className="reply-action" key={`${action.kind}-${index}`}>{status?.status === 'done'
            ? <span className="reply-done" role="status"><Check size={14} aria-hidden="true" />{status.text}</span>
            : <button type="button" className={pick(!isQuietAction(action.kind))} disabled={status?.status === 'running'} onClick={() => runAction(message, index)}>{status?.status === 'running' ? <LoaderCircle className="spin" size={14} aria-hidden="true" /> : <Icon size={14} aria-hidden="true" />}{action.label}</button>}
            {status?.status === 'failed' && <small className="reply-failed" role="alert">{status.text}</small>}
            {!status && list(action.problems).length > 0 && <small className="reply-muted">{action.problems[0]}</small>}
          </div>;
        })}
        {showMe && <button type="button" className={BUTTON.quiet} onClick={() => onShow(message.show.steps)}><MousePointerClick size={14} aria-hidden="true" />{message.show.steps.length > 1 ? `Show me · ${message.show.steps.length} steps` : 'Show me'}</button>}
      </div>}
    </>;
  };
  // Ask next: what to ask after the newest answer, as quiet suggestion chips (they ask; they aren't links).
  const renderFollowUps = (message) => (message.followUps.length > 0 && !running ? <div className="ask-reply-next ask-rise" data-reply-group="next" role="group" aria-label="Ask next">
    <span className="reply-label" aria-hidden="true">Ask next</span>
    <div className="ask-reply-next-list">{message.followUps.map((question) => <button type="button" key={question} className="reply-suggest" {...writeProps(viewer)} onClick={() => ask(question)}>{question}</button>)}</div>
  </div> : null);
  const renderFailure = (message) => {
    const settingsError = onOpenSettings && !message.stoppedEmpty && /claude|codex|api key|signed in|sign in|update|openai|openrouter|connection/i.test(message.error || '');
    if (message.stoppedEmpty) return <div className="ask-reply-text" role="status"><p className="reply-note"><CircleStop size={14} aria-hidden="true" />Stopped before answering. Nothing more is spent on that question.</p>{message.retry && <div className="reply-card-foot"><button type="button" className={BUTTON.quiet} {...writeProps(viewer, running)} onClick={() => retryAnswer(message)}><RotateCcw size={14} aria-hidden="true" />Ask again</button></div>}</div>;
    return <div className="reply-error" role="alert"><p>{message.error}</p><div className="reply-card-foot">{message.retry && <button type="button" className={BUTTON.quiet} {...writeProps(viewer, running)} onClick={() => retryAnswer(message)}><RotateCcw size={14} aria-hidden="true" />Try again</button>}{settingsError && <button type="button" className={BUTTON.quiet} onClick={onOpenSettings}>Open Settings<ArrowRight size={14} aria-hidden="true" /></button>}</div></div>;
  };
  const lastUser = [...messages].reverse().find((row) => row.role === 'user');
  const editableUser = (user) => canRedo && !isLocal(user?.id) && !running;
  const chipRows = [
    ...chips.map((chip) => ({ key: `${chip.kind}:${chip.ref}`, kind: chip.kind, label: chip.ref, title: `${REF_LABEL[chip.kind] || 'item'}: ${chip.ref}`, onRemove: () => setChips((current) => current.filter((row) => row !== chip)) })),
    ...(note ? [{ key: 'note', kind: 'note', label: `${note.name} · first 3,900 characters`, onRemove: () => setNote(null) }] : []),
  ];
  const placeholder = chips.length ? `Ask about “${clip(chips[0].ref, 40)}”…` : copy.placeholder || (imagesReady ? 'Ask anything, describe a picture, or type / for commands' : 'Ask anything, or type / for commands');

  const thread = <>
    {panel === 'memory' && <MemoryPanel api={api} workspaceId={workspaceId} onClose={closePanel} />}
    {panel === 'history' && !inline && <section className="help-sheet" aria-label="Conversations"><div className="help-sheet-head"><h3><History size={16} aria-hidden="true" />Conversations</h3><button type="button" className="help-icon" onClick={closePanel} aria-label="Back to the conversation" title="Back (Esc)"><X size={16} aria-hidden="true" /></button></div>{history}</section>}
    <AskThread messages={messages} store={store} liveStream={liveStream} reduced={reduced} hidden={Boolean(panel)} busy={running || Boolean(opening)} opening={Boolean(opening)} welcome={welcome}
      pinnedKey={pinned.key} pinSignal={pinned.signal} editingKey={editingKey} canEdit={editableUser} onEditStart={(user) => setEditingKey(user.key || user.id)} onEditCancel={() => { setEditingKey(''); requestAnimationFrame(() => inputRef.current?.focus()); }} onEditSend={editQuestion}
      canRetry={(message, user) => !running && !viewer.preview && (message.failed ? Boolean(message.retry) : canRedo && Boolean(user) && !isLocal(user.id) && !isLocal(message.id))} onRetry={retryAnswer} retryTitle={retryTitle}
      renderExtras={renderExtras} renderFollowUps={renderFollowUps} renderFailure={renderFailure} announcement={announcement} />
    {!panel && <>
      {(notice || commandsOpen) && <div className="ask-notices">
        {notice && <div className="help-notice" role="status"><p>{notice}</p><button type="button" className="help-icon ask-notice-close" aria-label="Dismiss" onClick={() => setNotice('')}><X size={13} aria-hidden="true" /></button></div>}
        {commandsOpen && <div className="ask-commands" role="region" aria-label="Commands"><ul>{slashCommands.map((command) => <li key={command.id}><code>{command.usage}</code><span>{command.label}</span></li>)}</ul><button type="button" className="help-icon ask-notice-close" aria-label="Close the command list" onClick={() => setCommandsOpen(false)}><X size={13} aria-hidden="true" /></button></div>}
      </div>}
      <AskComposer inputRef={inputRef} value={draft} onChange={(value) => { setDraft(value); if (notice && value) setNotice(''); }} onSubmit={submit} onStop={stop} running={running} stopping={Boolean(stopping) && stopping === viewRequest?.requestId} canStop={canStop}
        sendDisabled={viewer.preview || Boolean(opening)} sendTitle={viewer.preview ? PREVIEW_TITLE : undefined} placeholder={placeholder} chips={chipRows} queued={queued && queued.source !== 'seed' ? queued.text : ''} onCancelQueued={() => setQueued(null)}
        slash={slashCommands} onSlash={onSlashPick} attachOptions={attachOptions} picker={picker} onPicker={setPicker} onAttach={addChip}
        onArrowUp={lastUser && editableUser(lastUser) ? () => setEditingKey(lastUser.key || lastUser.id) : undefined} compact={!inline || narrow} spot="ask.box"
        foot={askCostLine({ persisted, seesCosts, route: state?.capabilities?.aiProvider || '', imagesReady, estimate })} />
    </>}
  </>;

  const railHidden = narrow && !railOpen;
  return <aside ref={asideRef} id={inline ? 'help-page' : 'help-drawer'} className={`help-drawer${inline ? ' help-page' : ''}${inline && persisted ? ' has-rail' : ''}${open || inline ? ' open' : ''}${dropping ? ' is-dropping' : ''}`} aria-label="Ask AI about Scraper Studio" aria-hidden={!open && !inline} inert={!open && !inline} style={inline ? undefined : { '--help-drawer-w': `${drawerWidth}px` }}
    onDragOver={onDragOver} onDragEnter={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
    {!inline && <DrawerResizer width={drawerWidth} onWidth={setDrawerWidth} />}
    {inline ? <>
      {persisted && <nav className={`help-rail${railOpen ? ' is-open' : ''}`} data-spot={narrow ? undefined : 'ask.conversations'} aria-label="Ask AI conversations" aria-hidden={railHidden || undefined} inert={railHidden || undefined}>{history}</nav>}
      {persisted && narrow && railOpen && <button type="button" className="help-rail-scrim" aria-label="Close conversations" tabIndex={-1} onClick={() => setRailOpen(false)} />}
      <div className="help-main">
        {/* The conversation's bar: in the page's flow above the thread (never over it), with the conversation's name. */}
        <header className={`help-page-tools${messages.length || title ? '' : ' is-plain'}`}>
          {persisted && narrow && <button type="button" data-spot="ask.conversations" className="help-tool" aria-expanded={railOpen} onClick={() => setRailOpen((value) => !value)}><MessagesSquare size={14} aria-hidden="true" /><span>Conversations</span>{unreadIds.size > 0 && <span className="ask-unread-dot" aria-label="New answers" />}</button>}
          {title && <h2 className="help-thread-title" title={title}>{title}</h2>}
          <span className="help-tools-end">{memoryButton}{messages.length > 0 && <button type="button" className="help-tool" onClick={startNew}><RotateCcw size={14} aria-hidden="true" /><span>New conversation</span></button>}</span>
        </header>
        {thread}
      </div>
    </> : <>
      <header className="help-head">
        <span className="help-mark" aria-hidden="true"><Sparkles size={17} /></span>
        <div><h2>Ask AI</h2><p title={title || undefined}>{title || copy.subtitle || 'Questions about the app, or ask for a picture'}</p></div>
        {persisted && <button type="button" data-spot="ask.conversations" className="help-icon" aria-pressed={panel === 'history'} onClick={() => { setPanel((current) => (current === 'history' ? '' : 'history')); if (panel !== 'history') refreshList(); }} aria-label={unreadIds.size ? 'Conversations, new answers' : 'Conversations'} title="Conversations"><History size={16} aria-hidden="true" />{unreadIds.size > 0 && <span className="ask-unread-dot" aria-hidden="true" />}</button>}
        {memoryButton}
        {messages.length > 0 && <button type="button" className="help-icon" onClick={startNew} aria-label="Start a new conversation" title="New conversation"><RotateCcw size={15} /></button>}
        <button type="button" className="help-icon" onClick={onClose} aria-label="Close Ask AI" title="Close (Esc)"><X size={17} /></button>
      </header>
      {thread}
    </>}
    {dropping && <div className="ask-drop" aria-hidden="true"><p>{dropping}</p></div>}
    {enlarged && <div className="help-lightbox" role="dialog" aria-modal="true" aria-label={enlarged.title} onClick={() => setEnlarged(null)}>
      <img src={enlarged.dataUrl} alt={enlarged.title} />
      <button type="button" className="help-icon" onClick={() => setEnlarged(null)} aria-label="Close picture"><X size={18} /></button>
    </div>}
  </aside>;
}

