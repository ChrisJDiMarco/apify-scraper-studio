import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import workspaceModule from '../src/main/content-workspace.js';
import content from '../src/shared/content-studio.js';
import fixture from './helpers/research-ai-fixture.js';
import studio from './helpers/roles-studio.js';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createContentWorkspace } = workspaceModule;
const { seedStudio, TREND } = studio;
const roots = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const tempRoot = (name) => { const root = fs.mkdtempSync(path.join(os.tmpdir(), name)); roots.push(root); return root; };
const RILEY = { id: 'member-riley', name: 'Riley' }; const CHRIS = { id: 'member-chris', name: 'Chris' }; const ALEX = { id: 'member-alex', name: 'Alex' };
const SYSTEM = { id: 'system', name: 'Automatic' };

// ---------- Attribution through the research pipeline ----------
const rows = (count) => Array.from({ length: count }, (_, i) => ({ id: `source-${i}`, externalId: String(i), platform: 'x', author: `person${i}`, type: 'post', text: `Reporting problem ${i}: dashboards take too much manual work.`, url: `https://x.com/person${i}/status/${i + 1}`, publishedAt: '2026-09-20T12:00:00Z', raw: { likeCount: 100, replyCount: 20, retweetCount: 10, quoteCount: 3, bookmarkCount: 5, viewCount: 1000 } }));
const program = (extra = {}) => ({ id: 'program-a', name: 'Weekly research', sourceGroups: [{ platform: 'x', targets: ['researcher'] }], window: { startDate: '2026-09-20', endDate: '2026-09-26' }, budgets: { collectionUsd: 1, aiUsd: 10 }, ...extra });
function draft(request) {
  const research = fixture.researchOutput(request); if (research) return research;
  const context = JSON.parse(request.prompt.split('UNTRUSTED_SOURCE_AND_BRAND_DATA:\n')[1].split('\n\nYOUR PREVIOUS RESPONSE')[0]);
  const ids = request.schema.properties.sections.items.properties.id.enum;
  const descriptor = content.CONTENT_DELIVERABLES.find((value) => value.kind === 'text' && JSON.stringify(value.sections.map((section) => section.id)) === JSON.stringify(ids));
  const cite = context.source.evidence[1]?.id || context.source.evidence[0].id;
  return { title: `${descriptor.label} draft`, summary: 'Fixture summary.', sections: descriptor.sections.map((section) => ({ id: section.id, heading: section.heading, body: 'Sourced fixture body.', items: Array.from({ length: section.minItems || 0 }, (_, i) => ({ label: `Item ${i + 1}`, text: 'Review it', evidenceIds: [cite], productIds: [] })), evidenceIds: [cite], productIds: [] })), caveats: ['Fixture only; no approved products were supplied.'], ...(descriptor.id === 'evidence-report' ? { quotes: [] } : {}), ...(descriptor.id === 'pr' ? { journalists: [] } : {}) };
}
// `person.current` is whoever is calling now; tests change it while background work runs.
function researchHarness({ clock } = {}) {
  const root = tempRoot('roles-research-'); const person = { current: RILEY }; const items = rows(5);
  const api = createContentWorkspace({ root, actor: () => person.current, runAI: async (request) => ({ output: draft(request), receipt: { costUsd: 0.001, provider: 'fixture' } }), getDatasets: () => [{ id: 'dataset-a', name: 'Example', platform: 'x', itemCount: items.length }], readDataset: async () => ({ items }), collect: async ({ program: p }) => ({ items: rows(1).map((row) => ({ ...row, publishedAt: `${p.window.endDate || '2026-09-26'}T12:00:00Z` })), receipt: { provider: 'fixture' } }), ...(clock ? { clock } : {}) });
  return { root, api, person };
}

