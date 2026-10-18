import { describe, expect, it, vi } from 'vitest';
import { readinessItems } from '../src/shared/health.js';
const { createAiConnections } = require('../src/main/ai-connections.js');
const { createAiRoutes } = require('../src/main/ai-routes.js');

// What the Windows app says where the Mac app says "this Mac", Terminal and the keychain. index.js passes its own
// process.platform; these pass 'win32' (and 'darwin' for the Mac copy), so they check the same thing on every OS.
// Nothing is spawned: Claude Code's state is injected and Codex answers from a fake probe.
const READY_CLI = { installed: true, version: '2.1.296 (Claude Code)', loggedIn: true, missingFlags: [], authMethod: 'claude.ai' };
function connections({ platform, cli = READY_CLI, codex = 'signed-out', keys = {}, web = false } = {}) {
  const probeCli = vi.fn(async (command, args) => {
    if (codex === 'missing') return { missing: true, code: null, stdout: '', stderr: '' };
    return args[0] === '--version' ? { code: 0, stdout: 'codex-cli 0.156.0\n' } : { code: 1, stdout: 'Not logged in\n' };
  });
  const aiRoutes = { detectClaudeCli: vi.fn(async () => cli), resolve: vi.fn(async () => ({ route: 'claude' })), invalidate: vi.fn() };
  return createAiConnections({ aiRoutes, probeCli, getKey: (name) => keys[name] || '', web, platform, now: () => Date.parse('2026-10-18T10:00:00Z') });
}
const row = (status, id) => status.connections.find((entry) => entry.id === id);

describe('AI connection copy on Windows', () => {
  it('says this PC when Codex is missing, and Command Prompt for every sign-in command', async () => {
    const missing = await connections({ platform: 'win32', codex: 'missing' }).status();
    expect(row(missing, 'codex').detail).toBe('Codex isn’t installed on this PC. Install it, then sign in.');
    await expect(connections({ platform: 'win32', codex: 'missing' }).require('codex')).rejects.toThrow('Codex isn’t installed on this PC. Nothing was started.');

    const signedOut = connections({ platform: 'win32', cli: { ...READY_CLI, loggedIn: false } });
    const status = await signedOut.status();
    expect(row(status, 'codex').detail).toBe('Not signed in. In Command Prompt run: codex login');
    expect(row(status, 'claude').detail).toBe('Not signed in. In Command Prompt run: claude auth login');
    await expect(signedOut.require('codex')).rejects.toThrow('Codex isn’t signed in on this PC. In Command Prompt run: codex login. Nothing was started.');
    const old = await connections({ platform: 'win32', cli: { ...READY_CLI, missingFlags: ['--effort'] } }).status();
    expect(row(old, 'claude').detail).toBe('This version can’t run studio requests. In Command Prompt run: claude update');
    expect(JSON.stringify(status)).not.toMatch(/Terminal|this Mac|keychain/);
  });

  it('names the Windows sign-in, not a keychain, for saved keys', async () => {
    const status = await connections({ platform: 'win32', keys: { OPENAI_API_KEY: 'sk-test-openai' } }).status();
    expect(row(status, 'openai').detail).toBe('Key saved. Stored encrypted with your Windows sign-in on this PC and sent only to OpenAI.');
    expect(row(status, 'fal').detail).toBe('Add a fal.ai key to use it. Stored encrypted with your Windows sign-in on this PC and sent only to fal.ai.');
  });

  it('keeps the Mac and browser studio wording', async () => {
    const mac = await connections({ platform: 'darwin', codex: 'missing', keys: { OPENAI_API_KEY: 'sk-test-openai' } }).status();
    expect(row(mac, 'codex').detail).toBe('Codex isn’t installed on this Mac. Install it, then sign in.');
    expect(row(mac, 'openai').detail).toBe('Key saved. Stored encrypted in this Mac’s keychain and sent only to OpenAI.');
    expect(row(await connections({ platform: 'darwin' }).status(), 'codex').detail).toBe('Not signed in. In Terminal run: codex login');
    // A browser studio served from a Windows machine still talks about the server, not this PC.
    const web = await connections({ platform: 'win32', web: true, codex: 'missing', keys: { OPENAI_API_KEY: 'sk-test-openai' } }).status();
    expect(row(web, 'codex').detail).toBe('Codex isn’t installed on the studio server. Install it, then sign in.');
    expect(row(web, 'openai').detail).toBe('Key saved. Stored encrypted on the studio server and sent only to OpenAI.');
  });
});

describe('Claude route problems on Windows', () => {
  const spawnFor = ({ loggedIn = true, helpText = '' } = {}) => vi.fn(async (command, args) => {
    if (args[0] === '--version') return { stdout: '1.0.3 (Claude Code)\n' };
    if (args[0] === '--help') return { stdout: helpText };
    if (args[0] === 'auth') return { stdout: JSON.stringify({ loggedIn }) };
    throw new Error(`unexpected ${args.join(' ')}`);
  });
  const routes = (platform, spawn) => createAiRoutes({ spawn, getKey: () => '', getSettings: () => ({ aiProvider: 'claude' }), dataDir: () => '', createRunner: vi.fn(), platform });

  // Command Prompt, not PowerShell: PowerShell picks npm's codex.ps1 shim first, and a stock Windows PC's execution policy
  // refuses to run it ("running scripts is disabled on this system").
  it('tells Windows to use Command Prompt and the Mac to use Terminal', async () => {
    await expect(routes('win32', spawnFor()).requireRoute()).rejects.toThrow(/Run "claude update" in Command Prompt\./);
    await expect(routes('darwin', spawnFor()).requireRoute()).rejects.toThrow(/Run "claude update" in Terminal\./);
  });
});

describe('Connection diagnostics on Windows', () => {
  it('says the Apify token is encrypted with the Windows sign-in only when Settings says it is not a Mac', () => {
    const state = { keys: { APIFY_API_TOKEN: true } };
    expect(readinessItems(state, { mac: false })[0].detail).toBe('Saved (encrypted with your Windows sign-in)');
    expect(readinessItems(state, { mac: true })[0].detail).toBe('Saved in keychain');
    expect(readinessItems(state, {})[0].detail).toBe('Saved in keychain');
  });
});
