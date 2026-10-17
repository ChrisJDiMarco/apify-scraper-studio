import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import {
  Activity, BookOpen, Building2, CalendarDays, Check, ChartColumn, ChevronDown, ChevronsUpDown, Circle, Database, Ellipsis, Eye, FileChartColumn, FileText, FileUp, FolderOpen, Gauge,
  GitCompareArrows, Globe, House, ImagePlus, Images, Inbox, Keyboard, Layers, LayoutDashboard, LayoutGrid, LayoutList, Library, LoaderCircle, LogOut, Megaphone, Menu, MessagesSquare,
  PanelLeftClose, PanelLeftOpen, Plus, Radar, ScanSearch, ScrollText, Search, Settings2, Sheet, Sparkles, SquareKanban, SquarePen, TrendingUp, UserPlus, Users, Workflow, Wrench, X,
} from 'lucide-react';
import semrushWordmark from './assets/semrush-2026-logo.svg';
import { LOCAL_ADMIN_FALLBACK, PREVIEW_TITLE, initials, roleLabel } from './viewer.js';
import { Dialog, DialogClose, MoreMenu, focusables, trapTab, useNarrow } from './role-screens.jsx';
import { MAX_FOCUS_CHANNELS, ariaKeys, isChannelViewer, isRealAdmin, itemName, viewAsChoice } from './nav-model.js';
import { KeyboardShortcutsDialog } from './keyboard-shortcuts.jsx';
import { WorkingPopover } from './working-popover.jsx';
import './studio-sidebar.css';

// One left sidebar for every layout and role. App renders it once inside .studio-frame and never remounts it, so focus
// stays on the control just pressed (a layout radio, a View as choice) while the main column changes. It draws
// nav-model.js's buildNav() result, top to bottom: the head (wordmark, collapse, workspace switcher), the actions (New,
// Search, Ask AI), the page groups, then the footer (Working, the Simple | Advanced switch, the account menu).
// Rail mode is icon-only with tooltips (⌘\). Below 860px it is a modal drawer, always expanded.

// Lucide icons by the names nav-model.js uses. App's palette draws the same icons.
export const NAV_ICONS = {
  Activity, BookOpen, Building2, CalendarDays, ChartColumn, Database, FileChartColumn, FileText, FileUp, FolderOpen, Gauge, GitCompareArrows, Globe, House, ImagePlus, Images, Inbox,
  Layers, LayoutGrid, Library, MessagesSquare, Radar, ScanSearch, ScrollText, Search, Settings2, Sheet, Sparkles, SquareKanban, SquarePen, TrendingUp, UserPlus, Users, Workflow, Wrench,
};
const iconOf = (name) => (typeof name === 'function' || (name && typeof name === 'object') ? name : NAV_ICONS[name] || Circle);
const LAYOUT_ICON = { simple: LayoutList, classic: LayoutDashboard };
export function workingText(working) {
  if (!working) return '';
  if (typeof working === 'string') return working;
  if (typeof working === 'number') return `${new Intl.NumberFormat().format(working)} running`;
  if (typeof working === 'object') return working.label || '';
  return 'Working…';
}

