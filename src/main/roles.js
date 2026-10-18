'use strict';
// Roles policy for the main process: who may call which method, what a session's effective role is, and the state each
// role receives. Pure CommonJS; the data lives in ../shared/roles.json. The renderer never imports this file (Vite can't
// build a renderer import of CommonJS): it reads viewer.allowed, capabilities, nav, modes and hiddenPages from state.
//
// The model: every method belongs to one capability. A role is built on a base (admin, editor or channel); admins hold
// every capability, other roles hold their role's capabilities (built-in defaults adjusted by the team's role policy, or
// a custom role's own list), then each person's grants and denies (deny wins). Locked capabilities and those outside the
// base are dropped, core is always added, and a capability whose requirements are missing is removed. A channel-based
// role can only ever call channelSafeMethods. With no policy edits this reproduces the old fixed matrix exactly.
const POLICY = require('../shared/roles.json');
const kit = require('../shared/asset-kit');
const { buildChannelView, channelOf } = require('./channel-view');

const list = (value) => (Array.isArray(value) ? value : []);
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const freezeList = (value) => Object.freeze([...value]);
const ROLES = Object.freeze(POLICY.roles.map((role) => Object.freeze({ ...role })));
const ROLE_IDS = freezeList(ROLES.map((role) => role.id));
const BASES = freezeList(['admin', 'editor', 'channel']);
const ROLE_BASES = freezeList(['editor', 'channel']); // what a custom role may be built on
const COPY = Object.freeze({ ...POLICY.copy });
const POLICY_VERSION = Number(POLICY.policyVersion) || 1;
const CAPABILITY_GROUPS = Object.freeze(POLICY.capabilityGroups.map((group) => Object.freeze({ ...group })));
const CAPABILITIES = Object.freeze(POLICY.capabilities.map((cap) => Object.freeze({
  id: cap.id, group: cap.group, label: cap.label, description: cap.description, lock: cap.lock || '', spends: Boolean(cap.spends), projection: cap.projection || '',
  since: Number(cap.since) || 1, requires: freezeList(list(cap.requires)), defaults: freezeList(list(cap.defaults)), bases: freezeList(list(cap.bases)), methods: freezeList(list(cap.methods)),
})));
const CAPABILITY_IDS = freezeList(CAPABILITIES.map((cap) => cap.id));
const CAP_BY_ID = new Map(CAPABILITIES.map((cap) => [cap.id, cap]));
const CAP_OF_METHOD = Object.freeze(Object.fromEntries(CAPABILITIES.flatMap((cap) => cap.methods.map((method) => [method, cap.id]))));
const METHOD_NAMES = freezeList(CAPABILITIES.flatMap((cap) => cap.methods));
const CHANNEL_SAFE = new Set(POLICY.channelSafeMethods);
const CHANNEL_SAFE_METHODS = freezeList(POLICY.channelSafeMethods);
const NO_ROLE_METHODS = freezeList(POLICY.noRoleMethods);
const IDENTITY_METHODS = freezeList(POLICY.identityMethods);
const READ_METHODS = freezeList(POLICY.readMethods);
const ROLE_TEMPLATES = Object.freeze(POLICY.roleTemplates.map((template) => Object.freeze({ ...template, capabilities: freezeList(template.capabilities) })));
const UI_MODES = freezeList(['simple', 'classic']);
const EMPTY_NAV = Object.freeze({ main: Object.freeze([]), admin: Object.freeze([]), bottom: Object.freeze([]) });
const CUSTOM_ROLE_ID = /^role-[a-z0-9-]{1,48}$/;
const isChannelId = (value) => typeof value === 'string' && kit.KIT_FOLDERS.some((folder) => folder.id === value);
const isCapability = (id) => typeof id === 'string' && CAP_BY_ID.has(id);
const capLabel = (id) => CAP_BY_ID.get(id)?.label || id;

// "{name} saved…" → the copy text with its placeholders filled; an unknown key is used as the text itself.
function format(copyKey, vars = {}) {
  const template = own(COPY, copyKey) ? COPY[copyKey] : String(copyKey ?? '');
  return template.replace(/\{(\w+)\}/g, (_, name) => (vars && vars[name] != null ? String(vars[name]) : ''));
}
// A refusal people can read: the copy text, an HTTP status and the copy key as `code`.
function refusal(copyKey, vars, status = 403) {
  return Object.assign(new Error(format(copyKey, vars)), { status, code: copyKey });
}

