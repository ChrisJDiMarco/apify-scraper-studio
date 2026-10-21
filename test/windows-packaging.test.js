import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { canSymlink } from './helpers/can-symlink.js';

// The Windows build's packaging, checked on any OS: the npm scripts, the installer's file name, the notarize hook that
// electron-builder also runs for Windows, the installer's "app is running" check, line endings, and the prompt goldens
// script started through a link (a junction or subst drive on Windows behaves the same way).
const root = fileURLToPath(new URL('..', import.meta.url));
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const pkg = JSON.parse(read('package.json'));
const require = createRequire(import.meta.url);
const temporary = [];
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); for (const dir of temporary.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

describe('npm scripts and electron-builder settings', () => {
  it('builds an x64 installer on any host and never publishes', () => {
    const script = pkg.scripts['dist:win'];
    expect(script).toContain('--win');
    expect(script).toContain('--x64'); // without it electron-builder builds for the host's arch: arm64 on Apple silicon
    expect(script).toContain('--publish never'); // on CI electron-builder would otherwise publish to the GitHub repo
    expect(script).not.toMatch(/\bnsis\b/); // a bare target type also falls back to the host's arch
    expect(pkg.build.win.target).toEqual([{ target: 'nsis', arch: ['x64'] }]);
    expect(pkg.scripts['dist:mac']).toBe('npm run icons:mac && npm run build && electron-builder --mac --universal');
  });

  it('names the installer without a space, so latest.yml points at the uploaded file', () => {
    const name = pkg.build.win.artifactName;
    expect(name).not.toMatch(/\s/);
    expect(name).toBe('Golden-Thread-${version}-Windows-${arch}.${ext}');
    const built = name.replace('${version}', pkg.version).replace('${arch}', 'x64').replace('${ext}', 'exe');
    expect(read('.github/workflows/ci.yml')).toContain('dist/*-Windows-x64.exe'); // what CI installs and uploads
    expect(built).toMatch(/-Windows-x64\.exe$/);
  });

  it('downloads Electron before npm run dev, since Electron 42 has no install script', () => {
    expect(pkg.scripts.predev).toBe('install-electron');
    expect(JSON.parse(read('node_modules/electron/package.json')).bin['install-electron']).toBe('install.js');
  });
});

describe('the notarize hook', () => {
  const hookPath = path.join(root, 'scripts', 'notarize-if-configured.cjs');
  const notarizeLoaded = () => Object.keys(require.cache).some((file) => file.includes(`${path.sep}@electron${path.sep}notarize${path.sep}`));

  it('skips a Windows build even with the Apple variables set, before looking at them', async () => {
    vi.stubEnv('APPLE_ID', 'alex@example.com'); vi.stubEnv('APPLE_APP_SPECIFIC_PASSWORD', 'fixture-password'); vi.stubEnv('APPLE_TEAM_ID', 'FIXTURE123');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const loadedBefore = notarizeLoaded();
    // No packager in the context: going any further than the platform check would throw.
    await expect(require(hookPath).default({ electronPlatformName: 'win32' })).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith('Skipping notarization: not a macOS build.');
    if (!loadedBefore) expect(notarizeLoaded()).toBe(false);
  });

  it('still reaches the Apple checks for a macOS build', async () => {
    vi.stubEnv('APPLE_ID', ''); vi.stubEnv('APPLE_APP_SPECIFIC_PASSWORD', ''); vi.stubEnv('APPLE_TEAM_ID', '');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    for (const electronPlatformName of ['darwin', 'mas']) await expect(require(hookPath).default({ electronPlatformName })).resolves.toBeUndefined();
    expect(log.mock.calls.map(([line]) => line)).toEqual(Array(2).fill('Skipping notarization: APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, and APPLE_TEAM_ID are required.'));
  });
});

describe('the Windows installer', () => {
  const custom = read('resources/installer.nsh');

  it('waits for the person to quit a running app instead of killing it', () => {
    expect(custom).toContain('!macro customCheckAppRunning');
    expect(custom).toContain('${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0');
    expect(custom).toMatch(/MessageBox MB_RETRYCANCEL\|MB_ICONEXCLAMATION "\$\{PRODUCT_NAME\} is open\. Close its window \(it asks first if a run is still going\), then click Retry\."/);
    expect(custom).toContain('/SD IDCANCEL'); // a silent install gives up rather than waiting forever
    const code = custom.split('\n').filter((line) => !line.trim().startsWith(';')).join('\n');
    expect(code).not.toMatch(/KillProcess|taskkill|Stop-Process/i);
    expect(custom).toMatch(/!macroend\s*$/);
  });

  // electron-builder includes resources/installer.nsh by name and uses the macro only if its template still asks for
  // it; an electron-builder upgrade that renamed the hook would silently bring back the taskkill.
  it('is picked up by the electron-builder templates this project builds with', () => {
    expect(pkg.build.directories.buildResources).toBe('resources');
    const templates = path.join(root, 'node_modules', 'app-builder-lib', 'templates', 'nsis', 'include');
    const guard = fs.readFileSync(path.join(templates, 'allowOnlyOneInstallerInstance.nsh'), 'utf8');
    expect(guard).toContain('!ifmacrodef customCheckAppRunning');
    expect(guard).toContain('!include "nsProcess.nsh"');
    expect(fs.readFileSync(path.join(templates, 'nsProcess.nsh'), 'utf8')).toContain('!macro nsProcess::FindProcess _FILE _ERR');
  });
});

describe('line endings', () => {
  it('keeps every text file LF on every OS, and archived evidence byte-exact', () => {
    const lines = read('.gitattributes').split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
    expect(lines).toEqual(['* text=auto eol=lf', '*.sh text eol=lf', '*.png binary', '*.jpg binary', '*.icns binary', '*.ico binary', '*.pdf binary', '*.zip binary', '*.gz binary', 'docs/archive/** -text']);
  });
});

describe('the prompt goldens script', () => {
  it.runIf(canSymlink)('still checks when started through a link to it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goldens-link-')); temporary.push(dir);
    const link = path.join(dir, 'prompt-goldens.mjs');
    fs.symlinkSync(path.join(root, 'scripts', 'prompt-goldens.mjs'), link);
    const run = spawnSync(process.execPath, [link, '--check', '--only', 'research.'], { encoding: 'utf8', timeout: 60000 });
    expect(run.stderr).toBe('');
    expect(run.stdout).toMatch(/^prompt goldens: \d+ cases, 0 differences\.$/m); // before: nothing ran and it exited 0
    expect(run.status).toBe(0);
  });
});
