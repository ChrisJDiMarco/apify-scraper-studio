import React, { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import { Placeholder } from '@tiptap/extensions';
import { TextSelection } from '@tiptap/pm/state';
import { yXmlFragmentToProsemirrorJSON } from '@tiptap/y-tiptap';
import { Awareness, applyAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
import { Bold, Check, CircleAlert, ClipboardCopy, CloudCheck, Code, Heading1, Heading2, Heading3, Italic, Link as LinkIcon, List, ListOrdered, LoaderCircle, MessageSquarePlus, MessageSquareText, Minus, Table, TextQuote, Unlink } from 'lucide-react';
import { useConfirm } from '../confirm-dialog.jsx';
import { copyText } from '../role-screens.jsx';
import { can, canRun, formatDay, initials, useViewer } from '../viewer.js';
import { ariaKey } from '../platform.js';
import { contentExtensions, jsonToMarkdown, safeHref } from './markdown.js';
import { FIELD, anchorFromSelection, applyRemoteUpdate, createReportYDoc, findQuote, fromBase64, newClientId, resolveAnchor } from './ydoc.js';
import { createDocSync } from './sync.js';
import { MarkdownLink, NoteHighlights, NoteShortcut, refreshNoteHighlights } from './extensions.js';
import { subscribePersonEvents, takeNoteFocus } from './events.js';
import { NotesPanel } from './NotesPanel.jsx';
import { HistoryMenu, versionWhen } from './HistoryMenu.jsx';
import '../report-editor.css';

// One clean page for reading and editing a report (Google Docs style): the text is edited in place and saved as you
// type, with a floating menu on a selection, a "/" menu on an empty line and Markdown shortcuts (# heading, - list,
// **bold**…). On the web several people edit at once (Yjs over the studio's per-person push), with presence and soft
// named carets; the Mac app is one person. Notes hang on the text and live in a side panel.
//
// Live mode needs the report-doc methods (openReportDoc, pushReportDocUpdate, …). Without them (an older studio) the
// same editor saves through editStudioAsset with its conflict check, and notes and History's versions are off.

export const MAX_EDIT_CHARS = 250000;
export const KEEP_ALIVE_MS = 10 * 60000; // under report-docs.js LIMITS.openMs (30 minutes)
const list = (value) => (Array.isArray(value) ? value : []);
const PALETTE = ['#7c5cff', '#1f9d74', '#e8590c', '#1c7ed6', '#d6336c', '#0c8599', '#9c36b5', '#5c940d'];
export function colorFor(id, given = '') {
  if (/^#[0-9a-f]{6}$/i.test(String(given || ''))) return given;
  let hash = 0; for (const char of String(id || '')) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}
const reduceMotion = () => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
let sessionKey = 0;
const BUBBLE_KEY = 'reportSelectionMenu';
// One visit to a report's live document: what openReportDoc (or restoreReportVersion) answered, and this browser's id.
function liveSession(result, fallback, clientId) {
  return { key: ++sessionKey, live: true, clientId, markdown: typeof result?.markdown === 'string' ? result.markdown : fallback, yState: typeof result?.yState === 'string' ? result.yState : '', epoch: Number.isFinite(Number(result?.epoch)) && result?.epoch !== null && result?.epoch !== undefined ? Number(result.epoch) : null, version: result?.version ?? null, versions: list(result?.versions), canEdit: Boolean(result?.canEdit), canNote: Boolean(result?.canNote), editors: list(result?.editors), members: list(result?.members), awareness: list(result?.awareness) };
}
const plainSession = (markdown) => ({ key: ++sessionKey, live: false, clientId: 0, markdown: String(markdown || ''), yState: '', epoch: null, version: null, versions: [], canEdit: true, canNote: false, editors: [], members: [], awareness: [] });

export const SLASH_ITEMS = Object.freeze([
  { id: 'h1', label: 'Heading 1', hint: '#', words: 'title big heading', icon: Heading1, run: (chain) => chain.setNode('heading', { level: 1 }) },
  { id: 'h2', label: 'Heading 2', hint: '##', words: 'section heading', icon: Heading2, run: (chain) => chain.setNode('heading', { level: 2 }) },
  { id: 'h3', label: 'Heading 3', hint: '###', words: 'subsection heading', icon: Heading3, run: (chain) => chain.setNode('heading', { level: 3 }) },
  { id: 'bullets', label: 'Bulleted list', hint: '-', words: 'bullet unordered list', icon: List, run: (chain) => chain.toggleBulletList() },
  { id: 'numbers', label: 'Numbered list', hint: '1.', words: 'numbered ordered list', icon: ListOrdered, run: (chain) => chain.toggleOrderedList() },
  { id: 'quote', label: 'Quote', hint: '>', words: 'quote blockquote citation', icon: TextQuote, run: (chain) => chain.toggleBlockquote() },
  { id: 'table', label: 'Table', hint: '3 × 3', words: 'table grid', icon: Table, run: (chain) => chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }) },
  { id: 'code', label: 'Code block', hint: '```', words: 'code snippet', icon: Code, run: (chain) => chain.toggleCodeBlock() },
  { id: 'divider', label: 'Divider', hint: '---', words: 'divider rule line separator', icon: Minus, run: (chain) => chain.setHorizontalRule() },
]);
export const slashMatches = (query, inTable = false) => SLASH_ITEMS.filter((item) => !(inTable && item.id === 'table') && (!query || `${item.label} ${item.words}`.toLowerCase().includes(query)));

function Presence({ people }) {
  if (!people.length) return null;
  const shown = people.slice(0, 4);
  const names = people.map((person) => person.name || 'Someone');
  return <span className="rd-presence" role="group" aria-label={`Also here: ${names.join(', ')}`}>
    {shown.map((person) => <span key={person.id} className="rd-avatar" style={{ '--rd-color': person.color }} title={`${person.name || 'Someone'} is here`} aria-hidden="true">{initials(person.name || '?')}</span>)}
    {people.length > shown.length && <span className="rd-avatar more" aria-hidden="true">+{people.length - shown.length}</span>}
  </span>;
}

function SaveStatus({ status, onRetry }) {
  const { state, savedAt } = status;
  return <span className={`rd-status is-${state}`} role="status" aria-live="polite">
    {state === 'pending' || state === 'saving' ? <><LoaderCircle className="spin" size={13} aria-hidden="true" />Saving…</>
      : state === 'saved' ? <><CloudCheck size={14} aria-hidden="true" /><span title={savedAt ? `Saved ${new Date(savedAt).toLocaleTimeString()}` : undefined}>Saved</span></>
      : state === 'error' ? <><CircleAlert size={13} aria-hidden="true" />Not saved{!status.conflict && onRetry && <button type="button" className="rd-link" onClick={onRetry}>Retry</button>}</>
      : null}
  </span>;
}

// `editable`: whether the page around it lets this person edit (role, a detached report…); the studio's canEdit and the
// role's methods are checked too. `edited` ({ at, byName }) names the edit the text was loaded from (Restore the
// original says whose edits go). `onMarkdown(md)` after each save; `onSaved({ markdown, result, restored? })`;
// `onText(md)` as the text changes (debounced); `onUnsaved(bool)` while a save is failing; `barEnd` sits at the end of
// the bar (the editor's Done). The ref offers flush(), markdown(), selectText(excerpt) and the editor.
export const ReportDocument = forwardRef(function ReportDocument({ api = {}, asset, markdown = '', web = false, editable = false, edited = null, baseEditedAt = '', variant = 'reader', autoFocus = false, members: membersIn = null, onMarkdown, onSaved, onText, onUnsaved, barEnd = null, label = '' }, ref) {
  const viewer = useViewer();
  const confirm = useConfirm();
  const assetId = asset?.id || '';
  const title = asset?.title || 'the report';
  const live = typeof api.openReportDoc === 'function' && can(viewer, 'openReportDoc');
  const [session, setSession] = useState(() => (live ? null : plainSession(markdown)));
  const [status, setStatus] = useState({ state: 'idle', savedAt: '', error: '', conflict: false });
  const [editors, setEditors] = useState([]);
  const [notes, setNotes] = useState([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [notesProblem, setNotesProblem] = useState('');
  const [panelOpen, setPanelOpen] = useState(false);
  const [activeId, setActiveId] = useState('');
  const [draft, setDraft] = useState(null);
  const [slash, setSlash] = useState(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [copied, setCopied] = useState(false);
  const [team, setTeam] = useState([]);
  const [mentionable, setMentionable] = useState([]);
  const [notice, setNotice] = useState('');
  const [docTick, setDocTick] = useState(0);
  const [wide, setWide] = useState(false);
  const rootRef = useRef(null); const pageRef = useRef(null); const bubbleRef = useRef(null);
  const syncRef = useRef(null); const replacingRef = useRef(false); const dismissedRef = useRef(''); const closingRef = useRef(null); const editorRef = useRef(null);
  const notesRef = useRef([]); const activeRef = useRef(''); const slashRef = useRef(null); const addNoteRef = useRef(null);
  const callbacks = useRef({}); callbacks.current = { onMarkdown, onSaved, onText, onUnsaved };
  const linkInput = useRef(null);
  const sessionRef = useRef(null); sessionRef.current = session;
  const reopenRef = useRef(null); const restoringRef = useRef(false); const catchUpRef = useRef(null);
  const id = useId();

  // Open the report: the live document when the studio has it, else the Markdown the page loaded. Each visit (and each
  // reopen after the document started over) is a new browser id, which is also this browser's Yjs client id.
  const openLive = async () => {
    const clientId = newClientId();
    const result = await api.openReportDoc({ assetId, clientId: String(clientId) });
    return liveSession(result, markdown, clientId);
  };
  useEffect(() => {
    if (!live) { setSession(plainSession(markdown)); return undefined; }
    let cancelled = false;
    setSession(null);
    Promise.resolve().then(openLive).then(
      (next) => { if (!cancelled) setSession(next); else if (typeof api.closeReportDoc === 'function') Promise.resolve(api.closeReportDoc({ assetId, clientId: String(next.clientId) })).catch(() => {}); },
      () => { if (!cancelled) setSession(plainSession(markdown)); },
    );
    return () => { cancelled = true; };
  }, [assetId, live]); // eslint-disable-line react-hooks/exhaustive-deps

  const notesOn = Boolean(session?.live) && typeof api.listReportNotes === 'function' && can(viewer, 'listReportNotes');
  const canNote = notesOn && Boolean(session?.canNote) && typeof api.saveReportNote === 'function' && can(viewer, 'saveReportNote') && !viewer.preview;
  const canEdit = Boolean(session) && editable && !viewer.preview && (session.live ? session.canEdit && typeof api.pushReportDocUpdate === 'function' && can(viewer, 'pushReportDocUpdate') : typeof api.editStudioAsset === 'function' && canRun(viewer, 'editStudioAsset'));
  const mentionsOn = web && canNote;
  const me = String(viewer?.id || '');
  const myColor = colorFor(me, list(session?.editors).find((row) => row?.id === me)?.color);

  const doc = useMemo(() => (session ? createReportYDoc({ yState: session.yState, markdown: session.markdown, clientID: session.clientId }) : null), [session]);
  const awareness = useMemo(() => (doc && web && session?.live ? new Awareness(doc.ydoc) : null), [doc]); // eslint-disable-line react-hooks/exhaustive-deps
  // Other browsers' carets: the ones open now (from openReportDoc), then as they move.
  useEffect(() => {
    if (!awareness) return undefined;
    for (const update of list(session?.awareness)) { try { applyAwarenessUpdate(awareness, fromBase64(update), 'remote'); } catch { /* a caret is a nicety */ } }
    return () => awareness.destroy();
  }, [awareness]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setEditors(list(session?.editors)); }, [session]);
  const currentMarkdown = useCallback(() => (doc ? jsonToMarkdown(yXmlFragmentToProsemirrorJSON(doc.ydoc.getXmlFragment(FIELD))) : String(markdown || '')), [doc, markdown]);

  const openNote = useCallback((noteId) => { setActiveId(noteId); setPanelOpen(true); }, []);
  const editor = useEditor({
    extensions: doc ? [
      ...contentExtensions(),
      Placeholder.configure({ placeholder: ({ node }) => (node.type.name === 'heading' ? 'Heading' : 'Write, or type / for blocks'), showOnlyCurrent: true }),
      Collaboration.configure({ document: doc.ydoc, field: FIELD }),
      ...(awareness ? [CollaborationCaret.configure({ provider: { awareness }, user: { id: me, name: viewer?.name || 'Someone', color: myColor } })] : []),
      NoteHighlights.configure({ getNotes: () => notesRef.current, getActive: () => activeRef.current, onOpen: openNote }),
      MarkdownLink,
      NoteShortcut.configure({ onAddNote: () => addNoteRef.current?.() }),
    ] : [...contentExtensions()],
    editable: Boolean(doc) && canEdit,
    editorProps: {
      attributes: { class: 'rd-prose', role: canEdit ? 'textbox' : 'document', 'aria-multiline': canEdit ? 'true' : undefined, 'aria-label': label || (canEdit ? `Text of ${title}` : title), tabindex: '0', spellcheck: canEdit ? 'true' : 'false' },
      handleKeyDown: (_view, event) => slashKeys(event),
    },
    onUpdate: ({ editor: current }) => senseSlash(current),
    onSelectionUpdate: ({ editor: current }) => senseSlash(current),
  }, [doc, awareness, canEdit]);
  editorRef.current = editor;

  // Leaving the report (unmount) sends what is left; losing edit rights or the report itself (a switched workspace)
  // stops saving without sending it. Declared before the autosave so its cleanup runs first.
  const leavingRef = useRef(false);
  useEffect(() => () => { leavingRef.current = true; }, []);
  // Autosave (only for people who may edit).
  useEffect(() => {
    if (!doc || !canEdit) return undefined;
    const sync = createDocSync({
      api, assetId, ydoc: doc.ydoc, mode: session.live ? 'live' : 'plain', awareness, epoch: session.epoch, baseEditedAt, seeded: doc.seeded, initialMarkdown: session.markdown,
      onBehind: () => catchUpRef.current?.(),
      onReset: () => reopen('This report was restored or changed outside the editor, so it was reloaded. Your last few seconds of typing may not have been kept.'),
      getMarkdown: () => {
        const text = currentMarkdown();
        if (text.length > MAX_EDIT_CHARS) throw Object.assign(new Error(`Keep it under ${MAX_EDIT_CHARS.toLocaleString()} characters to save.`), { retry: false });
        return text;
      },
      onStatus: (next) => { setStatus(next); callbacks.current.onUnsaved?.(next.state === 'error'); },
      onSaved: (saved) => { callbacks.current.onMarkdown?.(saved.markdown); callbacks.current.onSaved?.(saved); },
    });
    syncRef.current = sync;
    // This person's caret moves go out on their own when no change is waiting to carry them.
    let lastCursor = 'null';
    const onCaret = (_change, origin) => {
      if (origin !== 'local') return;
      const cursor = JSON.stringify(awareness.getLocalState()?.cursor || null);
      if (cursor !== lastCursor) { lastCursor = cursor; sync.sendCaret(); }
    };
    awareness?.on('update', onCaret);
    return () => {
      awareness?.off('update', onCaret);
      syncRef.current = null;
      if (replacingRef.current || !leavingRef.current) sync.destroy(); else closingRef.current = sync.close();
      callbacks.current.onUnsaved?.(false);
    };
  }, [doc, canEdit]); // eslint-disable-line react-hooks/exhaustive-deps
  // Tell the studio this browser left (after the last save went out). A document being replaced (a restore, a reopen)
  // closes the old browser id; the new one is already registered.
  useEffect(() => {
    if (!session?.live) return undefined;
    const clientId = String(session.clientId || '');
    return () => {
      replacingRef.current = false;
      const leave = () => { if (typeof api.closeReportDoc === 'function') Promise.resolve().then(() => api.closeReportDoc({ assetId, ...(clientId ? { clientId } : {}) })).catch(() => {}); };
      Promise.resolve(closingRef.current).catch(() => {}).finally(leave); closingRef.current = null;
    };
  }, [session]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!notice) return undefined; const timer = setTimeout(() => setNotice(''), 10000); return () => clearTimeout(timer); }, [notice]);
  // The web holds the tab while edits are still going out.
  useEffect(() => {
    if (!web || !canEdit) return undefined;
    const hold = (event) => { const sync = syncRef.current; if (!sync?.dirty) return; sync.flush({ final: true }); event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', hold);
    return () => window.removeEventListener('beforeunload', hold);
  }, [web, canEdit]);
  useEffect(() => { if (editor && autoFocus && canEdit) { try { editor.commands.focus('start', { scrollIntoView: false }); } catch { /* not focusable here */ } } }, [editor]); // eslint-disable-line react-hooks/exhaustive-deps

  // Text changes (local and remote): note places, the brand check.
  useEffect(() => {
    if (!editor) return undefined;
    let timer = null;
    const changed = () => { clearTimeout(timer); timer = setTimeout(() => { setDocTick((value) => value + 1); if (callbacks.current.onText) callbacks.current.onText(currentMarkdown()); }, 300); };
    editor.on('update', changed);
    if (callbacks.current.onText) callbacks.current.onText(currentMarkdown());
    return () => { clearTimeout(timer); editor.off('update', changed); };
  }, [editor, currentMarkdown]);

  // Other people's edits, presence and note changes.
  const reloadTimer = useRef(null);
  const reloadNotes = useCallback(async () => {
    if (!notesOn) return [];
    setNotesLoading(true);
    try { const result = await api.listReportNotes({ assetId }); const rows = list(result?.notes); setNotes(rows); if (Array.isArray(result?.mentionable)) setMentionable(result.mentionable); setNotesProblem(''); return rows; }
    catch (failure) { setNotesProblem(failure?.message || 'Notes couldn’t be loaded. Try again.'); return null; }
    finally { setNotesLoading(false); }
  }, [notesOn, assetId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!session?.live || !doc) return undefined;
    const applyAwareness = (base64) => { if (!awareness || !base64) return; try { applyAwarenessUpdate(awareness, fromBase64(base64), 'remote'); } catch { /* a caret is a nicety */ } };
    // Missed events (a dropped stream, an update that needs one this page never got) are filled in from the studio's
    // whole state: merging it again is harmless.
    const catchUp = () => {
      Promise.resolve().then(() => api.openReportDoc({ assetId, clientId: String(session.clientId) })).then((result) => {
        if (result?.epoch !== undefined && session.epoch !== null && Number(result.epoch) !== session.epoch) { reopen('This report was restored or changed outside the editor, so it was reloaded.'); return; }
        applyRemoteUpdate(doc.ydoc, result?.yState); if (Array.isArray(result?.editors)) setEditors(result.editors);
      }, () => {});
      if (notesOn) reloadNotes();
    };
    catchUpRef.current = catchUp;
    const current = () => sessionRef.current?.epoch;
    // The studio lets a browser go after 30 minutes without a change (report-docs.js), and then stops sending it other
    // people's edits and notes; a reader never saves, so an open page that's on screen checks in every 10 minutes
    // (reopening with the same browser id, which also catches up). A hidden tab catches up on its resync instead.
    const keepAlive = setInterval(() => { if (typeof document === 'undefined' || document.visibilityState !== 'hidden') catchUp(); }, KEEP_ALIVE_MS);
    const off = subscribePersonEvents(api, (event) => {
      if (event.type === 'resync') { catchUp(); return; }
      if (event.assetId !== assetId) return;
      if (event.type === 'doc-update' && (event.reset || (typeof event.epoch === 'number' && typeof current() === 'number' && event.epoch !== current()))) {
        // The document started over (a restore, an edit outside the editor): reopen it, once, unless this browser did it.
        if (restoringRef.current || (typeof event.epoch === 'number' && typeof current() === 'number' && event.epoch <= current())) return;
        reopen(`${event.from?.name && event.from.id !== me ? event.from.name : 'Someone'} restored this report or changed it outside the editor, so it was reloaded.`);
        return;
      }
      if (event.type === 'doc-update') {
        applyRemoteUpdate(doc.ydoc, event.update);
        if (doc.ydoc.store.pendingStructs || doc.ydoc.store.pendingDs) catchUp();
        applyAwareness(event.awareness);
        if (event.from?.id) setEditors((rows) => (rows.some((row) => row.id === event.from.id) ? rows : [...rows, event.from]));
      } else if (event.type === 'doc-presence') {
        const rows = list(event.editors); setEditors(rows);
        applyAwareness(event.awareness); list(event.cursors).forEach((cursor) => applyAwareness(cursor?.awareness));
        if (awareness) {
          const here = new Set(rows.map((row) => row.id));
          const gone = [...awareness.getStates().entries()].filter(([client, state]) => client !== doc.ydoc.clientID && state?.user?.id && !here.has(state.user.id)).map(([client]) => client);
          if (gone.length) removeAwarenessStates(awareness, gone, 'presence');
        }
      } else if (event.type === 'note-changed' && notesOn) {
        clearTimeout(reloadTimer.current); reloadTimer.current = setTimeout(reloadNotes, 200);
      }
    });
    return () => { clearInterval(keepAlive); off(); };
  }, [doc, awareness, notesOn]); // eslint-disable-line react-hooks/exhaustive-deps

  // Notes: load once open, then on every change anyone makes; an Inbox link opens its note.
  useEffect(() => {
    if (!notesOn) { setNotes([]); return; }
    reloadNotes().then((rows) => { const focus = takeNoteFocus(assetId); if (focus && list(rows).some((note) => note.id === focus)) { setPanelOpen(true); setActiveId(focus); } });
  }, [notesOn, assetId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { notesRef.current = draft ? [...notes, { ...draft, id: '__draft', draft: true }] : notes; activeRef.current = draft ? '__draft' : activeId; refreshNoteHighlights(editor); }, [notes, draft, activeId, editor]);
  const placed = useMemo(() => {
    const changedIds = new Set(); const at = new Map();
    if (editor && !editor.isDestroyed) for (const note of notes) { const spot = resolveAnchor(editor.state, note.anchor); if (spot.changed) changedIds.add(note.id); else at.set(note.id, spot.from); }
    const order = [...notes].sort((a, b) => (at.get(a.id) ?? Infinity) - (at.get(b.id) ?? Infinity) || String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
    return { order, changedIds };
  }, [notes, editor, docTick]); // eslint-disable-line react-hooks/exhaustive-deps
  const openCount = notes.filter((note) => !note.resolved).length;

  // People to @mention: the studio's list when it sends one, the team for admins, and everyone already in the notes.
  useEffect(() => {
    if (!mentionsOn || mentionable.length || list(membersIn).length || list(session?.members).length || typeof api.getTeam !== 'function' || !can(viewer, 'getTeam')) return undefined;
    let live = true;
    Promise.resolve().then(() => api.getTeam()).then((result) => { if (live) setTeam(list(result?.members).filter((row) => row && !row.disabled).map((row) => ({ id: row.id, name: row.name || row.email || '' }))); }, () => {});
    return () => { live = false; };
  }, [mentionsOn]); // eslint-disable-line react-hooks/exhaustive-deps
  const members = useMemo(() => {
    // The studio's own list (listReportNotes' mentionable: people who can read this report) wins when it sends one.
    const rows = mentionable.length ? mentionable : [...list(membersIn), ...list(session?.members), ...team, ...editors, ...notes.flatMap((note) => [note.author, ...list(note.replies).map((reply) => reply.author)])];
    const seen = new Map(); for (const row of rows) if (row?.id && row.name && row.id !== me && !seen.has(row.id)) seen.set(row.id, { id: row.id, name: row.name });
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [membersIn, session, team, editors, notes, me, mentionable]);
  const colorOf = useCallback((personId) => colorFor(personId, editors.find((row) => row.id === personId)?.color), [editors]);

  // The notes panel beside the page when there is room, else a sheet over it.
  useEffect(() => {
    const node = rootRef.current; if (!node || typeof ResizeObserver !== 'function') return undefined;
    const observer = new ResizeObserver(([entry]) => setWide((entry?.contentRect?.width || 0) >= 1040));
    observer.observe(node);
    return () => observer.disconnect();
  }, [session]);

  // ---------- "/" menu ----------
  function senseSlash(current) {
    if (!current?.isEditable) { if (slashRef.current) { slashRef.current = null; setSlash(null); } return; }
    const { selection } = current.state; const $from = selection.$from; const text = $from.parent.textContent;
    const fits = selection.empty && $from.parent.type.name === 'paragraph' && /^\/[\p{L}\d ]{0,24}$/u.test(text) && $from.parentOffset === text.length;
    if (!fits) { dismissedRef.current = ''; if (slashRef.current) { slashRef.current = null; setSlash(null); } return; }
    const key = String($from.start());
    if (dismissedRef.current === key) return;
    let top = 28; let left = 0;
    try { const coords = current.view.coordsAtPos($from.start()); const box = pageRef.current?.getBoundingClientRect(); if (box && coords) { top = coords.bottom - box.top + 6; left = Math.max(0, coords.left - box.left); } } catch { /* placed under the line */ }
    const query = text.slice(1).trim().toLowerCase();
    const inTable = current.isActive('table');
    const next = { query, from: $from.start(), to: $from.end(), index: slashRef.current?.query === query ? slashRef.current.index : 0, top, left, inTable };
    slashRef.current = next; setSlash(next);
  }
  function chooseSlash(item) {
    const open = slashRef.current; const current = editorRef.current; if (!open || !current) return;
    slashRef.current = null; setSlash(null);
    item.run(current.chain().focus().deleteRange({ from: open.from, to: open.to })).run();
  }
  function slashKeys(event) {
    const open = slashRef.current; if (!open) return false;
    const items = slashMatches(open.query, open.inTable);
    if (event.key === 'Escape') { dismissedRef.current = String(open.from); slashRef.current = null; setSlash(null); event.stopPropagation(); return true; }
    if (!items.length) return false;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { const index = (open.index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; slashRef.current = { ...open, index }; setSlash(slashRef.current); return true; }
    if (event.key === 'Enter' || event.key === 'Tab') { chooseSlash(items[Math.min(open.index, items.length - 1)]); return true; }
    return false;
  }

  // ---------- Selection menu ----------
  const marks = useEditorState({ editor, selector: ({ editor: current }) => (current && !current.isDestroyed ? { bold: current.isActive('bold'), italic: current.isActive('italic'), link: current.isActive('link'), heading: current.isActive('heading') } : {}) }) || {};
  const bubbleShouldShow = useCallback(({ editor: current, view, state, from, to }) => {
    if (from === to || !(canEdit || canNote) || !(state.selection instanceof TextSelection)) return false;
    if (!state.doc.textBetween(from, to, ' ').trim()) return false;
    const inMenu = Boolean(bubbleRef.current?.contains(document.activeElement));
    return current.isEditable ? view.hasFocus() || inMenu : true;
  }, [canEdit, canNote]);
  // Read-only: a selection that leaves the page closes the menu (an editable page closes it on blur).
  useEffect(() => {
    if (!editor || canEdit || !canNote) return undefined;
    const onChange = () => {
      const selection = document.getSelection?.(); const dom = editor.view.dom;
      if (bubbleRef.current?.contains(document.activeElement)) return;
      if (!selection || selection.isCollapsed || !dom.contains(selection.anchorNode)) {
        const { state } = editor; if (state.selection.empty) return;
        editor.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, state.selection.to)));
      }
    };
    document.addEventListener('selectionchange', onChange);
    return () => document.removeEventListener('selectionchange', onChange);
  }, [editor, canEdit, canNote]);
  useEffect(() => { if (linkOpen) requestAnimationFrame(() => linkInput.current?.focus()); }, [linkOpen]);
  function applyLink(event) {
    event?.preventDefault();
    const href = safeHref(linkValue);
    const chain = editor.chain().focus().extendMarkRange('link');
    (href ? chain.setLink({ href }) : chain.unsetLink()).run();
    setLinkOpen(false);
  }

  // ---------- Notes ----------
  function startNote() {
    if (!canNote || !editor) return false;
    const anchor = anchorFromSelection(editor);
    if (!anchor?.quote) return false;
    setDraft({ anchor }); setActiveId(''); setPanelOpen(true);
    try { editor.view.dispatch(editor.state.tr.setMeta(BUBBLE_KEY, 'hide')); } catch { /* the menu closes on its own */ }
    return true;
  }
  addNoteRef.current = startNote;
  function merge(note) { if (note?.id) setNotes((rows) => (rows.some((row) => row.id === note.id) ? rows.map((row) => (row.id === note.id ? note : row)) : [...rows, note])); }
  async function addNote({ body, mentions, anchor }) {
    const result = await api.saveReportNote({ assetId, anchor, body, mentions });
    setDraft(null); merge(result?.note); if (result?.note?.id) setActiveId(result.note.id);
    reloadNotes();
  }
  async function replyNote({ replyTo, body, mentions }) { const result = await api.saveReportNote({ assetId, replyTo, body, mentions }); if (result?.note?.replies) merge(result.note); reloadNotes(); }
  async function editNote({ noteId, replyTo, body, mentions }) { const result = await api.saveReportNote({ assetId, noteId, ...(replyTo ? { replyTo } : {}), body, mentions }); if (!replyTo || result?.note?.replies) merge(result?.note); reloadNotes(); }
  async function deleteNote({ noteId, replyId }) {
    if (!(await confirm({ title: replyId ? 'Delete this reply?' : 'Delete this note?', lines: [replyId ? 'The reply is removed for everyone.' : 'The note and its replies are removed for everyone.'], confirmLabel: 'Delete', tone: 'danger' }))) return;
    try { await api.deleteReportNote({ assetId, noteId, ...(replyId ? { replyId } : {}) }); if (!replyId) setNotes((rows) => rows.filter((row) => row.id !== noteId)); reloadNotes(); }
    catch (failure) { setNotesProblem(failure?.message || 'That note couldn’t be deleted. Try again.'); }
  }
  async function resolveNote({ noteId, resolved }) {
    try { const result = await api.resolveReportNote({ assetId, noteId, resolved }); merge(result?.note); if (resolved && activeId === noteId) setActiveId(''); reloadNotes(); }
    catch (failure) { setNotesProblem(failure?.message || 'That note couldn’t be changed. Try again.'); }
  }
  function showNote(noteId) {
    setActiveId(noteId);
    const note = notes.find((row) => row.id === noteId); if (!note || !editor) return;
    const spot = resolveAnchor(editor.state, note.anchor); if (spot.changed) return;
    try { const { node } = editor.view.domAtPos(spot.from); const element = node.nodeType === 3 ? node.parentElement : node; element?.scrollIntoView?.({ block: 'center', behavior: reduceMotion() ? 'auto' : 'smooth' }); } catch { /* still marked */ }
  }

  // ---------- History ----------
  const canRestoreVersion = Boolean(session?.live) && typeof api.restoreReportVersion === 'function' && can(viewer, 'restoreReportVersion');
  const canRestoreOriginal = typeof api.restoreStudioAsset === 'function' && can(viewer, 'restoreStudioAsset');
  const hasOriginal = Boolean(edited?.at || status.savedAt || list(session?.versions).length);
  const [versions, setVersions] = useState([]);
  useEffect(() => { setVersions(list(session?.versions)); }, [session]);
  async function refreshVersions() {
    if (!session?.live) return;
    try { const result = await api.openReportDoc({ assetId, clientId: String(session.clientId) }); setVersions(list(result?.versions)); } catch { /* keeps the list it has */ }
  }
  async function previewVersion(version) {
    if (typeof api.readReportVersion !== 'function') return '';
    const result = await api.readReportVersion({ assetId, versionId: version.id });
    return typeof result?.markdown === 'string' ? result.markdown : '';
  }
  function replaceWith(next) {
    replacingRef.current = true; sessionRef.current = next;
    setSession(next); setStatus({ state: 'idle', savedAt: '', error: '', conflict: false });
    callbacks.current.onMarkdown?.(next.markdown);
  }
  // The document started over somewhere else: open it again under a new browser id (once at a time).
  function reopen(message = '') {
    if (reopenRef.current || !sessionRef.current?.live) return reopenRef.current;
    syncRef.current?.destroy(); // what wasn't sent belongs to the old document
    reopenRef.current = openLive().then((next) => { replaceWith(next); if (message) setNotice(message); }, (failure) => setProblem(failure?.message || 'This report couldn’t be reloaded. Close it and open it again.')).finally(() => { reopenRef.current = null; });
    return reopenRef.current;
  }
  async function restoreVersion(version) {
    const original = version.id === 'original';
    const whose = edited?.byName ? `${edited.byName}’s edits` : 'the edits';
    const question = original
      ? { title: 'Restore the original?', lines: [`This removes ${whose}${edited?.at ? ` from ${formatDay(edited.at)}` : ''}. Drafts already made from the edited version stay as they are.`, 'What it says now stays in History.'], confirmLabel: 'Restore the original', tone: 'danger' }
      : { title: 'Restore this version?', lines: [`The report goes back to the version from ${versionWhen(version.at) || 'earlier'}${version.by?.name ? ` by ${version.by.name}` : ''}.`, 'What it says now stays in History.'], confirmLabel: 'Restore this version' };
    if (!(await confirm(question))) return;
    setBusy(true); setProblem('');
    editor?.setEditable(false);
    restoringRef.current = true;
    try {
      await syncRef.current?.flush({ final: true });
      const clientId = newClientId();
      const result = await api.restoreReportVersion({ assetId, versionId: version.id, clientId: String(clientId) });
      replaceWith(liveSession(result, session.markdown, clientId));
      if (original) callbacks.current.onSaved?.({ asset, restored: true, live: true });
    } catch (failure) { editor?.setEditable(canEdit); setProblem(failure?.message || 'That version couldn’t be restored. Try again.'); }
    finally { setBusy(false); setTimeout(() => { restoringRef.current = false; }, 1500); }
  }
  async function restoreOriginal() {
    const whose = edited?.byName ? `${edited.byName}’s edits` : 'the edits';
    if (!(await confirm({ title: 'Restore the original?', lines: [`This removes ${whose}${edited?.at ? ` from ${formatDay(edited.at)}` : ''}. Drafts already made from the edited version stay as they are.`, status.state === 'pending' || status.state === 'error' ? 'Changes that haven’t saved yet are discarded too.' : ''], confirmLabel: 'Restore the original', tone: 'danger' }))) return;
    setBusy(true); setProblem('');
    editor?.setEditable(false); // nothing typed now could be kept
    try {
      if (status.state !== 'error') await syncRef.current?.flush({ final: true });
      const result = await api.restoreStudioAsset({ assetId });
      if (result === null) throw new Error('The original couldn’t be restored. Try again.');
      syncRef.current?.destroy();
      if (session?.live) { restoringRef.current = true; replaceWith(await openLive()); setTimeout(() => { restoringRef.current = false; }, 1500); }
      callbacks.current.onSaved?.({ asset: result?.asset || asset, restored: true });
    } catch (failure) { editor?.setEditable(canEdit); setProblem(failure?.message || 'The original couldn’t be restored. Try again.'); }
    finally { setBusy(false); }
  }

  useImperativeHandle(ref, () => ({
    editor,
    markdown: currentMarkdown,
    flush: (options) => syncRef.current?.flush(options) || Promise.resolve(null),
    get status() { return syncRef.current?.status || status; },
    get dirty() { return Boolean(syncRef.current?.dirty); },
    selectText(excerpt) {
      if (!editor) return false;
      const spot = findQuote(editor.state.doc, excerpt); if (!spot) return false;
      editor.chain().setTextSelection(spot).focus(undefined, { scrollIntoView: false }).run();
      try { const { node } = editor.view.domAtPos(spot.from); (node.nodeType === 3 ? node.parentElement : node)?.scrollIntoView?.({ block: 'center', behavior: reduceMotion() ? 'auto' : 'smooth' }); } catch { /* selected anyway */ }
      return true;
    },
  }), [editor, currentMarkdown, status]);

  if (!session) return <div className={`rd-root is-${variant}`} aria-busy="true"><div className="rd-skeleton" role="status" aria-label="Opening the report"><span /><span /><span /><span /><span /></div></div>;
  const others = editors.filter((row) => row?.id && row.id !== me).map((row) => ({ ...row, color: colorFor(row.id, row.color) }));
  const showBar = canEdit || notesOn || (web && others.length) || barEnd || (canRestoreOriginal && hasOriginal);
  const items = slash ? slashMatches(slash.query, slash.inTable) : [];
  const overlay = panelOpen && !wide;
  return <div ref={rootRef} className={`rd-root is-${variant}${panelOpen ? ' has-notes' : ''}${wide ? ' is-wide' : ''}`} data-spot="report.document">
    {showBar && <div className="rd-bar">
      {web && <Presence people={others} />}
      <span className="rd-bar-space" />
      {canEdit && <SaveStatus status={status} onRetry={() => syncRef.current?.flush()} />}
      {notesOn && <button type="button" className="rd-tool" aria-pressed={panelOpen} aria-label={`Notes, ${openCount} open`} onClick={() => { setPanelOpen((value) => !value); setDraft(null); }}><MessageSquareText size={15} aria-hidden="true" /><span>Notes</span>{openCount > 0 && <span className="rd-count" aria-hidden="true">{openCount}</span>}</button>}
      {(canRestoreVersion || (canRestoreOriginal && hasOriginal)) && <HistoryMenu versions={session.live ? versions : null} canRestore={canRestoreVersion || canRestoreOriginal} hasOriginal={hasOriginal && canRestoreOriginal && !versions.some((row) => row.id === 'original')} busy={busy || !canEdit} onOpen={session.live ? refreshVersions : undefined} onPreview={typeof api.readReportVersion === 'function' ? previewVersion : undefined} onRestore={canRestoreVersion && canEdit ? restoreVersion : undefined} onRestoreOriginal={canEdit ? restoreOriginal : undefined} />}
      {barEnd}
    </div>}
    {notice && !problem && status.state !== 'error' && <div className="rd-alert is-info" role="status"><p>{notice}</p><button type="button" className="rd-quiet" onClick={() => setNotice('')}>OK</button></div>}
    {(problem || status.state === 'error') && <div className="rd-alert" role="alert">
      <p>{problem || status.error}</p>
      {status.conflict && <button type="button" className="rd-quiet" onClick={async () => { setCopied(await copyText(currentMarkdown())); setTimeout(() => setCopied(false), 1800); }}>{copied ? <Check size={14} aria-hidden="true" /> : <ClipboardCopy size={14} aria-hidden="true" />}{copied ? 'Copied' : 'Copy my text'}</button>}
    </div>}
    <div className="rd-layout">
      <div ref={pageRef} className="rd-page">
        <EditorContent editor={editor} className="rd-content" />
        {editor && (canEdit || canNote) && <BubbleMenu editor={editor} pluginKey={BUBBLE_KEY} updateDelay={60} shouldShow={bubbleShouldShow} options={{ placement: 'top', offset: 10, onHide: () => setLinkOpen(false) }} className="rd-bubble" ref={bubbleRef}>
          <div role="toolbar" aria-label="Selected text" className="rd-bubble-inner" onMouseDown={(event) => { if (event.target.tagName !== 'INPUT') event.preventDefault(); }}>
            {linkOpen ? <form className="rd-link-form" noValidate onSubmit={applyLink} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setLinkOpen(false); editor.commands.focus(); } }}>
              <input ref={linkInput} type="url" inputMode="url" aria-label="Link address" placeholder="Paste or type a link" value={linkValue} onChange={(event) => setLinkValue(event.target.value)} />
              <button type="submit" className="rd-bubble-btn" aria-label="Apply link"><Check size={15} aria-hidden="true" /></button>
              {marks.link && <button type="button" className="rd-bubble-btn" aria-label="Remove link" onClick={() => { editor.chain().focus().extendMarkRange('link').unsetLink().run(); setLinkOpen(false); }}><Unlink size={15} aria-hidden="true" /></button>}
            </form> : <>
              {canEdit && <>
                <button type="button" className="rd-bubble-btn" aria-label="Bold" aria-pressed={Boolean(marks.bold)} aria-keyshortcuts={`${ariaKey()}+B`} onClick={() => editor.chain().focus().toggleBold().run()}><Bold size={15} aria-hidden="true" /></button>
                <button type="button" className="rd-bubble-btn" aria-label="Italic" aria-pressed={Boolean(marks.italic)} aria-keyshortcuts={`${ariaKey()}+I`} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic size={15} aria-hidden="true" /></button>
                <button type="button" className="rd-bubble-btn" aria-label="Link" aria-pressed={Boolean(marks.link)} onClick={() => { setLinkValue(editor.getAttributes('link').href || ''); setLinkOpen(true); }}><LinkIcon size={15} aria-hidden="true" /></button>
                <button type="button" className="rd-bubble-btn" aria-label="Heading" aria-pressed={Boolean(marks.heading)} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 size={15} aria-hidden="true" /></button>
              </>}
              {canEdit && canNote && <span className="rd-bubble-rule" aria-hidden="true" />}
              {canNote && <button type="button" className="rd-bubble-btn wide" aria-keyshortcuts={`${ariaKey()}+Alt+M`} onClick={startNote}><MessageSquarePlus size={15} aria-hidden="true" /><span>Add note</span></button>}
            </>}
          </div>
        </BubbleMenu>}
        {slash && items.length > 0 && <ul className="rd-slash" role="listbox" id={`${id}-slash`} aria-label="Insert a block" style={{ top: slash.top, left: slash.left }}>
          {items.map((item, index) => { const Icon = item.icon; return <li key={item.id} role="option" aria-selected={index === Math.min(slash.index, items.length - 1)} onMouseDown={(event) => { event.preventDefault(); chooseSlash(item); }}>
            <span className="rd-slash-icon" aria-hidden="true"><Icon size={15} /></span><span className="rd-slash-label">{item.label}</span><kbd aria-hidden="true">{item.hint}</kbd>
          </li>; })}
        </ul>}
      </div>
      {panelOpen && notesOn && <NotesPanel notes={placed.order} changedIds={placed.changedIds} draft={draft} activeId={activeId} canNote={canNote} mentionsOn={mentionsOn} members={members} me={me} isAdmin={viewer?.base === 'admin' || viewer?.role === 'admin'} loading={notesLoading} problem={notesProblem} colorOf={colorOf} overlay={overlay}
        onClose={() => { setPanelOpen(false); setDraft(null); setActiveId(''); }} onActivate={showNote} onAdd={addNote} onCancelDraft={() => setDraft(null)} onReply={replyNote} onEdit={editNote} onDelete={deleteNote} onResolve={resolveNote} />}
    </div>
  </div>;
});
