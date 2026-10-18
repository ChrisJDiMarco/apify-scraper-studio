import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import studio from './helpers/roles-studio.js';

// The data-safety fixes on the real main process (src/main/index.js): Apify run limits, request IDs on paid long calls,
// strict data.json/config.json reads, the per-dataset cache behind every state broadcast, one Monday sync at a time, the
// daily AI budget, and on the browser studio, saved keys under the wrong STUDIO_SECRET_KEY and temporary export copies.
const mainPath = path.resolve('src/main/index.js');
const mainRequire = createRequire(mainPath);
const source = fs.readFileSync(mainPath, 'utf8');
const roots = [];
const temp = (prefix) => { const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); roots.push(root); return root; };
afterAll(() => { for (const root of roots) { try { fs.chmodSync(path.join(root, 'data.json'), 0o644); } catch (_) { /* not there */ } fs.rmSync(root, { recursive: true, force: true }); } });
afterEach(() => { vi.unstubAllGlobals(); });
const later = (work) => Promise.resolve().then(work); // a handler that refuses synchronously, as a promise

// The Mac app's main process with its outside world replaced: Apify, child processes and (optionally) its fs.
function desktop(root, { env = {}, ApifyClient, spawn, fsModule } = {}) {
  const handlers = new Map();
  const app = Object.assign(new EventEmitter(), { getPath: () => root, whenReady: () => ({ then() {} }), getVersion: () => 'test' });
  vm.runInNewContext(source, {
    require: (name) => {
      if (name === 'electron') return { app, ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) }, safeStorage: { isEncryptionAvailable: () => false }, dialog: { showErrorBox() {} }, shell: { showItemInFolder() {} } };
      if (name === 'electron-updater') return {};
      if (name === 'apify-client' && ApifyClient) return { ApifyClient };
      if (name === 'child_process' && spawn) return { spawn };
      if (name === 'fs' && fsModule) return fsModule;
      return mainRequire(name);
    },
    process: { pid: process.pid, platform: process.platform, env: { STUDIO_DISABLE_LOCAL_ENV: '1', ...env }, argv: [] },
    __dirname: path.dirname(mainPath), Buffer, URL, AbortController, setTimeout, clearTimeout, setImmediate,
  }, { filename: mainPath });
  return { call: (channel, payload) => handlers.get(channel)(null, payload), close: () => { app.emit('before-quit'); app.emit('quit'); } };
}

// Apify: every Actor start is recorded with the options the studio sent; a start takes a moment, as a real one does.
function fakeApify(starts, status = 'SUCCEEDED') {
  return class FakeApifyClient {
    actor() { return { start: async (input, options) => { starts.push(options); await new Promise((resolve) => setTimeout(resolve, 15)); return { id: `apify-${starts.length}`, status, defaultDatasetId: 'dataset-remote' }; } }; }
    dataset() { return { listItems: async () => ({ items: [{ id: 'row-1', text: 'Answer engines are eating search.', url: 'https://x.com/a/1' }], count: 1, total: 1 }) }; }
    run() { return { abort: async () => {}, get: async () => null }; }
  };
}

