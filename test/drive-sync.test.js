import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import sync from '../src/main/drive-sync.js';
import roles from '../src/main/roles.js';
import policy from '../src/shared/roles.json';
import channels from '../src/shared/studio-api-channels.json';

// The Google Drive folder sync (src/main/drive-sync.js) against an in-memory Drive: connect, the folder check, folders
// that mirror the Library without duplicates, create then update on edit, Copy existing reports, errors and Retry, the
// old per-program setting, and who may call it. Mocked fetch only.
const { createDriveSync } = sync;
const FOLDER = 'application/vnd.google-apps.folder';
const DOC = 'application/vnd.google-apps.document';
const EMAIL = 'studio-sync@studio-fixture.iam.gserviceaccount.com';
const PEM = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
const KEY = JSON.stringify({ type: 'service_account', project_id: 'studio-fixture', private_key_id: 'kid', private_key: PEM, client_email: EMAIL });
const reply = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const roots = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const page = (title, body) => `<!doctype html><html><head><meta charset="utf-8"/><title>${title}</title></head><body><h1>${title}</h1><p>${body}</p></body></html>`;

// A Drive with one shared folder (ROOT) the service account may add to. `fail(call)` can answer instead of Drive.
function fakeDrive({ fail } = {}) {
  const files = new Map([['ROOT_FOLDER_1', { id: 'ROOT_FOLDER_1', name: 'Studio reports', mimeType: FOLDER, parents: [], trashed: false, driveId: 'SHARED_DRIVE_1', capabilities: { canAddChildren: true } }]]);
  const calls = []; let sequence = 0; let tokens = 0;
  const media = (options) => { const boundary = options.headers['Content-Type'].split('boundary=')[1]; const parts = Buffer.from(options.body).toString('utf8').split(`--${boundary}`); return { metadata: JSON.parse(parts[1].split('\r\n\r\n')[1]), body: parts[2].slice(parts[2].indexOf('\r\n\r\n') + 4, -2) }; };
  const fetchImpl = vi.fn(async (url, options = {}) => {
    if (url === 'https://oauth2.googleapis.com/token') { tokens += 1; return reply({ access_token: `access-${tokens}`, expires_in: 3600 }); }
    const parsed = new URL(url); const call = { method: options.method || 'GET', path: parsed.pathname, query: parsed.searchParams };
    calls.push(call);
    expect(parsed.searchParams.get('supportsAllDrives')).toBe('true');
    if (fail) { const answer = await fail(call); if (answer) return answer; }
    const one = parsed.pathname.match(/^\/(?:upload\/)?drive\/v3\/files\/([^/]+)$/);
    if (call.method === 'GET' && one) return files.has(one[1]) ? reply(files.get(one[1])) : reply({ error: { code: 404 } }, 404);
    if (call.method === 'GET') {
      const q = parsed.searchParams.get('q');
      const parent = /'([^']+)' in parents/.exec(q)[1]; const name = /name = '((?:[^'\\]|\\.)*)'/.exec(q)?.[1]?.replace(/\\(.)/g, '$1'); const tag = /value='([^']+)'/.exec(q)?.[1];
      return reply({ files: [...files.values()].filter((file) => !file.trashed && file.parents.includes(parent) && (name === undefined || file.name === name) && (!q.includes('mimeType =') || file.mimeType === FOLDER) && (!tag || Object.values(file.appProperties || {}).includes(tag))) });
    }
    if (call.method === 'POST' && parsed.pathname === '/drive/v3/files') {
      const body = JSON.parse(options.body); if (!files.has(body.parents[0])) return reply({ error: { code: 404 } }, 404);
      const file = { id: `folder_${++sequence}`, ...body, trashed: false }; files.set(file.id, file); return reply(file);
    }
    if (call.method === 'POST') {
      const { metadata, body } = media(options); if (!files.has(metadata.parents[0])) return reply({ error: { code: 404 } }, 404);
      const file = { id: `file_${++sequence}`, ...metadata, content: body, trashed: false, webViewLink: `https://docs.google.com/document/d/file_${sequence}/edit` }; files.set(file.id, file); call.fileId = file.id; return reply(file);
    }
    if (call.method === 'PATCH') {
      const { metadata, body } = media(options); const file = files.get(one[1]); if (!file) return reply({ error: { code: 404 } }, 404);
      Object.assign(file, metadata, { content: body }); call.fileId = file.id; return reply(file);
    }
    throw new Error(`unexpected ${call.method} ${url}`);
  });
  const named = (name) => [...files.values()].filter((file) => file.name === name);
  return { files, calls, fetchImpl, named, writes: () => calls.filter((call) => call.method !== 'GET') };
}

