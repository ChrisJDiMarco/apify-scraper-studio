const { app, BrowserWindow, ipcMain, safeStorage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { ApifyClient } = require('apify-client');
const workflow = require('../shared/asset-workflow.json');
let autoUpdater = null;
try {
  ({ autoUpdater } = require('electron-updater'));
} catch (_) {
  autoUpdater = null;
}
const { createApifyRunner, discoverApifyResource: discoverApifyResourceLive } = require('../shared/apify-runner');
const { SCHEMAS, buildAnalysisContext, buildAssetPrompt, buildCodexCommand, buildPrompt, parseJsonlEvents, reportPresetById, validateAiOutput } = require('../shared/codex-runner');
const { buildArchiveClearRequest, buildDatasetWriteRequests, buildPingRequest, buildSheetReadRequest, isRetryableSheetMessage, isRetryableSheetStatus } = require('../shared/google-sheets');
const { buildStudioIntelligence, planIntent } = require('../shared/intelligence');
const { normalizeItem, toCsv, toJsonl } = require('../shared/normalize');
const packageConfig = require('../../package.json');
const { publicRecipe, toId, validateRecipe } = require('../shared/recipe');
const {
  validateAnalysisPayload,
  validateAssetPayload,
  validateCardPayload,
  validateExportPayload,
  validateGenerateAssetsPayload,
  validateId,
  validateIntentActionPayload,
  validateIntentPayload,
  validateJobPayload,
  validateKeyValue,
  validateKeyName,
  validateMissionPayload,
  validateMoveCardPayload,
  validateRecipeVersionPayload,
  validateSchedulePayload,
  validateSettings,
  stringValue,
} = require('../shared/validation');
const {
  MISSION_PRESETS,
  appendEvent,
  buildActionGraph,
  buildDatasetProfileV2,
  buildEvidenceIndex,
  buildObservability,
  buildReleaseDiagnostics,
  createEvent,
  createMission,
  createMissionBundle,
  dueSchedules,
  migrateLegacyDataToEvents,
  nextScheduleAt,
  projectEvents,
  readEvents,
  scoreEvalSuite,
  searchEvidence,
  validateActionGraph,
  validateSchedule,
} = require('../shared/v5-core');
const { ensureWorkspace, isPathInside, safeFilename } = require('../shared/workspace');

const APP_NAME = 'Apify Scraper Studio';
const KEY_NAMES = ['APIFY_API_TOKEN', 'GOOGLE_SHEETS_WEBHOOK_URL'];
const CODEX_TIMEOUT_MS = 10 * 60 * 1000;
const jobs = new Map();
const jobProcesses = new Map();
const apifyRunControllers = new Map();
const cancelledJobs = new Set();

let mainWindow;
let dataCache = null;
let configCache = null;
let scheduleTimer = null;
const runningScheduledMissions = new Set();

function now() {
  return new Date().toISOString();
}

function cliEnv() {
  return { ...process.env, PATH: ['/opt/homebrew/bin', '/usr/local/bin', process.env.PATH || ''].filter(Boolean).join(':') };
}

function dataRoot() {
  return app.getPath('userData');
}

function dataPath(...parts) {
  return path.join(dataRoot(), ...parts);
}

function ensureDirs() {
  for (const dir of ['assets', 'datasets', 'exports', 'reports', 'sheets', 'workspaces', 'v5', 'v5/jobs', 'v5/bundles']) {
    fs.mkdirSync(dataPath(dir), { recursive: true });
  }
}

function defaultData() {
  return {
    projects: [{ id: 'default', name: 'Default Project', createdAt: now() }],
    recipes: [],
    runs: [],
    datasets: [],
    analyses: [],
    intentRuns: [],
    cards: [],
    assets: [],
    sheetRuns: [],
    settings: {
      maxItems: 1000,
      sheets: {},
    },
  };
}

function defaultConfig() {
  return { keys: {} };
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (fs.existsSync(filePath) && error instanceof SyntaxError) {
      fs.copyFileSync(filePath, `${filePath}.bad-${Date.now()}`);
    }
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2));
  fs.renameSync(tempPath, filePath);
}

function dataFile() {
  return dataPath('data.json');
}

function configFile() {
  return dataPath('config.json');
}

function loadData() {
  if (dataCache) return dataCache;
  ensureDirs();
  dataCache = { ...defaultData(), ...readJson(dataFile(), {}) };
  dataCache.projects = dataCache.projects?.length ? dataCache.projects : defaultData().projects;
  dataCache.recipes = dataCache.recipes || [];
  dataCache.runs = dataCache.runs || [];
  dataCache.datasets = dataCache.datasets || [];
  dataCache.analyses = dataCache.analyses || [];
  dataCache.intentRuns = dataCache.intentRuns || [];
  dataCache.cards = dataCache.cards || [];
  dataCache.assets = dataCache.assets || [];
  dataCache.sheetRuns = dataCache.sheetRuns || [];
  dataCache.settings = { ...defaultData().settings, ...(dataCache.settings || {}) };
  saveData();
  return dataCache;
}

function saveData() {
  writeJson(dataFile(), dataCache || defaultData());
}

function loadConfig() {
  if (configCache) return configCache;
  ensureDirs();
  configCache = { ...defaultConfig(), ...readJson(configFile(), {}) };
  configCache.keys = configCache.keys || {};
  saveConfig();
  return configCache;
}

function saveConfig() {
  writeJson(configFile(), configCache || defaultConfig());
}

function encryptValue(value) {
  if (safeStorage.isEncryptionAvailable()) {
    return { encrypted: true, value: safeStorage.encryptString(value).toString('base64') };
  }
  throw new Error('macOS secure storage is unavailable. Token was not saved.');
}

function decryptValue(stored) {
  if (!stored) return '';
  if (stored.encrypted && safeStorage.isEncryptionAvailable()) {
    return safeStorage.decryptString(Buffer.from(stored.value, 'base64'));
  }
  return '';
}

function getKey(name) {
  const config = loadConfig();
  return decryptValue(config.keys[name]) || process.env[name] || '';
}

function publicState() {
  const data = loadData();
  const v5 = publicV5State(data);
  return {
    ...data,
    recipes: data.recipes.map(publicRecipe),
    intelligence: studioIntelligence(data),
    keys: Object.fromEntries(KEY_NAMES.map((name) => [name, Boolean(getKey(name))])),
    jobs: Array.from(jobs.values()),
    v5,
  };
}

function studioIntelligence(data = loadData()) {
  return buildStudioIntelligence(data, (dataset) => readJson(datasetPayloadFile(dataset.id), { rawItems: [], items: [] }));
}

