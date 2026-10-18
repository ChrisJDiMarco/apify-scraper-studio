import { describe, expect, it, vi } from 'vitest';
const { createAiConnections, codexSignIn } = require('../src/main/ai-connections.js');

// The six AI connections (src/main/ai-connections.js) with injected CLI probes, keys and catalogs: nothing is spawned or
// fetched. Claude Code's state comes from ai-routes detectClaudeCli ('claude auth status --json'); Codex's from
// 'codex --version' and 'codex login status'. The Mac copy is checked here on every OS (platform: 'darwin');
// test/win-copy.test.js checks the Windows copy.
const READY_CLI = { installed: true, version: '2.1.296 (Claude Code)', loggedIn: true, missingFlags: [], authMethod: 'claude.ai', streaming: true };
function harness({ cli = READY_CLI, codex = { version: { code: 0, stdout: 'codex-cli 0.156.0\n' }, status: { code: 0, stdout: 'Logged in using ChatGPT\n' } }, keys = {}, problems = {}, web = false, catalog = {}, runners = {}, aiRoutes = {}, platform = 'darwin' } = {}) {
  const probes = [];
  const probeCli = vi.fn(async (command, args) => {
    probes.push([command, ...args].join(' '));
    if (command !== 'codex') throw new Error(`unexpected ${command}`);
    if (codex === 'missing') return { missing: true, code: null, stdout: '', stderr: '' };
    return args[0] === '--version' ? codex.version : codex.status;
  });
  const routes = {
    detectClaudeCli: vi.fn(async () => cli),
    resolve: vi.fn(async (provider) => (provider === 'claude' && !cli.loggedIn ? { route: 'claude', problem: 'The Claude app is not signed in. Run "claude auth login" in Terminal.' } : cli.loggedIn ? { route: 'claude' } : keys.ANTHROPIC_API_KEY ? { route: 'claude-api' } : { route: '', problem: 'The Claude app is not signed in.' })),
    checkModels: vi.fn(async (route, models) => models.map((id) => ({ id, available: id !== 'claude-fable-5-1', error: id === 'claude-fable-5-1' ? 'Not available to this account.' : '' }))),
    check: vi.fn(async ({ provider, models }) => ({ ok: true, provider, version: cli.version, models: models.map((id) => ({ id, available: true })) })),
    invalidate: vi.fn(),
    ...aiRoutes,
  };
  const onChecked = vi.fn();
  const connections = createAiConnections({ aiRoutes: routes, probeCli, getKey: (name) => keys[name] || '', keyProblem: (name) => problems[name] || '', web, serverUser: web ? 'node' : '', catalog, runners, onChecked, now: () => Date.parse('2026-10-17T10:00:00Z'), platform });
  return { connections, probes, routes, onChecked };
}
const row = (status, id) => status.connections.find((entry) => entry.id === id);

