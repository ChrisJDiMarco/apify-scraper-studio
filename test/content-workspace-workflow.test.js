import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import workspaceModule from '../src/main/content-workspace.js';
import fixture from './helpers/research-ai-fixture.js';

const { createContentWorkspace } = workspaceModule;
const roots = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const LINK = { id: 'workflow-a', runId: 'wfrun-a', name: 'Weekly SEO watch' };
const rows = () => Array.from({ length: 3 }, (_, index) => ({ id: `row-${index}`, externalId: String(index), platform: 'x', author: `writer${index}`, type: 'post', text: 'Manual reporting needs better tools and dashboards take forever.', url: `https://x.com/writer${index}/status/${index}`, publishedAt: '2026-10-16T12:00:00Z', raw: { likeCount: 100, replyCount: 20, retweetCount: 10, quoteCount: 3, bookmarkCount: 5, viewCount: 1000 } }));

function harness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-workflow-')); roots.push(root);
  let acting = null; let release = null;
  const collect = vi.fn(async () => { if (release) await release; return { items: rows(), receipt: { provider: 'fixture', paid: false } }; });
  const runAI = vi.fn(async (request) => ({ output: fixture.researchOutput(request), receipt: { provider: 'fixture', costUsd: 0.01 } }));
  const api = createContentWorkspace({ root, collect, runAI, clock: () => new Date('2026-10-17T12:00:00Z'), actor: () => acting || { id: 'local', name: 'Admin' }, isWorkflowCall: () => String(acting?.id || '').startsWith('workflow:') });
  const program = api.saveResearchProgram({ id: 'program-a', name: 'SEO weekly', workspaceId: api.activeWorkspaceId(), sourceGroups: [{ platform: 'x', targets: ['writer0'] }], budgets: { collectionUsd: 1, aiUsd: 10 }, notes: { research: 'Prefer data-backed findings.', reports: '' } });
  const readState = () => JSON.parse(fs.readFileSync(path.join(root, 'state.json'), 'utf8'));
  return { api, program, collect, runAI, readState, as: (actor) => { acting = actor; }, hold: () => { let open; release = new Promise((resolve) => { open = resolve; }); return () => { release = null; open(); }; } };
}

