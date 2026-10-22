import React, { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, Eye, FolderOpen, Monitor, RefreshCw, UserPlus, Users } from 'lucide-react';
import { Dialog, DialogClose, useToast } from './role-screens.jsx';
import { useConfirm } from './confirm-dialog.jsx';
import { useUnsavedGuard } from './asset-editor.jsx';
import { CoverageStrip, PeopleTable } from './people-table.jsx';
import { PersonSheet, RetryNote } from './person-sheet.jsx';
import { InviteDialog } from './invite-dialog.jsx';
import { RolesMatrix } from './roles-matrix.jsx';
import { AccessLog } from './access-log.jsx';
import { firstName, writeProps } from './viewer.js';
import { place } from './platform.js';
import './people-view.css';

export { linkMessage, linkStatus } from './person-sheet.jsx';

// People & access (admins): three tabs. People is who's in the studio (channel coverage, a searchable table, a sheet per
// person, invites); Roles is what each role can do (a matrix saved in one go); Access log is who changed what. The
// server enforces every rule (yourself, the last admin, admins set in the server settings, locked capabilities); this
// page just doesn't offer what would be refused. On the Mac there's only you, so People offers previews instead, while
// Roles and the access log still work and change what View as shows.
const list = (value) => (Array.isArray(value) ? value : []);
const runWith = (action, fn) => (action ? action(fn, '', true) : Promise.resolve().then(fn));
const TAB_KEY = 'studio.people.tab';
const TABS = [['people', 'People'], ['roles', 'Roles'], ['log', 'Access log']];
function readTab() { try { const value = window.localStorage.getItem(TAB_KEY); return TABS.some(([id]) => id === value) ? value : 'people'; } catch { return 'people'; } }
function saveTab(value) { try { window.localStorage.setItem(TAB_KEY, value); } catch { /* a blocked store just forgets the tab */ } }

// A greyed action that still explains itself. aria-disabled (not disabled) keeps it focusable, so the note shows on
// hover and on keyboard focus, is read out through aria-describedby, and Escape hides it until the pointer or focus leaves.
function ExplainedButton({ icon, label, note }) {
  const noteId = useId(); const [dismissed, setDismissed] = useState(false);
  return <span className={`people-hint${dismissed ? ' is-dismissed' : ''}`} onMouseLeave={() => setDismissed(false)} onBlur={() => setDismissed(false)}
    onKeyDown={(event) => { if (event.key === 'Escape') setDismissed(true); }}>
    <button type="button" className="studio-primary is-unavailable" aria-disabled="true" aria-describedby={noteId} onClick={(event) => event.preventDefault()}>{icon}{label}</button>
    <span role="tooltip" id={noteId} className="people-hint-tip">{note}</span>
  </span>;
}

// On the Mac (or PC) app nobody else can sign in, so inviting happens in the browser studio. This says how to get there.
function MacPeople({ channels, onPreview, onOpenDataFolder }) {
  const here = place(); const stepsId = useId(); const [open, setOpen] = useState(false);
  return <>
    <section className="people-mac-note" aria-labelledby="people-mac-title">
      <span className="people-mac-icon" aria-hidden="true"><Monitor size={22} /></span>
      <div><h2 id="people-mac-title">Only you use the studio on {here}</h2><p>This app is a studio for you alone: its work stays on {here}. Your team shares one studio in the browser version, and that’s where you invite people and choose their roles. To check what someone else would see, use View as in the sidebar.</p>
        <button type="button" className="studio-quiet small people-setup-toggle" aria-expanded={open} aria-controls={stepsId} onClick={() => setOpen((value) => !value)}>How to set up the browser studio<ChevronDown size={15} aria-hidden="true" /></button>
        {open && <div id={stepsId} className="people-setup">
          <ol className="people-steps is-stacked">
            <li><span>1</span>Your dev or IT team hosts the browser studio on a company server, behind company sign-in. The hosting guide comes with the studio’s code (docs/web-deploy.md).</li>
            <li><span>2</span>To keep your work, they copy this app’s data folder to the server while both are stopped. Saved keys stay locked to {here}, so save them again in Settings there.</li>
            <li><span>3</span>In the browser studio, open People & access and invite your team: choose each person’s role and, for channel owners, their channel.</li>
          </ol>
          {onOpenDataFolder && <button type="button" className="studio-quiet small" onClick={onOpenDataFolder}><FolderOpen size={15} aria-hidden="true" />Open data folder</button>}
        </div>}
      </div>
    </section>
    <section className="people-section" aria-labelledby="people-preview-title">
      <div className="people-section-head"><h2 id="people-preview-title" className="studio-section-title">Preview a role</h2>{onPreview && <button type="button" className="studio-quiet small" onClick={() => onPreview({ role: 'editor' })}><Eye size={15} aria-hidden="true" />Preview as an editor</button>}</div>
      <ul className="people-coverage">{channels.map((channel) => <li key={channel.id}><span className="people-coverage-name"><strong>{channel.name}</strong><small>Channel owner view</small></span>{onPreview && <button type="button" className="studio-quiet small" aria-label={`Preview what ${channel.name}’s owner sees`} onClick={() => onPreview({ role: 'channel', channelId: channel.id })}><Eye size={15} aria-hidden="true" />Preview</button>}</li>)}</ul>
    </section>
  </>;
}

