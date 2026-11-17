// Offline integration smoke: real Electron/preload on Mac, or the real web server and browser adapter (--web).
// Uses only a disposable fixture profile; external requests, CLI tools and provider adapters are blocked.
const electron = require('electron');
const { app, BrowserWindow, nativeImage, session } = electron;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const Module = require('node:module');
const web = process.argv.includes('--web');
const root = fs.mkdtempSync(path.join(os.tmpdir(), `golden-workspaces-${web ? 'web' : 'mac'}-`));
const dataDir = path.join(root, 'profile'); const captures = path.join(root, 'captures');
fs.mkdirSync(captures, { recursive: true });
app.setPath('userData', web ? path.join(root, 'browser') : dataDir);
process.env.STUDIO_DISABLE_LOCAL_ENV = '1'; process.env.STUDIO_WORKSPACE_MODE = 'multi';
if (web) process.env.STUDIO_RUNTIME = 'web'; else delete process.env.STUDIO_RUNTIME;
for (const key of ['APIFY_API_TOKEN', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GOOGLE_DOCS_ACCESS_TOKEN', 'GOOGLE_SHEETS_WEBHOOK_URL', 'APIFY_STUDIO_AUTO_UPDATE_URL', 'STUDIO_ADMIN_EMAILS', 'EMAIL_PROVIDER', 'MONDAY_API_TOKEN']) delete process.env[key];
const { seedStudio } = require('../test/helpers/roles-studio');
seedStudio(dataDir, { at: new Date(Date.now() - 86400000).toISOString(), settings: { aiProvider: 'codex', uiMode: 'simple' } });
const studioRoot = path.join(dataDir, 'content-studio');
const teamFile = path.join(studioRoot, 'team.json'); const team = JSON.parse(fs.readFileSync(teamFile, 'utf8'));
for (const member of team.members) { if (member.id === 'member-chris') Object.assign(member, { name: 'Jordan', email: 'jordan-admin@example.com' }); else member.email = `${member.name.toLowerCase()}@example.com`; }
team.members.push({ ...team.members.find((row) => row.id === 'member-alex'), id: 'member-jordan', name: 'Jordan', email: 'jordan@example.com' });
fs.writeFileSync(teamFile, JSON.stringify(team));
const stateFile = path.join(studioRoot, 'state.json'); const seeded = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
for (const program of seeded.programs) Object.assign(program, { query: 'Listen for practitioner problems with AI search measurement.', sourceGroups: [{ id: 'qa-x', name: 'X accounts', platform: 'x', enabled: true, targets: ['example-team'] }], schedule: { frequency: 'manual', enabled: false } });
fs.writeFileSync(stateFile, JSON.stringify(seeded));
const bitmap = Buffer.alloc(96 * 64 * 4); for (let i = 0; i < bitmap.length; i += 4) { bitmap[i] = 70; bitmap[i + 1] = 120; bitmap[i + 2] = 180; bitmap[i + 3] = 255; }
const image = nativeImage.createFromBitmap(bitmap, { width: 96, height: 64 }).toPNG();
const imagePath = path.join(root, 'example.png'); fs.writeFileSync(imagePath, image);
const { createChannelReferences } = require('../src/main/channel-references');
createChannelReferences({ root: path.join(studioRoot, 'channel-references') }).add({ workspaceId: 'semrush', channelId: 'blog', name: 'Example layout.png', data: image, description: 'The simple layout and clear focal point worked well for our channel.' });

let blockedNetwork = 0, blockedCli = 0, blockedProvider = 0, server, runtime, origin = '';
const windows = []; const rendererErrors = [];
const receipt = { fixtureOnly: true, mode: web ? 'web' : 'desktop', root, dataDir, captures, checks: [], screenshots: [] };
const check = (name, detail = {}) => { receipt.checks.push({ name, ...detail }); console.log(`CHECK ${name}`); };
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const denied = () => { blockedProvider++; throw new Error('Provider work is disabled in this offline fixture.'); };
const originalLoad = Module._load;
app.on('browser-window-created', (_, win) => { win.show = () => {}; win.focus = () => {}; win.restore = () => {}; });
Module._load = function (name) {
  if (name === 'electron') return { ...electron, dialog: { ...electron.dialog, showOpenDialog: async () => ({ canceled: false, filePaths: [imagePath] }) }, shell: { ...electron.shell, openExternal: async () => { blockedNetwork++; throw new Error('External links are blocked.'); } } };
  if (name === 'electron-updater') return { autoUpdater: null };
  if (/(?:^|\/)content-workspace(?:\.js)?$/.test(name)) { const actual = originalLoad.apply(this, arguments); return { ...actual, createContentWorkspace: (deps) => actual.createContentWorkspace({ ...deps, runAI: denied, collect: denied, generateImage: denied, generateVideo: denied, publishCampaign: denied }) }; }
  if (['child_process', 'node:child_process'].includes(name)) { const actual = { ...originalLoad.apply(this, arguments) }; for (const key of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) actual[key] = () => { blockedCli++; throw new Error('CLI execution is disabled in this offline fixture.'); }; return actual; }
  return originalLoad.apply(this, arguments);
};
const localUrl = (value) => { try { return ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(typeof value === 'string' ? value : value.url || value.href).hostname); } catch (_) { return false; } };
const fetchOriginal = global.fetch;
global.fetch = (...args) => { if (!localUrl(args[0])) { blockedNetwork++; return Promise.reject(new Error('External requests are disabled in this fixture.')); } return fetchOriginal(...args); };
for (const protocol of ['node:http', 'node:https']) {
  const adapter = require(protocol);
  for (const method of ['request', 'get']) { const original = adapter[method]; adapter[method] = function (...args) { const request = args[0]; const host = typeof request === 'object' ? request.hostname || request.host : ''; if (!localUrl(request) && !['127.0.0.1', 'localhost', '::1'].includes(host)) { blockedNetwork++; throw new Error('External requests are disabled in this fixture.'); } return original.apply(this, args); }; }
}
app.on('web-contents-created', (_, contents) => { contents.setBackgroundThrottling(false); contents.on('console-message', (details) => { if (details.level === 'error') rendererErrors.push(details.message); }); contents.on('render-process-gone', (_, detail) => rendererErrors.push(`Renderer exited: ${detail.reason}`)); });
function guardSession(surface) { surface.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (request, done) => { const blocked = !web || !localUrl(request.url); if (blocked) blockedNetwork++; done({ cancel: blocked }); }); }
const evaluate = (win, code) => win.webContents.executeJavaScript(code, true);
const call = (win, method, payload) => evaluate(win, `window.apifyStudio[${JSON.stringify(method)}](${payload === undefined ? '' : JSON.stringify(payload)})`);
async function waitFor(win, code, name) { for (let i = 0; i < 160; i++) { if (await evaluate(win, code).catch(() => false)) return; await pause(80); } throw new Error(`Timed out: ${name}. ${await evaluate(win, 'document.body.innerText.slice(0,1800)').catch(() => '')}`); }
async function click(win, label, scope = 'document') { const clicked = await evaluate(win, `(() => { const node = [...(${scope})?.querySelectorAll('button,[role="menuitem"],[role="menuitemradio"]') || []].find(node => { const copy = node.cloneNode(true); copy.querySelectorAll('[aria-hidden=true]').forEach(child => child.remove()); return node.getAttribute('aria-label') === ${JSON.stringify(label)} || copy.textContent.trim() === ${JSON.stringify(label)}; }); if (!node || node.disabled) return false; node.click(); return true; })()`); assert.ok(clicked, `Clickable: ${label}`); await pause(100); }
async function navigate(win, label) { await click(win, label, 'document.querySelector(\'nav[aria-label="Main"]\')'); await pause(100); }
async function skipTour(win) { if (await evaluate(win, 'Boolean(document.querySelector(".workspace-tour-intro"))')) await click(win, 'Skip for now'); if (await evaluate(win, 'Boolean(document.querySelector(".workspace-tour-card"))')) await click(win, 'Skip walkthrough'); await pause(120); }
async function shot(win, name, width = 1440) {
  win.setContentSize(width, 980); await pause(200);
  await evaluate(win, 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await win.webContents.capturePage(undefined, { stayHidden: true });
  const file = path.join(captures, `${name}.png`); fs.writeFileSync(file, (await win.webContents.capturePage(undefined, { stayHidden: true })).toPNG());
  const size = await evaluate(win, '({width:innerWidth,documentWidth:document.documentElement.scrollWidth})');
  assert.ok(size.documentWidth <= size.width, `${name}: no horizontal viewport overflow (${size.documentWidth}/${size.width})`);
  receipt.screenshots.push({ name, path: file, ...size });
}
async function refused(win, method, payload, pattern = /workspace|access|admin|channel|not|preview/i) { const failure = await call(win, method, payload).then(() => '', (error) => error.message); assert.match(failure, pattern, `Refused ${method}`); check(`denied-${method}`); }
async function webWindow(label, login) {
  const surface = session.fromPartition(`workspace-smoke-${label}-${crypto.randomUUID()}`); guardSession(surface);
  const win = new BrowserWindow({ width: 1440, height: 980, show: false, webPreferences: { session: surface, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } }); windows.push(win);
  await win.loadURL(origin);
  const result = await evaluate(win, `fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(${JSON.stringify(login)})}).then(async response=>({status:response.status,body:await response.json()}))`);
  assert.equal(result.status, 200, `Signed in ${label}`);
  await win.loadURL(origin);
  await waitFor(win, 'Boolean(window.apifyStudio && document.querySelector(\'nav[aria-label="Main"]\'))', `${label} app`);
  return win;
}
async function programReadOnly(win, prefix) {
  await skipTour(win); await navigate(win, 'Research programs');
  await waitFor(win, 'Boolean(document.querySelector(".channel-programs"))', 'read-only programs');
  assert.doesNotMatch(await evaluate(win, 'document.querySelector(".channel-programs").innerText'), /\$|USD|Claude|Codex|AI models|Budget/);
  await shot(win, `${prefix}-programs-desktop`);
  await click(win, 'View AI search pulse'); await waitFor(win, 'Boolean(document.querySelector(".program-readonly-detail"))', 'program details');
  await shot(win, `${prefix}-program-detail-desktop`); await click(win, 'Done');
  const programs = (await call(win, 'state')).contentStudio.programs;
  assert.equal(programs.length, 2); assert.ok(programs.every((program) => !program.budgets && !program.models && !program.ai && !program.notes));
  check(`${prefix}-safe-program-browsing`);
}
function contrast(foreground, background) {
  const luminance = (color) => { const rgb = color.match(/[\d.]+/g).slice(0, 3).map((value) => { const channel = Number(value) / 255; return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4; }); return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722; };
  const a = luminance(foreground), b = luminance(background); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
async function channelViews(win, prefix) {
  await programReadOnly(win, prefix);
  await navigate(win, 'Trends'); await waitFor(win, 'Boolean(document.querySelector(".channel-board"))', 'channel board');
  await shot(win, `${prefix}-channel-board-desktop`);
  await shot(win, `${prefix}-channel-board-narrow`, web ? 390 : 720);
  if (web) assert.equal(await evaluate(win, '(() => { const label = [...document.querySelectorAll(".studio-bottom-nav button > span:last-child")].find(node=>node.textContent==="Programs"); return Boolean(label) && label.scrollWidth <= label.clientWidth; })()'), true, 'Programs label fits narrow navigation');
  await navigate(win, 'My channel'); await click(win, 'Image examples');
  const settings = await call(win, 'readChannelSettings', { channelId: 'blog' });
  const reference = await call(win, 'readChannelReference', { channelId: 'blog', imageId: settings.references[0].id });
  check(`${prefix}-read-image-reference`, { fields: Object.keys(reference), dataPrefix: String(reference.dataUrl || '').slice(0, 28) });
  assert.match(reference.dataUrl || '', /^data:image\/png;base64,/);
  await shot(win, `${prefix}-image-examples-loading`, web ? 390 : 720);
  await waitFor(win, 'Boolean(document.querySelector(".channel-example img"))', 'saved image example');
  await shot(win, `${prefix}-image-examples-narrow`, web ? 390 : 720); await shot(win, `${prefix}-image-examples-desktop`);
  if (web) {
    const colors = await evaluate(win, '(() => { const node = document.querySelector(".channel-example button[aria-label^=Remove]"); const style = getComputedStyle(node); let parent = node, background; while(parent){background=getComputedStyle(parent).backgroundColor;if(!background.endsWith(", 0)")&&background!=="transparent")break;parent=parent.parentElement;} return {foreground:style.color,background,disabled:node.disabled}; })()');
    assert.equal(colors.disabled, false); const ratio = contrast(colors.foreground, colors.background); assert.ok(ratio >= 4.5, `Remove button contrast ${ratio.toFixed(2)}:1`); check('image-remove-button-contrast', { ...colors, ratio });
  }
  await navigate(win, 'Assets');
  assert.ok(await evaluate(win, '[...document.querySelectorAll("button")].some(node=>node.textContent.trim()==="Generate assets")'));
  check(`${prefix}-assets-generation-entry`);
}
async function run() {
  await app.whenReady();
  let owner, second;
  if (web) {
    runtime = require('../src/main/web-runtime'); runtime.configure({ dataDir, secretKey: crypto.randomBytes(32).toString('hex'), passwordSignIn: true });
    require('../src/main/index');
    const studio = require('../src/main/studio-server').createStudioServer({ webRoot: path.resolve(__dirname, '../out/web'), runtime, password: 'offline-smoke-password-12345', minFreeMb: 0, sessionFile: '', serverLog: { log() {} } });
    server = studio; await new Promise((resolve) => studio.server.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${studio.server.address().port}`;
    owner = await webWindow('owner-a', { password: 'offline-smoke-password-12345' }); second = await webWindow('owner-b', { password: 'offline-smoke-password-12345' });
    await evaluate(second, 'window.__smokePushes=[];window.__smokeStream=new EventSource("/api/events");window.__smokeStream.addEventListener("hello",()=>window.__smokeHello=true);window.__smokeStream.addEventListener("state-changed",event=>{const state=JSON.parse(event.data);window.__smokePushes.push({workspaceId:state.contentStudio.activeWorkspaceId,programIds:state.contentStudio.programs.map(row=>row.id)});});');
    await waitFor(second, 'window.__smokeHello===true', 'second owner live event stream');
  } else {
    guardSession(session.defaultSession); require('../out/main/index.js');
    for (let i = 0; i < 100 && !BrowserWindow.getAllWindows().length; i++) await pause(80);
    owner = BrowserWindow.getAllWindows()[0]; assert.ok(owner, 'Native window created'); windows.push(owner);
    await waitFor(owner, 'Boolean(window.apifyStudio && document.querySelector(\'nav[aria-label="Main"]\'))', 'native app');
    assert.equal((await call(owner, 'appMeta')).dataRoot, dataDir);
  }
  assert.equal((await call(owner, 'state')).viewer.isSuperAdmin, true);
  await shot(owner, `${web ? 'web' : 'mac'}-first-use-tour`); await skipTour(owner); if (second) await skipTour(second);
  if (second) await evaluate(second, 'window.__smokePushes=[]');
  const adobe = await call(owner, 'saveContentWorkspace', { name: 'Adobe QA', editionId: 'general', knowledge: {}, products: [] });
  assert.ok(adobe.id); await waitFor(owner, `window.apifyStudio.state().then(state=>state.contentStudio.activeWorkspaceId===${JSON.stringify(adobe.id)})`, 'new workspace selected');
  await call(owner, 'saveResearchProgram', { id: 'program-qa-firefly', workspaceId: adobe.id, name: 'Adobe Firefly QA', query: 'Synthetic offline fixture for creative workflow research.', sourceGroups: [{ platform: 'x', targets: ['qa_creative'] }], schedule: { frequency: 'manual', enabled: false } });
  assert.equal((await call(owner, 'state')).contentStudio.programs.length, 1);
  if (second) { const other = await call(second, 'state'); assert.equal(other.contentStudio.activeWorkspaceId, 'semrush'); assert.equal(other.contentStudio.programs.length, 2); check('two-session-workspace-selection-isolated'); await waitFor(second, 'window.__smokePushes.length>0', 'broadcast after other owner write'); const pushes = await evaluate(second, 'window.__smokePushes'); assert.ok(pushes.every((push) => push.workspaceId === 'semrush' && push.programIds.length === 2 && !push.programIds.includes('program-qa-firefly'))); check('sse-workspace-broadcasts-isolated', { events: pushes.length }); }
  await call(owner, 'selectContentWorkspace', 'semrush'); await waitFor(owner, 'Boolean(document.querySelector(\'button[aria-label^="Workspace: Semrush workspace"]\'))', 'workspace picker state after switching'); await skipTour(owner);
  await evaluate(owner, 'document.querySelector(\'button[aria-label^="Workspace: Semrush workspace"]\').click()'); await shot(owner, `${web ? 'web' : 'mac'}-workspace-picker`); await evaluate(owner, 'document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
  check('workspace-create-and-switch-retains-semrush');
  if (!web) {
    await call(owner, 'setViewAs', { role: 'channel', channelId: 'blog' }); await waitFor(owner, 'Boolean(document.querySelector(".channel-main"))', 'channel preview');
    await channelViews(owner, 'mac');
    assert.equal(await evaluate(owner, '[...document.querySelectorAll("button")].find(node=>node.textContent.trim()==="Generate assets")?.disabled'), true);
    await refused(owner, 'saveContentWorkspace', { name: 'Forbidden workspace', editionId: 'general' });
    await call(owner, 'setViewAs', { role: 'admin' });
  } else {
    await call(owner, 'saveWorkspaceMembership', { memberId: 'member-alex', workspaceId: adobe.id, role: 'editor', channelId: null });
    const links = [];
    for (const id of ['member-alex', 'member-jordan']) { const result = await call(owner, 'createSignInLink', { id }); assert.ok(result.url); links.push(result.url.split('#signin=')[1]); }
    const alex = await webWindow('alex', { linkToken: links[0] }); const jordan = await webWindow('jordan', { linkToken: links[1] });
    await shot(alex, 'web-channel-first-use-tour'); await skipTour(alex); await skipTour(jordan);
    await channelViews(alex, 'web');
    await call(alex, 'setTrendAdoption', { themeId: 'theme-citations', status: 'using', link: '', note: '' });
    await waitFor(jordan, 'window.apifyStudio.state().then(state=>state.contentStudio.channelView.trends.some(trend=>trend.themeId==="theme-citations"&&trend.adoption?.status==="using"))', 'shared channel answer');
    await navigate(jordan, 'Trends'); await waitFor(jordan, '[...document.querySelectorAll(".channel-board-column")].find(node=>node.getAttribute("aria-label")==="Using")?.innerText.includes("AI Citation Tracking")', 'shared answer pushed to the second user’s board'); await shot(jordan, 'web-second-channel-owner-shared-board'); check('same-channel-users-share-decisions');
    await refused(alex, 'saveContentWorkspace', { name: 'Forbidden workspace', editionId: 'general' });
    await refused(alex, 'readStudioAsset', { assetId: 'asset-kit-social' });
    await refused(alex, 'approveResearchThemes', { runId: 'research-1', themeIds: ['theme-citations'] });
    await call(alex, 'selectContentWorkspace', adobe.id); const seen = await call(alex, 'state'); assert.equal(seen.viewer.role, 'editor'); assert.equal(seen.contentStudio.activeWorkspaceId, adobe.id);
    await waitFor(alex, 'document.querySelector(".workspace-tour-intro")?.innerText.includes("Adobe QA")', 'new workspace and Editor walkthrough'); await shot(alex, 'web-editor-adobe-first-use-tour');
    await refused(alex, 'readStudioAsset', { assetId: 'asset-report' });
    assert.equal((await call(jordan, 'state')).contentStudio.activeWorkspaceId, 'semrush'); check('one-account-different-workspace-roles-without-reinvite');
    const adminLink = await call(owner, 'createSignInLink', { id: 'member-chris' }); const admin = await webWindow('workspace-admin', { linkToken: adminLink.url.split('#signin=')[1] });
    const adminState = await call(admin, 'state'); assert.equal(adminState.viewer.role, 'admin'); assert.equal(adminState.viewer.isSuperAdmin, false);
    await shot(admin, 'web-workspace-admin-first-use-tour'); await skipTour(admin); await refused(admin, 'saveContentWorkspace', { name: 'Forbidden workspace', editionId: 'general' });
    await refused(admin, 'createSignInLink', { id: 'member-alex' }); await refused(admin, 'revokeSignInLink', { id: 'member-alex' });
    assert.equal((await call(admin, 'getTeam')).directory, undefined); check('workspace-admin-cannot-create-workspace-or-read-global-directory');
    await call(alex, 'selectContentWorkspace', 'semrush'); await waitFor(alex, 'Boolean(document.querySelector(".channel-main"))', 'channel renderer after workspace switch'); await pause(150); await skipTour(alex);
    alex.setContentSize(1440, 980); await pause(120); await evaluate(alex, 'document.querySelector(\'button[aria-label^="Account:"]\').click()'); await click(alex, 'Take the guided tour'); await waitFor(alex, 'Boolean(document.querySelector(".workspace-tour-intro"))', 'replayed tour'); assert.match(await evaluate(alex, 'document.querySelector(".workspace-tour-intro").innerText'), /account menu/i); await click(alex, 'Start walkthrough'); await waitFor(alex, 'Boolean(document.querySelector(".workspace-tour-card"))', 'walkthrough step'); await shot(alex, 'web-role-workspace-walkthrough', 390); await click(alex, 'Skip walkthrough');
  }
  assert.equal(blockedProvider, 0, 'No provider operation was attempted');
  receipt.status = 'passed'; receipt.blockedNetworkRequests = blockedNetwork; receipt.blockedCliAttempts = blockedCli; receipt.providerAttempts = blockedProvider; receipt.rendererErrors = rendererErrors;
  const unexpected = rendererErrors.filter((line) => !/Error invoking remote method|favicon|Content Security Policy|ERR_BLOCKED_BY_CLIENT|Failed to load resource: the server responded with a status of (401|403)/.test(line));
  assert.deepEqual(unexpected, [], 'No unexpected renderer errors');
  check('offline-no-paid-work');
}
const timeout = setTimeout(() => { throw new Error('Workspace/channel smoke exceeded three minutes.'); }, 180000);
run().then(() => finish(0), (error) => { receipt.status = 'failed'; receipt.error = error.stack || error.message; console.error(error); finish(1); });
function finish(code) {
  clearTimeout(timeout); receipt.completedAt = new Date().toISOString(); const target = path.join(root, 'receipt.json'); fs.writeFileSync(target, `${JSON.stringify(receipt, null, 2)}\n`); console.log(`RECEIPT ${target}`);
  server?.closeStreams(); server?.server.close(); runtime?.shutdown(); for (const win of windows) if (!win.isDestroyed()) win.destroy(); app.exit(code);
}
