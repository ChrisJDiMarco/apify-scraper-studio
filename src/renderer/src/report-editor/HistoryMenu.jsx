import React, { useEffect, useId, useRef, useState } from 'react';
import { History, LoaderCircle, RotateCcw, X } from 'lucide-react';
import { MarkdownContent } from '../markdown-content.jsx';

// History, in a menu: the report's versions (who and when), a preview of one, and restore. The original generated
// version stays restorable too.
const list = (value) => (Array.isArray(value) ? value : []);
export const versionWhen = (value) => { const date = new Date(value || 0); return value && !Number.isNaN(date.getTime()) ? date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''; };

// `versions` is null on a studio that keeps no versions (only the original can be restored there).
export function HistoryMenu({ versions = [], canRestore = false, hasOriginal = false, busy = false, onOpen, onPreview, onRestore, onRestoreOriginal }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState(null); // { version, markdown, loading }
  const button = useRef(null); const menu = useRef(null);
  const id = useId();
  useEffect(() => {
    if (!open) return undefined;
    const away = (event) => { if (!menu.current?.contains(event.target) && !button.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('mousedown', away);
    requestAnimationFrame(() => menu.current?.querySelector('button')?.focus({ preventScroll: true }));
    return () => document.removeEventListener('mousedown', away);
  }, [open]);
  async function toggle() {
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (onOpen) { setLoading(true); try { await onOpen(); } finally { setLoading(false); } }
  }
  async function show(version) {
    setOpen(false);
    setPreview({ version, markdown: typeof version.markdown === 'string' ? version.markdown : '', loading: typeof version.markdown !== 'string' });
    if (typeof version.markdown === 'string' || !onPreview) { setPreview((current) => current && { ...current, loading: false }); return; }
    const markdown = await Promise.resolve().then(() => onPreview(version)).catch(() => '');
    setPreview((current) => (current?.version.id === version.id ? { ...current, markdown: typeof markdown === 'string' ? markdown : '', loading: false } : current));
  }
  function onMenuKey(event) {
    const items = [...(menu.current?.querySelectorAll('button') || [])]; const index = items.indexOf(document.activeElement);
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); button.current?.focus(); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); items[(index + 1) % items.length]?.focus(); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); items[(index - 1 + items.length) % items.length]?.focus(); }
    else if (event.key === 'Tab') setOpen(false);
  }
  const rows = list(versions);
  return <span className="rd-history">
    <button ref={button} type="button" className="rd-tool" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? `${id}-menu` : undefined} onClick={toggle}><History size={15} aria-hidden="true" /><span>History</span></button>
    {open && <div ref={menu} id={`${id}-menu`} className="rd-menu rd-history-menu" role="menu" aria-label="Versions" onKeyDown={onMenuKey}>
      {loading && !rows.length ? <p className="rd-menu-note" role="status"><LoaderCircle className="spin" size={13} aria-hidden="true" />Loading versions…</p>
        : !rows.length && Array.isArray(versions) && <p className="rd-menu-note">No saved versions yet. Versions are kept as people edit.</p>}
      {rows.map((version) => <button key={version.id} type="button" role="menuitem" onClick={() => show(version)}>
        <span className="rd-version-when">{versionWhen(version.at) || 'A version'}</span>
        <small>{[version.by?.name, version.label].filter(Boolean).join(' · ')}</small>
      </button>)}
      {hasOriginal && canRestore && onRestoreOriginal && <button type="button" role="menuitem" className="rd-version-original" disabled={busy} onClick={() => { setOpen(false); onRestoreOriginal(); }}>
        <span className="rd-version-when"><RotateCcw size={13} aria-hidden="true" />Original version</span><small>Restore the generated text</small>
      </button>}
    </div>}
    {preview && <div className="rd-preview-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setPreview(null); }}>
      <section className="rd-preview" role="dialog" aria-modal="true" aria-labelledby={`${id}-preview`} onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); setPreview(null); } }}>
        <header><div><small>Version</small><h2 id={`${id}-preview`}>{versionWhen(preview.version.at) || 'A version'}{preview.version.by?.name ? ` · ${preview.version.by.name}` : ''}</h2></div>
          <button type="button" className="rd-icon" aria-label="Close preview" autoFocus onClick={() => setPreview(null)}><X size={16} aria-hidden="true" /></button></header>
        <div className="rd-preview-body">
          {preview.loading ? <p className="rd-menu-note" role="status"><LoaderCircle className="spin" size={14} aria-hidden="true" />Opening this version…</p>
            : preview.markdown ? <MarkdownContent>{preview.markdown}</MarkdownContent>
            : <p className="rd-menu-note">A preview isn’t available for this version. Restoring it replaces the current text; later versions stay in History.</p>}
        </div>
        {canRestore && onRestore && <footer><button type="button" className="rd-quiet" onClick={() => setPreview(null)}>Close</button><button type="button" className="rd-send" disabled={busy} onClick={async () => { const version = preview.version; setPreview(null); await onRestore(version); }}><RotateCcw size={14} aria-hidden="true" />Restore this version</button></footer>}
      </section>
    </div>}
  </span>;
}