// A workspace with one research run (two trends) and a quick scan, like content-workspace's driveSource/driveDocument.
function fakeWorkspace() {
  const source = {
    workspaceId: 'semrush', editionId: 'semrush',
    programs: [{ id: 'program-1', name: 'Weekly SEO pulse', workspaceId: 'semrush', delivery: { publishToDrive: false } }],
    researchRuns: [
      { id: 'research-1', type: 'research', programId: 'program-1', title: 'Weekly SEO pulse', createdAt: '2026-10-14T09:00:00Z', themes: [{ id: 'theme-a', name: 'AI Overviews' }, { id: 'theme-b', name: 'Zero-click search' }], reportRunIds: [{ themeId: 'theme-a', runId: 'report-a' }, { themeId: 'theme-b', runId: 'report-b' }] },
      { id: 'scan-1', type: 'research', origin: 'quick-scan', title: 'Quick scan · local SEO', quickScan: { topic: 'local SEO' }, createdAt: '2026-10-15T09:00:00Z', reportRunIds: [] },
    ],
    contentRuns: [
      { id: 'report-a', researchRunId: 'research-1', themeId: 'theme-a', title: 'AI Overviews', createdAt: '2026-10-14T10:00:00Z' },
      { id: 'report-b', researchRunId: 'research-1', themeId: 'theme-b', title: 'Zero-click search', createdAt: '2026-10-14T10:00:00Z' },
      { id: 'scan-report-1', researchRunId: 'scan-1', scanReport: true, title: 'local SEO', createdAt: '2026-10-15T10:00:00Z' },
      { id: 'kit-1', kit: { reportAssetId: 'asset-a-report', sourceTitle: 'AI Overviews' }, title: 'Kit', createdAt: '2026-10-16T08:30:00Z' },
      { id: 'draft-run', title: 'Draft', createdAt: '2026-10-16T08:30:00Z' },
    ],
    assets: [
      { id: 'asset-a-report', runId: 'report-a', deliverableId: 'evidence-report', kind: 'text', title: 'TREND: AI Overviews — Comprehensive Trends Report', createdAt: '2026-10-14T10:05:00Z' },
      { id: 'asset-a-kit', runId: 'report-a', deliverableId: 'editorial-toolkit', kind: 'text', title: 'AI Overviews toolkit', createdAt: '2026-10-14T10:09:00Z' },
      { id: 'asset-b-report', runId: 'report-b', deliverableId: 'evidence-report', kind: 'text', title: 'TREND: Zero-click search — Comprehensive Trends Report', createdAt: '2026-10-14T10:06:00Z' },
      { id: 'asset-scan', runId: 'scan-report-1', deliverableId: 'scan-report', kind: 'text', title: 'Local SEO this week', createdAt: '2026-10-15T10:05:00Z' },
      { id: 'asset-social', runId: 'kit-1', deliverableId: 'social', kind: 'text', title: 'Social post', createdAt: '2026-10-16T08:40:00Z' },
      { id: 'asset-draft', runId: 'draft-run', deliverableId: 'blogshort', kind: 'text', title: 'A draft', createdAt: '2026-10-16T08:40:00Z' },
    ],
  };
  const pages = Object.fromEntries(source.assets.map((asset) => [asset.id, page(asset.title, 'First version.')]));
  return {
    source, pages, documentCalls: [],
    driveSource() { return source; },
    driveDocument(assetId, options) { this.documentCalls.push({ assetId, ...options }); const asset = source.assets.find((row) => row.id === assetId); return asset ? { asset, html: options?.trendsDocUrl ? pages[assetId].replace('</body>', `<p><a href="${options.trendsDocUrl}">Full evidence</a></p></body>`) : pages[assetId] } : null; },
  };
}