function emit(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function emitState() {
  emit('state-changed', publicState());
}

function configureAutoUpdates() {
  if (!autoUpdater || !process.env.APIFY_STUDIO_AUTO_UPDATE_URL) return;
  autoUpdater.setFeedURL({ provider: 'generic', url: process.env.APIFY_STUDIO_AUTO_UPDATE_URL });
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on('error', (error) => {
    appendV5Event('job-finished', {
      id: toId('update-check'),
      status: 'failed',
      error: error.message || String(error),
      metrics: { updateCheck: true },
    });
  });
}

function v5EventsFile() {
  return dataPath('v5', 'events.jsonl');
}

function v5ProjectionFile() {
  return dataPath('v5', 'projection.json');
}

function v5JobLogPath(jobId) {
  return dataPath('v5', 'jobs', `${safeFilename(jobId)}.log`);
}

function readV5EventsSafe() {
  try {
    return readEvents(v5EventsFile());
  } catch (error) {
    const eventsPath = v5EventsFile();
    if (fs.existsSync(eventsPath)) fs.copyFileSync(eventsPath, `${eventsPath}.bad-${Date.now()}`);
    return [];
  }
}

function appendV5Event(type, payload, options = {}) {
  const event = createEvent(type, payload, options);
  appendEvent(v5EventsFile(), event);
  writeJson(v5ProjectionFile(), buildV5Projection(loadData()));
  return event;
}

function legacyHasData(data = {}) {
  return ['recipes', 'runs', 'datasets', 'analyses', 'cards', 'assets', 'intentRuns'].some((key) => Array.isArray(data[key]) && data[key].length);
}

function ensureV5Seed(data = loadData()) {
  ensureDirs();
  const events = readV5EventsSafe();
  if (events.length) return events;
  const seedEvents = migrateLegacyDataToEvents(data);
  for (const event of seedEvents) appendEvent(v5EventsFile(), event);
  return legacyHasData(data) ? seedEvents : seedEvents;
}

function buildAllEvidence(data = loadData()) {
  const evidence = [];
  for (const dataset of data.datasets || []) {
    try {
      evidence.push(...buildEvidenceIndex(dataset, readJson(datasetPayloadFile(dataset.id), { rawItems: [], items: [] })));
    } catch (_) {
      // A missing dataset payload should not break the whole command center.
    }
  }
  return evidence;
}

function buildDatasetProfilesV2(data = loadData()) {
  return (data.datasets || []).map((dataset) => {
    try {
      return buildDatasetProfileV2(dataset, readJson(datasetPayloadFile(dataset.id), { rawItems: [], items: [] }));
    } catch (error) {
      return {
        datasetId: dataset.id,
        name: dataset.name || dataset.id,
        rowCount: Number(dataset.itemCount) || 0,
        fields: [],
        rowTypes: [],
        mapperWarnings: [error.message || String(error)],
        recommendedFixes: [{ severity: 'high', message: error.message || String(error) }],
        confidence: 0,
      };
    }
  });
}

function buildV5Projection(data = loadData()) {
  const events = ensureV5Seed(data);
  const projection = projectEvents(events);
  return {
    ...projection,
    recipes: data.recipes.map(publicRecipe),
    runs: data.runs || [],
    datasets: data.datasets || [],
    analyses: data.analyses || [],
    cards: data.cards || [],
    assets: data.assets || [],
  };
}

function commandPaletteItems(projection, data = loadData()) {
  const mission = projection.missions.find((item) => item.id === projection.activeMissionId) || projection.missions[0] || null;
  return [
    { id: 'run-active-mission', label: mission ? `Run ${mission.name}` : 'Run active mission', action: 'runMission', args: { missionId: mission?.id || '' }, shortcut: 'Cmd+Enter' },
    { id: 'new-mission', label: 'New mission', action: 'navigate', args: { view: 'dashboard' }, shortcut: 'Cmd+N' },
    { id: 'open-recipes', label: 'Open recipe builder', action: 'navigate', args: { view: 'automation' }, shortcut: 'Cmd+R' },
    { id: 'open-datasets', label: 'Search datasets', action: 'navigate', args: { view: 'datasets' }, shortcut: 'Cmd+F' },
    { id: 'open-artifacts', label: 'Open artifact studio', action: 'navigate', args: { view: 'assets' }, shortcut: 'Cmd+Shift+A' },
  ].filter((item) => item.args?.missionId !== '' || item.id !== 'run-active-mission' || data.recipes.length);
}

function buildOnboardingState(data = loadData(), projection = buildV5Projection(data)) {
  const mission = projection.missions.find((item) => item.id === projection.activeMissionId) || projection.missions[0] || null;
  const steps = [
    { id: 'token', label: 'Connect Apify', done: Boolean(getKey('APIFY_API_TOKEN')), view: 'settings' },
    { id: 'recipe', label: 'Save a recipe', done: Boolean(data.recipes.length), view: 'automation' },
    { id: 'dataset', label: 'Run a dataset', done: Boolean(data.datasets.length), view: 'automation' },
    { id: 'mission', label: 'Schedule a mission', done: Boolean(mission && projection.schedules[mission.id]), view: 'dashboard' },
  ];
  return {
    done: steps.filter((step) => step.done).length,
    total: steps.length,
    steps,
    next: steps.find((step) => !step.done) || null,
  };
}

function buildLocalEvalSuite(data = loadData(), evidence = buildAllEvidence()) {
  const cases = (data.assets || []).slice(0, 12).map((asset) => ({
    id: asset.id,
    name: asset.title || asset.id,
    artifact: asset,
    evidence,
    minScore: asset.status === 'approved' ? 85 : 70,
  }));
  if (!cases.length) {
    cases.push({
      id: 'empty-workspace-smoke',
      name: 'Empty workspace smoke',
      artifact: { markdown: 'No generated assets have been evaluated yet.', evidenceIds: [] },
      evidence,
      minScore: 10,
    });
  }
  return scoreEvalSuite(cases);
}

function publicV5State(data = loadData()) {
  const projection = buildV5Projection(data);
  const evidence = buildAllEvidence(data);
  const datasetProfiles = buildDatasetProfilesV2(data);
  const observability = buildObservability({ ...projection, ...data });
  const releasePackageConfig = process.env.APIFY_STUDIO_AUTO_UPDATE_URL
    ? { ...packageConfig, build: { ...(packageConfig.build || {}), publish: { provider: 'generic', url: process.env.APIFY_STUDIO_AUTO_UPDATE_URL } } }
    : packageConfig;
  const release = buildReleaseDiagnostics({ platform: process.platform, env: process.env, packageConfig: releasePackageConfig });
  return {
    ...projection,
    missionPresets: MISSION_PRESETS,
    datasetProfiles,
    onboarding: buildOnboardingState(data, projection),
    evals: buildLocalEvalSuite(data, evidence),
    evidenceSummary: {
      total: evidence.length,
      datasets: Object.fromEntries((data.datasets || []).map((dataset) => [
        dataset.id,
        evidence.filter((item) => item.datasetId === dataset.id).length,
      ])),
      sample: evidence.slice(0, 8),
    },
    observability,
    release,
    commandPalette: commandPaletteItems(projection, data),
  };
}

function saveMission(payload) {
  const valid = validateMissionPayload(payload);
  const mission = createMission(valid);
  appendV5Event('mission-saved', { mission });
  emitState();
  return mission;
}

function pauseMission(missionId) {
  const validMissionId = validateId(missionId, 'Mission ID');
  appendV5Event('mission-status-changed', { missionId: validMissionId, status: 'paused' });
  emitState();
  return publicV5State().missions.find((mission) => mission.id === validMissionId);
}

function scheduleMission(payload) {
  const record = payload && typeof payload === 'object' ? payload : {};
  const missionId = validateId(record.missionId, 'Mission ID');
  const baseSchedule = validateSchedule(validateSchedulePayload(record.schedule || record));
  const schedule = {
    ...baseSchedule,
    nextRunAt: baseSchedule.nextRunAt || nextScheduleAt(baseSchedule, { from: now() }),
  };
  appendV5Event('mission-scheduled', { missionId, schedule });
  appendV5Event('mission-status-changed', { missionId, status: schedule.paused ? 'paused' : 'watching' });
  emitState();
  return { missionId, ...schedule };
}

async function runMission(missionId, options = {}) {
  const projection = publicV5State();
  const mission = projection.missions.find((item) => item.id === validateId(missionId, 'Mission ID'));
  if (!mission) throw new Error('Mission not found.');
  const data = loadData();
  const dataset = data.datasets.find((item) => mission.datasetIds.includes(item.id)) || data.datasets[0] || null;
  const recipe = data.recipes.find((item) => mission.recipeIds.includes(item.id)) || data.recipes[0] || null;
  const graph = buildActionGraph(mission.goal || mission.name, { ...data, selectedDatasetId: dataset?.id || '', recipes: recipe ? [recipe] : data.recipes, intelligence: studioIntelligence(data) });
  const validation = validateActionGraph(graph);
  if (!validation.canRun) throw new Error(validation.errors.join(' ') || graph.missing.join(' ') || 'Mission is not runnable.');
  const jobId = toId('mission-job');
  const logsPath = v5JobLogPath(jobId);
  appendV5Event('job-started', { id: jobId, missionId: mission.id, kind: 'mission', title: mission.name, sourceAction: { action: 'run-mission', args: { missionId: mission.id } }, logsPath });
  fs.writeFileSync(logsPath, `Mission ${mission.name} started ${now()}\n${JSON.stringify(graph, null, 2)}\n`);
  try {
    const result = await runPlannedIntent(
      { ...graph, intent: graph.presetId, profile: null, summary: graph.steps.map((step) => step.label).join(' -> ') },
      { jobId, logsPath, completedStepIds: options.completedStepIds || [] },
    );
    fs.appendFileSync(logsPath, `Mission completed ${now()}\n`);
    appendV5Event('job-finished', { id: jobId, status: 'succeeded', artifacts: result.results || [], metrics: { completedSteps: result.completedSteps || 0, completedStepIds: result.completedStepIds || [] } });
    return { mission, graph, result };
  } catch (error) {
    fs.appendFileSync(logsPath, `Mission failed ${now()}\n${error.message || String(error)}\n`);
    appendV5Event('job-finished', { id: jobId, status: 'failed', error: error.message || String(error), metrics: { completedStepIds: error.completedStepIds || [] } });
    throw error;
  } finally {
    emitState();
  }
}

async function runActionGraph(payload) {
  const record = payload && typeof payload === 'object' ? payload : {};
  const graph = record.graph && typeof record.graph === 'object' ? record.graph : record;
  const validation = validateActionGraph(graph);
  if (!validation.canRun) throw new Error(validation.errors.join(' ') || graph.missing?.join(' ') || 'Action graph is not runnable.');
  const jobId = toId('graph-job');
  const logsPath = v5JobLogPath(jobId);
  appendV5Event('job-started', { id: jobId, kind: 'mission', title: graph.title || graph.command || 'Action graph', sourceAction: { action: 'run-action-graph', args: { graph } }, logsPath });
  fs.writeFileSync(logsPath, `Action graph started ${now()}\n${JSON.stringify(graph, null, 2)}\n`);
  try {
    const result = await runPlannedIntent({
      ...graph,
      command: graph.command || graph.title || 'Action graph',
      intent: graph.presetId || 'custom-action-graph',
      summary: graph.steps.map((step) => step.label).join(' -> '),
      canRun: true,
      missing: [],
    }, { jobId, logsPath });
    appendV5Event('job-finished', { id: jobId, status: 'succeeded', artifacts: result.results || [], metrics: { completedSteps: result.completedSteps || 0, completedStepIds: result.completedStepIds || [] } });
    emitState();
    return { graph, result };
  } catch (error) {
    appendV5Event('job-finished', { id: jobId, status: 'failed', error: error.message || String(error), metrics: { completedStepIds: error.completedStepIds || [] } });
    emitState();
    throw error;
  }
}

async function discoverApifyResource(payload) {
  const discovered = await discoverApifyResourceLive(payload, {
    token: getKey('APIFY_API_TOKEN'),
    Client: ApifyClient,
  });
  return {
    ...discovered,
    inputTemplate: Object.keys(discovered.inputTemplate || {}).length
      ? discovered.inputTemplate
      : { startUrls: [], maxItems: loadData().settings.maxItems || 1000 },
  };
}

function saveRecipeVersion(payload) {
  const valid = validateRecipeVersionPayload(payload);
  appendV5Event('recipe-version-saved', valid);
  emitState();
  return publicV5State().recipeVersions[valid.recipeId]?.[0] || valid.version;
}

async function testRecipe(payload) {
  const recipe = validateRecipe(payload);
  const data = loadData();
  const runner = createApifyRunner({ token: getKey('APIFY_API_TOKEN'), Client: ApifyClient });
  const result = await runner.runRecipe(recipe, { maxItems: Math.min(10, Number(data.settings.maxItems) || 10) });
  const dataset = { id: 'test-dataset', name: `${recipe.name} test`, platform: recipe.platform, runId: result.run.id, recipeId: recipe.id };
  return {
    run: result.run,
    rawSample: result.rawItems.slice(0, 5),
    normalizedSample: result.normalizedItems.slice(0, 5),
    profile: buildDatasetProfileV2(dataset, { items: result.normalizedItems }),
  };
}

function getJob(jobId) {
  const id = validateId(jobId, 'Job ID');
  const job = publicV5State().jobs.find((item) => item.id === id);
  if (!job) throw new Error('Job not found.');
  return job;
}

async function retryJob(jobId) {
  const job = getJob(jobId);
  const action = job.sourceAction || {};
  if (action.action === 'run-mission' && action.args?.missionId) {
    return runMission(action.args.missionId, { retryOf: job.id, completedStepIds: job.metrics?.completedStepIds || [] });
  }
  if (action.action === 'run-action-graph' && action.args?.graph) {
    return runActionGraph({ graph: action.args.graph, retryOf: job.id });
  }
  throw new Error('Job has no retryable source action.');
}

function readJobLog(jobId) {
  const job = getJob(jobId);
  const logsPath = job.logsPath || v5JobLogPath(job.id);
  if (!fs.existsSync(logsPath)) return '';
  return fs.readFileSync(logsPath, 'utf8');
}

function searchEvidenceRecords(payload) {
  const record = payload && typeof payload === 'object' ? payload : { query: payload };
  return searchEvidence(buildAllEvidence(), String(record.query || ''), { limit: Number(record.limit) || 25 });
}

function readEvidenceRecord(evidenceId) {
  const id = validateId(evidenceId, 'Evidence ID');
  const evidence = buildAllEvidence().find((item) => item.id === id);
  if (!evidence) throw new Error('Evidence not found.');
  return evidence;
}

function exportMissionBundle(missionId) {
  const projection = publicV5State();
  const bundle = createMissionBundle(validateId(missionId, 'Mission ID'), { ...projection, evidence: buildAllEvidence() });
  const filePath = dataPath('v5', 'bundles', `${safeFilename(bundle.mission.name)}-${Date.now()}.json`);
  writeJson(filePath, bundle);
  return { filePath, bundle };
}

function exportAssetPack(payload = {}) {
  const data = loadData();
  const assetIds = Array.isArray(payload.assetIds) ? payload.assetIds.map((id) => validateId(id, 'Asset ID')) : [];
  const assets = (data.assets || []).filter((asset) => !assetIds.length || assetIds.includes(asset.id));
  if (!assets.length) throw new Error('No assets to export.');
  const dir = dataPath('exports', `asset-pack-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  const escapeHtml = (value) => String(value || '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const markdown = assets.map((asset) => `# ${asset.title || asset.id}\n\n${asset.markdown || ''}`).join('\n\n---\n\n');
  const html = `<!doctype html><meta charset="utf-8"><title>Asset Pack</title><body>${assets.map((asset) => `<article><h1>${escapeHtml(asset.title || asset.id)}</h1><pre>${escapeHtml(asset.markdown || '')}</pre></article>`).join('\n')}</body>`;
  const markdownPath = path.join(dir, 'asset-pack.md');
  const htmlPath = path.join(dir, 'asset-pack.html');
  fs.writeFileSync(markdownPath, markdown);
  fs.writeFileSync(htmlPath, html);
  return { dir, markdownPath, htmlPath, assetCount: assets.length };
}

function recoverInterruptedJobs() {
  const projection = publicV5State();
  for (const job of projection.jobs || []) {
    if (['queued', 'running', 'paused'].includes(job.status)) {
      appendV5Event('job-finished', {
        id: job.id,
        status: 'failed',
        error: 'App restarted before this job finished. Retry from the job ledger.',
        metrics: { ...(job.metrics || {}), recoverable: true },
      });
    }
  }
  const data = loadData();
  let changed = false;
  for (const key of ['runs', 'analyses', 'intentRuns']) {
    data[key] = (data[key] || []).map((record) => {
      if (record.status !== 'running') return record;
      changed = true;
      return { ...record, status: 'failed', error: 'App restarted before this job finished.', finishedAt: now() };
    });
  }
  if (changed) saveData();
}

async function checkDueSchedules() {
  const projection = publicV5State();
  const due = dueSchedules(projection.schedules, { now: now() });
  for (const schedule of due) {
    if (!schedule.missionId || runningScheduledMissions.has(schedule.missionId)) continue;
    runningScheduledMissions.add(schedule.missionId);
    const runAt = now();
    appendV5Event('mission-scheduled', {
      missionId: schedule.missionId,
      schedule: {
        ...validateSchedule(schedule),
        lastRunAt: runAt,
        nextRunAt: nextScheduleAt({ ...schedule, nextRunAt: '', lastRunAt: runAt }, { from: runAt }),
      },
    });
    runMission(schedule.missionId).catch((error) => {
      appendV5Event('job-finished', {
        id: toId('schedule-error'),
        missionId: schedule.missionId,
        kind: 'schedule',
        title: 'Scheduled mission failed',
        status: 'failed',
        error: error.message || String(error),
      });
    }).finally(() => {
      runningScheduledMissions.delete(schedule.missionId);
      emitState();
    });
  }
}

function startScheduleLoop() {
  clearInterval(scheduleTimer);
  scheduleTimer = setInterval(() => {
    checkDueSchedules().catch(() => null);
  }, 60 * 1000);
  checkDueSchedules().catch(() => null);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 880,
    minWidth: 1060,
    minHeight: 720,
    title: APP_NAME,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#f6f4ef',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.session.setPermissionRequestHandler((_, __, callback) => callback(false));
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    if (!isAllowedNavigation(targetUrl)) event.preventDefault();
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

function isAllowedNavigation(targetUrl) {
  try {
    const parsed = new URL(targetUrl);
    if (parsed.protocol === 'file:') return true;
    if (!process.env.ELECTRON_RENDERER_URL) return false;
    const devUrl = new URL(process.env.ELECTRON_RENDERER_URL);
    return parsed.origin === devUrl.origin;
  } catch (_) {
    return false;
  }
}

function startJob(job) {
  jobs.set(job.id, job);
  emitState();
  return job;
}

function finishJob(jobId, patch = {}) {
  const current = jobs.get(jobId);
  if (current) jobs.set(jobId, { ...current, ...patch, finishedAt: now() });
  jobProcesses.delete(jobId);
  jobs.delete(jobId);
  emitState();
}

function failJob(jobId, error) {
  const current = jobs.get(jobId);
  if (current) jobs.set(jobId, { ...current, status: 'failed', error: error.message || String(error), finishedAt: now() });
  jobProcesses.delete(jobId);
  jobs.delete(jobId);
  emitState();
}

function wasCancelled(jobId) {
  const cancelled = cancelledJobs.has(jobId);
  if (cancelled) cancelledJobs.delete(jobId);
  return cancelled;
}

function upsertById(list, record) {
  const index = list.findIndex((item) => item.id === record.id);
  if (index >= 0) list[index] = record;
  else list.unshift(record);
}

function containedDataPath(rootName, fileName) {
  const root = dataPath(rootName);
  const filePath = path.resolve(root, fileName);
  if (!isPathInside(root, filePath)) throw new Error('Local file path is outside this app workspace.');
  return filePath;
}

function datasetPayloadFile(datasetId) {
  return containedDataPath('datasets', `${safeFilename(datasetId)}.json`);
}

function datasetPayloadPath(datasetId) {
  const dataset = loadData().datasets.find((item) => item.id === datasetId);
  if (!dataset) throw new Error('Dataset not found.');
  return datasetPayloadFile(dataset.id);
}

function readDatasetPayload(datasetId) {
  return readJson(datasetPayloadPath(datasetId), { rawItems: [], items: [] });
}

function localWorkspaceFile(filePath, missingFallback = null) {
  if (!filePath) return missingFallback;
  const root = dataPath('workspaces');
  const resolved = path.resolve(filePath);
  if (!isPathInside(root, resolved)) throw new Error('Analysis output is outside this app workspace.');
  return fs.existsSync(resolved) ? resolved : missingFallback;
}

function readAnalysisOutput(analysisId) {
  const analysis = loadData().analyses.find((item) => item.id === analysisId);
  if (!analysis) throw new Error('Analysis not found.');
  const outputPath = localWorkspaceFile(analysis.outputPath);
  const reportPath = localWorkspaceFile(analysis.reportPath);
  const eventsPath = localWorkspaceFile(analysis.eventsPath);
  const contextPath = localWorkspaceFile(analysis.contextPath);
  const promptPath = localWorkspaceFile(analysis.promptPath);
  return {
    analysis,
    context: contextPath ? readJson(contextPath, null) : null,
    output: outputPath ? readJson(outputPath, null) : null,
    markdown: reportPath ? fs.readFileSync(reportPath, 'utf8') : '',
    events: eventsPath ? parseJsonlEvents(fs.readFileSync(eventsPath, 'utf8')) : [],
    prompt: promptPath ? fs.readFileSync(promptPath, 'utf8') : '',
    stderr: analysis.stderr || '',
  };
}

function localAnalysisPath(analysisId) {
  const analysis = loadData().analyses.find((item) => item.id === analysisId);
  if (!analysis) throw new Error('Analysis not found.');
  const candidate = analysis.reportPath || analysis.outputPath;
  const filePath = localWorkspaceFile(candidate);
  if (!filePath) throw new Error('Analysis output file not found.');
  return filePath;
}

function assetMarkdownPath(asset) {
  const cardDir = safeFilename(asset.cardId || 'uncategorized');
  const fileName = safeFilename(asset.assetType || asset.id || 'asset');
  return dataPath('assets', cardDir, `${fileName}.md`);
}

function localAssetPath(assetId) {
  const asset = loadData().assets.find((item) => item.id === assetId);
  if (!asset?.assetPath || !fs.existsSync(asset.assetPath)) throw new Error('Asset file not found.');
  const root = dataPath('assets');
  const filePath = path.resolve(asset.assetPath);
  if (!isPathInside(root, filePath)) throw new Error('Asset file is outside this app workspace.');
  return filePath;
}

async function openPathOrThrow(filePath) {
  const error = await shell.openPath(filePath);
  if (error) throw new Error(error);
  return true;
}

function saveCard(payload) {
  const data = loadData();
  const valid = validateCardPayload(payload);
  const card = {
    ...valid,
    id: valid.id || toId('card'),
    column: valid.column || 'detected',
    createdAt: payload?.createdAt || now(),
    updatedAt: now(),
  };
  if (!card.title) throw new Error('Card title is required.');
  upsertById(data.cards, card);
  saveData();
  emitState();
  return card;
}

function moveCard(payload) {
  const data = loadData();
  const valid = validateMoveCardPayload(payload);
  if (!workflow.columns.some((item) => item.id === valid.column)) throw new Error('Unknown Kanban column.');
  const existing = data.cards.find((item) => item.id === valid.cardId);
  const next = {
    ...(valid.card || {}),
    ...(existing || {}),
    id: valid.cardId,
    column: valid.column,
    title: existing?.title || valid.card?.title || valid.cardId,
    updatedAt: now(),
  };
  upsertById(data.cards, next);
  saveData();
  emitState();
  return next;
}

function saveAsset(payload) {
  const data = loadData();
  const valid = validateAssetPayload(payload);
  const existing = valid.id ? data.assets.find((item) => item.id === valid.id) : null;
  const draft = {
    ...(existing || {}),
    ...valid,
    id: valid.id || `${valid.cardId || 'card'}-${valid.assetType || toId('asset')}`,
    cardId: valid.cardId || existing?.cardId || '',
    assetType: valid.assetType || existing?.assetType || '',
    title: valid.title || existing?.title || '',
    channel: valid.channel || existing?.channel || '',
    markdown: valid.markdown ?? existing?.markdown ?? '',
    status: valid.status || existing?.status || 'draft',
    evidenceIds: valid.evidenceIds.length ? valid.evidenceIds : existing?.evidenceIds || [],
    createdAt: payload?.createdAt || existing?.createdAt || now(),
    updatedAt: now(),
  };
  const asset = { ...draft, assetPath: assetMarkdownPath(draft) };
  if (!asset.title) throw new Error('Asset title is required.');
  fs.mkdirSync(path.dirname(asset.assetPath), { recursive: true });
  fs.writeFileSync(asset.assetPath, asset.markdown);
  upsertById(data.assets, asset);
  saveData();
  emitState();
  return asset;
}

function exportDataset(exportPayload) {
  const data = loadData();
  const valid = validateExportPayload(exportPayload);
  const dataset = data.datasets.find((item) => item.id === valid.datasetId);
  if (!dataset) throw new Error('Dataset not found.');
  const payload = readDatasetPayload(valid.datasetId);
  const items = payload.items || [];
  const extension = valid.format === 'csv' ? 'csv' : 'jsonl';
  const content = extension === 'csv' ? toCsv(items) : toJsonl(items);
  const filePath = dataPath('exports', `${safeFilename(dataset.name || dataset.id)}.${extension}`);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  if (valid.reveal) shell.showItemInFolder(filePath);
  return { filePath, itemCount: items.length, format: extension };
}

function sheetSettings() {
  return loadData().settings.sheets || {};
}

function sheetWebhookUrl() {
  const url = getKey('GOOGLE_SHEETS_WEBHOOK_URL');
  if (!url) throw new Error('Save GOOGLE_SHEETS_WEBHOOK_URL in Settings first.');
  return url;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callSheetsWebhook(request, options = {}) {
  const maxAttempts = Math.max(1, Math.min(5, Number(options.maxAttempts) || 3));
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    try {
      const response = await fetch(sheetWebhookUrl(), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
      const text = await response.text();
      let body = {};
      try {
        body = text ? JSON.parse(text) : {};
      } catch (_) {
        body = { raw: text };
      }
      if (!response.ok) {
        const error = new Error(body.error || body.message || `Google Sheets webhook failed: ${response.status}`);
        error.retryable = isRetryableSheetStatus(response.status);
        throw error;
      }
      if (body.error || body.ok === false) {
        const error = new Error(body.error || body.message || 'Google Sheets webhook returned an error.');
        error.retryable = body.retryable === true || isRetryableSheetMessage(error.message);
        throw error;
      }
      return body;
    } catch (error) {
      lastError = error;
      const retryable = error.name === 'AbortError' || error.retryable || /network|fetch|timeout/i.test(error.message || '');
      if (!retryable || attempt >= maxAttempts) throw error;
      await sleep(400 * attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error('Google Sheets webhook failed.');
}

function recordSheetRun(record) {
  const data = loadData();
  const saved = {
    id: record.id || toId('sheet'),
    status: record.status || 'succeeded',
    createdAt: now(),
    ...record,
  };
  upsertById(data.sheetRuns, saved);
  data.sheetRuns = data.sheetRuns.slice(0, 50);
  saveData();
  emitState();
  return saved;
}

function sheetSnapshotPath(runId) {
  return containedDataPath('sheets', `${safeFilename(runId)}.json`);
}

function sheetRequestSummary(request = {}) {
  return {
    action: request.action || '',
    spreadsheetId: request.spreadsheetId || '',
    tabName: request.tabName || '',
    tabs: request.tabs || [],
    rows: Number(request.rowCount) || (Array.isArray(request.rows) ? request.rows.length : 0),
    chunks: Number(request.chunkCount) || (Array.isArray(request.requests) ? request.requests.length : 0),
  };
}

function writeSheetSnapshot(run, extra = {}) {
  writeJson(sheetSnapshotPath(run.id), {
    ...extra,
    run,
  });
}

function startSheetRun(kind, request, extra = {}) {
  const id = toId('sheet');
  const run = recordSheetRun({
    id,
    kind,
    status: 'running',
    request: sheetRequestSummary(request),
    snapshotPath: sheetSnapshotPath(id),
    ...extra,
  });
  writeSheetSnapshot(run, { request });
  return run;
}

function finishSheetRun(run, result, extra = {}) {
  const saved = recordSheetRun({
    ...run,
    ...extra,
    status: 'succeeded',
    finishedAt: now(),
    result,
  });
  const snapshot = readJson(sheetSnapshotPath(run.id), {});
  writeSheetSnapshot(saved, { ...snapshot, response: result });
  return saved;
}

function failSheetRun(run, error) {
  const saved = recordSheetRun({
    ...run,
    status: 'failed',
    error: error.message || String(error),
    finishedAt: now(),
  });
  const snapshot = readJson(sheetSnapshotPath(run.id), {});
  writeSheetSnapshot(saved, { ...snapshot, error: saved.error });
  return saved;
}

async function runSheetWebhook(kind, request, extra = {}) {
  const run = startSheetRun(kind, request, extra);
  try {
    const result = await callSheetsWebhook(request);
    return finishSheetRun(run, result);
  } catch (error) {
    failSheetRun(run, error);
    throw error;
  }
}

async function testSheetsBridge() {
  const request = buildPingRequest(sheetSettings());
  return runSheetWebhook('bridge-test', request, {
    spreadsheetId: request.spreadsheetId,
  });
}

async function archiveAndClearSheets(payload = {}) {
  const archiveName = stringValue(payload.archiveName, 'Archive name', { max: 180 });
  const request = buildArchiveClearRequest(sheetSettings(), { archiveName });
  const run = await runSheetWebhook('archive-clear', request, {
    spreadsheetId: request.spreadsheetId,
  });
  const archiveUrl = run.result?.archiveUrl || run.result?.url || run.result?.link || '';
  return archiveUrl ? recordSheetRun({ ...run, archiveUrl }) : run;
}

async function replayDatasetSheetBatch(existing, batchRequest) {
  const requests = Array.isArray(batchRequest.requests) ? batchRequest.requests : [];
  if (!requests.length) throw new Error('Sheet run snapshot has no chunk requests to replay.');
  const sheetRun = startSheetRun('replay-dataset-export', batchRequest, {
    replayOf: existing.id,
    datasetId: existing.datasetId || '',
    tabName: batchRequest.tabName || existing.tabName || '',
    rowCount: Number(batchRequest.rowCount) || 0,
    chunkCount: requests.length,
    spreadsheetId: batchRequest.spreadsheetId || existing.spreadsheetId || '',
  });
  try {
    const responses = [];
    for (const request of requests) responses.push(await callSheetsWebhook(request));
    return finishSheetRun(sheetRun, {
      chunkCount: requests.length,
      responses,
    });
  } catch (error) {
    failSheetRun(sheetRun, error);
    throw error;
  }
}

async function replaySheetRun(sheetRunId) {
  const validRunId = validateId(sheetRunId, 'Sheet run ID');
  const existing = loadData().sheetRuns.find((run) => run.id === validRunId);
  if (!existing) throw new Error('Sheet run not found.');
  if (existing.status !== 'failed') throw new Error('Only failed sheet runs can be replayed.');
  const snapshot = readJson(existing.snapshotPath || sheetSnapshotPath(validRunId), {});
  const request = snapshot.request;
  if (!request || typeof request !== 'object') throw new Error('Sheet run snapshot is missing the saved request.');
  if (request.action === 'writeDatasetRowsBatch') return replayDatasetSheetBatch(existing, request);
  return runSheetWebhook(`replay-${existing.kind || 'sheet'}`, request, {
    replayOf: validRunId,
    datasetId: existing.datasetId || '',
    tabName: request.tabName || existing.tabName || '',
    spreadsheetId: request.spreadsheetId || existing.spreadsheetId || '',
  });
}

async function exportDatasetToSheets(payload = {}) {
  const datasetId = validateId(payload.datasetId, 'Dataset ID');
  const tabName = stringValue(payload.tabName, 'Sheet tab', { max: 80 });
  const data = loadData();
  const dataset = data.datasets.find((item) => item.id === datasetId);
  if (!dataset) throw new Error('Dataset not found.');
  const items = readDatasetPayload(datasetId).items || [];
  const requestId = toId('sheet-write');
  const requests = buildDatasetWriteRequests(sheetSettings(), dataset, items, {
    tabName,
    clearFirst: payload.clearFirst === true,
    requestId,
  });
  const batchRequest = {
    action: 'writeDatasetRowsBatch',
    spreadsheetId: requests[0]?.spreadsheetId || '',
    tabName: requests[0]?.tabName || '',
    rowCount: items.length,
    chunkCount: requests.length,
    requests,
  };
  const sheetRun = startSheetRun('dataset-export', batchRequest, {
    datasetId,
    tabName: requests[0]?.tabName || '',
    rowCount: items.length,
    chunkCount: requests.length,
    spreadsheetId: requests[0]?.spreadsheetId || '',
  });
  try {
    const responses = [];
    for (const request of requests) responses.push(await callSheetsWebhook(request));
    return finishSheetRun(sheetRun, {
      chunkCount: requests.length,
      responses,
    });
  } catch (error) {
    failSheetRun(sheetRun, error);
    throw error;
  }
}

function inferSheetPlatform(tabName, row = {}) {
  const text = `${tabName} ${row.platform || row.Platform || row.source || row.Source || ''}`.toLowerCase();
  if (text.includes('reddit')) return 'reddit';
  if (text.includes('linkedin')) return 'linkedin';
  if (text.includes('twitter') || text.includes(' x ')) return 'x';
  return 'sheets';
}

function rowsFromSheetsResponse(response = {}) {
  if (Array.isArray(response.rows)) return response.rows.map((row) => ({ tabName: response.tabName || 'Sheet', row }));
  if (!response.tabs || typeof response.tabs !== 'object') return [];
  return Object.entries(response.tabs).flatMap(([tabName, rows]) => (
    Array.isArray(rows) ? rows.map((row) => ({ tabName, row })) : []
  ));
}

async function importWorkingSheets() {
  const request = buildSheetReadRequest(sheetSettings());
  const sheetRun = startSheetRun('working-sheet-import', request, { spreadsheetId: request.spreadsheetId });
  try {
    const response = await callSheetsWebhook(request);
    const rows = rowsFromSheetsResponse(response);
    if (!rows.length) throw new Error('Google Sheets webhook returned no rows.');

    const datasetId = toId('dataset');
    const runId = toId('sheet-import');
    const rawItems = rows.map(({ tabName, row }) => ({
      ...(row && typeof row === 'object' ? row : { value: row }),
      platform: inferSheetPlatform(tabName, row),
      sourceTab: tabName,
    }));
    const items = rawItems.map((row) => normalizeItem(row, { runId, platform: row.platform }));
    const datasetRecord = {
      id: datasetId,
      runId,
      projectId: 'default',
      platform: 'sheets',
      name: `Google Sheets import ${new Date().toLocaleString()}`,
      itemCount: items.length,
      createdAt: now(),
    };

    const data = loadData();
    writeJson(datasetPayloadFile(datasetId), { rawItems, items });
    upsertById(data.datasets, datasetRecord);
    saveData();
    finishSheetRun(sheetRun, { tabs: request.tabs }, {
      datasetId,
      rowCount: items.length,
    });
    return datasetRecord;
  } catch (error) {
    failSheetRun(sheetRun, error);
    throw error;
  }
}

async function generateAssets({ card, assetTypeIds, datasetId }) {
  const data = loadData();
  const valid = validateGenerateAssetsPayload({ card, assetTypeIds, datasetId });
  const selectedTypes = workflow.assetTypes.filter((asset) => valid.assetTypeIds.includes(asset.id));
  if (!valid.card?.id) throw new Error('Card is required.');
  if (!selectedTypes.length) throw new Error('Select at least one asset type.');

  const cardRecord = saveCard({ ...valid.card, column: 'generating' });
  const assetIds = selectedTypes.map((assetType) => `${cardRecord.id}-${assetType.id}`);
  for (const assetType of selectedTypes) {
    const queuedAsset = {
      id: `${cardRecord.id}-${assetType.id}`,
      cardId: cardRecord.id,
      assetType: assetType.id,
      title: assetType.name,
      channel: assetType.channel,
      markdown: '',
      status: 'running',
      evidenceIds: [],
      createdAt: now(),
      updatedAt: now(),
    };
    queuedAsset.assetPath = assetMarkdownPath(queuedAsset);
    fs.mkdirSync(path.dirname(queuedAsset.assetPath), { recursive: true });
    fs.writeFileSync(queuedAsset.assetPath, queuedAsset.markdown);
    upsertById(data.assets, queuedAsset);
  }

  const assetRunId = toId('assets');
  startJob({ id: assetRunId, kind: 'assets', status: 'running', title: cardRecord.title, cancellable: true, startedAt: now() });
  saveData();
  emitState();

  const workspaceDir = ensureWorkspace(dataPath('workspaces'), cardRecord.projectId || 'default');
  const runDir = path.join(workspaceDir, safeFilename(assetRunId));
  fs.mkdirSync(runDir, { recursive: true });
  const dataset = valid.datasetId ? data.datasets.find((item) => item.id === valid.datasetId) : null;
  const datasetPayload = dataset ? readDatasetPayload(dataset.id) : { items: [] };
  const contextPath = path.join(runDir, 'asset-context.json');
  const schemaPath = path.join(runDir, 'asset-pack.schema.json');
  const outputPath = path.join(runDir, 'asset-pack.json');

  writeJson(contextPath, {
    card: cardRecord,
    requestedAssets: selectedTypes,
    dataset,
    items: (datasetPayload.items || []).slice(0, 80),
    analyses: data.analyses.filter((analysis) => !valid.datasetId || analysis.datasetId === valid.datasetId).slice(0, 10),
  });
  writeJson(schemaPath, SCHEMAS.assetPack);

  try {
    const { command, args } = buildCodexCommand({
      workspaceDir,
      schemaPath,
      outputPath,
      prompt: buildAssetPrompt(contextPath),
    });
    const { stdout, stderr } = await spawnCodex(command, args, workspaceDir, { jobId: assetRunId });
    const events = parseJsonlEvents(stdout);
    const output = validateAiOutput('assetPack', readJson(outputPath, null));

    const completedTypes = new Set();
    for (const generated of output.assets) {
      const assetType = selectedTypes.find((item) => item.id === generated.assetType);
      if (!assetType) continue;
      completedTypes.add(assetType.id);
      const doneAsset = {
        id: `${cardRecord.id}-${generated.assetType}`,
        cardId: cardRecord.id,
        assetType: generated.assetType,
        title: generated.title || assetType.name,
        channel: generated.channel || assetType.channel,
        markdown: generated.markdown,
        status: 'done',
        evidenceIds: generated.evidenceIds || [],
        outputPath,
        eventCount: events.length,
        stderr: stderr.slice(-1200),
        createdAt: now(),
        updatedAt: now(),
      };
      doneAsset.assetPath = assetMarkdownPath(doneAsset);
      fs.mkdirSync(path.dirname(doneAsset.assetPath), { recursive: true });
      fs.writeFileSync(doneAsset.assetPath, doneAsset.markdown);
      upsertById(data.assets, doneAsset);
    }
    for (const assetType of selectedTypes) {
      if (completedTypes.has(assetType.id)) continue;
      const assetId = `${cardRecord.id}-${assetType.id}`;
      const existing = data.assets.find((asset) => asset.id === assetId);
      if (existing) upsertById(data.assets, { ...existing, status: 'failed', error: 'Codex did not return this asset.', updatedAt: now() });
    }
    const column = completedTypes.size === selectedTypes.length ? 'ready' : 'in-review';
    upsertById(data.cards, { ...cardRecord, column, assetsReady: `${completedTypes.size}/${selectedTypes.length}`, updatedAt: now() });
    finishJob(assetRunId, { status: 'succeeded' });
    saveData();
    return { cardId: cardRecord.id, assetIds, outputPath, output };
  } catch (error) {
    const status = wasCancelled(assetRunId) ? 'cancelled' : 'failed';
    for (const assetId of assetIds) {
      const existing = data.assets.find((asset) => asset.id === assetId);
      if (existing) upsertById(data.assets, { ...existing, status, error: error.message, updatedAt: now() });
    }
    upsertById(data.cards, { ...cardRecord, column: 'in-review', error: error.message, updatedAt: now() });
    failJob(assetRunId, error);
    saveData();
    throw error;
  }
}

async function runRecipe(recipeId) {
  const data = loadData();
  const recipe = data.recipes.find((item) => item.id === recipeId);
  if (!recipe) throw new Error('Recipe not found.');

  const localRunId = toId('run');
  const job = startJob({ id: localRunId, kind: 'run', status: 'running', title: recipe.name, cancellable: true, startedAt: now() });

  const runRecord = {
    id: localRunId,
    recipeId,
    projectId: 'default',
    actorId: recipe.actorId,
    taskId: recipe.taskId,
    platform: recipe.platform,
    status: 'running',
    startedAt: job.startedAt,
  };
  upsertById(data.runs, runRecord);
  saveData();
  emitState();

  try {
    const token = getKey('APIFY_API_TOKEN');
    const runner = createApifyRunner({ token, Client: ApifyClient });
    const result = await runner.runRecipe(recipe, {
      maxItems: Number(data.settings.maxItems) || 1000,
      isCancelled: () => cancelledJobs.has(localRunId),
      onRunStarted: (run) => {
        if (!run?.id) return;
        apifyRunControllers.set(localRunId, {
          runId: run.id,
          abort: () => new ApifyClient({ token }).run(run.id).abort({ gracefully: true }),
        });
        upsertById(data.runs, { ...runRecord, apifyRunId: run.id, status: String(run.status || 'RUNNING').toLowerCase(), updatedAt: now() });
        saveData();
        emitState();
      },
      onStatus: (run) => {
        if (!run?.id) return;
        upsertById(data.runs, { ...runRecord, apifyRunId: run.id, status: String(run.status || 'RUNNING').toLowerCase(), updatedAt: now() });
        jobs.set(localRunId, { ...jobs.get(localRunId), status: 'running', progress: 25, apifyRunId: run.id });
        emitState();
      },
    });
    const datasetId = toId('dataset');
    const datasetRecord = {
      id: datasetId,
      runId: localRunId,
      apifyRunId: result.run.id,
      defaultDatasetId: result.run.defaultDatasetId,
      recipeId,
      projectId: 'default',
      platform: recipe.platform,
      name: `${recipe.name} ${new Date().toLocaleString()}`,
      itemCount: result.normalizedItems.length,
      createdAt: now(),
    };

    writeJson(datasetPayloadFile(datasetId), {
      rawItems: result.rawItems,
      items: result.normalizedItems,
    });

    upsertById(data.datasets, datasetRecord);
    upsertById(data.runs, {
      ...runRecord,
      status: 'succeeded',
      apifyRunId: result.run.id,
      defaultDatasetId: result.run.defaultDatasetId,
      datasetId,
      itemCount: result.normalizedItems.length,
      finishedAt: now(),
    });
    finishJob(localRunId, { status: 'succeeded' });
    apifyRunControllers.delete(localRunId);
    saveData();
    return datasetRecord;
  } catch (error) {
    const status = wasCancelled(localRunId) ? 'cancelled' : 'failed';
    upsertById(data.runs, { ...runRecord, status, error: error.message, finishedAt: now() });
    if (status === 'cancelled') finishJob(localRunId, { status: 'cancelled', error: error.message });
    else failJob(localRunId, error);
    apifyRunControllers.delete(localRunId);
    saveData();
    throw error;
  }
}

function spawnCodex(command, args, cwd, options = {}) {
  const timeoutMs = options.timeoutMs || CODEX_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: cliEnv() });
    if (options.jobId) jobProcesses.set(options.jobId, child);
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (options.jobId) jobProcesses.delete(options.jobId);
      callback();
    };
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      finish(() => reject(new Error(`Codex timed out after ${Math.round(timeoutMs / 1000)} seconds.`)));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => finish(() => reject(error)));
    child.on('close', (code, signal) => {
      finish(() => {
        if (code === 0) resolve({ stdout, stderr });
        else if (signal === 'SIGTERM' && options.jobId && cancelledJobs.has(options.jobId)) reject(new Error('Job cancelled.'));
        else reject(new Error(stderr || `Codex exited with ${code}`));
      });
    });
  });
}

function checkCodexCli(timeoutMs = 5000) {
  return new Promise((resolve) => {
    const child = spawn('codex', ['--version'], { env: cliEnv() });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      finish({ ok: false, error: 'Codex check timed out.' });
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => finish({ ok: false, error: error.message }));
    child.on('close', (code) => {
      const version = stdout.trim().split(/\r?\n/)[0] || stderr.trim().split(/\r?\n/)[0];
      finish(code === 0 ? { ok: true, version } : { ok: false, error: stderr.trim() || `Codex exited with ${code}.` });
    });
  });
}

