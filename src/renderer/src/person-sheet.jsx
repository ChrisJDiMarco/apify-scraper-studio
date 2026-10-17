import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ClipboardCopy, Link2, LoaderCircle, Lock, RefreshCw, Unlink } from 'lucide-react';
import { Dialog, DialogClose, copyText } from './role-screens.jsx';
import { useConfirm } from './confirm-dialog.jsx';
import { firstName, formatDay, formatTime, plural, writeProps } from './viewer.js';

// One person, in a wide sheet with four tabs: Details (name, email, role, channel), Access (their own changes on top of
// the role: Role default · On · Off for each capability), Sign-in (their link) and Activity (the access log about them).
// The capability rules here mirror src/main/roles.js only so a choice can switch its prerequisites on (or what depends
// on it off) as the admin clicks; the server checks every save and previewAccess answers what the result can do.
const list = (value) => (Array.isArray(value) ? value : []);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const runWith = (action, fn) => (action ? action(fn, '', true) : Promise.resolve().then(fn));
const expired = (link) => Boolean(link?.expiresAt) && new Date(link.expiresAt).getTime() < Date.now();

// ---------- Capability rules ----------
// access: getTeam().access. Returns the capabilities by id and grouped in the order roles.json lists the groups.
export function capabilityRules(access) {
  const caps = list(access?.capabilities);
  const byId = new Map(caps.map((cap) => [cap.id, cap]));
  const groups = list(access?.groups).map((group) => ({ ...group, caps: caps.filter((cap) => cap.group === group.id) })).filter((group) => group.caps.length);
  return { caps, byId, groups };
}
// What a capability needs besides itself: its requirements, plus See costs for paid work on an editor-based role.
export const requirementsOf = (cap, base) => [...list(cap?.requires), ...(base === 'editor' && cap?.spends ? ['seeCosts'] : [])];
// 'admin' (an admin has it), 'always' (everyone has it), 'locked' (admins only), 'unavailable' (not for this kind of
// role) or 'open'.
export function availability(cap, base) {
  if (base === 'admin') return 'admin';
  if (cap.lock === 'always') return 'always';
  if (cap.lock === 'admin') return 'locked';
  return list(cap.bases).includes(base) ? 'open' : 'unavailable';
}
// Removes anything whose requirements are missing, until nothing changes. Returns what it removed.
export function closeSet(set, base, byId) {
  const removed = [];
  for (let changed = true; changed;) {
    changed = false;
    for (const id of [...set]) if (requirementsOf(byId.get(id), base).some((need) => !set.has(need))) { set.delete(id); removed.push(id); changed = true; }
  }
  return removed;
}
// Turning one on also turns on what it needs (that this kind of role can have); returns what else came on.
export function withRequirements(set, id, base, byId) {
  const added = []; const queue = [id];
  while (queue.length) {
    const next = queue.shift(); if (set.has(next)) continue;
    const cap = byId.get(next); if (!cap || !['open', 'always'].includes(availability(cap, base))) continue;
    set.add(next); if (next !== id) added.push(next);
    queue.push(...requirementsOf(cap, base));
  }
  return added;
}
// Turning one off also turns off everything that needs it; returns what else went off.
export function withoutDependents(set, id, base, byId) {
  set.delete(id);
  return closeSet(set, base, byId);
}
// What a person holds: their role's capabilities with their own grants and denies (deny wins), settled for the base.
export function personCapabilities({ roleCaps, grants, denies, base, byId }) {
  if (base === 'admin') return new Set(byId.keys());
  const deny = new Set(list(denies));
  const set = new Set([...list(roleCaps), ...list(grants)].filter((id) => !deny.has(id) && byId.has(id) && ['open', 'always'].includes(availability(byId.get(id), base))));
  for (const cap of byId.values()) if (cap.lock === 'always') set.add(cap.id);
  closeSet(set, base, byId);
  return set;
}
const labelsOf = (ids, byId) => ids.map((id) => byId.get(id)?.label || id);
// One three-way choice for a person, with its cascade. Returns { grants, denies, note } where note names what else
// changed ("Also turned on: See research and evidence").
export function setPersonState(context, id, state) {
  const { roleCaps, grants, denies, base, byId } = context;
  const role = new Set(list(roleCaps)); const grant = new Set(list(grants)); const deny = new Set(list(denies));
  const before = personCapabilities(context);
  grant.delete(id); deny.delete(id);
  if (state === 'on') {
    grant.add(id);
    // Its prerequisites come on too: a denied role default is undone, one the role lacks is granted.
    const needed = new Set(); withRequirements(needed, id, base, byId);
    for (const need of needed) { if (need === id) continue; deny.delete(need); if (!role.has(need)) grant.add(need); }
  } else if (state === 'off') deny.add(id);
  // Whatever now misses a prerequisite goes off with it, and stays off: a grant is dropped, a role default is denied.
  const after = personCapabilities({ ...context, grants: [...grant], denies: [...deny] });
  for (const gone of [...before].filter((cap) => !after.has(cap) && cap !== id)) { grant.delete(gone); if (role.has(gone)) deny.add(gone); }
  const final = personCapabilities({ ...context, grants: [...grant], denies: [...deny] });
  const on = [...final].filter((cap) => !before.has(cap) && cap !== id); const off = [...before].filter((cap) => !final.has(cap) && cap !== id);
  const note = [on.length ? `Also turned on: ${labelsOf(on, byId).join(', ')}` : '', off.length ? `Also turned off: ${labelsOf(off, byId).join(', ')}` : ''].filter(Boolean).join('. ');
  return { grants: [...grant].filter((cap) => byId.has(cap)).sort(), denies: [...deny].filter((cap) => byId.has(cap)).sort(), note };
}
const stateOf = (grants, denies, id) => (list(denies).includes(id) ? 'off' : list(grants).includes(id) ? 'on' : 'default');
export const roleOf = (access, roleId) => list(access?.roles).find((role) => role.id === roleId) || null;
// "Can: Start research, Write reports, … · Can’t: Edit brand knowledge, …" for a role card.
export function roleSummary(role, rules) {
  if (!role) return '';
  if (role.base === 'admin') return 'Can do everything, including settings, people and access.';
  const held = new Set(role.capabilities);
  const shown = rules.caps.filter((cap) => availability(cap, role.base) === 'open');
  const can = shown.filter((cap) => held.has(cap.id)).map((cap) => cap.label); const cannot = shown.filter((cap) => !held.has(cap.id)).map((cap) => cap.label);
  const clip = (items) => (items.length > 4 ? `${items.slice(0, 4).join(', ')} and ${items.length - 4} more` : items.join(', '));
  return [can.length ? `Can: ${clip(can)}` : 'Can only read what’s shared with them', cannot.length ? `Can’t: ${clip(cannot)}` : ''].filter(Boolean).join(' · ');
}

