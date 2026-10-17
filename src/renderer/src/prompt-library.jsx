import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, ChevronDown, CircleCheck, CircleX, Database, FlaskConical, History, Info, Link2, LoaderCircle, Lock, LockOpen, Pencil, RotateCcw, ScrollText, Search, Sparkles, Square, TriangleAlert, Eye } from 'lucide-react';
import { useConfirm } from './confirm-dialog.jsx';
import { useUnsavedGuard } from './asset-editor.jsx';
import { Dialog, DialogClose, copyText, useNarrow, useToast } from './role-screens.jsx';
import { adminNames, formatDay, formatTime, plural, useCan, useViewer, writeProps } from './viewer.js';
import { linkFor, shareOrigin, LINK_COPIED } from './deep-links.js';
import { money } from './studio-actions.js';
import { modelLabel, number } from './ui.jsx';
import './prompt-library.css';

// Prompts (SPEC-2 §A): every prompt behind research, reports, channel assets, pictures, Ask AI and the data tools, read
// from the content workspace's Prompt Library API. A list on the left (search, registry groups, badges); on the right the
// prompt with three tabs: Edit (the prompt in order: fixed parts with their reason, data sections, and the editable
// parts with value chips, live checks and Reset), Preview (the real prompt on a recent run or the bundled sample, editable
// spans highlighted, with its size and price, and a confirmed paid Test run), and History (versions, compare, restore,
// and an admin's Lock). The server checks every save again (validateBlocks), versions it and refuses stale or locked
// edits; the renderer only shows what it would say. Works in both layouts and down to 360px.
//
// <PromptLibrary api state viewer can request onAsk onNotice linkOrigin />
//   request    { promptId, key, tab? }: open that prompt once per key (Ask AI's Open in Prompts, share links, the Inbox)
//   onAsk      (text, context) => void: Ask AI about the open prompt (absent: no button)
//   onNotice   (text) => void: the layout's toast (absent: the page shows its own)
//   linkOrigin the share-link origin (deep-links.js shareOrigin); defaults from the viewer and settings
const list = (value) => (Array.isArray(value) ? value : []);
const messageOf = (failure) => String(failure?.message || failure || 'Something went wrong. Try again.').replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
const normalize = (text) => String(text ?? '').replace(/\r\n?/g, '\n');
const fmt = (value) => Number(value).toLocaleString('en-US');
const PLACEHOLDER = /\{\{([a-zA-Z][a-zA-Z0-9]*)\}\}/g;
// The studio's own section markers (src/shared/prompt-template.js RESERVED). An edit may keep the mentions its default
// makes but never add one; the server checks the same list, plus secret-shaped text.
const RESERVED = ['SYSTEM INSTRUCTIONS', '\nTASK\n', 'UNTRUSTED_SOURCE_AND_BRAND_DATA', 'RAW DATA BATCH', 'SOURCE_ITEMS', 'SOURCES (untrusted', 'LIVE CONTEXT', 'LOOKUP RESULTS', 'YOUR PREVIOUS RESPONSE WAS REJECTED'];
const MAX_PROMPT_CHARS = 40000;
const NOTE_MAX = 200;
const PREVIEW_SHOWN = 80000; // characters drawn at once; the rest is one click away
const SELECTED_KEY = 'studio.prompts.selected';
const TABS = [{ id: 'edit', label: 'Edit', Icon: Pencil, spot: 'prompts.edit' }, { id: 'preview', label: 'Preview', Icon: Eye, spot: 'prompts.preview' }, { id: 'history', label: 'History', Icon: History, spot: 'prompts.history' }];
const ROUTE_LABELS = { claude: 'the Claude app', 'claude-api': 'the Claude API key', codex: 'Codex', openai: 'OpenAI' };
const SOURCE_LABELS = { library: 'Prompts', 'ask-ai': 'Ask AI', restore: 'Restore' };
const SAMPLE_LABELS = { latest: 'Latest run', bundled: 'Sample data' };
const readSelected = () => { try { return window.localStorage?.getItem(SELECTED_KEY) || ''; } catch { return ''; } };
const saveSelected = (id) => { try { window.localStorage?.setItem(SELECTED_KEY, id); } catch { /* the choice still holds while the page is open */ } };
// "Oct 15, 2:14 PM", or "2:14 PM" today.
const when = (value) => { const date = new Date(value || 0); if (!value || Number.isNaN(date.getTime())) return ''; return date.toDateString() === new Date().toDateString() ? formatTime(value) : `${formatDay(value)}, ${formatTime(value)}`; };

// ---------- Checks (the light half of prompt-template.js validateBlocks, in the same words) ----------
const occurrences = (text, term) => text.split(term).length - 1;
export function checkBlock(block, value, original = '') {
  const text = normalize(value); const label = block?.label || 'This part'; const out = [];
  if (!block?.editable) return out;
  if (!text.trim() && !block.allowEmpty) return [`${label} can’t be empty. Use Reset this block to go back to the default.`];
  if (block.maxChars && text.length > block.maxChars) out.push(`${label} is ${fmt(text.length)} characters; keep it to ${fmt(block.maxChars)}.`);
  if (/[-]/.test(text)) out.push(`${label} contains hidden marker characters. Retype the text instead of pasting it from the preview.`);
  const known = new Set(list(block.variables).map((variable) => variable.name)); const used = [...text.matchAll(PLACEHOLDER)].map((match) => match[1]);
  for (const name of new Set(used.filter((entry) => !known.has(entry)))) out.push(known.size ? `{{${name}}} isn’t a value this part can use. Use one of: ${[...known].map((entry) => `{{${entry}}}`).join(', ')}.` : `{{${name}}} isn’t a value this part can use; this part takes no values.`);
  for (const name of list(block.requiredVariables)) if (!used.includes(name)) out.push(`${label} must keep {{${name}}}: the studio fills it in for every run.`);
  if (/\{\{|\}\}/.test(text.replace(PLACEHOLDER, ''))) out.push(`${label} has a stray {{ or }}. Values look like {{name}}.`);
  for (const term of list(block.requiredTerms)) if (!text.includes(term)) out.push(`${label} must still mention “${term}”: the studio reads that field back.`);
  if (block.lines) {
    const count = text.split('\n').filter((line) => line.trim()).length;
    if (count < block.lines.min || count > block.lines.max) out.push(block.lines.min === block.lines.max ? `${label} needs exactly ${block.lines.min} lines (one per line); it has ${count}.` : `${label} needs ${block.lines.min} to ${block.lines.max} lines; it has ${count}.`);
  }
  for (const marker of RESERVED) if (occurrences(text, marker) > occurrences(normalize(original), marker)) out.push(`${label} can’t add “${marker.trim()}”: the studio uses it to mark where its own sections start.`);
  return out;
}
// Every word of the search in the name, what it's used for, the description or the id.
export function matchPrompt(row, query) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = [row?.name, row?.description, row?.id, ...list(row?.powers)].join(' ').toLowerCase();
  return words.every((word) => hay.includes(word));
}
// What the header says the prompt runs on.
export function runsOn(detail) {
  if (!detail) return '';
  if (detail.route === 'openai') return `Draws with ${detail.modelLabel || 'the image model'}`;
  if (!detail.model) return detail.prompt?.group === 'system' ? 'Sent with the studio’s AI calls' : 'Doesn’t call a model on its own';
  if (detail.route === 'codex') return 'Runs on Codex (not metered)';
  return `Runs on ${detail.modelLabel || detail.model}${detail.effort ? ` · ${detail.effort} effort` : ''}`;
}
// The prompt in order for the Edit tab: the registry layout, then any part the layout doesn't place (report presets,
// picture purposes: the studio picks one per run). Parts another edition has are left out.
export function promptParts(entry) {
  const blocks = new Map(list(entry?.blocks).map((block) => [block.id, block])); const placed = new Set(); const parts = [];
  for (const row of list(entry?.layout)) {
    if (row.kind === 'block') { const block = blocks.get(row.blockId); if (block) { placed.add(block.id); parts.push({ kind: 'block', block }); } }
    else parts.push(row.kind === 'data' ? { kind: 'data', label: row.label } : { kind: 'fixed', label: row.label, reason: row.reason || '' });
  }
  const rest = list(entry?.blocks).filter((block) => !placed.has(block.id));
  return { parts, rest };
}
const editableBlocks = (entry) => list(entry?.blocks).filter((block) => block.editable);
// The draft's blocks that differ from the saved text.
const changedBlocks = (detail, drafts) => Object.fromEntries(Object.entries(drafts || {}).filter(([blockId, text]) => typeof text === 'string' && normalize(text) !== normalize(detail?.blocks?.[blockId] ?? '')));

