import React, { useEffect, useId, useRef } from 'react';
import { Check, Circle, X } from 'lucide-react';
import './workspace-setup-guide.css';

// Shown right after a new workspace is created: Home's setup list (next-steps.js setupChecklist), each step one button
// away. App builds the steps ({ id, label, detail, done, optional, actionLabel, action: () => void | null }) because it
// owns the navigation. Closing it loses nothing: the same list stays on Home until it's done. The walkthrough is offered
// here as a link, so it never arrives as a second dialog.
export function WorkspaceSetupGuide({ name = '', steps = [], onClose, onTour }) {
  const titleId = useId();
  const panelRef = useRef(null);
  useEffect(() => {
    const before = document.activeElement;
    panelRef.current?.querySelector('.ws-guide-go, .confirm-cancel')?.focus();
    // Capture phase, so Esc closes this and never also something behind it.
    const onKey = (event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose?.(); } };
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('keydown', onKey, true); if (before && typeof before.focus === 'function' && before.isConnected) before.focus(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const go = (step) => { onClose?.(); step.action?.(); };
  const rows = Array.isArray(steps) ? steps : [];
  const left = rows.filter((step) => !step.done && !step.optional).length;
  return <div className="confirm-backdrop ws-guide-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose?.(); }}>
    <div ref={panelRef} className="confirm-dialog ws-guide" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <header className="ws-guide-head">
        <div><h2 id={titleId}>Set up {name || 'your workspace'}</h2>
          <p>{left ? `${left === 1 ? 'One thing' : `${left} things`} left to get it ready. This list stays on Home until it’s done.` : 'Everything needed is in place. The optional steps are below.'}</p></div>
        <button type="button" className="ws-guide-close" aria-label="Close" onClick={() => onClose?.()}><X size={16} aria-hidden="true" /></button>
      </header>
      <ol className="ws-guide-steps">{rows.map((step) => <li key={step.id} className={step.done ? 'is-done' : ''}>
        <span className="ws-guide-mark" aria-hidden="true">{step.done ? <Check size={14} /> : <Circle size={14} />}</span>
        <div className="ws-guide-text"><strong>{step.label}{step.optional && <span className="ws-guide-optional">Optional</span>}</strong>{step.detail && <small>{step.detail}</small>}</div>
        {step.done ? <span className="ws-guide-done">Done</span>
          : step.action ? <button type="button" className="ws-guide-go" onClick={() => go(step)}>{step.actionLabel || 'Open'}</button>
            : <span className="ws-guide-done">Ask an admin</span>}
      </li>)}</ol>
      <div className="confirm-buttons ws-guide-foot">{onTour && <button type="button" className="ws-guide-tour" onClick={() => onTour()}>Take a two-minute tour of the studio</button>}<button type="button" className="confirm-cancel" onClick={() => onClose?.()}>I’ll do this later</button></div>
    </div>
  </div>;
}
