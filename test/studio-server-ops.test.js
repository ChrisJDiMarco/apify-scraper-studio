import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import serverModule from '../src/main/studio-server.js';
import roles from '../src/shared/roles.json';
import { methods } from '../src/shared/studio-api-channels.json';
const { createStudioServer, buildIdFrom, DRAIN_REFUSED, proxyAllowList } = serverModule;
const ownership = createRequire(import.meta.url)('../src/main/studio-owner-lock.js'); // the copy the server's own require() loads

// The browser studio server as operators see it: health checks, the stop sequence, who may send the SSO header, live
// update limits and backpressure, errors that keep server paths to themselves, transfer quotas and request logs.
const PASSWORD = 'fixture-only-password-12345';
const channel = (method) => (typeof methods[method] === 'string' ? methods[method] : methods[method].channel);
const resources = [];
afterEach(async () => { for (const r of resources.splice(0)) { r.release?.(); r.server.closeAllConnections?.(); await new Promise((resolve) => r.server.close(resolve)); fs.rmSync(r.root, { recursive: true, force: true }); } });

function fakeRuntime(root, handlers) {
  const listeners = new Set();
  return {
    settings: { transferDir: path.join(root, 'transfers'), dataDir: path.join(root, 'data') },
    channels: () => Object.keys(handlers),
    provided: () => null,
    async invoke(name, payload, context = {}) { const out = await handlers[name](payload, context); const envelope = out && typeof out === 'object' && 'files' in out; return { result: envelope ? out.result : out, files: envelope ? out.files : [], opens: [] }; },
    onBroadcast: (_, listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    broadcast: (state) => { for (const listener of listeners) listener(state); },
  };
}
async function fixture({ handlers = {}, before, ...options } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-server-ops-')); const webRoot = path.join(root, 'public'); fs.mkdirSync(webRoot);
  fs.mkdirSync(path.join(root, 'data')); before?.(root);
  fs.writeFileSync(path.join(webRoot, 'index.html'), '<!doctype html><script type="module" crossorigin src="/assets/index-NEW1.js"></script><link rel="modulepreload" href="/assets/vendor-X.js"><link rel="stylesheet" crossorigin href="/assets/index-CSS1.css">');
  const runtime = fakeRuntime(root, {
    state: () => ({ version: 0 }),
    'app-meta': () => ({ runtime: 'web' }),
    [channel('startResearchRun')]: () => ({ started: true }),
    [channel('cancelStudioRun')]: () => ({ cancelled: true }),
    [channel('readStudioAsset')]: () => { fs.readFileSync(path.join(root, 'data', 'content-studio', 'runs', 'run-1', 'asset-1.png')); return {}; },
    [channel('openAsset')]: () => { throw new Error(`Couldn’t open ${path.join(root, 'data', 'reports', 'report.md')}. See https://example.com/data/help.`); },
    'setup:open': (_, context) => ({ read: context.uploads.length }),
    'setup:export': (_, context) => { const file = path.join(context.saveDir, 'setup.json'); fs.writeFileSync(file, '{}'); return { result: { ok: true }, files: [file] }; },
    ...handlers,
  });
  const logs = [];
  const studio = createStudioServer({ webRoot, password: PASSWORD, runtime, serverLog: { log: (level, event, fields) => logs.push({ level, event, ...fields }) }, logEvent: () => {}, ...options });
  const { server } = studio;
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); const base = `http://127.0.0.1:${server.address().port}`;
  const resource = { server, root }; resources.push(resource);
  const request = (route, { method = 'GET', body, cookie, headers = {} } = {}) => fetch(`${base}${route}`, { method, headers: { ...(method === 'POST' ? { Origin: base } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  const login = async () => (await request('/api/login', { method: 'POST', body: { password: PASSWORD } })).headers.get('set-cookie').split(';')[0];
  const rpc = (cookie, name, payload, uploads) => request('/api/rpc', { method: 'POST', cookie, body: { channel: name, payload, uploads } });
  return { root, base, server, studio, runtime, logs, request, login, rpc, resource };
}
// Reads an event stream as text until `until` matches (or the stream ends).
async function readStream(base, cookie, until, headers = {}) {
  const controller = new AbortController();
  const response = await fetch(`${base}/api/events`, { headers: { Cookie: cookie, 'Accept-Encoding': 'identity', ...headers }, signal: controller.signal });
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let text = '';
  const next = async (pattern) => { while (!pattern.test(text)) { const { value, done } = await reader.read(); if (done) return { text, ended: true }; text += decoder.decode(value); } return { text, ended: false }; };
  if (until) await next(until);
  return { response, next, abort: () => controller.abort(), get text() { return text; } };
}

describe('health checks', () => {
  it('answers /healthz and /readyz without sign-in, naming only which check failed', async () => {
    const h = await fixture();
    const live = await h.request('/healthz'); expect(live.status).toBe(200); expect(await live.json()).toEqual({ ok: true });
    expect(live.headers.get('cache-control')).toBe('no-store');
    const ready = await h.request('/readyz'); expect(ready.status).toBe(200);
    expect(await ready.json()).toEqual({ ready: true, version: expect.any(String), checks: { data: 'ok', disk: 'ok', lock: 'ok', draining: false } });
    expect((await h.request('/readyz', { method: 'HEAD' })).status).toBe(200);
    expect((await h.request('/healthz', { method: 'POST', body: {} })).status).toBe(405);
    expect(JSON.stringify(await (await h.request('/readyz')).json())).not.toContain(h.root);
    expect(h.logs.filter((entry) => entry.event === 'request')).toEqual([]); // probes aren't logged
  });

  it.runIf(process.platform !== 'win32' && process.getuid?.() !== 0)('fails readiness when the data folder stops taking writes, the lock is lost, or the server is stopping', async () => {
    const h = await fixture();
    fs.chmodSync(path.join(h.root, 'data'), 0o500);
    try { const answer = await h.request('/readyz'); expect(answer.status).toBe(503); expect((await answer.json()).checks.data).toBe('unwritable'); }
    finally { fs.chmodSync(path.join(h.root, 'data'), 0o700); }
    const lockRoot = path.join(h.root, 'data', 'content-studio'); const release = ownership.acquireStudioOwnerLock(lockRoot); h.resource.release = release;
    const withLock = await fixture({ lockRoot });
    expect((await withLock.request('/readyz')).status).toBe(200);
    release();
    const lost = await withLock.request('/readyz'); expect(lost.status).toBe(503); expect((await lost.json()).checks.lock).toBe('lost');
    h.studio.drain();
    const draining = await h.request('/readyz'); expect(draining.status).toBe(503); expect((await draining.json()).checks.draining).toBe(true);
    expect((await h.request('/healthz')).status).toBe(200); // still alive while it drains
  });
});

describe('stopping for a deploy', () => {
  it('refuses new paid work while draining, keeps reads and Stop working, and tells open tabs', async () => {
    const h = await fixture(); const cookie = await h.login();
    expect(DRAIN_REFUSED.has(channel('startResearchRun'))).toBe(true);
    expect(DRAIN_REFUSED.has(channel('cancelStudioRun'))).toBe(false);
    for (const method of roles.readMethods) expect(DRAIN_REFUSED.has(channel(method))).toBe(false);
    const tab = await readStream(h.base, cookie, /event: hello/);
    h.studio.drain();
    await tab.next(/event: restarting/);
    const refused = await h.rpc(cookie, channel('startResearchRun'), {});
    expect(refused.status).toBe(503); expect(await refused.json()).toEqual({ error: 'The studio is restarting for an update. Try again in a minute.', code: 'restarting' });
    expect(refused.headers.get('retry-after')).toBe('60');
    expect((await h.rpc(cookie, channel('cancelStudioRun'), {})).status).toBe(200);
    expect((await h.rpc(cookie, 'state')).status).toBe(200);
    const late = await readStream(h.base, cookie, /event: hello/); expect(late.text).toContain('"restarting":true');
    tab.abort(); late.abort();
  });

  it('counts calls still running, so the stop waits for them', async () => {
    let finish; const h = await fixture({ handlers: { 'app-meta': () => new Promise((resolve) => { finish = resolve; }) } }); const cookie = await h.login();
    const pending = h.rpc(cookie, 'app-meta');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(h.studio.inFlight()).toBe(1); finish({ runtime: 'web' }); await pending;
    expect(h.studio.inFlight()).toBe(0);
  });
});

describe('the trusted SSO header', () => {
  const sso = { password: undefined, trustedEmailHeader: 'X-Forwarded-Email', allowedEmailDomains: 'semrush.com' };
  it('refuses to start until the proxy can be told apart from everyone else', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-server-ops-config-')); resources.push({ root, server: { close: (done) => done() } });
    const runtime = fakeRuntime(root, {});
    expect(() => createStudioServer({ webRoot: root, runtime, ...sso })).toThrow(/STUDIO_TRUSTED_PROXY_CIDRS .* or STUDIO_PROXY_SECRET/);
    expect(() => createStudioServer({ webRoot: root, runtime, ...sso, trustedProxies: '10.0.0.0/33' })).toThrow(/isn't an IP address or CIDR range: 10.0.0.0\/33/);
    expect(() => createStudioServer({ webRoot: root, runtime, ...sso, proxySecret: 'short' })).toThrow(/at least 16/);
    expect(proxyAllowList('172.30.10.10, fd00::/8').entries).toEqual(['172.30.10.10', 'fd00::/8']);
  });

  it('believes the header only from the proxy’s addresses', async () => {
    const as = { 'X-Forwarded-Email': 'lead@semrush.com' };
    const elsewhere = await fixture({ ...sso, trustedProxies: '10.0.0.0/8' });
    const refused = await elsewhere.request('/api/session', { headers: as });
    expect(refused.status).toBe(401); expect((await refused.json()).signIn).toBe('proxy');
    expect(elsewhere.logs).toContainEqual(expect.objectContaining({ level: 'warn', event: 'untrusted-proxy-header', remote: '127.0.0.1', reason: 'address' }));
    await elsewhere.request('/api/session', { headers: as });
    expect(elsewhere.logs.filter((entry) => entry.event === 'untrusted-proxy-header')).toHaveLength(1); // once a minute per address
    const local = await fixture({ ...sso, trustedProxies: '127.0.0.1/32, ::1' });
    expect(await (await local.request('/api/session', { headers: as })).json()).toMatchObject({ ok: true, user: 'lead@semrush.com', signOut: false });
  });

  it('believes the header only with the proxy’s shared secret, when one is set', async () => {
    const secret = 'fixture-proxy-secret-0123456789';
    const h = await fixture({ ...sso, proxySecret: secret });
    const as = (extra = {}) => ({ headers: { 'X-Forwarded-Email': 'lead@semrush.com', ...extra } });
    expect((await h.request('/api/session', as())).status).toBe(401);
    expect((await h.request('/api/session', as({ 'X-Studio-Proxy-Secret': `${secret}x` }))).status).toBe(401);
    expect((await h.request('/api/session', as({ 'X-Studio-Proxy-Secret': secret }))).status).toBe(200);
    // Both set: both must match.
    const both = await fixture({ ...sso, proxySecret: secret, trustedProxies: '10.0.0.0/8' });
    expect((await both.request('/api/session', as({ 'X-Studio-Proxy-Secret': secret }))).status).toBe(401);
  });
});

describe('live updates', () => {
  it('starts every stream with the server’s build and sends it on every API answer', async () => {
    expect(buildIdFrom('<script type="module" crossorigin src="/assets/index-A.js"></script><link rel="modulepreload" href="/assets/v.js"><link rel="stylesheet" href="/assets/index-B.css">')).toBe('index-A.js index-B.css');
    expect(buildIdFrom('<!doctype html><script type="module" src="./main.jsx"></script>')).toBe('');
    const h = await fixture(); const cookie = await h.login();
    expect((await h.rpc(cookie, 'state')).headers.get('x-studio-build')).toBe('index-NEW1.js index-CSS1.css');
    const tab = await readStream(h.base, cookie, /event: hello\ndata: .*\n\n/);
    expect(tab.text).toContain('event: hello\ndata: {"build":"index-NEW1.js index-CSS1.css"}'); tab.abort();
  });

  it('tells a tab past the server’s stream limit that live updates are paused, and lets the browser ask again', async () => {
    const h = await fixture({ maxEventStreams: 1 }); const cookie = await h.login(); const other = await h.login();
    const first = await readStream(h.base, cookie, /event: hello/);
    const second = await readStream(h.base, other, /event: hello\ndata: .*\n\n/);
    expect(second.response.status).toBe(200); expect(second.response.headers.get('content-type')).toContain('text/event-stream');
    expect(second.text).toContain('retry: 30000'); expect(second.text).toContain('"busy":true');
    expect((await second.next(/never/)).ended).toBe(true); // ends, so EventSource reconnects by itself
    expect(h.logs).toContainEqual(expect.objectContaining({ level: 'warn', event: 'stream-refused', reason: 'capacity', open: 1, max: 1 }));
    first.abort();
  });

  it('keeps only the newest state for a tab that stops reading, and drops it once it has taken nothing for a while', async () => {
    const h = await fixture({ streamTuning: { coalesceMs: 5, stallMs: 400, backlogBytes: 256 * 1024 } }); const cookie = await h.login();
    const big = 'x'.repeat(400 * 1024);
    const stalled = await new Promise((resolve) => {
      const req = http.get(`${h.base}/api/events`, { headers: { Cookie: cookie, 'Accept-Encoding': 'identity' } }, (res) => { res.pause(); resolve({ req, res }); });
    });
    stalled.req.on('error', () => {});
    // 40 frames of 400 KB would be 16 MB queued; the stream holds about one backlog plus what the sockets buffer.
    for (let version = 1; version <= 40; version++) { h.runtime.broadcast({ version, big }); await new Promise((resolve) => setTimeout(resolve, 10)); }
    await new Promise((resolve) => setTimeout(resolve, 500));
    h.runtime.broadcast({ version: 41, big });
    for (let i = 0; i < 30 && !h.logs.some((entry) => entry.event === 'stream-dropped'); i++) await new Promise((resolve) => setTimeout(resolve, 100));
    expect(h.logs).toContainEqual(expect.objectContaining({ event: 'stream-dropped', reason: 'stalled', identity: 'session' }));
    stalled.req.destroy();
  });

  it('delivers the newest state to a slow tab once it catches up, skipping the ones in between', async () => {
    const h = await fixture({ streamTuning: { coalesceMs: 5, stallMs: 60000, backlogBytes: 256 * 1024 } }); const cookie = await h.login();
    const big = 'y'.repeat(300 * 1024); const seen = [];
    const done = new Promise((resolve) => {
      http.get(`${h.base}/api/events`, { headers: { Cookie: cookie, 'Accept-Encoding': 'identity' } }, (res) => {
        res.pause(); let text = '';
        res.on('data', (chunk) => { text += chunk; for (const match of text.matchAll(/"version":(\d+)/g)) seen.push(Number(match[1])); text = text.slice(text.lastIndexOf('\n\n') + 2); if (seen.includes(30)) { res.destroy(); resolve(); } });
        setTimeout(() => res.resume(), 800);
      });
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    for (let version = 1; version <= 30; version++) { h.runtime.broadcast({ version, big }); await new Promise((resolve) => setTimeout(resolve, 15)); }
    await done;
    expect(seen.at(-1)).toBe(30); expect(new Set(seen).size).toBeLessThan(30);
  });
});

describe('errors and logs', () => {
  it('answers a filesystem error with a reference instead of server paths, and logs it with that reference', async () => {
    const h = await fixture(); const cookie = await h.login();
    const answer = await h.rpc(cookie, channel('readStudioAsset'), {});
    expect(answer.status).toBe(500); const body = await answer.json();
    expect(body).toEqual({ error: expect.stringMatching(/^Something went wrong on the studio server\. Try again, or give an admin this ref: [a-f0-9]{12}\.$/), ref: expect.any(String) });
    expect(JSON.stringify(body)).not.toContain(h.root); expect(answer.headers.get('x-request-id')).toBe(body.ref);
    expect(h.logs).toContainEqual(expect.objectContaining({ level: 'error', event: 'request-failed', id: body.ref, channel: channel('readStudioAsset'), code: 'ENOENT' }));
  });

  it('keeps a message written for people but takes the server paths out of it, leaving links alone', async () => {
    const h = await fixture(); const cookie = await h.login();
    const body = await (await h.rpc(cookie, channel('openAsset'), {})).json();
    expect(body.error).toBe('Couldn’t open …. See https://example.com/data/help.');
  });

  it.each([String.raw`C:\Users\runner\data\report.md`, 'C:/Users/runner/data/report.md', String.raw`\\server\share\report.md`])('removes Windows server paths on every platform: %s', async (file) => {
    const h = await fixture({ handlers: { [channel('openAsset')]: () => { throw new Error(`Couldn’t open ${file}. See https://example.com/data/help.`); } } });
    const cookie = await h.login();
    const body = await (await h.rpc(cookie, channel('openAsset'), {})).json();
    expect(body.error).toBe('Couldn’t open …. See https://example.com/data/help.');
  });

  it('logs one line per API request with its id, channel, status, duration and who, never the payload', async () => {
    const h = await fixture(); const cookie = await h.login();
    await h.rpc(cookie, channel('startResearchRun'), { note: 'payload-text-that-must-not-be-logged' });
    await h.rpc(cookie, 'state');
    await new Promise((resolve) => setTimeout(resolve, 20));
    const lines = h.logs.filter((entry) => entry.event === 'request');
    expect(lines).toContainEqual({ level: 'info', event: 'request', id: expect.stringMatching(/^[a-f0-9]{12}$/), method: 'POST', route: '/api/rpc', channel: channel('startResearchRun'), status: 200, ms: expect.any(Number), identity: 'session' });
    expect(lines).toContainEqual(expect.objectContaining({ level: 'debug', channel: 'state', status: 200 })); // reads log at debug
    expect(JSON.stringify(h.logs)).not.toContain('payload-text-that-must-not-be-logged');
    expect(JSON.stringify(h.logs)).not.toContain(PASSWORD); expect(JSON.stringify(h.logs)).not.toContain(cookie.split('=')[1]);
  });

  it('marks an unknown action so an older tab can offer a reload', async () => {
    const h = await fixture(); const cookie = await h.login();
    expect(await (await h.rpc(cookie, 'renamed:in-the-new-build')).json()).toEqual({ error: 'Unknown studio action.', code: 'unknownAction' });
  });
});

describe('the upload and download area', () => {
  it('empties what a previous run left in it, which nothing can claim after a restart', async () => {
    const h = await fixture({ before: (root) => { for (const area of ['uploads', 'saves']) { const dir = path.join(root, 'transfers', area, 'left-over'); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'setup with token.json'), 'apify_api_fixture'); } } });
    for (const area of ['uploads', 'saves']) expect(fs.readdirSync(path.join(h.root, 'transfers', area))).toEqual([]);
  });

  it('keeps ten unused uploads per person, the oldest giving way', async () => {
    const h = await fixture(); const cookie = await h.login();
    const ids = [];
    for (let i = 0; i < 11; i++) ids.push((await (await h.request('/api/upload', { method: 'POST', cookie, body: `{"n":${i}}`, headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': `file-${i}.json` } })).json()).uploadId);
    expect(fs.readdirSync(path.join(h.root, 'transfers', 'uploads'))).toHaveLength(10);
    expect((await h.rpc(cookie, 'setup:open', undefined, [ids[0]])).status).toBe(410);
    expect((await (await h.rpc(cookie, 'setup:open', undefined, [ids[10]])).json()).result).toEqual({ read: 1 });
  });

  it('keeps twenty exports per person for download, the oldest giving way', async () => {
    const h = await fixture(); const cookie = await h.login();
    const links = [];
    for (let i = 0; i < 21; i++) links.push((await (await h.rpc(cookie, 'setup:export')).json()).downloads[0].url);
    expect((await h.request(links[0], { cookie })).status).toBe(404);
    expect((await h.request(links[20], { cookie })).status).toBe(200);
    expect(fs.readdirSync(path.join(h.root, 'transfers', 'saves'))).toHaveLength(20);
  });
});
