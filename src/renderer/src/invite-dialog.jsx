import React, { useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, ClipboardCopy, LoaderCircle, UserPlus, X } from 'lucide-react';
import { Dialog, DialogClose, copyText } from './role-screens.jsx';
import { AccessList, capabilityRules, linkMessage, roleOf, roleSummary } from './person-sheet.jsx';
import { plural, writeProps } from './viewer.js';

// Invite people: paste one or more work emails, choose their role (and channel for a channel role), optionally adjust
// what they can do, then one inviteMembers call adds everyone. The answer depends on how this studio signs in: with
// personal links each person gets one to copy and send; with company sign-in they just sign in. The Mac doesn't invite.
const list = (value) => (Array.isArray(value) ? value : []);
const EMAIL = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;
const runWith = (action, fn) => (action ? action(fn, '', true) : Promise.resolve().then(fn));
// "pat.lee@semrush.com" → "Pat Lee", the name the server gives an invite without one.
export const nameFromEmail = (email) => String(email || '').split('@')[0].split(/[._+-]+/).filter(Boolean).map((word) => word[0].toUpperCase() + word.slice(1)).join(' ');
// Pasted text → addresses. Commas, semicolons and new lines separate entries; "Pat Lee <pat@x.com>" from a mail client
// keeps just the email, and so does "mailto:". An entry with no email in it is kept word by word, so a mistyped
// address shows up (and is flagged) instead of vanishing.
const EMAIL_IN_TEXT = /[^\s<>(),;"']+@[^\s<>(),;"']+/g;
export function parseEmails(text) {
  return String(text || '').split(/[,;\n\r]+/).flatMap((entry) => {
    const found = entry.match(EMAIL_IN_TEXT);
    return found || entry.split(/\s+/);
  }).map((part) => part.replace(/^mailto:/i, '').trim().toLowerCase()).filter(Boolean);
}
// Each pasted address with what's wrong with it, if anything.
export function checkEmails(entries, members) {
  const taken = new Set(list(members).map((member) => String(member.email || '').toLowerCase()).filter(Boolean));
  const seen = new Set();
  return entries.map((entry) => {
    const problem = !EMAIL.test(entry.email) ? 'Not an email address' : seen.has(entry.email) ? 'Listed twice' : taken.has(entry.email) ? 'Already in the studio' : '';
    seen.add(entry.email);
    return { ...entry, problem };
  });
}

export function InviteDialog({ team, viewer = {}, api, action, preset = {}, studioName, origin = '', onClose, onInvited }) {
  const access = team?.access || null;
  const rules = useMemo(() => capabilityRules(access), [access]);
  const roles = list(access?.roles);
  const channels = list(team?.channels);
  const signIn = team?.signIn || {};
  const titleId = useId(); const pasteId = useId(); const hintId = useId();
  const pasteRef = useRef(null);
  const [draft, setDraft] = useState('');
  const [entries, setEntries] = useState([]);
  const [role, setRole] = useState(preset.role || (roles.some((entry) => entry.id === 'editor') ? 'editor' : roles[0]?.id || 'editor'));
  const [channelId, setChannelId] = useState(preset.channelId || '');
  const [adjust, setAdjust] = useState(false);
  const [grants, setGrants] = useState([]);
  const [denies, setDenies] = useState([]);
  const [notes, setNotes] = useState({});
  const [problem, setProblem] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState('');
  const roleDef = roleOf(access, role);
  const base = roleDef?.base || 'editor';
  const checked = checkEmails(entries, team?.members);
  const ready = checked.filter((entry) => !entry.problem);

  // Pasted or typed addresses become rows once a separator, Enter or leaving the field ends them.
  function take(text = draft) {
    const emails = parseEmails(text);
    if (!emails.length) { setDraft(''); return; }
    setEntries((current) => [...current, ...emails.map((email) => ({ key: `${email}-${Math.random().toString(36).slice(2, 8)}`, email, name: '' }))].slice(0, 50));
    setDraft(''); setProblem('');
  }
  function chooseRole(id) { setRole(id); setGrants([]); setDenies([]); setNotes({}); setProblem(''); }
  async function send(event) {
    event.preventDefault();
    const pending = draft.trim() ? [...entries, ...parseEmails(draft).map((email) => ({ key: email, email, name: '' }))] : entries;
    if (draft.trim()) take();
    const people = checkEmails(pending, team?.members).filter((entry) => !entry.problem);
    if (!people.length) { setProblem(pending.length ? 'None of these can be invited. Check the addresses marked below.' : 'Paste at least one work email.'); pasteRef.current?.focus(); return; }
    if (base === 'channel' && !channelId) { setProblem('Choose the channel they own.'); return; }
    setSending(true); setProblem('');
    try {
      const answer = await runWith(action, () => api.inviteMembers({ people: people.map((entry) => ({ email: entry.email, ...(entry.name.trim() ? { name: entry.name.trim() } : {}) })), role, ...(base === 'channel' ? { channelId } : {}), ...(adjust && (grants.length || denies.length) ? { grants, denies } : {}) }));
      setSending(false);
      if (answer === null) { setProblem('Nobody was invited. Try again.'); return; }
      setResult(answer || { members: [], links: [], skipped: [] });
      onInvited?.(answer);
    } catch (failure) { setSending(false); setProblem(failure?.message || 'Nobody was invited. Try again.'); }
  }
  async function copy(key, text) { if (await copyText(text)) { setCopied(key); setTimeout(() => setCopied(''), 1800); } }

  if (result) {
    const members = list(result.members); const links = list(result.links); const skipped = list(result.skipped);
    const byId = new Map(members.map((member) => [member.id, member]));
    const linkRows = links.map((link) => ({ ...link, member: byId.get(link.id) })).filter((row) => row.member);
    const sso = Boolean(result.signIn?.sso ?? signIn.sso);
    const where = origin || (typeof window !== 'undefined' ? window.location.origin : '');
    const ssoMessage = `You’re invited to the ${studioName || 'research studio'}. Sign in at ${where} with your company account.`;
    const all = linkRows.map((row) => `${row.member.name}: ${row.url}`).join('\n');
    return <Dialog labelledBy={titleId} onClose={onClose} className="people-sheet people-invite" wide>
      <header className="studio-dialog-head"><div><small>People & access</small><h2 id={titleId}>{members.length ? `${plural(members.length, 'person', 'people')} invited` : 'Nobody was invited'}</h2></div><DialogClose onClose={onClose} /></header>
      <div className="studio-dialog-body">
        {members.length > 0 && linkRows.length > 0 && <>
          <p className="studio-hint">Send each person their own link. Only they should use it.</p>
          <ul className="people-invite-links">{linkRows.map((row) => <li key={row.id}>
            <span><strong>{row.member.name}</strong><small>{row.member.email}</small></span>
            <span className="people-invite-actions">
              <button type="button" className="studio-quiet small" aria-label={`Copy ${row.member.name}’s link`} onClick={() => copy(`link-${row.id}`, row.url)}>{copied === `link-${row.id}` ? <Check size={14} aria-hidden="true" /> : <ClipboardCopy size={14} aria-hidden="true" />}{copied === `link-${row.id}` ? 'Copied' : 'Copy link'}</button>
              <button type="button" className="studio-quiet small" aria-label={`Copy the message for ${row.member.name}`} onClick={() => copy(`message-${row.id}`, linkMessage({ url: row.url, expiresAt: row.expiresAt, studioName }))}>{copied === `message-${row.id}` ? <Check size={14} aria-hidden="true" /> : <ClipboardCopy size={14} aria-hidden="true" />}{copied === `message-${row.id}` ? 'Copied' : 'Copy message'}</button>
            </span>
          </li>)}</ul>
          {linkRows.length > 1 && <button type="button" className="studio-quiet small" onClick={() => copy('all', all)}>{copied === 'all' ? <Check size={14} aria-hidden="true" /> : <ClipboardCopy size={14} aria-hidden="true" />}{copied === 'all' ? 'Copied' : 'Copy all links'}</button>}
        </>}
        {members.length > 0 && !linkRows.length && (sso
          ? <div className="people-invite-sso"><p>They can sign in at <strong>{where}</strong> with their company account.</p><button type="button" className="studio-quiet small" onClick={() => copy('sso', ssoMessage)}>{copied === 'sso' ? <Check size={14} aria-hidden="true" /> : <ClipboardCopy size={14} aria-hidden="true" />}{copied === 'sso' ? 'Copied' : 'Copy invite message'}</button></div>
          : <p className="studio-hint">They’re in the studio. Make each person’s sign-in link from their row when you’re ready to send it.</p>)}
        {skipped.length > 0 && <section className="people-invite-skipped" aria-label="Not invited"><h3>Not invited</h3><ul>{skipped.map((row, index) => <li key={`${row.email}-${index}`}><span>{row.email || 'A blank line'}</span><small>{row.reason}</small></li>)}</ul></section>}
      </div>
      <footer className="studio-dialog-foot"><button type="button" className="studio-primary" onClick={onClose}>Done</button></footer>
    </Dialog>;
  }

  return <Dialog labelledBy={titleId} onClose={onClose} closeDisabled={sending} initialFocus={pasteRef} className="people-sheet people-invite" wide>
    <form className="people-sheet-form" noValidate onSubmit={send}>
      <header className="studio-dialog-head"><div><small>People & access</small><h2 id={titleId}>Invite people</h2></div><DialogClose onClose={onClose} disabled={sending} /></header>
      <div className="studio-dialog-body">
        <label className="studio-field"><span>Work emails</span>
          <textarea id={pasteId} ref={pasteRef} className="people-invite-paste" rows={2} value={draft} placeholder="pat@company.com, sam@company.com" aria-describedby={hintId}
            onChange={(event) => { const value = event.target.value; if (/[\s,;]$/.test(value) && value.trim()) take(value); else setDraft(value); }}
            onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); take(); } }}
            onPaste={(event) => { const text = event.clipboardData?.getData('text') || ''; if (/[\s,;]/.test(text.trim())) { event.preventDefault(); take(`${draft} ${text}`); } }}
            onBlur={() => take()} />
        </label>
        <p id={hintId} className="studio-hint">Paste a list or type one at a time. Up to 50 people.</p>
        {checked.length > 0 && <ul className="people-invite-list" aria-label="People to invite">{checked.map((entry) => <li key={entry.key} className={entry.problem ? 'is-invalid' : ''}>
          <span className="people-invite-email"><strong>{entry.email}</strong>{entry.problem && <small>{entry.problem}</small>}</span>
          {!entry.problem && <input aria-label={`Name for ${entry.email} (optional)`} placeholder={nameFromEmail(entry.email) || 'Name'} value={entry.name} maxLength={120} onChange={(event) => setEntries((current) => current.map((row) => (row.key === entry.key ? { ...row, name: event.target.value } : row)))} />}
          <button type="button" className="studio-icon-button" aria-label={`Remove ${entry.email}`} onClick={() => setEntries((current) => current.filter((row) => row.key !== entry.key))}><X size={15} aria-hidden="true" /></button>
        </li>)}</ul>}
        <fieldset className="people-roles">
          <legend>Role</legend>
          <div className="people-role-cards" role="radiogroup" aria-label="Role">{roles.map((entry) => <label key={entry.id} className={`people-role-card role-${entry.base}${role === entry.id ? ' checked' : ''}`}>
            <input type="radio" name={`${titleId}-role`} value={entry.id} checked={role === entry.id} onChange={() => chooseRole(entry.id)} />
            <span><strong>{entry.label}{!entry.builtIn && <em className="people-custom-tag">Custom</em>}</strong><small>{entry.description}</small><small className="people-role-summary">{roleSummary(entry, rules)}</small></span>
          </label>)}</div>
        </fieldset>
        {base === 'channel' && <label className="studio-field"><span>Channel</span><select value={channelId} onChange={(event) => { setChannelId(event.target.value); setProblem(''); }}><option value="">Choose a channel</option>{channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></label>}
        {base !== 'admin' && <div className="people-invite-adjust">
          <button type="button" className="studio-link" aria-expanded={adjust} onClick={() => setAdjust((value) => !value)}><ChevronDown size={15} aria-hidden="true" className={adjust ? 'is-open' : ''} />Adjust access</button>
          {adjust && <AccessList access={access} base={base} roleCaps={roleDef?.capabilities} roleName={roleDef?.label || 'chosen'} grants={grants} denies={denies} notes={notes} onChange={(next) => { setGrants(next.grants); setDenies(next.denies); setNotes(next.note ? { [next.id]: next.note } : {}); }} />}
        </div>}
        {!signIn.links && !signIn.sso && <p className="studio-hint">This studio doesn’t use sign-in links, so nobody is sent one.</p>}
        {problem && <p className="studio-error" role="alert">{problem}</p>}
      </div>
      <footer className="studio-dialog-foot">
        <button type="button" className="studio-quiet" disabled={sending} onClick={onClose}>Cancel</button>
        <button type="submit" className="studio-primary" {...writeProps(viewer, sending)}>{sending ? <LoaderCircle className="spin" size={15} aria-hidden="true" /> : <UserPlus size={16} aria-hidden="true" />}{sending ? 'Inviting…' : ready.length ? `Invite ${plural(ready.length, 'person', 'people')}` : 'Invite people'}</button>
      </footer>
    </form>
  </Dialog>;
}
