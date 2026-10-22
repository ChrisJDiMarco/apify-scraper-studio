import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { methods } from '../src/shared/studio-api-channels.json';

// The browser studio end to end: the Mac app's real main process (src/main/index.js) on the web runtime,
// behind the real HTTP server, driven the way the browser drives it. No paid services are called.
const require = createRequire(import.meta.url);
const { seedStudio } = require('./helpers/roles-studio.js');
const PASSWORD = 'web-host-test-password';
let root; let dataDir; let base; let server; let runtime; let cookie; let reportFile;
const rpc = async (channel, payload, uploads) => {
  const response = await fetch(`${base}/api/rpc`, { method: 'POST', headers: { Origin: base, Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ channel, payload, uploads }) });
  const body = await response.json(); if (!response.ok) throw new Error(body.error); return body;
};
beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'web-host-test-')); dataDir = path.join(root, 'data');
  seedStudio(dataDir, { team: false }); // a trend, its brief and a Social Team set with costs; people are added below
  // An older record keeps an absolute path inside the data folder, like Mac data copied to a server.
  reportFile = path.join(dataDir, 'workspaces', 'default', 'report-1', 'report.md'); fs.mkdirSync(path.dirname(reportFile), { recursive: true }); fs.writeFileSync(reportFile, '# Fixture report');
  fs.writeFileSync(path.join(dataDir, 'data.json'), JSON.stringify({ analyses: [{ id: 'report-1', kind: 'report', datasetId: 'dataset-missing', reportPath: reportFile, outputPath: reportFile, createdAt: '2026-10-01T00:00:00.000Z' }] }));
  process.env.STUDIO_RUNTIME = 'web'; process.env.SHELL = '/bin/sh'; process.env.STUDIO_PASSWORD = PASSWORD; // admin password mode: sign-in links on
  for (const name of ['APIFY_API_TOKEN', 'ANTHROPIC_API_KEY']) delete process.env[name];
  runtime = require('../src/main/web-runtime.js');
  runtime.configure({ dataDir, secretKey: 'web-host-test-secret-0123456789abcdef' });
  require('../src/main/index.js');
  await new Promise((resolve) => setTimeout(resolve, 100)); // whenReady work
  const webRoot = path.join(root, 'public'); fs.mkdirSync(webRoot); fs.writeFileSync(path.join(webRoot, 'index.html'), '<!doctype html>');
  ({ server } = require('../src/main/studio-server.js').createStudioServer({ webRoot, password: PASSWORD, runtime, serverLog: { log: () => {} } }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: PASSWORD }) });
  cookie = login.headers.get('set-cookie').split(';')[0];
});
afterAll(async () => {
  server?.closeAllConnections?.(); await new Promise((resolve) => (server ? server.close(resolve) : resolve()));
  runtime?.shutdown(); fs.rmSync(root, { recursive: true, force: true }); delete process.env.STUDIO_PASSWORD;
});