describe('Apify runs from Scrapers', () => {
  it('give every scraper run and test a charge cap and a timeout, old scrapers included', async () => {
    const root = temp('safety-apify-');
    fs.writeFileSync(path.join(root, 'data.json'), JSON.stringify({ recipes: [{ id: 'recipe-old', name: 'Old crawler', platform: 'web', actorId: 'owner/old', input: {}, mapper: {} }] }));
    const starts = []; const app = desktop(root, { env: { APIFY_API_TOKEN: 'apify_api_fixture' }, ApifyClient: fakeApify(starts) });
    try {
      const saved = app.call('save-recipe', { name: 'Crawler', platform: 'web', actorId: 'owner/crawler', inputJson: '{"maxCrawlPages":0}' });
      expect(saved.runOptions).toEqual({ maxTotalChargeUsd: 5, timeoutSecs: 900 });
      const sample = await app.call('test-recipe', { ...saved, inputJson: JSON.stringify(saved.input) });
      expect(starts[0]).toEqual({ maxItems: 10, maxTotalChargeUsd: 1, timeout: 180 });
      expect(sample.limits).toEqual({ maxTotalChargeUsd: 1, timeoutSecs: 180 });
      await app.call('run-recipe', saved.id);
      expect(starts[1]).toMatchObject({ maxTotalChargeUsd: 5, timeout: 900 });
      await app.call('run-recipe', 'recipe-old');
      expect(starts[2]).toMatchObject({ maxTotalChargeUsd: 5, timeout: 900 });
      expect(app.call('state').runs.find((run) => run.recipeId === 'recipe-old').runLimits).toEqual({ maxTotalChargeUsd: 5, timeoutSecs: 900 });
      // A scraper's own limits survive an edit from the form, which doesn't send them.
      const tuned = app.call('save-recipe', { ...saved, runOptions: { maxTotalChargeUsd: 2, timeoutSecs: 300 } });
      expect(app.call('save-recipe', { id: tuned.id, name: 'Crawler, renamed', platform: 'web', actorId: 'owner/crawler', inputJson: '{}' }).runOptions).toEqual({ maxTotalChargeUsd: 2, timeoutSecs: 300 });
    } finally { app.close(); }
  });

  it('keep the rows of a run stopped at its time limit, marked as stopped early; a failed run still fails', async () => {
    const root = temp('safety-limit-');
    const starts = []; const app = desktop(root, { env: { APIFY_API_TOKEN: 'apify_api_fixture' }, ApifyClient: fakeApify(starts, 'TIMED-OUT') });
    try {
      const saved = app.call('save-recipe', { name: 'Slow crawler', platform: 'web', actorId: 'owner/slow', inputJson: '{}' });
      const dataset = await app.call('run-recipe', saved.id);
      expect(dataset).toMatchObject({ itemCount: 1, collectionScope: { stoppedEarly: true, stopReason: 'Apify status TIMED-OUT: the 15-minute limit' } });
      expect(app.call('state').runs[0]).toMatchObject({ status: 'succeeded', stoppedEarly: true });
    } finally { app.close(); }
    const failing = desktop(temp('safety-failed-'), { env: { APIFY_API_TOKEN: 'apify_api_fixture' }, ApifyClient: fakeApify([], 'FAILED') });
    try {
      const saved = failing.call('save-recipe', { name: 'Broken', platform: 'web', actorId: 'owner/broken', inputJson: '{}' });
      await expect(failing.call('run-recipe', saved.id)).rejects.toThrow('Apify run finished with status FAILED.');
      expect(failing.call('state').runs[0].status).toBe('failed');
    } finally { failing.close(); }
  });

  it('join a retried request to the run already going instead of starting a second paid run', async () => {
    const root = temp('safety-repeat-');
    const starts = []; const app = desktop(root, { env: { APIFY_API_TOKEN: 'apify_api_fixture' }, ApifyClient: fakeApify(starts) });
    try {
      const saved = app.call('save-recipe', { name: 'Pulse', platform: 'x', actorId: 'owner/pulse', inputJson: '{}' });
      const [first, retry] = await Promise.all([app.call('run-recipe', { recipeId: saved.id, requestId: 'req-run-0001' }), app.call('run-recipe', { recipeId: saved.id, requestId: 'req-run-0001' })]);
      expect(starts).toHaveLength(1);
      expect(retry).toEqual(first);
      expect(await app.call('run-recipe', { recipeId: saved.id, requestId: 'req-run-0001' })).toEqual(first); // finished: the same result back
      expect(starts).toHaveLength(1);
      await expect(later(() => app.call('run-recipe', { recipeId: 'recipe-other', requestId: 'req-run-0001' }))).rejects.toMatchObject({ status: 409, message: 'Use a new request ID for a different request.' });
      await expect(later(() => app.call('run-recipe', { recipeId: saved.id, requestId: 'bad id!' }))).rejects.toThrow('Invalid request ID.');
      await app.call('run-recipe', { recipeId: saved.id, requestId: 'req-run-0002' }); // a new ID is new work
      expect(starts).toHaveLength(2);
      // Test sample: a second press while one runs is refused; the same request ID joins it.
      const draft = { ...saved, inputJson: '{}', requestId: 'req-test-0001' };
      const [a, b] = await Promise.all([app.call('test-recipe', draft), app.call('test-recipe', draft)]);
      expect(b).toEqual(a); expect(starts).toHaveLength(3);
      const running = app.call('test-recipe', { ...saved, inputJson: '{}' });
      await expect(later(() => app.call('test-recipe', { ...saved, inputJson: '{}' }))).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/still running/) });
      await running;
    } finally { app.close(); }
  });
});

