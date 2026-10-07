// Read-only probe of an ALREADY RUNNING installed macOS app. Never launches it.
// Close development copies first; launch the installed executable with a localhost
// debugging port and ALL four credential env variables unset. See the companion note.
// Usage: node scripts/installed-app-continuity.cjs --app '/Applications/Scraper Studio.app'
//   --port 9338 --clean-launch-confirmed --expected-datasets 4
//   --image-credential-file /absolute/previously-approved/.env.local
// Only sanitized booleans/counts are written to stdout. No profile files are written.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const KEY_NAMES = ['APIFY_API_TOKEN', 'GOOGLE_SHEETS_WEBHOOK_URL', 'GOOGLE_DOCS_ACCESS_TOKEN', 'OPENAI_API_KEY'];
const fail = code => { const error = new Error(code); error.safeCode = code; throw error; };
function optionsFromArgs(argv) {
  const allowed = new Set(['--app', '--port', '--profile', '--expected-datasets', '--image-credential-file']);
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === '--clean-launch-confirmed') { opts.cleanLaunchConfirmed = true; continue; }
    if (!allowed.has(key) || !argv[i + 1] || argv[i + 1].startsWith('--') || opts[key]) fail('INVALID_ARGUMENTS');
    opts[key] = argv[++i];
  }
  if (!opts.cleanLaunchConfirmed) fail('CLEAN_LAUNCH_ATTESTATION_REQUIRED');
  const port = Number(opts['--port']); const expectedDatasets = Number(opts['--expected-datasets'] ?? 4);
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || !Number.isInteger(expectedDatasets) || expectedDatasets < 0) fail('INVALID_ARGUMENTS');
  const app = opts['--app']; const imageFile = opts['--image-credential-file'];
  const profile = opts['--profile'] || path.join(os.homedir(), 'Library', 'Application Support', 'apify-scraper-studio');
  if (!app?.endsWith('.app') || !path.isAbsolute(app) || !path.isAbsolute(profile) || !imageFile || !path.isAbsolute(imageFile)) fail('ABSOLUTE_PATHS_REQUIRED');
  return { app: path.resolve(app), profile: path.resolve(profile), imageFile: path.resolve(imageFile), port, expectedDatasets, cleanLaunchConfirmed: true };
}
function readBounded(file, limit) {
  let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const stat = fs.fstatSync(fd); if (!stat.isFile() || stat.size > limit) fail('INVALID_PROFILE_FILE');
    const buffer = Buffer.alloc(limit + 1); let bytes = 0, size;
    while (bytes <= limit && (size = fs.readSync(fd, buffer, bytes, buffer.length - bytes, null))) bytes += size;
    if (bytes > limit) fail('INVALID_PROFILE_FILE');
    return buffer.subarray(0, bytes);
  } catch (error) { if (error.safeCode) throw error; fail('PROFILE_FILE_UNAVAILABLE'); }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}
