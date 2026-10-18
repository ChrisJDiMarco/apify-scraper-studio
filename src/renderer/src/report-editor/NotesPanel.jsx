import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, CircleAlert, Ellipsis, LoaderCircle, MessageSquareText, Pencil, RotateCcw, Trash2, X } from 'lucide-react';
import { initials } from '../viewer.js';

// The notes side panel: threads anchored to the report's text, with replies, @mentions, edit and delete of your own,
// resolve and reopen. Plain text bodies; a mention is "@Name" in the text plus the member's id in `mentions`.

const list = (value) => (Array.isArray(value) ? value : []);
const nameOf = (person) => String(person?.name || '').trim() || 'Someone';
export function relativeTime(value, now = Date.now()) {
  const ms = Date.parse(value || '');
  if (!Number.isFinite(ms)) return '';
  const minutes = Math.round((now - ms) / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) { const hours = Math.round(minutes / 60); return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`; }
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// The ids of the members whose "@Name" is still in the text.
export function mentionIds(body, members) {
  const text = String(body || '');
  return [...new Set(list(members).filter((member) => member?.id && member.name && text.includes(`@${member.name}`)).map((member) => member.id))];
}

// Body text with its mentions drawn as chips.
function NoteText({ body, mentions, members }) {
  const names = list(mentions).map((id) => list(members).find((member) => member.id === id)?.name).filter(Boolean).sort((a, b) => b.length - a.length);
  if (!names.length) return <p className="rd-note-text">{body}</p>;
  const pattern = new RegExp(`(@(?:${names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')}))`, 'g');
  return <p className="rd-note-text">{String(body).split(pattern).map((part, index) => (index % 2 ? <span key={index} className="rd-mention">{part}</span> : part))}</p>;
}

function Avatar({ person, color }) {
  return <span className="rd-avatar small" aria-hidden="true" style={color ? { '--rd-color': color } : undefined}>{initials(nameOf(person))}</span>;
}

// A text box with an @mention picker. ⌘↵ (Ctrl+Enter) sends; Esc cancels.
export function MentionInput({ value, onChange, members = [], mentionsOn = false, label, placeholder, autoFocus = false, onSubmit, onCancel, disabled = false }) {
  const area = useRef(null);
  const id = useId();
  const [picker, setPicker] = useState(null); // { query, start, index }
  const matches = useMemo(() => {
    if (!picker) return [];
    const q = picker.query.toLowerCase();
    return list(members).filter((member) => member?.id && member.name && (member.name.toLowerCase().split(/\s+/).some((word) => word.startsWith(q)) || member.name.toLowerCase().includes(q))).slice(0, 6);
  }, [picker, members]);
  useEffect(() => { if (autoFocus) area.current?.focus({ preventScroll: true }); }, [autoFocus]);
  useEffect(() => { const node = area.current; if (!node) return; node.style.height = 'auto'; node.style.height = `${Math.min(220, node.scrollHeight + 2)}px`; }, [value]);
  function sense(text, caret) {
    if (!mentionsOn) { setPicker(null); return; }
    const before = text.slice(0, caret);
    const match = /(^|\s)@([\p{L}\d.'-]{0,30})$/u.exec(before);
    setPicker(match ? { query: match[2], start: caret - match[2].length - 1, index: 0 } : null);
  }
  function pick(member) {
    const node = area.current; const caret = node?.selectionStart ?? value.length;
    const next = `${value.slice(0, picker.start)}@${member.name} ${value.slice(caret)}`;
    onChange(next); setPicker(null);
    requestAnimationFrame(() => { const at = picker.start + member.name.length + 2; node?.focus(); node?.setSelectionRange?.(at, at); });
  }
  function onKeyDown(event) {
    if (picker && matches.length) {
      if (event.key === 'ArrowDown') { event.preventDefault(); setPicker({ ...picker, index: (picker.index + 1) % matches.length }); return; }
      if (event.key === 'ArrowUp') { event.preventDefault(); setPicker({ ...picker, index: (picker.index - 1 + matches.length) % matches.length }); return; }
      if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); pick(matches[picker.index] || matches[0]); return; }
    }
    if (event.key === 'Escape') { event.stopPropagation(); if (picker) { event.preventDefault(); setPicker(null); return; } onCancel?.(); return; }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); onSubmit?.(); }
  }
  const listId = `${id}-people`;
  const open = Boolean(picker && matches.length);
  return <div className="rd-input">
    <textarea ref={area} rows={1} aria-label={label} placeholder={placeholder} value={value} disabled={disabled}
      role={mentionsOn ? 'combobox' : undefined} aria-expanded={mentionsOn ? open : undefined} aria-controls={mentionsOn ? listId : undefined} aria-autocomplete={mentionsOn ? 'list' : undefined}
      aria-activedescendant={open ? `${listId}-${picker.index}` : undefined}
      onChange={(event) => { onChange(event.target.value); sense(event.target.value, event.target.selectionStart ?? event.target.value.length); }}
      onKeyDown={onKeyDown} onBlur={() => setTimeout(() => setPicker(null), 120)} />
    {open && <ul className="rd-mentions" id={listId} role="listbox" aria-label="People to mention">
      {matches.map((member, index) => <li key={member.id} id={`${listId}-${index}`} role="option" aria-selected={index === picker.index} onMouseDown={(event) => { event.preventDefault(); pick(member); }}>
        <Avatar person={member} /><span>{member.name}</span>
      </li>)}
    </ul>}
  </div>;
}

function Composer({ initial = '', label, placeholder, submitLabel, members, mentionsOn, autoFocus, onSubmit, onCancel }) {
  const [text, setText] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState('');
  async function submit() {
    const body = text.trim();
    if (!body || saving) return;
    setSaving(true); setProblem('');
    try { await onSubmit(body, mentionIds(body, members)); setText(''); }
    catch (failure) { setProblem(failure?.message || 'That note couldn’t be saved. Try again.'); }
    finally { setSaving(false); }
  }
  return <div className="rd-composer">
    <MentionInput value={text} onChange={setText} members={members} mentionsOn={mentionsOn} label={label} placeholder={placeholder} autoFocus={autoFocus} onSubmit={submit} onCancel={onCancel} disabled={saving} />
    {problem && <p className="rd-error" role="alert">{problem}</p>}
    <div className="rd-composer-actions">
      {onCancel && <button type="button" className="rd-quiet" onClick={onCancel}>Cancel</button>}
      <button type="button" className="rd-send" disabled={!text.trim() || saving} onClick={submit}>{saving && <LoaderCircle className="spin" size={13} aria-hidden="true" />}{submitLabel}</button>
    </div>
  </div>;
}

function Entry({ entry, members, me, isAdmin, canNote, mentionsOn, colorOf, onEdit, onDelete, kind = 'note' }) {
  const [editing, setEditing] = useState(false);
  const [menu, setMenu] = useState(false);
  const mine = Boolean(me) && entry.author?.id === me;
  const mayEdit = canNote && mine;
  const mayDelete = canNote && (mine || isAdmin);
  useEffect(() => {
    if (!menu) return undefined;
    const away = () => setMenu(false);
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [menu]);
  const who = nameOf(entry.author);
  return <div className={`rd-entry kind-${kind}`}>
    <div className="rd-entry-head">
      <Avatar person={entry.author} color={colorOf(entry.author?.id)} />
      <span className="rd-entry-who"><strong>{who}</strong><time dateTime={entry.createdAt} title={entry.createdAt ? new Date(entry.createdAt).toLocaleString() : undefined}>{relativeTime(entry.createdAt)}{entry.editedAt ? ' · edited' : ''}</time></span>
      {(mayEdit || mayDelete) && !editing && <span className="rd-entry-more">
        <button type="button" className="rd-icon" aria-label={`More for ${kind === 'reply' ? 'reply' : 'note'} by ${who}`} aria-haspopup="menu" aria-expanded={menu} onMouseDown={(event) => event.stopPropagation()} onClick={() => setMenu((value) => !value)}><Ellipsis size={15} aria-hidden="true" /></button>
        {menu && <span className="rd-menu" role="menu" onMouseDown={(event) => event.stopPropagation()}>
          {mayEdit && <button type="button" role="menuitem" onClick={() => { setMenu(false); setEditing(true); }}><Pencil size={14} aria-hidden="true" />Edit</button>}
          {mayDelete && <button type="button" role="menuitem" className="danger" onClick={() => { setMenu(false); onDelete(); }}><Trash2 size={14} aria-hidden="true" />Delete</button>}
        </span>}
      </span>}
    </div>
    {editing ? <Composer initial={entry.body} label={`Edit your ${kind === 'reply' ? 'reply' : 'note'}`} submitLabel="Save" members={members} mentionsOn={mentionsOn} autoFocus onCancel={() => setEditing(false)} onSubmit={async (body, mentions) => { await onEdit(body, mentions); setEditing(false); }} />
      : <NoteText body={entry.body} mentions={entry.mentions} members={members} />}
  </div>;
}

function Thread({ note, active, changed, members, me, isAdmin, canNote, mentionsOn, colorOf, onActivate, onReply, onEdit, onDelete, onResolve }) {
  const [replying, setReplying] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);
  useEffect(() => { if (active) ref.current?.scrollIntoView?.({ block: 'nearest', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); }, [active]);
  const resolved = Boolean(note.resolved);
  async function toggleResolved() { setBusy(true); try { await onResolve(!resolved); } finally { setBusy(false); } }
  return <article ref={ref} className={`rd-thread${active ? ' is-active' : ''}${resolved ? ' is-resolved' : ''}`} aria-label={`Note by ${nameOf(note.author)}`} data-note={note.id}>
    {note.anchor?.quote && <button type="button" className={`rd-quote${changed ? ' is-changed' : ''}`} onClick={() => onActivate(note.id)} title={changed ? 'The text this note was on has changed' : 'Show this in the report'}>
      <span>{note.anchor.quote}</span>{changed && <em><CircleAlert size={12} aria-hidden="true" />text was changed</em>}
    </button>}
    <Entry entry={note} members={members} me={me} isAdmin={isAdmin} canNote={canNote} mentionsOn={mentionsOn} colorOf={colorOf} onEdit={(body, mentions) => onEdit({ noteId: note.id, body, mentions })} onDelete={() => onDelete({ noteId: note.id })} />
    {list(note.replies).length > 0 && <div className="rd-replies">{list(note.replies).map((reply) => <Entry key={reply.id} kind="reply" entry={reply} members={members} me={me} isAdmin={isAdmin} canNote={canNote} mentionsOn={mentionsOn} colorOf={colorOf} onEdit={(body, mentions) => onEdit({ noteId: reply.id, replyTo: note.id, body, mentions })} onDelete={() => onDelete({ noteId: note.id, replyId: reply.id })} />)}</div>}
    {resolved && <p className="rd-resolved-line"><Check size={13} aria-hidden="true" />Resolved{note.resolved?.by?.name ? ` by ${note.resolved.by.name}` : ''}{note.resolved?.at ? ` · ${relativeTime(note.resolved.at)}` : ''}</p>}
    {canNote && <div className="rd-thread-actions">
      {!resolved && !replying && <button type="button" className="rd-quiet" onClick={() => setReplying(true)}>Reply</button>}
      <button type="button" className="rd-quiet" disabled={busy} onClick={toggleResolved}>{resolved ? <><RotateCcw size={13} aria-hidden="true" />Reopen</> : <><Check size={13} aria-hidden="true" />Resolve</>}</button>
    </div>}
    {replying && <Composer label={`Reply to ${nameOf(note.author)}`} placeholder={mentionsOn ? 'Reply, or @mention someone' : 'Reply'} submitLabel="Reply" members={members} mentionsOn={mentionsOn} autoFocus onCancel={() => setReplying(false)} onSubmit={async (body, mentions) => { await onReply({ replyTo: note.id, body, mentions }); setReplying(false); }} />}
  </article>;
}

// `notes` are in document order; `changedIds` holds the notes whose text is gone; `draft` is the note being written
// ({ anchor }), shown first with its composer.
export function NotesPanel({ notes = [], changedIds = new Set(), draft = null, activeId = '', canNote = false, mentionsOn = false, members = [], me = '', isAdmin = false, loading = false, problem = '', colorOf = () => '', onClose, onActivate, onAdd, onCancelDraft, onReply, onEdit, onDelete, onResolve, overlay = false }) {
  const [showResolved, setShowResolved] = useState(false);
  const titleId = useId();
  const panel = useRef(null);
  const open = notes.filter((note) => !note.resolved);
  const resolved = notes.filter((note) => note.resolved);
  const shown = showResolved ? resolved : open;
  useEffect(() => {
    if (!overlay) return undefined;
    const previous = document.activeElement;
    // Into the note being written when there is one, else the panel's first control.
    (panel.current?.querySelector('textarea') || panel.current?.querySelector('button'))?.focus({ preventScroll: true });
    return () => { if (previous?.isConnected) previous.focus?.({ preventScroll: true }); };
  }, [overlay]);
  // As an overlay the panel is drawn at the app frame's top level: inside the reader, the sticky toolbar's backdrop blur
  // made its own stacking layer and painted over the panel's corner.
  const node = <aside ref={panel} className={`rd-notes${overlay ? ' is-overlay' : ''}`} aria-labelledby={titleId} onKeyDown={(event) => { if (event.key === 'Escape' && !event.defaultPrevented) { event.stopPropagation(); onClose(); } }}>
    <header className="rd-notes-head">
      <h2 id={titleId}><MessageSquareText size={16} aria-hidden="true" />Notes</h2>
      <div className="rd-segment" role="group" aria-label="Show notes">
        <button type="button" aria-pressed={!showResolved} onClick={() => setShowResolved(false)}>Open<span>{open.length}</span></button>
        <button type="button" aria-pressed={showResolved} onClick={() => setShowResolved(true)}>Resolved<span>{resolved.length}</span></button>
      </div>
      <button type="button" className="rd-icon" aria-label="Close notes" onClick={onClose}><X size={16} aria-hidden="true" /></button>
    </header>
    <div className="rd-notes-body">
      {draft && <article className="rd-thread is-active is-draft" aria-label="New note">
        {draft.anchor?.quote && <p className="rd-quote static"><span>{draft.anchor.quote}</span></p>}
        <Composer label="Your note" placeholder={mentionsOn ? 'Add a note, or @mention someone' : 'Add a note'} submitLabel="Add note" members={members} mentionsOn={mentionsOn} autoFocus onCancel={onCancelDraft} onSubmit={(body, mentions) => onAdd({ body, mentions, anchor: draft.anchor })} />
      </article>}
      {problem && <p className="rd-error" role="alert">{problem}</p>}
      {loading && !notes.length ? <p className="rd-notes-empty" role="status"><LoaderCircle className="spin" size={14} aria-hidden="true" />Loading notes…</p>
        : !shown.length && !draft ? <p className="rd-notes-empty">{showResolved ? 'No resolved notes.' : canNote ? 'No open notes. Select text and choose Add note to start one.' : 'No open notes on this report.'}</p>
        : shown.map((note) => <Thread key={note.id} note={note} active={note.id === activeId} changed={changedIds.has(note.id)} members={members} me={me} isAdmin={isAdmin} canNote={canNote} mentionsOn={mentionsOn} colorOf={colorOf} onActivate={onActivate} onReply={onReply} onEdit={onEdit} onDelete={onDelete} onResolve={(value) => onResolve({ noteId: note.id, resolved: value })} />)}
    </div>
  </aside>;
  const host = overlay && typeof document !== 'undefined' ? (document.querySelector('.app-shell') || document.body) : null;
  return host ? createPortal(<div className="rd-portal">{node}</div>, host) : node;
}
