import { describe, expect, it } from 'vitest';
import accessModule from '../src/main/access.js';
import roles from '../src/main/roles.js';
import fixture from './fixtures/roles-state.js';
const { createAccess } = accessModule;

// The gate's logic on its own: a fake team and a workspace read from the roles fixture (a Semrush studio with a Blog
// set, a set shared by Blog and Social, and Social's own set still running).
const at = fixture.at;
const ALEX = { id: 'member-alex', name: 'Alex', email: 'alex@semrush.com', role: 'channel', channelId: 'blog', via: 'link', disabled: false, memberSince: at('10-01') };
const SAM = { id: 'member-sam', name: 'Sam', email: 'sam@semrush.com', role: 'channel', channelId: 'social', via: 'link', disabled: false, memberSince: at('10-05') };
const RILEY = { id: 'member-riley', name: 'Riley', email: 'riley@semrush.com', role: 'editor', channelId: null, via: 'link', disabled: false, memberSince: at('08-02') };
const CHRIS = { id: 'member-chris', name: 'Chris', email: 'chris@semrush.com', role: 'admin', channelId: null, via: 'proxy', disabled: false, memberSince: at('08-01') };

// policy/access/members: the team's compiled role policy, people's own grants and denies, and members by id (for a
// person preview). Left out, the gate falls back to the built-in defaults, as older team stores did.
function fakeTeam({ policy = null, access = {}, members = {} } = {}) {
  const logs = []; const events = []; const audits = [];
  return {
    logs, events, audits,
    prefsFor: () => ({ uiMode: '', welcomedAt: '' }), admins: () => [{ id: 'member-chris', name: 'Chris' }, { id: 'member-pat', name: 'Pat' }],
    logEvent: (event) => events.push(event), log: (kind, workspaceId, detail, by) => { logs.push({ kind, workspaceId, detail, by }); return {}; },
    adoptionsFor: () => fixture.adoptions(), listMembers: () => fixture.members(),
    ...(policy ? { accessPolicy: () => policy, accessFor: (id) => access[id] || { grants: [], denies: [] }, memberById: (id) => members[id] || null, audit: (rows, by) => { audits.push({ rows, by }); return rows; } } : {}),
  };
}
function fakeWorkspace({ pictures = true } = {}) {
  const studio = fixture.contentStudio(); const runs = [...studio.contentRuns, ...studio.researchRuns];
  return {
    studio,
    findAsset: (id) => { const asset = studio.assets.find((row) => row.id === id); return asset ? { asset, run: runs.find((run) => run.id === asset.runId) || null } : null; },
    findRun: (id) => runs.find((run) => run.id === id) || null,
    activeEditionId: () => 'semrush',
    activeWorkspace: () => ({ id: 'semrush', name: 'Semrush workspace', editionId: 'semrush' }),
    workspaceById: (id) => (id === 'semrush' ? { id, name: 'Semrush workspace', editionId: 'semrush' } : null),
    isTrendReport: (asset) => { const run = studio.contentRuns.find((row) => row.id === asset?.runId); return ['evidence-report', 'editorial-toolkit'].includes(asset?.deliverableId) && Boolean(run && !run.kit && run.status === 'succeeded' && run.themeId); },
    kitRunsFor: (key) => studio.contentRuns.filter((run) => run.kit?.sourceKey === key),
    picturesReady: () => pictures,
  };
}
function setup({ identity = ALEX, viewAs = null, web = true, pictures = true, team: teamOptions } = {}) {
  const team = fakeTeam(teamOptions); const workspace = fakeWorkspace({ pictures }); const call = { user: identity, session: { viewAs } };
  const access = createAccess({ teamStore: team, workspace, web, localName: 'Chris', currentCall: () => call });
  return { team, workspace, call, access, viewer: () => access.currentViewer() };
}
const refused = (fn) => { try { fn(); } catch (error) { return error; } throw new Error('Expected a refusal.'); };

