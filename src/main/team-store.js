'use strict';
// The studio team: members and their roles, custom roles and the role policy, personal sign-in links, which channels use
// which trend, an activity log, an access log and per-person preferences, in content-studio/team.json (the folder the
// owner lock protects). CommonJS, Electron-free.
//
// Concurrency: every call is synchronous end to end, so nothing awaits between a read and its write. Only one process may
// own content-studio/, so the studio doesn't scale horizontally. Adoptions, like trend decisions, are last-write-wins and
// the UI shows who answered. Role policy edits carry the policy's `rev`, so two admins can't overwrite each other.
//
// Member lifecycle:
// - Remove keeps their adoptions and activity (both snapshot by.name) and deletes their prefs and sign-in link. Their
//   sessions end because identify() no longer finds them.
// - Disable is the same, but the record stays; they see "Your access to this studio is paused."
// - Re-adding an email creates a new id. A channel change leaves old answers with the channel.
// - Owners of one channel share one answer per trend ("Answered by <name>").
// - In proxy mode an email change means they sign in with the new address from then on.
// - A role change to another kind of role (base) clears their own access changes, which only made sense for the old one.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const roles = require('./roles');

const TEAM_VERSION = 2;
// Upgrades keyed on the version they start from. v2 adds per-person access, custom roles, the role policy and the
// access log; an existing team keeps exactly the access it had.
const MIGRATIONS = Object.freeze({
  1: (data) => ({ ...data, version: 2, members: Array.isArray(data.members) ? data.members.map((member) => (member && typeof member === 'object' ? { ...member, grants: [], denies: [] } : member)) : data.members, roles: [], rolePolicy: { rev: 0, updatedAt: '', updatedBy: null, builtIn: {} }, audit: [] }),
});
const ACTIVITY_KINDS = Object.freeze(['trend-decision', 'adoption', 'kit-created', 'report-edited', 'report-restored', 'member-changed', 'link-issued', 'research-started']);
const AUDIT_KINDS = Object.freeze(['member-added', 'member-changed', 'member-disabled', 'member-enabled', 'member-removed', 'member-access', 'link-issued', 'link-revoked', 'role-created', 'role-changed', 'role-deleted', 'policy-changed']);
const ACTIVITY_LIMIT = 5000;
const AUDIT_LIMIT = 2000;
const ROLE_LIMIT = 12;
const INVITE_LIMIT = 50;
const TOUCH_MS = 5 * 60 * 1000;
const MERGE_MS = 10 * 60 * 1000;
const DAY_MS = 86400000;
const UI_MODES = ['simple', 'classic'];
const SECRET_KEY = /token|hash|password|secret|cookie|payload/i;
const HEX_SECRET = /^[0-9a-f]{32,}$/i;
const RECORD_ID = /^[a-zA-Z0-9_-]{1,180}$/;
const IDENTITY_ID = /^[\w:@.+-]{1,320}$/;
const EMAIL = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const list = (value) => (Array.isArray(value) ? value : []);
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const copy = (value) => JSON.parse(JSON.stringify(value));
const time = (value) => { const ms = Date.parse(value || ''); return Number.isFinite(ms) ? ms : NaN; };
const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');
const normEmail = (value) => String(value ?? '').trim().toLowerCase();
const cleanName = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const localName = (email) => normEmail(email).split('@')[0] || 'Someone';
const actorOf = (by) => ({ id: String(by?.id || 'system').slice(0, 320), name: String(by?.name || 'Automatic').slice(0, 120) });
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const sortedIds = (value) => [...new Set(list(value))].sort();
const plural = (count, word, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;
const when = (value) => { const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }) : 'an earlier time'; };
// "pat.lee@semrush.com" → "Pat Lee": a readable name when an invite doesn't give one.
function nameFromEmail(email) {
  const words = localName(email).split(/[._+-]+/).filter(Boolean);
  return words.length ? words.map((word) => word[0].toUpperCase() + word.slice(1)).join(' ').slice(0, 120) : 'Someone';
}
// "Weekly SEO reviewers" → "weekly-seo-reviewers" for a custom role id.
const slug = (text) => cleanName(text).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'role';

function migrate(data) {
  let next = data;
  while (next.version < TEAM_VERSION) {
    const step = MIGRATIONS[next.version];
    if (!step) throw new Error('Team data could not be read (content-studio/team.json). Restore it from a backup before starting.');
    next = step(next);
  }
  return next;
}

// What changed about a member, for the access log: the audit kind and field changes between two member views (either
// may be null for added or removed). roleLabel names a role id at the time of the change.
function auditForMember(before, after, roleLabel = (id) => id) {
  if (!before && !after) return null;
  const subject = after || before;
  const target = { type: 'member', id: subject.id, name: subject.name || '' };
  if (!before) return { kind: 'member-added', target, changes: [{ field: 'role', from: '', to: after.role, toLabel: roleLabel(after.role) }, ...(after.channelId ? [{ field: 'channelId', from: '', to: after.channelId }] : [])], affected: 1 };
  if (!after) return { kind: 'member-removed', target, changes: [{ field: 'role', from: before.role, to: '', fromLabel: roleLabel(before.role) }], affected: 1 };
  const changes = [];
  for (const field of ['name', 'email']) if ((before[field] || '') !== (after[field] || '')) changes.push({ field, from: before[field] || '', to: after[field] || '' });
  if (before.role !== after.role) changes.push({ field: 'role', from: before.role, to: after.role, fromLabel: roleLabel(before.role), toLabel: roleLabel(after.role) });
  if ((before.channelId || null) !== (after.channelId || null)) changes.push({ field: 'channelId', from: before.channelId || '', to: after.channelId || '' });
  for (const field of ['grants', 'denies']) {
    const was = new Set(list(before[field])); const now = new Set(list(after[field]));
    for (const id of [...was].filter((cap) => !now.has(cap))) changes.push({ field: field === 'grants' ? 'grant' : 'deny', capability: id, from: true, to: false });
  }
  const kind = Boolean(before.disabled) !== Boolean(after.disabled) ? (after.disabled ? 'member-disabled' : 'member-enabled') : 'member-changed';
  return kind === 'member-changed' && !changes.length ? null : { kind, target, changes, affected: 1 };
}

