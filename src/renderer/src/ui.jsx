import React, { cloneElement, isValidElement } from 'react';
import { flushSync } from 'react-dom';

// Moves between states morph instead of cutting (styles in craft.css). Falls back to an instant update.
// `types` lets a local move (a card changing column) skip the full-page rise used for navigation.
export function withViewTransition(update, types = []) {
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (!document.startViewTransition || reduce || document.hidden) return update();
  try { document.startViewTransition({ update: () => flushSync(update), types }); }
  catch { document.startViewTransition(() => flushSync(update)); }
}

export function label(value) {
  return value ? `${String(value)[0].toUpperCase()}${String(value).slice(1)}` : 'Idle';
}

export function short(value, length = 96) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > length ? `${text.slice(0, length - 1).trimEnd()}…` : text;
}

// Provider failures read as what happened and what to do next, never as exit codes or IPC plumbing.
export function friendlyMessage(value) {
  const text = String(value?.message || value || '').trim();
  const exit = /^(Claude|Codex|AI) exited with (?:code )?(\d+)\.?$/i.exec(text);
  if (exit) return `${/codex/i.test(exit[1]) ? 'Codex' : 'Claude'} stopped before finishing (exit code ${exit[2]}). Check the Claude connection in Settings, then retry.`;
  return text.replace(/^Error invoking remote method '[^']+':\s*/, '').replace(/^(?:[A-Za-z]*Error):\s*/, '');
}

// Collection names carry a run timestamp ("Reddit · topic 9/27/2026, 3:27:22 PM"). Lists already show the
// date, so titles drop it; pickers show a short date instead so repeated runs stay distinguishable.
const RUN_STAMP = /\s+\d{1,2}\/\d{1,2}\/\d{2,4},?\s+\d{1,2}:\d{2}(?::\d{2})?\s?(?:[AP]M)?$/i;
export function datasetTitle(dataset) { return String(dataset?.name || '').replace(RUN_STAMP, '').trim() || 'Untitled dataset'; }
export function datasetLabel(dataset, { rows = false } = {}) {
  const stamped = RUN_STAMP.test(String(dataset?.name || ''));
  const when = stamped && dataset?.createdAt ? new Date(dataset.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
  return [datasetTitle(dataset), when, rows ? `${number(dataset?.itemCount)} rows` : ''].filter(Boolean).join(' · ');
}

// Model IDs read as product names: claude-opus-5-5 → Claude Opus 5.5.
export function modelLabel(id) {
  const match = /^claude-([a-z]+)-(\d+)-(\d+)/i.exec(String(id || ''));
  return match ? `Claude ${match[1][0].toUpperCase()}${match[1].slice(1)} ${match[2]}.${match[3]}` : String(id || '');
}

export function number(value) {
  return new Intl.NumberFormat().format(Number(value) || 0);
}

export function formatDate(value) {
  if (!value) return 'Not started';
  return new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function statusTone(status) {
  if (status === 'succeeded' || status === 'Ready') return 'ready';
  if (status === 'failed' || status === 'cancelled' || status === 'Needs tags') return 'warning';
  if (status === 'running' || status === 'Codex') return 'running';
  return 'neutral';
}

export function JsonBlock({ value }) {
  return <pre className="json-block">{JSON.stringify(value, null, 2)}</pre>;
}

export function Button({ children, className = '', tone = '', ...props }) {
  return <button className={[className, tone].filter(Boolean).join(' ')} {...props}>{children}</button>;
}

export function Badge({ children, tone = 'neutral' }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function Panel({ children, className = '', as: Tag = 'section' }) {
  return <Tag className={`panel ${className}`.trim()}>{children}</Tag>;
}

export function Field({ label: text, error, children }) {
  const id = isValidElement(children) ? children.props.id || children.props.name : '';
  const describedBy = error && id ? `${id}-error` : undefined;
  const control = isValidElement(children) && describedBy
    ? cloneElement(children, { 'aria-invalid': 'true', 'aria-describedby': describedBy })
    : children;
  return (
    <label>
      {text}
      {control}
      {error && <span id={describedBy} className="field-error" role="alert">{error}</span>}
    </label>
  );
}

export function StatusBanner({ error, notice }) {
  if (error) return <div className="error-line" role="alert">{short(friendlyMessage(error), 600)}</div>;
  if (notice) return <div className="notice-line" role="status">{short(notice, 300)}</div>;
  return null;
}

export function Empty({ title, detail, action, onAction }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      <span>{detail}</span>
      {action && <button type="button" className="ghost" onClick={onAction}>{action}</button>}
    </div>
  );
}