describe('who is calling', () => {
  it('fails closed on the web: a call without a signed-in person is refused, never treated as an admin', () => {
    const { access, call, team } = setup(); call.user = null; call.session = null;
    const error = refused(() => access.check('state', undefined, access.currentViewer()));
    expect(error).toMatchObject({ status: 403 });
    expect(team.events).toEqual([expect.objectContaining({ event: 'denied', method: 'state' })]);
    expect(access.actorForCall()).toEqual({ id: 'system', name: 'Automatic' });
  });

  it('is always the local admin on the Mac, with View as in this process', () => {
    const { access } = setup({ web: false, identity: null });
    const viewer = access.currentViewer();
    expect(viewer).toMatchObject({ id: 'local', name: 'Chris', role: 'admin', realRole: 'admin', via: 'desktop', preview: false });
    access.sessionForCall().viewAs = { role: 'channel', channelId: 'blog' };
    expect(access.currentViewer()).toMatchObject({ role: 'channel', channelId: 'blog', realRole: 'admin', preview: true, channelName: 'Semrush Blog' });
    expect(access.actorForCall()).toEqual({ id: 'local', name: 'Chris' });
  });
});

describe('deny by default', () => {
  it('lets each role call only its methods, with plain refusals', () => {
    const owner = setup(); const editor = setup({ identity: RILEY });
    expect(refused(() => owner.access.check('startResearchRun', { programId: 'p' }, owner.viewer()))).toMatchObject({ status: 403, code: 'forbidden', message: roles.COPY.forbidden });
    expect(refused(() => owner.access.check('saveSettings', {}, owner.viewer()))).toMatchObject({ status: 403, code: 'adminOnly' });
    expect(refused(() => owner.access.check('readStudioRun', { runId: 'research-new' }, owner.viewer()))).toMatchObject({ status: 403, code: 'forbidden' });
    expect(refused(() => editor.access.check('saveSettings', {}, editor.viewer()))).toMatchObject({ status: 403, code: 'adminOnly', message: roles.COPY.adminOnly });
    expect(refused(() => editor.access.check('setViewAs', { role: 'editor' }, editor.viewer()))).toMatchObject({ code: 'adminOnly' });
    expect(refused(() => editor.access.check('someNewMethod', {}, editor.viewer()))).toMatchObject({ code: 'adminOnly' }); // unknown → admin only
    expect(editor.access.check('startResearchRun', { programId: 'p' }, editor.viewer())).toEqual({ programId: 'p' });
    const nobody = setup({ identity: { id: 'guest:pat@semrush.com', name: 'pat', email: 'pat@semrush.com', role: null, via: 'proxy' } });
    expect(nobody.access.check('state', undefined, nobody.viewer())).toBeUndefined();
    expect(refused(() => nobody.access.check('contentCatalog', {}, nobody.viewer()))).toMatchObject({ status: 403, message: expect.stringContaining('not in this studio yet') });
  });

  it('keeps a preview read-only: reads and switching back work, anything that writes is refused', () => {
    const { access, viewer } = setup({ identity: CHRIS, viewAs: { role: 'channel', channelId: 'blog' } });
    expect(viewer()).toMatchObject({ preview: true, role: 'channel' });
    expect(refused(() => access.check('createAssetKit', { source: { kind: 'report', assetId: 'asset-aio-toolkit-2' } }, viewer()))).toMatchObject({ status: 403, code: 'preview', message: 'You’re previewing as Semrush Blog’s channel owner. Switch back to Admin to make changes.' });
    expect(refused(() => access.check('setTrendAdoption', { themeId: 'theme-aio', status: 'using' }, viewer()))).toMatchObject({ code: 'preview' });
    expect(access.check('planAssetKit', { source: { kind: 'report', assetId: 'asset-aio-toolkit-2' } }, viewer())).toMatchObject({ deliverableIds: ['blogshort', 'bloglong'] });
    expect(access.check('setViewAs', { role: 'admin' }, viewer())).toEqual({ role: 'admin' });
    // The admin's own layout isn't forced to Simple by the channel they're previewing.
    expect(access.check('setViewPrefs', { uiMode: 'classic' }, viewer())).toEqual({ uiMode: 'classic' });
    const asEditor = setup({ identity: CHRIS, viewAs: { role: 'editor' } });
    expect(refused(() => asEditor.access.check('saveSettings', {}, asEditor.viewer()))).toMatchObject({ code: 'preview' });
    expect(refused(() => access.check('readStudioRun', { runId: 'research-new' }, viewer()))).toMatchObject({ code: 'forbidden' }); // a read the previewed role can't make
    expect(refused(() => asEditor.access.check('startResearchRun', {}, asEditor.viewer()))).toMatchObject({ code: 'preview', message: expect.stringContaining('previewing as an editor') });
  });
});