// ---------- Diff (shared with Ask AI's prompt-change card) ----------
const CONTEXT = 2;
// Runs of unchanged lines longer than the context around them fold into one "unchanged lines" button.
function foldDiff(lines) {
  const rows = list(lines); const out = []; let at = 0;
  while (at < rows.length) {
    if (rows[at].op !== 'same') { out.push({ line: rows[at], index: at }); at++; continue; }
    let end = at; while (end < rows.length && rows[end].op === 'same') end++;
    const head = at === 0 ? 0 : CONTEXT; const tail = end === rows.length ? 0 : CONTEXT;
    if (end - at > head + tail + 1) {
      for (let i = at; i < at + head; i++) out.push({ line: rows[i], index: i });
      out.push({ fold: { from: at + head, to: end - tail } });
      for (let i = end - tail; i < end; i++) out.push({ line: rows[i], index: i });
    } else for (let i = at; i < end; i++) out.push({ line: rows[i], index: i });
    at = end;
  }
  return out;
}
export const diffCounts = (lines) => ({ added: list(lines).filter((line) => line?.op === 'add').length, removed: list(lines).filter((line) => line?.op === 'del').length });
export function PromptDiff({ lines, label = 'Changes', className = '' }) {
  const [open, setOpen] = useState(() => new Set());
  const rows = list(lines);
  const folded = useMemo(() => foldDiff(rows), [lines]);
  const { added, removed } = diffCounts(rows);
  if (!rows.length) return <p className={`pdiff-empty ${className}`}>No changes.</p>;
  if (!added && !removed) return <p className={`pdiff-empty ${className}`}>No changes: this is the same text.</p>;
  const line = ({ op, text }, index) => <li key={index} className={`pdiff-line is-${op}`}><span className="pdiff-sign" aria-hidden="true">{op === 'add' ? '+' : op === 'del' ? '−' : ' '}</span><span className="pdiff-sr">{op === 'add' ? 'Added: ' : op === 'del' ? 'Removed: ' : ''}</span><span className="pdiff-text">{text || ' '}</span></li>;
  return <ol className={`pdiff ${className}`} aria-label={`${label}: ${plural(added, 'line')} added, ${plural(removed, 'line')} removed`}>
    {folded.map((row, at) => {
      if (row.line) return line(row.line, row.index);
      const key = row.fold.from;
      if (open.has(key)) return rows.slice(row.fold.from, row.fold.to).map((entry, offset) => line(entry, row.fold.from + offset));
      return <li key={`fold-${at}`} className="pdiff-fold"><button type="button" onClick={() => setOpen((current) => new Set([...current, key]))}><ChevronDown size={13} aria-hidden="true" />{`Show ${plural(row.fold.to - row.fold.from, 'unchanged line')}`}</button></li>;
    })}
  </ol>;
}

