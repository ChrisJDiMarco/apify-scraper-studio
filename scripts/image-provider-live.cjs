// Owner-approved connection smoke. One image request, no CLI/Apify/Drive calls.
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const Module = require('node:module'); const assert = require('node:assert/strict');
const { readLocalImageKey } = require('../src/main/local-image-key');
const project = path.resolve(__dirname, '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-live-image-'));
const receipt = { startedAt: new Date().toISOString(), source: 'Public synthetic creative brief; no scraped/private source records.', maxDispatchAllowanceUsd: 0.50, requestedImages: 1, paidImageRequests: 0, quality: 'low', cliCalls: 0 };
app.setPath('userData', root); process.env.STUDIO_DISABLE_LOCAL_ENV = '1';
for (const name of ['APIFY_API_TOKEN', 'GOOGLE_DOCS_ACCESS_TOKEN', 'GOOGLE_SHEETS_WEBHOOK_URL', 'APIFY_STUDIO_AUTO_UPDATE_URL']) delete process.env[name];
process.env.OPENAI_API_KEY = readLocalImageKey({ appPath: project, enabled: true });
assert.ok(process.env.OPENAI_API_KEY, 'Approved local credential is available');
const actualFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  if (String(url) === 'https://api.openai.com/v1/images/generations' && options.method === 'POST' && receipt.paidImageRequests === 0) { receipt.paidImageRequests++; return actualFetch(url, options); }
  throw new Error('This connection smoke allows one image request only.');
};
const originalLoad = Module._load;
Module._load = function (name, parent, isMain) {
  if (/(?:^|\/)image-provider(?:\.js)?$/.test(name)) { const actual = originalLoad.apply(this, arguments); return { ...actual, createImageProvider: options => actual.createImageProvider({ ...options, quality: 'low' }) }; }
  if (name === 'child_process') return { ...originalLoad.apply(this, arguments), spawn: () => { receipt.cliCalls++; throw new Error('CLI calls forbidden in image smoke.'); } };
  return originalLoad.apply(this, arguments);
};
app.whenReady().then(() => session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_, callback) => callback({ cancel: true })));
require('../out/main/index.js');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms)); let win;
const call = (method, payload) => win.webContents.executeJavaScript(`window.apifyStudio[${JSON.stringify(method)}](${payload === undefined ? '' : JSON.stringify(payload)})`, true);
const source = { kind: 'text', title: 'Image connection test — research to campaign', text: 'Synthetic creative brief for a provider connection test, not market evidence. Design a polished editorial campaign illustration: three cream paper cards lead toward a sculpted orange folded-paper mountain, symbolizing collecting sources, reviewing findings and creating content. Off-white studio background, Semrush-like warm orange palette, soft natural shadows, generous negative space. No words, no logos, no charts, no numerical or marketing claims.' };
async function finish(status, error) {
  receipt.status = status; receipt.finishedAt = new Date().toISOString(); if (error) receipt.error = String(error.message).replace(/(?:sk-|apify_api_)[\w.-]+/g, '[redacted]');
  fs.writeFileSync(path.join(project, 'docs/verification/image-provider-live.json'), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify({ status, paidImageRequests: receipt.paidImageRequests, costUsd: receipt.run?.costUsd, output: receipt.output, error: receipt.error })); app.exit(status === 'passed' ? 0 : 1);
}
async function run() {
  await app.whenReady();
  for (let i = 0; i < 100; i++) { win = BrowserWindow.getAllWindows()[0]; if (win && await win.webContents.executeJavaScript('Boolean(window.apifyStudio)').catch(() => false)) break; await pause(100); }
  assert.ok(win); const state = await call('state'); assert.equal(state.keys.OPENAI_API_KEY, true); assert.equal(state.contentStudio.capabilities.imagesConfigured, true);
  const started = await call('createContentRun', { workspaceId: 'general', source, deliverableIds: ['brand-image'], imageVariants: 1, maxBudgetUsd: .50 });
  for (let i = 0; i < 210; i++) { receipt.run = await call('readStudioRun', { runId: started.id }); if (!['queued', 'running'].includes(receipt.run.status)) break; await pause(1000); }
  assert.equal(receipt.run.status, 'succeeded', receipt.run.jobs.map(j => j.error || '').join('; '));
  assert.equal(receipt.paidImageRequests, 1); assert.equal(receipt.cliCalls, 0);
  const finalState = await call('state'); assert.equal(finalState.contentStudio.assets.length, 1);
  receipt.asset = finalState.contentStudio.assets[0]; assert.equal(receipt.asset.receipt.quality, 'low');
  const exported = await call('exportStudioRun', { runId: started.id });
  const target = path.join(project, 'docs/verification/live-image'); fs.mkdirSync(target, { recursive: true }); fs.cpSync(exported.path, target, { recursive: true });
  const png = fs.readdirSync(path.join(target, 'Design')).find(name => name.endsWith('.png')); receipt.output = path.join(target, 'Design', png);
  await finish('passed');
}
run().catch(error => finish('failed', error));