describe('channel owner scopes rebuild every payload', () => {
  it('makes drafts only from a trend brief, for their own channel, with no budget or extras', () => {
    const { access, viewer } = setup();
    const payload = { workspaceId: 'general', source: { kind: 'report', assetId: 'asset-aio-toolkit-2', text: 'injected' }, deliverableIds: ['social', 'pr', 'blogshort'], maxBudgetUsd: 900, imageVariants: 9, id: 'x', kind: 'run' };
    expect(access.check('planAssetKit', payload, viewer())).toEqual({ source: { kind: 'report', assetId: 'asset-aio-toolkit-2' }, deliverableIds: ['blogshort', 'bloglong'] });
    expect(access.check('createAssetKit', payload, viewer())).toEqual({ source: { kind: 'report', assetId: 'asset-aio-toolkit-2' }, deliverableIds: ['blogshort', 'bloglong'], onlyIfIdle: true });
    expect(refused(() => access.check('createAssetKit', { source: { kind: 'text', text: 'Anything' } }, viewer()))).toMatchObject({ status: 403, code: 'outOfScope' });
    expect(refused(() => access.check('createAssetKit', { source: { kind: 'report', assetId: 'asset-campaign-newsletter' } }, viewer()))).toMatchObject({ code: 'outOfScope' });
    expect(refused(() => access.check('createAssetKit', { source: { kind: 'run', runId: 'content-kit-blog' } }, viewer()))).toMatchObject({ code: 'outOfScope' });
  });

  it('leaves pictures out when pictures are off', () => {
    const { access, viewer } = setup({ identity: SAM, pictures: false });
    expect(access.check('createAssetKit', { source: { kind: 'report', assetId: 'asset-local-report' } }, viewer()).deliverableIds).toEqual(['social']);
    expect(setup({ identity: SAM }).access.check('createAssetKit', { source: { kind: 'report', assetId: 'asset-local-report' } }, setup({ identity: SAM }).viewer()).deliverableIds).toEqual(['social', 'brand-image']);
  });

  it('opens their channel’s files and trend briefs, never another channel’s', () => {
    const { access, viewer } = setup();
    expect(access.check('readStudioAsset', { assetId: 'asset-kit-blog-short', extra: 1 }, viewer())).toEqual({ assetId: 'asset-kit-blog-short' });
    expect(access.check('openStudioAsset', { assetId: 'asset-aio-report-2' }, viewer())).toEqual({ assetId: 'asset-aio-report-2' });
    expect(refused(() => access.check('readStudioAsset', { assetId: 'asset-kit-shared-social' }, viewer()))).toMatchObject({ status: 403, code: 'outOfScope', message: roles.COPY.outOfScope });
    expect(refused(() => access.check('readStudioAsset', { assetId: 'image-shared-0' }, viewer()))).toMatchObject({ code: 'outOfScope' });
    expect(refused(() => access.check('readStudioAsset', { assetId: 'asset-campaign-newsletter' }, viewer()))).toMatchObject({ code: 'outOfScope' });
    expect(refused(() => access.check('readStudioAsset', { assetId: 'asset-missing' }, viewer()))).toMatchObject({ status: 404 });
    expect(access.check('saveAssetKitFolder', { runId: 'content-kit-shared', channels: ['social'] }, viewer())).toEqual({ runId: 'content-kit-shared' });
    expect(refused(() => access.check('saveAssetKitFolder', { runId: 'content-kit-local' }, viewer()))).toMatchObject({ code: 'outOfScope' });
  });

  it('stops or finishes only a set made for their channel alone, with a budget the server sets', () => {
    const { access, viewer } = setup();
    expect(access.check('cancelStudioRun', { runId: 'content-kit-blog', maxBudgetUsd: 5 }, viewer())).toEqual({ runId: 'content-kit-blog' });
    expect(refused(() => access.check('retryStudioRun', { runId: 'content-kit-shared' }, viewer()))).toMatchObject({ status: 403, code: 'sharedSet', message: roles.COPY.sharedSet });
    expect(refused(() => access.check('cancelStudioRun', { runId: 'content-kit-local' }, viewer()))).toMatchObject({ code: 'outOfScope' });
    const sam = setup({ identity: SAM });
    // content-kit-local: two unfinished jobs, $3.10 reserved, a $15 cap → max(15, ceil(3.1 + 4)) = 15.
    expect(sam.access.check('retryStudioRun', { runId: 'content-kit-local', maxBudgetUsd: 999 }, sam.viewer())).toEqual({ runId: 'content-kit-local', maxBudgetUsd: 15 });
    sam.workspace.findRun('content-kit-local').reservedUsd = 14.5;
    expect(sam.access.check('retryStudioRun', { runId: 'content-kit-local' }, sam.viewer()).maxBudgetUsd).toBe(19);
  });

  it('answers for their own channel only, and keeps their layout Simple', () => {
    const { access, viewer } = setup();
    expect(access.check('setTrendAdoption', { themeId: 'theme-aio', channelId: 'social', status: 'using', link: 'semrush.com/blog/x', workspaceId: 'general', by: { id: 'member-chris' } }, viewer())).toEqual({ themeId: 'theme-aio', channelId: 'blog', status: 'using', link: 'semrush.com/blog/x' });
    expect(access.check('setTrendAdoption', { themeId: 'theme-aio', status: 'clear' }, viewer())).toEqual({ themeId: 'theme-aio', channelId: 'blog', status: 'clear' });
    expect(access.check('setViewPrefs', { uiMode: 'classic', welcomedAt: at('10-16'), viewAs: { role: 'admin' } }, viewer())).toEqual({ uiMode: 'simple', welcomedAt: at('10-16') });
    // View as is the real role's: a channel owner can't call it at all.
    expect(refused(() => access.check('setViewAs', { role: 'admin' }, viewer()))).toMatchObject({ code: 'adminOnly' });
  });

  it('signs an editor’s research review with their own name on the web', () => {
    const editor = setup({ identity: RILEY });
    expect(editor.access.check('saveResearchReview', { analysisId: 'a', reviewer: 'Chris' }, editor.viewer())).toEqual({ analysisId: 'a', reviewer: 'Riley' });
    const admin = setup({ identity: CHRIS });
    expect(admin.access.check('saveResearchReview', { analysisId: 'a', reviewer: 'Someone' }, admin.viewer())).toEqual({ analysisId: 'a', reviewer: 'Someone' });
  });
});

