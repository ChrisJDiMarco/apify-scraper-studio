import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, Eye, Lock, Minus, PenLine, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { Dialog, DialogClose, MoreMenu, useNarrow } from './role-screens.jsx';
import { useConfirm } from './confirm-dialog.jsx';
import { availability, capabilityRules, withRequirements, withoutDependents } from './person-sheet.jsx';
import { plural, writeProps } from './viewer.js';
import './roles-matrix.css';

// The Roles tab: what each role can do, as a table with roles across and capabilities down. Admin is fixed (it can do
// everything); Editor, Channel owner and custom roles are switches. Turning one on also turns on what it needs, and
// turning one off turns off what depends on it, with a note saying so. Nothing is saved until Review and save sends
// every change in one saveRolePolicy call (carrying the policy's rev, so a second admin's newer save isn't lost).
const list = (value) => (Array.isArray(value) ? value : []);
const runWith = (action, fn) => (action ? action(fn, '', true) : Promise.resolve().then(fn));
const joinAnd = (items) => (items.length <= 1 ? items[0] || '' : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);
const REASONS = {
  admin: 'Admins can do everything, so their access can’t be adjusted.',
  always: 'Everyone with a role has this.',
  locked: (label) => `Only admins can have “${label}”.`,
  unavailable: (label) => `Channel owners see only their channel, so they can’t have “${label}”.`,
};

function RoleDialog({ title, role, templates = [], busy, problem, onSave, onClose }) {
  const titleId = useId(); const nameRef = useRef(null);
  const [label, setLabel] = useState(role?.label || '');
  const [description, setDescription] = useState(role?.description || '');
  const [template, setTemplate] = useState(templates[0]?.id || '');
  const [local, setLocal] = useState('');
  function submit(event) {
    event.preventDefault();
    if (!label.trim() || label.trim().length > 40) { setLocal('Enter a role name of up to 40 characters.'); nameRef.current?.focus(); return; }
    if (description.trim().length > 160) { setLocal('Keep the description to 160 characters or fewer.'); return; }
    setLocal(''); onSave({ label: label.trim(), description: description.trim(), template: templates.find((entry) => entry.id === template) || null });
  }
  return <Dialog labelledBy={titleId} onClose={onClose} closeDisabled={busy} initialFocus={nameRef} className="people-sheet">
    <form className="people-sheet-form" noValidate onSubmit={submit}>
      <header className="studio-dialog-head"><div><small>Roles</small><h2 id={titleId}>{title}</h2></div><DialogClose onClose={onClose} disabled={busy} /></header>
      <div className="studio-dialog-body">
        <label className="studio-field"><span>Role name</span><input ref={nameRef} value={label} maxLength={40} autoComplete="off" onChange={(event) => { setLabel(event.target.value); setLocal(''); }} /></label>
        <label className="studio-field"><span>What it’s for <em>(optional)</em></span><input value={description} maxLength={160} autoComplete="off" onChange={(event) => setDescription(event.target.value)} /></label>
        {templates.length > 0 && <fieldset className="people-roles"><legend>Start from</legend>
          <div className="people-role-cards" role="radiogroup" aria-label="Start from">{templates.map((entry) => <label key={entry.id} className={`people-role-card role-${entry.base}${template === entry.id ? ' checked' : ''}`}>
            <input type="radio" name={`${titleId}-template`} value={entry.id} checked={template === entry.id} onChange={() => setTemplate(entry.id)} />
            <span><strong>{entry.label}</strong><small>{entry.description}</small></span>
          </label>)}</div>
          <p className="studio-hint">A role built on Channel owner sees only its channel. Its kind can’t change later.</p>
        </fieldset>}
        {(local || problem) && <p className="studio-error" role="alert">{local || problem}</p>}
      </div>
      <footer className="studio-dialog-foot"><button type="button" className="studio-quiet" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" className="studio-primary" disabled={busy}>{busy ? 'Saving…' : role ? 'Save' : 'Make role'}</button></footer>
    </form>
  </Dialog>;
}

