// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';

// How Ask AI's streamed answers travel on the web: index.js pushAskEvent → web-runtime sendTo → studio-server writes
// `event: ask` to that person's own live-update streams, at once (never held for the 750 ms state coalescing), only to
// the browser session that asked for people who share the admin password, and not at all to a stalled tab.
const require = createRequire(import.meta.url);
const webRuntime = require('../src/main/web-runtime.js');
const { createStudioServer } = require('../src/main/studio-server.js');
const PASSWORD = 'fixture-only-password-12345';
const resources = [];
afterEach(async () => { for (const r of resources.splice(0)) { r.server.closeAllConnections?.(); await new Promise((resolve) => r.server.close(resolve)); fs.rmSync(r.root, { recursive: true, force: true }); } vi.restoreAllMocks(); });

function people() {
  const members = new Map(['member-one', 'member-two'].map((id) => [id, { id, name: id, email: `${id}@semrush.com`, role: 'editor', link: { id: `${id}-link`, token: randomBytes(32).toString('hex') } }]));
  return {
    members,
    ownerIdentity: () => ({ id: 'owner', name: 'Studio admin', email: '', role: 'admin', channelId: null, via: 'password', disabled: false }),
    fromProxyEmail: () => null,
    // Links here sign in as often as a test needs (one-time use is studio-server.test.js's to check).
    fromMemberSession: (session) => { const m = members.get(session.memberId); return m ? { id: m.id, name: m.name, email: m.email, role: m.role, channelId: null, via: 'link', disabled: false } : null; },
    useLink: (token) => { const m = [...members.values()].find((entry) => entry.link.token === token); return m ? { memberId: m.id, epoch: 0 } : null; },
    view: (base) => JSON.stringify(base),
    logEvent: () => {},
  };
}
async function fixture({ streamTuning } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ask-transport-')); const webRoot = path.join(root, 'public'); fs.mkdirSync(webRoot);
  fs.writeFileSync(path.join(webRoot, 'index.html'), '<!doctype html><title>Fixture</title>');
  const sessions = []; const listeners = new Set(); const provider = people(); const provisions = new Map();
  const runtime = {
    settings: { transferDir: path.join(root, 'transfers') },
    channels: () => ['state', 'help:progress'],
    provided: (name) => (name === 'people' ? provider : provisions.get(name) || null),
    provide: (name, value) => provisions.set(name, value),
    async invoke(channel, payload, context = {}) { sessions.push({ user: context.user?.id, session: context.session }); return { result: { ok: true }, files: [], opens: [] }; },
    onBroadcast: (channel, listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    broadcast: (state) => { for (const listener of listeners) listener(state); },
    onPersonal: webRuntime.onPersonal,
  };
  const { server } = createStudioServer({ webRoot, password: PASSWORD, runtime, logEvent: () => {}, streamTuning: { coalesceMs: 5000, ...streamTuning } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); const base = `http://127.0.0.1:${server.address().port}`;
  resources.push({ server, root });
  const post = (route, body, cookie) => fetch(`${base}${route}`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
  const cookieOf = (response) => response.headers.get('set-cookie').split(';')[0];
  return {
    base, runtime, provider, sessions, provisions,
    password: async () => cookieOf(await post('/api/login', { password: PASSWORD })),
    link: async (id) => cookieOf(await post('/api/login', { linkToken: provider.members.get(id).link.token })),
    // The live session object a browser's calls carry (what index.js reads with access.sessionForCall()).
    sessionOf: async (cookie) => { await post('/api/rpc', { channel: 'state' }, cookie); return sessions.at(-1).session; },
  };
}
async function openStream(base, cookie) {
  const controller = new AbortController();
  const response = await fetch(`${base}/api/events`, { headers: { Cookie: cookie, 'Accept-Encoding': 'identity' }, signal: controller.signal });
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let text = ''; let pending = null;
  const stream = {
    abort: () => controller.abort(),
    // Everything the stream sent within `ms` (one read stays pending between calls, so no chunk is lost).
    async collect(ms = 150) {
      const until = Date.now() + ms;
      while (Date.now() < until) {
        pending ||= reader.read().catch(() => ({ done: true }));
        const next = await Promise.race([pending, new Promise((resolve) => setTimeout(() => resolve(null), Math.max(1, until - Date.now())))]);
        if (!next) break;
        pending = null; if (next.done) break; text += decoder.decode(next.value);
      }
      return text;
    },
    asks: () => [...text.matchAll(/event: ask\ndata: (.*)\n\n/g)].map((match) => JSON.parse(match[1])),
    persons: () => [...text.matchAll(/event: person\ndata: (.*)\n\n/g)].map((match) => JSON.parse(match[1])),
  };
  await stream.collect(50); // the hello
  return stream;
}

describe('the web runtime’s personal channel', () => {
  it('hands each event to listeners with who it is for, and never without a person', () => {
    const heard = []; const off = webRuntime.onPersonal('ask', (target, payload) => heard.push([target, payload]));
    webRuntime.sendTo({ identityId: 'member-one', session: null }, 'ask', { type: 'delta', text: 'Hi' });
    webRuntime.sendTo({ session: null }, 'ask', { type: 'delta', text: 'nobody' });
    webRuntime.sendTo(null, 'ask', { type: 'delta' });
    off(); webRuntime.sendTo({ identityId: 'member-one' }, 'ask', { type: 'delta', text: 'after' });
    expect(heard).toEqual([[{ identityId: 'member-one', session: null }, { type: 'delta', text: 'Hi' }]]);
  });
});

describe('Ask AI events on the browser studio', () => {
  it('reach only that person’s streams, at once, and for the shared admin password only the browser that asked', async () => {
    const h = await fixture();
    const one = await openStream(h.base, await h.link('member-one'));
    const two = await openStream(h.base, await h.link('member-two'));
    const firstCookie = await h.password(); const secondCookie = await h.password();
    const firstAdmin = await openStream(h.base, firstCookie); const secondAdmin = await openStream(h.base, secondCookie);
    const firstSession = await h.sessionOf(firstCookie);
    const started = Date.now();
    webRuntime.sendTo({ identityId: 'member-one', session: null }, 'ask', { type: 'delta', requestId: 'r1', seq: 2, at: 0, text: 'Two trends' });
    webRuntime.sendTo({ identityId: 'owner', session: firstSession }, 'ask', { type: 'progress', requestId: 'r2', seq: 1, progress: { status: 'starting' } });
    // A follow-up names no session: every tab of that person gets it.
    webRuntime.sendTo({ identityId: 'owner', session: null }, 'ask', { type: 'followup', conversationId: 'ask-1', messageId: 'msg-1' });
    await Promise.all([one.collect(), two.collect(), firstAdmin.collect(), secondAdmin.collect()]);
    expect(Date.now() - started).toBeLessThan(2000); // well inside the 5 s state coalescing
    expect(one.asks()).toEqual([{ type: 'delta', requestId: 'r1', seq: 2, at: 0, text: 'Two trends' }]);
    expect(two.asks()).toEqual([]);
    expect(firstAdmin.asks().map((event) => event.type)).toEqual(['progress', 'followup']);
    expect(secondAdmin.asks().map((event) => event.type)).toEqual(['followup']);
    for (const stream of [one, two, firstAdmin, secondAdmin]) stream.abort();
  });

  it('skips a stalled tab instead of piling events up behind it', async () => {
    const h = await fixture({ streamTuning: { backlogBytes: -1, stallMs: 60000, heartbeatMs: 20 } });
    const one = await openStream(h.base, await h.link('member-one'));
    webRuntime.sendTo({ identityId: 'member-one', session: null }, 'ask', { type: 'delta', requestId: 'r1', seq: 1, at: 0, text: 'x' });
    await one.collect();
    expect(one.asks()).toEqual([]);
    one.abort();
  });
});

// The report editor's live events (index.js pushPersonEvent → web-runtime sendTo(…, 'person') → `event: person`).
describe('report editor events on the browser studio', () => {
  it('reach only that person’s streams, at once, and say whether the person still has a stream open', async () => {
    const h = await fixture();
    const liveStreams = h.provisions.get('liveStreams');
    expect(liveStreams.has('member-one')).toBe(false);
    const one = await openStream(h.base, await h.link('member-one'));
    const two = await openStream(h.base, await h.link('member-two'));
    expect(liveStreams.has('member-one')).toBe(true);
    const started = Date.now();
    webRuntime.sendTo({ identityId: 'member-one', session: null }, 'person', { type: 'doc-update', assetId: 'asset-report', update: 'AAA=', from: { id: 'member-two', name: 'member-two', color: '#4F7FE8' } });
    webRuntime.sendTo({ identityId: 'member-two', session: null }, 'person', { type: 'note-changed', assetId: 'asset-report', noteId: 'note-1' });
    await Promise.all([one.collect(), two.collect()]);
    expect(Date.now() - started).toBeLessThan(2000); // never held for the 5 s state coalescing
    expect(one.persons()).toEqual([{ type: 'doc-update', assetId: 'asset-report', update: 'AAA=', from: { id: 'member-two', name: 'member-two', color: '#4F7FE8' } }]);
    expect(two.persons()).toEqual([{ type: 'note-changed', assetId: 'asset-report', noteId: 'note-1' }]);
    expect(one.asks()).toEqual([]); // Ask AI's listeners never see them
    one.abort(); two.abort();
    for (let i = 0; i < 50 && liveStreams.has('member-one'); i++) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(liveStreams.has('member-one')).toBe(false);
  });
});