// ---------- The page ----------
export function PromptLibrary({ api, state, viewer: viewerIn, can: canIn, request = null, onAsk, onNotice, linkOrigin }) {
  const contextViewer = useViewer(); const contextCan = useCan(); const confirm = useConfirm();
  const viewer = viewerIn || contextViewer; const can = canIn || contextCan;
  const narrow = useNarrow();
  const [toast, showToast] = useToast();
  const notify = (text) => (onNotice ? onNotice(text) : showToast(text));
  const studio = state?.contentStudio || {};
  const workspaceId = studio.activeWorkspaceId || '';
  const changes = list(studio.promptChanges);
  const changeKey = changes.slice(0, 3).map((row) => `${row.promptId}:${row.version}:${row.at}`).join('|');
  const askAdmin = adminNames(state, 'an admin');
  const origin = linkOrigin ?? shareOrigin({ web: Boolean(viewer?.web), settings: state?.settings });
  const titleId = useId();
  const allowed = can('listPrompts'); // the nav hides the page otherwise; a stale link still lands on a plain note

  const [catalog, setCatalog] = useState({ status: 'loading', groups: [], prompts: [], error: '' });
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [showDetail, setShowDetail] = useState(false); // narrow: the prompt instead of the list
  const [detail, setDetail] = useState({ status: 'idle', data: null, error: '' });
  const [tab, setTab] = useState('edit');
  const [drafts, setDrafts] = useState({});
  // Each prompt's latest test run (`${workspaceId}:${promptId}` → its state), kept here so a paid test that's still
  // running, or its result, is still shown after a look at Edit or History or another prompt.
  const [tests, setTests] = useState({});
  const [saving, setSaving] = useState(false);
  const loads = useRef(0); const reads = useRef(0); const handled = useRef(null);
  const backRef = useRef(null); const listRef = useRef(null); const wasHidden = useRef(false);
  const data = detail.data;
  const changed = data ? changedBlocks(data, drafts) : {};
  const dirty = Object.keys(changed).length > 0;
  const dirtyRef = useRef(dirty); dirtyRef.current = dirty;
  // App's unsaved guard: the sidebar, shortcuts, the palette and Ask AI ask before leaving a prompt with unsaved edits.
  const guard = useUnsavedGuard(); const guardKey = useId();
  useEffect(() => { guard.set(guardKey, dirty); }, [dirty]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => guard.set(guardKey, false), []); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadCatalog() {
    if (typeof api?.listPrompts !== 'function') { setCatalog({ status: 'error', groups: [], prompts: [], error: 'Prompts aren’t available in this version of the studio.' }); return null; }
    const id = ++loads.current;
    setCatalog((current) => ({ ...current, status: current.prompts.length ? 'ready' : 'loading', error: '' }));
    try {
      const result = await api.listPrompts();
      if (id !== loads.current) return null;
      setCatalog({ status: 'ready', groups: list(result?.groups), prompts: list(result?.prompts), editionId: result?.editionId || '', error: '' });
      return list(result?.prompts);
    } catch (failure) { if (id === loads.current) setCatalog((current) => ({ ...current, status: 'error', error: messageOf(failure) })); return null; }
  }
  async function loadDetail(id, { keepDrafts = false } = {}) {
    if (!id || typeof api?.readPrompt !== 'function') return;
    const read = ++reads.current;
    setDetail((current) => ({ status: current.data?.prompt?.id === id ? 'refreshing' : 'loading', data: current.data?.prompt?.id === id ? current.data : null, error: '' }));
    if (!keepDrafts) setDrafts({});
    try {
      const result = await api.readPrompt({ id });
      if (read !== reads.current) return;
      setDetail({ status: 'ready', data: result, error: '' });
    } catch (failure) { if (read === reads.current) setDetail({ status: 'error', data: null, error: messageOf(failure) }); }
  }
  // The list on open, after a workspace switch, and when someone saves a prompt (promptChanges in the pushed state).
  useEffect(() => {
    let live = true;
    if (!allowed) return undefined;
    loadCatalog().then((rows) => {
      if (!live || !rows) return;
      setSelectedId((current) => {
        const wanted = current && rows.some((row) => row.id === current) ? current : rows.some((row) => row.id === readSelected()) ? readSelected() : rows[0]?.id || '';
        return wanted;
      });
    });
    return () => { live = false; };
  }, [workspaceId, changeKey, allowed]); // eslint-disable-line react-hooks/exhaustive-deps
  // choose() has already asked about unsaved edits; a workspace switch drops them (they belong to the other workspace).
  useEffect(() => { if (selectedId && allowed) loadDetail(selectedId); }, [selectedId, workspaceId]); // eslint-disable-line react-hooks/exhaustive-deps
  // Someone else's save while this prompt is open: fresh text when nothing is being edited; otherwise a note (below).
  const savedElsewhere = data && changes.find((row) => row.promptId === data.prompt?.id && row.current && Number(row.version) > Number(data.version));
  useEffect(() => { if (savedElsewhere && !dirtyRef.current) loadDetail(data.prompt.id); }, [savedElsewhere?.version]); // eslint-disable-line react-hooks/exhaustive-deps
  // A prompt asked for from elsewhere, once per key.
  useEffect(() => {
    if (!request?.key || handled.current === request.key || !request.promptId) return;
    handled.current = request.key;
    choose(request.promptId, { tab: request.tab });
  }, [request?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  // Unsaved edits live only on this page; in the browser studio a reload or a closed tab asks first. (Not on the Mac: an
  // Electron window would refuse to close without asking.)
  useEffect(() => {
    if (!dirty || !viewer?.web) return undefined;
    const warn = (event) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, viewer?.web]);

  async function choose(id, { tab: nextTab } = {}) {
    if (!id) return;
    if (id !== selectedId && dirtyRef.current) {
      const ok = await confirm({ title: `Discard your changes to “${data?.prompt?.name || 'this prompt'}”?`, lines: [`${plural(Object.keys(changed).length, 'part')} you changed ${Object.keys(changed).length === 1 ? 'isn’t' : 'aren’t'} saved yet.`], confirmLabel: 'Discard changes', cancelLabel: 'Keep editing', tone: 'danger' });
      if (!ok) return;
      setDrafts({});
    }
    if (TABS.some((row) => row.id === nextTab)) setTab(nextTab);
    setSelectedId(id); saveSelected(id); setShowDetail(true);
  }

  const rows = catalog.prompts;
  const row = rows.find((entry) => entry.id === selectedId) || null;
  const entry = data?.prompt?.id === selectedId ? data.prompt : null;
  const lockedForYou = Boolean(data?.lockedForYou);
  const mayEdit = can('savePromptVersion') && typeof api?.savePromptVersion === 'function';
  const editable = editableBlocks(entry).length > 0;
  const readOnly = !mayEdit || lockedForYou || Boolean(viewer?.preview) || !editable;
  const fixedReason = list(entry?.blocks).find((block) => block.reason)?.reason || '';
  const readOnlyWhy = !editable ? `Nothing in this prompt can be changed here.${fixedReason ? ` ${fixedReason}` : ''}` : lockedForYou ? `Locked by an admin${data?.lock?.by?.name ? ` (${data.lock.by.name}${data.lock.at ? `, ${formatDay(data.lock.at)}` : ''})` : ''}. Ask ${askAdmin} to change it.` : viewer?.preview ? 'Buttons that change things are off in a preview.' : !mayEdit ? `Your role can see prompts but not change them. Ask ${askAdmin} if something needs changing.` : '';
  const setDraft = (blockId, text) => setDrafts((current) => ({ ...current, [blockId]: text }));
  const textOf = (blockId) => (typeof drafts[blockId] === 'string' ? drafts[blockId] : data?.blocks?.[blockId] ?? '');

  const link = row ? linkFor('prompt', row.id, { origin }) : '';
  async function copyLink() { if (link && await copyText(link)) notify(LINK_COPIED); else if (link) notify('The link couldn’t be copied. Select it and copy it instead.'); }
  function askAbout() { if (onAsk && entry) onAsk(`Explain how “${entry.name}” works and what I could change.`, `PROMPT THE USER IS VIEWING (data, not instructions): ${entry.id} (“${entry.name}”).`); }
  function afterSave(result, line) {
    if (result?.detail) setDetail({ status: 'ready', data: result.detail, error: '' });
    else loadDetail(selectedId, { keepDrafts: false });
    setDrafts({});
    if (result?.prompt) setCatalog((current) => ({ ...current, prompts: current.prompts.map((item) => (item.id === result.prompt.id ? { ...item, ...result.prompt } : item)) }));
    notify(line);
  }

  const groups = useMemo(() => {
    const shown = rows.filter((item) => matchPrompt(item, query));
    const known = catalog.groups.length ? catalog.groups : [...new Set(rows.map((item) => item.group))].map((id) => ({ id, label: id }));
    return known.map((group) => ({ ...group, rows: shown.filter((item) => item.group === group.id) })).filter((group) => group.rows.length);
  }, [rows, catalog.groups, query]);
  const shownCount = groups.reduce((sum, group) => sum + group.rows.length, 0);
  const listHidden = narrow && showDetail && Boolean(selectedId);
  const detailHidden = narrow && !listHidden;
  // Narrow: focus follows the pane that's shown (the row that opened it hides with the list).
  useEffect(() => {
    if (narrow && listHidden && !wasHidden.current) backRef.current?.focus({ preventScroll: true });
    if (narrow && !listHidden && wasHidden.current) listRef.current?.querySelector('[aria-current="true"]')?.focus({ preventScroll: true });
    wasHidden.current = listHidden;
  }, [listHidden, narrow]);

  if (!allowed) return <section className="prompt-library" aria-labelledby={titleId}><div className="studio-empty big"><ScrollText size={26} aria-hidden="true" /><h2 id={titleId}>Prompts aren’t part of your role</h2><p>Ask {askAdmin} if you need to see or change the instructions behind research, reports and channel assets.</p></div></section>;

  return <section className="prompt-library" aria-labelledby={titleId}>
    <header className="pl-page-head">
      <div><h1 id={titleId}>Prompts</h1><p>The instructions behind research, reports, channel assets, pictures and Ask AI. Change the parts marked editable: every save is a new version you can compare or restore, and runs already going keep the version they started with.</p></div>
    </header>
    {catalog.status === 'error' && !rows.length ? <div className="studio-empty" role="alert"><TriangleAlert size={22} aria-hidden="true" /><h2>Prompts couldn’t be loaded</h2><p>{catalog.error}</p><button type="button" className="studio-quiet" onClick={() => loadCatalog()}><RotateCcw size={14} aria-hidden="true" />Try again</button></div>
      : <div className={`pl-panes${listHidden ? ' is-detail' : ''}`}>
        <nav ref={listRef} className="pl-list" aria-label="All prompts" data-spot="prompts.list" hidden={listHidden || undefined}>
          <label className="pl-search"><Search size={15} aria-hidden="true" /><span className="pl-sr">Search prompts</span><input type="search" value={query} placeholder="Search prompts" onChange={(event) => setQuery(event.target.value)} /></label>
          {catalog.status === 'loading' ? <div className="studio-skeleton" aria-label="Loading prompts" role="status"><span /><span /><span /><span /></div>
            : !rows.length ? <p className="pl-quiet">This workspace has no prompts to show.</p>
            : !shownCount ? <p className="pl-quiet" role="status">No prompt matches “{query.trim()}”.</p>
            : <>{query.trim() && <p className="pl-sr" role="status">{plural(shownCount, 'prompt')} found.</p>}{groups.map((group) => <section key={group.id} className="pl-group" aria-labelledby={`${titleId}-${group.id}`}>
              <h2 id={`${titleId}-${group.id}`} className="pl-group-label">{group.label}</h2>
              <ul>{group.rows.map((item) => <li key={item.id}><PromptRow row={item} current={item.id === selectedId} onSelect={() => choose(item.id)} /></li>)}</ul>
            </section>)}</>}
        </nav>
        <div className="pl-detail" hidden={detailHidden || undefined}>
          {narrow && <button ref={backRef} type="button" className="pl-back" onClick={() => setShowDetail(false)}><ArrowLeft size={15} aria-hidden="true" />All prompts</button>}
          {!selectedId ? <div className="studio-empty"><ScrollText size={22} aria-hidden="true" /><h2>Choose a prompt</h2><p>Pick one on the left to read it, change it, preview it or see its history.</p></div>
            : detail.status === 'error' ? <div className="studio-empty" role="alert"><TriangleAlert size={22} aria-hidden="true" /><h2>This prompt couldn’t be opened</h2><p>{detail.error}</p><button type="button" className="studio-quiet" onClick={() => loadDetail(selectedId)}><RotateCcw size={14} aria-hidden="true" />Try again</button></div>
            : !entry ? <div className="studio-skeleton" role="status" aria-label="Opening the prompt"><span /><span /><span /><span /></div>
            : <article className="pl-prompt" aria-labelledby={`${titleId}-name`} aria-busy={detail.status === 'refreshing'}>
              <header className="pl-head">
                <div className="pl-head-text">
                  <span className="pl-kicker">{catalog.groups.find((group) => group.id === entry.group)?.label || 'Prompt'}</span>
                  <h2 id={`${titleId}-name`}>{entry.name}</h2>
                  <p>{entry.description}</p>
                  <p className="pl-meta">{[runsOn(data), list(entry.powers).length ? `Used for ${list(entry.powers).join(' · ')}` : ''].filter(Boolean).join(' · ')}</p>
                  <PromptBadges row={row || { ...data, editable }} detail={data} />
                </div>
                <div className="pl-head-tools">
                  {onAsk && <button type="button" className="studio-quiet pl-ask" data-spot="prompts.ask" {...writeProps(viewer)} onClick={askAbout}><Sparkles size={15} aria-hidden="true" />Ask AI about this prompt</button>}
                  {link && <button type="button" className="studio-quiet" onClick={copyLink}><Link2 size={15} aria-hidden="true" />Copy link</button>}
                </div>
              </header>
              {data.damaged && <p className="pl-note is-warn" role="status"><TriangleAlert size={15} aria-hidden="true" />This prompt’s saved file couldn’t be read, so it’s back on the studio’s default. The damaged file was kept next to it.</p>}
              {savedElsewhere && dirty && !saving && <div className="pl-note is-warn" role="status"><TriangleAlert size={15} aria-hidden="true" /><span>{savedElsewhere.byName || 'Someone'} saved version {savedElsewhere.version} while you were editing. Reload to see it; your edits stay.</span><button type="button" className="studio-link" onClick={() => loadDetail(selectedId, { keepDrafts: true })}>Reload</button></div>}
              <PromptTabs tab={tab} onTab={setTab} idBase={titleId} dirty={dirty} />
              <div id={`${titleId}-panel-${tab}`} role="tabpanel" aria-labelledby={`${titleId}-tab-${tab}`} className="pl-panel" tabIndex={-1}>
                {tab === 'edit' && <EditTab key={entry.id} detail={data} parts={promptParts(entry)} textOf={textOf} setDraft={setDraft} changed={changed} readOnly={readOnly} readOnlyWhy={readOnlyWhy} saving={saving} onDiscard={() => setDrafts({})} onSave={() => setSaving(true)} />}
                {tab === 'preview' && <PreviewTab key={entry.id} api={api} state={state} detail={data} drafts={changed} viewer={viewer} can={can} confirm={confirm} lockedForYou={lockedForYou}
                  test={tests[`${workspaceId}:${entry.id}`] || IDLE_TEST} setTest={(next) => setTests((current) => ({ ...current, [`${workspaceId}:${entry.id}`]: next }))}
                  onTested={(record) => record?.id && setDetail((current) => (current.data?.prompt?.id === entry.id ? { ...current, data: { ...current.data, tests: [record, ...list(current.data.tests).filter((row) => row.id !== record.id)].slice(0, 10) } } : current))} />}
                {tab === 'history' && <HistoryTab key={entry.id} api={api} detail={data} viewer={viewer} can={can} confirm={confirm} dirty={dirty} onChanged={afterSave} onDetail={(next) => { setDetail({ status: 'ready', data: next, error: '' }); setCatalog((current) => ({ ...current, prompts: current.prompts.map((item) => (item.id === next?.prompt?.id ? { ...item, locked: Boolean(next.locked) } : item)) })); }} />}
              </div>
            </article>}
        </div>
      </div>}
    {saving && data && <SaveDialog api={api} detail={data} changed={changed} onClose={() => setSaving(false)} onReload={() => loadDetail(selectedId, { keepDrafts: true })} onSaved={(result) => { setSaving(false); afterSave(result, result?.changed === false ? 'Nothing changed: that’s already the saved text.' : `Saved version ${result?.version} of “${data.prompt.name}”.`); }} />}
    {!onNotice && toast}
  </section>;
}

function PromptRow({ row, current, onSelect }) {
  return <button type="button" className={`pl-row${current ? ' is-current' : ''}`} aria-current={current ? 'true' : undefined} onClick={onSelect}>
    <span className="pl-row-name">{row.name}</span>
    {list(row.powers).length > 0 && <span className="pl-row-used">Used for {list(row.powers).join(' · ')}</span>}
    <PromptBadges row={row} compact />
  </button>;
}
function PromptBadges({ row, detail = null, compact = false }) {
  const by = row?.updatedBy?.name || detail?.updatedBy?.name || '';
  const at = row?.updatedAt || detail?.updatedAt || '';
  const badges = [
    row?.custom || list(detail?.customized).length ? { key: 'custom', tone: 'is-custom', text: ['Customized', row?.version ? `v${row.version}` : '', by, at ? formatDay(at) : ''].filter(Boolean).join(' · ') } : null,
    row?.defaultChanged || list(detail?.defaultChanged).length ? { key: 'default', tone: 'is-warn', text: 'Default updated' } : null,
    row?.locked || detail?.locked ? { key: 'locked', tone: 'is-locked', text: 'Locked', Icon: Lock } : null,
    row && row.editable === false ? { key: 'fixed', tone: 'is-fixed', text: 'View only' } : null,
  ].filter(Boolean);
  if (!badges.length) return compact ? null : <span className="pl-badges"><span className="pl-badge">Studio default</span></span>;
  return <span className="pl-badges">{badges.map((badge) => <span key={badge.key} className={`pl-badge ${badge.tone}`}>{badge.Icon && <badge.Icon size={11} aria-hidden="true" />}{badge.text}</span>)}</span>;
}

function PromptTabs({ tab, onTab, idBase, dirty }) {
  const refs = useRef({});
  function onKeyDown(event) {
    const at = TABS.findIndex((row) => row.id === tab); let next = null;
    if (event.key === 'ArrowRight') next = TABS[(at + 1) % TABS.length]; else if (event.key === 'ArrowLeft') next = TABS[(at - 1 + TABS.length) % TABS.length];
    else if (event.key === 'Home') next = TABS[0]; else if (event.key === 'End') next = TABS[TABS.length - 1];
    if (!next) return;
    event.preventDefault(); onTab(next.id); refs.current[next.id]?.focus();
  }
  return <div className="pl-tabs" role="tablist" aria-label="Prompt views" onKeyDown={onKeyDown}>
    {TABS.map(({ id, label, Icon, spot }) => <button key={id} ref={(node) => { refs.current[id] = node; }} type="button" role="tab" id={`${idBase}-tab-${id}`} aria-selected={tab === id} aria-controls={tab === id ? `${idBase}-panel-${id}` : undefined} tabIndex={tab === id ? 0 : -1} data-spot={spot} onClick={() => onTab(id)}><Icon size={14} aria-hidden="true" />{label}{id === 'edit' && dirty && <><span className="pl-dot" aria-hidden="true" /><span className="pl-sr"> (unsaved changes)</span></>}</button>)}
  </div>;
}

// ---------- Edit ----------
function EditTab({ detail, parts, textOf, setDraft, changed, readOnly, readOnlyWhy, saving, onDiscard, onSave }) {
  const id = useId(); const entry = detail.prompt; const enforced = list(entry.enforced);
  const blocks = editableBlocks(entry);
  const problems = blocks.flatMap((block) => (Object.prototype.hasOwnProperty.call(changed, block.id) ? checkBlock(block, textOf(block.id), detail.defaults?.[block.id] ?? '') : []));
  const total = blocks.reduce((sum, block) => sum + normalize(textOf(block.id)).length, 0);
  if (total > MAX_PROMPT_CHARS) problems.push(`Together the editable parts are ${fmt(total)} characters; keep them to ${fmt(MAX_PROMPT_CHARS)}.`);
  const count = Object.keys(changed).length;
  const firstEditable = blocks[0]?.id;
  const renderBlock = (block) => (block.editable
    ? <BlockEditor key={block.id} block={block} text={textOf(block.id)} saved={detail.blocks?.[block.id] ?? ''} original={detail.defaults?.[block.id] ?? ''} customized={list(detail.customized).includes(block.id)} defaultChanged={list(detail.defaultChanged).includes(block.id)} readOnly={readOnly} spot={block.id === firstEditable ? 'prompts.block' : undefined} onChange={(text) => setDraft(block.id, text)} />
    : <FixedBlock key={block.id} block={block} text={detail.blocks?.[block.id] ?? ''} />);
  const { rest } = parts;
  return <div className="pl-edit">
    {readOnlyWhy && <p className={`pl-note${detail.lockedForYou ? ' is-lock' : ''}`} role="note">{detail.lockedForYou ? <Lock size={15} aria-hidden="true" /> : <Info size={15} aria-hidden="true" />}{readOnlyWhy}</p>}
    {enforced.length > 0 && <details className="pl-rules"><summary><Check size={14} aria-hidden="true" />Rules the studio enforces · {enforced.length}<ChevronDown size={14} aria-hidden="true" /></summary><p className="pl-quiet">The studio checks every answer against these, whatever the prompt says. An edit that contradicts one makes the step fail.</p><ul>{enforced.map((rule) => <li key={rule}>{rule}</li>)}</ul></details>}
    <ol className="pl-parts" aria-label="The prompt, in order">
      {parts.parts.map((part, index) => <li key={part.kind === 'block' ? part.block.id : `${part.kind}-${index}`} className={`pl-part is-${part.kind === 'block' ? (part.block.editable ? 'block' : 'fixed') : part.kind}`}>
        {part.kind === 'block' ? renderBlock(part.block)
          : part.kind === 'data' ? <div className="pl-slot"><Database size={14} aria-hidden="true" /><div><strong>{part.label}</strong><span>Data from the run goes here.</span></div></div>
          : <div className="pl-slot"><Lock size={14} aria-hidden="true" /><div><strong>{part.label}</strong>{part.reason && <span>{part.reason}</span>}</div></div>}
      </li>)}
    </ol>
    {rest.length > 0 && <section className="pl-case" aria-labelledby={`${id}-case`}><h3 id={`${id}-case`}>Used case by case</h3><p className="pl-quiet">The studio uses one of these for each run, depending on what it’s making.</p><ol className="pl-parts">{rest.map((block) => <li key={block.id} className={`pl-part is-${block.editable ? 'block' : 'fixed'}`}>{renderBlock(block)}</li>)}</ol></section>}
    {!readOnly && count > 0 && <div className="pl-savebar" data-spot="prompts.save" role="region" aria-label="Unsaved changes">
      <span><strong>{plural(count, 'part')} changed</strong>{problems.length > 0 && <small className="pl-problem-count"><TriangleAlert size={13} aria-hidden="true" />{plural(problems.length, 'thing')} to fix first</small>}</span>
      <span className="pl-savebar-buttons"><button type="button" className="studio-quiet" disabled={saving} onClick={onDiscard}>Discard</button><button type="button" className="studio-primary" disabled={saving || problems.length > 0} title={problems.length ? 'Fix the problems shown in the changed parts first.' : undefined} onClick={onSave}>Save as version {(Number(detail.version) || 0) + 1}…</button></span>
      {total > MAX_PROMPT_CHARS && <p className="pl-problem" role="alert">{problems[problems.length - 1]}</p>}
    </div>}
  </div>;
}

function BlockEditor({ block, text, saved, original, customized, defaultChanged, readOnly, spot, onChange }) {
  const id = useId(); const area = useRef(null);
  const [showDefault, setShowDefault] = useState(false);
  const problems = normalize(text) === normalize(saved) ? [] : checkBlock(block, text, original);
  const edited = normalize(text) !== normalize(saved);
  const atDefault = normalize(text) === normalize(original);
  const rows = Math.max(3, Math.min(22, normalize(text).split('\n').length + 1));
  // The box grows with its text (wrapped lines included) up to a comfortable height, then scrolls.
  useLayoutEffect(() => {
    const node = area.current; if (!node || typeof window === 'undefined') return undefined;
    const fit = () => { node.style.height = 'auto'; if (node.scrollHeight) node.style.height = `${Math.min(node.scrollHeight + 2, 560)}px`; };
    fit(); window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [text]);
  const required = new Set(list(block.requiredVariables));
  const lineCount = block.lines ? normalize(text).split('\n').filter((line) => line.trim()).length : 0;
  // A value goes in where the cursor is, and the cursor lands after it.
  function insert(name) {
    const node = area.current; const token = `{{${name}}}`;
    const start = node ? node.selectionStart ?? text.length : text.length; const end = node ? node.selectionEnd ?? start : start;
    onChange(`${text.slice(0, start)}${token}${text.slice(end)}`);
    (window.requestAnimationFrame || setTimeout)(() => { if (!area.current) return; area.current.focus(); area.current.setSelectionRange(start + token.length, start + token.length); });
  }
  return <section className={`pl-block${edited ? ' is-edited' : ''}${problems.length ? ' has-problems' : ''}`} aria-labelledby={`${id}-label`} data-spot={spot}>
    <div className="pl-block-head">
      <h3 id={`${id}-label`}><label htmlFor={`${id}-text`}>{block.label}</label></h3>
      <span className="pl-badges">{customized && <span className="pl-badge is-custom">Customized</span>}{edited && <span className="pl-badge is-draft">Edited</span>}{defaultChanged && <span className="pl-badge is-warn">Default updated</span>}</span>
    </div>
    {block.help && <p id={`${id}-help`} className="pl-help">{block.help}</p>}
    {list(block.variables).length > 0 && <div className="pl-vars" role="group" aria-label={`Values ${block.label} can use`}>
      {list(block.variables).map((variable) => <button key={variable.name} type="button" className="pl-chip" disabled={readOnly} title={[variable.description, variable.example ? `For example: ${variable.example}` : ''].filter(Boolean).join('. ')} aria-label={`Insert {{${variable.name}}}${required.has(variable.name) ? ', required' : ''}: ${variable.description}`} onClick={() => insert(variable.name)}><code>{`{{${variable.name}}}`}</code>{required.has(variable.name) && <span className="pl-chip-required">required</span>}</button>)}
    </div>}
    <textarea ref={area} id={`${id}-text`} className="pl-text" value={text} rows={rows} readOnly={readOnly} aria-readonly={readOnly || undefined} spellCheck="true" aria-invalid={problems.length > 0 || undefined} aria-describedby={[block.help ? `${id}-help` : '', `${id}-count`, problems.length ? `${id}-checks` : ''].filter(Boolean).join(' ')} onChange={(event) => onChange(event.target.value)} />
    <div className="pl-block-foot">
      <span id={`${id}-count`} className={`pl-count${block.maxChars && text.length > block.maxChars ? ' is-over' : ''}`}>{number(normalize(text).length)} of {number(block.maxChars)} characters{block.lines ? ` · ${lineCount} of ${block.lines.min === block.lines.max ? block.lines.min : `${block.lines.min}–${block.lines.max}`} lines` : ''}</span>
      {!readOnly && !atDefault && <button type="button" className="pl-link" onClick={() => onChange(original)}><RotateCcw size={13} aria-hidden="true" />Reset this block</button>}
    </div>
    {list(block.requiredTerms).length > 0 && <p className="pl-keep">Must still mention {list(block.requiredTerms).map((term, index) => <React.Fragment key={term}>{index ? ' ' : ''}<code>{term}</code></React.Fragment>)}</p>}
    <ul id={`${id}-checks`} className="pl-checks" aria-live="polite">{problems.map((problem) => <li key={problem}><TriangleAlert size={13} aria-hidden="true" />{problem}</li>)}</ul>
    {defaultChanged && <div className="pl-default">
      <p><Info size={14} aria-hidden="true" />The studio’s default for this part changed after it was customized.</p>
      <span className="pl-default-buttons"><button type="button" className="pl-link" aria-expanded={showDefault} onClick={() => setShowDefault((value) => !value)}>{showDefault ? 'Hide the new default' : 'See the new default'}</button>{!readOnly && <button type="button" className="pl-link" onClick={() => onChange(original)}>Use the new default</button>}</span>
      {showDefault && <pre className="pl-default-text">{original}</pre>}
    </div>}
  </section>;
}
function FixedBlock({ block, text }) {
  return <div className="pl-fixed-block">
    <div className="pl-slot"><Lock size={14} aria-hidden="true" /><div><strong>{block.label}</strong>{block.reason && <span>{block.reason}</span>}</div></div>
    {text && <details className="pl-fixed-text"><summary>Show the text<ChevronDown size={13} aria-hidden="true" /></summary><pre>{text}</pre></details>}
  </div>;
}

// Saving: what changes (the server's own diff of the draft against the saved version), a required note, and the
// server's answer: a new version, problems to fix, or "someone saved in between".
function SaveDialog({ api, detail, changed, onClose, onSaved, onReload }) {
  const id = useId(); const noteRef = useRef(null);
  const [diff, setDiff] = useState({ status: 'loading', blocks: [], error: '' });
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null); // { text, conflict, problems }
  const next = (Number(detail.version) || 0) + 1;
  useEffect(() => {
    let live = true;
    if (typeof api?.diffPromptVersions !== 'function') { setDiff({ status: 'error', blocks: [], error: 'The change can’t be shown in this version of the studio.' }); return undefined; }
    Promise.resolve(api.diffPromptVersions({ id: detail.prompt.id, from: 'current', to: 'draft', draft: changed }))
      .then((result) => { if (live) setDiff({ status: 'ready', blocks: list(result?.blocks), error: '' }); })
      .catch((failure) => { if (live) setDiff({ status: 'error', blocks: [], error: messageOf(failure) }); });
    return () => { live = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  async function save(event) {
    event.preventDefault();
    const text = note.trim();
    if (!text) { setError({ text: 'Add a short note on what changed and why, so the team can follow the history.' }); noteRef.current?.focus(); return; }
    setBusy(true); setError(null);
    try { onSaved(await api.savePromptVersion({ id: detail.prompt.id, blocks: changed, expectedVersion: Number(detail.version) || 0, note: text, source: 'library' })); }
    catch (failure) {
      const words = messageOf(failure);
      const conflict = failure?.status === 409 || failure?.code === 'promptConflict' || /after you opened it|changed since you opened/i.test(words);
      let problems = list(failure?.problems).map((problem) => problem?.message || String(problem));
      // The refusal names only how many problems there are; the free preview lists them (the same checks).
      if (!conflict && !problems.length && /problems? to fix/i.test(words) && typeof api?.previewPrompt === 'function') {
        try { problems = list((await api.previewPrompt({ id: detail.prompt.id, sample: 'bundled', blocks: changed }))?.problems).map((problem) => problem?.message || String(problem)); } catch { problems = []; }
      }
      setError({ text: words, conflict, problems });
    } finally { setBusy(false); }
  }
  return <Dialog labelledBy={`${id}-title`} describedBy={`${id}-hint`} onClose={onClose} closeDisabled={busy} initialFocus={noteRef} wide>
    <form className="pl-save" onSubmit={save}>
      <div className="studio-dialog-head"><div><small>Save a new version</small><h2 id={`${id}-title`}>Version {next} of “{detail.prompt.name}”</h2></div><DialogClose onClose={onClose} disabled={busy} /></div>
      <div className="studio-dialog-body">
        <p id={`${id}-hint`} className="studio-hint">Runs already going keep the version they started with. You can compare or restore any version from History.</p>
        {diff.status === 'loading' ? <div className="studio-skeleton" role="status" aria-label="Loading the change"><span /><span /></div>
          : diff.status === 'error' ? <p className="pl-quiet" role="status">{diff.error}</p>
          : diff.blocks.map((block) => <section key={block.blockId} className="pl-save-block" aria-label={block.label}><h3>{block.label}</h3><PromptDiff lines={block.lines} label={`Changes to ${block.label}`} /></section>)}
        <label className="studio-field"><span>Note for the history</span><textarea ref={noteRef} rows={2} maxLength={NOTE_MAX} value={note} aria-describedby={`${id}-count`} aria-invalid={error && !note.trim() ? true : undefined} placeholder="What changed, and why" onChange={(event) => setNote(event.target.value)} /></label>
        <small id={`${id}-count`} className="pl-count">{note.length} of {NOTE_MAX} characters</small>
        {error && <div className="pl-problem" role="alert"><p>{error.text}</p>{error.problems?.length > 0 && <ul>{error.problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>}{error.conflict && <button type="button" className="studio-link" onClick={() => { onReload(); onClose(); }}>Reload the prompt (your edits stay)</button>}</div>}
      </div>
      <div className="studio-dialog-foot"><button type="button" className="studio-quiet" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" className="studio-primary" disabled={busy}>{busy ? <LoaderCircle className="spin" size={15} aria-hidden="true" /> : <Check size={15} aria-hidden="true" />}{busy ? 'Saving…' : `Save as version ${next}`}</button></div>
    </form>
  </Dialog>;
}

// ---------- Preview ----------
const IDLE_TEST = Object.freeze({ status: 'idle', result: null, error: '', estimate: null });
// `test` and `setTest` live in PromptLibrary, so leaving this tab mid-test doesn't lose the run or its result;
// `onTested(record)` adds a finished test to Recent test runs straight away.
function PreviewTab({ api, state, detail, drafts, viewer, can, confirm, lockedForYou, test = IDLE_TEST, setTest, onTested }) {
  const entry = detail.prompt; const id = useId();
  const samples = list(entry.test?.samples).filter((sample) => SAMPLE_LABELS[sample]);
  const options = samples.length ? samples : ['bundled'];
  const [sample, setSample] = useState(options[0]);
  const hasDraft = Object.keys(drafts).length > 0 && !lockedForYou;
  const [useDraft, setUseDraft] = useState(true);
  const draft = hasDraft && useDraft ? drafts : null;
  const draftKey = JSON.stringify(draft || {});
  const [view, setView] = useState({ status: 'loading', data: null, error: '' });
  const [all, setAll] = useState(false);
  const reads = useRef(0);
  const labels = Object.fromEntries(list(entry.blocks).map((block) => [block.id, block.label]));
  useEffect(() => {
    if (typeof api?.previewPrompt !== 'function') { setView({ status: 'error', data: null, error: 'The preview isn’t available in this version of the studio.' }); return undefined; }
    const read = ++reads.current;
    setView((current) => ({ ...current, status: current.data ? 'refreshing' : 'loading', error: '' }));
    // Typing pauses before the preview is built again.
    const timer = setTimeout(() => {
      Promise.resolve(api.previewPrompt({ id: entry.id, sample, ...(draft ? { blocks: draft } : {}) }))
        .then((result) => { if (read === reads.current) setView({ status: 'ready', data: result, error: '' }); })
        .catch((failure) => { if (read === reads.current) setView({ status: 'error', data: null, error: messageOf(failure) }); });
    }, draft ? 500 : 0);
    return () => clearTimeout(timer);
  }, [entry.id, sample, draftKey, detail.version]); // eslint-disable-line react-hooks/exhaustive-deps

  const result = view.data;
  const text = String(result?.text || '');
  const shown = all ? text : text.slice(0, PREVIEW_SHOWN);
  const nodes = useMemo(() => {
    const out = []; let at = 0;
    for (const segment of list(result?.segments)) {
      if (segment.start >= shown.length) break;
      if (segment.start > at) out.push(shown.slice(at, segment.start));
      out.push(<mark key={`${segment.start}-${segment.blockId}`} className="pl-mark" title={labels[segment.blockId] || segment.blockId}>{shown.slice(segment.start, Math.min(segment.end, shown.length))}</mark>);
      at = Math.min(segment.end, shown.length);
    }
    if (at < shown.length) out.push(shown.slice(at));
    return out;
  }, [result, all]); // eslint-disable-line react-hooks/exhaustive-deps
  // A role without See costs gets no *Usd fields back, so the price is left out rather than shown as "about  per call".
  const priced = Number.isFinite(result?.estimateUsd);
  const cost = !result ? '' : result.kind === 'none' ? 'Not sent on its own, so it has no cost of its own' : result.kind === 'image' ? (priced ? `about ${money(result.estimateUsd)} for ${result.estimateUsd > 0.07 ? 'these pictures' : 'a picture'}` : '') : !result.metered ? 'Codex: not metered' : priced ? `about ${money(result.estimateUsd)} per call` : '';
  const testable = detail.testable && can('testPrompt') && typeof api?.estimatePromptTest === 'function' && typeof api?.testPrompt === 'function';
  const job = test.status === 'running' ? list(state?.jobs).find((row) => row?.kind === 'prompt-test' && row.title === `Test run · ${entry.name}` && row.cancellable) : null;
  const serverProblems = list(result?.problems).map((problem) => problem?.message || String(problem));

  async function runTest() {
    if (test.status === 'estimating' || test.status === 'running') return;
    setTest({ status: 'estimating', result: null, error: '', estimate: null });
    let estimate;
    try { estimate = await api.estimatePromptTest({ id: entry.id, sample, ...(draft ? { blocks: draft } : {}) }); }
    catch (failure) { setTest({ status: 'error', result: null, error: messageOf(failure), estimate: null }); return; }
    if (!estimate?.available) { setTest({ status: 'error', result: null, error: estimate?.reason || 'This prompt can’t be test-run on its own.', estimate }); return; }
    const problems = list(estimate.problems).map((problem) => problem?.message || String(problem));
    if (problems.length) { setTest({ status: 'error', result: null, error: `Fix the problems in this draft before testing it: ${problems[0]}`, estimate }); return; }
    const route = ROUTE_LABELS[estimate.route] || estimate.route || 'the studio’s AI connection';
    const price = estimate.kind === 'image' ? `OpenAI draws one picture: about ${money(estimate.estimateUsd)}, with a cap of ${money(estimate.capUsd)}.` : estimate.metered ? `${estimate.modelLabel || estimate.model}${estimate.effort ? ` at ${estimate.effort} effort` : ''}, through ${route}: about ${money(estimate.estimateUsd)}, capped at ${money(estimate.capUsd)}.` : `${estimate.note || 'Your Codex plan (not metered): Codex reports no cost and takes no cap.'}`;
    const ok = await confirm({
      title: `Test “${entry.name}” once?`,
      lines: [`It runs the real ${estimate.kind === 'image' ? 'picture step' : 'step'} on ${estimate.sampleLabel || 'the sample'}, with ${draft ? 'your unsaved changes' : 'the saved version'}, and checks the answer the way a run does.`, price, estimate.kind === 'image' && estimate.note ? estimate.note : '', 'Only a test record is kept. Nothing is saved as a version, and no run or report changes.'],
      confirmLabel: estimate.metered ? `Run the test (about ${money(estimate.estimateUsd)})` : 'Run the test',
    });
    if (!ok) { setTest({ status: 'idle', result: null, error: '', estimate: null }); return; }
    setTest({ status: 'running', result: null, error: '', estimate });
    try { const result = await api.testPrompt({ id: entry.id, sample, fingerprint: estimate.fingerprint, ...(draft ? { blocks: draft } : {}) }); setTest({ status: 'done', result, error: '', estimate }); onTested?.(result?.test); }
    catch (failure) { setTest({ status: 'error', result: null, error: messageOf(failure), estimate, stale: /check the cost again/i.test(messageOf(failure)) }); }
  }
  async function stop() { if (job && typeof api?.cancelJob === 'function') { try { await api.cancelJob(job.id); } catch { /* it finished first; its result shows below */ } } }

  return <div className="pl-preview">
    <div className="pl-preview-tools">
      {options.length > 1 ? <div className="studio-segment" role="radiogroup" aria-label="Preview with">{options.map((option) => <button key={option} type="button" role="radio" aria-checked={sample === option} aria-pressed={sample === option} onClick={() => setSample(option)}>{SAMPLE_LABELS[option]}</button>)}</div> : <span className="pl-quiet">{SAMPLE_LABELS[options[0]]}</span>}
      {hasDraft && <label className="pl-toggle"><input type="checkbox" checked={useDraft} onChange={(event) => setUseDraft(event.target.checked)} /><span>With my unsaved changes</span></label>}
    </div>
    {view.status === 'error' ? <p className="pl-problem" role="alert">{view.error}</p> : null}
    {result && <p className="pl-meta" aria-live="polite">{[result.sampleLabel ? `Using ${result.sampleLabel}` : '', `${number(result.chars)} characters`, result.kind !== 'image' && result.tokens ? `about ${number(result.tokens)} tokens` : '', cost].filter(Boolean).join(' · ')}</p>}
    {serverProblems.length > 0 && <ul className="pl-checks" aria-label="Problems in this draft">{serverProblems.map((problem) => <li key={problem}><TriangleAlert size={13} aria-hidden="true" />{problem}</li>)}</ul>}
    {testable && <div className="pl-test" data-spot="prompts.test">
      <div className="pl-test-row">
        <button type="button" className="studio-primary" {...writeProps(viewer, test.status === 'estimating' || test.status === 'running' || serverProblems.length > 0)} title={serverProblems.length ? 'Fix the problems in this draft first.' : undefined} onClick={runTest}>{test.status === 'estimating' || test.status === 'running' ? <LoaderCircle className="spin" size={15} aria-hidden="true" /> : <FlaskConical size={15} aria-hidden="true" />}{test.status === 'estimating' ? 'Checking the cost…' : test.status === 'running' ? 'Testing…' : 'Test run…'}</button>
        {test.status === 'running' && job && typeof api?.cancelJob === 'function' && <button type="button" className="studio-quiet" onClick={stop}><Square size={13} aria-hidden="true" />Stop</button>}
        <small className="pl-quiet">Paid: you see the price and confirm first.</small>
      </div>
      {test.status === 'error' && <div className="pl-problem" role="alert"><p>{test.error}</p>{test.stale && <button type="button" className="studio-link" onClick={runTest}>Check the cost again</button>}</div>}
      {test.status === 'done' && test.result && <TestResult result={test.result} />}
    </div>}
    {!detail.testable && <p className="pl-quiet">This prompt can’t be test-run on its own: the preview shows exactly what it sends, and you can try it where it runs.</p>}
    {detail.testable && !testable && <p className="pl-quiet">Test runs are for people whose role can edit prompts.</p>}
    <figure className="pl-render-wrap" aria-busy={view.status !== 'ready'}>
      <figcaption className="pl-quiet" id={`${id}-legend`}><span className="pl-mark pl-legend-swatch" aria-hidden="true">Highlighted</span> text is what you can change on the Edit tab.</figcaption>
      {view.status === 'loading' ? <div className="studio-skeleton" role="status" aria-label="Building the preview"><span /><span /><span /><span /></div>
        : result ? <pre className={`pl-render${view.status === 'refreshing' ? ' is-stale' : ''}`} tabIndex={0} aria-describedby={`${id}-legend`} aria-label={`The prompt as ${entry.name} sends it`}>{nodes}</pre> : null}
      {result && text.length > shown.length && <button type="button" className="studio-link" onClick={() => setAll(true)}>Show the rest ({number(text.length - shown.length)} more characters)</button>}
    </figure>
    {list(detail.tests).length > 0 && <section className="pl-tests" aria-labelledby={`${id}-tests`}><h3 id={`${id}-tests`}>Recent test runs</h3><ul>{list(detail.tests).slice(0, 10).map((row) => <li key={row.id || row.at}>{row.ok ? <CircleCheck size={14} className="is-ok" aria-hidden="true" /> : <CircleX size={14} className="is-bad" aria-hidden="true" />}<span>{[when(row.at), row.by?.name, row.ok ? 'Passed' : row.status === 'cancelled' ? 'Stopped' : 'Didn’t pass', row.version ? `version ${row.version}` : 'the default', row.route === 'codex' ? 'Codex (not metered)' : Number.isFinite(row.costUsd) ? money(row.costUsd) : ''].filter(Boolean).join(' · ')}</span></li>)}</ul></section>}
  </div>;
}
function TestResult({ result }) {
  const passed = result.ok; const stopped = result.status === 'cancelled';
  const receipt = result.receipt || {};
  const cost = receipt.metered === false ? 'Codex (not metered)' : Number.isFinite(receipt.costUsd) ? money(receipt.costUsd) : '';
  return <section className={`pl-result ${passed ? 'is-passed' : stopped ? 'is-stopped' : 'is-failed'}`} aria-live="polite">
    <h4>{passed ? <CircleCheck size={16} aria-hidden="true" /> : <CircleX size={16} aria-hidden="true" />}{passed ? 'Passes the studio’s checks' : stopped ? 'The test was stopped' : 'Didn’t pass the studio’s checks'}</h4>
    {list(result.problems).length > 0 && <ul className="pl-checks">{list(result.problems).map((problem) => <li key={problem}><TriangleAlert size={13} aria-hidden="true" />{problem}</li>)}</ul>}
    <p className="pl-meta">{[result.sampleLabel, receipt.route === 'codex' ? '' : modelLabel(receipt.model), ROUTE_LABELS[receipt.route] || receipt.route, cost, Number.isFinite(result.durationMs) ? `${Math.max(1, Math.round(result.durationMs / 1000))}s` : ''].filter(Boolean).join(' · ')}</p>
    {result.output?.imageDataUrl ? <img className="pl-result-image" src={result.output.imageDataUrl} alt="The test picture" />
      : result.output != null && <details className="pl-output"><summary>See the answer<ChevronDown size={13} aria-hidden="true" /></summary><pre tabIndex={0}>{JSON.stringify(result.output, null, 2)}</pre></details>}
  </section>;
}

// ---------- History ----------
function HistoryTab({ api, detail, viewer, can, confirm, dirty, onChanged, onDetail }) {
  const entry = detail.prompt; const id = useId();
  const [compare, setCompare] = useState(null); // { key, status, blocks, error, title }
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const rows = list(detail.history);
  const current = Number(detail.version) || 0;
  const mayRevert = can('revertPrompt') && typeof api?.revertPrompt === 'function' && !detail.lockedForYou;
  const mayLock = can('setPromptLock') && typeof api?.setPromptLock === 'function';
  async function show(key, from, to, title) {
    if (compare?.key === key) { setCompare(null); return; }
    setCompare({ key, status: 'loading', blocks: [], error: '', title });
    try { const result = await api.diffPromptVersions({ id: entry.id, from, to }); setCompare({ key, status: 'ready', blocks: list(result?.blocks), error: '', title }); }
    catch (failure) { setCompare({ key, status: 'error', blocks: [], error: messageOf(failure), title }); }
  }
  async function restore(version) {
    const ok = await confirm({ title: version ? `Restore version ${version} of “${entry.name}”?` : `Go back to the studio’s default for “${entry.name}”?`, lines: [`This saves version ${current + 1} with ${version ? `the text from version ${version}` : 'the default text'}. Nothing is lost: every version stays in History.`, 'Runs already going keep the version they started with.', dirty ? 'Your unsaved changes on the Edit tab are discarded.' : ''], confirmLabel: version ? `Restore version ${version}` : 'Use the default' });
    if (!ok) return;
    setBusy(`restore-${version}`); setError('');
    try {
      const result = await api.revertPrompt({ id: entry.id, toVersion: version, expectedVersion: current, note: version ? `Restored version ${version}` : 'Restored the default' });
      setCompare(null);
      onChanged(result, result?.changed === false ? 'Nothing changed: that’s already the current text.' : version ? `Restored version ${version} as version ${result?.version}.` : `Back on the default, as version ${result?.version}.`);
    }
    catch (failure) { setError(messageOf(failure)); } finally { setBusy(''); }
  }
  async function toggleLock() {
    setBusy('lock'); setError('');
    try { onDetail(await api.setPromptLock({ id: entry.id, locked: !detail.locked })); }
    catch (failure) { setError(messageOf(failure)); } finally { setBusy(''); }
  }
  const compareRegion = (key) => (compare?.key === key ? <div className="pl-compare" role="region" aria-label={compare.title} aria-busy={compare.status === 'loading'}>
    {compare.status === 'loading' ? <div className="studio-skeleton" role="status" aria-label="Loading the comparison"><span /><span /></div>
      : compare.status === 'error' ? <p className="pl-problem" role="alert">{compare.error}</p>
      : !compare.blocks.length ? <p className="pl-quiet">The text is the same.</p>
      : compare.blocks.map((block) => <section key={block.blockId} aria-label={block.label}><h4>{block.label}</h4><PromptDiff lines={block.lines} label={`${compare.title}: ${block.label}`} /></section>)}
  </div> : null);
  const lockLine = detail.locked ? `Locked${detail.lock?.by?.name ? ` by ${detail.lock.by.name}` : ''}${detail.lock?.at ? ` · ${when(detail.lock.at)}` : ''}. Only admins can change it; everyone who can see prompts can still read, preview and test the saved version.` : 'Unlocked. Admins and people whose role can edit prompts can change it.';
  return <div className="pl-history">
    {mayLock ? <div className="pl-lock">
      <div><strong id={`${id}-lock`}>Lock this prompt</strong><p id={`${id}-lock-help`} className="pl-quiet">{lockLine}</p></div>
      <button type="button" role="switch" className="pl-switch" aria-checked={Boolean(detail.locked)} aria-labelledby={`${id}-lock`} aria-describedby={`${id}-lock-help`} {...writeProps(viewer, busy === 'lock')} onClick={toggleLock}><span aria-hidden="true">{detail.locked ? <Lock size={12} /> : <LockOpen size={12} />}</span></button>
    </div> : detail.locked ? <p className="pl-note is-lock" role="note"><Lock size={15} aria-hidden="true" />{lockLine}</p> : null}
    {error && <p className="pl-problem" role="alert">{error}</p>}
    <ol className="pl-versions" aria-label="Versions, newest first">
      {rows.map((row) => {
        const previous = Math.max(0, Number(row.version) - 1); const key = `v${row.version}`; // versions count up by one
        return <li key={row.version} className={row.version === current ? 'is-current' : ''}>
          <div className="pl-version-head"><strong>Version {row.version}</strong>{row.version === current && <span className="pl-badge is-custom">Current</span>}<span className="pl-badge">{SOURCE_LABELS[row.source] || 'Prompts'}</span></div>
          <p className="pl-meta">{[row.by?.name || 'Someone', when(row.at), row.revertOf != null ? (row.revertOf ? `restored version ${row.revertOf}` : 'restored the default') : '', list(row.blockIds).length ? `changed ${list(row.blockIds).map((blockId) => list(entry.blocks).find((block) => block.id === blockId)?.label || blockId).join(', ')}` : ''].filter(Boolean).join(' · ')}</p>
          {row.note && <p className="pl-version-note">{row.note}</p>}
          <div className="pl-version-buttons">
            <button type="button" className="pl-link" aria-expanded={compare?.key === `${key}-prev`} onClick={() => show(`${key}-prev`, previous, row.version, `Version ${row.version} against ${previous ? `version ${previous}` : 'the default'}`)}>Compare with {previous ? 'previous' : 'the default'}</button>
            {previous > 0 && <button type="button" className="pl-link" aria-expanded={compare?.key === `${key}-default`} onClick={() => show(`${key}-default`, 0, row.version, `Version ${row.version} against the default`)}>Compare with the default</button>}
            {mayRevert && row.version !== current && <button type="button" className="pl-link" {...writeProps(viewer, Boolean(busy))} onClick={() => restore(row.version)}>{busy === `restore-${row.version}` ? <LoaderCircle className="spin" size={13} aria-hidden="true" /> : <RotateCcw size={13} aria-hidden="true" />}Restore this version…</button>}
          </div>
          {compareRegion(`${key}-prev`)}{compareRegion(`${key}-default`)}
        </li>;
      })}
      <li className={current === 0 ? 'is-current' : ''}>
        <div className="pl-version-head"><strong>The studio’s default</strong>{current === 0 && <span className="pl-badge is-custom">Current</span>}</div>
        <p className="pl-meta">{current === 0 ? 'No saved versions yet: this prompt uses the text the studio ships with.' : 'The text the studio ships with.'}{list(detail.defaultChanged).length > 0 ? ' A newer build changed it since this prompt was customized.' : ''}</p>
        <div className="pl-version-buttons">
          {current > 0 && <button type="button" className="pl-link" aria-expanded={compare?.key === 'default-current'} onClick={() => show('default-current', 0, 'current', 'The default against the current version')}>Compare with the current version</button>}
          {mayRevert && current > 0 && <button type="button" className="pl-link" {...writeProps(viewer, Boolean(busy))} onClick={() => restore(0)}>{busy === 'restore-0' ? <LoaderCircle className="spin" size={13} aria-hidden="true" /> : <RotateCcw size={13} aria-hidden="true" />}Go back to the default…</button>}
        </div>
        {compareRegion('default-current')}
      </li>
    </ol>
  </div>;
}

export default PromptLibrary;
