'use strict';
// Roles policy for the main process: who may call which method, what a session's effective role is, and the state each
// role receives. Pure CommonJS; the data lives in ../shared/roles.json. The renderer never imports this file (Vite can't
// build a renderer import of CommonJS): it reads viewer.allowed, nav, modes and hiddenPages from state instead.
const POLICY = require('../shared/roles.json');
const kit = require('../shared/asset-kit');
const { buildChannelView } = require('./channel-view');

const list = (value) => (Array.isArray(value) ? value : []);
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const ROLES = Object.freeze(POLICY.roles.map((role) => Object.freeze({ ...role })));
const ROLE_IDS = Object.freeze(ROLES.map((role) => role.id));
const COPY = Object.freeze({ ...POLICY.copy });
const ADMIN_ONLY = Object.freeze(['admin']);
const METHOD_ROLES = Object.freeze(Object.fromEntries(POLICY.methodRoles.flatMap((group) => group.methods.map((method) => [method, Object.freeze([...group.roles])]))));
const METHOD_NAMES = Object.freeze(Object.keys(METHOD_ROLES));
const NO_ROLE_METHODS = Object.freeze([...POLICY.noRoleMethods]);
const IDENTITY_METHODS = Object.freeze([...POLICY.identityMethods]);
const READ_METHODS = Object.freeze([...POLICY.readMethods]);
const UI_MODES = Object.freeze(['simple', 'classic']);
const EMPTY_NAV = Object.freeze({ main: [], admin: [], bottom: [] });
const isChannelId = (value) => typeof value === 'string' && kit.KIT_FOLDERS.some((folder) => folder.id === value);
const isRole = (value) => ROLE_IDS.includes(value);

// "{name} saved…" → the copy text with its placeholders filled; an unknown key is used as the text itself.
function format(copyKey, vars = {}) {
  const template = own(COPY, copyKey) ? COPY[copyKey] : String(copyKey ?? '');
  return template.replace(/\{(\w+)\}/g, (_, name) => (vars && vars[name] != null ? String(vars[name]) : ''));
}
// A refusal people can read: the copy text, an HTTP status and the copy key as `code`.
function refusal(copyKey, vars, status = 403) {
  return Object.assign(new Error(format(copyKey, vars)), { status, code: copyKey });
}

// Deny by default: a method missing from the table is admin-only, and someone signed in without a role may only load
// the app and its state.
function rolesFor(method) { return [...(own(METHOD_ROLES, method) ? METHOD_ROLES[method] : ADMIN_ONLY)]; }
function canCall(role, method) {
  if (typeof method !== 'string' || !method) return false;
  if (role == null) return NO_ROLE_METHODS.includes(method);
  if (!isRole(role)) return false;
  return (own(METHOD_ROLES, method) ? METHOD_ROLES[method] : ADMIN_ONLY).includes(role);
}
const isAdminOnly = (method) => rolesFor(method).every((role) => role === 'admin');
// The methods a session may call, shipped to the renderer as viewer.allowed. Identity methods follow the real role, so an
// admin previewing as a channel owner can still switch back; a preview allows only reads.
function allowedMethods(role, { preview = false, realRole = preview ? 'admin' : role } = {}) {
  return METHOD_NAMES.filter((method) => (IDENTITY_METHODS.includes(method) ? canCall(realRole, method) : canCall(role, method) && (!preview || READ_METHODS.includes(method))));
}

// View as can only lower privilege, and only a real admin's session carries it. A demoted admin's old view-as is ignored.
function effectiveRole(realRole, realChannelId, viewAs) {
  const role = isRole(realRole) ? realRole : null;
  if (role === 'admin' && viewAs && typeof viewAs === 'object') {
    if (viewAs.role === 'editor') return { role: 'editor', channelId: null };
    if (viewAs.role === 'channel' && isChannelId(viewAs.channelId)) return { role: 'channel', channelId: viewAs.channelId };
  }
  return { role, channelId: role === 'channel' && isChannelId(realChannelId) ? realChannelId : null };
}

const navFor = (role) => { const nav = isRole(role) ? POLICY.simpleNav[role] : EMPTY_NAV; return { main: [...nav.main], admin: [...nav.admin], bottom: [...nav.bottom] }; };
const viewModesFor = (role) => (isRole(role) ? [...POLICY.viewModes[role]] : []);
const hiddenPagesFor = (role) => (isRole(role) ? [...POLICY.hiddenPages[role]] : []);
const channelsFor = (editionId = 'general') => kit.kitFolders(editionId).map(({ id, name, short }) => ({ id, name, short }));

// Who to ask, by name: "Alex", "Alex or Riley", "Alex, Riley or Pat"; more than three, or none, falls back.
function askWho(admins, fallback = 'an admin') {
  const names = [...new Set(list(admins).map((admin) => String(admin?.name || '').trim()).filter(Boolean))];
  if (!names.length) return fallback;
  if (names.length > 3) return `${names.slice(0, 2).join(', ')} or another admin`;
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
}
// "Semrush Blog’s channel owner" or "an editor", for the preview banner and copy.preview.
function previewWho(viewer) {
  if (viewer?.role === 'channel') return `${viewer.channelName || 'a channel'}’s channel owner`;
  return viewer?.role === 'editor' ? 'an editor' : 'an admin';
}

