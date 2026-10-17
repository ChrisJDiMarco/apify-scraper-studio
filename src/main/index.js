// The same main process runs the Mac app and, with STUDIO_RUNTIME=web, the browser studio on a server
// (web-runtime.js stands in for Electron there; studio-server.js serves it).
const WEB_RUNTIME = process.env.STUDIO_RUNTIME === 'web';
const { app, BrowserWindow, ipcMain, safeStorage, shell, dialog, Menu } = WEB_RUNTIME ? require('./web-runtime').electron : require('electron');
// Browser studio: a file the Mac app saves or reveals downloads instead (an export folder as one .zip), and the
// page never receives server paths. On the Mac this returns the result unchanged.
const SERVER_PATH_KEYS = ['path', 'filePath', 'folder', 'dir', 'evidencePath', 'markdownPath', 'htmlPath', 'reportPath'];
function forBrowser(result, ...downloads) {
  if (!WEB_RUNTIME || !result || typeof result !== 'object') return result;
  for (const target of downloads.filter(Boolean)) shell.showItemInFolder(target);
  return Object.fromEntries(Object.entries(result).filter(([key]) => !SERVER_PATH_KEYS.includes(key)));
}
const path = require('path');
const { randomUUID } = require('crypto');
// Keep the original data directory and macOS Safe Storage identity across bundle renames.
// app.setName changes Electron's internal identity, not the Dock's bundle display name.
const INTERNAL_APP_NAME = 'apify-scraper-studio';
if (app.isPackaged) {
  const previousDefault = path.join(app.getPath('appData'), app.getName());
  const originalUserData = app.getPath('userData');
  app.setName(INTERNAL_APP_NAME);
  if (path.resolve(originalUserData) === path.resolve(previousDefault)) {
    app.setPath('userData', path.join(app.getPath('appData'), INTERNAL_APP_NAME));
  }
  // Exit before constructing services or touching shared state in a second installed process.
  if (!app.requestSingleInstanceLock()) app.exit(0);
}
const fs = require('fs');
const { spawn } = require('child_process');
const { ApifyClient } = require('apify-client');
const { createContentWorkspace } = require('./content-workspace');
const { acquireStudioOwnerLock } = require('./studio-owner-lock');
// Roles and access (docs/roles-and-access.md): the team store, the policy and the gate every handler passes.
const { createTeamStore } = require('./team-store');
const roles = require('./roles');
const { createAccess } = require('./access');
const API_METHODS = require('../shared/studio-api-channels.json').methods;
const { createStudioHost, studioCliEnv, loadLoginShellPath } = require('./studio-host');
// A packaged app opened from Finder lacks the shell's PATH; read it now so the first Claude check finds CLIs installed
// outside the default locations. A dev run started from Terminal already has it.
const loginShellPathReady = app.isPackaged ? loadLoginShellPath() : Promise.resolve('');
const { createImageProvider } = require('./image-provider');
const { readLocalImageKey } = require('./local-image-key');
const { createResearchWorkspace } = require('./research-workspace');
const { accountForUrl } = require('../shared/brand-context');
const { DEFAULT_CLAUDE_MODEL, CLAUDE_CLI_ENV, buildClaudeCommand, parseClaudeResult, modelMatches, readClaudeCost } = require('../shared/claude-runner');
const { createAiRoutes } = require('./ai-routes');
const { DEFAULT_RESEARCH_AI, modelPrice } = require('../shared/research-program');
const { SOURCE_CATALOG, buildSearchRecipes } = require('../shared/source-catalog');
const { CHAT_SCHEMA, buildFindingsContext, normalizeFindingsAnswer } = require('../shared/findings-chat');
// Prompt Library: the data tools' prompts read the active workspace's saved text (contentWorkspace.promptEffective).
const dataPrompts = require('../shared/data-prompts');
const { brandContextBlock } = require('../shared/findings-chat');
const workflow = require('../shared/asset-workflow.json');
const monday = require('./monday-sync');
let autoUpdater = null;
try {
  ({ autoUpdater } = WEB_RUNTIME ? require('./web-runtime') : require('electron-updater'));
} catch (_) {
  autoUpdater = null;
}
const { createApifyRunner, discoverApifyResource: discoverApifyResourceLive } = require('../shared/apify-runner');
const { SCHEMAS, buildAnalysisContext, buildAssetPrompt, buildCodexCommand, buildPrompt, codexExecSupport, parseJsonlEvents, reportPresetById, validateAiOutput } = require('../shared/codex-runner');
const { buildArchiveClearRequest, buildDatasetWriteRequests, buildPingRequest, buildSheetReadRequest, isRetryableSheetMessage, isRetryableSheetStatus } = require('../shared/google-sheets');
const { buildStudioIntelligence, planIntent } = require('../shared/intelligence');
const { normalizeItem, toCsv, toJsonl } = require('../shared/normalize');
const packageConfig = require('../../package.json');
const { DEFAULT_RUN_OPTIONS, abortAfterMs, publicRecipe, testRunOptions, toId, validateRecipe } = require('../shared/recipe');
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

const APP_NAME = 'Scraper Studio';
const KEY_NAMES = ['APIFY_API_TOKEN', 'ANTHROPIC_API_KEY', 'GOOGLE_SHEETS_WEBHOOK_URL', 'GOOGLE_DOCS_ACCESS_TOKEN', 'OPENAI_API_KEY', 'MONDAY_API_TOKEN'];
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
const activeChats = new Set();

function now() {
  return new Date().toISOString();
}

function cliEnv() { return studioCliEnv(); }

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
    conversations: [],
    brandProfiles: [], researchReviews: [], researchAudit: [], researchExports: [], monitors: [], comparisons: [],
    apifyCatalog: { actors: [], syncedAt: '' },
    intentRuns: [],
    cards: [],
    assets: [],
    sheetRuns: [],
    settings: {
      selectedBrandProfileId: '',
      aiProvider: 'auto',
      aiModel: DEFAULT_CLAUDE_MODEL,
      aiMaxBudgetUsd: 1,
      maxItems: 1000,
      sheets: {},
    },
  };
}

function defaultConfig() {
  return { keys: {} };
}

// Lenient: payloads, contexts and snapshots read as `fallback` when missing or damaged (a damaged file is copied aside).
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

// Strict, for data.json and config.json only: a missing file is a first launch; a file that can't be read (permissions, a
// disk error) stops the studio rather than being replaced with an empty one; a damaged file is copied aside before the
// studio starts fresh, and the copy is named in Settings (storeRecovery in the state).
const storeRecovery = [];
function readStoreJson(filePath, label) {
  let text;
  try { text = fs.readFileSync(filePath, 'utf8'); }
  catch (error) {
    if (error.code === 'ENOENT') return {};
    throw Object.assign(new Error(`${label} could not be read (${path.basename(filePath)}: ${error.code || error.message}). Nothing was changed. Fix the file's permissions or restore it from a backup, then start the studio again.`), { code: 'storeUnreadable' });
  }
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SyntaxError('not an object');
    return value;
  } catch (_) {
    const kept = `${filePath}.bad-${Date.now()}`;
    fs.copyFileSync(filePath, kept);
    storeRecovery.push({ store: label, file: path.basename(filePath), kept: path.basename(kept), at: now() });
    console.error(`${label} (${filePath}) was damaged. A copy was kept at ${kept}; the studio started without it.`);
    return {};
  }
}

// Atomic and durable: written to a private temp file, flushed, then renamed over the old one, so a crash or power cut
// leaves the previous file or the new one, never half of either.
function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  try {
    const fd = fs.openSync(tempPath, 'w', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(value, null, 2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tempPath, filePath);
  } catch (error) { fs.rmSync(tempPath, { force: true }); throw error; }
  let folder;
  try { folder = fs.openSync(path.dirname(filePath), 'r'); fs.fsyncSync(folder); }
  catch (error) { if (!['EINVAL', 'ENOTSUP', 'EPERM', 'EACCES', 'EISDIR'].includes(error.code)) throw error; }
  finally { if (folder != null) fs.closeSync(folder); }
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
  dataCache = { ...defaultData(), ...readStoreJson(dataFile(), 'Studio data') };
  dataCache.projects = dataCache.projects?.length ? dataCache.projects : defaultData().projects;
  dataCache.recipes = dataCache.recipes || [];
  dataCache.runs = dataCache.runs || [];
  dataCache.datasets = dataCache.datasets || [];
  dataCache.analyses = dataCache.analyses || [];
  dataCache.conversations = dataCache.conversations || [];
  for (const key of ['brandProfiles', 'researchReviews', 'researchAudit', 'researchExports', 'monitors', 'comparisons']) dataCache[key] = Array.isArray(dataCache[key]) ? dataCache[key] : [];
  dataCache.intentRuns = dataCache.intentRuns || [];
  dataCache.cards = dataCache.cards || [];
  dataCache.assets = dataCache.assets || [];
  dataCache.sheetRuns = dataCache.sheetRuns || [];
  dataCache.settings = { ...defaultData().settings, ...(dataCache.settings || {}) };
  rebaseStoredPaths(dataCache);
  saveData();
  return dataCache;
}

// Older records keep absolute file paths. When a studio's data folder moves (a Mac's data copied to the browser
// studio's server), re-anchor each path on this data folder if the same file exists here.
const DATA_FOLDERS = new Set(['workspaces', 'assets', 'exports', 'reports', 'datasets', 'sheets', 'workbooks', 'v5', 'content-studio']);
function rebasedPath(stored) {
  if (typeof stored !== 'string' || !path.isAbsolute(stored) || fs.existsSync(stored)) return stored;
  const parts = stored.split(/[\\/]+/);
  for (let index = 0; index < parts.length; index++) {
    if (!DATA_FOLDERS.has(parts[index])) continue;
    const candidate = path.join(dataRoot(), ...parts.slice(index));
    if (fs.existsSync(candidate)) return candidate;
  }
  return stored;
}
function rebaseStoredPaths(data) {
  for (const record of [...(data.analyses || []), ...(data.assets || []), ...(data.researchExports || [])]) {
    for (const [key, value] of Object.entries(record || {})) if (/Path$|^folder$/.test(key) && typeof value === 'string') record[key] = rebasedPath(value);
  }
}

// Never writes defaults over a file that failed to load: only what loadData read (or started fresh) is saved.
function saveData() {
  if (!dataCache) throw new Error('Studio data isn’t loaded, so nothing was saved. Restart the studio.');
  writeJson(dataFile(), dataCache);
}

function loadConfig() {
  if (configCache) return configCache;
  ensureDirs();
  configCache = { ...defaultConfig(), ...readStoreJson(configFile(), 'Studio settings') };
  configCache.keys = configCache.keys && typeof configCache.keys === 'object' ? configCache.keys : {};
  saveConfig();
  return configCache;
}

function saveConfig() {
  if (!configCache) throw new Error('Studio settings aren’t loaded, so nothing was saved. Restart the studio.');
  writeJson(configFile(), configCache);
}

function encryptValue(value) {
  if (safeStorage.isEncryptionAvailable()) {
    return { encrypted: true, value: safeStorage.encryptString(value).toString('base64') };
  }
  throw new Error('Secure storage on this computer is unavailable. Credential was not saved.');
}

function decryptValue(stored) {
  if (!stored) return '';
  if (stored.encrypted && safeStorage.isEncryptionAvailable()) {
    return safeStorage.decryptString(Buffer.from(stored.value, 'base64'));
  }
  return '';
}

// A saved key this studio can't decrypt. On the browser studio a key encrypted here ('sw1' blobs) that no longer
// decrypts was saved under a different STUDIO_SECRET_KEY (a restore onto a new host, a mistyped secrets file); anything
// else came from another installation (a Mac's keychain). Settings names them (keyProblems) instead of "not connected",
// and save-key refuses to overwrite a mismatched one, so the original server key can still bring it back.
// Browser studio only (the Mac app's keychain can need a moment's repair, which getKey already rides out); each saved blob
// is checked once, again only when it changes.
const KEY_PROBLEM_COPY = { mismatch: 'it was saved with a different STUDIO_SECRET_KEY', foreign: 'it was saved by another installation of the studio' };
const reportedKeyProblems = new Set();
const keyChecks = new Map(); // name → { blob, problem }
function keyProblem(name) {
  if (!WEB_RUNTIME) return '';
  const config = loadConfig(); const stored = config.keys?.[name];
  if (!stored || config.disabledKeys?.[name]) return '';
  const blob = String(stored.value || ''); const hit = keyChecks.get(name);
  if (hit && hit.blob === blob) return hit.problem;
  let problem = '';
  try { decryptValue(stored); } catch (_) {
    let tagged = false; try { tagged = require('buffer').Buffer.from(blob, 'base64').subarray(0, 3).toString('latin1') === 'sw1'; } catch (_) { tagged = false; }
    problem = tagged ? 'mismatch' : 'foreign';
  }
  keyChecks.set(name, { blob, problem });
  return problem;
}
function keyProblems() { return Object.fromEntries(KEY_NAMES.map((name) => [name, keyProblem(name)]).filter(([, problem]) => problem)); }
const KEY_LABELS = { APIFY_API_TOKEN: 'Apify token', ANTHROPIC_API_KEY: 'Anthropic API key', GOOGLE_SHEETS_WEBHOOK_URL: 'Google Sheets bridge link', GOOGLE_DOCS_ACCESS_TOKEN: 'Google Drive token', OPENAI_API_KEY: 'OpenAI key', MONDAY_API_TOKEN: 'Monday.com token' };
// The message for a key a call needs but can't use: why, when the saved one can't be read, else `missing`.
function keyNeeded(name, missing) {
  const problem = keyProblem(name);
  return problem ? `The saved ${KEY_LABELS[name] || name} can’t be read: ${KEY_PROBLEM_COPY[problem]}. ${problem === 'mismatch' ? 'Start the studio with its original STUDIO_SECRET_KEY, or clear the key in Settings and save it again.' : 'Clear it in Settings and save it again.'}` : missing;
}

function getKey(name) {
  const config = loadConfig();
  if (config.disabledKeys?.[name]) return '';
  let saved;
  try { saved = decryptValue(config.keys[name]); } catch { // Keep Settings reachable if Keychain access needs repair.
    saved = '';
    if (!reportedKeyProblems.has(name)) { reportedKeyProblems.add(name); console.warn(`Saved key ${name} could not be decrypted${keyProblem(name) ? `: ${KEY_PROBLEM_COPY[keyProblem(name)]}` : ''}.`); }
  }
  saved ||= process.env[name];
  if (saved) return saved;
  if (name !== 'OPENAI_API_KEY') return '';
  try { return readLocalImageKey({ appPath: app.getAppPath?.(), credentialFile: config.imageCredentialFile, enabled: !app.isPackaged && process.env.STUDIO_DISABLE_LOCAL_ENV !== '1' }); }
  catch { return ''; } // Keep Settings reachable when a development file needs repair.
}

// Monday.com: the token lives with the other encrypted keys; board setup and item IDs live in config.
function publicMonday() {
  const saved = loadConfig().monday || {};
  return { connected: Boolean(getKey('MONDAY_API_TOKEN')), boardId: saved.boardId || '', boardName: saved.boardName || '', statusColumnId: saved.statusColumnId || '', notesColumnId: saved.notesColumnId || '', syncedCount: Object.keys(saved.itemIds || {}).length, lastSyncedAt: saved.lastSyncedAt || '', lastError: saved.lastError || '', warnings: saved.warnings || [] };
}

async function saveMondayBoard({ boardId } = {}) {
  const request = monday.createMondayClient({ token: getKey('MONDAY_API_TOKEN') });
  const board = await monday.describeBoard(request, boardId);
  const config = loadConfig();
  const previous = config.monday?.boardId === board.boardId ? config.monday : {};
  config.monday = { ...board, itemIds: previous.itemIds || {}, lastSyncedAt: previous.lastSyncedAt || '', lastError: '' };
  saveConfig();
  emitState();
  return publicMonday();
}

// One sync at a time across the studio: a second editor's sync waits for the first and starts from its saved item IDs,
// so no trend gets two Monday items. A board switched or cleared during a sync keeps the new setup.
let mondayQueue = Promise.resolve();
function syncTrendBoardToMonday(payload = {}) {
  const run = mondayQueue.then(() => syncTrendBoardToMondayNow(payload));
  mondayQueue = run.catch(() => {});
  return run;
}
async function syncTrendBoardToMondayNow({ cards } = {}) {
  const start = loadConfig().monday;
  if (!start?.boardId) throw new Error('Choose a Monday.com board in Settings first.');
  const token = getKey('MONDAY_API_TOKEN'); if (!token) throw new Error(keyNeeded('MONDAY_API_TOKEN', 'Connect Monday.com in Settings first.'));
  const result = await monday.syncTrendCards(monday.createMondayClient({ token }), start, cards);
  const config = loadConfig();
  if (config.monday?.boardId === start.boardId) {
    config.monday = { ...config.monday, itemIds: result.itemIds, lastSyncedAt: new Date().toISOString(), lastError: result.failed[0]?.error || '' };
    saveConfig();
    emitState();
  }
  return { created: result.created, updated: result.updated, failed: result.failed.length, error: result.failed[0]?.error || '' };
}

// The browser studio never receives server file locations: path fields in records shrink to their file name.
// Files still open and download by record ID, so nothing in the UI depends on the full path.
const RECORD_LISTS_WITH_PATHS = ['analyses', 'assets', 'researchExports', 'datasets', 'runs', 'conversations', 'jobs'];
function withoutServerPaths(state) {
  if (!WEB_RUNTIME) return state;
  const strip = (record) => (record && typeof record === 'object' && !Array.isArray(record)
    ? Object.fromEntries(Object.entries(record).map(([key, value]) => [key, typeof value === 'string' && (/Path$/.test(key) || key === 'path' || key === 'folder') && path.isAbsolute(value) ? path.basename(value) : value]))
    : record);
  const lists = (container) => { const copy = { ...container }; for (const key of RECORD_LISTS_WITH_PATHS) if (Array.isArray(copy[key])) copy[key] = copy[key].map(strip); return copy; };
  const copy = lists(state);
  if (copy.v5 && typeof copy.v5 === 'object') copy.v5 = lists(copy.v5); // the v5 projection repeats the same records
  return copy;
}

function publicState() {
  const data = loadData();
  const v5 = publicV5State(data);
  return withoutServerPaths({
    ...data,
    contentStudio: contentWorkspace.publicState(),
    recipes: data.recipes.map(publicRecipe),
    intelligence: studioIntelligence(data),
    keys: Object.fromEntries(KEY_NAMES.map((name) => [name, Boolean(getKey(name))])),
    // Saved keys this studio can't read ('mismatch': a different STUDIO_SECRET_KEY; 'foreign': another installation),
    // and data or settings files that were damaged and copied aside at startup. Names only, never values or paths.
    keyProblems: keyProblems(),
    ...(storeRecovery.length ? { storeRecovery: storeRecovery.map((entry) => ({ ...entry })) } : {}),
    monday: publicMonday(),
    jobs: Array.from(jobs.values()),
    v5,
  });
}

function studioIntelligence(data = loadData()) {
  return buildStudioIntelligence(data, (dataset) => ({ items: derivedFor(dataset).items }));
}

// What every state broadcast derives from a dataset (its evidence index, profile and items), cached per dataset and keyed
// on the payload file's identity plus the record, so a broadcast stats each payload instead of parsing it again (twice).
// writeJson renames a new file into place, so a rewrite changes the inode and mtime. rawItems are never kept.
const datasetDerived = new Map();
function derivedFor(dataset) {
  let file = ''; let stat = null;
  try { file = datasetPayloadFile(dataset.id); stat = fs.statSync(file); } catch (_) { stat = null; }
  const key = `${stat ? `${stat.ino}:${stat.size}:${stat.mtimeMs}` : 'missing'}|${JSON.stringify(dataset)}`;
  const hit = datasetDerived.get(dataset.id);
  if (hit && hit.key === key) return hit;
  let entry;
  try {
    const payload = file ? readJson(file, { rawItems: [], items: [] }) : { rawItems: [], items: [] };
    entry = { key, items: Array.isArray(payload.items) ? payload.items : [], evidence: buildEvidenceIndex(dataset, payload), profile: buildDatasetProfileV2(dataset, payload) };
  } catch (error) {
    const message = error.message || String(error);
    entry = { key, items: [], evidence: [], profile: { datasetId: dataset.id, name: dataset.name || dataset.id, rowCount: Number(dataset.itemCount) || 0, fields: [], rowTypes: [], mapperWarnings: [message], recommendedFixes: [{ severity: 'high', message }], confidence: 0 } };
  }
  datasetDerived.set(dataset.id, entry);
  return entry;
}
function pruneDerived(data) { const ids = new Set((data.datasets || []).map((dataset) => dataset.id)); for (const id of datasetDerived.keys()) if (!ids.has(id)) datasetDerived.delete(id); }

function emit(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

// The state broadcast. The base state is built once. The Mac app's window gets it projected for its one viewer, so a
// View as preview survives every push. The browser studio broadcasts the base, and studio-server writes each live-update
// stream through the people provider's view(), which projects it per person; nothing goes to a browser unprojected.
function emitState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const base = publicState();
  emit('state-changed', WEB_RUNTIME ? base : access.project(base, access.currentViewer()));
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

// A missing or damaged dataset payload never breaks the whole command center (derivedFor falls back to nothing).
function buildAllEvidence(data = loadData()) {
  pruneDerived(data);
  return (data.datasets || []).flatMap((dataset) => derivedFor(dataset).evidence);
}

// Profiles are cached with their payload; only the freshness age moves with the clock, so it is recomputed on each read.
function buildDatasetProfilesV2(data = loadData()) {
  return (data.datasets || []).map((dataset) => {
    const profile = derivedFor(dataset).profile;
    const newest = Date.parse(profile?.freshness?.newest || '');
    return Number.isFinite(newest) && profile.freshness ? { ...profile, freshness: { ...profile.freshness, ageHours: Math.round((Date.now() - newest) / 36e5) } } : profile;
  });
}

function buildV5Projection(data = loadData()) {
  const events = ensureV5Seed(data);
  const projection = projectEvents(events);
  return {
    ...projection,
    recipes: data.recipes.map(publicRecipe),
    recipeVersions: Object.fromEntries(Object.entries(projection.recipeVersions || {}).map(([id, versions]) => [id, versions.map(publicRecipe)])),
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
  return discoverApifyResourceLive(payload, {
    token: getKey('APIFY_API_TOKEN'),
    Client: ApifyClient,
  });
}

function saveRecipeVersion(payload) {
  const valid = validateRecipeVersionPayload(payload);
  appendV5Event('recipe-version-saved', valid);
  emitState();
  return publicV5State().recipeVersions[valid.recipeId]?.[0] || valid.version;
}

// ── Paid long calls: one request ID, one piece of work ──
// searchSources, runRecipe, testRecipe and analyzeDataset can outlast a proxy's timeout (the nginx example's 300 s), and
// the page may then try again. A payload with a requestId (8-100 letters, digits, - or _) joins the work already running
// for that person and ID, or gets its outcome back for 30 minutes, so a retry never starts a second paid run. A
// different payload under the same ID is refused. Without a requestId every call is new work, as before.
const REPEAT_REQUEST_ID = /^[A-Za-z0-9_-]{8,100}$/;
const REPEAT_KEEP_MS = 30 * 60 * 1000;
const repeatable = new Map(); // `${identity} ${method} ${requestId}` → { fingerprint, work, settledAt }
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value ?? null);
}
function onceForRequest(method, payload, start) {
  const record = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  if (record.requestId == null || record.requestId === '') return start();
  const requestId = String(record.requestId);
  if (!REPEAT_REQUEST_ID.test(requestId)) throw Object.assign(new Error('Invalid request ID.'), { status: 400 });
  const at = Date.now();
  for (const [key, entry] of repeatable) if (entry.settledAt && at - entry.settledAt > REPEAT_KEEP_MS) repeatable.delete(key);
  const { requestId: _requestId, ...rest } = record;
  const fingerprint = stableJson(rest);
  const key = `${access.identityForCall()?.id || 'local'} ${method} ${requestId}`;
  const found = repeatable.get(key);
  if (found) {
    if (found.fingerprint !== fingerprint) throw Object.assign(new Error('Use a new request ID for a different request.'), { status: 409, code: 'requestIdReused' });
    return found.work;
  }
  const entry = { fingerprint, settledAt: 0, work: null };
  entry.work = Promise.resolve().then(start).finally(() => { entry.settledAt = Date.now(); });
  repeatable.set(key, entry);
  while (repeatable.size > 500) repeatable.delete(repeatable.keys().next().value);
  return entry.work;
}

