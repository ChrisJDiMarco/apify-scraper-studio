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
  async function request(route, { method = 'GET', body, raw, cookie, origin = base, headers = {} } = {}) {
    return fetch(`${base}${route}`, { method, headers: { ...(method === 'POST' && origin !== false ? { Origin: origin } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined) });
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

// The main process's `people` provider, reduced to what the server asks of it: members with personal links, the admin
// password identity, SSO lookups and a per-viewer projection that names who it was made for.
function peopleStub() {
  const member = (id, name, email, role, channelId = null) => ({ id, name, email, role, channelId, disabled: false, link: { id: `${id}-link`, token: randomBytes(32).toString('hex') } });
  const members = new Map([member('member-alex', 'Alex', 'alex@semrush.com', 'channel', 'blog'), member('member-riley', 'Riley', 'riley@semrush.com', 'editor'), member('member-pat', 'Pat', 'pat@semrush.com', 'admin')].map((m) => [m.id, m]));
  const identity = (m, via) => ({ id: m.id, name: m.name, email: m.email, role: m.disabled ? null : m.role, channelId: m.channelId, via, disabled: m.disabled, memberSince: '2026-10-01T00:00:00.000Z' });
  const stub = {
    members, views: [], logs: [],
    token: (id) => members.get(id).link.token,
    ownerIdentity: () => ({ id: 'owner', name: 'Studio admin', email: '', role: 'admin', channelId: null, via: 'password', disabled: false }),
    fromProxyEmail: (email) => { const m = [...members.values()].find((entry) => entry.email === email); return m ? identity(m, 'proxy') : { id: `guest:${email}`, name: email.split('@')[0], email, role: null, channelId: null, via: 'proxy' }; },
    fromLinkSession: (session) => { const m = members.get(session.memberId); return m && m.link?.id === session.linkId ? identity(m, 'link') : null; },
    linkLogin: (token) => { const m = [...members.values()].find((entry) => entry.link?.token === token && !entry.disabled); return m ? { memberId: m.id, linkId: m.link.id } : null; },
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

  it('signs people in with their personal link for 30 days, passes who they are to each call, and logs no tokens', async () => {
    const people = peopleStub(); const h = await fixture({ people });
    const signedIn = await linkLogin(h, people.token('member-alex'));
    expect(signedIn.status).toBe(200); expect(signedIn.headers.get('set-cookie')).toMatch(/HttpOnly; SameSite=Strict; Path=\/; Max-Age=2592000$/);
    const cookie = cookieOf(signedIn);
    expect(await (await h.request('/api/session', { cookie })).json()).toEqual({ ok: true, user: 'alex@semrush.com', signOut: true, viewer: { name: 'Alex', email: 'alex@semrush.com', role: 'channel', channelId: 'blog', disabled: false } });
    expect((await h.rpc(cookie, { channel: 'state' })).status).toBe(200);
    expect(h.runtime.calls.at(-1)).toMatchObject({ channel: 'state', user: 'member-alex', session: 'link', origin: h.base });
    const admin = await h.login();
    await h.rpc(admin, { channel: 'app-meta' });
    expect(h.runtime.calls.at(-1)).toMatchObject({ channel: 'app-meta', user: 'owner', session: 'password' });
    expect(people.logs).toEqual([expect.objectContaining({ event: 'sign-in', kind: 'link', memberId: 'member-alex' }), expect.objectContaining({ event: 'sign-in', kind: 'password' })]);
    expect(JSON.stringify(people.logs)).not.toContain(people.token('member-alex')); expect(JSON.stringify(people.logs)).not.toContain(cookie.split('=')[1]);
  });

  it('refuses an unknown, malformed or turned-off link with its own answer, and never lets bad links lock anyone out', async () => {
    const people = peopleStub(); const h = await fixture({ people });
    const unknown = await linkLogin(h, randomBytes(32).toString('hex'));
    expect(unknown.status).toBe(401); expect(await unknown.json()).toEqual({ error: roles.copy.linkInvalid, signIn: 'link-invalid' });
    expect((await linkLogin(h, 'not-a-token')).status).toBe(401);
    people.members.get('member-alex').disabled = true;
    expect((await linkLogin(h, people.token('member-alex'))).status).toBe(401);
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

  it('expires admin password sessions after 12 hours and link sessions after 30 days', async () => {
    const people = peopleStub(); const h = await fixture({ people });
    const admin = await h.login(); const alex = cookieOf(await linkLogin(h, people.token('member-alex')));
    const start = Date.now(); const later = (ms) => vi.spyOn(Date, 'now').mockReturnValue(start + ms);
    later(13 * 3600000);
    expect((await h.request('/api/session', { cookie: admin })).status).toBe(401);
    expect((await h.request('/api/session', { cookie: alex })).status).toBe(200);
    later(31 * 24 * 3600000);
    const expired = await h.request('/api/session', { cookie: alex });
    expect(expired.status).toBe(401); expect(await expired.json()).toMatchObject({ signIn: 'password' });
  });

  it('signs out every browser that used a link once the link is replaced, and closes their live updates', async () => {
    const people = peopleStub(); const h = await fixture({ people });
    const phone = cookieOf(await linkLogin(h, people.token('member-alex'))); const laptop = cookieOf(await linkLogin(h, people.token('member-alex')));
    const stream = await openStream(h.base, laptop);
    people.members.get('member-alex').link = { id: 'member-alex-link-2', token: randomBytes(32).toString('hex') };
    h.runtime.broadcast({ version: 1 });
    expect(await stream.ended()).toBe(true);
    for (const cookie of [phone, laptop]) expect((await h.request('/api/session', { cookie })).status).toBe(401);
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