async function analyzeDataset({ datasetId, kind, reportPresetId }) {
  const valid = validateAnalysisPayload({ datasetId, kind, reportPresetId });
  const data = loadData();
  const dataset = data.datasets.find((item) => item.id === valid.datasetId);
  if (!dataset) throw new Error('Dataset not found.');
  if (!SCHEMAS[valid.kind]) throw new Error('Unknown analysis kind.');
  const reportPreset = valid.kind === 'report' ? reportPresetById(valid.reportPresetId) : null;

  const analysisId = toId(valid.kind);
  const job = startJob({ id: analysisId, kind: valid.kind, status: 'running', title: reportPreset?.name || dataset.name, cancellable: true, startedAt: now() });

  const analysis = {
    id: analysisId,
    datasetId,
    projectId: dataset.projectId || 'default',
    kind: valid.kind,
    reportPresetId: reportPreset?.id || '',
    reportPresetName: reportPreset?.name || '',
    status: 'running',
    startedAt: job.startedAt,
  };
  upsertById(data.analyses, analysis);
  saveData();
  emitState();

  const workspaceDir = ensureWorkspace(dataPath('workspaces'), analysis.projectId);
  const runDir = path.join(workspaceDir, safeFilename(analysisId));
  fs.mkdirSync(runDir, { recursive: true });

  const payload = readDatasetPayload(datasetId);
  const intelligence = studioIntelligence(data);
  const profile = intelligence.datasetProfiles.find((item) => item.datasetId === dataset.id) || null;
  const analysisContext = buildAnalysisContext({
    dataset,
    profile,
    kind: valid.kind,
    reportPresetId: reportPreset?.id || '',
  });
  const contextPath = path.join(runDir, 'analysis-context.json');
  const itemsPath = path.join(runDir, 'items.jsonl');
  const schemaPath = path.join(runDir, `${valid.kind}.schema.json`);
  const outputPath = path.join(runDir, `${valid.kind}.json`);
  const eventsPath = path.join(runDir, 'events.jsonl');
  const reportPath = path.join(runDir, 'report.md');
  const promptPath = path.join(runDir, 'prompt.txt');

  writeJson(contextPath, analysisContext);
  fs.writeFileSync(itemsPath, toJsonl(payload.items || []));
  writeJson(schemaPath, SCHEMAS[valid.kind]);

  const prompt = buildPrompt(valid.kind, itemsPath, { contextPath, reportPresetId: reportPreset?.id });
  fs.writeFileSync(promptPath, prompt);
  const { command, args } = buildCodexCommand({ workspaceDir, schemaPath, outputPath, prompt });

  let stderr = '';
  try {
    const result = await spawnCodex(command, args, workspaceDir, { jobId: analysisId });
    stderr = result.stderr;
    fs.writeFileSync(eventsPath, result.stdout);
    const events = parseJsonlEvents(result.stdout);
    const output = validateAiOutput(valid.kind, readJson(outputPath, null));
    if (valid.kind === 'report') fs.writeFileSync(reportPath, output.markdownReport);

    const complete = {
      ...analysis,
      status: 'succeeded',
      finishedAt: now(),
      contextPath,
      outputPath,
      eventsPath,
      promptPath,
      reportPath: valid.kind === 'report' ? reportPath : '',
      eventCount: events.length,
      stderr: stderr.slice(-1200),
      preview: valid.kind === 'report' ? output.summary : JSON.stringify(output).slice(0, 800),
    };
    upsertById(data.analyses, complete);
    finishJob(analysisId, { status: 'succeeded' });
    saveData();
    return { ...complete, output };
  } catch (error) {
    const failed = { ...analysis, status: wasCancelled(analysisId) ? 'cancelled' : 'failed', error: error.message, finishedAt: now(), contextPath, eventsPath: fs.existsSync(eventsPath) ? eventsPath : '', promptPath, stderr: stderr.slice(-1200) };
    upsertById(data.analyses, failed);
    failJob(analysisId, error);
    saveData();
    throw error;
  }
}