// A small menu that opens from a button: arrow keys move, Home and End jump, Esc closes and gives focus back, Tab
// leaves. Rows: { type: 'item' | 'radio' | 'group' | 'separator' | 'note', key, label, hint, icon, kbd, checked,
// disabled, title, onSelect, items (a group's rows) }. `openKey` opens it from outside (⌥⌘N); `placement` is
// bottom, top, right or right-up (the rail).
function MenuButton({ label, rows = [], buttonClass, buttonContent, buttonProps = {}, placement = 'bottom', openKey = 0, menuClass = '', disabled = false, header = null }) {
  const [open, setOpen] = useState(false);
  const button = useRef(null); const menu = useRef(null);
  const menuId = useId();
  const lastKey = useRef(openKey);
  useEffect(() => { if (openKey && openKey !== lastKey.current && !disabled) setOpen(true); lastKey.current = openKey; }, [openKey]);
  useEffect(() => {
    if (!open) return undefined;
    const items = menu.current ? [...menu.current.querySelectorAll('[role^="menuitem"]:not([disabled])')] : [];
    (items.find((node) => node.getAttribute('aria-checked') === 'true') || items[0] || menu.current)?.focus({ preventScroll: true });
    const away = (event) => { if (!menu.current?.contains(event.target) && !button.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);
  function close(refocus = true) { setOpen(false); if (refocus) button.current?.focus({ preventScroll: true }); }
  function onKeyDown(event) {
    const nodes = [...(menu.current?.querySelectorAll('[role^="menuitem"]:not([disabled])') || [])];
    const index = nodes.indexOf(document.activeElement);
    const move = (next) => { event.preventDefault(); nodes[(next + nodes.length) % nodes.length]?.focus(); };
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    else if (event.key === 'ArrowDown') move(index + 1);
    else if (event.key === 'ArrowUp') move(index < 0 ? nodes.length - 1 : index - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(nodes.length - 1);
    else if (event.key === 'Tab') close(false);
  }
  const choose = (row) => { close(); row.onSelect?.(); };
  const renderRow = (row) => {
    if (row.type === 'separator') return <div key={row.key} className="sb-menu-sep" role="separator" />;
    if (row.type === 'note') return <p key={row.key} className="sb-menu-note">{row.label}</p>;
    if (row.type === 'group') return <MenuGroup key={row.key} label={row.label}>{row.items.map(renderRow)}</MenuGroup>;
    const Icon = row.icon ? iconOf(row.icon) : null;
    const radio = row.type === 'radio';
    return <MenuItem key={row.key} row={row} Icon={Icon} radio={radio} onChoose={() => choose(row)} />;
  };
  return <div className="sb-menu-wrap">
    <button ref={button} type="button" className={buttonClass} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} disabled={disabled} {...buttonProps}
      onClick={() => setOpen((value) => !value)} onKeyDown={(event) => { if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !open) { event.preventDefault(); setOpen(true); } }}>{buttonContent}</button>
    {open && <div ref={menu} id={menuId} className={`sb-pop sb-menu place-${placement}${menuClass ? ` ${menuClass}` : ''}`} role="menu" aria-label={label} tabIndex={-1} onKeyDown={onKeyDown}>{header}{rows.filter(Boolean).map(renderRow)}</div>}
  </div>;
}
function MenuGroup({ label, children }) {
  const id = useId();
  return <div role="group" aria-labelledby={label ? id : undefined} className="sb-menu-group">{label && <div className="sb-menu-heading" id={id} role="presentation">{label}</div>}{children}</div>;
}
function MenuItem({ row, Icon, radio, onChoose }) {
  const hintId = useId();
  return <button type="button" role={radio ? 'menuitemradio' : 'menuitem'} aria-checked={radio ? Boolean(row.checked) : undefined} aria-label={row.hint ? row.label : undefined} aria-describedby={row.hint ? hintId : undefined} aria-keyshortcuts={row.kbd ? ariaKeys(row.kbd) : undefined} className={`sb-menu-item${row.danger ? ' is-danger' : ''}${row.indent ? ' is-indent' : ''}`} disabled={row.disabled} title={row.title || undefined} onClick={onChoose}>
    {radio ? <span className="sb-menu-check" aria-hidden="true">{row.checked && <Check size={15} />}</span> : Icon ? <Icon size={16} aria-hidden="true" /> : null}
    <span className="sb-menu-copy"><span>{row.label}</span>{row.hint && <small id={hintId}>{row.hint}</small>}</span>
    {row.kbd && <kbd className="sb-kbd" aria-hidden="true">{row.kbd}</kbd>}
  </button>;
}

// Rail tooltips: one label beside whatever carries data-tip, on hover and on keyboard focus. Drawn fixed so the nav's
// scroll box never clips it; the accessible name is already on the control, so the tooltip is hidden from readers.
function useRailTip(enabled) {
  const [tip, setTip] = useState(null);
  useEffect(() => { if (!enabled) setTip(null); }, [enabled]);
  if (!enabled) return { tip: null, handlers: {} };
  const show = (event) => {
    const node = event.target?.closest?.('[data-tip]');
    if (!node || node.closest('[role="menu"], [role="dialog"]')) { setTip(null); return; }
    const rect = node.getBoundingClientRect();
    setTip({ text: node.getAttribute('data-tip'), top: rect.top + rect.height / 2, left: rect.right + 10 });
  };
  return { tip, handlers: { onMouseOver: show, onFocus: show, onMouseLeave: () => setTip(null), onBlur: () => setTip(null) } };
}

// One soft pill slides under the current page in the nav, measured here, once, for every layout.
function useIndicator(navRef, key) {
  const [pill, setPill] = useState(null);
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) { setPill(null); return undefined; }
    const measure = () => {
      const button = nav.querySelector('.sb-item[aria-current="page"]');
      const shown = button && button.offsetWidth > 0; // a page inside a closed group has no box to slide to
      setPill((current) => (shown ? { left: button.offsetLeft, top: button.offsetTop, width: button.offsetWidth, height: button.offsetHeight, settled: Boolean(current) } : null));
    };
    measure();
    // Keep the current page clear of the nav's edges when it scrolls.
    const current = nav.querySelector('.sb-item[aria-current="page"]');
    if (current && nav.scrollHeight > nav.clientHeight) {
      const item = current.getBoundingClientRect(); const view = nav.getBoundingClientRect();
      if (item.bottom > view.bottom - 24) nav.scrollBy?.({ top: item.bottom - view.bottom + 36, behavior: 'smooth' });
      else if (item.top < view.top + 12) nav.scrollBy?.({ top: item.top - view.top - 24, behavior: 'smooth' });
    }
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(nav);
    return () => observer?.disconnect();
  }, [key]);
  return pill;
}