function setup({ drive = fakeDrive(), workspace = fakeWorkspace(), root, saved = { key: '' }, token = '' } = {}) {
  root ||= fs.mkdtempSync(path.join(os.tmpdir(), 'drive-sync-')); roots.push(root);
  let clock = Date.UTC(2026, 9, 18, 12); const timers = [];
  const jobs = { started: [], start(job) { const controller = new AbortController(); const handle = { ...job, signal: controller.signal, abort: () => controller.abort(), progress: vi.fn(), finish: vi.fn(), fail: vi.fn() }; this.started.push(handle); return handle; } };
  const credentials = () => (saved.key ? { mode: 'service-account', key: JSON.parse(saved.key) } : token ? { mode: 'token', token } : null);
  const emitState = vi.fn();
  const engine = createDriveSync({ root, workspace, credentials, saveServiceAccount: (json) => { saved.key = json; }, clearServiceAccount: () => { saved.key = ''; }, emitState, jobs, fetchImpl: drive.fetchImpl, now: () => clock, sleep: async () => {}, setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimer: () => {}, createDelayMs: 10000, editDelayMs: 60000 });
  return { engine, drive, workspace, saved, root, jobs, emitState, timers, advance: (ms) => { clock += ms; }, now: () => clock };
}
async function connected(options) {
  const env = setup(options);
  await env.engine.connect({ serviceAccountKey: KEY });
  await env.engine.save({ folder: 'https://drive.google.com/drive/folders/ROOT_FOLDER_1?usp=sharing', autoAdd: true });
  return env;
}

describe('connecting', () => {
  it('saves the key only after Google signs it in, and shows the address to share with', async () => {
    const env = setup();
    await expect(env.engine.connect({ serviceAccountKey: '{"type":"authorized_user"}' })).rejects.toThrow(/isn’t a service account key/);
    expect(env.saved.key).toBe('');
    const result = await env.engine.connect({ serviceAccountKey: KEY });
    expect(result).toMatchObject({ ok: true, email: EMAIL, driveSync: { connected: true, mode: 'service-account', email: EMAIL, folder: null } });
    expect(JSON.parse(env.saved.key)).toEqual({ type: 'service_account', client_email: EMAIL, private_key: PEM, private_key_id: 'kid', project_id: 'studio-fixture' });
    expect(JSON.stringify(env.engine.publicState())).not.toContain('PRIVATE');
    expect(fs.readFileSync(path.join(env.root, 'drive-sync.json'), 'utf8')).not.toContain('PRIVATE');
  });

  it('checks the folder link, shows its name, and says to share it when the studio can’t add files', async () => {
    const env = setup();
    await env.engine.connect({ serviceAccountKey: KEY });
    await expect(env.engine.save({ folder: 'https://example.com/folders/x' })).rejects.toThrow(/isn’t a Google Drive folder link/);
    env.drive.files.set('READONLY_FOLDER', { id: 'READONLY_FOLDER', name: 'Read only', mimeType: FOLDER, parents: [], capabilities: { canAddChildren: false } });
    await expect(env.engine.save({ folder: 'READONLY_FOLDER' })).rejects.toThrow(`The studio can see “Read only” but can’t add files to it. Share it with ${EMAIL} as Editor (in a shared drive: Contributor or higher).`);
    await expect(env.engine.save({ folder: 'MISSING_FOLDER_1' })).rejects.toThrow(`The studio can’t see that folder or file. Share the folder with ${EMAIL} as Editor`);
    const saved = await env.engine.save({ folder: 'https://drive.google.com/drive/u/0/folders/ROOT_FOLDER_1' });
    expect(saved.driveSync.folder).toEqual({ id: 'ROOT_FOLDER_1', name: 'Studio reports', url: 'https://drive.google.com/drive/folders/ROOT_FOLDER_1', sharedDrive: true });
    expect((await env.engine.test()).message).toBe('Working. The studio can add files to “Studio reports”.');
    await expect(env.engine.save({ autoAdd: true, rev: 0 })).rejects.toMatchObject({ status: 409 });
  });

  it('falls back to the Google Docs access token when no service account is connected', async () => {
    const env = setup({ token: 'docs-access-token' });
    expect(env.engine.publicState()).toMatchObject({ connected: true, mode: 'token', email: '' });
    await env.engine.save({ folder: 'ROOT_FOLDER_1', autoAdd: true });
    expect((await env.engine.test()).message).toMatch(/with the access token, which expires after about an hour/);
    expect(env.drive.fetchImpl.mock.calls.every(([url, options]) => url.startsWith('https://oauth2') || options.headers.Authorization === 'Bearer docs-access-token')).toBe(true);
  });
});

