import React, { useId, useState } from 'react';
import { Dialog, DialogClose } from './role-screens.jsx';

const list = (value) => Array.isArray(value) ? value : [];

// Reuse the account's sign-in identity; this changes only membership in the selected workspace.
export function WorkspaceMemberDialog({ viewer = {}, team = {}, api, workspaceName = 'this workspace', onClose, onSaved }) {
  const titleId = useId();
  const fieldId = useId();
  const [memberId, setMemberId] = useState('');
  const [role, setRole] = useState('editor');
  const [channelId, setChannelId] = useState('');
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState('');
  if (!viewer.isSuperAdmin || viewer.preview) return null;
  const present = new Set(list(team.members).map((member) => member.id));
  const people = list(team.directory).filter((member) => !present.has(member.id));
  const roles = list(team.access?.roles);
  const selectedRole = roles.find((entry) => entry.id === role);
  const needsChannel = selectedRole?.base === 'channel';
  const ready = people.some((person) => person.id === memberId) && Boolean(selectedRole) && (!needsChannel || Boolean(channelId));
  async function save(event) {
    event.preventDefault();
    if (!ready || saving) return;
    setSaving(true); setProblem('');
    try {
      const result = await api.saveWorkspaceMembership({ memberId, workspaceId: viewer.workspaceId, role, channelId: needsChannel ? channelId : null });
      onSaved?.(result);
    } catch (error) { setProblem(error?.message || 'That person couldn’t be added. Try again.'); }
    finally { setSaving(false); }
  }
  return <Dialog labelledBy={titleId} onClose={saving ? undefined : onClose} className="people-sheet">
    <form className="people-sheet-form" onSubmit={save}>
      <header className="studio-dialog-head"><div><h2 id={titleId}>Add an existing person</h2><p className="studio-dialog-meta">Give someone access to {workspaceName} using their existing account. Their role in other workspaces stays the same.</p></div><DialogClose onClose={onClose} disabled={saving} /></header>
      <div className="studio-dialog-body">
        {problem && <p className="studio-error" role="alert">{problem}</p>}
        {people.length ? <>
          <label className="studio-field" htmlFor={`${fieldId}-person`}>Existing person<select id={`${fieldId}-person`} value={memberId} disabled={saving} onChange={(event) => setMemberId(event.target.value)} required><option value="">Choose a person</option>{people.map((person) => <option key={person.id} value={person.id}>{person.name}{person.email ? ` · ${person.email}` : ''}</option>)}</select></label>
          <label className="studio-field" htmlFor={`${fieldId}-role`}>Role in {workspaceName}<select id={`${fieldId}-role`} value={role} disabled={saving} onChange={(event) => { setRole(event.target.value); setChannelId(''); }}>{roles.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}</select></label>
          {needsChannel && <label className="studio-field" htmlFor={`${fieldId}-channel`}>Channel<select id={`${fieldId}-channel`} value={channelId} disabled={saving} onChange={(event) => setChannelId(event.target.value)} required><option value="">Choose a channel</option>{list(team.channels).map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></label>}
          <p className="studio-hint">They can use their existing sign-in. No new invitation is sent.</p>
        </> : <p className="studio-hint">Every existing account already belongs to this workspace. Invite a new person from People & access.</p>}
      </div>
      <footer className="studio-dialog-foot"><button type="button" className="studio-quiet" onClick={onClose} disabled={saving}>Cancel</button><button type="submit" className="studio-primary" disabled={!ready || saving}>{saving ? 'Adding…' : 'Add to workspace'}</button></footer>
    </form>
  </Dialog>;
}
