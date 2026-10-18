import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { createRequire } from 'node:module';

// How the real main process (src/main/index.js) starts and stops the AI CLIs, loaded as the desktop app runs it with a
// chosen platform. On Windows every CLI is resolved first (an npm shim is read, never run) and starts hidden with no
// shell; a CLI that isn't installed is reported without starting anything; Cancel ends the whole tree with taskkill and
// still reads as cancelled; Codex's checks get longer on Windows. On the Mac each CLI starts under its own name as before.
// Processes are fakes: nothing runs, nothing is paid for.
const mainPath = path.resolve('src/main/index.js');
const mainRequire = createRequire(mainPath);
const w = path.win32;
const cleanups = [];
afterEach(() => { for (const done of cleanups.splice(0)) done(); });

// A Windows machine with Codex and Claude Code installed with npm, as files the resolver can see (case-insensitive).
const NPM = 'C:\\Users\\t\\AppData\\Roaming\\npm';
const CODEX_PKG = w.join(NPM, 'node_modules', '@openai', 'codex');
const CODEX_EXE = w.join(CODEX_PKG, 'node_modules', '@openai', 'codex-win32-x64', 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe');
const CLAUDE_EXE = w.join(NPM, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
const HEAD = '@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n';
const NPM_INSTALL = {
  [w.join(NPM, 'codex.cmd')]: `${HEAD}\r\nIF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n) ELSE (\r\n  SET "_prog=node"\r\n  SET PATHEXT=%PATHEXT:;.JS;=;%\r\n)\r\n\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n`,
  [w.join(CODEX_PKG, 'bin', 'codex.js')]: '#!/usr/bin/env node',
  [CODEX_EXE]: '',
  [w.join(NPM, 'claude.cmd')]: `${HEAD}"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*\r\n`,
  [CLAUDE_EXE]: '',
};
const WINDOWS_ENV = { APPDATA: 'C:\\Users\\t\\AppData\\Roaming', Path: 'C:\\Windows\\System32', SystemRoot: 'C:\\Windows' };
function fakeFs(files) {
  const table = new Map(Object.entries(files).map(([file, text]) => [file.toLowerCase(), text]));
  const missing = () => Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' });
  return { statSync: (file) => { if (!table.has(file.toLowerCase())) throw missing(); return { isFile: () => true }; }, readFileSync: (file) => { if (!table.has(file.toLowerCase())) throw missing(); return table.get(file.toLowerCase()); } };
}

// `reply(command, args)` says how a fake CLI answers: { stdout, code } at once, or { hang: true } until it is stopped.
// Stopping one (kill, or taskkill on its PID) ends it as taskkill does: exit code 1 and no signal. `fast` timer lengths
// fire at once; every length is recorded.
function boot({ platform = 'darwin', env = {}, files = null, fast = [], reply = defaultReply } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'win-main-cli-'));
  const handlers = new Map(); const calls = []; const delays = [];
  function spawn(command, args = [], options = {}) {
    const child = new EventEmitter(); child.pid = 4100 + calls.length; child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.stdin = new Writable({ write(_chunk, _encoding, done) { done(); } });
    let closed = false; child.end = (code, signal = null) => { if (closed) return; closed = true; setImmediate(() => child.emit('close', code, signal)); };
    const answer = /taskkill\.exe$/i.test(command) ? { taskkill: true } : reply(command, args);
    child.kill = vi.fn(() => { if (!answer.ignoreKill) child.end(1, null); return true; });
    calls.push({ command, args, options, child });
    if (answer.taskkill) { calls.find((call) => String(call.child.pid) === args[1])?.child.end(1, null); child.end(0); return child; }
    if (answer.stdout) child.stdout.write(answer.stdout);
    if (!answer.hang) child.end(answer.code ?? 0);
    return child;
  }
  const studioHost = mainRequire('./studio-host'); const cliRunners = mainRequire('./cli-runners'); const probes = [];
  const app = Object.assign(new EventEmitter(), { getPath: () => root, whenReady: () => ({ then() {} }), getVersion: () => 'test' });
  const ctx = vm.createContext({
    require: (name) => {
      if (name === 'electron') return { app, ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) }, safeStorage: { isEncryptionAvailable: () => false }, dialog: { showMessageBoxSync: () => 1, showErrorBox: () => {} }, BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] } };
      if (name === 'electron-updater') return {};
      if (name === 'child_process') return { spawn };
      // The options the status-check probe is built with are recorded.
      if (name === './cli-runners') return { ...cliRunners, createCliProbe: (options) => { probes.push(options); return cliRunners.createCliProbe(options); } };
      // The Windows file system above, for the resolver only.
      if (name === './studio-host' && files) return { ...studioHost, resolveCli: (cli, options) => studioHost.resolveCli(cli, { ...options, fsImpl: fakeFs(files) }) };
      return mainRequire(name);
    },
    process: { pid: process.pid, platform, env, argv: [] },
    __dirname: path.dirname(mainPath), Buffer, URL, AbortController, queueMicrotask, setImmediate, setInterval, clearInterval, clearTimeout,
    setTimeout: (fn, ms, ...rest) => { delays.push(ms); return setTimeout(fn, fast.includes(ms) ? 1 : ms, ...rest); },
  });
  vm.runInContext(fs.readFileSync(mainPath, 'utf8'), ctx, { filename: mainPath });
  cleanups.push(() => { app.emit('before-quit', { preventDefault() {} }); app.emit('quit'); fs.rmSync(root, { recursive: true, force: true }); });
  const call = async (channel, payload) => handlers.get(channel)(null, payload);
  const inside = (expression) => vm.runInContext(expression, ctx);
  return { root, ctx, call, calls, delays, inside, probes };
}
function defaultReply(command, args) {
  if (args[0] === '--version') return { stdout: command === 'codex' ? 'codex-cli 0.156.0\n' : '2.1.296 (Claude Code)\n' };
  if (args.includes('--help')) return { stdout: 'Options:\n      --ephemeral\n      --ignore-user-config\n' };
  if (args[0] === 'login') return { stdout: 'Logged in using ChatGPT\n' };
  return { hang: true }; // a job runs until it is cancelled or answered
}
const answering = (command, args) => (args[0] === 'exec' && args.at(-1) === '-' ? { stdout: '{"type":"turn.completed"}\n' } : defaultReply(command, args));

