'use strict';
// The studio team: members and their roles, personal sign-in links, which channels use which trend, an activity log and
// per-person preferences, in content-studio/team.json (the folder the owner lock protects). CommonJS, Electron-free.
//
// Concurrency: every call is synchronous end to end, so nothing awaits between a read and its write. Only one process may
// own content-studio/, so the studio doesn't scale horizontally. Adoptions, like trend decisions, are last-write-wins and
// the UI shows who answered.
//
// Member lifecycle:
// - Remove keeps their adoptions and activity (both snapshot by.name) and deletes their prefs and sign-in link. Their
//   sessions end because identify() no longer finds them.
// - Disable is the same, but the record stays; they see "Your access to this studio is paused."
// - Re-adding an email creates a new id. A channel change leaves old answers with the channel.
// - Owners of one channel share one answer per trend ("Answered by <name>").
// - In proxy mode an email change means they sign in with the new address from then on.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const roles = require('./roles');

const TEAM_VERSION = 1;
// Upgrades keyed on the version they start from: { 1: (data) => ({ ...data, version: 2 }) }.
const MIGRATIONS = Object.freeze({});
const ACTIVITY_KINDS = Object.freeze(['trend-decision', 'adoption', 'kit-created', 'report-edited', 'report-restored', 'member-changed', 'link-issued', 'research-started']);
const ACTIVITY_LIMIT = 5000;
const TOUCH_MS = 5 * 60 * 1000;
const MERGE_MS = 10 * 60 * 1000;
const DAY_MS = 86400000;
const UI_MODES = ['simple', 'classic'];
const SECRET_KEY = /token|hash|password|secret|cookie|payload/i;
const HEX_SECRET = /^[0-9a-f]{32,}$/i;
const RECORD_ID = /^[a-zA-Z0-9_-]{1,180}$/;
const IDENTITY_ID = /^[\w:@.+-]{1,320}$/;
const EMAIL = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;
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

function migrate(data) {
  let next = data;
  while (next.version < TEAM_VERSION) {
    const step = MIGRATIONS[next.version];
    if (!step) throw new Error('Team data could not be read (content-studio/team.json). Restore it from a backup before starting.');
    next = step(next);
  }
  return next;
}