function profileSnapshot(profile, imageFile) {
  const configBytes = readBounded(path.join(profile, 'config.json'), 1_000_000);
  const dataBytes = readBounded(path.join(profile, 'data.json'), 64_000_000);
  const studioBytes = readBounded(path.join(profile, 'content-studio', 'state.json'), 64_000_000);
  let config, data, studio;
  try { config = JSON.parse(configBytes); data = JSON.parse(dataBytes); studio = JSON.parse(studioBytes); } catch { fail('INVALID_PROFILE_JSON'); }
  const encrypted = Object.fromEntries(KEY_NAMES.map(key => [key, config.keys?.[key]?.encrypted === true && typeof config.keys[key].value === 'string' && config.keys[key].value.length > 0]));
  const enabledEncrypted = KEY_NAMES.filter(key => encrypted[key] && !config.disabledKeys?.[key]);
  const datasetIds = Array.isArray(data.datasets) ? data.datasets.map(row => row.id).sort() : [];
  if (datasetIds.some(id => typeof id !== 'string')) fail('INVALID_DATASET_INDEX');
  return {
    // Ciphertexts are never decrypted, serialized or returned by this probe.
    encrypted, enabledEncrypted, datasetIds,
    allWorkspaceJobsIdle: [...(studio.contentRuns || []), ...(studio.researchRuns || [])].every(row => !['queued', 'running'].includes(row.status)),
    pointerMatches: config.imageCredentialFile === imageFile,
    signature: createHash('sha256').update(configBytes).update(dataBytes).update(studioBytes).digest('hex'),
  };
}
function installedMetadata(app, exec = spawnSync) {
  const run = (command, args) => exec(command, args, { encoding: 'utf8', timeout: 30_000, maxBuffer: 100_000 });
  const plist = path.join(app, 'Contents', 'Info.plist');
  const bundleId = run('/usr/bin/plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', plist]);
  const binary = run('/usr/bin/plutil', ['-extract', 'CFBundleExecutable', 'raw', '-o', '-', plist]);
  const executable = String(binary.stdout || '').trim();
  if (binary.status !== 0 || !executable || executable.includes('/') || executable.includes('..')) fail('BUNDLE_EXECUTABLE_UNAVAILABLE');
  const arch = run('/usr/bin/lipo', ['-archs', path.join(app, 'Contents', 'MacOS', executable)]);
  const signing = run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
  const identity = run('/usr/bin/codesign', ['-d', '--verbose=4', app]);
  const details = String(identity.stderr || '');
  return {
    bundleIdentityMatches: bundleId.status === 0 && String(bundleId.stdout).trim() === 'com.chrisdimarco.apifyscraperstudio',
    executableSupportsArm64: arch.status === 0 && String(arch.stdout).trim().split(/\s+/).includes('arm64'),
    signatureValid: signing.status === 0,
    developerIdSigned: identity.status === 0 && /^Authority=Developer ID Application:/m.test(details),
    signingTeamMatches: identity.status === 0 && /^TeamIdentifier=4X5MZ8MGH9$/m.test(details),
    hardenedRuntime: identity.status === 0 && /flags=0x[0-9a-f]+\([^)]*runtime[^)]*\)/i.test(details),
  };
}
function selectTarget(targets, app, port) {
  const expected = path.join(app, 'Contents', 'Resources', 'app.asar', 'out', 'renderer', 'index.html');
  const matches = (Array.isArray(targets) ? targets : []).filter(target => {
    try { return target.type === 'page' && fileURLToPath(target.url) === expected; } catch { return false; }
  });
  if (matches.length !== 1) fail('INSTALLED_RENDERER_NOT_UNIQUE');
  let websocket; try { websocket = new URL(matches[0].webSocketDebuggerUrl); } catch { fail('INVALID_DEBUG_ENDPOINT'); }
  if (websocket.protocol !== 'ws:' || websocket.hostname !== '127.0.0.1' || Number(websocket.port) !== port || websocket.username || websocket.password || !websocket.pathname.startsWith('/devtools/page/')) fail('NONLOCAL_DEBUG_ENDPOINT');
  return websocket.href;
}
function readOnlyExpression({ profile, datasetIds }) {
  return `(async () => {
    const bridge = window.apifyStudio;
    if (!bridge || typeof bridge.appMeta !== 'function' || typeof bridge.state !== 'function') throw new Error('BRIDGE_UNAVAILABLE');
    const meta = await bridge.appMeta(); const state = await bridge.state();
    const ids = (state.datasets || []).map(row => row.id).sort();
    const keyNames = ${JSON.stringify(KEY_NAMES)};
    const active = row => ['running','queued','starting','collecting','analyzing','generating'].includes(row.status);
    return {
      runtimeAppMatches: meta.name === 'Scraper Studio',
      runtimeDataRootMatches: meta.dataRoot === ${JSON.stringify(profile)},
      datasetsMatchProfile: JSON.stringify(ids) === ${JSON.stringify(JSON.stringify(datasetIds))},
      datasetCount: ids.length,
      keys: Object.fromEntries(keyNames.map(key => [key, state.keys?.[key] === true])),
      generalWorkspacePresent: (state.contentStudio?.workspaces || []).some(row => row.id === 'general'),
      semrushWorkspacePresent: (state.contentStudio?.workspaces || []).some(row => row.id === 'semrush'),
      noRunningJobs: !(state.jobs || []).some(active) && !(state.contentStudio?.researchRuns || []).some(active) && !(state.contentStudio?.contentRuns || []).some(active),
      noEnabledSchedules: !Object.values(state.v5?.schedules || {}).some(row => !row.paused && row.cadence && row.cadence !== 'manual')
    };
  })()`;
}
function evaluateReadOnly(endpoint, expression, WebSocketImpl = WebSocket) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocketImpl(endpoint);
    const finish = (error, value) => { clearTimeout(timer); try { ws.close(); } catch {} error ? reject(error) : resolve(value); };
    const timer = setTimeout(() => finish(Object.assign(new Error('DEBUG_PROBE_TIMED_OUT'), { safeCode: 'DEBUG_PROBE_TIMED_OUT' })), 45_000);
    ws.addEventListener('open', () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true, timeout: 40_000 } })));
    ws.addEventListener('error', () => finish(Object.assign(new Error('DEBUG_CONNECTION_FAILED'), { safeCode: 'DEBUG_CONNECTION_FAILED' })));
    ws.addEventListener('message', event => {
      try {
        const message = JSON.parse(event.data); if (message.id !== 1) return;
        if (message.error || message.result?.exceptionDetails || !message.result?.result?.value) throw new Error();
        finish(null, message.result.result.value);
      } catch { finish(Object.assign(new Error('READ_ONLY_IPC_FAILED'), { safeCode: 'READ_ONLY_IPC_FAILED' })); }
    });
  });
}
function receiptFor(options, before, after, metadata, runtime) {
  // Reconstruct an allowlist. Never print arbitrary app/CDP or file error payloads.
  const checks = Object.fromEntries(Object.keys(metadata).map(key => [key, metadata[key] === true]));
  for (const key of ['runtimeAppMatches', 'runtimeDataRootMatches', 'datasetsMatchProfile', 'generalWorkspacePresent', 'semrushWorkspacePresent', 'noRunningJobs', 'noEnabledSchedules']) checks[key] = runtime[key] === true;
  checks.expectedDatasetCount = runtime.datasetCount === options.expectedDatasets;
  checks.encryptedCredentialsAvailable = before.enabledEncrypted.every(key => runtime.keys?.[key] === true);
  checks.allWorkspaceJobsIdle = before.allWorkspaceJobsIdle === true && after.allWorkspaceJobsIdle === true;
  // Optional integrations need continuity only when an enabled credential existed.
  checks.googleCredentialsPreserved = before.enabledEncrypted.filter(key => ['GOOGLE_SHEETS_WEBHOOK_URL', 'GOOGLE_DOCS_ACCESS_TOKEN'].includes(key)).every(key => runtime.keys?.[key] === true);
  checks.apifyAvailable = runtime.keys?.APIFY_API_TOKEN === true;
  checks.openAiAvailable = runtime.keys?.OPENAI_API_KEY === true;
  checks.explicitImageFileMatches = before.pointerMatches === true;
  checks.profileUnchangedDuringProbe = before.signature === after.signature;
  checks.cleanLaunchAttested = options.cleanLaunchConfirmed === true;
  return {
    kind: 'installed-app-read-only-continuity', createdAt: new Date().toISOString(),
    passed: Object.values(checks).every(Boolean), checks,
    datasetCount: Number.isSafeInteger(runtime.datasetCount) ? runtime.datasetCount : null,
    encryptedEntriesPresent: Object.fromEntries(KEY_NAMES.map(key => [key, before.encrypted[key] === true])),
    credentialsAvailable: Object.fromEntries(KEY_NAMES.map(key => [key, runtime.keys?.[key] === true])),
    probeProviderCalls: 0, probeAiCliCalls: 0, probeConfigWrites: 0,
    scope: 'Only appMeta/state IPC was invoked. Normal app startup/background activity is outside this probe. Clean credential environment is operator-attested; credential values and source-file contents were not returned. Notarization is not assessed.',
  };
}
async function run(options) {
  if (process.platform !== 'darwin') fail('MACOS_REQUIRED');
  const app = fs.realpathSync(options.app); const profile = fs.realpathSync(options.profile);
  const normalized = { ...options, app, profile };
  const metadata = installedMetadata(app);
  if (!Object.values(metadata).every(Boolean)) return { kind: 'installed-app-read-only-continuity', passed: false, checks: metadata, error: 'SIGNED_ARM64_BUNDLE_REQUIRED' };
  const before = profileSnapshot(profile, options.imageFile);
  const response = await fetch(`http://127.0.0.1:${options.port}/json/list`, { signal: AbortSignal.timeout(10_000), redirect: 'error' });
  if (!response.ok) fail('DEBUG_TARGETS_UNAVAILABLE');
  const target = selectTarget(await response.json(), app, options.port);
  const runtime = await evaluateReadOnly(target, readOnlyExpression({ profile, datasetIds: before.datasetIds }));
  return receiptFor(normalized, before, profileSnapshot(profile, options.imageFile), metadata, runtime);
}
module.exports = { optionsFromArgs, profileSnapshot, installedMetadata, selectTarget, readOnlyExpression, evaluateReadOnly, receiptFor, run };
if (require.main === module) Promise.resolve().then(() => run(optionsFromArgs(process.argv.slice(2)))).then(receipt => {
  console.log(JSON.stringify(receipt, null, 2)); process.exitCode = receipt.passed ? 0 : 1;
}).catch(error => {
  console.log(JSON.stringify({ kind: 'installed-app-read-only-continuity', passed: false, error: error.safeCode || 'PROBE_FAILED' })); process.exitCode = 1;
});
