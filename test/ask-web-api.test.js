// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

// The browser studio's side of Ask AI's stream (src/web/web-api.js onAskStream): it opens the live-update stream if
// needed, hands over `event: ask`, and says { type: 'resync' } whenever events may have been missed.
class FakeSource {
  static CLOSED = 2;
  static instances = [];
  constructor(url) { this.url = url; this.readyState = 0; this.listeners = {}; FakeSource.instances.push(this); }
  addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
  emit(type, data) { for (const listener of this.listeners[type] || []) listener({ data: JSON.stringify(data ?? {}) }); }
  close() { this.readyState = FakeSource.CLOSED; }
}
const answer = (body) => ({ status: 200, ok: true, type: 'basic', headers: new Headers({ 'content-type': 'application/json' }), json: async () => body });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function load() {
  vi.resetModules(); FakeSource.instances = [];
  vi.stubGlobal('fetch', vi.fn(async () => answer({ result: { version: 'fresh' } }))); vi.stubGlobal('EventSource', FakeSource);
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  const { createWebApi } = await import('../src/web/web-api.js');
  return createWebApi();
}

describe('Ask AI on the browser studio', () => {
  it('opens the stream for Ask AI alone, passes its events on, and asks for a resync after a drop', async () => {
    const api = await load(); const heard = [];
    const off = api.onAskStream((event) => heard.push(event));
    expect(FakeSource.instances).toHaveLength(1);
    const source = FakeSource.instances[0];
    source.emit('hello', { build: '' });
    source.emit('ask', { type: 'delta', requestId: 'r1', seq: 2, at: 0, text: 'Two' });
    source.emit('ask-resync');
    source.emit('error'); source.emit('hello', { build: '' }); // back after a drop
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(heard).toEqual([{ type: 'delta', requestId: 'r1', seq: 2, at: 0, text: 'Two' }, { type: 'resync' }, { type: 'resync' }]);
    off();
    expect(source.readyState).toBe(FakeSource.CLOSED); // nobody else listens, so the stream is given back
  });

  it('shares one stream with the state listeners and keeps it while either still listens', async () => {
    const api = await load();
    const offState = api.onStateChanged(() => {}); const offAsk = api.onAskStream(() => {});
    expect(FakeSource.instances).toHaveLength(1);
    offState();
    expect(FakeSource.instances[0].readyState).not.toBe(FakeSource.CLOSED);
    offAsk();
    expect(FakeSource.instances[0].readyState).toBe(FakeSource.CLOSED);
  });
});

describe('the report editor’s live events on the browser studio', () => {
  it('passes `event: person` to onPersonEvent only, with the same resyncs, and gives the stream back when done', async () => {
    const api = await load(); const person = []; const asks = [];
    const off = api.onPersonEvent((event) => person.push(event));
    const offAsk = api.onAskStream((event) => asks.push(event));
    expect(FakeSource.instances).toHaveLength(1);
    const source = FakeSource.instances[0];
    source.emit('hello', { build: '' });
    source.emit('person', { type: 'note-changed', assetId: 'asset-report', noteId: 'note-1' });
    source.emit('ask-resync');
    expect(person).toEqual([{ type: 'note-changed', assetId: 'asset-report', noteId: 'note-1' }, { type: 'resync' }]);
    expect(asks).toEqual([{ type: 'resync' }]);
    offAsk();
    expect(source.readyState).not.toBe(FakeSource.CLOSED);
    off();
    expect(source.readyState).toBe(FakeSource.CLOSED);
  });
});
