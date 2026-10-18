import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { methods } from '../src/shared/studio-api-channels.json';
import policy from '../src/shared/roles.json';
import roles from '../src/main/roles.js';
import accessModule from '../src/main/access.js';
import teamStoreModule from '../src/main/team-store.js';
import kit from '../src/shared/asset-kit.js';
import fixture from './fixtures/roles-state.js';
const { createTeamStore } = teamStoreModule;
const roots = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

// The handlers §5.5 adds; studio-api-channels.json gains them alongside this policy.
const NEW_METHODS = ['getTeam', 'saveMember', 'removeMember', 'createSignInLink', 'revokeSignInLink', 'setViewAs', 'setViewPrefs', 'setTrendAdoption', 'getTrendAnalytics', 'editStudioAsset', 'restoreStudioAsset'];
// Methods that run other methods: each must be at least as restricted as everything it can run.
const COMPOSITES = {
  // A workflow run starts, decides, continues, makes, stops and retries the studio's own work (as its owner, re-checked).
  runWorkflow: ['startResearchRun', 'startQuickScan', 'decideResearchTheme', 'approveResearchThemes', 'continueResearchRun', 'createAssetKit'],
  retryWorkflowRun: ['startResearchRun', 'startQuickScan', 'decideResearchTheme', 'approveResearchThemes', 'continueResearchRun', 'createAssetKit', 'retryStudioRun'],
  cancelWorkflowRun: ['cancelStudioRun'], searchSources: ['saveRecipe', 'runRecipe'],
  createAssetKit: ['planAssetKit'], askHelp: ['readStudioAsset', 'readStudioRun'],
  saveContentWorkspace: ['selectContentWorkspace'], saveBrandProfile: ['selectBrandProfile'],
  applySetup: ['saveKey', 'saveResearchProgram', 'saveContentWorkspace', 'selectContentWorkspace', 'saveWorkspaceTaxonomy', 'saveReferenceDoc', 'importProductRegistry'],
  archiveAndClearSheets: ['exportDatasetToSheets'], importWorkingSheets: ['importDataset'],
};
const WRITERS = ['saveSettings', 'saveKey', 'createAssetKit', 'startResearchRun', 'setTrendAdoption', 'editStudioAsset', 'cancelStudioRun', 'retryStudioRun', 'saveMember', 'decideResearchTheme', 'removeWorkbook', 'saveWorkbookEdits', 'exportStudioRun', 'selectContentWorkspace'];

function walk(value, visit, trail = []) {
  visit(value, trail);
  if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) walk(child, visit, [...trail, key]);
}
const undefinedPaths = (value) => { const found = []; walk(value, (entry, trail) => { if (entry === undefined) found.push(trail.join('.')); }); return found; };
const keysIn = (value) => { const found = new Set(); walk(value, (entry) => { if (entry && typeof entry === 'object' && !Array.isArray(entry)) for (const key of Object.keys(entry)) found.add(key); }); return found; };
const stringsIn = (value) => { const found = []; walk(value, (entry) => { if (typeof entry === 'string') found.push(entry); }); return found; };

const identities = {
  admin: { id: 'member-chris', name: 'Chris', email: 'chris@semrush.com', role: 'admin', channelId: null, via: 'proxy', disabled: false, memberSince: fixture.at('08-01') },
  editor: { id: 'member-riley', name: 'Riley', email: 'riley@semrush.com', role: 'editor', channelId: null, via: 'link', disabled: false, memberSince: fixture.at('08-02') },
  channel: { id: 'member-alex', name: 'Alex', email: 'alex@semrush.com', role: 'channel', channelId: 'blog', via: 'link', disabled: false, memberSince: fixture.at('10-01') },
  guest: { id: 'guest:pat@semrush.com', name: 'pat', email: 'pat@semrush.com', role: null, channelId: null, via: 'proxy', disabled: false, memberSince: null },
};
const viewerFor = (who, session = null, prefs = { uiMode: 'classic', welcomedAt: '' }) => roles.buildViewer({ identity: identities[who], session, prefs, editionId: 'semrush', web: true, admins: [{ id: 'member-chris', name: 'Chris' }] });
const project = (viewer) => roles.projectState(fixture.baseState(), viewer, { adoptions: fixture.adoptions(), admins: [{ id: 'member-chris', name: 'Chris' }], memberCount: 5, editionId: 'semrush', now: new Date('2026-10-16T12:00:00Z') });

// Every capability a capability needs, all the way down (its requires, plus See costs for paid work on an editor base).
function needsOf(id, base = 'editor', seen = new Set()) {
  const cap = roles.CAPABILITIES.find((entry) => entry.id === id);
  for (const need of roles.requirementsOf(cap, base)) if (!seen.has(need)) { seen.add(need); needsOf(need, base, seen); }
  return seen;
}

