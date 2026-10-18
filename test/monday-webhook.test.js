import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import serverModule from '../src/main/studio-server.js';
import engineModule from '../src/main/monday-engine.js';
import storeModule from '../src/main/monday-store.js';

// POST /hooks/monday/<secret> on the real browser-studio server (src/main/studio-server.js), dispatched to the real
// Monday.com engine's receiver. Nothing reaches Monday: the engine's fetch stand-in records calls only.
const { createStudioServer } = serverModule;
const PASSWORD = 'fixture-only-password-12345';
const SECRET = 'e'.repeat(64);
const resources = [];
afterEach(async () => { for (const r of resources.splice(0)) { r.server.closeAllConnections?.(); await new Promise((resolve) => r.server.close(resolve)); fs.rmSync(r.root, { recursive: true, force: true }); } });

async function fixture({ provide = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'monday-webhook-')); const webRoot = path.join(root, 'public'); fs.mkdirSync(webRoot);
  fs.writeFileSync(path.join(webRoot, 'index.html'), '<!doctype html><title>Fixture</title>');
  const store = storeModule.createMondayStore({ root: path.join(root, 'content-studio') });
  store.saveLink('general', { active: true, boardId: '42', boardName: 'Trends', hookSecretHash: storeModule.hashSecret(SECRET), columns: { stage: 'stage', studioKey: 'key' }, pull: { mode: 'instant' }, hookStatus: 'on' });
  const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, headers: new Headers(), json: async () => ({ data: {} }) }));
  const workspace = { activeWorkspaceId: () => 'general', boardSource: () => ({}), decideResearchTheme: vi.fn() };
  const timers = [];
  const engine = engineModule.createMondayEngine({ store, getToken: () => 'fixture-monday-token', workspace, web: true, fetchImpl, timers: { setTimeout: (fn, ms) => { timers.push({ fn, ms }); return {}; }, clearTimeout: () => {}, setInterval: () => null, clearInterval: () => {} }, warn: () => {} });
  const runtime = { settings: { transferDir: path.join(root, 'transfers') }, channels: () => ['state'], provided: (name) => (provide && name === 'mondayHook' ? { receive: (secret, body) => engine.receiveHook(secret, body) } : null), invoke: async () => ({ result: {}, files: [], opens: [] }), onBroadcast: () => () => {} };
  const lines = [];
  const studio = createStudioServer({ webRoot, password: PASSWORD, runtime, serverLog: { log: (level, event, fields) => lines.push({ level, event, ...fields }) } });
  await new Promise((resolve) => studio.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${studio.server.address().port}`;
  resources.push({ server: studio.server, root });
  const post = (route, body, headers = {}) => fetch(`${base}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  return { base, post, studio, lines, fetchImpl, workspace, timers };
}

describe('Monday.com webhooks on the browser studio', () => {
  it('echoes the challenge without an Origin or a sign-in, while other POSTs without an Origin are still refused', async () => {
    const h = await fixture();
    const challenge = await h.post(`/hooks/monday/${SECRET}`, { challenge: 'monday-says-hi' });
    expect(challenge.status).toBe(200);
    expect(await challenge.json()).toEqual({ challenge: 'monday-says-hi' });
    expect((await h.post('/api/rpc', { channel: 'state' })).status).toBe(403);
    expect((await h.post(`/hooks/monday/${'f'.repeat(64)}`, { challenge: 'x' })).status).toBe(404);
    expect((await h.post('/hooks/monday/short', { challenge: 'x' })).status).toBe(404);
    expect((await fetch(`${h.base}/hooks/monday/${SECRET}`)).status).toBe(405);
  });

  it('caps the body, refuses while draining and answers 404 without a provider', async () => {
    const h = await fixture();
    expect((await h.post(`/hooks/monday/${SECRET}`, JSON.stringify({ pad: 'x'.repeat(70000) }))).status).toBe(413);
    h.studio.drain();
    expect((await h.post(`/hooks/monday/${SECRET}`, { challenge: 'x' })).status).toBe(503);
    const none = await fixture({ provide: false });
    expect((await none.post(`/hooks/monday/${SECRET}`, { challenge: 'x' })).status).toBe(404);
  });

  it('logs the route, never the secret, and never applies payload values without re-reading the item', async () => {
    const h = await fixture();
    const response = await h.post(`/hooks/monday/${SECRET}`, { event: { boardId: 42, pulseId: 1234, columnId: 'stage', value: { label: { text: 'Approved' } } } });
    expect(response.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(JSON.stringify(h.lines)).not.toContain(SECRET);
    expect(h.lines.some((line) => line.event === 'request' && line.route === '/hooks/monday/:secret')).toBe(true);
    expect(h.workspace.decideResearchTheme).not.toHaveBeenCalled();
    expect(h.fetchImpl).not.toHaveBeenCalled(); // only a debounced re-read is queued
    expect(h.timers.at(-1).ms).toBe(3000);
  });
});