// ---------- Access list (the three-way control) ----------
const REASONS = {
  locked: (cap) => `Only admins can have “${cap.label}”.`,
  unavailable: (cap) => `Channel owners see only their channel, so they can’t have “${cap.label}”.`,
  always: () => 'Everyone with a role has this.',
};
// grants/denies: the person's own changes; roleCaps: what their role gives them. onChange({ grants, denies, note, id }).
export function AccessList({ access, base, roleCaps, roleName = 'role', grants, denies, onChange, disabled = false, notes = {}, idPrefix }) {
  const rules = useMemo(() => capabilityRules(access), [access]);
  const fallbackId = useId(); const prefix = idPrefix || fallbackId;
  if (base === 'admin') return <p className="people-access-note"><Lock size={15} aria-hidden="true" />Admins can do everything, so their access can’t be adjusted.</p>;
  const roleSet = new Set(list(roleCaps));
  const held = personCapabilities({ roleCaps, grants, denies, base, byId: rules.byId });
  return <div className="people-access-list">
    {rules.groups.map((group) => <section key={group.id} className="people-access-group" aria-labelledby={`${prefix}-${group.id}`}>
      <h3 id={`${prefix}-${group.id}`}>{group.label}</h3>
      {group.caps.map((cap) => {
        const kind = availability(cap, base); const state = stateOf(grants, denies, cap.id); const name = `${prefix}-${cap.id}`;
        const choose = (next) => onChange({ ...setPersonState({ roleCaps, grants, denies, base, byId: rules.byId }, cap.id, next), id: cap.id });
        return <div key={cap.id} className={`people-access-row is-${kind}${held.has(cap.id) ? ' is-on' : ''}`}>
          <div className="people-access-copy">
            <strong id={`${name}-label`}>{cap.label}{cap.spends && <span className="people-cost-tag">Costs money</span>}</strong>
            <small id={`${name}-help`}>{cap.description}</small>
            {notes[cap.id] && <small className="people-access-cascade" role="status">{notes[cap.id]}</small>}
          </div>
          {kind === 'open'
            ? <div className="studio-segment people-three-way" role="radiogroup" aria-labelledby={`${name}-label`} aria-describedby={`${name}-help`}>
              {[['default', `Role default (${roleSet.has(cap.id) ? 'On' : 'Off'})`], ['on', 'On'], ['off', 'Off']].map(([value, label]) => <label key={value} className={state === value ? 'checked' : ''}>
                <input type="radio" name={name} value={value} checked={state === value} disabled={disabled} onChange={() => choose(value)} />{label}
              </label>)}
            </div>
            : <span className="people-access-fixed">{kind === 'always' ? <Check size={15} aria-hidden="true" /> : <Lock size={15} aria-hidden="true" />}<span>{REASONS[kind](cap)}</span></span>}
        </div>;
      })}
    </section>)}
    <p className="studio-hint">Role default follows the {roleName} role, including later changes to it. On and Off stay as you set them.</p>
  </div>;
}

