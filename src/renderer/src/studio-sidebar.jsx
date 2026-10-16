import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronsUpDown, Layers3, LoaderCircle, LogOut, Megaphone, Menu, PenLine, Settings2, Shield, X } from 'lucide-react';
import semrushWordmark from './assets/semrush-2026-logo.svg';
import { LOCAL_ADMIN_FALLBACK, PREVIEW_TITLE, initials } from './viewer.js';
import { MoreMenu, focusables, trapTab, useNarrow } from './role-screens.jsx';

// One left sidebar for every layout and role. App renders it once inside .studio-frame and never remounts it, so
// focus stays on the control just pressed (a layout radio, the View as select) while the main column changes.
// Top to bottom: brand, who you are (workspace and role cards), the layout switch, the mode's own nav (children),
// the Admin nav, then Settings, the working indicator and the footer. Below 860px it becomes a modal drawer.
const ROLE_ICON = { admin: Shield, editor: PenLine, channel: Megaphone };
const MODES = [['simple', 'Simple', 'The essentials: Home, Reports, Trends, Assets and Ask AI.'], ['classic', 'Advanced', 'Every tool, including research programs, sheets and scrapers.']];
const KEY_NAMES = { '⌘': 'Meta', '⌥': 'Alt', '⇧': 'Shift', '⌃': 'Control' };
// "⌘1" → "Meta+1" for aria-keyshortcuts; the visible hint stays in the title only.
const keyShortcuts = (shortcut) => [...String(shortcut || '')].map((key) => KEY_NAMES[key] || key).join('+').replace(/\+{2,}/g, '+');
export function workingText(working) {
  if (!working) return '';
  if (typeof working === 'string') return working;
  if (typeof working === 'number') return `${new Intl.NumberFormat().format(working)} ${working === 1 ? 'job' : 'jobs'} running`;
  return 'Working…';
}
// The View as select's value: admin, editor, or channel:<id>.
const choiceOf = (viewer) => (!viewer?.preview ? 'admin' : viewer.role === 'editor' ? 'editor' : viewer.role === 'channel' && viewer.channelId ? `channel:${viewer.channelId}` : 'admin');
const payloadOf = (choice) => (choice.startsWith('channel:') ? { role: 'channel', channelId: choice.slice(8) } : { role: choice === 'editor' ? 'editor' : 'admin' });

// A badge's number is hidden from screen readers; the button says it in words ("Trends, 5 new") so it never reads "5Trends".
const countName = (item) => (item.count > 0 ? `${item.label}, ${item.countLabel || `${item.count} new`}` : undefined);
export function SidebarNav({ ariaLabel, label, items = [], active, onNavigate }) {
  const nav = useRef(null);
  const [pill, setPill] = useState(null);
  // One pill slides under the current item, measured like the Primary nav's (App.jsx), but vertically.
  useLayoutEffect(() => {
    const node = nav.current; if (!node) return undefined;
    const measure = () => { const button = node.querySelector('button[aria-current="page"]'); setPill((current) => (button ? { top: button.offsetTop, left: button.offsetLeft, width: button.offsetWidth, height: button.offsetHeight, settled: Boolean(current) } : null)); };
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(node);
    return () => observer?.disconnect();
  }, [active, items.map((item) => `${item.id}:${item.count || 0}`).join('|')]);
  return <nav ref={nav} className="studio-nav" aria-label={ariaLabel}>
    {label && <small className="studio-nav-label" aria-hidden="true">{label}</small>}
    {pill && <span className={`studio-nav-indicator${pill.settled ? ' settled' : ''}`} aria-hidden="true" style={{ transform: `translate(${pill.left}px, ${pill.top}px)`, width: pill.width, height: pill.height }} />}
    {items.map((item) => {
      const Icon = item.icon; const current = active === item.id;
      return <button key={item.id} type="button" className={`studio-nav-item${current ? ' active' : ''}`} data-spot={item.spot || `nav.${item.id}`} aria-current={current ? 'page' : undefined} aria-label={countName(item)} title={item.shortcut ? `${item.label} (${item.shortcut})` : item.title} aria-keyshortcuts={item.shortcut ? keyShortcuts(item.shortcut) : undefined} onClick={() => onNavigate?.(item.id)}>
        {Icon && <Icon size={18} aria-hidden="true" />}<span className="studio-nav-text">{item.label}</span>{item.count > 0 && <span className="simple-count" aria-hidden="true">{item.count}</span>}
      </button>;
    })}
  </nav>;
}

function PickerCopy({ label, value, preview = false, labelFirst = true }) {
  const small = <small>{label}{preview && <em className="studio-preview-tag">Preview</em>}</small>;
  return <span className="studio-picker-copy">{labelFirst ? <>{small}<strong>{value}</strong></> : <><strong>{value}</strong>{small}</>}</span>;
}