describe('browser studio host', () => {
  it('registers a handler for exactly the channels the studio UI calls', () => {
    const ui = [...new Set(Object.values(methods).map((entry) => (typeof entry === 'string' ? entry : entry.channel)))].sort();
    expect(runtime.channels().sort()).toEqual(ui);
  });

  it('owns the data folder while it runs', () => {
    const { acquireStudioOwnerLock } = require('../src/main/studio-owner-lock.js');
    expect(() => acquireStudioOwnerLock(path.join(dataDir, 'content-studio'))).toThrow(/already open/);
  });

  it('reports the web runtime and never sends server paths to the page', async () => {
    expect((await rpc('app-meta')).result).toMatchObject({ runtime: 'web', dataRoot: '', version: expect.any(String) });
    const state = await rpc('state');
    expect(state.result.analyses[0]).toMatchObject({ id: 'report-1', reportPath: 'report.md', outputPath: 'report.md' });
    expect(JSON.stringify(state)).not.toContain(root);
  });

  it('downloads files the Mac app would open, and explains folders', async () => {
    const opened = await rpc('open-analysis-output', 'report-1');
    expect(opened.downloads).toEqual([{ url: expect.stringMatching(/^\/api\/download\//), fileName: 'report.md' }]);
    expect(await (await fetch(`${base}${opened.downloads[0].url}`, { headers: { Cookie: cookie } })).text()).toBe('# Fixture report');
    await expect(rpc('open-data-folder')).rejects.toThrow(/Folders stay on the server/);
    expect((await rpc('open-source-url', 'https://example.com/post')).opens).toEqual(['https://example.com/post']);
  });

  it('shares a setup through a download and imports it through an upload', async () => {
    const exported = await rpc('setup:export', { includeApifyToken: false });
    expect(exported.result).toMatchObject({ fileName: expect.stringMatching(/setup .*\.json$/), includesApifyToken: false });
    expect(exported.result).not.toHaveProperty('path');
    const file = await (await fetch(`${base}${exported.downloads[0].url}`, { headers: { Cookie: cookie } })).text();
    const { uploadId } = await (await fetch(`${base}/api/upload`, { method: 'POST', headers: { Origin: base, Cookie: cookie, 'X-File-Name': encodeURIComponent('team setup.json') }, body: file })).json();
    const preview = await rpc('setup:open', undefined, [uploadId]);
    expect(preview.result).toMatchObject({ fileName: 'team setup.json', apifyTokenIncluded: false });
    const applied = await rpc('setup:apply', { token: preview.result.token });
    expect(applied.result.fileName).toBe('team setup.json');
    expect((await rpc('setup:open')).result).toEqual({ cancelled: true });
  });

  it('keeps saved keys encrypted with the server secret', async () => {
    await rpc('save-key', { keyName: 'APIFY_API_TOKEN', value: 'apify_api_webhostfixture0123456789' });
    expect((await rpc('state')).result.keys.APIFY_API_TOKEN).toBe(true);
    const config = fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8');
    expect(config).not.toContain('apify_api_webhostfixture0123456789');
    const saved = JSON.parse(config).keys.APIFY_API_TOKEN;
    expect(runtime.electron.safeStorage.decryptString(Buffer.from(saved.value, 'base64'))).toBe('apify_api_webhostfixture0123456789');
    await rpc('clear-key', 'APIFY_API_TOKEN');
    expect((await rpc('state')).result.keys.APIFY_API_TOKEN).toBe(false);
  });
});

// People with their own sign-in links: a Semrush Blog channel owner and an editor, next to the admin password session.
const login = async (body) => fetch(`${base}/api/login`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const tokenOf = (url) => url.split('#signin=')[1];
async function rpcAs(who, channel, payload) {
  const response = await fetch(`${base}/api/rpc`, { method: 'POST', headers: { Origin: base, Cookie: who, 'Content-Type': 'application/json' }, body: JSON.stringify({ channel, payload, uploads: [] }) });
  return { status: response.status, body: await response.json() };
}
// One open /api/events stream: the next state text it receives, or whether the server ended it.
async function openStream(who) {
  const controller = new AbortController();
  const response = await fetch(`${base}/api/events`, { headers: { Cookie: who, 'Accept-Encoding': 'identity' }, signal: controller.signal });
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let text = '';
  return {
    status: response.status, abort: () => controller.abort(),
    async state() {
      for (;;) {
        const match = text.match(/event: state-changed\ndata: (.*)\n\n/);
        if (match) { text = text.slice(match.index + match[0].length); return match[1]; }
        const { value, done } = await reader.read(); if (done) return null; text += decoder.decode(value);
      }
    },
    async ended() { for (;;) { const { done } = await reader.read().catch(() => ({ done: true })); if (done) return true; } },
  };
}
const HIDDEN_FROM_CHANNEL = ['costUsd', 'receipts', 'program-pulse', 'maxBudgetUsd', 'content-kit-social', 'asset-kit-social', 'Semrush Social Team'];

describe('people and roles in the browser studio', () => {
  let alex; let riley; let alexId; let rileyId;
  beforeAll(async () => {
    const add = async (member) => (await rpc('team:save-member', member)).result.member;
    const owner = await add({ name: 'Alex', email: 'alex@semrush.com', role: 'channel', channelId: 'blog' }); alexId = owner.id;
    const editor = await add({ name: 'Riley', email: 'riley@semrush.com', role: 'editor' }); rileyId = editor.id;
    alex = (await login({ linkToken: tokenOf((await rpc('team:sign-in-link', { id: owner.id })).result.url) })).headers.get('set-cookie').split(';')[0];
    riley = (await login({ linkToken: tokenOf((await rpc('team:sign-in-link', { id: editor.id })).result.url) })).headers.get('set-cookie').split(';')[0];
  });

  it('signs each person in with their own link as who they are', async () => {
    expect((await (await fetch(`${base}/api/session`, { headers: { Cookie: alex } })).json()).viewer).toEqual({ name: 'Alex', email: 'alex@semrush.com', role: 'channel', channelId: 'blog', disabled: false });
    expect((await (await fetch(`${base}/api/session`, { headers: { Cookie: riley } })).json()).viewer).toMatchObject({ role: 'editor' });
    expect((await login({ linkToken: 'f'.repeat(64) })).status).toBe(401);
    expect(await rpcAs(alex, 'save-settings', {})).toMatchObject({ status: 403, body: { error: 'Only an admin can do that.' } });
    expect(await rpcAs(riley, 'team:list')).toMatchObject({ status: 403 });
  });

  it('sends a channel owner only their channel, over RPC and live updates', async () => {
    const { body } = await rpcAs(alex, 'state');
    expect(body.result.viewer).toMatchObject({ role: 'channel', channelId: 'blog', channelName: 'Semrush Blog' });
    expect(body.result.contentStudio.channelView.trends).toEqual([expect.objectContaining({ themeId: 'theme-citations', isNew: true })]);
    for (const hidden of HIDDEN_FROM_CHANNEL) expect(JSON.stringify(body)).not.toContain(hidden);
    const owner = await openStream(alex); const editor = await openStream(riley);
    expect([owner.status, editor.status]).toEqual([200, 200]);
    await rpc('save-settings', { aiProvider: 'auto' }); // any change: one broadcast
    const [ownerText, editorText] = await Promise.all([owner.state(), editor.state()]);
    for (const hidden of HIDDEN_FROM_CHANNEL) expect(ownerText).not.toContain(hidden);
    expect(JSON.parse(ownerText)).toMatchObject({ viewer: { role: 'channel' }, contentStudio: { channelView: { channel: { id: 'blog' } } } });
    expect(JSON.parse(editorText)).toMatchObject({ viewer: { role: 'editor' }, contentStudio: { programs: expect.any(Array), adoptionsByTheme: {} } });
    expect(editorText).toContain('asset-kit-social');
    owner.abort(); editor.abort();
  });

  it('builds the state once per change and each kind of viewer’s view once, however many tabs are open', async () => {
    const people = runtime.provided('people'); const original = people.view; const views = [];
    people.view = (state, identity, session) => { views.push({ state, id: identity.id }); return original(state, identity, session); };
    let broadcasts = 0; const stop = runtime.onBroadcast('state-changed', () => { broadcasts += 1; });
    try {
      const streams = await Promise.all([openStream(alex), openStream(alex), openStream(riley), openStream(cookie)]);
      await rpc('save-settings', { aiProvider: 'auto' });
      const texts = await Promise.all(streams.map((stream) => stream.state()));
      expect(broadcasts).toBe(1);
      expect(new Set(views.map((entry) => entry.state)).size).toBe(1);
      expect(views.map((entry) => entry.id).sort()).toEqual([alexId, rileyId, 'owner'].sort()); // Alex's two tabs share one view
      expect(texts[0]).toBe(texts[1]);
      for (const stream of streams) stream.abort();
    } finally { people.view = original; stop(); }
  });

  it('signs someone out of every browser with Sign out everywhere, and a new link signs them in once', async () => {
    const stream = await openStream(alex); expect(stream.status).toBe(200);
    const fresh = (await rpc('team:sign-in-link', { id: alexId })).result.url;
    expect((await fetch(`${base}/api/session`, { headers: { Cookie: alex } })).status).toBe(200); // a new link signs nobody out
    await rpc('team:revoke-link', { id: alexId });
    expect(await stream.ended()).toBe(true);
    expect((await fetch(`${base}/api/session`, { headers: { Cookie: alex } })).status).toBe(401);
    expect((await login({ linkToken: tokenOf(fresh) })).status).toBe(401); // the unused link was turned off with it
    const next = tokenOf((await rpc('team:sign-in-link', { id: alexId })).result.url);
    const again = await login({ linkToken: next }); expect(again.status).toBe(200);
    expect((await login({ linkToken: next })).status).toBe(401); // used up
    alex = again.headers.get('set-cookie').split(';')[0];
    expect((await rpcAs(alex, 'state')).body.result.viewer.role).toBe('channel');
  });
});

// What the stop sequence (scripts/studio-web.cjs) and /readyz ask the real main process. Last: an idle before-quit
// answer also stops the schedules, as a stopping server should.
describe('browser studio host, for operators', () => {
  it('holds its data folder lock where readiness looks for it', () => {
    expect(require('../src/main/studio-owner-lock.js').ownerLockHeld(path.join(dataDir, 'content-studio'))).toBe(true);
  });
  it('tells the stop sequence nothing is running when the studio is idle', () => {
    expect(runtime.busyWork()).toEqual([]);
  });
});
