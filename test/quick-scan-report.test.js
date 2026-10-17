import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import workspaceModule from '../src/main/content-workspace.js';
import fixture from './helpers/research-ai-fixture.js';
const { createContentWorkspace } = workspaceModule;
const { researchOutput, stageOf } = fixture;

// A quick scan started from Ask AI writes a short trends report when it finds trends (SPEC-3): the report is part of the
// scan's estimate, runs as a child report run, lands under the scan, and the conversation that started it hears about it.
const roots = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); vi.restoreAllMocks(); });
const NOW = new Date('2026-10-17T12:00:00Z');
const CONVERSATION = 'ask-11111111-2222-3333-4444-555555555555';
const MESSAGE = 'msg-11111111-2222-3333-4444-555555555555';
const program = { id: 'program-pulse', name: 'Weekly pulse', query: 'SEO', budgets: { collectionUsd: 5, aiUsd: 10 }, sourceGroups: [{ id: 'x', platform: 'x', targets: ['account0', 'account1', 'account2'] }] };
const rows = (count) => Array.from({ length: count }, (_, i) => ({ id: `scan-${i}`, externalId: String(i), platform: 'x', author: `account${i % 3}`, type: 'post', text: `Reporting problem ${i}: dashboards take too much manual work for every client this week.`, url: `https://x.com/account${i % 3}/status/${i + 1}`, publishedAt: '2026-10-17T09:00:00Z', raw: { likeCount: 400, replyCount: 80, retweetCount: 40, quoteCount: 12, bookmarkCount: 20, viewCount: 9000 } }));

function harness({ runAI, onRunEvent, count = 30, aiUsd, costOf = () => 0.01 } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quick-scan-report-')); roots.push(root);
  const calls = [];
  const ai = async (request) => { calls.push(request); const output = runAI ? await runAI(request, calls) : researchOutput(request); return { output, receipt: { costUsd: costOf(request), provider: 'fixture', requestedModel: request.model || '' } }; };
  const collect = vi.fn(async () => ({ items: rows(count), receipt: { warnings: [] }, datasetIds: [] }));
  const api = createContentWorkspace({ root, runAI: ai, collect, clock: () => NOW, actor: () => ({ id: 'member-editor', name: 'Editor One' }), onRunEvent, getDatasets: () => [], readDataset: async () => ({ items: [] }) });
  api.saveResearchProgram({ ...program, ...(aiUsd ? { budgets: { ...program.budgets, aiUsd } } : {}) });
  return { api, calls, root, collect };
}
const scanPayload = (extra = {}) => ({ programId: program.id, scan: { topic: 'reporting', depth: 'standard', platforms: ['x'], lookbackHours: 6, ...extra } });
async function startScan(h, { scan = {}, ask = { conversationId: CONVERSATION, messageId: MESSAGE, actionIndex: 0 } } = {}) {
  const estimate = await h.api.estimateQuickScan(scanPayload(scan));
  const started = h.api.startQuickScan({ ...scanPayload(scan), fingerprint: estimate.fingerprint, ...(ask ? { ask } : {}) });
  await h.api.waitForIdle();
  return { estimate, started, run: h.api.readStudioRun({ runId: started.id }) };
}