describe('AI CLIs in the main process', () => {
  it('starts every CLI hidden and without a shell on the Mac, under its own name, with the Mac’s check times', async () => {
    const h = boot({ platform: 'darwin', reply: answering });
    expect(await h.call('check-codex')).toEqual({ ok: true, version: 'codex-cli 0.156.0' });
    await h.ctx.spawnCodex('codex', ['exec', '-'], h.root, { stdin: 'Question', providerLabel: 'Codex' });
    await h.ctx.spawnCodex('claude', ['--version'], h.root, { providerLabel: 'Claude' });
    expect(await h.ctx.codexSupport()).toMatchObject({ ephemeral: true });
    expect(await h.inside('cliProbe')('codex', ['login', 'status'])).toMatchObject({ code: 0, stdout: 'Logged in using ChatGPT\n' });
    expect(h.calls.map((entry) => [entry.command, entry.args])).toEqual([['codex', ['--version']], ['codex', ['exec', '-']], ['claude', ['--version']], ['codex', ['exec', '--help']], ['codex', ['login', 'status']]]);
    for (const entry of h.calls) {
      expect(entry.options).toMatchObject({ windowsHide: true, shell: false });
      expect(Object.keys(entry.options.env).filter((name) => name.startsWith('CODEX_MANAGED'))).toEqual([]);
    }
    expect(h.calls[2].options.env.DISABLE_PROMPT_CACHING).toBe('1'); // Claude Code's own setting, keyed on the name
    expect(h.calls[1].options.cwd).toBe(h.root);
    expect(h.delays).toContain(5000); expect(h.delays).not.toContain(15000);
    expect(h.probes).toHaveLength(1); expect(h.probes[0].timeoutMs).toBeUndefined(); // the probe's own 10 s on the Mac
  });

  it('reports a CLI missing from PATH on Windows without starting anything', async () => {
    const h = boot({ platform: 'win32', env: {} });
    const check = await h.call('check-codex');
    expect(check.ok).toBe(false); expect(check.error).toMatch(/ENOENT/);
    await expect(h.ctx.spawnCodex('codex', ['exec', '-'], h.root, { jobId: 'job-missing-1', providerLabel: 'Codex' })).rejects.toMatchObject({ code: 'ENOENT', message: 'spawn codex ENOENT' });
    await expect(h.ctx.spawnCodex('claude', ['--version'], h.root, { providerLabel: 'Claude' })).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await h.inside('cliProbe')('codex', ['--version'])).toMatchObject({ missing: true });
    expect(await h.ctx.codexSupport()).toMatchObject({ ephemeral: false });
    expect(h.inside('jobProcesses.has("job-missing-1")')).toBe(false);
    expect(h.calls).toEqual([]);
  });

  it('starts the program an npm shim names on Windows, hidden, with Codex’s launcher variables and one PATH', async () => {
    const h = boot({ platform: 'win32', env: WINDOWS_ENV, files: NPM_INSTALL, reply: answering });
    await h.ctx.spawnCodex('codex', ['exec', '-'], h.root, { stdin: 'Question', providerLabel: 'Codex' });
    await h.ctx.spawnCodex('claude', ['--version'], h.root, { providerLabel: 'Claude' });
    const [codex, claude] = h.calls;
    expect(codex).toMatchObject({ command: CODEX_EXE, args: ['exec', '-'], options: { cwd: h.root, windowsHide: true, shell: false } });
    expect(codex.options.env).toMatchObject({ CODEX_MANAGED_BY_NPM: '1', CODEX_MANAGED_PACKAGE_ROOT: CODEX_PKG });
    expect(claude).toMatchObject({ command: CLAUDE_EXE, args: ['--version'], options: { windowsHide: true, shell: false } });
    expect(claude.options.env.DISABLE_PROMPT_CACHING).toBe('1');
    for (const entry of h.calls) {
      expect(entry.command).not.toMatch(/\.cmd$/i);
      expect(Object.keys(entry.options.env).filter((name) => name.toUpperCase() === 'PATH')).toEqual(['PATH']);
      expect(entry.options.env.PATH.split(';')).toContain(NPM);
    }
  });

  it('reads a cancelled job as cancelled when the CLI exits with code 1 and no signal', async () => {
    const h = boot({ platform: 'darwin' });
    const job = h.ctx.spawnCodex('codex', ['exec', '-'], h.root, { jobId: 'job-cancel-1', providerLabel: 'Codex' });
    expect(await h.call('cancel-job', 'job-cancel-1')).toBe(true);
    await expect(job).rejects.toMatchObject({ message: 'Job cancelled.' });
    expect(h.calls[0].child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(h.inside('jobProcesses.size')).toBe(0);
  });

  it('cancels the whole process tree with taskkill on Windows', async () => {
    const h = boot({ platform: 'win32', env: WINDOWS_ENV, files: NPM_INSTALL });
    const job = h.ctx.spawnCodex('codex', ['exec', '-'], h.root, { jobId: 'job-cancel-2', providerLabel: 'Codex' });
    await h.call('cancel-job', 'job-cancel-2');
    await expect(job).rejects.toMatchObject({ message: 'Job cancelled.' });
    const [codex, taskkill] = h.calls;
    expect(taskkill).toMatchObject({ command: 'C:\\Windows\\System32\\taskkill.exe', args: ['/PID', String(codex.child.pid), '/T', '/F'], options: { windowsHide: true, stdio: 'ignore' } });
    expect(codex.child.kill).not.toHaveBeenCalled(); // taskkill ended it
  });

  it('reports a timeout once the CLI has exited, or after 3 seconds if it never does', async () => {
    const h = boot({ platform: 'darwin', fast: [2000] });
    const started = Date.now();
    await expect(h.ctx.spawnCodex('codex', ['exec', '-'], h.root, { jobId: 'job-slow-1', timeoutMs: 2000, providerLabel: 'Codex' })).rejects.toMatchObject({ message: 'Codex timed out after 2 seconds.' });
    expect(Date.now() - started).toBeLessThan(2500); // it exited when stopped, so the 3-second wait was cut short
    expect(h.calls[0].child.kill).toHaveBeenCalledWith('SIGTERM');
    const stubborn = boot({ platform: 'darwin', fast: [2000, 3000], reply: () => ({ hang: true, ignoreKill: true }) });
    await expect(stubborn.ctx.spawnCodex('codex', ['exec', '-'], stubborn.root, { jobId: 'job-slow-2', timeoutMs: 2000, providerLabel: 'Codex' })).rejects.toMatchObject({ message: 'Codex timed out after 2 seconds.' });
    expect(stubborn.delays).toContain(3000);
    expect(stubborn.inside('jobProcesses.size')).toBe(0);
  });

  it('gives Codex’s checks 15 seconds on Windows and never keeps a flag list cut off by the time limit', async () => {
    let helpCalls = 0;
    const reply = (command, args) => {
      if (args[0] === '--version') return { hang: true };
      if (args.includes('--help')) { helpCalls += 1; return helpCalls === 1 ? { stdout: 'Options:\n      --ephemeral\n', hang: true } : defaultReply(command, args); }
      return defaultReply(command, args);
    };
    const h = boot({ platform: 'win32', env: WINDOWS_ENV, files: NPM_INSTALL, fast: [15000], reply });
    expect(await h.call('check-codex')).toEqual({ ok: false, error: 'Codex check timed out.' });
    expect(await h.ctx.codexSupport()).toMatchObject({ ephemeral: false, ignoreUserConfig: false });
    expect(h.delays.filter((ms) => ms === 15000)).toHaveLength(2); expect(h.delays).not.toContain(5000);
    expect(h.probes[0].timeoutMs).toBe(15000); // Settings → AI connections' version and sign-in checks too
    // Each check that ran out of time was stopped with taskkill.
    const checks = h.calls.filter((entry) => !/taskkill\.exe$/.test(entry.command));
    expect(checks.map((entry) => entry.args)).toEqual([['--version'], ['exec', '--help']]);
    expect(h.calls.filter((entry) => /taskkill\.exe$/.test(entry.command)).map((entry) => entry.args[1])).toEqual(checks.map((entry) => String(entry.child.pid)));
    // The next Codex job reads --help again rather than trusting the partial one.
    expect(await h.ctx.codexSupport()).toMatchObject({ ephemeral: true, ignoreUserConfig: true });
    expect(helpCalls).toBe(2);
  });
});