// "Preview as…": any role (a channel role asks which channel) or one person, with their own access changes.
function PreviewDialog({ team, onPreview, onClose }) {
  const titleId = useId(); const firstRef = useRef(null);
  const roles = list(team?.access?.roles).filter((role) => role.base !== 'admin');
  const people = list(team?.members).filter((member) => member.base && member.base !== 'admin' && !member.disabled && (member.base !== 'channel' || member.channelId));
  const channels = list(team?.channels);
  const [kind, setKind] = useState('role');
  const [roleId, setRoleId] = useState(roles[0]?.id || '');
  const [channelId, setChannelId] = useState(channels[0]?.id || '');
  const [memberId, setMemberId] = useState(people[0]?.id || '');
  const role = roles.find((entry) => entry.id === roleId);
  const ready = kind === 'person' ? Boolean(memberId) : Boolean(role) && (role.base !== 'channel' || Boolean(channelId));
  function submit(event) {
    event.preventDefault(); if (!ready) return;
    onPreview(kind === 'person' ? { memberId } : role.base === 'channel' ? { role: role.id, channelId } : { role: role.id });
  }
  return <Dialog labelledBy={titleId} onClose={onClose} initialFocus={firstRef} className="people-sheet">
    <form className="people-sheet-form" onSubmit={submit}>
      <header className="studio-dialog-head"><div><small>Preview</small><h2 id={titleId}>Preview what someone sees</h2></div><DialogClose onClose={onClose} /></header>
      <div className="studio-dialog-body">
        <div className="studio-segment" role="radiogroup" aria-label="Preview">
          {[['role', 'A role'], ['person', 'A person']].map(([value, label]) => <label key={value} className={kind === value ? 'checked' : ''}><input ref={value === 'role' ? firstRef : undefined} type="radio" name={`${titleId}-kind`} value={value} checked={kind === value} disabled={value === 'person' && !people.length} onChange={() => setKind(value)} />{label}</label>)}
        </div>
        {kind === 'role' && <>
          <label className="studio-field"><span>Role</span><select value={roleId} onChange={(event) => setRoleId(event.target.value)}>{roles.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}</select></label>
          {role?.base === 'channel' && <label className="studio-field"><span>Channel</span><select value={channelId} onChange={(event) => setChannelId(event.target.value)}>{channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></label>}
        </>}
        {kind === 'person' && <label className="studio-field"><span>Person</span><select value={memberId} onChange={(event) => setMemberId(event.target.value)}>{people.map((member) => <option key={member.id} value={member.id}>{member.name} · {member.roleLabel}</option>)}</select></label>}
        <p className="studio-hint">A preview is read-only: buttons that change things are off until you go back to Admin.</p>
      </div>
      <footer className="studio-dialog-foot"><button type="button" className="studio-quiet" onClick={onClose}>Cancel</button><button type="submit" className="studio-primary" disabled={!ready}><Eye size={15} aria-hidden="true" />Preview</button></footer>
    </form>
  </Dialog>;
}

// onPreview(payload) starts View as with a setViewAs payload: { role, channelId? } (any role, custom roles included) or
// { memberId } (one person, with their own access changes). request, acted on once per key: { kind: 'invite', key,
// preset? } opens Invite (the sidebar's New › Person); { kind: 'person', key, memberId } opens that person's sheet (⌘K).
export function PeopleView({ api, web = false, busy = false, action, viewer = {}, onPreview, request = null, studioName }) {
  const [team, setTeam] = useState(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [tab, setTabState] = useState(readTab);
  const [sheet, setSheet] = useState(null); // { memberId, tab }
  const [invite, setInvite] = useState(null); // { preset }
  const [panel, setPanel] = useState(null); // { memberId, url, expiresAt }
  const [previewing, setPreviewing] = useState(false);
  const [toast, showToast] = useToast();
  const confirm = useConfirm();
  const tabsId = useId();
  const available = typeof api?.getTeam === 'function';
  useEffect(() => {
    if (!available) return undefined;
    let cancelled = false; setError('');
    Promise.resolve().then(() => api.getTeam()).then((result) => { if (!cancelled) setTeam(result || { members: [], channels: [], signIn: {} }); }, (failure) => { if (!cancelled) setError(failure?.message || 'People couldn’t be loaded. Try again.'); });
    return () => { cancelled = true; };
  }, [attempt]);
  const reload = () => setAttempt((value) => value + 1);
  // Leaving the Roles tab unmounts its unsaved draft, so ask first (RolesMatrix marks the guard while it has changes).
  // False when the person chose to stay.
  const guard = useUnsavedGuard();
  function setTab(value) {
    if (value !== tab && !guard.confirmLeave()) return false;
    setTabState(value); saveTab(value); return true;
  }
  const previewTo = typeof onPreview === 'function' ? onPreview : null;
  const preview = (payload) => { setPreviewing(false); previewTo?.(payload); };
  const canPreviewAny = Boolean(previewTo);

  const members = list(team?.members);
  const channels = list(team?.channels).length ? list(team.channels) : list(viewer.channels);
  const signIn = team?.signIn || {};
  const links = web && Boolean(signIn.links) && typeof api?.createSignInLink === 'function';
  const name = studioName || (channels.some((channel) => /^Semrush\b/.test(channel.name || '')) ? 'Semrush research studio' : 'research studio');
  const editable = typeof api?.saveMember === 'function';
  const canInvite = web && typeof api?.inviteMembers === 'function' && Boolean(team?.access);
  const firstRun = web && Boolean(team) && members.length <= 1;
  const sheetMember = sheet ? members.find((member) => member.id === sheet.memberId) : null;
  // A request from elsewhere opens once the team has loaded, once per key (App sends a new key on every pick, so this
  // also works when People is already open): New › Person opens Invite; ⌘K's "People: <name>" opens that person's sheet.
  // The sheet and Invite are overlays, so they open even when the person chooses to stay on an unsaved Roles tab.
  const handled = useRef('');
  useEffect(() => {
    if (!request?.key || !team || handled.current === String(request.key)) return;
    if (request.kind === 'invite') {
      handled.current = String(request.key);
      if (canInvite) { setTab('people'); setInvite({ preset: request.preset || {} }); }
      return;
    }
    if (request.kind === 'person' && request.memberId) {
      handled.current = String(request.key);
      if (members.some((member) => member.id === request.memberId)) { setTab('people'); setSheet({ memberId: request.memberId }); }
      else showToast('That person isn’t on the team anymore.');
    }
  }, [request?.key, Boolean(team), canInvite]); // eslint-disable-line react-hooks/exhaustive-deps

  async function write(fn, done) {
    try { const result = await runWith(action, fn); if (result !== null) { done?.(result); reload(); } return result; }
    catch (failure) { showToast(failure?.message || 'That didn’t work. Try again.', { tone: 'error' }); return null; }
  }
  const first = (member) => firstName(member.name) || member.name;
  // With email on, the link goes straight to the person and nobody here sees it; otherwise it's shown to copy and send.
  async function makeLink(member) {
    await write(() => api.createSignInLink({ id: member.id }), (result) => {
      if (result?.emailed) showToast(`Sign-in link emailed to ${result.to || member.email}.`);
      else if (result?.url) { setPanel({ memberId: member.id, url: result.url, expiresAt: result.expiresAt || null }); if (result.emailFailed) showToast('The email didn’t go out, so copy the link and send it yourself.', { tone: 'error' }); }
    });
  }
  async function turnOffLink(member) {
    if (!(await confirm({ title: `Sign ${first(member)} out everywhere?`, lines: [`Every browser ${first(member)} is signed in on is signed out, and an unused sign-in link stops working. They can sign in again the usual way.`], confirmLabel: 'Sign out everywhere', tone: 'danger' }))) return;
    await write(() => api.revokeSignInLink({ id: member.id }), () => { if (panel?.memberId === member.id) setPanel(null); showToast(`${member.name} is signed out everywhere.`); });
  }
  async function setDisabled(member, disabled) {
    if (disabled && !(await confirm({ title: `Disable ${member.name}?`, lines: ['They can’t use the studio until you enable them again. Their answers and history stay.'], confirmLabel: 'Disable', tone: 'danger' }))) return;
    await write(() => api.saveMember({ id: member.id, name: member.name, email: member.email, role: member.role, channelId: member.channelId || null, disabled }), () => showToast(disabled ? `${member.name} is disabled.` : `${member.name} can use the studio again.`));
  }
  async function remove(member) {
    if (!(await confirm({ title: `Remove ${member.name} from the studio?`, lines: ['Their answers and history stay, and they’re signed out everywhere. To stop access for a while instead, disable them.'], confirmLabel: 'Remove', tone: 'danger' }))) return;
    await write(() => api.removeMember({ id: member.id }), () => { if (panel?.memberId === member.id) setPanel(null); setSheet(null); showToast(`${member.name} was removed.`); });
  }
  function invited(result) {
    reload();
    const count = list(result?.members).length;
    if (count) showToast(`${count === 1 ? `${result.members[0].name} is` : `${count} people are`} in the studio.`);
  }
  // Role changes come back with the new policy; people's capabilities follow it, so the list is read again too.
  function rolesSaved(access) { if (access) setTeam((current) => (current ? { ...current, access } : current)); reload(); }

  const heading = <div className="studio-page-head">
    <div><h1>People & access</h1><p>Who can use the studio and what they can do. {web ? (signIn.sso ? 'People sign in with their company account.' : links ? 'Each person signs in with their own link.' : '') : `On ${place()}, roles and the access log change what View as shows.`}</p></div>
    {team && <div className="studio-head-actions">
      {canPreviewAny && <button type="button" className="studio-quiet" onClick={() => setPreviewing(true)}><Eye size={16} aria-hidden="true" />Preview as…</button>}
      {canInvite && !firstRun && <button type="button" className="studio-primary" {...writeProps(viewer, busy)} onClick={() => setInvite({ preset: {} })}><UserPlus size={16} aria-hidden="true" />Invite people</button>}
      {!web && <ExplainedButton icon={<UserPlus size={16} aria-hidden="true" />} label="Invite people" note={`People join through the browser version of the studio, where your team shares one studio. Invite them there once it’s set up; this app on ${place()} is for you alone.`} />}
    </div>}
  </div>;
  if (!available) return <div className="studio-screen studio-page people-page"><div className="studio-page-head"><div><h1>People & access</h1></div></div><div className="studio-empty"><p>People and roles aren’t available in this version of the studio.</p></div></div>;
  return <div className="studio-screen studio-page people-page">
    {heading}
    {error && <div className="studio-empty" role="alert"><p>{error}</p><button type="button" className="studio-quiet small" onClick={reload}><RefreshCw size={14} aria-hidden="true" />Try again</button></div>}
    {!team && !error && <div className="studio-skeleton" role="status" aria-label="Loading people"><span /><span /><span /><span /></div>}
    {team && <>
      <div className="people-tabs" role="tablist" aria-label="People & access">
        {TABS.map(([id, label], index) => <button key={id} type="button" role="tab" id={`${tabsId}-${id}`} aria-selected={tab === id} aria-controls={`${tabsId}-${id}-panel`} tabIndex={tab === id ? 0 : -1} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}
          onKeyDown={(event) => { const move = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : event.key === 'Home' ? -index : event.key === 'End' ? TABS.length - 1 - index : 0; if (!move) return; event.preventDefault(); const next = TABS[(index + move + TABS.length) % TABS.length][0]; if (setTab(next)) document.getElementById(`${tabsId}-${next}`)?.focus(); }}>
          {label}{id === 'people' && members.length > 0 ? <span className="studio-count">{members.length}</span> : null}
        </button>)}
      </div>
      <div role="tabpanel" id={`${tabsId}-${tab}-panel`} aria-labelledby={`${tabsId}-${tab}`} className="people-panel">
        {tab === 'people' && !web && <MacPeople channels={channels} onPreview={previewTo ? preview : null}
          onOpenDataFolder={typeof api?.openDataFolder === 'function' ? () => (action ? action(() => api.openDataFolder(), 'Data folder opened.') : api.openDataFolder()) : null} />}
        {tab === 'people' && web && firstRun && <section className="people-first-run" aria-labelledby="people-first-title">
          <span className="people-mac-icon" aria-hidden="true"><Users size={22} /></span>
          <div><h2 id="people-first-title">Bring your team in</h2>
            <ol className="people-steps"><li><span>1</span>Invite people</li><li><span>2</span>Choose their role and channel</li><li><span>3</span>{links ? 'Send their sign-in link' : 'They sign in with their company account'}</li></ol></div>
          {canInvite && <button type="button" className="studio-primary" {...writeProps(viewer, busy)} onClick={() => setInvite({ preset: {} })}><UserPlus size={16} aria-hidden="true" />Invite people</button>}
        </section>}
        {/* Before anyone is invited, the table is hidden, so show which channels still need an owner here. */}
        {tab === 'people' && web && !members.length && <CoverageStrip channels={channels} canAssign={canInvite} viewer={viewer} onAssign={(channelId) => setInvite({ preset: { role: 'channel', channelId } })} />}
        {tab === 'people' && web && members.length > 0 && <PeopleTable team={{ ...team, channels }} viewer={viewer} web={web} editable={editable} signIn={signIn} links={links} panel={panel} studioName={name}
          onInvite={canInvite ? (preset) => setInvite({ preset }) : null} onOpen={(member, nextTab) => setSheet({ memberId: member.id, tab: nextTab })}
          onPreview={canPreviewAny ? (member) => preview({ memberId: member.id }) : null} onMakeLink={makeLink} onTurnOffLink={turnOffLink} onSetDisabled={setDisabled} onRemove={typeof api.removeMember === 'function' ? remove : null} onDismissPanel={() => setPanel(null)} />}
        {tab === 'roles' && <RolesMatrix team={{ ...team, channels }} viewer={viewer} api={api} action={action} onPreview={previewTo ? preview : null} onSaved={rolesSaved} onReload={reload} showToast={showToast} />}
        {tab === 'log' && (team.access ? <AccessLog api={api} team={{ ...team, channels }} /> : <RetryNote message="The access log isn’t available yet." onRetry={reload} />)}
      </div>
    </>}
    {sheetMember && <PersonSheet key={sheetMember.id} team={{ ...team, channels }} member={sheetMember} initialTab={sheet.tab} viewer={viewer} web={web} api={api} action={action} studioName={name}
      onClose={() => setSheet(null)} onSaved={() => { setSheet(null); reload(); showToast('Changes saved.'); }} onLinkMade={() => reload()} onTurnOffLink={turnOffLink} />}
    {invite && <InviteDialog team={{ ...team, channels }} viewer={viewer} api={api} action={action} preset={invite.preset} studioName={name} onClose={() => setInvite(null)} onInvited={invited} />}
    {previewing && <PreviewDialog team={{ ...team, channels }} onPreview={preview} onClose={() => setPreviewing(false)} />}
    {toast}
  </div>;
}
