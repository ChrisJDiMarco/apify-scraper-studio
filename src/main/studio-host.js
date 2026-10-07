const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { randomUUID, createHash } = require('crypto');
const { ApifyClient } = require('apify-client');
const { createApifyRunner } = require('../shared/apify-runner');
const { buildClaudeCommand, parseClaudeResult, DEFAULT_CLAUDE_MODEL } = require('../shared/claude-runner');
function studioCliEnv() {
  const searchPaths = process.platform === 'win32' ? [path.join(os.homedir(), '.local', 'bin'), path.join(process.env.APPDATA || os.homedir(), 'npm')] : [path.join(os.homedir(), '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin'];
  const env = { ...process.env, PATH: [...searchPaths, process.env.PATH || ''].join(path.delimiter) };
  for (const name of Object.keys(env)) if (/^(OPENAI_API_KEY|APIFY_API_TOKEN|GOOGLE_.*TOKEN|STUDIO_.*PASSWORD|STUDIO_SESSION_SECRET)$/.test(name)) delete env[name];
  return env;
}
function createStudioHost({ root, getApifyToken = () => process.env.APIFY_API_TOKEN, model = () => process.env.CLAUDE_MODEL || DEFAULT_CLAUDE_MODEL, Client = ApifyClient } = {}) {
  const datasetsDir = path.join(root, 'datasets'); const collectionsDir = path.join(root, 'collections');
  fs.mkdirSync(datasetsDir, { recursive: true }); fs.mkdirSync(collectionsDir, { recursive: true });
  const children = new Map(); const aborts = new Map(); const activeCollections = new Set();
  const safeId = (key, label = 'record') => { if (typeof key !== 'string' || !/^[a-zA-Z0-9_-]{1,180}$/.test(key)) throw new Error(`Invalid ${label} ID.`); return key; };
  const datasetFile = key => path.join(datasetsDir, `${safeId(key, 'dataset')}.json`);
  const indexFile = path.join(root, 'dataset-index.json'); let metadata; let metadataStamp;
  const indexStamp = () => { if (!fs.existsSync(indexFile)) return ''; const info = fs.statSync(indexFile); return `${info.ino}:${info.mtimeMs}:${info.size}`; };
  function readJson(target) { return JSON.parse(fs.readFileSync(target, 'utf8')); }
  function atomicJson(target, value) {
    const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`; let fd;
    try { fd = fs.openSync(temporary, 'wx', 0o600); fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined; fs.renameSync(temporary, target); }
    finally { if (fd !== undefined) fs.closeSync(fd); if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }
  function loadMetadata() {
    const currentStamp = indexStamp(); if (metadata && metadataStamp === currentStamp) return metadata;
    if (currentStamp) {
      const index = readJson(indexFile); if (index.version !== 1 || !Array.isArray(index.datasets)) throw new Error('Studio dataset metadata could not be read. Restore its index before continuing.');
      metadata = new Map(index.datasets.map(dataset => [safeId(dataset.id, 'dataset'), dataset]));
    } else {
      // One-time migration. Subsequent state emissions read only the small metadata index,
      // never every full raw/normalized dataset payload.
      let studio = {}; if (fs.existsSync(path.join(root, 'state.json'))) studio = readJson(path.join(root, 'state.json'));
      metadata = new Map();
      for (const name of fs.readdirSync(datasetsDir).filter(name => name.endsWith('.json'))) {
        const { dataset } = readJson(path.join(datasetsDir, name));
        if (!dataset?.id) continue;
        const owner = dataset.workspaceId || studio.datasetOwners?.[dataset.id] || studio.researchRuns?.find(run => run.id === dataset.researchRunId)?.workspaceId || 'general';
        metadata.set(safeId(dataset.id, 'dataset'), { ...dataset, workspaceId: owner });
      }
      atomicJson(indexFile, { version: 1, datasets: [...metadata.values()] });
    }
    metadataStamp = indexStamp(); return metadata;
  }
  function rememberDataset(dataset) { loadMetadata().set(dataset.id, dataset); atomicJson(indexFile, { version: 1, datasets: [...metadata.values()] }); metadataStamp = indexStamp(); }
  const getDatasets = () => [...loadMetadata().values()].map(dataset => ({ ...dataset }));
  const readDataset = key => readJson(datasetFile(key));
  function acquireCollectionLock(runId) {
    const target = path.join(collectionsDir, `${runId}.lock`); const nonce = randomUUID();
    for (let attempt = 0; attempt < 2; attempt++) {
      try { fs.writeFileSync(target, JSON.stringify({ pid: process.pid, nonce }), { flag: 'wx', mode: 0o600 }); return () => { try { if (readJson(target).nonce === nonce) fs.unlinkSync(target); } catch (error) { if (error.code !== 'ENOENT') throw error; } }; }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const lock = readJson(target); let alive = true;
        if (!Number.isInteger(lock.pid) || lock.pid < 1) throw new Error('Collection lock is invalid. Check this saved run before retrying.');
        try { process.kill(lock.pid, 0); } catch (probe) { if (probe.code === 'ESRCH') alive = false; }
        if (alive) throw new Error('This collection is already active on this host. Wait for it or cancel it before retrying.');
        fs.unlinkSync(target);
      }
    }
    throw new Error('Could not reserve this collection. Retry when no other host is running it.');
  }
  async function collect({ program, runId, workspaceId, isCancelled = () => false, onProgress = () => {} }) {
    safeId(runId, 'research run'); safeId(workspaceId, 'workspace');
    if (activeCollections.has(runId)) throw new Error('This collection is already active.');
    const { buildCollectionPlan } = require('../shared/research-collection'); const plan = buildCollectionPlan(program);
    const fingerprint = createHash('sha256').update(JSON.stringify(plan)).digest('hex');
    const checkpointFile = path.join(collectionsDir, `${runId}.json`); const unlock = acquireCollectionLock(runId); activeCollections.add(runId);
    let checkpoint; let runner;
    try {
      if (fs.existsSync(checkpointFile)) {
        checkpoint = readJson(checkpointFile);
        if (checkpoint.version !== 1 || checkpoint.runId !== runId || checkpoint.workspaceId !== workspaceId || checkpoint.planFingerprint !== fingerprint) throw new Error('The saved collection belongs to a different workspace or source plan. Start a new research run instead of changing an already launched collection.');
      } else {
        checkpoint = { version: 1, runId, workspaceId, programId: plan.programId, planFingerprint: fingerprint, createdAt: new Date().toISOString(), jobs: plan.jobs.map(job => ({ id: job.id, datasetId: `dataset-${createHash('sha256').update(`${runId}:${job.id}`).digest('hex').slice(0, 24)}`, status: 'planned', budgetUsd: job.budgetUsd, reservedBudgetUsd: 0, providerRunId: null })) };
        atomicJson(checkpointFile, checkpoint);
      }
      const save = () => { checkpoint.updatedAt = new Date().toISOString(); atomicJson(checkpointFile, checkpoint); };
      const items = []; const datasetIds = []; const receipts = [];
      for (const [index, job] of plan.jobs.entries()) {
        if (isCancelled()) throw new Error('Collection cancelled.');
        const saved = checkpoint.jobs.find(entry => entry.id === job.id);
        if (!saved) throw new Error('The saved collection checkpoint is incomplete. Review the run before collecting again.');
        onProgress(`Collecting source group ${index + 1} of ${plan.jobs.length}`);
        // Dataset files are committed before the success checkpoint. Recover that small
        // crash window without repeating even the provider download.
        if (fs.existsSync(datasetFile(saved.datasetId))) {
          const stored = readDataset(saved.datasetId); const dataset = stored.dataset;
          if (dataset?.researchRunId !== runId || dataset?.collectionJobId !== job.id || dataset?.workspaceId !== workspaceId || !Array.isArray(stored.items)) throw new Error('A saved collection dataset has inconsistent ownership or lineage. Restore it before retrying.');
          saved.status = 'succeeded'; saved.providerRunId = dataset.apifyRunId; saved.receipt = dataset.collectionReceipt; delete saved.error; save(); rememberDataset(dataset);
          datasetIds.push(dataset.id); items.push(...stored.items); receipts.push({ ...saved.receipt, reused: true }); continue;
        }
        if (saved.status !== 'planned' && !saved.providerRunId) throw new Error('An Actor start was attempted but its run ID was not saved. It may already be charging in Apify. Check the recent Apify run and resolve this collection before starting a new research run; automatic retry will not launch a duplicate.');
        if (!runner) runner = createApifyRunner({ token: getApifyToken(), Client, maxRetries: 0 });
        if (!saved.providerRunId) {
          // Fsync the intent and budget BEFORE the potentially billable POST. SDK retries
          // are disabled: a lost start response is an unknown outcome, never a free retry.
          saved.status = 'starting'; saved.reservedBudgetUsd = job.budgetUsd; saved.startAttemptedAt = new Date().toISOString(); save();
        }
        const attachAbort = providerRunId => aborts.set(runId, () => new Client({ token: getApifyToken(), maxRetries: 0 }).run(providerRunId).abort({ gracefully: true }));
        if (saved.providerRunId) attachAbort(saved.providerRunId);
        try {
          const result = await runner.runRecipe(job.recipe, {
            maxItems: job.maxItems, isCancelled, ...(saved.providerRunId ? { resumeRunId: saved.providerRunId } : {}), expandComments: job.sourceId === 'linkedin-search',
            onRunStarted: run => {
              if (!run?.id || typeof run.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(run.id)) throw new Error('Apify did not provide a valid run ID; the start outcome requires manual review.');
              saved.providerRunId = run.id; saved.status = 'running'; saved.providerStatus = run.status || 'UNKNOWN'; save(); attachAbort(run.id);
            },
            onStatus: run => { saved.providerStatus = run.status || 'UNKNOWN'; save(); },
          });
          if (isCancelled()) throw new Error('Collection cancelled.');
          const costUsd = typeof result.run.usageTotalUsd === 'number' && Number.isFinite(result.run.usageTotalUsd) && result.run.usageTotalUsd >= 0 ? result.run.usageTotalUsd : null;
          const receipt = { jobId: job.id, sourceId: job.sourceId, apifyRunId: result.run.id, providerStatus: result.run.status, costUsd, budgetUsd: job.budgetUsd, itemCount: result.normalizedItems.length, providerRows: result.rawItems.length, reused: false };
          const dataset = { id: saved.datasetId, workspaceId, name: `${program.name} · ${job.sourceId}`, platform: job.platform, itemCount: result.normalizedItems.length, createdAt: new Date().toISOString(), researchRunId: runId, collectionJobId: job.id, apifyRunId: result.run.id, collectionReceipt: receipt };
          atomicJson(datasetFile(dataset.id), { dataset, items: result.normalizedItems, rawItems: result.rawItems }); rememberDataset(dataset);
          saved.status = 'succeeded'; saved.receipt = receipt; delete saved.error; save();
          datasetIds.push(dataset.id); items.push(...result.normalizedItems); receipts.push(receipt);
        } catch (error) {
          saved.status = isCancelled() ? 'cancelled' : 'failed'; saved.error = String(error?.message || error).replace(/(?:Bearer\s+|(?:sk-|apify_api_))[\w.-]+/gi, '[redacted]').replace(/([?&]token=)[^&\s]+/gi, '$1[redacted]').slice(0, 1500); save(); throw error;
        } finally { aborts.delete(runId); }
      }
      return { items, datasetIds, receipt: { ...plan.receipt, workspaceId, runId, succeededJobs: receipts.length, reusedJobs: receipts.filter(receipt => receipt.reused).length, reservedBudgetUsd: Math.round(checkpoint.jobs.reduce((sum, job) => sum + job.reservedBudgetUsd, 0) * 100) / 100, costUsd: receipts.every(receipt => receipt.costUsd !== null) ? receipts.reduce((sum, receipt) => sum + receipt.costUsd, 0) : null, runs: receipts } };
    } finally { aborts.delete(runId); activeCollections.delete(runId); unlock(); }
  }
  function runAI({ runId, schema, prompt, maxBudgetUsd, workspaceDir, outputPath }) {
    const requestedModel = model(); const invocation = buildClaudeCommand({ model: requestedModel, schema, prompt, maxBudgetUsd });
    return new Promise((resolve, reject) => {
      const child = spawn(invocation.command, invocation.args, { cwd: workspaceDir, env: studioCliEnv(), windowsHide: true }); children.set(runId, child); let stdout = ''; let stderr = ''; let done = false;
      const finish = (error, value) => { if (done) return; done = true; clearTimeout(timer); children.delete(runId); error ? reject(error) : resolve(value); };
      const timer = setTimeout(() => { child.kill(); finish(new Error('Claude timed out. Retry the incomplete output.')); }, 600000);
      child.on('error', error => finish(new Error(error.code === 'ENOENT' ? 'Install Claude Code and sign in on this host before generating content.' : 'Claude could not start.')));
      child.stdout.on('data', chunk => { stdout += chunk; if (stdout.length > 20000000) { child.kill(); finish(new Error('Claude output exceeded the limit.')); } });
      child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-2000); });
      child.stdin.on('error', () => {}); child.stdin.end(invocation.stdin);
      child.on('close', code => {
        if (code !== 0) return finish(new Error('Claude did not complete this request. Check the host CLI connection and budget.'));
        try { const parsed = parseClaudeResult(stdout); if (requestedModel.startsWith('claude-') && !parsed.actualModels.includes(requestedModel)) throw new Error('Claude returned a different or unverified model.'); fs.writeFileSync(outputPath, JSON.stringify(parsed.output, null, 2), { mode: 0o600 }); finish(null, { output: parsed.output, receipt: { provider: 'claude', requestedModel, actualModel: parsed.actualModel, actualModels: parsed.actualModels, costUsd: parsed.costUsd, usage: parsed.usage, durationMs: parsed.durationMs } }); } catch (error) { finish(error); }
      });
    });
  }
  async function cancelProvider(runId) { children.get(runId)?.kill(); const abort = aborts.get(runId); if (abort) await abort().catch(() => {}); }
  return { collect, getDatasets, readDataset, runAI, cancelProvider };
}
module.exports = { createStudioHost, studioCliEnv };