function NavItem({ row, current, rail, onNavigate }) {
  const Icon = iconOf(row.icon);
  const name = itemName(row);
  return <button type="button" className="sb-item" data-spot={row.spot} aria-current={current ? 'page' : undefined} aria-label={name !== row.label ? name : undefined}
    aria-keyshortcuts={row.shortcut ? ariaKeys(row.shortcut) : undefined} title={!rail && row.shortcut ? `${row.label} (${row.shortcut})` : undefined} data-tip={rail ? [name, row.shortcut].filter(Boolean).join(' · ') : undefined} onClick={() => onNavigate?.(row)}>
    <Icon size={18} strokeWidth={1.75} aria-hidden="true" /><span className="sb-text">{row.label}</span>
    {row.badge > 0 ? <span className="sb-badge" aria-hidden="true">{row.badge > 99 ? '99+' : row.badge}</span> : row.warn ? <span className="sb-warn" aria-hidden="true" /> : row.live ? <span className="sb-live" aria-hidden="true" /> : null}
  </button>;
}

function NavGroups({ groups, activeId, rail, onNavigate, onToggleDataTools }) {
  const navRef = useRef(null);
  const baseId = useId();
  const key = `${activeId}|${rail}|${groups.map((group) => `${group.id}:${group.open}:${group.items.map((row) => row.id).join(',')}`).join('|')}`;
  const pill = useIndicator(navRef, key);
  return <nav ref={navRef} className="sb-nav" aria-label="Main">
    {pill && <span className={`sb-indicator${pill.settled ? ' settled' : ''}`} aria-hidden="true" style={{ transform: `translate(${pill.left}px, ${pill.top}px)`, width: pill.width, height: pill.height }} />}
    {groups.map((group) => {
      const labelId = `${baseId}-${group.id}`;
      if (group.collapsible) {
        const openTool = !group.open ? group.items.find((row) => row.id === activeId) : null;
        const subId = `${baseId}-${group.id}-items`; const currentId = `${baseId}-${group.id}-current`;
        return <div key={group.id} className="sb-group is-collapsible">
          <button type="button" className="sb-group-toggle" data-spot={group.spot || `nav.${group.id}`} aria-label={group.label} aria-expanded={group.open} aria-controls={subId} aria-describedby={openTool ? currentId : undefined} data-tip={rail ? (openTool ? `${group.label} · ${openTool.label}` : group.label) : undefined} onClick={onToggleDataTools}>
            <Wrench size={18} strokeWidth={1.75} aria-hidden="true" /><span className="sb-text">{group.label}</span>
            {openTool && <span className="sb-current" id={currentId}><span className="sr-only">Open now:</span>{' '}{openTool.label}</span>}
            <ChevronDown className={`sb-chevron${group.open ? ' is-open' : ''}`} size={14} aria-hidden="true" />
          </button>
          {group.open && <div id={subId} className="sb-sub">{(group.subgroups || [{ id: 'all', label: '', items: group.items }]).map((sub, setIndex) => <div key={sub.id} className="sb-subgroup" role="group" aria-label={sub.label || 'Activity'}>
            {sub.label && <small className="sb-sublabel" aria-hidden="true">{sub.label}</small>}
            {sub.items.map((row, index) => <span key={row.id} className="sb-rise" style={{ '--i': setIndex * 4 + index }}><NavItem row={row} current={row.id === activeId} rail={rail} onNavigate={onNavigate} /></span>)}
          </div>)}</div>}
        </div>;
      }
      return <div key={group.id} className={`sb-group sb-group-${group.id}`} role="group" aria-labelledby={group.label ? labelId : undefined} aria-label={group.label ? undefined : 'Pages'}>
        {group.label && <span className="sb-group-label" id={labelId}>{group.label}</span>}
        {group.items.map((row) => <NavItem key={row.id} row={row} current={row.id === activeId} rail={rail} onNavigate={onNavigate} />)}
      </div>;
    })}
  </nav>;
}