function planIntentCommand(payload) {
  const valid = validateIntentPayload(payload);
  return planIntent(valid.command, { ...publicState(), selectedDatasetId: valid.datasetId });
}

async function executeIntentStep(step, plan) {
  if (step.action === 'run-recipe') return runRecipe(step.args.recipeId);
  if (step.action === 'analyze-dataset') return analyzeDataset(step.args);
  if (step.action === 'export-dataset') return exportDataset({ ...step.args, reveal: false });
  if (step.action === 'generate-assets') {
    const data = loadData();
    const dataset = data.datasets.find((item) => item.id === step.args.datasetId);
    const card = saveCard({
      title: step.args.title || `${dataset?.name || 'Dataset'} asset pack`,
      description: `Smart command: ${plan.command}`,
      column: 'generating',
      tags: ['asset-pack', plan.presetId || plan.intent].filter(Boolean),
      datasetId: dataset?.id || '',
      signalCount: dataset?.itemCount || '',
      signalChange: 'Asset factory',
      priority: 'smart',
    });
    const assetTypeIds = workflow.presets.find((preset) => preset.id === step.args.presetId)?.assetTypeIds || workflow.presets[0]?.assetTypeIds || [];
    return generateAssets({ card, assetTypeIds, datasetId: dataset?.id || '' });
  }
  if (step.action === 'create-card') {
    const data = loadData();
    const dataset = data.datasets.find((item) => item.id === step.args.datasetId);
    const profile = plan.profile || {};
    return saveCard({
      title: step.args.title || `${dataset?.name || 'Dataset'} follow-up`,
      description: `Smart command: ${plan.command}`,
      column: 'detected',
      tags: ['smart-plan', profile.kind].filter(Boolean),
      datasetId: dataset?.id || '',
      signalCount: dataset?.itemCount || '',
      signalChange: profile.label || 'Smart plan',
      priority: 'smart',
    });
  }
  throw new Error(`Unsupported smart action: ${step.action}`);
}

