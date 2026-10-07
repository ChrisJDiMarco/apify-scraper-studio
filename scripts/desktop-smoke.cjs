// Native smoke checks use disposable app data and never invoke paid services.
// Run after npm run build: npm run test:desktop [-- --with-data]
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const fixture = process.argv.includes('--with-data');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scraper-studio-smoke-'));
const evidenceDir = path.join(dataDir, 'screenshots');
fs.mkdirSync(evidenceDir);
app.setPath('userData', dataDir);
const timestamp = '2026-09-27T12:00:00.000Z';
if (fixture) {
  fs.mkdirSync(path.join(dataDir, 'datasets'));
  const marketingBrief = { templateId: 'competitor-positioning', reportPresetId: 'competitor-positioning', templateVersion: 1, brand: 'QA sample brand', decision: 'Identify a clearer positioning angle.', audience: 'Marketing leaders', sourceUrls: ['https://example.com/product'] };
  const dataset = { marketingBrief, id: 'qa-dataset', name: 'QA fixture · website research', platform: 'web', itemCount: 100, createdAt: timestamp, recipeId: 'qa-recipe' };
  const items = Array.from({ length: 100 }, (_, i) => ({ id: `web:${i + 1}`, type: 'page', author: `Source ${i + 1}`, text: `Research note ${i + 1}: product feedback from a test fixture.`, url: `https://example.com/${i + 1}`, metrics: { likes: i, comments: 2, shares: 0, views: 10 } }));
  fs.writeFileSync(path.join(dataDir, 'datasets', 'qa-dataset.json'), JSON.stringify({ items, rawItems: items.map((row, i) => ({ id: i + 1, body: row.text, url: row.url })) }));
  fs.writeFileSync(path.join(dataDir, 'data.json'), JSON.stringify({ recipes: [{ id: 'qa-recipe', name: 'QA fixture scraper', actorId: 'apify/website-content-crawler', taskId: '', platform: 'web', input: {}, mapper: {} }], datasets: [dataset], runs: [{ id: 'qa-run', recipeId: 'qa-recipe', datasetId: dataset.id, status: 'succeeded', itemCount: 100, startedAt: timestamp }], settings: { maxItems: 100 }, analyses: [], assets: [], cards: [] }));
}
const failures = [];
app.on('web-contents-created', (_, contents) => {
  contents.setBackgroundThrottling(false);
  contents.on('console-message', (_, details) => { if (details.level === 'error') failures.push(details.message); });
  contents.on('did-fail-load', (_, code, description) => failures.push(`${code}: ${description}`));
});
require('../out/main/index.js');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let win;
const evaluate = (code) => win.webContents.executeJavaScript(code, true);
async function waitFor(code, label) {
  for (let i = 0; i < 80; i++) { if (await evaluate(code)) return; await delay(100); }
  throw new Error(`Timed out: ${label}`);
}
async function click(label, scope = 'document') {
  const ok = await evaluate(`(() => { const button = [...${scope}.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || b.textContent.trim()) === ${JSON.stringify(label)}); if (!button || button.disabled) return false; button.click(); return true; })()`);
  assert.ok(ok, `Button is available: ${label}`);
  await delay(100);
}
async function fill(selector, value) {
  await evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); if(!element) throw new Error('Missing input'); const proto = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(element, ${JSON.stringify(value)}); element.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await delay(80);
}
async function shot(name) {
  await delay(500);
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await win.webContents.capturePage(undefined, { stayHidden: true });
  await delay(100);
  fs.writeFileSync(path.join(evidenceDir, `${name}.png`), (await win.webContents.capturePage(undefined, { stayHidden: true })).toPNG());
}
async function navigate(label) {
  await click(label, "document.querySelector('nav[aria-label=Primary]')");
  await delay(100);
}
async function run() {
  await app.whenReady();
  for (let i = 0; i < 80 && !BrowserWindow.getAllWindows().length; i++) await delay(100);
  win = BrowserWindow.getAllWindows()[0];
  await waitFor("Boolean(document.querySelector('.home-view'))", 'overview');
  assert.equal(await evaluate('Boolean(window.apifyStudio)'), true, 'real preload bridge');
  await shot(fixture ? 'overview-with-data' : 'overview');
  if (!fixture) {
    await click('New scraper');
    await fill('input[id$="-name"]', 'Native smoke test scraper');
    await shot('scraper-source');
    await click('Continue');
    await fill('input[id$="-resource"]', 'apify/website-content-crawler');
    await shot('scraper-configure');
    await click('Continue');
    await shot('scraper-review');
    await click('Save scraper');
    await waitFor("Boolean(document.querySelector('.scraper-library-card'))", 'saved scraper library');
    assert.equal(await evaluate('(async () => (await window.apifyStudio.state()).recipes[0].name)()'), 'Native smoke test scraper');
    await navigate('Overview');
    await navigate('Scrapers');
    assert.equal(await evaluate('Boolean(document.querySelector(".scraper-form"))'), false, 'returning to library does not reopen draft');
    await shot('scraper-library');
    await navigate('Overview');
    await click('Use Competitor positioning brief');
    await waitFor('Boolean(document.querySelector("#marketing-brand"))', 'marketing starter');
    await shot('marketing-template');
    await click('Save collection');
    assert.match(await evaluate('document.querySelector("[role=alert]").innerText'), /project or brand/);
    await fill('#marketing-brand', 'QA sample brand');
    await fill('#marketing-decision', 'Identify a clearer positioning angle.');
    await fill('#marketing-audience', 'Marketing leaders');
    await fill('#marketing-sourceUrls', 'https://example.com/product\nhttps://example.com/product#section\nhttps://example.org/pricing');
    await shot('marketing-template-filled');
    await click('Save collection');
    await waitFor('Boolean(document.querySelector("#marketing-saved-title"))', 'saved marketing starter');
    const savedStarter = await evaluate('(async () => (await window.apifyStudio.state()).recipes.find(recipe => recipe.marketingBrief))()');
    assert.equal(savedStarter.marketingBrief.brand, 'QA sample brand');
    assert.equal(savedStarter.marketingBrief.reportPresetId, 'competitor-positioning');
    assert.equal(savedStarter.input.startUrls.length, 2);
    assert.equal(savedStarter.input.maxCrawlDepth, 0);
    assert.deepEqual(savedStarter.runOptions, { maxTotalChargeUsd: 2, timeoutSecs: 300 });
    assert.equal(await evaluate('(async () => (await window.apifyStudio.state()).runs.length)()'), 0, 'saving does not start a paid run');
    await shot('marketing-template-saved');
    await click('Open saved scrapers');
    await waitFor('document.querySelectorAll(".scraper-library-card").length === 2', 'starter handoff to library');
    await navigate('Datasets');
    assert.match(await evaluate('document.querySelector(".content").innerText'), /Good insights start/);
    await shot('datasets-empty');
    await navigate('AI reports');
    assert.equal(await evaluate('Boolean(document.querySelector(".data-welcome"))'), true);
    await shot('reports-empty');
  } else {
    await navigate('Datasets');
    await waitFor('document.querySelectorAll("tbody tr").length === 90', 'dataset rows');
    await shot('datasets');
    await evaluate("document.querySelector('.data-export-menu').open = true");
    await click('CSV spreadsheet');
    await waitFor("document.querySelector('.content').innerText.includes('Exported 100 rows')", 'CSV export');
    assert.ok(fs.readdirSync(path.join(dataDir, 'exports')).some(name => name.endsWith('.csv')), 'CSV was written locally');
    await click('Next');
    assert.equal(await evaluate('document.querySelectorAll("tbody tr").length'), 10);
    assert.match(await evaluate('document.querySelector(".dataset-window-tools").innerText'), /91.*100/);
    await fill('[aria-label="Search dataset rows"]', 'note 95:');
    assert.equal(await evaluate('document.querySelectorAll("tbody tr").length'), 1);
    await navigate('AI reports');
    assert.equal(await evaluate('document.querySelectorAll(".report-field select")[1].value'), 'competitor-positioning', 'marketing dataset selects its report preset');
    assert.match(await evaluate('document.querySelector(".report-brief-context").innerText'), /QA sample brand/);
    await shot('reports');
  }
  await navigate('Search platforms');
  await evaluate('document.querySelector("#search-step-2").click()');
  await waitFor('document.querySelector("#search-panel-2")?.hidden === false', 'search review tab');
  assert.equal(await evaluate('document.querySelector("#search-max-items").value'), '10', 'Reddit minimum is the visible default');
  assert.match(await evaluate('document.querySelector(".search-minimum-note").textContent'), /at least 10/);
  assert.equal(await evaluate('document.querySelector(".search-form button[type=submit]").disabled'), true, 'missing token blocks paid search');
  await shot('search-platforms');
  await navigate('Chat with findings');
  assert.equal(await evaluate('Boolean(document.querySelector(".findings-workspace, .findings-empty"))'), true);
  if (fixture) {
    assert.equal(await evaluate('document.querySelectorAll(".findings-dataset input:checked").length'), 1);
    await fill('textarea[aria-label="Question about your findings"]', 'What does this QA dataset contain?');
    assert.equal(await evaluate('document.querySelector(".findings-composer button[type=submit]").disabled'), false, 'chat composer is usable');
  }
  await shot('findings-chat');
  await click('Settings', "document.querySelector('nav[aria-label=Preferences]')");
  await waitFor('Boolean(document.querySelector(".settings-view"))', 'settings');
  await shot('settings');
  await navigate('Overview');
  await evaluate("document.querySelector('.search-command').click()");
  await waitFor('Boolean(document.querySelector("[role=dialog]"))', 'command palette');
  await fill('[aria-label="Search commands"]', 'Settings');
  await evaluate("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))");
  await waitFor('Boolean(document.querySelector(".settings-view")) && !document.querySelector("[role=dialog]")', 'keyboard navigation');
  await navigate('Overview');
  win.setSize(760, 700);
  await delay(250);
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, 'compact window has no page overflow');
  assert.equal(await evaluate("(() => { const header = document.querySelector('.topbar').getBoundingClientRect(); return [...document.querySelectorAll('.topbar button')].every(button => { const rect = button.getBoundingClientRect(); return rect.top >= header.top && rect.bottom <= header.bottom; }); })()"), true, 'compact header controls remain inside header');
  await shot('overview-compact');
  await click('Use Campaign message audit');
  await waitFor('Boolean(document.querySelector("#marketing-brand"))', 'compact marketing starter');
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, 'compact starter has no page overflow');
  await shot('marketing-template-compact');
  await navigate('Scrapers');
  await shot('scrapers-compact');
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
  assert.deepEqual(failures, [], 'no renderer console errors');
  console.log(JSON.stringify({ status: 'passed', mode: fixture ? 'fixture-data' : 'first-run', nativeBridge: true, screenshots: evidenceDir, savedData: dataDir, paidServicesInvoked: false }, null, 2));
}
const timeout = setTimeout(() => { console.error('Native smoke timed out'); app.exit(1); }, 60000);
run().then(() => { clearTimeout(timeout); app.exit(0); }).catch((error) => { clearTimeout(timeout); console.error(error); app.exit(1); });
