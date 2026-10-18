import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import workspaceModule from '../src/main/content-workspace.js';
import content from '../src/shared/content-studio.js';
import { buildTrendBoard, generationPlan } from '../src/shared/trend-board.js';
import fixture from './helpers/research-ai-fixture.js';
const { createContentWorkspace } = workspaceModule;
const roots = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

const items = Array.from({ length: 6 }, (_, i) => ({ id: `source-${i}`, externalId: String(i), platform: 'x', author: `person${i}`, type: 'post', text: `Reporting problem ${i}: dashboards and pricing pages take too much manual work.`, url: `https://x.com/person${i}/status/${i}`, publishedAt: '2026-09-22T12:00:00Z', raw: { likeCount: 100, replyCount: 20, retweetCount: 10, quoteCount: 3, bookmarkCount: 5, viewCount: 1000 } }));
function output(request) {
  const props = request.schema.properties;
  if (fixture.stageOf(request) === 'synthesis') { const ids = fixture.synthesisCandidates(request).map((c) => c.id); return { themes: ['Reporting workflow friction', 'Pricing page confusion'].map((name) => ({ name, description: `${name} described by sources.`, candidateIds: ids, novelty: 'NEW ANGLE', matchingKeywords: ['reporting'], matchingCriteria: 'Mentions the problem.', negativeCriteria: 'Unrelated posts.', taxonomyCategory: 'Workflow', contentGap: 'OPEN', gapRationale: '', recentTrend: 'DORMANT', crossPlatform: false, totalEvidence: ids.length })) }; }
  const research = fixture.researchOutput(request); if (research) return research;
  const sectionIds = props.sections.items.properties.id.enum;
  const descriptor = content.CONTENT_DELIVERABLES.find(d => d.kind === 'text' && JSON.stringify(d.sections.map(s => s.id)) === JSON.stringify(sectionIds));
  const input = JSON.parse(request.prompt.split('UNTRUSTED_SOURCE_AND_BRAND_DATA:\n')[1]);
  const evidenceId = input.source.evidence[1]?.id || input.source.evidence[0].id;
  const result = { title: 'Trend evidence', summary: 'The supplied sample describes manual reporting work.', sections: descriptor.sections.map(section => ({ id: section.id, heading: section.heading, body: 'This is a sampled observation. Validate the proposed next step with an editor.', items: Array.from({ length: section.minItems || 0 }, (_, i) => ({ label: `Action ${i + 1}`, text: 'Review the reporting workflow.', evidenceIds: [evidenceId], productIds: [] })), evidenceIds: [evidenceId], productIds: [] })), caveats: ['The sample does not establish market prevalence. No approved product registry or verified quotation set was supplied.'] };
  if (descriptor.id === 'evidence-report') result.quotes = [];
  return result;
}
function harness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trend-board-test-')); roots.push(root);
  const runAI = async request => ({ output: output(request), receipt: { costUsd: 0.001, provider: 'fixture', paid: false } });
  return createContentWorkspace({ root, runAI, cancelProvider: vi.fn(), getDatasets: () => [{ id: 'dataset-a', name: 'Example', platform: 'x', itemCount: items.length }], readDataset: async id => ({ items, id }) });
}
async function discover(api) {
  const program = api.saveResearchProgram({ id: 'program-a', name: 'Weekly pulse', sourceGroups: [{ platform: 'x', targets: ['researcher'] }], window: { startDate: '2026-09-20', endDate: '2026-09-26' }, budgets: { collectionUsd: 1, aiUsd: 10 } });
  const run = api.startResearchRun({ programId: program.id, datasetIds: ['dataset-a'] }); await api.waitForIdle();
  return api.readStudioRun({ runId: run.id });
}
const boardFor = (api) => buildTrendBoard(api.publicState());