async function runIntent(payload) {
  const plan = planIntentCommand(payload);
  return runPlannedIntent(plan);
}

function planFromIntentAction(payload) {
  const step = validateIntentActionPayload(payload);
  const state = publicState();
  const datasetId = step.args.datasetId || '';
  const profile = datasetId ? (state.intelligence?.datasetProfiles || []).find((item) => item.datasetId === datasetId) || null : null;
  return {
    command: step.label,
    intent: 'next-best-action',
    confidence: 1,
    targetDatasetId: datasetId,
    targetRecipeId: step.args.recipeId || '',
    profile,
    steps: [{ ...step, why: 'Queued as the next best action for the current workspace.' }],
    missing: [],
    canRun: true,
    summary: step.label,
  };
}

async function runIntentAction(payload) {
  return runPlannedIntent(planFromIntentAction(payload));
}

async function runPlannedIntent(plan, options = {}) {
  if (!plan.canRun) throw new Error(plan.missing.join(' ') || 'Smart command is not runnable yet.');

  const data = loadData();
  const intentRunId = toId('intent');
  const completedStepIds = [...(options.completedStepIds || [])];
  const completedSet = new Set(completedStepIds);
  const record = {
    id: intentRunId,
    command: plan.command,
    status: 'running',
    plan,
    startedAt: now(),
  };
  upsertById(data.intentRuns, record);
  startJob({ id: intentRunId, kind: 'intent', status: 'running', title: plan.command, cancellable: false, startedAt: record.startedAt });
  saveData();
  emitState();

  try {
    const results = [];
    for (const [index, step] of plan.steps.entries()) {
      if (completedSet.has(step.id)) {
        results.push({ stepId: step.id, action: step.action, skipped: true });
        continue;
      }
      if (options.jobId) {
        appendV5Event('job-progressed', {
          id: options.jobId,
          progress: Math.round((index / plan.steps.length) * 100),
          status: 'running',
          logsPath: options.logsPath || '',
          metrics: { completedStepIds },
        });
        if (options.logsPath) fs.appendFileSync(options.logsPath, `Step ${index + 1}/${plan.steps.length}: ${step.action} ${now()}\n`);
      }
      results.push({ stepId: step.id, action: step.action, result: await executeIntentStep(step, plan) });
      completedStepIds.push(step.id);
      completedSet.add(step.id);
    }
    const complete = {
      ...record,
      status: 'succeeded',
      finishedAt: now(),
      completedSteps: results.length,
      completedStepIds,
      results,
    };
    upsertById(data.intentRuns, complete);
    finishJob(intentRunId, { status: 'succeeded' });
    saveData();
    return complete;
  } catch (error) {
    error.completedStepIds = completedStepIds;
    const failed = {
      ...record,
      status: 'failed',
      error: error.message || String(error),
      finishedAt: now(),
      completedStepIds,
    };
    upsertById(data.intentRuns, failed);
    failJob(intentRunId, error);
    saveData();
    throw error;
  }
}

