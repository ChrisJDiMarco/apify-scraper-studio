// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';
import { methods } from '../src/shared/studio-api-channels.json';
import { createWebApi, FILE_PICKERS } from '../src/web/web-api.js';

// The Mac app's preload, loaded as written, with Electron replaced by a recorder.
function desktopApi() {
  let exposed = null; const calls = [];
  const electron = {
    contextBridge: { exposeInMainWorld: (_name, api) => { exposed = api; } },
    ipcRenderer: { invoke: (channel, ...args) => { calls.push({ channel, args }); return Promise.resolve(null); }, on: () => {}, removeListener: () => {} },
  };
  vm.runInNewContext(fs.readFileSync('src/preload/index.js', 'utf8'), { require: (name) => { if (name === 'electron') return electron; throw new Error(`The preload must stay self-contained; it required ${name}.`); } });
  return { api: exposed, calls };
}
function recordRpc() {
  const sent = [];
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    if (url === '/api/rpc') sent.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ result: null, downloads: [], opens: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  return sent;
}
const originalClick = HTMLInputElement.prototype.click;
afterEach(() => { HTMLInputElement.prototype.click = originalClick; vi.restoreAllMocks(); });

describe('browser studio and Mac app expose the same API', () => {
  it('lists every preload method in the shared channel table', () => {
    const { api } = desktopApi();
    expect(Object.keys(methods).sort()).toEqual(Object.keys(api).filter((name) => name !== 'onStateChanged').sort());
  });

  it('sends each method to the same channel with the same payload as the preload', async () => {
    const { api, calls } = desktopApi(); const sent = recordRpc(); const web = createWebApi();
    HTMLInputElement.prototype.click = function click() { if (this.type === 'file') setTimeout(() => this.dispatchEvent(new Event('cancel')), 0); };
    expect(Object.keys(web).filter((name) => name !== 'signOut').sort()).toEqual(Object.keys(api).sort());
    for (const method of Object.keys(methods)) {
      calls.length = 0; sent.length = 0;
      await api[method]({ probe: method }, 'second');
      await web[method]({ probe: method }, 'second');
      const desktop = calls[0]; const browser = sent[0];
      expect(browser.channel, method).toBe(desktop.channel);
      expect(browser.payload, method).toEqual(desktop.args[0]);
      expect(browser.uploads, method).toEqual([]);
    }
  });

  it('opens the browser file picker exactly where the Mac app opens a file dialog', async () => {
    recordRpc(); const web = createWebApi(); const accepted = [];
    HTMLInputElement.prototype.click = function click() { if (this.type === 'file') { accepted.push(this.accept); setTimeout(() => this.dispatchEvent(new Event('cancel')), 0); } };
    for (const method of Object.keys(methods)) { accepted.length = 0; await web[method](undefined); expect(accepted.length > 0, method).toBe(Boolean(FILE_PICKERS[method]?.(undefined))); }
    accepted.length = 0; await web.importStudioSource({ url: 'https://docs.google.com/document/d/fixture_document_12345/edit' });
    expect(accepted).toEqual([]); // a Google Doc link needs no file
    // Every file dialog in the main process has a browser picker; this list must grow with them.
    const dialogs = [...fs.readFileSync('src/main/index.js', 'utf8').matchAll(/dialog\.showOpenDialog/g)].length + [...fs.readFileSync('src/main/research-workspace.js', 'utf8').matchAll(/dialog\.showOpenDialog/g)].length;
    expect(Object.keys(FILE_PICKERS)).toHaveLength(dialogs);
  });

  it('uploads the chosen file, then follows the server: downloads saved files and opens links', async () => {
    const posted = []; const downloads = []; const opened = [];
    globalThis.fetch = vi.fn(async (url, init = {}) => {
      posted.push({ url, headers: init.headers, body: url === '/api/rpc' ? JSON.parse(init.body) : init.body });
      const body = url === '/api/upload' ? { uploadId: 'upload-1' } : { result: { cancelled: false }, downloads: [{ url: '/api/download/abc', fileName: 'team setup.json' }], opens: ['https://example.com/source'] };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.spyOn(window, 'open').mockImplementation((url) => { opened.push(url); return null; });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click() { downloads.push(this.getAttribute('download')); });
    HTMLInputElement.prototype.click = function click() {
      Object.defineProperty(this, 'files', { value: [new File(['{}'], 'team setup.json', { type: 'application/json' })] });
      setTimeout(() => this.dispatchEvent(new Event('change')), 0);
    };
    const web = createWebApi();
    await expect(web.openSetupFile()).resolves.toEqual({ cancelled: false });
    expect(posted[0]).toMatchObject({ url: '/api/upload', headers: expect.objectContaining({ 'X-File-Name': 'team%20setup.json' }) });
    expect(posted[1]).toMatchObject({ url: '/api/rpc', body: { channel: 'setup:open', uploads: ['upload-1'] } });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(downloads).toEqual(['team setup.json']); expect(opened).toEqual(['https://example.com/source']);
  });
});