describe('what a channel owner gets back', () => {
  it('plans without money, models or other channels, and lists their earlier sets', () => {
    const { access, viewer } = setup();
    const plan = { title: 'AI Overviews eat clicks', sourceKey: 'theme:theme-aio', sourceKind: 'trend', route: 'claude', estimate: { totalUsd: 4.2, capUsd: 9, model: 'claude-opus-5-5' }, minutes: 5, imagesReady: true, warnings: ['No product registry is loaded.'], edited: { at: at('10-12', '08:00:00'), byName: 'Sam' },
      folders: [{ id: 'blog', name: 'Semrush Blog', items: [{ id: 'blogshort', label: 'Blog — Short News Update', kind: 'text', selected: true, available: true, usd: 0.4 }, { id: 'bloglong', label: 'Blog — Long-form Article', kind: 'text', selected: true, available: true, usd: 0.9 }] }, { id: 'social', name: 'Semrush Social Team', items: [{ id: 'social', label: 'Social', kind: 'text', selected: false, available: true, usd: 0.3 }] }] };
    const shaped = access.after('planAssetKit', plan, viewer());
    expect(shaped).toEqual({ title: 'AI Overviews eat clicks', folder: { id: 'blog', name: 'Semrush Blog', items: [{ id: 'blogshort', label: 'Blog — Short News Update', kind: 'text', pictures: 0 }, { id: 'bloglong', label: 'Blog — Long-form Article', kind: 'text', pictures: 0 }] }, minutes: 5, imagesReady: true, edited: { at: at('10-12', '08:00:00'), byName: 'Sam' },
      earlierSets: [{ runId: 'content-kit-shared', createdAt: at('10-13'), status: 'failed' }, { runId: 'content-kit-blog', createdAt: at('10-12'), status: 'succeeded' }] });
    expect(JSON.stringify(shaped)).not.toMatch(/usd|Usd|model|route|warnings|Social/);
  });

  it('gets runs as their channel’s view and files without evidence or receipts', () => {
    const { access, viewer, workspace } = setup();
    const run = access.after('createAssetKit', workspace.findRun('content-kit-shared'), viewer());
    expect(run).toMatchObject({ id: 'content-kit-shared', shared: true, jobs: [{ id: 'blogshort', status: 'failed' }] });
    expect(JSON.stringify(run)).not.toMatch(/costUsd|receipts|maxBudgetUsd|reservedUsd|budget|model|social/i);
    const file = access.after('readStudioAsset', { asset: { ...workspace.findAsset('asset-kit-blog-short').asset, receipt: { costUsd: 1 } }, output: { sections: [] }, markdown: '# Short', evidence: [{ id: 'e1' }], aggregateMetrics: {}, originalMarkdown: '# Old' }, viewer());
    expect(file).toEqual({ asset: { id: 'asset-kit-blog-short', title: 'AI Overviews: a short news update', deliverableId: 'blogshort', kind: 'text', format: 'markdown', createdAt: at('10-12', '10:20:00'), edited: { at: at('10-14'), byName: 'Alex' } }, markdown: '# Short' });
    expect(access.after('readStudioAsset', { asset: workspace.findAsset('image-shared-0').asset, imageDataUrl: 'data:image/png;base64,AA==' }, viewer())).toMatchObject({ imageDataUrl: 'data:image/png;base64,AA==', asset: { kind: 'image' } });
    expect(access.after('saveAssetKitFolder', { folderName: 'Golden Thread — x', assetCount: 2, path: '/Users/x/Downloads/Golden Thread — x', savedTo: 'downloads' }, viewer())).toEqual({ folderName: 'Golden Thread — x', assetCount: 2, savedTo: 'downloads' });
    expect(access.after('openStudioAsset', { path: '/data/runs/x.html' }, viewer())).toEqual({ opened: true });
    // Admins and editors get results as the handler made them.
    const admin = setup({ identity: CHRIS }); const raw = workspace.findRun('content-kit-shared');
    expect(admin.access.after('createAssetKit', raw, admin.viewer())).toBe(raw);
  });
});

