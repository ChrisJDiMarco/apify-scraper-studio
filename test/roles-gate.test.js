import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { createRequire } from 'node:module';
import studio from './helpers/roles-studio.js';

// The gate on the real main process (src/main/index.js). The browser studio's runtime (web-runtime.js) runs it as the
// server does, with only child processes replaced: AI CLIs are recorded and never run, so nothing paid is called.
// A second harness loads it as the Mac app, with a window that records what the app pushes.
const mainPath = path.resolve('src/main/index.js');
const mainRequire = createRequire(mainPath);
const { MEMBERS, identity, seedStudio, TREND } = studio;
const roots = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
afterAll(() => { for (const root of roots) fs.rmSync(root, { recursive: true, force: true }); });

// AI CLIs: each call is recorded; Codex fails at once unless held, so a run started by a test ends quickly.
function fakeCli() {
  const calls = []; let holding = false; const held = [];
  function spawn(command, args = [], options = {}) {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.stdin = new Writable({ write(_chunk, _encoding, done) { done(); } });
    child.kill = () => { queueMicrotask(() => child.emit('close', null, 'SIGTERM')); return true; };
    calls.push({ command, args, env: options.env });
    const finish = () => { child.stderr.write('Fixture CLI: no AI in tests.'); child.emit('close', 1, null); };
    if (holding) held.push(finish); else queueMicrotask(finish);
    return child;
  }
  return { spawn, calls, hold: () => { holding = true; }, release: () => { holding = false; for (const finish of held.splice(0)) finish(); } };
}