// ---------- Capabilities ----------
// What a capability needs besides itself: its own requirements, plus See costs for paid work on an editor base (paid
// work shows its estimate before it starts). A channel base never needs costs: its sheets show minutes, never money.
const requirementsOf = (cap, base) => [...cap.requires, ...(base === 'editor' && cap.spends ? ['seeCosts'] : [])];
// Whether a base may ever hold a capability: admins hold everything; locked admin capabilities never leave admins.
const baseMayHold = (cap, base) => base === 'admin' || (cap.lock !== 'admin' && cap.bases.includes(base));
function close(set, base) {
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of [...set]) { const cap = CAP_BY_ID.get(id); if (requirementsOf(cap, base).some((need) => !set.has(need))) { set.delete(id); changed = true; } }
  }
  return set;
}
const sorted = (set) => [...set].sort();
// The capability set a base ends up with from a starting list: unknown ids and anything the base can't hold are
// dropped (a hand-edited team.json is harmless), core is added, and requirements are closed.
function settle(ids, base) {
  if (base === 'admin') return [...CAPABILITY_IDS].sort();
  if (!ROLE_BASES.includes(base)) return [];
  const set = new Set(list(ids).filter((id) => isCapability(id) && baseMayHold(CAP_BY_ID.get(id), base)));
  for (const cap of CAPABILITIES) if (cap.lock === 'always' && baseMayHold(cap, base)) set.add(cap.id);
  return sorted(close(set, base));
}
// Built-in defaults: the capabilities a built-in role starts with.
const defaultsFor = (roleId) => CAPABILITIES.filter((cap) => cap.defaults.includes(roleId)).map((cap) => cap.id);
const cleanIds = (value) => [...new Set(list(value).filter(isCapability))];

// ---------- The compiled policy ----------
// teamPolicy: { rev, builtIn: { editor?: { grant, deny }, channel?: { grant, deny } }, roles: [custom role] } from
// team.json. Returns a frozen { rev, key, roles: Map(id → role), list } where each role is { id, label, description,
// base, builtIn, template, raw (capabilities before closure), capabilities (closed, sorted), overrides?, policyVersion }.
function compilePolicy(teamPolicy = null) {
  const input = teamPolicy && typeof teamPolicy === 'object' ? teamPolicy : {};
  const builtIn = input.builtIn && typeof input.builtIn === 'object' ? input.builtIn : {};
  const roles = new Map();
  for (const role of ROLES) {
    const base = role.id;
    if (base === 'admin') { roles.set('admin', Object.freeze({ id: 'admin', label: role.label, description: role.description, base, builtIn: true, template: '', raw: freezeList(CAPABILITY_IDS), capabilities: freezeList(settle([], 'admin')), policyVersion: POLICY_VERSION })); continue; }
    const overrides = builtIn[base] && typeof builtIn[base] === 'object' ? builtIn[base] : {};
    const grant = cleanIds(overrides.grant); const deny = new Set(cleanIds(overrides.deny));
    const raw = [...new Set([...defaultsFor(base), ...grant])].filter((id) => !deny.has(id));
    roles.set(base, Object.freeze({ id: base, label: role.label, description: role.description, base, builtIn: true, template: '', raw: freezeList(raw), capabilities: freezeList(settle(raw, base)), overrides: Object.freeze({ grant: freezeList(grant.filter((id) => !deny.has(id))), deny: freezeList([...deny]) }), policyVersion: POLICY_VERSION }));
  }
  for (const role of list(input.roles)) {
    if (!role || typeof role.id !== 'string' || !CUSTOM_ROLE_ID.test(role.id) || roles.has(role.id) || !ROLE_BASES.includes(role.base)) continue;
    const raw = cleanIds(role.capabilities);
    roles.set(role.id, Object.freeze({
      id: role.id, label: String(role.label || 'Custom role').slice(0, 40), description: String(role.description || '').slice(0, 160), base: role.base, builtIn: false,
      template: typeof role.template === 'string' ? role.template : '', raw: freezeList(raw), capabilities: freezeList(settle(raw, role.base)), policyVersion: Number(role.policyVersion) || 1,
    }));
  }
  const rev = Number.isInteger(input.rev) && input.rev >= 0 ? input.rev : 0;
  const key = `${rev}:${[...roles.values()].map((role) => `${role.id}=${role.capabilities.join(',')}`).join(';')}`;
  return Object.freeze({ rev, key, roles, list: freezeList(roles.values()) });
}
const DEFAULT_POLICY = compilePolicy(null);
const policyOf = (compiled) => (compiled && compiled.roles instanceof Map ? compiled : DEFAULT_POLICY);
const roleOf = (roleId, compiled) => (typeof roleId === 'string' ? policyOf(compiled).roles.get(roleId) || null : null);
const isRoleId = (roleId, compiled) => Boolean(roleOf(roleId, compiled));
const baseOf = (roleId, compiled) => roleOf(roleId, compiled)?.base || null;