describe('method policy', () => {
  it('puts every studio method in exactly one capability, plus the new team methods', () => {
    const listed = policy.capabilities.flatMap((cap) => cap.methods);
    expect(listed.length).toBe(new Set(listed).size);
    expect(new Set(listed)).toEqual(new Set([...Object.keys(methods), ...NEW_METHODS]));
    for (const method of Object.keys(methods)) expect(listed.filter((entry) => entry === method)).toHaveLength(1);
    const ids = policy.capabilities.map((cap) => cap.id);
    expect(ids).toHaveLength(28);
    expect(new Set(ids).size).toBe(ids.length);
    const groups = policy.capabilityGroups.map((group) => group.id);
    for (const cap of policy.capabilities) {
      expect(groups).toContain(cap.group);
      expect(cap.defaults.every((role) => roles.ROLE_IDS.includes(role))).toBe(true);
      expect(cap.defaults).toContain('admin');
      expect(cap.bases.every((base) => ['editor', 'channel'].includes(base))).toBe(true);
      for (const need of cap.requires || []) expect(ids).toContain(need);
      for (const role of ['editor', 'channel']) if (cap.defaults.includes(role)) expect({ cap: cap.id, role, base: cap.bases.includes(role) }).toEqual({ cap: cap.id, role, base: true });
      if (cap.lock === 'admin') { expect(cap.defaults).toEqual(['admin']); expect(cap.bases).toEqual([]); }
      if (cap.lock === 'always') { expect(cap.defaults).toEqual(['admin', 'editor', 'channel']); expect(cap.bases).toEqual(['editor', 'channel']); }
    }
    expect(policy.capabilities.filter((cap) => cap.lock === 'admin').map((cap) => cap.id)).toEqual(['settings', 'manageAccess']);
    expect(roles.CAP_OF_METHOD.setPromptLock).toBe('settings');
    expect(roles.CAP_OF_METHOD.saveRolePolicy).toBe('manageAccess');
    expect(roles.CAP_OF_METHOD.setAssetStatus).toBe('editReports');
    expect(roles.CAP_OF_METHOD.savePromptVersion).toBe('editPrompts');
    expect(roles.CAP_OF_METHOD.listPrompts).toBe('viewPrompts');
  });

  it('reproduces the old fixed matrix exactly with no policy edits', () => {
    const counts = Object.fromEntries(roles.ROLE_IDS.map((role) => [role, roles.METHOD_NAMES.filter((method) => roles.canCall(role, method)).length]));
    expect(counts).toEqual({ admin: 187, editor: 116, channel: 19 }); // + Google Drive folder sync (7 admin: connect, save, test, backfill, retry, disconnect, log); + the report editor and notes (8 new; channel: open, close, list and the three note methods); + readTrendPosts (readResearch); + AI connections and routing (settings, managePrograms); + cancelAsk and readAskProgress (askAi); Monday.com: +8 admin (10 new, saveMondayBoard and clearMondayBoard gone), +2 editor (readMondaySyncLog, readMondayItem); Workflows: +13 new (9 editor), 16 legacy mission, intent and card methods gone (15 editor)
    expect(roles.capabilitiesFor({ roleId: 'channel' })).toEqual(['commentReports', 'core', 'makeAssets', 'manageRuns', 'markTrendsUsed', 'readAssets']);
    expect(roles.capabilitiesFor({ roleId: 'editor' })).toEqual(['approveTrends', 'askAi', 'commentReports', 'core', 'dataTools', 'editPrompts', 'editReports', 'exportPublish', 'makeAssets', 'manageRuns', 'manageWorkflows', 'quickScans', 'readAssets', 'readResearch', 'readWorkflows', 'seeCosts', 'sheets', 'startResearch', 'viewPrompts', 'writeReports']);
    expect(roles.capabilitiesFor({ roleId: 'admin' })).toHaveLength(28);
    // Editors see and edit prompts by default; locking a prompt stays an admin's.
    for (const method of ['listPrompts', 'readPrompt', 'previewPrompt', 'savePromptVersion', 'revertPrompt', 'testPrompt', 'setAssetStatus']) expect(roles.canCall('editor', method)).toBe(true);
    for (const method of ['setPromptLock', 'saveRolePolicy', 'saveRole', 'deleteRole', 'saveMemberAccess', 'inviteMembers', 'readAccessLog', 'previewAccess']) expect(roles.canCall('editor', method)).toBe(false);
  });

  it('keeps a composite method’s capability the same as, or requiring, everything it runs', () => {
    for (const [composite, inner] of Object.entries(COMPOSITES)) for (const method of inner) {
      const outer = roles.CAP_OF_METHOD[composite]; const cap = roles.CAP_OF_METHOD[method];
      const locked = roles.CAPABILITIES.find((entry) => entry.id === outer).lock === 'admin';
      expect({ composite, method, ok: locked || outer === cap || needsOf(outer).has(cap) }).toMatchObject({ ok: true });
    }
  });

  it('lets a channel-based role reach only the core methods and the methods with a channel scope', () => {
    const core = policy.capabilities.find((cap) => cap.id === 'core').methods;
    expect(new Set(policy.channelSafeMethods)).toEqual(new Set([...core, ...accessModule.SCOPE_METHODS.channel]));
    expect(roles.CHANNEL_SAFE_METHODS).toEqual(policy.channelSafeMethods);
  });

  it('maps every page to a capability, with data tools as one group', () => {
    const ids = new Set(policy.capabilities.map((cap) => cap.id));
    for (const map of [policy.pages, policy.pageGroups, policy.channelPages]) for (const cap of Object.values(map)) expect(ids.has(cap)).toBe(true);
    expect(policy.pages.prompts).toBe('viewPrompts');
    expect(policy.pageGroups).toEqual({ 'data-tools': 'dataTools' });
    for (const template of policy.roleTemplates) expect(roles.settle(template.capabilities, template.base)).toEqual([...new Set([...template.capabilities, 'core'])].sort());
  });

  it('keeps identity and read methods to classified methods, and no write among the reads', () => {
    for (const method of [...policy.identityMethods, ...policy.readMethods, ...policy.noRoleMethods]) expect(roles.METHOD_NAMES).toContain(method);
    for (const method of WRITERS) expect(policy.readMethods).not.toContain(method);
    expect(policy.identityMethods).toEqual(['appMeta', 'state', 'setViewAs', 'setViewPrefs']);
  });

  it('lets each role call only its methods, and treats an unknown method as admin-only', () => {
    expect(roles.canCall('admin', 'saveSettings')).toBe(true);
    expect(roles.canCall('admin', 'someFutureMethod')).toBe(true);
    expect(roles.canCall('editor', 'someFutureMethod')).toBe(false);
    expect(roles.canCall('editor', 'startResearchRun')).toBe(true);
    expect(roles.canCall('editor', 'saveResearchProgram')).toBe(false);
    expect(roles.canCall('editor', 'saveSettings')).toBe(false);
    expect(roles.canCall('editor', 'setTrendAdoption')).toBe(false);
    expect(roles.canCall('channel', 'createAssetKit')).toBe(true);
    expect(roles.canCall('channel', 'setTrendAdoption')).toBe(true);
    for (const method of ['askHelp', 'startResearchRun', 'saveSettings', 'readStudioRun', 'exportStudioRun', 'publishStudioRun']) expect(roles.canCall('channel', method)).toBe(false);
    expect(roles.canCall(null, 'state')).toBe(true);
    expect(roles.canCall(null, 'appMeta')).toBe(true);
    expect(roles.canCall(null, 'contentCatalog')).toBe(false);
    expect(roles.canCall('owner', 'state')).toBe(false);
    expect(roles.canCall('admin', '')).toBe(false);
    expect(roles.canCall('admin', '__proto__')).toBe(true); // unknown → admin-only, never a prototype lookup
    expect(roles.canCall('editor', 'constructor')).toBe(false);
    expect(roles.isAdminOnly('setViewAs')).toBe(true);
    expect(roles.isAdminOnly('askHelp')).toBe(false);
    // Admin-only by default, but a role can be given it: not "Only an admin can do that".
    expect(roles.isAdminOnly('saveResearchProgram')).toBe(false);
    expect(roles.isAdminOnly('someFutureMethod')).toBe(true);
  });

  it('ships the allowed methods per role, and only reads while previewing', () => {
    expect(roles.allowedMethods(null)).toEqual(['appMeta', 'state']);
    expect(roles.allowedMethods('channel').sort()).toEqual(['appMeta', 'cancelStudioRun', 'closeReportDoc', 'contentCatalog', 'createAssetKit', 'deleteReportNote', 'listReportNotes', 'openReportDoc', 'openSourceUrl', 'openStudioAsset', 'planAssetKit', 'readStudioAsset', 'resolveReportNote', 'retryStudioRun', 'saveAssetKitFolder', 'saveReportNote', 'setTrendAdoption', 'setViewPrefs', 'state']);
    expect(roles.allowedMethods('admin')).toHaveLength(roles.METHOD_NAMES.length);
    const preview = roles.allowedMethods('channel', { preview: true });
    expect(preview).toContain('setViewAs'); // a previewing admin can always switch back
    expect(preview).toContain('readStudioAsset');
    expect(preview).not.toContain('createAssetKit');
    expect(preview).not.toContain('setTrendAdoption');
    const editorPreview = roles.allowedMethods('editor', { preview: true });
    expect(editorPreview).toContain('readWorkbook');
    expect(editorPreview).not.toContain('startResearchRun');
    expect(editorPreview.every((method) => policy.readMethods.includes(method) || policy.identityMethods.includes(method))).toBe(true);
  });

  it('formats copy and refusals', () => {
    expect(roles.format('preview', { who: 'Semrush Blog’s channel owner' })).toBe('You’re previewing as Semrush Blog’s channel owner. Switch back to Admin to make changes.');
    expect(roles.format('editConflict', { name: 'Riley' })).toBe('Riley saved this report at , after you opened it. Copy your text, reopen the report and try again.');
    expect(roles.format('Plain {thing}', { thing: 'text' })).toBe('Plain text');
    const error = roles.refusal('alreadyMaking', { channel: 'Semrush Blog' }, 409);
    expect(error).toMatchObject({ message: 'Your Semrush Blog assets for this trend are already being made.', status: 409, code: 'alreadyMaking' });
    expect(roles.refusal('adminOnly').status).toBe(403);
    for (const text of Object.values(roles.COPY)) { expect(text).not.toMatch(/!/); expect(text).not.toMatch(/'/); }
    for (const key of ['capabilityOff', 'lockedCapability', 'notForChannelRoles', 'needsCapability', 'policyConflict', 'adminAccess', 'roleInUse', 'roleName', 'roleBase']) expect(roles.COPY[key]).toEqual(expect.any(String));
    expect(roles.format('capabilityOff', { what: 'Start research', admin: 'Alex' })).toBe('Your access doesn’t include “Start research”. Ask Alex if you need it.');
    expect(roles.askWho([])).toBe('an admin');
    expect(roles.askWho([], 'a studio admin')).toBe('a studio admin');
    expect(roles.askWho([{ name: 'Alex' }, { name: 'Riley' }])).toBe('Alex or Riley');
    expect(roles.askWho([{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }])).toBe('A, B or another admin');
  });
});

describe('effective role and navigation', () => {
  it('lets View as only lower an admin, and ignores it for everyone else', () => {
    expect(roles.effectiveRole('admin', null, { role: 'channel', channelId: 'blog' })).toEqual({ role: 'channel', roleId: 'channel', channelId: 'blog' });
    expect(roles.effectiveRole('admin', null, { role: 'editor', channelId: 'blog' })).toEqual({ role: 'editor', roleId: 'editor', channelId: null });
    expect(roles.effectiveRole('admin', null, { role: 'admin' })).toEqual({ role: 'admin', roleId: 'admin', channelId: null });
    expect(roles.effectiveRole('admin', null, { role: 'channel', channelId: 'not-a-channel' })).toEqual({ role: 'admin', roleId: 'admin', channelId: null });
    expect(roles.effectiveRole('admin', null, null)).toEqual({ role: 'admin', roleId: 'admin', channelId: null });
    // A demoted admin whose session still carries an old View as gets their new role.
    expect(roles.effectiveRole('editor', null, { role: 'channel', channelId: 'blog' })).toEqual({ role: 'editor', roleId: 'editor', channelId: null });
    expect(roles.effectiveRole('channel', 'social', { role: 'editor' })).toEqual({ role: 'channel', roleId: 'channel', channelId: 'social' });
    expect(roles.effectiveRole('channel', 'nope', null)).toEqual({ role: 'channel', roleId: 'channel', channelId: null });
    expect(roles.effectiveRole(null, null, { role: 'editor' })).toEqual({ role: null, roleId: null, channelId: null });
    // Custom roles resolve through the team's policy; without it they are unknown.
    const policyWithRoles = roles.compilePolicy({ roles: [{ id: 'role-reviewers-ab12', label: 'Reviewers', base: 'channel', capabilities: ['readAssets'] }] });
    expect(roles.effectiveRole('admin', null, { role: 'role-reviewers-ab12', channelId: 'blog' }, policyWithRoles)).toEqual({ role: 'channel', roleId: 'role-reviewers-ab12', channelId: 'blog' });
    expect(roles.effectiveRole('admin', null, { role: 'role-reviewers-ab12' }, policyWithRoles)).toEqual({ role: 'admin', roleId: 'admin', channelId: null });
    expect(roles.effectiveRole('role-reviewers-ab12', 'blog', null)).toEqual({ role: null, roleId: null, channelId: null });
  });

  it('gives each role its sidebar, layouts and hidden pages, from its capabilities', () => {
    expect(roles.navFor('admin')).toEqual({ main: ['home', 'trends', 'reports', 'assets', 'inbox', 'calendar', 'ask'], admin: ['prompts', 'analytics', 'people'], bottom: ['settings'] });
    expect(roles.navFor('editor')).toEqual({ main: ['home', 'trends', 'reports', 'assets', 'inbox', 'calendar', 'ask'], admin: ['prompts'], bottom: [] });
    expect(roles.navFor('channel')).toEqual({ main: ['trends', 'assets', 'plan', 'inbox'], admin: [], bottom: [] });
    expect(roles.navFor(null)).toEqual({ main: [], admin: [], bottom: [] });
    expect(roles.viewModesFor('channel')).toEqual(['simple']);
    expect(roles.viewModesFor('editor')).toEqual(['simple', 'classic']);
    expect(roles.hiddenPagesFor('editor')).toEqual(['settings', 'knowledge', 'analytics', 'people']);
    expect(roles.hiddenPagesFor('admin')).toEqual([]);
    expect(roles.hiddenPagesFor('channel')).toEqual([]);
    // A reader without data tools keeps Simple Reports: the Advanced data-tools pages hide as one group.
    expect(roles.pagesFor(['core', 'readAssets', 'readResearch'], 'editor').hiddenPages).toEqual(['settings', 'knowledge', 'analytics', 'people', 'prompts', 'ask', 'sheets', 'create', 'playbooks', 'workflows', 'data-tools']);
    expect(roles.pagesFor(['core', 'readAssets'], 'channel')).toEqual({ nav: { main: ['trends', 'assets', 'inbox'], admin: [], bottom: [] }, hiddenPages: ['plan'], modes: ['simple'] });
    const nav = roles.navFor('admin'); nav.main.push('mutated');
    expect(roles.navFor('admin').main).not.toContain('mutated');
  });

  it('builds the viewer for each role without undefined values', () => {
    const admin = viewerFor('admin');
    expect(admin).toMatchObject({ id: 'member-chris', role: 'admin', roleId: 'admin', base: 'admin', realRole: 'admin', realBase: 'admin', roleLabel: 'Admin', channelId: null, channelName: null, via: 'proxy', web: true, preview: false, viewAs: null, prefs: { uiMode: 'classic', welcomedAt: '', inboxSeenAt: '', focusChannels: [], navRail: null }, modes: ['simple', 'classic'], askAdmin: 'Chris' });
    expect(admin.capabilities).toHaveLength(28);
    expect(admin.roles).toEqual([{ id: 'admin', label: 'Admin', base: 'admin' }, { id: 'editor', label: 'Editor', base: 'editor' }, { id: 'channel', label: 'Channel owner', base: 'channel' }]);
    expect(admin.channels).toHaveLength(10);
    expect(admin.channels[9]).toEqual({ id: 'searchengineland', name: 'Search Engine Land / MarTech', short: 'SEL' });
    const channel = viewerFor('channel');
    expect(channel).toMatchObject({ role: 'channel', base: 'channel', realRole: 'channel', roleLabel: 'Channel owner', channelId: 'blog', channelName: 'Semrush Blog', prefs: { uiMode: 'simple', focusChannels: [] }, memberSince: fixture.at('10-01'), nav: { main: ['trends', 'assets', 'plan', 'inbox'] } });
    expect(channel.capabilities).toEqual(['commentReports', 'core', 'makeAssets', 'manageRuns', 'markTrendsUsed', 'readAssets']);
    expect(channel).not.toHaveProperty('channels');
    expect(channel).not.toHaveProperty('roles');
    expect(viewerFor('editor')).not.toHaveProperty('channels');
    expect(viewerFor('editor')).toMatchObject({ base: 'editor', roleId: 'editor', roleLabel: 'Editor', roleDescription: 'Finds trends, writes and edits reports, makes assets for any channel.' });
    const guest = viewerFor('guest');
    expect(guest).toMatchObject({ role: null, base: null, realRole: null, roleLabel: '', capabilities: [], allowed: ['appMeta', 'state'], modes: [], hiddenPages: [] });
    const nobody = roles.buildViewer({});
    expect(nobody).toMatchObject({ id: '', role: null, prefs: { uiMode: '', welcomedAt: '' }, askAdmin: 'an admin' });
    for (const viewer of [admin, channel, guest, nobody, viewerFor('editor')]) expect(undefinedPaths(viewer)).toEqual([]);
  });

  it('previews as a channel owner on a real admin session', () => {
    const viewer = viewerFor('admin', { viewAs: { role: 'channel', channelId: 'social' } });
    expect(viewer).toMatchObject({ role: 'channel', realRole: 'admin', channelId: 'social', channelName: 'Semrush Social Team', preview: true, viewAs: { role: 'channel', channelId: 'social' }, prefs: { uiMode: 'simple' } });
    expect(viewer.channels).toHaveLength(10); // the View as picker still lists every channel
    expect(viewer.allowed).toContain('setViewAs');
    expect(viewer.allowed).not.toContain('createAssetKit');
    expect(roles.previewWho(viewer)).toBe('Semrush Social Team’s channel owner');
    expect(roles.previewWho(viewerFor('admin', { viewAs: { role: 'editor' } }))).toBe('an editor');
    expect(roles.viewKey(viewer)).not.toBe(roles.viewKey(viewerFor('admin')));
  });

  it('tells a preview what the previewed role can do, so its buttons show disabled instead of vanishing', () => {
    const editorPreview = viewerFor('admin', { viewAs: { role: 'editor' } });
    expect(editorPreview.roleAllowed).toEqual(roles.allowedMethods('editor'));
    expect(editorPreview.roleAllowed).toEqual(expect.arrayContaining(['decideResearchTheme', 'editStudioAsset', 'askHelp', 'createAssetKit']));
    expect(editorPreview.roleAllowed).not.toContain('saveSettings');
    expect(editorPreview.allowed).not.toContain('decideResearchTheme'); // the server still refuses it
    expect(editorPreview).toMatchObject({ capabilities: roles.capabilitiesFor({ roleId: 'editor' }), roleCapabilities: roles.capabilitiesFor({ roleId: 'editor' }), previewName: '', previewChanges: 0, viewAs: { role: 'editor', channelId: null } });
    expect(viewerFor('admin', { viewAs: { role: 'channel', channelId: 'blog' } }).roleAllowed).toEqual(roles.allowedMethods('channel'));
    for (const who of ['admin', 'editor', 'channel', 'guest']) expect(viewerFor(who)).not.toHaveProperty('roleAllowed');
    expect(undefinedPaths(editorPreview)).toEqual([]);
  });

  it('keeps a channel owner a channel owner when they send viewAs through their preferences', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'roles-prefs-')); roots.push(root);
    const store = createTeamStore({ root });
    const prefs = store.setPrefs('member-alex', { viewAs: { role: 'admin' }, role: 'admin', uiMode: 'classic', welcomedAt: '2026-10-16T09:00:00Z' });
    expect(prefs).toEqual({ uiMode: 'classic', welcomedAt: '2026-10-16T09:00:00.000Z', inboxSeenAt: '', focusChannels: [], navRail: null });
    expect(JSON.parse(fs.readFileSync(path.join(root, 'team.json'), 'utf8')).prefs['member-alex']).toEqual({ uiMode: 'classic', welcomedAt: '2026-10-16T09:00:00.000Z' });
    const viewer = roles.buildViewer({ identity: identities.channel, session: { viewAs: { role: 'editor' } }, prefs: { ...store.prefsFor('member-alex'), viewAs: { role: 'admin' } }, editionId: 'semrush', web: true });
    expect(viewer).toMatchObject({ role: 'channel', realRole: 'channel', channelId: 'blog', preview: false, viewAs: null, prefs: { uiMode: 'simple', welcomedAt: '2026-10-16T09:00:00.000Z' } });
    expect(viewer.allowed).not.toContain('setViewAs');
  });

  it('gives a demoted admin with an old session View as their new role', () => {
    const session = { viewAs: { role: 'channel', channelId: 'blog' } };
    expect(viewerFor('admin', session)).toMatchObject({ role: 'channel', preview: true });
    const demoted = roles.buildViewer({ identity: { ...identities.admin, role: 'editor' }, session, prefs: {}, editionId: 'semrush', web: true });
    expect(demoted).toMatchObject({ role: 'editor', realRole: 'editor', channelId: null, preview: false, viewAs: null });
    expect(demoted).not.toHaveProperty('channels');
    expect(demoted.allowed).not.toContain('setViewAs');
  });
});