// Test sample: up to 10 rows under the test limits ($1 and 3 minutes at most, testRunOptions), as a cancellable job in
// the tray, one at a time per scraper. A run that hits its time limit still shows the rows it collected.
const testingRecipes = new Set();
async function testRecipe(payload) {
  const data = loadData();
  const recipe = validateRecipe(payload, data.recipes.find((item) => item.id === payload?.id));
  const token = getKey('APIFY_API_TOKEN');
  if (!token) throw new Error(keyNeeded('APIFY_API_TOKEN', 'Connect Apify in Settings first.'));
  const busyKey = payload?.id ? `id:${payload.id}` : `draft:${recipe.actorId || recipe.taskId}|${stableJson(recipe.input)}`;
  if (testingRecipes.has(busyKey)) throw Object.assign(new Error('A test of this scraper is still running. Wait for it, or stop it in the jobs tray.'), { status: 409 });
  const limits = testRunOptions(recipe.runOptions);
  const jobId = toId('test');
  testingRecipes.add(busyKey);
  startJob({ id: jobId, kind: 'run', status: 'running', title: `${recipe.name} (test)`, cancellable: true, startedAt: now() });
  try {
    const runner = createApifyRunner({ token, Client: ApifyClient });
    const result = await runner.runRecipe({ ...recipe, runOptions: limits }, {
      maxItems: Math.min(10, Number(data.settings.maxItems) || 10), abortAfterMs: abortAfterMs(limits), salvage: true,
      isCancelled: () => cancelledJobs.has(jobId),
      onRunStarted: (run) => { if (run?.id) apifyRunControllers.set(jobId, { runId: run.id, abort: () => new ApifyClient({ token }).run(run.id).abort({ gracefully: true }) }); },
    });
    if (result.salvaged && !result.normalizedItems.length) throw new Error(`The test run ended (Apify status ${result.run.status}) before the scraper returned any rows. ${result.statusMessage || 'Narrow the input, or run it in full.'}`.trim());
    const dataset = { id: 'test-dataset', name: `${recipe.name} test`, platform: recipe.platform, runId: result.run.id, recipeId: recipe.id };
    finishJob(jobId, { status: 'succeeded' });
    return {
      run: result.run,
      rawSample: result.rawItems.slice(0, 5),
      normalizedSample: result.normalizedItems.slice(0, 5),
      profile: buildDatasetProfileV2(dataset, { items: result.normalizedItems }),
      limits,
      ...(result.salvaged ? { stoppedEarly: true, note: `The test run ended with Apify status ${result.run.status}; these are the rows it collected.` } : {}),
    };
  } catch (error) {
    if (wasCancelled(jobId)) finishJob(jobId, { status: 'cancelled', error: error.message });
    else failJob(jobId, error);
    throw error;
  } finally { testingRecipes.delete(busyKey); apifyRunControllers.delete(jobId); }
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
  const filePath = path.join(browserDownloadFolder() || dataPath('v5', 'bundles'), `${safeFilename(bundle.mission.name)}-${Date.now()}.json`);
  writeJson(filePath, bundle);
  return forBrowser({ filePath, bundle }, filePath);
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
  const result = { dir, markdownPath, htmlPath, assetCount: assets.length };
  return WEB_RUNTIME ? offerBrowserFolder(result, dir) : result;
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
  for (const key of ['runs', 'analyses', 'intentRuns', 'conversations']) {
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
    minWidth: 720,
    minHeight: 560,
    title: APP_NAME,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#f6f8f7',
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
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url);
      if (['https:', 'http:'].includes(target.protocol) && !target.username && !target.password) shell.openExternal(target.href).catch(() => {});
    } catch (_) {}
    return { action: 'deny' };
  });
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
  const filePath = path.join(browserDownloadFolder() || dataPath('exports'), `${safeFilename(dataset.name || dataset.id)}.${extension}`);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  if (valid.reveal && !WEB_RUNTIME) shell.showItemInFolder(filePath);
  return forBrowser({ filePath, itemCount: items.length, format: extension }, filePath);
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
  if (request.action === 'createSpreadsheetBatch') return runWorkbookExport(startSheetRun('replay-workbook-export', request, { replayOf: validRunId, workbookName: existing.workbookName || request.title || '', rowCount: Number(request.rowCount) || 0, chunkCount: Number(request.chunkCount) || 0 }), request);
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

// The bridge's newer actions (Google Sheets and Docs) need the current scripts/google-sheets-webhook.gs. An older
// deployment answers "Unsupported action", which reads better as what to do about it.
async function callBridgeAction(request) {
  try { return await callSheetsWebhook(request); }
  catch (error) {
    if (!/Unsupported action/i.test(error.message || '')) throw error;
    throw new Error('Your Google Sheets bridge is an older version. Paste the latest scripts/google-sheets-webhook.gs into Apps Script, run authorizeBridge once, then deploy a new version (see the Sheets guide).');
  }
}

// Sheets → Export → Create Google Sheet: a new spreadsheet built through the bridge in chunks, with a sheet-run
// receipt. A failed export replays from Settings into the same spreadsheet without writing any chunk twice.
async function exportWorkbookToGoogleSheets(payload = {}) {
  if (!getKey('GOOGLE_SHEETS_WEBHOOK_URL')) throw new Error('Connect the Google Sheets bridge in Settings → Google Sheets first.');
  const { normalizeWorkbookExport, planGoogleSheetsExport, EXPORT_LIMITS } = require('./workbooks');
  const workbook = normalizeWorkbookExport(payload, { maxCells: EXPORT_LIMITS.googleCells, tooLarge: 'This workbook is too large to create as one Google Sheet (more than 2,000,000 cells). Download it as .xlsx and import that file in Google Sheets instead.' });
  const folderId = payload.folderId ? require('../shared/validation').parseDriveFolderId(payload.folderId, 'Folder') : (sheetSettings().sheetsExportFolderId || '');
  const plan = planGoogleSheetsExport(workbook, { requestId: toId('sheet-export'), folderId });
  const rowCount = workbook.sheets.reduce((sum, sheet) => sum + sheet.rows.length, 0);
  const batchRequest = { action: 'createSpreadsheetBatch', title: workbook.name, tabs: plan.create.tabs.map((tab) => tab.name), rowCount, chunkCount: plan.appends.length + 1, folderId, create: plan.create, appends: plan.appends };
  return runWorkbookExport(startSheetRun('workbook-export', batchRequest, { workbookName: workbook.name, rowCount, chunkCount: batchRequest.chunkCount }), batchRequest);
}

async function runWorkbookExport(sheetRun, batchRequest) {
  try {
    const result = await require('./workbooks').runGoogleSheetsExport(batchRequest, callBridgeAction);
    const saved = finishSheetRun(sheetRun, result, { spreadsheetId: result.spreadsheetId, spreadsheetUrl: result.url });
    return { url: result.url, spreadsheetId: result.spreadsheetId, title: batchRequest.title, tabCount: result.tabCount, rowCount: batchRequest.rowCount, sheetRunId: saved.id };
  } catch (error) {
    failSheetRun(sheetRun, error);
    throw error;
  }
}

// Publishing to Google Drive goes through the bridge whenever it is connected (nothing to paste or expire);
// otherwise through the Drive access token. Docs land in the folders set in Settings → Google Sheets.
function googlePublishVia() {
  return getKey('GOOGLE_SHEETS_WEBHOOK_URL') ? 'bridge' : getKey('GOOGLE_DOCS_ACCESS_TOKEN') ? 'token' : '';
}