describe('data.json and config.json', () => {
  it('copy a damaged file aside, start fresh and name the copy in the state', () => {
    const root = temp('safety-torn-');
    fs.writeFileSync(path.join(root, 'data.json'), '{"recipes": [');
    const app = desktop(root);
    try {
      const state = app.call('state');
      expect(state.storeRecovery).toEqual([{ store: 'Studio data', file: 'data.json', kept: expect.stringMatching(/^data\.json\.bad-\d+$/), at: expect.any(String) }]);
      expect(fs.readFileSync(path.join(root, state.storeRecovery[0].kept), 'utf8')).toBe('{"recipes": [');
      expect(JSON.parse(fs.readFileSync(path.join(root, 'data.json'), 'utf8')).recipes).toEqual([]);
    } finally { app.close(); }
  });

  it.skipIf(process.getuid?.() === 0)('never write over a file that can’t be read', () => {
    const root = temp('safety-unreadable-');
    const original = JSON.stringify({ recipes: [{ id: 'recipe-kept', name: 'Kept', platform: 'x', actorId: 'a/b' }] });
    fs.writeFileSync(path.join(root, 'data.json'), original); fs.chmodSync(path.join(root, 'data.json'), 0o000);
    const app = desktop(root);
    try {
      expect(() => app.call('state')).toThrow(/Studio data could not be read \(data\.json: EACCES\)\. Nothing was changed\./);
      expect(() => app.call('save-recipe', { name: 'New', platform: 'x', actorId: 'a/c' })).toThrow(/could not be read/);
    } finally { app.close(); fs.chmodSync(path.join(root, 'data.json'), 0o644); }
    expect(fs.readFileSync(path.join(root, 'data.json'), 'utf8')).toBe(original);
    expect(fs.readdirSync(root).filter((name) => name.startsWith('data.json.'))).toEqual([]);
  });
});

describe('the Codex command', () => {
  it('runs isolated: prompt on stdin, read-only, tools off, newer flags only when the CLI lists them', () => {
    const { buildCodexCommand, codexExecSupport, CODEX_TOOLS_OFF } = mainRequire('../shared/codex-runner');
    const support = codexExecSupport('Options:\n      --ephemeral\n      --ignore-rules\n      --ignore-user-config\n');
    const { args } = buildCodexCommand({ workspaceDir: '/tmp/empty', schemaPath: '/tmp/empty/s.json', outputPath: '/tmp/empty/o.json', isolated: true, support, ignoreUserConfig: true });
    expect(args.slice(0, 7)).toEqual(['--ask-for-approval', 'never', '--cd', '/tmp/empty', 'exec', '--skip-git-repo-check', '--sandbox']);
    expect(args[7]).toBe('read-only');
    for (const feature of ['shell_tool', 'unified_exec', 'view_image', 'apps', 'plugins']) expect(CODEX_TOOLS_OFF).toContain(feature);
    for (const feature of CODEX_TOOLS_OFF) expect(args).toContain(`features.${feature}=false`);
    expect(args).toEqual(expect.arrayContaining(['--ephemeral', '--ignore-rules', '--ignore-user-config']));
    expect(args.at(-1)).toBe('-');
    // An older CLI gets none of the flags it doesn't know, and the Mac app keeps its own config.
    const older = buildCodexCommand({ workspaceDir: '/tmp/empty', schemaPath: 's', outputPath: 'o', isolated: true, support: codexExecSupport('') }).args;
    for (const flag of ['--ephemeral', '--ignore-rules', '--ignore-user-config', 'workspace-write']) expect(older).not.toContain(flag);
  });
});

describe('shared records', () => {
  it('refuse a save over a newer one when the form says what it opened', () => {
    const root = temp('safety-stale-'); let now = Date.parse('2026-10-17T10:00:00Z');
    const api = mainRequire('./content-workspace').createContentWorkspace({ root, runAI: async () => ({}), clock: () => new Date(now += 60000) });
    const opened = api.saveContentWorkspace({ name: 'Team space' });
    const riley = api.saveContentWorkspace({ id: opened.id, name: 'Team space (Riley)', baseUpdatedAt: opened.updatedAt });
    expect(() => api.saveContentWorkspace({ id: opened.id, name: 'Team space (Sam)', baseUpdatedAt: opened.updatedAt })).toThrow(expect.objectContaining({ status: 409, code: 'saveConflict', message: expect.stringMatching(/^Someone saved this workspace at .+, after you opened it\./) }));
    expect(api.saveContentWorkspace({ id: opened.id, name: 'Team space (Sam)', baseUpdatedAt: riley.updatedAt }).name).toBe('Team space (Sam)');
    expect(api.saveContentWorkspace({ id: opened.id, name: 'Without a base' }).name).toBe('Without a base'); // older forms keep working
  });
});