describe('quick scan trends report', () => {
  it('prices the report into the plan, writes it as a report under the scan, and posts it to the conversation', async () => {
    const events = [];
    const h = harness({ onRunEvent: (event) => { events.push(event); return { messageId: `msg-${String(events.length).padStart(8, '0')}-2222-3333-4444-555555555555` }; } });
    const { estimate, started, run } = await startScan(h);
    expect(estimate.ai.report).toMatchObject({ on: true, usd: expect.any(Number) });
    expect(estimate.ai.stages.report).toBeGreaterThan(0);
    expect(estimate.ai.totalUsd).toBeCloseTo(estimate.ai.stages.discovery + estimate.ai.stages.synthesis + estimate.ai.stages.report, 2);
    expect(estimate.lines.join(' ')).toMatch(/includes a short trends report, about \$\d+\.\d\d/);
    expect(estimate.lines.at(-1)).toMatch(/writes a short trends report and posts it in Ask AI/);
    // The conversation stays on the server: neither the start's answer nor the state carries it.
    expect(JSON.stringify(started)).not.toContain(CONVERSATION);
    expect(JSON.stringify(h.api.publicState().researchRuns)).not.toContain(CONVERSATION);

    expect(run).toMatchObject({ status: 'succeeded', stage: 'scan-complete', origin: 'quick-scan', quickScan: { report: true } });
    expect(run.estimate.stages.reports).toBe(started.quickScan.reportUsd);
    expect(run.scanReport).toMatchObject({ status: 'succeeded', assetId: expect.stringMatching(/^asset-/), attempts: 1 });
    expect(run.message).toMatch(/The trends report is ready\.$/);
    const child = h.api.publicState().contentRuns.find((row) => row.id === run.scanReport.runId);
    expect(child).toMatchObject({ scanReport: true, researchRunId: run.id, status: 'succeeded', createdBy: { id: 'member-editor' } });
    const asset = h.api.publicState().assets.find((row) => row.id === run.scanReport.assetId);
    expect(asset).toMatchObject({ deliverableId: 'scan-report', kind: 'text', channel: 'Research', title: 'Quick scan report: reporting (2026-10-17)' });
    const read = h.api.readStudioAsset({ assetId: asset.id });
    expect(read.markdown).toMatch(/^# Quick scan report: reporting/);
    expect(read.markdown).toContain('Reporting Workflow Friction Surge');
    expect(read.output.checks.droppedQuotes).toBe(0);
    expect(read.evidence.length).toBeGreaterThan(1);
    // The report's cost rolls into the scan's, not into its own spend.
    expect(run.costUsd).toBeCloseTo(run.ownCostUsd + child.costUsd, 5);
    expect(h.calls.filter((call) => stageOf(call) === 'scan-report')).toHaveLength(1);

    expect(events.map((event) => event.type)).toEqual(['scan-report-ready']);
    expect(events[0]).toMatchObject({ identityId: 'member-editor', conversationId: CONVERSATION, messageId: MESSAGE, actionIndex: 0, programName: 'Weekly pulse', report: { assetId: asset.id, title: asset.title, summary: expect.stringMatching(/found 1 trends/) } });
    expect(JSON.stringify(events[0].run)).not.toContain(CONVERSATION);
    const after = h.api.readStudioRun({ runId: run.id });
    expect(after.followUpAt).toBe(NOW.toISOString());
    // Create content can start from the report (its source keeps the posts it read).
    expect(h.api.publicState().availableReports.map((row) => row.assetId)).toContain(asset.id);
  });

  it('turns the report off when the plan does, which changes the plan', async () => {
    const h = harness({ onRunEvent: () => ({ messageId: MESSAGE }) });
    const on = await h.api.estimateQuickScan(scanPayload());
    const off = await h.api.estimateQuickScan(scanPayload({ report: false }));
    expect(off.fingerprint).not.toBe(on.fingerprint);
    expect(off.ai.report).toMatchObject({ on: false, usd: 0 });
    expect(off.ai.totalUsd).toBeLessThan(on.ai.totalUsd);
    expect(off.lines.at(-1)).toMatch(/^Stops once trends are found/);
    // A plan priced with the report can't start without it.
    expect(() => h.api.startQuickScan({ ...scanPayload({ report: false }), fingerprint: on.fingerprint })).toThrow(/plan changed/);
    const { run } = await startScan(h, { scan: { report: false } });
    expect(run.scanReport).toBeUndefined();
    expect(run.status).toBe('succeeded');
    expect(h.calls.some((call) => stageOf(call) === 'scan-report')).toBe(false);
  });

  it('keeps the scan done with a clear message and Retry report when the report fails, and retries only the report', async () => {
    let failReport = true;
    const events = [];
    const h = harness({
      onRunEvent: (event) => { events.push(event); return { messageId: MESSAGE }; },
      runAI: async (request) => (stageOf(request) === 'scan-report' && failReport ? { summary: 'x', trends: [{ name: 'Not a trend we found', whatsHappening: '', whyItMatters: '', quotes: [], evidenceIds: [] }], watch: [], nextSteps: [], caveats: [] } : researchOutput(request)),
    });
    const { run } = await startScan(h);
    expect(run.status).toBe('succeeded');
    expect(run.scanReport).toMatchObject({ status: 'failed', attempts: 1 });
    expect(run.scanReport.error).toMatch(/one entry per trend/);
    expect(run.message).toMatch(/The trends report didn’t finish: .+ Retry report writes only the report; the posts aren’t collected again\./);
    // One try and one repair.
    expect(h.calls.filter((call) => stageOf(call) === 'scan-report')).toHaveLength(2);
    expect(events.map((event) => event.key)).toEqual(['scan-report-failed:1']);
    const child = h.api.publicState().contentRuns.find((row) => row.id === run.scanReport.runId);
    expect(child.status).toBe('failed');
    expect(child.maxBudgetUsd - child.reservedUsd).toBeGreaterThanOrEqual(0.6); // Retry report's confirmation shows this
    const before = { discovery: h.calls.filter((call) => stageOf(call) === 'discovery').length, synthesis: h.calls.filter((call) => stageOf(call) === 'synthesis').length };

    failReport = false;
    h.api.retryStudioRun({ runId: child.id, maxBudgetUsd: child.maxBudgetUsd });
    await h.api.waitForIdle();
    const after = h.api.readStudioRun({ runId: run.id });
    expect(after.scanReport).toMatchObject({ status: 'succeeded', attempts: 2, assetId: expect.stringMatching(/^asset-/) });
    expect(after.message).toMatch(/The trends report is ready\.$/);
    expect(h.calls.filter((call) => stageOf(call) === 'discovery')).toHaveLength(before.discovery);
    expect(h.calls.filter((call) => stageOf(call) === 'synthesis')).toHaveLength(before.synthesis);
    expect(h.collect).toHaveBeenCalledTimes(1);
    expect(events.map((event) => event.key)).toEqual(['scan-report-failed:1', 'scan-report-ready']);
  });

  it('skips the report with a reason when the AI cap can’t cover one try, and Retry report can still write it', async () => {
    const events = [];
    // The scan's own calls use almost all of its $5.00 cap, so not even one try of the report fits.
    const h = harness({ onRunEvent: (event) => { events.push(event); return { messageId: MESSAGE }; }, costOf: (request) => (stageOf(request) === 'synthesis' ? 4.95 : 0.01) });
    const { run } = await startScan(h);
    expect(run.status).toBe('succeeded');
    expect(run.scanReport).toMatchObject({ status: 'failed', reason: 'budget', attempts: 0 });
    expect(run.message).toMatch(/Not enough of the \$5\.00 AI cap is left for the trends report \(about \$\d+\.\d\d\)\. Retry report writes it; you’ll see what it can spend first\.$/);
    expect(h.calls.some((call) => stageOf(call) === 'scan-report')).toBe(false);
    expect(events.map((event) => event.key)).toEqual(['scan-report-failed:budget']);
    const child = h.api.publicState().contentRuns.find((row) => row.id === run.scanReport.runId);
    expect(child).toMatchObject({ status: 'failed', reservedUsd: 0 });
    expect(child.maxBudgetUsd).toBeGreaterThanOrEqual(0.6);
    h.api.retryStudioRun({ runId: child.id, maxBudgetUsd: child.maxBudgetUsd });
    await h.api.waitForIdle();
    expect(h.api.readStudioRun({ runId: run.id }).scanReport).toMatchObject({ status: 'succeeded', attempts: 1 });
    expect(events.map((event) => event.key)).toEqual(['scan-report-failed:budget', 'scan-report-ready']);
  });

  it('stops the report with the scan', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const h = harness({ onRunEvent: () => ({ messageId: MESSAGE }), runAI: async (request) => { if (stageOf(request) === 'scan-report') await gate; return researchOutput(request); } });
    const estimate = await h.api.estimateQuickScan(scanPayload());
    const started = h.api.startQuickScan({ ...scanPayload(), fingerprint: estimate.fingerprint });
    await vi.waitFor(() => expect(h.api.readStudioRun({ runId: started.id }).stage).toBe('scan-report'));
    const childId = h.api.readStudioRun({ runId: started.id }).scanReport.runId;
    await h.api.cancelStudioRun({ runId: childId }); // the report's own Stop stops the scan it belongs to
    release();
    await h.api.waitForIdle();
    expect(h.api.readStudioRun({ runId: started.id }).status).toBe('cancelled');
    expect(h.api.readStudioRun({ runId: childId }).status).toBe('cancelled');
  });

  it('posts nothing, and still finishes, when no conversation started it or posting fails', async () => {
    const h = harness({ onRunEvent: () => { throw new Error('disk full'); } });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { run } = await startScan(h);
    expect(run.status).toBe('succeeded');
    expect(run.scanReport.status).toBe('succeeded');
    expect(run.followUpAt).toBeUndefined();
    const quiet = harness({ onRunEvent: vi.fn(() => ({ messageId: MESSAGE })) });
    const plain = await startScan(quiet, { ask: null });
    expect(plain.run.scanReport.status).toBe('succeeded');
  });

  it('refuses a made-up conversation link quietly and never posts to another person', async () => {
    const events = [];
    const h = harness({ onRunEvent: (event) => { events.push(event); return { messageId: MESSAGE }; } });
    await startScan(h, { ask: { conversationId: '../../etc/passwd', identityId: 'someone-else' } });
    expect(events).toEqual([]);
    await startScan(h, { ask: { conversationId: CONVERSATION, identityId: 'someone-else' } });
    expect(events.map((event) => event.identityId)).toEqual(['member-editor']);
  });
});