function DeleteRoleDialog({ role, roles, busy, problem, onDelete, onClose }) {
  const titleId = useId();
  const targets = roles.filter((entry) => entry.id !== role.id && entry.base === role.base);
  const [moveTo, setMoveTo] = useState(targets.find((entry) => entry.builtIn)?.id || targets[0]?.id || '');
  const count = Number(role.memberCount) || 0;
  return <Dialog labelledBy={titleId} onClose={onClose} closeDisabled={busy} className="people-sheet">
    <form className="people-sheet-form" noValidate onSubmit={(event) => { event.preventDefault(); onDelete(count ? moveTo : ''); }}>
      <header className="studio-dialog-head"><div><small>Roles</small><h2 id={titleId}>Delete the {role.label} role?</h2></div><DialogClose onClose={onClose} disabled={busy} /></header>
      <div className="studio-dialog-body">
        {count > 0
          ? <><p>{plural(count, 'person', 'people')} {count === 1 ? 'has' : 'have'} this role. Choose where they move; their own access changes stay.</p>
            <label className="studio-field"><span>Move them to</span><select value={moveTo} onChange={(event) => setMoveTo(event.target.value)}>{targets.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}</select></label></>
          : <p>Nobody has this role. Deleting it can’t be undone.</p>}
        {problem && <p className="studio-error" role="alert">{problem}</p>}
      </div>
      <footer className="studio-dialog-foot"><button type="button" className="studio-quiet" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" className="studio-danger" disabled={busy || (count > 0 && !moveTo)}>{busy ? 'Deleting…' : count ? 'Move and delete' : 'Delete role'}</button></footer>
    </form>
  </Dialog>;
}

