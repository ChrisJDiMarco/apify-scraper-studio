import React, { useEffect, useId, useRef, useState } from 'react';
import { Check, ClipboardCopy, Eye, Link2, LoaderCircle, Monitor, CirclePause, PenLine, CirclePlay, RefreshCw, Trash2, Unlink, UserPlus, Users } from 'lucide-react';
import { Dialog, DialogClose, MoreMenu, copyText, useToast } from './role-screens.jsx';
import { ROLE_DESCRIPTIONS, ROLE_IDS, firstName, formatDay, initials, plural, roleLabel, writeProps } from './viewer.js';
import './people-view.css';

// People & roles (admins): who owns each channel, everyone's role and sign-in link, and adding or changing people.
// The server enforces every guard (yourself, the last admin, admins set in the server settings); this page just
// doesn't offer what would be refused. On the Mac there's only you, so it offers previews instead.
const list = (value) => (Array.isArray(value) ? value : []);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const runWith = (action, fn) => (action ? action(fn, '', true) : Promise.resolve().then(fn));
const expired = (link) => Boolean(link?.expiresAt) && new Date(link.expiresAt).getTime() < Date.now();

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

function PersonSheet({ team, member, preset, viewer, web, action, api, onClose, onSaved }) {
  const editing = Boolean(member?.id);
  const channels = list(team?.channels);
  const titleId = useId();
  const nameRef = useRef(null);
  const [name, setName] = useState(member?.name || '');
  const [email, setEmail] = useState(member?.email || '');
  const [role, setRole] = useState(member?.role || preset?.role || 'editor');
  const [channelId, setChannelId] = useState(member?.channelId || preset?.channelId || '');
  const [problem, setProblem] = useState('');
  const [saving, setSaving] = useState(false);
  const self = editing && member.id === viewer.id;
  const admins = list(team?.members).filter((row) => row.role === 'admin' && !row.disabled);
  const lastAdmin = editing && member.role === 'admin' && !member.disabled && admins.length <= 1;
  const sso = Boolean(team?.signIn?.sso);
  const emailChanged = editing && sso && email.trim().toLowerCase() !== String(member.email || '').toLowerCase();
  async function save(event) {
    event.preventDefault();
    const clean = { name: name.trim(), email: email.trim(), role, channelId: role === 'channel' ? channelId : null };
    if (!clean.name) { setProblem('Add their name.'); nameRef.current?.focus(); return; }
    if (clean.name.length > 120) { setProblem('Keep the name under 120 characters.'); return; }
    if ((web || clean.email) && !EMAIL.test(clean.email)) { setProblem('That doesn’t look like an email address.'); return; }
    if (role === 'channel' && !clean.channelId) { setProblem('Choose their channel.'); return; }
    setSaving(true); setProblem('');
    try {
      const result = await runWith(action, () => api.saveMember({ ...(editing ? { id: member.id } : {}), ...clean, disabled: Boolean(member?.disabled) }));
      setSaving(false);
      if (result === null) { setProblem('That couldn’t be saved. Try again.'); return; }
      onSaved(result?.member || { ...member, ...clean }, !editing);
    } catch (failure) { setSaving(false); setProblem(failure?.message || 'That couldn’t be saved. Try again.'); }
  }
  return <Dialog labelledBy={titleId} onClose={onClose} closeDisabled={saving} initialFocus={nameRef} className="people-sheet">
    <form className="people-sheet-form" noValidate onSubmit={save}>
      <header className="studio-dialog-head"><div><small>People & roles</small><h2 id={titleId}>{editing ? `Edit ${member.name}` : 'Add a person'}</h2></div><DialogClose onClose={onClose} disabled={saving} /></header>
      <div className="studio-dialog-body">
        <label className="studio-field"><span>Name</span><input ref={nameRef} value={name} maxLength={120} autoComplete="off" onChange={(event) => { setName(event.target.value); setProblem(''); }} /></label>
        <label className="studio-field"><span>Work email{web ? '' : <em> (optional)</em>}</span><input type="email" inputMode="email" autoComplete="off" value={email} onChange={(event) => { setEmail(event.target.value); setProblem(''); }} /></label>
        {emailChanged && <p className="channel-note">They’ll sign in with this address from now on.</p>}
        <fieldset className="people-roles">
          <legend>Role</legend>
          {self && <p className="studio-hint">You can’t change your own role. Ask another admin.</p>}
          {!self && lastAdmin && <p className="studio-hint">The studio needs at least one admin, so this person stays an admin.</p>}
          <div className="people-role-cards" role="radiogroup" aria-label="Role">{ROLE_IDS.map((id) => <label key={id} className={`people-role-card role-${id}${role === id ? ' checked' : ''}`}>
            <input type="radio" name={`${titleId}-role`} value={id} checked={role === id} disabled={(self || lastAdmin) && id !== member?.role} onChange={() => { setRole(id); setProblem(''); }} />
            <span><strong>{roleLabel(id)}</strong><small>{ROLE_DESCRIPTIONS[id]}</small></span>
          </label>)}</div>
        </fieldset>
        {role === 'channel' && <label className="studio-field"><span>Channel</span><select value={channelId} onChange={(event) => { setChannelId(event.target.value); setProblem(''); }}><option value="">Choose a channel</option>{channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></label>}
        {problem && <p className="studio-error" role="alert">{problem}</p>}
      </div>
      <footer className="studio-dialog-foot">
        <button type="button" className="studio-quiet" disabled={saving} onClick={onClose}>Cancel</button>
        <button type="submit" className="studio-primary" {...writeProps(viewer, saving)}>{saving ? <LoaderCircle className="spin" size={15} aria-hidden="true" /> : null}{saving ? 'Saving…' : editing ? 'Save changes' : 'Add person'}</button>
      </footer>
    </form>
  </Dialog>;
}

function LinkPanel({ member, panel, studioName, onDone }) {
  const [copied, setCopied] = useState('');
  const message = linkMessage({ url: panel.url, expiresAt: panel.expiresAt, studioName });
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, [panel.url]);
  async function copy(kind, text) { if (await copyText(text)) { setCopied(kind); setTimeout(() => setCopied(''), 1800); } }
  return <div className="people-link-panel" role="region" aria-label={`Sign-in link for ${member.name}`}>
    <h3 ref={ref} tabIndex={-1}>Send {firstName(member.name) || 'them'} this link</h3>
    <div className="people-link-row"><input readOnly value={panel.url} aria-label={`Sign-in link for ${member.name}`} onFocus={(event) => event.target.select()} /><button type="button" className="studio-primary small" onClick={() => copy('url', panel.url)}>{copied === 'url' ? <Check size={14} aria-hidden="true" /> : <ClipboardCopy size={14} aria-hidden="true" />}{copied === 'url' ? 'Copied' : 'Copy link'}</button></div>
    <p className="people-link-message">{message}</p>
    <div className="people-link-actions"><button type="button" className="studio-quiet small" onClick={() => copy('message', message)}>{copied === 'message' ? <Check size={14} aria-hidden="true" /> : <ClipboardCopy size={14} aria-hidden="true" />}{copied === 'message' ? 'Copied' : 'Copy message'}</button><button type="button" className="studio-link" onClick={onDone}>Done</button></div>
    <p className="studio-hint">Only {firstName(member.name) || 'they'} should use it. Making a new link turns this one off.</p>
  </div>;
}

