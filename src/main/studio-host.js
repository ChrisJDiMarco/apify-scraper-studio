const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { randomUUID, createHash } = require('crypto');
const { ApifyClient } = require('apify-client');
const { createApifyRunner } = require('../shared/apify-runner');
const { buildClaudeCommand, parseClaudeResult, modelMatches, readClaudeCost, DEFAULT_CLAUDE_MODEL, CLAUDE_CLI_ENV } = require('../shared/claude-runner');
// An app opened from Finder starts with launchd's minimal PATH, so a CLI installed through nvm, volta, asdf or a
// custom npm prefix would look missing. The login shell's PATH, read once in the background, comes first so the
// app runs the same `claude` that Terminal does; the common install locations stay as a fallback.
let loginShellPath = '';
const SHELL_PATH_MARKER = '__SCRAPER_STUDIO_PATH__';
function loadLoginShellPath({ shell = process.env.SHELL || '/bin/zsh', timeoutMs = 5000 } = {}) {
  if (process.platform === 'win32') return Promise.resolve('');
  return new Promise((resolve) => {
    let output = ''; let settled = false; let child;
    const finish = () => {
      if (settled) return; settled = true; clearTimeout(timer);
      const parts = output.split(SHELL_PATH_MARKER); // rc files may print around the marked value
      if (parts.length >= 3) { loginShellPath = parts[1].trim(); resolve(loginShellPath); } else resolve('');
    };
    const timer = setTimeout(() => { try { child?.kill('SIGKILL'); } catch {} finish(); }, timeoutMs);
    try { child = spawn(shell, ['-ilc', `printf '%s%s%s' '${SHELL_PATH_MARKER}' "$PATH" '${SHELL_PATH_MARKER}'`], { stdio: ['ignore', 'pipe', 'ignore'] }); }
    catch { finish(); return; }
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.on('error', finish); child.on('close', finish);
  });
}
// Every AI CLI the studio starts (Claude Code, Codex) gets this environment. On the Codex route the CLI can run shell
// commands, so nothing a person could ask it to print may be in here: no STUDIO_* setting (the web secret key and admin
// password), no email setting (RESEND_API_KEY, SMTP_PASSWORD) and no saved-key variable. No route takes its credential from here: the Claude app and Codex use their
// own sign-in, and the Anthropic API key route calls the API from the studio itself.
// Windows variable names ignore case (`Path`, `Anthropic_Api_Key`), so names are compared in upper case and the copy
// keeps a single PATH.
const CLI_SECRET_ENV = /^(STUDIO_.*|EMAIL_.*|RESEND_.*|SMTP_.*|MAILGUN_.*|ANTHROPIC_API_KEY|OPENAI_API_KEY|OPENROUTER_API_KEY|FAL_KEY|APIFY_API_TOKEN|MONDAY_API_TOKEN|GOOGLE_.*TOKEN|GOOGLE_SHEETS_WEBHOOK_URL)$/;
const envValue = (env, name) => { const key = Object.keys(env || {}).find(entry => entry.toUpperCase() === name); return key === undefined ? undefined : env[key]; };
function studioCliEnv({ platform = process.platform, env: source = process.env } = {}) {
  const win = platform === 'win32'; const p = win ? path.win32 : path;
  const searchPaths = win ? [p.join(os.homedir(), '.local', 'bin'), p.join(envValue(source, 'APPDATA') || os.homedir(), 'npm')] : [p.join(os.homedir(), '.local', 'bin'), p.join(os.homedir(), '.claude', 'local'), '/opt/homebrew/bin', '/usr/local/bin'];
  const joined = [win ? '' : loginShellPath, ...searchPaths, (win ? envValue(source, 'PATH') : source.PATH) || ''].filter(Boolean).join(p.delimiter);
  const env = { ...source };
  if (win) for (const name of Object.keys(env)) if (name.toUpperCase() === 'PATH') delete env[name];
  env.PATH = joined;
  for (const name of Object.keys(env)) if (CLI_SECRET_ENV.test(name.toUpperCase())) delete env[name];
  return env;
}
// Windows has no shell here, so an AI CLI's name is looked up the way cmd.exe would find it, without running cmd.exe
// (Node can't start an npm .cmd shim without a shell): each PATH folder in order, a program (.exe, .com) first, else the
// npm shim, read (never run) for what it starts. Claude Code's shim starts claude.exe. Codex's starts node with
// codex.js, which only finds its own codex.exe and starts that with two variables, so the exe is started directly with
// them. Any other script runs on the Node.js beside the shim or on PATH. { command, prefixArgs, env } or null when
// nothing is found; elsewhere the name is used as it is.
const SHIM_TARGET = /"%~?dp0%?\\([^"]+)"/g;
const CODEX_PLATFORM_PACKAGES = [['codex-win32-x64', 'x86_64-pc-windows-msvc'], ['codex-win32-arm64', 'aarch64-pc-windows-msvc']];
function resolveCli(name, { env = process.env, platform = process.platform, fsImpl = fs } = {}) {
  if (platform !== 'win32') return { command: name, prefixArgs: [], env: {} };
  const p = path.win32;
  const isFile = (target) => { try { return fsImpl.statSync(target).isFile(); } catch (_) { return false; } };
  // Drive and network folders only: a relative one would be checked here but resolved against the spawn's working folder.
  const folders = String(envValue(env, 'PATH') || '').split(';').map(entry => entry.trim().replace(/^"(.*)"$/, '$1').trim()).filter(entry => /^(?:[A-Za-z]:[\\/]|[\\/]{2})/.test(entry));
  const program = command => ({ command, prefixArgs: [], env: {} });
  for (const folder of folders) {
    const direct = ['.exe', '.com'].map(extension => p.join(folder, `${name}${extension}`)).find(isFile);
    if (direct) return program(direct);
    const shim = p.join(folder, `${name}.cmd`);
    if (!isFile(shim)) continue;
    let text; try { text = String(fsImpl.readFileSync(shim, 'utf8')); } catch (_) { continue; }
    const found = [...text.matchAll(SHIM_TARGET)].pop();
    if (!found) continue;
    const target = p.resolve(folder, found[1]);
    if (/\.exe$/i.test(target)) { if (isFile(target)) return program(target); continue; }
    if (/\\@openai\\codex\\bin\\codex\.js$/i.test(target)) {
      // The platform package sits inside Codex's own node_modules (a global install) or beside it (hoisted).
      const pkg = p.dirname(p.dirname(target));
      const exe = [
        ...CODEX_PLATFORM_PACKAGES.map(([dir, triple]) => p.join(pkg, 'node_modules', '@openai', dir, 'vendor', triple, 'bin', 'codex.exe')),
        ...CODEX_PLATFORM_PACKAGES.map(([dir, triple]) => p.join(pkg, '..', dir, 'vendor', triple, 'bin', 'codex.exe')),
        p.join(pkg, 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe'),
      ].find(isFile);
      if (exe) return { command: exe, prefixArgs: [], env: { CODEX_MANAGED_BY_NPM: '1', CODEX_MANAGED_PACKAGE_ROOT: pkg } };
    }
    if (!/\.[cm]?js$/i.test(target) || !isFile(target)) continue;
    // Never process.execPath: the packaged app can't run as Node (its runAsNode fuse is off).
    const node = [p.join(folder, 'node.exe'), ...folders.map(entry => p.join(entry, 'node.exe')), p.join(envValue(env, 'PROGRAMFILES') || 'C:\\Program Files', 'nodejs', 'node.exe')].find(isFile);
    if (node) return { command: node, prefixArgs: [target], env: {} };
  }
  return null;
}
// Stops a CLI and everything it started. On Windows a process's children outlive it, so taskkill /T ends the whole tree
// (it must run while the CLI is still alive to find its children); if taskkill can't run or fails, the CLI itself is
// still ended.
function killProcessTree(child, { platform = process.platform, spawnImpl = spawn, systemRoot = process.env.SystemRoot } = {}) {
  if (!child || child.exitCode != null || child.signalCode != null) return;
  const end = (signal) => { try { child.kill(signal); } catch (_) { /* already gone */ } };
  if (platform !== 'win32') { end('SIGTERM'); return; }
  if (!Number.isInteger(child.pid)) { end(); return; }
  try {
    const taskkill = spawnImpl(path.win32.join(systemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    taskkill.on?.('error', () => end());
    taskkill.on?.('close', (code) => { if (code !== 0) end(); });
  } catch (_) { end(); }
}
function createStudioHost({ root, getApifyToken = () => process.env.APIFY_API_TOKEN, model = () => process.env.CLAUDE_MODEL || DEFAULT_CLAUDE_MODEL, Client = ApifyClient, runnerOptions = {} } = {}) {
  const datasetsDir = path.join(root, 'datasets'); const collectionsDir = path.join(root, 'collections');
  fs.mkdirSync(datasetsDir, { recursive: true }); fs.mkdirSync(collectionsDir, { recursive: true });
  const children = new Map(); const aborts = new Map(); const activeCollections = new Set();
  const safeId = (key, label = 'record') => { if (typeof key !== 'string' || !/^[a-zA-Z0-9_-]{1,180}$/.test(key)) throw new Error(`Invalid ${label} ID.`); return key; };
  const datasetFile = key => path.join(datasetsDir, `${safeId(key, 'dataset')}.json`);
  const indexFile = path.join(root, 'dataset-index.json'); let metadata; let metadataStamp;
  const indexStamp = () => { if (!fs.existsSync(indexFile)) return ''; const info = fs.statSync(indexFile); return `${info.ino}:${info.mtimeMs}:${info.size}`; };
  function readJson(target) { return JSON.parse(fs.readFileSync(target, 'utf8')); }
  // On Windows the rename is retried while a scanner holds the file (src/shared/durable-write.js). Cleanup that fails
  // (EBUSY again) never hides the error that stopped the save.
  function atomicJson(target, value) {
    const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`; let fd;
    try { fd = fs.openSync(temporary, 'wx', 0o600); fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined; require('../shared/durable-write').renameDurable(temporary, target); }
    finally {
      try { if (fd !== undefined) fs.closeSync(fd); } catch (_) { /* already closed */ }
      try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch (_) { /* a leftover temp file is harmless; the save's own error is the one to report */ }
    }
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
        const lock = readJson(target);
        if (!Number.isInteger(lock.pid) || lock.pid < 1) throw new Error('Collection lock is invalid. Check this saved run before retrying.');
        // Our own PID is live only in a lock written since this process started (another host in this process). An older
        // one was left by an earlier process the system gave the same PID: Windows after a restart, a container's PID 1.
        const alive = lock.pid === process.pid ? fs.statSync(target).mtimeMs >= Date.now() - process.uptime() * 1000 : require('./studio-owner-lock').lockOwnerAlive(lock) !== false;
        if (alive) throw new Error('This collection is already active on this host. Wait for it or cancel it before retrying.');
        fs.unlinkSync(target);
      }
    }
    throw new Error('Could not reserve this collection. Retry when no other host is running it.');
  }
  const redactError = error => String(error?.message || error).replace(/(?:Bearer\s+|(?:sk-|apify_api_))[\w.-]+/gi, '[redacted]').replace(/([?&]token=)[^&\s]+/gi, '$1[redacted]').slice(0, 1500);
  const TERMINAL = new Set(['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT']);
  async function pool(items, limit, worker) {
    const queue = [...items]; const runners = Array.from({ length: Math.max(1, Math.min(limit, queue.length)) }, async () => { while (queue.length) await worker(queue.shift()); });
    await Promise.all(runners);
  }
  async function collect({ program, runId, workspaceId, isCancelled = () => false, onProgress = () => {} }) {
    safeId(runId, 'research run'); safeId(workspaceId, 'workspace');
    if (activeCollections.has(runId)) throw new Error('This collection is already active.');
    const { buildCollectionPlan } = require('../shared/research-collection'); const plan = buildCollectionPlan(program);
    const fingerprint = createHash('sha256').update(JSON.stringify(plan)).digest('hex');
    const checkpointFile = path.join(collectionsDir, `${runId}.json`); const unlock = acquireCollectionLock(runId); activeCollections.add(runId);
    let checkpoint; let runner; const runAborts = new Map(); aborts.set(runId, runAborts);
    try {
      if (fs.existsSync(checkpointFile)) {
        checkpoint = readJson(checkpointFile);
        if (checkpoint.version !== 1 || checkpoint.runId !== runId || checkpoint.workspaceId !== workspaceId || checkpoint.planFingerprint !== fingerprint) throw new Error('The saved collection belongs to a different workspace or source plan. Start a new research run instead of changing an already launched collection.');
      } else {
        checkpoint = { version: 1, runId, workspaceId, programId: plan.programId, planFingerprint: fingerprint, createdAt: new Date().toISOString(), jobs: plan.jobs.map(job => ({ id: job.id, lane: job.lane, datasetId: `dataset-${createHash('sha256').update(`${runId}:${job.id}`).digest('hex').slice(0, 24)}`, status: 'planned', budgetUsd: job.budgetUsd, reservedBudgetUsd: 0, providerRunId: null })) };
        atomicJson(checkpointFile, checkpoint);
      }
      const save = () => { checkpoint.updatedAt = new Date().toISOString(); atomicJson(checkpointFile, checkpoint); };
      const results = new Map(); const failures = [];
      const lanes = [...new Set(plan.jobs.map(job => job.lane))];
      const progress = () => {
        const done = checkpoint.jobs.filter(job => ['succeeded', 'partial'].includes(job.status)).length;
        onProgress(`Collecting ${lanes.map(lane => `${lane === 'x' ? 'X' : lane === 'linkedin' ? 'LinkedIn' : 'Reddit'} ${checkpoint.jobs.filter(job => job.lane === lane && ['succeeded', 'partial'].includes(job.status)).length}/${checkpoint.jobs.filter(job => job.lane === lane).length}`).join(' · ')} (${done} of ${checkpoint.jobs.length} source jobs)`);
      };
      const client = () => new Client({ token: getApifyToken(), maxRetries: 0 });
      async function runJob(job) {
        if (isCancelled()) throw new Error('Collection cancelled.');
        const saved = checkpoint.jobs.find(entry => entry.id === job.id);
        if (!saved) throw new Error('The saved collection checkpoint is incomplete. Review the run before collecting again.');
        // Dataset files are committed before the success checkpoint. Recover that small
        // crash window without repeating even the provider download.
        if (fs.existsSync(datasetFile(saved.datasetId))) {
          const stored = readDataset(saved.datasetId); const dataset = stored.dataset;
          if (dataset?.researchRunId !== runId || dataset?.collectionJobId !== job.id || dataset?.workspaceId !== workspaceId || !Array.isArray(stored.items)) throw new Error('A saved collection dataset has inconsistent ownership or lineage. Restore it before retrying.');
          saved.status = dataset.collectionReceipt?.salvaged ? 'partial' : 'succeeded'; saved.providerRunId = dataset.apifyRunId; saved.receipt = dataset.collectionReceipt; delete saved.error; save(); rememberDataset(dataset);
          results.set(job.id, { dataset, items: stored.items, receipt: { ...saved.receipt, reused: true } }); progress(); return;
        }
        if (saved.status !== 'planned' && !saved.providerRunId && !saved.startRejected) throw new Error('An Actor start was attempted but its run ID was not saved. It may already be charging in Apify. Check the recent Apify run and resolve this collection before starting a new research run; automatic retry will not launch a duplicate.');
        if (!runner) runner = createApifyRunner({ token: getApifyToken(), Client, maxRetries: 0 });
        if (saved.providerRunId && saved.status === 'cancelled') {
          // A run the user cancelled is restarted only once Apify confirms it is terminal.
          const prior = await client().run(saved.providerRunId).get().catch(() => null);
          if (!prior || !TERMINAL.has(prior.status)) throw new Error('The cancelled Apify run has not stopped yet. Retry once it shows as aborted in Apify.');
          saved.previousProviderRunIds = [...(saved.previousProviderRunIds || []), saved.providerRunId]; saved.providerRunId = null; saved.status = 'planned'; save();
        }
        if (!saved.providerRunId) {
          // Fsync the intent and budget BEFORE the potentially billable POST. SDK retries
          // are disabled: a lost start response is an unknown outcome, never a free retry.
          saved.status = 'starting'; saved.startRejected = false; saved.reservedBudgetUsd = job.budgetUsd; saved.startAttemptedAt = new Date().toISOString(); save();
        }
        const attachAbort = providerRunId => runAborts.set(job.id, () => client().run(providerRunId).abort({ gracefully: true }));
        if (saved.providerRunId) attachAbort(saved.providerRunId);
        try {
          const result = await runner.runRecipe(job.recipe, {
            ...runnerOptions, maxItems: job.maxItems, isCancelled, salvage: true, abortAfterMs: job.abortAfterSecs * 1000, ...(saved.providerRunId ? { resumeRunId: saved.providerRunId } : {}), expandComments: job.sourceId === 'linkedin-search',
            onRunStarted: run => {
              if (!run?.id || typeof run.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(run.id)) throw new Error('Apify did not provide a valid run ID; the start outcome requires manual review.');
              saved.providerRunId = run.id; saved.status = 'running'; saved.providerStatus = run.status || 'UNKNOWN'; save(); attachAbort(run.id);
            },
            onStatus: run => { saved.providerStatus = run.status || 'UNKNOWN'; save(); },
          });
          if (isCancelled()) throw new Error('Collection cancelled.');
          const costUsd = typeof result.run.usageTotalUsd === 'number' && Number.isFinite(result.run.usageTotalUsd) && result.run.usageTotalUsd >= 0 ? result.run.usageTotalUsd : null;
          const receipt = { jobId: job.id, sourceId: job.sourceId, lane: job.lane, apifyRunId: result.run.id, providerStatus: result.run.status, salvaged: !!result.salvaged, abortedForTimeLimit: !!result.run.abortedForTimeLimit, statusMessage: result.statusMessage || '', costUsd, budgetUsd: job.budgetUsd, itemCount: result.normalizedItems.length, providerRows: result.rawItems.length, targetCount: job.targets.length, reused: false };
          const dataset = { id: saved.datasetId, workspaceId, name: `${program.name} · ${job.sourceId}`, platform: job.platform, itemCount: result.normalizedItems.length, createdAt: new Date().toISOString(), researchRunId: runId, collectionJobId: job.id, apifyRunId: result.run.id, collectionReceipt: receipt };
          atomicJson(datasetFile(dataset.id), { dataset, items: result.normalizedItems, rawItems: result.rawItems }); rememberDataset(dataset);
          saved.status = result.salvaged ? 'partial' : 'succeeded'; saved.receipt = receipt; delete saved.error; save();
          results.set(job.id, { dataset, items: result.normalizedItems, receipt }); progress();
        } catch (error) {
          const cancelled = isCancelled() || /cancelled/i.test(String(error?.message));
          // Apify answered the start with a client error: no run exists, so a retry may start again.
          const rejected = !saved.providerRunId && Number.isInteger(error?.statusCode) && error.statusCode >= 400 && error.statusCode < 500;
          saved.status = cancelled ? 'cancelled' : 'failed'; saved.startRejected = rejected; saved.error = redactError(error); save();
          if (cancelled) throw error;
          failures.push({ jobId: job.id, lane: job.lane, sourceId: job.sourceId, targets: job.targets.slice(0, 5), error: saved.error });
        } finally { runAborts.delete(job.id); }
      }
      progress();
      // Every lane runs at the same time (n8n launches all three Actors, then collects); within a
      // lane a few jobs run concurrently so large X and LinkedIn rosters finish in one pass.
      await Promise.all(lanes.map(lane => pool(plan.jobs.filter(job => job.lane === lane), plan.receipt.laneConcurrency || 4, runJob)));
      if (isCancelled()) throw new Error('Collection cancelled.');
      if (failures.length) {
        const summary = failures.slice(0, 3).map(failure => `${failure.sourceId} (${failure.targets.join(', ')}${failure.targets.length < 5 ? '' : '…'}): ${failure.error}`).join(' | ');
        throw new Error(`${failures.length} of ${plan.jobs.length} source jobs failed; ${results.size} finished and are saved for the retry. ${summary}`);
      }
      const ordered = plan.jobs.map(job => results.get(job.id)).filter(Boolean);
      const items = ordered.flatMap(entry => entry.items); const datasetIds = ordered.map(entry => entry.dataset.id); const receipts = ordered.map(entry => entry.receipt);
      const salvaged = receipts.filter(receipt => receipt.salvaged);
      const warnings = [...plan.receipt.warnings, ...salvaged.map(receipt => `${receipt.sourceId} job ended ${receipt.providerStatus}${receipt.abortedForTimeLimit ? ' (time limit)' : ''}; kept the ${receipt.itemCount} rows it collected.`)];
      const lanesSummary = Object.fromEntries(lanes.map(lane => [lane, { jobs: receipts.filter(receipt => receipt.lane === lane).length, rows: receipts.filter(receipt => receipt.lane === lane).reduce((sum, receipt) => sum + receipt.itemCount, 0), salvagedJobs: receipts.filter(receipt => receipt.lane === lane && receipt.salvaged).length }]));
      return { items, datasetIds, receipt: { ...plan.receipt, warnings, workspaceId, runId, lanes: lanesSummary, succeededJobs: receipts.filter(receipt => !receipt.salvaged).length, partialJobs: salvaged.length, reusedJobs: receipts.filter(receipt => receipt.reused).length, reservedBudgetUsd: Math.round(checkpoint.jobs.reduce((sum, job) => sum + job.reservedBudgetUsd, 0) * 100) / 100, costUsd: receipts.every(receipt => receipt.costUsd !== null) ? Math.round(receipts.reduce((sum, receipt) => sum + receipt.costUsd, 0) * 10000) / 10000 : null, runs: receipts } };
    } finally { aborts.delete(runId); activeCollections.delete(runId); unlock(); }
  }
  function runAI({ runId, schema, prompt, maxBudgetUsd, workspaceDir, outputPath, model: stageModel, effort, timeoutMs = 1800000 }) {
    const requestedModel = stageModel || model(); const invocation = buildClaudeCommand({ model: requestedModel, schema, prompt, maxBudgetUsd, effort });
    return new Promise((resolve, reject) => {
      const child = spawn(invocation.command, invocation.args, { cwd: workspaceDir, env: { ...studioCliEnv(), ...CLAUDE_CLI_ENV }, windowsHide: true });
      if (!children.has(runId)) children.set(runId, new Set()); children.get(runId).add(child); let stdout = ''; let stderr = ''; let done = false;
      const finish = (error, value) => { if (done) return; done = true; clearTimeout(timer); children.get(runId)?.delete(child); if (!children.get(runId)?.size) children.delete(runId); error ? reject(error) : resolve(value); };
      const timer = setTimeout(() => { child.kill(); finish(new Error('Claude timed out. Retry the incomplete output.')); }, timeoutMs);
      child.on('error', error => finish(new Error(error.code === 'ENOENT' ? 'Install Claude Code and sign in on this host before generating content.' : 'Claude could not start.')));
      child.stdout.on('data', chunk => { stdout += chunk; if (stdout.length > 20000000) { child.kill(); finish(new Error('Claude output exceeded the limit.')); } });
      child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-2000); });
      child.stdin.on('error', () => {}); child.stdin.end(invocation.stdin);
      child.on('close', code => {
        if (code !== 0) { const costUsd = readClaudeCost(stdout); try { parseClaudeResult(stdout); } catch (error) { error.costUsd = costUsd; return finish(error); } const error = new Error('Claude did not complete this request. Check the host CLI connection and budget.'); error.costUsd = costUsd; return finish(error); }
        try { const parsed = parseClaudeResult(stdout); if (!modelMatches(requestedModel, parsed.actualModels)) throw new Error('Claude returned a different or unverified model.'); fs.writeFileSync(outputPath, JSON.stringify(parsed.output, null, 2), { mode: 0o600 }); finish(null, { output: parsed.output, receipt: { provider: 'claude', requestedModel, actualModel: parsed.actualModel, actualModels: parsed.actualModels, effort: effort || '', costUsd: parsed.costUsd, usage: parsed.usage, durationMs: parsed.durationMs } }); } catch (error) { finish(error); }
      });
    });
  }
  async function cancelProvider(runId) { for (const child of children.get(runId) || []) killProcessTree(child); const entry = aborts.get(runId); const list = entry instanceof Map ? [...entry.values()] : entry ? [entry] : []; await Promise.all(list.map(abort => abort().catch(() => {}))); }
  return { collect, getDatasets, readDataset, runAI, cancelProvider };
}
module.exports = { createStudioHost, studioCliEnv, loadLoginShellPath, resolveCli, killProcessTree };
