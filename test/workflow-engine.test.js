import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import workspaceModule from '../src/main/content-workspace.js';
import engineModule from '../src/main/workflow-engine.js';
import storeModule from '../src/main/workflow-store.js';
import content from '../src/shared/content-studio.js';
import fixture from './helpers/research-ai-fixture.js';

const { createContentWorkspace } = workspaceModule;
const { createWorkflowEngine } = engineModule;
const { createWorkflowStore } = storeModule;
const roots = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

// Channel asset drafts: schema-valid text for whichever deliverable is asked for.
function assetOutput(request) {
  const context = fixture.jsonAfter(request.prompt, 'UNTRUSTED_SOURCE_AND_BRAND_DATA:');
  const ids = request.schema.properties.sections.items.properties.id.enum;
  const descriptor = content.CONTENT_DELIVERABLES.find((value) => value.kind === 'text' && JSON.stringify(value.sections.map((section) => section.id)) === JSON.stringify(ids));
  const cite = context.source.evidence[0]?.id;
  return { title: 'Fixture draft for editorial review', summary: 'A fixture proposal based on the saved source.', sections: descriptor.sections.map((section) => ({ id: section.id, heading: section.heading, body: 'The supplied source supports an editorial hypothesis.', items: Array.from({ length: section.minItems || 0 }, (_, i) => ({ label: `Item ${i + 1}`, text: 'Review original evidence', evidenceIds: [cite], productIds: [] })), evidenceIds: [cite], productIds: [] })), caveats: ['Fixture only.'] };
}

const SOURCE = { id: 'program-a', name: 'SEO weekly', sourceGroups: [{ platform: 'x', targets: ['researcher'] }], budgets: { collectionUsd: 1, aiUsd: 10 } };
const rows = () => Array.from({ length: 4 }, (_, index) => ({ id: `row-${index + 1}`, externalId: String(index + 1), platform: 'x', author: `researcher${index}`, type: 'post', text: 'Manual reporting needs better tools and dashboards take forever.', url: `https://x.com/researcher${index}/status/${index + 1}`, publishedAt: '2026-10-16T12:00:00Z', raw: { likeCount: 100, replyCount: 20, retweetCount: 10, quoteCount: 3, bookmarkCount: 5, viewCount: 1000 } }));