describe('the activity log', () => {
  it('records decisions, kits, edits, research and people with the fields analytics reads', () => {
    const { access, team, workspace } = setup({ identity: RILEY }); const viewer = access.currentViewer();
    const research = workspace.findRun('research-review');
    access.after('decideResearchTheme', research, viewer, { runId: 'research-review', themeId: 'theme-agents', decision: 'approved' });
    access.after('approveResearchThemes', { ...research, decisions: { a: 'approved', b: 'approved', c: 'passed' } }, viewer, {});
    access.after('createAssetKit', workspace.findRun('content-kit-shared'), viewer, {});
    access.after('editStudioAsset', { asset: { id: 'asset-aio-toolkit-2', workspaceId: 'semrush', title: 'TREND: AI Overviews eat clicks' } }, viewer, {});
    access.after('startResearchRun', { id: 'research-9', workspaceId: 'semrush', programId: 'program-pulse', title: 'AI search pulse' }, viewer, {});
    expect(team.logs).toEqual([
      { kind: 'trend-decision', workspaceId: 'semrush', detail: { runId: 'research-review', themeId: 'theme-agents', trendName: 'Agentic checkout', decision: 'approved' }, by: { id: 'member-riley', name: 'Riley' } },
      { kind: 'trend-decision', workspaceId: 'semrush', detail: { runId: 'research-review', approved: 2, passed: 1 }, by: { id: 'member-riley', name: 'Riley' } },
      { kind: 'kit-created', workspaceId: 'semrush', detail: { runId: 'content-kit-shared', themeId: 'theme-aio', trendName: 'AI Overviews eat clicks', channels: ['blog', 'social'], estimateUsd: 4.2 }, by: { id: 'member-riley', name: 'Riley' } },
      { kind: 'report-edited', workspaceId: 'semrush', detail: { assetId: 'asset-aio-toolkit-2', title: 'TREND: AI Overviews eat clicks' }, by: { id: 'member-riley', name: 'Riley' } },
      { kind: 'research-started', workspaceId: 'semrush', detail: { runId: 'research-9', programId: 'program-pulse', programName: 'AI search pulse' }, by: { id: 'member-riley', name: 'Riley' } },
    ]);
  });

  it('logs what a handler reports, removes it from the answer, and never fails the action over a log', () => {
    const { access, team } = setup({ identity: CHRIS }); const viewer = access.currentViewer();
    const activity = { memberId: 'member-alex', name: 'Alex', action: 'added', role: 'channel', channelId: 'blog' };
    expect(access.after('saveMember', { member: { id: 'member-alex' }, activity }, viewer)).toEqual({ member: { id: 'member-alex' } });
    expect(access.after('createSignInLink', { url: 'https://studio/#signin=x', expiresAt: null, activity: { memberId: 'member-alex', name: 'Alex' } }, viewer)).toEqual({ url: 'https://studio/#signin=x', expiresAt: null });
    expect(team.logs.map((row) => [row.kind, row.workspaceId, row.detail])).toEqual([['member-changed', '', activity], ['link-issued', '', { memberId: 'member-alex', name: 'Alex' }]]);
    team.log = () => { throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); };
    expect(access.after('removeMember', { ok: true, activity: { memberId: 'm', name: 'M', action: 'removed' } }, viewer)).toEqual({ ok: true });
    expect(team.events).toContainEqual(expect.objectContaining({ event: 'activity-not-logged', method: 'removeMember', code: 'ENOSPC' }));
  });
});

