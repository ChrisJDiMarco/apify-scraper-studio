import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { methods } from '../src/shared/studio-api-channels.json';
import policy from '../src/shared/roles.json';
import roles from '../src/main/roles.js';
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
  runIntent: ['runRecipe', 'analyzeDataset', 'exportDataset', 'generateAssets', 'saveCard'],
  runIntentAction: ['runRecipe', 'analyzeDataset', 'exportDataset', 'generateAssets', 'saveCard'],
  runActionGraph: ['runRecipe', 'analyzeDataset', 'exportDataset', 'generateAssets', 'saveCard'],
  runMission: ['runActionGraph'], retryJob: ['runMission', 'runActionGraph'],
  generateAssets: ['saveCard', 'saveAsset'], searchSources: ['saveRecipe', 'runRecipe'],
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

describe('method policy', () => {
  it('classifies every studio method exactly once, plus the new team methods', () => {
    const listed = policy.methodRoles.flatMap((group) => group.methods);
    expect(listed.length).toBe(new Set(listed).size);
    expect(new Set(listed)).toEqual(new Set([...Object.keys(methods), ...NEW_METHODS]));
    for (const method of Object.keys(methods)) expect(listed.filter((entry) => entry === method)).toHaveLength(1);
    for (const group of policy.methodRoles) { expect(group.roles.length).toBeGreaterThan(0); expect(group.roles.every((role) => roles.ROLE_IDS.includes(role))).toBe(true); expect(group.roles).toContain('admin'); }
  });

  it('classifies a composite method at least as high as anything it can run', () => {
    for (const [composite, inner] of Object.entries(COMPOSITES)) for (const method of inner) {
      for (const role of roles.rolesFor(composite)) expect({ composite, method, role, allowed: roles.canCall(role, method) }).toMatchObject({ allowed: true });
    }
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
  });

  it('ships the allowed methods per role, and only reads while previewing', () => {
    expect(roles.allowedMethods(null)).toEqual(['appMeta', 'state']);
    expect(roles.allowedMethods('channel').sort()).toEqual(['appMeta', 'cancelStudioRun', 'contentCatalog', 'createAssetKit', 'openSourceUrl', 'openStudioAsset', 'planAssetKit', 'readStudioAsset', 'retryStudioRun', 'saveAssetKitFolder', 'setTrendAdoption', 'setViewPrefs', 'state']);
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
    expect(roles.askWho([])).toBe('an admin');
    expect(roles.askWho([], 'a studio admin')).toBe('a studio admin');
    expect(roles.askWho([{ name: 'Alex' }, { name: 'Riley' }])).toBe('Alex or Riley');
    expect(roles.askWho([{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }])).toBe('A, B or another admin');
  });
});