function MyChannelsDialog({ channels, selected, onSave, onClose }) {
  const titleId = useId();
  const [chosen, setChosen] = useState(() => selected.filter((id) => channels.some((row) => row.id === id)).slice(0, MAX_FOCUS_CHANNELS));
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState('');
  const full = chosen.length >= MAX_FOCUS_CHANNELS;
  const toggle = (id) => setChosen((current) => (current.includes(id) ? current.filter((row) => row !== id) : current.length >= MAX_FOCUS_CHANNELS ? current : [...current, id]));
  async function save(event) {
    event.preventDefault(); setSaving(true); setProblem('');
    try { await onSave(chosen); onClose(); } catch (failure) { setProblem(failure?.message || 'Your channels couldn’t be saved. Try again.'); setSaving(false); }
  }
  return <Dialog labelledBy={titleId} className="sb-channels-dialog" onClose={onClose} closeDisabled={saving}>
    <form onSubmit={save} className="sb-channels-form">
      <div className="studio-dialog-head"><div><small>Account</small><h2 id={titleId}>My channels</h2></div><div className="studio-dialog-tools"><DialogClose onClose={onClose} disabled={saving} /></div></div>
      <div className="studio-dialog-body">
        <p className="studio-hint">Assets opens on these channels, Make channel assets ticks their files first, and trend cards say which ones fit. Choose up to {MAX_FOCUS_CHANNELS}.</p>
        <fieldset className="sb-channels"><legend className="sr-only">Channels you work on</legend>
          {channels.map((channel) => { const on = chosen.includes(channel.id); return <label key={channel.id} className={`sb-channel${on ? ' is-on' : ''}`}><input type="checkbox" checked={on} disabled={saving || (!on && full)} onChange={() => toggle(channel.id)} /><span>{channel.name}</span></label>; })}
        </fieldset>
        <p className="studio-hint" aria-live="polite">{chosen.length ? `${chosen.length} of ${MAX_FOCUS_CHANNELS} chosen.` : 'None chosen: everything shows for every channel.'}</p>
        {problem && <p className="studio-error" role="alert">{problem}</p>}
      </div>
      <div className="studio-dialog-foot"><button type="button" className="studio-quiet small" disabled={saving} onClick={onClose}>Cancel</button><button type="submit" className="studio-primary small" disabled={saving}>{saving ? <LoaderCircle className="spin" size={14} aria-hidden="true" /> : null}{saving ? 'Saving…' : 'Save'}</button></div>
    </form>
  </Dialog>;
}

