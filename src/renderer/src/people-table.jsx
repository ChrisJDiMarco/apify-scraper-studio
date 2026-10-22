import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CirclePause, CirclePlay, Eye, KeyRound, Link2, PenLine, Search, Trash2, Unlink, UserPlus } from 'lucide-react';
import { MoreMenu, useNarrow } from './role-screens.jsx';
import { LinkPanel, linkStatus } from './person-sheet.jsx';
import { firstName, formatDay, formatTime, initials, plural, writeProps } from './viewer.js';

// The People tab: who owns each channel (one line when every channel has an owner), then everyone in a table you can
// search, filter and sort, each with a menu of what an admin can do. Below 860px the rows become cards.
const list = (value) => (Array.isArray(value) ? value : []);
const MINUTE = 60000; const DAY = 86400000;
const expired = (link) => Boolean(link?.expiresAt) && new Date(link.expiresAt).getTime() < Date.now();
export const STATUS_FILTERS = [['all', 'Everyone'], ['active', 'Active this week'], ['never', 'Never signed in'], ['disabled', 'Disabled'], ['expired', 'Link expired']];
export const SORTS = [['name', 'Name'], ['role', 'Role'], ['active', 'Last active']];

// "Active now" under 10 minutes, "Today 9:41", "Yesterday", "3 days ago", then the date; "Never signed in" otherwise.
export function lastActive(value, now = Date.now()) {
  const at = new Date(value || '').getTime();
  if (!value || !Number.isFinite(at)) return 'Never signed in';
  const age = now - at;
  if (age < 10 * MINUTE) return 'Active now';
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  if (at >= today.getTime()) return `Today ${formatTime(value)}`;
  if (at >= today.getTime() - DAY) return 'Yesterday';
  const days = Math.ceil((today.getTime() - at) / DAY);
  return days <= 6 ? `${days} days ago` : formatDay(value);
}
// The people a toolbar choice shows, in its order.
export function filterPeople(members, { query = '', role = 'all', status = 'all', channel = 'all', sort = 'name' } = {}, now = Date.now()) {
  const words = String(query).trim().toLowerCase().split(/\s+/).filter(Boolean);
  const rows = list(members).filter((member) => {
    const text = `${member.name || ''} ${member.email || ''}`.toLowerCase();
    if (words.some((word) => !text.includes(word))) return false;
    if (role !== 'all' && member.role !== role) return false;
    if (channel !== 'all' && member.channelId !== channel) return false;
    const seen = new Date(member.lastSeenAt || '').getTime();
    if (status === 'active' && !(Number.isFinite(seen) && now - seen <= 7 * DAY)) return false;
    if (status === 'never' && member.lastSeenAt) return false;
    if (status === 'disabled' && !member.disabled) return false;
    if (status === 'expired' && !expired(member.link)) return false;
    return true;
  });
  const byName = (a, b) => String(a.name || a.email || '').localeCompare(String(b.name || b.email || ''), undefined, { sensitivity: 'base' });
  const time = (member) => { const value = new Date(member.lastSeenAt || '').getTime(); return Number.isFinite(value) ? value : -Infinity; };
  const rank = { admin: 0, editor: 1, channel: 2 };
  return rows.sort(sort === 'active' ? (a, b) => time(b) - time(a) || byName(a, b) : sort === 'role' ? (a, b) => (rank[a.base] ?? 3) - (rank[b.base] ?? 3) || String(a.roleLabel || '').localeCompare(String(b.roleLabel || '')) || byName(a, b) : byName);
}

// "All 10 channels have an owner", or which ones don't, each with Assign.
export function CoverageStrip({ channels, canAssign, viewer, onAssign }) {
  const rows = list(channels);
  const open = rows.filter((channel) => !list(channel.owners).length);
  if (!rows.length) return null;
  return <section className={`people-coverage-strip${open.length ? ' has-open' : ''}`} aria-label="Channel owners">
    {!open.length
      ? <p><strong>All {plural(rows.length, 'channel')} {rows.length === 1 ? 'has' : 'have'} an owner.</strong></p>
      : <>
        <p><strong>{plural(open.length, 'channel')} {open.length === 1 ? 'has' : 'have'} no owner:</strong></p>
        <ul>{open.map((channel) => <li key={channel.id}><span>{channel.name}</span>{canAssign && <button type="button" className="studio-link" aria-label={`Assign an owner to ${channel.name}`} {...writeProps(viewer)} onClick={() => onAssign(channel.id)}><UserPlus size={14} aria-hidden="true" />Assign</button>}</li>)}</ul>
      </>}
  </section>;
}

