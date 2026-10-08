import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import hostModule from '../src/main/studio-host.js';
import runnerModule from '../src/shared/apify-runner.js';
const { createStudioHost } = hostModule;
const { createApifyRunner } = runnerModule;
const roots = [];
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const program = (extra = {}) => ({ id: 'program-a', name: 'Research fixture', sourceGroups: [{ id: 'source-x', platform: 'x', targets: ['author1'] }], targetPerPlatform: 20, budgets: { collectionUsd: 0.1, aiUsd: 1 }, ...extra });
function harness({ configure = {}, root } = {}) {
  root ||= fs.mkdtempSync(path.join(os.tmpdir(), 'studio-host-test-')); if (!roots.includes(root)) roots.push(root);
  const calls = { starts: [], gets: [], datasets: [], aborts: [], constructors: [] }; const runs = new Map();
  class Client {
    constructor(options) { calls.constructors.push(options); }
    actor(actorId) { return { start: async (input, options) => {
      const id = `provider-${calls.starts.length + 1}`; const record = { id, actorId, input, options }; calls.starts.push(record);
      const run = { id, status: 'SUCCEEDED', defaultDatasetId: `data-${id}`, usageTotalUsd: 0.001 }; runs.set(id, run);
      await configure.onStart?.(record, run, calls); return { ...run };
    } }; }
    run(id) { return { get: async () => { calls.gets.push(id); await configure.onGet?.(id, runs.get(id), calls); return runs.has(id) ? { ...runs.get(id) } : null; }, abort: async () => { calls.aborts.push(id); const run = runs.get(id); if (run) run.status = 'ABORTED'; return run; } }; }
    dataset(id) { return { listItems: async options => {
      calls.datasets.push({ id, options }); await configure.onDataset?.(id, options, calls);
      const items = configure.items || [{ id: `post-${id}`, text: `Evidence from ${id}`, author: 'author1', url: 'https://x.com/author1/status/123', createdAt: '2026-09-20T12:00:00Z', likeCount: 10 }];
      return { items: items.slice(options.offset, options.offset + options.limit), count: Math.min(items.length - options.offset, options.limit), total: items.length };
    } }; }
  }
  const deps = { root, getApifyToken: () => 'fixture-only-token', Client, runnerOptions: { pollIntervalMs: 0, pollBackoffMs: 0, downloadBackoffMs: 0 } };
  const host = createStudioHost(deps);
  const request = (extra = {}) => ({ program: program(), runId: 'research-a', workspaceId: 'semrush', isCancelled: () => false, onProgress: () => {}, ...extra });
  const checkpoint = () => JSON.parse(fs.readFileSync(path.join(root, 'collections', 'research-a.json'), 'utf8'));
  return { root, host, Client, deps, calls, runs, request, checkpoint };
}