describe('state broadcasts', () => {
  it('parse each dataset payload once until the file changes', () => {
    const root = temp('safety-derived-');
    const row = (id) => ({ id, text: `Post ${id} about AI search`, url: `https://x.com/a/${id}`, platform: 'x', publishedAt: '2026-10-01T00:00:00Z' });
    fs.writeFileSync(path.join(root, 'data.json'), JSON.stringify({ datasets: [{ id: 'dataset-1', name: 'Pulse', platform: 'x', itemCount: 2, createdAt: '2026-10-01T00:00:00Z' }] }));
    fs.mkdirSync(path.join(root, 'datasets'), { recursive: true });
    const payload = path.join(root, 'datasets', 'dataset-1.json');
    fs.writeFileSync(payload, JSON.stringify({ rawItems: [], items: [row('1'), row('2')] }));
    const reads = []; const fsModule = { ...fs, readFileSync: (file, ...rest) => { reads.push(String(file)); return fs.readFileSync(file, ...rest); } };
    const app = desktop(root, { fsModule });
    const payloadReads = () => reads.filter((file) => file === payload).length;
    try {
      // The retired v5 projection is gone (state.v5 carries only Scrapers' recipe versions); the dataset intelligence in
      // every push and evidence search share one parse per payload.
      const first = app.call('state'); app.call('state'); app.call('state');
      expect(Object.keys(first.v5)).toEqual(['recipeVersions']);
      expect(payloadReads()).toBe(1);
      const found = app.call('search-evidence', { query: 'AI search' }); app.call('search-evidence', { query: 'AI search' });
      expect(payloadReads()).toBe(1);
      expect(found.length).toBeGreaterThan(0);
      fs.writeFileSync(payload, JSON.stringify({ rawItems: [], items: [row('1'), row('2'), row('3')] }));
      expect(app.call('search-evidence', { query: 'AI search' }).length).toBeGreaterThan(found.length);
      expect(payloadReads()).toBe(2);
    } finally { app.close(); }
  });
});