// The capabilities one person holds: their role's, plus their own grants, minus their denies (deny wins), then settled
// for the base. An unknown role holds nothing; an admin holds everything.
function capabilitiesFor({ roleId, grants = [], denies = [] } = {}, compiled) {
  const role = roleOf(roleId, compiled);
  if (!role) return [];
  if (role.base === 'admin') return [...role.capabilities];
  const deny = new Set(cleanIds(denies));
  const set = new Set([...role.raw, ...cleanIds(grants)].filter((id) => !deny.has(id)));
  return settle([...set], role.base);
}
// The methods a set of capabilities opens. A channel base only ever reaches the channel-safe methods.
function methodsFor(base, caps) {
  if (base === 'admin') return [...METHOD_NAMES];
  if (!ROLE_BASES.includes(base)) return [];
  const held = new Set(list(caps));
  return METHOD_NAMES.filter((method) => held.has(CAP_OF_METHOD[method]) && (base !== 'channel' || CHANNEL_SAFE.has(method)));
}
// subject: { roleId, base, capabilities, methods: Set } — who the gate checks a call against.
function subjectFor(access = {}, compiled) {
  const role = roleOf(access.roleId, compiled);
  if (!role) return { roleId: null, base: null, capabilities: [], methods: new Set() };
  const capabilities = capabilitiesFor(access, compiled);
  return { roleId: role.id, base: role.base, capabilities, methods: new Set(methodsFor(role.base, capabilities)) };
}
// Deny by default. Someone without a role may only load the app and its state; an admin may call anything, including a
// method no capability lists; anyone else only what their capabilities open.
function canCallAs(subject, method) {
  if (typeof method !== 'string' || !method) return false;
  if (!subject || !subject.base) return NO_ROLE_METHODS.includes(method);
  if (subject.base === 'admin') return true;
  if (!own(CAP_OF_METHOD, method)) return false;
  return subject.methods instanceof Set ? subject.methods.has(method) : list(subject.methods).includes(method);
}
// The refusal for a call the subject can't make: an admin-only (locked or unknown) method says so; a capability the
// base can never hold keeps the old wording; anything else names what's missing and who to ask.
function refusalFor(method, subject = {}, { admins = [] } = {}) {
  const cap = own(CAP_OF_METHOD, method) ? CAP_BY_ID.get(CAP_OF_METHOD[method]) : null;
  if (!cap || cap.lock === 'admin') return refusal('adminOnly');
  if (!cap.bases.includes(subject?.base)) return refusal('forbidden');
  return refusal('capabilityOff', { what: cap.label, admin: askWho(admins) });
}

// ---------- The old fixed matrix (built-in roles, no policy edits) ----------
const DEFAULT_SUBJECTS = Object.freeze(Object.fromEntries(ROLE_IDS.map((id) => [id, subjectFor({ roleId: id })])));
const METHOD_ROLES = Object.freeze(Object.fromEntries(METHOD_NAMES.map((method) => [method, freezeList(ROLE_IDS.filter((id) => DEFAULT_SUBJECTS[id].methods.has(method)))])));
const isRole = (value) => ROLE_IDS.includes(value);
function rolesFor(method) { return [...(own(METHOD_ROLES, method) ? METHOD_ROLES[method] : ['admin'])]; }
function canCall(role, method) {
  if (role == null) return canCallAs(null, method);
  if (!isRole(role)) return false;
  return canCallAs(DEFAULT_SUBJECTS[role], method);
}
// Admin-only for good: a locked capability, or a method no capability lists. Others can be granted to a role.
const isAdminOnly = (method) => { const cap = own(CAP_OF_METHOD, method) ? CAP_BY_ID.get(CAP_OF_METHOD[method]) : null; return !cap || cap.lock === 'admin'; };
// The methods a subject may call, shipped to the renderer as viewer.allowed. Identity methods follow the real subject,
// so an admin previewing a channel owner can still switch back; a preview allows only reads.
function allowedFor(subject, { preview = false, realSubject = subject } = {}) {
  return METHOD_NAMES.filter((method) => (IDENTITY_METHODS.includes(method) ? canCallAs(realSubject, method) : canCallAs(subject, method) && (!preview || READ_METHODS.includes(method))));
}
// An unknown role id calls nothing at all (not even the no-role methods), as canCall says.
const NOBODY = Object.freeze({ roleId: null, base: 'nobody', capabilities: Object.freeze([]), methods: new Set() });
function allowedMethods(role, { preview = false, realRole = preview ? 'admin' : role } = {}) {
  const subjectOf = (id) => (id == null ? null : isRole(id) ? DEFAULT_SUBJECTS[id] : NOBODY);
  return allowedFor(subjectOf(role), { preview, realSubject: subjectOf(realRole) });
}