describe('errors people can act on', () => {
  const error = (message, status = 400) => Object.assign(new Error(message), { status });
  it('sends editors and channel owners to an admin by name instead of to Settings', () => {
    const editor = setup({ identity: RILEY }); const owner = setup(); const admin = setup({ identity: CHRIS });
    const rewrite = (who, message, status) => who.access.rewriteError(error(message, status), who.viewer());
    expect(rewrite(editor, 'Add an Anthropic API key in Settings → Writing & research.', 400)).toMatchObject({ message: 'The studio’s AI or data connection needs attention. Ask Chris or Pat.', status: 400, code: 'askConnection' });
    expect(rewrite(editor, 'Connect the image provider in Settings to generate this image.')).toMatchObject({ message: 'Pictures aren’t set up for your team. Ask Chris or Pat to turn them on.' });
    expect(rewrite(editor, 'Connect Google Drive with file creation permission in Settings first.', 409)).toMatchObject({ message: 'Google Drive isn’t connected. Ask Chris or Pat to connect it.', status: 409 });
    expect(rewrite(owner, 'The Claude app is not signed in. Run "claude auth login" in Terminal.')).toMatchObject({ code: 'askConnection' });
    // Budgets: an editor can raise one, a channel owner can't.
    expect(rewrite(editor, 'Run budget exhausted. Increase the budget before retrying.').message).toBe('Run budget exhausted. Increase the budget before retrying.');
    expect(rewrite(owner, 'Run budget exhausted. Increase the budget before retrying.')).toMatchObject({ message: 'This needs an admin to finish. Ask Chris or Pat.', code: 'askBudget' });
    // Admins keep the original; refusals already written for people pass through; other errors are untouched.
    expect(rewrite(admin, 'Add an Anthropic API key in Settings → Writing & research.').message).toContain('Settings');
    const refusal = roles.refusal('sharedSet'); expect(owner.access.rewriteError(refusal, owner.viewer())).toBe(refusal);
    expect(rewrite(editor, 'Choose a written report.').message).toBe('Choose a written report.');
  });

  it('never passes a provider’s own error to editors or channel owners: no model ids, credit or billing', () => {
    const editor = setup({ identity: RILEY }); const owner = setup(); const admin = setup({ identity: CHRIS });
    const rewrite = (who, message) => who.access.rewriteError(Object.assign(new Error(message), { status: 400 }), who.viewer());
    const credit = 'the Claude app can’t use claude-fable-5-1: Claude could not complete this run: Credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits. Choose another model for those stages under "AI models and effort per stage", or use an account with access. Nothing was started.';
    const overloaded = 'Error: API Error: 529 {"type":"error","error":{"type":"overloaded_error"}} request_id=req_011CU';
    for (const who of [editor, owner]) {
      expect(rewrite(who, credit)).toMatchObject({ message: 'The studio’s AI or data connection needs attention. Ask Chris or Pat.', code: 'askConnection', status: 400 });
      expect(rewrite(who, overloaded)).toMatchObject({ code: 'askConnection' });
      expect(rewrite(who, 'Codex is not signed in on this computer.')).toMatchObject({ code: 'askConnection' });
      expect(rewrite(who, 'Apify run finished with status FAILED.')).toMatchObject({ code: 'askConnection' });
      expect(rewrite(who, 'OpenAI image generation hit its billing limit.')).toMatchObject({ code: 'askPictures' });
    }
    expect(rewrite(admin, credit).message).toBe(credit);
  });
});

