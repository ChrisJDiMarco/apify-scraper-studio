import React, { useEffect, useId, useRef, useState } from 'react';
import { ArrowRight, ArrowUp, BookOpen, Brain, Check, CircleAlert, Download, Ellipsis, FileText, History, Image as ImageIcon, LoaderCircle, MessagesSquare, MousePointerClick, Pencil, Pin, PinOff, Plus, RefreshCw, RotateCcw, Search, Sparkles, Square, Trash2, X } from 'lucide-react';
import { MarkdownContent } from './markdown-content.jsx';
import { ChatCards, MemoryCard, cardActionIndexes } from './chat-cards.jsx';
import { useConfirm } from './confirm-dialog.jsx';
import { aiActionAllowed } from './studio-actions.js';
import { PREVIEW_TITLE, formatDay, formatTime, useCan, useViewer, writeProps } from './viewer.js';
import './help-assistant.css';

// "Ask AI": questions about the app and the person's studio, answered from the app guide and live state, with buttons
// for work it can do (nothing runs until the person clicks and confirms), cards built from real studio data, "Show me"
// tours and pictures on request. Conversations are saved on the server, per person (listAskConversations and friends),
// so a thread survives a reload, a layout switch and a role change; Ask AI also keeps a small long-term memory the
// person can read, pin, edit and forget. Against an older server (no conversation methods) it keeps the thread in the
// page and sends the history itself, as before.
const STARTERS = [
  'How do I run my first research program?',
  'What will a research run cost?',
  'Why did my last run stop?',
  'Create a hero image for my latest trend',
];
const money = (value) => (Number.isFinite(value) ? `$${value < 0.01 ? value.toFixed(3) : value.toFixed(2)}` : '');
const ratio = (size) => String(size || '1536x1024').replace('x', ' / ');
const list = (value) => (Array.isArray(value) ? value : []);
const errorText = (failure) => String(failure?.message || failure || 'Something went wrong. Try again.');
const clip = (value, max = 60) => { const text = String(value || '').trim(); return text.length > max ? `${text.slice(0, max - 1)}…` : text; };
// The server registers each question as job "help-<requestId>", so Stop can cancel it; ids are uuids (job ids allow [a-z0-9-]).
const newRequestId = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`);
const isLocal = (id) => !id || String(id).startsWith('local-');
const rowsOf = (result) => list(Array.isArray(result) ? result : result?.conversations).filter((row) => row?.id);
const memoryOf = (result) => list(Array.isArray(result) ? result : result?.items).filter((row) => row?.id && row.status !== 'forgotten');
const savedOf = (result) => (result?.item?.id ? result.item : result?.id ? result : null);
const byPinThenNewest = (a, b) => (Number(Boolean(b.pinned)) - Number(Boolean(a.pinned))) || String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
const when = (value) => { const date = new Date(value || 0); if (!value || Number.isNaN(date.getTime())) return ''; return date.toDateString() === new Date().toDateString() ? formatTime(value) : formatDay(value); };
// Which conversation was open, per person, for this window's session: a layout switch or reload reopens it.
const threadKey = (identity) => `ask.thread.${identity}`;
function readThread(identity) { try { return sessionStorage.getItem(threadKey(identity)) || ''; } catch { return ''; } }
function keepThread(identity, id) { try { if (id) sessionStorage.setItem(threadKey(identity), id); else sessionStorage.removeItem(threadKey(identity)); } catch { /* a convenience only */ } }
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
  const base = { title: image.title || 'Ask AI picture', prompt: image.prompt || '', size: image.size || '1536x1024' };
  const imageId = image.imageId || '';
  if (imageId) return { ...base, id: imageId, imageId, status: image.dataUrl ? 'ready' : 'loading', dataUrl: image.dataUrl || '', costUsd: image.costUsd ?? null };
  return stored ? { ...base, status: 'failed', error: image.error || 'It wasn’t finished.' } : { ...base, status: 'creating' };
}
function assistantFrom(message = {}, options = {}) {
  return {
    id: message.id, role: 'assistant', content: String(message.content ?? message.answer ?? ''), pages: list(message.pages), followUps: list(message.followUps).filter(Boolean), actions: list(message.actions),
    receipt: message.receipt || null, read: list(message.read), show: message.show?.steps?.length ? message.show : null, image: imageFrom(message.image, options), cards: list(message.cards),
    remembered: list(message.remembered).filter((row) => row?.id && row.text), createdAt: message.createdAt || '',
  };
}
// A stored conversation as the panel shows it, plus the outcomes recorded for its buttons. A plan step that was skipped
// was recorded as cancelled with its words; a plain "no" (cancelled, no words) brings the button back.
function threadFrom(messages) {
  const states = {};
  const rows = list(messages).map((message) => {
    if (message?.role === 'user') return { id: message.id, role: 'user', content: String(message.content || ''), context: String(message.context || '') };
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
// In-app links in an answer, [label](studio:<kind>/<id>) (the server writes them from [[Exact title]] and drops any it
// can't find): the words stay in the text, in bold, and each link becomes a button under the answer.
const STUDIO_LINK = /\[([^\]\n]{1,160})\]\(studio:(report|trend|folder|run|prompt|page)\/([A-Za-z0-9][A-Za-z0-9_.:~-]{0,299})\)/g;
export function studioLinks(content) {
  const links = []; const seen = new Set();
  const text = String(content || '').replace(STUDIO_LINK, (all, label, kind, id) => {
    const key = `${kind}:${id}`;
    if (!seen.has(key) && links.length < 6) { seen.add(key); links.push({ label: label.replace(/\*/g, ''), kind, id }); }
    return `**${label.replace(/\*/g, '')}**`;
  });
  return { text, links };
}
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

function Picture({ image, onRetry, onDownload, onEnlarge, onOpenAssets }) {
  if (image.status === 'creating') return <div className="help-picture help-picture-pending" style={{ aspectRatio: ratio(image.size) }} role="status"><LoaderCircle className="spin" size={18} aria-hidden="true" /><span>Creating the picture… usually under a minute</span></div>;
  if (image.status === 'loading') return <div className="help-picture help-picture-pending" style={{ aspectRatio: ratio(image.size) }} role="status"><LoaderCircle className="spin" size={18} aria-hidden="true" /><span>Loading the picture…</span></div>;
  if (image.status === 'failed') return <div className="help-error" role="alert"><p>The picture wasn't created. {image.error}</p>{onRetry && <button type="button" onClick={onRetry}><RefreshCw size={13} aria-hidden="true" />Try again</button>}</div>;
  return <figure className="help-picture">
    <button type="button" className="help-picture-frame" onClick={onEnlarge} aria-label={`Enlarge ${image.title}`}><img src={image.dataUrl} alt={image.title} style={{ aspectRatio: ratio(image.size) }} /></button>
    <figcaption><span>{image.title}</span><button type="button" onClick={onDownload}><Download size={13} aria-hidden="true" />Download</button></figcaption>
    {(image.costUsd != null || onOpenAssets) && <small className="help-receipt">{image.costUsd != null ? `OpenAI image · ${money(image.costUsd)}` : ''}{onOpenAssets && <>{image.costUsd != null ? ' · ' : ''}Saved to <button type="button" className="help-inline-link" onClick={onOpenAssets}>Assets</button></>}</small>}
  </figure>;
}

// The ⋯ menu on a conversation: pin, rename, delete. Arrow keys move, Esc closes and returns to the button.
function RowMenu({ title, pinned, open, onOpenChange, onPin, onRename, onDelete }) {
  const id = useId(); const buttonRef = useRef(null); const menuRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    menuRef.current?.querySelector('[role="menuitem"]')?.focus();
    const away = (event) => { if (!menuRef.current?.contains(event.target) && !buttonRef.current?.contains(event.target)) onOpenChange(false); };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);
  function keys(event) {
    const items = [...(menuRef.current?.querySelectorAll('[role="menuitem"]') || [])]; const at = items.indexOf(document.activeElement);
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
      <button type="button" role="menuitem" className="is-danger" onClick={pick(onDelete)}><Trash2 size={14} aria-hidden="true" />Delete</button>
    </div>}
  </div>;
}

// Saved conversations: New conversation, search, pinned first then newest, and each one's ⋯ menu.
function ConversationList({ rows, status, error, note, activeId, locked, canWrite, onOpen, onNew, onRename, onPin, onDelete, onRetry }) {
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState('');
  const [renaming, setRenaming] = useState('');
  const [title, setTitle] = useState('');
  const want = query.trim().toLowerCase();
  const shown = rows.filter((row) => !want || `${row.title || ''} ${row.preview || ''}`.toLowerCase().includes(want));
  const pinned = shown.filter((row) => row.pinned); const recent = shown.filter((row) => !row.pinned);
  const lockedTitle = locked ? 'Wait for the answer, or stop it' : undefined;
  function commit(row) { const next = title.trim(); setRenaming(''); if (next && next !== row.title) onRename(row, next); }
  const group = (label, items) => items.length > 0 && <section className="help-history-group" aria-label={label || 'Conversations'}>
    {label && <h3>{label}</h3>}
    <ul>{items.map((row) => <li key={row.id} className={`help-history-row${row.id === activeId ? ' is-active' : ''}`}>
      {renaming === row.id
        ? <form className="help-rename" onSubmit={(event) => { event.preventDefault(); commit(row); }}><input aria-label="Conversation name" value={title} maxLength={80} autoFocus onChange={(event) => setTitle(event.target.value)} onBlur={() => commit(row)} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setRenaming(''); } }} /></form>
        : <button type="button" className="help-history-open" aria-current={row.id === activeId ? 'true' : undefined} disabled={locked && row.id !== activeId} title={lockedTitle} onClick={() => onOpen(row)}>
          <span className="help-history-title">{row.pinned && <Pin size={11} aria-label="Pinned" />}{row.title || 'Untitled conversation'}</span>
          <small>{[when(row.updatedAt), row.preview].filter(Boolean).join(' · ')}</small>
        </button>}
      {canWrite && renaming !== row.id && <RowMenu title={row.title || 'Untitled conversation'} pinned={Boolean(row.pinned)} open={menu === row.id} onOpenChange={(next) => setMenu(next ? row.id : '')} onPin={() => onPin(row)} onRename={() => { setTitle(row.title || ''); setRenaming(row.id); }} onDelete={() => onDelete(row)} />}
    </li>)}</ul>
  </section>;
  return <div className="help-history">
    <div className="help-history-tools">
      <button type="button" className="help-new" disabled={locked} title={lockedTitle} onClick={onNew}><Plus size={14} aria-hidden="true" />New conversation</button>
      <label className="help-search"><Search size={14} aria-hidden="true" /><input type="search" aria-label="Search conversations" placeholder="Search conversations" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
    </div>
    <div className="help-history-list">
      {status === 'loading' && !rows.length ? <p className="help-history-note" role="status"><LoaderCircle className="spin" size={13} aria-hidden="true" />Loading conversations…</p>
        : status === 'error' && !rows.length ? <div className="help-history-note" role="alert"><span>Conversations couldn’t be loaded. {error}</span><button type="button" className="help-text-button" onClick={onRetry}>Try again</button></div>
        : !rows.length ? <p className="help-history-note">No conversations yet. What you ask is saved here, for you only.</p>
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
// (with a History view). seed ({ text, context, key } or { draft, key }) asks a question sent from elsewhere, with
// optional background (a report being read) that travels with the question but isn't shown as a bubble.
// onAction runs a button the answer offered (studio-actions.js runAiAction) and resolves to a short result line, false
// when the person said no, or throws; onShow starts a "Show me" tour. state (the pushed studio state) lets cards follow
// runs live; nav (studio-actions.js StudioNav) lets cards open reports and folders. page.layout ('simple' or 'classic')
// tells Ask AI which layout the person is in. onOpenSettings is passed only to people who may open Settings, so the
// "Open Settings" button on an error never shows an editor a door they can't use; copy.noPictures replaces the Settings
// hint when pictures are off for someone else to turn on.
export function HelpAssistant({ api, open, onClose, page, onOpenPage, onOpenSettings, imagesReady = false, variant = 'drawer', seed = null, onAction, onShow, starters = STARTERS, copy = {}, onOpenAssets, state = null, nav = null, workspaceId: workspaceIn }) {
  const viewer = useViewer(); // an admin previewing another role sees Ask AI as they would, but can't send
  const can = useCan();
  const confirm = useConfirm();
  const inline = variant === 'page';
  const identity = viewer.id || 'local';
  const workspaceId = workspaceIn ?? state?.contentStudio?.activeWorkspaceId ?? '';
  const persisted = typeof api?.listAskConversations === 'function' && typeof api?.readAskConversation === 'function' && can('listAskConversations');
  const memoryOn = typeof api?.listAskMemory === 'function' && can('listAskMemory');
  const [messages, setMessages] = useState([]);
  const [conversation, setConversation] = useState(null); // { id, title } once the server has the thread
  const [conversations, setConversations] = useState([]);
  const [listStatus, setListStatus] = useState('idle');
  const [listError, setListError] = useState('');
  const [listNote, setListNote] = useState('');
  const [opening, setOpening] = useState(''); // the id of a conversation being read
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(null); // { requestId, question } while a question is out
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(null); // { question, context, requestId, localId } for Ask again
  const [notice, setNotice] = useState('');
  const [enlarged, setEnlarged] = useState(null);
  const [actionState, setActionState] = useState({});
  const [panel, setPanel] = useState(''); // '' | 'history' (drawer) | 'memory'
  const [railOpen, setRailOpen] = useState(false);
  const narrow = useMedia('(max-width: 899px)');
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const seedKey = useRef(null);
  const queuedSeed = useRef(null); // a question sent from elsewhere while an answer was still coming
  const threadRef = useRef(0); // bumps on every New conversation or switch, so a late reply never lands in another thread
  const conversationRef = useRef(null); conversationRef.current = conversation;
  const messagesRef = useRef(messages); messagesRef.current = messages;
  const pendingRef = useRef(pending); pendingRef.current = pending;
  const stoppedRef = useRef('');
  const listToken = useRef(0);
  const images = useRef(new Map()); // imageId -> dataUrl, so switching back to a thread doesn't read pictures again
  const seen = useRef({ identity: null, workspaceId: null });

  useEffect(() => {
    if (!seed?.key || seed.key === seedKey.current) return;
    seedKey.current = seed.key;
    // A draft fills the box for the person to finish; text asks right away.
    if (seed.draft) { setPanel(''); setDraft(seed.draft); requestAnimationFrame(() => { const input = inputRef.current; if (input) { input.focus(); input.setSelectionRange(seed.draft.length, seed.draft.length); } }); }
    else if (seed.text) {
      setPanel('');
      // While an answer is still coming, the question (and the report it came with) waits its turn instead of being lost.
      if (pendingRef.current || opening) { queuedSeed.current = { text: seed.text, context: seed.context || '' }; setNotice('Your question will be asked as soon as this answer is done.'); }
      else ask(seed.text, seed.context);
    }
  }, [seed?.key]);
  // The waiting question goes once the answer is in; after an error (or in a preview) it waits in the box instead, so the
  // error stays readable and nothing is sent unasked.
  useEffect(() => {
    if (pending || opening || !queuedSeed.current) return;
    const next = queuedSeed.current; queuedSeed.current = null;
    if (error || viewer.preview) { setDraft(next.text); return; }
    ask(next.text, next.context);
  }, [pending, opening]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (open && !panel) requestAnimationFrame(() => inputRef.current?.focus()); }, [open]);
  useEffect(() => { const box = listRef.current; if (box) box.scrollTop = box.scrollHeight; }, [messages, pending, error]);
  // Esc: the enlarged picture, then an open panel or rail, then (drawer only) the drawer itself.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (enlarged) { event.stopPropagation(); setEnlarged(null); }
      else if (panel) { event.stopPropagation(); closePanel(); }
      else if (inline && railOpen && narrow) { event.stopPropagation(); setRailOpen(false); }
      else if (!inline) { event.stopPropagation(); onClose(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, inline, onClose, enlarged, panel, railOpen, narrow]);
  // The person's saved conversations: on mount and whenever who they are, their role or the workspace changes. A
  // different person or workspace starts clean; otherwise the thread that was open in this window opens again.
  useEffect(() => {
    if (!api?.askHelp) return;
    const changed = seen.current.identity !== null && (seen.current.identity !== identity || seen.current.workspaceId !== workspaceId);
    seen.current = { identity, workspaceId };
    if (changed) reset();
    if (persisted) refreshList({ reopen: true });
  }, [identity, viewer.role, workspaceId, persisted]);
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
      if (remembered && thread === threadRef.current && !messagesRef.current.length && !pendingRef.current && rows.some((row) => row.id === remembered)) openConversation(rows.find((row) => row.id === remembered));
    } catch (failure) { if (token === listToken.current) { setListStatus('error'); setListError(errorText(failure)); } }
  }
  function reset() {
    threadRef.current += 1; queuedSeed.current = null;
    setMessages([]); setConversation(null); setActionState({}); setError(''); setRetry(null); setNotice(''); setOpening(''); setEnlarged(null);
  }
  function startNew() {
    if (pendingRef.current) return;
    reset(); keepThread(identity, ''); setPanel(''); setRailOpen(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  }
  function closePanel() { setPanel(''); requestAnimationFrame(() => inputRef.current?.focus()); }
  const upsertRow = (row) => setConversations((rows) => scoped([{ ...(rows.find((item) => item.id === row.id) || {}), ...row }, ...rows.filter((item) => item.id !== row.id)]));
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
  async function openConversation(row) {
    if (!row?.id || pendingRef.current) return;
    setPanel(''); setRailOpen(false);
    if (conversationRef.current?.id === row.id && messagesRef.current.length) return;
    reset(); const thread = threadRef.current;
    setConversation({ id: row.id, title: row.title || '' }); setOpening(row.id); keepThread(identity, row.id);
    try {
      const result = await api.readAskConversation({ id: row.id, conversationId: row.id });
      if (thread !== threadRef.current) return;
      const record = result?.conversation?.messages ? result.conversation : result || {};
      const { rows, states } = threadFrom(record.messages);
      for (const message of rows) if (message.image?.imageId && images.current.has(message.image.imageId)) message.image = { ...message.image, dataUrl: images.current.get(message.image.imageId), status: 'ready' };
      setConversation({ id: record.id || row.id, title: record.title || row.title || '' });
      setMessages(rows); setActionState(states);
      readPictures(rows, thread);
    } catch (failure) {
      if (thread !== threadRef.current) return;
      keepThread(identity, ''); setConversation(null);
      setError(`That conversation couldn’t be opened. ${errorText(failure)}`);
    } finally { if (thread === threadRef.current) setOpening(''); }
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

  async function ask(question = draft, context = '', again = null) {
    if (viewer.preview) { setNotice(PREVIEW_TITLE); return; }
    const text = String(question).trim();
    if (!text) return;
    if (pendingRef.current || opening) { setNotice('Ask AI is still answering. Ask again once it’s done, or press Stop.'); return; }
    const background = String(context || '').slice(0, 3900);
    const requestId = again?.requestId || newRequestId();
    const localId = again?.localId || `local-${requestId}`;
    const thread = threadRef.current;
    const conversationId = conversationRef.current?.id || '';
    const before = messagesRef.current.filter((message) => message.id !== localId);
    if (!again) setMessages((current) => [...current, { id: localId, role: 'user', content: text, context: background }]);
    else setMessages((current) => current.map((message) => (message.id === localId ? { ...message, stopped: false } : message)));
    const sent = { requestId, question: text };
    pendingRef.current = sent; setPending(sent);
    setDraft(''); setError(''); setRetry(null); setNotice(''); setStopping(false); stoppedRef.current = '';
    try {
      // With a saved conversation the server builds the history itself; an older server still needs it sent.
      const reply = await api.askHelp({ question: text, requestId, page, ...(conversationId ? { conversationId } : { history: legacyHistory(before) }), ...(background ? { context: background } : {}) });
      if (thread !== threadRef.current) { refreshList(); return; }
      const server = Boolean(reply?.message);
      const message = assistantFrom(server ? reply.message : { ...reply, id: `local-a-${requestId}` });
      if (!message.id) message.id = `local-a-${requestId}`;
      if (message.image?.status === 'creating' && typeof api.createHelpImage !== 'function') message.image = null;
      const convo = server && reply.conversation?.id ? reply.conversation : null;
      if (convo) {
        setConversation({ id: convo.id, title: convo.title || conversationRef.current?.title || '' }); conversationRef.current = { id: convo.id, title: convo.title || '' };
        keepThread(identity, convo.id);
        upsertRow({ id: convo.id, title: convo.title || clip(text, 60), updatedAt: convo.updatedAt || new Date().toISOString(), workspaceId, preview: clip(message.content.replace(/[#*_`>]/g, ''), 120), messageCount: messagesRef.current.length + 1 });
      }
      const userId = server ? reply.userMessage?.id || localId : localId;
      setMessages((current) => [...current.map((row) => (row.id === localId ? { ...row, id: userId } : row)), message]);
      if (message.image?.status === 'creating') drawPicture(message.id, { title: message.image.title, prompt: message.image.prompt, size: message.image.size }, convo?.id || conversationId);
      else if (message.image?.status === 'loading') readPictures([message], thread);
      if (onShow && message.show?.autoStart) onShow(message.show.steps);
    } catch (failure) {
      if (thread !== threadRef.current) return;
      if (stoppedRef.current === requestId) {
        setMessages((current) => current.map((row) => (row.id === localId ? { ...row, stopped: true } : row)));
        setNotice('Stopped. Nothing more is spent on that question.');
        setRetry({ question: text, context: background, requestId: newRequestId(), localId });
      } else {
        setError(errorText(failure));
        setRetry({ question: text, context: background, requestId, localId }); // the same id: a reply that did arrive isn't paid for twice
      }
    } finally {
      if (pendingRef.current?.requestId === requestId) { pendingRef.current = null; setPending(null); }
      setStopping(false);
    }
  }
  async function stop() {
    const current = pendingRef.current;
    if (!current || stopping || typeof api.cancelJob !== 'function') return;
    setStopping(true); stoppedRef.current = current.requestId;
    try { await api.cancelJob(`help-${current.requestId}`); }
    catch { stoppedRef.current = ''; setStopping(false); setNotice('It’s nearly done, so it couldn’t be stopped. The answer will appear in a moment.'); }
  }
  async function download(image) {
    try { const saved = await api.saveHelpImage({ id: image.id || image.imageId }); if (saved && !saved.cancelled) setNotice(`Saved ${saved.fileName || 'the picture'}.`); }
    catch (failure) { setError(errorText(failure)); }
  }
  async function runAction(message, index) {
    const action = message.actions[index]; if (!action || !onAction) return;
    const key = `${message.id}:${index}`; const conversationId = conversationRef.current?.id || '';
    // A plan's "ask" step asks its question here (a normal Ask AI answer, with its own cost line).
    if (action.kind === 'ask') {
      if (pendingRef.current || opening || viewer.preview || !String(action.target || '').trim()) { setNotice(viewer.preview ? PREVIEW_TITLE : 'Ask AI is still answering. Try this step once it’s done.'); return; }
      const done = { status: 'done', text: 'Asked.' };
      setActionState((current) => ({ ...current, [key]: done })); record(conversationId, message.id, { index, outcome: done });
      ask(action.target);
      return;
    }
    setActionState((current) => ({ ...current, [key]: { status: 'running' } }));
    try {
      // A prompt edit is credited to this conversation (the Prompts page's History links back to it).
      const result = await onAction(action.kind === 'edit-prompt' ? { ...action, conversationId } : action);
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
      if (typeof nav?.openTarget === 'function') { nav.openTarget({ kind: link.kind, id: link.id, ...(link.kind === 'page' ? { page: link.id } : {}) }); return; }
      const ways = { report: () => nav?.openReport?.(link.id), folder: () => nav?.openFolder?.(link.id), prompt: () => nav?.openPrompt?.(link.id), page: () => onOpenPage?.(link.id), trend: () => nav?.openTab?.('trends'), run: () => nav?.openTab?.('home') };
      const way = { report: nav?.openReport, folder: nav?.openFolder, prompt: nav?.openPrompt, page: onOpenPage, trend: nav?.openTab, run: nav?.openTab }[link.kind];
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
  const needs = onAction && !messages.length ? attentionStarters(state, can).filter((row) => aiActionAllowed(row.request.kind, can)) : [];

  const last = messages[messages.length - 1];
  const busy = Boolean(pending) || Boolean(opening);
  const canStop = Boolean(pending) && typeof api.cancelJob === 'function' && can('cancelJob');
  const canEditList = !viewer.preview && can('renameAskConversation') && typeof api.renameAskConversation === 'function' && typeof api.deleteAskConversation === 'function';
  const title = conversation?.title || '';
  const settingsError = onOpenSettings && /claude|codex|api key|signed in|sign in|update|openai/i.test(error);
  const history = persisted && <ConversationList rows={conversations} status={listStatus} error={listError} note={listNote} activeId={conversation?.id || ''} locked={Boolean(pending)} canWrite={canEditList}
    onOpen={openConversation} onNew={startNew} onRename={renameConversation} onPin={pinConversation} onDelete={deleteConversation} onRetry={() => refreshList()} />;
  const memoryButton = memoryOn && <button type="button" data-spot="ask.memory" className={inline ? 'help-tool' : 'help-icon'} aria-pressed={panel === 'memory'} onClick={() => setPanel((current) => (current === 'memory' ? '' : 'memory'))} aria-label="What Ask AI remembers" title="Memory"><Brain size={inline ? 14 : 16} aria-hidden="true" />{inline && <span>Memory</span>}</button>;

  const thread = <>
    {panel === 'memory' && <MemoryPanel api={api} workspaceId={workspaceId} onClose={closePanel} />}
    {panel === 'history' && !inline && <section className="help-sheet" aria-label="Conversations"><div className="help-sheet-head"><h3><History size={16} aria-hidden="true" />Conversations</h3><button type="button" className="help-icon" onClick={closePanel} aria-label="Back to the conversation" title="Back (Esc)"><X size={16} aria-hidden="true" /></button></div>{history}</section>}
    <div className="help-messages" ref={listRef} role="log" aria-live="polite" aria-busy={busy} hidden={Boolean(panel)}>
      {opening && !messages.length && <p className="help-thinking" role="status"><LoaderCircle className="spin" size={15} aria-hidden="true" />Opening the conversation…</p>}
      {!messages.length && !opening && <div className="help-welcome">
        {inline && <span className="help-welcome-mark" aria-hidden="true"><Sparkles size={24} /></span>}
        <h3>{copy.title || 'Ask anything about Scraper Studio'}</h3>
        <p>{copy.intro || 'How a page works, what a run will cost, why something stopped, or what to do next. Answers use the app guide and your current setup.'} {imagesReady ? 'Ask for a picture and it appears right here.' : copy.noPictures || 'Add an OpenAI key in Settings → Image generation to make pictures here too.'}</p>
        {needs.length > 0 && <div className="help-starters help-needs" role="group" aria-label="Needs you now">{needs.map((row) => <button type="button" key={row.label} {...writeProps(viewer)} onClick={() => runStarter(row.request)}><span>{row.label}</span><CircleAlert size={14} aria-hidden="true" /></button>)}</div>}
        <div className="help-starters">{starters.filter((question) => imagesReady || !/image/i.test(question)).map((question) => <button type="button" key={question} {...writeProps(viewer)} onClick={() => ask(question)}><span>{question}</span>{/image/i.test(question) ? <ImageIcon size={14} aria-hidden="true" /> : <ArrowRight size={14} aria-hidden="true" />}</button>)}</div>
      </div>}
      {messages.map((message) => {
        if (message.role === 'user') return <div className="help-question" key={message.id}>{message.context && <small className="help-context"><FileText size={12} aria-hidden="true" />With the report you had open</small>}{message.content}{message.stopped && <small className="help-stopped">Stopped before answering</small>}</div>;
        const carded = cardActionIndexes(message.cards, message.actions);
        const plain = onAction ? message.actions.map((action, index) => [action, index]).filter(([action, index]) => action && !carded.has(index)) : [];
        const memoryCarded = message.cards.some((card) => card?.type === 'memory');
        const shown = studioLinks(message.content);
        return <article className="help-answer" key={message.id} aria-label="Answer">
          {message.read.length > 0 && <small className="help-read"><BookOpen size={12} aria-hidden="true" />Read {message.read.map((row) => `“${row.title}”`).join(', ')}</small>}
          <MarkdownContent>{shown.text}</MarkdownContent>
          {shown.links.length > 0 && <div className="help-pages help-links" aria-label="In this answer">{shown.links.map((link) => <button type="button" key={`${link.kind}:${link.id}`} onClick={() => openLink(link)}>{link.label}<ArrowRight size={13} aria-hidden="true" /></button>)}</div>}
          {message.cards.length > 0 && <ChatCards cards={message.cards} actions={message.actions} actionState={statesFor(message)} onAction={onAction ? (index) => runAction(message, index) : undefined} onRunAction={onAction} onOutcome={(index, outcome) => cardOutcome(message, index, outcome)} onAsk={(text) => ask(text)} onNav={nav || {}} api={api} state={state} conversationId={conversation?.id || conversationRef.current?.id || ''} />}
          {message.remembered.length > 0 && !memoryCarded && <MemoryCard card={{ type: 'memory', title: 'Remembered', data: { items: message.remembered } }} api={api} />}
          {message.show && onShow && <div className="help-show"><button type="button" onClick={() => onShow(message.show.steps)}><MousePointerClick size={14} aria-hidden="true" />{message.show.steps.length > 1 ? `Show me · ${message.show.steps.length} steps` : 'Show me'}</button></div>}
          {message.image && <Picture image={message.image} onRetry={typeof api.createHelpImage === 'function' && !viewer.preview ? () => drawPicture(message.id, { title: message.image.title, prompt: message.image.prompt, size: message.image.size }, conversation?.id || '') : null} onDownload={() => download(message.image)} onEnlarge={() => setEnlarged(message.image)} onOpenAssets={onOpenAssets} />}
          {plain.length > 0 && <div className="help-actions">{plain.map(([action, index]) => { const status = actionState[`${message.id}:${index}`]; return <div className="help-action" key={`${action.kind}-${index}`}>{status?.status === 'done' ? <span className="help-action-done"><Check size={13} aria-hidden="true" />{status.text}</span> : <button type="button" disabled={status?.status === 'running'} onClick={() => runAction(message, index)}>{status?.status === 'running' ? <LoaderCircle className="spin" size={13} aria-hidden="true" /> : <Sparkles size={13} aria-hidden="true" />}{action.label}</button>}{status?.status === 'failed' && <small role="alert">{status.text}</small>}{!status && list(action.problems).length > 0 && <small className="help-action-note">{action.problems[0]}</small>}</div>; })}</div>}
          {message.pages.length > 0 && <div className="help-pages">{message.pages.map((link) => <button type="button" key={link.page} onClick={() => onOpenPage(link.page)}>{link.label}<ArrowRight size={13} aria-hidden="true" /></button>)}</div>}
          {message === last && message.followUps.length > 0 && !pending && <div className="help-followups">{message.followUps.map((question) => <button type="button" key={question} {...writeProps(viewer)} onClick={() => ask(question)}>{question}</button>)}</div>}
          {message.receipt && <small className="help-receipt">{[message.receipt.route === 'codex' ? 'Codex (not metered)' : message.receipt.model, money(message.receipt.costUsd)].filter(Boolean).join(' · ')}</small>}
        </article>;
      })}
      {pending && <div className="help-thinking" role="status"><LoaderCircle className="spin" size={15} aria-hidden="true" /><span>{stopping ? 'Stopping…' : 'Looking at your studio…'}</span>{canStop && <button type="button" className="help-stop" disabled={stopping} onClick={stop}><Square size={11} aria-hidden="true" />Stop</button>}</div>}
      {notice && <div className="help-notice" role="status"><p>{notice}</p>{retry && !error && <button type="button" className="help-text-button" {...writeProps(viewer, busy)} onClick={() => ask(retry.question, retry.context, retry)}><RotateCcw size={13} aria-hidden="true" />Ask again</button>}</div>}
      {error && <div className="help-error" role="alert"><p>{error}</p><div className="help-error-buttons">{retry && <button type="button" {...writeProps(viewer, busy)} onClick={() => ask(retry.question, retry.context, retry)}><RotateCcw size={13} aria-hidden="true" />Ask again</button>}{settingsError && <button type="button" onClick={onOpenSettings}>Open Settings<ArrowRight size={13} aria-hidden="true" /></button>}</div></div>}
    </div>
    {!panel && <>
      <form className="help-composer" data-spot="ask.box" onSubmit={(event) => { event.preventDefault(); ask(); }}>
        <textarea ref={inputRef} rows={2} value={draft} aria-label="Question about Scraper Studio" placeholder={copy.placeholder || (imagesReady ? 'Ask how something works, or describe a picture…' : 'Ask how something works…')} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); ask(); } }} />
        <button type="submit" {...writeProps(viewer, !draft.trim() || busy)} aria-label="Send question"><ArrowUp size={16} /></button>
      </form>
      <p className="help-foot">{persisted ? 'Saved for you only. ' : ''}Answers use the studio’s AI connection, about $0.15 each on Claude (a little more when it reads a report).{imagesReady ? ' Pictures use OpenAI and cost a few cents each.' : ''} AI can be mistaken.</p>
    </>}
  </>;

  const railHidden = narrow && !railOpen;
  return <aside id={inline ? 'help-page' : 'help-drawer'} className={`help-drawer${inline ? ' help-page' : ''}${inline && persisted ? ' has-rail' : ''}${open || inline ? ' open' : ''}`} aria-label="Ask AI about Scraper Studio" aria-hidden={!open && !inline} inert={!open && !inline}>
    {inline ? <>
      {persisted && <nav className={`help-rail${railOpen ? ' is-open' : ''}`} data-spot={narrow ? undefined : 'ask.conversations'} aria-label="Ask AI conversations" aria-hidden={railHidden || undefined} inert={railHidden || undefined}>{history}</nav>}
      {persisted && narrow && railOpen && <button type="button" className="help-rail-scrim" aria-label="Close conversations" tabIndex={-1} onClick={() => setRailOpen(false)} />}
      <div className="help-main">
        <div className="help-page-tools">
          {persisted && narrow && <button type="button" data-spot="ask.conversations" className="help-tool" aria-expanded={railOpen} onClick={() => setRailOpen((value) => !value)}><MessagesSquare size={14} aria-hidden="true" /><span>Conversations</span></button>}
          {title && <span className="help-thread-title" title={title}>{title}</span>}
          <span className="help-tools-end">{memoryButton}{messages.length > 0 && <button type="button" className="help-tool" disabled={Boolean(pending)} onClick={startNew}><RotateCcw size={14} aria-hidden="true" /><span>New conversation</span></button>}</span>
        </div>
        {thread}
      </div>
    </> : <>
      <header className="help-head">
        <span className="help-mark" aria-hidden="true"><Sparkles size={17} /></span>
        <div><h2>Ask AI</h2><p title={title || undefined}>{title || copy.subtitle || 'Questions about the app, or ask for a picture'}</p></div>
        {persisted && <button type="button" data-spot="ask.conversations" className="help-icon" aria-pressed={panel === 'history'} onClick={() => { setPanel((current) => (current === 'history' ? '' : 'history')); if (panel !== 'history') refreshList(); }} aria-label="Conversations" title="Conversations"><History size={16} aria-hidden="true" /></button>}
        {memoryButton}
        {messages.length > 0 && <button type="button" className="help-icon" disabled={Boolean(pending)} onClick={startNew} aria-label="Start a new conversation" title="New conversation"><RotateCcw size={15} /></button>}
        <button type="button" className="help-icon" onClick={onClose} aria-label="Close Ask AI" title="Close (Esc)"><X size={17} /></button>
      </header>
      {thread}
    </>}
    {enlarged && <div className="help-lightbox" role="dialog" aria-modal="true" aria-label={enlarged.title} onClick={() => setEnlarged(null)}>
      <img src={enlarged.dataUrl} alt={enlarged.title} />
      <button type="button" className="help-icon" onClick={() => setEnlarged(null)} aria-label="Close picture"><X size={18} /></button>
    </div>}
  </aside>;
}
