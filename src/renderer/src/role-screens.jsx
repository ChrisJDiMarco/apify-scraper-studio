import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Check, ClipboardCopy, Ellipsis, Eye, LoaderCircle, LogOut, RefreshCw, ShieldOff, X } from 'lucide-react';
import { adminNames, previewWho } from './viewer.js';

// Screens around the roles (the preview banner, the no-access card) and the small primitives every new role screen
// shares: a dialog that traps focus and gives it back, a "…" menu, a toast that never takes focus, and the one
// frame breakpoint (860px, the kit layouts' width).
export const NARROW_QUERY = '(max-width: 860px)';
export function useNarrow(query = NARROW_QUERY) {
  const read = () => Boolean(typeof window !== 'undefined' && window.matchMedia?.(query).matches);
  const [narrow, setNarrow] = useState(read);
  useEffect(() => {
    const media = window.matchMedia?.(query); if (!media) return undefined;
    const sync = () => setNarrow(media.matches); sync();
    media.addEventListener?.('change', sync);
    return () => media.removeEventListener?.('change', sync);
  }, [query]);
  return narrow;
}

// The clipboard API can be refused (a denied permission, an insecure origin); fall back to a hidden selection.
export async function copyText(text) {
  try { await navigator.clipboard.writeText(String(text)); return true; } catch { /* fall back below */ }
  const active = document.activeElement;
  try {
    const area = document.createElement('textarea');
    area.value = String(text); area.setAttribute('readonly', ''); area.style.position = 'fixed'; area.style.opacity = '0'; area.style.pointerEvents = 'none';
    document.body.appendChild(area); area.select();
    const done = typeof document.execCommand === 'function' && document.execCommand('copy');
    area.remove(); active?.focus?.({ preventScroll: true });
    return Boolean(done);
  } catch { active?.focus?.({ preventScroll: true }); return false; }
}

const FOCUSABLE ='a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
export const focusables = (root) => [...(root?.querySelectorAll(FOCUSABLE) || [])].filter((node) => !node.closest('[inert]') && !node.closest('[hidden]'));
// Tab and Shift+Tab stay inside `root`.
export function trapTab(event, root) {
  if (event.key !== 'Tab' || !root) return;
  const nodes = focusables(root); if (!nodes.length) { event.preventDefault(); root.focus?.(); return; }
  const first = nodes[0]; const last = nodes[nodes.length - 1]; const active = document.activeElement;
  if (event.shiftKey && (active === first || !root.contains(active) || active === root)) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && (active === last || !root.contains(active))) { event.preventDefault(); first.focus(); }
}

