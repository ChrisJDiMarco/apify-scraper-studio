import { describe, expect, it } from 'vitest';
import path from 'node:path';
import host from '../src/main/studio-host.js';

const { resolveCli } = host;
const w = path.win32;

// On Windows the studio starts Claude Code and Codex without a shell, so `claude` and `codex` are resolved the way cmd.exe
// would find them, without running cmd.exe or the npm .cmd shim (Node 24 refuses to start a .cmd without a shell). These
// run on any OS: the file system is a fake keyed by Windows paths (case-insensitive, as on Windows), and the shims are
// the texts npm's cmd-shim writes.
function fakeFs(files) {
  const table = new Map(Object.entries(files).map(([file, text]) => [file.toLowerCase(), text]));
  const missing = (file) => Object.assign(new Error(`ENOENT: no such file or directory, stat '${file}'`), { code: 'ENOENT' });
  return {
    statSync(file) { if (!table.has(file.toLowerCase())) throw missing(file); return { isFile: () => true }; },
    readFileSync(file) { if (!table.has(file.toLowerCase())) throw missing(file); return table.get(file.toLowerCase()); },
  };
}
// npm cmd-shim's two shapes. A package bin with a node shebang (Codex's bin/codex.js) gets the node form; a bin with no
// shebang (Claude Code 2.x's native bin/claude.exe) is started directly.
const HEAD = ['@ECHO off', 'GOTO start', ':find_dp0', 'SET dp0=%~dp0', 'EXIT /b', ':start', 'SETLOCAL', 'CALL :find_dp0'];
const nodeShim = (target) => [...HEAD, '', 'IF EXIST "%dp0%\\node.exe" (', '  SET "_prog=%dp0%\\node.exe"', ') ELSE (', '  SET "_prog=node"', '  SET PATHEXT=%PATHEXT:;.JS;=;%', ')', '', `endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\${target}" %*`, ''].join('\r\n');
const exeShim = (target) => [...HEAD, `"%dp0%\\${target}"   %*`, ''].join('\r\n');
// pnpm writes its own shape, with %~dp0 and the script named twice.
const pnpmShim = (target) => ['@SETLOCAL', '@IF EXIST "%~dp0\\node.exe" (', `  "%~dp0\\node.exe"  "%~dp0\\${target}" %*`, ') ELSE (', '  @SET PATHEXT=%PATHEXT:;.JS;=;%', `  node  "%~dp0\\${target}" %*`, ')', ''].join('\r\n');