describe('trend board decisions', () => {
  it('scouted trends land in Potential and move one at a time without losing the others', async () => {
    const api = harness(); const run = await discover(api);
    expect(run.status).toBe('awaiting-review');
    expect(boardFor(api).columns.potential.map(card => card.name)).toEqual(['Pricing page confusion', 'Reporting workflow friction']);
    const pricing = run.themes.find(theme => theme.name === 'Pricing page confusion'); const reporting = run.themes.find(theme => theme.name === 'Reporting workflow friction');
    api.decideResearchTheme({ runId: run.id, themeId: reporting.id, decision: 'approved' });
    api.decideResearchTheme({ runId: run.id, themeId: pricing.id, decision: 'passed' });
    let board = boardFor(api);
    expect(board.columns.approved.map(card => card.name)).toEqual(['Reporting workflow friction']);
    expect(board.columns.passed.map(card => card.name)).toEqual(['Pricing page confusion']);
    api.decideResearchTheme({ runId: run.id, themeId: pricing.id, decision: 'pending' });
    expect(boardFor(api).columns.potential.map(card => card.name)).toEqual(['Pricing page confusion']);
    expect(generationPlan(boardFor(api).cards, run.id)).toMatchObject({ approved: [{ themeId: reporting.id }], undecided: [{ themeId: pricing.id }] });
    expect(() => api.decideResearchTheme({ runId: run.id, themeId: 'invented', decision: 'approved' })).toThrow(/discovered/);
    expect(() => api.decideResearchTheme({ runId: run.id, themeId: pricing.id, decision: 'maybe' })).toThrow(/approve, pass/);
  });

  it('re-approving can pick a theme passed over earlier, because discovered themes are kept', async () => {
    const api = harness(); const run = await discover(api);
    api.approveResearchThemes({ runId: run.id, themes: [run.themes[0].id] });
    const again = api.approveResearchThemes({ runId: run.id, themes: [run.themes[1].id] });
    expect(again.themes.map(theme => theme.id)).toEqual([run.themes[1].id]);
    expect(again.decisions).toEqual({ [run.themes[0].id]: 'passed', [run.themes[1].id]: 'approved' });
  });

  it('generating reports moves approved trends to Ready, passes the rest, and links assets made from the report', async () => {
    const api = harness(); const run = await discover(api);
    const reporting = run.themes.find(theme => theme.name === 'Reporting workflow friction');
    api.decideResearchTheme({ runId: run.id, themeId: reporting.id, decision: 'approved' });
    const { approved } = generationPlan(boardFor(api).cards, run.id);
    api.approveResearchThemes({ runId: run.id, themes: approved.map(card => card.themeId) });
    api.continueResearchRun({ runId: run.id }); await api.waitForIdle();
    expect(() => api.decideResearchTheme({ runId: run.id, themeId: reporting.id, decision: 'passed' })).toThrow(/no longer waiting/);
    let board = boardFor(api);
    expect(board.columns.passed.map(card => card.name)).toEqual(['Pricing page confusion']);
    const [ready] = board.columns.ready;
    expect(ready).toMatchObject({ name: 'Reporting workflow friction', assetCount: 0 });
    const report = ready.reportAssets.find(asset => asset.deliverableId === 'evidence-report');
    expect(report).toBeTruthy();
    const followUp = api.createContentRun({ source: { kind: 'report', assetId: report.id }, deliverableIds: ['social'], maxBudgetUsd: 1 });
    expect(followUp.sourceAssetId).toBe(report.id);
    await api.waitForIdle();
    board = boardFor(api);
    expect(board.columns.ready[0].contentRunCount).toBe(1);
    expect(board.columns.ready[0].assetCount).toBeGreaterThan(0);
  }, 30000); // a research run and its reports; slow when the suite runs in parallel.
});

describe('trend board layout', () => {
  it('drops a failed scouting run once a newer run of the same program finds themes', () => {
    const failed = { id: 'old', programId: 'p1', status: 'failed', stage: 'discovery', themes: [], message: 'Claude stopped before finishing.', createdAt: '2026-09-27T20:42:00Z' };
    const scouts = (others) => buildTrendBoard({ programs: [{ id: 'p1', name: 'Pulse' }, { id: 'p2', name: 'Other' }], researchRuns: [failed, ...others] }).scouting.map((scout) => scout.runId);
    expect(scouts([])).toEqual(['old']);
    // Still visible while the newer run is working, or when only another program finished.
    expect(scouts([{ id: 'new', programId: 'p1', status: 'running', stage: 'collecting', themes: [], createdAt: '2026-10-07T22:58:00Z' }])).toEqual(['new', 'old']);
    expect(scouts([{ id: 'p2-run', programId: 'p2', status: 'succeeded', themes: [], createdAt: '2026-10-07T22:58:00Z' }])).toEqual(['old']);
    expect(scouts([{ id: 'new', programId: 'p1', status: 'succeeded', themes: [], createdAt: '2026-10-07T22:58:00Z' }])).toEqual([]);
    expect(scouts([{ id: 'new', programId: 'p1', status: 'awaiting-review', discoveredThemes: [{ id: 't1', name: 'Theme' }], createdAt: '2026-10-07T22:58:00Z' }])).toEqual([]);
  });
  it('shows scouting runs and treats runs without decisions as all potential', () => {
    const board = buildTrendBoard({
      programs: [{ id: 'p1', name: 'AI search pulse' }],
      researchRuns: [
        { id: 'r1', programId: 'p1', status: 'running', stage: 'discovery', discoveryProgress: { completed: 2, total: 5 }, themes: [], createdAt: '2026-10-01' },
        { id: 'r2', programId: 'p1', status: 'awaiting-review', themes: [{ id: 't1', name: 'Legacy theme', evidenceIds: ['a', 'b'] }], createdAt: '2026-09-30' },
      ],
    });
    expect(board.scouting).toMatchObject([{ runId: 'r1', title: 'AI search pulse', stage: 'discovery' }]);
    expect(board.columns.potential).toMatchObject([{ key: 'r2:t1', evidenceCount: 2, programName: 'AI search pulse', canDecide: true }]);
  });

  it('flags a failed report as needing attention instead of leaving it spinning', () => {
    const board = buildTrendBoard({
      researchRuns: [{ id: 'r1', status: 'partial', approvedAt: 'x', discoveredThemes: [{ id: 't1', name: 'A' }], themes: [{ id: 't1', name: 'A' }], reportRunIds: [{ themeId: 't1', runId: 'c1' }] }],
      contentRuns: [{ id: 'c1', status: 'failed' }],
    });
    expect(board.columns.production).toMatchObject([{ needsAttention: true, activity: 'Needs attention' }]);
  });
});

// The Monday.com sync's own tests: test/monday-sync.test.js, monday-cards.test.js (stage parity with this board),
// monday-engine.test.js, monday-store.test.js and monday-webhook.test.js.