describe('who did what in the research pipeline', () => {
  it('credits the person who started a run, decided a trend or approved, never whoever is calling later', async () => {
    const h = researchHarness(); h.api.saveResearchProgram(program());
    const started = h.api.startResearchRun({ programId: 'program-a', datasetIds: ['dataset-a'] });
    h.person.current = CHRIS; // someone else is using the studio while the search runs
    await h.api.waitForIdle();
    let run = h.api.readStudioRun({ runId: started.id });
    expect(run).toMatchObject({ status: 'awaiting-review', createdBy: RILEY });
    const [theme] = run.discoveredThemes;
    h.person.current = ALEX; h.api.decideResearchTheme({ runId: run.id, themeId: theme.id, decision: 'approved' });
    expect(h.api.readStudioRun({ runId: run.id }).decisionsBy[theme.id]).toEqual({ ...ALEX, at: expect.any(String) });
    h.api.decideResearchTheme({ runId: run.id, themeId: theme.id, decision: 'pending' }); // Undo forgets who decided
    expect(h.api.readStudioRun({ runId: run.id }).decisionsBy).toEqual({});
    h.api.decideResearchTheme({ runId: run.id, themeId: theme.id, decision: 'approved' });
    // Approving the same choice again leaves Alex's decision his; decisions stay exactly as before.
    h.person.current = CHRIS; h.api.approveResearchThemes({ runId: run.id, themes: [theme.id] });
    run = h.api.readStudioRun({ runId: run.id });
    expect(run.decisions).toEqual({ [theme.id]: 'approved' }); expect(run.decisionsBy[theme.id]).toMatchObject(ALEX);
    h.api.continueResearchRun({ runId: run.id }); await h.api.waitForIdle();
    run = h.api.readStudioRun({ runId: run.id });
    expect(run.status).toBe('succeeded');
    // Report runs written for the trend belong to whoever started the search.
    const reports = h.api.publicState().contentRuns.filter((entry) => entry.researchRunId === run.id);
    expect(reports.length).toBeGreaterThan(0); for (const report of reports) expect(report.createdBy).toEqual(RILEY);
    // A follow-up and a kit are the caller's.
    const reportAsset = h.api.publicState().assets.find((asset) => asset.deliverableId === 'evidence-report');
    h.person.current = ALEX;
    expect(h.api.createContentRun({ source: { kind: 'report', assetId: reportAsset.id }, deliverableIds: ['social'], maxBudgetUsd: 1, createdBy: CHRIS }).createdBy).toEqual(ALEX);
    expect(h.api.createAssetKit({ source: { kind: 'report', assetId: reportAsset.id }, deliverableIds: ['blogshort'] }).createdBy).toEqual(ALEX);
    await h.api.waitForIdle();
  }, 30000); // a whole research run and its reports; slow when the suite runs in parallel.

  it('credits automatic approval and schedules to the system', async () => {
    const h = researchHarness(); h.api.saveResearchProgram(program({ autoApproveThemes: true, budgets: { collectionUsd: 1, aiUsd: 40 } }));
    const started = h.api.startResearchRun({ programId: 'program-a', datasetIds: ['dataset-a'] }); await h.api.waitForIdle();
    const run = h.api.readStudioRun({ runId: started.id });
    expect(run.createdBy).toEqual(RILEY);
    expect(Object.values(run.decisionsBy)).toEqual(run.discoveredThemes.map(() => ({ ...SYSTEM, at: run.approvedAt })));
    let now = '2026-09-27T12:00:00Z';
    const scheduled = researchHarness({ clock: () => new Date(now) });
    scheduled.api.saveResearchProgram(program({ schedule: { frequency: 'daily', enabled: true, time: '09:00', timeZone: 'America/New_York', weekday: 1, dayOfMonth: 1, lookbackDays: 1 } }));
    now = '2026-09-27T13:01:00Z';
    const [result] = scheduled.api.checkDueResearchSchedules();
    expect(result.status).toBe('started');
    expect(scheduled.api.readStudioRun({ runId: result.runId }).createdBy).toEqual(SYSTEM);
    await scheduled.api.waitForIdle();
  }, 30000); // two research runs; slow when the suite runs in parallel.

  it('won’t start a program’s search twice by accident, and says who started the first', async () => {
    const h = researchHarness(); h.api.saveResearchProgram(program());
    const first = h.api.startResearchRun({ programId: 'program-a', datasetIds: ['dataset-a'] }); await h.api.waitForIdle();
    expect(h.api.readStudioRun({ runId: first.id }).status).toBe('awaiting-review');
    h.person.current = CHRIS;
    const refusal = (() => { try { h.api.startResearchRun({ programId: 'program-a', datasetIds: ['dataset-a'] }); } catch (error) { return error; } return null; })();
    expect(refusal).toMatchObject({ status: 409, code: 'researchRunning', message: expect.stringMatching(/^Riley started a search with this program at [A-Z][a-z]{2} \d+, \d+:\d{2} [AP]M .+\. It’s still running\.$/) });
    expect(() => h.api.checkResearchIdle({ programId: 'program-a' })).toThrow('Riley started a search');
    expect(() => h.api.checkResearchIdle({ programId: 'program-a', again: true })).not.toThrow();
    const second = h.api.startResearchRun({ programId: 'program-a', datasetIds: ['dataset-a'], again: true });
    expect(second.createdBy).toEqual(CHRIS); await h.api.waitForIdle();
  });
});

