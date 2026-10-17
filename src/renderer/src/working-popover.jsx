import React, { useEffect, useId, useRef, useState } from 'react';
import { ArrowUpRight, LoaderCircle, Square } from 'lucide-react';

// The sidebar footer's Working button, shown only while something runs. It opens a small popover of the live runs, each
// with Open (where its progress shows) and Stop (behind the studio's own confirmation, which App supplies). Quick work
// with no run behind it (a refresh, a save) shows as a plain status line instead, since there is nothing to open.
//
// working = { label, runs:[{ id, title, line, kindLabel, onOpen?, onStop?, stopLabel? }] }
export function workingLabel(count) {
  return `${new Intl.NumberFormat().format(count)} running`;
}

export function WorkingPopover({ working, rail = false, placement = 'top' }) {
  const runs = Array.isArray(working?.runs) ? working.runs : [];
  const label = working?.label || (runs.length ? workingLabel(runs.length) : '');
  const [open, setOpen] = useState(false);
  const [stopping, setStopping] = useState('');
  const button = useRef(null); const panel = useRef(null);
  const id = useId();
  useEffect(() => { if (!runs.length) setOpen(false); }, [runs.length]);
  useEffect(() => {
    if (!open) return undefined;
    panel.current?.querySelector('button:not([disabled])')?.focus({ preventScroll: true });
    const away = (event) => { if (!panel.current?.contains(event.target) && !button.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);
  if (!label) return null;
  if (!runs.length) return <span className="sb-working is-status" role="status" data-spot="top.working" data-tip={label}><LoaderCircle className="spin" size={15} aria-hidden="true" /><span className="sb-text">{label}</span></span>;

  function close(refocus = true) { setOpen(false); if (refocus) button.current?.focus({ preventScroll: true }); }
  async function stop(run) {
    setStopping(run.id);
    try { await run.onStop(); } finally { setStopping(''); }
  }
  return <div className="sb-working-wrap">
    <button ref={button} type="button" className="sb-working" data-spot="top.working" data-tip={rail ? label : undefined} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} aria-label={rail ? `${label}. Show what’s running` : undefined} onClick={() => setOpen((value) => !value)}>
      <LoaderCircle className="spin" size={15} aria-hidden="true" /><span className="sb-text">{label}</span>{rail && <span className="sb-dot-count" aria-hidden="true">{runs.length}</span>}
    </button>
    {open && <div ref={panel} id={id} className={`sb-pop sb-working-pop place-${placement}`} role="dialog" aria-label="Working now" onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } }}>
      <h2 className="sb-pop-title">Working now</h2>
      <ul className="sb-run-list">{runs.map((run) => <li key={run.id} className="sb-run">
        <span className="sb-run-copy"><strong>{run.title}</strong><small>{[run.kindLabel, run.line].filter(Boolean).join(' · ')}</small></span>
        <span className="sb-run-actions">
          {run.onOpen && <button type="button" className="sb-run-button" aria-label={`Open ${run.title}`} onClick={() => { close(false); run.onOpen(); }}><ArrowUpRight size={14} aria-hidden="true" />Open</button>}
          {run.onStop && <button type="button" className="sb-run-button is-stop" aria-label={`${run.stopLabel || 'Stop'} ${run.title}`} disabled={stopping === run.id} onClick={() => stop(run)}>{stopping === run.id ? <LoaderCircle className="spin" size={14} aria-hidden="true" /> : <Square size={12} aria-hidden="true" />}{run.stopLabel || 'Stop'}</button>}
        </span>
      </li>)}</ul>
    </div>}
  </div>;
}
