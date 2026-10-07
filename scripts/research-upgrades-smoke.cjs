// Disposable native research smoke. No credentials, paid calls, or real user data.
// Run after npm run build: node_modules/.bin/electron scripts/research-upgrades-smoke.cjs
const { app, BrowserWindow, ipcMain, shell, session } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scraper-research-upgrades-'));
const screenshots = path.join(dataDir, 'screenshots');
const reportDir = path.join(dataDir, 'workspaces', 'default', 'qa-report');
fs.mkdirSync(screenshots); fs.mkdirSync(reportDir, { recursive: true }); fs.mkdirSync(path.join(dataDir, 'datasets'));
app.setPath('userData', dataDir);
const beforeDate = '2026-09-20T12:00:00.000Z';
const currentDate = '2026-09-27T12:00:00.000Z';
const page = (id, slug, text) => ({ id, type: 'page', platform: 'web', author: 'QA fixture source', text: `QA FIXTURE. ${text}`, url: `https://example.com/${slug}`, publishedAt: '2026-09-19T12:00:00Z', metrics: {} });
const beforeItems = [page('qa-before:pricing', 'pricing', 'The sample plan is $10.'), page('qa-before:features', 'features', 'Shared reporting tools.'), page('qa-before:faq', 'faq', 'A sample FAQ page.')];
const currentItems = [page('qa-current:pricing', 'pricing', 'The sample plan is $15.'), page('qa-current:features', 'features', 'Shared reporting tools.')];
const requestedUrls = beforeItems.map(item => item.url);
const baseline = { id: 'qa-baseline', name: 'QA FIXTURE · earlier competitor pages', platform: 'web', recipeId: 'qa-recipe', itemCount: 3, createdAt: beforeDate, collectionScope: { requestedUrls, returnedRows: 3, retrievalLimit: 15, collectedAt: beforeDate } };
const current = { ...baseline, id: 'qa-current', name: 'QA FIXTURE · current competitor pages', itemCount: 2, createdAt: currentDate, collectionScope: { ...baseline.collectionScope, returnedRows: 2, collectedAt: currentDate } };
const output = { title: 'QA FIXTURE — sample competitor report', summary: 'Fixture-only observation: the saved pricing page states $15. This does not establish real market pricing.', bullets: ['QA FIXTURE evidence only: qa-current:pricing'], opportunities: ['Validate real sources before acting.'], risks: ['One requested page is unavailable.'], recommendedNextSteps: ['Review the saved sample before approval.'], markdownReport: '# QA FIXTURE — sample competitor report\n\nThis report is seeded test data. **No AI request was made.**\n\n## Observation\nThe saved [pricing page](https://example.com/pricing) states $15. Source: `qa-current:pricing`.\n\n## Limits\nThe FAQ capture is unavailable, not confirmed removed. Only the pricing record was included in the recorded report sample.' };
const reportPath = path.join(reportDir, 'report.md');
const outputPath = path.join(reportDir, 'report.json');
const itemsPath = path.join(reportDir, 'items.jsonl');
fs.writeFileSync(reportPath, output.markdownReport);
fs.writeFileSync(outputPath, JSON.stringify(output));
fs.writeFileSync(itemsPath, currentItems.map(item => JSON.stringify(item)).join('\n'));
for (const [dataset, items] of [[baseline, beforeItems], [current, currentItems]]) fs.writeFileSync(path.join(dataDir, 'datasets', `${dataset.id}.json`), JSON.stringify({ items, rawItems: items }));
const analysis = { id: 'qa-report', datasetId: current.id, projectId: 'default', datasetSnapshot: current, kind: 'report', reportPresetId: 'competitor-positioning', reportPresetName: 'QA FIXTURE · competitor positioning', status: 'succeeded', startedAt: currentDate, finishedAt: currentDate, reportPath, outputPath, itemsPath, includedItemIds: ['qa-current:pricing'], coverage: { includedItems: 1, availableItems: 2, omittedItems: 1, truncatedItems: 0 }, aiReceipt: { provider: 'qa-fixture', actualModel: 'QA fixture — no AI call', costUsd: null } };
fs.writeFileSync(path.join(dataDir, 'data.json'), JSON.stringify({ recipes: [{ id: 'qa-recipe', name: 'QA FIXTURE · competitor pages', platform: 'web', actorId: 'apify/website-content-crawler', taskId: '', input: { startUrls: requestedUrls.map(url => ({ url })) }, mapper: {} }], datasets: [current, baseline], analyses: [analysis], settings: { aiProvider: 'claude', aiModel: 'claude-opus-5-5', aiMaxBudgetUsd: 1, maxItems: 1000 }, projects: [{ id: 'default', name: 'QA fixture workspace' }], runs: [], cards: [], assets: [], brandProfiles: [], researchReviews: [], researchAudit: [], researchExports: [], monitors: [], comparisons: [] }));