function RoleCell({ member, onAccess }) {
  const plus = list(member.grants).length; const minus = list(member.denies).length;
  return <span className="people-role">
    <span className={`studio-chip role-${member.base || 'none'}`}>{member.roleLabel || 'No role'}</span>
    {(plus > 0 || minus > 0) && <button type="button" className="people-custom-chip" aria-label={`Custom access for ${member.name}: ${[plus ? `${plus} turned on` : '', minus ? `${minus} turned off` : ''].filter(Boolean).join(', ')}. Change access`} onClick={onAccess}>Custom access{plus ? ` +${plus}` : ''}{minus ? ` −${minus}` : ''}</button>}
    {member.disabled && <span className="studio-chip paused">Disabled</span>}
  </span>;
}

export function PeopleTable({ team, viewer = {}, web = false, editable = false, signIn = {}, links = false, panel = null, studioName, onInvite, onOpen, onPreview, onMakeLink, onTurnOffLink, onSetDisabled, onRemove, onDismissPanel }) {
  const members = list(team?.members);
  const channels = list(team?.channels);
  const roles = list(team?.access?.roles);
  const narrow = useNarrow();
  const searchRef = useRef(null);
  const [filters, setFilters] = useState({ query: '', role: 'all', status: 'all', channel: 'all', sort: 'name' });
  const shown = useMemo(() => filterPeople(members, filters), [members, filters]);
  const filtered = filters.query || filters.role !== 'all' || filters.status !== 'all' || filters.channel !== 'all';
  const enabledAdmins = members.filter((row) => row.role === 'admin' && !row.disabled);
  const channelName = (id) => channels.find((channel) => channel.id === id)?.name || '';
  const counts = new Map(); for (const member of members) counts.set(member.role, (counts.get(member.role) || 0) + 1);
  const set = (key) => (event) => setFilters((current) => ({ ...current, [key]: event.target.value }));
  // "/" jumps to search, unless someone is typing or a dialog is open.
  useEffect(() => {
    const onKey = (event) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target; if (target?.closest?.('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="alertdialog"]')) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      event.preventDefault(); searchRef.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  function menuFor(member) {
    if (member.serverAdmin || !editable) return [];
    const self = member.id === viewer.id;
    const last = member.role === 'admin' && !member.disabled && enabledAdmins.length <= 1;
    const guarded = self || last;
    const first = firstName(member.name) || member.name;
    return [
      { label: 'Edit details', icon: PenLine, onSelect: () => onOpen(member, 'details') },
      member.base !== 'admin' && { label: 'Change access', icon: KeyRound, onSelect: () => onOpen(member, 'access') },
      onPreview && member.base && member.base !== 'admin' && !member.disabled && { label: `Preview as ${first}`, icon: Eye, onSelect: () => onPreview(member) },
      links && !member.disabled && { label: signIn.email ? 'Email a sign-in link' : 'Make a sign-in link', icon: Link2, onSelect: () => onMakeLink(member) },
      links && (member.link || member.lastSeenAt) && { label: 'Sign out everywhere', icon: Unlink, onSelect: () => onTurnOffLink(member) },
      !guarded && (member.disabled ? { label: 'Enable', icon: CirclePlay, onSelect: () => onSetDisabled(member, false) } : { label: 'Disable', icon: CirclePause, title: 'They can’t sign in until you enable them again. Their answers stay.', onSelect: () => onSetDisabled(member, true) }),
      !guarded && onRemove && { label: 'Remove', icon: Trash2, danger: true, onSelect: () => onRemove(member) },
    ];
  }
  function actions(member) {
    if (member.serverAdmin) return <span className="people-server">Set by the server</span>;
    return <MoreMenu label={`Actions for ${member.name}`} disabled={Boolean(viewer.preview)} title={viewer.preview ? 'Buttons that change things are off in a preview.' : undefined} items={menuFor(member)} />;
  }
  const status = (member) => (web ? (signIn.sso ? 'Company sign-in' : links ? linkStatus(member, signIn) : '') : '');
  const person = (member) => <span className="people-person">
    <span className={`people-avatar role-${member.base || 'none'}`} aria-hidden="true">{initials(member.name || member.email)}</span>
    <span className="people-who"><strong>{member.name}{member.id === viewer.id ? ' (you)' : ''}</strong><small>{member.email || 'No email'}</small></span>
  </span>;
  const active = (member) => <span title={member.lastSeenAt ? `${formatDay(member.lastSeenAt)}, ${formatTime(member.lastSeenAt)}` : undefined}>{lastActive(member.lastSeenAt)}</span>;
  const linkFor = (member) => (panel?.memberId === member.id ? <LinkPanel member={member} panel={panel} studioName={studioName} onDone={onDismissPanel} /> : null);

  return <div className="people-tab">
    <CoverageStrip channels={channels} canAssign={editable && typeof onInvite === 'function'} viewer={viewer} onAssign={(channelId) => onInvite({ role: 'channel', channelId })} />
    <div className="people-toolbar" role="search" aria-label="Find people">
      <label className="people-search"><Search size={16} aria-hidden="true" /><span className="sr-only">Search people</span><input ref={searchRef} type="search" value={filters.query} placeholder="Search name or email" aria-keyshortcuts="/" onChange={set('query')} /><kbd aria-hidden="true">/</kbd></label>
      <label className="people-filter"><span>Role</span><select value={filters.role} onChange={set('role')}><option value="all">All roles ({members.length})</option>{roles.map((role) => <option key={role.id} value={role.id}>{role.label} ({counts.get(role.id) || 0})</option>)}</select></label>
      <label className="people-filter"><span>Status</span><select value={filters.status} onChange={set('status')}>{STATUS_FILTERS.filter(([id]) => id !== 'expired' || links).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      {channels.length > 0 && <label className="people-filter"><span>Channel</span><select value={filters.channel} onChange={set('channel')}><option value="all">All channels</option>{channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></label>}
      <label className="people-filter"><span>Sort</span><select value={filters.sort} onChange={set('sort')}>{SORTS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <p className="people-count" aria-live="polite">{filtered ? `${plural(members.length, 'person', 'people')}, ${shown.length} shown` : plural(members.length, 'person', 'people')}</p>
    </div>
    {!shown.length && <div className="studio-empty"><p>No one matches.</p><button type="button" className="studio-quiet small" onClick={() => setFilters((current) => ({ ...current, query: '', role: 'all', status: 'all', channel: 'all' }))}>Clear filters</button></div>}
    {shown.length > 0 && (narrow
      ? <ul className="people-cards" aria-label="People">{shown.map((member) => <li key={member.id} className={member.disabled ? 'is-disabled' : ''}>
        <div className="people-card-head">{person(member)}<span className="people-row-actions">{actions(member)}</span></div>
        <RoleCell member={member} onAccess={() => onOpen(member, 'access')} />
        <dl className="people-card-facts">
          {member.base === 'channel' && <><dt>Channel</dt><dd>{channelName(member.channelId) || 'No channel'}</dd></>}
          <dt>Last active</dt><dd>{active(member)}</dd>
          {status(member) && <><dt>Sign-in</dt><dd>{status(member)}</dd></>}
        </dl>
        {linkFor(member)}
      </li>)}</ul>
      : <table className="people-table">
        <caption className="sr-only">People in the studio</caption>
        <thead><tr><th scope="col">Person</th><th scope="col">Role & access</th><th scope="col">Channel</th><th scope="col">Last active</th>{web && <th scope="col">Sign-in</th>}<th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>{shown.map((member) => <React.Fragment key={member.id}>
          <tr className={member.disabled ? 'is-disabled' : ''}>
            <th scope="row">{person(member)}</th>
            <td><RoleCell member={member} onAccess={() => onOpen(member, 'access')} /></td>
            <td>{member.base === 'channel' ? channelName(member.channelId) || 'No channel' : <span className="people-none" aria-label="No channel">—</span>}</td>
            <td>{active(member)}</td>
            {web && <td className="people-signin-cell">{status(member)}</td>}
            <td className="people-row-actions">{actions(member)}</td>
          </tr>
          {panel?.memberId === member.id && <tr className="people-panel-row"><td colSpan={web ? 6 : 5}>{linkFor(member)}</td></tr>}
        </React.Fragment>)}</tbody>
      </table>)}
  </div>;
}