// ---------- Effective role ----------
// View as can only lower privilege, and only a real admin's session carries it: any non-admin role (a channel base
// needs a real channel). A person preview ({ memberId }) is resolved by access.viewerFor, which passes the member's
// role and channel here. A demoted admin's old view-as is ignored. Returns { role (base), roleId, channelId }.
function effectiveRole(realRole, realChannelId, viewAs, compiled) {
  const real = roleOf(realRole, compiled);
  if (real?.base === 'admin' && viewAs && typeof viewAs === 'object') {
    const target = roleOf(viewAs.role, compiled);
    if (target && target.base === 'editor') return { role: 'editor', roleId: target.id, channelId: null };
    if (target && target.base === 'channel' && isChannelId(viewAs.channelId)) return { role: 'channel', roleId: target.id, channelId: viewAs.channelId };
  }
  if (!real) return { role: null, roleId: null, channelId: null };
  return { role: real.base, roleId: real.id, channelId: real.base === 'channel' && isChannelId(realChannelId) ? realChannelId : null };
}

// ---------- Pages ----------
// Nav, hidden pages and layouts from the capabilities. hiddenPages keeps roles.json's page order, so a default editor
// still gets exactly [settings, knowledge, analytics, people]; a channel base uses its own shell's pages.
function pagesFor(caps, base) {
  if (!base) return { nav: { main: [], admin: [], bottom: [] }, hiddenPages: [], modes: [] };
  const held = new Set(base === 'admin' ? CAPABILITY_IDS : list(caps));
  const shows = (map, id) => held.has(map[id]);
  if (base === 'channel') {
    const order = POLICY.navOrder.channel;
    return { nav: { main: order.main.filter((id) => shows(POLICY.channelPages, id)), admin: [], bottom: [] }, hiddenPages: Object.keys(POLICY.channelPages).filter((id) => !shows(POLICY.channelPages, id)), modes: ['simple'] };
  }
  const order = POLICY.navOrder.full; const pick = (ids) => ids.filter((id) => shows(POLICY.pages, id));
  const hiddenPages = [...Object.keys(POLICY.pages).filter((id) => !shows(POLICY.pages, id)), ...Object.keys(POLICY.pageGroups).filter((id) => !shows(POLICY.pageGroups, id))];
  return { nav: { main: pick(order.main), admin: pick(order.admin), bottom: pick(order.bottom) }, hiddenPages, modes: [...UI_MODES] };
}
const navFor = (role) => (isRole(role) ? pagesFor(DEFAULT_SUBJECTS[role].capabilities, role).nav : { main: [], admin: [], bottom: [] });
const viewModesFor = (role) => (isRole(role) ? pagesFor(DEFAULT_SUBJECTS[role].capabilities, role).modes : []);
const hiddenPagesFor = (role) => (isRole(role) ? pagesFor(DEFAULT_SUBJECTS[role].capabilities, role).hiddenPages : []);
const channelsFor = (editionId = 'general') => kit.kitFolders(editionId).map(({ id, name, short }) => ({ id, name, short }));

// Who to ask, by name: "Alex", "Alex or Riley", "Alex, Riley or Pat"; more than three, or none, falls back.
function askWho(admins, fallback = 'an admin') {
  const names = [...new Set(list(admins).map((admin) => String(admin?.name || '').trim()).filter(Boolean))];
  if (!names.length) return fallback;
  if (names.length > 3) return `${names.slice(0, 2).join(', ')} or another admin`;
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
}
// Who a preview shows, for copy.preview: "Riley", "Semrush Blog’s channel owner", "Channel reviewer for Semrush Blog",
// "an editor" or "the Viewer role".
function previewWho(viewer) {
  if (viewer?.previewName) return viewer.previewName;
  const custom = Boolean(viewer?.roleId) && !isRole(viewer.roleId);
  if (viewer?.role === 'channel') return custom ? `${viewer.roleLabel || 'Channel role'} for ${viewer.channelName || 'a channel'}` : `${viewer.channelName || 'a channel'}’s channel owner`;
  if (viewer?.role === 'editor') return custom ? `the ${viewer.roleLabel || 'custom'} role` : 'an editor';
  return 'an admin';
}