// ---------- Edited reports, kits and exports ----------
// The roles studio: an approved trend with its report and toolkit, and a Social Team set.
function kitHarness({ hold = false, publishCampaign } = {}) {
  const dataDir = tempRoot('roles-kit-'); const { root } = seedStudio(dataDir, { team: false });
  const person = { current: RILEY }; const waiting = []; let holding = hold;
  const runAI = vi.fn(async (request) => {
    if (holding) await new Promise((resolve) => waiting.push(resolve));
    return { output: draft(request), receipt: { provider: 'fixture', costUsd: 0.05 } };
  });
  const api = createContentWorkspace({ root, actor: () => person.current, runAI, publishCampaign, capabilities: () => ({ aiProvider: 'auto', imagesConfigured: false }) });
  return { root, api, person, runAI, release: () => { holding = false; for (const resolve of waiting.splice(0)) resolve(); } };
}
const refusalOf = (fn) => { try { fn(); } catch (error) { return error; } return null; };

describe('reports edited in the studio', () => {
  it('saves an edit beside the generated files and every reader uses it', async () => {
    const h = kitHarness();
    const original = h.api.readStudioAsset({ assetId: 'asset-toolkit' });
    expect(original).toMatchObject({ edited: null }); expect(original).not.toHaveProperty('originalMarkdown');
    const markdown = '# Measurement first\n\nUNIQUE-EDIT: lead with **ROI**.\n\n- [Study](https://example.com/study)\n- <script>alert(1)</script>';
    const { asset } = h.api.editStudioAsset({ assetId: 'asset-toolkit', markdown, baseEditedAt: '' });
    expect(asset.edited).toEqual({ at: expect.any(String), by: RILEY });
    const html = fs.readFileSync(path.join(h.root, 'runs', 'content-trend', 'asset-toolkit.edited.html'), 'utf8');
    expect(html).toMatch(/^<!doctype html>.*<title>Measurement first<\/title>.*<h1>Measurement first<\/h1><\/header><main class="doc">/s);
    expect(html).toContain('<a href="https://example.com/study">Study</a>'); expect(html).toContain('&lt;script&gt;'); expect(html).not.toContain('<script>');
    const read = h.api.readStudioAsset({ assetId: 'asset-toolkit' });
    expect(read).toMatchObject({ markdown, originalMarkdown: original.markdown, edited: { at: asset.edited.at, byName: 'Riley' } });
    expect(read.output).toEqual(original.output); // the data behind it stays the generated JSON
    expect(h.api.planAssetKit({ source: { kind: 'report', assetId: 'asset-report' } }).edited).toEqual({ at: asset.edited.at, byName: 'Riley' });
    // A kit made now reads the edited brief, as does a follow-up draft from the toolkit.
    const kit = h.api.createAssetKit({ source: { kind: 'report', assetId: 'asset-report' }, deliverableIds: ['blogshort'] });
    expect(JSON.parse(fs.readFileSync(path.join(h.root, 'runs', kit.id, 'input.json'), 'utf8')).source.text).toContain('UNIQUE-EDIT');
    await h.api.waitForIdle();
    const follow = h.api.createContentRun({ source: { kind: 'report', assetId: 'asset-toolkit' }, deliverableIds: ['social'], maxBudgetUsd: 1 });
    expect(JSON.parse(fs.readFileSync(path.join(h.root, 'runs', follow.id, 'input.json'), 'utf8')).source.text).toBe(markdown);
    await h.api.waitForIdle();
    // Exports and opening the file use the edited page and text.
    const exported = h.api.exportStudioRun({ runId: 'content-trend' });
    const strategy = path.join(exported.path, 'Strategy');
    expect(fs.readFileSync(path.join(strategy, 'editorial-toolkit-asset-toolkit.md'), 'utf8')).toBe(markdown);
    expect(fs.readFileSync(path.join(strategy, 'editorial-toolkit-asset-toolkit.html'), 'utf8')).toBe(html);
    expect(JSON.parse(fs.readFileSync(path.join(strategy, 'editorial-toolkit-asset-toolkit.json'), 'utf8'))).toEqual(original.output);
    expect((await h.api.openStudioAsset({ assetId: 'asset-toolkit' })).path).toMatch(/asset-toolkit\.edited\.html$/);
  });

  it('refuses a stale save with who saved and when, and keeps pictures and landing pages out', () => {
    const h = kitHarness();
    const { asset } = h.api.editStudioAsset({ assetId: 'asset-report', markdown: '# First edit', baseEditedAt: '' });
    h.person.current = CHRIS;
    expect(refusalOf(() => h.api.editStudioAsset({ assetId: 'asset-report', markdown: '# Mine', baseEditedAt: '' }))).toMatchObject({ status: 409, code: 'editConflict', message: expect.stringMatching(/^Riley saved this report at .+, after you opened it\. Copy your text, reopen the report and try again\.$/) });
    expect(h.api.editStudioAsset({ assetId: 'asset-report', markdown: '# Second edit', baseEditedAt: asset.edited.at }).asset.edited.by).toEqual(CHRIS);
    expect(() => h.api.editStudioAsset({ assetId: 'asset-report', markdown: '   ', baseEditedAt: '' })).toThrow('Write the report before saving');
    expect(() => h.api.editStudioAsset({ assetId: 'asset-report', markdown: 'x'.repeat(250001), baseEditedAt: '' })).toThrow('under 250,000 characters');
    const state = JSON.parse(fs.readFileSync(path.join(h.root, 'state.json'), 'utf8'));
    state.assets.push({ id: 'image-1', workspaceId: 'semrush', runId: 'content-kit-social', deliverableId: 'brand-image', kind: 'image', title: 'Hero', createdAt: '2026-10-11T10:00:00.000Z' }, { id: 'asset-landing', workspaceId: 'semrush', runId: 'content-kit-social', deliverableId: 'landingpage', kind: 'text', title: 'Landing', createdAt: '2026-10-11T10:00:00.000Z' });
    fs.writeFileSync(path.join(h.root, 'state.json'), JSON.stringify(state));
    const reopened = createContentWorkspace({ root: h.root, runAI: async () => ({}) });
    expect(() => reopened.editStudioAsset({ assetId: 'image-1', markdown: '# x', baseEditedAt: '' })).toThrow('Pictures and landing pages can’t be edited here.');
    expect(() => reopened.editStudioAsset({ assetId: 'asset-landing', markdown: '# x', baseEditedAt: '' })).toThrow('Pictures and landing pages can’t be edited here.');
  });

  it('restores the original, and someone who opened the edit is told who restored it', () => {
    const h = kitHarness();
    const { asset } = h.api.editStudioAsset({ assetId: 'asset-toolkit', markdown: '# Edited', baseEditedAt: '' });
    h.person.current = CHRIS;
    const restored = h.api.restoreStudioAsset({ assetId: 'asset-toolkit' }).asset;
    expect(restored).not.toHaveProperty('edited'); expect(restored.restored).toEqual({ at: expect.any(String), by: CHRIS });
    for (const name of ['asset-toolkit.edited.md', 'asset-toolkit.edited.html']) expect(fs.existsSync(path.join(h.root, 'runs', 'content-trend', name))).toBe(false);
    expect(h.api.readStudioAsset({ assetId: 'asset-toolkit' })).toMatchObject({ edited: null, markdown: expect.stringContaining('Toolkit: lead with the measurement gap.') });
    h.person.current = RILEY;
    expect(refusalOf(() => h.api.editStudioAsset({ assetId: 'asset-toolkit', markdown: '# Late', baseEditedAt: asset.edited.at }))).toMatchObject({ status: 409, message: expect.stringMatching(/^Chris saved this report at /) });
    expect(h.api.restoreStudioAsset({ assetId: 'asset-toolkit' }).asset).not.toHaveProperty('edited'); // nothing to restore: no change
  });

  it('sends an edited toolkit to Drive as edited, with the trends report link at the end', async () => {
    const delivered = [];
    const publishCampaign = vi.fn(async ({ assets }) => { delivered.push(...assets); return { status: 'Published', assets: assets.map((entry) => ({ assetId: entry.id, files: [{ url: `https://docs.google.com/document/d/doc-${entry.id}/edit` }] })) }; });
    const h = kitHarness({ publishCampaign });
    h.api.editStudioAsset({ assetId: 'asset-toolkit', markdown: '# Edited toolkit\n\nUNIQUE-DRIVE-EDIT', baseEditedAt: '' });
    await h.api.publishStudioRun({ runId: 'content-trend' });
    const toolkit = delivered.find((entry) => entry.id.startsWith('asset-toolkit-edited-'));
    expect(toolkit.title).toBe(`TREND: ${TREND} (edited)`);
    expect(toolkit.html).toContain('UNIQUE-DRIVE-EDIT');
    expect(toolkit.html).toMatch(/<p><a href="https:\/\/docs\.google\.com\/document\/d\/doc-asset-report\/edit">Full evidence, quotes, and source links\.<\/a><\/p><\/main><\/body><\/html>$/);
  });
});

