import React, { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { TriangleAlert } from 'lucide-react';
import './chat-cards.css';

// The in-app confirmation that replaces window.confirm, so the person reads what will happen (and what it costs) in the
// studio's own type and answers with a button, and the caller awaits the answer instead of blocking the window.
// const confirm = useConfirm(); if (!(await confirm({ title, lines, items, note, confirmLabel, cancelLabel, tone }))) return false;
// confirm('Stop it?') works too. It resolves true or false; one dialog shows at a time and later requests wait their turn.
// Without a ConfirmProvider above it (old mounts, tests) useConfirm falls back to window.confirm with the same words.
const ConfirmContext = createContext(null);
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const textList = (value) => (Array.isArray(value) ? value : value == null || value === '' ? [] : [value]).map((line) => String(line ?? '').trim()).filter(Boolean);
let nextKey = 0;

export function confirmOptions(options) {
  const value = typeof options === 'string' ? { title: options } : options && typeof options === 'object' ? options : {};
  // A message with blank lines between paragraphs reads as separate lines, as window.confirm text did.
  const lines = value.lines != null ? textList(value.lines) : textList(String(value.message || '').split(/\n{2,}/));
  return {
    title: String(value.title || 'Are you sure?').trim(), lines, items: textList(value.items).slice(0, 20), note: String(value.note || '').trim(),
    confirmLabel: String(value.confirmLabel || 'Continue'), cancelLabel: String(value.cancelLabel || 'Cancel'), tone: value.tone === 'danger' ? 'danger' : 'default',
  };
}

function fallbackConfirm(options) {
  const { title, lines, items, note } = confirmOptions(options);
  const text = [title, ...lines, items.map((item) => `• ${item}`).join('\n'), note].filter(Boolean).join('\n\n');
  return Promise.resolve(typeof window !== 'undefined' && typeof window.confirm === 'function' ? Boolean(window.confirm(text)) : false);
}

export function useConfirm() {
  return useContext(ConfirmContext) || fallbackConfirm;
}

// container (optional): a function returning the element to render into, e.g. () => frameRef.current, so the dialog
// picks up that element's tokens (the Semrush shell's accent). Without one it renders where the provider sits.
export function ConfirmProvider({ children, container }) {
  const [queue, setQueue] = useState([]);
  const queueRef = useRef(queue); queueRef.current = queue;
  const confirm = useCallback((options) => new Promise((resolve) => {
    const request = { ...confirmOptions(options), resolve, key: ++nextKey };
    setQueue((current) => [...current, request]);
  }), []);
  const answer = useCallback((value) => {
    const [first] = queueRef.current;
    if (!first) return;
    first.resolve(Boolean(value));
    setQueue((current) => current.filter((request) => request.key !== first.key));
  }, []);
  // A provider that goes away (a role change remounts the shell) answers "no" to anything still asking.
  useEffect(() => () => { for (const request of queueRef.current) request.resolve(false); }, []);
  const current = queue[0] || null;
  const dialog = current ? <ConfirmDialog key={current.key} request={current} onAnswer={answer} /> : null;
  const host = typeof container === 'function' ? container() : container || null;
  return <ConfirmContext.Provider value={confirm}>{children}{dialog && (host ? createPortal(dialog, host) : dialog)}</ConfirmContext.Provider>;
}

function ConfirmDialog({ request, onAnswer }) {
  const titleId = useId(); const bodyId = useId();
  const panelRef = useRef(null); const confirmRef = useRef(null); const cancelRef = useRef(null);
  const danger = request.tone === 'danger';
  useEffect(() => {
    const before = document.activeElement;
    // Something that deletes starts on Cancel; everything else starts on the button that does what was clicked.
    (danger ? cancelRef : confirmRef).current?.focus();
    // Capture phase, so Esc answers this dialog and never also closes the Ask AI drawer or a report behind it.
    const onKey = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onAnswer(false); return; }
      if (event.key !== 'Tab') return;
      const nodes = [...(panelRef.current?.querySelectorAll(FOCUSABLE) || [])];
      if (!nodes.length) return;
      const first = nodes[0]; const last = nodes[nodes.length - 1];
      if (!panelRef.current.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('keydown', onKey, true); if (before && typeof before.focus === 'function' && before.isConnected) before.focus(); };
  }, [request.key]);
  return <div className="confirm-backdrop">
    <div ref={panelRef} className={`confirm-dialog${danger ? ' is-danger' : ''}`} role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={bodyId}>
      <h2 id={titleId}>{danger && <TriangleAlert size={17} aria-hidden="true" />}{request.title}</h2>
      <div id={bodyId} className="confirm-body">
        {request.lines.map((line, index) => <p key={index}>{line}</p>)}
        {request.items.length > 0 && <ul>{request.items.map((item, index) => <li key={index}>{item}</li>)}</ul>}
        {request.note && <p className="confirm-note">{request.note}</p>}
      </div>
      <div className="confirm-buttons">
        <button type="button" ref={cancelRef} className="confirm-cancel" onClick={() => onAnswer(false)}>{request.cancelLabel}</button>
        <button type="button" ref={confirmRef} className="confirm-ok" onClick={() => onAnswer(true)}>{request.confirmLabel}</button>
      </div>
    </div>
  </div>;
}