function harness({ denied = [], mondayFails = false, theme = {}, noTrends = false, failCollect = false, failKitOnce = false, uncapped = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-engine-test-')); roots.push(root);
  let now = '2026-10-17T12:00:00Z';
  let acting = null; let engine = null;
  const collect = vi.fn(async (request) => { if (failCollect) throw new Error('Collection failed in the fixture.'); return { items: rows(), receipt: { provider: 'fixture', paid: false, runId: request.runId, jobCount: 1, costUsd: 0.05 } }; });
  let kitFailures = failKitOnce ? 1 : 0;
  const runAI = vi.fn(async (request) => {
    const stage = fixture.stageOf(request);
    if (stage === 'discovery' && noTrends) return { output: { candidates: [] }, receipt: { provider: 'fixture', costUsd: 0.01, paid: false } };
    if (stage === 'content' && kitFailures > 0) { kitFailures--; throw new Error('The fixture writer is unavailable.'); }
    const output = stage === 'content' ? assetOutput(request) : fixture.researchOutput(request, { theme: { name: 'Reporting Friction Surge', description: 'Reporting takes manual work.', ...theme } });
    return { output, receipt: { provider: 'fixture', costUsd: 0.01, paid: false } };
  });
  const workspace = createContentWorkspace({
    root, collect, runAI, clock: () => new Date(now),
    actor: () => acting || { id: 'local', name: 'Admin' },
    isWorkflowCall: () => String(acting?.id || '').startsWith('workflow:'),
    hooks: { onResearchRunStarted: (run) => engine?.onResearchRunStarted(run) },
  });
  const monday = { connected: () => true, syncCards: vi.fn(async ({ cards }) => { if (mondayFails) throw new Error('board missing'); return { created: cards.length, updated: 0, failed: [] }; }) };
  const activity = [];
  const store = createWorkflowStore({ file: path.join(root, 'workflows.json') });
  engine = createWorkflowEngine({
    store, workspace, clock: () => new Date(now), monday, describeRoutes: async () => ({ models: ['Fixture model'], uncapped }),
    canIdentityCall: (_id, method) => !denied.includes(method),
    logActivity: (kind, workspaceId, detail, by) => activity.push({ kind, detail, by }),
    runAs: (actor, fn) => { const previous = acting; acting = actor; try { return fn(); } finally { acting = previous; } },
  });
  const program = workspace.saveResearchProgram({ ...SOURCE, workspaceId: workspace.activeWorkspaceId() });
  // Drive the engine until nothing more happens: content work settles, then the engine looks again.
  async function settle(rounds = 12) { for (let i = 0; i < rounds; i++) { await workspace.waitForIdle(); await engine.tick(); } await workspace.waitForIdle(); }
  return { root, workspace, engine, store, monday, activity, program, collect, runAI, settle, setTime: (value) => { now = value; }, now: () => now };
}

const admin = { id: 'local', name: 'Admin', admin: true };
const steps = (programId, extra = {}) => [
  { kind: 'research', programId },
  { kind: 'approve', mode: 'rules', rules: [{ momentum: ['new'] }], maxApprove: 3, otherwise: 'review', waitHours: 48, afterWait: 'continue', channels: [], note: '', ...extra.approve },
  { kind: 'reports' },
  { kind: 'assets', channels: ['blog'], pictures: false, teamNotes: 'Lead with the numbers.' },
  { kind: 'monday', alsoAtReview: false },
  { kind: 'notify', audience: ['editor', 'admin'], slackSummary: true },
];
const WEEKLY = { kind: 'schedule', schedule: { frequency: 'weekly', time: '08:00', timeZone: 'UTC', weekday: 1 } };
async function approvedWorkflow(h, extra = {}) {
  const saved = h.engine.save({ workflow: { name: 'Weekly SEO watch', trigger: extra.trigger || WEEKLY, steps: extra.steps || steps(h.program.id, extra) } }, admin);
  const estimate = await h.engine.estimate({ workflowId: saved.id });
  const perRun = extra.perRunUsd ?? Math.ceil(estimate.perRun.capUsd + 5);
  return h.engine.approveBudget({ workflowId: saved.id, perRunUsd: perRun, perMonthUsd: extra.perMonthUsd ?? perRun * 5, budgetHash: estimate.budgetHash, activate: true }, admin);
}
const MONDAY = '2026-10-19T08:00:30Z';
const onlyRun = (h) => h.engine.readRun({ runId: h.engine.publicState().workflowRuns[0].id });

describe('workflow engine', () => {
  it('runs on schedule: research, rule approvals with a note, reports, channel assets, Monday.com and the team summary', async () => {
    const h = harness();
    const workflow = await approvedWorkflow(h);
    expect(workflow).toMatchObject({ status: 'active', needsBudget: false, nextRunAt: '2026-10-19T08:00:00.000Z' });
    h.setTime('2026-10-19T08:00:30Z');
    await h.settle();
    const { workflowRuns } = h.engine.publicState();
    expect(workflowRuns).toHaveLength(1);
    const run = h.engine.readRun({ runId: workflowRuns[0].id });
    expect(run.status).toBe('succeeded');
    expect(run.steps.map((step) => step.status)).toEqual(['done', 'done', 'done', 'done', 'done', 'done']);
    expect(run.steps[1].refs.approved[0]).toMatchObject({ reason: 'New' });
    const research = h.workspace.publicState().researchRuns.find((row) => row.id === run.steps[0].refs.researchRunId);
    expect(research.workflow).toMatchObject({ id: workflow.id, runId: run.id, name: 'Weekly SEO watch' });
    const decided = Object.values(research.decisionsBy);
    expect(decided[0]).toMatchObject({ id: `workflow:${workflow.id}`, name: 'Weekly SEO watch', note: 'Approved by rule: New' });
    const kit = h.workspace.publicState().contentRuns.find((row) => row.id === run.steps[3].refs.kitRuns[0].contentRunId);
    expect(kit.workflow.runId).toBe(run.id);
    expect(h.monday.syncCards).toHaveBeenCalledOnce();
    expect(h.monday.syncCards.mock.calls[0][0].cards[0].key).toBe(`${research.id}:${research.themes[0].id}`);
    expect(run.notify).toMatchObject({ audience: ['admin', 'editor'], slackSummary: true });
    expect(run.committedUsd).toBeLessThanOrEqual(run.capUsd);
    expect(run.spentUsd).toBeGreaterThan(0);
    // The kit's writers saw the team notes.
    expect(h.runAI.mock.calls.some(([request]) => request.prompt.includes('TEAM NOTES FOR THESE CHANNEL ASSETS') && request.prompt.includes('Lead with the numbers.'))).toBe(true);
    expect(h.engine.publicState().workflows[0].lastRun).toMatchObject({ id: run.id, status: 'succeeded' });
    expect(h.activity.some((row) => row.kind === 'trend-decision' && row.by.id === `workflow:${workflow.id}`)).toBe(true);
  });
});

describe('workflow engine: waiting for people', () => {
  it('waits for review, and a person pressing Write reports is followed, never overridden', async () => {
    const h = harness();
    await approvedWorkflow(h, { approve: { mode: 'review', rules: [] } });
    h.setTime(MONDAY); await h.settle();
    let run = onlyRun(h);
    expect(run.status).toBe('waiting-review');
    expect(run.waiting).toMatchObject({ kind: 'review', count: 1, untilAt: '2026-10-21T08:00:30.000Z' });
    expect(h.engine.publicState().workflowSummary.waiting).toBe(1);
    const research = h.workspace.publicState().researchRuns[0];
    h.workspace.approveResearchThemes({ runId: research.id, themes: [research.themes[0].id] });
    h.workspace.continueResearchRun({ runId: research.id });
    await h.settle();
    run = onlyRun(h);
    expect(run.status).toBe('succeeded');
    expect(run.steps[1].refs.decidedByPeople).toEqual([research.themes[0].id]);
    expect(h.workspace.publicState().researchRuns[0].decisionsBy[research.themes[0].id].id).toBe('local');
  });
  it('skips the undecided after the wait, or stops when told to', async () => {
    const h = harness();
    await approvedWorkflow(h, { approve: { mode: 'review', rules: [], waitHours: 2, afterWait: 'stop' } });
    h.setTime(MONDAY); await h.settle();
    expect(onlyRun(h).status).toBe('waiting-review');
    h.setTime('2026-10-19T10:01:00Z'); await h.settle();
    const run = onlyRun(h);
    expect(run).toMatchObject({ status: 'partial', message: 'Stopped waiting for review.' });
    expect(run.steps.slice(2).map((step) => step.status)).toEqual(['skipped', 'skipped', 'skipped', 'skipped']);
  });
  it('ends “Nothing met the rules” and closes the review when nothing qualifies and the rest are skipped', async () => {
    const h = harness();
    await approvedWorkflow(h, { approve: { rules: [{ momentum: ['fading'] }], otherwise: 'skip' } });
    h.setTime(MONDAY); await h.settle();
    const run = onlyRun(h);
    expect(run).toMatchObject({ status: 'succeeded', message: 'Nothing met the rules.' });
    const research = h.workspace.publicState().researchRuns[0];
    expect(research.status).toBe('succeeded');
    expect(Object.values(research.decisions)).toEqual(['passed']);
    expect(h.collect).toHaveBeenCalledOnce();
  });
  it('finishes “No new trends this time” when research finds nothing', async () => {
    const h = harness({ noTrends: true });
    await approvedWorkflow(h);
    h.setTime(MONDAY); await h.settle();
    expect(onlyRun(h)).toMatchObject({ status: 'succeeded', message: 'No new trends this time.' });
  });
});

describe('workflow engine: money', () => {
  it('waits for a bigger budget when the next set would go over the run’s cap', async () => {
    const h = harness();
    await approvedWorkflow(h, { perRunUsd: 11 });
    h.setTime(MONDAY); await h.settle();
    const run = onlyRun(h);
    expect(run.status).toBe('waiting-budget');
    expect(run.steps[3]).toMatchObject({ kind: 'assets', status: 'waiting' });
    expect(run.message).toMatch(/Needs a bigger budget/);
    expect(h.workspace.publicState().contentRuns.filter((row) => row.kit)).toHaveLength(0);
    expect(run.committedUsd).toBeLessThanOrEqual(run.capUsd);
  });
  it('refuses to start past the month’s budget', async () => {
    const h = harness();
    const workflow = await approvedWorkflow(h, { perRunUsd: 30, perMonthUsd: 35 });
    h.store.change((data) => { data.runs.push({ id: 'wfrun-earlier', workflowId: workflow.id, workspaceId: workflow.workspaceId, status: 'succeeded', spentUsd: 30, committedUsd: 30, createdAt: '2026-10-05T08:00:00.000Z', steps: [] }); });
    h.setTime(MONDAY); await h.settle();
    const run = h.engine.publicState().workflowRuns.find((row) => row.id !== 'wfrun-earlier');
    expect(run.status).toBe('waiting-budget');
    expect(run.message).toMatch(/this month/);
    expect(h.collect).not.toHaveBeenCalled();
  });
  it('pauses at trigger time when the paid setup changed since approval', async () => {
    const h = harness();
    const workflow = await approvedWorkflow(h);
    h.workspace.saveResearchProgram({ ...h.program, workspaceId: h.workspace.activeWorkspaceId(), budgets: { collectionUsd: 2, aiUsd: 12 } });
    h.setTime(MONDAY); await h.settle();
    const saved = h.engine.publicState().workflows.find((row) => row.id === workflow.id);
    expect(saved).toMatchObject({ status: 'paused', needsBudget: true });
    expect(onlyRun(h)).toMatchObject({ status: 'skipped' });
    expect(h.collect).not.toHaveBeenCalled();
    await expect(h.engine.setStatus({ workflowId: workflow.id, status: 'active' }, admin)).rejects.toThrow(/Approve this workflow’s budget/);
  });
  it('a draft runs once only with a one-off cap, and the hash must match what was priced', async () => {
    const h = harness();
    const draft = h.engine.save({ workflow: { name: 'Try it', trigger: { kind: 'manual' }, steps: steps(h.program.id).slice(0, 2) } }, admin);
    expect(draft).toMatchObject({ status: 'draft', needsBudget: true });
    const estimate = await h.engine.estimate({ workflowId: draft.id });
    expect(estimate.steps[0]).toMatchObject({ kind: 'research', capUsd: 11 });
    await expect(h.engine.run({ workflowId: draft.id, budgetHash: estimate.budgetHash }, admin)).rejects.toThrow(/Choose a cap/);
    await expect(h.engine.run({ workflowId: draft.id, budgetHash: 'stale', capUsd: 20 }, admin)).rejects.toThrow(/setup changed/);
    const run = await h.engine.run({ workflowId: draft.id, budgetHash: estimate.budgetHash, capUsd: 20 }, admin);
    expect(run).toMatchObject({ trigger: 'manual', capUsd: 20, startedBy: { id: 'local' } });
    await h.settle();
    expect(onlyRun(h).status).toBe('succeeded');
  });
  it('marks spend as estimated on a route that reports no cost', async () => {
    const h = harness({ uncapped: true });
    await approvedWorkflow(h);
    h.setTime(MONDAY); await h.settle();
    expect(onlyRun(h)).toMatchObject({ status: 'succeeded', spentEstimated: true });
  });
});

describe('workflow engine: access, triggers and recovery', () => {
  it('pauses with needsAdmin when the owner can no longer make channel assets', async () => {
    const h = harness({ denied: ['createAssetKit'] });
    const workflow = await approvedWorkflow(h);
    h.setTime(MONDAY); await h.settle();
    const run = onlyRun(h);
    expect(run).toMatchObject({ status: 'partial', needsAdmin: true });
    expect(run.message).toMatch(/no longer has access to Make channel assets/);
    const saved = h.engine.publicState().workflows.find((row) => row.id === workflow.id);
    expect(saved).toMatchObject({ status: 'paused', needsAdmin: true });
    const taken = h.engine.approveBudget({ workflowId: workflow.id, takeOver: true }, { id: 'member-2', name: 'Second admin' });
    expect(taken).toMatchObject({ owner: { id: 'member-2' }, needsAdmin: false });
  });
  it('records a skipped run while the program’s own run waits for review', async () => {
    const h = harness();
    await approvedWorkflow(h);
    h.workspace.startResearchRun({ programId: h.program.id }); await h.workspace.waitForIdle();
    h.setTime(MONDAY); await h.settle();
    expect(onlyRun(h)).toMatchObject({ status: 'skipped' });
    expect(onlyRun(h).message).toMatch(/started a search with this program/);
  });
  it('follows a run a person starts when the trigger is “whenever the program runs”', async () => {
    const h = harness();
    const workflow = await approvedWorkflow(h, { trigger: { kind: 'program-run', programId: SOURCE.id } });
    expect(workflow.nextRunAt).toBe('');
    const started = h.workspace.startResearchRun({ programId: h.program.id });
    await h.settle();
    const run = onlyRun(h);
    expect(run).toMatchObject({ trigger: 'program-run', status: 'succeeded' });
    expect(run.steps[0].refs.researchRunId).toBe(started.id);
    expect(h.workspace.publicState().researchRuns.find((row) => row.id === started.id).workflow.id).toBe(workflow.id);
    expect(h.collect).toHaveBeenCalledOnce();
  });
  it('cancels every running child', async () => {
    const h = harness();
    const workflow = await approvedWorkflow(h);
    const estimate = await h.engine.estimate({ workflowId: workflow.id });
    const run = await h.engine.run({ workflowId: workflow.id, budgetHash: estimate.budgetHash }, admin);
    const cancelled = await h.engine.cancelRun({ runId: run.id }, admin);
    expect(cancelled.status).toBe('cancelled');
    await h.workspace.waitForIdle();
    expect(h.workspace.publicState().researchRuns[0].status).toBe('cancelled');
  });
  it('retries from the stopped step without repeating finished, paid work', async () => {
    const h = harness({ failKitOnce: true });
    const workflow = await approvedWorkflow(h);
    h.setTime(MONDAY); await h.settle();
    let run = onlyRun(h);
    expect(run.status).toBe('partial');
    expect(run.steps[3].status).toBe('failed');
    const researchCalls = h.runAI.mock.calls.filter(([request]) => fixture.stageOf(request) !== 'content').length;
    const estimate = await h.engine.estimate({ workflowId: workflow.id });
    await h.engine.retryRun({ runId: run.id, budgetHash: estimate.budgetHash }, admin);
    await h.settle();
    run = onlyRun(h);
    expect(run.status).toBe('succeeded');
    expect(h.collect).toHaveBeenCalledOnce();
    expect(h.runAI.mock.calls.filter(([request]) => fixture.stageOf(request) !== 'content').length).toBe(researchCalls);
    expect(h.workspace.publicState().contentRuns.filter((row) => row.kit)).toHaveLength(1);
  });
  it('keeps the approved per-run budget as the cap when a run is tried again', async () => {
    const h = harness({ failKitOnce: true });
    const workflow = await approvedWorkflow(h);
    h.setTime(MONDAY); await h.settle();
    const run = onlyRun(h);
    expect(run.status).toBe('partial');
    const estimate = await h.engine.estimate({ workflowId: workflow.id });
    await h.engine.retryRun({ runId: run.id, budgetHash: estimate.budgetHash, capUsd: 400 }, admin);
    expect(onlyRun(h).capUsd).toBe(workflow.budget.perRunUsd); // raising it is approveWorkflowBudget's
  });
  it('refuses to save a step the person saving couldn’t run (runs act with the owner’s access)', () => {
    const h = harness({ denied: ['syncTrendBoardToMonday'] });
    const riley = { id: 'member-riley', name: 'Riley' };
    expect(() => h.engine.save({ workflow: { name: 'Weekly SEO watch', trigger: WEEKLY, steps: steps(h.program.id) } }, riley)).toThrow(expect.objectContaining({ status: 403, message: expect.stringMatching(/Update Monday|Monday/) }));
    expect(h.engine.save({ workflow: { name: 'Weekly SEO watch', trigger: WEEKLY, steps: steps(h.program.id).filter((step) => step.kind !== 'monday') } }, riley)).toMatchObject({ owner: { id: 'member-riley' } });
  });
  it('rebuilds lost links from the children after a restart', async () => {
    const h = harness();
    await approvedWorkflow(h, { approve: { mode: 'review', rules: [] } });
    h.setTime(MONDAY); await h.settle();
    const run = onlyRun(h);
    h.store.change((data) => { const row = data.runs.find((entry) => entry.id === run.id); row.steps[0].refs = {}; row.steps[0].status = 'pending'; });
    h.engine.recover();
    expect(h.engine.readRun({ runId: run.id }).steps[0].refs.researchRunId).toBe(h.workspace.publicState().researchRuns[0].id);
  });
  it('starts nothing new once stopped for a restart', async () => {
    const h = harness();
    await approvedWorkflow(h);
    h.engine.stop();
    h.setTime(MONDAY); await h.engine.tick();
    expect(onlyRun(h)).toMatchObject({ status: 'skipped', message: 'The studio was restarting.' });
    expect(h.collect).not.toHaveBeenCalled();
  });
  it('pauses itself after three failed runs in a row', async () => {
    const h = harness({ failCollect: true });
    const workflow = await approvedWorkflow(h);
    for (let attempt = 0; attempt < 3; attempt++) {
      const estimate = await h.engine.estimate({ workflowId: workflow.id });
      await h.engine.run({ workflowId: workflow.id, budgetHash: estimate.budgetHash }, admin);
      await h.settle();
    }
    const saved = h.engine.publicState().workflows.find((row) => row.id === workflow.id);
    expect(saved.status).toBe('paused');
    expect(saved.pausedReason).toMatch(/3 failed runs/);
  });
  it('refuses a program schedule while a scheduled workflow runs that program, and the reverse', async () => {
    const h = harness();
    await approvedWorkflow(h);
    expect(() => h.engine.assertNoScheduleConflict({ id: SOURCE.id, schedule: { frequency: 'daily', enabled: true } })).toThrow(/already runs this program on a schedule/);
    const other = harness();
    other.workspace.saveResearchProgram({ ...SOURCE, workspaceId: other.workspace.activeWorkspaceId(), schedule: { frequency: 'daily', enabled: true, time: '09:00', timeZone: 'UTC' } });
    expect(() => other.engine.save({ workflow: { name: 'Clash', trigger: WEEKLY, steps: steps(SOURCE.id) } }, admin)).toThrow(/already runs on its own schedule/);
  });
  it('a Monday.com failure leaves the run partial and still tells the team', async () => {
    const h = harness({ mondayFails: true });
    await approvedWorkflow(h);
    h.setTime(MONDAY); await h.settle();
    const run = onlyRun(h);
    expect(run.status).toBe('partial');
    expect(run.steps[4]).toMatchObject({ status: 'failed' });
    expect(run.steps[4].message).toMatch(/Monday.com sync failed: board missing; everything else finished/);
    expect(run.steps[5].status).toBe('done');
  });
  it('counts a Monday.com push that stopped early as failed, not done', async () => {
    const h = harness();
    h.monday.syncCards.mockResolvedValue({ error: 'auth' }); // what monday-engine push returns after pausing the link
    await approvedWorkflow(h);
    h.setTime(MONDAY); await h.settle();
    const run = onlyRun(h);
    expect(run.status).toBe('partial');
    expect(run.steps[4]).toMatchObject({ status: 'failed', message: expect.stringMatching(/^Monday.com sync failed: it stopped early/) });
    expect(run.steps[5].status).toBe('done');
  });
});

describe('workflow engine: playbooks', () => {
  it('previews a playbook with its cost, then sets up the program and the workflow, turned on', async () => {
    const h = harness();
    const preview = await h.engine.previewPlaybook({ playbookId: 'weekly-seo-trend-watch', inputs: { topic: 'SEO' }, timeZone: 'America/New_York', sourceProgramId: SOURCE.id, programMode: 'new' });
    expect(preview.missing).toEqual([]);
    expect(preview.program).toMatchObject({ name: 'SEO weekly watch', query: 'SEO', schedule: { enabled: false }, autoApproveThemes: false });
    expect(preview.estimate).toMatchObject({ blocked: false, perRun: { capUsd: expect.any(Number) }, perMonth: { runs: { min: 4, max: 5 } } });
    expect(preview.estimate.steps.find((step) => step.kind === 'research').capUsd).toBe(28);
    const applied = await h.engine.applyPlaybook({ playbookId: 'weekly-seo-trend-watch', program: { ...preview.program, notes: { research: 'Prefer data-backed findings.', reports: '' } }, workflow: preview.workflow, budget: { perRunUsd: Math.ceil(preview.estimate.perRun.capUsd), perMonthUsd: Math.ceil(preview.estimate.perRun.capUsd) * 5 }, budgetHash: preview.estimate.budgetHash, activate: true }, admin);
    expect(applied).toMatchObject({ approved: true, workflow: { status: 'active', needsBudget: false, playbookId: 'weekly-seo-trend-watch', nextRunAt: '2026-10-19T12:00:00.000Z' } });
    const program = h.workspace.publicState().programs.find((row) => row.id === applied.programId);
    expect(program).toMatchObject({ name: 'SEO weekly watch', notes: { research: 'Prefer data-backed findings.' }, sourceGroups: [expect.objectContaining({ targets: ['researcher'] })] });
    expect(applied.workflow.steps[0].programId).toBe(applied.programId);
    await expect(h.engine.applyPlaybook({ playbookId: 'weekly-seo-trend-watch', program: preview.program, workflow: preview.workflow, budget: { perRunUsd: 60, perMonthUsd: 300 }, budgetHash: 'stale', activate: true }, admin)).rejects.toThrow(/setup changed/);
  });
  it('keeps team playbooks per workspace and deletes only those', () => {
    const h = harness();
    const saved = h.engine.savePlaybook({ playbook: { basedOn: 'pr-angle-finder', name: 'Our PR angles', steps: [{ kind: 'research' }, { kind: 'approve', mode: 'rules', rules: [{ priority: ['FAST-TRACK'] }], maxApprove: 1, otherwise: 'skip' }, { kind: 'reports' }], notes: { research: 'Only data-backed.', reports: '' } } }, admin);
    expect(saved).toMatchObject({ id: expect.stringMatching(/^team-/), basedOn: 'pr-angle-finder', name: 'Our PR angles', notes: { research: 'Only data-backed.' } });
    expect(h.engine.publicState().playbooks.map((row) => row.id)).toEqual([saved.id]);
    expect(() => h.engine.deletePlaybook({ playbookId: 'pr-angle-finder' })).toThrow(/team’s own playbooks/);
    expect(h.engine.deletePlaybook({ playbookId: saved.id })).toEqual({ deleted: true, playbookId: saved.id });
  });
});
