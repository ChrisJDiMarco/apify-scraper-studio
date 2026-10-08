import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { methods } from '../src/shared/studio-api-channels.json';

// The browser studio end to end: the Mac app's real main process (src/main/index.js) on the web runtime,
// behind the real HTTP server, driven the way the browser drives it. No paid services are called.
const require = createRequire(import.meta.url);
const PASSWORD = 'web-host-test-password';
let root; let dataDir; let base; let server; let runtime; let cookie; let reportFile;
const rpc = async (channel, payload, uploads) => {
  const response = await fetch(`${base}/api/rpc`, { method: 'POST', headers: { Origin: base, Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ channel, payload, uploads }) });
  const body = await response.json(); if (!response.ok) throw new Error(body.error); return body;
};
beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'web-host-test-')); dataDir = path.join(root, 'data');
  // An older record keeps an absolute path inside the data folder, like Mac data copied to a server.
  reportFile = path.join(dataDir, 'workspaces', 'default', 'report-1', 'report.md'); fs.mkdirSync(path.dirname(reportFile), { recursive: true }); fs.writeFileSync(reportFile, '# Fixture report');
  fs.writeFileSync(path.join(dataDir, 'data.json'), JSON.stringify({ analyses: [{ id: 'report-1', kind: 'report', datasetId: 'dataset-missing', reportPath: reportFile, outputPath: reportFile, createdAt: '2026-10-01T00:00:00.000Z' }] }));
  process.env.STUDIO_RUNTIME = 'web'; process.env.SHELL = '/bin/sh';
  for (const name of ['APIFY_API_TOKEN', 'ANTHROPIC_API_KEY']) delete process.env[name];
  runtime = require('../src/main/web-runtime.js');
  runtime.configure({ dataDir, secretKey: 'web-host-test-secret-0123456789abcdef' });
  require('../src/main/index.js');
  await new Promise((resolve) => setTimeout(resolve, 100)); // whenReady work
  const webRoot = path.join(root, 'public'); fs.mkdirSync(webRoot); fs.writeFileSync(path.join(webRoot, 'index.html'), '<!doctype html>');
  ({ server } = require('../src/main/studio-server.js').createStudioServer({ webRoot, password: PASSWORD, runtime }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: PASSWORD }) });
  cookie = login.headers.get('set-cookie').split(';')[0];
});
afterAll(async () => {
  server?.closeAllConnections?.(); await new Promise((resolve) => (server ? server.close(resolve) : resolve()));
  runtime?.shutdown(); fs.rmSync(root, { recursive: true, force: true });
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