function MacPeople({ channels, onPreview }) {
  return <div className="studio-screen studio-page people-page">
    <div className="studio-page-head"><div><h1>People & roles</h1><p>Who can use the studio, and what each role sees.</p></div></div>
    <section className="people-mac-note" aria-labelledby="people-mac-title">
      <span className="people-mac-icon" aria-hidden="true"><Monitor size={22} /></span>
      <div><h2 id="people-mac-title">Only you use the studio on this Mac</h2><p>People sign in to the browser version of the studio. On this Mac you’re the only user and always an admin. To check what someone else sees, use View as in the sidebar.</p></div>
    </section>
    <section className="people-section" aria-labelledby="people-preview-title">
      <div className="people-section-head"><h2 id="people-preview-title" className="studio-section-title">Preview a role</h2>{onPreview && <button type="button" className="studio-quiet small" onClick={() => onPreview(null)}><Eye size={15} aria-hidden="true" />Preview as an editor</button>}</div>
      <ul className="people-coverage">{channels.map((channel) => <li key={channel.id}><span className="people-coverage-name"><strong>{channel.name}</strong><small>Channel owner view</small></span>{onPreview && <button type="button" className="studio-quiet small" aria-label={`Preview what ${channel.name}’s owner sees`} onClick={() => onPreview(channel.id)}><Eye size={15} aria-hidden="true" />Preview</button>}</li>)}</ul>
    </section>
  </div>;
}