describe('durable paid Actor collection', () => {
  it('persists start intent and budget before POST, persists provider ID before download, and reuses completed datasets', async () => {
    let h;
    h = harness({ configure: {
      onStart: () => { const saved = h.checkpoint().jobs[0]; expect(saved).toMatchObject({ status: 'starting', providerRunId: null, reservedBudgetUsd: 0.1 }); },
      onDataset: () => { expect(h.checkpoint().jobs[0]).toMatchObject({ status: 'running', providerRunId: 'provider-1' }); },
    } });
    const result = await h.host.collect(h.request());
    expect(result.receipt).toMatchObject({ runId: 'research-a', workspaceId: 'semrush', succeededJobs: 1, reusedJobs: 0, reservedBudgetUsd: 0.1 });
    expect(h.checkpoint().jobs[0]).toMatchObject({ status: 'succeeded', providerRunId: 'provider-1' });
    expect(h.calls.constructors.every(options => options.maxRetries === 0)).toBe(true);
    const resumed = await createStudioHost({ ...h.deps, getApifyToken: () => '' }).collect(h.request());
    expect(resumed.datasetIds).toEqual(result.datasetIds); expect(resumed.receipt.reusedJobs).toBe(1);
    expect(h.calls.starts).toHaveLength(1); expect(h.calls.datasets).toHaveLength(1);
  });
  it('keeps waiting through transient polling failures without starting or reserving another paid run', async () => {
    let broken = true;
    const h = harness({ configure: { onStart: (_record, run) => { run.status = 'RUNNING'; }, onGet: (_id, run) => { if (broken) { broken = false; throw new Error('Transient polling failure'); } run.status = 'SUCCEEDED'; } } });
    const result = await h.host.collect(h.request());
    expect(h.calls.starts).toHaveLength(1); expect(result.receipt.reservedBudgetUsd).toBe(0.1); expect(result.items).toHaveLength(1);
    expect(h.checkpoint().jobs[0]).toMatchObject({ status: 'succeeded', providerRunId: 'provider-1' });
  });
  it('keeps finished sources when another job fails, then retries only the failed job', async () => {
    let failures = 0; const h = harness({ configure: { onDataset: id => { if (id === 'data-provider-2' && failures < 3) { failures++; throw new Error('Dataset download interrupted'); } } } });
    const p = program({ sourceGroups: [{ platform: 'x', targets: Array.from({ length: 11 }, (_, i) => `author${i}`) }] });
    await expect(h.host.collect(h.request({ program: p }))).rejects.toThrow(/1 of 3 source jobs failed; 2 finished.*interrupted/);
    expect(h.calls.starts).toHaveLength(3); expect(h.host.getDatasets()).toHaveLength(2);
    expect(h.host.getDatasets()[0]).toMatchObject({ workspaceId: 'semrush', researchRunId: 'research-a' });
    const result = await createStudioHost(h.deps).collect(h.request({ program: p }));
    // The failed job resumes its saved Apify run instead of paying for a new one.
    expect(h.calls.starts).toHaveLength(3); expect(result.items).toHaveLength(3); expect(result.receipt.reusedJobs).toBe(2);
    expect(h.calls.starts.map(c => c.options.maxTotalChargeUsd)).toEqual([0.04, 0.04, 0.02]);
  });
  it('fetches whatever a FAILED, TIMED-OUT or ABORTED run collected instead of failing the source', async () => {
    const h = harness({ configure: { onStart: (_record, run) => { run.status = 'TIMED-OUT'; run.statusMessage = 'Run timed out'; } } });
    const result = await h.host.collect(h.request());
    expect(result.items).toHaveLength(1); expect(result.receipt).toMatchObject({ partialJobs: 1, succeededJobs: 0 });
    expect(result.receipt.warnings.join(' ')).toMatch(/ended TIMED-OUT; kept the 1 rows/);
    expect(h.checkpoint().jobs[0]).toMatchObject({ status: 'partial' });
  });
  it('runs every platform lane at the same time like the n8n launch step', async () => {
    let running = 0; let peak = 0; let release; const gate = new Promise(resolve => { release = resolve; });
    const h = harness({ configure: { onStart: async () => { running++; peak = Math.max(peak, running); if (peak === 3) release(); await Promise.race([gate, new Promise(resolve => setTimeout(resolve, 200))]); running--; } } });
    const p = program({ sourceGroups: [{ platform: 'x', targets: ['author1'] }, { platform: 'reddit', targets: ['seo'] }, { platform: 'linkedin-profile', targets: ['https://www.linkedin.com/in/someone'] }], budgets: { collectionUsd: 1, aiUsd: 1 } });
    await h.host.collect(h.request({ program: p }));
    expect(peak).toBe(3);
    const inputs = Object.fromEntries(h.calls.starts.map(call => [call.actorId, call.input]));
    expect(inputs['apidojo/twitter-scraper-lite'].searchTerms[0]).toMatch(/^from:author1 since:\d{4}-\d{2}-\d{2}$/);
    expect(inputs['trudax/reddit-scraper-lite']).toMatchObject({ startUrls: [{ url: 'https://www.reddit.com/r/seo/new/' }], maxPostCount: 300, scrollTimeout: 90, skipComments: true });
    expect(inputs['harvestapi/linkedin-profile-posts']).toMatchObject({ targetUrls: ['https://www.linkedin.com/in/someone/'], maxPosts: 15 });
  });
  it('refuses automatic retry when the start response was lost and the charging outcome is unknown', async () => {
    const h = harness({ configure: { onStart: () => { throw new Error('Connection lost after provider accepted POST'); } } });
    await expect(h.host.collect(h.request())).rejects.toThrow(/Connection lost/);
    expect(h.checkpoint().jobs[0]).toMatchObject({ status: 'failed', providerRunId: null, reservedBudgetUsd: 0.1 });
    const checkpoint = h.checkpoint(); checkpoint.jobs[0].status = 'starting'; fs.writeFileSync(path.join(h.root, 'collections', 'research-a.json'), JSON.stringify(checkpoint));
    await expect(createStudioHost(h.deps).collect(h.request())).rejects.toThrow(/may already be charging.*automatic retry will not launch a duplicate/);
    expect(h.calls.starts).toHaveLength(1);
  });
  it('recovers a dataset committed immediately before the success checkpoint without provider calls', async () => {
    const h = harness(); const result = await h.host.collect(h.request()); const checkpoint = h.checkpoint();
    checkpoint.jobs[0].status = 'running'; delete checkpoint.jobs[0].receipt; fs.writeFileSync(path.join(h.root, 'collections', 'research-a.json'), JSON.stringify(checkpoint));
    const second = await createStudioHost(h.deps).collect(h.request());
    expect(second.datasetIds).toEqual(result.datasetIds); expect(second.receipt.reusedJobs).toBe(1); expect(h.calls.starts).toHaveLength(1); expect(h.calls.datasets).toHaveLength(1);
  });
  it('rejects changing the source plan or workspace of a previously launched research run', async () => {
    const h = harness(); await h.host.collect(h.request());
    await expect(h.host.collect(h.request({ workspaceId: 'general' }))).rejects.toThrow(/different workspace or source plan/);
    await expect(h.host.collect(h.request({ program: program({ targetPerPlatform: 30 }) }))).rejects.toThrow(/different workspace or source plan/);
    await expect(h.host.collect(h.request({ workspaceId: undefined }))).rejects.toThrow(/workspace ID/);
    await expect(h.host.collect(h.request({ runId: '../outside' }))).rejects.toThrow(/research run ID/);
    expect(h.calls.starts).toHaveLength(1);
  });
  it('checks cancellation before spending, aborts an in-flight provider run, and restarts it cleanly later', async () => {
    let cancelled = true; const h = harness({ configure: { onStart: (_record, run) => { run.status = 'RUNNING'; }, onGet: (id, run) => { if (id === 'provider-1') cancelled = true; else run.status = 'SUCCEEDED'; } } });
    await expect(h.host.collect(h.request({ isCancelled: () => cancelled }))).rejects.toThrow(/cancelled/);
    expect(h.calls.starts).toHaveLength(0); expect(h.checkpoint().jobs[0].reservedBudgetUsd).toBe(0);
    cancelled = false;
    await expect(h.host.collect(h.request({ isCancelled: () => cancelled }))).rejects.toThrow(/cancelled/);
    expect(h.calls.aborts).toEqual(['provider-1']); expect(h.checkpoint().jobs[0]).toMatchObject({ status: 'cancelled', providerRunId: 'provider-1' });
    // Apify confirms the cancelled run is ABORTED, so a retry starts one fresh run.
    const result = await h.host.collect(h.request());
    expect(h.calls.starts).toHaveLength(2); expect(result.items).toHaveLength(1);
    expect(h.checkpoint().jobs[0]).toMatchObject({ status: 'succeeded', providerRunId: 'provider-2', previousProviderRunIds: ['provider-1'] });
  });
  it('prevents concurrent hosts from launching the same run twice', async () => {
    let release; let started; const ready = new Promise(resolve => { started = resolve; }); const gate = new Promise(resolve => { release = resolve; });
    const h = harness({ configure: { onStart: async () => { started(); await gate; } } });
    const first = h.host.collect(h.request()); await ready;
    await expect(createStudioHost(h.deps).collect(h.request())).rejects.toThrow(/already active/);
    release(); await first; expect(h.calls.starts).toHaveLength(1);
  });
  it('rejects an insufficient total source budget before creating a provider client', async () => {
    const h = harness(); const p = program({ sourceGroups: [{ platform: 'x', targets: Array.from({ length: 41 }, (_, i) => `author${i}`) }], budgets: { collectionUsd: 0.02, aiUsd: 1 } });
    await expect(h.host.collect(h.request({ program: p }))).rejects.toThrow(/at least \$0.18/);
    expect(h.calls.starts).toHaveLength(0); expect(h.calls.constructors).toHaveLength(0);
  });
  it('expands nested LinkedIn keyword comments through the enterprise route after recipe validation', async () => {
    const h = harness({ configure: { items: [{ id: 'post-a', text: 'Original post', comments: [{ id: 'comment-a', text: 'First reply' }, { id: 'comment-b', text: 'Second reply' }, { id: 'comment-c', text: 'Outside selected limit' }] }] } });
    const p = program({ query: 'reporting', sourceGroups: [{ sourceId: 'linkedin-search', targets: ['reporting'], options: { includeComments: true, maxComments: 2 } }] });
    const result = await h.host.collect(h.request({ program: p }));
    expect(result.items.map(item => item.text)).toEqual(['Original post', 'First reply', 'Second reply']);
    expect(result.items[1]).toMatchObject({ type: 'comment', parentId: 'post-a' });
    expect(result.receipt.runs[0]).toMatchObject({ providerRows: 1, itemCount: 3 });
  });
});