// ---------- Viewer ----------
const ISO = (value) => (typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : '');
function cleanPrefs(prefs, base) {
  const uiMode = base === 'channel' ? 'simple' : UI_MODES.includes(prefs?.uiMode) ? prefs.uiMode : '';
  return {
    uiMode, welcomedAt: typeof prefs?.welcomedAt === 'string' ? prefs.welcomedAt : '', inboxSeenAt: ISO(prefs?.inboxSeenAt),
    focusChannels: base === 'channel' ? [] : [...new Set(list(prefs?.focusChannels).filter(isChannelId))], navRail: typeof prefs?.navRail === 'boolean' ? prefs.navRail : null,
  };
}
// The signed-in person as the renderer and the gate see them. identity: { id, name, email, role (base), roleId?,
// channelId, via, disabled, memberSince }; session: { viewAs } (the web session entry, a proxy user's entry, or the
// desktop's module-level object); prefs: team-store prefsFor(identity.id); admins: team-store admins(), for askAdmin;
// policy: the compiled team policy; access: this person's { grants, denies }; previewMember: for a { memberId } View
// as, that member ({ id, name, role, channelId, grants, denies, disabled }), resolved by access.viewerFor.
function buildViewer({ identity = null, session = null, prefs = null, editionId = 'general', web = false, admins = [], policy = null, access = null, previewMember = null } = {}) {
  const compiled = policyOf(policy);
  const who = identity && typeof identity === 'object' ? identity : {};
  const realRoleDef = roleOf(who.roleId || who.role, compiled);
  const realBase = realRoleDef?.base || null;
  const realAccess = { roleId: realRoleDef?.id || null, grants: list(access?.grants), denies: list(access?.denies) };
  const realSubject = subjectFor(realAccess, compiled);
  // Who this session looks like: the real person, or (a real admin's View as) a role or one member.
  let target = { ...realAccess, channelId: realBase === 'channel' && isChannelId(who.channelId) ? who.channelId : null, previewName: '', memberId: '' };
  const viewAs = realBase === 'admin' && session?.viewAs && typeof session.viewAs === 'object' ? session.viewAs : null;
  if (viewAs?.memberId) {
    const member = previewMember && previewMember.id === viewAs.memberId && !previewMember.disabled ? previewMember : null;
    const def = member ? roleOf(member.role, compiled) : null;
    if (def && def.base !== 'admin' && (def.base === 'editor' || isChannelId(member.channelId))) target = { roleId: def.id, grants: list(member.grants), denies: list(member.denies), channelId: def.base === 'channel' ? member.channelId : null, previewName: String(member.name || ''), memberId: member.id };
  } else if (viewAs) {
    const seen = effectiveRole(realRoleDef?.id, null, viewAs, compiled);
    if (seen.role && seen.role !== 'admin') target = { roleId: seen.roleId, grants: [], denies: [], channelId: seen.channelId, previewName: '', memberId: '' };
  }
  const def = roleOf(target.roleId, compiled);
  const base = def?.base || null;
  const preview = realBase === 'admin' && base !== 'admin' && Boolean(def);
  const subject = preview ? subjectFor(target, compiled) : realSubject;
  const channels = channelsFor(editionId);
  const pages = pagesFor(subject.capabilities, base);
  const viewer = {
    id: String(who.id || ''), name: String(who.name || ''), email: String(who.email || ''),
    role: base, roleId: def?.id || null, base, realRole: realBase, realRoleId: realRoleDef?.id || null, realBase,
    roleLabel: def?.label || '', roleDescription: def?.description || '', capabilities: [...subject.capabilities],
    channelId: target.channelId, channelName: target.channelId ? channels.find((channel) => channel.id === target.channelId)?.name || null : null,
    via: String(who.via || ''), web: Boolean(web), disabled: Boolean(who.disabled), memberSince: who.memberSince || null,
    preview, viewAs: preview ? (target.memberId ? { memberId: target.memberId, role: target.roleId, channelId: target.channelId } : { role: target.roleId, channelId: target.channelId }) : null,
    prefs: cleanPrefs(prefs, base), nav: pages.nav, modes: pages.modes, hiddenPages: pages.hiddenPages, allowed: allowedFor(subject, { preview, realSubject }),
    askAdmin: askWho(admins),
  };
  // In a preview, `allowed` is reads only (the server refuses writes), so the renderer shows the previewed role's controls
  // from roleAllowed, disabled, instead of hiding them: an admin sees what an editor would. roleCapabilities is the role
  // before the person's own changes, so the banner can say "Editor, 2 changes".
  if (preview) {
    viewer.roleAllowed = allowedFor(subject);
    viewer.roleCapabilities = [...def.capabilities];
    viewer.previewName = target.previewName;
    viewer.previewChanges = changeCount(def.capabilities, subject.capabilities);
  }
  if (realBase === 'admin') {
    viewer.channels = channels;
    viewer.roles = compiled.list.map((role) => ({ id: role.id, label: role.label, base: role.base }));
  }
  return viewer;
}
const changeCount = (from, to) => { const a = new Set(from); const b = new Set(to); return [...a].filter((id) => !b.has(id)).length + [...b].filter((id) => !a.has(id)).length; };
// Everything a projection depends on besides the base state, for memoising one projection per kind of viewer. The
// viewer is small, so the whole of it is the key: nothing it carries can go stale.
const viewKey = (viewer) => JSON.stringify(viewer ?? null);