describe('state projection', () => {
  const FORBIDDEN_KEYS = ['costUsd', 'ownCostUsd', 'receipts', 'programs', 'maxBudgetUsd', 'reservedUsd', 'estimateUsd', 'estimate', 'ai', 'model', 'warnings', 'imageCalls', 'receipt', 'knowledge', 'products', 'referenceDocs', 'availableDatasets', 'availableReports', 'researchRuns', 'contentRuns', 'v5', 'monday', 'recipes', 'datasets', 'sheets', 'error'];

  it('keeps who saved which prompt from a role that can’t see prompts', () => {
    const studio = fixture.baseState().contentStudio;
    const base = { ...fixture.baseState(), contentStudio: { ...studio, promptChanges: [{ promptId: 'reports.trends-report', name: 'Trends report', version: 2, at: fixture.at('10-15', '11:00:00'), by: { id: 'member-riley', name: 'Riley' }, byName: 'Riley', source: 'library', note: 'Shorter intro', current: true }] } };
    expect(roles.projectState(base, viewerFor('admin')).contentStudio.promptChanges).toHaveLength(1);
    expect(roles.projectState(base, viewerFor('editor')).contentStudio.promptChanges).toHaveLength(1);
    const editor = viewerFor('editor');
    const noPrompts = { ...editor, capabilities: editor.capabilities.filter((id) => id !== 'viewPrompts' && id !== 'editPrompts') };
    expect(roles.projectState(base, noPrompts).contentStudio).not.toHaveProperty('promptChanges');
    expect(roles.projectState(base, noPrompts).contentStudio.programs).toBeDefined();
  });

  it('gives an admin the full base plus where each trend is used and the team size', () => {
    const base = fixture.baseState(); const viewer = viewerFor('admin');
    const state = roles.projectState(base, viewer, { adoptions: fixture.adoptions(), admins: [{ id: 'member-chris', name: 'Chris' }, { id: 'member-x', name: '' }], memberCount: 5, editionId: 'semrush' });
    expect(state).not.toBe(base);
    expect(state.contentStudio).not.toBe(base.contentStudio);
    expect(base.contentStudio).not.toHaveProperty('adoptionsByTheme');
    expect(state).toMatchObject({ viewer, team: { admins: [{ name: 'Chris' }], memberCount: 5 }, keys: base.keys, settings: base.settings, v5: base.v5 });
    expect(state.contentStudio.programs).toEqual(base.contentStudio.programs);
    expect(state.contentStudio.adoptionsByTheme).toEqual({
      'theme-aio': { blog: { status: 'using', link: 'https://www.semrush.com/blog/ai-overviews/', plannedFor: '', byName: 'Alex', at: fixture.at('10-13', '16:00:00'), channelName: 'Semrush Blog' } },
      'theme-local': { social: { status: 'not-using', link: '', plannedFor: '', byName: 'Sam', at: fixture.at('10-15', '11:00:00'), channelName: 'Semrush Social Team' } },
    });
    expect(undefinedPaths(state)).toEqual([]);
  });

  it('gives an editor the full base and adoptions but not the team size', () => {
    const state = project(viewerFor('editor'));
    expect(state.team).toEqual({ admins: [{ name: 'Chris' }] });
    expect(state.contentStudio.researchRuns).toHaveLength(5);
    expect(state.contentStudio.adoptionsByTheme['theme-aio'].blog.status).toBe('using');
    // Editors get no viewer.channels, so each answer carries the channel's display name for the reader's "Used by".
    expect(state.viewer).not.toHaveProperty('channels');
    expect(state.contentStudio.adoptionsByTheme['theme-aio'].blog.channelName).toBe('Semrush Blog');
    expect(state.viewer.hiddenPages).toEqual(['settings', 'knowledge', 'analytics', 'people']);
    expect(JSON.stringify(state)).toContain('costUsd'); // editors see costs by default
    expect(undefinedPaths(state)).toEqual([]);
  });

  it('gives a role without See costs the editor’s state with every money field taken out', () => {
    const compiled = roles.compilePolicy({ roles: [{ id: 'role-viewer-ab12', label: 'Viewer', base: 'editor', capabilities: ['core', 'readAssets', 'readResearch'] }] });
    const viewer = roles.buildViewer({ identity: { ...identities.editor, roleId: 'role-viewer-ab12' }, prefs: {}, editionId: 'semrush', web: true, admins: [{ id: 'member-chris', name: 'Chris' }], policy: compiled });
    expect(viewer).toMatchObject({ role: 'editor', roleId: 'role-viewer-ab12', roleLabel: 'Viewer', capabilities: ['core', 'readAssets', 'readResearch'] });
    const base = fixture.baseState();
    const state = project(viewer);
    expect(state.contentStudio.researchRuns).toHaveLength(5);
    const keys = keysIn({ ...state, viewer: {} });
    for (const key of ['costUsd', 'ownCostUsd', 'receipts', 'receipt', 'maxBudgetUsd', 'reservedUsd', 'estimateUsd', 'estimate', 'budgets', 'imageCalls']) expect({ key, present: keys.has(key) }).toEqual({ key, present: false });
    expect([...keys].filter((key) => /Usd$/.test(key))).toEqual([]);
    expect(JSON.stringify(base)).toContain('costUsd'); // the base itself is untouched
    expect(state.viewer).toBe(viewer);
    expect(undefinedPaths(state)).toEqual([]);
  });
  it('gives someone without a role nothing but who to ask', () => {
    const state = project(viewerFor('guest'));
    expect(state).toEqual({ viewer: state.viewer, team: { admins: [{ name: 'Chris' }] }, settings: {}, keys: {}, contentStudio: { workspaces: [] } });
    expect(undefinedPaths(state)).toEqual([]);
  });

  it('gives a channel owner only their channel, with no money, programs, keys or other channels', () => {
    const state = project(viewerFor('channel'));
    expect(Object.keys(state).sort()).toEqual(['contentStudio', 'keys', 'settings', 'team', 'viewer']);
    expect(state.settings).toEqual({ uiMode: 'simple' });
    expect(state.keys).toEqual({});
    expect(state.team).toEqual({ admins: [{ name: 'Chris' }] });
    expect(Object.keys(state.contentStudio).sort()).toEqual(['activeWorkspaceId', 'capabilities', 'channelView', 'noteCounts', 'noteMentions', 'workspaces']);
    expect(state.contentStudio).toMatchObject({ activeWorkspaceId: 'semrush', workspaces: [{ id: 'semrush', name: 'Semrush workspace', editionId: 'semrush' }], capabilities: { imagesConfigured: true } });
    const view = state.contentStudio.channelView;
    expect(view.channel).toEqual({ id: 'blog', name: 'Semrush Blog', short: 'Blog', deliverables: [{ id: 'blogshort', label: 'Short news update', kind: 'text' }, { id: 'bloglong', label: 'Long-form article', kind: 'text' }] });
    const keys = keysIn(state);
    for (const key of FORBIDDEN_KEYS) expect({ key, present: keys.has(key) }).toEqual({ key, present: false });
    const strings = stringsIn(state);
    const otherDeliverables = kit.kitFolders('semrush').filter((folder) => folder.id !== 'blog').flatMap((folder) => folder.deliverableIds);
    for (const id of otherDeliverables) expect(strings).not.toContain(id);
    for (const id of ['asset-kit-shared-social', 'image-shared-0', 'content-kit-local', 'asset-campaign-newsletter', 'program-pulse']) expect(strings).not.toContain(id);
    expect(strings.some((text) => /claude-opus|Semrush Social Team|Private positioning/.test(text))).toBe(false);
    expect(undefinedPaths(state)).toEqual([]);
  });

  it('projects an admin’s channel preview with the same shape and no “earlier” group', () => {
    const preview = project(viewerFor('admin', { viewAs: { role: 'channel', channelId: 'blog' } }));
    const owner = project({ ...viewerFor('channel'), memberSince: '2026-12-01T00:00:00.000Z' });
    expect(Object.keys(preview.contentStudio).sort()).toEqual(Object.keys(owner.contentStudio).sort());
    expect(preview.contentStudio.channelView.trends.every((trend) => !trend.earlier)).toBe(true);
    expect(owner.contentStudio.channelView.trends.filter((trend) => trend.earlier).map((trend) => trend.themeId)).toEqual(['theme-local']);
    expect(preview.team).toEqual({ admins: [{ name: 'Chris' }] });
    const desktop = roles.projectState(fixture.baseState(), roles.buildViewer({ identity: { ...identities.channel, via: 'desktop', memberSince: '2026-12-01T00:00:00.000Z' }, editionId: 'semrush' }), { editionId: 'semrush' });
    expect(desktop.contentStudio.channelView.trends.some((trend) => trend.earlier)).toBe(false);
  });

  it('gives note counts and the person’s own mentions, a channel owner only for their channel’s assets and the briefs', () => {
    const base = fixture.baseState();
    base.contentStudio.noteCounts = { 'asset-kit-blog-short': { open: 1, total: 2 }, 'asset-kit-shared-social': { open: 1, total: 1 }, 'asset-aio-toolkit-2': { open: 0, total: 1 }, 'asset-campaign-newsletter': { open: 3, total: 3 } };
    const item = (assetId) => ({ id: `ni-${assetId}`, kind: 'mention', assetId, noteId: 'note-1', assetTitle: 'x', by: { id: 'member-riley', name: 'Riley' }, excerpt: 'Look', at: fixture.at('10-15'), read: false });
    // The last item is about a report in another (or a hidden) workspace: nobody sees it here.
    const noteInbox = { items: [item('asset-kit-blog-short'), item('asset-kit-shared-social'), item('asset-aio-toolkit-2'), item('asset-in-another-workspace')], unread: 4 };
    const options = { adoptions: fixture.adoptions(), admins: [], editionId: 'semrush', noteInbox };
    const editor = roles.projectState(base, viewerFor('editor'), options).contentStudio;
    expect(Object.keys(editor.noteCounts)).toHaveLength(4);
    expect(editor.noteMentions.map((row) => row.assetId)).toEqual(['asset-kit-blog-short', 'asset-kit-shared-social', 'asset-aio-toolkit-2']);
    expect(roles.projectState(base, viewerFor('admin'), options).contentStudio.noteMentions).toHaveLength(3);
    const channel = roles.projectState(base, viewerFor('channel'), options).contentStudio;
    expect(channel.noteCounts).toEqual({ 'asset-kit-blog-short': { open: 1, total: 2 }, 'asset-aio-toolkit-2': { open: 0, total: 1 } });
    expect(channel.noteMentions).toEqual([item('asset-kit-blog-short'), item('asset-aio-toolkit-2')]);
    const compiled = roles.compilePolicy({ roles: [{ id: 'role-notes-off-0001', label: 'Research only', base: 'editor', capabilities: ['core', 'readResearch'] }] });
    const noReads = roles.buildViewer({ identity: { ...identities.editor, roleId: 'role-notes-off-0001' }, prefs: {}, editionId: 'semrush', web: true, policy: compiled });
    expect(roles.projectState(base, noReads, options).contentStudio).toMatchObject({ noteCounts: {}, noteMentions: [] });
  });

  it('copes with a bare base from older hosts and tests', () => {
    const admin = roles.projectState({ settings: { uiMode: 'simple' } }, viewerFor('admin'));
    expect(admin).toMatchObject({ settings: { uiMode: 'simple' }, contentStudio: { adoptionsByTheme: {} }, team: { admins: [], memberCount: 0 } });
    const channel = roles.projectState(null, viewerFor('channel'));
    expect(channel.contentStudio).toMatchObject({ activeWorkspaceId: '', workspaces: [], channelView: { counts: { newTrends: 0 }, trends: [], runs: [], assets: [] } });
    expect(undefinedPaths(admin)).toEqual([]);
    expect(undefinedPaths(channel)).toEqual([]);
  });
});