function ChannelPickDialog({ role, channels, onPick, onClose }) {
  const titleId = useId(); const selectRef = useRef(null);
  const [channelId, setChannelId] = useState(channels[0]?.id || '');
  return <Dialog labelledBy={titleId} onClose={onClose} initialFocus={selectRef} className="people-sheet">
    <form className="people-sheet-form" onSubmit={(event) => { event.preventDefault(); if (channelId) onPick(channelId); }}>
      <header className="studio-dialog-head"><div><small>Preview</small><h2 id={titleId}>Preview {role.label} for which channel?</h2></div><DialogClose onClose={onClose} /></header>
      <div className="studio-dialog-body"><label className="studio-field"><span>Channel</span><select ref={selectRef} value={channelId} onChange={(event) => setChannelId(event.target.value)}>{channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></label></div>
      <footer className="studio-dialog-foot"><button type="button" className="studio-quiet" onClick={onClose}>Cancel</button><button type="submit" className="studio-primary" disabled={!channelId}><Eye size={15} aria-hidden="true" />Preview</button></footer>
    </form>
  </Dialog>;
}

export function RolesMatrix({ team, viewer = {}, api, action, onPreview, onSaved, onReload, showToast }) {
  const access = team?.access || null;
  const rules = useMemo(() => capabilityRules(access), [access]);
  const roles = list(access?.roles);
  const editable = roles.filter((role) => role.base !== 'admin');
  const narrow = useNarrow();
  const confirm = useConfirm();
  const saved = useMemo(() => new Map(editable.map((role) => [role.id, new Set(role.capabilities)])), [access]);
  const [draft, setDraft] = useState(saved);
  const [note, setNote] = useState(null); // { roleId, capId, text } for the last cascade
  const [shown, setShown] = useState('editor');
  const [dialog, setDialog] = useState(null); // { kind: 'new' | 'rename' | 'delete' | 'channel', role }
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [conflict, setConflict] = useState('');
  useEffect(() => { setDraft(saved); setNote(null); }, [saved]);
  useEffect(() => { if (!roles.some((role) => role.id === shown)) setShown(editable[0]?.id || 'admin'); }, [roles.map((role) => role.id).join()]);
  const canSave = typeof api?.saveRolePolicy === 'function' && !viewer.preview;
  const canEditRoles = typeof api?.saveRole === 'function' && !viewer.preview;
  const defaults = (roleId) => new Set(rules.caps.filter((cap) => list(cap.defaults).includes(roleId)).map((cap) => cap.id));

  // What's changed, role by role: { role, on:[ids], off:[ids] }.
  const changes = editable.map((role) => {
    const before = saved.get(role.id) || new Set(); const after = draft.get(role.id) || before;
    return { role, on: [...after].filter((id) => !before.has(id)), off: [...before].filter((id) => !after.has(id)) };
  }).filter((entry) => entry.on.length || entry.off.length);
  const changeCount = changes.reduce((sum, entry) => sum + entry.on.length + entry.off.length, 0);
  const affectedPeople = list(team?.members).filter((member) => !member.disabled && changes.some((entry) => entry.role.id === member.role));
  const dirty = changeCount > 0;

  function toggle(role, cap) {
    if (!canSave) return;
    const set = new Set(draft.get(role.id) || []);
    const turningOn = !set.has(cap.id);
    const others = turningOn ? withRequirements(set, cap.id, role.base, rules.byId) : withoutDependents(set, cap.id, role.base, rules.byId);
    setDraft((current) => new Map(current).set(role.id, set));
    setNote(others.length ? { roleId: role.id, capId: cap.id, text: `${role.label}: also turned ${turningOn ? 'on' : 'off'} ${joinAnd(others.map((id) => rules.byId.get(id)?.label || id))}` } : null);
    setConflict('');
  }
  function resetRole(role) { setDraft((current) => new Map(current).set(role.id, defaults(role.id))); setNote(null); }
  const label = (id) => rules.byId.get(id)?.label || id;
  async function review() {
    const items = changes.map((entry) => `${entry.role.label}: ${[entry.on.length ? `turns on ${joinAnd(entry.on.map(label))}` : '', entry.off.length ? `turns off ${joinAnd(entry.off.map(label))}` : ''].filter(Boolean).join('; ')}`);
    const names = affectedPeople.map((member) => member.name);
    const who = names.length ? `Affects ${joinAnd(names.length > 20 ? [...names.slice(0, 20), `${names.length - 20} more`] : names)}. It applies as soon as you save.` : 'Nobody has these roles yet.';
    if (!(await confirm({ title: `Save ${plural(changeCount, 'change')}?`, items, note: who, confirmLabel: 'Save changes' }))) return;
    const builtIn = {}; const custom = [];
    for (const entry of changes) {
      const set = draft.get(entry.role.id);
      if (entry.role.builtIn) { const base = defaults(entry.role.id); builtIn[entry.role.id] = { grant: [...set].filter((id) => !base.has(id)), deny: [...base].filter((id) => !set.has(id)) }; }
      else custom.push({ id: entry.role.id, capabilities: [...set] });
    }
    setBusy(true); setProblem('');
    try {
      const result = await runWith(action, () => api.saveRolePolicy({ rev: access.rev, ...(Object.keys(builtIn).length ? { builtIn } : {}), ...(custom.length ? { custom } : {}) }));
      setBusy(false);
      if (result === null) return;
      onSaved?.(result?.access);
      showToast?.(`Roles saved. ${result?.affected ? `${plural(result.affected, 'person', 'people')} see the change now.` : 'The change applies now.'}`);
    } catch (failure) {
      setBusy(false);
      if (failure?.status === 409 || failure?.code === 'policyConflict') setConflict(failure.message || 'Someone changed roles after you opened them. Reload to see the latest.');
      else setProblem(failure?.message || 'The roles couldn’t be saved. Try again.');
    }
  }
  async function saveRole(fields) {
    setBusy(true); setProblem('');
    try {
      const payload = dialog.kind === 'new'
        ? { label: fields.label, description: fields.description, base: fields.template?.base || 'editor', template: fields.template?.id || '', rev: access.rev }
        : { id: dialog.role.id, label: fields.label, description: fields.description, rev: access.rev };
      const result = await runWith(action, () => api.saveRole(payload));
      setBusy(false);
      if (result === null) return;
      setDialog(null); onSaved?.(result?.access);
      if (dialog.kind === 'new' && result?.role?.id) setShown(result.role.id);
      showToast?.(dialog.kind === 'new' ? `${fields.label} is ready. Turn on what it can do, then save.` : 'Role saved.');
    } catch (failure) { setBusy(false); setProblem(failure?.message || 'The role couldn’t be saved. Try again.'); }
  }
  async function deleteRole(moveTo) {
    setBusy(true); setProblem('');
    try {
      const result = await runWith(action, () => api.deleteRole({ id: dialog.role.id, ...(moveTo ? { moveTo } : {}), rev: access.rev }));
      setBusy(false);
      if (result === null) return;
      const name = dialog.role.label; setDialog(null); onSaved?.(result?.access);
      showToast?.(result?.moved ? `${name} is deleted. ${plural(result.moved, 'person', 'people')} moved.` : `${name} is deleted.`);
    } catch (failure) { setBusy(false); setProblem(failure?.message || 'The role couldn’t be deleted. Try again.'); }
  }
  function previewRole(role) {
    if (role.base === 'channel') { const channels = list(team?.channels); if (channels.length === 1) onPreview({ role: role.id, channelId: channels[0].id }); else setDialog({ kind: 'channel', role }); return; }
    onPreview({ role: role.id });
  }
  const blockedWhileDirty = dirty ? { disabled: true, title: 'Save or discard your changes first.' } : {};
  const columns = narrow ? roles.filter((role) => role.id === shown) : roles;

  function header(role) {
    const count = Number(role.memberCount) || 0;
    const items = role.base === 'admin' ? [] : [
      onPreview && { label: 'Preview as this role', icon: Eye, onSelect: () => previewRole(role) },
      !role.builtIn && canEditRoles && { label: 'Rename', icon: PenLine, ...blockedWhileDirty, onSelect: () => { setProblem(''); setDialog({ kind: 'rename', role }); } },
      role.builtIn && canSave && { label: 'Reset to defaults', icon: RotateCcw, onSelect: () => resetRole(role) },
      !role.builtIn && canEditRoles && typeof api?.deleteRole === 'function' && { label: 'Delete', icon: Trash2, danger: true, ...blockedWhileDirty, onSelect: () => { setProblem(''); setDialog({ kind: 'delete', role }); } },
    ];
    return <th key={role.id} scope="col" className={`roles-matrix-role role-${role.base}`}>
      <span className="roles-matrix-role-head">
        <span><strong>{role.label}</strong>{!role.builtIn && <em className="people-custom-tag">Custom</em>}</span>
        {items.some(Boolean) && <MoreMenu label={`${role.label} role actions`} items={items} />}
      </span>
      <small>{role.base === 'admin' ? <><Lock size={12} aria-hidden="true" />Everything. Can’t be changed.</> : `${plural(count, 'person', 'people')}${role.base === 'channel' && !role.builtIn ? ' · channel role' : ''}`}</small>
    </th>;
  }
  function cell(role, cap) {
    const kind = availability(cap, role.base);
    const set = draft.get(role.id); const on = kind === 'admin' || kind === 'always' || Boolean(set?.has(cap.id));
    const name = `${role.label}: ${cap.label}`;
    if (kind !== 'open') {
      const reason = kind === 'admin' ? REASONS.admin : kind === 'always' ? REASONS.always : REASONS[kind](cap.label);
      return <td key={role.id} className={`roles-matrix-cell is-${kind}`}><button type="button" role="switch" aria-checked={on} aria-disabled="true" aria-label={`${name}. ${on ? 'On' : 'Off'}. ${reason}`} title={reason} className="roles-matrix-switch is-fixed" onClick={(event) => event.preventDefault()}>
        {on ? <><Check size={15} aria-hidden="true" /><Lock size={11} aria-hidden="true" className="roles-matrix-lock" /></> : kind === 'locked' ? <Lock size={14} aria-hidden="true" /> : <Minus size={14} aria-hidden="true" />}
      </button></td>;
    }
    const before = saved.get(role.id)?.has(cap.id) || false; const pending = before !== on;
    const fromDefault = role.builtIn && list(cap.defaults).includes(role.id) !== on;
    const isNew = list(role.newCapabilities).includes(cap.id);
    return <td key={role.id} className={`roles-matrix-cell${pending ? ' is-pending' : ''}`}>
      <button type="button" role="switch" aria-checked={on} aria-label={`${name}${pending ? ', not saved yet' : fromDefault ? ', changed from the default' : ''}${isNew ? ', new' : ''}`} className={`roles-matrix-switch${on ? ' is-on' : ''}`} disabled={!canSave} onClick={() => toggle(role, cap)}>
        <span className="roles-matrix-track" aria-hidden="true"><span /></span>
        {(pending || fromDefault) && <span className={`roles-matrix-dot${pending ? ' is-pending' : ''}`} aria-hidden="true" />}
        {isNew && <span className="roles-matrix-new" aria-hidden="true">New</span>}
      </button>
    </td>;
  }

  if (!access) return <div className="studio-empty"><p>Roles aren’t available in this version of the studio.</p></div>;
  return <div className="roles-tab">
    <div className="roles-tab-head">
      <p className="studio-hint">Admins can do everything. Change what Editor, Channel owner and your own roles can do; each person can also have their own changes on top.</p>
      <div className="roles-tab-actions">
        {narrow && <label className="people-filter"><span>Show</span><select value={shown} onChange={(event) => setShown(event.target.value)}>{roles.map((role) => <option key={role.id} value={role.id}>{role.label}</option>)}</select></label>}
        {canEditRoles && <button type="button" className="studio-quiet small" {...(dirty ? blockedWhileDirty : writeProps(viewer, busy || roles.filter((role) => !role.builtIn).length >= (access.limits?.roles || 12)))} onClick={() => { setProblem(''); setDialog({ kind: 'new' }); }}><Plus size={15} aria-hidden="true" />New role</button>}
      </div>
    </div>
    {conflict && <div className="roles-conflict" role="alert"><p>{conflict}</p><button type="button" className="studio-quiet small" onClick={() => { setConflict(''); onReload?.(); }}>Reload</button></div>}
    {problem && !dialog && <p className="studio-error" role="alert">{problem}</p>}
    <div className="roles-matrix-scroll">
      <table className="roles-matrix">
        <caption>What each role can do</caption>
        <thead><tr><td className="roles-matrix-corner" />{columns.map(header)}</tr></thead>
        {rules.groups.map((group) => <tbody key={group.id}>
          <tr className="roles-matrix-group"><th scope="rowgroup" colSpan={columns.length + 1}>{group.label}</th></tr>
          {group.caps.map((cap) => <tr key={cap.id}>
            <th scope="row" className="roles-matrix-cap">
              <strong>{cap.label}{cap.spends && <span className="people-cost-tag">Costs money</span>}</strong>
              <small>{cap.description}</small>
              {note?.capId === cap.id && <small className="people-access-cascade" role="status">{note.text}</small>}
            </th>
            {columns.map((role) => cell(role, cap))}
          </tr>)}
        </tbody>)}
      </table>
    </div>
    {dirty && <div className="roles-dirty-bar" role="region" aria-label="Unsaved role changes">
      <p><strong>{plural(changeCount, 'change')}</strong> · affects {plural(affectedPeople.length, 'person', 'people')}</p>
      <div><button type="button" className="studio-quiet small" disabled={busy} onClick={() => { setDraft(saved); setNote(null); }}>Discard</button><button type="button" className="studio-primary small" disabled={busy || !canSave} onClick={review}>{busy ? 'Saving…' : 'Review and save'}</button></div>
    </div>}
    {dialog?.kind === 'new' && <RoleDialog title="New role" templates={list(access.templates)} busy={busy} problem={problem} onSave={saveRole} onClose={() => setDialog(null)} />}
    {dialog?.kind === 'rename' && <RoleDialog title={`Rename ${dialog.role.label}`} role={dialog.role} busy={busy} problem={problem} onSave={saveRole} onClose={() => setDialog(null)} />}
    {dialog?.kind === 'delete' && <DeleteRoleDialog role={dialog.role} roles={roles} busy={busy} problem={problem} onDelete={deleteRole} onClose={() => setDialog(null)} />}
    {dialog?.kind === 'channel' && <ChannelPickDialog role={dialog.role} channels={list(team?.channels)} onClose={() => setDialog(null)} onPick={(channelId) => { const role = dialog.role; setDialog(null); onPreview({ role: role.id, channelId }); }} />}
  </div>;
}
