import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import runtimeModule from '../src/main/web-runtime.js';

const runtime = runtimeModule; const { app, dialog, shell, safeStorage, ipcMain } = runtime.electron;
let root; let dataDir; let outside;
beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'web-runtime-test-')); dataDir = path.join(root, 'data'); outside = path.join(root, 'outside.txt');
  fs.writeFileSync(outside, 'NOT FOR DOWNLOAD');
  runtime.configure({ dataDir, secretKey: 'fixture-secret-key-for-tests-0123456789' });
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const saveDir = () => fs.mkdtempSync(path.join(runtime.settings.transferDir, 'call-'));

describe('web runtime stands in for Electron on the server', () => {
  it('keeps Mailgun credentials in memory and out of the public configuration', () => {
    const visible = runtime.configure({ dataDir, secretKey: 'fixture-secret-key-for-tests-0123456789', emailSecrets: { MAILGUN_API_KEY: 'fixture-mailgun-key' } });
    expect(runtime.settings.emailSecrets.MAILGUN_API_KEY).toBe('fixture-mailgun-key');
    expect(JSON.stringify(visible)).not.toContain('fixture-mailgun-key');
    expect(visible).not.toHaveProperty('emailSecrets');
    runtime.configure({ dataDir, secretKey: 'fixture-secret-key-for-tests-0123456789' });
  });
  it('refuses a missing data folder or a weak secret', () => {
    expect(() => runtime.configure({ secretKey: 'x'.repeat(40) })).toThrow(/STUDIO_DATA_DIR/);
    expect(() => runtime.configure({ dataDir, secretKey: 'too-short' })).toThrow(/STUDIO_SECRET_KEY/);
    runtime.configure({ dataDir, secretKey: 'fixture-secret-key-for-tests-0123456789' });
    expect(app.getPath('userData')).toBe(path.resolve(dataDir)); expect(app.isPackaged).toBe(true);
  });

  it('encrypts saved keys with the server secret and rejects keychain or tampered values', () => {
    expect(safeStorage.isEncryptionAvailable()).toBe(true);
    const sealed = safeStorage.encryptString('apify_api_fixture_value');
    expect(sealed.toString('utf8')).not.toContain('apify_api_fixture_value');
    expect(safeStorage.decryptString(sealed)).toBe('apify_api_fixture_value');
    const tampered = Buffer.from(sealed); tampered[tampered.length - 1] ^= 1;
    expect(() => safeStorage.decryptString(tampered)).toThrow();
    expect(() => safeStorage.decryptString(Buffer.from('v10keychainblob'))).toThrow(/another installation/);
  });

  it('answers file dialogs with the uploaded files and turns saves into downloads', async () => {
    ipcMain.handle('fixture:open', async () => dialog.showOpenDialog(null, { properties: ['openFile'] }));
    ipcMain.handle('fixture:save', async () => { const choice = await dialog.showSaveDialog(null, { defaultPath: path.join(app.getPath('documents'), 'team setup.json') }); fs.writeFileSync(choice.filePath, '{}'); return { saved: path.basename(choice.filePath) }; });
    const upload = path.join(root, 'upload.json'); fs.writeFileSync(upload, '{}');
    expect((await runtime.invoke('fixture:open', null, {})).result).toEqual({ canceled: true, filePaths: [] });
    expect((await runtime.invoke('fixture:open', null, { uploads: [{ path: upload }] })).result).toEqual({ canceled: false, filePaths: [upload] });
    const dir = saveDir(); const saved = await runtime.invoke('fixture:save', null, { saveDir: dir });
    expect(saved.result).toEqual({ saved: 'team setup.json' }); expect(saved.files).toEqual([path.join(dir, 'team setup.json')]);
    await expect(runtime.invoke('fixture:missing')).rejects.toThrow('Unknown studio action.');
  });

  it('offers data files as downloads, zips export folders, and keeps everything else on the server', async () => {
    const report = path.join(dataDir, 'workspaces', 'default', 'report.md'); fs.mkdirSync(path.dirname(report), { recursive: true }); fs.writeFileSync(report, '# Report');
    const exportDir = path.join(dataDir, 'exports', 'asset-pack-1'); fs.mkdirSync(path.join(exportDir, 'social'), { recursive: true });
    fs.writeFileSync(path.join(exportDir, 'manifest.json'), '{}'); fs.writeFileSync(path.join(exportDir, 'social', 'post.md'), 'Post');
    ipcMain.handle('fixture:shell', async (_, target) => ({ error: await shell.openPath(target) }));
    ipcMain.handle('fixture:link', async (_, url) => { await shell.openExternal(url); return true; });
    const open = (target) => runtime.invoke('fixture:shell', target, { saveDir: saveDir() });
    expect(await open(report)).toMatchObject({ result: { error: '' }, files: [fs.realpathSync(report)] });
    const zipped = await open(exportDir); expect(zipped.result.error).toBe('');
    expect(path.basename(zipped.files[0])).toBe('asset-pack-1.zip'); expect(fs.readFileSync(zipped.files[0]).subarray(0, 2).toString()).toBe('PK');
    expect((await open(outside)).result.error).toMatch(/outside the studio folder/);
    expect((await open(path.join(dataDir, 'workspaces'))).result.error).toMatch(/Folders stay on the server/);
    expect((await open(path.join(dataDir, 'exports'))).result.error).toMatch(/Folders stay on the server/);
    expect((await open(path.join(dataDir, 'missing.md'))).result.error).toMatch(/no longer exists/);
    expect((await runtime.invoke('fixture:link', 'https://example.com/post', {})).opens).toEqual(['https://example.com/post']);
  });

  it('tells handlers which signed-in call they serve, without letting one call inherit another’s person', async () => {
    const seen = {};
    ipcMain.handle('fixture:who', async (_, label) => {
      const call = runtime.currentCall(); seen[label] = { user: call.user?.id ?? null, viewAs: call.session?.viewAs ?? null, origin: call.origin };
      if (label === 'outer') { call.session.viewAs = { role: 'editor' }; await runtime.invoke('fixture:who', 'inner'); } // e.g. work an admin's call starts
      return label;
    });
    const session = { viewAs: null };
    expect(runtime.currentCall()).toBeNull();
    expect((await runtime.invoke('fixture:who', 'outer', { user: { id: 'member-pat' }, session, origin: 'https://studio.example.com' })).result).toBe('outer');
    expect(seen.outer).toEqual({ user: 'member-pat', viewAs: null, origin: 'https://studio.example.com' });
    expect(seen.inner).toEqual({ user: null, viewAs: null, origin: '' });
    expect(session.viewAs).toEqual({ role: 'editor' }); // the live session object, so View as outlives the call
    expect(runtime.currentCall()).toBeNull();
  });

  it('keeps what the main process provides to the server', () => {
    expect(runtime.provided('fixture-people')).toBeNull();
    const people = { ownerIdentity: () => ({ id: 'owner' }) }; runtime.provide('fixture-people', people);
    expect(runtime.provided('fixture-people')).toBe(people);
  });

  it.runIf(process.platform !== 'win32')('keeps the data folder private to the server’s user, tightening one made by hand', () => {
    const mode = (dir) => fs.statSync(dir).mode & 0o777;
    expect(mode(dataDir)).toBe(0o700); expect(mode(runtime.settings.transferDir)).toBe(0o700);
    const handMade = path.join(root, 'hand-made'); fs.mkdirSync(handMade, { mode: 0o755 }); fs.chmodSync(handMade, 0o755);
    runtime.configure({ dataDir: handMade, secretKey: 'fixture-secret-key-for-tests-0123456789' });
    expect(mode(handMade)).toBe(0o700);
    runtime.configure({ dataDir, secretKey: 'fixture-secret-key-for-tests-0123456789' });
  });

  // The drain on SIGTERM waits while the main process has work to lose: Electron's before-quit contract, where a listener
  // that calls preventDefault() is saying "something is still running", or a `work` provider when one is offered.
  it('reports running work through before-quit, or through a work provider', () => {
    expect(runtime.busyWork()).toEqual([]);
    const busy = (event) => event.preventDefault(); app.on('before-quit', busy);
    try { expect(runtime.busyWork()).toEqual(['work in progress']); } finally { app.off('before-quit', busy); }
    runtime.provide('work', { active: () => ['Research run: Weekly trends'] });
    try { expect(runtime.busyWork()).toEqual(['Research run: Weekly trends']); } finally { runtime.provide('work', null); }
  });

  it('broadcasts what the main process sends to its window', () => {
    const received = []; const stop = runtime.onBroadcast('state-changed', (state) => received.push(state));
    const window = new runtime.electron.BrowserWindow(); window.webContents.send('state-changed', { version: 1 });
    stop(); window.webContents.send('state-changed', { version: 2 });
    expect(received).toEqual([{ version: 1 }]);
  });
});