describe('Drive after an edit', () => {
  it('saves an edited report to Drive again as a new file next to the original, and still delivers new files', async () => {
    const { createBridgeDelivery } = await import('../src/main/bridge-delivery.js');
    let count = 0; const made = new Map(); const requests = [];
    const callBridge = async (request) => { requests.push(request); if (!made.has(request.requestId)) { count += 1; made.set(request.requestId, { fileId: `file-${String(count).padStart(12, '0')}`, documentId: `doc-${String(count).padStart(12, '0')}`, name: request.name, folderId: 'folder-000000000001' }); } return made.get(request.requestId); };
    const bridge = createBridgeDelivery({ callBridge, getFolders: () => ({ default: 'folder-000000000001' }) });
    const h = kitHarness({ publishCampaign: bridge.publishCampaign });
    const first = await h.api.publishStudioRun({ runId: 'content-trend' });
    expect(first.status).toBe('succeeded');
    expect(first.assets.map((entry) => entry.assetId).sort()).toEqual(['asset-report', 'asset-toolkit']);
    // An http:// link in the edit stays text, since Drive delivery takes https links only.
    h.api.editStudioAsset({ assetId: 'asset-report', markdown: '# Edited report\n\nUNIQUE-SECOND-PUBLISH lead paragraph. See [the old study](http://example.com/study) and [the new one](https://example.com/new).', baseEditedAt: '' });
    requests.length = 0;
    const second = await h.api.publishStudioRun({ runId: 'content-trend' });
    expect(second.status).toBe('succeeded');
    const edited = second.assets.find((entry) => entry.assetId.startsWith('asset-report-edited-'));
    expect(edited).toBeTruthy();
    // The edit went out as its own file; the original and the toolkit Drive already had were left as they were.
    expect(requests).toEqual([expect.objectContaining({ action: 'createDoc', title: expect.stringMatching(/^Priority_Trends_AI Citation Tracking_.+ \(edited\)$/), html: expect.stringContaining('UNIQUE-SECOND-PUBLISH') })]);
    expect(second.assets.map((entry) => entry.assetId).filter((id) => ['asset-report', 'asset-toolkit'].includes(id)).sort()).toEqual(['asset-report', 'asset-toolkit']);
    expect(h.api.readStudioRun({ runId: 'content-trend' }).deliveryMessage).toBe('succeeded');
    // Saving again with no change is a no-op, and Restore goes back to the original Drive already has.
    expect((await h.api.publishStudioRun({ runId: 'content-trend' })).status).toBe('succeeded');
    h.api.restoreStudioAsset({ assetId: 'asset-report' });
    expect((await h.api.publishStudioRun({ runId: 'content-trend' })).status).toBe('succeeded');
  });
});