describe('capabilities: role policy and per-person access', () => {
  const policyOf = (input) => roles.compilePolicy(input);
  it('lets deny win, for the role policy and for a person', () => {
    const compiled = policyOf({ rev: 2, builtIn: { editor: { grant: ['seeAnalytics'], deny: ['startResearch'] } } });
    expect(roles.capabilitiesFor({ roleId: 'editor' }, compiled)).toContain('seeAnalytics');
    expect(roles.capabilitiesFor({ roleId: 'editor' }, compiled)).not.toContain('startResearch');
    expect(roles.capabilitiesFor({ roleId: 'editor', grants: ['startResearch'] }, compiled)).toContain('startResearch'); // their own grant
    expect(roles.capabilitiesFor({ roleId: 'editor', grants: ['askAi'], denies: ['askAi'] }, compiled)).not.toContain('askAi'); // deny wins
    expect(roles.methodsFor('editor', roles.capabilitiesFor({ roleId: 'editor' }, compiled))).toContain('getTrendAnalytics');
  });

  it('never grants a locked capability, even from a hand-edited team.json, and always keeps core', () => {
    const compiled = policyOf({ builtIn: { editor: { grant: ['settings', 'manageAccess'], deny: ['core'] } }, roles: [{ id: 'role-sneaky-0001', label: 'Sneaky', base: 'editor', capabilities: ['settings', 'manageAccess', 'readAssets'] }] });
    for (const access of [{ roleId: 'editor' }, { roleId: 'role-sneaky-0001' }, { roleId: 'editor', grants: ['settings'] }]) {
      const caps = roles.capabilitiesFor(access, compiled);
      expect(caps).not.toContain('settings'); expect(caps).not.toContain('manageAccess'); expect(caps).toContain('core');
    }
    expect(roles.canCallAs(roles.subjectFor({ roleId: 'editor', grants: ['settings'] }, compiled), 'saveSettings')).toBe(false);
  });

  it('closes requirements: a capability missing a prerequisite is removed, and paid work needs See costs', () => {
    const compiled = policyOf({ builtIn: { editor: { deny: ['readResearch'] } } });
    const caps = roles.capabilitiesFor({ roleId: 'editor' }, compiled);
    for (const id of ['readResearch', 'startResearch', 'quickScans', 'approveTrends', 'writeReports', 'askAi', 'exportPublish']) expect(caps).not.toContain(id);
    expect(caps).toContain('readAssets');
    const noCosts = roles.capabilitiesFor({ roleId: 'editor', denies: ['seeCosts'] });
    for (const id of ['startResearch', 'quickScans', 'writeReports', 'makeAssets', 'manageRuns', 'askAi', 'editPrompts', 'dataTools']) expect(noCosts).not.toContain(id);
    expect(noCosts).toEqual(expect.arrayContaining(['readResearch', 'readAssets', 'viewPrompts', 'sheets', 'approveTrends', 'editReports']));
    // A channel base never needs costs.
    expect(roles.capabilitiesFor({ roleId: 'channel' })).toContain('makeAssets');
  });

  it('keeps a custom channel-based role to its channel: channel scopes, channel methods only', () => {
    const compiled = policyOf({ roles: [{ id: 'role-reviewers-ab12', label: 'Channel reviewer', base: 'channel', capabilities: ['readAssets', 'markTrendsUsed', 'askAi', 'manageRuns'] }] });
    const caps = roles.capabilitiesFor({ roleId: 'role-reviewers-ab12' }, compiled);
    expect(caps).toEqual(['core', 'manageRuns', 'markTrendsUsed', 'readAssets']); // askAi is never for a channel base
    const methods = roles.methodsFor('channel', caps);
    expect(methods).not.toContain('cancelJob'); expect(methods).not.toContain('getJob');
    expect(methods.every((method) => policy.channelSafeMethods.includes(method))).toBe(true);
    const viewer = roles.buildViewer({ identity: { ...identities.channel, roleId: 'role-reviewers-ab12' }, prefs: {}, editionId: 'semrush', web: true, policy: compiled });
    expect(viewer).toMatchObject({ role: 'channel', base: 'channel', roleId: 'role-reviewers-ab12', roleLabel: 'Channel reviewer', channelId: 'blog', modes: ['simple'], nav: { main: ['trends', 'assets', 'plan', 'inbox'] } });
    expect(viewer.allowed).not.toContain('createAssetKit');
    expect(Object.keys(roles.projectState(fixture.baseState(), viewer, { editionId: 'semrush' })).sort()).toEqual(['contentStudio', 'keys', 'settings', 'team', 'viewer']);
  });

  it('ignores unknown ids, and an admin always has everything', () => {
    const compiled = policyOf({ builtIn: { editor: { grant: ['flyToTheMoon'] } }, roles: [{ id: 'not-a-role', label: 'X', base: 'editor', capabilities: [] }, { id: 'role-admin-like-0001', label: 'Boss', base: 'admin', capabilities: [] }] });
    expect(compiled.roles.has('not-a-role')).toBe(false);
    expect(compiled.roles.has('role-admin-like-0001')).toBe(false); // there is no second admin type
    expect(roles.capabilitiesFor({ roleId: 'editor', grants: ['flyToTheMoon'] }, compiled)).toEqual(roles.capabilitiesFor({ roleId: 'editor' }));
    expect(roles.capabilitiesFor({ roleId: 'admin', denies: ['settings'] }, compiled)).toHaveLength(28);
    expect(roles.capabilitiesFor({ roleId: 'role-missing' }, compiled)).toEqual([]);
    expect(roles.canCallAs(roles.subjectFor({ roleId: 'admin' }, compiled), 'someFutureMethod')).toBe(true);
    expect(roles.canCallAs(roles.subjectFor({ roleId: 'role-missing' }, compiled), 'state')).toBe(true); // nobody: the no-role methods
    expect(roles.canCallAs(roles.subjectFor({ roleId: 'role-missing' }, compiled), 'contentCatalog')).toBe(false);
  });

  it('words a refusal by why it was refused', () => {
    const editor = roles.subjectFor({ roleId: 'editor', denies: ['startResearch'] });
    expect(roles.refusalFor('startResearchRun', editor, { admins: [{ name: 'Alex' }] })).toMatchObject({ status: 403, code: 'capabilityOff', message: 'Your access doesn’t include “Start research”. Ask Alex if you need it.' });
    expect(roles.refusalFor('saveSettings', editor)).toMatchObject({ code: 'adminOnly' });
    expect(roles.refusalFor('someFutureMethod', editor)).toMatchObject({ code: 'adminOnly' });
    expect(roles.refusalFor('startResearchRun', roles.subjectFor({ roleId: 'channel' }))).toMatchObject({ code: 'forbidden', message: roles.COPY.forbidden });
    expect(roles.refusalFor('createAssetKit', roles.subjectFor({ roleId: 'channel', denies: ['makeAssets'] }))).toMatchObject({ code: 'capabilityOff' });
  });

  it('previews one person with their own changes, and names them in the banner copy', () => {
    const member = { id: 'member-riley', name: 'Riley Jones', role: 'editor', channelId: null, grants: [], denies: ['askAi', 'editPrompts'], disabled: false };
    const viewer = viewerFor('admin', { viewAs: { memberId: 'member-riley' } });
    expect(viewer.preview).toBe(false); // without the member, the request is ignored
    const preview = roles.buildViewer({ identity: identities.admin, session: { viewAs: { memberId: 'member-riley' } }, prefs: {}, editionId: 'semrush', web: true, previewMember: member });
    expect(preview).toMatchObject({ preview: true, role: 'editor', roleId: 'editor', previewName: 'Riley Jones', previewChanges: 2, viewAs: { memberId: 'member-riley', role: 'editor', channelId: null } });
    expect(preview.capabilities).not.toContain('askAi');
    expect(preview.roleCapabilities).toContain('askAi');
    expect(roles.previewWho(preview)).toBe('Riley Jones');
    expect(preview.allowed).toContain('setViewAs');
    expect(preview.allowed).not.toContain('askHelp');
    for (const refused of [{ ...member, role: 'admin' }, { ...member, disabled: true }, { ...member, id: 'member-other' }]) expect(roles.buildViewer({ identity: identities.admin, session: { viewAs: { memberId: 'member-riley' } }, previewMember: refused }).preview).toBe(false);
    expect(roles.viewKey(preview)).not.toBe(roles.viewKey(viewerFor('admin', { viewAs: { role: 'editor' } })));
  });
});