describe('connection status', () => {
  it('reads Claude Code’s install, version and sign-in, and every key, for free', async () => {
    const { connections } = harness({ keys: { OPENAI_API_KEY: 'sk-test-openai' }, problems: { OPENROUTER_API_KEY: 'mismatch' } });
    const status = await connections.status();
    expect(status).toMatchObject({ host: 'mac', serverUser: null });
    expect(row(status, 'claude')).toMatchObject({ status: 'ready', signedInWith: 'claude-plan', version: '2.1.296', detail: 'Signed in · Claude Code 2.1.296', label: 'Claude Code', auth: 'subscription-cli' });
    expect(row(status, 'claude-api')).toMatchObject({ status: 'no-key', keySaved: false });
    expect(row(status, 'openai')).toMatchObject({ status: 'ready', keySaved: true, detail: expect.stringContaining('Stored encrypted in this Mac’s keychain and sent only to OpenAI.') });
    expect(row(status, 'openrouter')).toMatchObject({ status: 'key-unreadable', keyProblem: 'mismatch', detail: expect.stringContaining('different STUDIO_SECRET_KEY') });
    expect(row(status, 'fal')).toMatchObject({ status: 'no-key' });
    expect(row(status, 'codex')).toMatchObject({ status: 'ready', signedInWith: 'chatgpt', version: '0.156.0', detail: 'Signed in with ChatGPT · Codex 0.156.0' });
  });
  it.each([
    [{ installed: false }, 'not-installed', 'Claude Code isn’t installed on this Mac. Install it, then sign in.', 'claude auth login'],
    [{ installed: true, version: '1.0.0', missingFlags: ['--effort'], loggedIn: true }, 'update', 'This version can’t run studio requests. In Terminal run: claude update', 'claude update'],
    [{ installed: true, version: '2.1.296', missingFlags: [], loggedIn: false }, 'sign-in', 'Not signed in. In Terminal run: claude auth login', 'claude auth login'],
  ])('says what to do when Claude Code isn’t ready (%#)', async (cli, status, detail, command) => {
    const claude = row(await harness({ cli }).connections.status(), 'claude');
    expect(claude).toMatchObject({ status, detail }); expect(claude.commands.map((entry) => entry.command)).toEqual([command]);
  });
  it('reads "codex login status" for ChatGPT, an API key, a sign-out, an unreadable answer and a missing CLI', async () => {
    expect(codexSignIn({ code: 0, stdout: 'Logged in using ChatGPT\n' })).toBe('chatgpt');
    expect(codexSignIn({ code: 0, stdout: 'Logged in using an API key - sk-proj-***\n' })).toBe('api-key');
    expect(codexSignIn({ code: 1, stdout: 'Not logged in\n' })).toBe('');
    expect(codexSignIn({ code: 2, stderr: "error: unrecognized subcommand 'status'" })).toBe('unknown');
    expect(codexSignIn({ code: null, timedOut: true })).toBe('unknown');
    expect(row(await harness({ codex: { version: { code: 0, stdout: 'codex-cli 0.156.0' }, status: { code: 0, stdout: 'Logged in using an API key' } } }).connections.status(), 'codex')).toMatchObject({ status: 'ready', signedInWith: 'api-key', detail: 'Signed in with an API key · Codex 0.156.0' });
    expect(row(await harness({ codex: { version: { code: 0, stdout: 'codex-cli 0.156.0' }, status: { code: 1, stdout: 'Not logged in' } } }).connections.status(), 'codex')).toMatchObject({ status: 'sign-in', detail: 'Not signed in. In Terminal run: codex login' });
    expect(row(await harness({ codex: 'missing' }).connections.status(), 'codex')).toMatchObject({ status: 'not-installed', detail: 'Codex isn’t installed on this Mac. Install it, then sign in.' });
    expect(row(await harness({ codex: { version: { code: 0, stdout: 'codex-cli 0.40.0' }, status: { code: 2, stderr: 'unrecognized subcommand' } } }).connections.status(), 'codex')).toMatchObject({ status: 'ready', detail: expect.stringContaining('the sign-in couldn’t be confirmed') });
  });
  it('says on the browser studio that subscriptions use the server’s sign-in, and caches status for a minute', async () => {
    const h = harness({ web: true });
    const status = await h.connections.status();
    expect(status).toMatchObject({ host: 'server', serverUser: 'node' });
    expect(row(status, 'claude').serverNote).toBe('This uses the sign-in on the studio server (user node), not your own account. Whoever runs the server signs in there, and usage counts against that plan.');
    expect(row(status, 'codex').serverNote).toContain('Codex can read files the server’s user can read. Prefer Claude on a shared server.');
    expect(row(status, 'openai').detail).toContain('Stored encrypted on the studio server and sent only to OpenAI.');
    await h.connections.status();
    expect(h.routes.detectClaudeCli).toHaveBeenCalledTimes(1);
    await h.connections.status({ fresh: true });
    expect(h.routes.detectClaudeCli).toHaveBeenCalledTimes(2);
  });
});