describe('Monday.com sync', () => {
  it('gives up on a request that doesn’t answer in time, and never sends a create again after one', async () => {
    const monday = mainRequire('./monday-sync');
    let calls = 0;
    const fetchImpl = (_url, options) => new Promise((_resolve, reject) => { calls++; options.signal.addEventListener('abort', () => reject(options.signal.reason)); });
    const request = monday.createMondayClient({ token: 'fixture-monday', fetchImpl, timeoutMs: 20, sleep: async () => {} });
    await expect(request('query { me { id } }', {}, { idempotent: true })).rejects.toMatchObject({ kind: 'timeout', message: 'Monday.com didn’t answer in time.' });
    calls = 0;
    const results = await monday.pushChunk(request, '123', [{ kind: 'create', name: 'A', values: {} }, { kind: 'create', name: 'B', values: {} }]);
    expect(results.map((row) => row.error?.kind)).toEqual(['timeout', 'timeout']);
    expect(calls).toBe(1); // one aliased request, not resent: the engine looks these keys up before creating anything
  });

  it('runs one sync at a time on the real main process, so two people syncing at once never create the same item twice', async () => {
    const root = temp('safety-monday-');
    fs.mkdirSync(path.join(root, 'content-studio'), { recursive: true });
    const theme = { id: 't1', name: 'Trend A', description: 'Described.', evidenceIds: ['e1'], platforms: ['x'] };
    fs.writeFileSync(path.join(root, 'content-studio', 'state.json'), JSON.stringify({ version: 1, activeWorkspaceId: 'general', workspaces: [{ id: 'general', name: 'Your workspace', editionId: 'general', knowledge: {}, products: [], createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' }], programs: [], researchRuns: [{ id: 'run-a', type: 'research', workspaceId: 'general', programId: '', title: 'Pulse', status: 'awaiting-review', createdAt: '2026-10-10T00:00:00Z', discoveredThemes: [theme], themes: [theme], decisions: {}, decisionsBy: {} }], contentRuns: [], themes: [], history: [], detections: [], assets: [], exports: [], datasetOwners: {} }));
    fs.writeFileSync(path.join(root, 'content-studio', 'monday.json'), JSON.stringify({ version: 1, account: null, links: { general: { rev: 1, active: true, linkedAt: '2026-10-01T00:00:00Z', boardId: '123', boardName: 'Trends', columns: { stage: 'status', studioKey: 'studio_key' }, columnInfo: { status: { title: 'Stage', type: 'status' }, studio_key: { title: 'Studio key', type: 'text' } }, statusLabels: {}, groups: { by: 'none', ids: {}, defaultGroupId: 'topics' }, push: { mode: 'manual', from: 'all', includeSkipped: true, postUpdates: false }, pull: { mode: 'manual' }, onDeleted: 'leave' } }, items: {}, people: {}, usage: {} }));
    const requests = [];
    vi.stubGlobal('fetch', async (_url, options) => {
      const body = JSON.parse(options.body); requests.push({ query: body.query, signal: options.signal });
      await new Promise((resolve) => setTimeout(resolve, 10));
      const data = body.query.includes('items_page_by_column_values') ? { items_page_by_column_values: { items: [] } } : { c0: { id: `item-${requests.length}`, url: 'https://x.monday.com/boards/123/pulses/1' } };
      return new Response(JSON.stringify({ data }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    const app = desktop(root, { env: { MONDAY_API_TOKEN: 'fixture-monday', STUDIO_WORKSPACE_MODE: 'multi' } });
    try {
      const [first, second] = await Promise.all([app.call('sync-trend-board-to-monday', { cards: [{ key: 'ignored', name: 'Sent by a browser' }] }), app.call('sync-trend-board-to-monday', {})]);
      expect(first.jobId).toMatch(/^monday-/); expect(second.jobId).toBe(first.jobId); // the second joins the first
      for (let i = 0; i < 100 && requests.filter((request) => request.query.includes('create_item')).length < 1; i++) await new Promise((resolve) => setTimeout(resolve, 10));
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(requests.filter((request) => request.query.includes('create_item'))).toHaveLength(1);
      expect(requests.some((request) => request.query.includes('Sent by a browser'))).toBe(false); // the server builds the cards
      expect(requests.every((request) => request.signal instanceof AbortSignal)).toBe(true); // each request has a time limit
      expect(app.call('state').monday.items['run-a:t1']).toMatchObject({ state: 'synced' });
    } finally { app.close(); }
  });
});

describe('daily AI budget', () => {
  it('refuses a data-tools analysis before any AI starts once the day’s budget is spent', async () => {
    const root = temp('safety-budget-');
    fs.writeFileSync(path.join(root, 'data.json'), JSON.stringify({ settings: { aiProvider: 'codex' }, datasets: [{ id: 'dataset-1', name: 'Pulse', platform: 'x', itemCount: 1, createdAt: '2026-10-01T00:00:00Z' }] }));
    fs.mkdirSync(path.join(root, 'datasets'), { recursive: true });
    fs.writeFileSync(path.join(root, 'datasets', 'dataset-1.json'), JSON.stringify({ rawItems: [], items: [{ id: 'row-1', text: 'AI answer engines are replacing search for buyers.', url: 'https://x.com/a/1', platform: 'x' }] }));
    fs.writeFileSync(path.join(root, 'ai-spend.json'), JSON.stringify({ day: new Date().toISOString().slice(0, 10), usd: 0.6, calls: 3 }));
    const spawns = []; const spawn = (command, args) => { spawns.push({ command, args }); throw new Error('No CLI should start.'); };
    const app = desktop(root, { env: { STUDIO_DAILY_AI_BUDGET_USD: '0.50' }, spawn });
    try {
      await expect(app.call('analyze-dataset', { datasetId: 'dataset-1', kind: 'tag' })).rejects.toMatchObject({ code: 'dailyAiBudget', message: expect.stringMatching(/daily AI budget of \$0\.50 is used up for today/) });
      expect(spawns).toEqual([]);
      expect(app.call('state').analyses[0]).toMatchObject({ status: 'failed', error: expect.stringMatching(/daily AI budget/) });
    } finally { app.close(); }
  });
});

// ── The browser studio ──
describe('the browser studio', () => {
  const KEY_A = 'data-safety-original-secret-0123456789abcdef'; const KEY_B = 'data-safety-replaced-secret-0123456789abcdef';
  let runtime; let dataDir; const sessions = new Map();
  const as = (member, extra = {}) => (channel, payload) => runtime.invoke(channel, payload, { user: studio.identity(member), session: sessions.get(member.id) || sessions.set(member.id, { expires: Date.now() + 3600000, kind: 'link', memberId: member.id, linkId: 'fixture', viewAs: null }).get(member.id), origin: 'https://studio.example.com', ...extra });
  const admin = (channel, payload) => as(studio.MEMBERS.chris)(channel, payload).then((outcome) => outcome.result);
  beforeAll(async () => {
    dataDir = path.join(temp('safety-web-'), 'data');
    studio.seedStudio(dataDir);
    process.env.SHELL = '/bin/sh';
    runtime = mainRequire('./web-runtime');
    // The saved Apify token was encrypted under KEY_A; the server now starts with KEY_B (a restore onto a new host).
    runtime.configure({ dataDir, secretKey: KEY_A });
    const blob = runtime.electron.safeStorage.encryptString('apify_api_fixture_original').toString('base64');
    fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({ keys: { APIFY_API_TOKEN: { encrypted: true, value: blob } } }));
    runtime.configure({ dataDir, secretKey: KEY_B });
    vi.spyOn(console, 'error').mockImplementation(() => {}); vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'warn').mockImplementation(() => {});
    vm.runInNewContext(source, {
      require: (name) => (name === 'child_process' ? { spawn: () => { throw new Error('No CLIs in this test.'); } } : mainRequire(name)),
      process: { pid: process.pid, platform: process.platform, env: { STUDIO_RUNTIME: 'web', STUDIO_PASSWORD: 'data-safety-admin-password' }, argv: [] },
      __dirname: path.dirname(mainPath), Buffer, URL, AbortController, setTimeout, clearTimeout, setInterval, clearInterval, setImmediate, console,
      fetch: () => { throw new Error('Network access is forbidden in this test.'); },
    }, { filename: mainPath });
    await new Promise((resolve) => setTimeout(resolve, 50)); // whenReady work
  });
  afterAll(() => { runtime?.shutdown(); vi.restoreAllMocks(); });

  it('names a saved key the server key can’t read, and won’t overwrite it until an admin clears it', async () => {
    const state = await admin('state');
    expect(state.keys.APIFY_API_TOKEN).toBe(false);
    expect(state.keyProblems).toEqual({ APIFY_API_TOKEN: 'mismatch' });
    expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/STUDIO_SECRET_KEY does not match .*APIFY_API_TOKEN/));
    await expect(admin('refresh-apify-actors')).rejects.toThrow(/saved Apify token can’t be read: it was saved with a different STUDIO_SECRET_KEY/);
    const before = fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8');
    await expect(admin('save-key', { keyName: 'APIFY_API_TOKEN', value: 'apify_api_fixture_new_value' })).rejects.toMatchObject({ status: 409, code: 'keyMismatch' });
    expect(fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8')).toBe(before); // the only copy the original key can read
    await admin('clear-key', 'APIFY_API_TOKEN');
    await admin('save-key', { keyName: 'APIFY_API_TOKEN', value: 'apify_api_fixture_new_value' });
    expect((await admin('state')).keyProblems).toEqual({});
  });

  it('serves a trend’s posts to people who see research, never to a channel owner', async () => {
    expect(await as(studio.MEMBERS.riley)('studio:readTrendPosts', { name: studio.TREND }).then((outcome) => outcome.result)).toEqual(expect.any(Array));
    await expect(as(studio.MEMBERS.alex)('studio:readTrendPosts', { name: studio.TREND })).rejects.toMatchObject({ status: 403 });
  });

  it('downloads a channel asset set and a run export as zips and leaves no copy on the server', async () => {
    const saveDir = fs.mkdtempSync(path.join(dataDir, 'web-transfers', 'call-'));
    const kit = await as(studio.MEMBERS.chris, { saveDir })('studio:saveAssetKitFolder', { runId: 'content-kit-social' });
    expect(kit.files.map((file) => fs.realpathSync(file))).toEqual([path.join(fs.realpathSync(saveDir), `${kit.result.folderName}.zip`)]);
    expect(kit.result.path).toBeUndefined(); // no server path reaches the browser
    const run = await as(studio.MEMBERS.chris, { saveDir })('studio:exportStudioRun', { runId: 'content-trend' });
    expect(run.files).toHaveLength(1); expect(run.files[0].endsWith('.zip')).toBe(true);
    for (const file of [...kit.files, ...run.files]) expect(fs.statSync(file).size).toBeGreaterThan(100);
    const exportsDir = path.join(dataDir, 'content-studio', 'exports');
    expect(fs.existsSync(exportsDir) ? fs.readdirSync(exportsDir) : []).toEqual([]);
    expect(JSON.parse(fs.readFileSync(path.join(dataDir, 'content-studio', 'state.json'), 'utf8')).exports).toEqual([]);
  });
});