describe('the report as a source and as a prompt', () => {
  it('previews “Quick scan trends report” in Prompts on the newest scan or the bundled sample', async () => {
    const h = harness({ onRunEvent: () => ({ messageId: MESSAGE }) });
    const bundled = await h.api.previewPrompt({ id: 'reports.quick-scan', sample: 'bundled' });
    expect(bundled.text).toContain('SYSTEM INSTRUCTIONS');
    expect(bundled.text).toContain('POSTS:');
    expect((await h.api.previewPrompt({ id: 'reports.quick-scan', sample: 'latest' })).sampleLabel).toMatch(/no recent run has this yet/);
    await startScan(h);
    const latest = await h.api.previewPrompt({ id: 'reports.quick-scan', sample: 'latest' });
    expect(latest.sampleLabel).toBe('The 1 trend from “Quick scan · reporting” (2026-10-17)');
    expect(latest.text).toContain('Reporting Workflow Friction Surge');
  });

  it('starts Create content from the report with the title and text the person edited, and the report’s sources', async () => {
    const h = harness({ onRunEvent: () => ({ messageId: MESSAGE }), runAI: async (request) => researchOutput(request) || { title: 'Social', summary: 'x', sections: [], caveats: [] } });
    const { run } = await startScan(h);
    const assetId = run.scanReport.assetId;
    const edited = h.api.createContentRun({ source: { kind: 'report', id: assetId, title: 'My take on reporting', text: 'A shorter brief I wrote.' }, deliverableIds: ['social'], maxBudgetUsd: 1 });
    await h.api.waitForIdle();
    const input = JSON.parse(fs.readFileSync(path.join(h.root, 'runs', edited.id, 'input.json'), 'utf8'));
    expect(input.source).toMatchObject({ kind: 'report', id: assetId, title: 'My take on reporting', text: 'A shorter brief I wrote.' });
    expect(input.source.evidence.length).toBeGreaterThan(1);
    expect(edited.title).toBe('My take on reporting');
    // Sent without text, the report's own (edited copy if any) is used.
    const plain = h.api.createContentRun({ source: { kind: 'report', assetId }, deliverableIds: ['social'], maxBudgetUsd: 1 });
    await h.api.waitForIdle();
    const plainInput = JSON.parse(fs.readFileSync(path.join(h.root, 'runs', plain.id, 'input.json'), 'utf8'));
    expect(plainInput.source.title).toBe('Quick scan report: reporting (2026-10-17)');
    expect(plainInput.source.text).toMatch(/^# Quick scan report: reporting/);
  });
});

describe('research runs started from Ask AI', () => {
  it('posts the trends waiting for an OK, then the finished reports', async () => {
    const events = [];
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'research-followups-')); roots.push(root);
    const items = rows(12).map((row) => ({ ...row, publishedAt: '2026-09-20T12:00:00Z' }));
    const api = createContentWorkspace({ root, clock: () => NOW, actor: () => ({ id: 'local', name: 'Chris' }), onRunEvent: (event) => { events.push(event); return { messageId: MESSAGE }; },
      runAI: async (request) => ({ output: researchOutput(request) || { title: 'x', summary: 'x', sections: [], caveats: [] }, receipt: { costUsd: 0.01 } }),
      getDatasets: () => [{ id: 'dataset-a', name: 'Example', platform: 'x', itemCount: items.length }], readDataset: async () => ({ items }) });
    const saved = api.saveResearchProgram({ id: 'program-a', name: 'Weekly research', sourceGroups: [{ platform: 'x', targets: ['researcher'] }], window: { startDate: '2026-09-20', endDate: '2026-09-26' }, budgets: { collectionUsd: 1, aiUsd: 10 } });
    const run = api.startResearchRun({ programId: saved.id, datasetIds: ['dataset-a'], ask: { conversationId: CONVERSATION, messageId: MESSAGE, actionIndex: 2 } });
    expect(JSON.stringify(run)).not.toContain(CONVERSATION);
    await api.waitForIdle();
    expect(events.map((event) => event.type)).toEqual(['trends-ready']);
    expect(events[0].run.status).toBe('awaiting-review');
    const live = api.readStudioRun({ runId: run.id });
    api.approveResearchThemes({ runId: run.id, themes: live.themes.map((theme) => theme.id) });
    api.continueResearchRun({ runId: run.id });
    await api.waitForIdle();
    expect(events.map((event) => event.type)).toEqual(['trends-ready', 'reports-ready']);
    expect(events[1].reports[0]).toMatchObject({ assetId: expect.stringMatching(/^asset-/), themeName: expect.any(String) });
  });
});