describe('the gate on the browser studio', () => {
  let runtime; let dataDir; let cli; const sessions = new Map();
  const sessionOf = (member) => { if (!sessions.has(member.id)) sessions.set(member.id, { expires: Date.now() + 3600000, kind: 'link', memberId: member.id, linkId: 'fixture', viewAs: null }); return sessions.get(member.id); };
  const as = (member) => (channel, payload) => runtime.invoke(channel, payload, { user: identity(member), session: sessionOf(member), origin: 'https://studio.example.com' }).then((outcome) => outcome.result);
  const chris = as(MEMBERS.chris); const riley = as(MEMBERS.riley); const alex = as(MEMBERS.alex);
  const run = async (runId) => chris('studio:readStudioRun', { runId });
  // A run started here fails as soon as it reaches the fixture CLI; wait for it to finish.
  async function settled(runId) { for (let i = 0; i < 200; i++) { const value = await run(runId); if (!['queued', 'running'].includes(value.status)) return value; await sleep(10); } throw new Error('The run never finished.'); }
  const kitRuns = async () => (await chris('state')).contentStudio.contentRuns.filter((entry) => entry.kit);

  beforeAll(async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'roles-gate-')); roots.push(root); dataDir = path.join(root, 'data');
    seedStudio(dataDir);
    process.env.SHELL = '/bin/sh'; // the login-shell PATH probe must not read a developer's shell setup
    runtime = mainRequire('./web-runtime');
    runtime.configure({ dataDir, secretKey: 'roles-gate-test-secret-0123456789abcdef' });
    cli = fakeCli();
    vm.runInNewContext(fs.readFileSync(mainPath, 'utf8'), {
      require: (name) => (name === 'child_process' ? { spawn: cli.spawn } : mainRequire(name)),
      process: { pid: process.pid, platform: process.platform, env: { STUDIO_RUNTIME: 'web', STUDIO_PASSWORD: 'roles-gate-admin-password' }, argv: [] },
      __dirname: path.dirname(mainPath), Buffer, URL, AbortController, setTimeout, clearTimeout, setInterval, clearInterval, setImmediate,
      fetch: () => { throw new Error('Network access is forbidden in this test.'); },
    }, { filename: mainPath });
    await sleep(50); // whenReady work
  });
  afterAll(() => { cli?.release(); runtime?.shutdown(); });

  it('refuses a call that carries no signed-in person', async () => {
    await expect(runtime.invoke('state', undefined)).rejects.toMatchObject({ status: 403 });
    await expect(runtime.invoke('app-meta', undefined, { user: null })).rejects.toMatchObject({ status: 403 });
  });

  it('keeps a channel owner to their own channel', async () => {
    await expect(alex('save-settings', { aiProvider: 'claude' })).rejects.toMatchObject({ status: 403, message: 'Only an admin can do that.' });
    await expect(alex('studio:startResearchRun', { programId: 'program-pulse' })).rejects.toMatchObject({ status: 403, message: 'Only editors and admins can do that. Ask an admin if you need it.' });
    await expect(alex('help:ask', { question: 'What is new?' })).rejects.toMatchObject({ status: 403 });
    await expect(alex('studio:readStudioAsset', { assetId: 'asset-kit-social' })).rejects.toMatchObject({ status: 403, message: 'That belongs to another channel.' });
    await expect(alex('studio:saveAssetKitFolder', { runId: 'content-kit-social' })).rejects.toMatchObject({ status: 403 });
    expect(cli.calls).toEqual([]); // nothing reached an AI
    const brief = await alex('studio:readStudioAsset', { assetId: 'asset-toolkit' });
    expect(brief).toEqual({ asset: expect.objectContaining({ id: 'asset-toolkit', edited: null }), markdown: expect.stringContaining('lead with the measurement gap') });
    expect(Object.keys(brief.asset).sort()).toEqual(['createdAt', 'deliverableId', 'edited', 'format', 'id', 'kind', 'title']);
  });

  it('gives a channel owner only their channel’s state, with no money, programs or other channels', async () => {
    const state = await alex('state');
    expect(state.viewer).toMatchObject({ role: 'channel', channelId: 'blog', channelName: 'Semrush Blog', preview: false });
    expect(Object.keys(state).sort()).toEqual(['contentStudio', 'keys', 'settings', 'team', 'viewer']);
    expect(state.contentStudio.channelView.trends).toEqual([expect.objectContaining({ themeId: 'theme-citations', name: TREND, primaryReportId: 'asset-toolkit', isNew: true })]);
    const text = JSON.stringify(state);
    for (const hidden of ['costUsd', 'receipts', 'program-pulse', 'maxBudgetUsd', 'asset-kit-social', 'content-kit-social', 'Semrush Social Team']) expect(text).not.toContain(hidden);
    expect((await chris('state')).contentStudio.programs).toHaveLength(2);
  });

  it('makes a channel owner’s set with their channel’s files and the server’s own budget', async () => {
    const plan = await chris('studio:planAssetKit', { source: { kind: 'report', assetId: 'asset-toolkit' }, deliverableIds: ['blogshort', 'bloglong'] });
    const ownPlan = await alex('studio:planAssetKit', { source: { kind: 'report', assetId: 'asset-toolkit' }, deliverableIds: ['social'] });
    expect(ownPlan).toEqual({ title: TREND, folder: { id: 'blog', name: 'Semrush Blog', items: [expect.objectContaining({ id: 'blogshort' }), expect.objectContaining({ id: 'bloglong' })] }, minutes: expect.any(Number), imagesReady: false, edited: null, earlierSets: [] });
    const made = await alex('studio:createAssetKit', { workspaceId: 'general', source: { kind: 'report', assetId: 'asset-toolkit' }, deliverableIds: ['social', 'pr'], maxBudgetUsd: 999, imageVariants: 9 });
    expect(made).toMatchObject({ title: TREND, shared: false, kit: { themeId: 'theme-citations' }, jobs: [{ id: 'blogshort' }, { id: 'bloglong' }] });
    expect(JSON.stringify(made)).not.toMatch(/costUsd|receipts|maxBudgetUsd|reservedUsd|model/);
    const saved = await settled(made.id);
    expect(saved.jobs.map((job) => job.id)).toEqual(['blogshort', 'bloglong']);
    expect(saved.maxBudgetUsd).toBe(plan.estimate.capUsd);
    expect(saved.workspaceId).toBe('semrush');
    expect(saved.createdBy).toEqual({ id: 'member-alex', name: 'Alex' });
    // Codex ran without the server's secrets.
    const codex = cli.calls.filter((call) => call.command === 'codex');
    expect(codex.length).toBeGreaterThan(0);
    for (const call of codex) for (const name of Object.keys(call.env)) expect(name).not.toMatch(/^STUDIO_|^ANTHROPIC_API_KEY$|^OPENAI_API_KEY$|^MONDAY_API_TOKEN$|^GOOGLE_SHEETS_WEBHOOK_URL$/);
  });

  it('edits a report, refuses a stale save, and sends the edit into the next set', async () => {
    const opened = await riley('studio:readStudioAsset', { assetId: 'asset-toolkit' });
    expect(opened.edited).toBeNull();
    const markdown = '# AI citations, edited\n\nUNIQUE-EDIT-MARKER: lead with **ROI**, not reach.\n\n- One\n- Two';
    const { asset } = await riley('studio:editStudioAsset', { assetId: 'asset-toolkit', markdown, baseEditedAt: '' });
    expect(asset.edited).toMatchObject({ by: { id: 'member-riley', name: 'Riley' } });
    // Someone who opened the report before Riley saved can't overwrite her edit.
    await expect(chris('studio:editStudioAsset', { assetId: 'asset-toolkit', markdown: '# Mine', baseEditedAt: '' })).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/^Riley saved this report at .+, after you opened it\./) });
    const reread = await alex('studio:readStudioAsset', { assetId: 'asset-toolkit' });
    expect(reread).toMatchObject({ markdown, asset: { edited: { at: asset.edited.at, byName: 'Riley' } } });
    const html = fs.readFileSync(path.join(dataDir, 'content-studio', 'runs', 'content-trend', 'asset-toolkit.edited.html'), 'utf8');
    expect(html).toContain('<h1>AI citations, edited</h1>'); expect(html).toContain('<strong>ROI</strong>'); expect(html).toContain('<ul><li>One</li><li>Two</li></ul>');
    const plan = await alex('studio:planAssetKit', { source: { kind: 'report', assetId: 'asset-toolkit' } });
    expect(plan.edited).toEqual({ at: asset.edited.at, byName: 'Riley' });
    expect(plan.earlierSets).toEqual([expect.objectContaining({ status: 'failed' })]);
    const made = await alex('studio:createAssetKit', { source: { kind: 'report', assetId: 'asset-toolkit' } });
    const input = JSON.parse(fs.readFileSync(path.join(dataDir, 'content-studio', 'runs', made.id, 'input.json'), 'utf8'));
    expect(input.source.text).toContain('UNIQUE-EDIT-MARKER');
    await settled(made.id);
    const activity = (await chris('team:analytics', { days: 30 })).recent.map((row) => row.text);
    expect(activity).toContain('Riley edited “TREND: AI Citation Tracking”');
    expect(activity).toContain('Alex generated drafts of “AI Citation Tracking” for Semrush Blog');
  });

  it('makes one set when a channel owner taps Generate twice', async () => {
    const before = (await kitRuns()).length;
    cli.hold();
    const results = await Promise.allSettled([alex('studio:createAssetKit', { source: { kind: 'report', assetId: 'asset-toolkit' } }), alex('studio:createAssetKit', { source: { kind: 'report', assetId: 'asset-toolkit' } })]);
    const made = results.filter((result) => result.status === 'fulfilled'); expect(made).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected').reason).toMatchObject({ status: 409, message: 'Your Semrush Blog assets for this trend are already being made.' });
    expect((await kitRuns()).length).toBe(before + 1);
    // An editor isn't held to it: they decide when a second set makes sense.
    const second = await riley('studio:createAssetKit', { source: { kind: 'report', assetId: 'asset-toolkit' }, deliverableIds: ['blogshort'] });
    expect(second.id).toBeTruthy();
    cli.release();
    await settled(second.id); await settled(made[0].value.id);
  });

  it('records a channel owner’s answer for their channel only, on ready trends only', async () => {
    const { adoption } = await alex('team:adoption', { themeId: 'theme-citations', channelId: 'social', status: 'using', link: 'semrush.com/blog/ai-citations' });
    expect(adoption).toMatchObject({ channelId: 'blog', status: 'using', link: 'https://semrush.com/blog/ai-citations', byName: 'Alex', byMe: true });
    await expect(alex('team:adoption', { themeId: 'theme-unknown', status: 'using' })).rejects.toMatchObject({ status: 404 });
    const state = await alex('state');
    expect(state.contentStudio.channelView.trends[0].adoption).toMatchObject({ status: 'using', byMe: true });
    expect((await chris('state')).contentStudio.adoptionsByTheme['theme-citations']).toEqual({ blog: expect.objectContaining({ status: 'using', byName: 'Alex' }) });
    // An admin can correct any channel's answer.
    expect((await chris('team:adoption', { themeId: 'theme-citations', channelId: 'social', status: 'not-using' })).adoption).toMatchObject({ channelId: 'social', byName: 'Chris' });
  });

  it('runs View as on the browser session: a read-only preview that lowers the role and clears with Admin', async () => {
    const { viewer } = await chris('team:view-as', { role: 'channel', channelId: 'blog' });
    expect(viewer).toMatchObject({ role: 'channel', realRole: 'admin', preview: true, channelId: 'blog' });
    expect(sessionOf(MEMBERS.chris).viewAs).toEqual({ role: 'channel', channelId: 'blog' });
    expect((await chris('state')).viewer).toMatchObject({ role: 'channel', preview: true });
    await expect(chris('save-settings', {})).rejects.toMatchObject({ status: 403, message: 'You’re previewing as Semrush Blog’s channel owner. Switch back to Admin to make changes.' });
    await expect(chris('team:adoption', { themeId: 'theme-citations', status: 'clear' })).rejects.toMatchObject({ status: 403 });
    expect((await chris('studio:readStudioAsset', { assetId: 'asset-toolkit' })).asset).not.toHaveProperty('workspaceId');
    expect((await chris('team:view-as', { role: 'admin' })).viewer).toMatchObject({ role: 'admin', preview: false });
    expect(sessionOf(MEMBERS.chris).viewAs).toBeNull();
    await expect(riley('team:view-as', { role: 'channel', channelId: 'blog' })).rejects.toMatchObject({ status: 403, message: 'Only an admin can do that.' });
  });

  it('manages people and makes sign-in links with the page’s own address', async () => {
    const { member } = await chris('team:save-member', { name: 'Dana', email: 'Dana@Semrush.com', role: 'channel', channelId: 'pr' });
    expect(member).toMatchObject({ name: 'Dana', email: 'dana@semrush.com', role: 'channel', channelId: 'pr', disabled: false, link: null, serverAdmin: false });
    const link = await chris('team:sign-in-link', { id: member.id });
    expect(link).toEqual({ url: expect.stringMatching(/^https:\/\/studio\.example\.com\/#signin=[0-9a-f]{64}$/), expiresAt: expect.any(String) });
    const team = await chris('team:list');
    expect(team.signIn).toEqual({ web: true, sso: false, links: true, linkDays: 30 });
    expect(team.members.find((entry) => entry.id === member.id).link).toEqual({ createdAt: expect.any(String), expiresAt: link.expiresAt, lastUsedAt: '' });
    expect(JSON.stringify(team)).not.toMatch(/hash|signin=/);
    expect(team.channels.find((channel) => channel.id === 'pr').owners).toEqual([{ id: member.id, name: 'Dana' }]);
    await expect(chris('team:save-member', { id: 'member-chris', role: 'editor' })).rejects.toMatchObject({ status: 403, message: 'You can’t change your own access. Ask another admin.' });
    expect(await chris('team:remove-member', { id: member.id })).toEqual({ ok: true });
    await expect(riley('team:list')).rejects.toMatchObject({ status: 403 });
    const recent = (await chris('team:analytics', {})).recent.map((row) => row.text);
    expect(recent).toEqual(expect.arrayContaining(['Chris added Dana as a channel owner for Semrush PR', 'Chris made a new sign-in link for Dana', 'Chris removed Dana']));
  });

  it('changes what a role can do, one person’s access, custom roles and previews, all enforced by the server', async () => {
    const team = await chris('team:list');
    expect(team.access).toMatchObject({ rev: expect.any(Number), groups: expect.any(Array), roles: expect.arrayContaining([expect.objectContaining({ id: 'editor', builtIn: true })]) });
    expect(team.members.find((member) => member.id === 'member-riley')).toMatchObject({ role: 'editor', roleLabel: 'Editor', base: 'editor', grants: [], denies: [], capabilities: expect.arrayContaining(['startResearch', 'viewPrompts']) });
    // Turn off Start research for Editor: Riley is refused, naming it, and her state no longer lists it.
    const saved = await chris('team:role-policy', { rev: team.access.rev, builtIn: { editor: { grant: [], deny: ['startResearch'] } } });
    expect(saved).toMatchObject({ affected: expect.any(Number), access: { rev: team.access.rev + 1 } });
    expect(saved).not.toHaveProperty('audit');
    await expect(riley('studio:startResearchRun', { programId: 'program-pulse' })).rejects.toMatchObject({ status: 403, code: 'capabilityOff', message: expect.stringContaining('“Start research”') });
    expect((await riley('state')).viewer.capabilities).not.toContain('startResearch');
    await expect(chris('team:role-policy', { rev: team.access.rev, builtIn: { editor: { grant: [], deny: [] } } })).rejects.toMatchObject({ status: 409, code: 'policyConflict' });
    // Her own grant gives it back to her alone.
    const { member } = await chris('team:member-access', { id: 'member-riley', grants: ['startResearch'], denies: [] });
    expect(member).toMatchObject({ grants: ['startResearch'], capabilities: expect.arrayContaining(['startResearch']) });
    expect((await riley('state')).viewer.capabilities).toContain('startResearch');
    // Preview exactly what she sees, then a custom role.
    const asRiley = (await chris('team:view-as', { memberId: 'member-riley' })).viewer;
    expect(asRiley).toMatchObject({ preview: true, role: 'editor', previewName: 'Riley', previewChanges: 1, viewAs: { memberId: 'member-riley' } });
    await expect(chris('studio:startResearchRun', { programId: 'program-pulse' })).rejects.toMatchObject({ status: 403, code: 'preview' });
    const access = (await chris('team:list')).access;
    await expect(chris('team:save-role', { label: 'Viewer', base: 'editor', template: 'viewer', rev: access.rev })).rejects.toMatchObject({ status: 403, code: 'preview' }); // still previewing
    await chris('team:view-as', { role: 'admin' });
    const { role } = await chris('team:save-role', { label: 'Viewer', base: 'editor', template: 'viewer', rev: access.rev });
    expect(role).toMatchObject({ label: 'Viewer', base: 'editor', capabilities: ['core', 'readAssets', 'readResearch'] });
    expect((await chris('team:view-as', { role: role.id })).viewer).toMatchObject({ preview: true, role: 'editor', roleId: role.id, roleLabel: 'Viewer' });
    const viewerState = await chris('state');
    expect(JSON.stringify(viewerState.contentStudio)).not.toMatch(/"costUsd"|"maxBudgetUsd"|"receipts"/); // no See costs, no money
    await chris('team:view-as', { role: 'admin' });
    await expect(riley('team:preview-access', { role: 'editor' })).rejects.toMatchObject({ status: 403, message: 'Only an admin can do that.' });
    expect(await chris('team:preview-access', { role: role.id })).toMatchObject({ base: 'editor', capabilities: ['core', 'readAssets', 'readResearch'], can: ['See research and evidence', 'Read reports and assets'] });
    // The access log says what happened, newest first.
    const log = await chris('team:access-log', { limit: 10 });
    expect(log.rows.map((row) => row.text)).toEqual(expect.arrayContaining(['Chris made the Viewer role, built on Editor', 'Chris turned on Start research for Riley', 'Chris turned off Start research for Editor']));
    // Put things back for the tests after this one.
    const latest = (await chris('team:list')).access;
    await chris('team:delete-role', { id: role.id, rev: latest.rev });
    await chris('team:role-policy', { rev: latest.rev + 1, builtIn: { editor: { grant: [], deny: [] } } });
    await chris('team:member-access', { id: 'member-riley', grants: [], denies: [] });
  });

  it('invites people in one go, with a sign-in link each', async () => {
    const result = await chris('team:invite', { people: [{ email: 'Jordan@Semrush.com' }, { email: 'riley@semrush.com' }], role: 'channel', channelId: 'pr' });
    expect(result.members).toEqual([expect.objectContaining({ name: 'Jordan', email: 'jordan@semrush.com', role: 'channel', base: 'channel', channelId: 'pr' })]);
    expect(result.links).toEqual([{ id: result.members[0].id, url: expect.stringMatching(/^https:\/\/studio\.example\.com\/#signin=[0-9a-f]{64}$/), expiresAt: expect.any(String) }]);
    expect(result.skipped).toEqual([{ email: 'riley@semrush.com', reason: 'Already in the studio' }]);
    expect(result).not.toHaveProperty('audit'); expect(result).not.toHaveProperty('activity');
    expect((await chris('team:analytics', {})).recent.map((row) => row.text)).toContain('Chris added Jordan as a channel owner for Semrush PR');
    expect(await chris('team:remove-member', { id: result.members[0].id })).toEqual({ ok: true });
  });

  it('tells an editor who is already searching with a program before anything is spent', async () => {
    const before = cli.calls.length;
    await expect(chris('studio:startResearchRun', { programId: 'program-weekly' })).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/^Riley started a search with this program at Oct 15, .+\. It’s still running\.$/) });
    expect(cli.calls.length).toBe(before); // refused before the model check
  });
});

describe('the gate on the Mac app', () => {
  let handlers; let sent; let root; let app;
  afterAll(() => { app?.emit('before-quit'); app?.emit('quit'); });
  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'roles-desktop-')); roots.push(root);
    seedStudio(root, { team: false });
    handlers = new Map(); sent = [];
    app = Object.assign(new EventEmitter(), { isPackaged: false, getPath: () => root, getVersion: () => 'test', whenReady: () => Promise.resolve(), setAboutPanelOptions: () => {} });
    class BrowserWindow extends EventEmitter {
      constructor() { super(); this.webContents = Object.assign(new EventEmitter(), { send: (channel, payload) => sent.push({ channel, payload }), session: { setPermissionRequestHandler: () => {} }, setWindowOpenHandler: () => {} }); }
      loadURL() { return Promise.resolve(); } loadFile() { return Promise.resolve(); } isDestroyed() { return false; } show() {}
      static getAllWindows() { return []; }
    }
    vm.runInNewContext(fs.readFileSync(mainPath, 'utf8'), {
      require: (name) => {
        if (name === 'electron') return { app, BrowserWindow, Menu: { setApplicationMenu: () => {}, buildFromTemplate: () => ({}) }, ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) }, safeStorage: { isEncryptionAvailable: () => false }, shell: { openExternal: () => Promise.resolve() }, dialog: {} };
        if (name === 'electron-updater') return {};
        if (name === 'child_process') return { spawn: () => { throw new Error('No CLIs in this test.'); } };
        return mainRequire(name);
      },
      process: { pid: process.pid, platform: 'darwin', env: {}, argv: [] },
      __dirname: path.dirname(mainPath), Buffer, URL, AbortController, setTimeout, clearTimeout, setInterval, clearInterval, setImmediate,
    }, { filename: mainPath });
    await sleep(20); // whenReady: the window exists
  });
  const last = () => sent.filter((entry) => entry.channel === 'state-changed').at(-1)?.payload;

  it('keeps synchronous handlers synchronous', () => {
    const meta = handlers.get('app-meta')(null);
    expect(typeof meta.then).toBe('undefined'); expect(meta).toMatchObject({ runtime: 'desktop', dataRoot: root });
    const state = handlers.get('state')();
    expect(state.viewer).toMatchObject({ id: 'local', role: 'admin', via: 'desktop', allowed: expect.arrayContaining(['saveSettings', 'setViewAs']) });
    expect(state.contentStudio.programs).toHaveLength(2);
    expect(state.team).toEqual({ admins: [], memberCount: 0 });
  });

  it('pushes the projected state while an admin previews, and the full state again after', () => {
    expect(handlers.get('team:view-as')(null, { role: 'channel', channelId: 'blog' }).viewer).toMatchObject({ role: 'channel', preview: true });
    let pushed = last();
    expect(pushed.viewer).toMatchObject({ role: 'channel', channelId: 'blog', preview: true, realRole: 'admin' });
    expect(pushed.contentStudio.channelView.channel).toMatchObject({ id: 'blog', name: 'Semrush Blog' });
    expect(JSON.stringify(pushed)).not.toMatch(/costUsd|receipts|program-pulse|asset-kit-social/);
    expect(() => handlers.get('save-settings')(null, { uiMode: 'classic' })).toThrow('You’re previewing as Semrush Blog’s channel owner.');
    // Any later push (here: the admin's own layout preference) stays the preview.
    const count = sent.length;
    handlers.get('team:prefs')(null, { uiMode: 'classic' });
    expect(sent.length).toBe(count + 1); pushed = last();
    expect(pushed.viewer).toMatchObject({ role: 'channel', preview: true });
    // An editor preview pushes the full state, with the editor's controls to show turned off.
    handlers.get('team:view-as')(null, { role: 'editor' });
    pushed = last();
    expect(pushed.viewer).toMatchObject({ role: 'editor', preview: true, roleAllowed: expect.arrayContaining(['decideResearchTheme', 'editStudioAsset']) });
    expect(pushed.viewer.allowed).not.toContain('decideResearchTheme');
    expect(pushed.contentStudio.programs).toHaveLength(2);
    handlers.get('team:view-as')(null, { role: 'admin' });
    pushed = last();
    expect(pushed.viewer).toMatchObject({ role: 'admin', preview: false, prefs: { uiMode: 'classic' } });
    expect(pushed.viewer).not.toHaveProperty('roleAllowed');
    expect(pushed.settings.uiMode).toBe('classic'); // the Mac keeps the layout in Settings too
    expect(pushed.contentStudio.programs).toHaveLength(2);
  });

  it('tells the Mac app that sign-in links are for the web version', () => {
    expect(() => handlers.get('team:sign-in-link')(null, { id: 'member-x' })).toThrow('Sign-in links are for the web version.');
    expect(handlers.get('team:list')().signIn).toEqual({ web: false, sso: false, links: false, linkDays: 30 });
  });
});
