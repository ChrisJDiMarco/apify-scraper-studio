import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import workspaceModule from '../src/main/content-workspace.js';
import content from '../src/shared/content-studio.js';
const { createContentWorkspace } = workspaceModule;
const roots = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const sourceRows = (count) => Array.from({ length: count }, (_, i) => ({ id: `source-${i}`, externalId: String(i), platform: 'x', author: `person${i}`, type: 'post', text: `Reporting problem ${i}: dashboards take too much manual work.`, url: `https://x.com/person${i}/status/${i + 1}`, publishedAt: '2026-09-20T12:00:00Z', raw: { likeCount: 100, replyCount: 20, retweetCount: 10, quoteCount: 3, bookmarkCount: 5, viewCount: 1000 } }));
const program = (extra = {}) => ({ id: 'program-a', name: 'Weekly research', sourceGroups: [{ platform: 'x', targets: ['researcher'] }], window: { startDate: '2026-09-20', endDate: '2026-09-26' }, budgets: { collectionUsd: 1, aiUsd: 10 }, ...extra });
import fixture from './helpers/research-ai-fixture.js';
const { researchOutput, stageOf } = fixture;
function outputFor(request) {
  const research = researchOutput(request); if (research) return research;
  const sectionIds = request.schema.properties.sections.items.properties.id.enum;
  const descriptor = content.CONTENT_DELIVERABLES.find(d => d.kind === 'text' && JSON.stringify(d.sections.map(s => s.id)) === JSON.stringify(sectionIds));
  const input = JSON.parse(request.prompt.split('UNTRUSTED_SOURCE_AND_BRAND_DATA:\n')[1]);
  const evidenceId = input.source.evidence[1]?.id || input.source.evidence[0].id;
  const output = { title: 'Reporting workflow evidence', summary: 'The supplied sample describes manual reporting work.', sections: descriptor.sections.map(section => ({ id: section.id, heading: section.heading, body: 'This is a sampled observation. Validate the proposed next step with an editor.', items: Array.from({ length: section.minItems || 0 }, (_, i) => ({ label: `Action ${i + 1}`, text: 'Review the reporting workflow.', evidenceIds: [evidenceId], productIds: [] })), evidenceIds: [evidenceId], productIds: [] })), caveats: ['The sample does not establish market prevalence. No approved product registry or verified quotation set was supplied.'] };
  if (descriptor.id === 'evidence-report') output.quotes = [];
  return output;
}
function harness({ count = 5, runAI, collect, root, datasets } = {}) {
  root ||= fs.mkdtempSync(path.join(os.tmpdir(), 'content-workspace-test-')); if (!roots.includes(root)) roots.push(root);
  const calls = []; const items = sourceRows(count);
  const ai = async request => { calls.push(request); const output = runAI ? await runAI(request, calls, outputFor) : outputFor(request); return { output, receipt: { costUsd: 0.001, provider: 'fixture', paid: false } }; };
  const cancelProvider = vi.fn();
  const deps = { root, runAI: ai, collect, cancelProvider, getDatasets: () => datasets || [{ id: 'dataset-a', name: 'Example source', platform: 'x', itemCount: items.length }], readDataset: async id => ({ items, id }) };
  return { api: createContentWorkspace(deps), root, calls, deps, items, cancelProvider };
}
async function discover(h, extra = {}) { const p = h.api.saveResearchProgram(program(extra)); const run = h.api.startResearchRun({ programId: p.id, datasetIds: ['dataset-a'] }); await h.api.waitForIdle(); return h.api.readStudioRun({ runId: run.id }); }
async function approveAndContinue(h, run) { h.api.approveResearchThemes({ runId: run.id, themes: run.themes.map(t => t.id) }); h.api.continueResearchRun({ runId: run.id }); await h.api.waitForIdle(); return h.api.readStudioRun({ runId: run.id }); }

