import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import workspaceModule from '../src/main/content-workspace.js';
const { createContentWorkspace } = workspaceModule;
const roots = [];
afterEach(() => { vi.useRealTimers(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const program = extra => ({ id: 'program-a', name: 'Scheduled research', sourceGroups: [{ platform: 'x', targets: ['researcher'] }], window: { startDate: '2026-01-01', endDate: '2026-01-07' }, budgets: { collectionUsd: .5, aiUsd: 1 }, schedule: { frequency: 'daily', enabled: true, time: '09:00', timeZone: 'America/New_York', weekday: 1, dayOfMonth: 1, lookbackDays: 1 }, ...extra });
function harness({ collect: customCollect, review = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'research-scheduler-test-')); roots.push(root);
  let now = '2026-09-27T12:00:00Z';
  const readState = () => JSON.parse(fs.readFileSync(path.join(root, 'state.json'), 'utf8'));
  const rows = endDate => [{ id: 'row-1', externalId: '1', platform: 'x', author: 'researcher', type: 'post', text: 'Manual reporting needs better tools.', url: 'https://x.com/researcher/status/1', publishedAt: `${endDate}T12:00:00Z`, raw: { likeCount: 100, replyCount: 20, retweetCount: 10, quoteCount: 3, bookmarkCount: 5, viewCount: 1000 } }];
  const collect = vi.fn(async request => customCollect ? customCollect(request, readState) : ({ items: rows(request.program.window.endDate || '2026-09-26'), receipt: { provider: 'fixture', paid: false, runId: request.runId, jobCount: 1 } }));
  const runAI = vi.fn(async request => {
    const tail = JSON.parse(request.prompt.slice(request.prompt.lastIndexOf('\n{') + 1));
    const output = request.schema.properties.candidates ? { candidates: review ? [{ name: 'Reporting friction', summary: 'Manual reporting work is slow.', painPoint: 'Workflow/Resource Overload', semanticIntentSignals: ['manual reports'], actionability: 'Simplify reporting.', evidenceIds: tail.evidenceIds }] : [] } : { themes: review ? [{ name: 'Reporting friction', description: 'Reporting takes manual work.', existingThemeId: null, candidateIds: tail.candidates.map(c => c.id), novelty: 'NEW ANGLE', matchingKeywords: ['reporting'], matchingCriteria: 'Specific manual reporting work.', negativeCriteria: 'Generic promotion.', taxonomyCategory: 'Reporting' }] : [] };
    return { output, receipt: { provider: 'fixture', costUsd: 0, paid: false } };
  });
  const deps = { root, collect, runAI, clock: () => new Date(now) };
  return { root, deps, api: createContentWorkspace(deps), collect, runAI, readState, setTime: value => { now = value; } };
}
describe('durable research scheduling', () => {
  it('does not activate old programs or a chosen cadence without explicit enabling', async () => {
    const h = harness();
    h.api.saveResearchProgram(program({ schedule: undefined }));
    expect(h.api.publicState().programs[0].schedule).toMatchObject({ frequency: 'manual', enabled: false, nextRunAt: '' });
    h.api.saveResearchProgram(program({ schedule: { frequency: 'daily' } }));
    h.setTime('2027-09-27T16:00:00Z');
    expect(h.api.checkDueResearchSchedules()).toEqual([]);
    expect(h.collect).not.toHaveBeenCalled();
  });
  it('owns next-run metadata and preserves the occurrence across unrelated edits/restarts', () => {
    const h = harness(); const saved = h.api.saveResearchProgram(program());
    expect(saved.schedule.nextRunAt).toBe('2026-09-27T13:00:00.000Z');
    h.setTime('2026-09-27T12:30:00Z');
    const edited = h.api.saveResearchProgram({ ...saved, name: 'Edited title', schedule: { ...saved.schedule, nextRunAt: '2020-01-01T00:00:00Z', lastRunId: 'forged', lastStatus: 'succeeded' } });
    expect(edited.schedule).toMatchObject({ nextRunAt: saved.schedule.nextRunAt, lastRunId: '', lastStatus: '' });
    const restart = createContentWorkspace(h.deps); restart.recoverInterrupted();
    expect(restart.publicState().programs[0].schedule.nextRunAt).toBe(saved.schedule.nextRunAt);
    expect(h.collect).not.toHaveBeenCalled();
  });
  it('claims on disk before collection, executes only once, and retains fixed manual dates', async () => {
    let claim;
    const h = harness({ collect: async (request, readState) => { claim = { request, state: readState() }; return { items: [], receipt: {} }; } });
    h.api.saveResearchProgram(program()); h.setTime('2026-09-27T13:00:01Z');
    const [started] = h.api.checkDueResearchSchedules();
    expect(started.status).toBe('started'); expect(h.api.checkDueResearchSchedules()).toEqual([]);
    await h.api.waitForIdle();
    expect(h.collect).toHaveBeenCalledOnce();
    expect(claim.state.programs[0].schedule).toMatchObject({ lastRunId: started.runId, lastScheduledFor: '2026-09-27T13:00:00.000Z', nextRunAt: '2026-09-28T13:00:00.000Z' });
    expect(claim.state.researchRuns[0].id).toBe(started.runId);
    expect(claim.request.program.window).toEqual({ startDate: '2026-09-26', endDate: '2026-09-26' });
    expect(h.api.publicState().programs[0].window).toEqual({ startDate: '2026-01-01', endDate: '2026-01-07' });
  });
  it('uses the latest due period after a long sleep, with no replay backlog', async () => {
    const h = harness(); h.api.saveResearchProgram(program()); h.setTime('2026-10-08T15:00:00Z');
    h.api.checkDueResearchSchedules(); await h.api.waitForIdle();
    expect(h.collect).toHaveBeenCalledOnce(); expect(h.runAI).toHaveBeenCalledTimes(2);
    const saved = h.api.publicState();
    expect(saved.researchRuns[0]).toMatchObject({ status: 'succeeded', scheduledFor: '2026-10-08T13:00:00.000Z', window: { startDate: '2026-10-07', endDate: '2026-10-07' } });
    expect(saved.programs[0].schedule.nextRunAt).toBe('2026-10-09T13:00:00.000Z');
    expect(h.api.checkDueResearchSchedules()).toEqual([]);
  });
  it('blocks overlap during execution and awaiting review, then resumes after cancellation and explicit enable', async () => {
    const h = harness({ review: true }); h.api.saveResearchProgram(program()); h.setTime('2026-09-27T13:01:00Z');
    const [first] = h.api.checkDueResearchSchedules();
    h.setTime('2026-09-28T13:01:00Z');
    expect(h.api.checkDueResearchSchedules()[0]).toMatchObject({ status: 'skipped', runId: first.runId });
    await h.api.waitForIdle(); expect(h.api.publicState().researchRuns[0].status).toBe('awaiting-review');
    h.setTime('2026-09-29T13:01:00Z');
    expect(h.api.checkDueResearchSchedules()[0].status).toBe('skipped');
    expect(h.api.publicState().programs[0].schedule.skippedReason).toMatch(/review/);
    expect(h.collect).toHaveBeenCalledOnce();
    await h.api.cancelStudioRun({ runId: first.runId });
    expect(h.api.publicState().programs[0].schedule.enabled).toBe(false);
    h.api.saveResearchProgram({ ...h.api.publicState().programs[0], schedule: { ...h.api.publicState().programs[0].schedule, enabled: true } });
    h.setTime('2026-09-30T13:01:00Z'); expect(h.api.checkDueResearchSchedules()[0].status).toBe('started');
    await h.api.waitForIdle(); expect(h.collect).toHaveBeenCalledTimes(2);
  });
  it('also blocks a schedule behind a manual run awaiting review', async () => {
    const h = harness({ review: true }); h.api.saveResearchProgram(program());
    h.api.startResearchRun({ programId: 'program-a' }); await h.api.waitForIdle();
    h.setTime('2026-09-27T14:00:00Z'); expect(h.api.checkDueResearchSchedules()[0].status).toBe('skipped');
    expect(h.collect).toHaveBeenCalledOnce();
  });
  it('dispatches the owning workspace without switching the visible workspace', async () => {
    const h = harness(); h.api.selectContentWorkspace('semrush'); h.api.saveResearchProgram(program()); h.api.selectContentWorkspace('general');
    h.setTime('2026-09-27T14:00:00Z'); h.api.checkDueResearchSchedules(); await h.api.waitForIdle();
    expect(h.collect.mock.calls[0][0].workspaceId).toBe('semrush');
    expect(h.api.publicState()).toMatchObject({ activeWorkspaceId: 'general', researchRuns: [] });
    h.api.selectContentWorkspace('semrush'); expect(h.api.publicState().researchRuns).toHaveLength(1);
  });
  it('pauses on provider failure and does not retry paid requests on later ticks', async () => {
    const h = harness({ collect: async () => { throw new Error('Provider unavailable'); } });
    h.api.saveResearchProgram(program()); h.setTime('2026-09-27T14:00:00Z'); h.api.checkDueResearchSchedules(); await h.api.waitForIdle();
    expect(h.api.publicState().programs[0].schedule).toMatchObject({ enabled: false, nextRunAt: '', lastStatus: 'failed', lastError: 'Provider unavailable' });
    h.setTime('2026-10-27T14:00:00Z'); expect(h.api.checkDueResearchSchedules()).toEqual([]);
    expect(h.collect).toHaveBeenCalledOnce(); expect(h.runAI).not.toHaveBeenCalled();
  });
  it('pauses interrupted claims on restart without dispatching the same occurrence', async () => {
    const h = harness(); const saved = h.api.saveResearchProgram(program()); const state = h.readState();
    state.programs[0].schedule = { ...saved.schedule, lastRunId: 'interrupted-run', lastStatus: 'queued', nextRunAt: '2026-09-28T13:00:00.000Z' };
    state.researchRuns.push({ id: 'interrupted-run', programId: 'program-a', workspaceId: 'general', type: 'research', status: 'queued', scheduledFor: saved.schedule.nextRunAt });
    fs.writeFileSync(path.join(h.root, 'state.json'), JSON.stringify(state));
    h.setTime('2026-09-29T14:00:00Z'); const restart = createContentWorkspace(h.deps); restart.recoverInterrupted();
    expect(restart.publicState().programs[0].schedule).toMatchObject({ enabled: false, lastStatus: 'failed', nextRunAt: '' });
    expect(restart.checkDueResearchSchedules()).toEqual([]); expect(h.collect).not.toHaveBeenCalled();
  });
  it('uses rolling dates on a manual start of a paused recurrence and restores fixed dates in one-time mode', async () => {
    const h = harness();
    let saved = h.api.saveResearchProgram(program({ schedule: { ...program().schedule, enabled: false } }));
    h.api.startResearchRun({ programId: saved.id }); await h.api.waitForIdle();
    expect(h.collect.mock.calls[0][0].program.window).toEqual({ startDate: '2026-09-26', endDate: '2026-09-26' });
    expect(h.api.publicState().programs[0].schedule).toMatchObject({ enabled: false, lastRunId: '' });
    saved = h.api.saveResearchProgram({ ...saved, schedule: { ...saved.schedule, frequency: 'manual' } });
    h.api.startResearchRun({ programId: saved.id }); await h.api.waitForIdle();
    expect(h.collect.mock.calls[1][0].program.window).toEqual({ startDate: '2026-01-01', endDate: '2026-01-07' });
  });
  it('supports pause/resume and does not start immediately when re-enabled', async () => {
    const h = harness(); const saved = h.api.saveResearchProgram(program());
    h.api.saveResearchProgram({ ...saved, schedule: { ...saved.schedule, enabled: false } });
    h.setTime('2026-09-28T14:00:00Z'); expect(h.api.checkDueResearchSchedules()).toEqual([]);
    const resumed = h.api.saveResearchProgram({ ...saved, schedule: { ...saved.schedule, enabled: true } });
    expect(resumed.schedule.nextRunAt).toBe('2026-09-29T13:00:00.000Z');
    expect(h.api.checkDueResearchSchedules()).toEqual([]); expect(h.collect).not.toHaveBeenCalled();
  });
  it('runs its host timer and stops it cleanly', async () => {
    vi.useFakeTimers(); const h = harness(); h.api.saveResearchProgram(program()); h.api.startResearchScheduler();
    h.setTime('2026-09-27T13:01:00Z'); await vi.advanceTimersByTimeAsync(30000); await h.api.waitForIdle();
    expect(h.collect).toHaveBeenCalledOnce(); h.api.stopResearchScheduler();
    h.setTime('2026-09-28T13:01:00Z'); await vi.advanceTimersByTimeAsync(60000); expect(h.collect).toHaveBeenCalledOnce();
  });
});