// ---------- Links ----------
export function linkStatus(member, signIn = {}) {
  const link = member.link;
  if (link) {
    if (expired(link)) return `Link expired ${formatDay(link.expiresAt)}`;
    return [`Link made ${formatDay(link.createdAt)}`, link.expiresAt ? `works until ${formatDay(link.expiresAt)}` : 'never expires', link.lastUsedAt ? `used ${formatDay(link.lastUsedAt)}` : 'not used yet'].join(' · ');
  }
  if (!member.lastSeenAt) return 'Never signed in';
  return signIn.links && !signIn.sso ? 'No link' : '';
}
export function linkMessage({ url, expiresAt, studioName = 'research studio' }) {
  return `Here’s your sign-in link for the ${studioName}: ${url}. ${expiresAt ? `It works until ${formatDay(expiresAt)}.` : 'It doesn’t expire.'} Open it in your work browser.`;
}
export function LinkPanel({ member, panel, studioName, onDone }) {
  const [copied, setCopied] = useState('');
  const message = linkMessage({ url: panel.url, expiresAt: panel.expiresAt, studioName });
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, [panel.url]);
  async function copy(kind, text) { if (await copyText(text)) { setCopied(kind); setTimeout(() => setCopied(''), 1800); } }
  return <div className="people-link-panel" role="region" aria-label={`Sign-in link for ${member.name}`}>
    <h3 ref={ref} tabIndex={-1}>Send {firstName(member.name) || 'them'} this link</h3>
    <div className="people-link-row"><input readOnly value={panel.url} aria-label={`Sign-in link for ${member.name}`} onFocus={(event) => event.target.select()} /><button type="button" className="studio-primary small" onClick={() => copy('url', panel.url)}>{copied === 'url' ? <Check size={14} aria-hidden="true" /> : <ClipboardCopy size={14} aria-hidden="true" />}{copied === 'url' ? 'Copied' : 'Copy link'}</button></div>
    <p className="people-link-message">{message}</p>
    <div className="people-link-actions"><button type="button" className="studio-quiet small" onClick={() => copy('message', message)}>{copied === 'message' ? <Check size={14} aria-hidden="true" /> : <ClipboardCopy size={14} aria-hidden="true" />}{copied === 'message' ? 'Copied' : 'Copy message'}</button>{onDone && <button type="button" className="studio-link" onClick={onDone}>Done</button>}</div>
    <p className="studio-hint">Only {firstName(member.name) || 'they'} should use it. Making a new link turns this one off.</p>
  </div>;
}