export function PeopleView({ api, web = false, busy = false, action, viewer = {}, onPreview, studioName }) {
  const [team, setTeam] = useState(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [sheet, setSheet] = useState(null);
  const [panel, setPanel] = useState(null);
  const [added, setAdded] = useState(null);
  const [toast, showToast] = useToast();
  const available = typeof api?.getTeam === 'function';
  useEffect(() => {
    if (!available) return undefined;
    let cancelled = false; setError('');
    Promise.resolve().then(() => api.getTeam()).then((result) => { if (!cancelled) setTeam(result || { members: [], channels: [], signIn: {} }); }, (failure) => { if (!cancelled) setError(failure?.message || 'People couldn’t be loaded. Try again.'); });
    return () => { cancelled = true; };
  }, [attempt]);
  const reload = () => setAttempt((value) => value + 1);
  const channels = list(team?.channels).length ? list(team.channels) : list(viewer.channels);
  if (!web) return <MacPeople channels={channels} onPreview={onPreview} />;

  const members = list(team?.members);
  const signIn = team?.signIn || {};
  const links = Boolean(signIn.links) && Boolean(api.createSignInLink);
  const name = studioName || (channels.some((channel) => /^Semrush\b/.test(channel.name || '')) ? 'Semrush research studio' : 'research studio');
  const enabledAdmins = members.filter((row) => row.role === 'admin' && !row.disabled);
  const channelName = (id) => channels.find((channel) => channel.id === id)?.name || '';
  const preview = Boolean(viewer.preview);
  const editable = typeof api.saveMember === 'function';

  async function write(fn, done) {
    try { const result = await runWith(action, fn); if (result !== null) { done?.(result); reload(); } return result; }
    catch (failure) { showToast(failure?.message || 'That didn’t work. Try again.', { tone: 'error' }); return null; }
  }
  async function makeLink(member) {
    if (member.link && !expired(member.link) && !window.confirm(`${firstName(member.name) || member.name}’s current link will stop working, and anyone signed in with it is signed out.`)) return;
    await write(() => api.createSignInLink({ id: member.id }), (result) => { if (result?.url) { setPanel({ memberId: member.id, url: result.url, expiresAt: result.expiresAt || null }); setAdded(null); } });
  }
  async function turnOffLink(member) {
    if (!window.confirm(`Turn off ${firstName(member.name) || member.name}’s sign-in link? Anyone signed in with it is signed out.`)) return;
    await write(() => api.revokeSignInLink({ id: member.id }), () => { if (panel?.memberId === member.id) setPanel(null); showToast(`${member.name}’s link is off.`); });
  }
  async function setDisabled(member, disabled) {
    if (disabled && !window.confirm(`Disable ${member.name}? They can’t use the studio until you enable them again. Their answers and history stay.`)) return;
    await write(() => api.saveMember({ id: member.id, name: member.name, email: member.email, role: member.role, channelId: member.channelId || null, disabled }), () => showToast(disabled ? `${member.name} is disabled.` : `${member.name} can use the studio again.`));
  }
  async function remove(member) {
    if (!window.confirm(`Remove ${member.name} from the studio? Their answers and history stay, and their sign-in link stops working. To stop access for a while instead, disable them.`)) return;
    await write(() => api.removeMember({ id: member.id }), () => { if (panel?.memberId === member.id) setPanel(null); showToast(`${member.name} was removed.`); });
  }
  function saved(member, isNew) {
    setSheet(null); reload();
    if (isNew) { setAdded(member); showToast(`${member.name} was added.`); }
    else showToast('Changes saved.');
  }
  const assign = (channelId) => setSheet({ preset: { role: 'channel', channelId } });

  if (!available) return <div className="studio-screen studio-page people-page"><div className="studio-page-head"><div><h1>People & roles</h1></div></div><div className="studio-empty"><p>People and roles aren’t available in this version of the studio.</p></div></div>;
  const firstRun = Boolean(team) && members.length <= 1;
  return <div className="studio-screen studio-page people-page">
    <div className="studio-page-head">
      <div><h1>People & roles</h1><p>Who can use the studio and what they can do. {signIn.sso ? 'People sign in with their company account.' : links ? 'Each person signs in with their own link.' : ''}</p></div>
      {team && !firstRun && editable && <div className="studio-head-actions"><button type="button" className="studio-primary" {...writeProps(viewer, busy)} onClick={() => setSheet({})}><UserPlus size={16} aria-hidden="true" />Add a person</button></div>}
    </div>
    {error && <div className="studio-empty" role="alert"><p>{error}</p><button type="button" className="studio-quiet small" onClick={reload}><RefreshCw size={14} aria-hidden="true" />Try again</button></div>}
    {!team && !error && <div className="studio-skeleton" role="status" aria-label="Loading people"><span /><span /><span /><span /></div>}

    {team && firstRun && <section className="people-first-run" aria-labelledby="people-first-title">
      <span className="people-mac-icon" aria-hidden="true"><Users size={22} /></span>
      <div><h2 id="people-first-title">Bring your team in</h2>
        <ol className="people-steps"><li><span>1</span>Add a person</li><li><span>2</span>Choose their role and channel</li><li><span>3</span>{links ? 'Send their sign-in link' : 'They sign in with their company account'}</li></ol></div>
      {editable && <button type="button" className="studio-primary" {...writeProps(viewer, busy)} onClick={() => setSheet({})}><UserPlus size={16} aria-hidden="true" />Add a person</button>}
    </section>}

    {team && <section className="people-section" aria-labelledby="people-channels-title">
      <div className="people-section-head"><h2 id="people-channels-title" className="studio-section-title">Channels</h2><small className="people-section-note">{channels.filter((channel) => list(channel.owners).length).length} of {plural(channels.length, 'channel')} {channels.length === 1 ? 'has' : 'have'} an owner</small></div>
      <ul className="people-coverage">{channels.map((channel) => {
        const owners = list(channel.owners);
        return <li key={channel.id} className={owners.length ? '' : 'is-open'}>
          <span className="people-coverage-name"><strong>{channel.name}</strong>{owners.length ? <small>{owners.map((owner) => owner.name).join(', ')}</small> : <small>No owner yet</small>}</span>
          <span className="people-coverage-actions">
            {!owners.length && editable && <button type="button" className="studio-link" aria-label={`Assign an owner to ${channel.name}`} {...writeProps(viewer)} onClick={() => assign(channel.id)}><UserPlus size={14} aria-hidden="true" />Assign</button>}
            {onPreview && <button type="button" className="studio-quiet small" aria-label={`Preview what ${channel.name}’s owner sees`} onClick={() => onPreview(channel.id)}><Eye size={14} aria-hidden="true" />Preview</button>}
          </span>
        </li>;
      })}</ul>
    </section>}

    {team && members.length > 0 && <section className="people-section" aria-labelledby="people-list-title">
      <div className="people-section-head"><h2 id="people-list-title" className="studio-section-title">People <span className="studio-count">{members.length}</span></h2>{onPreview && <button type="button" className="studio-quiet small" onClick={() => onPreview(null)}><Eye size={14} aria-hidden="true" />Preview as an editor</button>}</div>
      {added && links && !panel && <div className="people-added" role="status"><Check size={16} aria-hidden="true" /><span>{added.name} is added. Make their sign-in link to send it.</span><button type="button" className="studio-primary small" {...writeProps(viewer)} onClick={() => makeLink(members.find((row) => row.id === added.id) || added)}><Link2 size={14} aria-hidden="true" />Make sign-in link</button></div>}
      <ul className="people-list">{members.map((member) => {
        const self = member.id === viewer.id;
        const last = member.role === 'admin' && !member.disabled && enabledAdmins.length <= 1;
        const guarded = self || last || member.serverAdmin;
        const status = links ? linkStatus(member, signIn) : '';
        const items = member.serverAdmin || !editable ? [] : [
          { label: 'Edit', icon: PenLine, onSelect: () => setSheet({ member }) },
          links && !member.disabled && { label: 'Make a new sign-in link', icon: Link2, onSelect: () => makeLink(member) },
          links && member.link && api.revokeSignInLink && { label: 'Turn off link', icon: Unlink, onSelect: () => turnOffLink(member) },
          !guarded && (member.disabled ? { label: 'Enable', icon: CirclePlay, onSelect: () => setDisabled(member, false) } : { label: 'Disable', icon: CirclePause, title: 'They can’t sign in until you enable them again. Their answers stay.', onSelect: () => setDisabled(member, true) }),
          !guarded && api.removeMember && { label: 'Remove', icon: Trash2, danger: true, onSelect: () => remove(member) },
        ];
        return <li key={member.id} className={`people-row${member.disabled ? ' is-disabled' : ''}`}>
          <div className="people-row-main">
            <span className={`people-avatar role-${member.role}`} aria-hidden="true">{initials(member.name || member.email)}</span>
            <span className="people-who"><strong>{member.name}{self ? ' (you)' : ''}</strong><small>{member.email || 'No email'}</small></span>
            <span className="people-role"><span className={`studio-chip role-${member.role}`}>{roleLabel(member.role)}</span>{member.role === 'channel' && <span className="people-channel">{channelName(member.channelId) || 'No channel'}</span>}{member.disabled && <span className="studio-chip paused">Disabled</span>}</span>
            <span className="people-status">{member.lastSeenAt ? <small>Last seen {formatDay(member.lastSeenAt)}</small> : null}{status && <small>{status}</small>}</span>
            <span className="people-row-actions">{member.serverAdmin ? <span className="people-server">Set by the server</span> : <MoreMenu label={`Actions for ${member.name}`} disabled={preview} title={preview ? 'Buttons that change things are off in a preview.' : undefined} items={items} />}</span>
          </div>
          {panel?.memberId === member.id && <LinkPanel member={member} panel={panel} studioName={name} onDone={() => setPanel(null)} />}
        </li>;
      })}</ul>
    </section>}

    {sheet && <PersonSheet team={team} member={sheet.member} preset={sheet.preset} viewer={viewer} web={web} action={action} api={api} onClose={() => setSheet(null)} onSaved={saved} />}
    {toast}
  </div>;
}