function WorkspaceSwitcher({ viewer, edition, workspaces, activeWorkspaceId, mode, web, busy, rail, onSelectWorkspace, onNewWorkspace, onDone }) {
  const workspace = workspaces.find((row) => row.id === activeWorkspaceId) || null;
  const workspaceName = workspace?.name || (web ? 'Shared studio' : 'My workspace');
  const preview = Boolean(viewer.preview);
  const label = viewer.roleLabel || roleLabel(viewer.role);
  if (mode === 'channel' || isChannelViewer(viewer)) {
    const line = [preview ? `Viewing as ${label}` : label, workspace?.name].filter(Boolean).join(' · ');
    return <div className="sb-switcher is-static" role="group" aria-label="Your channel" data-spot="nav.workspace" data-tip={rail ? `${viewer.channelName || 'Your channel'} · ${line}` : undefined} tabIndex={rail ? 0 : undefined}>
      <span className="sb-tile is-channel" aria-hidden="true"><Megaphone size={15} /></span>
      <span className="sb-switcher-copy"><strong>{viewer.channelName || 'Your channel'}</strong><small>{line}</small></span>
    </div>;
  }
  const line = `${preview ? `Viewing as ${label}` : label} · ${mode === 'classic' ? 'Advanced' : 'Simple'}`;
  const tile = <span className={`sb-tile${edition === 'general' ? ' is-general' : ''}`} aria-hidden="true">{(workspaceName.trim()[0] || 'W').toUpperCase()}</span>;
  const copy = <span className="sb-switcher-copy"><strong>{workspaceName}</strong><small>{line}</small></span>;
  const switchable = Boolean(onSelectWorkspace) && isRealAdmin(viewer) && workspaces.length > 0;
  if (!switchable) {
    return <div className="sb-switcher is-static" role="group" aria-label={`Workspace: ${workspaceName}`} data-spot="nav.workspace" data-tip={rail ? `${workspaceName} · ${line}` : undefined} tabIndex={rail ? 0 : undefined}>{tile}{copy}</div>;
  }
  function choose(id) {
    if (!id || id === activeWorkspaceId) return;
    const name = workspaces.find((row) => row.id === id)?.name || 'that workspace';
    if (web && !window.confirm(`Everyone using the studio, including channel owners, switches to ${name}. Switch?`)) return;
    onSelectWorkspace(id); onDone?.();
  }
  const rows = [
    { type: 'group', key: 'workspaces', label: 'Workspaces', items: workspaces.map((row) => ({ type: 'radio', key: row.id, label: row.name, checked: row.id === activeWorkspaceId, onSelect: () => choose(row.id) })) },
    onNewWorkspace && { type: 'separator', key: 'sep' },
    onNewWorkspace && { type: 'item', key: 'new', label: 'New workspace', icon: Plus, onSelect: () => { onNewWorkspace(); onDone?.(); } },
  ];
  return <MenuButton label="Workspaces" rows={rows} placement={rail ? 'right' : 'bottom'} disabled={busy || preview}
    buttonClass="sb-switcher" buttonProps={{ 'data-spot': 'nav.workspace', 'aria-label': `Workspace: ${workspaceName}. ${line}`, title: preview ? PREVIEW_TITLE : undefined, 'data-tip': rail ? `${workspaceName} · ${line}` : undefined }}
    buttonContent={<>{tile}{copy}<ChevronsUpDown className="sb-switcher-chevron" size={15} aria-hidden="true" /></>} />;
}

/**
 * The sidebar. `nav` is buildNav()'s result for this layout; `activeId` the page that's open (an item id).
 * onNavigate(item) · onCreate(kind, { programId }) · onSearch() · onAsk() · onToggleDataTools() · onToggleRail() ·
 * onSelectWorkspace(id) · onNewWorkspace() · onViewAs(payload) → false when declined · onMode(layout) · onSignOut() ·
 * onSaveFocusChannels(ids) → Promise. `working` = { label, runs } (working-popover.jsx). `newMenuKey` opens New when
 * it changes (⌥⌘N). `askCurrent`: Simple's Ask AI page is open; `askExpanded`: Advanced's drawer is open.
 */