function IdentityStack({ viewer, web, workspaces, activeWorkspaceId, busy, onSelectWorkspace, onNewWorkspace, onViewAs, onCommitted }) {
  const realRole = viewer.realRole || viewer.role;
  const preview = Boolean(viewer.preview);
  const workspace = workspaces.find((row) => row.id === activeWorkspaceId) || null;
  const workspaceName = workspace?.name || 'My workspace';
  const channels = Array.isArray(viewer.channels) ? viewer.channels : [];
  const current = choiceOf(viewer);
  const [choice, setChoice] = useState(current);
  const latest = useRef(current); latest.current = current;
  const timer = useRef(null);
  const select = useRef(null);
  const wasPreview = useRef(preview);
  useEffect(() => { setChoice(current); }, [current]);
  useEffect(() => () => clearTimeout(timer.current), []);
  // "Back to Admin" in the banner removes the banner itself; focus comes back to View as rather than the page.
  useEffect(() => {
    if (wasPreview.current && !preview && (!document.activeElement || document.activeElement === document.body)) select.current?.focus({ preventScroll: true });
    wasPreview.current = preview;
  }, [preview]);
  // Arrow keys on a closed select fire change on every press (Windows, Firefox), so commit once the choice settles.
  function pick(value) {
    setChoice(value); clearTimeout(timer.current);
    // onViewAs may decline (App asks about unsaved edits first); the card then shows the current view again.
    timer.current = setTimeout(() => { if (value === latest.current) return; if (onViewAs(payloadOf(value)) === false) setChoice(latest.current); else onCommitted?.(); }, 350);
  }
  function switchWorkspace(id) {
    if (!id || id === activeWorkspaceId) return;
    const name = workspaces.find((row) => row.id === id)?.name || 'that workspace';
    if (web && !window.confirm(`Everyone using the studio, including channel owners, switches to ${name}. Switch?`)) return;
    onSelectWorkspace(id); onCommitted?.();
  }

  if (!realRole) return null; // no access: App shows NoAccess instead of the frame
  if (realRole === 'channel') {
    return <div className="studio-identity">
      <div className="shell-workspace-control studio-picker-card" data-spot="nav.role">
        <div className="shell-workspace-picker studio-picker is-static role-channel" role="group" aria-label="Your channel">
          <span className="workspace-avatar"><Megaphone size={15} aria-hidden="true" /></span>
          <PickerCopy label={['Channel owner', workspace?.name].filter(Boolean).join(' · ')} value={viewer.channelName || 'Your channel'} labelFirst={false} />
        </div>
      </div>
    </div>;
  }
  if (realRole !== 'admin') {
    return <div className="studio-identity">
      <div className="shell-workspace-control studio-picker-card" data-spot="nav.workspace">
        <div className="shell-workspace-picker studio-picker is-static"><span className="workspace-avatar"><Layers3 size={15} aria-hidden="true" /></span><PickerCopy label="Workspace" value={workspaceName} labelFirst={false} /></div>
      </div>
      <div className="shell-workspace-control studio-picker-card" data-spot="nav.role">
        <div className="shell-workspace-picker studio-picker is-static role-editor"><span className="workspace-avatar"><PenLine size={15} aria-hidden="true" /></span><PickerCopy label="Writes and edits reports" value="Editor" labelFirst={false} /></div>
      </div>
    </div>;
  }
  const shownRole = choice.startsWith('channel:') ? 'channel' : choice;
  const RoleIcon = ROLE_ICON[shownRole] || Shield;
  const choiceText = choice === 'admin' ? 'Admin (you)' : choice === 'editor' ? 'Editor' : channels.find((row) => `channel:${row.id}` === choice)?.name || viewer.channelName || 'Channel owner';
  const switchable = Boolean(onSelectWorkspace && workspaces.length);
  return <div className="studio-identity">
    <div className="shell-workspace-control studio-picker-card" data-spot="nav.workspace">
      {switchable
        ? <label className="shell-workspace-picker studio-picker" title={preview ? PREVIEW_TITLE : undefined}>
          <span className="workspace-avatar"><Layers3 size={15} aria-hidden="true" /></span>
          <PickerCopy label="Workspace" value={workspaceName} />
          <ChevronsUpDown className="studio-picker-chevron" size={15} aria-hidden="true" />
          <select aria-label="Content workspace" value={workspace?.id || ''} disabled={busy || preview} onChange={(event) => switchWorkspace(event.target.value)}>{!workspace && <option value="">Choose a workspace</option>}{workspaces.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select>
        </label>
        : <div className="shell-workspace-picker studio-picker is-static"><span className="workspace-avatar"><Layers3 size={15} aria-hidden="true" /></span><PickerCopy label={web ? 'Shared studio' : 'Local to this Mac'} value={workspaceName} labelFirst={false} /></div>}
      {switchable && onNewWorkspace && !preview && <button className="shell-new-workspace" type="button" disabled={busy} onClick={() => { onNewWorkspace(); onCommitted?.(); }}>+ New workspace</button>}
    </div>
    <div className="shell-workspace-control studio-picker-card" data-spot="nav.role">
      {onViewAs
        ? <label className={`shell-workspace-picker studio-picker role-${shownRole}`} data-preview={preview ? '' : undefined}>
          <span className="workspace-avatar"><RoleIcon size={15} aria-hidden="true" /></span>
          <PickerCopy label="View as" value={choiceText} preview={preview} />
          <ChevronsUpDown className="studio-picker-chevron" size={15} aria-hidden="true" />
          <select ref={select} aria-label="View as" value={choice} onChange={(event) => pick(event.target.value)}>
            <option value="admin">Admin (you)</option>
            <option value="editor">Editor</option>
            {channels.length > 0 && <optgroup label="Channel owner">{channels.map((row) => <option key={row.id} value={`channel:${row.id}`}>{row.name}</option>)}</optgroup>}
          </select>
        </label>
        : <div className="shell-workspace-picker studio-picker is-static role-admin"><span className="workspace-avatar"><Shield size={15} aria-hidden="true" /></span><PickerCopy label="Everything, including settings" value="Admin" labelFirst={false} /></div>}
    </div>
  </div>;
}

export function StudioSidebar({ edition = 'semrush', meta, web = false, viewer: given, workspaces = [], activeWorkspaceId, mode = 'simple', busy = false, working, onSelectWorkspace, onNewWorkspace, onViewAs, onMode, onSignOut, drawerOpen = false, onCloseDrawer, children, adminItems = [], activeAdmin, onAdminNavigate, showSettings = false, settingsActive = false, onSettings }) {
  const viewer = given || LOCAL_ADMIN_FALLBACK;
  const aside = useRef(null);
  const narrow = useNarrow();
  const drawer = narrow && drawerOpen && mode !== 'channel';
  const closeRef = useRef(onCloseDrawer); closeRef.current = onCloseDrawer;
  const close = () => { if (drawer) closeRef.current?.(); };
  // The drawer is modal: the main column goes inert, focus moves to the current item, and comes back to the menu button
  // when it closes. Safari and Firefox on the Mac don't focus a button on click, so the menu button is found by what it
  // controls rather than taken from document.activeElement; whatever had focus is the fallback (a widened window has
  // no menu button).
  useEffect(() => {
    const node = aside.current; if (!drawer || !node) return undefined;
    const opener = document.activeElement;
    (node.querySelector('[aria-current="page"]') || focusables(node)[0] || node).focus?.({ preventScroll: true });
    const main = [...(node.parentElement?.children || [])].find((child) => child.classList?.contains('studio-main'));
    main?.setAttribute('inert', '');
    return () => {
      main?.removeAttribute('inert');
      const menu = document.querySelector('[aria-controls="studio-sidebar"]');
      const back = menu?.isConnected ? menu : opener?.isConnected && !node.contains(opener) ? opener : null;
      back?.focus?.({ preventScroll: true });
    };
  }, [drawer]);
  const text = workingText(working);
  const showModes = Boolean(onMode) && mode !== 'channel' && viewer.role !== 'channel' && (Array.isArray(viewer.modes) ? viewer.modes.length > 1 : true);
  const semrush = edition !== 'general';
  // In the drawer, navigating closes it; a toggle inside a nav (Advanced's More tools) opens more choices instead.
  return <>
    <aside id="studio-sidebar" ref={aside} className={`sidebar studio-sidebar${drawer ? ' is-open' : ''}`} role={drawer ? 'dialog' : undefined} aria-modal={drawer ? 'true' : undefined} aria-label={drawer ? 'Menu' : undefined} tabIndex={drawer ? -1 : undefined}
      onKeyDown={drawer ? (event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } else trapTab(event, aside.current); } : undefined}
      onClick={drawer ? (event) => { if (event.target.closest?.('nav button:not([aria-expanded])')) close(); } : undefined}>
      <div className="brand studio-brand">
        {semrush ? <div className="semrush-brand"><img src={semrushWordmark} alt="Semrush" className="semrush-wordmark" /><span>Research & content studio</span></div>
          : <><span className="brand-mark"><Layers3 size={23} strokeWidth={1.8} aria-hidden="true" /></span><div><strong>scraper<span>studio</span></strong><small>Powered by Apify</small></div></>}
        {drawer && <button type="button" className="studio-icon-button studio-drawer-close" aria-label="Close menu" onClick={close}><X size={18} aria-hidden="true" /></button>}
      </div>
      <div className="sidebar-body studio-sidebar-body">
        <IdentityStack viewer={viewer} web={web} workspaces={workspaces} activeWorkspaceId={activeWorkspaceId} busy={busy} onSelectWorkspace={onSelectWorkspace} onNewWorkspace={onNewWorkspace} onViewAs={onViewAs} onCommitted={close} />
        {showModes && <div className="studio-layout" role="radiogroup" aria-label="Layout" data-spot="nav.mode">
          {MODES.map(([value, label, title]) => <label key={value} className={mode === value ? 'checked' : ''} title={title}><input type="radio" name="studio-layout" value={value} checked={mode === value} onChange={() => { onMode(value); close(); }} />{label}</label>)}
        </div>}
        {children}
        {adminItems.length > 0 && <SidebarNav ariaLabel="Admin" label="Admin" items={adminItems} active={activeAdmin} onNavigate={onAdminNavigate} />}
      </div>
      <div className="sidebar-bottom studio-sidebar-bottom">
        {showSettings && <nav aria-label="Preferences" className="studio-nav studio-prefs"><button type="button" className={`studio-nav-item${settingsActive ? ' active' : ''}`} data-spot="nav.settings" aria-current={settingsActive ? 'page' : undefined} title="Settings (⌘,)" aria-keyshortcuts="Meta+," onClick={onSettings}><Settings2 size={18} aria-hidden="true" /><span className="studio-nav-text">Settings</span></button></nav>}
        {text && <span className="studio-working" role="status" data-spot="top.working"><LoaderCircle className="spin" size={14} aria-hidden="true" />{text}</span>}
        <div className="studio-foot">
          <span className="studio-foot-avatar" aria-hidden="true">{initials(viewer.name || viewer.email)}</span>
          <span className="studio-foot-copy"><strong>{viewer.name || viewer.email || 'You'}</strong>{meta?.version ? <small>Version {meta.version}</small> : <small>{web ? 'Shared studio' : 'On this Mac'}</small>}</span>
          {web && onSignOut && <button type="button" className="studio-signout" onClick={onSignOut}><LogOut size={14} aria-hidden="true" />Sign out</button>}
        </div>
      </div>
    </aside>
    {drawer && <div className="studio-scrim" aria-hidden="true" onClick={close} />}
  </>;
}