// A modal dialog: focus moves in (to `initialFocus`, else the panel, which reads the title), Tab stays inside, Esc and
// the backdrop close it, and focus goes back to whatever opened it.
export function Dialog({ labelledBy, label, describedBy, className = '', onClose, closeDisabled = false, initialFocus, children, wide = false, onKeyDown: onKey }) {
  const panel = useRef(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  const blocked = useRef(closeDisabled); blocked.current = closeDisabled;
  useLayoutEffect(() => {
    const opener = document.activeElement;
    (initialFocus?.current || panel.current)?.focus?.({ preventScroll: true });
    return () => { if (opener?.isConnected && typeof opener.focus === 'function') opener.focus({ preventScroll: true }); };
  }, []);
  function onKeyDown(event) {
    onKey?.(event); if (event.defaultPrevented) return;
    if (event.key === 'Escape') { event.stopPropagation(); event.preventDefault(); if (!blocked.current) closeRef.current?.(); return; }
    trapTab(event, panel.current);
  }
  return <div className="studio-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !blocked.current) closeRef.current?.(); }}>
    <div ref={panel} className={`studio-dialog${wide ? ' wide' : ''}${className ? ` ${className}` : ''}`} role="dialog" aria-modal="true" aria-labelledby={labelledBy} aria-label={labelledBy ? undefined : label} aria-describedby={describedBy} tabIndex={-1} onKeyDown={onKeyDown}>{children}</div>
  </div>;
}
export function DialogClose({ onClose, disabled, label = 'Close' }) {
  return <button type="button" className="studio-icon-button" aria-label={label} disabled={disabled} onClick={onClose}><X size={18} aria-hidden="true" /></button>;
}

// "…": a small menu of actions. Arrow keys move, Esc closes and returns focus to the button. Items are
// { label, icon, onSelect, danger, disabled, title }; { type: 'radio', checked } items are menuitemradio; items that
// share a `group` string sit under that heading (role="group"); { type: 'separator' } draws a line. placement 'top'
// opens it upward (a footer menu).
const ITEM_ROLES = '[role="menuitem"]:not([disabled]), [role="menuitemradio"]:not([disabled])';
export function MoreMenu({ label, items, disabled = false, title, align = 'end', placement = 'bottom', icon: Icon = Ellipsis, buttonText = '', describedBy, buttonClassName = '', buttonContent = null }) {
  const [open, setOpen] = useState(false);
  const button = useRef(null); const menu = useRef(null);
  const shown = items.filter(Boolean);
  useEffect(() => {
    if (!open) return undefined;
    (menu.current?.querySelector('[role="menuitemradio"][aria-checked="true"]:not([disabled])') || menu.current?.querySelector(ITEM_ROLES))?.focus();
    const away = (event) => { if (!menu.current?.contains(event.target) && !button.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);
  function close(refocus = true) { setOpen(false); if (refocus) button.current?.focus(); }
  function onKeyDown(event) {
    const nodes = [...(menu.current?.querySelectorAll(ITEM_ROLES) || [])];
    const index = nodes.indexOf(document.activeElement);
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); nodes[(index + 1) % nodes.length]?.focus(); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); nodes[(index - 1 + nodes.length) % nodes.length]?.focus(); }
    else if (event.key === 'Home') { event.preventDefault(); nodes[0]?.focus(); }
    else if (event.key === 'End') { event.preventDefault(); nodes[nodes.length - 1]?.focus(); }
    else if (event.key === 'Tab') close(false);
  }
  if (!shown.some((item) => item.type !== 'separator')) return null;
  const renderItem = (item, index) => {
    if (item.type === 'separator') return <div key={`separator-${index}`} role="separator" className="studio-menu-separator" />;
    const radio = item.type === 'radio';
    return <button key={item.key || item.label} type="button" role={radio ? 'menuitemradio' : 'menuitem'} aria-checked={radio ? Boolean(item.checked) : undefined} className={[item.danger ? 'danger' : '', radio && item.checked ? 'checked' : ''].filter(Boolean).join(' ')} disabled={item.disabled} title={item.title} onClick={() => { close(); item.onSelect(); }}>
      {radio ? <Check className="studio-menu-check" size={15} aria-hidden="true" style={{ visibility: item.checked ? 'visible' : 'hidden' }} /> : item.icon ? <item.icon size={15} aria-hidden="true" /> : null}{item.label}
    </button>;
  };
  // Consecutive items with the same group become one labelled group.
  const sections = [];
  shown.forEach((item, index) => { const last = sections[sections.length - 1]; if (item.group && last?.group === item.group) last.items.push([item, index]); else sections.push({ group: item.group || '', items: [[item, index]] }); });
  return <span className="studio-menu-wrap">
    <button ref={button} type="button" className={buttonClassName || (buttonText ? 'studio-quiet small' : 'studio-icon-button')} aria-label={buttonText || buttonContent ? undefined : label} aria-haspopup="menu" aria-expanded={open} aria-describedby={describedBy} disabled={disabled} title={title} onClick={() => setOpen((value) => !value)} onKeyDown={(event) => { if (event.key === 'ArrowDown' && !open) { event.preventDefault(); setOpen(true); } }}>{buttonContent || <><Icon size={17} aria-hidden="true" />{buttonText}</>}</button>
    {open && <div ref={menu} className={`studio-menu align-${align}${placement === 'top' ? ' placement-top' : ''}`} role="menu" aria-label={label} onKeyDown={onKeyDown}>
      {sections.map((section, index) => (section.group
        ? <div key={`group-${section.group}-${index}`} role="group" aria-label={section.group} className="studio-menu-group"><span className="studio-menu-heading" aria-hidden="true">{section.group}</span>{section.items.map(([item, at]) => renderItem(item, at))}</div>
        : section.items.map(([item, at]) => renderItem(item, at))))}
    </div>}
  </span>;
}

// A role=status toast near the bottom of the main column. It never takes focus; an optional action (Undo) sits inside.
export function useToast(duration = 6000) {
  const [toast, setToast] = useState(null);
  const timer = useRef(null);
  const held = useRef(false);
  const dismiss = useCallback(() => { clearTimeout(timer.current); setToast(null); }, []);
  const arm = useCallback((ms) => { clearTimeout(timer.current); timer.current = setTimeout(() => { if (!held.current) setToast(null); }, ms); }, []);
  const show = useCallback((text, options = {}) => { setToast({ text, key: Date.now() + Math.random(), tone: options.tone || '', actionLabel: options.actionLabel || '', onAction: options.onAction || null }); arm(options.duration || duration); }, [arm, duration]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const element = toast ? <div className={`studio-toast${toast.tone === 'error' ? ' error' : ''}`} role={toast.tone === 'error' ? 'alert' : 'status'} key={toast.key}
    onMouseEnter={() => { held.current = true; }} onMouseLeave={() => { held.current = false; arm(2500); }}>
    <span>{toast.text}</span>
    {toast.actionLabel && <button type="button" className="studio-toast-action" onClick={() => { const run = toast.onAction; dismiss(); run?.(); }}>{toast.actionLabel}</button>}
    <button type="button" className="studio-toast-close" aria-label="Dismiss" onClick={dismiss}><X size={15} aria-hidden="true" /></button>
  </div> : null;
  return [element, show, dismiss];
}

// A 40px row above the page while an admin previews another role or one person. Focus lands on it when a preview
// starts, and a polite live region names who the preview is for: "Previewing what Riley Jones (Editor, 2 changes) sees."
export function PreviewBanner({ viewer, onBack, busy = false }) {
  const banner = useRef(null);
  const [said, setSaid] = useState('');
  const who = previewWho(viewer);
  const key = viewer?.preview ? `${viewer.roleId || viewer.role}:${viewer.channelId || ''}:${viewer.viewAs?.memberId || ''}:${viewer.previewChanges || 0}` : '';
  useEffect(() => {
    if (!key) { setSaid(''); return undefined; }
    banner.current?.focus({ preventScroll: true });
    setSaid('');
    const frame = setTimeout(() => setSaid(`Now previewing as ${who}.`), 60);
    return () => clearTimeout(frame);
  }, [key]);
  if (!viewer?.preview) return null;
  return <div ref={banner} className="studio-preview-banner" role="status" tabIndex={-1}>
    <Eye size={16} aria-hidden="true" />
    <p>Previewing what {who} sees. Buttons that change things are off.</p>
    {onBack && <button type="button" className="studio-preview-back" disabled={busy} onClick={onBack}>Back to Admin</button>}
    <span className="sr-only" aria-live="polite">{said}</span>
  </div>;
}

// Signed in, but not a member (or paused). The .web-login card look, with the admins to ask.
export function NoAccess({ viewer = {}, email = viewer.email || '', disabled = Boolean(viewer.disabled), admins = [], canSignOut = false, onRetry, onSignOut }) {
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState(false);
  const [copied, setCopied] = useState(false);
  const ask = adminNames(admins, 'a studio admin');
  async function retry() {
    if (!onRetry) { window.location.reload(); return; }
    setChecking(true); setChecked(false);
    try { await onRetry(); } catch { /* the line below says it didn't work */ }
    setChecking(false); setChecked(true);
  }
  async function copy() { const done = await copyText(email); setCopied(done); if (done) setTimeout(() => setCopied(false), 1800); }
  return <main className="web-login studio-no-access">
    <section aria-labelledby="studio-no-access-title">
      <span className="studio-no-access-mark" aria-hidden="true"><ShieldOff size={22} /></span>
      <h1 id="studio-no-access-title">{disabled ? 'Your access is paused' : 'You’re not in this studio yet'}</h1>
      {disabled
        ? <p>Your access to this studio is paused. Ask {ask} if you need it back.</p>
        : <p>{email ? <>You’re signed in as <strong>{email}</strong>. </> : null}Ask {ask} to add you, then press Check again.</p>}
      {checked && !checking && <p className="studio-no-access-note" role="status">Still no access. {disabled ? `Ask ${ask} to turn it back on.` : `Once ${ask} adds you, press Check again.`}</p>}
      <div className="studio-no-access-actions">
        <button type="button" className="studio-no-access-primary" disabled={checking} onClick={retry}>{checking ? <LoaderCircle className="spin" size={15} aria-hidden="true" /> : <RefreshCw size={15} aria-hidden="true" />}{checking ? 'Checking…' : 'Check again'}</button>
        {email && <button type="button" className="studio-no-access-quiet" onClick={copy}>{copied ? <Check size={15} aria-hidden="true" /> : <ClipboardCopy size={15} aria-hidden="true" />}{copied ? 'Copied' : 'Copy my email'}</button>}
        {canSignOut && onSignOut && <button type="button" className="studio-no-access-quiet" onClick={onSignOut}><LogOut size={15} aria-hidden="true" />Sign out</button>}
      </div>
    </section>
  </main>;
}