// Guard external-service entrypoints, retaining the real preload and all research handlers.
let serviceCalls = 0, networkCalls = 0, revealCalls = 0;
const paidChannels = new Set(['run-recipe', 'test-recipe', 'search-sources', 'ask-findings', 'analyze-dataset', 'generate-assets', 'run-mission', 'run-action-graph', 'run-intent', 'run-intent-action', 'refresh-apify-actors', 'discover-apify-resource', 'check-ai', 'check-codex', 'test-sheets-bridge', 'archive-and-clear-sheets', 'import-working-sheets', 'export-dataset-to-sheets', 'replay-sheet-run']);
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, handler) => handle(channel, (event, ...args) => {
  if (paidChannels.has(channel)) { serviceCalls += 1; throw new Error(`External service is forbidden in fixture smoke: ${channel}`); }
  return handler(event, ...args);
});
shell.showItemInFolder = () => { revealCalls += 1; };
for (const key of ['APIFY_API_TOKEN', 'GOOGLE_SHEETS_WEBHOOK_URL', 'APIFY_STUDIO_AUTO_UPDATE_URL']) delete process.env[key];
const failures = [];
const receipt = { fixtureOnly: true, startedAt: new Date().toISOString(), dataDir, screenshots, checks: [] };
const check = (name, details = {}) => { receipt.checks.push({ name, ...details }); };
app.on('web-contents-created', (_, contents) => {
  contents.setBackgroundThrottling(false);
  contents.on('console-message', (_, details) => { if (details.level === 'error') failures.push(details.message); });
  contents.on('did-fail-load', (_, code, description) => failures.push(`${code}: ${description}`));
});
app.whenReady().then(() => session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_, callback) => { networkCalls += 1; callback({ cancel: true }); }));
require('../out/main/index.js');
let win;
const pause = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const evaluate = (code) => win.webContents.executeJavaScript(code, true);
const call = (method, payload) => evaluate(`window.apifyStudio[${JSON.stringify(method)}](${payload === undefined ? '' : JSON.stringify(payload)})`);
async function waitFor(code, label) {
  for (let index = 0; index < 100; index += 1) { if (await evaluate(code).catch(() => false)) return; await pause(80); }
  throw new Error(`Timed out waiting for ${label}`);
}
async function click(label, scope = 'document') {
  const clicked = await evaluate(`(() => { const button = [...${scope}.querySelectorAll('button')].find(item => (item.getAttribute('aria-label') || item.textContent.trim()) === ${JSON.stringify(label)}); if(!button || button.disabled) return false; button.click(); return true; })()`);
  assert.ok(clicked, `Available button: ${label}`); await pause(100);
}
async function fill(selector, value) {
  await evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); if(!element) throw new Error('Missing input: ' + ${JSON.stringify(selector)}); const prototype = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : element.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, ${JSON.stringify(value)}); element.dispatchEvent(new Event(element.tagName === 'SELECT' ? 'change' : 'input', {bubbles:true})); })()`);
  await pause(100);
}
async function navigate(label) {
  if (!await evaluate(`Boolean(document.querySelector('nav[aria-label=Primary] button[aria-label=${JSON.stringify(label)}]'))`).catch(() => false)) {
    const closed = await evaluate('document.querySelector(".more-toggle")?.getAttribute("aria-expanded") === "false"');
    if (closed) await click('More tools');
  }
  await click(label, "document.querySelector('nav[aria-label=Primary]')");
}
async function shot(name, selector) {
  if (selector) await evaluate(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'start'})`);
  await pause(250);
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const capture = () => Promise.race([win.webContents.capturePage(undefined, { stayHidden: true }), new Promise((_, reject) => setTimeout(() => reject(new Error('Screenshot timed out')), 8000))]);
  await capture(); await pause(80);
  fs.writeFileSync(path.join(screenshots, `${name}.png`), (await capture()).toPNG());
}
async function assertNoOverflow(label) {
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, `${label}: page fits the compact window`);
  check(`compact-${label}`);
}