// ---------- State ----------
// { [themeId]: { [channelId]: { status, link, plannedFor, byName, at, channelName } } } for the active workspace.
// channelName is the edition's display name, because editors don't get viewer.channels but the reader still names who
// used a report.
function adoptionsByTheme(adoptions, workspaceId, editionId) {
  const names = new Map(channelsFor(editionId).map((channel) => [channel.id, channel.name]));
  const result = {};
  for (const row of list(adoptions)) {
    if (!row?.themeId || !row.channelId || (workspaceId && row.workspaceId && row.workspaceId !== workspaceId)) continue;
    (result[row.themeId] ||= {})[row.channelId] = { status: row.status, link: row.link || '', plannedFor: row.plannedFor || '', byName: row.by?.name || '', at: row.at || row.updatedAt || null, channelName: names.get(row.channelId) || row.channelId };
  }
  return result;
}
// Money, for a role without See costs: these keys (and any key ending in Usd) are removed wherever they appear.
const MONEY_KEYS = new Set(['receipts', 'receipt', 'estimate', 'budgets', 'imageCalls']);
// Any key ending in usd (estimateUsd, unitUsd, a plan item's usd) is money, whatever its case.
const isMoneyKey = (key) => MONEY_KEYS.has(key) || /usd$/i.test(key);
// Run status text can quote a budget or an estimate ("The AI budget ($2.00) is below the estimate of $3.40…"), and a
// scheduled program copies a run's message into lastError. Under these keys only, text with a dollar amount becomes
// one line without it; evidence posts and report text are left alone.
const MONEY_TEXT_KEYS = new Set(['message', 'warnings', 'error', 'lastError']);
const HAS_AMOUNT = /\$\s?\d/;
const NO_AMOUNT = 'This run’s budget needs attention. Ask someone who can see costs to raise it; finished steps are kept.';
function textWithoutMoney(entry) {
  if (typeof entry === 'string') return HAS_AMOUNT.test(entry) ? NO_AMOUNT : entry;
  if (Array.isArray(entry)) { const out = entry.map((item) => (typeof item === 'string' ? textWithoutMoney(item) : stripMoney(item))); return out.filter((item, index) => typeof item !== 'string' || out.indexOf(item) === index); }
  return stripMoney(entry);
}
// A new value without money fields; plain objects and arrays are copied, everything else is kept as it is.
function stripMoney(value) {
  if (Array.isArray(value)) return value.map(stripMoney);
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return value;
  const out = {};
  for (const [key, entry] of Object.entries(value)) if (!isMoneyKey(key)) out[key] = MONEY_TEXT_KEYS.has(key) ? textWithoutMoney(entry) : stripMoney(entry);
  return out;
}
// A viewer from an older host (no capabilities) keeps what editors always had.
const seesMoney = (viewer) => (viewer?.base || viewer?.role) === 'admin' || !Array.isArray(viewer?.capabilities) || viewer.capabilities.includes('seeCosts');
// Who saved which prompt, and their notes, is for roles that can open the Prompt Library.
const seesPrompts = (viewer) => (viewer?.base || viewer?.role) === 'admin' || !Array.isArray(viewer?.capabilities) || viewer.capabilities.includes('viewPrompts');
const holds = (viewer, id) => (viewer?.base || viewer?.role) === 'admin' || !Array.isArray(viewer?.capabilities) || viewer.capabilities.includes(id);

