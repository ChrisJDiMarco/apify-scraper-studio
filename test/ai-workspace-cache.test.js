import { describe, expect, it, vi } from 'vitest';
import { AsyncLocalStorage } from 'node:async_hooks';
const { createAiRoutes } = require('../src/main/ai-routes.js');
const { createAiConnections } = require('../src/main/ai-connections.js');
const { createAiRouting } = require('../src/main/ai-routing.js');

const cli = { installed: false };
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

describe('AI caches in separate workspaces', () => {
  it('reads readiness without re-entering routing preview in the real routing/connection wiring', async () => {
    let connections;
    const routing = createAiRouting({ getSettings: () => ({ aiProvider: 'auto' }), isReady: (route) => connections.ready(route) });
    const getRouting = vi.fn(() => routing.preview());
    connections = createAiConnections({ getScope: () => 'semrush', getKey: () => '', getRouting, aiRoutes: { detectClaudeCli: async () => cli }, probeCli: async () => ({ missing: true }) });
    expect(connections.ready('claude')).toBe(null);
    expect(connections.cachedStatus()).toBe(null);
    expect(getRouting).not.toHaveBeenCalled();
    const status = await connections.status();
    expect(status.connections).toHaveLength(6);
    const before = getRouting.mock.calls.length;
    expect(connections.ready('claude')).toBe(false);
    expect(connections.cachedStatus()).toBe(status);
    expect(getRouting).toHaveBeenCalledTimes(before);
  });

  it('does not join route resolution from a workspace with a saved key to one without a key', async () => {
    const calls = new AsyncLocalStorage();
    const routes = createAiRoutes({ getScope: () => calls.getStore(), getKey: () => calls.getStore() === 'semrush' ? 'key-a' : '', getSettings: () => ({ aiProvider: 'auto' }), shared: true });
    const withKey = calls.run('semrush', () => routes.resolve());
    const withoutKey = calls.run('adobe', () => routes.resolve());
    expect((await withKey).route).toBe('claude-api');
    expect((await withoutKey).route).toBe('');
    expect((await calls.run('adobe', () => routes.resolve())).problem).toContain('Add an Anthropic API key');
  });

  it('does not reuse route or model access from another workspace or a replaced credential', async () => {
    let scope = 'semrush';
    const keys = { semrush: 'key-a', adobe: 'key-b' };
    const check = vi.fn(async (key, models) => ({ models: models.map((id) => ({ id, available: key === 'key-a', error: 'Not available to this account.' })) }));
    const routes = createAiRoutes({ getScope: () => scope, getKey: () => keys[scope], getSettings: () => ({ aiProvider: 'claude-api' }), createRunner: ({ apiKey }) => ({ checkModels: ({ models }) => check(apiKey, models) }), shared: true });
    expect((await routes.resolve('auto')).route).toBe('claude-api');
    expect((await routes.checkModels('claude-api', ['test-model']))[0].available).toBe(true);
    scope = 'adobe';
    expect((await routes.checkModels('claude-api', ['test-model']))[0].available).toBe(false);
    keys.adobe = '';
    expect((await routes.resolve('auto')).route).toBe('');
    scope = 'semrush'; keys.semrush = 'key-c';
    expect((await routes.checkModels('claude-api', ['test-model']))[0].available).toBe(false);
    expect(check).toHaveBeenCalledTimes(3);
  });

  it('keeps connection status, routing attribution and in-flight results within their own scope', async () => {
    const calls = new AsyncLocalStorage();
    const keys = { semrush: { OPENAI_API_KEY: 'key-a' }, adobe: {} };
    const gate = deferred();
    const connections = createAiConnections({ getScope: () => calls.getStore(), getKey: (name) => keys[calls.getStore()][name] || '', getRouting: () => ({ tasks: [{ taskId: calls.getStore(), route: 'openai' }] }), aiRoutes: { detectClaudeCli: async () => { await gate.promise; return cli; } }, probeCli: async () => ({ missing: true }) });
    const first = calls.run('semrush', () => connections.status());
    const second = calls.run('adobe', () => connections.status());
    gate.resolve();
    const [semrush, adobe] = await Promise.all([first, second]);
    const row = (status) => status.connections.find((entry) => entry.id === 'openai');
    expect(row(semrush)).toMatchObject({ status: 'ready', usedBy: ['semrush'] });
    expect(row(adobe)).toMatchObject({ status: 'no-key', usedBy: ['adobe'] });
    expect(calls.run('adobe', () => connections.cachedStatus())).toBe(adobe);
    keys.adobe.OPENAI_API_KEY = 'key-b';
    expect(calls.run('adobe', () => connections.cachedStatus())).toBe(null);
    expect(row(await calls.run('adobe', () => connections.status())).status).toBe('ready');
  });

  it('does not restore stale cached status after settings invalidate an in-flight check', async () => {
    const gate = deferred(); let key = 'key-a';
    const connections = createAiConnections({ getScope: () => 'semrush', getKey: () => key, aiRoutes: { detectClaudeCli: async () => { await gate.promise; return cli; }, invalidate: vi.fn() }, probeCli: async () => ({ missing: true }) });
    const pending = connections.status();
    key = ''; connections.invalidate(); gate.resolve(); await pending;
    expect(connections.cachedStatus()).toBe(null);
    expect((await connections.status()).connections.find((entry) => entry.id === 'openai').status).toBe('no-key');
  });
});