export function StudioSidebar({ edition = 'semrush', meta, web = false, viewer: given, nav, activeId = '', mode = 'simple', busy = false, workspaces = [], activeWorkspaceId, rail = false, onToggleRail,
  drawerOpen = false, onCloseDrawer, onNavigate, onCreate, onSearch, onAsk, askCurrent = false, askExpanded = false, onToggleDataTools, onSelectWorkspace, onNewWorkspace, onViewAs, onMode, onSignOut,
  working, onSaveFocusChannels, newMenuKey = 0 }) {
  const viewer = given || LOCAL_ADMIN_FALLBACK;
  const aside = useRef(null); const account = useRef(null);
  const narrow = useNarrow();
  const drawer = narrow && drawerOpen && mode !== 'channel';
  const railed = rail && !narrow;
  const closeRef = useRef(onCloseDrawer); closeRef.current = onCloseDrawer;
  const close = () => { if (drawer) closeRef.current?.(); };
  const [dialog, setDialog] = useState('');
  const { tip, handlers } = useRailTip(railed);
  const groups = Array.isArray(nav?.groups) ? nav.groups : [];
  const actions = nav?.actions || {};
  const create = Array.isArray(actions.create) ? actions.create : [];
  const footer = nav?.footer || {};
  const preview = Boolean(viewer.preview);
  const wasPreview = useRef(preview);
  // The drawer is modal: the main column goes inert, focus moves to the current page (unless something inside already has
  // it, like the New menu opened by ⌥⌘N), and comes back to the menu button when it closes. Safari and Firefox on the Mac
  // don't focus a button on click, so the menu button is found by what it controls; whatever had focus is the fallback.
  useEffect(() => {
    const node = aside.current; if (!drawer || !node) return undefined;
    const opener = document.activeElement;
    if (!node.contains(opener)) (node.querySelector('[aria-current="page"]') || focusables(node)[0] || node).focus?.({ preventScroll: true });
    const main = [...(node.parentElement?.children || [])].find((child) => child.classList?.contains('studio-main'));
    main?.setAttribute('inert', '');
    return () => {
      main?.removeAttribute('inert');
      const menu = document.querySelector('[aria-controls="studio-sidebar"]');
      const back = menu?.isConnected ? menu : opener?.isConnected && !node.contains(opener) ? opener : null;
      back?.focus?.({ preventScroll: true });
    };
  }, [drawer]);
  // "Back to Admin" in the banner removes the banner itself; focus comes back to the account menu rather than the page.
  useEffect(() => {
    if (wasPreview.current && !preview && (!document.activeElement || document.activeElement === document.body)) account.current?.querySelector('button')?.focus({ preventScroll: true });
    wasPreview.current = preview;
  }, [preview]);

  const go = (row) => { close(); onNavigate?.(row); };
  const make = (kind, args = {}) => { close(); onCreate?.(kind, args); };
  const semrush = edition !== 'general';
  const name = viewer.name || viewer.email || 'You';
  const label = viewer.roleLabel || roleLabel(viewer.role);
  const accountLine = preview ? `Viewing as ${label}` : [label, meta?.version ? `Version ${meta.version}` : web ? 'Shared studio' : 'On this Mac'].filter(Boolean).join(' · ');

  // New: the main rows, then (after a separator) the admin rows. Find new trends with several programs lists them.
  const createRow = (row) => (row.id === 'research' && row.choices?.length
    ? { type: 'group', key: 'research', label: row.label, items: row.choices.map((choice) => ({ type: 'item', key: `research-${choice.id}`, label: `With ${choice.label}`, indent: true, disabled: row.disabled, title: row.title, onSelect: () => make('research', { programId: choice.id }) })) }
    : { type: 'item', key: row.id, label: row.label, hint: row.hint, icon: row.icon, disabled: row.disabled, title: row.title, onSelect: () => make(row.id, { programId: row.programId || '' }) });
  const mainCreate = create.filter((row) => row.section !== 'admin');
  const adminCreate = create.filter((row) => row.section === 'admin');
  const newRows = [...mainCreate.map(createRow), mainCreate.length && adminCreate.length ? { type: 'separator', key: 'admin-sep' } : null, ...adminCreate.map(createRow)];

  // Account: View as (admins), My channels, Keyboard shortcuts, Sign out on the web.
  const viewAs = onViewAs && Array.isArray(footer.viewAs) ? footer.viewAs : [];
  const choice = viewAsChoice(viewer, viewAs);
  const channels = Array.isArray(footer.channels) ? footer.channels : [];
  const focus = Array.isArray(viewer.prefs?.focusChannels) ? viewer.prefs.focusChannels : [];
  const viewRow = (option) => ({ type: 'radio', key: option.value, label: option.label, checked: option.value === choice, onSelect: () => { if (option.value === choice) return; if (onViewAs(option.payload) !== false) close(); } });
  const accountRows = [
    viewAs.length > 0 && { type: 'group', key: 'view-as', label: 'View as', items: viewAs.filter((option) => option.group !== 'channels').map(viewRow) },
    viewAs.some((option) => option.group === 'channels') && { type: 'group', key: 'view-as-channel', label: 'View as a channel owner', items: viewAs.filter((option) => option.group === 'channels').map(viewRow) },
    viewAs.length > 0 && { type: 'separator', key: 'sep-view' },
    channels.length > 0 && onSaveFocusChannels && { type: 'item', key: 'channels', label: 'My channels…', icon: Megaphone, hint: focus.length ? `${focus.length} chosen` : 'Choose the channels you work on', onSelect: () => setDialog('channels') },
    { type: 'item', key: 'shortcuts', label: 'Keyboard shortcuts', icon: Keyboard, onSelect: () => setDialog('shortcuts') },
    web && onSignOut && { type: 'separator', key: 'sep-out' },
    web && onSignOut && { type: 'item', key: 'signout', label: 'Sign out', icon: LogOut, onSelect: onSignOut },
  ];
  const ask = actions.ask;
  const search = actions.search && onSearch ? actions.search : null;
  const layouts = onMode && Array.isArray(footer.layouts) ? footer.layouts : [];
  const tipStyle = tip ? { top: tip.top, left: tip.left } : undefined;

  return <>
    <aside id="studio-sidebar" ref={aside} className={`studio-sidebar${drawer ? ' is-open' : ''}${railed ? ' is-rail' : ''}`} data-rail={railed ? '' : undefined} data-edition={semrush ? 'semrush' : 'general'}
      role={drawer ? 'dialog' : undefined} aria-modal={drawer ? 'true' : undefined} aria-label={drawer ? 'Menu' : 'Sidebar'} tabIndex={drawer ? -1 : undefined}
      onKeyDown={drawer ? (event) => { if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); close(); } else trapTab(event, aside.current); } : undefined} {...handlers}>
      <header className="sb-head">
        {semrush ? <img src={semrushWordmark} alt="Semrush" className="sb-wordmark" />
          : <span className="sb-brand"><span className="sb-mark" aria-hidden="true"><Layers size={19} strokeWidth={1.8} /></span><strong className="sb-brand-text">scraper<span>studio</span></strong></span>}
        {drawer ? <button type="button" className="studio-icon-button sb-drawer-close" aria-label="Close menu" onClick={close}><X size={18} aria-hidden="true" /></button>
          : onToggleRail && !narrow && <button type="button" className="sb-collapse" data-spot="nav.collapse" aria-label={railed ? 'Expand sidebar' : 'Collapse sidebar'} aria-keyshortcuts="Meta+\" title={railed ? undefined : 'Collapse sidebar (⌘\\)'} data-tip={railed ? 'Expand sidebar · ⌘\\' : undefined} onClick={onToggleRail}>{railed ? <PanelLeftOpen size={18} aria-hidden="true" /> : <PanelLeftClose size={18} aria-hidden="true" />}</button>}
      </header>
      <WorkspaceSwitcher viewer={viewer} edition={edition} workspaces={workspaces} activeWorkspaceId={activeWorkspaceId} mode={mode} web={web} busy={busy} rail={railed} onSelectWorkspace={onSelectWorkspace} onNewWorkspace={onNewWorkspace} onDone={close} />
      {(create.length > 0 || search || ask) && <div className="sb-actions">
        {create.length > 0 && <MenuButton label="New" rows={newRows} placement={railed ? 'right' : 'bottom'} openKey={newMenuKey} menuClass="sb-new-menu"
          buttonClass="sb-create" buttonProps={{ 'data-spot': 'nav.new', 'aria-keyshortcuts': 'Alt+Meta+N', title: railed ? undefined : 'New (⌥⌘N)', 'data-tip': railed ? 'New · ⌥⌘N' : undefined }}
          buttonContent={<><Plus size={17} strokeWidth={2.2} aria-hidden="true" /><span className="sb-text">New</span><kbd className="sb-kbd" aria-hidden="true">⌥⌘N</kbd></>} />}
        {search && <button type="button" className="sb-search" data-spot={search.spot} aria-label="Search reports, trends and pages" aria-keyshortcuts="Meta+K" title={railed ? undefined : 'Search reports, trends and pages (⌘K)'} data-tip={railed ? 'Search · ⌘K' : undefined} onClick={() => { close(); onSearch(); }}>
          <Search size={16} aria-hidden="true" /><span className="sb-text">{search.label}</span><kbd className="sb-kbd" aria-hidden="true">⌘K</kbd>
        </button>}
        {ask && onAsk && <button type="button" className="sb-ask" data-spot={ask.spot} aria-keyshortcuts="Meta+J" title={railed ? undefined : `${ask.label} (⌘J)`} data-tip={railed ? 'Ask AI · ⌘J' : undefined}
          {...(ask.mode === 'page' ? { 'aria-current': askCurrent ? 'page' : undefined } : { 'aria-expanded': askExpanded, 'aria-controls': 'help-drawer' })} onClick={() => { close(); onAsk(); }}>
          <Sparkles size={17} strokeWidth={1.9} aria-hidden="true" /><span className="sb-text">{ask.label}</span><kbd className="sb-kbd" aria-hidden="true">⌘J</kbd>
        </button>}
      </div>}
      <NavGroups groups={groups} activeId={activeId} rail={railed} onNavigate={go} onToggleDataTools={onToggleDataTools} />
      <footer className="sb-foot">
        <WorkingPopover working={working && typeof working === 'object' ? working : { label: workingText(working), runs: [] }} rail={railed} placement={railed ? 'right-up' : 'top'} />
        {layouts.length > 1 && <div className="sb-layout" role="radiogroup" aria-label="Layout" data-spot="nav.mode">
          {layouts.map((row) => { const Icon = LAYOUT_ICON[row.id] || LayoutList; return <label key={row.id} className={mode === row.id ? 'checked' : ''} title={row.hint} data-tip={railed ? `${row.label} layout` : undefined}>
            <input type="radio" name="studio-layout" value={row.id} checked={mode === row.id} onChange={() => { onMode(row.id); close(); }} />{railed && <Icon size={16} aria-hidden="true" />}<span className="sb-text">{row.label}</span>
          </label>; })}
        </div>}
        <div ref={account} className="sb-account-wrap">
          <MenuButton label="Account" rows={accountRows} placement={railed ? 'right-up' : 'top'} menuClass="sb-account-menu"
            header={<div className="sb-menu-who" role="presentation"><strong>{name}</strong><small>{preview ? `Viewing as ${label}` : viewer.email && viewer.email !== name ? viewer.email : label}</small></div>}
            buttonClass={`sb-account${preview ? ' is-preview' : ''}`} buttonProps={{ 'data-spot': 'nav.account', 'aria-label': `Account: ${name}, ${accountLine}`, 'data-tip': railed ? `${name} · ${accountLine}` : undefined }}
            buttonContent={<><span className="sb-avatar" aria-hidden="true">{initials(name)}{preview && <span className="sb-avatar-eye"><Eye size={10} /></span>}</span><span className="sb-account-copy"><strong>{name}</strong><small>{accountLine}</small></span><Ellipsis className="sb-account-more" size={16} aria-hidden="true" /></>} />
        </div>
      </footer>
    </aside>
    {drawer && <div className="studio-scrim" aria-hidden="true" onClick={close} />}
    {tip && <span className="sb-tip" aria-hidden="true" style={tipStyle}>{tip.text}</span>}
    {dialog === 'shortcuts' && <KeyboardShortcutsDialog shortcuts={nav?.shortcuts || []} onClose={() => setDialog('')} />}
    {dialog === 'channels' && <MyChannelsDialog channels={channels} selected={focus} onSave={onSaveFocusChannels} onClose={() => setDialog('')} />}
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
    {text && <span className="studio-working compact" role="status"><LoaderCircle className="spin" size={14} aria-hidden="true" /><span>{text}</span></span>}
    {channel && web && onSignOut && <MoreMenu label="Account" items={[{ label: 'Sign out', icon: LogOut, onSelect: onSignOut }]} />}
  </header>;
}

// Channel owners on a phone: their pages, fixed to the bottom edge above the home indicator. Items are nav-model rows.
export function ChannelBottomNav({ items = [], active, onNavigate }) {
  const narrow = useNarrow();
  if (!narrow) return null;
  return <nav className="studio-bottom-nav" aria-label="Main">{items.map((row) => {
    const Icon = row.icon ? iconOf(row.icon) : null; const current = active === row.id;
    const name = itemName({ ...row, badge: Number(row.badge ?? row.count) || 0, badgeLabel: row.badgeLabel || row.countLabel || '' });
    return <button key={row.id} type="button" className={current ? 'active' : ''} data-spot={row.spot || `nav.${row.id}`} aria-current={current ? 'page' : undefined} aria-label={name !== row.label ? name : undefined} onClick={() => onNavigate?.(row.id)}>
      <span className="studio-bottom-icon">{Icon && <Icon size={20} aria-hidden="true" />}{Number(row.badge ?? row.count) > 0 && <span className="simple-count" aria-hidden="true">{row.badge ?? row.count}</span>}</span><span>{row.label}</span>
    </button>;
  })}</nav>;
}