const HOME = 'C:\\Users\\t';
const LOCAL_BIN = w.join(HOME, '.local', 'bin');
const NPM = w.join(HOME, 'AppData', 'Roaming', 'npm');
const CLAUDE_TARGET = 'node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe';
const CODEX_TARGET = 'node_modules\\@openai\\codex\\bin\\codex.js';
const CODEX_PKG = w.join(NPM, 'node_modules', '@openai', 'codex');
const NESTED_CODEX_EXE = w.join(CODEX_PKG, 'node_modules', '@openai', 'codex-win32-x64', 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe');
const win = (files, env) => ({ platform: 'win32', env, fsImpl: fakeFs(files) });

describe('finding an AI CLI on Windows without a shell', () => {
  it('starts the native Claude Code installer’s claude.exe directly', () => {
    const found = resolveCli('claude', win({ [w.join(LOCAL_BIN, 'claude.exe')]: '' }, { PATH: `${LOCAL_BIN};C:\\Windows\\System32` }));
    expect(found).toEqual({ command: w.join(LOCAL_BIN, 'claude.exe'), prefixArgs: [], env: {} });
  });

  it('reads Claude Code’s npm shim for the claude.exe it starts', () => {
    const files = { [w.join(NPM, 'claude.cmd')]: exeShim(CLAUDE_TARGET), [w.join(NPM, CLAUDE_TARGET)]: '' };
    const found = resolveCli('claude', win(files, { PATH: NPM }));
    expect(found).toEqual({ command: w.join(NPM, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'), prefixArgs: [], env: {} });
    expect(found.command).not.toMatch(/\.cmd$/i);
  });

  it('starts Codex’s own codex.exe from its platform package, with the two variables its launcher sets', () => {
    const files = { [w.join(NPM, 'codex.cmd')]: nodeShim(CODEX_TARGET), [w.join(NPM, CODEX_TARGET)]: '#!/usr/bin/env node', [NESTED_CODEX_EXE]: '' };
    const found = resolveCli('codex', win(files, { PATH: NPM }));
    expect(found).toEqual({ command: NESTED_CODEX_EXE, prefixArgs: [], env: { CODEX_MANAGED_BY_NPM: '1', CODEX_MANAGED_PACKAGE_ROOT: CODEX_PKG } });
  });

  it('finds a hoisted Codex platform package and the arm64 one too', () => {
    const hoisted = w.join(NPM, 'node_modules', '@openai', 'codex-win32-x64', 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe');
    const files = { [w.join(NPM, 'codex.cmd')]: nodeShim(CODEX_TARGET), [w.join(NPM, CODEX_TARGET)]: '', [hoisted]: '' };
    expect(resolveCli('codex', win(files, { PATH: NPM })).command).toBe(hoisted);
    const arm = w.join(CODEX_PKG, 'node_modules', '@openai', 'codex-win32-arm64', 'vendor', 'aarch64-pc-windows-msvc', 'bin', 'codex.exe');
    const armFiles = { [w.join(NPM, 'codex.cmd')]: nodeShim(CODEX_TARGET), [w.join(NPM, CODEX_TARGET)]: '', [arm]: '' };
    expect(resolveCli('codex', win(armFiles, { PATH: NPM })).command).toBe(arm);
  });

  it('runs codex.js on the node.exe beside the shim when no platform package is installed', () => {
    const files = { [w.join(NPM, 'codex.cmd')]: nodeShim(CODEX_TARGET), [w.join(NPM, CODEX_TARGET)]: '', [w.join(NPM, 'node.exe')]: '' };
    const found = resolveCli('codex', win(files, { PATH: NPM }));
    expect(found).toEqual({ command: w.join(NPM, 'node.exe'), prefixArgs: [w.join(NPM, CODEX_TARGET)], env: {} });
  });

  it('otherwise runs a node script on the first node.exe on PATH, then Node.js in Program Files', () => {
    const nodeDir = 'C:\\Program Files\\nodejs';
    const tool = 'node_modules\\some-cli\\cli.js';
    const files = { [w.join(NPM, 'some-cli.cmd')]: nodeShim(tool), [w.join(NPM, tool)]: '', [w.join(nodeDir, 'node.exe')]: '' };
    expect(resolveCli('some-cli', win(files, { PATH: `${NPM};${nodeDir}` }))).toEqual({ command: w.join(nodeDir, 'node.exe'), prefixArgs: [w.join(NPM, tool)], env: {} });
    expect(resolveCli('some-cli', win(files, { PATH: NPM })).command).toBe(w.join(nodeDir, 'node.exe'));
    const elsewhere = { [w.join(NPM, 'some-cli.cmd')]: nodeShim(tool), [w.join(NPM, tool)]: '', 'D:\\Apps\\nodejs\\node.exe': '' };
    expect(resolveCli('some-cli', win(elsewhere, { PATH: NPM, ProgramFiles: 'D:\\Apps' })).command).toBe('D:\\Apps\\nodejs\\node.exe');
    expect(resolveCli('some-cli', win(elsewhere, { PATH: NPM }))).toBeNull(); // no Node.js anywhere: not installed
  });

  it('reads pnpm’s shim too, taking the script it names last', () => {
    const target = '..\\pnpm-global\\5\\node_modules\\@openai\\codex\\bin\\codex.js';
    const pnpmHome = w.join(HOME, 'AppData', 'Local', 'pnpm');
    const pkg = w.resolve(pnpmHome, '..\\pnpm-global\\5\\node_modules\\@openai\\codex');
    const exe = w.join(pkg, 'node_modules', '@openai', 'codex-win32-x64', 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe');
    const files = { [w.join(pnpmHome, 'codex.cmd')]: pnpmShim(target), [w.resolve(pnpmHome, target)]: '', [exe]: '' };
    expect(resolveCli('codex', win(files, { PATH: pnpmHome }))).toMatchObject({ command: exe, env: { CODEX_MANAGED_PACKAGE_ROOT: pkg } });
  });

  it('returns null when the CLI is nowhere on PATH, or its shim points at nothing', () => {
    expect(resolveCli('codex', win({}, { PATH: `${NPM};C:\\Windows\\System32` }))).toBeNull();
    expect(resolveCli('codex', win({}, {}))).toBeNull();
    expect(resolveCli('claude', win({ [w.join(NPM, 'claude.cmd')]: exeShim(CLAUDE_TARGET) }, { PATH: NPM }))).toBeNull(); // claude.exe was removed
    expect(resolveCli('claude', win({ [w.join(NPM, 'claude.cmd')]: '@ECHO off\r\nclaude-old %*\r\n' }, { PATH: NPM }))).toBeNull();
  });

  it('leaves the name alone on the Mac and Linux', () => {
    const files = { [w.join(LOCAL_BIN, 'claude.exe')]: '' };
    for (const platform of ['darwin', 'linux']) expect(resolveCli('claude', { platform, env: { PATH: LOCAL_BIN }, fsImpl: fakeFs(files) })).toEqual({ command: 'claude', prefixArgs: [], env: {} });
  });

  it('reads a Path variable in any case, with quoted folders and empty entries', () => {
    const quoted = 'C:\\Program Files\\Claude Tools';
    const files = { [w.join(quoted, 'claude.exe')]: '' };
    const found = resolveCli('claude', win(files, { Path: ';;C:\\Windows\\System32; ;"C:\\Program Files\\Claude Tools" ;' }));
    expect(found?.command).toBe(w.join(quoted, 'claude.exe'));
    expect(resolveCli('claude', win(files, { path: `"${quoted}"` }))?.command).toBe(w.join(quoted, 'claude.exe'));
  });

  // A relative PATH folder would be checked against the app's working folder but started from the spawn's (a run
  // folder), where a bare or relative name is looked up first: what was checked and what runs could differ.
  it('skips relative PATH folders and uses only drive or network paths', () => {
    const real = 'C:\\x';
    const files = { 'codex.exe': '', 'tools\\codex.exe': '', '\\tools\\codex.exe': '', [w.join(real, 'codex.exe')]: '' };
    expect(resolveCli('codex', win(files, { Path: '.;tools;\\tools;C:\\x' }))).toEqual({ command: w.join(real, 'codex.exe'), prefixArgs: [], env: {} });
    expect(resolveCli('codex', win(files, { Path: '.;tools' }))).toBeNull();
    const share = '\\\\server\\tools';
    expect(resolveCli('codex', win({ [w.join(share, 'codex.exe')]: '' }, { Path: share })).command).toBe(w.join(share, 'codex.exe'));
    // Node.js beside a script shim is looked for in the same folders, so a relative one is skipped there too.
    const script = { [w.join(NPM, 'some-cli.cmd')]: nodeShim('node_modules\\some-cli\\cli.js'), [w.join(NPM, 'node_modules\\some-cli\\cli.js')]: '', 'node.exe': '', 'C:\\Program Files\\nodejs\\node.exe': '' };
    expect(resolveCli('some-cli', win(script, { PATH: `${NPM};.` })).command).toBe('C:\\Program Files\\nodejs\\node.exe');
  });

  it('takes the first PATH folder that has the CLI, whatever its kind, as cmd.exe would', () => {
    const files = { [w.join(LOCAL_BIN, 'claude.exe')]: '', [w.join(NPM, 'claude.cmd')]: exeShim(CLAUDE_TARGET), [w.join(NPM, CLAUDE_TARGET)]: '' };
    expect(resolveCli('claude', win(files, { PATH: `${LOCAL_BIN};${NPM}` })).command).toBe(w.join(LOCAL_BIN, 'claude.exe'));
    expect(resolveCli('claude', win(files, { PATH: `${NPM};${LOCAL_BIN}` })).command).toBe(w.join(NPM, CLAUDE_TARGET));
    // Within one folder a program comes before its shim; .com is a program too.
    const both = { [w.join(NPM, 'claude.com')]: '', [w.join(NPM, 'claude.cmd')]: exeShim(CLAUDE_TARGET), [w.join(NPM, CLAUDE_TARGET)]: '' };
    expect(resolveCli('claude', win(both, { PATH: NPM })).command).toBe(w.join(NPM, 'claude.com'));
  });
});