// ---------- Activity (the access log about one person) ----------
export function MemberActivity({ api, memberId }) {
  const [page, setPage] = useState({ rows: [], more: false, next: '' });
  const [status, setStatus] = useState('loading');
  async function load(before = '') {
    setStatus('loading');
    try {
      const result = await api.readAccessLog({ memberId, limit: 20, ...(before ? { before } : {}) });
      setPage((current) => ({ rows: before ? [...current.rows, ...list(result?.rows)] : list(result?.rows), more: Boolean(result?.more), next: result?.next || '' })); setStatus('ready');
    } catch (failure) { setStatus(failure?.message || 'The access log couldn’t be loaded.'); }
  }
  useEffect(() => { if (typeof api?.readAccessLog === 'function') load(); else setStatus('ready'); }, [memberId]);
  if (typeof api?.readAccessLog !== 'function') return <p className="studio-hint">The access log isn’t available in this version of the studio.</p>;
  return <div className="people-activity">
    {status !== 'ready' && status !== 'loading' && <p className="studio-error" role="alert">{status} <button type="button" className="studio-link" onClick={() => load()}>Try again</button></p>}
    {status === 'ready' && !page.rows.length && <p className="studio-hint">No changes to their access yet.</p>}
    {page.rows.length > 0 && <ol className="people-activity-list">{page.rows.map((row) => <li key={row.id}><span>{row.text}</span><time dateTime={row.at}>{formatDay(row.at)}, {formatTime(row.at)}</time></li>)}</ol>}
    {status === 'loading' && <p className="studio-hint" role="status"><LoaderCircle className="spin" size={14} aria-hidden="true" /> Loading…</p>}
    {page.more && status === 'ready' && <button type="button" className="studio-quiet small" onClick={() => load(page.next)}>Load older</button>}
  </div>;
}