describe('the content workspace’s way in for workflows', () => {
  it('writes run.workflow in the save that creates the research run, credited to the workflow', async () => {
    const h = harness();
    h.as({ id: 'workflow:workflow-a', name: 'Weekly SEO watch' });
    const run = h.api.startResearchRunFor({ programId: h.program.id, link: LINK });
    const saved = h.readState().researchRuns.find((row) => row.id === run.id);
    expect(saved.workflow).toEqual(LINK);
    expect(saved.createdBy).toEqual({ id: 'workflow:workflow-a', name: 'Weekly SEO watch' });
    await h.api.waitForIdle();
    expect(h.api.publicState().researchRuns[0]).toMatchObject({ status: 'awaiting-review', workflow: LINK });
    // A link that isn't a workflow's is dropped.
    expect(() => h.api.startResearchRunFor({ programId: h.program.id, link: { id: 'x', runId: 'y' } })).toThrow(/started a search/);
  });
  it('passes program notes to the research prompts only when there are some', async () => {
    const h = harness();
    h.api.startResearchRun({ programId: h.program.id }); await h.api.waitForIdle();
    const prompts = h.runAI.mock.calls.map(([request]) => request.prompt);
    expect(prompts.filter((prompt) => prompt.includes('TEAM NOTES FOR THIS PROGRAM')).length).toBeGreaterThanOrEqual(2);
    expect(prompts.find((prompt) => prompt.includes('TEAM NOTES FOR THIS PROGRAM'))).toContain('Prefer data-backed findings.');
    expect(() => h.api.saveResearchProgram({ ...h.program, workspaceId: h.api.activeWorkspaceId(), notes: { research: 'sk-abcdefghijklmnopqrstuvwxyz' } })).toThrow(/key or token/);
    expect(() => h.api.saveResearchProgram({ ...h.program, workspaceId: h.api.activeWorkspaceId(), notes: { research: 'x'.repeat(601) } })).toThrow(/600/);
    expect(h.api.saveResearchProgram({ ...h.program, workspaceId: h.api.activeWorkspaceId(), notes: { research: '', reports: '' } }).notes).toBeUndefined();
  });
  it('runs a workflow’s quick scan without a fingerprint, still one at a time', () => {
    const h = harness(); const open = h.hold();
    const run = h.api.startQuickScanFor({ scan: { topic: 'reporting', depth: 'lite' }, programId: h.program.id, link: LINK });
    expect(run).toMatchObject({ origin: 'quick-scan', workflow: LINK, quickScan: { topic: 'reporting', report: true } });
    expect(() => h.api.startQuickScanFor({ scan: { topic: 'again' }, programId: h.program.id, link: LINK })).toThrow(/One quick scan runs at a time/);
    expect(h.api.estimateQuickScanFor({ scan: { topic: 'reporting' }, programId: h.program.id })).toMatchObject({ topic: 'reporting', blocked: false });
    open();
    return h.api.waitForIdle();
  });
  it('reads the signals approval rules use, and closes a review nobody will do', async () => {
    const h = harness();
    const run = h.api.startResearchRun({ programId: h.program.id }); await h.api.waitForIdle();
    const signals = h.api.reviewSignals({ runId: run.id });
    const [themeId] = Object.keys(signals);
    expect(signals[themeId]).toMatchObject({ momentum: 'new', name: expect.any(String), priorityTier: expect.any(String), posts: expect.any(Number), platforms: expect.any(Array) });
    h.as({ id: 'workflow:workflow-a', name: 'Weekly SEO watch' });
    const closed = h.api.closeReviewFor({ runId: run.id, message: 'Nothing met the rules.' });
    expect(closed).toMatchObject({ status: 'succeeded', themes: [], decisions: { [themeId]: 'passed' } });
    expect(closed.decisionsBy[themeId].id).toBe('workflow:workflow-a');
  });
  it('accepts a workflow link and team notes on a set of channel assets only from the workflow', async () => {
    const h = harness();
    const run = h.api.startResearchRun({ programId: h.program.id }); await h.api.waitForIdle();
    const research = h.api.publicState().researchRuns[0];
    h.api.approveResearchThemes({ runId: run.id, themes: [research.themes[0].id] });
    h.api.continueResearchRun({ runId: run.id }); await h.api.waitForIdle();
    const [report] = h.api.reportAssetsForRun({ runId: run.id });
    expect(report).toMatchObject({ themeId: research.themes[0].id, status: 'succeeded', reportAssetId: expect.stringMatching(/^asset-/), toolkitAssetId: expect.stringMatching(/^asset-/) });
    const source = { kind: 'report', assetId: report.reportAssetId };
    expect(() => h.api.createAssetKit({ source, deliverableIds: ['newsletter'], workflow: LINK })).toThrow(/Only a workflow/);
    expect(() => h.api.planAssetKit({ source, deliverableIds: ['newsletter'], teamNotes: 'x'.repeat(601) })).toThrow(/600/);
    expect(() => h.api.planAssetKit({ source, deliverableIds: ['newsletter'], teamNotes: 'token ghp_abcdefghijklmnopqrstuvwxyz123456' })).toThrow(/key or token/);
    h.as({ id: 'workflow:workflow-a', name: 'Weekly SEO watch' });
    const kit = h.api.createAssetKit({ source, deliverableIds: ['newsletter'], teamNotes: 'Lead with the numbers.', workflow: LINK });
    expect(kit.workflow).toEqual(LINK);
    expect(h.api.estimateKitTypical({ deliverableIds: ['newsletter'] })).toMatchObject({ basis: 'report', aboutUsd: expect.any(Number), capUsd: expect.any(Number) });
    await h.api.waitForIdle();
  });
});