describe('folders that mirror the Library', () => {
  it('files reports by run and trend, quick scans by topic, and never makes a folder twice', async () => {
    const env = await connected();
    for (const id of ['asset-a-report', 'asset-a-kit', 'asset-b-report', 'asset-scan']) await env.engine.syncAsset(id);
    const { named } = env.drive;
    expect(named('2026-10-14 · Weekly SEO pulse')).toHaveLength(1);
    const run = named('2026-10-14 · Weekly SEO pulse')[0];
    expect(run.parents).toEqual(['ROOT_FOLDER_1']);
    expect(named('AI Overviews')).toEqual([expect.objectContaining({ parents: [run.id], mimeType: FOLDER })]);
    expect(named('Zero-click search')[0].parents).toEqual([run.id]);
    expect(named('AI Overviews — Trends report')[0]).toMatchObject({ mimeType: DOC, parents: [named('AI Overviews')[0].id], appProperties: { studioAsset: 'asset-a-report' } });
    expect(named('AI Overviews — Editorial toolkit')[0].parents).toEqual([named('AI Overviews')[0].id]);
    expect(named('Quick scan · local SEO')[0].parents).toEqual(['ROOT_FOLDER_1']);
    expect(named('Quick scan report · local SEO')[0].parents).toEqual([named('Quick scan · local SEO')[0].id]);
    // The toolkit links its trends report's Doc, like n8n's "Full evidence" line.
    expect(named('AI Overviews — Editorial toolkit')[0].content).toContain(`href="${named('AI Overviews — Trends report')[0].webViewLink}"`);
    expect(env.drive.calls.filter((call) => call.method === 'POST' && call.path === '/drive/v3/files')).toHaveLength(4); // run, 2 trends, scan
    // Drafts and (while the option is off) channel assets stay in the studio.
    expect(await env.engine.syncAsset('asset-draft')).toEqual({ kind: 'skipped' });
    expect(await env.engine.syncAsset('asset-social')).toEqual({ kind: 'skipped' });
    expect(env.engine.links()).toEqual(expect.objectContaining({ 'asset-a-report': named('AI Overviews — Trends report')[0].webViewLink }));
  });

  it('puts channel assets in their trend’s folder when that option is on', async () => {
    const env = await connected();
    await env.engine.save({ includeChannelAssets: true });
    await env.engine.syncAsset('asset-social');
    const set = env.drive.named('Channel assets · 2026-10-16 08:30')[0];
    expect(set.parents).toEqual([env.drive.named('AI Overviews')[0].id]);
    expect(env.drive.named('Semrush Social Team')[0].parents).toEqual([set.id]);
    expect(env.drive.named('Social post')[0].parents).toEqual([env.drive.named('Semrush Social Team')[0].id]);
  });

  it('reuses a folder a person made, leaves another run’s same-named folder alone, and finds its own files after the id map is lost', async () => {
    const drive = fakeDrive();
    drive.files.set('PERSON_FOLDER', { id: 'PERSON_FOLDER', name: '2026-10-14 · Weekly SEO pulse', mimeType: FOLDER, parents: ['ROOT_FOLDER_1'], trashed: false });
    drive.files.set('OTHER_RUN', { id: 'OTHER_RUN', name: 'AI Overviews', mimeType: FOLDER, parents: ['PERSON_FOLDER'], trashed: false, appProperties: { studioKey: 'something-else' } });
    const first = await connected({ drive });
    await first.engine.syncAsset('asset-a-report');
    expect(drive.named('2026-10-14 · Weekly SEO pulse')).toHaveLength(1); // the person's folder was used
    expect(drive.named('AI Overviews')).toHaveLength(2); // a new one beside the other run's
    // A second studio pointing at the same folder with an empty map adds nothing new.
    const second = await connected({ drive });
    const before = drive.files.size;
    expect((await second.engine.syncAsset('asset-a-report')).kind).toBe('updated');
    expect(drive.files.size).toBe(before);
  });
});