// The signed-in person as the renderer and the gate see them. identity: { id, name, email, role, channelId, via, disabled,
// memberSince }; session: { viewAs } (the web session entry, a proxy user's entry, or the desktop's module-level object);
// prefs: team-store prefsFor(identity.id); admins: team-store admins(), for viewer.askAdmin.
function buildViewer({ identity = null, session = null, prefs = null, editionId = 'general', web = false, admins = [] } = {}) {
  const who = identity && typeof identity === 'object' ? identity : {};
  const realRole = isRole(who.role) ? who.role : null;
  const { role, channelId } = effectiveRole(realRole, who.channelId, session?.viewAs);
  const preview = realRole === 'admin' && role !== 'admin';
  const channels = channelsFor(editionId);
  const uiMode = role === 'channel' ? 'simple' : UI_MODES.includes(prefs?.uiMode) ? prefs.uiMode : '';
  const viewer = {
    id: String(who.id || ''), name: String(who.name || ''), email: String(who.email || ''),
    role, realRole, channelId, channelName: channelId ? channels.find((channel) => channel.id === channelId)?.name || null : null,
    via: String(who.via || ''), web: Boolean(web), disabled: Boolean(who.disabled), memberSince: who.memberSince || null,
    preview, viewAs: preview ? { role, channelId } : null,
    prefs: { uiMode, welcomedAt: typeof prefs?.welcomedAt === 'string' ? prefs.welcomedAt : '' },
    nav: navFor(role), modes: viewModesFor(role), hiddenPages: hiddenPagesFor(role), allowed: allowedMethods(role, { preview, realRole }),
    askAdmin: askWho(admins),
  };
  // In a preview, `allowed` is reads only (the server refuses writes), so the renderer shows the previewed role's controls
  // from roleAllowed, disabled, instead of hiding them: an admin sees what an editor would.
  if (preview) viewer.roleAllowed = allowedMethods(role);
  if (realRole === 'admin') viewer.channels = channels;
  return viewer;
}
// Everything a projection depends on besides the base state, for memoising one projection per kind of viewer.
const viewKey = (viewer) => [viewer?.id, viewer?.realRole, viewer?.role, viewer?.channelId, viewer?.prefs?.uiMode, viewer?.prefs?.welcomedAt, viewer?.preview ? 'preview' : '', viewer?.askAdmin].map((part) => part ?? '').join('|');

// { [themeId]: { [channelId]: { status, link, byName, at, channelName } } } for the active workspace. channelName is the
// edition's display name, because editors don't get viewer.channels but the reader still names who used a report.
function adoptionsByTheme(adoptions, workspaceId, editionId) {
  const names = new Map(channelsFor(editionId).map((channel) => [channel.id, channel.name]));
  const result = {};
  for (const row of list(adoptions)) {
    if (!row?.themeId || !row.channelId || (workspaceId && row.workspaceId && row.workspaceId !== workspaceId)) continue;
    (result[row.themeId] ||= {})[row.channelId] = { status: row.status, link: row.link || '', byName: row.by?.name || '', at: row.at || row.updatedAt || null, channelName: names.get(row.channelId) || row.channelId };
  }
  return result;
}

// The state a viewer receives. Always a new object; never writes `key: undefined`. Admins and editors get the full base
// plus where each trend is used; a channel owner gets only their channel's view; someone without a role gets nothing.
function projectState(base, viewer, { adoptions = [], admins = [], memberCount = 0, editionId } = {}) {
  const state = base && typeof base === 'object' ? base : {};
  const studio = state.contentStudio && typeof state.contentStudio === 'object' ? state.contentStudio : {};
  const role = isRole(viewer?.role) ? viewer.role : null;
  const team = { admins: list(admins).filter((admin) => admin?.name).map((admin) => ({ name: String(admin.name) })) };
  if (role === 'admin') team.memberCount = Number(memberCount) || 0;
  const active = list(studio.workspaces).find((workspace) => workspace.id === studio.activeWorkspaceId);
  const edition = editionId || active?.editionId || 'general';
  if (role === 'admin' || role === 'editor') return { ...state, viewer, team, contentStudio: { ...studio, adoptionsByTheme: adoptionsByTheme(adoptions, studio.activeWorkspaceId, edition) } };
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
    },
  };
}

module.exports = {
  ROLES, ROLE_IDS, COPY, METHOD_ROLES, METHOD_NAMES, NO_ROLE_METHODS, IDENTITY_METHODS, READ_METHODS, UI_MODES,
  format, refusal, rolesFor, canCall, isAdminOnly, allowedMethods, effectiveRole, isChannelId,
  navFor, viewModesFor, hiddenPagesFor, channelsFor, askWho, previewWho, buildViewer, viewKey, projectState,
};
