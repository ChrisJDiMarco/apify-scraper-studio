// Native source-options smoke. Uses disposable state and the real renderer/preload/main.
// Only ApifyClient is replaced with a fixture; network, AI, and other service calls fail closed.
// Run after npm run build: node_modules/.bin/electron scripts/search-options-smoke.cjs
const { app, BrowserWindow, ipcMain, session } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scraper-search-options-'));
const screenshots = path.join(dataDir, 'screenshots');
fs.mkdirSync(screenshots);
app.setPath('userData', dataDir);
const catalog = require('../src/shared/source-catalog-data.json');
fs.writeFileSync(path.join(dataDir, 'data.json'), JSON.stringify({ projects: [{ id: 'default', name: 'QA fixture workspace' }], recipes: [], datasets: [], runs: [], analyses: [], apifyCatalog: { actors: catalog.map(source => ({ fullName: source.actorId, name: source.actorId, title: source.name })), syncedAt: new Date().toISOString() }, settings: { aiProvider: 'claude', aiModel: 'claude-opus-5-5', maxItems: 50 } }));
// A conspicuously fake token satisfies local configuration checks. It can never leave this process.
process.env.APIFY_API_TOKEN = 'fixture-only-no-credential';
for (const key of ['GOOGLE_SHEETS_WEBHOOK_URL', 'APIFY_STUDIO_AUTO_UPDATE_URL', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY']) delete process.env[key];
const providerStarts = [], datasetReads = [], searchRequests = [], previewResponses = [], externalDatasets = new Map();
let blockedServiceCalls = 0, networkCalls = 0, cliCalls = 0;
const failures = [];
const receipt = { fixtureOnly: true, startedAt: new Date().toISOString(), dataDir, screenshots, checks: [] };
const check = (name, details = {}) => receipt.checks.push({ name, ...details });
class FixtureApifyClient {
  actor(actorId) {
    return { start: async (input, options) => {
      const index = providerStarts.length + 1;
      const run = { id: `fixture-provider-run-${index}`, status: 'SUCCEEDED', defaultDatasetId: `fixture-provider-dataset-${index}`, buildId: 'fixture-only', usageTotalUsd: 0 };
      providerStarts.push({ actorId, input, options });
      const item = { id: `fixture-post-${index}`, dataType: 'post', type: 'post', body: 'QA FIXTURE: campaign reporting sample.', text: 'QA FIXTURE: campaign reporting sample.', content: 'QA FIXTURE: campaign reporting sample.', username: 'qa_fixture', author: { userName: 'qa_fixture', name: 'QA fixture' }, authorName: 'QA fixture', url: `https://example.com/fixture/${index}`, linkedinUrl: `https://example.com/fixture/${index}`, createdAt: '2026-09-26T12:00:00Z', postedAtISO: '2026-09-26T12:00:00Z', postedAt: { date: '2026-09-26T12:00:00Z' } };
      if (actorId === 'supreme_coder/linkedin-post') item.comments = [{ id: 'fixture-nested-comment', text: 'QA FIXTURE: an explicit source comment about campaign reporting.', authorName: 'QA commenter', replies: [{ id: 'fixture-nested-reply', text: 'QA FIXTURE: a nested reply with a specific reporting request.', authorName: 'QA reply author' }] }];
      externalDatasets.set(run.defaultDatasetId, actorId === 'harvestapi/linkedin-profile-posts' ? Array.from({ length: 12 }, (_, row) => ({ ...item, id: `fixture-profile-${row + 1}`, type: row < 2 ? 'post' : 'comment', content: `QA FIXTURE: ${row < 2 ? 'post' : 'comment'} ${row + 1}.`, linkedinUrl: `https://example.com/fixture/profile/${row + 1}` })) : [item]);
      return run;
    } };
  }
  dataset(datasetId) { return { listItems: async options => { datasetReads.push({ datasetId, options }); const all = externalDatasets.get(datasetId) || []; const items = all.slice(options.offset, options.offset + options.limit); return { items, count: items.length, total: all.length }; } }; }
}
const originalLoad = Module._load;
Module._load = function (name, parent, isMain) {
  if (name === 'apify-client') return { ApifyClient: FixtureApifyClient };
  if (name === 'electron-updater') return { autoUpdater: null };
  if (name === 'child_process' || name === 'node:child_process') {
    const childProcess = { ...originalLoad.apply(this, arguments) };
    for (const method of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) childProcess[method] = () => { cliCalls += 1; throw new Error('CLI calls are forbidden in fixture smoke.'); };
    return childProcess;
  }
  return originalLoad.apply(this, arguments);
};
const forbidNetwork = () => { networkCalls += 1; throw new Error('Network calls are forbidden in fixture smoke.'); };
global.fetch = forbidNetwork;
for (const protocol of ['node:http', 'node:https']) { const module = require(protocol); module.request = forbidNetwork; module.get = forbidNetwork; }
const serviceChannels = new Set(['refresh-apify-actors', 'discover-apify-resource', 'check-ai', 'check-codex', 'ask-findings', 'analyze-dataset', 'generate-assets', 'run-mission', 'run-action-graph', 'run-intent', 'run-intent-action', 'test-sheets-bridge', 'archive-and-clear-sheets', 'import-working-sheets', 'export-dataset-to-sheets', 'replay-sheet-run']);
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, handler) => handle(channel, (event, ...args) => {
  if (serviceChannels.has(channel)) { blockedServiceCalls += 1; throw new Error(`Service forbidden in fixture smoke: ${channel}`); }
  if (channel === 'search-sources') searchRequests.push(args[0]);
  if (channel === 'preview-search-sources') return Promise.resolve(handler(event, ...args)).then(result => { previewResponses.push({ request: args[0], result }); return result; });
  return handler(event, ...args);
});
app.on('web-contents-created', (_, contents) => {
  contents.setBackgroundThrottling(false);
  contents.on('console-message', (_, details) => { if (details.level === 'error') failures.push(details.message); });
  contents.on('did-fail-load', (_, code, description) => failures.push(`${code}: ${description}`));
});
app.whenReady().then(() => session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_, callback) => { networkCalls += 1; callback({ cancel: true }); }));
require('../out/main/index.js');
let win;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const evaluate = code => win.webContents.executeJavaScript(code, true);
const call = (method, payload) => evaluate(`window.apifyStudio[${JSON.stringify(method)}](${payload === undefined ? '' : JSON.stringify(payload)})`);
async function waitFor(code, label) { for (let index = 0; index < 120; index += 1) { if (await evaluate(code).catch(() => false)) return; await pause(80); } throw new Error(`Timed out waiting for ${label}`); }
async function click(label, scope = 'document') { const clicked = await evaluate(`(() => { const button = [...${scope}.querySelectorAll('button')].find(item => { const copy = item.cloneNode(true); copy.querySelectorAll('[aria-hidden=true]').forEach(node => node.remove()); return (item.getAttribute('aria-label') || copy.textContent.trim()) === ${JSON.stringify(label)}; }); if (!button || button.disabled) return false; button.click(); return true; })()`); assert.ok(clicked, `Available button: ${label}`); await pause(100); }
async function activate(selector) { const found = await evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); if(!element || element.disabled) return false; element.click(); return true; })()`); assert.ok(found, `Available control: ${selector}`); await pause(100); }
async function fill(selector, value) { await evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) throw new Error('Missing input: ' + ${JSON.stringify(selector)}); const prototype = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : element.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, ${JSON.stringify(value)}); element.dispatchEvent(new Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); })()`); await pause(90); }
async function checked(selector, value = true) { const found = await evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element || element.disabled) return false; if (element.checked !== ${value}) element.click(); return true; })()`); assert.ok(found, `Available checkbox: ${selector}`); await pause(80); }
async function shot(name, selector) { if (selector) await evaluate(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({ block: 'start' })`); await pause(250); await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'); const capture = () => Promise.race([win.webContents.capturePage(undefined, { stayHidden: true }), new Promise((_, reject) => setTimeout(() => reject(new Error('Screenshot timed out')), 8000))]); await capture(); await pause(80); fs.writeFileSync(path.join(screenshots, `${name}.png`), (await capture()).toPNG()); }
async function noOverflow(label) { const viewport = await evaluate('({ width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth })'); assert.ok(viewport.documentWidth <= viewport.width, `${label}: window fits without horizontal scroll`); check(`layout-${label}`, viewport); }