// The read capabilities' share of the state. The gate refuses their methods to a role without them, so the state
// doesn't carry the same records either. Without See research and evidence, runs and trends are cut to the names,
// dates and counts the asset library, calendar and report footers show; without data tools, the scrapers, datasets,
// dataset reports and missions are empty (same keys, so the pages that read them still render).
const pick = (value, keys) => { const out = {}; for (const key of keys) if (own(value, key) && value[key] !== undefined) out[key] = value[key]; return out; };
const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const RUN_OUTLINE = ['id', 'type', 'workspaceId', 'programId', 'title', 'origin', 'status', 'stage', 'createdAt', 'updatedAt', 'startedAt', 'finishedAt', 'approvedAt', 'scheduledFor', 'window', 'counts', 'reportRunIds', 'prompts'];
function runOutline(run) {
  if (!isRecord(run)) return run;
  const out = pick(run, RUN_OUTLINE);
  if (isRecord(run.createdBy)) out.createdBy = pick(run.createdBy, ['id', 'name']);
  if (isRecord(run.coverage)) out.coverage = pick(run.coverage, ['platformCounts', 'retainedCount']);
  if (isRecord(run.quickScan)) out.quickScan = pick(run.quickScan, ['topic']);
  for (const key of ['themes', 'discoveredThemes']) if (Array.isArray(run[key])) out[key] = run[key].filter(isRecord).map((theme) => pick(theme, ['id', 'name']));
  return out;
}
const NO_EVIDENCE = () => ({ total: 0, datasets: {}, sample: [] });
const DATA_TOOL_LISTS = ['recipes', 'runs', 'datasets', 'analyses', 'conversations', 'monitors', 'comparisons', 'intentRuns', 'cards', 'assets'];
const RESEARCH_LISTS = ['researchReviews', 'researchAudit', 'researchExports'];
// Every list and record in v5 emptied, its other values kept.
const emptied = (value) => Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined).map(([key, entry]) => [key, Array.isArray(entry) ? [] : entry && typeof entry === 'object' ? {} : entry]));
function withoutUnheld(state, viewer) {
  const research = holds(viewer, 'readResearch'); const data = holds(viewer, 'dataTools'); const automation = holds(viewer, 'readWorkflows');
  if (research && data && automation) return state;
  const out = { ...state }; const studio = { ...(isRecord(state.contentStudio) ? state.contentStudio : {}) };
  // Workflows and playbooks: same keys, nothing in them.
  if (!automation) for (const key of ['workflows', 'workflowRuns', 'playbooks']) if (own(studio, key)) studio[key] = [];
  if (!automation && own(studio, 'workflowSummary')) studio.workflowSummary = { active: 0, paused: 0, drafts: 0, waiting: 0 };
  if (!research) {
    if (Array.isArray(studio.researchRuns)) studio.researchRuns = studio.researchRuns.map(runOutline);
    if (Array.isArray(studio.themes)) studio.themes = studio.themes.filter(isRecord).map((theme) => pick(theme, ['id', 'workspaceId', 'name', 'status']));
    for (const key of RESEARCH_LISTS) if (Array.isArray(out[key])) out[key] = [];
    if (isRecord(out.v5)) out.v5 = { ...out.v5, ...(own(out.v5, 'evidence') ? { evidence: [] } : {}), evidenceSummary: NO_EVIDENCE() };
  }
  if (!data) {
    for (const key of DATA_TOOL_LISTS) if (Array.isArray(out[key])) out[key] = [];
    if (own(out, 'apifyCatalog')) out.apifyCatalog = { actors: [], syncedAt: '' };
    if (own(out, 'intelligence')) out.intelligence = {};
    if (isRecord(out.v5)) out.v5 = { ...emptied(out.v5), evidenceSummary: NO_EVIDENCE() };
    // A research program picks its datasets by name, so Manage research programs keeps that list.
    if (Array.isArray(studio.availableDatasets) && !holds(viewer, 'managePrograms')) studio.availableDatasets = [];
  }
  out.contentStudio = studio;
  return out;
}

// Notes on reports (report-notes.js): contentStudio.noteCounts { [assetId]: { open, total } } from the base, and
// contentStudio.noteMentions, this person's own mentions and replies, newest first (access.js passes them per person;
// inbox-model.js turns them into Inbox rows, unread while not read and newer than inboxSeenAt).
// A role without Read reports and assets gets neither; a channel owner gets only their own channel's assets and the trend
// briefs, the files access.js channelFile lets them read.
const NOTE_REPORTS = new Set(['evidence-report', 'editorial-toolkit']);
function channelNoteScope(studio, channelId, editionId) {
  const runs = new Map(list(studio.contentRuns).map((run) => [run?.id, run]));
  return new Set(list(studio.assets).filter((asset) => {
    const run = runs.get(asset?.runId);
    if (run?.kit) return channelOf(asset.deliverableId, editionId) === channelId;
    return asset?.kind === 'text' && NOTE_REPORTS.has(asset.deliverableId) && Boolean(run && run.status === 'succeeded' && run.themeId);
  }).map((asset) => asset.id));
}
// A person's items come from every workspace, so only those about the active workspace's reports are shown: one about a
// report in another workspace (or one hidden in single-workspace mode) couldn't be opened, and its excerpt stays there.
function notesView(studio, noteInbox, viewer, keep = null) {
  if (!holds(viewer, 'readAssets')) return { noteCounts: {}, noteMentions: [] };
  const counts = isRecord(studio.noteCounts) ? studio.noteCounts : {};
  const here = keep || new Set(list(studio.assets).map((asset) => asset?.id));
  const items = list(noteInbox?.items).filter((item) => isRecord(item) && here.has(item.assetId));
  return { noteCounts: Object.fromEntries(Object.entries(counts).filter(([id]) => !keep || keep.has(id))), noteMentions: items };
}

