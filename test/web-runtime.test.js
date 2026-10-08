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

  it('broadcasts what the main process sends to its window', () => {
    const received = []; const stop = runtime.onBroadcast('state-changed', (state) => received.push(state));
    const window = new runtime.electron.BrowserWindow(); window.webContents.send('state-changed', { version: 1 });
    stop(); window.webContents.send('state-changed', { version: 2 });
    expect(received).toEqual([{ version: 1 }]);
  });
});
