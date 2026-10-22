import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import serverModule from '../src/main/studio-server.js';
import roles from '../src/shared/roles.json';
import { canSymlink } from './helpers/can-symlink.js';
const { createStudioServer } = serverModule;
const PASSWORD = 'fixture-only-password-12345';
const resources = [];
afterEach(async () => { for (const r of resources.splice(0)) { r.server.closeAllConnections?.(); await new Promise((resolve) => r.server.close(resolve)); fs.rmSync(r.root, { recursive: true, force: true }); } });

// A stand-in for web-runtime.js: real channel names, recorded calls, a broadcast hook and the provider registry
// (no `people` provider unless a test passes one, which keeps the pre-roles behaviour).
function fakeRuntime(root, handlers, providers = {}) {
  const listeners = new Set();
  return {
    settings: { transferDir: path.join(root, 'transfers') },
    calls: [],
    channels: () => Object.keys(handlers),
    provided: (name) => providers[name] || null,
    async invoke(channel, payload, context = {}) { this.calls.push({ channel, payload, uploads: (context.uploads || []).map((u) => fs.readFileSync(u.path, 'utf8')), user: context.user?.id ?? null, session: context.session?.kind ?? null, origin: context.origin }); const out = await handlers[channel](payload, context); const envelope = out && typeof out === 'object' && ('files' in out || 'opens' in out); return { result: envelope ? out.result : out, files: envelope ? out.files || [] : [], opens: envelope ? out.opens || [] : [] }; },
    onBroadcast: (channel, listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    broadcast: (state) => { for (const listener of listeners) listener(state); },
  };
}
async function fixture({ people, handlers = {}, ...extra } = {}) {
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
    ...handlers,
  }, people ? { people } : {});
  const logs = [];
  const { server } = createStudioServer({ webRoot, password: PASSWORD, runtime, logEvent: (entry) => logs.push(entry), ...extra });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); const base = `http://127.0.0.1:${server.address().port}`;
  resources.push({ server, root });
  async function request(route, { method = 'GET', body, raw, cookie, origin = base, headers = {}, redirect = 'follow' } = {}) {
    return fetch(`${base}${route}`, { method, redirect, headers: { ...(method === 'POST' && origin !== false ? { Origin: origin } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined) });
  }
  async function login() { const response = await request('/api/login', { method: 'POST', body: { password: PASSWORD } }); expect(response.status).toBe(200); return response.headers.get('set-cookie').split(';')[0]; }
  const rpc = (cookie, body) => request('/api/rpc', { method: 'POST', cookie, body });
  return { root, webRoot, base, server, runtime, request, login, rpc, logs };
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
    expect(await (await h.request('/api/session', { cookie })).json()).toEqual({ ok: true, user: '', signOut: true, viewer: null });
    await h.request('/api/logout', { method: 'POST', cookie, body: {} });
    expect((await h.request('/api/session', { cookie })).status).toBe(401);
  });

  it('rejects missing or foreign origins, but accepts the configured public origin behind a proxy', async () => {
    const h = await fixture({ publicOrigin: 'https://studio.example.com' });
    for (const origin of [false, 'https://foreign.example', 'file://local', 'null']) expect((await h.request('/api/login', { method: 'POST', origin, body: { password: PASSWORD } })).status).toBe(403);
    const signedIn = await h.request('/api/login', { method: 'POST', body: { password: PASSWORD } });
    expect(signedIn.headers.get('set-cookie')).toMatch(/; Secure$/); // an https public origin makes the cookie Secure without STUDIO_SECURE_COOKIES
    const cookie = signedIn.headers.get('set-cookie').split(';')[0];
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
    const h = await fixture({ password: undefined, trustedEmailHeader: 'X-Auth-Request-Email', trustedProxies: '127.0.0.1, ::1', allowedEmailDomains: 'semrush.com, @example.org' });
    expect(await (await h.request('/api/session', { headers: { 'X-Auth-Request-Email': 'Pat@Semrush.com' } })).json()).toEqual({ ok: true, user: 'pat@semrush.com', signOut: false, viewer: null });
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

  it.runIf(canSymlink)('does not follow a symlink outside the public renderer directory', async () => {
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

// The main process's `people` provider, reduced to what the server asks of it: members with one-time links and a
// sessionEpoch, the admin password identity, SSO and Google lookups, emailed links and a per-viewer projection that names
// who it was made for. token(id) makes a fresh one-time link for that member, as People would.
function peopleStub({ email = false } = {}) {
  const member = (id, name, address, role, channelId = null) => ({ id, name, email: address, role, channelId, disabled: false, sessionEpoch: 0 });
  const members = new Map([member('member-alex', 'Alex', 'alex@semrush.com', 'channel', 'blog'), member('member-riley', 'Riley', 'riley@semrush.com', 'editor'), member('member-pat', 'Pat', 'pat@semrush.com', 'admin')].map((m) => [m.id, m]));
  const identity = (m, via) => ({ id: m.id, name: m.name, email: m.email, role: m.disabled ? null : m.role, channelId: m.channelId, via, disabled: m.disabled, memberSince: '2026-10-01T00:00:00.000Z' });
  const links = new Map(); // token → member id, one per member, used up on sign-in
  const holder = (token) => { const m = members.get(links.get(token)); return m && !m.disabled ? m : null; };
  const stub = {
    members, views: [], logs: [], emailed: [],
    token: (id) => { for (const [token, owner] of links) if (owner === id) links.delete(token); const token = randomBytes(32).toString('hex'); links.set(token, id); return token; },
    ownerIdentity: () => ({ id: 'owner', name: 'Studio admin', email: '', role: 'admin', channelId: null, via: 'password', disabled: false }),
    fromProxyEmail: (address) => { const m = [...members.values()].find((entry) => entry.email === address); return m ? identity(m, 'proxy') : { id: `guest:${address}`, name: address.split('@')[0], email: address, role: null, channelId: null, via: 'proxy' }; },
    fromMemberSession: (session) => { const m = members.get(session.memberId); return m && !m.disabled && m.sessionEpoch === session.epoch ? identity(m, session.via) : null; },
    peekLink: (token) => { const m = holder(token); return m ? { id: m.id, name: m.name, email: m.email } : null; },
    useLink: (token) => { const m = holder(token); if (!m) return null; links.delete(token); return { memberId: m.id, epoch: m.sessionEpoch }; },
    googleLogin: (address) => { const m = [...members.values()].find((entry) => entry.email === address); if (!m) return { refused: 'not-invited' }; if (m.disabled) return { refused: 'paused' }; return { memberId: m.id, epoch: m.sessionEpoch }; },
    emailReady: () => email,
    requestEmailLink: async (address, context) => { stub.emailed.push({ address, origin: context.origin }); },
    view: (base, who, session) => { stub.views.push(who.id); return JSON.stringify({ ...base, viewer: { id: who.id, role: who.role, viewAs: session?.viewAs?.role || null } }); },
    logEvent: (entry) => stub.logs.push(entry),
  };
  return stub;
}
// One open /api/events stream: the next state it receives, or whether the server ended it.
async function openStream(base, cookie, headers = {}) {
  const controller = new AbortController();
  const response = await fetch(`${base}/api/events`, { headers: { ...(cookie ? { Cookie: cookie } : {}), 'Accept-Encoding': 'identity', ...headers }, signal: controller.signal });
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let text = '';
  return {
    status: response.status, abort: () => controller.abort(),
    async state() {
      for (;;) {
        const match = text.match(/event: state-changed\ndata: (.*)\n\n/);
        if (match) { text = text.slice(match.index + match[0].length); return JSON.parse(match[1]); }
        const { value, done } = await reader.read(); if (done) return null; text += decoder.decode(value);
      }
    },
    async ended() { for (;;) { const { done } = await reader.read().catch(() => ({ done: true })); if (done) return true; } },
    async raw() { const { value, done } = await reader.read().catch(() => ({ done: true })); return done ? null : decoder.decode(value); },
  };
}

describe('browser studio server with people and roles', () => {
  afterEach(() => { vi.restoreAllMocks(); });
  const linkLogin = (h, linkToken, cookie) => h.request('/api/login', { method: 'POST', cookie, body: { linkToken } });
  const cookieOf = (response) => response.headers.get('set-cookie').split(';')[0];

  it('signs people in once with a link, for 30 days, passes who they are to each call, and logs no tokens', async () => {
    const people = peopleStub(); const h = await fixture({ people });
    const link = people.token('member-alex');
    const signedIn = await linkLogin(h, link);
    expect(signedIn.status).toBe(200); expect(signedIn.headers.get('set-cookie')).toMatch(/HttpOnly; SameSite=Strict; Path=\/; Max-Age=2592000$/);
    const cookie = cookieOf(signedIn);
    expect(await (await h.request('/api/session', { cookie })).json()).toEqual({ ok: true, user: 'alex@semrush.com', signOut: true, viewer: { name: 'Alex', email: 'alex@semrush.com', role: 'channel', channelId: 'blog', disabled: false } });
    expect((await h.rpc(cookie, { channel: 'state' })).status).toBe(200);
    expect(h.runtime.calls.at(-1)).toMatchObject({ channel: 'state', user: 'member-alex', session: 'member', origin: h.base });
    // The link is used up: opening it again (someone it was forwarded to, the admin who made it) signs nobody in.
    const again = await linkLogin(h, link);
    expect(again.status).toBe(401); expect(await again.json()).toEqual({ error: roles.copy.linkInvalid, signIn: 'link-invalid' });
    const admin = await h.login();
    await h.rpc(admin, { channel: 'app-meta' });
    expect(h.runtime.calls.at(-1)).toMatchObject({ channel: 'app-meta', user: 'owner', session: 'password' });
    expect(people.logs).toEqual([expect.objectContaining({ event: 'sign-in', kind: 'link', memberId: 'member-alex' }), expect.objectContaining({ event: 'sign-in-failed', kind: 'link' }), expect.objectContaining({ event: 'sign-in', kind: 'password' })]);
    expect(JSON.stringify(people.logs)).not.toContain(link); expect(JSON.stringify(people.logs)).not.toContain(cookie.split('=')[1]);
  });

  it('refuses an unknown, malformed or turned-off link with its own answer, and never lets bad links lock anyone out', async () => {
    const people = peopleStub(); const h = await fixture({ people });
    const unknown = await linkLogin(h, randomBytes(32).toString('hex'));
    expect(unknown.status).toBe(401); expect(await unknown.json()).toEqual({ error: roles.copy.linkInvalid, signIn: 'link-invalid' });
    expect((await linkLogin(h, 'not-a-token')).status).toBe(401);
    const paused = people.token('member-alex'); people.members.get('member-alex').disabled = true;
    expect((await linkLogin(h, paused)).status).toBe(401);
    // Behind the reverse proxy everyone arrives from one address: a flood of bad links from it must not stop people
    // with real links, or the admin password, from signing in (link tokens are 32 random bytes; guessing is hopeless).
    for (let i = 0; i < 20; i++) expect((await linkLogin(h, randomBytes(32).toString('hex'))).status).toBe(401);
    expect((await linkLogin(h, people.token('member-riley'))).status).toBe(200);
    expect((await h.request('/api/login', { method: 'POST', body: { password: PASSWORD } })).status).toBe(200);
    expect(people.logs.filter((entry) => entry.event === 'sign-in-failed' && entry.kind === 'link')).toHaveLength(23);
    expect(JSON.stringify(people.logs)).not.toMatch(/[a-f0-9]{64}/);
  });

  it('counts password guesses per client, using the proxy’s forwarded address only when told to trust it', async () => {
    const guess = (h, from) => h.request('/api/login', { method: 'POST', body: { password: 'wrong' }, headers: from ? { 'X-Forwarded-For': from } : {} });
    const trusted = await fixture({ people: peopleStub(), trustProxy: true });
    for (let i = 0; i < 10; i++) expect((await guess(trusted, 'spoofed, 203.0.113.7')).status).toBe(401);
    expect((await guess(trusted, '203.0.113.7')).status).toBe(429); // the proxy-appended (last) address is the client
    expect((await guess(trusted, '198.51.100.2')).status).toBe(401); // someone else behind the same proxy isn't blocked
    expect((await trusted.request('/api/login', { method: 'POST', body: { password: PASSWORD }, headers: { 'X-Forwarded-For': '198.51.100.2' } })).status).toBe(200);
    // Without trustProxy the header is ignored, so a client can't dodge the limit by inventing addresses.
    const direct = await fixture({ people: peopleStub() });
    for (let i = 0; i < 10; i++) expect((await guess(direct, `192.0.2.${i}`)).status).toBe(401);
    expect((await guess(direct, '192.0.2.99')).status).toBe(429);
  });

  it('gives one person at most five live-update streams, so a channel owner can’t take an admin’s', async () => {
    const people = peopleStub(); const h = await fixture({ people });
    const alex = cookieOf(await linkLogin(h, people.token('member-alex')));
    const tabs = []; for (let i = 0; i < 5; i++) tabs.push(await openStream(h.base, alex));
    expect(tabs.every((tab) => tab.status === 200)).toBe(true);
    const sixth = await openStream(h.base, alex); expect(sixth.status).toBe(200);
    // The oldest tab is told it was replaced, so the page stops reconnecting it, and it closes.
    const first = await (async () => { const reader = tabs[0]; let text = ''; for (;;) { const chunk = await reader.raw(); if (chunk === null) return text; text += chunk; } })();
    expect(first).toContain('event: replaced');
    for (let i = 0; i < 60; i++) tabs.push(await openStream(h.base, alex));
    const admin = await openStream(h.base, await h.login());
    expect(admin.status).toBe(200);
    for (const tab of [...tabs, sixth, admin]) tab.abort();
  });

  it('keeps sign-in links out of company sign-in', async () => {
    const people = peopleStub(); const h = await fixture({ people, password: undefined, trustedEmailHeader: 'X-Auth-Request-Email', trustedProxies: '127.0.0.1, ::1', allowedEmailDomains: 'semrush.com' });
    expect((await linkLogin(h, people.token('member-alex'))).status).toBe(400);
    expect(await (await h.request('/api/session', { headers: { 'X-Auth-Request-Email': 'Pat@semrush.com' } })).json()).toEqual({ ok: true, user: 'pat@semrush.com', signOut: false, viewer: { name: 'Pat', email: 'pat@semrush.com', role: 'admin', channelId: null, disabled: false } });
  });

  it('expires admin password sessions after 12 hours, and member sessions 30 days after they were last used', async () => {
    const people = peopleStub(); const h = await fixture({ people });
    const admin = await h.login(); const alex = cookieOf(await linkLogin(h, people.token('member-alex'))); const riley = cookieOf(await linkLogin(h, people.token('member-riley')));
    const start = Date.now(); const later = (ms) => vi.spyOn(Date, 'now').mockReturnValue(start + ms);
    later(13 * 3600000);
    expect((await h.request('/api/session', { cookie: admin })).status).toBe(401);
    expect((await h.request('/api/session', { cookie: alex })).status).toBe(200);
    // Riley keeps using the studio: their session is pushed back to 30 days (at most once a day), and so is the cookie.
    later(20 * 24 * 3600000);
    const renewed = await h.request('/api/session', { cookie: riley });
    expect(renewed.status).toBe(200); expect(renewed.headers.get('set-cookie')).toMatch(/^studio_session=[a-f0-9]{64}; HttpOnly; SameSite=Strict; Path=\/; Max-Age=2592000$/);
    expect((await h.request('/api/session', { cookie: riley })).headers.get('set-cookie')).toBeNull(); // not again the same day
    later(31 * 24 * 3600000);
    const expired = await h.request('/api/session', { cookie: alex });
    expect(expired.status).toBe(401); expect(await expired.json()).toMatchObject({ signIn: 'password', methods: { password: true, google: false, email: false } });
    expect((await h.request('/api/session', { cookie: riley })).status).toBe(200);
  });

  it('signs someone out of every browser when their sessions are ended, and closes their live updates', async () => {
    const people = peopleStub(); const h = await fixture({ people });
    const phone = cookieOf(await linkLogin(h, people.token('member-alex'))); const laptop = cookieOf(await linkLogin(h, people.token('member-alex')));
    const riley = cookieOf(await linkLogin(h, people.token('member-riley')));
    const stream = await openStream(h.base, laptop);
    people.members.get('member-alex').sessionEpoch = 1; // Sign out everywhere, or pausing them
    h.runtime.broadcast({ version: 1 });
    expect(await stream.ended()).toBe(true);
    for (const cookie of [phone, laptop]) expect((await h.request('/api/session', { cookie })).status).toBe(401);
    expect((await h.request('/api/session', { cookie: riley })).status).toBe(200); // nobody else
    expect((await h.request('/api/session', { cookie: cookieOf(await linkLogin(h, people.token('member-alex'))) })).status).toBe(200); // they can sign in again
  });

  it('ends the session a browser arrived with when a link signs it in, and its stream with it', async () => {
    const people = peopleStub(); const h = await fixture({ people });
    const before = cookieOf(await linkLogin(h, people.token('member-riley')));
    const stream = await openStream(h.base, before);
    const after = cookieOf(await linkLogin(h, people.token('member-alex'), before));
    expect(await stream.ended()).toBe(true);
    expect((await h.request('/api/session', { cookie: before })).status).toBe(401);
    expect((await (await h.request('/api/session', { cookie: after })).json()).viewer.name).toBe('Alex');
  });

  it('closes a browser’s streams when it signs out', async () => {
    const people = peopleStub(); const h = await fixture({ people });
    const cookie = cookieOf(await linkLogin(h, people.token('member-riley')));
    const tabs = [await openStream(h.base, cookie), await openStream(h.base, cookie)];
    const other = await openStream(h.base, await h.login());
    await h.request('/api/logout', { method: 'POST', cookie, body: {} });
    for (const tab of tabs) expect(await tab.ended()).toBe(true);
    h.runtime.broadcast({ version: 2 });
    expect((await other.state()).viewer.id).toBe('owner'); // other people's streams stay open
    other.abort();
  });

  it('sends each stream its own viewer’s state, rendering each viewer once per broadcast', async () => {
    const people = peopleStub(); const h = await fixture({ people });
    const admin = await h.login(); const alex = cookieOf(await linkLogin(h, people.token('member-alex'))); const alexAgain = cookieOf(await linkLogin(h, people.token('member-alex')));
    const streams = [await openStream(h.base, admin), await openStream(h.base, alex), await openStream(h.base, alexAgain)];
    const base = { version: 7 }; h.runtime.broadcast(base);
    const [adminState, alexState, alexAgainState] = await Promise.all(streams.map((stream) => stream.state()));
    expect(adminState).toEqual({ version: 7, viewer: { id: 'owner', role: 'admin', viewAs: null } });
    expect(alexState).toEqual({ version: 7, viewer: { id: 'member-alex', role: 'channel', viewAs: null } });
    expect(alexAgainState).toEqual(alexState);
    expect(people.views.sort()).toEqual(['member-alex', 'owner']);
    h.runtime.broadcast({ version: 8 });
    await Promise.all(streams.map((stream) => stream.state()));
    expect(people.views).toHaveLength(4); // a new broadcast is a new state, rendered again per viewer
    for (const stream of streams) stream.abort();
  });

  it('lets someone with no role reach only their session, app details and state', async () => {
    const people = peopleStub(); const h = await fixture({ people, password: undefined, trustedEmailHeader: 'X-Auth-Request-Email', trustedProxies: '127.0.0.1, ::1', allowedEmailDomains: 'semrush.com' });
    const as = (email) => ({ 'X-Auth-Request-Email': email });
    expect(await (await h.request('/api/session', { headers: as('new@semrush.com') })).json()).toEqual({ ok: true, user: 'new@semrush.com', signOut: false, viewer: { name: 'new', email: 'new@semrush.com', role: null, channelId: null, disabled: false } });
    for (const channel of ['state', 'app-meta']) expect((await h.request('/api/rpc', { method: 'POST', headers: as('new@semrush.com'), body: { channel } })).status).toBe(200);
    const refused = await h.request('/api/rpc', { method: 'POST', headers: as('new@semrush.com'), body: { channel: 'studio:saveResearchProgram', payload: {} } });
    expect(refused.status).toBe(403); expect((await refused.json()).error).toMatch(/not in this studio yet/);
    expect(h.runtime.calls.map((call) => call.channel)).toEqual(['state', 'app-meta']);
    expect((await openStream(h.base, '', as('new@semrush.com'))).status).toBe(403);
    expect((await h.request('/api/upload', { method: 'POST', raw: 'x', headers: as('new@semrush.com') })).status).toBe(403);
    // A member whose access was paused while a tab was open: the next push closes the stream.
    const stream = await openStream(h.base, '', as('riley@semrush.com'));
    people.members.get('member-riley').disabled = true;
    h.runtime.broadcast({ version: 1 });
    expect(await stream.ended()).toBe(true);
    const paused = await h.request('/api/rpc', { method: 'POST', headers: as('riley@semrush.com'), body: { channel: 'studio:saveResearchProgram', payload: {} } });
    expect(paused.status).toBe(403); expect((await paused.json()).error).toContain(roles.copy.paused);
  });

  it('takes uploads from admins and editors only, by the role they are acting as', async () => {
    const people = peopleStub();
    const h = await fixture({ people, password: undefined, trustedEmailHeader: 'X-Auth-Request-Email', trustedProxies: '127.0.0.1, ::1', allowedEmailDomains: 'semrush.com', handlers: { 'app-meta': (payload, context) => { if (payload?.viewAs !== undefined) context.session.viewAs = payload.viewAs; return { runtime: 'web' }; } } });
    const upload = (email) => h.request('/api/upload', { method: 'POST', raw: '{}', headers: { 'X-Auth-Request-Email': email, 'Content-Type': 'application/octet-stream' } });
    const owner = await upload('alex@semrush.com'); expect(owner.status).toBe(403); expect((await owner.json()).error).toBe(roles.copy.forbidden);
    expect((await upload('riley@semrush.com')).status).toBe(200);
    expect((await upload('pat@semrush.com')).status).toBe(200);
    await h.request('/api/rpc', { method: 'POST', headers: { 'X-Auth-Request-Email': 'pat@semrush.com' }, body: { channel: 'app-meta', payload: { viewAs: { role: 'channel', channelId: 'blog' } } } });
    expect((await upload('pat@semrush.com')).status).toBe(403); // previewing as a channel owner
    await h.request('/api/rpc', { method: 'POST', headers: { 'X-Auth-Request-Email': 'pat@semrush.com' }, body: { channel: 'app-meta', payload: { viewAs: null } } });
    expect((await upload('pat@semrush.com')).status).toBe(200);
  });

  it('keeps each person’s uploads and downloads to that person', async () => {
    const people = peopleStub(); const h = await fixture({ people });
    const riley = cookieOf(await linkLogin(h, people.token('member-riley'))); const admin = await h.login();
    const upload = async (cookie) => (await (await h.request('/api/upload', { method: 'POST', cookie, raw: '{"kind":"scraper-studio-setup"}', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': 'setup.json' } })).json()).uploadId;
    const mine = await upload(riley);
    expect((await h.rpc(admin, { channel: 'setup:open', uploads: [mine] })).status).toBe(404);
    expect((await (await h.rpc(riley, { channel: 'setup:open', uploads: [mine] })).json()).result).toEqual({ cancelled: false, read: ['{"kind":"scraper-studio-setup"}'] });
    const exported = await (await h.rpc(riley, { channel: 'setup:export' })).json();
    expect((await h.request(exported.downloads[0].url, { cookie: admin })).status).toBe(404);
    expect((await h.request(exported.downloads[0].url, { cookie: riley })).status).toBe(200);
  });

  it('passes an error’s short code along with its message', async () => {
    const h = await fixture({ handlers: {
      'studio:saveResearchProgram': () => { throw Object.assign(new Error(roles.copy.adminOnly), { status: 403, code: 'forbidden' }); },
      'studio:editStudioAsset': () => { throw Object.assign(new Error('Riley saved this report first.'), { status: 409, code: 'editConflict' }); },
      'open-source-url': () => { throw Object.assign(new Error('That file no longer exists.'), { code: 'ENOENT' }); },
    } });
    const cookie = await h.login();
    const refused = await h.rpc(cookie, { channel: 'studio:saveResearchProgram', payload: {} });
    expect(refused.status).toBe(403); expect(await refused.json()).toEqual({ error: roles.copy.adminOnly, code: 'forbidden' });
    // The gate's codes are copy keys, some camelCase.
    const stale = await h.rpc(cookie, { channel: 'studio:editStudioAsset', payload: {} });
    expect(stale.status).toBe(409); expect(await stale.json()).toEqual({ error: 'Riley saved this report first.', code: 'editConflict' });
    expect(await (await h.rpc(cookie, { channel: 'open-source-url', payload: 'x' })).json()).toEqual({ error: 'That file no longer exists.' });
  });
});

describe('one-time links, emailed links, Google sign-in and saved sessions', () => {
  afterEach(() => { vi.restoreAllMocks(); });
  const cookieOf = (response) => response.headers.get('set-cookie').split(';')[0];
  const linkInfo = (h, linkToken, cookie) => h.request('/api/login/link', { method: 'POST', cookie, body: { linkToken } });

  it('says whose link it is and who this browser is signed in as, without using the link', async () => {
    const people = peopleStub(); const h = await fixture({ people });
    const link = people.token('member-alex');
    expect(await (await linkInfo(h, link)).json()).toEqual({ name: 'Alex', email: 'a•••@semrush.com', signedInAs: null });
    // An admin who clicks Alex's invite sees that it's Alex's, and that they'd stop being themselves.
    const admin = await h.login();
    expect(await (await linkInfo(h, link, admin)).json()).toEqual({ name: 'Alex', email: 'a•••@semrush.com', signedInAs: { name: 'Studio admin', same: false } });
    expect((await h.request('/api/session', { cookie: admin })).status).toBe(200); // still the admin
    const alex = cookieOf(await h.request('/api/login', { method: 'POST', body: { linkToken: link } })); // the link still worked
    const again = people.token('member-alex');
    expect((await (await linkInfo(h, again, alex)).json()).signedInAs).toEqual({ name: 'Alex', same: true });
    expect((await linkInfo(h, randomBytes(32).toString('hex'))).status).toBe(401);
    expect(people.logs.filter((entry) => entry.event === 'sign-in')).toHaveLength(2); // peeking signed nobody in
  });

  it('emails a sign-in link on request with the same answer for anyone, and limits how often', async () => {
    const off = await fixture({ people: peopleStub() });
    expect((await off.request('/api/login/email', { method: 'POST', body: { email: 'alex@semrush.com' } })).status).toBe(400);
    const people = peopleStub({ email: true }); const h = await fixture({ people });
    const ask = (email, headers) => h.request('/api/login/email', { method: 'POST', body: { email }, headers });
    const member = await ask('Alex@Semrush.com'); const stranger = await ask('nobody@example.com');
    expect(member.status).toBe(200); expect(stranger.status).toBe(200);
    expect(await member.json()).toEqual(await stranger.json()); // nothing tells who is in the studio
    expect((await ask('not an email')).status).toBe(400);
    await new Promise((resolve) => setTimeout(resolve, 20));
    // The provider decides whether there's anyone to email; the server only passes the address and the page's origin.
    expect(people.emailed).toEqual([{ address: 'alex@semrush.com', origin: h.base }, { address: 'nobody@example.com', origin: h.base }]);
    for (let i = 0; i < 3; i++) await ask('riley@semrush.com');
    expect((await ask('riley@semrush.com')).status).toBe(429); // five a client per 10 minutes
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(people.emailed.filter((entry) => entry.address === 'riley@semrush.com')).toHaveLength(3);
    expect(JSON.stringify(people.logs)).not.toContain('riley@semrush.com');
  });

  it('keeps signed-in browsers through a restart, storing only a hash of each cookie', async () => {
    const people = peopleStub(); const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'studio-sessions-')), 'web-sessions.json');
    const first = await fixture({ people, sessionFile: file });
    const alex = cookieOf(await first.request('/api/login', { method: 'POST', body: { linkToken: people.token('member-alex') } }));
    const admin = await first.login();
    await new Promise((resolve) => first.server.close(resolve)); // saves on close
    const saved = fs.readFileSync(file, 'utf8');
    expect(saved).not.toContain(alex.split('=')[1]); expect(saved).not.toContain(admin.split('=')[1]);
    if (process.platform !== 'win32') expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    const second = await fixture({ people, sessionFile: file });
    expect((await (await second.request('/api/session', { cookie: alex })).json()).viewer.name).toBe('Alex');
    expect((await second.request('/api/session', { cookie: admin })).status).toBe(200);
    people.members.get('member-alex').sessionEpoch = 1;
    expect((await second.request('/api/session', { cookie: alex })).status).toBe(401);
  });

  describe('Google sign-in', () => {
    const GOOGLE = { googleClientId: 'client-123.apps.googleusercontent.com', googleClientSecret: 'google-secret-value', publicOrigin: 'http://127.0.0.1' };
    // A Google stand-in: the token endpoint answers with an ID token for `claims` (nonce copied from the sign-in).
    function google(claims = {}, { status = 200 } = {}) {
      const seen = [];
      const fetchImpl = async (url, init) => {
        const body = new URLSearchParams(init.body); seen.push({ url, body });
        const payload = { iss: 'https://accounts.google.com', aud: GOOGLE.googleClientId, exp: Math.floor(Date.now() / 1000) + 300, email: 'riley@semrush.com', email_verified: true, nonce: google.nonce, ...claims };
        const part = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
        return { ok: status === 200, status, json: async () => (status === 200 ? { id_token: `${part({ alg: 'RS256' })}.${part(payload)}.sig` } : { error: 'invalid_grant' }) };
      };
      return { fetchImpl, seen };
    }
    async function start(h) {
      const response = await h.request('/api/auth/google/start', { redirect: 'manual' });
      const location = new URL(response.headers.get('location'));
      google.nonce = location.searchParams.get('nonce');
      return { response, location, cookie: response.headers.get('set-cookie').split(';')[0], state: location.searchParams.get('state') };
    }
    const back = (h, { state, cookie, code = 'auth-code' }) => fetch(`${h.base}/api/auth/google/callback?state=${state}&code=${code}`, { redirect: 'manual', headers: { Cookie: cookie } });

    it('needs both Google settings and the public origin', () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-google-config-')); resources.push({ root, server: { close: (done) => done() } });
      const runtime = fakeRuntime(root, {});
      expect(() => createStudioServer({ webRoot: root, password: PASSWORD, runtime, googleClientId: 'x' })).toThrow(/both STUDIO_GOOGLE_CLIENT_ID and STUDIO_GOOGLE_CLIENT_SECRET/);
      expect(() => createStudioServer({ webRoot: root, password: PASSWORD, runtime, googleClientId: 'x', googleClientSecret: 'y' })).toThrow(/STUDIO_PUBLIC_ORIGIN/);
    });

    it('sends people to Google with PKCE, then signs in the member whose verified email it is', async () => {
      const people = peopleStub(); const stub = google(); const h = await fixture({ people, ...GOOGLE, fetchImpl: stub.fetchImpl });
      expect(await (await h.request('/api/session')).json()).toMatchObject({ methods: { google: true, password: true } });
      const { response, location, cookie, state } = await start(h);
      expect(response.status).toBe(302); expect(location.origin + location.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
      expect(Object.fromEntries(location.searchParams)).toMatchObject({ client_id: GOOGLE.googleClientId, redirect_uri: 'http://127.0.0.1/api/auth/google/callback', response_type: 'code', scope: 'openid email profile', code_challenge_method: 'S256' });
      expect(response.headers.get('set-cookie')).toMatch(/^studio_google=[a-f0-9]{64}; HttpOnly; SameSite=Lax; Path=\/api\/auth\/google; Max-Age=600/);
      const done = await back(h, { state, cookie });
      expect(done.status).toBe(302); expect(done.headers.get('location')).toBe('/');
      const session = done.headers.getSetCookie().find((part) => part.startsWith('studio_session=')).split(';')[0];
      expect(done.headers.getSetCookie()).toContain('studio_google=; HttpOnly; SameSite=Lax; Path=/api/auth/google; Max-Age=0');
      expect((await (await h.request('/api/session', { cookie: session })).json()).viewer).toMatchObject({ name: 'Riley', role: 'editor' });
      // The code went to Google with the PKCE verifier that matches the challenge, and the client secret.
      const sent = stub.seen[0].body; const challenge = (await import('node:crypto')).createHash('sha256').update(sent.get('code_verifier')).digest('base64url');
      expect(challenge).toBe(location.searchParams.get('code_challenge')); expect(sent.get('client_secret')).toBe(GOOGLE.googleClientSecret);
      expect(JSON.stringify(people.logs)).not.toContain('google-secret-value');
      // The same Google answer can't be replayed.
      expect((await back(h, { state, cookie })).headers.get('location')).toBe('/#signin-error=expired');
    });

    it('signs nobody in for a wrong state, someone not in People, a paused member, another domain or a bad token', async () => {
      const cases = [
        [{}, (s) => ({ ...s, cookie: `studio_google=${'a'.repeat(64)}` }), 'expired'],
        [{ email: 'stranger@gmail.com' }, (s) => s, 'not-invited'],
        [{ email_verified: false }, (s) => s, 'unverified'],
        [{ nonce: 'replayed' }, (s) => s, 'failed'],
        [{ aud: 'someone-else' }, (s) => s, 'failed'],
        [{ exp: 1 }, (s) => s, 'failed'],
      ];
      for (const [claims, tweak, code] of cases) {
        const people = peopleStub(); const h = await fixture({ people, ...GOOGLE, fetchImpl: google(claims).fetchImpl });
        const answer = await back(h, tweak(await start(h)));
        expect([claims, answer.headers.get('location')]).toEqual([claims, `/#signin-error=${code}`]);
        expect(answer.headers.get('set-cookie')).not.toMatch(/studio_session=[a-f0-9]/);
      }
      const people = peopleStub(); people.members.get('member-riley').disabled = true;
      const paused = await fixture({ people, ...GOOGLE, fetchImpl: google().fetchImpl });
      expect((await back(paused, await start(paused))).headers.get('location')).toBe('/#signin-error=paused');
      const limited = await fixture({ people: peopleStub(), ...GOOGLE, googleDomains: 'searchengineland.com', fetchImpl: google().fetchImpl });
      const limitedStart = await start(limited); expect(limitedStart.location.searchParams.get('hd')).toBe('searchengineland.com');
      expect((await back(limited, limitedStart)).headers.get('location')).toBe('/#signin-error=domain');
      const refused = await fixture({ people: peopleStub(), ...GOOGLE, fetchImpl: google({}, { status: 400 }).fetchImpl });
      expect((await back(refused, await start(refused))).headers.get('location')).toBe('/#signin-error=failed');
      const cancelled = await fixture({ people: peopleStub(), ...GOOGLE, fetchImpl: google().fetchImpl });
      const { state, cookie } = await start(cancelled);
      expect((await fetch(`${cancelled.base}/api/auth/google/callback?state=${state}&error=access_denied`, { redirect: 'manual', headers: { Cookie: cookie } })).headers.get('location')).toBe('/#signin-error=cancelled');
    });

    it('stays off without its settings and under company sign-in', async () => {
      const h = await fixture({ people: peopleStub() });
      expect((await h.request('/api/auth/google/start', { redirect: 'manual' })).headers.get('location')).toBe('/#signin-error=google-off');
    });
  });
});
