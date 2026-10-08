import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import routesModule from '../src/main/ai-routes.js';
import claude from '../src/shared/claude-runner.js';
const { createAiRoutes, AI_ROUTE_TTL_MS } = routesModule;

const dirs = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
const help = () => claude.requiredClaudeFlags().join('\n');
const envelope = (model) => JSON.stringify({ type: 'result', subtype: 'success', is_error: false, structured_output: { ok: true }, modelUsage: { [model]: { canonicalModel: model, outputTokens: 5, costUSD: 0.01 } }, usage: { input_tokens: 2, output_tokens: 5 }, total_cost_usd: 0.01 });

// A Claude app in a given state: missing, too old, signed out, or ready. `ping` decides model answers.
function cli({ installed = true, version = '2.1.281 (Claude Code)', helpText = help(), loggedIn = true, ping = (model) => ({ stdout: envelope(model) }) } = {}) {
  return vi.fn(async (command, args) => {
    if (!installed) throw Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' });
    if (args[0] === '--version') return { stdout: `${version}\n` };
    if (args[0] === '--help') return { stdout: helpText };
    if (args[0] === 'auth') return { stdout: JSON.stringify({ loggedIn }) };
    if (args.includes('--print')) return ping(args[args.indexOf('--model') + 1]);
    throw new Error(`unexpected ${args.join(' ')}`);
  });
}
function routes({ spawn = cli(), key = '', provider = 'auto', runner, clock } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-routes-')); dirs.push(dir);
  const settings = { aiProvider: provider };
  const fakeRunner = runner || { checkModels: vi.fn(async ({ models }) => ({ ok: true, models: models.map((id) => ({ id, available: true })) })), run: vi.fn() };
  const createRunner = vi.fn(() => fakeRunner);
  const api = createAiRoutes({ spawn, getKey: (name) => (name === 'ANTHROPIC_API_KEY' ? key : ''), getSettings: () => settings, dataDir: () => dir, createRunner, now: clock || Date.now });
  return { api, spawn, settings, createRunner, runner: fakeRunner };
}