describe('channel sets', () => {
  it('refuses a second set from the same trend while one is being made, only when asked to', async () => {
    const h = kitHarness({ hold: true }); const source = { kind: 'report', assetId: 'asset-toolkit' };
    const first = h.api.createAssetKit({ source, deliverableIds: ['blogshort', 'bloglong'], onlyIfIdle: true });
    expect(first.status).toBe('queued');
    expect(refusalOf(() => h.api.createAssetKit({ source, deliverableIds: ['bloglong'], onlyIfIdle: true }))).toMatchObject({ status: 409, code: 'alreadyMaking', message: 'Your Semrush Blog assets for this trend are already being made.' });
    const before = h.api.publicState().contentRuns.filter((run) => run.kit).length;
    // Another channel's files from the same trend, or an editor's deliberate second set, go ahead.
    expect(h.api.createAssetKit({ source, deliverableIds: ['newsletter'], onlyIfIdle: true }).id).toBeTruthy();
    expect(h.api.createAssetKit({ source, deliverableIds: ['blogshort'] }).id).toBeTruthy();
    expect(h.api.publicState().contentRuns.filter((run) => run.kit).length).toBe(before + 2);
    h.release(); await h.api.waitForIdle();
    expect(h.api.readStudioRun({ runId: first.id }).status).toBe('succeeded');
    expect(h.api.createAssetKit({ source, deliverableIds: ['blogshort'], onlyIfIdle: true }).id).toBeTruthy(); // finished: a new set is fine
    await h.api.waitForIdle();
  });

  it('puts the files a retry will try again back in the queue, so nobody reads them as failed while it runs', async () => {
    const h = kitHarness();
    const real = h.runAI.getMockImplementation();
    h.runAI.mockImplementation(async (request) => { if (/output-bloglong/.test(request.outputPath)) throw new Error('Validation failed twice.'); return real(request); });
    const run = h.api.createAssetKit({ source: { kind: 'report', assetId: 'asset-toolkit' }, deliverableIds: ['blogshort', 'bloglong'] }); await h.api.waitForIdle();
    expect(h.api.readStudioRun({ runId: run.id }).jobs.map((job) => [job.id, job.status])).toEqual([['blogshort', 'succeeded'], ['bloglong', 'failed']]);
    h.runAI.mockImplementation(real);
    const retried = h.api.retryStudioRun({ runId: run.id });
    expect(retried.jobs.map((job) => [job.id, job.status, job.error ?? null])).toEqual([['blogshort', 'succeeded', null], ['bloglong', 'queued', null]]);
    await h.api.waitForIdle();
    expect(h.api.readStudioRun({ runId: run.id })).toMatchObject({ status: 'succeeded', jobs: [{ status: 'succeeded' }, { status: 'succeeded' }] });
  });

  it('downloads only a channel’s own folders, with the source only for a trend’s set', async () => {
    const h = kitHarness();
    const run = h.api.createAssetKit({ source: { kind: 'report', assetId: 'asset-toolkit' }, deliverableIds: ['blogshort', 'social'] }); await h.api.waitForIdle();
    const into = tempRoot('roles-downloads-');
    const blog = h.api.exportAssetKit({ runId: run.id }, { into, channels: ['blog'] });
    expect(blog.assetCount).toBe(1);
    expect(fs.readdirSync(blog.path).sort()).toEqual(['Semrush Blog', `Source — ${TREND}.md`]);
    expect(() => h.api.exportAssetKit({ runId: run.id }, { into, channels: ['pr'] })).toThrow('Nothing for your channel is ready yet.');
    expect(fs.readdirSync(h.api.exportAssetKit({ runId: run.id }, { into }).path).sort()).toEqual(['Semrush Blog', 'Semrush Social Team', `Source — ${TREND}.md`]);
    // A set made from pasted text keeps its text from a channel owner, but the person who made it gets it in their folder.
    const pasted = h.api.createAssetKit({ source: { kind: 'text', text: 'Private pasted brief about AI citations.' }, deliverableIds: ['blogshort'] }); await h.api.waitForIdle();
    expect(fs.readdirSync(h.api.exportAssetKit({ runId: pasted.id }, { into, channels: ['blog'] }).path)).toEqual(['Semrush Blog']);
    const full = h.api.exportAssetKit({ runId: pasted.id }, { into }).path;
    const source = fs.readdirSync(full).find((name) => name.startsWith('Source — '));
    expect(fs.readdirSync(full).sort()).toEqual(['Semrush Blog', source]);
    expect(fs.readFileSync(path.join(full, source), 'utf8')).toBe('Private pasted brief about AI citations.');
  });

  it('answers the gate’s questions about the active workspace', () => {
    const h = kitHarness();
    expect(h.api.findAsset('asset-toolkit')).toMatchObject({ asset: { id: 'asset-toolkit' }, run: { id: 'content-trend' } });
    expect(h.api.findAsset('../escape')).toBeNull(); expect(h.api.findAsset('asset-missing')).toBeNull();
    expect(h.api.findRun('content-kit-social')).toMatchObject({ kit: { themeId: 'theme-citations' } });
    expect(h.api.activeEditionId()).toBe('semrush');
    expect(h.api.activeWorkspace()).toEqual({ id: 'semrush', name: 'Semrush workspace', editionId: 'semrush' });
    expect(h.api.workspaceById('general')).toEqual({ id: 'general', name: 'Your workspace', editionId: 'general' });
    expect(h.api.isTrendReport({ id: 'asset-toolkit' })).toBe(true); expect(h.api.isTrendReport({ id: 'asset-report' })).toBe(true);
    expect(h.api.isTrendReport({ id: 'asset-kit-social' })).toBe(false);
    expect(h.api.kitRunsFor('theme:theme-citations').map((run) => run.id)).toEqual(['content-kit-social']);
    expect(h.api.picturesReady()).toBe(false);
    // The trend reads behind an answer: the same ready trends as the public state, without copying it.
    const channelView = require('../src/main/channel-view.js');
    expect(channelView.readyTrends(h.api.trendSource())).toEqual(channelView.readyTrends(h.api.publicState()));
    expect(channelView.readyTrends(h.api.trendSource()).map((trend) => trend.themeId)).toEqual(['theme-citations']);
    h.api.selectContentWorkspace('general');
    expect(h.api.findAsset('asset-toolkit')).toBeNull(); expect(h.api.isTrendReport({ id: 'asset-toolkit' })).toBe(false);
    expect(h.api.trendSource()).toMatchObject({ activeWorkspaceId: 'general', researchRuns: [], contentRuns: [], assets: [] });
  });
});