function createTeamStore({ root, now = () => new Date(), adminEmails = [] } = {}) {
  if (!root) throw new Error('Team data needs the studio data folder.');
  const target = path.join(root, 'team.json');
  const clock = () => new Date(now()).getTime();
  const stamp = () => new Date(now()).toISOString();
  const serverAdmins = new Set(list(adminEmails).map(normEmail).filter(Boolean));
  const unreadable = () => new Error('Team data could not be read (content-studio/team.json). Restore it from a backup before starting.');
  const emptyPolicy = () => ({ rev: 0, updatedAt: '', updatedBy: null, builtIn: {} });
  let data = load();
  let compiled = null; // the compiled role policy, rebuilt after any change
  // When each member's lastSeenAt last reached the disk; a restart counts the saved value.
  const touched = new Map(data.members.filter((member) => Number.isFinite(time(member.lastSeenAt))).map((member) => [member.id, time(member.lastSeenAt)]));

  // A missing file is an empty team (the file appears on the first write). Anything unreadable stops the studio rather
  // than starting with nobody in it.
  function load() {
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(target, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return { version: TEAM_VERSION, members: [], roles: [], rolePolicy: emptyPolicy(), adoptions: [], activity: [], audit: [], prefs: {} }; throw unreadable(); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw unreadable();
    const version = parsed.version ?? 1;
    if (!Number.isInteger(version) || version < 1) throw unreadable();
    if (version > TEAM_VERSION) throw new Error('This team file is from a newer Scraper Studio. Update the app or server.');
    const result = migrate({ ...parsed, version });
    for (const key of ['members', 'roles', 'adoptions', 'activity', 'audit']) { if (result[key] == null) result[key] = []; else if (!Array.isArray(result[key])) throw unreadable(); }
    if (result.prefs == null) result.prefs = {}; else if (typeof result.prefs !== 'object' || Array.isArray(result.prefs)) throw unreadable();
    if (result.rolePolicy == null) result.rolePolicy = emptyPolicy(); else if (typeof result.rolePolicy !== 'object' || Array.isArray(result.rolePolicy)) throw unreadable();
    if (!Number.isInteger(result.rolePolicy.rev) || result.rolePolicy.rev < 0) result.rolePolicy.rev = 0;
    if (!result.rolePolicy.builtIn || typeof result.rolePolicy.builtIn !== 'object' || Array.isArray(result.rolePolicy.builtIn)) result.rolePolicy.builtIn = {};
    if (result.members.some((member) => !member || typeof member.id !== 'string' || !member.id)) throw unreadable();
    for (const member of result.members) { if (!Array.isArray(member.grants)) member.grants = []; if (!Array.isArray(member.denies)) member.denies = []; }
    return result;
  }
  // Same pattern as content-workspace's writeBytes: a pid-named temp file, fsync, rename, then fsync the folder.
  function writeFile(text) {
    fs.mkdirSync(root, { recursive: true });
    const temp = `${target}.${process.pid}.tmp`;
    try {
      const fd = fs.openSync(temp, 'w', 0o600);
      try { fs.writeFileSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(temp, target);
    } catch (error) { try { fs.unlinkSync(temp); } catch (_) { /* Nothing was left behind. */ } throw error; }
    let directory;
    try { directory = fs.openSync(path.dirname(target), 'r'); fs.fsyncSync(directory); }
    catch (error) { if (!['EINVAL', 'ENOTSUP', 'EPERM', 'EACCES', 'EISDIR'].includes(error.code)) throw error; }
    finally { if (directory != null) fs.closeSync(directory); }
  }
  // Write-through: a change that can't reach the disk is undone in memory too.
  function change(mutate) {
    const before = JSON.stringify(data);
    try { const result = mutate(); compiled = null; writeFile(JSON.stringify(data, null, 2)); return result; }
    catch (error) { data = JSON.parse(before); compiled = null; throw error; }
  }

  // ---------- Role policy ----------
  // The compiled policy (built-in roles with the team's adjustments, plus custom roles), for the gate and the viewer.
  function accessPolicy() {
    if (!compiled) compiled = roles.compilePolicy({ rev: data.rolePolicy.rev, builtIn: data.rolePolicy.builtIn, roles: data.roles });
    return compiled;
  }
  const roleDef = (id) => accessPolicy().roles.get(id) || null;
  const roleLabel = (id) => roleDef(id)?.label || (id ? 'a removed role' : '');
  const accessFor = (id) => { const member = record(id); return { grants: [...list(member?.grants)], denies: [...list(member?.denies)] }; };
  const membersWith = (roleId) => data.members.filter((member) => member.role === roleId);
  const enabledWith = (roleIds) => data.members.filter((member) => roleIds.has(member.role) && !member.disabled);
  // Two admins with the role matrix open: the second save is refused, naming who saved first.
  function checkRev(rev) {
    if (!Number.isInteger(rev) || rev !== data.rolePolicy.rev) throw roles.refusal('policyConflict', { name: data.rolePolicy.updatedBy?.name || 'Someone', time: when(data.rolePolicy.updatedAt) }, 409);
  }
  const bump = (by, at) => { data.rolePolicy.rev += 1; data.rolePolicy.updatedAt = at; data.rolePolicy.updatedBy = actorOf(by); };
  // Requested capability ids: every id must be known, and each one granted must be one the base can hold.
  function checkGrants(ids, base) {
    for (const id of list(ids)) if (!roles.isCapability(id)) throw fail('That access option isn’t in this studio. Reload and try again.');
    for (const id of list(ids)) {
      const cap = roles.CAPABILITIES.find((entry) => entry.id === id);
      if (cap.lock === 'admin') throw roles.refusal('lockedCapability', { what: cap.label }, 400);
      if (!cap.bases.includes(base)) throw roles.refusal(base === 'channel' ? 'notForChannelRoles' : 'lockedCapability', { what: cap.label }, 400);
    }
  }
  // A person's grants and denies, cleaned: deny wins, core can't be turned off, and every grant must keep its
  // requirements (granted, from the role, or not denied), or the change is refused naming what it needs.
  function cleanAccess(roleId, input = {}) {
    const def = roleDef(roleId);
    if (!def) throw fail('Choose a role for this person.');
    const denies = sortedIds(list(input.denies)); const grantsWanted = sortedIds(list(input.grants));
    if (def.base === 'admin') { if (denies.length || grantsWanted.length) throw roles.refusal('adminAccess', {}, 400); return { grants: [], denies: [] }; }
    for (const id of denies) if (!roles.isCapability(id)) throw fail('That access option isn’t in this studio. Reload and try again.');
    checkGrants(grantsWanted, def.base);
    const deny = new Set(denies.filter((id) => roles.CAPABILITIES.find((cap) => cap.id === id).lock !== 'always'));
    const grants = grantsWanted.filter((id) => !deny.has(id));
    const held = new Set(roles.capabilitiesFor({ roleId, grants, denies: [...deny] }, accessPolicy()));
    for (const id of grants) {
      if (held.has(id)) continue;
      const cap = roles.CAPABILITIES.find((entry) => entry.id === id);
      const missing = roles.requirementsOf(cap, def.base).filter((need) => !held.has(need));
      throw roles.refusal('needsCapability', { what: cap.label, needs: missing.map((id) => `“${roles.capLabel(id)}”`).join(' and ') }, 400);
    }
    return { grants, denies: [...deny].sort() };
  }
  // One capability's state for a person: 'on' or 'off' when they have their own setting, else 'default'.
  const stateOf = (access, id) => (list(access.denies).includes(id) ? 'off' : list(access.grants).includes(id) ? 'on' : 'default');
  function accessChanges(before, after) {
    return roles.CAPABILITY_IDS.filter((id) => stateOf(before, id) !== stateOf(after, id)).map((id) => ({ field: 'capability', capability: id, from: stateOf(before, id), to: stateOf(after, id) }));
  }
  const publicRole = (role) => (role ? copy(role) : null);
  // Everything the Roles tab and Invite need: the capabilities, every role with what it can do and how many people
  // have it, and the templates a new role can start from.
  function accessSummary() {
    const policy = accessPolicy();
    const counts = new Map(); for (const member of data.members) counts.set(member.role, (counts.get(member.role) || 0) + 1);
    const stored = new Map(data.roles.map((role) => [role.id, role]));
    return {
      rev: data.rolePolicy.rev, updatedAt: data.rolePolicy.updatedAt || '', updatedBy: data.rolePolicy.updatedBy ? copy(data.rolePolicy.updatedBy) : null,
      groups: roles.CAPABILITY_GROUPS.map((group) => ({ ...group })),
      capabilities: roles.CAPABILITIES.map((cap) => ({ id: cap.id, group: cap.group, label: cap.label, description: cap.description, lock: cap.lock, spends: cap.spends, projection: cap.projection, requires: [...cap.requires], bases: [...cap.bases], defaults: [...cap.defaults], since: cap.since })),
      roles: policy.list.map((role) => ({
        id: role.id, label: role.label, description: role.description, base: role.base, builtIn: role.builtIn, template: role.template || '',
        capabilities: [...role.capabilities], memberCount: counts.get(role.id) || 0,
        ...(role.overrides ? { overrides: { grant: [...role.overrides.grant], deny: [...role.overrides.deny] } } : {}),
        ...(role.builtIn ? {} : { createdAt: stored.get(role.id)?.createdAt || '', newCapabilities: roles.CAPABILITIES.filter((cap) => cap.since > role.policyVersion && cap.bases.includes(role.base) && cap.lock !== 'admin').map((cap) => cap.id) }),
      })),
      templates: [
        ...['editor', 'channel'].map((id) => { const role = policy.roles.get(id); return { id, label: role.label, description: role.description, base: id, capabilities: [...role.capabilities] }; }),
        ...roles.ROLE_TEMPLATES.map((template) => ({ id: template.id, label: template.label, description: template.description, base: template.base, capabilities: roles.settle(template.capabilities, template.base) })),
      ],
      limits: { roles: ROLE_LIMIT, invite: INVITE_LIMIT },
    };
  }

  // Built-in Editor and Channel owner adjustments, and custom roles' capability lists, saved together as one revision.
  // builtIn.<base> = { grant, deny } relative to the built-in defaults; custom = [{ id, capabilities }]. The admin role
  // can't be adjusted. Returns { access, affected, audit } (audit rows for the gate to write: one per capability change).
  function saveRolePolicy(input = {}, by = {}) {
    const payload = input && typeof input === 'object' ? input : {};
    checkRev(payload.rev);
    const builtIn = payload.builtIn && typeof payload.builtIn === 'object' ? payload.builtIn : {};
    if (own(builtIn, 'admin')) throw roles.refusal('adminAccess', {}, 400);
    const policy = accessPolicy();
    const nextBuiltIn = copy(data.rolePolicy.builtIn);
    const nextCustom = new Map();
    const audit = []; const changedRoles = new Set();
    const noteChanges = (role, from, to) => {
      const before = new Set(from); const after = new Set(to);
      for (const id of roles.CAPABILITY_IDS) if (before.has(id) !== after.has(id)) { audit.push({ kind: 'policy-changed', target: { type: 'role', id: role.id, name: role.label }, changes: [{ field: 'capability', capability: id, from: before.has(id), to: after.has(id) }], affected: membersWith(role.id).filter((member) => !member.disabled).length }); changedRoles.add(role.id); }
    };
    for (const base of ['editor', 'channel']) {
      if (builtIn[base] === undefined) continue;
      const entry = builtIn[base] && typeof builtIn[base] === 'object' ? builtIn[base] : {};
      const grant = sortedIds(list(entry.grant)); const deny = sortedIds(list(entry.deny));
      for (const id of deny) if (!roles.isCapability(id)) throw fail('That access option isn’t in this studio. Reload and try again.');
      checkGrants(grant, base);
      const defaults = roles.defaultsFor(base); const denied = new Set(deny);
      const final = roles.validateCapabilities([...new Set([...defaults, ...grant])].filter((id) => !denied.has(id) || roles.CAPABILITIES.find((cap) => cap.id === id).lock === 'always'), base);
      const kept = { grant: final.filter((id) => !defaults.includes(id)), deny: defaults.filter((id) => !final.includes(id)) };
      if (kept.grant.length || kept.deny.length) nextBuiltIn[base] = kept; else delete nextBuiltIn[base];
      noteChanges(policy.roles.get(base), policy.roles.get(base).capabilities, final);
    }
    for (const entry of list(payload.custom)) {
      const role = data.roles.find((row) => row.id === entry?.id);
      if (!role) throw fail('That role isn’t in the studio anymore. Reload and try again.', 404);
      const final = roles.validateCapabilities(list(entry.capabilities), role.base);
      nextCustom.set(role.id, final);
      noteChanges(policy.roles.get(role.id), policy.roles.get(role.id).capabilities, final);
    }
    if (!audit.length) return { access: accessSummary(), affected: 0, audit: [] };
    const affected = enabledWith(changedRoles).length;
    change(() => {
      const at = stamp();
      data.rolePolicy.builtIn = nextBuiltIn;
      for (const role of data.roles) if (nextCustom.has(role.id)) Object.assign(role, { capabilities: nextCustom.get(role.id), updatedAt: at });
      bump(by, at);
    });
    return { access: accessSummary(), affected, audit };
  }

  // Makes a custom role (no id) or renames, describes or re-scopes one. A new role starts from a template (a built-in
  // role's current access, or Viewer, Analyst or Channel reviewer) unless capabilities are given. Its base never changes.
  function saveRole(input = {}, by = {}) {
    const payload = input && typeof input === 'object' ? input : {};
    checkRev(payload.rev);
    const id = typeof payload.id === 'string' ? payload.id : '';
    if (id && roles.ROLE_IDS.includes(id)) throw fail('Built-in roles keep their names. Change what they can do in the table.');
    const existing = id ? data.roles.find((role) => role.id === id) || null : null;
    if (id && !existing) throw fail('That role isn’t in the studio anymore. Reload and try again.', 404);
    const label = cleanName(payload.label !== undefined ? payload.label : existing?.label);
    if (!label || label.length > 40) throw fail('Enter a role name of up to 40 characters.');
    const taken = [...roles.ROLES.map((role) => role.label), ...data.roles.filter((role) => role !== existing).map((role) => role.label)].map((name) => name.toLowerCase());
    if (taken.includes(label.toLowerCase())) throw roles.refusal('roleName', {}, 400);
    const description = cleanName(payload.description !== undefined ? payload.description : existing?.description || '');
    if (description.length > 160) throw fail('Keep the description to 160 characters or fewer.');
    let base = existing?.base;
    if (existing) { if (payload.base !== undefined && payload.base !== existing.base) throw roles.refusal('roleBase', {}, 400); }
    else {
      base = payload.base;
      if (!roles.ROLE_BASES.includes(base)) throw fail('Start the role from Editor or Channel owner.');
      if (data.roles.length >= ROLE_LIMIT) throw fail(`A studio can have up to ${ROLE_LIMIT} custom roles. Delete one first.`, 409);
    }
    const template = typeof payload.template === 'string' ? payload.template : '';
    let wanted = payload.capabilities !== undefined ? list(payload.capabilities) : existing ? existing.capabilities : null;
    if (!wanted) {
      const fromBuiltIn = ['editor', 'channel'].includes(template) ? accessPolicy().roles.get(template) : null;
      const fromTemplate = roles.ROLE_TEMPLATES.find((entry) => entry.id === template) || null;
      const source = fromBuiltIn ? { base: fromBuiltIn.base, capabilities: fromBuiltIn.capabilities } : fromTemplate;
      if (source && source.base !== base) throw fail('That starting point is for a different kind of role.');
      wanted = source ? [...source.capabilities] : [];
    }
    const capabilities = roles.validateCapabilities(wanted, base);
    const audit = [];
    const role = change(() => {
      const at = stamp();
      if (existing) {
        const changes = [];
        if (existing.label !== label) changes.push({ field: 'label', from: existing.label, to: label });
        if ((existing.description || '') !== description) changes.push({ field: 'description', from: existing.description || '', to: description });
        const was = new Set(existing.capabilities); const now = new Set(capabilities);
        for (const capId of roles.CAPABILITY_IDS) if (was.has(capId) !== now.has(capId)) changes.push({ field: 'capability', capability: capId, from: was.has(capId), to: now.has(capId) });
        Object.assign(existing, { label, description, capabilities, updatedAt: at });
        if (changes.length) { audit.push({ kind: 'role-changed', target: { type: 'role', id: existing.id, name: label }, changes, affected: membersWith(existing.id).filter((member) => !member.disabled).length }); bump(by, at); }
        return existing;
      }
      let roleId = '';
      do roleId = `role-${slug(label)}-${crypto.randomBytes(2).toString('hex')}`; while (data.roles.some((row) => row.id === roleId));
      const created = { id: roleId, label, description, base, capabilities, template, policyVersion: roles.POLICY_VERSION, createdAt: at, updatedAt: at, createdBy: actorOf(by) };
      data.roles.push(created);
      audit.push({ kind: 'role-created', target: { type: 'role', id: roleId, name: label }, changes: [{ field: 'base', from: '', to: base, toLabel: roles.ROLES.find((entry) => entry.id === base)?.label || base }, ...capabilities.filter((capId) => capId !== 'core').map((capId) => ({ field: 'capability', capability: capId, from: false, to: true }))], affected: 0 });
      bump(by, at);
      return created;
    });
    return { role: publicRole(role), access: accessSummary(), audit };
  }

  // Deletes a custom role. Anyone who has it moves to moveTo (a role of the same base) in the same write.
  function deleteRole(input = {}, by = {}) {
    const payload = input && typeof input === 'object' ? input : {};
    checkRev(payload.rev);
    const id = typeof payload.id === 'string' ? payload.id : '';
    if (roles.ROLE_IDS.includes(id)) throw fail('Built-in roles can’t be deleted.');
    const role = data.roles.find((row) => row.id === id);
    if (!role) throw fail('That role isn’t in the studio anymore. Reload and try again.', 404);
    const holders = membersWith(id);
    const moveTo = typeof payload.moveTo === 'string' && payload.moveTo ? payload.moveTo : '';
    if (holders.length && !moveTo) throw roles.refusal('roleInUse', { count: plural(holders.length, 'person', 'people') }, 409);
    const destination = moveTo ? roleDef(moveTo) : null;
    if (moveTo && (!destination || destination.id === id || destination.base !== role.base)) throw fail('Choose a role of the same kind to move them to.');
    const toLabel = destination?.label || '';
    const audit = [{ kind: 'role-deleted', target: { type: 'role', id, name: role.label }, changes: moveTo ? [{ field: 'role', from: id, to: moveTo, fromLabel: role.label, toLabel }] : [], affected: holders.length }];
    for (const member of holders) audit.push({ kind: 'member-changed', target: { type: 'member', id: member.id, name: member.name }, changes: [{ field: 'role', from: id, to: moveTo, fromLabel: role.label, toLabel }], affected: 1 });
    change(() => {
      const at = stamp();
      data.roles = data.roles.filter((row) => row !== role);
      for (const member of holders) Object.assign(member, { role: moveTo, updatedAt: at });
      bump(by, at);
    });
    return { ok: true, moved: holders.length, access: accessSummary(), audit };
  }

  // ---------- Members ----------
  const isServerAdmin = (email) => { const value = normEmail(email); return Boolean(value) && serverAdmins.has(value); };
  const record = (id) => (typeof id === 'string' && id ? data.members.find((member) => member.id === id) || null : null);
  const recordByEmail = (email) => { const value = normEmail(email); return value ? data.members.find((member) => normEmail(member.email) === value) || null : null; };
  const enabledAdmins = () => data.members.filter((member) => member.role === 'admin' && !member.disabled);
  // Members leave the store without their link hash; the token only ever matches inside memberByLinkToken.
  function publicMember(member) {
    if (!member) return null;
    const { link, ...rest } = member;
    return { ...copy(rest), channelId: rest.channelId ?? null, disabled: Boolean(rest.disabled), grants: [...list(rest.grants)], denies: [...list(rest.denies)], link: link ? { id: link.id, createdAt: link.createdAt, expiresAt: link.expiresAt ?? null, lastUsedAt: link.lastUsedAt || '' } : null, serverAdmin: isServerAdmin(rest.email) };
  }
  const listMembers = () => data.members.map(publicMember);
  const memberById = (id) => publicMember(record(id));
  const memberByEmail = (email) => publicMember(recordByEmail(email));

  // Saves a new member (no id) or changes one. `by` is the acting identity; email may be left out only on the Mac.
  // role is any role id: Admin, Editor, Channel owner or a custom role.
  function saveMember(input = {}, by = {}) {
    if (!input || typeof input !== 'object') throw fail('Add the person’s name and role.');
    const existing = input.id != null && input.id !== '' ? record(input.id) : null;
    if (input.id != null && input.id !== '' && !existing) throw fail('That person isn’t in the studio anymore.', 404);
    const pick = (key) => (input[key] !== undefined ? input[key] : existing?.[key]);
    const name = cleanName(pick('name'));
    if (!name || name.length > 120) throw fail('Enter a name of up to 120 characters.');
    const role = pick('role');
    const def = typeof role === 'string' ? roleDef(role) : null;
    if (!def) throw fail('Choose a role for this person.');
    const email = normEmail(pick('email'));
    if (email && (email.length > 254 || !EMAIL.test(email))) throw fail('Enter a work email like pat@company.com.');
    if (!email && by?.via !== 'desktop') throw fail('Add their work email so they can sign in.');
    if (email && data.members.some((member) => member !== existing && normEmail(member.email) === email)) throw fail('Someone in the studio already uses that email.', 409);
    const channelId = def.base === 'channel' ? pick('channelId') ?? null : null;
    if (def.base === 'channel' && !roles.isChannelId(channelId)) throw fail('Choose the channel this person owns.');
    const disabled = input.disabled !== undefined ? input.disabled === true : Boolean(existing?.disabled);
    if (existing) {
      const wasDisabled = Boolean(existing.disabled);
      if (isServerAdmin(existing.email) && (role !== existing.role || disabled !== wasDisabled || email !== normEmail(existing.email))) throw roles.refusal('serverAdmin');
      if (existing.id === by?.id && (role !== existing.role || (disabled && !wasDisabled))) throw roles.refusal('selfChange');
      if (existing.role === 'admin' && !wasDisabled && (role !== 'admin' || disabled) && !enabledAdmins().some((member) => member !== existing)) throw roles.refusal('lastAdmin');
    }
    if (isServerAdmin(email) && (role !== 'admin' || disabled)) throw roles.refusal('serverAdmin');
    return change(() => {
      const at = stamp();
      if (existing) {
        const pausing = disabled && !existing.disabled;
        // Their own access changes belonged to the old kind of role; an admin has none.
        const baseChanged = (roleDef(existing.role)?.base || null) !== def.base;
        Object.assign(existing, { name, email, role, channelId, disabled, updatedAt: at });
        if (baseChanged || def.base === 'admin') Object.assign(existing, { grants: [], denies: [] });
        if (pausing) { existing.link = null; delete data.prefs[existing.id]; }
        return publicMember(existing);
      }
      const member = { id: `member-${crypto.randomUUID()}`, name, email, role, channelId, disabled, grants: [], denies: [], createdAt: at, updatedAt: at, createdBy: actorOf(by), lastSeenAt: '', link: null };
      data.members.push(member);
      return publicMember(member);
    });
  }
  // Returns the removed member, so the caller can name them in the activity and access logs.
  function removeMember(id, by = {}) {
    const member = record(id);
    if (!member) throw fail('That person isn’t in the studio anymore.', 404);
    if (isServerAdmin(member.email)) throw roles.refusal('serverAdmin');
    if (member.id === by?.id) throw roles.refusal('selfChange');
    if (member.role === 'admin' && !member.disabled && !enabledAdmins().some((other) => other !== member)) throw roles.refusal('lastAdmin');
    const removed = publicMember(member);
    change(() => { data.members = data.members.filter((other) => other !== member); delete data.prefs[member.id]; });
    touched.delete(member.id);
    return removed;
  }
  // One person's own access changes on top of their role: { grants, denies } of capability ids (deny wins). Admins
  // have everything, so theirs can't be adjusted. Returns { member, audit }.
  function saveMemberAccess(input = {}, by = {}) {
    const payload = input && typeof input === 'object' ? input : {};
    const member = record(typeof payload.id === 'string' ? payload.id : '');
    if (!member) throw fail('That person isn’t in the studio anymore.', 404);
    if (isServerAdmin(member.email)) throw roles.refusal('serverAdmin');
    if (roleDef(member.role)?.base === 'admin') throw roles.refusal('adminAccess', {}, 400);
    if (member.id === by?.id) throw roles.refusal('selfChange');
    const next = cleanAccess(member.role, payload);
    const changes = accessChanges(member, next);
    if (!changes.length) return { member: publicMember(member), audit: [] };
    const saved = change(() => { const at = stamp(); Object.assign(member, { grants: next.grants, denies: next.denies, accessUpdatedAt: at, accessUpdatedBy: actorOf(by), updatedAt: at }); return publicMember(member); });
    return { member: saved, audit: [{ kind: 'member-access', target: { type: 'member', id: member.id, name: member.name }, changes, affected: 1 }] };
  }
  // Adds up to 50 people with one role (and channel, and optional access changes) in one write. Addresses that aren't
  // emails, repeat, or already belong to someone are skipped with a reason. makeLinks issues each new person a sign-in
  // link in the same write (the caller decides whether this studio uses links). Returns { members, links:[{ id, token,
  // expiresAt }], skipped:[{ email, reason }], audit }.
  function inviteMembers(input = {}, by = {}) {
    const payload = input && typeof input === 'object' ? input : {};
    const people = list(payload.people);
    if (!people.length || people.length > INVITE_LIMIT) throw fail(`Add between 1 and ${INVITE_LIMIT} email addresses.`);
    const def = typeof payload.role === 'string' ? roleDef(payload.role) : null;
    if (!def) throw fail('Choose a role for the people you invite.');
    const channelId = def.base === 'channel' ? payload.channelId ?? null : null;
    if (def.base === 'channel' && !roles.isChannelId(channelId)) throw fail('Choose the channel they own.');
    const access = cleanAccess(def.id, { grants: payload.grants, denies: payload.denies });
    const skipped = []; const adding = []; const seen = new Set();
    for (const person of people) {
      const raw = typeof person === 'string' ? person : person?.email;
      const email = normEmail(raw);
      if (!email || email.length > 254 || !EMAIL.test(email)) { skipped.push({ email: String(raw ?? '').slice(0, 254), reason: 'Not an email address' }); continue; }
      if (seen.has(email)) { skipped.push({ email, reason: 'Listed twice' }); continue; }
      seen.add(email);
      if (recordByEmail(email)) { skipped.push({ email, reason: 'Already in the studio' }); continue; }
      if (isServerAdmin(email) && def.id !== 'admin') { skipped.push({ email, reason: 'An admin in the server settings' }); continue; }
      const name = cleanName(typeof person === 'object' ? person?.name : '').slice(0, 120) || nameFromEmail(email);
      adding.push({ email, name });
    }
    if (!adding.length) return { members: [], links: [], skipped, audit: [] };
    const requested = Number(payload.linkDays ?? 30);
    const lifetime = Number.isFinite(requested) && requested >= 0 ? Math.min(3650, requested) : 30;
    const audit = []; const links = [];
    const members = change(() => {
      const at = stamp();
      return adding.map(({ email, name }) => {
        const member = { id: `member-${crypto.randomUUID()}`, name, email, role: def.id, channelId, disabled: false, grants: [...access.grants], denies: [...access.denies], createdAt: at, updatedAt: at, createdBy: actorOf(by), lastSeenAt: '', link: null };
        if (payload.makeLinks === true) {
          const token = crypto.randomBytes(32).toString('hex');
          member.link = { id: crypto.randomBytes(16).toString('hex'), hash: sha256(token), createdAt: at, expiresAt: lifetime ? new Date(clock() + lifetime * DAY_MS).toISOString() : null, lastUsedAt: '' };
          links.push({ id: member.id, token, expiresAt: member.link.expiresAt });
        }
        data.members.push(member);
        const added = auditForMember(null, member, roleLabel);
        audit.push({ ...added, changes: [...added.changes, ...accessChanges({}, access)] });
        if (member.link) audit.push({ kind: 'link-issued', target: { type: 'member', id: member.id, name }, changes: [], affected: 1 });
        return publicMember(member);
      });
    });
    return { members, links, skipped, audit };
  }

  // ---------- Personal sign-in links ----------
  // 32 random bytes, kept only as a SHA-256 hash. days 0 means the link never expires, and a fraction of a day is honoured
  // (0.5 is 12 hours, never "forever"); a new link replaces the old one, which signs out every device that used it. The
  // gate logs who made or turned off a link, so `by` is not stored here.
  function issueLink(id, by = {}, { days = 30 } = {}) {
    const member = record(id);
    if (!member) throw fail('That person isn’t in the studio anymore.', 404);
    if (member.disabled) throw fail('Turn this person back on before making a sign-in link.', 409);
    const requested = Number(days);
    const lifetime = Number.isFinite(requested) && requested >= 0 ? Math.min(3650, requested) : 30;
    const token = crypto.randomBytes(32).toString('hex');
    return change(() => {
      const createdAt = stamp();
      member.link = { id: crypto.randomBytes(16).toString('hex'), hash: sha256(token), createdAt, expiresAt: lifetime ? new Date(clock() + lifetime * DAY_MS).toISOString() : null, lastUsedAt: '' };
      member.updatedAt = createdAt;
      return { token, link: { createdAt, expiresAt: member.link.expiresAt, lastUsedAt: '' }, member: publicMember(member) };
    });
  }
  function revokeLink(id, by = {}) {
    const member = record(id);
    if (!member) throw fail('That person isn’t in the studio anymore.', 404);
    if (!member.link) return publicMember(member);
    return change(() => { member.link = null; member.updatedAt = stamp(); return publicMember(member); });
  }
  // Compares against every member's hash in constant time per hash, then refuses expired links and disabled members.
  function memberByLinkToken(token) {
    const value = typeof token === 'string' ? token.trim().toLowerCase() : '';
    if (!/^[0-9a-f]{64}$/.test(value)) return null;
    const digest = Buffer.from(sha256(value), 'hex');
    let found = null;
    for (const member of data.members) {
      const hash = member.link?.hash;
      if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) continue;
      if (crypto.timingSafeEqual(Buffer.from(hash, 'hex'), digest) && !found) found = member;
    }
    if (!found || found.disabled) return null;
    if (found.link.expiresAt && !(time(found.link.expiresAt) > clock())) return null;
    change(() => { const at = stamp(); found.link.lastUsedAt = at; found.lastSeenAt = at; });
    touched.set(found.id, clock());
    return { member: publicMember(found), linkId: found.link.id };
  }

  // ---------- Sign-in helpers ----------
  // role is the role's base (admin, editor or channel), which everything that sorts people by kind reads; roleId is
  // the role itself (a custom role's id). No role while disabled, or when their role no longer exists.
  function identityFor(member, via = 'link') {
    if (!member) return null;
    const disabled = Boolean(member.disabled);
    const def = disabled ? null : roleDef(member.role);
    const role = def?.base || null;
    return { id: member.id, name: member.name || localName(member.email), email: member.email || '', role, roleId: def?.id || null, channelId: role === 'channel' && roles.isChannelId(member.channelId) ? member.channelId : null, via, disabled, memberSince: member.createdAt || null };
  }
  // A trusted SSO email. STUDIO_ADMIN_EMAILS is authoritative: a listed email is always an enabled admin, created or
  // restored here if needed. A known member gets their role (none while disabled); anyone else is a guest with no role.
  function fromProxyEmail(value) {
    const email = normEmail(value);
    if (!email || email.length > 254 || !EMAIL.test(email)) return null;
    let member = recordByEmail(email);
    if (isServerAdmin(email) && (!member || member.role !== 'admin' || member.disabled || member.channelId)) {
      member = change(() => {
        const at = stamp();
        if (member) { Object.assign(member, { role: 'admin', channelId: null, disabled: false, grants: [], denies: [], updatedAt: at }); return member; }
        const created = { id: `member-${crypto.randomUUID()}`, name: localName(email), email, role: 'admin', channelId: null, disabled: false, grants: [], denies: [], createdAt: at, updatedAt: at, createdBy: actorOf(null), lastSeenAt: '', link: null };
        data.members.push(created); return created;
      });
    }
    if (member) return identityFor(member, 'proxy');
    return { id: `guest:${email}`, name: localName(email), email, role: null, roleId: null, channelId: null, via: 'proxy', disabled: false, memberSince: null };
  }
  // lastSeenAt stays current in memory and reaches the disk at most every 5 minutes per member. Best effort: a failed
  // write never fails the request that touched it.
  function touch(id) {
    const member = record(id); if (!member) return;
    const at = clock(); member.lastSeenAt = stamp();
    if (at - (touched.get(member.id) ?? -Infinity) < TOUCH_MS) return;
    touched.set(member.id, at);
    try { change(() => {}); } catch (error) { touched.delete(member.id); logEvent({ event: 'team-write-failed', what: 'last-seen', code: error.code || '' }); }
  }

  // ---------- Trend adoptions ----------
  // A bare domain gets https://; only http(s) links without credentials, up to 2,048 characters.
  function cleanLink(value) {
    let text = String(value ?? '').trim();
    if (!text) return '';
    if (!/^https?:\/\//i.test(text)) {
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) throw roles.refusal('badLink', {}, 400);
      text = `https://${text.replace(/^\/+/, '')}`;
    }
    let url;
    try { url = new URL(text); } catch (_) { throw roles.refusal('badLink', {}, 400); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !url.hostname.includes('.') || url.href.length > 2048) throw roles.refusal('badLink', {}, 400);
    return url.href;
  }
  // "2026-10-24" (a real calendar day) or '' for no planned date.
  function cleanPlannedFor(value) {
    if (value === null || value === '') return '';
    const text = typeof value === 'string' ? value.trim() : '';
    const parsed = DATE_ONLY.test(text) ? new Date(`${text}T00:00:00.000Z`) : null;
    if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) throw fail('Choose a planned date like 2026-10-24.');
    return text;
  }
  // One answer per workspace, trend and channel. status 'clear' deletes it. A link, note or planned date left out keeps
  // the saved one; Not for us clears the planned date. `by` and `at` record who gave the current answer and when,
  // updatedAt the last change of any kind.
  function setAdoption({ workspaceId, themeId, channelId, status, link, note, plannedFor, trendName } = {}, by = {}) {
    if (typeof workspaceId !== 'string' || !RECORD_ID.test(workspaceId)) throw fail('Choose a workspace first.');
    if (typeof themeId !== 'string' || !RECORD_ID.test(themeId)) throw fail('Choose a trend.');
    if (!roles.isChannelId(channelId)) throw fail('Choose a channel.');
    if (!['using', 'not-using', 'clear'].includes(status)) throw fail('Choose Using, Not for us or Clear.');
    const existing = data.adoptions.find((row) => row.workspaceId === workspaceId && row.themeId === themeId && row.channelId === channelId) || null;
    if (status === 'clear') {
      if (existing) change(() => { data.adoptions = data.adoptions.filter((row) => row !== existing); });
      return null;
    }
    const nextLink = link === undefined ? existing?.link || '' : cleanLink(link);
    const nextNote = note === undefined ? existing?.note || '' : String(note ?? '').trim();
    if (nextNote.length > 500) throw fail('Keep the note to 500 characters or fewer.');
    const nextPlanned = status === 'not-using' ? '' : plannedFor === undefined ? existing?.plannedFor || '' : cleanPlannedFor(plannedFor);
    const name = trendName === undefined || trendName === null ? existing?.trendName || '' : cleanName(trendName).slice(0, 200);
    return change(() => {
      const at = stamp(); const actor = actorOf(by);
      if (existing) {
        if (existing.status !== status) Object.assign(existing, { status, by: actor, at });
        Object.assign(existing, { link: nextLink, note: nextNote, plannedFor: nextPlanned, trendName: name || existing.trendName || '', updatedAt: at });
        return copy(existing);
      }
      const row = { id: `adoption-${crypto.randomUUID()}`, workspaceId, themeId, channelId, status, link: nextLink, note: nextNote, plannedFor: nextPlanned, trendName: name, by: actor, at, updatedAt: at };
      data.adoptions.push(row);
      return copy(row);
    });
  }
  const adoptionsFor = (workspaceId) => data.adoptions.filter((row) => row.workspaceId === workspaceId).map(copy);

  // ---------- Activity ----------
  // Details are small plain objects; anything that looks like a secret is dropped. A repeated adoption by the same person
  // for the same trend and channel within 10 minutes replaces their last row. Only the newest 5,000 rows are kept.
  function cleanDetail(detail) {
    if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return {};
    const json = JSON.stringify(detail, (key, value) => (key && SECRET_KEY.test(key) ? undefined : typeof value === 'string' ? value.slice(0, 500) : value)) || '{}';
    const parsed = JSON.parse(json);
    return json.length <= 4000 ? parsed : Object.fromEntries(Object.entries(parsed).filter(([, value]) => value === null || typeof value !== 'object'));
  }
  function log(kind, workspaceId = '', detail = {}, by = {}) {
    if (!ACTIVITY_KINDS.includes(kind)) throw fail('Unknown kind of activity.');
    const space = typeof workspaceId === 'string' ? workspaceId.slice(0, 180) : '';
    const clean = cleanDetail(detail); const actor = actorOf(by);
    return change(() => {
      const at = stamp(); const nowMs = clock();
      if (kind === 'adoption') {
        for (let index = data.activity.length - 1; index >= 0; index--) {
          const row = data.activity[index];
          if (!(nowMs - time(row.at) <= MERGE_MS)) break;
          if (row.kind === 'adoption' && row.workspaceId === space && row.by?.id === actor.id && row.detail?.themeId === clean.themeId && row.detail?.channelId === clean.channelId) {
            data.activity.splice(index, 1);
            const merged = { ...row, at, by: actor, detail: clean };
            data.activity.push(merged);
            return copy(merged);
          }
        }
      }
      const row = { id: `activity-${crypto.randomUUID()}`, workspaceId: space, at, by: actor, kind, detail: clean };
      data.activity.push(row);
      if (data.activity.length > ACTIVITY_LIMIT) data.activity.splice(0, data.activity.length - ACTIVITY_LIMIT);
      return copy(row);
    });
  }
  // Newest first. Studio-wide rows (people and links, logged without a workspace) show in every workspace.
  function activityFor(workspaceId, limit = 50) {
    const max = Math.max(1, Math.min(ACTIVITY_LIMIT, Math.floor(Number(limit)) || 50));
    const rows = workspaceId == null ? data.activity : data.activity.filter((row) => row.workspaceId === workspaceId || !row.workspaceId);
    return rows.slice(-max).reverse().map(copy);
  }

  // ---------- Access log ----------
  // Who changed people, roles and access: its own ring of 2,000 rows, so busy trend activity never pushes it out. Rows
  // are { id, at, by, kind, target:{ type, id, name }, changes:[{ field, capability?, from, to, fromLabel?, toLabel? }],
  // affected }; values are short strings, booleans or null, and nothing secret-shaped is kept.
  const cleanValue = (value) => (typeof value === 'boolean' || value === null ? value : typeof value === 'number' && Number.isFinite(value) ? value : String(value ?? '').slice(0, 200));
  function cleanAuditRow(row) {
    if (!row || typeof row !== 'object' || !AUDIT_KINDS.includes(row.kind)) return null;
    const targetType = row.target?.type === 'role' ? 'role' : 'member';
    const changes = list(row.changes).slice(0, 60).filter((entry) => entry && typeof entry.field === 'string' && !SECRET_KEY.test(entry.field)).map((entry) => ({
      field: entry.field.slice(0, 40), ...(roles.isCapability(entry.capability) ? { capability: entry.capability } : {}), from: cleanValue(entry.from), to: cleanValue(entry.to),
      ...(entry.fromLabel ? { fromLabel: String(entry.fromLabel).slice(0, 120) } : {}), ...(entry.toLabel ? { toLabel: String(entry.toLabel).slice(0, 120) } : {}),
    }));
    return { kind: row.kind, target: { type: targetType, id: String(row.target?.id || '').slice(0, 180), name: String(row.target?.name || '').slice(0, 120) }, changes, affected: Math.max(0, Math.floor(Number(row.affected) || 0)) };
  }
  // Writes rows in one change. Unknown kinds are dropped, never thrown: logging never fails what it describes.
  function audit(rows, by = {}) {
    const clean = list(rows).map(cleanAuditRow).filter(Boolean);
    if (!clean.length) return [];
    const actor = actorOf(by);
    return change(() => {
      const at = stamp();
      const written = clean.map((row) => ({ id: `audit-${crypto.randomUUID()}`, at, by: actor, ...row }));
      data.audit.push(...written);
      if (data.audit.length > AUDIT_LIMIT) data.audit.splice(0, data.audit.length - AUDIT_LIMIT);
      return written.map(copy);
    });
  }
  // Newest first, filtered and paged. before: an audit id (the `next` of the previous page) or an ISO time; memberId
  // matches rows about that person and rows they made; roleId matches rows about that role and moves into or out of it.
  function auditFor({ before, limit = 50, memberId, roleId, kinds } = {}) {
    const max = Math.max(1, Math.min(200, Math.floor(Number(limit)) || 50));
    const kindSet = new Set(list(kinds).filter((kind) => AUDIT_KINDS.includes(kind)));
    let end = data.audit.length;
    if (typeof before === 'string' && before) {
      const index = before.startsWith('audit-') ? data.audit.findIndex((row) => row.id === before) : -1;
      if (index >= 0) end = index;
      else if (Number.isFinite(time(before))) { const cut = time(before); end = data.audit.findIndex((row) => !(time(row.at) < cut)); if (end < 0) end = data.audit.length; }
    }
    const matches = (row) => (!kindSet.size || kindSet.has(row.kind))
      && (!memberId || (row.target?.type === 'member' && row.target.id === memberId) || row.by?.id === memberId)
      && (!roleId || (row.target?.type === 'role' && row.target.id === roleId) || list(row.changes).some((entry) => entry.field === 'role' && (entry.from === roleId || entry.to === roleId)));
    const rows = [];
    let index = end - 1;
    for (; index >= 0 && rows.length < max; index--) if (matches(data.audit[index])) rows.push(copy(data.audit[index]));
    let more = false;
    for (let rest = index; rest >= 0; rest--) if (matches(data.audit[rest])) { more = true; break; }
    return { rows, more, next: more && rows.length ? rows[rows.length - 1].id : '' };
  }

  // ---------- Preferences ----------
  // uiMode (simple or classic), welcomedAt and inboxSeenAt (dates, or '' to clear), focusChannels (the channels a
  // person works on) and navRail (the sidebar as icons; null follows the window width).
  const isoOr = (value) => (typeof value === 'string' && Number.isFinite(time(value)) ? value : '');
  function prefsFor(identityId) {
    const stored = typeof identityId === 'string' && own(data.prefs, identityId) ? data.prefs[identityId] : null;
    return {
      uiMode: UI_MODES.includes(stored?.uiMode) ? stored.uiMode : '', welcomedAt: typeof stored?.welcomedAt === 'string' ? stored.welcomedAt : '', inboxSeenAt: isoOr(stored?.inboxSeenAt),
      focusChannels: list(stored?.focusChannels).filter(roles.isChannelId), navRail: typeof stored?.navRail === 'boolean' ? stored.navRail : null,
    };
  }
  const dateOrBlank = (value) => (value === null || value === '' ? '' : typeof value === 'string' && Number.isFinite(time(value)) ? new Date(time(value)).toISOString() : null);
  // Every other field is ignored.
  function setPrefs(identityId, patch = {}) {
    if (typeof identityId !== 'string' || !IDENTITY_ID.test(identityId) || FORBIDDEN_KEYS.has(identityId)) throw fail('Sign in to save your preferences.', 401);
    const next = prefsFor(identityId); const input = patch && typeof patch === 'object' ? patch : {};
    if (input.uiMode !== undefined) { if (!UI_MODES.includes(input.uiMode)) throw fail('Choose Simple or Advanced.'); next.uiMode = input.uiMode; }
    for (const key of ['welcomedAt', 'inboxSeenAt']) {
      if (input[key] === undefined) continue;
      const value = dateOrBlank(input[key]);
      if (value === null) throw fail('Choose a valid date.');
      next[key] = value;
    }
    if (input.focusChannels !== undefined) {
      if (!Array.isArray(input.focusChannels) || input.focusChannels.some((id) => !roles.isChannelId(id))) throw fail('Choose channels from the list.');
      next.focusChannels = [...new Set(input.focusChannels)];
    }
    if (input.navRail !== undefined) { if (input.navRail !== null && typeof input.navRail !== 'boolean') throw fail('Choose whether the sidebar shows labels.'); next.navRail = input.navRail; }
    const current = prefsFor(identityId);
    if (JSON.stringify(current) === JSON.stringify(next)) return current;
    change(() => {
      const kept = Object.fromEntries(Object.entries(next).filter(([, value]) => (Array.isArray(value) ? value.length : typeof value === 'boolean' ? true : value)));
      if (Object.keys(kept).length) data.prefs[identityId] = kept; else delete data.prefs[identityId];
    });
    return prefsFor(identityId);
  }

  // ---------- Misc ----------
  const admins = () => enabledAdmins().map((member) => ({ id: member.id, name: member.name }));
  // One JSON line on stdout. index.js runs in vm sandboxes without `console`, so its logging comes here. Only flat values
  // are written, and never anything keyed or shaped like a token, hash, password or payload.
  function logEvent(event = {}) {
    const line = { at: stamp() };
    for (const [key, value] of Object.entries(event && typeof event === 'object' ? event : {})) {
      if (SECRET_KEY.test(key) || key === 'at') continue;
      if (typeof value === 'string') { if (!HEX_SECRET.test(value)) line[key] = value.slice(0, 300); }
      else if (value === null || typeof value === 'number' || typeof value === 'boolean') line[key] = value;
    }
    try { process.stdout.write(`${JSON.stringify(line)}\n`); } catch (_) { /* Logging never fails the work it describes. */ }
  }

  return {
    listMembers, memberById, memberByEmail, isServerAdmin, saveMember, removeMember, saveMemberAccess, inviteMembers,
    issueLink, revokeLink, memberByLinkToken,
    fromProxyEmail, identityFor, touch,
    accessPolicy, accessFor, accessSummary, roleLabel, saveRolePolicy, saveRole, deleteRole,
    setAdoption, adoptionsFor,
    log, activityFor, audit, auditFor,
    prefsFor, setPrefs,
    admins, logEvent,
  };
}

module.exports = { createTeamStore, migrate, auditForMember, nameFromEmail, TEAM_VERSION, ACTIVITY_KINDS, AUDIT_KINDS, AUDIT_LIMIT, ROLE_LIMIT };