ipcMain.handle('app-meta', () => ({
  name: APP_NAME,
  version: app.getVersion(),
  dataRoot: dataRoot(),
}));

ipcMain.handle('state', () => publicState());
ipcMain.handle('list-missions', () => publicV5State().missions);
ipcMain.handle('save-mission', (_, payload) => saveMission(payload));
ipcMain.handle('run-mission', (_, missionId) => runMission(missionId));
ipcMain.handle('run-action-graph', (_, payload) => runActionGraph(payload));
ipcMain.handle('pause-mission', (_, missionId) => pauseMission(missionId));
ipcMain.handle('schedule-mission', (_, payload) => scheduleMission(payload));
ipcMain.handle('discover-apify-resource', (_, payload) => discoverApifyResource(payload));
ipcMain.handle('test-recipe', (_, payload) => testRecipe(payload));
ipcMain.handle('save-recipe-version', (_, payload) => saveRecipeVersion(payload));
ipcMain.handle('get-job', (_, jobId) => getJob(jobId));
ipcMain.handle('retry-job', (_, jobId) => retryJob(jobId));
ipcMain.handle('read-job-log', (_, jobId) => readJobLog(jobId));
ipcMain.handle('search-evidence', (_, payload) => searchEvidenceRecords(payload));
ipcMain.handle('read-evidence', (_, evidenceId) => readEvidenceRecord(evidenceId));
ipcMain.handle('export-mission-bundle', (_, missionId) => exportMissionBundle(missionId));
ipcMain.handle('export-asset-pack', (_, payload) => exportAssetPack(payload));
ipcMain.handle('check-codex', () => checkCodexCli());
ipcMain.handle('plan-intent', (_, payload) => planIntentCommand(payload));
ipcMain.handle('run-intent', (_, payload) => runIntent(payload));
ipcMain.handle('run-intent-action', (_, payload) => runIntentAction(payload));

