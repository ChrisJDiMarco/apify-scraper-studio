const { app, BrowserWindow, session } = require('electron');
const fs = require('fs'); const path = require('path'); const os = require('os'); const assert = require('assert/strict');
const { createContentWorkspace } = require('../src/main/content-workspace'); const { createStudioServer } = require('../src/main/studio-server');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-web-qa-')); const shots = path.join(root, 'screenshots'); fs.mkdirSync(shots);
app.setPath('userData', path.join(root, 'browser-profile'));
let externalCalls = 0; let providerCalls = 0; const errors = []; const checks = [];
const service = createContentWorkspace({ root: path.join(root, 'data'), runAI: async () => { providerCalls++; throw new Error('Provider calls forbidden in browser smoke.'); } });
const { server } = createStudioServer({ root, webRoot: path.resolve(__dirname, '../out/web'), password: 'fixture-only-browser-password', service, host: {} });
let win; const pause = ms => new Promise(resolve => setTimeout(resolve, ms)); const evaluate = async code => { try { return await win.webContents.executeJavaScript(code, true); } catch(error) { throw new Error(code.slice(0, 180) + ': ' + error.message); } };
async function until(code) { for (let i=0;i<100;i++) { if(await evaluate(code).catch(()=>false)) return; await pause(100); } throw new Error(`UI condition timed out: ${code}`); }
async function click(label, scope='document') { const found = await evaluate(`(()=>{const el=[...${scope}.querySelectorAll('button')].find(e=>(e.getAttribute('aria-label')||e.textContent.trim())===${JSON.stringify(label)}); if(!el||el.disabled)return false;el.click();return true})()`); assert.ok(found, `button ${label}`); await pause(120); }
async function fill(selector,value) { await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw new Error('Input missing');const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}))})()`); await pause(120); }
async function shot(name) { await pause(250); const image = await win.webContents.capturePage(undefined,{stayHidden:true}); fs.writeFileSync(path.join(shots,`${name}.png`),image.toPNG()); const metrics = await evaluate('({width:innerWidth,scroll:document.documentElement.scrollWidth})'); assert.ok(metrics.scroll<=metrics.width,`${name}: horizontal fit`); checks.push({name,...metrics}); }
app.whenReady().then(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve)); const port=server.address().port;
  session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(details,callback)=>{const allowed=new URL(details.url).host===`127.0.0.1:${port}`;if(!allowed)externalCalls++;callback({cancel:!allowed})});
  win=new BrowserWindow({width:1440,height:1000,show:false,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  win.webContents.on('console-message',(event,...args)=>{const details=event.message?event:args[0];if(details?.level==='error'&&!details.message.includes('401'))errors.push(details.message)});
  await win.loadURL(`http://127.0.0.1:${port}`); await until('Boolean(document.querySelector(".web-login"))'); await shot('web-login');
  await fill('input[type=password]','fixture-only-browser-password'); await click('Open studio'); await until('Boolean(document.querySelector(".content-studio"))');
  await shot('web-general-overview'); await fill('select[aria-label="Content workspace"]','semrush'); await until('document.querySelector(".content-studio")?.dataset.edition === "semrush"'); await shot('web-semrush-overview');
  await click('Create content',"document.querySelector('.cs-view-nav')"); await fill('#cs-source-title','QA fixture: AI search research brief'); await fill('#cs-source-text','QA fixture. This brief is synthetic and used only to check the interface. Marketing teams need a clear way to preserve source evidence, review themes, and turn an approved finding into channel drafts. There are no measured market claims or external results in this fixture.');
  await click('Choose deliverables'); await shot('web-deliverables'); await evaluate('document.querySelector("#cs-create-tab-2").click()'); await shot('web-review');
  win.setSize(860,1000); await shot('web-compact'); win.setSize(1440,1000);
  await click('Brand knowledge',"document.querySelector('.cs-view-nav')"); await shot('web-brand-knowledge');
  await click('Research programs', "document.querySelector('.cs-view-nav')");
  await fill('#cs-program-name', 'QA weekly source review');
  await evaluate('document.querySelector(".cs-source-group input[type=checkbox]").click()');
  await fill('#cs-targets-reddit', 'r/marketing');
  await fill('#cs-schedule-frequency', 'weekly'); await fill('#cs-schedule-weekday', '1'); await fill('#cs-schedule-time', '09:00'); await fill('#cs-schedule-zone', 'America/New_York');
  assert.equal(await evaluate('document.querySelector(".cs-schedule-consent input").checked'), false);
  await evaluate('document.querySelector(".cs-schedule-consent input").click()');
  await evaluate('document.querySelector(".cs-schedule-fields").scrollIntoView({block:"start"})'); await shot('web-weekly-schedule');
  await click('Save research program'); await until('document.querySelector(".cs-program-schedule")?.textContent.includes("Next run:")');
  assert.ok(service.publicState().programs[0].schedule.nextRunAt);
  await click('Pause schedule'); await until('document.querySelector(".cs-program-schedule")?.textContent.includes("Schedule is paused")');
  assert.equal(service.publicState().programs[0].schedule.enabled, false);
  assert.equal(service.publicState().researchRuns.length, 0); checks.push({name:'web-schedule-save-pause-no-run'});
  await click('Sign out'); await until('Boolean(document.querySelector(".web-login"))'); checks.push({ name: 'sign-out-removes-session' });
  assert.equal(providerCalls,0);assert.equal(externalCalls,0);assert.deepEqual(errors,[]);
  const receipt={fixtureOnly:true,startedAt:new Date().toISOString(),root,screenshots:shots,checks,providerCalls,externalCalls,consoleErrors:errors};fs.writeFileSync(path.resolve(__dirname,'../docs/verification/content-studio-web.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt,null,2)); await new Promise(resolve=>server.close(resolve));app.exit(0);
}).catch(error=>{console.error(error.stack);console.error(JSON.stringify({root,errors}));server.close();app.exit(1)});