describe('create, then update on edit', () => {
  it('queues a new report, sends it a few seconds later, and updates the same Doc a minute after an edit', async () => {
    const env = await connected();
    env.engine.assetChanged({ assetId: 'asset-a-report', reason: 'created' });
    env.engine.assetChanged({ assetId: 'asset-draft', reason: 'created' }); // not a report: never queued
    expect(env.engine.publicState().waiting).toBe(1);
    expect(env.timers.at(-1).ms).toBe(10000);
    await env.engine.pump(); expect(env.drive.writes()).toHaveLength(0); // not due yet
    env.advance(10000); await env.engine.pump();
    const doc = env.drive.named('AI Overviews — Trends report')[0];
    expect(doc.content).toContain('First version.');
    expect(env.engine.readLog().rows[0]).toMatchObject({ kind: 'added', assetId: 'asset-a-report', title: 'TREND: AI Overviews — Comprehensive Trends Report', where: '2026-10-14 · Weekly SEO pulse / AI Overviews', url: doc.webViewLink });
    // Typing saves every second and a half; the Doc follows a minute after the last change.
    env.workspace.pages['asset-a-report'] = page('AI Overviews', 'Edited in the studio.');
    env.engine.assetChanged({ assetId: 'asset-a-report', reason: 'edited' });
    env.advance(30000); env.engine.assetChanged({ assetId: 'asset-a-report', reason: 'edited' });
    env.advance(45000); await env.engine.pump(); expect(doc.content).toContain('First version.');
    env.advance(15000); await env.engine.pump();
    expect(doc.content).toContain('Edited in the studio.');
    expect(env.drive.writes().filter((call) => call.method === 'PATCH')).toEqual([expect.objectContaining({ fileId: doc.id })]);
    expect(env.engine.readLog().rows[0]).toMatchObject({ kind: 'updated', assetId: 'asset-a-report' });
    // Nothing changed: no call to Drive.
    const writes = env.drive.writes().length;
    expect((await env.engine.syncAsset('asset-a-report')).kind).toBe('unchanged');
    expect(env.drive.writes()).toHaveLength(writes);
  });

  it('keeps an edit made while that report was being sent, and sends it a minute later', async () => {
    const drive = fakeDrive(); const real = drive.fetchImpl; let editDuringUpload = null;
    drive.fetchImpl = vi.fn(async (url, options) => { if (editDuringUpload && options?.method === 'POST' && url.includes('/upload/')) { editDuringUpload(); editDuringUpload = null; } return real(url, options); });
    const env = await connected({ drive });
    env.engine.assetChanged({ assetId: 'asset-a-report', reason: 'created' });
    editDuringUpload = () => { env.workspace.pages['asset-a-report'] = page('AI Overviews', 'Typed during the upload.'); env.engine.assetChanged({ assetId: 'asset-a-report', reason: 'edited' }); };
    env.advance(10000); await env.engine.pump();
    const doc = env.drive.named('AI Overviews — Trends report')[0];
    expect(doc.content).toContain('First version.');
    expect(env.engine.publicState().waiting).toBe(1); // the edit is still queued
    env.advance(60000); await env.engine.pump();
    expect(doc.content).toContain('Typed during the upload.');
    expect(env.engine.publicState().waiting).toBe(0);
  });

  it('waits quietly while the switch is off or Drive isn’t connected, and sends what waited once it’s back on', async () => {
    const env = await connected();
    env.engine.assetChanged({ assetId: 'asset-scan', reason: 'created' });
    await env.engine.save({ autoAdd: false });
    env.advance(10000); await env.engine.pump();
    expect(env.drive.writes()).toHaveLength(0);
    expect(env.engine.publicState().waiting).toBe(1);
    expect(env.timers.at(-1).ms).toBeGreaterThanOrEqual(60000); // no 250 ms loop while nothing can be sent
    await env.engine.save({ autoAdd: true });
    expect(env.timers.at(-1).ms).toBe(250); // turning it back on sends what waited straight away
    await env.engine.pump();
    expect(env.drive.named('Quick scan report · local SEO')).toHaveLength(1);
  });

  it('adds the Doc again when someone deleted it in Drive, and keeps the queue when the switch is off', async () => {
    const env = await connected();
    await env.engine.syncAsset('asset-b-report');
    const old = env.drive.named('Zero-click search — Trends report')[0]; env.drive.files.delete(old.id);
    env.workspace.pages['asset-b-report'] = page('Zero-click', 'Second version.');
    expect((await env.engine.syncAsset('asset-b-report')).kind).toBe('added');
    expect(env.drive.named('Zero-click search — Trends report')).toHaveLength(1);
    await env.engine.save({ autoAdd: false });
    env.engine.assetChanged({ assetId: 'asset-scan', reason: 'created' });
    expect(env.engine.publicState().waiting).toBe(0);
  });
});

