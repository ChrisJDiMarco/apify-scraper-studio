import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
const mainPath = path.resolve('src/main/index.js');
const mainRequire = createRequire(mainPath);
const roots = [];
const fixtureApps = [];
afterEach(() => { for (const app of fixtureApps.splice(0)) { app.emit('before-quit'); app.emit('quit'); } for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function harness({ packaged = true, customPath = false, hasLock = true, configured = false, savedKey = false, disabled = false, invalidFile = false, brokenKeychain = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-package-fixture-')); roots.push(root);
  const appData = path.join(root, 'Application Support'); const legacy = path.join(appData, 'apify-scraper-studio');
  const injected = path.join(root, 'injected-profile'); const expectedData = customPath ? injected : packaged ? legacy : path.join(appData, 'Apify Scraper Studio');
  fs.mkdirSync(expectedData, { recursive: true });
  const appPath = path.join(root, 'installed-app'); fs.mkdirSync(appPath); fs.writeFileSync(path.join(appPath, '.env.local'), 'OPENAI_API_KEY=fixture-discovery-only');
  const externalFile = path.join(root, 'approved.env'); fs.writeFileSync(externalFile, invalidFile ? 'OPENAI_API_KEY="fixture bad value"' : 'OPENAI_API_KEY=fixture-explicit-value\nOTHER_VARIABLE=fixture-unrelated');
  const config = { keys: savedKey ? { OPENAI_API_KEY: { encrypted: true, value: Buffer.from('fixture-saved-override').toString('base64') } } : {}, ...(configured ? { imageCredentialFile: externalFile } : {}), ...(disabled ? { disabledKeys: { OPENAI_API_KEY: true } } : {}) };
  fs.writeFileSync(path.join(expectedData, 'config.json'), JSON.stringify(config));
  let appName = 'Apify Scraper Studio'; let userData = customPath ? injected : path.join(appData, appName); let imageKey;
  const handlers = new Map(); const exited = new Error('fixture-app-exited');
  const app = Object.assign(new EventEmitter(), { isPackaged: packaged, getName: () => appName, setName: vi.fn(name => { appName = name; }), getPath: name => name === 'appData' ? appData : userData, setPath: vi.fn((name, target) => { if (name === 'userData') userData = target; }), getAppPath: () => appPath, getVersion: () => 'fixture', requestSingleInstanceLock: vi.fn(() => hasLock), exit: vi.fn(() => { throw exited; }), whenReady: () => ({ then() {} }) });
  const events = { has: name => app.listenerCount(name) > 0 };
  fixtureApps.push(app);
  const env = {}; let exitError;
  try { vm.runInNewContext(fs.readFileSync(mainPath, 'utf8'), {
    require(name) {
      if (name === 'electron') return { app, ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, safeStorage: { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: value => { if (brokenKeychain) throw new Error('Fixture Keychain is unavailable'); return value.toString(); } } };
      if (name === 'electron-updater') return {};
      if (name === './image-provider') return { createImageProvider: ({ getApiKey }) => { imageKey = getApiKey; return { generateImage: () => { throw new Error('Paid requests forbidden'); }, checkAccess: () => ({ configured: Boolean(getApiKey()) }) }; } };
      if (name === 'child_process') return { spawn: () => { throw new Error('CLI requests forbidden'); } };
      return mainRequire(name);
    },
    process: { pid: process.pid, platform: 'darwin', env, argv: [] }, __dirname: path.dirname(mainPath), Buffer, URL, setTimeout, clearTimeout,
    fetch: () => { throw new Error('Network requests forbidden'); },
  }, { filename: mainPath }); } catch (error) { if (error !== exited) throw error; exitError = error; }
  return { root, app, env, userData, expectedData, imageKey, events, handlers, exitError, invoke: (name, payload) => handlers.get(name)(null, payload), config: () => JSON.parse(fs.readFileSync(path.join(expectedData, 'config.json'), 'utf8')) };
}
describe('installed app continuity', () => {
  it('pins the internal Keychain identity and legacy data directory before constructing services', () => {
    const h = harness(); expect(h.app.setName).toHaveBeenCalledWith('apify-scraper-studio'); expect(h.userData).toBe(h.expectedData);
    expect(h.invoke('app-meta').dataRoot).toBe(h.expectedData); expect(h.app.requestSingleInstanceLock).toHaveBeenCalledOnce(); expect(h.events.has('second-instance')).toBe(true);
    expect(fs.existsSync(path.join(h.expectedData, 'content-studio', 'datasets'))).toBe(true);
    const ownerLock = path.join(h.expectedData, 'content-studio', '.studio-owner.json');
    expect(fs.existsSync(ownerLock)).toBe(true); h.app.emit('quit'); expect(fs.existsSync(ownerLock)).toBe(false);
  });
  it('preserves an injected profile path for packaged fixture runs', () => { const h = harness({ customPath: true }); expect(h.userData).toBe(h.expectedData); expect(h.app.setPath).not.toHaveBeenCalled(); });
  it('leaves nonpackaged identity and profile overrides unchanged', () => { const h = harness({ packaged: false, customPath: true }); expect(h.userData).toBe(h.expectedData); expect(h.app.setName).not.toHaveBeenCalled(); expect(h.app.requestSingleInstanceLock).not.toHaveBeenCalled(); });
  it('exits a second installed process before registering handlers or constructing data services', () => { const h = harness({ hasLock: false }); expect(h.exitError).toBeTruthy(); expect(h.app.exit).toHaveBeenCalledWith(0); expect(h.handlers.size).toBe(0); expect(fs.existsSync(path.join(h.expectedData, 'content-studio'))).toBe(false); });
  it('never discovers an app-directory key automatically in packaged mode', () => { const h = harness(); expect(h.imageKey()).toBe(''); expect(h.invoke('state').keys.OPENAI_API_KEY).toBe(false); });
  it('uses only the configured external file, without copying it into the user data or environment', () => {
    const h = harness({ configured: true }); expect(h.imageKey()).toBe('fixture-explicit-value'); expect(h.env).toEqual({});
    expect(h.config().keys.OPENAI_API_KEY).toBeUndefined(); expect(h.invoke('state').keys.OPENAI_API_KEY).toBe(true);
    expect(JSON.stringify(h.invoke('state'))).not.toContain('fixture-explicit-value'); expect(JSON.stringify(h.invoke('state'))).not.toContain(h.config().imageCredentialFile);
  });
  it('prefers secure Settings storage and honors disconnect without falling back to the configured file', () => {
    const h = harness({ configured: true, savedKey: true }); expect(h.imageKey()).toBe('fixture-saved-override');
    h.invoke('clear-key', 'OPENAI_API_KEY'); expect(h.imageKey()).toBe(''); expect(h.config().disabledKeys.OPENAI_API_KEY).toBe(true); expect(h.config().imageCredentialFile).toBeTruthy();
    h.invoke('save-key', { keyName: 'OPENAI_API_KEY', value: 'fixture-new-settings-key' }); expect(h.imageKey()).toBe('fixture-new-settings-key'); expect(h.config().disabledKeys.OPENAI_API_KEY).toBeUndefined();
  });
  it('keeps Settings state reachable if the explicit file is malformed', () => { const h = harness({ configured: true, invalidFile: true }); expect(h.imageKey()).toBe(''); expect(h.invoke('state').keys.OPENAI_API_KEY).toBe(false); });
  it('keeps Settings reachable when an existing Keychain value cannot be decrypted', () => { const h = harness({ savedKey: true, brokenKeychain: true }); expect(h.imageKey()).toBe(''); expect(h.invoke('state').keys.OPENAI_API_KEY).toBe(false); });
});