describe('require and preflight', () => {
  it('refuses work on a connection that isn’t ready with what to do, and checks only Codex for a Codex job', async () => {
    const h = harness({ codex: { version: { code: 0, stdout: 'codex-cli 0.156.0' }, status: { code: 1, stdout: 'Not logged in' } } });
    await expect(h.connections.require('openrouter')).rejects.toThrow('Add an OpenRouter key in Settings, AI connections. Nothing was started.');
    await expect(h.connections.require('fal')).rejects.toThrow('Add a fal.ai key in Settings, AI connections. Nothing was started.');
    await expect(h.connections.require('codex')).rejects.toThrow('Codex isn’t signed in on this Mac. In Terminal run: codex login. Nothing was started.');
    expect(h.routes.detectClaudeCli).not.toHaveBeenCalled();
    expect(h.probes.every((probe) => probe.startsWith('codex '))).toBe(true);
    expect(await harness().connections.require('auto')).toBe('claude');
    expect(await harness({ cli: { installed: false, loggedIn: false }, keys: { ANTHROPIC_API_KEY: 'sk-ant-x' } }).connections.require('auto')).toBe('claude-api');
    const web = harness({ web: true, codex: 'missing' });
    await expect(web.connections.require('codex')).rejects.toThrow('Codex isn’t installed on the studio server. Nothing was started.');
    // An answer that can't be read lets Codex run, as it did before (it reports its own sign-in problem).
    expect(await harness({ codex: { version: { code: 0, stdout: 'codex-cli 0.40.0' }, status: { code: 2, stderr: 'unrecognized subcommand' } } }).connections.require('codex')).toBe('codex');
  });
  it('checks every model a piece of work uses on its own connection before anything is spent', async () => {
    const catalog = {
      openrouterModels: vi.fn(async () => ({ models: [{ id: 'deepseek/deepseek-v4', contextTokens: 64000, inputUsdPerMTok: 0.3, outputUsdPerMTok: 1.2 }, { id: 'qwen/qwen-4', contextTokens: 1000000, inputUsdPerMTok: null, outputUsdPerMTok: null }] })),
      falModel: vi.fn(async (id) => ({ profile: { id, png: true }, price: null })), profile: () => null,
      priceFor: vi.fn((route, model) => (model === 'fal-ai/priced' ? { known: true, unitUsd: 0.03, basis: 'unit' } : { known: false })),
    };
    const { connections, routes } = harness({ keys: { OPENROUTER_API_KEY: 'sk-or-x', FAL_KEY: 'fal-key-0123456789abcdef' }, catalog });
    const task = (fields) => ({ kind: 'text', metered: true, ...fields });
    await expect(connections.preflight([task({ taskId: 'research.tagging', label: 'Tag every post', route: 'auto', model: 'claude-fable-5-1', modelLabel: 'Claude Fable 5.1' })])).rejects.toThrow('Claude Code can’t use Claude Fable 5.1 for Tag every post: Not available to this account. Choose another model in Settings, Model routing, or use an account with access. Nothing was started.');
    expect(routes.checkModels).toHaveBeenCalledWith('claude', ['claude-fable-5-1']);
    await expect(connections.preflight([task({ taskId: 'assistant.ask-ai', label: 'Ask AI answers', route: 'openrouter', model: 'deepseek/deepseek-v4' })], { needs: () => ({ minContextTokens: 128000 }) })).rejects.toThrow('it reads 64K tokens and this job needs about 136K.');
    await expect(connections.preflight([task({ taskId: 'data.threads', label: 'Group threads', route: 'openrouter', model: 'qwen/qwen-4' })])).rejects.toThrow('OpenRouter didn’t return its price, so the studio can’t estimate it.');
    await expect(connections.preflight([task({ taskId: 'data.threads', label: 'Group threads', route: 'openrouter', model: 'gone/model' })])).rejects.toThrow('OpenRouter doesn’t list this model.');
    await expect(connections.preflight([{ taskId: 'pictures.kit-image', label: 'Channel asset pictures', kind: 'image', route: 'fal', model: 'fal-ai/unpriced', modelLabel: 'Unpriced' }])).rejects.toThrow('fal.ai didn’t return a price for Unpriced, so the studio can’t estimate it. Nothing was started.');
    await expect(connections.preflight([{ taskId: 'pictures.kit-image', kind: 'image', route: 'fal', model: 'fal-ai/priced' }])).resolves.toBeUndefined();
    await expect(connections.preflight([task({ taskId: 'x', route: 'auto', model: 'claude-opus-5-5', problem: 'Claude Opus 5.5 can’t run on Codex.' })])).rejects.toThrow('Claude Opus 5.5 can’t run on Codex. Nothing was started.');
    await expect(connections.preflight([task({ taskId: 'x', route: 'openrouter', model: 'deepseek/deepseek-v4' })])).resolves.toBeUndefined();
  });
  it('tests a connection for free and records the check for Home', async () => {
    const runners = { openrouter: { checkKey: vi.fn(async () => ({ label: 'studio', limitRemainingUsd: 42.1, usageUsd: 7.9, freeTier: false })) }, openaiCheck: vi.fn(async (id) => { if (id === 'gpt-image-2.5-sunburst') throw new Error('This OpenAI key can’t use gpt-image-2.5-sunburst.'); return { id }; }) };
    const catalog = { refresh: vi.fn(async () => ({ models: [{ id: 'anthropic/claude-opus-5.5' }] })), falPrices: vi.fn(async (ids) => Object.fromEntries(ids.map((id) => [id, { unitUsd: 0.24, unit: 'second' }]))), falModel: vi.fn(async () => ({ profile: {}, price: null })), modelLabel: (route, id) => (id === 'gpt-image-2.5-flare' ? 'GPT Image 2.5 Flare' : id) };
    const h = harness({ keys: { OPENROUTER_API_KEY: 'sk-or-x', OPENAI_API_KEY: 'sk-x', FAL_KEY: 'fal-key-0123456789abcdef' }, runners, catalog });
    expect(await h.connections.test('openrouter', { models: ['anthropic/claude-opus-5.5'] })).toMatchObject({ ok: true, detail: 'Works · $42.10 left on this key', account: { limitRemainingUsd: 42.1 } });
    expect(await h.connections.test('openai', { models: ['gpt-image-2.5-flare'] })).toMatchObject({ ok: true, detail: 'Works · GPT Image 2.5 Flare' });
    expect(await h.connections.test('openai', { models: ['gpt-image-2.5-sunburst'] })).toMatchObject({ ok: false, detail: 'This OpenAI key can’t use gpt-image-2.5-sunburst.' });
    expect(await h.connections.test('fal', { models: ['bytedance/seedance-2.0/fast/text-to-video'] })).toMatchObject({ ok: true, detail: 'Works · prices loaded for 1 model', pricesLoaded: 1 });
    expect(await h.connections.test('codex')).toMatchObject({ ok: true, detail: 'Signed in with ChatGPT · Codex 0.156.0' });
    expect(await harness().connections.test('fal')).toMatchObject({ ok: false, error: 'Add a fal.ai key in Settings, AI connections. Nothing was started.' });
    expect(h.onChecked).toHaveBeenCalledWith({ ok: true, provider: 'openrouter', at: '2026-10-17T10:00:00.000Z' });
  });
});
