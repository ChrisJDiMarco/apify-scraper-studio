import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import host from '../src/main/studio-host.js';
import runners from '../src/main/cli-runners.js';

const { killProcessTree, studioCliEnv } = host;
const { removeQuietly, createCodexRunner } = runners;

// How the studio stops and cleans up after an AI CLI, on Windows and on the Mac. Windows lets what a CLI started outlive
// it and refuses to remove a folder that a process or a virus scan still holds, so Cancel ends the whole process tree
// and a temp folder that can't go yet never turns a finished answer into an error.
const fakeChild = (extra = {}) => Object.assign(new EventEmitter(), { pid: 1234, exitCode: null, signalCode: null, kill: vi.fn(() => true) }, extra);
function fakeSpawn({ code = 0, error = null } = {}) {
  const calls = [];
  const spawnImpl = vi.fn((command, args, options) => {
    const child = new EventEmitter(); calls.push({ command, args, options, child });
    queueMicrotask(() => (error ? child.emit('error', error) : child.emit('close', code, null)));
    return child;
  });
  return { spawnImpl, calls };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
afterEach(() => vi.restoreAllMocks());

describe('stopping a CLI and everything it started', () => {
  it('runs taskkill on the whole tree on Windows, hidden, before touching the CLI itself', async () => {
    const child = fakeChild(); const { spawnImpl, calls } = fakeSpawn();
    killProcessTree(child, { platform: 'win32', spawnImpl, systemRoot: 'C:\\Windows' });
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe('C:\\Windows\\System32\\taskkill.exe');
    expect(calls[0].args).toEqual(['/PID', '1234', '/T', '/F']);
    expect(calls[0].options).toEqual({ windowsHide: true, stdio: 'ignore' });
    await tick();
    expect(child.kill).not.toHaveBeenCalled(); // taskkill succeeded
  });

  it('finds taskkill under the system folder, C:\\Windows when it isn’t set', () => {
    const { spawnImpl, calls } = fakeSpawn();
    killProcessTree(fakeChild(), { platform: 'win32', spawnImpl, systemRoot: 'D:\\WINNT' });
    killProcessTree(fakeChild(), { platform: 'win32', spawnImpl, systemRoot: '' });
    expect(calls.map((call) => call.command)).toEqual(['D:\\WINNT\\System32\\taskkill.exe', 'C:\\Windows\\System32\\taskkill.exe']);
  });

  it('still ends the CLI itself when taskkill can’t start or fails', async () => {
    const missing = fakeChild(); killProcessTree(missing, { platform: 'win32', spawnImpl: fakeSpawn({ error: Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }) }).spawnImpl });
    const refused = fakeChild(); killProcessTree(refused, { platform: 'win32', spawnImpl: fakeSpawn({ code: 1 }).spawnImpl });
    const thrown = fakeChild(); killProcessTree(thrown, { platform: 'win32', spawnImpl: () => { throw new Error('EPERM'); } });
    const noPid = fakeChild({ pid: undefined }); const unused = fakeSpawn(); killProcessTree(noPid, { platform: 'win32', spawnImpl: unused.spawnImpl });
    await tick();
    for (const child of [missing, refused, thrown, noPid]) expect(child.kill).toHaveBeenCalledTimes(1);
    expect(unused.calls).toEqual([]);
  });

  it('sends SIGTERM on the Mac and Linux, as before', () => {
    for (const platform of ['darwin', 'linux']) {
      const child = fakeChild(); const { spawnImpl } = fakeSpawn();
      killProcessTree(child, { platform, spawnImpl });
      expect(child.kill).toHaveBeenCalledWith('SIGTERM'); expect(spawnImpl).not.toHaveBeenCalled();
    }
  });

  it('does nothing for a CLI that has already exited', () => {
    for (const platform of ['win32', 'darwin']) {
      for (const ended of [{ exitCode: 0 }, { exitCode: 1 }, { signalCode: 'SIGTERM' }]) {
        const child = fakeChild(ended); const { spawnImpl } = fakeSpawn();
        killProcessTree(child, { platform, spawnImpl });
        expect(child.kill).not.toHaveBeenCalled(); expect(spawnImpl).not.toHaveBeenCalled();
      }
    }
    expect(() => killProcessTree(null, { platform: 'win32' })).not.toThrow();
  });
});