describe('effective role and navigation', () => {
  it('lets View as only lower an admin, and ignores it for everyone else', () => {
    expect(roles.effectiveRole('admin', null, { role: 'channel', channelId: 'blog' })).toEqual({ role: 'channel', channelId: 'blog' });
    expect(roles.effectiveRole('admin', null, { role: 'editor', channelId: 'blog' })).toEqual({ role: 'editor', channelId: null });
    expect(roles.effectiveRole('admin', null, { role: 'admin' })).toEqual({ role: 'admin', channelId: null });
    expect(roles.effectiveRole('admin', null, { role: 'channel', channelId: 'not-a-channel' })).toEqual({ role: 'admin', channelId: null });
    expect(roles.effectiveRole('admin', null, null)).toEqual({ role: 'admin', channelId: null });
    // A demoted admin whose session still carries an old View as gets their new role.
    expect(roles.effectiveRole('editor', null, { role: 'channel', channelId: 'blog' })).toEqual({ role: 'editor', channelId: null });
    expect(roles.effectiveRole('channel', 'social', { role: 'editor' })).toEqual({ role: 'channel', channelId: 'social' });
    expect(roles.effectiveRole('channel', 'nope', null)).toEqual({ role: 'channel', channelId: null });
    expect(roles.effectiveRole(null, null, { role: 'editor' })).toEqual({ role: null, channelId: null });
  });

  it('gives each role its sidebar, layouts and hidden pages', () => {
    expect(roles.navFor('admin')).toEqual({ main: ['home', 'reports', 'trends', 'assets', 'ask'], admin: ['analytics', 'people'], bottom: ['settings'] });
    expect(roles.navFor('editor')).toEqual({ main: ['home', 'reports', 'trends', 'assets', 'ask'], admin: [], bottom: [] });
    expect(roles.navFor('channel')).toEqual({ main: ['trends', 'assets'], admin: [], bottom: [] });
    expect(roles.navFor(null)).toEqual({ main: [], admin: [], bottom: [] });
    expect(roles.viewModesFor('channel')).toEqual(['simple']);
    expect(roles.viewModesFor('editor')).toEqual(['simple', 'classic']);
    expect(roles.hiddenPagesFor('editor')).toEqual(['settings', 'knowledge', 'analytics', 'people']);
    expect(roles.hiddenPagesFor('admin')).toEqual([]);
    const nav = roles.navFor('admin'); nav.main.push('mutated');
    expect(roles.navFor('admin').main).not.toContain('mutated');
  });

  it('builds the viewer for each role without undefined values', () => {
    const admin = viewerFor('admin');
    expect(admin).toMatchObject({ id: 'member-chris', role: 'admin', realRole: 'admin', channelId: null, channelName: null, via: 'proxy', web: true, preview: false, viewAs: null, prefs: { uiMode: 'classic', welcomedAt: '' }, modes: ['simple', 'classic'], askAdmin: 'Chris' });
    expect(admin.channels).toHaveLength(10);
    expect(admin.channels[9]).toEqual({ id: 'searchengineland', name: 'Search Engine Land / MarTech', short: 'SEL' });
    const channel = viewerFor('channel');
    expect(channel).toMatchObject({ role: 'channel', realRole: 'channel', channelId: 'blog', channelName: 'Semrush Blog', prefs: { uiMode: 'simple' }, memberSince: fixture.at('10-01'), nav: { main: ['trends', 'assets'] } });
    expect(channel).not.toHaveProperty('channels');
    expect(viewerFor('editor')).not.toHaveProperty('channels');
    const guest = viewerFor('guest');
    expect(guest).toMatchObject({ role: null, realRole: null, allowed: ['appMeta', 'state'], modes: [], hiddenPages: [] });
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
    expect(viewerFor('admin', { viewAs: { role: 'channel', channelId: 'blog' } }).roleAllowed).toEqual(roles.allowedMethods('channel'));
    for (const who of ['admin', 'editor', 'channel', 'guest']) expect(viewerFor(who)).not.toHaveProperty('roleAllowed');
    expect(undefinedPaths(editorPreview)).toEqual([]);
  });

  it('keeps a channel owner a channel owner when they send viewAs through their preferences', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'roles-prefs-')); roots.push(root);
    const store = createTeamStore({ root });
    const prefs = store.setPrefs('member-alex', { viewAs: { role: 'admin' }, role: 'admin', uiMode: 'classic', welcomedAt: '2026-10-16T09:00:00Z' });
    expect(prefs).toEqual({ uiMode: 'classic', welcomedAt: '2026-10-16T09:00:00.000Z' });
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

  it('gives an admin the full base plus where each trend is used and the team size', () => {
    const base = fixture.baseState(); const viewer = viewerFor('admin');
    const state = roles.projectState(base, viewer, { adoptions: fixture.adoptions(), admins: [{ id: 'member-chris', name: 'Chris' }, { id: 'member-x', name: '' }], memberCount: 5, editionId: 'semrush' });
    expect(state).not.toBe(base);
    expect(state.contentStudio).not.toBe(base.contentStudio);
    expect(base.contentStudio).not.toHaveProperty('adoptionsByTheme');
    expect(state).toMatchObject({ viewer, team: { admins: [{ name: 'Chris' }], memberCount: 5 }, keys: base.keys, settings: base.settings, v5: base.v5 });
    expect(state.contentStudio.programs).toEqual(base.contentStudio.programs);
    expect(state.contentStudio.adoptionsByTheme).toEqual({
      'theme-aio': { blog: { status: 'using', link: 'https://www.semrush.com/blog/ai-overviews/', byName: 'Alex', at: fixture.at('10-13', '16:00:00'), channelName: 'Semrush Blog' } },
      'theme-local': { social: { status: 'not-using', link: '', byName: 'Sam', at: fixture.at('10-15', '11:00:00'), channelName: 'Semrush Social Team' } },
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
    expect(Object.keys(state.contentStudio).sort()).toEqual(['activeWorkspaceId', 'capabilities', 'channelView', 'workspaces']);
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

  it('copes with a bare base from older hosts and tests', () => {
    const admin = roles.projectState({ settings: { uiMode: 'simple' } }, viewerFor('admin'));
    expect(admin).toMatchObject({ settings: { uiMode: 'simple' }, contentStudio: { adoptionsByTheme: {} }, team: { admins: [], memberCount: 0 } });
    const channel = roles.projectState(null, viewerFor('channel'));
    expect(channel.contentStudio).toMatchObject({ activeWorkspaceId: '', workspaces: [], channelView: { counts: { newTrends: 0 }, trends: [], runs: [], assets: [] } });
    expect(undefinedPaths(admin)).toEqual([]);
    expect(undefinedPaths(channel)).toEqual([]);
  });
});
