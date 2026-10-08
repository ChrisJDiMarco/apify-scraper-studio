import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import http from 'node:http';
import serverModule from '../src/main/studio-server.js';
const { createStudioServer } = serverModule;
const PASSWORD = 'fixture-only-password-12345';
const resources = [];
afterEach(async () => { for (const r of resources.splice(0)) { r.server.closeAllConnections?.(); await new Promise((resolve) => r.server.close(resolve)); fs.rmSync(r.root, { recursive: true, force: true }); } });

// A stand-in for web-runtime.js: real channel names, recorded calls, and a broadcast hook.
function fakeRuntime(root, handlers) {
  const listeners = new Set();
  return {
    settings: { transferDir: path.join(root, 'transfers') },
    calls: [],
    channels: () => Object.keys(handlers),
    async invoke(channel, payload, context) { this.calls.push({ channel, payload, uploads: context.uploads.map((u) => fs.readFileSync(u.path, 'utf8')) }); const out = await handlers[channel](payload, context); const envelope = out && typeof out === 'object' && ('files' in out || 'opens' in out); return { result: envelope ? out.result : out, files: envelope ? out.files || [] : [], opens: envelope ? out.opens || [] : [] }; },
    onBroadcast: (channel, listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    broadcast: (state) => { for (const listener of listeners) listener(state); },
  };
}
async function fixture(extra = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-server-test-')); const webRoot = path.join(root, 'public'); fs.mkdirSync(webRoot);
  fs.writeFileSync(path.join(webRoot, 'index.html'), '<!doctype html><title>Fixture</title>'); fs.writeFileSync(path.join(webRoot, 'app.js'), 'window.fixture = true;'); fs.writeFileSync(path.join(root, 'private.txt'), 'PRIVATE FIXTURE OUTSIDE WEB ROOT');
  const runtime = fakeRuntime(root, {
    state: () => ({ big: 'x'.repeat(40000) }),
    'app-meta': () => ({ runtime: 'web' }),
    'studio:saveResearchProgram': vi.fn((payload) => ({ id: 'saved', ...payload })),
    'setup:open': (_, context) => ({ cancelled: !context.uploads.length, read: context.uploads.map((u) => fs.readFileSync(u.path, 'utf8')) }),
    'setup:export': (_, context) => { const file = path.join(context.saveDir, 'team setup.json'); fs.writeFileSync(file, '{"kind":"scraper-studio-setup"}'); return { result: { fileName: 'team setup.json' }, files: [file] }; },
    'open-source-url': (url) => ({ result: null, opens: [url, 'javascript:alert(1)'] }),
    'internal:not-in-ui': () => 'should never run',
  });
  const { server } = createStudioServer({ webRoot, password: PASSWORD, runtime, ...extra });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); const base = `http://127.0.0.1:${server.address().port}`;
  resources.push({ server, root });
  async function request(route, { method = 'GET', body, raw, cookie, origin = base, headers = {} } = {}) {
    return fetch(`${base}${route}`, { method, headers: { ...(method === 'POST' && origin !== false ? { Origin: origin } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined) });
  }
  async function login() { const response = await request('/api/login', { method: 'POST', body: { password: PASSWORD } }); expect(response.status).toBe(200); return response.headers.get('set-cookie').split(';')[0]; }
  const rpc = (cookie, body) => request('/api/rpc', { method: 'POST', cookie, body });
  return { root, webRoot, base, server, runtime, request, login, rpc };
}

describe('browser studio server', () => {
  it('requires a strong password unless a trusted proxy signs people in', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-server-config-')); resources.push({ root, server: { close: (done) => done() } });
    const runtime = fakeRuntime(root, {});
    expect(() => createStudioServer({ webRoot: root, password: 'short', runtime })).toThrow(/16 characters/);
    expect(() => createStudioServer({ webRoot: root, runtime, trustedEmailHeader: 'x-auth-request-email' })).toThrow(/STUDIO_ALLOWED_EMAIL_DOMAINS/);
    expect(() => createStudioServer({ webRoot: root, password: PASSWORD })).toThrow(/web runtime/);
  });

  it('keeps every API behind sign-in with an HttpOnly, SameSite session', async () => {
    const h = await fixture();
    for (const route of ['/api/session', '/api/events', `/api/download/${'a'.repeat(64)}`]) expect((await h.request(route)).status).toBe(401);
    expect((await h.request('/api/upload', { method: 'POST', raw: 'x' })).status).toBe(401);
    expect((await h.rpc('', { channel: 'state' })).status).toBe(401);
    const login = await h.request('/api/login', { method: 'POST', body: { password: PASSWORD } });
    expect(login.headers.get('set-cookie')).toMatch(/HttpOnly; SameSite=Strict; Path=\/; Max-Age=43200$/);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    expect(await (await h.request('/api/session', { cookie })).json()).toEqual({ ok: true, user: '', signOut: true });
    await h.request('/api/logout', { method: 'POST', cookie, body: {} });
    expect((await h.request('/api/session', { cookie })).status).toBe(401);
  });

  it('rejects missing or foreign origins, but accepts the configured public origin behind a proxy', async () => {
    const h = await fixture({ publicOrigin: 'https://studio.example.com' });
    for (const origin of [false, 'https://foreign.example', 'file://local', 'null']) expect((await h.request('/api/login', { method: 'POST', origin, body: { password: PASSWORD } })).status).toBe(403);
    const cookie = await h.login();
    for (const origin of [false, 'https://foreign.example']) expect((await h.request('/api/rpc', { method: 'POST', cookie, origin, body: { channel: 'studio:saveResearchProgram', payload: {} } })).status).toBe(403);
    expect(h.runtime.calls).toEqual([]);
    expect((await h.request('/api/rpc', { method: 'POST', cookie, origin: 'https://studio.example.com', body: { channel: 'app-meta' } })).status).toBe(200);
  });

  it('runs only channels the studio UI uses, and returns safe links only', async () => {
    const h = await fixture(); const cookie = await h.login();
    for (const channel of ['constructor', '__proto__', 'internal:not-in-ui', 'delete-everything', undefined]) expect((await h.rpc(cookie, { channel })).status).toBe(400);
    expect(h.runtime.calls).toEqual([]);
    expect((await h.request('/api/rpc', { cookie })).status).toBe(404);
    const opened = await (await h.rpc(cookie, { channel: 'open-source-url', payload: 'https://example.com/post' })).json();
    expect(opened.opens).toEqual(['https://example.com/post']);
  });

  it('uploads stand in for file dialogs once, and saved files download only with a session', async () => {
    const h = await fixture(); const cookie = await h.login();
    const upload = await (await h.request('/api/upload', { method: 'POST', cookie, raw: '{"kind":"scraper-studio-setup"}', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent('../../team setup.json') } })).json();
    const opened = await (await h.rpc(cookie, { channel: 'setup:open', uploads: [upload.uploadId] })).json();
    expect(opened.result).toEqual({ cancelled: false, read: ['{"kind":"scraper-studio-setup"}'] });
    expect((await h.rpc(cookie, { channel: 'setup:open', uploads: [upload.uploadId] })).status).toBe(410);
    expect((await (await h.rpc(cookie, { channel: 'setup:open' })).json()).result.cancelled).toBe(true);
    expect(fs.readdirSync(path.join(h.root, 'transfers', 'uploads'))).toEqual([]);
    const exported = await (await h.rpc(cookie, { channel: 'setup:export' })).json();
    expect(exported.downloads).toEqual([{ url: expect.stringMatching(/^\/api\/download\/[a-f0-9]{64}$/), fileName: 'team setup.json' }]);
    expect((await h.request(exported.downloads[0].url)).status).toBe(401);
    const file = await h.request(exported.downloads[0].url, { cookie });
    expect(file.status).toBe(200); expect(file.headers.get('content-disposition')).toContain("filename*=UTF-8''team%20setup.json");
    expect(await file.text()).toBe('{"kind":"scraper-studio-setup"}');
    expect((await h.request(`/api/download/${'f'.repeat(64)}`, { cookie })).status).toBe(404);
    const tooBig = await h.request('/api/upload', { method: 'POST', cookie, raw: 'x', headers: { 'Content-Length': String(31 * 1024 * 1024) } }).catch(() => null);
    expect(tooBig === null || tooBig.status === 413).toBe(true);
  });

  it('streams state changes, coalesced and compressed, and compresses large replies', async () => {
    const h = await fixture(); const cookie = await h.login();
    const state = await h.rpc(cookie, { channel: 'state' }); // fetch decompresses transparently
    expect(state.headers.get('content-encoding')).toBe('gzip'); expect((await state.json()).result.big).toHaveLength(40000);
    const controller = new AbortController();
    const stream = await fetch(`${h.base}/api/events`, { headers: { Cookie: cookie, 'Accept-Encoding': 'identity' }, signal: controller.signal });
    expect(stream.headers.get('content-type')).toContain('text/event-stream');
    const reader = stream.body.getReader(); const decoder = new TextDecoder(); let text = '';
    h.runtime.broadcast({ version: 1 }); h.runtime.broadcast({ version: 2 });
    while (!text.includes('event: state-changed')) text += decoder.decode((await reader.read()).value);
    expect(text).toContain('data: {"version":2}'); expect(text).not.toContain('"version":1');
    controller.abort();
    const zipped = await new Promise((resolve) => {
      http.get(`${h.base}/api/events`, { headers: { Cookie: cookie, 'Accept-Encoding': 'gzip' } }, (res) => {
        const gunzip = zlib.createGunzip(); res.pipe(gunzip); let out = '';
        gunzip.on('data', (chunk) => { out += chunk; if (out.includes('state-changed')) { res.destroy(); resolve({ encoding: res.headers['content-encoding'], out }); } });
        setTimeout(() => h.runtime.broadcast({ version: 3 }), 50);
      });
    });
    expect(zipped.encoding).toBe('gzip'); expect(zipped.out).toContain('data: {"version":3}');
  });

  it('signs people in from a trusted proxy header for allowed email domains only', async () => {
    const h = await fixture({ password: undefined, trustedEmailHeader: 'X-Auth-Request-Email', allowedEmailDomains: 'semrush.com, @example.org' });
    expect(await (await h.request('/api/session', { headers: { 'X-Auth-Request-Email': 'Pat@Semrush.com' } })).json()).toEqual({ ok: true, user: 'pat@semrush.com', signOut: false });
    for (const email of ['pat@evil.com', 'pat@semrush.com.evil.com', 'not-an-email', '']) expect((await h.request('/api/session', { headers: { 'X-Auth-Request-Email': email } })).status).toBe(401);
    expect((await h.request('/api/login', { method: 'POST', body: { password: PASSWORD } })).status).toBe(400);
  });

  it('serves only webRoot files with CSP, no frame embedding, and an empty HEAD body', async () => {
    const h = await fixture();
    const page = await h.request('/'); expect(page.status).toBe(200);
    expect(page.headers.get('content-security-policy')).toMatch(/frame-ancestors 'none'/); expect(page.headers.get('x-frame-options')).toBe('DENY');
    expect((await h.request('/app.js')).headers.get('content-type')).toContain('text/javascript');
    for (const route of ['/private.txt', '/%2e%2e%2fprivate.txt', '/%2e%2e%2fpublic-other%2fprivate.txt']) expect((await h.request(route)).status).toBe(404);
    const head = await h.request('/', { method: 'HEAD' }); expect(head.status).toBe(200); expect(await head.text()).toBe('');
    expect((await h.request('/', { method: 'DELETE' })).status).toBe(405);
  });

  it('does not follow a symlink outside the public renderer directory', async () => {
    const h = await fixture(); fs.symlinkSync(path.join(h.root, 'private.txt'), path.join(h.webRoot, 'linked.txt'));
    const response = await h.request('/linked.txt'); expect(response.status).toBe(404); expect(await response.text()).not.toContain('PRIVATE FIXTURE');
  });

  it('limits password guessing and refuses malformed session cookies', async () => {
    const h = await fixture();
    for (let i = 0; i < 10; i++) expect((await h.request('/api/login', { method: 'POST', body: { password: 'wrong' } })).status).toBe(401);
    expect((await h.request('/api/login', { method: 'POST', body: { password: 'wrong' } })).status).toBe(429);
    expect((await h.request('/api/session', { cookie: 'studio_session=not-a-token' })).status).toBe(401);
    expect((await h.request('/api/session', { cookie: `studio_session=${'f'.repeat(64)}` })).status).toBe(401);
  });
});