describe('persistent content workspace orchestration', () => {
  it('traverses the full evidence cohort, pauses for approval, classifies every row and saves both reports', async () => {
    const h = harness({ count: 405 }); const run = await discover(h);
    expect(run.status).toBe('awaiting-review'); expect(run.discoveryProgress.completed).toBe(run.discoveryProgress.total); expect(run.discoveryProgress.total).toBeGreaterThan(1);
    expect(run.counts.retained).toBe(405);
    expect(h.calls.filter(c => c.schema.properties.assignments)).toHaveLength(0);
    expect(run.themes[0]).toMatchObject({ scoring: { priorityTier: expect.any(String), velocity: 'NEW', count: 1 }, match: { matched: false } });
    expect(() => h.api.continueResearchRun({ runId: run.id })).toThrow(/Approve/);
    const result = await approveAndContinue(h, run);
    expect(result.status).toBe('succeeded'); expect(result.assignmentProgress).toEqual({ completed: 9, total: 9 });
    const assigned = fs.readFileSync(path.join(h.root, 'runs', run.id, 'assignments.json'), 'utf8');
    expect(JSON.parse(assigned)).toHaveLength(405);
    expect(h.api.publicState().assets).toHaveLength(2);
    expect(h.api.publicState().assets.map(a => a.deliverableId).sort()).toEqual(['editorial-toolkit', 'evidence-report']);
    const report = h.api.readStudioAsset({ assetId: h.api.publicState().assets.find(a => a.deliverableId === 'evidence-report').id });
    const toolkit = h.api.readStudioAsset({ assetId: h.api.publicState().assets.find(a => a.deliverableId === 'editorial-toolkit').id });
    expect(toolkit.markdown).toMatch(/^(⚠️ TOOLKIT CHECK[^\n]*\n+)?# TREND: /);
    expect(toolkit.markdown).toContain('## SELF-SERVE ANGLE (PLG)');
    expect(report.output.aggregateMetrics.twitter.postCount).toBe(405);
    expect(report.markdown).toMatch(/Comprehensive Trends Report/);
    expect(h.calls.every(c => c.maxBudgetUsd > 0 && c.maxBudgetUsd <= 10)).toBe(true);
    expect(h.api.exportStudioRun({ runId: run.id }).assetCount).toBe(2);
    // Follow-up content from a research report carries the report text and only the posts it cites.
    const reportAsset = h.api.publicState().assets.find(a => a.deliverableId === 'evidence-report');
    const followUp = h.api.createContentRun({ source: { kind: 'report', assetId: reportAsset.id }, deliverableIds: ['social'], maxBudgetUsd: 1 }); await h.api.waitForIdle();
    const followInput = JSON.parse(fs.readFileSync(path.join(h.root, 'runs', followUp.id, 'input.json'), 'utf8'));
    expect(followInput.source.kind).toBe('report'); expect(followInput.source.evidence.length).toBeLessThanOrEqual(120);
    expect(h.api.readStudioRun({ runId: followUp.id }).status).toBe('succeeded');
  }, 15000); // 405 rows through the whole pipeline; slow when the suite runs in parallel.
  it('resumes completed discovery batches after failure and app restart without paying for them again', async () => {
    let failed = false;
    const h = harness({ count: 405, runAI: async (request, calls, output) => { if (stageOf(request) === 'discovery' && calls.filter(c => stageOf(c) === 'discovery').length === 2 && !failed) { failed = true; throw new Error('Temporary provider failure'); } return output(request); } });
    const run = await discover(h); expect(run.status).toBe('failed');
    const firstBatchPrompt = h.calls[0].prompt;
    const persisted = JSON.parse(fs.readFileSync(path.join(h.root, 'state.json'), 'utf8')); persisted.researchRuns[0].status = 'running'; fs.writeFileSync(path.join(h.root, 'state.json'), JSON.stringify(persisted));
    const restarted = createContentWorkspace(h.deps); restarted.recoverInterrupted();
    expect(restarted.readStudioRun({ runId: run.id }).status).toBe('failed');
    restarted.retryStudioRun({ runId: run.id }); await restarted.waitForIdle();
    expect(restarted.readStudioRun({ runId: run.id }).status).toBe('awaiting-review');
    expect(h.calls.filter(c => c.prompt === firstBatchPrompt)).toHaveLength(1);
  });
  it('rejects unapproved/fabricated theme IDs and preserves the approved stable identity', async () => {
    const h = harness(); const run = await discover(h);
    expect(() => h.api.approveResearchThemes({ runId: run.id, themes: ['invented'] })).toThrow(/discovered/);
    const approved = h.api.approveResearchThemes({ runId: run.id, themes: [{ id: run.themes[0].id, name: 'Reviewed reporting friction', description: 'An editor refined this description.' }] });
    expect(approved.themes[0]).toMatchObject({ id: run.themes[0].id, name: 'Reviewed reporting friction', description: 'An editor refined this description.' });
    expect(approved.themes[0].evidenceIds).toEqual(run.themes[0].evidenceIds);
  });
  it('keeps records and input datasets in their owning workspace', async () => {
    const h = harness({ datasets: [{ id: 'dataset-a', platform: 'x', itemCount: 5 }, { id: 'private-dataset', workspaceId: 'semrush', platform: 'x', itemCount: 5 }] });
    const run = await discover(h);
    expect(() => h.api.startResearchRun({ programId: 'program-a', datasetIds: ['private-dataset'] })).toThrow(/workspace/);
    h.api.selectContentWorkspace('semrush');
    expect(h.api.publicState().researchRuns).toEqual([]);
    expect(h.api.publicState().availableDatasets.map(d => d.id)).toEqual(['private-dataset']);
    expect(() => h.api.readStudioRun({ runId: run.id })).toThrow(/selected workspace/);
    expect(() => h.api.saveResearchProgram(program())).toThrow(/another workspace/);
    expect(() => h.api.startResearchRun({ programId: 'program-a', datasetIds: ['dataset-a'] })).toThrow(/selected workspace/);
  });
  it('re-asks only for skipped posts instead of failing the run or dropping evidence', async () => {
    let omitted = false;
    const h = harness({ count: 45, runAI: async (request, calls, output) => { const result = output(request); if (stageOf(request) === 'tagging' && !omitted) { omitted = true; result.assignments.pop(); } return result; } });
    const run = await discover(h); const result = await approveAndContinue(h, run);
    expect(result.status).toBe('succeeded');
    const tagging = h.calls.filter(c => stageOf(c) === 'tagging');
    expect(tagging.at(-1).prompt).toMatch(/POSTS TO ANALYZE \(1\):/);
    expect(JSON.parse(fs.readFileSync(path.join(h.root, 'runs', run.id, 'assignments.json'), 'utf8'))).toHaveLength(45);
  });
  it('retries failed report children while preserving already saved report assets', async () => {
    let failed = false;
    const h = harness({ runAI: async (request, calls, output) => { if (stageOf(request) === 'toolkit' && !failed) { failed = true; throw new Error('Temporary strategy failure'); } return output(request); } });
    const run = await discover(h); const partial = await approveAndContinue(h, run);
    expect(partial.status).toBe('partial'); const before = h.api.publicState().assets;
    expect(before).toHaveLength(1);
    h.api.retryStudioRun({ runId: run.id, maxBudgetUsd: 20 }); await h.api.waitForIdle();
    expect(h.api.readStudioRun({ runId: run.id }).status).toBe('succeeded');
    expect(h.api.publicState().assets).toHaveLength(2); expect(h.api.publicState().assets.some(a => a.id === before[0].id)).toBe(true);
    expect(h.calls.filter(c => c.schema.properties.quotes)).toHaveLength(1);
  });
  it('cancels while awaiting theme review without discarding discovered evidence', async () => {
    const h = harness(); const run = await discover(h); const callsBefore = h.calls.length;
    expect(run.status).toBe('awaiting-review');
    const cancelled = await h.api.cancelStudioRun({ runId: run.id });
    expect(cancelled.status).toBe('cancelled'); expect(cancelled.themes.length).toBeGreaterThan(0);
    expect(h.calls).toHaveLength(callsBefore);
    expect(fs.existsSync(path.join(h.root, 'runs', run.id, 'evidence.json'))).toBe(true);
  });
  it('cancels an in-flight model call without advancing to synthesis or generating reports', async () => {
    let release; let started; const ready = new Promise(resolve => { started = resolve; }); const gate = new Promise(resolve => { release = resolve; });
    const h = harness({ runAI: async (request, calls, output) => { started(); await gate; return output(request); } });
    h.api.saveResearchProgram(program()); const run = h.api.startResearchRun({ programId: 'program-a', datasetIds: ['dataset-a'] });
    await ready; await h.api.cancelStudioRun({ runId: run.id }); release(); await h.api.waitForIdle();
    expect(h.api.readStudioRun({ runId: run.id }).status).toBe('cancelled');
    expect(h.cancelProvider).toHaveBeenCalledWith(run.id); expect(h.calls).toHaveLength(1); expect(h.api.publicState().assets).toEqual([]);
  });
  it('fails before a model call when the budget cannot cover the remaining planned steps', async () => {
    const h = harness(); const run = await discover(h, { budgets: { collectionUsd: 1, aiUsd: 0.01 } });
    expect(run.status).toBe('failed'); expect(run.message).toMatch(/needs about \$/); expect(h.calls).toHaveLength(0); expect(run.reservedUsd).toBe(0);
  });
  it('refuses to start collecting when the AI budget is under half of what the run needs first', () => {
    const h = harness(); const roster = { sourceGroups: [{ platform: 'x', targets: Array.from({ length: 300 }, (_, i) => `account${i}`) }] };
    const reviewed = h.api.saveResearchProgram(program({ ...roster, budgets: { collectionUsd: 20, aiUsd: 0.5 } }));
    expect(() => h.api.startResearchRun({ programId: reviewed.id })).toThrow(/far below the estimated \$\d+\.\d{2} to discover themes/);
    // Unattended runs are measured against the whole estimate, not just discovery.
    const unattended = h.api.saveResearchProgram(program({ ...roster, id: 'program-b', autoApproveThemes: true, budgets: { collectionUsd: 20, aiUsd: 6 } }));
    expect(() => h.api.startResearchRun({ programId: unattended.id })).toThrow(/for a full unattended run/);
    expect(h.api.publicState().researchRuns).toHaveLength(0); expect(h.calls).toHaveLength(0);
  });
  it('retains conservative spend reservations for unknown-cost failed calls', async () => {
    const h = harness({ runAI: async () => { throw new Error('Lost response after request'); } }); const run = await discover(h);
    expect(run.reservedUsd).toBeGreaterThan(0);
    expect(() => h.api.retryStudioRun({ runId: run.id, maxBudgetUsd: 0.01 })).toThrow(/reserved spend/);
  });
  it('uses the authorized collection adapter and retains source coverage receipts', async () => {
    const collect = vi.fn(async ({ program, runId }) => ({ items: sourceRows(6), datasetIds: ['new-source'], receipt: { runId, retainedTarget: program.targetPerPlatform, jobCount: 1, succeededJobs: 1 } }));
    const h = harness({ collect }); h.api.saveResearchProgram(program()); const run = h.api.startResearchRun({ programId: 'program-a' }); await h.api.waitForIdle();
    expect(collect).toHaveBeenCalledOnce(); expect(h.api.readStudioRun({ runId: run.id })).toMatchObject({ status: 'awaiting-review', collectionReceipt: { jobCount: 1, succeededJobs: 1 }, counts: { retained: 6 } });
    const persisted = JSON.parse(fs.readFileSync(path.join(h.root, 'state.json'), 'utf8')); expect(persisted.datasetOwners['new-source']).toBe('general');
  });
});