describe('Claude routes', () => {
  it('uses the Claude app when it is installed, signed in and current', async () => {
    const { api } = routes({ key: 'sk-ant-api03-key' });
    await expect(api.resolve()).resolves.toMatchObject({ provider: 'auto', route: 'claude', problem: '', cli: { installed: true, loggedIn: true, missingFlags: [] } });
  });
  it('falls back to the API key when the Claude app is missing, too old or signed out', async () => {
    for (const spawn of [cli({ installed: false }), cli({ helpText: help().replace('--effort', '') }), cli({ loggedIn: false })]) {
      const { api } = routes({ spawn, key: 'sk-ant-api03-key' });
      expect((await api.resolve()).route).toBe('claude-api');
    }
    const { api } = routes({ spawn: cli({ helpText: help().replace('--effort', '').replace('--safe-mode', '') }), key: 'sk-ant-api03-key' });
    expect((await api.resolve()).cli.missingFlags).toEqual(['--safe-mode', '--effort']);
  });
  it('explains exactly what to fix when nothing works', async () => {
    const missing = routes({ spawn: cli({ installed: false }) }).api;
    await expect(missing.requireRoute()).rejects.toThrow('The Claude app (Claude Code) is not installed. Or add an Anthropic API key in Settings → Writing & research.');
    const old = routes({ spawn: cli({ version: '1.0.3 (Claude Code)', helpText: help().replace('--effort', '') }) }).api;
    await expect(old.requireRoute()).rejects.toThrow('This Claude app (1.0.3 (Claude Code)) is too old for Scraper Studio; it lacks --effort. Run "claude update" in Terminal.');
    const signedOut = routes({ spawn: cli({ loggedIn: false }) }).api;
    await expect(signedOut.requireRoute()).rejects.toThrow('Run "claude auth login" in Terminal.');
  });
  it('honors an explicit choice without falling back', async () => {
    const app = routes({ provider: 'claude', spawn: cli({ loggedIn: false }), key: 'sk-ant-api03-key' }).api;
    await expect(app.requireRoute()).rejects.toThrow(/not signed in/);
    const apiOnly = routes({ provider: 'claude-api' });
    await expect(apiOnly.api.requireRoute()).rejects.toThrow('Add an Anthropic API key in Settings → Writing & research.');
    expect(apiOnly.spawn).not.toHaveBeenCalled();
    expect((await routes({ provider: 'codex' }).api.resolve()).route).toBe('codex');
  });
  it('caches a working route for ten minutes, never a failure, and re-checks after invalidation', async () => {
    let time = 1_000_000;
    const working = routes({ clock: () => time });
    await working.api.resolve(); await working.api.resolve();
    expect(working.spawn).toHaveBeenCalledTimes(3); // --version, --help, auth status once
    time += AI_ROUTE_TTL_MS + 1; await working.api.resolve();
    expect(working.spawn).toHaveBeenCalledTimes(6);
    working.api.invalidate(); await working.api.resolve();
    expect(working.spawn).toHaveBeenCalledTimes(9);
    const failing = routes({ spawn: cli({ installed: false }) });
    await failing.api.resolve(); await failing.api.resolve();
    expect(failing.spawn).toHaveBeenCalledTimes(2);
  });
  it('checks API model access for free and remembers models that answered', async () => {
    const runner = { checkModels: vi.fn(async ({ models }) => ({ ok: false, models: models.map((id) => ({ id, available: id !== 'claude-fable-5-1', error: id === 'claude-fable-5-1' ? 'This API key cannot use claude-fable-5-1.' : '' })) })) };
    const { api, createRunner } = routes({ spawn: cli({ installed: false }), key: 'sk-ant-api03-key', runner });
    expect(await api.checkModels('claude-api', ['claude-opus-5-5', 'claude-fable-5-1', 'claude-opus-5-5'])).toEqual([{ id: 'claude-opus-5-5', available: true, error: '' }, { id: 'claude-fable-5-1', available: false, error: 'This API key cannot use claude-fable-5-1.' }]);
    await api.checkModels('claude-api', ['claude-opus-5-5', 'claude-fable-5-1']);
    expect(runner.checkModels).toHaveBeenLastCalledWith({ models: ['claude-fable-5-1'] }); // Opus answered before
    expect(createRunner).toHaveBeenCalledTimes(1);
    await expect(api.preflight(['claude-opus-5-5', 'claude-fable-5-1'])).rejects.toThrow("the Anthropic API key can't use claude-fable-5-1: This API key cannot use claude-fable-5-1. Choose another model");
  });
  it('checks Claude app model access with a tiny request per model', async () => {
    const spawn = cli({ ping: (model) => (model === 'claude-fable-5-1' ? Promise.reject(new Error('Fable is not on this plan.')) : { stdout: envelope(model) }) });
    const { api } = routes({ spawn });
    const rows = await api.checkModels('claude', ['claude-opus-5-5', 'claude-fable-5-1']);
    expect(rows).toEqual([{ id: 'claude-opus-5-5', available: true, error: '' }, { id: 'claude-fable-5-1', available: false, error: 'Fable is not on this plan.' }]);
    const pings = spawn.mock.calls.filter(([, args]) => args.includes('--print'));
    expect(pings).toHaveLength(2);
    expect(pings[0][1]).toEqual(expect.arrayContaining(['--max-budget-usd', '0.25', '--effort', 'low']));
    await api.checkModels('claude', ['claude-opus-5-5']);
    expect(spawn.mock.calls.filter(([, args]) => args.includes('--print'))).toHaveLength(2);
    // A model that answers as a different model is not accepted.
    const swapped = routes({ spawn: cli({ ping: () => ({ stdout: envelope('claude-sonnet-5-5') }) }) }).api;
    expect((await swapped.checkModels('claude', ['claude-opus-5-5']))[0]).toMatchObject({ available: false, error: 'Claude answered with claude-sonnet-5-5 instead of claude-opus-5-5.' });
  });
  it('reports the route, the Claude app state and model access for Settings', async () => {
    const { api } = routes({ spawn: cli({ helpText: help().replace('--effort', '') }), key: 'sk-ant-api03-key' });
    const result = await api.check({ provider: 'auto', models: ['claude-opus-5-5'] });
    expect(result).toMatchObject({ ok: true, provider: 'auto', route: 'claude-api', keySaved: true, cli: { installed: true, missingFlags: ['--effort'] }, models: [{ id: 'claude-opus-5-5', available: true }], error: '' });
    const nothing = await routes({ spawn: cli({ installed: false }) }).api.check({ provider: 'auto', models: ['claude-opus-5-5'] });
    expect(nothing).toMatchObject({ ok: false, route: '', models: [], error: expect.stringMatching(/not installed/) });
  });
});