let bridgeDelivery = null;
async function publishCampaignVia(request, tokenDelivery) {
  if (googlePublishVia() === 'bridge') {
    bridgeDelivery ||= require('./bridge-delivery').createBridgeDelivery({
      callBridge: callBridgeAction,
      getFolders: () => { const settings = sheetSettings(); return { default: settings.docsFolderId || '', byDeliverable: { 'evidence-report': settings.trendReportsFolderId || '', 'editorial-toolkit': settings.toolkitsFolderId || '' } }; },
    });
    return bridgeDelivery.publishCampaign(request);
  }
  // Files made through the bridge are known only by their bridge request IDs; the token adapter would copy them again.
  if (request?.previousReceipt?.via === 'bridge') throw new Error('This campaign was published through the Google Sheets bridge. Reconnect the bridge in Settings to finish or retry it.');
  return tokenDelivery.publishCampaign(request);
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
    // The instruction is the Prompt Library's "Workflow asset pack" text in the active workspace (defaults otherwise).
    const prompt = dataPrompts.assetPackPrompt(fs.readFileSync(contextPath, 'utf8'), { blocks: contentWorkspace.promptEffective('data.workflow-asset-pack').blocks });
    const result = await generateStructuredOutput({ schema: SCHEMAS.assetPack, prompt, workspaceDir: runDir, outputPath, jobId: assetRunId });
    const { stdout, stderr } = result;
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
        aiReceipt: result.receipt,
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
      if (existing) upsertById(data.assets, { ...existing, status: 'failed', error: 'AI did not return this asset.', updatedAt: now() });
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

  const runBrandContext = recipe.marketingBrief?.brandContext || researchWorkspace.selectedBrand();
  // Scrapers saved before every recipe carried limits get the defaults ($5, 15 minutes); the studio stops the run itself
  // a little after Apify's own timeout.
  const runOptions = recipe.runOptions || { ...DEFAULT_RUN_OPTIONS };
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
    runLimits: runOptions,
    startedAt: job.startedAt,
  };
  upsertById(data.runs, runRecord);
  saveData();
  emitState();

  try {
    const token = getKey('APIFY_API_TOKEN');
    const runner = createApifyRunner({ token, Client: ApifyClient });
    const result = await runner.runRecipe({ ...recipe, runOptions }, {
      maxItems: recipe.searchContext?.maxResultItems || recipe.searchContext?.maxItems || Number(data.settings.maxItems) || 1000,
      abortAfterMs: abortAfterMs(runOptions), salvage: true,
      isCancelled: () => cancelledJobs.has(localRunId),
      onRunStarted: (run) => {
        if (!run?.id) return;
        apifyRunControllers.set(localRunId, {
          runId: run.id,
          abort: () => new ApifyClient({ token }).run(run.id).abort({ gracefully: true }),
        });
        upsertById(data.runs, { ...runRecord, apifyRunId: run.id, status: String(run.status || 'RUNNING').toLowerCase(), usageTotalUsdAtCompletion: run.usageTotalUsd ?? null, updatedAt: now() });
        saveData();
        emitState();
      },
      onStatus: (run) => {
        if (!run?.id) return;
        upsertById(data.runs, { ...runRecord, apifyRunId: run.id, status: String(run.status || 'RUNNING').toLowerCase(), usageTotalUsdAtCompletion: run.usageTotalUsd ?? null, updatedAt: now() });
        jobs.set(localRunId, { ...jobs.get(localRunId), status: 'running', progress: 25, apifyRunId: run.id });
        emitState();
      },
    });
    // A run stopped at its time limit (or aborted) keeps the rows it collected, marked as stopped early; a failed run is
    // still a failure.
    if (result.salvaged && !['TIMED-OUT', 'ABORTED'].includes(result.run.status)) throw new Error(`Apify run finished with status ${result.run.status}.${result.statusMessage ? ` ${result.statusMessage}` : ''}`);
    const stoppedEarly = result.salvaged ? { stoppedEarly: true, stopReason: `Apify status ${result.run.status}${result.run.abortedForTimeLimit || result.run.status === 'TIMED-OUT' ? `: the ${Math.round(runOptions.timeoutSecs / 60)}-minute limit` : ''}` } : {};
    if (recipe.marketingBrief?.templateId === 'account-research') {
      result.normalizedItems = result.normalizedItems.map(item => ({ ...item, account: accountForUrl(item.url, recipe.marketingBrief.brandContext) }));
    }
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
      brandContext: runBrandContext,
      ...(recipe.marketingBrief ? { marketingBrief: { ...recipe.marketingBrief, sourceUrls: (Array.isArray(recipe.input?.startUrls) ? recipe.input.startUrls : []).map((source) => typeof source === 'string' ? source : source.url).filter(Boolean) } } : {}),
      ...(recipe.searchContext ? { searchContext: recipe.searchContext } : {}),
      collectionScope: {
        requestedUrls: (Array.isArray(recipe.input?.startUrls) ? recipe.input.startUrls : []).map((source) => typeof source === 'string' ? source : source.url).filter(Boolean),
        returnedRows: result.normalizedItems.length,
        retrievalLimit: recipe.searchContext?.maxResultItems || recipe.searchContext?.maxItems || Number(data.settings.maxItems) || 1000,
        providerRows: result.rawItems.length,
        expandedCommentRows: Math.max(0, result.normalizedItems.length - result.rawItems.length),
        ...(recipe.searchContext ? { searchSourceId: recipe.searchContext.sourceId, postAllowance: recipe.searchContext.maxItems, sourceOptions: recipe.searchContext.sourceOptions, dateSemantics: recipe.searchContext.dateSemantics } : {}),
        apifyRunId: result.run.id,
        buildId: result.run.buildId || '',
        runLimits: runOptions,
        ...stoppedEarly,
      },
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
      buildId: result.run.buildId || '',
      usageTotalUsdAtCompletion: result.run.usageTotalUsd ?? null,
      runLimits: runOptions,
      ...stoppedEarly,
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
    upsertById(data.runs, { ...runRecord, ...data.runs.find((run) => run.id === localRunId), status, error: safeServiceError(error), finishedAt: now() });
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
    // No saved key reaches any AI CLI (studioCliEnv also drops every STUDIO_* setting); see studio-host.js.
    const environment = cliEnv();
    for (const name of KEY_NAMES) delete environment[name];
    if (command === 'claude') Object.assign(environment, CLAUDE_CLI_ENV);
    const child = spawn(command, args, { cwd, env: environment });
    if (options.stdin != null) { child.stdin.on('error', () => {}); child.stdin.end(options.stdin); }
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
      finish(() => reject(new Error(`${options.providerLabel || 'AI'} timed out after ${Math.round(timeoutMs / 1000)} seconds.`)));
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
        else { const error = new Error(safeServiceError(stderr || `${options.providerLabel || 'AI'} stopped before finishing (exit code ${code}). Check the connection in Settings, then retry.`)); if (options.keepStdoutOnError) error.stdout = stdout; reject(error); }
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
  const payload = readDatasetPayload(datasetId);
  const sourceContext = buildFindingsContext({ datasets: [{ dataset, items: payload.items || [] }], question: 'Prepare the requested analysis.' });
  if (!sourceContext.sources.length) throw new Error('This dataset has no usable text to analyze.');
  const reportPreset = valid.kind === 'report' ? reportPresetById(valid.reportPresetId || dataset.marketingBrief?.reportPresetId) : null;

  const analysisId = toId(valid.kind);
  const job = startJob({ id: analysisId, kind: valid.kind, status: 'running', title: reportPreset?.name || dataset.name, cancellable: true, startedAt: now() });

  const analysis = {
    id: analysisId,
    datasetId,
    projectId: dataset.projectId || 'default',
    kind: valid.kind,
    datasetSnapshot: JSON.parse(JSON.stringify({ ...dataset, brandContext: dataset.marketingBrief?.brandContext || dataset.brandContext || researchWorkspace.selectedBrand() })),
    includedItemIds: sourceContext.sources.map(source => source.itemId),
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

  const intelligence = studioIntelligence(data);
  const profile = intelligence.datasetProfiles.find((item) => item.datasetId === dataset.id) || null;
  const analysisContext = buildAnalysisContext({
    dataset,
    profile,
    kind: valid.kind,
    reportPresetId: reportPreset?.id || '',
  });
  analysisContext.brandContext = analysis.datasetSnapshot.brandContext;
  // Prompt Library: this kind's instruction and the analysis rules as saved in the active workspace (defaults otherwise).
  // The rules go into ANALYSIS_CONTEXT and analysis-context.json alike, so the receipt shows what the model saw.
  const kindPromptId = valid.kind === 'tag' ? 'data.tag-items' : valid.kind === 'thread' ? 'data.threads' : 'data.dataset-report';
  const kindPrompt = contentWorkspace.promptEffective(kindPromptId); const rulesPrompt = contentWorkspace.promptEffective('data.analysis-rules');
  analysisContext.rules = dataPrompts.analysisRules(rulesPrompt.blocks);
  analysis.prompts = { [kindPromptId]: { version: kindPrompt.version, custom: kindPrompt.custom }, 'data.analysis-rules': { version: rulesPrompt.version, custom: rulesPrompt.custom } };
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

  // research-workspace.js finds "\nSOURCE_ITEMS (untrusted evidence):\n" in prompt.txt; analysisPrompt keeps that marker.
  const prompt = dataPrompts.analysisPrompt({ kind: valid.kind, reportPresetId: reportPreset?.id || '', analysisContext, coverage: sourceContext.coverage, items: sourceContext.items, blocks: kindPrompt.blocks });
  fs.writeFileSync(promptPath, prompt);

  let stderr = '';
  try {
    const result = await generateStructuredOutput({ schema: SCHEMAS[valid.kind], prompt, workspaceDir: runDir, outputPath, jobId: analysisId });
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
      itemsPath,
      outputPath,
      eventsPath,
      promptPath,
      reportPath: valid.kind === 'report' ? reportPath : '',
      eventCount: events.length,
      aiReceipt: result.receipt,
      coverage: sourceContext.coverage,
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

function safeServiceError(error) {
  return String(error?.message || error || 'Service request failed.').replace(/apify_api_[A-Za-z0-9]+/g, '[redacted]').replace(/([?&]token=)[^&\s]+/g, '$1[redacted]').slice(0, 2000);
}

async function refreshApifyActors() {
  const token = getKey('APIFY_API_TOKEN');
  if (!token) throw new Error(keyNeeded('APIFY_API_TOKEN', 'Connect Apify in Settings first.'));
  const client = new ApifyClient({ token });
  const actors = [];
  let offset = 0;
  try {
    do {
      const page = await client.actors().list({ my: false, limit: 100, offset, desc: true, sortBy: 'stats.lastRunStartedAt' });
      actors.push(...(page.items || []).map((actor) => ({ id: actor.id, name: actor.name, username: actor.username, title: actor.title || actor.name, fullName: `${actor.username}/${actor.name}`, lastRunAt: actor.stats?.lastRunStartedAt || '' })));
      offset += (page.items || []).length;
      if (!(page.items || []).length || offset >= page.total || offset >= 1000) break;
    } while (true);
    const data = loadData();
    data.apifyCatalog = { actors, syncedAt: now(), capped: offset >= 1000 };
    saveData(); emitState();
    return data.apifyCatalog;
  } catch (error) { throw new Error(safeServiceError(error)); }
}

async function searchSources(payload) {
  if (!getKey('APIFY_API_TOKEN')) throw new Error(keyNeeded('APIFY_API_TOKEN', 'Connect Apify in Settings first.'));
  const plan = buildSearchRecipes(payload);
  const data = loadData();
  const searchId = toId('search');
  const recipes = plan.recipes.map((input) => validateRecipe(input));
  for (const recipe of recipes) upsertById(data.recipes, recipe);
  saveData(); emitState();
  // Each selected source has its own explicit run budget and an independent receipt.
  const settled = await Promise.allSettled(recipes.map((recipe) => runRecipe(recipe.id)));
  const datasets = [];
  const errors = [];
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') datasets.push(result.value);
    else errors.push({ sourceId: recipes[index].searchContext.sourceId, message: safeServiceError(result.reason) });
  });
  emitState();
  return { searchId, datasets, errors, totalMaxChargeUsd: plan.totalMaxChargeUsd, totalRequestedItems: plan.totalRequestedItems, totalRequestedPosts: plan.totalRequestedPosts };
}

// Claude routes (the Claude app or an API key) and model checks before spending; see ai-routes.js.
const aiRoutes = createAiRoutes({
  spawn: async (command, args, { cwd, stdin, timeoutMs } = {}) => { await loginShellPathReady; return spawnCodex(command, args, cwd || app.getPath('userData'), { stdin, timeoutMs, providerLabel: 'Claude' }); },
  getKey, getSettings: () => loadData().settings, dataDir: () => dataRoot(), describeError: safeServiceError,
  // New API keys sit on low rate limits; large discovery batches can draw a 429, so retry a little more.
  createRunner: ({ apiKey }) => require('../shared/anthropic-runner').createAnthropicRunner({ apiKey, maxRetries: 4 }),
});
const apiRequests = aiRoutes.apiRequests;
// The last result is kept in settings (lastAiCheck), so Home's setup checklist can tick "Check that Claude works".
async function checkAi(payload = {}) {
  const provider = payload.provider || loadData().settings.aiProvider || 'auto';
  let result;
  if (provider === 'codex') { codexExecHelp = null; result = { ...await checkCodexCli(), provider, route: 'codex' }; } // a check reads a newer CLI's flags again
  else result = await aiRoutes.check({ provider, models: payload.models || [loadData().settings.aiModel || DEFAULT_CLAUDE_MODEL] });
  try {
    const data = loadData();
    data.settings = { ...data.settings, lastAiCheck: { ok: Boolean(result?.ok), provider, at: new Date().toISOString() } };
    saveData(); emitState();
  } catch (error) { console.warn(`The AI check result could not be saved: ${error?.message || error}`); }
  return result;
}

// Optional studio-wide AI limits (src/main/ai-limits.js: STUDIO_AI_CONCURRENCY, STUDIO_DAILY_AI_BUDGET_USD); unset, every
// call runs at once as before. Pictures go through the same limits (the image provider below).
const aiLimits = require('./ai-limits').createAiLimits({ env: process.env, file: dataPath('ai-spend.json') });

// The flags this Codex CLI's `exec` takes (codexExecSupport), read once from its --help; checkAi reads them again.
let codexExecHelp = null;
function codexSupport() {
  if (!codexExecHelp) {
    codexExecHelp = new Promise((resolve) => {
      let text = ''; let child; let timer = null;
      const done = () => { if (timer) clearTimeout(timer); resolve(text); };
      try { child = spawn('codex', ['exec', '--help'], { env: cliEnv() }); } catch (_) { resolve(''); return; }
      timer = setTimeout(() => { try { child.kill('SIGTERM'); } catch (_) { /* already gone */ } done(); }, 5000);
      child.stdout?.on('data', (chunk) => { text += chunk.toString(); });
      child.on('error', done); child.on('close', done);
    }).then((text) => { if (!text) codexExecHelp = null; return codexExecSupport(text); });
  }
  return codexExecHelp;
}

// Every AI text call (Ask AI, data tools, research and content runs, prompt tests) comes through here. Under a
// concurrency limit a call may wait for a slot; while it waits it sits in apiRequests under its job id, so the tray's
// Cancel, a run's Cancel and quitting stop it there too.
// `onWait(position)` and `onStart()` (optional) let a caller show that a call is waiting its turn (content-workspace runs).
async function generateStructuredOutput(args) {
  if (!aiLimits.enabled) return generateStructuredOutputNow(args);
  const { jobId, onWait, onStart } = args; let waiting = null; let waited = false;
  try {
    return await aiLimits.run(() => {
      if (jobId && waiting && apiRequests.get(jobId) === waiting) apiRequests.delete(jobId);
      if (waited) { try { onStart?.(); } catch (_) { /* a message is a courtesy */ } }
      return generateStructuredOutputNow(args);
    }, { onWait: (position) => { waited = true; onWait?.(position); }, register: (cancel) => { if (jobId && !apiRequests.has(jobId)) { waiting = { abort: cancel }; apiRequests.set(jobId, waiting); } } });
  } finally { if (jobId && waiting && apiRequests.get(jobId) === waiting) apiRequests.delete(jobId); }
}

// `cachePrefix` (optional) is the stable start of the prompt: the API route caches it in its own system block; the Claude
// app and Codex take one prompt, so for them it simply leads the prompt. `timeoutMs` applies on every route.
async function generateStructuredOutputNow({ schema, prompt, cachePrefix = '', workspaceDir, outputPath, jobId, maxBudgetUsd, model, effort, timeoutMs }) {
  const settings = loadData().settings;
  const { route: provider } = await aiRoutes.requireRoute();
  if (provider === 'claude-api') {
    const requestedModel = model || settings.aiModel || DEFAULT_CLAUDE_MODEL;
    const controller = new AbortController(); if (jobId) apiRequests.set(jobId, controller);
    try {
      const { output, receipt } = await aiRoutes.runner().run({ schema, prompt, ...(cachePrefix ? { cachePrefix } : {}), model: requestedModel, effort, maxBudgetUsd: maxBudgetUsd ?? settings.aiMaxBudgetUsd ?? 1, timeoutMs, signal: controller.signal });
      writeJson(outputPath, output);
      return { output, receipt, stdout: '' };
    } finally { if (jobId && apiRequests.get(jobId) === controller) apiRequests.delete(jobId); }
  }
  if (cachePrefix) prompt = cachePrefix + prompt;
  if (provider === 'claude') {
    // Research stages pass their own model and effort (n8n ran different models per stage).
    const requestedModel = model || settings.aiModel || DEFAULT_CLAUDE_MODEL;
    const invocation = buildClaudeCommand({ model: requestedModel, maxBudgetUsd: maxBudgetUsd ?? settings.aiMaxBudgetUsd ?? 1, schema, prompt, effort });
    let result;
    try { result = await spawnCodex(invocation.command, invocation.args, workspaceDir, { jobId, stdin: invocation.stdin, providerLabel: 'Claude', ...(timeoutMs ? { timeoutMs } : {}), keepStdoutOnError: true }); }
    catch (error) { if (error.stdout) { const costUsd = readClaudeCost(error.stdout); try { parseClaudeResult(error.stdout); } catch (detail) { detail.costUsd = costUsd; throw detail; } error.costUsd = costUsd; } throw error; }
    const parsed = parseClaudeResult(result.stdout);
    if (!modelMatches(requestedModel, parsed.actualModels)) throw new Error(`Claude returned an unverified or different model (${parsed.actualModels.join(', ') || 'not reported'}). No fallback answer was saved.`);
    writeJson(outputPath, parsed.output);
    return { ...result, output: parsed.output, receipt: { provider, requestedModel, actualModel: parsed.actualModel, actualModels: parsed.actualModels, effort: effort || '', costUsd: parsed.costUsd, usage: parsed.usage, durationMs: parsed.durationMs, costBasis: 'CLI-reported list cost; subscription billing may differ' } };
  }
  if (provider !== 'codex') throw new Error('Unknown AI provider.');
  // Codex is a shell agent, and the studio's data folder holds every person's Ask AI conversations and memory. So it runs
  // in an empty private folder outside the data folder, gets the prompt on stdin (no prompt file is written anywhere),
  // has its tools off and a read-only sandbox (codex-runner.js), and its answer is copied to outputPath here. The CLI's own
  // config file (its model, provider, MCP servers and hooks) is skipped on the browser studio and kept on the Mac;
  // STUDIO_CODEX_USER_CONFIG=1 keeps it, =0 skips it.
  const isolated = fs.mkdtempSync(path.join(require('os').tmpdir(), 'studio-codex-'));
  try {
    const schemaPath = path.join(isolated, 'output.schema.json'); const answerPath = path.join(isolated, 'answer.json');
    fs.writeFileSync(schemaPath, JSON.stringify(schema), { mode: 0o600 });
    const invocation = buildCodexCommand({ workspaceDir: isolated, schemaPath, outputPath: answerPath, isolated: true, support: await loginShellPathReady.then(() => codexSupport()), ignoreUserConfig: process.env.STUDIO_CODEX_USER_CONFIG === '0' || (WEB_RUNTIME && process.env.STUDIO_CODEX_USER_CONFIG !== '1') });
    const result = await spawnCodex(invocation.command, invocation.args, isolated, { jobId, stdin: `${dataPrompts.codexWrapper('the text below')}\n\n${prompt}`, providerLabel: 'Codex', ...(timeoutMs ? { timeoutMs } : {}) });
    const raw = fs.existsSync(answerPath) ? fs.readFileSync(answerPath, 'utf8') : '';
    let output = null; try { output = raw ? JSON.parse(raw) : null; } catch (_) { output = null; }
    if (output !== null) writeJson(outputPath, output); else if (raw) fs.writeFileSync(outputPath, raw); // kept for the receipt
    return { ...result, output, receipt: { provider, requestedModel: 'CLI configuration', actualModel: '', costUsd: null } };
  } finally { fs.rmSync(isolated, { recursive: true, force: true }); }
}

async function askFindings(payload = {}) {
  const question = stringValue(payload.question, 'Question', { required: true, max: 4000 });
  if (!Array.isArray(payload.datasetIds) || !payload.datasetIds.length || payload.datasetIds.length > 8) throw new Error('Choose between one and eight datasets.');
  const datasetIds = [...new Set(payload.datasetIds.map((id) => validateId(id, 'Dataset ID')))];
  const data = loadData();
  const selected = datasetIds.map((id) => {
    const dataset = data.datasets.find((item) => item.id === id);
    if (!dataset) throw new Error('A selected dataset no longer exists.');
    return { dataset, items: readDatasetPayload(id).items || [] };
  });
  const requestId = payload.requestId == null ? '' : String(payload.requestId);
  if (requestId && !/^[A-Za-z0-9_-]{8,100}$/.test(requestId)) throw new Error('Invalid question request ID.');
  const existing = payload.conversationId ? data.conversations.find((item) => item.id === validateId(payload.conversationId, 'Conversation ID')) : requestId ? data.conversations.find((item) => item.lastRequestId === requestId) : null;
  if (payload.conversationId && !existing) throw new Error('Conversation not found. Start a new chat.');
  if (existing && [...existing.datasetIds].sort().join('|') !== [...datasetIds].sort().join('|')) throw new Error('Start a new chat to change the selected evidence.');
  if (existing?.lastRequestId === requestId && requestId) {
    const lastQuestion = [...existing.messages].reverse().find((message) => message.role === 'user')?.content;
    if (lastQuestion !== question) throw new Error('Use a new request ID for a different question.');
    if (existing.status === 'ready') return { conversation: existing };
  }
  const conversationId = existing?.id || toId('chat');
  if (activeChats.has(conversationId)) throw new Error('This chat already has a question in progress.');
  const conversation = { ...existing, id: conversationId, lastRequestId: requestId, title: existing?.title || question.slice(0, 80), datasetIds, messages: [...(existing?.messages || [])], createdAt: existing?.createdAt || now(), updatedAt: now(), status: 'running', error: '' };
  // The instructions are the Prompt Library's "Ask your datasets" text saved in the active workspace (defaults otherwise).
  const instructions = contentWorkspace.promptEffective('assistant.ask-datasets');
  const context = buildFindingsContext({ datasets: selected, messages: conversation.messages, question, blocks: instructions.blocks });
  context.prompt += brandContextBlock(selected.map(({ dataset }) => ({ datasetId: dataset.id, brand: dataset.marketingBrief?.brandContext || dataset.brandContext || researchWorkspace.selectedBrand() })));
  if (!context.sources.length) throw new Error('The selected datasets have no usable text. Inspect the source mapping before asking AI.');
  const latest = conversation.messages.at(-1);
  if (!(['failed', 'cancelled'].includes(existing?.status) && latest?.role === 'user' && latest.content === question)) conversation.messages.push({ id: toId('message'), role: 'user', content: question, createdAt: now() });
  activeChats.add(conversationId);
  const jobId = toId('answer');
  startJob({ id: jobId, kind: 'chat', title: conversation.title, cancellable: true, status: 'running', startedAt: now() });
  upsertById(data.conversations, conversation); saveData(); emitState();
  const workspaceDir = ensureWorkspace(dataPath('workspaces'), 'default');
  const runDir = path.join(workspaceDir, safeFilename(jobId));
  fs.mkdirSync(runDir, { recursive: true });
  try {
    const outputPath = path.join(runDir, 'answer.json');
    const result = await generateStructuredOutput({ schema: CHAT_SCHEMA, prompt: context.prompt, workspaceDir: runDir, outputPath, jobId });
    const normalized = normalizeFindingsAnswer(result.output, context);
    conversation.messages.push({ id: toId('message'), role: 'assistant', content: normalized.answer, citations: normalized.citations, caveats: normalized.caveats, coverage: context.coverage, aiReceipt: result.receipt, createdAt: now() });
    conversation.status = 'ready'; conversation.updatedAt = now();
    upsertById(data.conversations, conversation);
    writeJson(path.join(runDir, 'receipt.json'), { conversationId, datasetIds, coverage: context.coverage, aiReceipt: result.receipt, rejectedCitationCount: normalized.rejectedCitationCount });
    finishJob(jobId, { status: 'succeeded' }); saveData(); emitState();
    return { conversation };
  } catch (error) {
    conversation.status = wasCancelled(jobId) ? 'cancelled' : 'failed'; conversation.error = safeServiceError(error); conversation.updatedAt = now();
    upsertById(data.conversations, conversation); failJob(jobId, error); saveData(); emitState();
    throw new Error(conversation.error);
  } finally { activeChats.delete(conversationId); }
}

const imageProvider = createImageProvider({ getApiKey: () => getKey('OPENAI_API_KEY'), limits: aiLimits.enabled ? aiLimits : null });
const googleDelivery = require('./google-delivery').createGoogleDelivery({ getAccessToken: () => getKey('GOOGLE_DOCS_ACCESS_TOKEN') });
// Both desktop and browser hosts own this same storage boundary exclusively.
let releaseStudioOwner;
try { releaseStudioOwner = acquireStudioOwnerLock(dataPath('content-studio')); }
catch (error) { dialog.showErrorBox('Workspace already in use', error.message); app.exit(1); }
app.once('quit', () => releaseStudioOwner?.());
// The team (people, roles, sign-in links, trend answers, activity and preferences) is content-studio/team.json, inside the
// folder the owner lock protects. On the web STUDIO_ADMIN_EMAILS names admins that People can't change (company sign-in).
const ADMIN_EMAILS = WEB_RUNTIME ? String(process.env.STUDIO_ADMIN_EMAILS || '').split(',').map((email) => email.trim().toLowerCase()).filter(Boolean) : [];
let teamStore;
try { teamStore = createTeamStore({ root: dataPath('content-studio'), adminEmails: ADMIN_EMAILS }); }
catch (error) { dialog.showErrorBox('Team data could not be read', error.message); app.exit(1); throw error; }
// Ask AI's conversations and long-term memory, one folder per person (src/main/ask-store.js), beside team.json. Never in
// the broadcast state: the help:* methods read them for the person asking.
const askStore = require('./ask-store').createAskStore({ root: dataPath('content-studio', 'ask') });
const studioHost = createStudioHost({ root: dataPath('content-studio'), getApifyToken: () => getKey('APIFY_API_TOKEN'), model: () => loadData().settings.aiModel || DEFAULT_CLAUDE_MODEL });
const contentWorkspace = createContentWorkspace({
  // A first launch opens in the edition this build is packaged for; saved state always wins after that.
  defaultWorkspaceId: packageConfig.studioDefaultWorkspace || 'general',
  // Who started a run, decided a trend or edited a report: the person making this call (read once at each method's entry).
  actor: () => access.actorForCall(),
  root: dataPath('content-studio'), emit: emitState,
  // Each concurrent call gets its own process key so cancelling a run stops all of them. A prompt test run passes its own
  // jobId (its job in the tray), so Cancel there stops it.
  runAI: args => generateStructuredOutput({ ...args, jobId: args.jobId || `${args.runId}::${path.basename(args.outputPath || 'call')}` }),
  collect: studioHost.collect,
  generateImage: request => imageProvider.generateImage(request),
  getDatasets: () => [...loadData().datasets, ...studioHost.getDatasets()],
  readDataset: datasetId => loadData().datasets.some(d => d.id === datasetId) ? readDatasetPayload(datasetId) : studioHost.readDataset(datasetId),
  cancelProvider: async runId => { for (const [key, child] of jobProcesses) if (key === runId || key.startsWith(`${runId}::`)) child.kill('SIGTERM'); for (const [key, controller] of apiRequests) if (key === runId || key.startsWith(`${runId}::`)) controller.abort(); await studioHost.cancelProvider(runId); },
  openFile: openPathOrThrow,
  publishCampaign: request => publishCampaignVia(request, googleDelivery), // the Sheets bridge when connected, else the Drive token
  // The AI route a quick scan's cost check names ('auto' resolved to the Claude app or the API key), so Codex's
  // "spend isn't capped" note shows when it applies.
  getAiProvider: async () => (await aiRoutes.resolve()).route,
  // Prompt Library: saves are credited with the caller's role, and only admins change or lock a locked prompt (read at
  // each prompt method's entry, like actor). Test runs show in the job tray as cancellable 'prompt-test' jobs.
  getCallerRole: () => access.currentViewer()?.role || '',
  // A preview or test on a recent run's posts, reports or dataset rows only for someone whose role may read them.
  getCallerCapabilities: () => { const viewer = access.currentViewer(); return viewer?.base === 'admin' ? ['*'] : viewer?.capabilities || []; },
  trackJob: (job) => {
    startJob({ ...job, status: 'running', startedAt: now() });
    return { finish: (patch = {}) => { wasCancelled(job.id); finishJob(job.id, patch); }, fail: (error) => { wasCancelled(job.id); failJob(job.id, error); }, cancelled: () => cancelledJobs.has(job.id) };
  },
  capabilities: () => ({ aiProvider: loadData().settings.aiProvider || 'auto', textModel: loadData().settings.aiModel || DEFAULT_CLAUDE_MODEL, imagesConfigured: Boolean(getKey('OPENAI_API_KEY')), imageProvider: 'OpenAI', imageModel: 'gpt-image-2.5-flare', googleConfigured: Boolean(getKey('GOOGLE_DOCS_ACCESS_TOKEN')), googlePublishConfigured: Boolean(googlePublishVia()), googlePublishVia: googlePublishVia() }),
  importSource: async (payload = {}) => {
    if (payload.url) {
      // A connected Google account reads private docs; a doc shared by link reads without one.
      const docs = require('./document-import'); const accessToken = getKey('GOOGLE_DOCS_ACCESS_TOKEN');
      if (accessToken) { try { return await docs.readGoogleDocument({ url: payload.url, accessToken }); } catch (error) { if (!['googleDocsConnection', 'googleDocUrl'].includes(error.field)) throw error; } }
      return docs.readPublicGoogleDocument({ url: payload.url });
    }
    const result = await dialog.showOpenDialog(mainWindow, { title: 'Import a trend or research document', properties: ['openFile'], filters: [{ name: 'Research documents', extensions: ['txt', 'md', 'docx'] }] });
    if (result.canceled || !result.filePaths.length) return null;
    const { readDocumentFile } = require('./document-import');
    return readDocumentFile({ filePath: result.filePaths[0] });
  },
});

// ── Access ────────────────────────────────────────────────────────────────────────────────────────
// Who is calling and what they may do (src/main/access.js, policy in src/shared/roles.json). On the Mac the one person is
// an admin, and View as lives in this process; on the web each browser request carries its identity and session.
const access = createAccess({ teamStore, roles, workspace: contentWorkspace, web: WEB_RUNTIME, currentCall: WEB_RUNTIME ? require('./web-runtime').currentCall : () => null });
const OWNER_IDENTITY = Object.freeze({ id: 'owner', name: 'Studio admin', email: '', role: 'admin', channelId: null, via: 'password', disabled: false, memberSince: null });
// The browser studio's sign-in, for studio-server.js: the admin password, a trusted SSO email or a personal sign-in link
// becomes an identity, and each live-update stream is written as that person's projection of the state.
if (WEB_RUNTIME) require('./web-runtime').provide('people', {
  ownerIdentity: () => OWNER_IDENTITY,
  fromProxyEmail: (email) => { const identity = teamStore.fromProxyEmail(email); if (identity?.role) teamStore.touch(identity.id); return identity; },
  // A replaced or turned-off link, or a removed member, ends every session that used it.
  fromLinkSession: (entry) => { const member = teamStore.memberById(entry?.memberId); if (!member?.link || member.link.id !== entry.linkId) return null; teamStore.touch(member.id); return teamStore.identityFor(member, 'link'); },
  linkLogin: (token) => { const found = teamStore.memberByLinkToken(token); return found ? { memberId: found.member.id, linkId: found.linkId } : null; },
  view: (base, identity, session) => JSON.stringify(access.project(base, access.viewerFor(identity, session))),
  // Uploads follow the role policy (a custom role without imports can't pick a file), and each rendering of the state is
  // keyed on the whole viewer, so a preview of one person or a custom role never shares another view's copy.
  canUpload: (identity, session) => access.canUpload(identity, session),
  viewKey: (identity, session) => access.viewKeyFor(identity, session),
  logEvent: (event) => teamStore.logEvent(event),
});
// The gate. Every handler below is registered through handle(), so every IPC/RPC call is checked against the caller's
// role before it runs (deny by default), a channel owner's payload is rebuilt from an allowlist, and what they get back
// is projected. It stays synchronous and never touches `event`: synchronous handlers (app-meta, state, save-key…) still
// return plain values, and the tests' harnesses call handlers with no event at all.
const METHOD_FOR = Object.fromEntries(Object.entries(API_METHODS).map(([method, entry]) => [typeof entry === 'string' ? entry : entry.channel, method]));
function gated(channel, fn) {
  const method = METHOD_FOR[channel] || channel;
  return (event, payload) => {
    const viewer = access.currentViewer();
    const scoped = access.check(method, payload, viewer);
    let out;
    try { out = fn(event, scoped); } catch (error) { throw access.rewriteError(error, viewer); }
    return out && typeof out.then === 'function'
      ? out.then((result) => access.after(method, result, viewer, scoped), (error) => { throw access.rewriteError(error, viewer); })
      : access.after(method, out, viewer, scoped);
  };
}
const handle = (channel, fn) => ipcMain.handle(channel, gated(channel, fn));

const studioMethods = ['contentCatalog', 'selectContentWorkspace', 'saveContentWorkspace', 'saveResearchProgram', 'startResearchRun', 'approveResearchThemes', 'decideResearchTheme', 'continueResearchRun', 'createContentRun', 'cancelStudioRun', 'retryStudioRun', 'readStudioRun', 'exportStudioRun', 'readStudioAsset', 'openStudioAsset', 'importStudioSource', 'publishStudioRun', 'saveWorkspaceTaxonomy', 'saveReferenceDoc', 'readReferenceDoc', 'deleteReferenceDoc', 'importProductRegistry', 'estimateResearchProgram', 'setThemeStatus', 'planAssetKit', 'createAssetKit', 'readBrandImage', 'setBrandImageRole', 'removeBrandImage', 'editStudioAsset', 'restoreStudioAsset', 'estimateQuickScan', 'startQuickScan', 'readTrendHistory', 'readTrendPosts', 'listPrompts', 'readPrompt', 'previewPrompt', 'diffPromptVersions', 'estimatePromptTest', 'savePromptVersion', 'revertPrompt', 'testPrompt', 'setPromptLock', 'setAssetStatus'];
// Work that spends checks first that Claude can use every model it will need.
const researchModels = (ai) => Object.values({ ...DEFAULT_RESEARCH_AI.models, ...(ai?.models || {}) });
const contentModel = () => [loadData().settings.aiModel || DEFAULT_CLAUDE_MODEL];
function runModels(runId) {
  let run = null; try { run = contentWorkspace.readStudioRun({ runId }); } catch (_) { return []; }
  return run?.type === 'research' ? researchModels(run.ai) : run?.ai?.model ? [run.ai.model] : contentModel();
}
const STUDIO_PREFLIGHT = {
  startResearchRun: (payload) => researchModels(contentWorkspace.publicState().programs.find((program) => program.id === payload?.programId)?.ai),
  continueResearchRun: (payload) => runModels(payload?.runId),
  retryStudioRun: (payload) => runModels(payload?.runId),
  createContentRun: contentModel,
  createAssetKit: () => [contentWorkspace.assetKitAi().model],
  // A quick scan may override the program's models; check the ones the scan will actually use.
  startQuickScan: (payload) => researchModels(contentWorkspace.quickScanAi?.(payload) || contentWorkspace.publicState().programs.find((program) => program.id === payload?.programId)?.ai),
  // A prompt test run uses its stage's model (none for picture prompts; Codex skips the check).
  testPrompt: (payload) => contentWorkspace.promptTestModels(payload),
};
for (const method of studioMethods) handle(`studio:${method}`, async (_, payload) => {
  // A program already searching is caught before the model check, which can cost a few cents on the Claude app.
  if (method === 'startResearchRun') contentWorkspace.checkResearchIdle(payload || {});
  // A picture prompt's test run needs no Claude or Codex route (it lists no models); prompt-lab checks the image key.
  if (STUDIO_PREFLIGHT[method]) { const models = STUDIO_PREFLIGHT[method](payload); if (method !== 'testPrompt' || models.length) await aiRoutes.preflight(models); }
  // The browser studio's run export is a temporary copy, zipped for the download and then removed (offerBrowserFolder).
  if (method === 'exportStudioRun' && WEB_RUNTIME) return offerBrowserFolder(contentWorkspace.exportStudioRun(payload, { temporary: true }));
  const result = await contentWorkspace[method](payload);
  if (method === 'exportStudioRun') return forBrowser(result, result?.path);
  return method === 'openStudioAsset' ? forBrowser(result) : result; // the file itself downloads through the shell
});

// Browser studio: the folder of the browser request being answered, where a file to download is written (studio-server
// sweeps it after ten minutes); '' on the Mac, or for work no request is waiting on (a Workflows step).
function browserDownloadFolder() { return WEB_RUNTIME ? require('./web-runtime').currentCall()?.saveDir || '' : ''; }

// Browser studio: an export folder downloads as one .zip (built into this call's own download folder, which
// studio-server sweeps after ten minutes), and the folder itself is removed straight away, so a download leaves nothing
// on the server. `folder` defaults to the result's path; an export lives in its own exports/<id>/ folder, removed whole.
function offerBrowserFolder(result, folder = result?.path) {
  try { return forBrowser(result, folder); }
  finally {
    const exportsRoot = [dataPath('content-studio', 'exports'), dataPath('exports')].find((root) => folder && isPathInside(root, folder) && path.resolve(folder) !== path.resolve(root));
    if (exportsRoot) fs.rmSync(path.join(exportsRoot, path.relative(exportsRoot, folder).split(path.sep)[0]), { recursive: true, force: true });
  }
}

// Brand reference images (Settings): one picture per pick, read here and kept in the studio's data folder. In the
// browser studio the picked file arrives as an upload first.
handle('studio:addBrandImage', async (_, payload = {}) => {
  const result = await dialog.showOpenDialog(mainWindow, { title: payload?.role === 'logo' ? 'Add the approved logo' : 'Add a style example', buttonLabel: 'Add', properties: ['openFile'], filters: [{ name: 'Pictures', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
  if (result.canceled || !result.filePaths.length) return { cancelled: true };
  const filePath = result.filePaths[0];
  if (fs.statSync(filePath).size > require('../shared/brand-images').MAX_BRAND_IMAGE_BYTES) throw new Error('Choose a picture under 10 MB.');
  return contentWorkspace.addBrandImage({ workspaceId: payload?.workspaceId, family: payload?.family, role: payload?.role, name: path.basename(filePath), data: fs.readFileSync(filePath) });
});

// A channel asset kit's folder: the browser downloads it as a .zip; the Mac app copies it into Downloads and shows it.
// A channel owner's folder holds only their own channel, taken from who they are, never from the request.
handle('studio:saveAssetKitFolder', async (_, payload = {}) => {
  const viewer = access.currentViewer(); const channels = viewer.role === 'channel' ? [viewer.channelId] : undefined;
  if (WEB_RUNTIME) return offerBrowserFolder(contentWorkspace.exportAssetKit({ runId: payload?.runId }, { channels, temporary: true }));
  const result = contentWorkspace.exportAssetKit({ runId: payload?.runId }, { into: app.getPath('downloads'), channels });
  shell.showItemInFolder(result.path);
  return { folderName: result.folderName, assetCount: result.assetCount, path: result.path, savedTo: 'downloads' };
});

// Sheets: research runs and imported spreadsheets, laid out like the Google Sheets the team reviews.
const workbookStore = require('./workbooks').createWorkbookStore({
  root: dataPath('workbooks'), contentWorkspace, activeWorkspaceId: () => contentWorkspace.activeWorkspaceId(),
  // Who reads and saves: edits merge per cell, and a conflict names who changed the cell (workbooks.js saveEdits).
  caller: () => { const identity = access.identityForCall(); return identity ? { id: identity.id, name: identity.name || '' } : null; },
  readGoogleTabs: ({ spreadsheetUrl, tabs }) => callSheetsWebhook({ ...buildSheetReadRequest({ ...sheetSettings(), workingSpreadsheetUrl: spreadsheetUrl, workingSpreadsheetId: '' }, { tabs }), allTabs: true }),
});
handle('workbooks:list', () => workbookStore.list());
handle('workbooks:read', (_, payload) => workbookStore.read(payload));
handle('workbooks:import', async (_, payload = {}) => {
  const result = await dialog.showOpenDialog(mainWindow, { title: 'Import a spreadsheet', buttonLabel: 'Import', properties: ['openFile'], filters: [{ name: 'Spreadsheets', extensions: ['xlsx', 'csv', 'tsv'] }] });
  if (result.canceled || !result.filePaths.length) return null;
  return workbookStore.importFile({ filePath: result.filePaths[0], workbookId: payload.workbookId });
});
handle('workbooks:pull-google', (_, payload) => workbookStore.pullGoogleSheet(payload));
handle('workbooks:save-edits', (_, payload) => workbookStore.saveEdits(payload));
handle('workbooks:remove', (_, payload) => workbookStore.remove(payload));
handle('workbooks:rename', (_, payload) => workbookStore.rename(payload));
// Exports carry the renderer's tabs with edits applied: an .xlsx through the save dialog, or a new Google Sheet.
handle('workbooks:export-xlsx', async (_, payload) => {
  const file = require('./workbooks').buildWorkbookXlsx(payload);
  const choice = await dialog.showSaveDialog(mainWindow, { title: 'Download workbook', buttonLabel: 'Save', defaultPath: path.join(app.getPath('downloads'), file.fileName), filters: [{ name: 'Excel workbook', extensions: ['xlsx'] }] });
  if (choice.canceled || !choice.filePath) return null;
  const target = /\.xlsx$/i.test(choice.filePath) ? choice.filePath : `${choice.filePath}.xlsx`;
  fs.writeFileSync(target, file.buffer);
  return forBrowser({ path: target, fileName: path.basename(target), bytes: file.buffer.length, sheetCount: file.sheetCount, rowCount: file.rowCount, truncatedCells: file.truncatedCells });
});
handle('workbooks:export-google', (_, payload) => exportWorkbookToGoogleSheets(payload));

const researchWorkspace = createResearchWorkspace({ loadData, saveData, emitState, dataPath, readJson, writeJson, readDatasetPayload, toId, dialog, getWindow: () => mainWindow, shell: WEB_RUNTIME ? { ...shell, showItemInFolder: () => {} } : shell });
for (const [channel, method] of Object.entries({
  'save-brand-profile': 'saveBrandProfile', 'select-brand-profile': 'selectBrandProfile', 'delete-brand-profile': 'deleteBrandProfile',
  'pick-import-file': 'pickImportFile', 'preview-import-dataset': 'previewImportDataset', 'import-dataset': 'importDataset',
  'compare-datasets': 'compareDatasets', 'save-monitor': 'saveMonitor', 'read-research-review': 'readResearchReview',
  'save-research-review': 'saveResearchReview', 'export-research-review': 'exportResearchReview',
})) handle(channel, async (_, payload) => { const result = await researchWorkspace[method](payload); return method !== 'exportResearchReview' ? result : WEB_RUNTIME ? offerBrowserFolder(result, result?.folder) : forBrowser(result, result?.folder); });

handle('app-meta', () => ({
  name: APP_NAME,
  version: packageConfig.version,
  runtime: WEB_RUNTIME ? 'web' : 'desktop',
  dataRoot: WEB_RUNTIME ? '' : dataRoot(), // a server path means nothing to someone in a browser
}));

// Each person's own view of the state: everything for admins and editors, their channel for a channel owner, nothing for
// someone without a role (src/main/roles.js projectState).
handle('state', () => access.project(publicState(), access.currentViewer()));
handle('list-missions', () => publicV5State().missions);
handle('save-mission', (_, payload) => saveMission(payload));
handle('run-mission', (_, missionId) => runMission(missionId));
handle('run-action-graph', (_, payload) => runActionGraph(payload));
handle('pause-mission', (_, missionId) => pauseMission(missionId));
handle('schedule-mission', (_, payload) => scheduleMission(payload));
handle('discover-apify-resource', (_, payload) => discoverApifyResource(payload));
handle('test-recipe', (_, payload) => onceForRequest('testRecipe', payload, () => testRecipe(payload)));
handle('save-recipe-version', (_, payload) => saveRecipeVersion(payload));
handle('get-job', (_, jobId) => getJob(jobId));
handle('retry-job', (_, jobId) => retryJob(jobId));
handle('read-job-log', (_, jobId) => readJobLog(jobId));
handle('search-evidence', (_, payload) => searchEvidenceRecords(payload));
handle('read-evidence', (_, evidenceId) => readEvidenceRecord(evidenceId));
handle('export-mission-bundle', (_, missionId) => exportMissionBundle(missionId));
handle('export-asset-pack', (_, payload) => exportAssetPack(payload));
handle('refresh-apify-actors', () => refreshApifyActors());
handle('search-sources', (_, payload) => onceForRequest('searchSources', payload, () => { const { requestId: _requestId, ...request } = payload || {}; return searchSources(request); }));
handle('preview-search-sources', (_, payload) => {
  try { return { valid: true, plan: buildSearchRecipes(payload) }; }
  catch (error) { return { valid: false, error: { field: error.field || 'request', message: safeServiceError(error) } }; }
});
handle('ask-findings', (_, payload) => askFindings(payload));
handle('check-ai', (_, payload) => checkAi(payload));

// ── Ask AI ────────────────────────────────────────────────────────────────────────────────────────
// Ask AI (src/main/help-assistant.js) answers from docs/app-guide.md plus a picture of this person's own studio:
// settings, programs, runs, quick scans, trends, reports and asset folders by title and status, and the trend memory
// across runs. It reads a report, folder, run, trend, matching posts, an earlier conversation or older memories only
// when a question needs it. No keys or tokens are ever included. Each person's conversations and memory live in
// askStore and travel only through the help:* methods, never in the broadcast state.
const helpAssistant = require('./help-assistant');
const promptTemplate = require('../shared/prompt-template'); // prompt-change cards: the checks and line diffs a save uses
const { askHistory, MAX_ACTIVE_MEMORY, tokens: askTokens, bm25: askBm25 } = require('./ask-store');
const HELP_IMAGE_SIZES = require('./help-images').HELP_IMAGE_SIZES;
let appGuideText = null;
function appGuide() {
  if (appGuideText === null) {
    const found = [path.join(__dirname, 'app-guide.md'), path.join(__dirname, '..', '..', 'docs', 'app-guide.md')].find((file) => fs.existsSync(file));
    appGuideText = found ? fs.readFileSync(found, 'utf8') : '';
  }
  return appGuideText;
}
const helpMoney = (value) => (Number.isFinite(Number(value)) ? Math.round(Number(value) * 100) / 100 : null);
const helpThemes = (run) => (run.discoveredThemes?.length ? run.discoveredThemes : run.themes || []);
const isQuickScan = (run) => run?.origin === 'quick-scan';
// Trend history and post search come from content-workspace when this build has them; a failure reads as "nothing".
const helpSafe = (read, fallback = null) => { try { return read() ?? fallback; } catch (_) { return fallback; } };
const helpNorm = (value) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const helpSources = (program) => Object.fromEntries(['x', 'linkedin', 'reddit'].map((platform) => [platform, (program.sourceGroups || []).filter((group) => group.enabled && group.platform.startsWith(platform)).reduce((sum, group) => sum + (group.targets || []).length, 0)]));
const helpWindow = (program) => (program.window?.startDate ? `${program.window.startDate} to ${program.window.endDate || 'now'}` : `last ${program.lookbackDays || 7} days`);
const helpSchedule = (program) => (program.schedule?.frequency && program.schedule.frequency !== 'manual' ? `${program.schedule.frequency}${program.schedule.enabled ? '' : ' (paused)'}` : 'run on demand');
// Exact title first; then the closest title that contains the ref or sits inside it. Refs under 4 characters match
// exactly only, so "AI" never lands on the wrong report. Rows come newest first, so ties go to the newest.
function helpPick(rows, title, ref) {
  const wanted = helpNorm(ref); if (!wanted) return null;
  const exact = rows.find((row) => helpNorm(title(row)) === wanted); if (exact) return exact;
  if (wanted.length < 4) return null;
  let best = null; let gap = Infinity;
  for (const row of rows) {
    const name = helpNorm(title(row));
    if (name.length < 4 || !(name.includes(wanted) || wanted.includes(name))) continue;
    const diff = Math.abs(name.length - wanted.length); if (diff < gap) { best = row; gap = diff; }
  }
  return best;
}
// What Ask AI may do with the Prompt Library for this person, read at the question's entry like role: view = may read
// prompts (listPrompts and readPrompt), edit = may save them (savePromptVersion; never in a preview, which only reads),
// admin = a lock doesn't stop them. help-assistant.js promptRights reads it; no workspace means no prompt features.
function helpPromptAccess(viewer) {
  const admin = (viewer?.base ?? viewer?.role) === 'admin';
  const may = (method) => admin || (Array.isArray(viewer?.allowed) && viewer.allowed.includes(method));
  const listed = typeof contentWorkspace.listPrompts === 'function' ? helpSafe(() => contentWorkspace.listPrompts()) : null;
  const view = Boolean(listed) && may('listPrompts') && may('readPrompt');
  return { view, edit: view && !viewer?.preview && may('savePromptVersion'), admin: admin && !viewer?.preview, editionId: listed?.editionId === 'semrush' ? 'semrush' : 'general' };
}
// The Prompt Library in LIVE CONTEXT: one short row per prompt (36 today), so Ask AI can name one and look it up.
const helpPromptRows = () => helpSafe(() => contentWorkspace.listPrompts().prompts.slice(0, 40).map((row) => ({ id: row.id, name: row.name, version: row.version, custom: Boolean(row.custom), locked: Boolean(row.locked), ...(row.editable ? {} : { fixed: true }) })), []);
// helpPick's rules, but every row that ties: all exact matches, else every containing title at the closest length. Two
// or more is an ambiguity the person settles (helpResolveActions), never a guess.
function helpMatches(rows, title, ref) {
  const wanted = helpNorm(ref); if (!wanted) return [];
  const exact = rows.filter((row) => helpNorm(title(row)) === wanted); if (exact.length) return exact;
  if (wanted.length < 4) return [];
  let best = []; let gap = Infinity;
  for (const row of rows) {
    const name = helpNorm(title(row));
    if (name.length < 4 || !(name.includes(wanted) || wanted.includes(name))) continue;
    const diff = Math.abs(name.length - wanted.length);
    if (diff < gap) { best = [row]; gap = diff; } else if (diff === gap) best.push(row);
  }
  return best;
}
const HELP_DAY_MS = 86400000;
const helpDay = (value) => String(value || '').slice(0, 10);
const helpAgo = (value) => { const ms = Date.parse(value || ''); return Number.isFinite(ms) ? (Date.now() - ms) / HELP_DAY_MS : Infinity; };
const helpPlural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
const HELP_ASSET_STATUSES = ['draft', 'in-review', 'approved', 'scheduled', 'published'];
const helpAssetStatus = (asset) => (HELP_ASSET_STATUSES.includes(asset?.reviewStatus) ? asset.reviewStatus : 'draft');
// A research run as people name it: "<program> · <date>", so two runs that found the same trend can be told apart.
function helpRunLabel(run, programs = []) {
  const program = programs.find((row) => row.id === run?.programId);
  return `${program?.name || run?.title || 'Research run'} · ${helpDay(run?.createdAt)}`;
}
// What was decided about a trend in earlier runs, from its history: "approved once (last 2026-10-01), skipped 2× (last
// 2026-10-08), report 2026-10-02". "" when nothing was.
function helpDecisionHistory(record, exceptRunId = '') {
  const rows = (record?.appearances || []).filter((row) => row && row.runId !== exceptRunId && ['approved', 'passed'].includes(row.decision));
  const part = (decision, word) => { const hits = rows.filter((row) => row.decision === decision); if (!hits.length) return ''; const last = hits.map((row) => helpDay(row.runDate)).filter(Boolean).sort().pop(); return `${word} ${hits.length === 1 ? 'once' : `${hits.length}×`}${last ? ` (last ${last})` : ''}`; };
  const report = (record?.reports || []).map((row) => helpDay(row.createdAt)).filter(Boolean).sort().pop();
  return [part('approved', 'approved'), part('passed', 'skipped'), report ? `report ${report}` : ''].filter(Boolean).join(', ');
}
const helpChannels = () => helpSafe(() => roles.channelsFor(contentWorkspace.activeEditionId()), []);
// Trends whose report is ready, newest first, with each channel's answer (channel-view.js readyTrends, the rule channel
// owners and analytics use).
function helpReadyTrends() {
  const rows = helpSafe(() => require('./channel-view').readyTrends(contentWorkspace.trendSource()), []);
  return [...rows].sort((a, b) => String(b.readyAt || '').localeCompare(String(a.readyAt || '')));
}
const helpAdoptions = () => helpSafe(() => teamStore.adoptionsFor(contentWorkspace.activeWorkspaceId()), []);
// The team as an admin's Ask AI sees it (names, roles, channels; never emails or links), for invite and View as.
function helpTeam() {
  const policy = helpSafe(() => teamStore.accessPolicy()); if (!policy) return null;
  const channels = helpChannels();
  return {
    roles: [...policy.roles.values()].slice(0, 20).map((def) => ({ id: def.id, name: def.label, base: def.base })),
    people: helpSafe(() => teamStore.listMembers(), []).filter((member) => !member.disabled).slice(0, 50).map((member) => ({ name: member.name, role: policy.roles.get(member.role)?.label || member.role, ...(member.channelId ? { channel: channels.find((row) => row.id === member.channelId)?.name || member.channelId } : {}) })),
  };
}
// The roles a role param may name ([{ id, label }]), for help-assistant.js cleanParams.
const helpRoleOptions = () => { const policy = helpSafe(() => teamStore.accessPolicy()); return policy ? [...policy.roles.values()].map((def) => ({ id: def.id, label: def.label })) : []; };

// What needs this person now, most urgent first, by plain rules (no AI): up to 6 { what, why, kind, target }, where
// kind and target are the button that would help. `scope` ({ admin, promptEdit }) adds the admin-only and prompt items.
function helpAttention(studio, scope = {}, ready = helpReadyTrends(), adoptions = helpAdoptions()) {
  const out = []; const add = (what, why, kind, target = '') => out.push({ what: String(what).slice(0, 160), why: String(why || '').slice(0, 200), kind, target: String(target || '').slice(0, 160) });
  const researchRuns = studio.researchRuns || []; const contentRuns = studio.contentRuns || []; const assets = studio.assets || [];
  const kitRuns = contentRuns.filter((run) => run.kit); const kitIds = new Set(kitRuns.map((run) => run.id));
  const channels = helpChannels(); const channelName = (id) => channels.find((row) => row.id === id)?.name || id;
  for (const run of [...researchRuns, ...contentRuns.filter((row) => !row.kit)].filter((row) => ['failed', 'partial'].includes(row.status) && helpAgo(row.updatedAt || row.createdAt) <= 7).slice(0, 2)) add(`“${run.title}” didn’t finish`, String(run.message || '').slice(0, 160) || 'It stopped before the end. Finished work is kept.', 'retry-run', run.title);
  const reviewing = researchRuns.filter((run) => run.status === 'awaiting-review' && !isQuickScan(run));
  const waiting = reviewing.flatMap((run) => helpThemes(run).filter((theme) => !run.decisions?.[theme.id]).map(() => run));
  if (waiting.length) { const oldest = Math.max(...waiting.map((run) => helpAgo(run.createdAt)).filter(Number.isFinite), 0); add(`${helpPlural(waiting.length, 'trend')} ${waiting.length === 1 ? 'needs' : 'need'} your OK`, oldest >= 1 ? `The oldest has waited ${helpPlural(Math.floor(oldest), 'day')}.` : 'Found today.', 'open-tab', 'trends'); }
  const approved = reviewing.flatMap((run) => helpThemes(run).filter((theme) => run.decisions?.[theme.id] === 'approved'));
  if (approved.length) add(`${helpPlural(approved.length, 'approved trend')} ${approved.length === 1 ? 'has' : 'have'} no report yet`, 'Write reports to get each trend’s report and toolkit.', 'write-reports');
  const seenKeys = new Set();
  for (const run of kitRuns) {
    if (seenKeys.has(run.kit.sourceKey)) continue; seenKeys.add(run.kit.sourceKey);
    const left = (run.jobs || []).filter((job) => job.status !== 'succeeded').length;
    if (['partial', 'failed'].includes(run.status) && left) add(`${helpPlural(left, 'asset')} in “${run.kit.sourceTitle}” need another try`, String(run.message || '').slice(0, 160), 'finish-assets', run.kit.sourceTitle);
  }
  for (const asset of assets.filter((row) => row.kind === 'text' && !kitIds.has(row.runId) && helpAssetStatus(row) === 'in-review' && helpAgo(row.review?.at) > 3).slice(0, 2)) add(`“${asset.title}” has been in review for ${helpPlural(Math.floor(helpAgo(asset.review.at)), 'day')}`, asset.review?.by?.name ? `${asset.review.by.name} moved it there.` : '', 'set-status', asset.title);
  const unlinked = assets.filter((row) => kitIds.has(row.runId) && helpAssetStatus(row) === 'published' && !row.review?.link);
  if (unlinked.length) add(`${helpPlural(unlinked.length, 'published file')} ${unlinked.length === 1 ? 'has' : 'have'} no live link`, 'Add the link so the team can find where it went out.', 'set-status', unlinked[0].title);
  for (const row of adoptions.filter((entry) => entry.status === 'using' && entry.plannedFor && helpAgo(entry.plannedFor) <= 0.99 && helpAgo(entry.plannedFor) >= -7).slice(0, 2)) add(`${channelName(row.channelId)} plans to use “${row.trendName || 'a trend'}” on ${row.plannedFor}`, 'Due this week.', 'open', row.trendName);
  if (scope.admin) {
    const fresh = ready.filter((trend) => helpAgo(trend.readyAt) <= 14);
    const silent = fresh.filter((trend) => !adoptions.some((row) => row.themeId === trend.themeId));
    if (silent.length) add(`No channel has answered on ${helpPlural(silent.length, 'ready trend')}`, `Newest: “${silent[0].name}”.`, 'open', silent[0].name);
  }
  const scan = researchRuns.find((run) => isQuickScan(run) && run.status === 'succeeded' && helpAgo(run.updatedAt || run.createdAt) <= 1);
  if (scan) add(`Quick scan “${scan.quickScan?.topic || scan.title}” finished`, `${helpPlural(helpThemes(scan).length, 'theme')} found.`, 'open', scan.title);
  if (scope.admin) {
    if (!getKey('APIFY_API_TOKEN')) add('No Apify token is saved', 'Research can’t collect posts until one is added in Settings.', 'open-tab', 'settings');
    for (const program of (studio.programs || []).filter((row) => row.schedule?.frequency && row.schedule.frequency !== 'manual' && !row.schedule.enabled).slice(0, 1)) add(`“${program.name}” has a paused schedule`, String(program.schedule.lastError || 'It won’t run until someone resumes it.').slice(0, 200), 'open', program.name);
  }
  if (scope.promptEdit) { const changed = helpSafe(() => contentWorkspace.listPrompts().prompts.filter((row) => row.defaultChanged), []); if (changed.length) add(`The studio’s own text changed for ${helpPlural(changed.length, 'prompt')} you customized`, `First: “${changed[0].name}”.`, 'open', changed[0].name); }
  return out.slice(0, 6);
}

// `role` is the asker's effective role; `layout` comes from the page they asked from (Simple unless it says classic).
// `promptAccess` (helpPromptAccess) adds the prompt list for people who can read prompts. `scope` ({ admin }) adds the
// team for admins and the admin-only attention items.
function helpContext(page, role = 'admin', promptAccess = null, scope = {}) {
  const data = loadData(); const studio = contentWorkspace.publicState();
  const workspace = (studio.workspaces || []).find((row) => row.id === studio.activeWorkspaceId) || {};
  const researchRuns = studio.researchRuns || []; const contentRuns = studio.contentRuns || []; const programs = studio.programs || [];
  const fullRuns = researchRuns.filter((run) => !isQuickScan(run));
  const kitRuns = contentRuns.filter((run) => run.kit); const kitIds = new Set(kitRuns.map((run) => run.id));
  const reviewing = researchRuns.filter((run) => run.status === 'awaiting-review');
  const done = (run) => (run.jobs || []).filter((job) => job.status === 'succeeded').length;
  const folders = new Map(); for (const run of kitRuns) { const key = run.kit.sourceKey; if (!folders.has(key)) folders.set(key, []); folders.get(key).push(run); }
  const view = page && typeof page === 'object' ? page : {};
  const kitAi = contentWorkspace.assetKitAi();
  const trendMemory = helpSafe(() => contentWorkspace.trendMemory?.());
  let history; const trendHistory = () => (history === undefined ? (history = helpTrendHistory()) : history);
  const past = (run, theme) => helpSafe(() => helpDecisionHistory(helpTrendRecord({ name: theme.name, themeId: theme.id }, trendHistory(), { strict: true }), run.id), '');
  const channels = helpChannels(); const channelName = (id) => channels.find((row) => row.id === id)?.name || id;
  const ready = helpReadyTrends(); const adoptions = helpAdoptions();
  const fileStatuses = (run) => { const counts = {}; for (const asset of (studio.assets || []).filter((row) => row.runId === run.id && row.kind === 'text')) { const status = helpAssetStatus(asset); counts[status] = (counts[status] || 0) + 1; } return counts; };
  return {
    appVersion: app.getVersion(),
    edition: WEB_RUNTIME ? 'browser studio (shared, on a server)' : 'Mac app',
    role: role === 'editor' ? 'editor' : 'admin',
    layout: view.layout === 'classic' ? 'classic' : 'simple',
    currentPage: view.id ? { id: String(view.id).slice(0, 40), name: String(view.label || '').slice(0, 80), ...(view.tab ? { tab: String(view.tab).slice(0, 20) } : {}), ...(view.report ? { openReport: String(view.report).slice(0, 160) } : {}), ...(view.folder ? { openFolder: String(view.folder).slice(0, 160) } : {}), ...(view.trend ? { openTrend: String(view.trend).slice(0, 160) } : {}), ...(view.prompt ? { openPrompt: String(view.prompt).slice(0, 120) } : {}) } : null,
    workspace: { name: workspace.name || '', edition: workspace.editionId || '', approvedProducts: (workspace.products || []).length, taxonomyCategories: workspace.taxonomy?.categories?.length || 0, referenceDocuments: (workspace.referenceDocs || []).map((doc) => doc.title).slice(0, 20) },
    connections: { apifyToken: Boolean(getKey('APIFY_API_TOKEN')), anthropicApiKey: Boolean(getKey('ANTHROPIC_API_KEY')), googleSheetsBridge: Boolean(getKey('GOOGLE_SHEETS_WEBHOOK_URL')), googleDocsToken: Boolean(getKey('GOOGLE_DOCS_ACCESS_TOKEN')), googleDrivePublishing: Boolean(studio.capabilities?.googlePublishConfigured), imageKey: Boolean(getKey('OPENAI_API_KEY')) },
    claude: { setting: data.settings.aiProvider || 'auto', defaultModel: data.settings.aiModel || DEFAULT_CLAUDE_MODEL, perRequestBudgetUsd: data.settings.aiMaxBudgetUsd ?? 1 },
    // What is waiting on this person, most urgent first (helpAttention).
    attention: helpSafe(() => helpAttention(studio, { admin: Boolean(scope.admin), promptEdit: Boolean(promptAccess?.edit) }, ready, adoptions), []),
    // This workspace's channels, for routing a trend or making assets for some of them.
    channels: channels.slice(0, 12).map(({ id, name }) => ({ id, name })),
    programs: programs.slice(0, 10).map((program) => { const last = fullRuns.find((run) => run.programId === program.id); return { name: program.name, sources: helpSources(program), window: helpWindow(program), targetPerPlatform: program.targetPerPlatform, budgetsUsd: program.budgets, stageModels: program.ai?.models, approveThemesAutomatically: Boolean(program.autoApproveThemes), schedule: helpSchedule(program), ...(program.schedule?.enabled && program.schedule.nextRunAt ? { nextRun: program.schedule.nextRunAt } : {}), ...(last ? { lastRun: { started: helpDay(last.createdAt), status: last.status, aiCostUsd: helpMoney(last.ownCostUsd ?? last.costUsd) } } : {}), reddit: { communitiesPerRun: program.collection?.redditSubsPerJob, scrollSeconds: program.collection?.redditScrollTimeoutSecs } }; }),
    recentResearchRuns: fullRuns.slice(0, 4).map((run) => ({ title: run.title, status: run.status, stage: run.stage, message: String(run.message || '').slice(0, 400), started: run.createdAt, aiCostUsd: helpMoney(run.costUsd), aiBudgetUsd: run.maxBudgetUsd, postsKept: run.counts?.platforms || null, themes: helpThemes(run).length, warnings: (run.warnings || []).slice(0, 3).map((line) => String(line).slice(0, 300)) })),
    // Small, hour-level runs started from Ask AI: collect, find themes, stop (no review, tagging or reports).
    quickScans: researchRuns.filter(isQuickScan).slice(0, 5).map((run) => ({ title: run.title, topic: run.quickScan?.topic || '', status: run.status, stage: run.stage, window: run.quickScan?.lookbackHours ? `last ${run.quickScan.lookbackHours} hours` : run.window?.startAt ? `since ${run.window.startAt}` : '', platforms: run.quickScan?.platforms || [], started: run.createdAt, aiCostUsd: helpMoney(run.costUsd), postsKept: run.counts?.platforms || null, themes: helpThemes(run).slice(0, 6).map((theme) => String(theme.name || '').slice(0, 120)), message: String(run.message || '').slice(0, 300) })),
    workingNow: activeWorkSummary(),
    trends: {
      // run tells two runs' trends of the same name apart; history is what was decided about the trend before.
      waiting: reviewing.flatMap((run) => helpThemes(run).filter((theme) => !run.decisions?.[theme.id]).map((theme) => ({ run, theme }))).slice(0, 20).map(({ run, theme }) => { const before = past(run, theme); return { name: String(theme.name || '').slice(0, 120), why: String(theme.description || theme.summary || '').slice(0, 200), run: helpRunLabel(run, programs), ...(before ? { history: before } : {}) }; }),
      // Decided while the run still waits for review, so Undo still works.
      decided: reviewing.flatMap((run) => helpThemes(run).filter((theme) => ['approved', 'passed'].includes(run.decisions?.[theme.id])).map((theme) => ({ name: String(theme.name || '').slice(0, 120), decision: run.decisions[theme.id] === 'approved' ? 'yes' : 'skipped', by: run.decisionsBy?.[theme.id]?.name || '', run: helpRunLabel(run, programs) }))).slice(0, 20),
      approvedAwaitingReports: reviewing.flatMap((run) => helpThemes(run).filter((theme) => run.decisions?.[theme.id] === 'approved').map((theme) => String(theme.name || '').slice(0, 120))).slice(0, 20),
      reportsBeingWritten: contentRuns.filter((run) => !run.kit && ['queued', 'running'].includes(run.status)).map((run) => String(run.title || '').slice(0, 120)).slice(0, 10),
      // Reports ready, with which channels said they use it (and when they plan to) or not.
      ready: ready.slice(0, 15).map((trend) => { const answers = adoptions.filter((row) => row.themeId === trend.themeId); return { name: String(trend.name || '').slice(0, 120), report: String((trend.reportAssets || []).find((asset) => asset.id === trend.primaryReportId)?.title || trend.reportAssets?.[0]?.title || '').slice(0, 160), using: answers.filter((row) => row.status === 'using').map((row) => channelName(row.channelId)), notUsing: answers.filter((row) => row.status === 'not-using').map((row) => channelName(row.channelId)), planned: answers.filter((row) => row.status === 'using' && row.plannedFor).map((row) => `${channelName(row.channelId)} ${row.plannedFor}`) }; }),
    },
    // What is new, rising, steady or fading across every run (src/shared/trend-history.js trendMemoryDigest).
    trendMemory: typeof trendMemory === 'string' ? trendMemory.slice(0, 3500) : trendMemory,
    reports: (studio.assets || []).filter((asset) => asset.kind !== 'image' && !kitIds.has(asset.runId)).slice(0, 50).map((asset) => ({ title: String(asset.title || '').slice(0, 160), type: asset.deliverableId || asset.channel || '', date: String(asset.createdAt || '').slice(0, 10), status: helpAssetStatus(asset), ...(asset.edited?.at ? { edited: `${helpDay(asset.edited.at)}${asset.edited.by?.name ? ` by ${asset.edited.by.name}` : ''}` } : {}) })),
    assetFolders: [...folders.values()].slice(0, 15).map((runs) => ({ title: runs[0].kit.sourceTitle, from: runs[0].kit.sourceKind, runs: runs.slice(0, 3).map((run, at) => ({ folder: run.kit.folderName, status: run.status, ready: `${done(run)} of ${(run.jobs || []).length}`, costUsd: helpMoney(run.costUsd), started: run.createdAt, ...(at === 0 ? { fileStatus: fileStatuses(run) } : {}), ...(['queued', 'running'].includes(run.status) ? {} : { needsAnotherTry: (run.jobs || []).filter((job) => job.status !== 'succeeded').map((job) => job.label).slice(0, 15) }) })) })),
    channelAssets: { model: kitAi.model, effort: kitAi.effort, writesAtOnce: kitAi.concurrency, pictures: Boolean(getKey('OPENAI_API_KEY')) },
    counts: { scrapers: (data.recipes || []).length, datasets: (data.datasets || []).length, libraryAssets: (studio.assets || []).length, pictures: (studio.assets || []).filter((asset) => asset.kind === 'image').length },
    // The brand visual direction as this workspace saved it in Prompts (pictures.direction), else the default.
    pictures: { available: Boolean(getKey('OPENAI_API_KEY')), visualDirection: require('../shared/content-studio').brandImageDirection(workspace.editionId, { blocks: helpSafe(() => contentWorkspace.promptEffective('pictures.direction').blocks) }), brandReferenceImages: (workspace.brandImageSets || []).map((set) => ({ set: set.label, styleExamples: (set.images || []).filter((image) => image.role === 'style').length, approvedLogo: (set.images || []).some((image) => image.role === 'logo') })) },
    latestTrends: (() => { const run = fullRuns.find((row) => helpThemes(row).length); return run ? helpThemes(run).slice(0, 6).map((theme) => ({ name: String(theme.name || '').slice(0, 120), summary: String(theme.summary || theme.description || '').slice(0, 300) })) : []; })(),
    ...(promptAccess?.view ? { prompts: helpPromptRows() } : {}),
    // Admins only: who is in the studio, for invites and View as.
    ...(scope.admin ? { team: helpTeam() } : {}),
  };
}

// Trend history across runs: content-workspace's readTrendHistory() and readTrendRecord() (src/shared/trend-history.js).
const helpTrendHistory = () => helpSafe(() => contentWorkspace.readTrendHistory?.({}));
// readTrendRecord matches names loosely, which suits a lookup (the result names the trend it found). A card shows its
// trend as fact, so `strict` also requires the theme id or a name match by helpPick's rules.
function helpTrendRecord({ name = '', themeId = '' } = {}, history = helpTrendHistory(), { strict = false } = {}) {
  const wanted = helpNorm(name);
  const fits = (row) => Boolean(row) && ((themeId && (row.themeIds || []).includes(themeId)) || (!strict && !themeId) || Boolean(helpPick([row.name, ...(row.aliases || [])].map((title) => ({ title })), (entry) => entry.title, name)));
  const record = helpSafe(() => contentWorkspace.readTrendRecord?.({ name, trendId: themeId }));
  if (record && typeof record === 'object' && fits(record)) return record;
  return (history?.trends || []).find((row) => (themeId && (row.themeIds || []).includes(themeId)) || (wanted && (helpNorm(row.name) === wanted || (row.aliases || []).some((alias) => helpNorm(alias) === wanted)))) || null;
}
// A share is stored as a fraction; cards and charts show it as a percentage.
const helpShare = (row) => { const share = Number(row?.share); return row?.share != null && Number.isFinite(share) ? Math.round((share <= 1 ? share * 100 : share) * 100) / 100 : null; };
function helpSpark(record) {
  if (Array.isArray(record?.spark)) return record.spark.map(Number).filter(Number.isFinite).slice(-12);
  const rows = (record?.appearances || []).slice(-12); const shares = rows.every((row) => helpShare(row) !== null);
  return rows.map((row) => (shares ? helpShare(row) : Number(row.posts?.total) || 0));
}
// One line on a chart: a trend's (or a taxonomy category's) share of posts in each run it appeared in, oldest first.
function helpSeries(name, history) {
  const wanted = helpNorm(name);
  const category = (history?.categories || []).find((row) => helpNorm(row.name || row.category) === wanted);
  let label; let appearances;
  if (category) {
    label = category.name || category.category;
    const members = (history.trends || []).filter((row) => helpNorm(row.category) === wanted).slice(0, 12).map((row) => (Array.isArray(row.appearances) ? row : helpTrendRecord({ name: row.name, themeId: (row.themeIds || [])[0] }, history, { strict: true }))).filter(Boolean);
    appearances = members.flatMap((row) => row.appearances || []);
  } else {
    const record = helpTrendRecord({ name }, history, { strict: true }); if (!record) return null;
    label = record.name; appearances = record.appearances || [];
  }
  const byRun = new Map();
  for (const row of appearances) {
    const x = String(row.runDate || '').slice(0, 10); if (!x) continue;
    const key = row.runId || x; const entry = byRun.get(key) || { x, share: 0, posts: 0, hasShare: true };
    const share = helpShare(row); if (share === null) entry.hasShare = false; else entry.share += share;
    entry.posts += Number(row.posts?.total) || 0; byRun.set(key, entry);
  }
  const points = [...byRun.values()].sort((a, b) => a.x.localeCompare(b.x)).slice(-12);
  return points.length ? { label: String(label || name).slice(0, 120), points } : null;
}
const helpPostView = (post) => ({ platform: String(post?.platform || ''), author: String(post?.author || post?.authorName || '').slice(0, 120), text: String(post?.text || '').slice(0, 400), url: /^https?:\/\//i.test(String(post?.url || '')) ? String(post.url) : '', publishedAt: String(post?.publishedAt || ''), engagement: Number.isFinite(Number(post?.engagement?.value ?? post?.engagement)) && (post?.engagement?.value ?? post?.engagement) !== null ? Number(post.engagement?.value ?? post.engagement) : null });
// Collected posts that match, most engaged first, from this workspace's recent research runs and quick scans.
function helpPosts(query, limit = 12) {
  const found = helpSafe(() => contentWorkspace.searchRunPosts?.({ query, limit }), []);
  return (Array.isArray(found) ? found : Array.isArray(found?.posts) ? found.posts : []).slice(0, limit).map(helpPostView).filter((post) => post.text);
}
const helpTrendView = (record) => ({ name: record.name, aliases: (record.aliases || []).slice(0, 8), category: record.category || '', zone: record.zone || '', keywords: (record.keywords || []).slice(0, 12), firstSeen: record.firstSeen || '', lastSeen: record.lastSeen || '', runsSeen: record.runsSeen ?? null, runsSinceFirstSeen: record.runsSinceFirstSeen ?? null, momentum: record.momentum || '', momentumBasis: record.momentumBasis || '', latestPriorityTier: record.latestPriorityTier || '', appearances: (record.appearances || []).slice(-12).map((row) => ({ runTitle: row.runTitle || '', runDate: row.runDate || '', origin: row.origin || 'research', decision: row.decision || '', posts: row.posts || null, sharePercent: helpShare(row), priorityTier: row.priorityTier || '' })), reports: (record.reports || []).slice(0, 6).map((row) => ({ title: row.title || '', createdAt: row.createdAt || '' })) });

// ── Ask AI: finding things by name ──
// Every named thing Ask AI can point at, newest first: { kind, id, title, where, date, aliases? } plus the id field a
// button reads (assetId, folderKey, themeId, runId, programId, promptId, page). kind is a studio: link kind (report,
// folder, trend, run, prompt, page) or program. Pages are the Advanced pages (help-assistant.js HELP_PAGES).
function helpItems(studio = contentWorkspace.publicState(), { prompts = false, role = 'admin' } = {}) {
  const researchRuns = studio.researchRuns || []; const contentRuns = studio.contentRuns || []; const assets = studio.assets || [];
  const kitRuns = contentRuns.filter((run) => run.kit); const kitIds = new Set(kitRuns.map((run) => run.id));
  const items = [];
  for (const asset of assets.filter((row) => row.kind === 'text' && !kitIds.has(row.runId))) items.push({ kind: 'report', id: asset.id, title: asset.title || '', where: 'Reports', date: helpDay(asset.createdAt), assetId: asset.id });
  const folders = new Set();
  for (const run of kitRuns) { if (folders.has(run.kit.sourceKey)) continue; folders.add(run.kit.sourceKey); items.push({ kind: 'folder', id: run.kit.sourceKey, title: run.kit.sourceTitle || run.title || '', where: 'Assets', date: helpDay(run.createdAt), folderKey: run.kit.sourceKey }); }
  const trends = new Map();
  for (const run of researchRuns) for (const theme of helpThemes(run)) if (theme?.id && !trends.has(theme.id)) trends.set(theme.id, { kind: 'trend', id: theme.id, title: theme.name || '', aliases: (theme.aliases || []).slice(0, 8), where: isQuickScan(run) ? 'Quick scans' : 'Trends', date: helpDay(run.createdAt), themeId: theme.id, runId: run.id });
  items.push(...trends.values());
  for (const program of studio.programs || []) items.push({ kind: 'program', id: program.id, title: program.name || '', where: 'Research programs', date: helpDay(program.updatedAt || program.createdAt), programId: program.id });
  for (const run of [...researchRuns, ...contentRuns.filter((row) => !row.kit)]) items.push({ kind: 'run', id: run.id, title: run.title || '', where: 'Activity', date: helpDay(run.createdAt), runId: run.id });
  if (prompts) for (const row of helpSafe(() => contentWorkspace.listPrompts().prompts, [])) items.push({ kind: 'prompt', id: row.id, title: row.name || row.id, where: 'Prompts', date: helpDay(row.updatedAt), promptId: row.id });
  for (const [id, name] of Object.entries(helpAssistant.HELP_PAGES)) if (role !== 'editor' || !['settings', 'knowledge'].includes(id)) if (id !== 'prompts' || prompts) items.push({ kind: 'page', id, title: name, where: 'Pages', date: '', page: id });
  return items.filter((item) => item.title);
}
// The files in channel asset folders, as "Folder › File": newest run first.
function helpKitFiles(studio = contentWorkspace.publicState()) {
  const out = [];
  for (const run of (studio.contentRuns || []).filter((row) => row.kit)) {
    for (const asset of (studio.assets || []).filter((row) => row.runId === run.id)) {
      const job = (run.jobs || []).find((row) => row.id === asset.deliverableId);
      const label = job?.label || asset.title || asset.deliverableId || 'File';
      out.push({ asset, run, label, folder: run.kit.sourceTitle || run.title || '', channel: job?.folder || '', title: `${run.kit.sourceTitle || run.title || ''} › ${label}`, detail: run.kit.folderName || helpDay(run.createdAt) });
    }
  }
  return out;
}
const HELP_LINK_ORDER = ['report', 'trend', 'folder', 'program', 'run', 'prompt', 'page'];
// The one item a name points at, for [[Title]] links: an exact title (or a trend's alias) first, by kind in that order.
function helpLinkTarget(items, title) {
  const hits = helpMatches(items, (item) => item.title, title);
  const named = hits.length ? hits : items.filter((item) => (item.aliases || []).some((alias) => helpNorm(alias) === helpNorm(title)));
  const best = [...named].sort((a, b) => HELP_LINK_ORDER.indexOf(a.kind) - HELP_LINK_ORDER.indexOf(b.kind))[0];
  if (!best) return null;
  return best.kind === 'program' ? { kind: 'page', id: 'research' } : { kind: best.kind, id: best.id };
}
// Loose words → the best items by BM25 over title, aliases and place, with a nudge for recent ones and for a date the
// words name ("last week", "October"). [{ item, score }], best first.
const HELP_MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
function helpFind(items, words, limit = 8) {
  const query = askTokens(words); if (!query.length) return [];
  const lower = helpNorm(words);
  const span = /\btoday\b/.test(lower) ? [0, 1] : /\byesterday\b/.test(lower) ? [1, 2] : /\b(this|last) week\b/.test(lower) ? (/\blast\b/.test(lower) ? [7, 14] : [0, 7]) : /\b(this|last) month\b/.test(lower) ? (/\blast\b/.test(lower) ? [30, 61] : [0, 31]) : null;
  const month = HELP_MONTHS.findIndex((name) => new RegExp(`\\b${name}\\b`).test(lower));
  const scores = askBm25(items.map((item) => askTokens(`${item.title} ${(item.aliases || []).join(' ')} ${item.where}`)), query);
  return items.map((item, index) => {
    const age = helpAgo(item.date); let score = scores[index];
    if (!score) return { item, score: 0 };
    if (Number.isFinite(age)) score += 0.5 * Math.exp(-age / 30);
    if (span && age >= span[0] && age < span[1]) score += 1;
    if (month >= 0 && item.date && Number(item.date.slice(5, 7)) === month + 1) score += 1;
    if (helpNorm(item.title).includes(lower) && lower.length >= 4) score += 1;
    return { item, score };
  }).filter((row) => row.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
}

// Each button's item, found on the server by its target so the button acts on exactly what it names: the ids the
// renderer's runAiAction reads first (programId, runId + themeId, assetId, folderKey, promptId, ref { kind, id },
// roleId / memberId) and `title`, the item's exact name. Two equally good matches give `candidates` ([{ id, title,
// detail, ids }], at most 5) and the person picks on a choice card; a target that matches nothing drops the button and
// says so in `unresolved`, so the next answer can ask. [[Exact title]] links in the answer become studio: links.
// Returns { actions: [action | null], answer, unresolved }. `scope` ({ promptAccess, admin, role }).
function helpResolveActions({ actions = [], answer = '' } = {}, scope = {}) {
  const studio = contentWorkspace.publicState();
  const items = helpItems(studio, { prompts: Boolean(scope.promptAccess?.view), role: scope.role });
  const programs = studio.programs || []; const researchRuns = studio.researchRuns || []; const contentRuns = studio.contentRuns || [];
  const runLabel = (run) => helpRunLabel(run, programs);
  const reviewThemes = (keep) => researchRuns.filter((run) => !isQuickScan(run) && run.status === 'awaiting-review').flatMap((run) => helpThemes(run).filter((theme) => keep(run.decisions?.[theme.id])).map((theme) => ({ run, theme, title: theme.name || '', aliases: theme.aliases || [], detail: runLabel(run) })));
  const unresolved = [];
  // The rows a name matches: helpMatches, else a trend alias; narrowed by a hint ("<name> · <run>" or params run=).
  const matching = (rows, ref, hint = '') => {
    let hits = helpMatches(rows, (row) => row.title, ref);
    if (!hits.length) hits = rows.filter((row) => (row.aliases || []).some((alias) => helpNorm(alias) === helpNorm(ref)));
    if (hint && hits.length > 1) { const narrowed = hits.filter((row) => helpNorm(row.detail).includes(helpNorm(hint))); if (narrowed.length) hits = narrowed; }
    return hits;
  };
  const split = (target) => { const at = String(target || '').indexOf(' · '); return at > 0 ? [target.slice(0, at).trim(), target.slice(at + 3).trim()] : [String(target || '').trim(), '']; };
  const settle = (action, hits, idsOf, titleOf = (row) => row.title, detailOf = (row) => row.detail || '') => {
    if (hits.length === 1) return { ...action, ...idsOf(hits[0]), title: titleOf(hits[0]) };
    if (hits.length > 1) return { ...action, candidates: hits.slice(0, 5).map((row) => ({ ids: idsOf(row), title: String(titleOf(row)).slice(0, 160), detail: String(detailOf(row)).slice(0, 160) })) };
    unresolved.push(action.target || action.label); return null;
  };
  const trendIds = (row) => ({ runId: row.run.id, themeId: row.theme.id });
  const itemIds = (item) => ({ ref: { kind: item.kind, id: item.id }, ...Object.fromEntries(['assetId', 'folderKey', 'themeId', 'runId', 'programId', 'promptId', 'page'].filter((key) => item[key]).map((key) => [key, item[key]])) });
  const out = actions.map((action) => {
    const spec = helpAssistant.CATALOG[action?.kind]; if (!spec) return null;
    const params = action.params || {};
    try {
      switch (spec.target) {
        case 'program': {
          const hits = matching(programs.map((program) => ({ program, title: program.name || '', detail: helpSchedule(program) })), action.target);
          if (!hits.length && programs.length === 1) return { ...action, programId: programs[0].id, title: programs[0].name };
          return settle(action, hits, (row) => ({ programId: row.program.id }));
        }
        case 'trend.waiting': case 'trend.decided': {
          const [name, hint] = split(action.target);
          const rows = spec.target === 'trend.waiting' ? reviewThemes((decision) => !decision) : reviewThemes((decision) => decision === 'approved' || decision === 'passed');
          return settle(action, matching(rows, name, params.run || hint), trendIds);
        }
        case 'trend.ready': {
          const rows = helpReadyTrends().map((trend) => ({ trend, title: trend.name || '', detail: `ready ${helpDay(trend.readyAt)}` }));
          return settle(action, matching(rows, action.target), (row) => ({ themeId: row.trend.themeId }));
        }
        case 'report': return settle(action, matching(items.filter((item) => item.kind === 'report'), action.target).map((item) => ({ ...item, detail: item.date })), (item) => ({ assetId: item.assetId }));
        case 'asset': {
          const reports = matching(items.filter((item) => item.kind === 'report'), action.target);
          if (reports.length) return settle(action, reports.map((item) => ({ ...item, detail: item.date })), (item) => ({ assetId: item.assetId }));
          const files = helpKitFiles(studio).map((row) => ({ ...row, aliases: [row.asset.title || ''] }));
          return settle(action, matching(files, action.target), (row) => ({ assetId: row.asset.id }));
        }
        case 'folder': return settle(action, matching(items.filter((item) => item.kind === 'folder'), action.target).map((item) => ({ ...item, detail: item.date })), (item) => ({ folderKey: item.folderKey }));
        case 'run.live': case 'run.stopped': {
          const wanted = spec.target === 'run.live' ? ['queued', 'running'] : ['failed', 'partial', 'cancelled'];
          const rows = [...researchRuns, ...contentRuns].filter((run) => wanted.includes(run.status)).map((run) => ({ run, title: run.kit ? run.kit.sourceTitle || run.title || '' : run.title || '', detail: helpDay(run.createdAt) }));
          return settle(action, matching(rows, action.target), (row) => ({ runId: row.run.id }));
        }
        case 'prompt': {
          if (action.kind === 'edit-prompt') return action; // its prompt is checked by help-assistant.js cleanPromptEdit
          const rows = items.filter((item) => item.kind === 'prompt');
          const byId = rows.find((item) => item.id === String(action.target || '').trim());
          return settle(action, byId ? [byId] : matching(rows, action.target), (item) => ({ promptId: item.promptId }));
        }
        case 'any': {
          const type = params.type || '';
          const kinds = action.kind === 'copy' ? ['report', 'folder', 'trend', 'prompt'] : ['report', 'folder', 'trend', 'program', 'run', 'prompt', 'page'];
          const pool = items.filter((item) => kinds.includes(item.kind) && (!type || item.kind === type || (type === 'page' && item.kind === 'page')));
          const byPage = type === 'page' || !type ? pool.find((item) => item.kind === 'page' && item.id === helpNorm(action.target)) : null;
          let hits = byPage ? [byPage] : matching(pool, action.target);
          if (!hits.length) {
            // Loose words: the clear winner, else the best few to choose from.
            const found = helpFind(pool, action.target, 4);
            hits = found.length && (found.length === 1 || found[0].score >= found[1].score * 1.5) ? [found[0].item] : found.map((row) => row.item);
          }
          return settle(action, hits.map((item) => ({ ...item, detail: [item.where, item.date].filter(Boolean).join(' · ') })), itemIds);
        }
        case 'who': {
          if (!scope.admin) { unresolved.push(action.target); return null; }
          const policy = teamStore.accessPolicy();
          const rolesRows = [...policy.roles.values()].filter((def) => def.base !== 'admin').map((def) => ({ title: def.label, aliases: [def.id, `${def.label}s`], detail: `Role (${def.base === 'channel' ? 'channel owner' : 'editor'})`, ids: { roleId: def.id, ...(def.base === 'channel' && params.channel ? { channelId: params.channel } : {}) }, base: def.base }));
          // Admins see what the admin sees, so View as never offers one.
          const people = teamStore.listMembers().filter((member) => !member.disabled && policy.roles.get(member.role)?.base !== 'admin').map((member) => ({ title: member.name, aliases: [], detail: `Person (${policy.roles.get(member.role)?.label || member.role})`, ids: { memberId: member.id } }));
          const hits = matching([...rolesRows, ...people], action.target);
          return settle(action, hits, (row) => row.ids);
        }
        default: return action;
      }
    } catch (_) { return action; } // the renderer still finds it by name, and the server checks every call
  }).map((action) => {
    if (!action) return null;
    // Several trends by name (approve-trends, write-reports): each name to its trend; names that match nothing are said.
    const names = Array.isArray(action.params?.trends) ? action.params.trends : null;
    if (!names || !['approve-trends', 'write-reports'].includes(action.kind)) return action;
    const rows = action.kind === 'approve-trends' ? reviewThemes((decision) => !decision) : reviewThemes((decision) => decision === 'approved');
    const picked = []; const missing = [];
    for (const name of names) { const hits = matching(rows, name); if (hits.length) picked.push(...hits); else missing.push(name); }
    if (!picked.length) { unresolved.push(names.join(', ')); return null; }
    const unique = [...new Map(picked.map((row) => [`${row.run.id}:${row.theme.id}`, row])).values()];
    const problems = [...(action.problems || []), ...(missing.length ? [`I couldn’t find ${missing.map((name) => `“${name}”`).join(' or ')} among the ${action.kind === 'write-reports' ? 'approved' : 'waiting'} trends.`] : [])];
    return { ...action, picks: unique.slice(0, 12).map((row) => ({ runId: row.run.id, themeId: row.theme.id, name: row.theme.name || '' })), ...(problems.length ? { problems: problems.slice(0, 4) } : {}) };
  });
  const known = (kind, id) => (kind === 'page' ? Boolean(helpAssistant.HELP_PAGES[id]) : items.some((item) => item.kind === kind && item.id === id));
  return { actions: out, answer: helpAssistant.linkAnswer(answer, { find: (title) => helpLinkTarget(items, title), known }), unresolved };
}

// What Ask AI reads when a question needs more than titles: a report's text, an asset folder's files, one channel asset
// file, a run's details, a trend's history, matching posts, the best matches for loose words (find), what was spent
// (spend, only for people who see costs), earlier conversations or older memories. `scope` is who is asking and where
// ({ identityId, workspaceId, conversationId, recalled, promptAccess, role, costs }).
function helpLookup({ kind, target }, scope = {}) {
  const studio = contentWorkspace.publicState();
  const kitRuns = (studio.contentRuns || []).filter((run) => run.kit);
  if (kind === 'report') {
    const kitIds = new Set(kitRuns.map((run) => run.id));
    const asset = helpPick((studio.assets || []).filter((row) => row.kind === 'text' && !kitIds.has(row.runId)), (row) => row.title, target);
    if (!asset) return { kind, target, found: false };
    const text = String(contentWorkspace.readStudioAsset({ assetId: asset.id }).markdown || '');
    return { kind, target, found: true, title: asset.title, text: text.slice(0, 16000), ...(text.length > 16000 ? { shortenedFrom: text.length } : {}) };
  }
  if (kind === 'asset-folder') {
    const latest = helpPick(kitRuns, (run) => run.kit.sourceTitle, target);
    if (!latest) return { kind, target, found: false };
    const runs = kitRuns.filter((run) => run.kit.sourceKey === latest.kit.sourceKey);
    const run = runs[0]; const assets = (studio.assets || []).filter((asset) => asset.runId === run.id);
    return { kind, target, found: true, title: run.kit.sourceTitle, runs: runs.length, latest: { folder: run.kit.folderName, status: run.status, started: run.createdAt, costUsd: helpMoney(run.costUsd), capUsd: run.maxBudgetUsd, model: run.ai?.model || '', files: (run.jobs || []).map((job) => ({ folder: job.folder, file: job.label, status: job.status, ...(job.error ? { error: String(job.error).slice(0, 300) } : {}), titles: assets.filter((asset) => asset.deliverableId === job.id).map((asset) => asset.title).slice(0, 3) })) } };
  }
  if (kind === 'run') {
    const run = helpPick([...(studio.researchRuns || []), ...(studio.contentRuns || []).filter((row) => !row.kit)], (row) => row.title, target);
    if (!run) return { kind, target, found: false };
    const costByStage = {}; for (const receipt of run.receipts || []) { const stage = String(receipt.stage || 'other').split(/[-:]/)[0]; costByStage[stage] = helpMoney((costByStage[stage] || 0) + (Number(receipt.costUsd) || 0)); }
    return { kind, target, found: true, title: run.title, type: isQuickScan(run) ? 'quick-scan' : run.type, status: run.status, stage: run.stage, message: String(run.message || '').slice(0, 600), started: run.createdAt, costUsd: helpMoney(run.costUsd), budgetUsd: run.maxBudgetUsd, counts: run.counts || null, progress: run.discoveryProgress || run.assignmentProgress || run.progress || null, warnings: (run.warnings || []).slice(0, 5).map((line) => String(line).slice(0, 300)), jobs: (run.jobs || []).slice(0, 20).map((job) => ({ label: job.label || job.id, status: job.status, ...(job.error ? { error: String(job.error).slice(0, 300) } : {}) })), costByStage, ...(isQuickScan(run) ? { quickScan: run.quickScan || null, themes: helpThemes(run).slice(0, 8).map((theme) => ({ name: theme.name, summary: String(theme.description || theme.summary || '').slice(0, 300), platforms: theme.platforms || [], evidenceCount: theme.evidenceCount ?? null })) } : {}) };
  }
  if (kind === 'trend') {
    const record = helpTrendRecord({ name: target });
    if (record) return { kind, target, found: true, title: record.name, trend: helpTrendView(record) };
    // Before trend history exists for it: what the newest run that found it says.
    const seen = (studio.researchRuns || []).flatMap((run) => helpThemes(run).map((theme) => ({ run, theme })));
    const hit = helpPick(seen, (row) => row.theme.name, target);
    if (!hit) return { kind, target, found: false };
    const { run, theme } = hit;
    return { kind, target, found: true, title: theme.name, trend: { name: theme.name, aliases: (theme.aliases || []).slice(0, 8), category: theme.scoring?.taxonomy?.category || theme.taxonomyCategory || '', keywords: (theme.matchingKeywords || []).slice(0, 12), firstSeen: String(run.createdAt || '').slice(0, 10), lastSeen: String(run.createdAt || '').slice(0, 10), runsSeen: theme.scoring?.count || 1, momentum: '', momentumBasis: 'Seen in one run so far.', latestPriorityTier: theme.scoring?.priorityTier || '', appearances: [{ runTitle: run.title, runDate: String(run.createdAt || '').slice(0, 10), origin: isQuickScan(run) ? 'quick-scan' : 'research', decision: run.decisions?.[theme.id] || '', evidenceCount: theme.evidenceCount ?? null, platforms: theme.platforms || [] }], reports: [] } };
  }
  // Loose words → exact titles: the best matches across everything with a name, and earlier conversations.
  if (kind === 'find') {
    const items = helpItems(studio, { prompts: Boolean(scope.promptAccess?.view), role: scope.role });
    const found = helpFind(items, target, 8).map(({ item }) => ({ type: item.kind === 'folder' ? 'asset folder' : item.kind, title: item.title, where: item.where, ...(item.date ? { date: item.date } : {}) }));
    const conversations = scope.identityId ? helpSafe(() => askStore.searchConversations(scope.identityId, target, 3, { workspaceId: scope.workspaceId || '', exclude: scope.conversationId || '' }), []) : [];
    const rows = [...found, ...conversations.map((row) => ({ type: 'conversation', title: row.title, where: 'Ask AI', date: helpDay(row.updatedAt) }))].slice(0, 10);
    return { kind, target, found: rows.length > 0, title: target, matches: rows };
  }
  // One channel asset file ("Folder › File"), its text, status and who last edited it. A folder alone lists its files.
  if (kind === 'asset') {
    const files = helpKitFiles(studio); const [folderName, fileName = ''] = String(target || '').split(/\s*(?:›|>)\s*/);
    // Runs come newest first, so the folder's newest set wins.
    const latestRun = helpPick((studio.contentRuns || []).filter((run) => run.kit), (run) => run.kit.sourceTitle, folderName);
    if (!latestRun) return { kind, target, found: false };
    const inFolder = files.filter((row) => row.run.id === latestRun.id);
    const file = fileName ? helpPick(inFolder, (row) => row.label, fileName) || helpPick(inFolder, (row) => row.asset.title, fileName) : null;
    if (!file) return { kind, target, found: inFolder.length > 0, title: latestRun.kit.sourceTitle, files: inFolder.slice(0, 40).map((row) => ({ file: row.title, channel: row.channel, status: helpAssetStatus(row.asset) })) };
    const result = file.asset.kind === 'text' ? helpSafe(() => contentWorkspace.readStudioAsset({ assetId: file.asset.id })) : null;
    const text = String(result?.markdown || '');
    return { kind, target, found: true, title: file.title, channel: file.channel, status: helpAssetStatus(file.asset), ...(file.asset.review?.link ? { link: file.asset.review.link } : {}), ...(file.asset.edited?.at ? { edited: `${helpDay(file.asset.edited.at)}${file.asset.edited.by?.name ? ` by ${file.asset.edited.by.name}` : ''}` } : {}), ...(file.asset.kind === 'text' ? { text: text.slice(0, 16000), ...(text.length > 16000 ? { shortenedFrom: text.length } : {}) } : { picture: true }) };
  }
  // What was spent and on what: by kind of work over a week, month or quarter (or one run), from each run's own cost
  // and receipts. Ask AI answers aren't runs, so they aren't in it. Never for someone who can't see costs.
  if (kind === 'spend') {
    if (scope.costs === false) return { kind, target, found: false, error: 'Costs aren’t shown to this person.' };
    const kindOf = (run) => (run.type === 'research' ? (isQuickScan(run) ? 'quick scans' : 'research') : run.kit ? 'channel assets' : 'reports');
    const own = (run) => Number(run.type === 'research' ? run.ownCostUsd ?? run.costUsd : run.costUsd) || 0;
    const codex = (run) => run.ai?.route === 'codex' || (run.receipts || []).some((receipt) => receipt?.provider === 'codex');
    const stages = (run) => { const costs = {}; for (const receipt of run.receipts || []) { const stage = String(receipt.stage || 'other').split(/[-:]/)[0]; costs[stage] = helpMoney((costs[stage] || 0) + (Number(receipt.costUsd) || 0)); } return costs; };
    const all = [...(studio.researchRuns || []), ...(studio.contentRuns || [])];
    const words = helpNorm(target); const days = /quarter|90/.test(words) ? 91 : /month|30/.test(words) ? 31 : /week|7/.test(words) ? 7 : /today|day/.test(words) ? 1 : 0;
    const one = days ? null : helpPick(all.map((run) => ({ run, title: run.kit ? run.kit.sourceTitle || run.title || '' : run.title || '' })), (row) => row.title, target);
    if (one) return { kind, target, found: true, title: one.title, run: { kind: kindOf(one.run), status: one.run.status, started: helpDay(one.run.createdAt), costUsd: helpMoney(own(one.run)), budgetUsd: helpMoney(one.run.maxBudgetUsd), costByStage: stages(one.run), ...(codex(one.run) ? { codex: 'Ran on Codex, which isn’t metered: AI cost shows as $0.' } : {}) } };
    const runs = all.filter((run) => helpAgo(run.createdAt) <= (days || 31));
    const byKind = {}; for (const run of runs) { const key = kindOf(run); byKind[key] = helpMoney((byKind[key] || 0) + own(run)); }
    const codexRuns = runs.filter(codex).length;
    return { kind, target, found: true, title: `Last ${days || 31} days`, totalUsd: helpMoney(runs.reduce((sum, run) => sum + own(run), 0)), runs: runs.length, byKind, mostExpensive: [...runs].sort((a, b) => own(b) - own(a)).slice(0, 5).map((run) => ({ title: run.kit ? run.kit.sourceTitle || run.title : run.title, kind: kindOf(run), started: helpDay(run.createdAt), costUsd: helpMoney(own(run)), costByStage: stages(run) })), ...(codexRuns ? { codex: `${helpPlural(codexRuns, 'run')} ran on Codex, which isn’t metered, so their AI cost isn’t counted.` } : {}), note: 'AI is metered per run; Apify collection is billed by Apify and isn’t included. Ask AI answers aren’t runs and aren’t included.' };
  }
  if (kind === 'posts') {
    if (typeof contentWorkspace.searchRunPosts !== 'function') return { kind, target, found: false, error: 'Searching collected posts isn’t available in this version of the studio.' };
    const posts = helpPosts(target, 12);
    return { kind, target, found: posts.length > 0, title: target, posts };
  }
  if (kind === 'conversation') {
    if (!scope.identityId) return { kind, target, found: false };
    const conversations = askStore.searchConversations(scope.identityId, target, 5, { workspaceId: scope.workspaceId || '', exclude: scope.conversationId || '' });
    return { kind, target, found: conversations.length > 0, title: target, conversations };
  }
  if (kind === 'memory') {
    if (!scope.identityId) return { kind, target, found: false };
    const items = askStore.searchMemory(scope.identityId, { workspaceId: scope.workspaceId || '', query: target, exclude: scope.recalled || [], limit: 12 });
    return { kind, target, found: items.length > 0, title: target, items: items.map((item) => ({ kind: item.kind, text: item.text, scope: item.scope, updatedAt: item.updatedAt })) };
  }
  // One prompt from this workspace's Prompt Library (a promise: readPrompt checks the AI route for "Runs on").
  if (kind === 'prompt') {
    if (!scope.promptAccess?.view || typeof contentWorkspace.readPrompt !== 'function') return { kind, target, found: false, error: 'The Prompt Library isn’t open to this person.' };
    const rows = helpSafe(() => contentWorkspace.listPrompts().prompts, []);
    const row = rows.find((entry) => entry.id === String(target || '').trim()) || helpPick(rows, (entry) => entry.name, target);
    if (!row) return { kind, target, found: false };
    return Promise.resolve(contentWorkspace.readPrompt({ id: row.id })).then((detail) => ({ kind, target, found: true, title: row.name, prompt: helpPromptView(detail, scope.promptAccess) }));
  }
  return { kind, target, found: false };
}
// A prompt as Ask AI reads it: its parts in layout order (fixed parts with their reason, data sections, and each
// editable part's current text with the {{values}} it can use and what it must keep), the rules the studio enforces,
// its version and lock, and the last 5 saves. Saved text is the team's own words, shown as data.
function helpPromptView(detail = {}, promptAccess = {}) {
  const entry = detail.prompt || {}; const byId = new Map((entry.blocks || []).map((block) => [block.id, block])); const custom = new Set(detail.customized || []);
  const part = (block) => (block.editable
    ? { kind: 'editable', blockId: block.id, label: block.label, help: block.help || '', customized: custom.has(block.id), text: String(detail.blocks?.[block.id] ?? ''), values: (block.variables || []).map((value) => `{{${value.name}}}: ${value.description}`), mustKeep: [...(block.requiredVariables || []).map((name) => `{{${name}}}`), ...(block.requiredTerms || []).map((term) => `“${term}”`)], maxChars: block.maxChars, ...(block.lines ? { lines: `${block.lines.min} to ${block.lines.max}, one per line` } : {}) }
    : { kind: 'fixed', label: block.label, reason: block.reason || '', text: String(detail.blocks?.[block.id] ?? '').slice(0, 4000) });
  const parts = []; const placed = new Set();
  for (const row of entry.layout || []) {
    if (row.kind === 'block') { const block = byId.get(row.blockId); if (block) { placed.add(block.id); parts.push(part(block)); } }
    else parts.push(row.kind === 'data' ? { kind: 'data', label: row.label } : { kind: 'fixed', label: row.label, reason: row.reason || '' });
  }
  for (const block of entry.blocks || []) if (!placed.has(block.id)) parts.push({ ...part(block), usedCaseByCase: true });
  return {
    id: entry.id, name: entry.name, description: entry.description || '', usedFor: entry.powers || [], version: detail.version ?? 0, customized: custom.size > 0,
    locked: Boolean(detail.locked), ...(detail.locked ? { lockedBy: detail.lock?.by?.name || 'an admin', theyCanEditIt: Boolean(promptAccess?.admin) } : {}),
    runsOn: detail.route === 'codex' ? 'Codex (not metered)' : [detail.modelLabel || detail.model || '', detail.effort ? `${detail.effort} effort` : ''].filter(Boolean).join(' · '),
    parts, studioEnforces: entry.enforced || [], ...(detail.defaultChanged?.length ? { newerDefaultFor: detail.defaultChanged } : {}),
    recentChanges: (detail.history || []).slice(0, 5).map((row) => ({ version: row.version, at: row.at, by: row.by?.name || '', source: row.source === 'ask-ai' ? 'Ask AI' : row.source === 'restore' ? 'Restore' : 'Prompts', note: row.note || '', parts: row.blockIds || [] })),
  };
}

const HELP_MOMENTUM = ['new', 'rising', 'steady', 'fading'];
const HELP_DOC_KINDS = { 'evidence-report': 'Trends report', 'editorial-toolkit': 'Editorial toolkit' };
// A trend's stage in the one vocabulary (Needs your OK · Approved · Being written · Ready · Skipped), placed the way the
// Trend board places it. Quick scans have no review gate, so their trends have no stage.
// The same rules as src/shared/trend-board.js buildTrendBoard (test/live-workflow-integration.test.js compares them): a run
// stopped before any report has no cards, and a ready trend whose report is being turned into assets is still Being
// written.
function helpTrendStage(run, theme, contentRuns, assets = []) {
  if (!run || isQuickScan(run)) return '';
  if (run.status === 'cancelled' && !(run.reportRunIds || []).length) return '';
  const decision = run.decisions?.[theme.id];
  if (run.status === 'awaiting-review') return decision === 'approved' ? 'approved' : decision === 'passed' ? 'passed' : 'waiting';
  if (!(run.themes || []).some((row) => row.id === theme.id)) return 'passed';
  const entry = (run.reportRunIds || []).find((row) => row.themeId === theme.id);
  const report = entry && contentRuns.find((row) => row.id === entry.runId);
  if (report?.status !== 'succeeded') return 'writing';
  const reportIds = new Set(assets.filter((asset) => asset.runId === report.id && ['evidence-report', 'editorial-toolkit'].includes(asset.deliverableId)).map((asset) => asset.id));
  return contentRuns.some((row) => row.sourceAssetId && reportIds.has(row.sourceAssetId) && ['queued', 'running'].includes(row.status)) ? 'writing' : 'ready';
}
function helpProgress(run) {
  const jobs = run.jobs || [];
  if (jobs.length) return { done: jobs.filter((job) => job.status === 'succeeded').length, total: jobs.length };
  const step = run.assignmentProgress || run.discoveryProgress || run.progress; const total = Number(step?.total);
  return Number.isFinite(total) && total > 0 ? { done: Number(step.completed ?? step.done) || 0, total } : null;
}
function helpExcerpt(asset) {
  const markdown = helpSafe(() => String(contentWorkspace.readStudioAsset({ assetId: asset.id }).markdown || ''), '');
  const text = markdown.split('\n').map((line) => line.replace(/^\s*(#{1,6}|[-*+]|\d+\.)\s+/, '').replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`>|]+/g, '').trim()).filter((line) => line && helpNorm(line) !== helpNorm(asset.title)).join(' ').replace(/\s+/g, ' ');
  return text.length > 240 ? `${text.slice(0, 239).replace(/\s+\S*$/, '')}…` : text;
}

// Cards under an answer, filled from the studio's own state (the renderer contract: { type, title, note, data,
// actionIndexes }). The model picks a card and names what it is about (ref); ids, statuses and numbers come from here,
// never from the model, and a card whose ref matches nothing is dropped. Model-only cards (metric, table, checklist,
// compare, choice, draft, plan) pass through helpAssistant.modelCard. A card that points at a button the server already
// resolved shows that button's item, so the card and its button always agree; ids the card found are copied onto the
// buttons that still lack them. A quick-scan button always gets its planner card, an edit-prompt button its
// prompt-change card, an edit-report button its report-change card, a button whose params need checking an action form
// card, and a button whose target matched two things a choice card. `actions` are the reply's resolved actions (card
// buttons point into them); `lookups` what Ask AI read for this answer; `promptAccess` (helpPromptAccess) whether this
// person may save prompts.
function hydrateCards(cards, { actions = [], lookups = [], promptAccess = null } = {}) {
  const studio = contentWorkspace.publicState();
  const researchRuns = studio.researchRuns || []; const contentRuns = studio.contentRuns || []; const assets = studio.assets || []; const programs = studio.programs || [];
  const kitRuns = contentRuns.filter((run) => run.kit); const kitIds = new Set(kitRuns.map((run) => run.id));
  let history; const trends = () => (history === undefined ? (history = helpTrendHistory()) : history);
  const base = (card, title) => ({ type: card.type, title: card.title || String(title || '').slice(0, 120), note: card.note || '', actionIndexes: Array.isArray(card.actionIndexes) ? card.actionIndexes : [] });
  // The first button this card points at whose kind is one of `kinds` and that has `key` resolved.
  const pointed = (card, kinds, key) => (card.actionIndexes || []).map((at) => actions[at]).find((row) => row && kinds.includes(row.kind) && row[key]);
  const builders = {
    trend(card) {
      const seen = researchRuns.flatMap((run) => helpThemes(run).map((theme) => ({ run, theme })));
      const button = pointed(card, ['approve-trend', 'pass-trend', 'undo-trend'], 'themeId');
      // A trend still waiting for an OK wins over the same trend in older runs, so the card's stage matches its buttons.
      const waiting = seen.filter(({ run, theme }) => run.status === 'awaiting-review' && !run.decisions?.[theme.id]);
      const hit = (button && seen.find(({ run, theme }) => run.id === button.runId && theme.id === button.themeId)) || helpPick(waiting, (row) => row.theme.name, card.ref) || helpPick(seen, (row) => row.theme.name, card.ref) || seen.find((row) => (row.theme.aliases || []).some((alias) => helpNorm(alias) === helpNorm(card.ref)));
      const record = helpTrendRecord(hit ? { name: hit.theme.name, themeId: hit.theme.id } : { name: card.ref }, trends(), { strict: true });
      if (!hit && !record) return null;
      const theme = hit?.theme || {}; const latest = record?.appearances?.[record.appearances.length - 1];
      const run = hit?.run || researchRuns.find((row) => row.id === latest?.runId) || null;
      const entry = run && hit && (run.reportRunIds || []).find((row) => row.themeId === theme.id);
      const report = (entry && (assets.find((asset) => asset.runId === entry.runId && asset.deliverableId === 'evidence-report') || assets.find((asset) => asset.runId === entry.runId && asset.kind === 'text'))) || [...(record?.reports || [])].sort((a, b) => Number(b.deliverableId === 'evidence-report') - Number(a.deliverableId === 'evidence-report')).map((row) => assets.find((asset) => asset.id === row.assetId)).find(Boolean) || null;
      const category = theme.scoring?.taxonomy?.category && theme.scoring.taxonomy.category !== 'UNMAPPED' ? theme.scoring.taxonomy.category : theme.taxonomyCategory || record?.category || '';
      const platforms = Array.isArray(theme.platforms) ? theme.platforms : Array.isArray(record?.platforms) ? record.platforms : latest?.posts ? ['x', 'linkedin', 'reddit'].filter((platform) => Number(latest.posts[platform]) > 0) : [];
      const name = theme.name || record.name; const day = String(run?.createdAt || '').slice(0, 10);
      return { ...base(card, name), data: { themeId: theme.id || (record?.themeIds || [])[0] || '', runId: run?.id || '', name, category, momentum: HELP_MOMENTUM.includes(record?.momentum) ? record.momentum : '', priorityTier: theme.scoring?.priorityTier || record?.latestPriorityTier || '', stage: hit ? helpTrendStage(run, theme, contentRuns, assets) : '', evidenceCount: Number(theme.evidenceCount ?? theme.evidenceIds?.length ?? latest?.posts?.total) || 0, platforms, runsSeen: Number(record?.runsSeen) || Number(theme.scoring?.count) || 1, firstSeen: record?.firstSeen || day, lastSeen: record?.lastSeen || day, spark: helpSpark(record), reportAssetId: report?.id || '', summary: String(theme.description || theme.summary || '').slice(0, 300), ...(run && !isQuickScan(run) ? { runLabel: helpRunLabel(run, programs) } : {}) } };
    },
    report(card) {
      const rows = assets.filter((row) => row.kind === 'text' && !kitIds.has(row.runId));
      const button = pointed(card, ['open', 'make-assets', 'set-status', 'edit-report', 'copy', 'export-run', 'publish-docs'], 'assetId');
      const asset = (button && rows.find((row) => row.id === button.assetId)) || helpPick(rows, (row) => row.title, card.ref);
      if (!asset) return null;
      const run = contentRuns.find((row) => row.id === asset.runId);
      const trendName = run?.themeId ? helpThemes(researchRuns.find((row) => row.id === run.researchRunId) || {}).find((theme) => theme.id === run.themeId)?.name || run.title || '' : '';
      return { ...base(card, asset.title), data: { assetId: asset.id, title: asset.title, kind: HELP_DOC_KINDS[asset.deliverableId] || asset.channel || 'Draft', date: String(asset.createdAt || '').slice(0, 10), trendName, excerpt: helpExcerpt(asset), status: helpAssetStatus(asset) } };
    },
    'asset-folder'(card) {
      const button = pointed(card, ['open', 'finish-assets', 'save-folder', 'copy'], 'folderKey');
      const latest = (button && kitRuns.find((run) => run.kit.sourceKey === button.folderKey)) || helpPick(kitRuns, (run) => run.kit.sourceTitle, card.ref);
      if (!latest) return null;
      const run = kitRuns.find((row) => row.kit.sourceKey === latest.kit.sourceKey); const jobs = run.jobs || [];
      const channels = new Map(); for (const job of jobs) channels.set(job.folder || 'Files', (channels.get(job.folder || 'Files') || 0) + 1);
      return { ...base(card, run.kit.sourceTitle), data: { sourceKey: run.kit.sourceKey, title: run.kit.sourceTitle, status: run.status, ready: jobs.filter((job) => job.status === 'succeeded').length, total: jobs.length, latestRunId: run.id, channels: [...channels].map(([name, count]) => ({ name, count })) } };
    },
    run(card) {
      const rows = [...researchRuns.map((run) => ({ run, title: run.title })), ...contentRuns.map((run) => ({ run, title: run.kit ? run.kit.sourceTitle : run.title }))];
      const button = pointed(card, ['stop-run', 'retry-run', 'open'], 'runId');
      const hit = (button && rows.find((row) => row.run.id === button.runId)) || helpPick(rows, (row) => row.title, card.ref);
      if (!hit) return null;
      const { run } = hit;
      return { ...base(card, hit.title), data: { runId: run.id, kind: run.type === 'research' ? (isQuickScan(run) ? 'quick-scan' : 'research') : run.kit ? 'kit' : 'content', title: hit.title, status: run.status, stage: run.stage || '', message: String(run.message || '').slice(0, 300), startedAt: run.createdAt || '', costUsd: helpMoney(run.costUsd), budgetUsd: helpMoney(run.maxBudgetUsd), progress: helpProgress(run), themes: helpThemes(run).slice(0, 6).map((theme) => String(theme.name || '')), programId: run.programId || '' } };
    },
    program(card) {
      const button = pointed(card, ['start-research', 'open'], 'programId');
      const program = (button && programs.find((row) => row.id === button.programId)) || helpPick(programs, (row) => row.name, card.ref);
      if (!program) return null;
      return { ...base(card, program.name), data: { programId: program.id, name: program.name, sources: helpSources(program), window: helpWindow(program), schedule: helpSchedule(program), budgets: { aiUsd: helpMoney(program.budgets?.aiUsd), collectionUsd: helpMoney(program.budgets?.collectionUsd) } } };
    },
    chart(card) {
      const names = [card.ref, ...(card.items || [])].map((name) => String(name || '').trim()).filter(Boolean).slice(0, 4);
      const series = names.map((name) => helpSeries(name, trends())).filter(Boolean);
      if (!series.length) return null;
      // One basis for the whole chart: share of posts when every point has it (runs of different sizes compare fairly).
      const shares = series.every((row) => row.points.every((point) => point.hasShare));
      return { ...base(card, series.length === 1 ? series[0].label : 'Trends over time'), data: { kind: series.some((row) => row.points.length > 1) ? 'line' : 'bar', unit: shares ? 'Share of posts (%)' : 'Posts', series: series.map((row) => ({ label: row.label, points: row.points.map((point) => ({ x: point.x, y: shares ? Math.round(point.share * 100) / 100 : point.posts })) })) } };
    },
    posts(card) {
      const query = card.ref || card.title; if (!query) return null;
      const read = lookups.filter((row) => row?.kind === 'posts' && row.found);
      const posts = (read.find((row) => helpNorm(row.target) === helpNorm(query)) || (read.length === 1 ? read[0] : null))?.posts || helpPosts(query, 12);
      const chosen = (card.items || []).filter(Boolean).map((url) => posts.find((post) => post.url && post.url === url)).filter(Boolean);
      const shown = (chosen.length ? chosen : posts).slice(0, 5);
      return shown.length ? { ...base(card, `What people are saying about ${query}`), data: { posts: shown } } : null;
    },
    'scan-plan'(card) {
      const index = (card.actionIndexes || []).find((at) => actions[at]?.kind === 'quick-scan');
      const scan = index === undefined ? null : actions[index].scan; const program = scan && programs.find((row) => row.id === scan.programId);
      if (!scan || !program) return null;
      return { ...base(card, `Quick scan · ${scan.topic}`), actionIndexes: [index], data: { scan, programId: program.id, programName: program.name } };
    },
    // The proposed edit against the saved text, checked by the same rules a save is (validateBlocks), line by line.
    'prompt-change'(card) {
      if (!promptAccess?.edit) return null;
      const named = (card.actionIndexes || []).find((at) => actions[at]?.kind === 'edit-prompt');
      const index = named ?? actions.findIndex((row) => row.kind === 'edit-prompt');
      return index >= 0 && actions[index]?.prompt ? helpPromptChange(card, actions[index].prompt, index, promptAccess) : null;
    },
    // One report section's new text against the saved report, line by line, for a report Ask AI read for this answer.
    'report-change'(card) {
      const named = (card.actionIndexes || []).find((at) => actions[at]?.kind === 'edit-report');
      const index = named ?? actions.findIndex((row) => row.kind === 'edit-report');
      return index >= 0 ? helpReportChange(card, actions[index], index, lookups) : null;
    },
  };
  const out = [];
  for (const card of Array.isArray(cards) ? cards : []) {
    const built = builders[card?.type] ? helpSafe(() => builders[card.type](card)) : helpAssistant.modelCard(card, actions);
    if (built) out.push(built);
  }
  // Ids a card found, copied onto the buttons it points at that don't have them yet (never onto one with candidates).
  const CARD_IDS = {
    report: (data) => ({ assetId: data.assetId }),
    'asset-folder': (data) => ({ folderKey: data.sourceKey }),
    run: (data) => ({ runId: data.runId }),
    program: (data) => ({ programId: data.programId }),
    trend: (data) => ({ themeId: data.themeId, runId: data.runId }),
  };
  const CARD_KINDS = { report: ['open', 'make-assets', 'set-status', 'edit-report', 'copy', 'export-run', 'publish-docs'], 'asset-folder': ['open', 'finish-assets', 'save-folder', 'copy'], run: ['stop-run', 'retry-run'], program: ['start-research'], trend: ['approve-trend', 'pass-trend', 'undo-trend'] };
  for (const card of out) {
    const ids = CARD_IDS[card.type]?.(card.data || {}); if (!ids) continue;
    for (const at of card.actionIndexes) {
      const action = actions[at];
      if (!action || action.candidates || !CARD_KINDS[card.type].includes(action.kind)) continue;
      // A trend card stamps a decision button only when the card's trend is still waiting (or decided) in that run.
      if (card.type === 'trend' && !['waiting', 'approved', 'passed'].includes(card.data.stage)) continue;
      for (const [key, value] of Object.entries(ids)) if (value && !action[key]) action[key] = value;
    }
  }
  const inPlan = new Set(out.filter((card) => card.type === 'plan').flatMap((card) => card.actionIndexes));
  actions.forEach((action, index) => {
    const has = (type) => out.some((card) => card.type === type && card.actionIndexes.includes(index));
    let built = null;
    if (action.candidates?.length) built = has('choice') ? null : helpChoiceCard(action, index);
    else {
      const type = action.kind === 'quick-scan' ? 'scan-plan' : action.kind === 'edit-prompt' ? 'prompt-change' : action.kind === 'edit-report' ? 'report-change' : !inPlan.has(index) && helpNeedsForm(action) ? 'action' : '';
      if (!type || has(type)) return;
      built = type === 'action' ? helpSafe(() => helpActionCard(action, index)) : helpSafe(() => builders[type]({ type, ref: action.target, title: '', note: '', actionIndexes: [index] }));
    }
    if (!built) return;
    // The form or the choice has the button now; the other cards keep showing the item without it.
    if (['action', 'choice'].includes(built.type)) for (const card of out) if (card.type !== 'plan') card.actionIndexes = card.actionIndexes.filter((at) => at !== index);
    out.push(built);
  });
  // A prompt-change or report-change card that found no edit (a second one, or one the model wrote alone) was dropped.
  return out.slice(0, 6);
}
// When a button's inputs need the person's eye before anything is saved (ask-actions.json form): always, or when Ask AI
// filled in a note, channels or a link. Published always asks for the live link.
function helpNeedsForm(action) {
  const spec = helpAssistant.CATALOG[action.kind]; const params = action.params || {};
  if (!spec || spec.form === 'never') return false;
  if (spec.form === 'always') return true;
  if (action.kind === 'set-status') return !params.status || params.status === 'published' || Boolean(params.link);
  return Object.keys(params).some((key) => !['run', 'type', 'what'].includes(key)) || Boolean(action.problems?.length);
}
const HELP_FIELD_LABELS = { note: 'Note for the channels', channels: 'Channels', channel: 'Channel', status: 'Status', link: 'Live link', date: 'Planned date' };
const HELP_FIELD_KIND_LABELS = { 'pass-trend': { note: 'Why you’re skipping it' }, 'mark-used': { note: 'Note', status: 'Answer' } };
const HELP_OPTION_LABELS = { draft: 'Draft', 'in-review': 'In review', approved: 'Approved', scheduled: 'Scheduled', published: 'Published', using: 'Using it', 'not-using': 'Not for us', clear: 'Clear the answer' };
// The action form card: what Ask AI filled in, as fields the person can change ({ key, type, label, value, options,
// max }), with anything the cleaner left out (problems). Its button runs the same action with the edited params.
function helpActionCard(action, index) {
  const spec = helpAssistant.CATALOG[action.kind]; const params = action.params || {};
  const channels = helpChannels().map(({ id, name }) => ({ value: id, label: name }));
  const labels = { ...HELP_FIELD_LABELS, ...(HELP_FIELD_KIND_LABELS[action.kind] || {}) };
  const fields = Object.entries(spec.params || {}).filter(([key]) => labels[key]).map(([key, type]) => {
    const [kind, ...rest] = String(type).split(':');
    const options = kind === 'channels' || kind === 'channel' ? channels : kind === 'enum' ? rest.join(':').split('|').map((value) => ({ value, label: HELP_OPTION_LABELS[value] || value })) : [];
    const fallback = kind === 'channels' ? [] : kind === 'enum' && action.kind === 'mark-used' && key === 'status' ? 'using' : '';
    return { key, type: kind, label: labels[key], value: params[key] ?? fallback, options, ...(kind === 'text' ? { max: Number(rest[0]) || 280 } : {}) };
  });
  return { type: 'action', title: action.label, note: '', actionIndexes: [index], data: { kind: action.kind, title: action.title || action.target || '', fields, problems: action.problems || [], spends: Boolean(spec.spends), confirm: spec.confirm } };
}
// Two or more items matched a button's target: the person picks one, and the button runs with its ids. No AI call.
function helpChoiceCard(action, index) {
  return { type: 'choice', title: `Which “${String(action.target || action.label).slice(0, 80)}” did you mean?`, note: '', actionIndexes: [index], data: { pick: true, options: action.candidates.map((row) => ({ label: row.title, detail: row.detail || '', ids: row.ids })) } };
}
const HELP_DIFF_LINES = 600;
// One edit-prompt proposal as its card: { promptId, promptName, blockId, blockLabel, version, nextVersion, diff, added,
// removed, problems, locked, canApply, text, note }. canApply needs no problems, someone who may save prompts, and no lock
// unless they're an admin. Apply (chat-cards.jsx) sends expectedVersion = version, so a save in between is refused.
function helpPromptChange(card, proposal, index, promptAccess) {
  const listed = contentWorkspace.listPrompts(); const editionId = listed.editionId;
  const row = listed.prompts.find((entry) => entry.id === proposal.promptId);
  const entry = row && promptTemplate.registryFor(editionId).prompts.find((prompt) => prompt.id === row.id);
  const block = entry?.blocks.find((part) => part.id === proposal.blockId && part.editable);
  if (!block) return null;
  const current = contentWorkspace.promptEffective(row.id);
  const before = promptTemplate.normalize(current.blocks?.[block.id] ?? promptTemplate.defaultText(row.id, block.id, editionId) ?? '');
  const after = promptTemplate.normalize(proposal.text);
  const problems = promptTemplate.validateBlocks(row.id, editionId, { [block.id]: after }).map((problem) => problem.message);
  if (before === after) problems.unshift('This is already what the prompt says, so there’s nothing to apply.');
  const lockedOut = Boolean(row.locked) && !promptAccess.admin;
  const diff = promptTemplate.lineDiff(before, after);
  const version = Number(current.version ?? row.version) || 0;
  return {
    type: 'prompt-change', title: card.title || row.name, note: card.note || '', actionIndexes: [index],
    data: { promptId: row.id, promptName: row.name, blockId: block.id, blockLabel: block.label, version, nextVersion: version + 1, diff: diff.slice(0, HELP_DIFF_LINES), ...(diff.length > HELP_DIFF_LINES ? { diffShortened: diff.length } : {}), added: diff.filter((line) => line.op === 'add').length, removed: diff.filter((line) => line.op === 'del').length, problems: problems.slice(0, 8), locked: Boolean(row.locked), canApply: !problems.length && !lockedOut && Boolean(promptAccess.edit), text: after, note: proposal.note || '' },
  };
}

// One edit-report proposal as its card: the section Ask AI rewrote, against the saved report (edits included), as a line
// diff, with the whole new report text Apply saves through editStudioAsset with baseEditedAt, so someone else's save in
// between is refused rather than overwritten. Only for a report Ask AI read with a report lookup for this answer, and a
// heading that is really in it. { assetId, title, section, diff, added, removed, markdown, baseEditedAt, editedBy,
// problems, canApply, note }.
const HELP_HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const helpHeadingText = (line) => helpNorm(String(line).replace(/[*_`]+/g, '').replace(/\s+#+\s*$/, ''));
function helpReportChange(card, action, index, lookups = []) {
  const change = action?.report; if (!change || !action.assetId) return null;
  const read = (lookups || []).some((row) => row?.kind === 'report' && row.found && [action.title, change.title, action.target].some((name) => name && helpNorm(row.title) === helpNorm(name)));
  if (!read) return null;
  const result = contentWorkspace.readStudioAsset({ assetId: action.assetId });
  const markdown = String(result?.markdown || '').replace(/\r\n?/g, '\n');
  if (!markdown || markdown.length > 60000) return null;
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) => { const match = HELP_HEADING.exec(line); return match && helpHeadingText(match[2]) === helpHeadingText(change.section); });
  if (start < 0) return null;
  const level = HELP_HEADING.exec(lines[start])[1].length;
  let end = lines.findIndex((line, at) => at > start && (HELP_HEADING.exec(line)?.[1].length || 7) <= level); if (end < 0) end = lines.length;
  const before = lines.slice(start + 1, end).join('\n').trim(); const after = change.text.trim();
  const next = [...lines.slice(0, start + 1), '', after, ...(end < lines.length ? ['', ...lines.slice(end)] : [''])].join('\n').replace(/\n{3,}/g, '\n\n');
  const problems = [];
  if (before === after) problems.push('This is already what the section says, so there’s nothing to apply.');
  if (next.length > 250000) problems.push('The report would be over 250,000 characters.');
  const diff = promptTemplate.lineDiff(before, after);
  const asset = result.asset || {};
  return {
    type: 'report-change', title: card.title || `${asset.title || change.title} › ${HELP_HEADING.exec(lines[start])[2]}`.slice(0, 120), note: card.note || '', actionIndexes: [index],
    data: { assetId: action.assetId, title: asset.title || change.title, section: HELP_HEADING.exec(lines[start])[2].replace(/[*_`]+/g, ''), diff: diff.slice(0, HELP_DIFF_LINES), ...(diff.length > HELP_DIFF_LINES ? { diffShortened: diff.length } : {}), added: diff.filter((line) => line.op === 'add').length, removed: diff.filter((line) => line.op === 'del').length, markdown: next, baseEditedAt: asset.edited?.at || '', editedBy: asset.edited?.by?.name || '', problems, canApply: !problems.length, note: change.note || '' },
  };
}

// ── Ask AI: questions, conversations and memory ──
// Every help:* handler reads the caller's identity at entry: nobody reads another person's conversations or memory, and
// View as never changes whose they are.
const ASK_REQUEST_ID = /^[A-Za-z0-9-]{8,100}$/; // the job id is help-<requestId>, which cancel-job accepts
const askFail = (message, status = 400) => Object.assign(new Error(message), { status });
const askInput = (payload) => (payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {});
const askingNow = new Map(); // `${identityId} ${requestId}` → { question, work }: a repeat of a request in flight joins it
const askingIn = new Set(); // conversations with a question in progress
function askIdentityId() { const id = access.identityForCall()?.id; if (!id) throw askFail('Sign in to use Ask AI.', 403); return id; }
function askQuestion(value) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error('Type a question first.');
  if (text.length > 2000) throw new Error('Keep the question under 2,000 characters.');
  return text;
}
// Where they asked from, stored with their message and read by helpContext.
function askPage(page) {
  const view = askInput(page); const text = (value, max) => String(value ?? '').slice(0, max);
  // trend and prompt: the trend selected on Trends and the prompt open in Prompts, so "this trend" and "this prompt" work.
  return { ...(view.id ? { id: text(view.id, 40) } : {}), ...(view.label ? { label: text(view.label, 80) } : {}), layout: view.layout === 'classic' ? 'classic' : 'simple', ...(view.tab ? { tab: text(view.tab, 20) } : {}), ...(view.report ? { report: text(view.report, 160) } : {}), ...(view.folder ? { folder: text(view.folder, 160) } : {}), ...(view.trend ? { trend: text(view.trend, 160) } : {}), ...(view.prompt ? { prompt: text(view.prompt, 120) } : {}) };
}
// Live names a memory can mention (recall boosts those): programs, recent trends and report titles.
function askNames() {
  const studio = contentWorkspace.publicState();
  return [...(studio.programs || []).map((program) => program.name), ...(studio.researchRuns || []).slice(0, 8).flatMap((run) => helpThemes(run).map((theme) => theme.name)), ...(studio.assets || []).filter((asset) => asset.kind === 'text').slice(0, 60).map((asset) => asset.title)].filter(Boolean);
}

// One answer as a cancellable job. `stop` sits in apiRequests under the job id, so the tray's Cancel (cancel-job) and
// quitting call its abort(), which stops whichever Claude or Codex call is running; nothing is saved. Each question gets
// its own folder, removed afterwards, so two people's answers (and Codex's files) never cross.
// `reach` ({ allowed, hiddenPages, costs, drive, admin }, from help:ask) is what this person's role opens; `related`
// earlier conversations that match the question.
async function answerHelp({ question, page, history = [], role, jobId, identityId = '', workspaceId = '', conversationId = '', memory = [], summary = '', pending = [], promptAccess = null, reach = null, checkModel = false, related = [] }) {
  const model = loadData().settings.aiModel || DEFAULT_CLAUDE_MODEL;
  // The per-call cap grows with the model's input price, so the app guide in the prefix fits on Fable or Mythos as it
  // does on the default model (the API route checks the estimate before sending).
  const helpBudgetUsd = Math.min(100, Math.round(0.75 * Math.max(1, modelPrice(model).input / modelPrice(DEFAULT_CLAUDE_MODEL).input) * 100) / 100);
  const dir = dataPath('help', 'calls', randomUUID()); fs.mkdirSync(dir, { recursive: true });
  const calls = new Set(); const used = [];
  const stop = { aborted: false, abort() { if (stop.aborted) return; stop.aborted = true; for (const key of calls) { cancelledJobs.add(key); jobProcesses.get(key)?.kill('SIGTERM'); apiRequests.get(key)?.abort(); } } };
  apiRequests.set(jobId, stop);
  startJob({ id: jobId, kind: 'chat', title: 'Ask AI answer', cancellable: true, status: 'running', startedAt: now(), ownerId: identityId });
  try {
    // A stored conversation's question checks the model first (a model this route can't use is caught before anything is
    // paid for), after the job is registered so Stop works during the check too.
    if (checkModel) { await aiRoutes.preflight([model]); if (stop.aborted) throw new Error('Job cancelled.'); }
    const programs = (contentWorkspace.publicState().programs || []).map(({ id, name, updatedAt, createdAt }) => ({ id, name, updatedAt: updatedAt || createdAt || '' }));
    // Ask AI's own prompt as this workspace saved it in Prompts (assistant.ask-ai; null = the defaults). The API route caches
    // the prefix by its text, so a saved change starts a new cache entry by itself.
    const blocks = helpSafe(() => contentWorkspace.promptEffective('assistant.ask-ai').blocks);
    const admin = Boolean(reach?.admin) || !reach;
    const reply = await helpAssistant.askHelp({ question, history, page }, {
      guide: appGuide(), context: (view) => helpContext(view, role, promptAccess, { admin }), role, imagesOn: Boolean(getKey('OPENAI_API_KEY')), imageSizes: HELP_IMAGE_SIZES, memory, summary, pending, programs, blocks, promptAccess, access: reach, related,
      // What action params are checked against: this workspace's channels, the studio's roles (admins), and today.
      params: { channels: helpChannels(), roles: admin ? helpRoleOptions() : [], today: new Date() },
      readLookup: (lookup) => helpLookup(lookup, { identityId, workspaceId, conversationId, recalled: memory.map((item) => item.id), promptAccess, role, costs: reach?.costs !== false }),
      resolve: ({ actions, answer }) => helpResolveActions({ actions, answer }, { promptAccess, admin, role }),
      hydrate: ({ cards, actions, lookups }) => hydrateCards(cards, { actions, lookups, promptAccess }),
      // Medium effort reads the guide and live context carefully; a question that needs a lookup makes a second call.
      // The instructions, spots and guide are the cached prefix on the API route.
      generate: async ({ schema, prefix, body, round }) => {
        if (stop.aborted) throw new Error('Job cancelled.');
        const key = `${jobId}::${round}`; calls.add(key); used.push(key);
        try { return await generateStructuredOutput({ schema, prompt: body, cachePrefix: prefix, workspaceDir: dir, outputPath: path.join(dir, round ? 'answer-read.json' : 'answer.json'), jobId: key, maxBudgetUsd: helpBudgetUsd, model, effort: 'medium', timeoutMs: 180000 }); }
        finally { calls.delete(key); }
      },
    });
    if (stop.aborted) throw new Error('Job cancelled.');
    finishJob(jobId, { status: 'succeeded' });
    return reply;
  } catch (error) {
    failJob(jobId, error);
    if (stop.aborted) throw new Error('Ask AI stopped. Nothing was saved; ask again when you’re ready.');
    throw error;
  } finally {
    if (apiRequests.get(jobId) === stop) apiRequests.delete(jobId);
    for (const key of [jobId, ...used]) cancelledJobs.delete(key);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// A question in a stored conversation (or the first of a new one). A stored conversation's history comes from its own
// messages, never from the page: the last 8, the rolling summary of what came before, and what happened to earlier
// buttons. Only a new conversation takes the page's `history` (an older caller's turns). The person's message and the
// reply are saved together once the answer is in, with anything Ask AI remembered.
async function askInConversation({ identityId, role, promptAccess, reach, question, requestId, conversationId, page, context, history }) {
  const workspaceId = contentWorkspace.activeWorkspaceId();
  const conversation = conversationId ? askStore.readConversation(identityId, conversationId) : null;
  if (conversationId && !conversation) throw askFail('That conversation isn’t available anymore. Start a new one.', 404);
  if (conversation && conversation.workspaceId !== workspaceId) throw askFail('This conversation belongs to another workspace. Switch back to it, or start a new conversation here.', 409);
  if (conversation && askingIn.has(conversation.id)) throw askFail('Ask AI is still answering in this conversation. Wait for it, or stop it first.', 409);
  const past = conversation ? askHistory(conversation) : { summary: '', turns: Array.isArray(history) ? history : [], pending: [], coverThrough: '' };
  if (conversation) askingIn.add(conversation.id);
  try {
    const memory = askStore.recall(identityId, { workspaceId, query: [question, page.tab, page.report, page.folder, page.trend, page.prompt].filter(Boolean).join(' '), names: askNames(), limit: 12, maxChars: 2500 });
    // Earlier conversations about the same thing, found for free (BM25 over this person's own messages), so a decision
    // made last week comes up without a lookup.
    const related = helpSafe(() => askStore.searchConversations(identityId, [question, page.trend, page.report].filter(Boolean).join(' '), 2, { workspaceId, exclude: conversation?.id || '', minScore: 3 }), []);
    const reply = await answerHelp({ question, page, history: [...past.turns, ...(context ? [{ role: 'user', content: context }] : [])], role, promptAccess, reach, checkModel: true, jobId: `help-${requestId}`, identityId, workspaceId, conversationId: conversation?.id || '', memory, summary: past.summary, pending: past.pending, related });
    return askStore.appendTurn(identityId, {
      conversationId: conversation?.id || '', workspaceId,
      user: { content: question, context, page, requestId },
      assistant: { content: reply.answer, pages: reply.pages, followUps: reply.followUps, actions: reply.actions, show: reply.show, image: reply.image ? { ...reply.image, status: 'creating' } : null, cards: reply.cards, read: reply.read, receipt: reply.receipt, ...(reply.unresolved?.length ? { unresolved: reply.unresolved } : {}) },
      remember: reply.remember, summary: past.pending.length && reply.summary ? { text: reply.summary, through: past.coverThrough } : null, title: conversation ? '' : reply.title,
    });
  } finally { if (conversation) askingIn.delete(conversation.id); }
}

// payload: { question, conversationId?, requestId, page, context? } → { conversation, userMessage, message }. Older callers
// that send neither requestId nor conversationId pass their own history and get the bare reply, and nothing is stored.
handle('help:ask', async (_, payload = {}) => {
  // Read at entry: an editor's answer never points at admin-only places, and prompt edits are offered only to people
  // who may save prompts.
  const viewer = access.currentViewer(); const role = viewer.role; const promptAccess = helpPromptAccess(viewer);
  // Buttons and page links only for what this role opens (an admin: everything). In a preview, the previewed role's
  // methods, so the admin sees what that person would (the buttons then say it's a preview).
  // costs: whether they may see costs (the spend lookup); drive: whether Google Drive publishing is connected; admin:
  // the team in LIVE CONTEXT and the admin-only buttons (View as, invites) resolve.
  const admin = viewer.base === 'admin';
  const reach = { allowed: admin ? null : viewer.preview ? viewer.roleAllowed || viewer.allowed : viewer.allowed, hiddenPages: admin ? [] : viewer.hiddenPages, costs: admin || (Array.isArray(viewer.capabilities) && viewer.capabilities.includes('seeCosts')), drive: Boolean(helpSafe(() => contentWorkspace.publicState().capabilities?.googlePublishConfigured)), admin };
  const input = askInput(payload);
  if (input.requestId == null && input.conversationId == null) {
    const question = askQuestion(input.question);
    const reply = await answerHelp({ question, page: input.page, history: input.history, role, promptAccess, reach, jobId: `help-${randomUUID()}`, identityId: access.identityForCall()?.id || '', workspaceId: contentWorkspace.activeWorkspaceId() });
    const { answer, pages, followUps, actions, image, show, read, receipt } = reply;
    return { answer, pages, followUps, actions, image, show, read, receipt };
  }
  const identityId = askIdentityId(); const question = askQuestion(input.question);
  const requestId = input.requestId == null ? randomUUID() : String(input.requestId);
  if (!ASK_REQUEST_ID.test(requestId)) throw askFail('Invalid question request ID.');
  // The same request never pays twice: one still running is joined, one already answered returns its stored reply.
  const key = `${identityId} ${requestId}`; const running = askingNow.get(key);
  if (running) { if (running.question !== question) throw askFail('Use a new request ID for a different question.'); return running.work; }
  const stored = askStore.findByRequest(identityId, requestId);
  if (stored) { if (stored.userMessage.content !== question) throw askFail('Use a new request ID for a different question.'); return stored; }
  const work = askInConversation({ identityId, role, promptAccess, reach, question, requestId, conversationId: String(input.conversationId || ''), page: askPage(input.page), context: String(input.context || '').slice(0, 3900), history: input.history }).finally(() => askingNow.delete(key));
  askingNow.set(key, { question, work });
  return work;
});
const askConversationId = (input) => String(input.conversationId ?? input.id ?? '');
handle('help:conversations', (_, payload = {}) => {
  const identityId = askIdentityId(); const input = askInput(payload); const workspaceId = contentWorkspace.activeWorkspaceId();
  return { workspaceId, conversations: askStore.listConversations(identityId, { workspaceId: input.allWorkspaces === true ? '' : workspaceId, limit: input.limit }) };
});
handle('help:conversation', (_, payload = {}) => {
  const conversation = askStore.readConversation(askIdentityId(), askConversationId(askInput(payload)));
  if (!conversation) throw askFail('That conversation isn’t available anymore.', 404);
  const { version, summaryThrough, ...rest } = conversation;
  return { conversation: rest };
});
handle('help:rename-conversation', (_, payload = {}) => { const input = askInput(payload); return { conversation: askStore.renameConversation(askIdentityId(), { conversationId: askConversationId(input), title: input.title, pinned: input.pinned }) }; });
handle('help:delete-conversation', (_, payload = {}) => askStore.deleteConversation(askIdentityId(), askConversationId(askInput(payload))));
// What happened after an answer: { conversationId, messageId, index, outcome:{ status:'done'|'failed'|'cancelled', text } }
// for a button, or { conversationId, messageId, outcome:{ kind:'image', imageId, status } } once its picture is drawn.
handle('help:outcome', (_, payload = {}) => { const input = askInput(payload); return { message: askStore.recordOutcome(askIdentityId(), { conversationId: askConversationId(input), messageId: input.messageId, index: input.index, outcome: input.outcome, imageId: input.imageId }) }; });
handle('help:memory', (_, payload = {}) => ({ items: askStore.listMemory(askIdentityId(), { workspaceId: contentWorkspace.activeWorkspaceId(), includeForgotten: askInput(payload).includeForgotten === true }), limit: MAX_ACTIVE_MEMORY }));
handle('help:save-memory', (_, payload = {}) => ({ item: askStore.saveMemory(askIdentityId(), askInput(payload), { workspaceId: contentWorkspace.activeWorkspaceId() }) }));
handle('help:forget-memory', (_, payload = {}) => ({ item: askStore.forgetMemory(askIdentityId(), String(askInput(payload).id || '')) }));

// Pictures from the Ask AI drawer (help-images.js), through the same image provider as Create content.
let helpImageStore = null;
const helpImages = () => (helpImageStore ||= require('./help-images').createHelpImages({ generateImage: (request) => imageProvider.generateImage(request), dir: dataPath('help', 'images'), isConfigured: () => Boolean(getKey('OPENAI_API_KEY')) }));
handle('help:image', (_, payload = {}) => helpImages().create({ prompt: payload.prompt, size: payload.size, title: payload.title }));
handle('help:images', () => helpImages().list());
handle('help:read-image', (_, payload = {}) => helpImages().read(payload.id));
handle('help:save-image', async (_, payload = {}) => {
  const { path: source, title } = helpImages().pngPath(payload.id);
  const fileName = `${title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Ask AI picture'}.png`;
  const choice = await dialog.showSaveDialog(mainWindow, { title: 'Save picture', buttonLabel: 'Save', defaultPath: path.join(app.getPath('downloads'), fileName), filters: [{ name: 'PNG image', extensions: ['png'] }] });
  if (choice.canceled || !choice.filePath) return { cancelled: true };
  const target = /\.png$/i.test(choice.filePath) ? choice.filePath : `${choice.filePath}.png`;
  fs.copyFileSync(source, target);
  return forBrowser({ fileName: path.basename(target), path: target });
});

// ── Team: people, roles and access, sign-in links, View as, preferences, trend answers, analytics ─────────────
const { readyTrends } = require('./channel-view');
const { buildTrendAnalytics } = require('./team-analytics');
const { accessLogRows } = require('./access-log');
const { auditForMember } = require('./team-store');
const objectPayload = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
const refuse = (message, status, code) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
// STUDIO_LINK_DAYS: how long a new sign-in link works (0 = until it's replaced or turned off); 30 when unset or invalid.
function linkDays() { const raw = String(process.env.STUDIO_LINK_DAYS ?? '').trim(); const days = raw === '' ? 30 : Number(raw); return Number.isFinite(days) && days >= 0 ? days : 30; }
// Company sign-in (a trusted proxy header) or the admin password with personal sign-in links. Links only exist without SSO.
// The server keeps the admin password out of process.env (scripts/studio-web.cjs), so it tells the web runtime it has one.
function signInSettings() {
  const sso = WEB_RUNTIME && Boolean(String(process.env.STUDIO_TRUSTED_EMAIL_HEADER || '').trim());
  const password = WEB_RUNTIME && (Boolean(process.env.STUDIO_PASSWORD) || require('./web-runtime').settings?.passwordSignIn === true);
  return { web: WEB_RUNTIME, sso, links: WEB_RUNTIME && !sso && password, linkDays: linkDays() };
}
// A member as People shows them: their role (an id), its label and base, their own access changes and what they can
// do with them. Never the link's hash.
function memberView(member) {
  const policy = teamStore.accessPolicy(); const def = policy.roles.get(member.role) || null;
  return {
    id: member.id, name: member.name, email: member.email || '', role: member.role, roleLabel: def?.label || 'Removed role', base: def?.base || null,
    grants: [...(member.grants || [])], denies: [...(member.denies || [])], capabilities: roles.capabilitiesFor({ roleId: member.role, grants: member.grants, denies: member.denies }, policy),
    channelId: member.channelId ?? null, disabled: Boolean(member.disabled), createdAt: member.createdAt || '', lastSeenAt: member.lastSeenAt || '', serverAdmin: Boolean(member.serverAdmin),
    link: member.link ? { createdAt: member.link.createdAt || '', expiresAt: member.link.expiresAt ?? null, lastUsedAt: member.link.lastUsedAt || '' } : null,
  };
}
const channelList = () => roles.channelsFor(contentWorkspace.activeEditionId());
// Owners are everyone enabled whose role is built on Channel owner, custom channel roles included.
function teamChannels() {
  const members = teamStore.listMembers().map(memberView);
  return channelList().map((channel) => ({ ...channel, owners: members.filter((member) => member.base === 'channel' && member.channelId === channel.id && !member.disabled).map(({ id, name }) => ({ id, name })) }));
}
// The page's own address for a sign-in link: the request's Origin (already checked by studio-server), else STUDIO_PUBLIC_ORIGIN.
function linkOrigin() {
  const origin = String(require('./web-runtime').currentCall()?.origin || process.env.STUDIO_PUBLIC_ORIGIN || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^/\s?#]+$/i.test(origin)) throw refuse('Open the studio in your browser to make a sign-in link.', 400);
  return origin;
}
// What the analytics log records about a person: role is the base ("an editor", "a channel owner for …"), with the role
// itself and its label for custom roles.
function memberActivity(member, action) {
  const view = memberView(member);
  return { memberId: member.id, name: member.name, action, role: view.base, roleId: member.role, roleLabel: view.roleLabel, channelId: member.channelId ?? null };
}
const roleLabelOf = (id) => teamStore.roleLabel(id);
handle('team:list', () => ({ members: teamStore.listMembers().map(memberView), channels: teamChannels(), signIn: signInSettings(), access: teamStore.accessSummary() }));
// Handlers that change people report what changed under `activity` (analytics) and `audit` (the access log); the gate
// writes both and removes them from the result.
handle('team:save-member', (_, payload = {}) => {
  const input = objectPayload(payload);
  const fields = Object.fromEntries(['id', 'name', 'email', 'role', 'channelId', 'disabled'].filter((key) => input[key] !== undefined).map((key) => [key, input[key]]));
  const before = fields.id ? teamStore.memberById(fields.id) : null;
  const member = teamStore.saveMember(fields, access.identityForCall());
  emitState(); // their role, the admin list and channel coverage change for everyone at once
  const action = !before ? 'added' : member.disabled !== before.disabled ? (member.disabled ? 'disabled' : 'enabled') : 'changed';
  const row = auditForMember(before, member, roleLabelOf);
  return { member: memberView(member), activity: memberActivity(member, action), audit: row ? [row] : [] };
});
handle('team:remove-member', (_, payload = {}) => {
  const removed = teamStore.removeMember(String(objectPayload(payload).id || ''), access.identityForCall());
  askStore.purge(removed.id); // their Ask AI conversations and memory go with them
  emitState();
  return { ok: true, activity: memberActivity(removed, 'removed'), audit: [auditForMember(removed, null, roleLabelOf)] };
});
// A new link replaces the old one: every browser that used the old link is signed out (its live updates end at this
// broadcast). The token appears only in this answer; team.json keeps its hash.
handle('team:sign-in-link', (_, payload = {}) => {
  if (!WEB_RUNTIME) throw refuse(roles.COPY.linksWebOnly, 400, 'linksWebOnly');
  if (!signInSettings().links) throw refuse('This studio signs in through your company login, so people don’t need sign-in links.', 400);
  const origin = linkOrigin();
  const { token, link, member } = teamStore.issueLink(String(objectPayload(payload).id || ''), access.identityForCall(), { days: linkDays() });
  emitState();
  return { url: `${origin}/#signin=${token}`, expiresAt: link.expiresAt ?? null, activity: { memberId: member.id, name: member.name }, audit: [{ kind: 'link-issued', target: { type: 'member', id: member.id, name: member.name }, changes: [], affected: 1 }] };
});
handle('team:revoke-link', (_, payload = {}) => {
  const id = String(objectPayload(payload).id || ''); const before = teamStore.memberById(id);
  const member = teamStore.revokeLink(id, access.identityForCall());
  emitState();
  return { ok: true, audit: before?.link ? [{ kind: 'link-revoked', target: { type: 'member', id: member.id, name: member.name }, changes: [], affected: 1 }] : [] };
});
// Role policy: what Editor and Channel owner can do, custom roles, and one person's own access. Each change bumps the
// policy's rev (a stale page gets policyConflict) and reaches everyone's state at once.
handle('team:role-policy', (_, payload = {}) => { const result = teamStore.saveRolePolicy(objectPayload(payload), access.identityForCall()); if (result.audit.length) emitState(); return result; });
handle('team:save-role', (_, payload = {}) => { const result = teamStore.saveRole(objectPayload(payload), access.identityForCall()); emitState(); return result; });
handle('team:delete-role', (_, payload = {}) => { const result = teamStore.deleteRole(objectPayload(payload), access.identityForCall()); emitState(); return result; });
handle('team:member-access', (_, payload = {}) => {
  const input = objectPayload(payload);
  const { member, audit } = teamStore.saveMemberAccess({ id: input.id, grants: input.grants, denies: input.denies }, access.identityForCall());
  if (audit.length) emitState();
  return { member: memberView(member), audit };
});
// Invite people: up to 50 emails with one role and channel. Where people sign in with personal links (the browser
// studio with the admin password), each gets one in the same write; with company sign-in they just sign in.
handle('team:invite', (_, payload = {}) => {
  const input = objectPayload(payload); const signIn = signInSettings();
  const makeLinks = input.makeLinks !== false && signIn.links;
  const origin = makeLinks ? linkOrigin() : '';
  const result = teamStore.inviteMembers({ people: input.people, role: input.role, channelId: input.channelId, grants: input.grants, denies: input.denies, makeLinks, linkDays: linkDays() }, access.identityForCall());
  if (result.members.length) emitState();
  const names = new Map(result.members.map((member) => [member.id, member.name]));
  return {
    members: result.members.map(memberView), links: result.links.map((link) => ({ id: link.id, url: `${origin}/#signin=${link.token}`, expiresAt: link.expiresAt ?? null })), skipped: result.skipped, signIn,
    activity: [...result.members.map((member) => ({ kind: 'member-changed', detail: memberActivity(member, 'added') })), ...result.links.map((link) => ({ kind: 'link-issued', detail: { memberId: link.id, name: names.get(link.id) || '' } }))],
    audit: result.audit,
  };
});
// The access log, newest first, in sentences (src/main/access-log.js). `next` pages to older rows.
handle('team:access-log', (_, payload = {}) => {
  const input = objectPayload(payload); const text = (value) => (typeof value === 'string' ? value : '');
  const page = teamStore.auditFor({ before: text(input.before), limit: input.limit, memberId: text(input.memberId), roleId: text(input.roleId), kinds: Array.isArray(input.kinds) ? input.kinds : [] });
  return { rows: accessLogRows(page.rows, { channels: channelList(), roleLabel: roleLabelOf }), more: page.more, next: page.next };
});
// What a role, a person or an unsaved set of changes would be able to do: a dry run of the same merge the gate uses, so
// People never repeats the rules. { role, grants?, denies? } | { memberId, grants?, denies? } | { base, capabilities }.
handle('team:preview-access', (_, payload = {}) => {
  const input = objectPayload(payload); const policy = teamStore.accessPolicy();
  let roleId = typeof input.role === 'string' ? input.role : ''; let { grants, denies } = input;
  if (typeof input.memberId === 'string' && input.memberId) {
    const member = teamStore.memberById(input.memberId);
    if (!member) throw refuse('That person isn’t in the studio anymore.', 404);
    roleId = roleId || member.role; if (grants === undefined) grants = member.grants; if (denies === undefined) denies = member.denies;
  }
  let base; let capabilities;
  if (Array.isArray(input.capabilities) && roles.ROLE_BASES.includes(input.base)) { base = input.base; capabilities = roles.settle(input.capabilities, base); }
  else {
    const def = policy.roles.get(roleId);
    if (!def) throw refuse('Choose a role to preview.', 400);
    base = def.base; capabilities = roles.capabilitiesFor({ roleId, grants: Array.isArray(grants) ? grants : [], denies: Array.isArray(denies) ? denies : [] }, policy);
  }
  const pages = roles.pagesFor(capabilities, base); const held = new Set(capabilities);
  const shown = roles.CAPABILITIES.filter((cap) => cap.lock !== 'always');
  // possible: how many things this kind of role could ever have, for "can do 15 of 22 things".
  const possible = shown.filter((cap) => base === 'admin' || (cap.lock !== 'admin' && cap.bases.includes(base))).length;
  return { base, capabilities, nav: pages.nav, hiddenPages: pages.hiddenPages, modes: pages.modes, can: shown.filter((cap) => held.has(cap.id)).map((cap) => cap.label), cannot: shown.filter((cap) => !held.has(cap.id)).map((cap) => cap.label), possible };
});
// View as: an admin's read-only preview, held on this session (the browser session, or this Mac app until it quits),
// never in team.json. It is a role ({ role, channelId? }, custom roles included) or one person ({ memberId }, with their
// own access changes). Admin ends it.
handle('team:view-as', (_, payload = {}) => {
  const input = objectPayload(payload); const session = access.sessionForCall();
  if (!session) throw refuse('Sign in to use the studio.', 403, 'forbidden');
  const policy = teamStore.accessPolicy();
  if (typeof input.memberId === 'string' && input.memberId) {
    const member = teamStore.memberById(input.memberId); const def = member ? policy.roles.get(member.role) : null;
    if (!member) throw refuse('That person isn’t in the studio anymore.', 404);
    if (!def || def.base === 'admin') throw refuse('Admins see what you see. Choose someone with another role.', 400);
    if (member.disabled) throw refuse('Turn this person back on to preview what they see.', 409);
    if (def.base === 'channel' && !roles.isChannelId(member.channelId)) throw refuse('Choose this person’s channel before previewing what they see.', 400);
    session.viewAs = { memberId: member.id };
  } else if (!input.role || input.role === 'admin') session.viewAs = null;
  else {
    const def = typeof input.role === 'string' ? policy.roles.get(input.role) : null;
    if (def?.base === 'editor') session.viewAs = { role: def.id };
    else if (def?.base === 'channel' && roles.isChannelId(input.channelId)) session.viewAs = { role: def.id, channelId: input.channelId };
    else throw refuse('Choose a role, a channel or a person to preview.', 400);
  }
  emitState();
  return { viewer: access.viewerFor(access.identityForCall(), session) };
});
// Per person: layout, the welcome card, when they last read the Inbox, their channels and the icon-only sidebar. On the
// Mac the layout is also kept in Settings, which the rest of the app reads.
handle('team:prefs', (_, payload = {}) => {
  const input = objectPayload(payload); const identity = access.identityForCall();
  const patch = Object.fromEntries(['uiMode', 'welcomedAt', 'inboxSeenAt', 'focusChannels', 'navRail'].filter((key) => input[key] !== undefined).map((key) => [key, input[key]]));
  const prefs = teamStore.setPrefs(identity.id, patch);
  if (!WEB_RUNTIME && patch.uiMode !== undefined && prefs.uiMode && loadData().settings.uiMode !== prefs.uiMode) { loadData().settings.uiMode = prefs.uiMode; saveData(); }
  emitState();
  return { viewer: access.currentViewer() };
});
// "Yes, I'm using this trend" / "Not for us" for one channel, with an optional link and planned date (YYYY-MM-DD). Only
// a trend whose brief is ready can be answered; its name is taken from the studio, not the request. A channel owner's
// channel is their own (the gate sets it); an admin may correct any channel's answer, and the change is logged.
handle('team:adoption', (_, payload = {}) => {
  const input = objectPayload(payload); const viewer = access.currentViewer(); const space = contentWorkspace.activeWorkspace();
  const trend = typeof input.themeId === 'string' ? readyTrends(contentWorkspace.trendSource()).find((row) => row.themeId === input.themeId) : null;
  if (!space || !trend) throw refuse('That trend’s brief isn’t ready yet, so it can’t be answered.', 404);
  const adoption = teamStore.setAdoption({ workspaceId: space.id, themeId: trend.themeId, channelId: input.channelId, status: input.status, link: input.link, note: input.note, plannedFor: input.plannedFor, trendName: trend.name }, access.identityForCall());
  emitState();
  return {
    adoption: adoption ? { themeId: adoption.themeId, channelId: adoption.channelId, status: adoption.status, link: adoption.link || '', note: adoption.note || '', plannedFor: adoption.plannedFor || '', at: adoption.at || adoption.updatedAt || null, byName: adoption.by?.name || '', byMe: adoption.by?.id === viewer.id } : null,
    activity: { themeId: trend.themeId, trendName: trend.name, channelId: input.channelId, status: input.status, link: adoption?.link || '', plannedFor: adoption?.plannedFor || '' },
  };
});
// Analytics counts owners by kind of role, so custom channel roles count as channel owners.
handle('team:analytics', (_, payload = {}) => {
  const input = objectPayload(payload); const space = contentWorkspace.activeWorkspace(); const workspaceId = space?.id || '';
  const members = teamStore.listMembers().map((member) => { const view = memberView(member); return { ...member, role: view.base || member.role, roleId: member.role, roleLabel: view.roleLabel }; });
  return buildTrendAnalytics({ contentStudio: contentWorkspace.publicState(), adoptions: teamStore.adoptionsFor(workspaceId), activity: teamStore.activityFor(workspaceId, 5000), members, editionId: space?.editionId, workspace: space, now: new Date(), days: Number(input.days) || 90, includeAll: input.includeAll === true });
});

// ── Share a setup ──────────────────────────────────────────────────────────────────────────────────
// Export writes one JSON file, optionally carrying the team's shared Apify token. Import previews first;
// the parsed file stays here in the main process until the person confirms, so a key never sits in the page.
const MAX_SETUP_FILE_BYTES = 26 * 1024 * 1024;
const SETUP_PREVIEW_TTL_MS = 30 * 60 * 1000;
const pendingSetups = new Map(); // preview token → { bundle, fileName, expires }
const setupFilters = [{ name: 'Scraper Studio setup', extensions: ['json'] }];
handle('setup:export', async (_, { includeApifyToken = false } = {}) => {
  const { attachSetupSecrets, summarizeSetupBundle } = require('../shared/setup-bundle');
  let bundle = contentWorkspace.exportSetup({ appVersion: app.getVersion() });
  if (includeApifyToken) {
    const token = getKey('APIFY_API_TOKEN');
    if (!token) throw new Error('No Apify token is saved on this Mac to include. Add it under Settings → Source collection first.');
    bundle = attachSetupSecrets(bundle, { APIFY_API_TOKEN: token });
  }
  const fileName = `${bundle.workspace.name} setup ${new Date().toISOString().slice(0, 10)}.json`.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ');
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, { title: 'Export setup', defaultPath: path.join(app.getPath('documents'), fileName), filters: setupFilters });
  if (canceled || !filePath) return { cancelled: true };
  fs.writeFileSync(filePath, `${JSON.stringify(bundle, null, 2)}\n`, { mode: bundle.secrets ? 0o600 : 0o644 });
  if (bundle.secrets) fs.chmodSync(filePath, 0o600); // `mode` applies only to a new file; an overwritten one keeps its old permissions
  return forBrowser({ fileName: path.basename(filePath), path: filePath, summary: summarizeSetupBundle(bundle).summary, includesApifyToken: Boolean(bundle.secrets?.APIFY_API_TOKEN) });
});
handle('setup:open', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, { title: 'Import setup', properties: ['openFile'], filters: setupFilters });
  if (canceled || !filePaths?.[0]) return { cancelled: true };
  const filePath = filePaths[0];
  if (fs.statSync(filePath).size > MAX_SETUP_FILE_BYTES) throw new Error('This file is too large to be a Scraper Studio setup.');
  const text = fs.readFileSync(filePath, 'utf8');
  const { validateSetupBundle } = require('../shared/setup-bundle');
  const bundle = validateSetupBundle(text); // readable errors for the wrong file, a newer format or a bad section
  const { summary, warnings } = contentWorkspace.previewSetup({ bundle });
  for (const [token, entry] of pendingSetups) if (entry.expires < Date.now()) pendingSetups.delete(token);
  const token = randomUUID();
  pendingSetups.set(token, { bundle, fileName: path.basename(filePath), expires: Date.now() + SETUP_PREVIEW_TTL_MS });
  return { token, fileName: path.basename(filePath), summary, warnings, apifyTokenIncluded: Boolean(bundle.secrets?.APIFY_API_TOKEN), apifyTokenSaved: Boolean(getKey('APIFY_API_TOKEN')) };
});
handle('setup:apply', async (_, { token, saveApifyToken = false } = {}) => {
  const pending = pendingSetups.get(String(token || ''));
  if (!pending || pending.expires < Date.now()) throw new Error('This preview has expired. Choose Import setup… and open the file again.');
  const apifyToken = saveApifyToken ? pending.bundle.secrets?.APIFY_API_TOKEN : '';
  const encryptedToken = apifyToken ? encryptValue(validateKeyValue('APIFY_API_TOKEN', apifyToken)) : ''; // fail before anything is imported
  const result = contentWorkspace.importSetup({ bundle: pending.bundle });
  pendingSetups.delete(token);
  if (encryptedToken) {
    const config = loadConfig();
    config.keys.APIFY_API_TOKEN = encryptedToken;
    if (config.disabledKeys) delete config.disabledKeys.APIFY_API_TOKEN;
    saveConfig();
  }
  emitState();
  return { fileName: pending.fileName, summary: result.summary, warnings: result.warnings, workspaceId: result.workspaceId, programIds: result.programIds, apifyTokenSaved: Boolean(getKey('APIFY_API_TOKEN')) };
});
handle('open-source-url', (_, value) => { const url = new URL(String(value)); if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Unsupported source link.'); return shell.openExternal(url.href); });
handle('check-codex', () => checkCodexCli());
handle('test-image-provider', () => imageProvider.checkAccess());
handle('plan-intent', (_, payload) => planIntentCommand(payload));
handle('run-intent', (_, payload) => runIntent(payload));
handle('run-intent-action', (_, payload) => runIntentAction(payload));

handle('save-key', (_, { keyName, value }) => {
  const validKey = validateKeyName(keyName, KEY_NAMES);
  const validValue = validateKeyValue(validKey, value);
  // A key saved under another STUDIO_SECRET_KEY is the only copy the original server key can still read: it is replaced
  // only after an admin clears it on purpose.
  if (keyProblem(validKey) === 'mismatch') throw Object.assign(new Error(`The saved ${KEY_LABELS[validKey] || validKey} was saved with a different STUDIO_SECRET_KEY, so it wasn’t replaced. Start the studio with the original STUDIO_SECRET_KEY to use it, or choose Clear for this key first and then save the new one.`), { status: 409, code: 'keyMismatch' });
  const config = loadConfig();
  config.keys[validKey] = encryptValue(validValue);
  if (config.disabledKeys) delete config.disabledKeys[validKey];
  saveConfig(); aiRoutes.invalidate();
  return publicState().keys;
});

handle('clear-key', (_, keyName) => {
  const validKey = validateKeyName(keyName, KEY_NAMES);
  const config = loadConfig();
  delete config.keys[validKey];
  config.disabledKeys = { ...(config.disabledKeys || {}), [validKey]: true };
  saveConfig(); aiRoutes.invalidate();
  return publicState().keys;
});

handle('save-settings', (_, settings) => {
  const data = loadData();
  data.settings = validateSettings(settings, data.settings);
  saveData(); aiRoutes.invalidate();
  emitState();
  return publicState();
});

handle('save-recipe', (_, payload) => {
  const data = loadData();
  const recipe = validateRecipe(payload, data.recipes.find((item) => item.id === payload?.id));
  upsertById(data.recipes, recipe);
  saveData();
  emitState();
  return publicRecipe(recipe);
});

handle('delete-recipe', (_, recipeId) => {
  const validRecipeId = validateId(recipeId, 'Recipe ID');
  const data = loadData();
  data.recipes = data.recipes.filter((recipe) => recipe.id !== validRecipeId);
  saveData();
  emitState();
  return publicState();
});

// Legacy surface (coherence review D7). No screen calls these methods any more: generateAssets, saveCard, moveCard,
// saveAsset, exportAssetPack, saveMission, listMissions, getJob, readEvidence, openAssetsFolder, setThemeStatus,
// readReferenceDoc and readStudioRun. They stay because the method manifest, the preload, roles.json and their tests
// (test/roles.test.js, test/web-parity.test.js) and docs/roles-and-access.md list them, and because Workflows uses the
// functions behind several: runIntent, runActionGraph, runMission and retryJob reach saveCard and generateAssets through
// executeIntentStep, and getJob backs retryJob and readJobLog. Known gap for the receiving team: generateAssets (and a
// Workflows plan with a generate-assets step) starts paid AI work with only the per-call aiMaxBudgetUsd cap and no
// estimate screen. Removing a method means taking it out of studio-api-channels.json, src/preload/index.js and
// roles.json together (test/roles.test.js keeps them in step).
handle('save-card', (_, payload) => saveCard(payload));
handle('move-card', (_, payload) => moveCard(payload));
handle('save-asset', (_, payload) => saveAsset(payload));
handle('generate-assets', (_, payload) => generateAssets(payload));
// recipeId, or { recipeId, requestId } so a retried request joins the run already going (onceForRequest).
handle('run-recipe', (_, payload) => { const input = typeof payload === 'string' ? { recipeId: payload } : payload || {}; return onceForRequest('runRecipe', input, () => runRecipe(validateId(input.recipeId, 'Recipe ID'))); });
handle('read-dataset', (_, datasetId) => readDatasetPayload(validateId(datasetId, 'Dataset ID')));
handle('export-dataset', (_, payload) => exportDataset(payload));
handle('test-sheets-bridge', () => testSheetsBridge());
handle('save-monday-board', (_, payload) => saveMondayBoard(payload));
handle('clear-monday-board', () => { const config = loadConfig(); delete config.monday; saveConfig(); emitState(); return publicState(); });
handle('sync-trend-board-to-monday', (_, payload) => syncTrendBoardToMonday(payload));
handle('archive-and-clear-sheets', (_, payload) => archiveAndClearSheets(payload));
handle('import-working-sheets', () => importWorkingSheets());
handle('export-dataset-to-sheets', (_, payload) => exportDatasetToSheets(payload));
handle('replay-sheet-run', (_, sheetRunId) => replaySheetRun(sheetRunId));
handle('read-analysis', (_, analysisId) => readAnalysisOutput(validateId(analysisId, 'Analysis ID')));
handle('analyze-dataset', (_, payload) => onceForRequest('analyzeDataset', payload, () => analyzeDataset(payload)));
handle('open-data-folder', () => openPathOrThrow(dataRoot()));
handle('open-assets-folder', () => openPathOrThrow(dataPath('assets')));
handle('open-analysis-output', (_, analysisId) => openPathOrThrow(localAnalysisPath(validateId(analysisId, 'Analysis ID'))));
handle('reveal-analysis-output', (_, analysisId) => {
  shell.showItemInFolder(localAnalysisPath(validateId(analysisId, 'Analysis ID')));
  return true;
});
handle('open-asset', (_, assetId) => openPathOrThrow(localAssetPath(validateId(assetId, 'Asset ID'))));
handle('reveal-asset', (_, assetId) => {
  shell.showItemInFolder(localAssetPath(validateId(assetId, 'Asset ID')));
  return true;
});
handle('open-workspace', (_, projectId = 'default') => openPathOrThrow(ensureWorkspace(dataPath('workspaces'), validateId(projectId, 'Project ID'))));
handle('cancel-job', async (_, jobId) => {
  const validJobId = validateId(jobId, 'Job ID');
  // A person's own job (an Ask AI answer) is stopped only by them.
  const owner = jobs.get(validJobId)?.ownerId;
  if (owner && owner !== access.identityForCall()?.id) throw new Error('Job cannot be cancelled.');
  const child = jobProcesses.get(validJobId);
  const apifyRun = apifyRunControllers.get(validJobId);
  const apiRequest = apiRequests.get(validJobId);
  if (!child && !apifyRun && !apiRequest) throw new Error('Job cannot be cancelled.');
  if (apiRequest) { apiRequest.abort(); apiRequests.delete(validJobId); }
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

if (app.isPackaged) app.on('second-instance', () => {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  else { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); }
});

app.whenReady().then(() => {
  ensureDirs();
  // An unreadable data.json or config.json stops here, before anything could save over it (readStoreJson).
  try { loadData(); loadConfig(); }
  catch (error) { dialog.showErrorBox('Studio data could not be read', error.message); app.exit(1); return; }
  if (WEB_RUNTIME) {
    // One line for the operator's log: saved keys this STUDIO_SECRET_KEY can't read are named, never shown.
    const problems = Object.entries(keyProblems());
    const mismatch = problems.filter(([, problem]) => problem === 'mismatch').map(([name]) => name);
    console.log(JSON.stringify({ event: 'secrets-check', saved: Object.keys(loadConfig().keys || {}).length, undecryptable: mismatch.length, otherInstallation: problems.length - mismatch.length }));
    if (mismatch.length) console.error(`STUDIO_SECRET_KEY does not match the key these saved keys were encrypted with: ${mismatch.join(', ')}. Start with the original key to use them; Settings shows them as unreadable until then.`);
  }
  recoverInterruptedJobs();
  contentWorkspace.recoverInterrupted();
  // Browser studio: export copies left by downloads made before they were temporary (STUDIO_EXPORT_DAYS, default 7).
  if (WEB_RUNTIME) {
    const raw = String(process.env.STUDIO_EXPORT_DAYS ?? '').trim(); const days = raw === '' ? 7 : Number(raw); const keepDays = Number.isFinite(days) && days >= 0 ? days : 7;
    try { contentWorkspace.pruneExports({ olderThanDays: keepDays }); } catch (error) { console.warn(`Old export copies could not be removed: ${error.message}`); }
    try { const cutoff = Date.now() - keepDays * 86400000; for (const entry of fs.readdirSync(dataPath('exports'), { withFileTypes: true })) { const target = dataPath('exports', entry.name); if (fs.statSync(target).mtimeMs < cutoff) fs.rmSync(target, { recursive: true, force: true }); } } catch (_) { /* nothing to remove */ }
  }
  contentWorkspace.startResearchScheduler();
  // Explicit local launch preference; normal launches keep the saved workspace.
  const requestedWorkspace = process.argv.find(argument => argument.startsWith("--studio-workspace="))?.split("=")[1];
  if (["general", "semrush"].includes(requestedWorkspace)) contentWorkspace.selectContentWorkspace(requestedWorkspace);
  configureAutoUpdates();
  app.setAboutPanelOptions({ applicationName: APP_NAME, applicationVersion: app.getVersion(), copyright: 'Chris DiMarco' });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ label: APP_NAME, submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] }] : [{ role: 'fileMenu' }]),
    { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' },
  ]));
  createWindow();
  startScheduleLoop();
});

// What would be lost by quitting now: research/content runs, background jobs (chat, analyses, scraper
// runs) and any AI process still running.
function activeWorkSummary() {
  const lines = [];
  for (const run of contentWorkspace.activeWork?.() || []) lines.push(`${run.kind === 'research' ? 'Research run' : 'Content run'}: ${run.title}${run.stage ? ` (${run.stage})` : ''}`);
  for (const job of jobs.values()) if (job.status === 'running') lines.push(`${({ chat: 'Chat answer', run: 'Scraper run', assets: 'Asset generation', intent: 'Search' })[job.kind] || 'Analysis'}: ${job.title || 'in progress'}`);
  const requests = jobProcesses.size + apiRequests.size;
  if (!lines.length && requests) lines.push(`${requests} AI request${requests === 1 ? '' : 's'} in progress`);
  return lines;
}
// Child processes outlive the app unless stopped, and an orphaned `claude --print` keeps spending.
function stopAllWork() {
  for (const child of jobProcesses.values()) { try { child.kill('SIGTERM'); } catch (_) { /* already exited */ } }
  jobProcesses.clear();
  for (const controller of apiRequests.values()) controller.abort();
  apiRequests.clear();
  for (const run of apifyRunControllers.values()) Promise.resolve().then(() => run.abort?.()).catch(() => { /* already settled */ });
}
// The browser studio stops with its server process (no quit dialog there): stop schedules and in-flight AI work.
if (WEB_RUNTIME) app.once('quit', () => { contentWorkspace.stopResearchScheduler(); stopAllWork(); });
let quitConfirmed = false;
app.on('before-quit', (event) => {
  const busy = quitConfirmed ? [] : activeWorkSummary();
  if (busy.length) {
    event.preventDefault();
    const choice = dialog.showMessageBoxSync(BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0], {
      type: 'warning', buttons: ['Keep working', 'Quit anyway'], defaultId: 0, cancelId: 0, noLink: true,
      message: busy.length === 1 ? 'Something is still running' : `${busy.length} things are still running`,
      detail: `${busy.slice(0, 6).join('\n')}${busy.length > 6 ? `\n…and ${busy.length - 6} more` : ''}\n\nQuitting stops the AI work in progress, and that work is lost. Apify collection keeps running on Apify's side. Retry a stopped research run later: it picks up the collected posts and keeps every step it finished.`,
    });
    if (choice !== 1) return;
    quitConfirmed = true;
    setImmediate(() => app.quit());
    return;
  }
  contentWorkspace.stopResearchScheduler();
  stopAllWork();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