// ---------- Notes and routing on a yes; the content status pipeline ----------
describe('a yes with a note for chosen channels', () => {
  it('stores the note and channels with who decided; every channel or none means all', async () => {
    const h = researchHarness(); h.api.saveResearchProgram(program());
    const started = h.api.startResearchRun({ programId: 'program-a', datasetIds: ['dataset-a'] }); await h.api.waitForIdle();
    const run = h.api.readStudioRun({ runId: started.id }); const [theme] = run.discoveredThemes;
    h.api.decideResearchTheme({ runId: run.id, themeId: theme.id, decision: 'approved', note: '  Lead with the CTR data.\n Don’t name competitors. ', channels: ['social', 'blog', 'social'] });
    expect(h.api.readStudioRun({ runId: run.id }).decisionsBy[theme.id]).toEqual({ ...RILEY, at: expect.any(String), note: 'Lead with the CTR data. Don’t name competitors.', channels: ['social', 'blog'] });
    h.api.decideResearchTheme({ runId: run.id, themeId: theme.id, decision: 'approved', note: '', channels: [] });
    expect(h.api.readStudioRun({ runId: run.id }).decisionsBy[theme.id]).toEqual({ ...RILEY, at: expect.any(String) });
    expect(() => h.api.decideResearchTheme({ runId: run.id, themeId: theme.id, decision: 'approved', note: 'x'.repeat(281) })).toThrow('under 280 characters');
    expect(() => h.api.decideResearchTheme({ runId: run.id, themeId: theme.id, decision: 'approved', channels: ['nowhere'] })).toThrow('Choose channels from this workspace.');
    // A skip keeps its note but never routes.
    h.api.decideResearchTheme({ runId: run.id, themeId: theme.id, decision: 'passed', note: 'Covered last month.', channels: ['social'] });
    expect(h.api.readStudioRun({ runId: run.id }).decisionsBy[theme.id]).toEqual({ ...RILEY, at: expect.any(String), note: 'Covered last month.' });
  });
});