ipcMain.handle('save-key', (_, { keyName, value }) => {
  const validKey = validateKeyName(keyName, KEY_NAMES);
  const validValue = validateKeyValue(validKey, value);
  const config = loadConfig();
  config.keys[validKey] = encryptValue(validValue);
  saveConfig();
  return publicState().keys;
});

ipcMain.handle('clear-key', (_, keyName) => {
  const validKey = validateKeyName(keyName, KEY_NAMES);
  const config = loadConfig();
  delete config.keys[validKey];
  saveConfig();
  return publicState().keys;
});

ipcMain.handle('save-settings', (_, settings) => {
  const data = loadData();
  data.settings = validateSettings(settings, data.settings);
  saveData();
  emitState();
  return publicState();
});

ipcMain.handle('save-recipe', (_, payload) => {
  const data = loadData();
  const recipe = validateRecipe(payload);
  upsertById(data.recipes, recipe);
  saveData();
  emitState();
  return publicRecipe(recipe);
});

ipcMain.handle('delete-recipe', (_, recipeId) => {
  const validRecipeId = validateId(recipeId, 'Recipe ID');
  const data = loadData();
  data.recipes = data.recipes.filter((recipe) => recipe.id !== validRecipeId);
  saveData();
  emitState();
  return publicState();
});