function createTeamStore({ root, now = () => new Date(), adminEmails = [] } = {}) {
  if (!root) throw new Error('Team data needs the studio data folder.');
  const target = path.join(root, 'team.json');
  const clock = () => new Date(now()).getTime();
  const stamp = () => new Date(now()).toISOString();
  const serverAdmins = new Set(list(adminEmails).map(normEmail).filter(Boolean));
  const unreadable = () => new Error('Team data could not be read (content-studio/team.json). Restore it from a backup before starting.');
  let data = load();
  // When each member's lastSeenAt last reached the disk; a restart counts the saved value.
  const touched = new Map(data.members.filter((member) => Number.isFinite(time(member.lastSeenAt))).map((member) => [member.id, time(member.lastSeenAt)]));

  // A missing file is an empty team (the file appears on the first write). Anything unreadable stops the studio rather
  // than starting with nobody in it.
  function load() {
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(target, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return { version: TEAM_VERSION, members: [], adoptions: [], activity: [], prefs: {} }; throw unreadable(); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw unreadable();
    const version = parsed.version ?? 1;
    if (!Number.isInteger(version) || version < 1) throw unreadable();
    if (version > TEAM_VERSION) throw new Error('This team file is from a newer Scraper Studio. Update the app or server.');
    const result = migrate({ ...parsed, version });
    for (const key of ['members', 'adoptions', 'activity']) { if (result[key] == null) result[key] = []; else if (!Array.isArray(result[key])) throw unreadable(); }
    if (result.prefs == null) result.prefs = {}; else if (typeof result.prefs !== 'object' || Array.isArray(result.prefs)) throw unreadable();
    if (result.members.some((member) => !member || typeof member.id !== 'string' || !member.id)) throw unreadable();
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
    try { const result = mutate(); writeFile(JSON.stringify(data, null, 2)); return result; }
    catch (error) { data = JSON.parse(before); throw error; }
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
    return { ...copy(rest), channelId: rest.channelId ?? null, disabled: Boolean(rest.disabled), link: link ? { id: link.id, createdAt: link.createdAt, expiresAt: link.expiresAt ?? null, lastUsedAt: link.lastUsedAt || '' } : null, serverAdmin: isServerAdmin(rest.email) };
  }
  const listMembers = () => data.members.map(publicMember);
  const memberById = (id) => publicMember(record(id));
  const memberByEmail = (email) => publicMember(recordByEmail(email));

  // Saves a new member (no id) or changes one. `by` is the acting identity; email may be left out only on the Mac.
  function saveMember(input = {}, by = {}) {
    if (!input || typeof input !== 'object') throw fail('Add the person’s name and role.');
    const existing = input.id != null && input.id !== '' ? record(input.id) : null;
    if (input.id != null && input.id !== '' && !existing) throw fail('That person isn’t in the studio anymore.', 404);
    const pick = (key) => (input[key] !== undefined ? input[key] : existing?.[key]);
    const name = cleanName(pick('name'));
    if (!name || name.length > 120) throw fail('Enter a name of up to 120 characters.');
    const role = pick('role');
    if (!roles.ROLE_IDS.includes(role)) throw fail('Choose Admin, Editor or Channel owner.');
    const email = normEmail(pick('email'));
    if (email && (email.length > 254 || !EMAIL.test(email))) throw fail('Enter a work email like pat@company.com.');
    if (!email && by?.via !== 'desktop') throw fail('Add their work email so they can sign in.');
    if (email && data.members.some((member) => member !== existing && normEmail(member.email) === email)) throw fail('Someone in the studio already uses that email.', 409);
    const channelId = role === 'channel' ? pick('channelId') ?? null : null;
    if (role === 'channel' && !roles.isChannelId(channelId)) throw fail('Choose the channel this person owns.');
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
        Object.assign(existing, { name, email, role, channelId, disabled, updatedAt: at });
        if (pausing) { existing.link = null; delete data.prefs[existing.id]; }
        return publicMember(existing);
      }
      const member = { id: `member-${crypto.randomUUID()}`, name, email, role, channelId, disabled, createdAt: at, updatedAt: at, createdBy: actorOf(by), lastSeenAt: '', link: null };
      data.members.push(member);
      return publicMember(member);
    });
  }
  // Returns the removed member, so the caller can name them in the activity log.
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
  function identityFor(member, via = 'link') {
    if (!member) return null;
    const disabled = Boolean(member.disabled);
    const role = disabled || !roles.ROLE_IDS.includes(member.role) ? null : member.role;
    return { id: member.id, name: member.name || localName(member.email), email: member.email || '', role, channelId: role === 'channel' && roles.isChannelId(member.channelId) ? member.channelId : null, via, disabled, memberSince: member.createdAt || null };
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
        if (member) { Object.assign(member, { role: 'admin', channelId: null, disabled: false, updatedAt: at }); return member; }
        const created = { id: `member-${crypto.randomUUID()}`, name: localName(email), email, role: 'admin', channelId: null, disabled: false, createdAt: at, updatedAt: at, createdBy: actorOf(null), lastSeenAt: '', link: null };
        data.members.push(created); return created;
      });
    }
    if (member) return identityFor(member, 'proxy');
    return { id: `guest:${email}`, name: localName(email), email, role: null, channelId: null, via: 'proxy', disabled: false, memberSince: null };
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
  // One answer per workspace, trend and channel. status 'clear' deletes it. A link or note left out keeps the saved one;
  // `by` and `at` record who gave the current answer and when, updatedAt the last change of any kind.
  function setAdoption({ workspaceId, themeId, channelId, status, link, note, trendName } = {}, by = {}) {
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
    const name = trendName === undefined || trendName === null ? existing?.trendName || '' : cleanName(trendName).slice(0, 200);
    return change(() => {
      const at = stamp(); const actor = actorOf(by);
      if (existing) {
        if (existing.status !== status) Object.assign(existing, { status, by: actor, at });
        Object.assign(existing, { link: nextLink, note: nextNote, trendName: name || existing.trendName || '', updatedAt: at });
        return copy(existing);
      }
      const row = { id: `adoption-${crypto.randomUUID()}`, workspaceId, themeId, channelId, status, link: nextLink, note: nextNote, trendName: name, by: actor, at, updatedAt: at };
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

  // ---------- Preferences ----------
  function prefsFor(identityId) {
    const stored = typeof identityId === 'string' && own(data.prefs, identityId) ? data.prefs[identityId] : null;
    return { uiMode: UI_MODES.includes(stored?.uiMode) ? stored.uiMode : '', welcomedAt: typeof stored?.welcomedAt === 'string' ? stored.welcomedAt : '' };
  }
  // Only uiMode (simple or classic) and welcomedAt (a date, or '' to clear) are kept; every other field is ignored.
  function setPrefs(identityId, patch = {}) {
    if (typeof identityId !== 'string' || !IDENTITY_ID.test(identityId) || FORBIDDEN_KEYS.has(identityId)) throw fail('Sign in to save your preferences.', 401);
    const next = prefsFor(identityId); const input = patch && typeof patch === 'object' ? patch : {};
    if (input.uiMode !== undefined) { if (!UI_MODES.includes(input.uiMode)) throw fail('Choose Simple or Advanced.'); next.uiMode = input.uiMode; }
    if (input.welcomedAt !== undefined) {
      const value = input.welcomedAt === null || input.welcomedAt === '' ? '' : typeof input.welcomedAt === 'string' && Number.isFinite(time(input.welcomedAt)) ? new Date(time(input.welcomedAt)).toISOString() : null;
      if (value === null) throw fail('Choose a valid date.');
      next.welcomedAt = value;
    }
    const current = prefsFor(identityId);
    if (current.uiMode === next.uiMode && current.welcomedAt === next.welcomedAt) return current;
    change(() => {
      const kept = Object.fromEntries(Object.entries(next).filter(([, value]) => value));
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
    listMembers, memberById, memberByEmail, isServerAdmin, saveMember, removeMember,
    issueLink, revokeLink, memberByLinkToken,
    fromProxyEmail, identityFor, touch,
    setAdoption, adoptionsFor,
    log, activityFor,
    prefsFor, setPrefs,
    admins, logEvent,
  };
}

module.exports = { createTeamStore, migrate, TEAM_VERSION, ACTIVITY_KINDS };