describe('asset status', () => {
  it('moves an asset through the pipeline with who and when, and keeps the live link once published', () => {
    const h = kitHarness();
    expect(h.api.readStudioAsset({ assetId: 'asset-report' }).asset.reviewStatus).toBe('draft');
    const review = h.api.setAssetStatus({ assetId: 'asset-report', status: 'in-review' });
    expect(review).toEqual({ asset: expect.objectContaining({ id: 'asset-report', reviewStatus: 'in-review', review: { status: 'in-review', by: RILEY, at: expect.any(String) } }) });
    // A report isn't a channel asset, so nothing suggests a channel answer.
    expect(h.api.setAssetStatus({ assetId: 'asset-report', status: 'published', link: 'semrush.com/blog/ai-citations' })).not.toHaveProperty('adoptionSuggested');
    expect(() => h.api.setAssetStatus({ assetId: 'asset-report', status: 'shipped' })).toThrow('Choose Draft, In review, Approved, Scheduled or Published.');
    expect(() => h.api.setAssetStatus({ assetId: 'asset-report', status: 'published', link: 'javascript:alert(1)' })).toThrow('That doesn’t look like a web link.');
  });

  it('suggests the channel’s Using answer when a channel asset made from a trend is published', () => {
    const h = kitHarness(); h.person.current = CHRIS;
    const published = h.api.setAssetStatus({ assetId: 'asset-kit-social', status: 'published', link: 'https://www.linkedin.com/posts/semrush-ai-citations' });
    expect(published).toMatchObject({ adoptionSuggested: true, themeId: 'theme-citations', channelId: 'social', link: 'https://www.linkedin.com/posts/semrush-ai-citations', asset: { reviewStatus: 'published', review: { status: 'published', by: CHRIS, link: 'https://www.linkedin.com/posts/semrush-ai-citations' } } });
    // Published again without a link keeps the one it had; any other status drops it.
    expect(h.api.setAssetStatus({ assetId: 'asset-kit-social', status: 'published' }).asset.review.link).toBe('https://www.linkedin.com/posts/semrush-ai-citations');
    expect(h.api.setAssetStatus({ assetId: 'asset-kit-social', status: 'scheduled' }).asset.review).not.toHaveProperty('link');
    expect(h.api.publicState().assets.find((asset) => asset.id === 'asset-kit-social').reviewStatus).toBe('scheduled');
  });
});