describe('Copy existing reports', () => {
  it('copies every report as a cancellable job, oldest first, and a second copy adds nothing', async () => {
    const env = await connected();
    const started = env.engine.startBackfill();
    expect(started).toEqual({ jobId: expect.stringMatching(/^drive-copy-/), total: 4 });
    expect(env.engine.startBackfill()).toMatchObject({ jobId: started.jobId, joined: true });
    await vi.waitFor(() => expect(env.engine.publicState().backfill).toBeNull());
    const job = env.jobs.started[0];
    expect(job).toMatchObject({ kind: 'drive', title: 'Copying reports to Google Drive' });
    expect(job.finish).toHaveBeenCalledWith({ status: 'succeeded', result: expect.objectContaining({ total: 4, added: 4, failed: 0 }) });
    expect(job.progress).toHaveBeenLastCalledWith(100);
    expect(env.engine.publicState()).toMatchObject({ files: 4, lastBackfill: expect.objectContaining({ added: 4 }) });
    env.engine.startBackfill();
    await vi.waitFor(() => expect(env.engine.publicState().backfill).toBeNull());
    expect(env.engine.publicState().lastBackfill).toMatchObject({ unchanged: 4, added: 0 });
    expect(env.drive.calls.filter((call) => call.method === 'POST' && call.path.startsWith('/upload'))).toHaveLength(4);
  });

  it('stops when cancelled', async () => {
    const env = await connected();
    env.engine.startBackfill(); env.jobs.started[0].abort();
    await vi.waitFor(() => expect(env.engine.publicState().backfill).toBeNull());
    expect(env.jobs.started[0].finish).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled' }));
  });
});

describe('errors and Retry', () => {
  it('logs a plain reason, keeps going, and Retry sends the file once the folder is shared', async () => {
    let shared = false;
    const drive = fakeDrive({ fail: (call) => (!shared && call.method === 'POST' && call.path.startsWith('/upload') ? reply({ error: { code: 403, errors: [{ reason: 'insufficientFilePermissions' }] } }, 403) : null) });
    const env = await connected({ drive });
    await expect(env.engine.syncAsset('asset-scan')).rejects.toThrow(/can’t add files to it/);
    expect(env.engine.readLog().rows[0]).toMatchObject({ kind: 'failed', assetId: 'asset-scan', error: `The studio can see the folder but can’t add files to it. Share the folder with ${EMAIL} as Editor (in a shared drive: Contributor or higher), not Viewer or Commenter.` });
    expect(env.engine.publicState()).toMatchObject({ failed: 1, lastError: expect.stringMatching(/can’t add files/) });
    shared = true;
    expect(await env.engine.retry({ assetId: 'asset-scan' })).toMatchObject({ kind: 'added', driveSync: { failed: 0 } });
    await expect(env.engine.retry({ assetId: '../x' })).rejects.toMatchObject({ status: 400 });
  });

  it('tries a temporary failure again later instead of giving up', async () => {
    let busy = true;
    const drive = fakeDrive({ fail: (call) => (busy && call.method === 'POST' && call.path.startsWith('/upload') ? reply({ error: { code: 503 } }, 503) : null) });
    const env = await connected({ drive });
    env.engine.assetChanged({ assetId: 'asset-scan', reason: 'created' });
    env.advance(10000); await env.engine.pump();
    expect(env.engine.readLog().rows[0]).toMatchObject({ kind: 'failed', error: expect.stringMatching(/Google Drive had a problem on its side/) });
    expect(env.engine.publicState().waiting).toBe(1); // back in the queue for five minutes from now
    busy = false; env.advance(5 * 60 * 1000); await env.engine.pump();
    expect(env.engine.readLog().rows[0]).toMatchObject({ kind: 'added', assetId: 'asset-scan' });
  });

  it('never adds a second copy when Drive made the file but its answer was lost', async () => {
    const drive = fakeDrive(); const real = drive.fetchImpl; let lose = true;
    drive.fetchImpl = vi.fn(async (url, options) => { const answer = await real(url, options); if (lose && options?.method === 'POST' && url.includes('/upload/')) { lose = false; return reply({ error: { code: 503 } }, 503); } return answer; });
    const env = await connected({ drive });
    await expect(env.engine.syncAsset('asset-scan')).rejects.toMatchObject({ code: 'driveBusy', retryable: true });
    expect(env.drive.named('Quick scan report · local SEO')).toHaveLength(1); // Drive made it once; the studio didn't send it again
    expect((await env.engine.retry({ assetId: 'asset-scan' })).kind).toBe('updated');
    expect(env.drive.named('Quick scan report · local SEO')).toHaveLength(1);
  });

  it('keeps the log to the newest 200 rows', async () => {
    const env = await connected();
    for (let index = 0; index < 205; index += 1) { env.workspace.pages['asset-scan'] = page('Scan', `Version ${index}`); await env.engine.syncAsset('asset-scan'); }
    expect(env.engine.readLog().rows).toHaveLength(200);
  });
});

