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
  if (error) return <div className="error-line" role="alert">{short(error, 180)}</div>;
  if (notice) return <div className="notice-line" role="status">{short(notice, 180)}</div>;
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
