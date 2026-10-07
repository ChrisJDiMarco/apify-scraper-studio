// Native content studio QA: real renderer, preload, IPC, validation and persistence.
// Only host provider adapters are fixtures. Network and CLI calls fail closed.
const { app, BrowserWindow, session } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const Module = require('node:module');
const content = require('../src/shared/content-studio');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scraper-content-studio-'));
const screenshots = path.join(dataDir, 'screenshots'); fs.mkdirSync(screenshots);
app.setPath('userData', dataDir);
process.env.STUDIO_DISABLE_LOCAL_ENV = '1';
fs.writeFileSync(path.join(dataDir, 'data.json'), JSON.stringify({ projects: [{ id: 'default', name: 'QA fixture' }], recipes: [], datasets: [], runs: [], analyses: [], settings: { aiProvider: 'claude', aiModel: 'claude-opus-5-5' } }));
for (const key of ['APIFY_API_TOKEN', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GOOGLE_DOCS_ACCESS_TOKEN', 'GOOGLE_SHEETS_WEBHOOK_URL', 'APIFY_STUDIO_AUTO_UPDATE_URL']) delete process.env[key];
let networkCalls = 0, cliCalls = 0, win;
const aiCalls = [], collectionCalls = [], imageCalls = [], imageAccessChecks = [], failures = [];
const syntheticImageCredential = 'native-qa-fixture-not-a-real-api-credential';
const receipt = { fixtureOnly: true, startedAt: new Date().toISOString(), dataDir, screenshots, checks: [] };
const check = (name, details = {}) => receipt.checks.push({ name, ...details });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const rows = Array.from({ length: 6 }, (_, index) => ({ id: `qa-source-${index}`, externalId: `qa-${index}`, platform: 'x', type: 'post', author: `QA author ${index}`, text: `QA FIXTURE: Manual reporting work creates campaign workflow friction ${index}.`, url: `https://example.com/qa-source/${index}`, publishedAt: '2026-09-25T12:00:00Z', raw: { likeCount: 100, replyCount: 25, retweetCount: 10, quoteCount: 4, bookmarkCount: 5, viewCount: 1000 } }));
function fixtureOutput(request) {
  const parseTail = () => JSON.parse(request.prompt.slice(request.prompt.lastIndexOf('\n{') + 1));
  if (request.schema.properties.candidates) { const batch = parseTail(); return { candidates: [{ name: 'QA reporting workflow friction', summary: 'The supplied fixture sources describe manual reporting work.', painPoint: 'Workflow/Resource Overload', semanticIntentSignals: ['manual reporting'], actionability: 'Reduce manual assembly.', evidenceIds: batch.evidenceIds }] }; }
  if (request.schema.properties.themes) { const input = parseTail(); return { themes: [{ name: 'QA reporting workflow friction', description: 'The fixture sources describe manual reporting work.', candidateIds: input.candidates.map(candidate => candidate.id), existingThemeId: null, novelty: 'NEW ANGLE', matchingKeywords: ['reporting'], matchingCriteria: 'Specific reporting workflow friction.', negativeCriteria: 'Generic praise.', taxonomyCategory: 'Reporting' }] }; }
  if (request.schema.properties.assignments) { const input = parseTail(); return { assignments: input.batch.items.map(item => ({ itemId: item.id, themeId: input.themes[0].id, confidence: .85, reason: 'Describes manual reporting.', painPoint: 'Workflow/Resource Overload', urgency: 'Strategic Planning', entities: { tools: [], people: [], companies: [] } })) }; }
  const sectionIds = request.schema.properties.sections.items.properties.id.enum;
  const descriptor = content.CONTENT_DELIVERABLES.find(item => item.kind === 'text' && JSON.stringify(item.sections.map(section => section.id)) === JSON.stringify(sectionIds));
  assert.ok(descriptor, 'Known output contract');
  const input = JSON.parse(request.prompt.split('UNTRUSTED_SOURCE_AND_BRAND_DATA:\n')[1]);
  const evidenceId = input.source.evidence[1]?.id || input.source.evidence[0].id;
  const output = { title: `QA FIXTURE: ${descriptor.label}`, summary: 'This synthetic sample verifies saved content, source references, and review controls.', sections: descriptor.sections.map(section => ({ id: section.id, heading: section.heading, body: 'QA FIXTURE: The supplied sample describes manual reporting work. Review the source context before acting.', items: Array.from({ length: section.minItems || 0 }, (_, index) => ({ label: `Action ${index + 1}`, text: 'Review the reporting workflow.', evidenceIds: [evidenceId], productIds: [] })), evidenceIds: [evidenceId], productIds: [] })), caveats: ['Synthetic QA fixture, not market research. No approved product registry or verified quotation set was supplied.'] };
  if (descriptor.id === 'evidence-report') output.quotes = [];
  return output;
}
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lS8AAAAASUVORK5CYII=', 'base64');
const originalLoad = Module._load;
Module._load = function (name, parent, isMain) {
  if (/(?:^|\/)image-provider(?:\.js)?$/.test(name)) {
    const actual = originalLoad.apply(this, arguments);
    return { ...actual, createImageProvider: deps => ({ ...actual.createImageProvider(deps), checkAccess: async () => {
      assert.equal(await deps.getApiKey(), syntheticImageCredential, 'Access check receives only the disposable fixture credential');
      const result = { configured: true, model: actual.MODEL, accessVerified: true, generationVerified: false, message: 'Offline QA fixture: model access checked; no provider request was made.' };
      imageAccessChecks.push(result); return result;
    } }) };
  }
  if (/(?:^|\/)content-workspace(?:\.js)?$/.test(name)) {
    const actual = originalLoad.apply(this, arguments);
    return { ...actual, createContentWorkspace: deps => actual.createContentWorkspace({ ...deps,
      runAI: async request => { aiCalls.push({ runId: request.runId, maxBudgetUsd: request.maxBudgetUsd, schema: Object.keys(request.schema.properties) }); await pause(90); return { output: fixtureOutput(request), receipt: { provider: 'native-qa-fixture', model: 'fixture-only', costUsd: .001, paid: false } }; },
      collect: async request => { collectionCalls.push({ runId: request.runId, targets: request.program.sourceGroups }); return { items: rows, datasetIds: [], receipt: { fixtureOnly: true, jobCount: 1, succeededJobs: 1 } }; },
      generateImage: async request => { imageCalls.push({ runId: request.runId, variants: request.deliverable.variants }); return Array.from({ length: request.deliverable.variants }, (_, index) => ({ title: `QA FIXTURE image ${index + 1}`, png, receipt: { provider: 'native-qa-fixture', costUsd: 0, paid: false } })); },
      capabilities: () => ({ imagesConfigured: true, googleConfigured: false, googlePublishConfigured: false }),
      importSource: async () => ({ title: 'QA imported source', text: 'QA FIXTURE: Imported document about reporting workflows.', evidence: [] }),
      openFile: async target => { assert.ok(target.startsWith(dataDir)); return true; },
      cancelProvider: async () => true,
    }) };
  }
  if (name === 'electron-updater') return { autoUpdater: null };
  if (name === 'child_process' || name === 'node:child_process') { const child = { ...originalLoad.apply(this, arguments) }; for (const method of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) child[method] = () => { cliCalls += 1; throw new Error('No CLI calls in native fixture.'); }; return child; }
  return originalLoad.apply(this, arguments);
};
const denyNetwork = () => { networkCalls += 1; throw new Error('No network calls in native fixture.'); };
global.fetch = denyNetwork;
for (const protocol of ['node:http', 'node:https']) { const adapter = require(protocol); adapter.request = denyNetwork; adapter.get = denyNetwork; }
app.on('web-contents-created', (_, contents) => { contents.setBackgroundThrottling(false); contents.on('console-message', (_, details) => { if (details.level === 'error') failures.push(details.message); }); contents.on('did-fail-load', (_, code, description) => failures.push(`${code}: ${description}`)); });
app.whenReady().then(() => session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_, callback) => { networkCalls += 1; callback({ cancel: true }); }));
require('../out/main/index.js');
const evaluate = code => win.webContents.executeJavaScript(code, true);
const call = (method, payload) => evaluate(`window.apifyStudio[${JSON.stringify(method)}](${payload === undefined ? '' : JSON.stringify(payload)})`);
async function waitFor(code, label) { for (let index = 0; index < 180; index += 1) { if (await evaluate(code).catch(() => false)) return; await pause(70); } throw new Error(`Timed out waiting for ${label}`); }
async function click(label, scope = 'document') { const result = await evaluate(`(() => { const button = [...${scope}.querySelectorAll('button')].find(item => { const copy = item.cloneNode(true); copy.querySelectorAll('[aria-hidden=true]').forEach(node => node.remove()); return (item.getAttribute('aria-label') || copy.textContent.trim()) === ${JSON.stringify(label)}; }); if (!button || button.disabled) return false; button.click(); return true; })()`); assert.ok(result, `Clickable: ${label}`); await pause(90); }
async function activate(selector) { const result = await evaluate(`(() => { const item = document.querySelector(${JSON.stringify(selector)}); if (!item || item.disabled) return false; item.click(); return true; })()`); assert.ok(result, `Available: ${selector}`); await pause(90); }
async function fill(selector, value) { await evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) throw new Error('Missing: ' + ${JSON.stringify(selector)}); const prototype = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : element.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, ${JSON.stringify(value)}); element.dispatchEvent(new Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); })()`); await pause(90); }
async function shot(name, selector = '.content-studio') { await evaluate(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({ block: 'start' })`); await pause(180); await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'); await win.webContents.capturePage(undefined, { stayHidden: true }); await pause(80); fs.writeFileSync(path.join(screenshots, `${name}.png`), (await win.webContents.capturePage(undefined, { stayHidden: true })).toPNG()); }
async function fits(name) { const result = await evaluate('({ width: innerWidth, docWidth: document.documentElement.scrollWidth, mainWidth: document.querySelector(".main")?.scrollWidth || 0 })'); assert.ok(result.docWidth <= result.width, `${name}: no horizontal viewport overflow`); check(`layout-${name}`, result); }
const nav = name => click(name, '(document.querySelector(".cs-view-nav") || document.querySelector("nav[aria-label=Primary]"))');
async function run() {
  await app.whenReady(); for (let index = 0; index < 100; index += 1) { win = BrowserWindow.getAllWindows()[0]; if (win) break; await pause(80); } assert.ok(win);
  win.setSize(1380, 940);
  await waitFor('Boolean(window.apifyStudio && document.querySelector(".content-studio"))', 'native content studio');
  assert.equal((await call('appMeta')).dataRoot, dataDir);
  await shot('general-overview'); await fits('general-overview'); check('real-preload-and-scoped-studio-service');
  assert.equal(await evaluate('document.querySelectorAll(".sidebar .shell-workspace-picker select").length'), 1);
  await click('Search platforms', 'document.querySelector("nav[aria-label=Primary]")');
  await waitFor('Boolean(document.querySelector(".search-workspace"))', 'General search page');
  await shot('workspace-switch-general-search', '.workspace');
  await fill('select[aria-label="Content workspace"]', 'semrush');
  await waitFor('document.querySelector(".app-shell")?.dataset.edition === "semrush"', 'return to Semrush from Search');
  assert.equal(await evaluate('document.querySelector(".sidebar select").value'), 'semrush');
  await shot('workspace-switch-semrush-search', '.workspace');
  await fill('select[aria-label="Content workspace"]', 'general');
  await waitFor('document.querySelector(".app-shell")?.dataset.edition === "general"', 'switch back to General');
  await click('Content studio', 'document.querySelector("nav[aria-label=Primary]")');
  await waitFor('Boolean(document.querySelector(".content-studio"))', 'return to content studio');
  check('persistent-workspace-switcher-on-search');
  await fill('select[aria-label="Content workspace"]', 'semrush');
  await waitFor('document.querySelector(".content-studio")?.dataset.edition === "semrush"', 'Semrush edition');
  await shot('semrush-overview');
  assert.equal(await evaluate('document.querySelector(".app-shell").dataset.edition'), 'semrush');
  assert.deepEqual(await evaluate('[...document.querySelectorAll("nav[aria-label=Primary] > .nav-group:first-child button")].map(button => button.textContent)'), ['Overview', 'Research programs', 'Create content', 'Library', 'Brand knowledge']);
  assert.equal(await evaluate('document.querySelector(".semrush-wordmark").getAttribute("alt")'), 'Semrush');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".app-shell")).getPropertyValue("--accent").trim()'), '#c190ff');
  check('focused-semrush-2026-shell');
  await nav('Brand knowledge'); await fill('#cs-knowledge-audience', 'QA fixture: enterprise marketing teams'); await fill('#cs-knowledge-voice', 'QA fixture: direct, source-linked, practical.');
  await click('Save brand knowledge');
  await waitFor('!document.querySelector(".cs-action-status")', 'knowledge saved');
  assert.equal((await call('state')).contentStudio.workspaces.find(item => item.id === 'semrush').knowledge.audience, 'QA fixture: enterprise marketing teams');
  await shot('semrush-knowledge', '.cs-knowledge-form'); check('workspace-knowledge-save');
  await click('Settings', 'document.querySelector("nav[aria-label=Preferences]")');
  await waitFor('Boolean(document.querySelector("#settings-image-key"))', 'image Settings');
  assert.equal(await evaluate('document.querySelector("#settings-image-key").type'), 'password');
  assert.equal((await call('state')).keys.OPENAI_API_KEY, false);
  assert.equal(imageAccessChecks.length, 0);
  await fill('#settings-image-key', syntheticImageCredential); await click('Save image key');
  await waitFor('document.querySelector("#settings-image-key")?.value === "" && document.querySelector(".settings-images")?.textContent.includes("Credential saved")', 'saved image credential field clearing');
  const keyState = await call('state'); assert.equal(keyState.keys.OPENAI_API_KEY, true); assert.equal(typeof keyState.keys.OPENAI_API_KEY, 'boolean');
  const configText = fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8');
  assert.equal(configText.includes(syntheticImageCredential), false, 'Fixture credential is not stored as plaintext');
  assert.equal(JSON.parse(configText).keys.OPENAI_API_KEY.encrypted, true);
  assert.equal(JSON.stringify(keyState).includes(syntheticImageCredential), false, 'Public state contains credential presence only');
  assert.equal(imageAccessChecks.length, 0, 'Saving does not perform an access check');
  await click('Check image access');
  await waitFor('document.querySelector(".settings-image-receipt")?.textContent.includes("Image model access confirmed")', 'image access receipt');
  assert.equal(imageAccessChecks.length, 1); assert.equal(imageAccessChecks[0].generationVerified, false);
  assert.ok((await evaluate('document.querySelector(".settings-image-receipt").textContent')).includes('No image was generated by this check'));
  assert.equal(imageCalls.length, 0, 'Connection setup never generates an image');
  await shot('settings-images', '.settings-images'); await fits('settings-images-normal');
  win.setSize(760, 940); await pause(120); await shot('settings-images-compact', '.settings-images'); await fits('settings-images-compact'); win.setSize(1380, 940); await pause(120);
  await click('Remove saved key');
  await waitFor('document.querySelector(".settings-images")?.textContent.includes("Setup needed") && !document.querySelector(".settings-image-receipt")', 'image credential removed');
  assert.equal((await call('state')).keys.OPENAI_API_KEY, false);
  const removedConfig = JSON.parse(fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8')); assert.equal(removedConfig.keys.OPENAI_API_KEY, undefined); assert.equal(removedConfig.disabledKeys.OPENAI_API_KEY, true);
  assert.equal(await evaluate('[...document.querySelectorAll(".settings-images button")].find(button => button.textContent.trim() === "Check image access").disabled'), true);
  check('image-settings-secure-save-access-check-remove', { credentialStoredEncrypted: true, publicCredentialPresenceOnly: true, accessVerified: true, generationVerified: false, accessChecks: imageAccessChecks.length });
  await nav('Create content'); await fill('#cs-source-title', 'QA reporting workflow trend'); await fill('#cs-source-text', 'QA FIXTURE: Marketing teams report manual campaign reporting work. This sample exercises the content workflow; it is not market evidence.');
  await shot('content-source-brief', '.cs-create-layout');
  await click('Choose deliverables', 'document.querySelector(".cs-wizard-footer")');
  await waitFor('[...document.querySelectorAll("input[type=checkbox]")].some(item => item.getAttribute("aria-label") === "Evidence report")', 'deliverable catalog');
  await activate('input[aria-label="Evidence report"]'); await activate('input[aria-label="Social captions and thread"]');
  await shot('semrush-reference', '.content-studio'); await shot('semrush-deliverables', '.cs-create-layout'); await fits('deliverables-normal');
  win.setSize(760, 940); await pause(120); await shot('semrush-compact', '.cs-create-layout'); await fits('semrush-compact'); win.setSize(1380, 940); await pause(120);
  await click('Review generation'); await fill('#cs-content-budget', '2.00');
  await shot('content-review', '.cs-create-layout');
  await click('Generate drafts');
  await waitFor('document.querySelector(".cs-run-detail")?.textContent.includes("Drafts ready to review and export.")', 'native completed content run');
  let state = (await call('state')).contentStudio;
  assert.equal(state.contentRuns.length, 1); assert.equal(state.contentRuns[0].status, 'succeeded'); assert.equal(state.assets.length, 2); assert.equal(aiCalls.length, 2);
  assert.deepEqual(state.contentRuns[0].jobs.map(job => job.id).sort(), ['evidence-report', 'social']);
  await shot('content-output-progress', '.cs-run-detail'); check('source-to-selected-content-jobs', { writtenAssets: 2, modelFixtureCalls: 2 });
  await nav('Library'); await waitFor('Boolean(document.querySelector(".cs-asset-preview .markdown-content h1"))', 'saved Markdown asset preview');
  await shot('library-written-preview', '.cs-library-layout');
  await click('Export pack'); await waitFor('!document.querySelector(".cs-action-status")', 'export receipt');
  const savedState = JSON.parse(fs.readFileSync(path.join(dataDir, 'content-studio', 'state.json'), 'utf8'));
  assert.equal(savedState.exports.length, 1); const manifest = JSON.parse(fs.readFileSync(path.join(savedState.exports[0].path, 'manifest.json'), 'utf8')); assert.equal(manifest.assets.length, 2); check('persisted-preview-and-export-manifest', { assets: 2, exportPath: savedState.exports[0].path });
  await click('Create from this'); await waitFor('document.querySelector("#cs-source-text")?.value.includes("QA FIXTURE")', 'report asset handoff');
  assert.ok((await evaluate('document.querySelector(".cs-source-meta").textContent')).includes('evidence records attached')); check('saved-report-to-content-handoff');
  await fill('select[aria-label="Content workspace"]', 'general'); await waitFor('document.querySelector(".content-studio")?.dataset.edition === "general"', 'General workspace isolation');
  assert.equal(await evaluate('document.querySelector("#cs-source-title").value'), ''); check('source-draft-workspace-isolation');
  await nav('Library'); assert.ok((await evaluate('document.querySelector(".content-studio").textContent')).includes('Make something worth sharing')); assert.equal((await call('state')).contentStudio.assets.length, 0); check('general-semrush-asset-isolation');
  await nav('Research programs'); await fill('#cs-program-name', 'QA recurring reporting pulse'); await fill('#cs-program-query', 'reporting friction');
  await activate('.cs-source-group:nth-child(1) input[type="checkbox"]'); await fill('#cs-targets-reddit', 'r/marketing\nr/SaaS');
  await activate('.cs-source-group:nth-child(2) input[type="checkbox"]'); await fill('#cs-targets-x', '@apify\n@NASA');
  await activate('#cs-source-options-reddit summary'); await activate('#cs-source-reddit-includeComments'); await fill('#cs-source-reddit-maxComments', '3');
  await activate('#cs-source-options-x summary'); await fill('#cs-source-x-replies', 'exclude'); await fill('#cs-source-x-media', 'images');
  await fill('#cs-window-start', '2026-09-01'); await fill('#cs-window-end', '2026-09-27');
  await shot('research-program-source-lists', '.cs-program-editor');
  assert.equal(await evaluate('document.querySelector("#cs-schedule-frequency").value'), 'manual');
  await fill('#cs-schedule-frequency', 'daily');
  assert.equal(await evaluate('document.querySelector("#cs-schedule-lookback").value'), '1');
  assert.equal(await evaluate('document.querySelector(".cs-schedule-consent input").checked'), false);
  await shot('research-schedule-daily', '.cs-schedule-fields');
  await fill('#cs-schedule-frequency', 'monthly'); await fill('#cs-schedule-monthday', '31');
  assert.equal(await evaluate('document.querySelector("#cs-schedule-lookback").value'), '30');
  await shot('research-schedule-monthly', '.cs-schedule-fields');
  await fill('#cs-schedule-frequency', 'weekly'); await fill('#cs-schedule-weekday', '1'); await fill('#cs-schedule-time', '09:00'); await fill('#cs-schedule-zone', 'America/New_York');
  await activate('.cs-schedule-consent input');
  await shot('research-schedule-weekly', '.cs-schedule-fields');
  win.setSize(760, 940); await pause(120); await shot('research-schedule-compact', '.cs-schedule-fields'); await fits('research-schedule-compact'); win.setSize(1380, 940);
  await click('Save research program'); await waitFor('Boolean(document.querySelector(".cs-research-layout"))', 'saved program');
  let scheduledProgram = (await call('state')).contentStudio.programs[0];
  assert.equal(scheduledProgram.schedule.enabled, true); assert.equal(scheduledProgram.schedule.frequency, 'weekly'); assert.ok(Date.parse(scheduledProgram.schedule.nextRunAt) > Date.now());
  await shot('research-schedule-saved', '.cs-program-schedule');
  await click('Pause schedule'); await waitFor('document.querySelector(".cs-program-schedule")?.textContent.includes("Schedule is paused")', 'paused schedule');
  assert.equal((await call('state')).contentStudio.programs[0].schedule.enabled, false);
  await click('Resume schedule'); await waitFor('document.querySelector(".cs-program-schedule")?.textContent.includes("Schedule is on")', 'resumed schedule');
  assert.equal((await call('state')).contentStudio.programs[0].schedule.enabled, true);
  check('daily-weekly-monthly-save-pause-resume', { externalCalls: networkCalls, collectionCallsBeforeRun: collectionCalls.length });
  assert.equal(collectionCalls.length, 0);
  await click('Edit program'); await fill('#cs-schedule-frequency', 'manual');
  assert.equal(await evaluate('document.querySelector("#cs-window-start").value'), '2026-09-01');
  assert.equal(await evaluate('document.querySelector("#cs-window-end").value'), '2026-09-27');
  await click('Save research program'); await waitFor('Boolean(document.querySelector(".cs-research-layout"))', 'manual schedule restored');
  await click('Start research'); await waitFor('Boolean(document.querySelector(".cs-theme-review"))', 'real discovery and theme review');
  state = (await call('state')).contentStudio; assert.equal(state.researchRuns[0].status, 'awaiting-review'); assert.equal(state.researchRuns[0].counts.retained, 6); assert.equal(collectionCalls[0].targets.find(group => group.sourceId === 'reddit').options.maxComments, 3); assert.equal(collectionCalls[0].targets.find(group => group.sourceId === 'x').options.replies, 'exclude');
  await fill('#cs-theme-name-0', 'QA reviewed reporting theme'); await shot('research-theme-review', '.cs-run-detail');
  await click('Approve themes & build reports');
  await waitFor('document.querySelector(".cs-run-detail")?.textContent.includes("Classification complete")', 'classification and paired reports');
  state = (await call('state')).contentStudio; assert.equal(state.researchRuns[0].status, 'succeeded'); assert.equal(state.assets.length, 2); assert.equal(state.researchRuns[0].themes[0].name, 'QA reviewed reporting theme');
  assert.ok((await evaluate('document.querySelector(".cs-run-assets").textContent')).includes('Create content')); check('bulk-program-discovery-review-classification-report-pair', { retained: 6, assets: 2 });
  await shot('research-completed-reports', '.cs-run-detail');
  await nav('Create content'); await click('Import document'); await waitFor('document.querySelector("#cs-source-title")?.value === "QA imported source"', 'document import');
  await click('Choose deliverables', 'document.querySelector(".cs-wizard-footer")'); await activate('input[aria-label="Brand campaign graphic"]'); await fill('#cs-image-variants', '1'); await click('Review generation'); await click('Generate drafts');
  await waitFor('document.querySelector(".cs-run-detail")?.textContent.includes("Drafts ready to review and export.")', 'image generation fixture');
  assert.equal(imageCalls.length, 1); await nav('Library'); await fill('select[aria-label="Asset type"]', 'image'); await waitFor('Boolean(document.querySelector(".cs-generated-image img"))', 'saved PNG preview'); assert.match(await evaluate('document.querySelector(".cs-generated-image img").src'), /^data:image\/png;base64,/); check('image-request-and-actual-png-preview', { fixtureVariants: 1 });
  win.setSize(760, 740); await nav('Create content'); await shot('create-content-compact', '.cs-create-layout'); await fits('create-compact');
  await activate('#cs-create-tab-1'); await shot('deliverables-compact', '.cs-create-layout'); await fits('deliverables-compact');
  await nav('Research programs'); await shot('research-compact', '.cs-research-layout'); await fits('research-compact');
  await fill('select[aria-label="Content workspace"]', 'semrush');
  await waitFor('document.querySelector(".app-shell")?.dataset.edition === "semrush"', 'Semrush secondary screens');
  if (await evaluate('document.querySelector(".more-toggle")?.getAttribute("aria-expanded") !== "true"')) await click('More tools', 'document.querySelector("nav[aria-label=Primary]")');
  for (const [label, name] of [['Search platforms', 'semrush-search'], ['Datasets', 'semrush-datasets'], ['AI reports', 'semrush-reports'], ['Playbooks', 'semrush-playbooks'], ['Content board', 'semrush-board']]) {
    await click(label, 'document.querySelector("nav[aria-label=Primary]")'); await pause(120); await shot(name, '.content'); await fits(name);
  }
  await click('Overview', 'document.querySelector("nav[aria-label=Primary] > .nav-group:first-child")');
  await shot('semrush-overview-final');
  assert.equal(networkCalls, 0); assert.equal(cliCalls, 0); assert.deepEqual(failures, []);
  receipt.status = 'passed'; receipt.finishedAt = new Date().toISOString(); receipt.nativeBridge = true;
}
function writeReceipt() { Object.assign(receipt, { networkCalls, cliCalls, aiCalls, collectionCalls, imageCalls, imageAccessChecks, failures }); fs.writeFileSync(path.join(dataDir, 'receipt.json'), JSON.stringify(receipt, null, 2)); }
const timeout = setTimeout(() => { receipt.status = 'timeout'; writeReceipt(); console.error(JSON.stringify(receipt)); app.exit(1); }, 150000);
run().then(() => { clearTimeout(timeout); writeReceipt(); console.log(JSON.stringify({ ...receipt, receiptPath: path.join(dataDir, 'receipt.json') }, null, 2)); app.exit(0); }).catch(async error => { clearTimeout(timeout); await shot('failure').catch(() => {}); receipt.status = 'failed'; receipt.error = error.stack || error.message; writeReceipt(); console.error(JSON.stringify(receipt, null, 2)); app.exit(1); });
