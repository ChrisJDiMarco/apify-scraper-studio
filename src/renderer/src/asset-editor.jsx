import React, { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Check, ClipboardCopy, LoaderCircle, PenLine, RotateCcw } from 'lucide-react';
import { MarkdownContent } from './markdown-content.jsx';
import { copyText } from './role-screens.jsx';
import { PREVIEW_TITLE, formatDay, useViewer, writeProps } from './viewer.js';
import './asset-editor.css';

// Editing a report in place (Simple's reader, and KitFileViewer for admins and editors). The edit is saved next to
// the original, and every later draft, kit and Ask AI answer reads the edited text. Unsaved work is guarded: App and
// Simple ask the guard before navigating, the editor itself guards Cancel and Esc, and the web also gets beforeunload.
export const LEAVE_MESSAGE = 'Leave without saving your edits?';
export const MAX_EDIT_CHARS = 250000;
export const canEditAsset = (asset) => Boolean(asset) && !['image', 'video'].includes(asset.kind) && asset.deliverableId !== 'landingpage';

export function createUnsavedGuard() {
  const dirty = new Set();
  return {
    set(key, isDirty) { if (isDirty) dirty.add(key); else dirty.delete(key); },
    isDirty: () => dirty.size > 0,
    // True means go ahead. Asks only when something is unsaved; the editor's own unmount clears its mark.
    confirmLeave: (message = LEAVE_MESSAGE) => !dirty.size || window.confirm(message),
  };
}
// Works without a provider: everything shares one guard unless App provides its own.
const sharedGuard = createUnsavedGuard();
export const UnsavedContext = createContext(sharedGuard);
export const useUnsavedGuard = () => useContext(UnsavedContext) || sharedGuard;

const runWith = (action, fn) => (action ? action(fn, '', true) : Promise.resolve().then(fn));
const isElectron = () => typeof navigator !== 'undefined' && /Electron\//.test(navigator.userAgent || '');

