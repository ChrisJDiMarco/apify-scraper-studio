// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The browser studio's live updates (src/web/web-api.js) against a stand-in EventSource: a server at its stream limit,
// a newer build after a deploy, a stream a proxy closed for good while the server restarted, and a tab in the background.
class FakeSource {
  static CLOSED = 2;
  static instances = [];
  constructor(url) { this.url = url; this.readyState = 0; this.listeners = {}; FakeSource.instances.push(this); }
  addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
  emit(type, data) { for (const listener of this.listeners[type] || []) listener({ data: JSON.stringify(data ?? {}) }); }
  close() { this.readyState = FakeSource.CLOSED; }
}
const answer = (status, body, contentType = 'application/json') => ({ status, ok: status >= 200 && status < 300, type: 'basic', headers: new Headers({ 'content-type': contentType }), json: async () => body });
let fetchMock; let events;
// Each test loads a fresh copy of the module; the listeners it and the test add to document and window are removed after.
const added = [];
function listen(target, type, listener) { target.addEventListener(type, listener); added.push([target, type, listener]); }
async function load({ head = '', session = answer(200, { ok: true }) } = {}) {
  vi.resetModules(); FakeSource.instances = []; document.head.innerHTML = head;
  fetchMock = vi.fn(async (url) => (url === '/api/session' ? session : answer(200, { result: { version: 'fresh' } })));
  vi.stubGlobal('fetch', fetchMock); vi.stubGlobal('EventSource', FakeSource);
  const seen = []; events = seen; for (const type of ['studio-live', 'studio-updated', 'studio-signed-out']) listen(window, type, (event) => seen.push({ type, detail: event.detail }));
  const original = document.addEventListener.bind(document);
  const spy = vi.spyOn(document, 'addEventListener').mockImplementation((type, listener, options) => { added.push([document, type, listener]); return original(type, listener, options); });
  const { createWebApi } = await import('../src/web/web-api.js');
  spy.mockRestore();
  const states = []; createWebApi().onStateChanged((state) => states.push(state));
  return { states, source: () => FakeSource.instances.at(-1) };
}
const rpcBodies = () => fetchMock.mock.calls.filter(([url]) => url === '/api/rpc').map(([, init]) => JSON.parse(init.body));
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
beforeEach(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); });
afterEach(() => { for (const [target, type, listener] of added.splice(0)) target.removeEventListener(type, listener); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('browser live updates', () => {
  it('says live updates are paused when the server is at its tab limit, and catches up with one state read', async () => {
    const page = await load();
    page.source().emit('hello', { build: '', busy: true, retryMs: 30000 }); await settle();
    expect(events).toContainEqual({ type: 'studio-live', detail: { live: false, reason: 'busy' } });
    expect(rpcBodies()).toEqual([{ channel: 'state' }]); expect(page.states).toEqual([{ version: 'fresh' }]);
    page.source().emit('error'); await settle(); // the server ended the stream; the browser asks again by itself
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/session')).toBe(false);
    page.source().emit('hello', { build: '' }); await settle();
    expect(events).toContainEqual({ type: 'studio-live', detail: { live: true, reason: '' } });
  });

  it('offers a reload when the server runs a newer build than this page', async () => {
    const page = await load({ head: '<script type="module" src="/assets/index-OLD.js"></script>' });
    page.source().emit('hello', { build: 'index-OLD.js' }); expect(events.filter((event) => event.type === 'studio-updated')).toEqual([]);
    page.source().emit('hello', { build: 'index-NEW.js' }); page.source().emit('hello', { build: 'index-NEWER.js' });
    expect(events.filter((event) => event.type === 'studio-updated')).toEqual([{ type: 'studio-updated', detail: { build: 'index-NEW.js' } }]);
  });

  it('shows the restart, then opens a new stream when a proxy closed the old one while the server was down', async () => {
    vi.useFakeTimers();
    const page = await load({ session: answer(502, {}, 'text/html') });
    const first = page.source(); first.emit('restarting');
    expect(events).toContainEqual({ type: 'studio-live', detail: { live: false, reason: 'restarting' } });
    first.readyState = FakeSource.CLOSED; first.emit('error');
    await vi.advanceTimersByTimeAsync(4000); expect(FakeSource.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1500); expect(FakeSource.instances).toHaveLength(2);
    page.source().emit('hello', { build: '' }); await vi.advanceTimersByTimeAsync(0);
    expect(rpcBodies()).toEqual([{ channel: 'state' }]); // back: catch up on what was missed
  });

  it('gives a background tab’s stream back after a minute and catches up when it’s shown again', async () => {
    vi.useFakeTimers();
    const page = await load(); const first = page.source();
    let state = 'hidden'; Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(60000); expect(first.readyState).toBe(FakeSource.CLOSED);
    state = 'visible'; document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(0);
    expect(FakeSource.instances).toHaveLength(2); expect(rpcBodies()).toEqual([{ channel: 'state' }]);
  });
});