ipcMain.handle('save-card', (_, payload) => saveCard(payload));
ipcMain.handle('move-card', (_, payload) => moveCard(payload));
ipcMain.handle('save-asset', (_, payload) => saveAsset(payload));
ipcMain.handle('generate-assets', (_, payload) => generateAssets(payload));
ipcMain.handle('run-recipe', (_, recipeId) => runRecipe(validateId(recipeId, 'Recipe ID')));
ipcMain.handle('read-dataset', (_, datasetId) => readDatasetPayload(validateId(datasetId, 'Dataset ID')));
ipcMain.handle('export-dataset', (_, payload) => exportDataset(payload));
ipcMain.handle('test-sheets-bridge', () => testSheetsBridge());
ipcMain.handle('archive-and-clear-sheets', (_, payload) => archiveAndClearSheets(payload));
ipcMain.handle('import-working-sheets', () => importWorkingSheets());
ipcMain.handle('export-dataset-to-sheets', (_, payload) => exportDatasetToSheets(payload));
ipcMain.handle('replay-sheet-run', (_, sheetRunId) => replaySheetRun(sheetRunId));
ipcMain.handle('read-analysis', (_, analysisId) => readAnalysisOutput(validateId(analysisId, 'Analysis ID')));
ipcMain.handle('analyze-dataset', (_, payload) => analyzeDataset(payload));
ipcMain.handle('open-data-folder', () => openPathOrThrow(dataRoot()));
ipcMain.handle('open-assets-folder', () => openPathOrThrow(dataPath('assets')));
ipcMain.handle('open-analysis-output', (_, analysisId) => openPathOrThrow(localAnalysisPath(validateId(analysisId, 'Analysis ID'))));
ipcMain.handle('reveal-analysis-output', (_, analysisId) => {
  shell.showItemInFolder(localAnalysisPath(validateId(analysisId, 'Analysis ID')));
  return true;
});
ipcMain.handle('open-asset', (_, assetId) => openPathOrThrow(localAssetPath(validateId(assetId, 'Asset ID'))));
ipcMain.handle('reveal-asset', (_, assetId) => {
  shell.showItemInFolder(localAssetPath(validateId(assetId, 'Asset ID')));
  return true;
});
ipcMain.handle('open-workspace', (_, projectId = 'default') => openPathOrThrow(ensureWorkspace(dataPath('workspaces'), validateId(projectId, 'Project ID'))));
ipcMain.handle('cancel-job', async (_, jobId) => {
  const validJobId = validateId(jobId, 'Job ID');
  const child = jobProcesses.get(validJobId);
  const apifyRun = apifyRunControllers.get(validJobId);
  if (!child && !apifyRun) throw new Error('Job cannot be cancelled.');
  cancelledJobs.add(validJobId);
  if (child) {
    child.kill('SIGTERM');
    jobProcesses.delete(validJobId);
  }
  if (apifyRun) {
    await apifyRun.abort().catch(() => null);
    apifyRunControllers.delete(validJobId);
  }
  jobs.set(validJobId, { ...jobs.get(validJobId), status: 'cancelled', finishedAt: now() });
  jobs.delete(validJobId);
  emitState();
  return true;
});

app.whenReady().then(() => {
  ensureDirs();
  loadData();
  loadConfig();
  recoverInterruptedJobs();
  configureAutoUpdates();
  createWindow();
  startScheduleLoop();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