// The state a viewer receives. Always a new object; never writes `key: undefined`. Admin and editor bases get the full
// base plus where each trend is used, less what a read capability the role lacks covers (withoutUnheld) and without
// money when the role lacks See costs; a channel base gets only its channel's view; someone without a role gets nothing.
function projectState(base, viewer, { adoptions = [], admins = [], memberCount = 0, editionId, noteInbox = null } = {}) {
  const state = base && typeof base === 'object' ? base : {};
  const studio = state.contentStudio && typeof state.contentStudio === 'object' ? state.contentStudio : {};
  const role = BASES.includes(viewer?.base) ? viewer.base : isRole(viewer?.role) ? viewer.role : null;
  const team = { admins: list(admins).filter((admin) => admin?.name).map((admin) => ({ name: String(admin.name) })) };
  if (role === 'admin') team.memberCount = Number(memberCount) || 0;
  const active = list(studio.workspaces).find((workspace) => workspace.id === studio.activeWorkspaceId);
  const edition = editionId || active?.editionId || 'general';
  if (role === 'admin' || role === 'editor') {
    const { promptChanges, ...studioRest } = studio;
    // A person's own jobs (an Ask AI answer carries ownerId) reach only them, and nobody receives whose job it is.
    const ownJobs = Array.isArray(state.jobs) ? { jobs: state.jobs.filter((job) => job && (!job.ownerId || job.ownerId === viewer?.id)).map(({ ownerId: _ownerId, ...job }) => job) } : {};
    const full = withoutUnheld({ ...state, ...ownJobs, viewer, team, contentStudio: { ...studioRest, ...(promptChanges !== undefined && seesPrompts(viewer) ? { promptChanges } : {}), adoptionsByTheme: adoptionsByTheme(adoptions, studio.activeWorkspaceId, edition), ...notesView(studio, noteInbox, viewer) } }, viewer);
    if (seesMoney(viewer)) return full;
    const { viewer: _viewer, ...rest } = full;
    return { ...stripMoney(rest), viewer };
  }
  if (role !== 'channel') return { viewer, team, settings: {}, keys: {}, contentStudio: { workspaces: [] } };
  // "Earlier" depends on when this person joined, so it is off on the Mac and in an admin's preview.
  const memberSince = viewer.preview || viewer.via === 'desktop' ? null : viewer.memberSince || null;
  return {
    viewer, team, settings: { uiMode: 'simple' }, keys: {},
    contentStudio: {
      activeWorkspaceId: studio.activeWorkspaceId || '',
      workspaces: active ? [{ id: active.id, name: active.name || '', editionId: active.editionId || edition }] : [],
      capabilities: { imagesConfigured: Boolean(studio.capabilities?.imagesConfigured) },
      channelView: buildChannelView({ contentStudio: studio, adoptions, channelId: viewer.channelId, editionId: edition, viewerId: viewer.id, memberSince }),
      ...notesView(studio, noteInbox, viewer, channelNoteScope(studio, viewer.channelId, edition)),
    },
  };
}

// ---------- Policy edits ----------
// Checks a capability list for a base before it is saved: locked or out-of-base capabilities are refused with copy,
// and so is any capability whose requirements aren't in the list. Returns the cleaned, sorted list with core added.
function validateCapabilities(ids, base) {
  const wanted = [...new Set(list(ids))];
  for (const id of wanted) if (!isCapability(id)) throw Object.assign(new Error('That access option isn’t in this studio. Reload and try again.'), { status: 400 });
  for (const id of wanted) {
    const cap = CAP_BY_ID.get(id);
    if (cap.lock === 'admin') throw refusal('lockedCapability', { what: cap.label }, 400);
    if (!cap.bases.includes(base)) throw refusal(base === 'channel' ? 'notForChannelRoles' : 'lockedCapability', { what: cap.label }, 400);
  }
  const set = new Set(wanted);
  for (const cap of CAPABILITIES) if (cap.lock === 'always' && cap.bases.includes(base)) set.add(cap.id);
  for (const id of set) {
    const missing = requirementsOf(CAP_BY_ID.get(id), base).filter((need) => !set.has(need));
    if (missing.length) throw refusal('needsCapability', { what: capLabel(id), needs: missing.map((id) => `“${capLabel(id)}”`).join(' and ') }, 400);
  }
  return sorted(set);
}

module.exports = {
  ROLES, ROLE_IDS, BASES, ROLE_BASES, COPY, POLICY_VERSION, CAPABILITIES, CAPABILITY_IDS, CAPABILITY_GROUPS, CAP_OF_METHOD, CHANNEL_SAFE_METHODS, ROLE_TEMPLATES,
  METHOD_ROLES, METHOD_NAMES, NO_ROLE_METHODS, IDENTITY_METHODS, READ_METHODS, UI_MODES, EMPTY_NAV, DEFAULT_POLICY, CUSTOM_ROLE_ID,
  format, refusal, rolesFor, canCall, isAdminOnly, allowedMethods, effectiveRole, isChannelId, isCapability, capLabel,
  compilePolicy, capabilitiesFor, methodsFor, subjectFor, canCallAs, refusalFor, allowedFor, requirementsOf, defaultsFor, settle, validateCapabilities, roleOf, isRoleId, baseOf,
  pagesFor, navFor, viewModesFor, hiddenPagesFor, channelsFor, askWho, previewWho, buildViewer, viewKey, projectState, stripMoney, adoptionsByTheme,
};