describe('removing a CLI’s temporary folder', () => {
  it('removes it at once when it can, without the background retry', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'win-process-')); fs.writeFileSync(path.join(dir, 'answer.json'), '{}');
    const rm = vi.spyOn(fs.promises, 'rm');
    removeQuietly(dir);
    expect(fs.existsSync(dir)).toBe(false); expect(rm).not.toHaveBeenCalled();
  });

  it('never throws when Windows still holds it, and retries in the background', async () => {
    const busy = Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' });
    const fsImpl = { rmSync: vi.fn(() => { throw busy; }), promises: { rm: vi.fn(async () => {}) } };
    expect(() => removeQuietly('C:\\Users\\t\\AppData\\Local\\Temp\\studio-codex-1', { fsImpl })).not.toThrow();
    expect(fsImpl.promises.rm).toHaveBeenCalledWith('C:\\Users\\t\\AppData\\Local\\Temp\\studio-codex-1', expect.objectContaining({ recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
    // A folder that still can't be removed is only noted.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const stuck = { rmSync: () => { throw busy; }, promises: { rm: async () => { throw busy; } } };
    expect(() => removeQuietly('C:\\Temp\\studio-codex-2', { fsImpl: stuck })).not.toThrow();
    await tick();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('EBUSY'));
    expect(() => removeQuietly('C:\\Temp\\studio-codex-3', { fsImpl: { rmSync: () => { throw busy; } } })).not.toThrow();
  });

  it('keeps Codex’s answer when its folder can’t be removed', async () => {
    let folder = '';
    const spawnCli = async (command, args, cwd) => { folder = cwd; fs.writeFileSync(args[args.indexOf('--output-last-message') + 1], JSON.stringify({ answer: 'From Codex' })); return { stdout: '', stderr: '' }; };
    const remove = vi.fn(() => { throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' }); });
    const runner = createCodexRunner({ spawnCli, writeJson: () => {}, remove });
    const out = await runner.run({ schema: { type: 'object', properties: { answer: { type: 'string' } } }, prompt: 'Question' });
    expect(out.output).toEqual({ answer: 'From Codex' });
    expect(remove).toHaveBeenCalledWith(folder);
    fs.rmSync(folder, { recursive: true, force: true });
  });

  it('keeps Codex’s own error too', async () => {
    let folder = '';
    const spawnCli = async (command, args, cwd) => { folder = cwd; throw new Error('Codex timed out after 180 seconds.'); };
    const runner = createCodexRunner({ spawnCli, writeJson: () => {}, remove: () => { throw new Error('EBUSY'); } });
    await expect(runner.run({ schema: { type: 'object' }, prompt: 'Question' })).rejects.toThrow('Codex timed out after 180 seconds.');
    fs.rmSync(folder, { recursive: true, force: true });
  });
});

describe('the AI CLI environment on Windows', () => {
  const SECRETS = { anthropic_api_key: 'sk-ant-fixture', Studio_Password: 'fixture-admin-password', OpenAI_Api_Key: 'sk-fixture', google_docs_access_token: 'ya29.fixture' };
  it('drops secrets whatever their case and keeps one PATH, the usual install folders first', () => {
    const env = studioCliEnv({ platform: 'win32', env: { Path: 'C:\\x', APPDATA: 'C:\\Users\\t\\AppData\\Roaming', SystemRoot: 'C:\\Windows', ...SECRETS } });
    for (const name of Object.keys(SECRETS)) expect(env, name).not.toHaveProperty(name);
    expect(JSON.stringify(env)).not.toMatch(/fixture/);
    expect(Object.keys(env).filter((name) => name.toUpperCase() === 'PATH')).toEqual(['PATH']);
    expect(env.PATH.split(';')).toEqual([path.win32.join(os.homedir(), '.local', 'bin'), 'C:\\Users\\t\\AppData\\Roaming\\npm', 'C:\\x']);
    expect(env).toMatchObject({ APPDATA: 'C:\\Users\\t\\AppData\\Roaming', SystemRoot: 'C:\\Windows' });
  });

  it('keeps the Mac’s search folders and PATH as they were', () => {
    const env = studioCliEnv({ platform: 'darwin', env: { PATH: ['/usr/bin', '/bin'].join(path.delimiter), HOME: '/Users/alex', STUDIO_SECRET_KEY: 'fixture', OPENAI_API_KEY: 'sk-fixture' } });
    expect(env).not.toHaveProperty('STUDIO_SECRET_KEY'); expect(env).not.toHaveProperty('OPENAI_API_KEY');
    expect(env.PATH.split(path.delimiter).slice(-6)).toEqual([path.join(os.homedir(), '.local', 'bin'), path.join(os.homedir(), '.claude', 'local'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin']);
    expect(env.HOME).toBe('/Users/alex');
  });
});
