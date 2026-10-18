'use strict';
// Google Drive folder sync (HANDOFF.md → Google Drive folder sync). An admin connects a Drive folder once in Settings →
// Google Drive, and every report the studio writes is copied there as a Google Doc, in folders that mirror the Library:
//   <date> · <program>/<trend>/<trend> — Trends report, <trend> — Editorial toolkit
//   Quick scan · <topic>/Quick scan report · <topic>
//   (channel assets, when that option is on) …/<trend>/Channel assets · <date>/<channel team>/<files>
// An edited report updates the same Doc (a minute after the last change). Bookkeeping lives in
// content-studio/drive-sync.json: the settings, an id map per chosen folder (folders by logical key, files by asset id,
// so nothing is ever added twice), the queue and the sync log (newest 200 rows). The service account key itself is an
// encrypted key in config.json (index.js); this file never sees it at rest. Nothing here spends AI money.
const fs = require('fs');
const path = require('path');
const { renameDurable } = require('../shared/durable-write');
const crypto = require('crypto');
const drive = require('./drive-client');
const { safeGoogleDocHtml } = require('./google-delivery');
const KIT = require('../shared/kit-folders.json');

const VERSION = 1;
const LOG_ROWS = 200;
const REPORTS = { 'evidence-report': 'Trends report', 'editorial-toolkit': 'Editorial toolkit', 'scan-report': 'Quick scan report' };
const RETRYABLE_AGAIN_MS = 5 * 60 * 1000;
const BLOCKED_RECHECK_MS = 60 * 1000;
const copy = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
const record = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
const list = (value) => (Array.isArray(value) ? value : []);
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');
const clip = (value, max) => String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const freshSettings = () => ({ folderId: '', folderName: '', folderUrl: '', driveId: '', autoAdd: false, includeChannelAssets: false, rev: 0, savedAt: '', migratedPrograms: null });
const fresh = () => ({ version: VERSION, settings: freshSettings(), account: null, maps: {}, pending: {}, log: [], lastSyncAt: '', lastError: '' });
const day = (value) => { const ms = Date.parse(value || ''); return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : 'Undated'; };
const minute = (value) => { const ms = Date.parse(value || ''); return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 16).replace('T', ' ') : 'Undated'; };
// Research reports carry "TREND:" and "— Comprehensive Trends Report" around the trend's name (library-tree.js cleanTitle).
const cleanTitle = (value) => clip(String(value || '').replace(/^\s*TREND:\s*/i, '').replace(/\s+—\s+Comprehensive Trends Report\s*$/i, ''), 160);
// A channel asset's team folder, from its deliverable id (library-tree.js channelOf / channelName).
function channelFolder(deliverableId, editionId) {
  const only = KIT.editionOnly?.[deliverableId];
  const folder = (!only || only.includes(editionId || 'general')) ? KIT.folders.find((row) => row.deliverables.includes(deliverableId)) : null;
  return folder ? { id: folder.id, name: folder[editionId === 'semrush' ? 'semrush' : 'general'] } : { id: 'other', name: 'Other' };
}