// Below 860px: a 56px bar over the main column with the menu button, the page title and the working indicator.
// Channel owners get their channel's name instead of a menu (they have a bottom nav), and Sign out under "…" on the web.
export function StudioTopBar({ title = '', working, mode = 'simple', drawerOpen = false, onMenu, menuRef, channelName = '', web = false, onSignOut }) {
  const narrow = useNarrow();
  if (!narrow) return null;
  const channel = mode === 'channel';
  const text = workingText(working);
  return <header className={`studio-topbar${channel ? ' is-channel' : ''}`}>
    {channel ? <span className="studio-topbar-mark" aria-hidden="true"><Megaphone size={17} /></span>
      : <button ref={menuRef} type="button" className="studio-icon-button studio-menu-button" aria-label="Menu" aria-expanded={drawerOpen} aria-controls="studio-sidebar" onClick={onMenu}><Menu size={20} aria-hidden="true" /></button>}
    <span className="studio-topbar-title">{channel ? channelName || title : title}</span>
    {text && <span className="studio-working compact" role="status" data-spot="top.working"><LoaderCircle className="spin" size={14} aria-hidden="true" /><span>{text}</span></span>}
    {channel && web && onSignOut && <MoreMenu label="Account" items={[{ label: 'Sign out', icon: LogOut, onSelect: onSignOut }]} />}
  </header>;
}

// Channel owners on a phone: Trends and My assets, fixed to the bottom edge above the home indicator.
export function ChannelBottomNav({ items = [], active, onNavigate }) {
  const narrow = useNarrow();
  if (!narrow) return null;
  return <nav className="studio-bottom-nav" aria-label="Main">{items.map((item) => {
    const Icon = item.icon; const current = active === item.id;
    return <button key={item.id} type="button" className={current ? 'active' : ''} data-spot={item.spot || `nav.${item.id}`} aria-current={current ? 'page' : undefined} aria-label={countName(item)} onClick={() => onNavigate?.(item.id)}>
      <span className="studio-bottom-icon">{Icon && <Icon size={20} aria-hidden="true" />}{item.count > 0 && <span className="simple-count" aria-hidden="true">{item.count}</span>}</span><span>{item.label}</span>
    </button>;
  })}</nav>;
}
