import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Download, LoaderCircle } from 'lucide-react';
import { RetryNote } from './person-sheet.jsx';
import { formatDay, formatTime, plural } from './viewer.js';

// The Access log tab: who changed people, roles and access, newest first, one sentence a row ("Alex turned off Edit AI
// prompts for Editor · affects 4 people · Oct 17, 10:42"). Rows open to show each change. Filters ask the server
// (readAccessLog); Load older pages back; Download CSV saves the rows loaded so far.
const list = (value) => (Array.isArray(value) ? value : []);
export const KIND_FILTERS = [
  ['all', 'Everything', []],
  ['people', 'People added, changed or removed', ['member-added', 'member-changed', 'member-disabled', 'member-enabled', 'member-removed']],
  ['access', 'Access changes', ['member-access', 'policy-changed']],
  ['roles', 'Roles made, renamed or deleted', ['role-created', 'role-changed', 'role-deleted']],
  ['links', 'Sign-in links', ['link-issued', 'link-revoked']],
];
const FIELD_LABELS = { name: 'Name', email: 'Email', role: 'Role', channelId: 'Channel', label: 'Name', description: 'Description', base: 'Built on', grant: 'Own access', deny: 'Own access' };
const STATE_WORDS = { on: 'On', off: 'Off', default: 'Role default', true: 'On', false: 'Off' };
export const when = (value) => `${formatDay(value)}, ${formatTime(value)}`;
// One stored change in words: "Edit AI prompts: On → Off", "Role: Editor → Viewer".
export function describeChange(change, { capabilityLabel = (id) => id, channelName = (id) => id } = {}) {
  if (change.field === 'capability' || change.capability) return `${capabilityLabel(change.capability)}: ${STATE_WORDS[String(change.from)] ?? String(change.from)} → ${STATE_WORDS[String(change.to)] ?? String(change.to)}`;
  const value = (raw, label) => label || (change.field === 'channelId' ? (raw ? channelName(raw) : 'none') : raw === '' || raw == null ? 'none' : String(raw));
  return `${FIELD_LABELS[change.field] || change.field}: ${value(change.from, change.fromLabel)} → ${value(change.to, change.toLabel)}`;
}
const csvCell = (value) => { const text = String(value ?? ''); return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; };
export function accessLogCsv(rows) {
  return [['When', 'Who', 'What', 'Affects', 'Kind'], ...rows.map((row) => [row.at, row.by?.name || '', row.text, row.affected || 0, row.kind])].map((line) => line.map(csvCell).join(',')).join('\n');
}
function download(name, text) {
  const blob = new Blob([`﻿${text}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function AccessLog({ api, team }) {
  const members = list(team?.members); const roles = list(team?.access?.roles); const channels = list(team?.channels);
  const capabilityLabel = useMemo(() => { const labels = new Map(list(team?.access?.capabilities).map((cap) => [cap.id, cap.label])); return (id) => labels.get(id) || id; }, [team]);
  const channelName = (id) => channels.find((channel) => channel.id === id)?.name || id;
  const [filters, setFilters] = useState({ memberId: '', roleId: '', kind: 'all' });
  const [rows, setRows] = useState([]);
  const [more, setMore] = useState(false);
  const [next, setNext] = useState('');
  const [status, setStatus] = useState('loading');
  const [open, setOpen] = useState(() => new Set());
  const available = typeof api?.readAccessLog === 'function';
  async function load(before = '') {
    if (!available) return;
    setStatus(before ? 'older' : 'loading');
    try {
      const kinds = KIND_FILTERS.find(([id]) => id === filters.kind)?.[2] || [];
      const result = await api.readAccessLog({ limit: 50, ...(before ? { before } : {}), ...(filters.memberId ? { memberId: filters.memberId } : {}), ...(filters.roleId ? { roleId: filters.roleId } : {}), ...(kinds.length ? { kinds } : {}) });
      setRows((current) => (before ? [...current, ...list(result?.rows)] : list(result?.rows)));
      setMore(Boolean(result?.more)); setNext(result?.next || ''); setStatus('ready');
    } catch (failure) { setStatus(failure?.message || 'The access log couldn’t be loaded. Try again.'); }
  }
  useEffect(() => { setOpen(new Set()); load(); }, [filters.memberId, filters.roleId, filters.kind]);
  if (!available) return <div className="studio-empty"><p>The access log isn’t available in this version of the studio.</p></div>;
  const set = (key) => (event) => setFilters((current) => ({ ...current, [key]: event.target.value }));
  const filtered = Boolean(filters.memberId || filters.roleId || filters.kind !== 'all');
  const failed = !['loading', 'older', 'ready'].includes(status);
  return <div className="access-log-tab">
    <div className="people-toolbar" role="group" aria-label="Filter the access log">
      <label className="people-filter"><span>Person</span><select value={filters.memberId} onChange={set('memberId')}><option value="">Everyone</option>{members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
      <label className="people-filter"><span>Role</span><select value={filters.roleId} onChange={set('roleId')}><option value="">All roles</option>{roles.map((role) => <option key={role.id} value={role.id}>{role.label}</option>)}</select></label>
      <label className="people-filter"><span>What</span><select value={filters.kind} onChange={set('kind')}>{KIND_FILTERS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <button type="button" className="studio-quiet small" disabled={!rows.length} onClick={() => download('access-log.csv', accessLogCsv(rows))}><Download size={14} aria-hidden="true" />Download CSV</button>
    </div>
    {failed && <RetryNote message={status} onRetry={() => load()} />}
    {status === 'loading' && <div className="studio-skeleton" role="status" aria-label="Loading the access log"><span /><span /><span /></div>}
    {status === 'ready' && !rows.length && <div className="studio-empty"><p>{filtered ? 'Nothing matches these filters.' : 'No changes yet. When someone invites people or changes what a role can do, it shows here.'}</p>{filtered && <button type="button" className="studio-quiet small" onClick={() => setFilters({ memberId: '', roleId: '', kind: 'all' })}>Clear filters</button>}</div>}
    {rows.length > 0 && <ol className="access-log-list" aria-label="Access log">{rows.map((row) => {
      const changes = list(row.changes); const expanded = open.has(row.id); const detailsId = `access-log-${row.id}`;
      return <li key={row.id} className={`access-log-row kind-${row.kind}`}>
        <div className="access-log-line">
          <p><span>{row.text}</span>{row.affected > 1 || row.kind === 'policy-changed' || row.kind === 'role-changed' ? <small> · affects {plural(row.affected, 'person', 'people')}</small> : null}<small> · <time dateTime={row.at}>{when(row.at)}</time></small></p>
          {changes.length > 0 && <button type="button" className="studio-icon-button" aria-expanded={expanded} aria-controls={detailsId} aria-label={expanded ? 'Hide the changes' : `Show ${plural(changes.length, 'change')}`} onClick={() => setOpen((current) => { const copy = new Set(current); if (copy.has(row.id)) copy.delete(row.id); else copy.add(row.id); return copy; })}><ChevronDown size={16} aria-hidden="true" className={expanded ? 'is-open' : ''} /></button>}
        </div>
        {expanded && <ul id={detailsId} className="access-log-changes">{changes.map((change, index) => <li key={index}>{describeChange(change, { capabilityLabel, channelName })}</li>)}</ul>}
      </li>;
    })}</ol>}
    {status === 'older' && <p className="studio-hint" role="status"><LoaderCircle className="spin" size={14} aria-hidden="true" /> Loading older changes…</p>}
    {more && status === 'ready' && <button type="button" className="studio-quiet small access-log-more" onClick={() => load(next)}>Load older</button>}
  </div>;
}