describe('the old per-program setting, and disconnecting', () => {
  it('turns the switch on once for programs that published to Drive, and stops the old route once a folder is connected', async () => {
    const workspace = fakeWorkspace(); workspace.source.programs[0].delivery.publishToDrive = true;
    const env = setup({ workspace });
    env.engine.start();
    expect(env.engine.publicState()).toMatchObject({ autoAdd: true, migratedPrograms: 1 });
    expect(workspace.source.programs[0].delivery.publishToDrive).toBe(true); // left as it was
    expect(env.engine.legacyPublish(workspace.source.programs[0])).toBe(true); // nothing connected yet: the old route runs
    await env.engine.connect({ serviceAccountKey: KEY }); await env.engine.save({ folder: 'ROOT_FOLDER_1', autoAdd: false });
    expect(env.engine.legacyPublish(workspace.source.programs[0])).toBe(false); // the switch decides now
    // A restart doesn't turn it back on.
    const again = setup({ workspace, root: env.root, saved: env.saved }); again.engine.start();
    expect(again.engine.publicState()).toMatchObject({ autoAdd: false, migratedPrograms: 1 });
  });

  it('disconnects without forgetting which files are already in Drive', async () => {
    const env = await connected();
    await env.engine.syncAsset('asset-scan');
    const result = env.engine.disconnect();
    expect(result.driveSync).toMatchObject({ connected: false, folder: null });
    expect(env.saved.key).toBe('');
    await env.engine.connect({ serviceAccountKey: KEY }); await env.engine.save({ folder: 'ROOT_FOLDER_1' });
    env.workspace.pages['asset-scan'] = page('Scan', 'After reconnecting.');
    expect((await env.engine.syncAsset('asset-scan')).kind).toBe('updated');
    expect(env.drive.named('Quick scan report · local SEO')).toHaveLength(1);
  });
});

describe('who may use it', () => {
  const methods = ['connectDriveSync', 'saveDriveSync', 'testDriveSync', 'startDriveBackfill', 'retryDriveSync', 'disconnectDriveSync', 'readDriveSyncLog'];
  it('is admin-only Settings, with the log as a read', () => {
    for (const method of methods) {
      expect(channels.methods[method]).toMatch(/^drive:/);
      expect(roles.CAP_OF_METHOD[method]).toBe('settings');
      expect(roles.canCall('admin', method)).toBe(true);
      expect(roles.canCall('editor', method)).toBe(false);
      expect(roles.canCall('channel', method)).toBe(false);
    }
    expect(policy.readMethods).toContain('readDriveSyncLog');
    expect(policy.readMethods).not.toContain('startDriveBackfill');
  });

  it('shows Open in Drive links only to roles that read reports', () => {
    const base = { contentStudio: { activeWorkspaceId: 'w', workspaces: [{ id: 'w', editionId: 'semrush' }], assets: [], driveLinks: { 'asset-1': 'https://docs.google.com/document/d/x/edit' } } };
    const viewer = (capabilities) => ({ id: 'p', role: 'editor', base: 'editor', capabilities });
    expect(roles.projectState(base, { id: 'a', role: 'admin', base: 'admin' }).contentStudio.driveLinks).toEqual({ 'asset-1': 'https://docs.google.com/document/d/x/edit' });
    expect(roles.projectState(base, viewer(['core', 'readAssets'])).contentStudio.driveLinks).toEqual({ 'asset-1': 'https://docs.google.com/document/d/x/edit' });
    expect(roles.projectState(base, viewer(['core', 'readResearch'])).contentStudio.driveLinks).toEqual({});
    expect(roles.projectState(base, { id: 'c', role: 'channel', base: 'channel', channelId: 'social', capabilities: ['core', 'readAssets'] }).contentStudio.driveLinks).toBeUndefined();
  });
});
