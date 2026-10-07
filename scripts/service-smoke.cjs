// Explicit, paid integration check. Never invoked by npm test/test:desktop.
// Uses the app's encrypted token and current Claude login. Requires --live.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const reviewOnly = process.argv.includes('--review');
const redditOnly = process.argv.includes('--reddit-only');
if (!reviewOnly && !process.argv.includes('--live')) { console.error('Use --review for existing workspace UI checks. Pass --live only when small paid Apify and Claude tests are authorized.'); process.exit(1); }
app.setName('apify-scraper-studio');
app.setPath('userData', path.join(app.getPath('appData'), 'apify-scraper-studio'));
const dir = path.resolve(__dirname, '../docs/verification');
fs.mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const receiptPath = path.join(dir, `service-smoke-${stamp}.json`);
const receipt = { startedAt: new Date().toISOString(), limits: { resultsPerSource: 10, apifyBudgetPerSourceUsd: 0.25, apifyTotalBudgetUsd: redditOnly ? 0.25 : 1 }, steps: [] };
const save = () => fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
const report = (step) => { receipt.steps.push(step); save(); console.log(JSON.stringify(step)); };
const pause = (ms) => new Promise(resolve => setTimeout(resolve, ms));
app.on('web-contents-created', (_, contents) => contents.setBackgroundThrottling(false));
require('../out/main/index.js');
let win;
const evaluate = code => win.webContents.executeJavaScript(code, true);
const call = (method, payload) => evaluate(`window.apifyStudio[${JSON.stringify(method)}](${payload === undefined ? '' : JSON.stringify(payload)})`);
async function capture(name) {
  await pause(500);
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await win.webContents.capturePage(undefined, { stayHidden: true });
  await pause(100);
  fs.writeFileSync(path.join(dir, `${stamp}-${name}.png`), (await win.webContents.capturePage(undefined, { stayHidden: true })).toPNG());
}
async function navigate(label) {
  await evaluate(`(() => { const button = [...document.querySelector('nav[aria-label=Primary]').querySelectorAll('button')].find(b=>b.getAttribute('aria-label') === ${JSON.stringify(label)}); if(!button) throw new Error('Missing navigation'); button.click(); })()`);
  await pause(200);
}
async function main() {
  await app.whenReady();
  for(let i=0;i<100;i++) { win=BrowserWindow.getAllWindows()[0]; if(win && await evaluate('Boolean(window.apifyStudio && document.querySelector(".home-view"))').catch(()=>false)) break; await pause(100); }
  if (!win) throw new Error('App window unavailable.');
  const state = await call('state');
  if (reviewOnly) {
    await navigate('Search platforms'); await capture('search-with-results');
    await navigate('Chat with findings');
    await evaluate(`(() => { const button=document.querySelector('.findings-history button'); if(button) button.click(); })()`);
    await capture('chat');
    await evaluate(`(() => { const source=document.querySelector('.findings-sources'); if(source) { source.open=true; source.scrollIntoView({block:'center'}); } })()`);
    await capture('chat-sources');
    await navigate('AI reports');
    const reportDatasetId=state.analyses.find(analysis=>analysis.kind==='report' && analysis.status==='succeeded')?.datasetId;
    if (reportDatasetId) await evaluate(`(() => { const select=document.querySelector('.report-field select'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,${JSON.stringify(reportDatasetId)}); select.dispatchEvent(new Event('change',{bubbles:true})); })()`);
    await pause(250); await capture('report');
    win.setSize(760,700); await pause(200);
    for (const label of ['Search platforms', 'Chat with findings', 'AI reports']) {
      await navigate(label);
      if (!await evaluate('document.documentElement.scrollWidth <= innerWidth')) throw new Error(label+' overflows compact window.');
      await capture(label.toLowerCase().replaceAll(' ','-')+'-compact');
    }
    receipt.status='existing-workspace-ui-passed'; receipt.finishedAt=new Date().toISOString(); save();
    console.log(JSON.stringify({status:receipt.status,receiptPath})); app.exit(0); return;
  }
  if (!state.keys.APIFY_API_TOKEN) throw new Error('Save the Apify token in the app before running this check.');
  const catalog = await call('refreshApifyActors');
  report({ step:'actor-catalog', count:catalog.actors.length, actorNames:catalog.actors.map(actor=>actor.fullName) });
  const ai = await call('checkAi', { provider:'claude' });
  report({ step:'claude-connection', ...ai });
  if (!ai.ok) throw new Error('Claude connection check failed.');
  await call('saveSettings', { aiProvider:'claude', aiModel:'claude-opus-5-5', aiMaxBudgetUsd:1 });
  await navigate('Search platforms');
  await capture('search');
  console.log(JSON.stringify({ step:'collection-started', sources:redditOnly ? 1 : 4, apifyTotalBudgetUsd:redditOnly ? 0.25 : 1 }));
  const result = await call('searchSources', { query:'enterprise marketing', platformIds:redditOnly ? ['reddit'] : ['reddit','x','linkedin-search','linkedin-profile'], sourceUrls:'https://www.linkedin.com/company/apify/', maxItems:10, maxTotalChargeUsd:0.25 });
  const after = await call('state');
  const runDetails = after.runs.filter(run=>result.datasets.some(dataset=>dataset.runId===run.id) || run.startedAt >= receipt.startedAt).map(run=>({ id:run.id,actorId:run.actorId,status:run.status,apifyRunId:run.apifyRunId,itemCount:run.itemCount,usageTotalUsdAtCompletion:run.usageTotalUsdAtCompletion,runLimits:run.runLimits,error:run.error }));
  report({ step:'collection', datasets:result.datasets.map(({id,platform,itemCount})=>({id,platform,itemCount})), errors:result.errors, runs:runDetails });
  const usable = [];
  for(const dataset of result.datasets) {
    const data = await call('readDataset', dataset.id);
    report({ step:'source-shape', datasetId:dataset.id, platform:dataset.platform, rawKeys:Object.keys(data.rawItems[0]||{}), usableTextRows:data.items.filter(item=>item.text?.trim()).length, sourceUrlRows:data.items.filter(item=>item.url).length });
    if(data.items.some(item=>item.text?.trim())) usable.push(dataset);
  }
  if(redditOnly) { receipt.status=result.errors.length ? 'failed' : 'reddit-collection-passed'; receipt.finishedAt=new Date().toISOString(); save(); console.log(JSON.stringify({status:receipt.status,receiptPath})); app.exit(result.errors.length ? 1 : 0); return; }
  if(!usable.length) throw new Error('No usable source text returned; stop before AI calls.');
  const answer = await call('askFindings', { datasetIds:usable.map(dataset=>dataset.id), question:'What does this small sample actually tell us about enterprise marketing? Give three evidence-backed observations and explain its limitations.' });
  const assistant=answer.conversation.messages.findLast(message=>message.role==='assistant');
  report({ step:'findings-chat', conversationId:answer.conversation.id, citations:assistant.citations.length, coverage:assistant.coverage, aiReceipt:assistant.aiReceipt });
  const analysis = await call('analyzeDataset', { datasetId:usable[0].id, kind:'report', reportPresetId:'market-scan' });
  report({ step:'report', id:analysis.id,status:analysis.status,title:analysis.output.title,aiReceipt:analysis.aiReceipt,coverage:analysis.coverage });
  await navigate('Chat with findings');
  await evaluate(`(() => { const button=[...document.querySelectorAll('.findings-history button')][0]; if(button) button.click(); })()`);
  await capture('chat');
  await navigate('AI reports');
  await capture('report');
  await navigate('Search platforms');
  await capture('search-with-results');
  win.setSize(760,700); await pause(200);
  const noOverflow=await evaluate('document.documentElement.scrollWidth <= innerWidth');
  if(!noOverflow) throw new Error('Search view overflows compact window.');
  await capture('search-compact');
  receipt.status=result.errors.length ? 'partial-sources-ai-passed' : 'passed';
  receipt.finishedAt=new Date().toISOString(); save();
  console.log(JSON.stringify({ status:receipt.status,receiptPath }));
  app.exit(0);
}
const timer=setTimeout(()=>{ receipt.status='timeout';save();app.exit(1); },12*60*1000);
main().catch(error=>{ receipt.status='failed';receipt.error=String(error.message||error).replace(/apify_api_[A-Za-z0-9]+/g,'[redacted]');save();console.error(receipt.error);app.exit(1); });