// ---------- The sheet ----------
const TABS = [['details', 'Details'], ['access', 'Access'], ['signin', 'Sign-in'], ['activity', 'Activity']];
export function PersonSheet({ team, member, viewer = {}, web = false, api, action, initialTab = 'details', studioName, onClose, onSaved, onLinkMade, onTurnOffLink }) {
  const access = team?.access || null;
  const rules = useMemo(() => capabilityRules(access), [access]);
  const channels = list(team?.channels);
  const titleId = useId(); const tabId = useId();
  const nameRef = useRef(null);
  const confirm = useConfirm();
  const [tab, setTab] = useState(TABS.some(([id]) => id === initialTab) ? initialTab : 'details');
  const [name, setName] = useState(member.name || '');
  const [email, setEmail] = useState(member.email || '');
  const [role, setRole] = useState(member.role);
  const [channelId, setChannelId] = useState(member.channelId || '');
  const [grants, setGrants] = useState(list(member.grants));
  const [denies, setDenies] = useState(list(member.denies));
  const [notes, setNotes] = useState({});
  const [summary, setSummary] = useState(null);
  const [problem, setProblem] = useState('');
  const [saving, setSaving] = useState(false);
  const [panel, setPanel] = useState(null);
  const roles = list(access?.roles);
  const roleDef = roleOf(access, role); const savedDef = roleOf(access, member.role);
  const base = roleDef?.base || member.base || null;
  const self = member.id === viewer.id;
  const admins = list(team?.members).filter((row) => row.role === 'admin' && !row.disabled);
  const lastAdmin = member.role === 'admin' && !member.disabled && admins.length <= 1;
  const locked = Boolean(member.serverAdmin);
  const sso = Boolean(team?.signIn?.sso); const links = Boolean(team?.signIn?.links) && typeof api?.createSignInLink === 'function';
  const emailChanged = sso && email.trim().toLowerCase() !== String(member.email || '').toLowerCase();
  const baseChanged = (savedDef?.base || member.base) !== base;
  const detailsChanged = name.trim() !== (member.name || '') || email.trim().toLowerCase() !== String(member.email || '').toLowerCase() || role !== member.role || (base === 'channel' ? channelId : null) !== (member.channelId || null);
  const accessChanged = !baseChanged && base !== 'admin' && (list(grants).join() !== list(member.grants).join() || list(denies).join() !== list(member.denies).join());
  const first = firstName(member.name) || member.name || 'They';

  // Moving to another kind of role clears their own access changes, as the server does.
  function chooseRole(id) {
    const next = roleOf(access, id); setRole(id); setProblem(''); setNotes({});
    if (next?.base !== (savedDef?.base || member.base)) { setGrants([]); setDenies([]); } else { setGrants(list(member.grants)); setDenies(list(member.denies)); }
  }
  // The live summary comes from the server's own merge (previewAccess), so this sheet never guesses what Save allows.
  useEffect(() => {
    if (typeof api?.previewAccess !== 'function' || !roleDef || base === 'admin') { setSummary(null); return undefined; }
    let cancelled = false;
    const timer = setTimeout(() => {
      Promise.resolve(api.previewAccess({ role, grants, denies })).then((result) => { if (!cancelled) setSummary(result || null); }, () => { if (!cancelled) setSummary(null); });
    }, 200);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [role, grants.join(), denies.join()]);
  const held = summary ? list(summary.capabilities) : [...personCapabilities({ roleCaps: roleDef?.capabilities, grants, denies, base, byId: rules.byId })];
  const changes = roleDef ? held.filter((id) => !list(roleDef.capabilities).includes(id)).length + list(roleDef.capabilities).filter((id) => !held.includes(id)).length : 0;
  const possible = summary?.possible ?? rules.caps.filter((cap) => availability(cap, base) === 'open').length;
  const canCount = summary ? list(summary.can).length : held.filter((id) => rules.byId.get(id) && availability(rules.byId.get(id), base) === 'open').length;

  async function save(event) {
    event?.preventDefault();
    const clean = { name: name.trim(), email: email.trim(), role, channelId: base === 'channel' ? channelId : null };
    if (!clean.name) { setTab('details'); setProblem('Add their name.'); setTimeout(() => nameRef.current?.focus()); return; }
    if (clean.name.length > 120) { setTab('details'); setProblem('Keep the name under 120 characters.'); return; }
    if ((web || clean.email) && !EMAIL.test(clean.email)) { setTab('details'); setProblem('That doesn’t look like an email address.'); return; }
    if (base === 'channel' && !clean.channelId) { setTab('details'); setProblem('Choose their channel.'); return; }
    if (baseChanged && (list(member.grants).length || list(member.denies).length) && !(await confirm({ title: `Change ${first}’s kind of role?`, lines: [`${roleDef?.label || 'This role'} is a different kind of role, so ${first}’s own access changes are cleared.`], confirmLabel: 'Change role' }))) return;
    setSaving(true); setProblem('');
    try {
      let saved = member;
      if (detailsChanged) {
        const result = await runWith(action, () => api.saveMember({ id: member.id, ...clean, disabled: Boolean(member.disabled) }));
        if (result === null) throw new Error('That couldn’t be saved. Try again.');
        saved = result?.member || { ...member, ...clean };
      }
      if (accessChanged && typeof api.saveMemberAccess === 'function') {
        const result = await runWith(action, () => api.saveMemberAccess({ id: member.id, grants, denies }));
        if (result === null) throw new Error('Their access couldn’t be saved. Try again.');
        saved = result?.member || saved;
      }
      setSaving(false);
      onSaved(saved);
    } catch (failure) { setSaving(false); setProblem(failure?.message || 'That couldn’t be saved. Try again.'); }
  }
  async function makeLink() {
    if (member.link && !expired(member.link) && !(await confirm({ title: `Make a new link for ${first}?`, lines: [`${first}’s current link will stop working, and anyone signed in with it is signed out.`], confirmLabel: 'Make a new link' }))) return;
    try { const result = await runWith(action, () => api.createSignInLink({ id: member.id })); if (result?.url) { setPanel({ url: result.url, expiresAt: result.expiresAt || null }); onLinkMade?.(member, result); } }
    catch (failure) { setProblem(failure?.message || 'The link couldn’t be made. Try again.'); }
  }
  const tabs = TABS.filter(([id]) => id !== 'signin' || web);
  const editable = !locked && typeof api?.saveMember === 'function';
  const roleChoices = roles.filter((entry) => !self || entry.id === member.role);
  return <Dialog labelledBy={titleId} onClose={onClose} closeDisabled={saving} initialFocus={tab === 'details' ? nameRef : undefined} className="people-sheet people-person-sheet" wide>
    <form className="people-sheet-form" noValidate onSubmit={save}>
      <header className="studio-dialog-head"><div><small>People & access</small><h2 id={titleId}>{member.name}</h2><p className="studio-dialog-meta">{member.roleLabel || roleDef?.label || 'No role'}{member.email ? ` · ${member.email}` : ''}</p></div><DialogClose onClose={onClose} disabled={saving} /></header>
      <div className="people-sheet-tabs" role="tablist" aria-label={`${member.name}’s details`}>
        {tabs.map(([id, label]) => <button key={id} type="button" role="tab" id={`${tabId}-${id}`} aria-selected={tab === id} aria-controls={`${tabId}-${id}-panel`} tabIndex={tab === id ? 0 : -1} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}
          onKeyDown={(event) => { const index = tabs.findIndex(([value]) => value === id); const move = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0; if (!move) return; event.preventDefault(); const next = tabs[(index + move + tabs.length) % tabs.length][0]; setTab(next); document.getElementById(`${tabId}-${next}`)?.focus(); }}>{label}</button>)}
      </div>
      <div className="studio-dialog-body" role="tabpanel" id={`${tabId}-${tab}-panel`} aria-labelledby={`${tabId}-${tab}`}>
        {locked && <p className="studio-hint">{member.name} is an admin in the server settings, so their access is set there.</p>}
        {tab === 'details' && <>
          <label className="studio-field"><span>Name</span><input ref={nameRef} value={name} maxLength={120} autoComplete="off" disabled={!editable} onChange={(event) => { setName(event.target.value); setProblem(''); }} /></label>
          <label className="studio-field"><span>Work email{web ? '' : <em> (optional)</em>}</span><input type="email" inputMode="email" autoComplete="off" value={email} disabled={!editable} onChange={(event) => { setEmail(event.target.value); setProblem(''); }} /></label>
          {emailChanged && <p className="channel-note">They’ll sign in with this address from now on.</p>}
          <fieldset className="people-roles">
            <legend>Role</legend>
            {self && <p className="studio-hint">You can’t change your own role. Ask another admin.</p>}
            {!self && lastAdmin && <p className="studio-hint">The studio needs at least one admin, so this person stays an admin.</p>}
            <div className="people-role-cards" role="radiogroup" aria-label="Role">{roleChoices.map((entry) => <label key={entry.id} className={`people-role-card role-${entry.base}${role === entry.id ? ' checked' : ''}`}>
              <input type="radio" name={`${titleId}-role`} value={entry.id} checked={role === entry.id} disabled={!editable || ((self || lastAdmin) && entry.id !== member.role)} onChange={() => chooseRole(entry.id)} />
              <span><strong>{entry.label}{!entry.builtIn && <em className="people-custom-tag">Custom</em>}</strong><small>{entry.description}</small><small className="people-role-summary">{roleSummary(entry, rules)}</small></span>
            </label>)}</div>
            {baseChanged && (list(member.grants).length > 0 || list(member.denies).length > 0) && <p className="studio-hint">{roleDef?.label} is a different kind of role, so {first}’s own access changes will be cleared.</p>}
          </fieldset>
          {base === 'channel' && <label className="studio-field"><span>Channel</span><select value={channelId} disabled={!editable} onChange={(event) => { setChannelId(event.target.value); setProblem(''); }}><option value="">Choose a channel</option>{channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></label>}
        </>}
        {tab === 'access' && <>
          {base !== 'admin' && roleDef && <p className="people-access-summary" role="status">{first} can do {canCount} of {possible} things{changes ? ` · ${plural(changes, 'change')} from ${roleDef.label}` : ` · the same as ${roleDef.label}`}</p>}
          {self && base !== 'admin' && <p className="studio-hint">You can’t change your own access. Ask another admin.</p>}
          {baseChanged && <p className="studio-hint">Save the new role first, then adjust {first}’s access.</p>}
          {!baseChanged && <AccessList access={access} base={base} roleCaps={roleDef?.capabilities} roleName={roleDef?.label || 'their'} grants={grants} denies={denies} notes={notes} disabled={!editable || self || typeof api?.saveMemberAccess !== 'function' || viewer.preview}
            onChange={(next) => { setGrants(next.grants); setDenies(next.denies); setNotes(next.note ? { [next.id]: next.note } : {}); setProblem(''); }} />}
        </>}
        {tab === 'signin' && <div className="people-signin">
          {!web && <p className="studio-hint">Sign-in links are for the web version.</p>}
          {web && sso && <p className="studio-hint">{first} signs in with their company account{member.email ? ` (${member.email})` : ''}. There’s no link to manage.</p>}
          {web && !sso && <>
            <p className="people-signin-status"><strong>{member.lastSeenAt ? `Last signed in ${formatDay(member.lastSeenAt)}` : 'Never signed in'}</strong><span>{linkStatus(member, team?.signIn)}</span></p>
            {links && !member.disabled && <div className="people-link-actions">
              <button type="button" className="studio-primary small" {...writeProps(viewer, saving)} onClick={makeLink}><Link2 size={14} aria-hidden="true" />{member.link ? 'Make a new sign-in link' : 'Make a sign-in link'}</button>
              {member.link && onTurnOffLink && <button type="button" className="studio-quiet small" {...writeProps(viewer, saving)} onClick={() => onTurnOffLink(member)}><Unlink size={14} aria-hidden="true" />Turn off link</button>}
            </div>}
            {member.disabled && <p className="studio-hint">Turn {first} back on before making a sign-in link.</p>}
            {panel && <LinkPanel member={member} panel={panel} studioName={studioName} />}
          </>}
        </div>}
        {tab === 'activity' && <MemberActivity api={api} memberId={member.id} />}
        {problem && <p className="studio-error" role="alert">{problem}</p>}
      </div>
      <footer className="studio-dialog-foot">
        <button type="button" className="studio-quiet" disabled={saving} onClick={onClose}>{detailsChanged || accessChanged ? 'Cancel' : 'Close'}</button>
        {editable && ['details', 'access'].includes(tab) && <button type="submit" className="studio-primary" {...writeProps(viewer, saving || !(detailsChanged || accessChanged))}>{saving ? <LoaderCircle className="spin" size={15} aria-hidden="true" /> : null}{saving ? 'Saving…' : 'Save changes'}</button>}
      </footer>
    </form>
  </Dialog>;
}

// A refresh control used by the People tabs when a load fails.
export function RetryNote({ message, onRetry }) {
  return <div className="studio-empty" role="alert"><p>{message}</p><button type="button" className="studio-quiet small" onClick={onRetry}><RefreshCw size={14} aria-hidden="true" />Try again</button></div>;
}