// `edited` is the edit the shown text was loaded from (null for the generated text): Save sends it as the base, so a save
// made by someone else since then is refused instead of overwritten. `detached` explains why this report can't be saved
// here anymore; the text stays, with Copy my text.
export function AssetEditor({ api, asset, markdown = '', edited = null, onSaved, onCancel, action, web, detached = '' }) {
  const viewer = useViewer();
  const guard = useUnsavedGuard();
  const key = useId();
  const [text, setText] = useState(markdown);
  const [view, setView] = useState('write');
  const [saving, setSaving] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [problem, setProblem] = useState('');
  const [conflict, setConflict] = useState(false);
  const [copied, setCopied] = useState(false);
  const area = useRef(null);
  const base = useRef(edited?.at || ''); // the version this person opened, for the server's conflict check
  const dirty = text !== markdown;
  const over = text.length > MAX_EDIT_CHARS;
  const browser = web ?? !isElectron();
  const saveRef = useRef(null);

  useEffect(() => { guard.set(key, dirty); }, [dirty]);
  useEffect(() => () => guard.set(key, false), []);
  useEffect(() => {
    if (!dirty || !browser) return undefined;
    const hold = (event) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', hold);
    return () => window.removeEventListener('beforeunload', hold);
  }, [dirty, browser]);
  // ⌘S saves from anywhere while the editor is open, instead of the browser's "Save page".
  useEffect(() => {
    const onKey = (event) => { if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 's') { event.preventDefault(); saveRef.current?.(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useLayoutEffect(() => {
    const node = area.current; if (!node || view !== 'write') return;
    node.style.height = 'auto'; node.style.height = `${node.scrollHeight + 2}px`;
  }, [text, view]);
  useEffect(() => { area.current?.focus({ preventScroll: true }); area.current?.setSelectionRange?.(0, 0); }, []);

  if (!canEditAsset(asset)) return <div className="studio-editor is-unavailable" role="note"><p className="studio-hint">Pictures and landing pages can’t be edited here.</p>{onCancel && <button type="button" className="studio-quiet small" onClick={onCancel}>Close</button>}</div>;

  function leave() { if (dirty && !window.confirm(LEAVE_MESSAGE)) return; guard.set(key, false); onCancel?.(); }
  async function save() {
    if (!dirty || saving || over || viewer.preview || detached || !api?.editStudioAsset) return;
    setSaving(true); setProblem(''); setConflict(false);
    try {
      const result = await runWith(action, () => api.editStudioAsset({ assetId: asset.id, markdown: text, baseEditedAt: base.current }));
      setSaving(false);
      if (result === null) { setProblem('Your edits couldn’t be saved. Your text is still here. Try again.'); return; }
      base.current = result?.asset?.edited?.at || base.current;
      guard.set(key, false);
      onSaved?.({ asset: result?.asset || asset, markdown: text });
    } catch (failure) {
      setSaving(false);
      // Someone else saved after this person opened the report: keep their text on screen so nothing is lost.
      setConflict(failure?.status === 409 || failure?.code === 409 || /after you opened it/i.test(String(failure?.message || '')));
      setProblem(failure?.message || 'Your edits couldn’t be saved. Your text is still here. Try again.');
    }
  }
  saveRef.current = save;
  async function restore() {
    const whose = edited?.byName ? `${edited.byName}’s edits` : 'the edits';
    if (!window.confirm(`Restore the original? This removes ${whose}${edited?.at ? ` from ${formatDay(edited.at)}` : ''}. Drafts already made from the edited version stay as they are.`)) return;
    setRestoring(true); setProblem('');
    try {
      const result = await runWith(action, () => api.restoreStudioAsset({ assetId: asset.id }));
      setRestoring(false);
      if (result === null) { setProblem('The original couldn’t be restored. Try again.'); return; }
      guard.set(key, false);
      onSaved?.({ asset: result?.asset || asset, restored: true });
    } catch (failure) { setRestoring(false); setProblem(failure?.message || 'The original couldn’t be restored. Try again.'); }
  }
  function onKeyDown(event) {
    if (event.key !== 'Escape') return;
    // The reader closes on Esc; while editing, Esc means Cancel (with a question if there are edits).
    event.stopPropagation(); event.preventDefault(); leave();
  }
  const busy = saving || restoring;
  return <section className="studio-editor" aria-label={`Editing ${asset.title || 'the report'}`} onKeyDown={onKeyDown} data-spot="report.editor">
    <div className="studio-editor-bar">
      <span className="studio-editor-state"><PenLine size={15} aria-hidden="true" />Editing{dirty && <em>Unsaved changes</em>}</span>
      <div className="studio-segment" role="group" aria-label="Show">
        <button type="button" aria-pressed={view === 'write'} onClick={() => setView('write')}>Write</button>
        <button type="button" aria-pressed={view === 'preview'} onClick={() => setView('preview')}>Preview</button>
      </div>
      <span className="studio-editor-actions">
        {edited?.at && api?.restoreStudioAsset && <button type="button" className="studio-link" {...writeProps(viewer, busy)} onClick={restore}><RotateCcw size={14} aria-hidden="true" />Restore the original</button>}
        <button type="button" className="studio-quiet small" disabled={busy} onClick={leave}>Cancel</button>
        <button type="button" className="studio-primary small" aria-keyshortcuts="Meta+S" {...writeProps(viewer, !dirty || busy || over || Boolean(detached))} title={viewer.preview ? PREVIEW_TITLE : over ? `Keep it under ${MAX_EDIT_CHARS.toLocaleString()} characters to save.` : 'Save (⌘S)'} onClick={save}>{saving ? <LoaderCircle className="spin" size={14} aria-hidden="true" /> : null}{saving ? 'Saving…' : 'Save'}<kbd aria-hidden="true">⌘S</kbd></button>
      </span>
    </div>
    {(problem || detached) && <div className="studio-editor-problem" role="alert"><p>{detached || problem}</p>{(conflict || detached) && <button type="button" className="studio-quiet small" onClick={async () => { setCopied(await copyText(text)); setTimeout(() => setCopied(false), 1800); }}>{copied ? <Check size={14} aria-hidden="true" /> : <ClipboardCopy size={14} aria-hidden="true" />}{copied ? 'Copied' : 'Copy my text'}</button>}</div>}
    {view === 'write' ? <div className="studio-editor-write">
      <textarea ref={area} className="studio-editor-text" aria-label={`Text of ${asset.title || 'the report'}`} aria-describedby={`${key}-hint`} value={text} spellCheck onChange={(event) => { setText(event.target.value); if (problem && !conflict) setProblem(''); }} />
      <p id={`${key}-hint`} className="studio-editor-hint"><span># Heading · **bold** · - list · [text](https://…)</span><span className={over ? 'over' : ''}>{text.length.toLocaleString()} characters{over ? ` · keep it under ${MAX_EDIT_CHARS.toLocaleString()}` : ''}</span></p>
    </div>
      : <div className="studio-editor-preview">{text.trim() ? <MarkdownContent>{text}</MarkdownContent> : <p className="studio-hint">Nothing to preview yet.</p>}</div>}
  </section>;
}