async function run() {
  await app.whenReady();
  for (let index = 0; index < 100; index += 1) { win = BrowserWindow.getAllWindows()[0]; if (win) break; await pause(80); }
  assert.ok(win, 'Native Electron window exists');
  win.setSize(1380, 920);
  await waitFor('Boolean(window.apifyStudio && document.querySelector(".home-view"))', 'real preload and overview');
  assert.equal((await call('appMeta')).dataRoot, dataDir);
  assert.equal((await call('state')).keys.APIFY_API_TOKEN, false);

  await navigate('Playbooks');
  await waitFor('document.querySelectorAll(".playbook-card").length === 8', 'eight playbooks');
  await shot('playbooks'); check('eight-playbooks', { count: 8 });
  await navigate('Brand context');
  await fill('#brand-profile-name', 'QA FIXTURE Brand');
  await fill('#brand-profile-offering', 'QA fixture research software. No actual commercial claim.');
  await fill('#brand-profile-audience', 'QA marketing researchers');
  await fill('#brand-profile-icp', 'QA enterprise teams with a documented research process.');
  await fill('#brand-profile-forbiddenClaims', 'No invented performance metrics.');
  await click('Save profile');
  await waitFor('document.querySelector(".brand-context-notice")?.textContent.includes("saved")', 'saved brand');
  const brandState = await call('state'); const brand = brandState.brandProfiles[0];
  assert.equal(brandState.settings.selectedBrandProfileId, brand.id); assert.equal(brand.name, 'QA FIXTURE Brand');
  await shot('brand-profile', '.brand-context-heading');
  await navigate('Playbooks'); await click('Set up collection: Competitor positioning brief');
  await waitFor('Boolean(document.querySelector("#marketing-brand-profile"))', 'profile picker');
  await fill('#marketing-brand-profile', brand.id);
  assert.equal(await evaluate('document.querySelector("#marketing-brand").value'), brand.name);
  assert.equal(await evaluate('document.querySelector("#marketing-audience").value'), brand.audience);
  check('brand-save-and-reuse', { profileId: brand.id });

  await navigate('Import research');
  await waitFor('Boolean(document.querySelector("#import-content"))', 'import form');
  const csv = 'text,url,author\n"QA FIXTURE: We need easier reporting.",https://example.com/feedback,"QA customer"\n"QA FIXTURE: We need easier reporting.",https://example.com/feedback,"QA customer"';
  await fill('.import-setup input', 'QA FIXTURE · imported customer feedback');
  await evaluate('document.querySelector("input[value=customer-feedback]").click()');
  await fill('#import-content', csv);
  await click('Preview records');
  await waitFor('Boolean(document.querySelector(".import-preview"))', 'mapped preview');
  assert.match(await evaluate('document.querySelector(".import-preview").textContent'), /1 record ready/);
  assert.equal(await evaluate('[...document.querySelectorAll("button")].find(button=>button.textContent.includes("Add to research")).disabled'), true);
  await shot('import-preview', '.import-preview');
  await evaluate('document.querySelector(".import-authorization input").click()'); await click('Add to research');
  await waitFor('Boolean(document.querySelector(".import-complete"))', 'import saved');
  const imported = (await call('state')).datasets.find(dataset => dataset.platform === 'import');
  assert.equal(imported.itemCount, 1); assert.equal(imported.brandContext.profileId, brand.id);
  assert.equal(imported.importMetadata.duplicateRows, 1); assert.equal((await call('readDataset', imported.id)).items[0].text, 'QA FIXTURE: We need easier reporting.');
  check('csv-preview-acknowledgment-import', { datasetId: imported.id, duplicatesExcluded: 1, brandReused: true });

  await navigate('Compare snapshots'); await waitFor('Boolean(document.querySelector(".snapshot-picker"))', 'comparison');
  await fill('select[aria-label="Earlier baseline"]', baseline.id); await fill('select[aria-label="Current snapshot"]', current.id);
  await click('Compare snapshots', "document.querySelector('.snapshot-picker')"); await waitFor('Boolean(document.querySelector(".snapshot-results"))', 'comparison result');
  const compared = (await call('state')).comparisons[0];
  assert.equal(compared.summary.changed, 1); assert.equal(compared.summary.unavailable, 1); assert.equal(compared.summary.unchanged, 1);
  assert.equal(compared.comparisonDataset.itemCount, 3);
  const derived = await call('readDataset', compared.comparisonDataset.id);
  assert.ok(derived.items.some(item => item.text.includes('$10') && item.text.includes('$15')));
  await shot('comparison', '.snapshot-results');
  await click('Draft change brief'); await waitFor('Boolean(document.querySelector(".report-builder"))', 'change-brief preset');
  assert.equal(await evaluate('document.querySelectorAll(".report-field select")[0].value'), compared.comparisonDataset.id);
  assert.equal(await evaluate('document.querySelectorAll(".report-field select")[1].value'), 'weekly-competitor-changes');
  check('comparison-and-derived-brief', { comparisonId: compared.id, changed: 1, unavailable: 1, derivedDatasetId: compared.comparisonDataset.id });

  await fill('.report-builder .report-field select', current.id);
  await waitFor('Boolean(document.querySelector(".coverage-review"))', 'saved QA report review');
  await shot('report-body', '.report-reader');
  const bundle = await call('readResearchReview', analysis.id);
  assert.equal(bundle.coverage.counts.total, 2); assert.equal(bundle.coverage.counts.included, 1);
  assert.equal(bundle.coverage.missingUrls.length, 1); assert.equal(bundle.evidence.length, 2);
  await assert.rejects(call('saveResearchReview', { analysisId: analysis.id, status: 'approved', reviewer: 'QA reviewer', expectedFingerprint: bundle.fingerprint, evidenceChecked: false, limitationsAccepted: false, acknowledgedWarnings: [] }), /review checks|coverage limitation/);
  await shot('report-review', '.coverage-review');
  await click('Inspect evidence (2)');
  await waitFor('Boolean(document.querySelector(".review-source-detail"))', 'source drawer');
  assert.match(await evaluate('document.querySelector(".review-source-detail").textContent'), /QA FIXTURE/);
  const sourceTextColors = await evaluate('[...document.querySelectorAll(".review-source-list strong, .review-source-list span")].map(element => getComputedStyle(element).color)');
  assert.ok(sourceTextColors.length > 0 && sourceTextColors.every(color => color !== 'rgb(255, 255, 255)'), 'Source list text remains readable on pale cards');
  await shot('report-source-drawer', '.review-evidence');
  await fill('.review-form input[type=text], .review-form input:not([type])', 'QA reviewer — fixture only');
  await fill('.review-form textarea', 'QA fixture approval exercises the workflow only. No real research claim was reviewed.');
  assert.equal(await evaluate('[...document.querySelectorAll("button")].find(button => button.textContent.trim() === "Export Markdown").disabled'), true, 'Unsaved review edits block export');
  await evaluate('[...document.querySelectorAll(".coverage-review input[type=checkbox]")].forEach(input => { if(!input.checked) input.click(); })');
  await waitFor('[...document.querySelectorAll("button")].some(button => button.textContent.trim() === "Approve locally" && !button.disabled)', 'review gate');
  await click('Approve locally');
  await waitFor('document.querySelector(".review-notice")?.textContent.includes("Approved locally")', 'approved receipt');
  assert.equal((await call('state')).researchReviews[0].status, 'approved');
  await shot('report-approved', '.review-save-row');
  await click('Export Markdown');
  await waitFor('document.querySelector(".review-notice")?.textContent.includes("Exported approved")', 'approved Markdown export');
  const exportState = await call('state'); const exported = exportState.researchExports[0];
  assert.equal(exported.reviewStatus, 'approved'); assert.equal(exported.localReviewOnly, true);
  const markdown = fs.readFileSync(exported.path, 'utf8');
  assert.match(markdown, /APPROVED.*LOCAL REVIEW/); assert.match(markdown, /QA FIXTURE/);
  assert.ok(fs.existsSync(path.join(exported.folder, 'evidence.csv'))); assert.ok(fs.existsSync(path.join(exported.folder, 'receipt.json')));
  assert.equal(revealCalls, 1); check('coverage-source-review-approved-export', { analysisId: analysis.id, included: 1, loaded: 2, exportPath: exported.path });
  await click('Export printable HTML');
  await waitFor('document.querySelector(".review-notice")?.textContent.includes("Exported approved")', 'approved HTML export');
  const htmlExport = (await call('state')).researchExports.find(item => item.path.endsWith('.html'));
  assert.ok(htmlExport); assert.equal(revealCalls, 2);
  const studioWindow = win;
  const exportWindow = new BrowserWindow({ show: false, width: 1040, height: 900, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
  await exportWindow.loadFile(htmlExport.path); win = exportWindow;
  assert.match(await evaluate('document.body.textContent'), /APPROVED.*LOCAL REVIEW/);
  assert.match(await evaluate('document.body.textContent'), /QA FIXTURE/);
  await shot('approved-export-html');
  await shot('approved-export-evidence', 'body > article');
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, 'Approved HTML export fits its page');
  check('approved-html-render', { exportPath: htmlExport.path });
  win = studioWindow; exportWindow.destroy();

  win.setSize(760, 700); await pause(150);
  await shot('report-source-compact', '.review-evidence'); await assertNoOverflow('report-source');
  await navigate('Playbooks'); await shot('playbooks-compact'); await assertNoOverflow('playbooks');
  await navigate('Brand context'); await shot('brand-profile-compact'); await assertNoOverflow('brand');
  await navigate('Import research'); await fill('#import-content', csv); await click('Preview records');
  await waitFor('Boolean(document.querySelector(".import-preview"))', 'compact import preview');
  await shot('import-preview-compact', '.import-preview'); await assertNoOverflow('import');
  await navigate('Compare snapshots'); await fill('select[aria-label="Earlier baseline"]', baseline.id); await fill('select[aria-label="Current snapshot"]', current.id); await click('Compare snapshots', "document.querySelector('.snapshot-picker')");
  await waitFor('Boolean(document.querySelector(".snapshot-results"))', 'compact comparison'); await shot('comparison-compact', '.snapshot-results'); await assertNoOverflow('comparison');
  assert.equal((await call('state')).comparisons.length, 1, 'Repeated comparison reused its saved result');
  assert.equal((await call('state')).runs.length, 0); assert.equal((await call('state')).analyses.length, 1);
  assert.equal(serviceCalls, 0); assert.equal(networkCalls, 0); assert.deepEqual(failures, []);
  receipt.status = 'passed'; receipt.finishedAt = new Date().toISOString(); receipt.externalServiceCalls = serviceCalls; receipt.networkCalls = networkCalls; receipt.nativeBridge = true;
}
const timeout = setTimeout(() => { receipt.status = 'timeout'; fs.writeFileSync(path.join(dataDir, 'receipt.json'), JSON.stringify(receipt, null, 2)); console.error(JSON.stringify(receipt)); app.exit(1); }, 120000);
run().then(() => { clearTimeout(timeout); fs.writeFileSync(path.join(dataDir, 'receipt.json'), JSON.stringify(receipt, null, 2)); console.log(JSON.stringify({ ...receipt, receiptPath: path.join(dataDir, 'receipt.json') }, null, 2)); app.exit(0); }).catch(error => { clearTimeout(timeout); receipt.status = 'failed'; receipt.error = error.message; receipt.externalServiceCalls = serviceCalls; receipt.networkCalls = networkCalls; fs.writeFileSync(path.join(dataDir, 'receipt.json'), JSON.stringify(receipt, null, 2)); console.error(JSON.stringify(receipt, null, 2)); app.exit(1); });