describe('dataset metadata cache and resume safety', () => {
  it('does not read full datasets for repeated UI state emissions or a restart with an index', async () => {
    const h = harness(); await h.host.collect(h.request());
    const read = vi.spyOn(fs, 'readFileSync');
    h.host.getDatasets(); h.host.getDatasets(); h.host.getDatasets();
    expect(read).not.toHaveBeenCalled();
    const restarted = createStudioHost(h.deps); expect(restarted.getDatasets()[0].workspaceId).toBe('semrush');
    expect(read.mock.calls.some(([file]) => String(file).includes(`${path.sep}datasets${path.sep}`))).toBe(false);
    expect(read.mock.calls.some(([file]) => String(file).endsWith('dataset-index.json'))).toBe(true);
  });
  it('refreshes only the small index when another host adds a dataset', async () => {
    const h = harness(); expect(h.host.getDatasets()).toEqual([]);
    await createStudioHost(h.deps).collect(h.request());
    const read = vi.spyOn(fs, 'readFileSync');
    expect(h.host.getDatasets()[0].workspaceId).toBe('semrush');
    expect(read.mock.calls.every(([file]) => String(file).endsWith('dataset-index.json'))).toBe(true);
  });
  it('migrates legacy metadata once and derives its owner from the saved research run', () => {
    const h = harness(); fs.writeFileSync(path.join(h.root, 'datasets', 'legacy.json'), JSON.stringify({ dataset: { id: 'legacy', researchRunId: 'research-old', itemCount: 10000 }, items: [] }));
    fs.writeFileSync(path.join(h.root, 'state.json'), JSON.stringify({ researchRuns: [{ id: 'research-old', workspaceId: 'semrush' }] }));
    expect(h.host.getDatasets()[0].workspaceId).toBe('semrush');
    const read = vi.spyOn(fs, 'readFileSync'); h.host.getDatasets(); expect(read).not.toHaveBeenCalled();
  });
  it('never starts a replacement when a saved provider ID cannot be found', async () => {
    const h = harness();
    await expect(createApifyRunner({ token: 'fixture-only', Client: h.Client }).runRecipe({ name: 'Existing', platform: 'x', actorId: 'example/actor', input: {} }, { resumeRunId: 'missing-run' })).rejects.toThrow(/could not be found.*will not be started again/);
    expect(h.calls.starts).toHaveLength(0);
  });
});