async function run() {
  await app.whenReady();
  for (let index = 0; index < 100; index += 1) { win = BrowserWindow.getAllWindows()[0]; if (win) break; await pause(80); }
  assert.ok(win, 'Native Electron window exists');
  win.setSize(1380, 920);
  await waitFor('Boolean(window.apifyStudio && document.querySelector(".home-view"))', 'real preload and overview');
  assert.equal((await call('appMeta')).dataRoot, dataDir);
  await click('Search platforms', "document.querySelector('nav[aria-label=Primary]')");
  await waitFor('Boolean(document.querySelector(".search-workspace"))', 'search workspace');
  await waitFor('Boolean(document.querySelector("#search-step-1"))', 'three-step search setup');
  assert.deepEqual(await evaluate('[...document.querySelectorAll(".search-tab-bar [role=tab]")].map(tab => tab.id)'), ['search-step-0', 'search-step-1', 'search-step-2']);
  await fill('#search-query', 'campaign reporting');
  await checked('#search-source-linkedin-profile');
  await shot('search-brief'); await noOverflow('brief-normal');
  check('source-selection-and-explicit-tabs', { selectedSources: 4 });
  const matchingOnly = await call('previewSearchSources', { query: 'campaign reporting', platformIds: ['reddit'], maxItems: 10, maxTotalChargeUsd: 0.1, sourceOptions: { reddit: { subreddits: 'marketing', searchComments: true, includeComments: false, maxComments: 5, commentStartDate: '2026-09-05' } } });
  assert.equal(matchingOnly.valid, true);
  assert.equal(matchingOnly.plan.recipes[0].input.searchComments, true);
  assert.equal(matchingOnly.plan.recipes[0].input.skipComments, true);
  assert.equal(Object.hasOwn(matchingOnly.plan.recipes[0].input, 'commentDateLimit'), false);
  assert.equal(providerStarts.length, 0);
  check('matching-comment-search-keeps-thread-expansion-off');

  await activate('#search-step-1');
  await fill('#search-reddit-subreddits', 'r/marketing, https://www.reddit.com/r/SaaS/');
  await fill('#search-reddit-time', 'month');
  await fill('#search-reddit-startDate', '2026-09-01');
  await checked('#search-reddit-includeComments');
  await fill('#search-reddit-maxComments', '5');
  await shot('reddit-targets-comments', '.search-tab-bar');
  await activate('.search-advanced > summary');
  await fill('#search-reddit-commentStartDate', '2026-09-05');
  await checked('#search-reddit-searchComments');
  await shot('reddit-advanced-options', '.search-advanced');

  await activate('#search-filter-tab-x');
  await fill('#search-x-handles', '@apify\nhttps://x.com/NASA');
  await fill('#search-x-startDate', '2026-09-01');
  await fill('#search-x-endDate', '2026-09-27');
  await fill('#search-x-replies', 'exclude');
  await activate('.search-advanced > summary');
  await fill('#search-x-media', 'images');
  await checked('#search-x-includeRetweets', false);
  await shot('x-accounts-dates', '.search-tab-bar');

  await activate('#search-filter-tab-linkedin-search');
  await fill('#search-linkedin-search-startDate', '2026-09-01');
  await checked('#search-linkedin-search-includeComments');
  await fill('#search-linkedin-search-maxComments', '3');
  await activate('.search-advanced > summary');
  await checked('#search-linkedin-search-includeReactions');
  await fill('#search-linkedin-search-maxReactions', '2');
  await checked('#search-linkedin-search-fetchDocumentDetails');
  await shot('linkedin-search-engagement', '.search-filter-panel');

  await activate('#search-filter-tab-linkedin-profile');
  await fill('#search-linkedin-profile-urls', 'https://linkedin.com/in/qa-person\nhttps://linkedin.com/company/qa-company');
  await fill('#search-linkedin-profile-startDate', '2026-09-01');
  await checked('#search-linkedin-profile-includeComments');
  await fill('#search-linkedin-profile-maxComments', '5');
  await activate('.search-advanced > summary');
  await fill('#search-linkedin-profile-commentsPostedLimit', 'week');
  await checked('#search-linkedin-profile-includeReactions');
  await fill('#search-linkedin-profile-maxReactions', '5');
  await fill('#search-linkedin-profile-contextCountry', 'US');
  await shot('linkedin-profile-options', '.search-tab-bar');
  check('source-targets-dates-and-engagement-options-entered');

  // The offline preview must catch malformed targets before any provider call and route back to the field.
  await activate('#search-filter-tab-x');
  await fill('#search-x-handles', '@this_handle_is_far_too_long');
  await activate('#search-step-2');
  await waitFor('Boolean(document.querySelector(".search-plan-status.invalid"))', 'invalid offline plan');
  assert.equal(providerStarts.length, 0);
  assert.ok(previewResponses.some(preview => preview.result.valid === false));
  await shot('invalid-target-preview', '.search-plan-status');
  await click('Fix inputs');
  await waitFor('document.querySelector("#search-filter-tab-x")?.getAttribute("aria-selected") === "true"', 'invalid source target focus');
  await fill('#search-x-handles', '@apify\nhttps://x.com/NASA');
  check('offline-preview-rejects-invalid-target-before-run');
  await activate('#search-step-2');
  await fill('#search-max-items', '10');
  await fill('#search-source-budget', '0.10');
  await waitFor('Boolean(document.querySelector(".search-plan-status.ready"))', 'validated source plan');
  const reviewText = await evaluate('document.querySelector(".search-review-sources").textContent');
  for (const expected of ['r/marketing', '@apify', 'qa-person', '2026-09-01', '2026-09-27', '5 comments/post', '5 reactions/post', 'no replies', 'images']) assert.ok(reviewText.includes(expected), `Review summary includes ${expected}`);
  assert.match(await evaluate('document.querySelector(".search-total").textContent'), /\$0\.40/);
  await shot('search-review', '.search-tab-bar');
  check('review-summary-and-budget', { totalBudgetUsd: 0.4, selectedSources: 4 });

  // Leaving the route and returning must preserve all draft controls without launching a run.
  await click('Overview', "document.querySelector('nav[aria-label=Primary]')");
  await click('Search platforms', "document.querySelector('nav[aria-label=Primary]')");
  assert.equal(await evaluate('document.querySelector("#search-query").value'), 'campaign reporting');
  assert.equal(await evaluate('document.querySelector("#search-source-linkedin-profile").checked'), true);
  await activate('#search-step-1');
  assert.equal(await evaluate('document.querySelector("#search-reddit-subreddits").value'), 'r/marketing, https://www.reddit.com/r/SaaS/');
  assert.equal(await evaluate('document.querySelector("#search-reddit-includeComments").checked'), true);
  await activate('#search-filter-tab-x');
  assert.equal(await evaluate('document.querySelector("#search-x-endDate").value'), '2026-09-27');
  await activate('#search-filter-tab-linkedin-profile');
  assert.match(await evaluate('document.querySelector("#search-linkedin-profile-urls").value'), /qa-person/);
  assert.equal(providerStarts.length, 0);
  check('draft-preserved-across-navigation');

  win.setSize(760, 700); await pause(150);
  await shot('linkedin-targets-compact', '.search-tab-bar'); await noOverflow('sources-compact');
  await activate('#search-step-2');
  await shot('search-review-compact', '.search-tab-bar'); await noOverflow('review-compact');
  await shot('search-budget-compact', '.search-limits');
  win.setSize(1380, 920); await pause(150);
  await click('Search selected sources');
  await waitFor('document.querySelectorAll(".search-result").length === 4', 'four source fixture collections');
  assert.equal(searchRequests.length, 1);
  const finalPreview = previewResponses.filter(preview => preview.result.valid).at(-1);
  assert.ok(finalPreview); assert.deepEqual(finalPreview.request, searchRequests[0]);
  assert.equal(finalPreview.result.plan.totalRequestedPosts, 40);
  assert.equal(finalPreview.result.plan.totalRequestedItems, 140);
  for (const actual of providerStarts) assert.deepEqual(actual.input, finalPreview.result.plan.recipes.find(recipe => recipe.actorId === actual.actorId).input);
  check('reviewed-plan-matches-actual-provider-inputs', { requestedPosts: 40, providerRows: 140 });
  assert.equal(providerStarts.length, 4);
  const start = actor => providerStarts.find(item => item.actorId === actor);
  const reddit = start('trudax/reddit-scraper-lite');
  assert.ok(reddit.input.searches.every(term => /subreddit:/.test(term)));
  assert.equal(reddit.input.time, 'month'); assert.equal(reddit.input.postDateLimit, '2026-09-01'); assert.equal(reddit.input.commentDateLimit, '2026-09-05');
  assert.equal(reddit.input.sort, 'new'); assert.equal(reddit.input.skipComments, false); assert.equal(reddit.input.searchComments, true); assert.equal(reddit.input.maxComments, 5);
  const x = start('apidojo/twitter-scraper-lite');
  for (const term of ['from:apify', 'from:NASA', 'since:2026-09-01', 'until:2026-09-28', '-filter:replies', 'filter:images', '-filter:nativeretweets']) assert.ok(x.input.searchTerms[0].includes(term), `X provider request includes ${term}`);
  const linkedinSearch = start('supreme_coder/linkedin-post');
  assert.equal(linkedinSearch.input.scrapeUntil, '2026-09-01'); assert.equal(linkedinSearch.input.deepScrape, true); assert.equal(linkedinSearch.input.numComments, 3); assert.equal(linkedinSearch.input.numLikes, 2); assert.equal(linkedinSearch.input.fetchDocumentDetails, true);
  const profile = start('harvestapi/linkedin-profile-posts');
  assert.deepEqual(profile.input.targetUrls, ['https://www.linkedin.com/in/qa-person', 'https://www.linkedin.com/company/qa-company']);
  assert.equal(profile.input.maxPosts, 5); assert.equal(profile.input.postedLimitDate, '2026-09-01'); assert.equal(profile.input.scrapeComments, true); assert.equal(profile.input.scrapeReactions, true); assert.equal(profile.input.maxComments, 5); assert.equal(profile.input.maxReactions, 5); assert.equal(profile.input.commentsPostedLimit, 'week'); assert.equal(profile.input.contextCountry, 'US');
  for (const source of providerStarts) { assert.equal(source.options.maxTotalChargeUsd, 0.1); assert.equal(source.options.timeout, 300); }
  assert.equal(profile.options.maxItems, 110, 'Provider row limit allows the selected child records');
  const saved = await call('state');
  assert.equal(saved.runs.length, 4); assert.ok(saved.runs.every(run => run.status === 'succeeded'));
  const profileDataset = saved.datasets.find(dataset => dataset.searchContext.sourceId === 'linkedin-profile');
  assert.equal(profileDataset.itemCount, 12, 'Posts and fixture comments beyond the post allowance are retained');
  assert.equal(profileDataset.searchContext.maxItems, 10); assert.equal(profileDataset.searchContext.maxResultItems, 110);
  assert.equal(profileDataset.collectionScope.retrievalLimit, 110);
  assert.equal((await call('readDataset', profileDataset.id)).items.length, 12);
  const linkedinDataset = saved.datasets.find(dataset => dataset.searchContext.sourceId === 'linkedin-search');
  const linkedinItems = (await call('readDataset', linkedinDataset.id)).items;
  assert.equal(linkedinItems.length, 3);
  const reply = linkedinItems.find(item => item.externalId === 'fixture-nested-reply');
  assert.equal(reply.text, 'QA FIXTURE: a nested reply with a specific reporting request.');
  assert.equal(reply.type, 'comment'); assert.equal(reply.parentId, 'fixture-nested-comment'); assert.equal(reply.urlBasis, 'parent-post');
  check('explicit-nested-comments-and-reply-evidence', { savedItems: 3, replyExternalId: reply.externalId, parentId: reply.parentId, urlBasis: reply.urlBasis });
  check('native-preload-main-actor-inputs-and-results', { sources: 4, profilePostAllowance: 10, profileRowAllowance: 110, profileRowsSaved: 12 });
  await shot('search-fixture-results', '.search-results'); await noOverflow('results-normal');
  await click('Open data', '[...document.querySelectorAll(".search-result")].find(article => article.textContent.includes("LinkedIn search"))');
  await waitFor('document.body.textContent.includes("QA FIXTURE: a nested reply with a specific reporting request.")', 'nested reply visible in the saved dataset');
  await shot('saved-comment-evidence');
  check('nested-reply-visible-in-dataset');
  assert.equal(saved.analyses.length, 0, 'No AI analysis was started');
  assert.equal(blockedServiceCalls, 0); assert.equal(networkCalls, 0); assert.equal(cliCalls, 0); assert.deepEqual(failures, []);
  receipt.status = 'passed'; receipt.finishedAt = new Date().toISOString(); receipt.nativeBridge = true;
}
function writeReceipt() { Object.assign(receipt, { blockedServiceCalls, networkCalls, cliCalls, mockedProviderStarts: providerStarts, datasetReads, searchRequests, previewChecks: previewResponses.map(({ result }) => ({ valid: result.valid, error: result.error || null, totalRequestedPosts: result.plan?.totalRequestedPosts, totalRequestedItems: result.plan?.totalRequestedItems })) }); fs.writeFileSync(path.join(dataDir, 'receipt.json'), JSON.stringify(receipt, null, 2)); }
const timeout = setTimeout(() => { receipt.status = 'timeout'; writeReceipt(); console.error(JSON.stringify(receipt)); app.exit(1); }, 120000);
run().then(() => { clearTimeout(timeout); writeReceipt(); console.log(JSON.stringify({ ...receipt, receiptPath: path.join(dataDir, 'receipt.json') }, null, 2)); app.exit(0); }).catch(async error => { clearTimeout(timeout); await shot('failure').catch(() => {}); receipt.status = 'failed'; receipt.error = error.stack || error.message; writeReceipt(); console.error(JSON.stringify(receipt, null, 2)); app.exit(1); });