describe('the state each person receives', () => {
  it('projects once per state and kind of viewer, and a channel owner’s view holds no money, programs or other channels', () => {
    const { access, viewer } = setup(); const base = fixture.baseState();
    const first = access.project(base, viewer()); expect(access.project(base, viewer())).toBe(first);
    const text = JSON.stringify(first);
    for (const secret of ['costUsd', 'receipts', 'programs', 'program-pulse', 'Private positioning', 'maxBudgetUsd', 'asset-kit-shared-social', 'Semrush Social Team']) expect(text).not.toContain(secret);
    expect(first.contentStudio.channelView.channel).toMatchObject({ id: 'blog', name: 'Semrush Blog' });
    const admin = setup({ identity: CHRIS });
    expect(admin.access.project(base, admin.viewer()).contentStudio.adoptionsByTheme['theme-aio'].blog).toMatchObject({ status: 'using', byName: 'Alex' });
    expect(admin.access.project(base, admin.viewer())).not.toBe(first);
  });
});

describe('capabilities at the gate', () => {
  const viewerRole = { id: 'role-viewer-ab12', label: 'Viewer', base: 'editor', capabilities: ['core', 'readAssets', 'readResearch'] };
  const reviewerRole = { id: 'role-reviewers-cd34', label: 'Channel reviewer', base: 'channel', capabilities: ['readAssets', 'markTrendsUsed', 'makeAssets'] };
  const policy = roles.compilePolicy({ rev: 3, builtIn: { editor: { grant: [], deny: ['startResearch'] } }, roles: [viewerRole, reviewerRole] });
  const SAM_VIEWER = { ...SAM, role: 'editor', roleId: 'role-viewer-ab12', channelId: null };
  const JORDAN = { id: 'member-jordan', name: 'Jordan', email: 'jordan@semrush.com', role: 'channel', roleId: 'role-reviewers-cd34', channelId: 'blog', via: 'link', disabled: false, memberSince: at('10-01') };

  it('refuses a capability the role policy turned off, naming it and who to ask', () => {
    const { access, viewer } = setup({ identity: RILEY, team: { policy } });
    expect(viewer()).toMatchObject({ role: 'editor', roleId: 'editor', base: 'editor' });
    expect(viewer().capabilities).not.toContain('startResearch');
    expect(refused(() => access.check('startResearchRun', { programId: 'p' }, viewer()))).toMatchObject({ status: 403, code: 'capabilityOff', message: 'Your access doesn’t include “Start research”. Ask Chris or Pat if you need it.' });
    expect(access.check('decideResearchTheme', { runId: 'r', themeId: 't', decision: 'approved' }, viewer())).toMatchObject({ decision: 'approved' });
  });

  it('lets a person-level grant allow the call, and a person-level deny refuse one the role has', () => {
    const { access, viewer } = setup({ identity: RILEY, team: { policy, access: { 'member-riley': { grants: ['startResearch'], denies: ['askAi'] } } } });
    expect(access.check('startResearchRun', { programId: 'p' }, viewer())).toEqual({ programId: 'p' });
    expect(refused(() => access.check('askHelp', { question: 'hi' }, viewer()))).toMatchObject({ code: 'capabilityOff' });
  });

  it('gives a custom channel-based role the channel owner’s scopes and result projections', () => {
    const { access, viewer, workspace } = setup({ identity: JORDAN, team: { policy } });
    expect(viewer()).toMatchObject({ role: 'channel', base: 'channel', roleId: 'role-reviewers-cd34', roleLabel: 'Channel reviewer', channelId: 'blog' });
    const payload = { workspaceId: 'general', source: { kind: 'report', assetId: 'asset-aio-toolkit-2' }, deliverableIds: ['social'], maxBudgetUsd: 900 };
    expect(access.check('createAssetKit', payload, viewer())).toEqual({ source: { kind: 'report', assetId: 'asset-aio-toolkit-2' }, deliverableIds: ['blogshort', 'bloglong'], onlyIfIdle: true });
    expect(refused(() => access.check('cancelStudioRun', { runId: 'content-kit-blog' }, viewer()))).toMatchObject({ code: 'capabilityOff' }); // no Stop and retry work
    expect(refused(() => access.check('readStudioRun', { runId: 'research-new' }, viewer()))).toMatchObject({ code: 'forbidden' });
    const run = access.after('createAssetKit', workspace.findRun('content-kit-shared'), viewer());
    expect(JSON.stringify(run)).not.toMatch(/costUsd|receipts|maxBudgetUsd/);
  });

  it('never sends money to a role without See costs, in state or in an answer', () => {
    const { access, viewer, workspace } = setup({ identity: SAM_VIEWER, team: { policy } });
    expect(viewer()).toMatchObject({ role: 'editor', roleLabel: 'Viewer', capabilities: ['core', 'readAssets', 'readResearch'] });
    const run = access.after('readStudioRun', workspace.findRun('content-kit-shared'), viewer(), {});
    expect(run).toMatchObject({ id: 'content-kit-shared' });
    expect(JSON.stringify(run)).not.toMatch(/costUsd|receipts|maxBudgetUsd|reservedUsd/);
    expect(JSON.stringify(access.project(fixture.baseState(), viewer()))).not.toMatch(/"costUsd"|"receipts"|"maxBudgetUsd"/);
    expect(refused(() => access.check('askHelp', { question: 'hi' }, viewer()))).toMatchObject({ code: 'capabilityOff' });
  });

  it('previews one person by memberId, with their own access, read-only', () => {
    const riley = { id: 'member-riley', name: 'Riley Jones', role: 'editor', channelId: null, grants: [], denies: ['askAi'], disabled: false };
    const { access, viewer } = setup({ identity: CHRIS, viewAs: { memberId: 'member-riley' }, team: { policy, members: { 'member-riley': riley } } });
    expect(viewer()).toMatchObject({ preview: true, role: 'editor', previewName: 'Riley Jones', viewAs: { memberId: 'member-riley', role: 'editor', channelId: null } });
    expect(viewer().capabilities).not.toContain('askAi');
    expect(refused(() => access.check('decideResearchTheme', {}, viewer()))).toMatchObject({ code: 'preview', message: 'You’re previewing as Riley Jones. Switch back to Admin to make changes.' });
    expect(access.check('readStudioRun', { runId: 'research-new' }, viewer())).toEqual({ runId: 'research-new' });
    expect(access.check('setViewAs', { role: 'admin' }, viewer())).toEqual({ role: 'admin' });
  });

  it('writes the access log from what a handler reports and takes it out of the answer; revoking a link is logged', () => {
    const { access, team, viewer } = setup({ identity: CHRIS, team: { policy } });
    const row = { kind: 'link-revoked', target: { type: 'member', id: 'member-alex', name: 'Alex' }, changes: [], affected: 1 };
    expect(access.after('revokeSignInLink', { ok: true, audit: [row] }, viewer(), { id: 'member-alex' })).toEqual({ ok: true });
    expect(access.after('saveRolePolicy', { access: { rev: 4 }, affected: 2, audit: [{ kind: 'policy-changed', target: { type: 'role', id: 'editor', name: 'Editor' }, changes: [], affected: 2 }] }, viewer(), {})).toEqual({ access: { rev: 4 }, affected: 2 });
    expect(team.audits).toEqual([{ rows: [row], by: { id: 'member-chris', name: 'Chris' } }, expect.objectContaining({ by: { id: 'member-chris', name: 'Chris' } })]);
    // An empty list writes nothing, and a method that isn't audited keeps its answer as it is.
    access.after('saveMemberAccess', { member: {}, audit: [] }, viewer(), {});
    expect(team.audits).toHaveLength(2);
    team.audit = () => { throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); };
    expect(access.after('deleteRole', { ok: true, moved: 0, audit: [row] }, viewer(), {})).toEqual({ ok: true, moved: 0 });
    expect(team.events).toContainEqual(expect.objectContaining({ event: 'audit-not-logged', method: 'deleteRole', code: 'ENOSPC' }));
  });

  it('answers the browser server: who may upload, who a request acts as, and a key per view', () => {
    const { access } = setup({ team: { policy } });
    expect(access.canUpload(CHRIS, { viewAs: null })).toBe(true);
    expect(access.canUpload(RILEY, { viewAs: null })).toBe(true);
    expect(access.canUpload(SAM_VIEWER, { viewAs: null })).toBe(false); // no method of theirs reads a file
    expect(access.canUpload(ALEX, { viewAs: null })).toBe(false);
    expect(access.canUpload(CHRIS, { viewAs: { role: 'editor' } })).toBe(false); // never in a preview
    expect(access.effectiveFor(CHRIS, { viewAs: { role: 'role-reviewers-cd34', channelId: 'social' } })).toEqual({ role: 'channel', roleId: 'role-reviewers-cd34', channelId: 'social', preview: true });
    expect(access.viewKeyFor(CHRIS, { viewAs: { role: 'editor' } })).not.toBe(access.viewKeyFor(CHRIS, { viewAs: { role: 'role-viewer-ab12' } }));
  });
});
