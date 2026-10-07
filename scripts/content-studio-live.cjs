// Explicit owner-approved provider smoke. Maximum total allocation: $1.50.
const fs = require('fs'); const os = require('os'); const path = require('path');
const { createContentWorkspace } = require('../src/main/content-workspace');
const { createStudioHost } = require('../src/main/studio-host');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-live-content-'));
const host = createStudioHost({ root }); const service = createContentWorkspace({ root, ...host });
const source = { id: 'approved-implementation-brief', kind: 'text', title: 'Internal implementation brief — live validation', text: fs.readFileSync(path.join(__dirname, '../docs/verification/content-studio-live-source.md'), 'utf8') };
const run = service.createContentRun({ workspaceId: 'general', source, deliverableIds: ['evidence-report', 'social'], maxBudgetUsd: 1.50 });
console.log(JSON.stringify({ runId: run.id, root, maxBudgetUsd: 1.50, provider: 'Claude CLI', requestedModel: 'claude-opus-5-5' }));
service.waitForIdle().then(() => {
  const result = service.readStudioRun({ runId: run.id }); const receipt = { run: result, assets: service.publicState().assets };
  if (receipt.assets.length) { const exported = service.exportStudioRun({ runId: run.id }); const target = path.join(__dirname, '../docs/verification/live-content'); fs.mkdirSync(target, { recursive: true }); fs.cpSync(exported.path, target, { recursive: true }); receipt.exportPath = target; }
  fs.writeFileSync(path.join(__dirname, '../docs/verification/content-studio-live.json'), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify({ status: result.status, jobs: result.jobs, costUsd: result.costUsd, reservedUsd: result.reservedUsd, receipts: result.receipts, exportPath: receipt.exportPath }));
  process.exit(result.status === 'succeeded' ? 0 : 1);
}).catch(error => { console.error(error.message); process.exit(1); });