function createDriveSync({ root, workspace, credentials, saveServiceAccount, clearServiceAccount, emitState = () => {}, jobs = null, fetchImpl = globalThis.fetch, now = () => Date.now(), sleep, setTimer = (fn, ms) => { const timer = setTimeout(fn, ms); timer.unref?.(); return timer; }, clearTimer = (timer) => clearTimeout(timer), createDelayMs = 10000, editDelayMs = 60000, onDamaged = (message) => console.warn(message) } = {}) {
  if (!root || !workspace || typeof credentials !== 'function') throw new Error('Google Drive sync needs the studio data folder, the workspace and a sign-in.');
  const target = path.join(root, 'drive-sync.json');
  let data = load();
  let timer = null; let pumping = false; let stopped = false; let backfill = null; let lastBackfill = null; let authCache = null;
  const attempts = new Map(); // assetId → automatic retries of a temporary failure
  const iso = () => new Date(now()).toISOString();

  // ---------- Store ----------
  function load() {
    let text;
    try { text = fs.readFileSync(target, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return fresh(); throw error; }
    try {
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new SyntaxError('not an object');
      if (Number(parsed.version) > VERSION) throw Object.assign(new Error('The Google Drive sync file is from a newer Scraper Studio. Update the app or server.'), { code: 'driveNewer' });
      return { ...fresh(), ...parsed, settings: { ...freshSettings(), ...record(parsed.settings) }, maps: record(parsed.maps), pending: record(parsed.pending), log: list(parsed.log).slice(0, LOG_ROWS) };
    } catch (error) {
      if (error.code === 'driveNewer') throw error;
      // A damaged file is kept beside the new one. Nothing is lost in Drive: every file the studio made carries its
      // asset id, so the next sync finds it again instead of adding a second copy.
      const kept = `${target}.bad-${now()}`;
      try { fs.copyFileSync(target, kept); } catch (_) { /* best effort */ }
      onDamaged(`The Google Drive sync file was damaged; a copy was kept at ${path.basename(kept)}.`);
      return fresh();
    }
  }
  function write() {
    fs.mkdirSync(root, { recursive: true });
    const temp = `${target}.${process.pid}.tmp`;
    try {
      const fd = fs.openSync(temp, 'w', 0o600);
      try { fs.writeFileSync(fd, JSON.stringify(data, null, 2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      renameDurable(temp, target); // retried on Windows while a scanner holds the file
    } catch (error) { try { fs.unlinkSync(temp); } catch (_) { /* nothing left behind */ } throw error; }
  }
  // Write-through: a change that can't reach the disk is undone in memory too.
  function change(mutate) {
    const before = JSON.stringify(data);
    try { const result = mutate(); write(); return result; } catch (error) { data = JSON.parse(before); throw error; }
  }
  const mapFor = (folderId) => { data.maps[folderId] ||= { folders: {}, files: {} }; data.maps[folderId].folders ||= {}; data.maps[folderId].files ||= {}; return data.maps[folderId]; };
  function logRow(row) {
    data.log.unshift({ id: `drive-log-${now()}-${crypto.randomBytes(3).toString('hex')}`, at: iso(), ...row });
    if (data.log.length > LOG_ROWS) data.log.length = LOG_ROWS;
  }

  // ---------- Sign-in ----------
  // { mode, email, client } for the saved service account (preferred) or the Google Docs access token, else null.
  function connection() {
    let creds = null; try { creds = credentials(); } catch (_) { creds = null; }
    if (!creds) return null;
    if (creds.mode === 'service-account' && creds.key?.client_email) {
      const fingerprint = sha(`${creds.key.client_email}\n${creds.key.private_key}`);
      if (authCache?.fingerprint !== fingerprint) authCache = { fingerprint, auth: drive.createServiceAccountAuth({ key: creds.key, fetchImpl, now }) };
      const { auth } = authCache;
      return { mode: 'service-account', email: creds.key.client_email, client: drive.createDriveClient({ getToken: () => auth.token(), refresh: () => auth.refresh(), who: creds.key.client_email, fetchImpl, ...(sleep ? { sleep } : {}) }) };
    }
    if (creds.mode === 'token' && creds.token) return { mode: 'token', email: '', client: drive.createDriveClient({ getToken: () => creds.token, fetchImpl, ...(sleep ? { sleep } : {}) }) };
    return null;
  }
  const ready = () => Boolean(data.settings.folderId) && Boolean(connection());

  // ---------- Where a file goes ----------
  // The folders (outermost first, each { key, name }) and the file name for one asset, mirroring the Library; null for
  // files the sync doesn't carry (drafts, videos, channel assets while that option is off).
  function placeFor(asset, source, { channelAssets = data.settings.includeChannelAssets } = {}) {
    if (!asset || !['text', 'image'].includes(asset.kind)) return null;
    const run = list(source.contentRuns).find((row) => row.id === asset.runId);
    if (!run) return null;
    const research = list(source.researchRuns);
    if (REPORTS[asset.deliverableId] && !run.kit) {
      if (asset.kind !== 'text') return null;
      if (asset.deliverableId === 'scan-report' || run.scanReport) {
        const scan = research.find((row) => row.id === run.researchRunId);
        const topic = clip(scan?.quickScan?.topic || '', 120);
        const folder = scan ? { key: `run:${scan.id}`, name: topic ? `Quick scan · ${topic}` : clip(scan.title || 'Quick scan', 160) } : { key: 'quick-scans', name: 'Quick scans' };
        return { folders: [folder], name: topic ? `Quick scan report · ${topic}` : clip(asset.title || 'Quick scan report', 200) };
      }
      if (!run.themeId) return { folders: [{ key: 'other-reports', name: 'Other reports' }], name: clip(asset.title || REPORTS[asset.deliverableId], 200) };
      const parent = research.find((row) => row.id === run.researchRunId) || research.find((row) => list(row.reportRunIds).some((entry) => (typeof entry === 'string' ? entry : entry?.runId) === run.id));
      const programName = parent ? list(source.programs).find((program) => program.id === parent.programId)?.name || '' : '';
      const theme = parent ? [...list(parent.themes), ...list(parent.discoveredThemes)].find((row) => row?.id === run.themeId) : null;
      const trend = cleanTitle(theme?.name || run.title || asset.title) || 'Untitled trend';
      const runFolder = parent ? { key: `run:${parent.id}`, name: clip(`${day(parent.createdAt)} · ${programName || parent.title || 'Research run'}`, 200) } : { key: 'earlier', name: 'Earlier research' };
      return { folders: [runFolder, { key: `trend:${parent?.id || 'none'}:${run.themeId}`, name: trend }], name: clip(`${trend} — ${REPORTS[asset.deliverableId]}`, 200) };
    }
    if (!run.kit || !channelAssets) return null;
    const team = channelFolder(asset.deliverableId, source.editionId);
    const report = run.kit.reportAssetId ? list(source.assets).find((row) => row.id === run.kit.reportAssetId) : null;
    const base = report ? placeFor(report, source, { channelAssets: false }) : null;
    const setFolder = base ? { key: `kit:${run.id}`, name: `Channel assets · ${minute(run.createdAt)}` } : { key: `kit:${run.id}`, name: clip(`${day(run.createdAt)} · ${run.kit.sourceTitle || run.title || 'Channel assets'}`, 200) };
    const folders = [...(base ? base.folders : [{ key: 'other-sources', name: 'Other sources' }]), setFolder, { key: `kit:${run.id}:${team.id}`, name: team.name }];
    const variant = Number.isInteger(asset.variantIndex) && asset.kind === 'image' ? ` (${asset.variantIndex + 1})` : '';
    return { folders, name: clip(asset.kind === 'image' ? `${asset.title || 'Picture'}${variant}.png` : asset.title || 'Channel asset', 200) };
  }
  const where = (place) => place.folders.map((folder) => folder.name).join(' / ');

  // Each folder found or made once, by logical key, under the chosen folder. A folder of the same name that the studio
  // made for something else (its studioKey differs) is left alone; one a person made (no studioKey) is used.
  async function ensureFolders(client, place, map, signal) {
    let parentId = data.settings.folderId; const driveId = data.settings.driveId;
    for (const folder of place.folders) {
      const known = map.folders[folder.key];
      if (known?.id) { parentId = known.id; continue; }
      const tag = sha(`${data.settings.folderId}\n${folder.key}`).slice(0, 40);
      const found = await client.findByName(parentId, folder.name, { driveId, signal });
      const match = found.find((file) => file.appProperties?.studioKey === tag) || found.find((file) => !file.appProperties?.studioKey);
      const made = match || await client.createFolder(parentId, folder.name, { studioKey: tag }, { signal });
      map.folders[folder.key] = { id: made.id, name: folder.name };
      parentId = made.id;
    }
    return parentId;
  }

  // ---------- One file ----------
  // Adds or updates one asset's file. Returns { kind: 'added' | 'updated' | 'unchanged' | 'skipped', url? }; a failure
  // is logged and thrown.
  async function syncAsset(assetId, { reason = 'auto', signal } = {}) {
    // An edit saved while this file is on its way re-queues it (assetChanged): only the queue entry this send started from
    // is cleared, so that edit still goes out.
    const queued = data.pending[assetId];
    const settle = () => { if (data.pending[assetId] === queued) delete data.pending[assetId]; };
    const conn = connection();
    if (!conn) throw Object.assign(new Error('Connect Google Drive in Settings → Google Drive first.'), { code: 'driveNotConnected', status: 400 });
    if (!data.settings.folderId) throw Object.assign(new Error('Choose a Drive folder in Settings → Google Drive first.'), { code: 'driveNoFolder', status: 400 });
    const source = workspace.driveSource();
    const asset = list(source.assets).find((row) => row.id === assetId);
    const place = asset ? placeFor(asset, source, { channelAssets: data.settings.includeChannelAssets || (reason === 'retry' && asset.kind !== 'video') }) : null;
    if (!asset || !place) { delete data.pending[assetId]; return { kind: 'skipped' }; }
    const folderId = data.settings.folderId; const map = mapFor(folderId);
    const title = clip(asset.title || place.name, 200);
    try {
      // A toolkit links its trends report's Doc once that is in Drive (n8n's "Full evidence" line).
      const sibling = asset.deliverableId === 'editorial-toolkit' ? list(source.assets).find((row) => row.runId === asset.runId && row.deliverableId === 'evidence-report') : null;
      const doc = workspace.driveDocument(assetId, { trendsDocUrl: sibling ? map.files[sibling.id]?.url || '' : '' });
      if (!doc) { delete data.pending[assetId]; return { kind: 'skipped' }; }
      const image = asset.kind === 'image';
      const media = image ? doc.png : Buffer.from(safeGoogleDocHtml(doc.html));
      const spec = { mimeType: image ? 'image/png' : drive.DOC_MIME, mediaType: image ? 'image/png' : 'text/html; charset=UTF-8' };
      const folderKey = place.folders[place.folders.length - 1].key;
      const hash = sha(Buffer.concat([Buffer.from(`${place.name}\n${folderKey}\n`), media]));
      const existing = map.files[assetId];
      if (existing?.id && existing.hash === hash) { delete data.pending[assetId]; return { kind: 'unchanged', url: existing.url }; }
      const update = async (fileId) => {
        try { const result = await conn.client.updateFile(fileId, { name: place.name, media, mediaType: spec.mediaType }, { signal }); return result?.trashed ? null : result; }
        catch (error) { if (error.code === 'driveNotFound') return null; throw error; }
      };
      const put = async () => {
        const parentId = await ensureFolders(conn.client, place, map, signal);
        if (existing?.id) { const updated = await update(existing.id); if (updated) return { file: updated, kind: 'updated' }; }
        // Not in the map (or deleted in Drive): look for the copy this studio made before adding one.
        const tagged = (await conn.client.findTagged(parentId, 'studioAsset', assetId, { driveId: data.settings.driveId, signal }))[0];
        const updated = tagged ? await update(tagged.id) : null;
        if (updated) return { file: updated, kind: 'updated' };
        return { file: await conn.client.createFile({ parentId, name: place.name, ...spec, media, appProperties: { studioAsset: assetId } }, { signal }), kind: 'added' };
      };
      let outcome;
      // A folder the map remembers may have been deleted in Drive: on "not found", forget this file's folders and look again once.
      try { outcome = await put(); } catch (error) { if (error.code !== 'driveNotFound') throw error; for (const folder of place.folders) delete map.folders[folder.key]; outcome = await put(); }
      const { file, kind } = outcome;
      const url = conn.client.fileUrl(file);
      change(() => {
        mapFor(folderId).files[assetId] = { id: file.id, url, name: place.name, mimeType: spec.mimeType, hash, folderKey, syncedAt: iso() };
        settle(); data.lastSyncAt = iso(); data.lastError = '';
        logRow({ kind, assetId, title, where: where(place), url, reason });
      });
      attempts.delete(assetId);
      return { kind, url };
    } catch (error) {
      if (error.code === 'driveCancelled') throw error;
      const message = clip(error.message || 'Google Drive didn’t accept the file.', 400);
      change(() => { settle(); data.lastError = message; logRow({ kind: 'failed', assetId, title, where: where(place), error: message, reason }); });
      throw error;
    }
  }
  // ---------- The queue ----------
  // One Drive conversation at a time, so two saves never make the same folder twice.
  let chain = Promise.resolve();
  function serial(work) { const next = chain.then(work, work); chain = next.catch(() => {}); return next; }
  // `blocked`: files are due but the switch is off or Drive isn't connected. The queue is then looked at again a minute
  // later (save and connect re-arm it at once) instead of every 250 ms.
  function arm(blocked = false) {
    if (timer) { clearTimer(timer); timer = null; }
    if (stopped) return;
    const due = Object.values(data.pending).map(Number).filter(Number.isFinite);
    if (!due.length) return;
    timer = setTimer(() => { timer = null; pump(); }, Math.max(blocked ? BLOCKED_RECHECK_MS : 250, Math.min(...due) - now()));
  }
  async function pump() {
    if (pumping || stopped) return;
    pumping = true; let blocked = false;
    try {
      while (!stopped) {
        const dueIds = Object.entries(data.pending).filter(([, at]) => Number(at) <= now()).map(([assetId]) => assetId);
        if (!dueIds.length) break;
        if (!data.settings.autoAdd || !ready()) { blocked = true; break; }
        for (const assetId of dueIds) {
          if (stopped) break;
          try { await serial(() => syncAsset(assetId, { reason: 'auto' })); }
          catch (error) {
            if (Number(data.pending[assetId]) <= now()) delete data.pending[assetId]; // never spin on the same file
            // A temporary problem (rate limit, Google busy, network) tries again in five minutes, three times at most.
            const tries = (attempts.get(assetId) || 0) + 1; attempts.set(assetId, tries);
            if (error.retryable && tries <= 3) { try { change(() => { data.pending[assetId] = now() + RETRYABLE_AGAIN_MS; }); } catch (_) { /* the log has the failure */ } }
          }
          emitState();
        }
      }
    } finally { pumping = false; arm(blocked); }
  }
  // An asset was written (hooks.onAssetChanged): a new report goes out after a few seconds, an edit a minute after the
  // last change. Never throws; the editor saves every second and a half, so only the first queueing writes the file.
  function assetChanged({ assetId, reason = 'edited' } = {}) {
    try {
      if (stopped || !data.settings.autoAdd || !data.settings.folderId || typeof assetId !== 'string') return;
      const source = workspace.driveSource();
      if (!placeFor(list(source.assets).find((row) => row.id === assetId), source)) return;
      const first = !(assetId in data.pending);
      data.pending[assetId] = now() + (reason === 'created' ? createDelayMs : editDelayMs);
      if (first) write();
      arm();
    } catch (error) { console.warn(`A report couldn’t be queued for Google Drive: ${error.message}`); }
  }

  // ---------- Copy existing reports (a cancellable 'drive' job) ----------
  function eligible() {
    const source = workspace.driveSource();
    const order = { 'evidence-report': 0, 'scan-report': 1, 'editorial-toolkit': 2 };
    return list(source.assets).filter((asset) => placeFor(asset, source))
      .sort((a, b) => String(a.createdAt || '').slice(0, 10).localeCompare(String(b.createdAt || '').slice(0, 10)) || (order[a.deliverableId] ?? 3) - (order[b.deliverableId] ?? 3) || String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
      .map((asset) => asset.id);
  }
  function startBackfill() {
    if (backfill) return { jobId: backfill.jobId, total: backfill.total, joined: true };
    if (!connection()) throw Object.assign(new Error('Connect Google Drive in Settings → Google Drive first.'), { code: 'driveNotConnected', status: 400 });
    if (!data.settings.folderId) throw Object.assign(new Error('Choose a Drive folder first.'), { code: 'driveNoFolder', status: 400 });
    const ids = eligible();
    const jobId = `drive-copy-${now()}`;
    const job = jobs?.start ? jobs.start({ id: jobId, kind: 'drive', title: 'Copying reports to Google Drive' }) : { signal: new AbortController().signal, progress: () => {}, finish: () => {}, fail: () => {} };
    backfill = { jobId, total: ids.length, done: 0, added: 0, updated: 0, unchanged: 0, failed: 0, startedAt: iso(), job };
    emitState();
    (async () => {
      let lastEmit = 0;
      try {
        for (const assetId of ids) {
          if (job.signal?.aborted || stopped) break;
          try { const result = await serial(() => syncAsset(assetId, { reason: 'copy', signal: job.signal })); if (backfill[result.kind] !== undefined) backfill[result.kind] += 1; }
          catch (error) { if (error.code === 'driveCancelled') break; backfill.failed += 1; }
          backfill.done += 1; job.progress?.(Math.round((backfill.done / Math.max(1, backfill.total)) * 100));
          if (now() - lastEmit > 2000) { lastEmit = now(); emitState(); }
        }
        const cancelled = Boolean(job.signal?.aborted);
        lastBackfill = { ...summary(), cancelled, finishedAt: iso() };
        job.finish?.({ status: cancelled ? 'cancelled' : 'succeeded', result: lastBackfill });
      } catch (error) { job.fail?.(error); lastBackfill = { ...summary(), error: error.message, finishedAt: iso() }; }
      finally { backfill = null; emitState(); }
    })();
    return { jobId, total: ids.length };
  }
  const summary = () => (backfill ? { total: backfill.total, done: backfill.done, added: backfill.added, updated: backfill.updated, unchanged: backfill.unchanged, failed: backfill.failed } : null);

  // ---------- Settings methods (admins) ----------
  // Connect: the pasted key is checked by signing in with it before it is saved (encrypted, by the host).
  async function connect(payload = {}) {
    const key = drive.parseServiceAccount(payload.serviceAccountKey);
    const auth = drive.createServiceAccountAuth({ key, fetchImpl, now });
    await auth.token();
    saveServiceAccount(JSON.stringify(key));
    authCache = { fingerprint: sha(`${key.client_email}\n${key.private_key}`), auth };
    change(() => { data.account = { email: key.client_email, checkedAt: iso() }; });
    arm(); emitState();
    return { ok: true, email: key.client_email, driveSync: publicState() };
  }
  async function verifyFolder(conn, folderId) {
    const folder = await conn.client.folder(folderId);
    if (folder.mimeType !== drive.FOLDER_MIME || folder.trashed) throw Object.assign(new Error('That link opens a file, not a folder. Paste the link of a Drive folder.'), { code: 'driveNotFolder', status: 400 });
    const may = folder.capabilities?.canAddChildren;
    if (may === false) throw Object.assign(new Error(conn.email ? `The studio can see “${folder.name}” but can’t add files to it. Share it with ${conn.email} as Editor (in a shared drive: Contributor or higher).` : `This Google account can see “${folder.name}” but can’t add files to it.`), { code: 'driveForbidden', status: 400 });
    return { id: folder.id, name: clip(folder.name, 200) || 'Untitled folder', url: folder.webViewLink || `https://drive.google.com/drive/folders/${folder.id}`, driveId: String(folder.driveId || '') };
  }
  async function save(payload = {}) {
    const input = record(payload);
    if (input.rev !== undefined && input.rev !== null && Number(input.rev) !== Number(data.settings.rev)) throw Object.assign(new Error('Someone changed the Google Drive setup after you opened it. Reload to see it.'), { status: 409, code: 'driveSetupChanged' });
    let folder = null;
    if (input.folder !== undefined && String(input.folder || '').trim()) {
      const folderId = drive.parseFolderLink(input.folder);
      if (!folderId) throw Object.assign(new Error('That isn’t a Google Drive folder link. Open the folder in Drive and copy the address from the browser.'), { code: 'driveFolderLink', status: 400 });
      const conn = connection();
      if (!conn) throw Object.assign(new Error('Connect a service account (or an access token) before choosing the folder.'), { code: 'driveNotConnected', status: 400 });
      folder = await verifyFolder(conn, folderId);
    }
    change(() => {
      const settings = data.settings;
      if (folder) Object.assign(settings, { folderId: folder.id, folderName: folder.name, folderUrl: folder.url, driveId: folder.driveId });
      else if (input.folder !== undefined) Object.assign(settings, { folderId: '', folderName: '', folderUrl: '', driveId: '' });
      if (input.autoAdd !== undefined) settings.autoAdd = Boolean(input.autoAdd);
      if (input.includeChannelAssets !== undefined) settings.includeChannelAssets = Boolean(input.includeChannelAssets);
      settings.rev = Number(settings.rev || 0) + 1; settings.savedAt = iso();
    });
    arm(); emitState(); // what waited while the switch was off (or before a folder) goes out now
    return { driveSync: publicState() };
  }
  async function test() {
    const conn = connection();
    if (!conn) throw Object.assign(new Error('Connect a service account (or an access token) first.'), { code: 'driveNotConnected', status: 400 });
    if (!data.settings.folderId) {
      if (conn.mode === 'service-account') await authCache.auth.token();
      return { ok: true, mode: conn.mode, email: conn.email, folder: null, message: conn.email ? `Signed in as ${conn.email}. Paste the Drive folder link next.` : 'The access token is saved. Paste the Drive folder link next.' };
    }
    const folder = await verifyFolder(conn, data.settings.folderId);
    change(() => { Object.assign(data.settings, { folderName: folder.name, folderUrl: folder.url, driveId: folder.driveId }); if (conn.email) data.account = { email: conn.email, checkedAt: iso() }; data.lastError = ''; });
    emitState();
    return { ok: true, mode: conn.mode, email: conn.email, folder: { name: folder.name, url: folder.url }, message: `Working. The studio can add files to “${folder.name}”${conn.mode === 'token' ? ' (with the access token, which expires after about an hour)' : ''}.` };
  }
  // Disconnect: the key is cleared and syncing stops. The id map and the log stay, so connecting the same folder again
  // updates the same files instead of copying everything twice.
  function disconnect() {
    backfill?.job?.abort?.();
    clearServiceAccount();
    authCache = null;
    change(() => { data.account = null; data.pending = {}; Object.assign(data.settings, { folderId: '', folderName: '', folderUrl: '', driveId: '', rev: Number(data.settings.rev || 0) + 1, savedAt: iso() }); });
    arm(); emitState();
    return { driveSync: publicState() };
  }
  function readLog(payload = {}) {
    const limit = Math.max(1, Math.min(LOG_ROWS, Number(record(payload).limit) || LOG_ROWS));
    return { rows: copy(data.log.slice(0, limit)) };
  }
  async function retry(payload = {}) {
    const assetId = String(record(payload).assetId || '');
    if (!/^[a-zA-Z0-9._~@-]{1,180}$/.test(assetId)) throw Object.assign(new Error('Choose a file from the sync log to retry.'), { status: 400 });
    const result = await serial(() => syncAsset(assetId, { reason: 'retry' }));
    emitState();
    return { ...result, driveSync: publicState() };
  }

  // ---------- State and host hooks ----------
  function publicState() {
    const conn = (() => { let creds = null; try { creds = credentials(); } catch (_) { creds = null; } return creds; })();
    const mode = conn?.mode === 'service-account' && conn.key?.client_email ? 'service-account' : conn?.mode === 'token' && conn.token ? 'token' : '';
    const settings = data.settings; const map = settings.folderId ? data.maps[settings.folderId] : null;
    // Files whose newest log row is a failure still need a Retry.
    const latest = new Map(); for (const row of data.log) if (row.assetId && !latest.has(row.assetId)) latest.set(row.assetId, row.kind);
    return {
      connected: Boolean(mode), mode, email: mode === 'service-account' ? conn.key.client_email : '',
      folder: settings.folderId ? { id: settings.folderId, name: settings.folderName, url: settings.folderUrl, sharedDrive: Boolean(settings.driveId) } : null,
      autoAdd: Boolean(settings.autoAdd), includeChannelAssets: Boolean(settings.includeChannelAssets), rev: Number(settings.rev || 0),
      files: map ? Object.keys(map.files || {}).length : 0, failed: [...latest.values()].filter((kind) => kind === 'failed').length,
      waiting: Object.keys(data.pending).length, lastSyncAt: data.lastSyncAt || '', lastError: data.lastError || '',
      backfill: backfill ? { jobId: backfill.jobId, ...summary() } : null, lastBackfill: lastBackfill ? { ...lastBackfill } : null,
      migratedPrograms: list(settings.migratedPrograms).length,
    };
  }
  // { [assetId]: url } of the files in the chosen folder, for "Open in Drive" on reports.
  function links(assetIds = null) {
    const map = data.settings.folderId ? data.maps[data.settings.folderId] : null; if (!map) return {};
    const keep = assetIds ? new Set(assetIds) : null;
    return Object.fromEntries(Object.entries(map.files || {}).filter(([assetId, file]) => file?.url && (!keep || keep.has(assetId))).map(([assetId, file]) => [assetId, file.url]));
  }
  const linkFor = (assetId) => links([assetId])[assetId] || '';
  // The per-program "Publish reports to Google Drive" (before this sync) still runs while no folder is connected; once one
  // is, the studio-wide switch decides and the old route stays off, so a report never lands in Drive twice.
  const legacyPublish = (program) => !ready() && Boolean(program?.delivery?.publishToDrive);
  // Programs that had "Publish reports to Google Drive" on turn the studio-wide switch on, once. Their saved setting is
  // left as it was.
  function migratePrograms() {
    if (Array.isArray(data.settings.migratedPrograms)) return;
    const ids = list(workspace.driveSource().programs).filter((program) => program?.delivery?.publishToDrive === true).map((program) => program.id);
    change(() => { data.settings.migratedPrograms = ids; if (ids.length) data.settings.autoAdd = true; });
  }
  function start() { stopped = false; try { migratePrograms(); } catch (error) { console.warn(`Google Drive program settings couldn’t be read: ${error.message}`); } arm(); }
  function stop() { stopped = true; if (timer) { clearTimer(timer); timer = null; } backfill?.job?.abort?.(); }
  const activeLine = () => (pumping ? 'Google Drive: adding reports' : '');

  return { connect, save, test, disconnect, readLog, retry, startBackfill, publicState, links, linkFor, legacyPublish, assetChanged, start, stop, activeLine, placeFor, syncAsset, pump, flush: () => chain };
}

module.exports = { createDriveSync, LOG_ROWS };
