import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import workspaceModule from '../src/main/content-workspace.js';
import storeModule from '../src/main/workbooks.js';
const { createContentWorkspace } = workspaceModule;
const { createWorkbookStore } = storeModule;

// Someone invited to one research program reads trend history, the Trend tracker and Ask AI's trend and post lookups
// built from that program's runs only (review FIX-5: these reads used to span every program).
const roots = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const theme = (id, name) => ({ id, name, description: `${name}.`, matchingKeywords: [], taxonomyCategory: 'AI Search', evidenceCount: 10, platforms: ['x'] });
const run = (id, programId, day, themes) => ({ id, workspaceId: 'general', programId, type: 'research', title: `Run ${id}`, status: 'succeeded', stage: 'reports', createdAt: `2026-10-${day}T10:00:00Z`, updatedAt: `2026-10-${day}T11:00:00Z`, counts: { retained: 100, discoveryEligible: 100, platforms: { x: 100 } }, discoveredThemes: themes, themes, decisions: {}, jobs: [] });

function studio() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'program-scope-trends-')); roots.push(root);
  let scope = null;
  const deps = { root, runAI: async () => ({ output: {}, receipt: {} }), clock: () => new Date('2026-10-20T12:00:00Z'), getCallerPrograms: () => scope };
  // Saving a program writes the first state.json.
  createContentWorkspace(deps).saveResearchProgram({ id: 'program-mine', name: 'Mine', sourceGroups: [{ platform: 'x', targets: ['researcher'] }], window: { startDate: '2026-01-01', endDate: '2026-01-07' }, budgets: { collectionUsd: .5, aiUsd: 1 } });
  const file = path.join(root, 'state.json'); const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  state.researchRuns = [
    run('run-mine', 'program-mine', '10', [theme('t-mine', 'Agentic checkout')]),
    run('run-theirs', 'program-theirs', '12', [theme('t-theirs', 'Firefly licensing leak')]),
  ];
  fs.writeFileSync(file, JSON.stringify(state));
  const workspace = createContentWorkspace(deps);
  const workbooks = createWorkbookStore({ root: path.join(root, 'workbooks'), contentWorkspace: workspace, activeWorkspaceId: () => workspace.publicState().activeWorkspaceId, clock: () => new Date('2026-10-20T12:00:00Z') });
  return { workspace, workbooks, as: (ids) => { scope = ids ? new Set(ids) : null; } };
}
const names = (history) => history.trends.map((trend) => trend.name).sort();

describe('trend reads follow the caller’s research programs', () => {
  it('gives an admin every program’s trends', () => {
    const h = studio();
    expect(names(h.workspace.readTrendHistory({}))).toEqual(['Agentic checkout', 'Firefly licensing leak']);
    expect(h.workspace.listTrendHistorySources().runs.map((row) => row.runId).sort()).toEqual(['run-mine', 'run-theirs']);
  });

  it('builds history, the digest and the run list from the invited programs only', () => {
    const h = studio(); h.as(['program-mine']);
    const history = h.workspace.readTrendHistory({});
    expect(names(history)).toEqual(['Agentic checkout']);
    expect(JSON.stringify(history)).not.toMatch(/Firefly|run-theirs|t-theirs/);
    expect(JSON.stringify(h.workspace.trendMemory())).not.toMatch(/Firefly/);
    expect(h.workspace.listTrendHistorySources()).toMatchObject({ trendCount: 1, runs: [{ runId: 'run-mine' }] });
    expect(JSON.stringify(h.workspace.readTrendHistorySource())).not.toMatch(/Firefly|run-theirs/);
  });

  it('finds no trend, by id or by name, from a program the caller wasn’t invited to', () => {
    const h = studio(); h.as(['program-mine']);
    expect(h.workspace.readTrendRecord({ name: 'Firefly licensing leak' })).toBeNull();
    expect(h.workspace.readTrendRecord({ trendId: 't-theirs' })).toBeNull();
    expect(h.workspace.readTrendPosts({ themeId: 't-theirs' })).toEqual([]);
    expect(h.workspace.readTrendRecord({ name: 'Agentic checkout' })).toMatchObject({ name: 'Agentic checkout' });
    h.as(null);
    expect(h.workspace.readTrendRecord({ name: 'Firefly licensing leak' })).toMatchObject({ name: 'Firefly licensing leak' });
  });

  it('someone invited to a program with no runs gets an empty history, not everyone’s', () => {
    const h = studio(); h.as(['program-empty']);
    expect(h.workspace.readTrendHistory({}).trends).toEqual([]);
    expect(h.workspace.listTrendHistorySources()).toMatchObject({ trendCount: 0, runs: [] });
  });

  it('opens the Trend tracker with the invited programs’ rows, and only the edits on those rows', async () => {
    const h = studio();
    const whole = await h.workbooks.read({ workbookId: 'trend-tracker' });
    const timeline = whole.sheets[0]; const theirs = timeline.rowKeys[timeline.rows.findIndex((row) => JSON.stringify(row).includes('Firefly'))];
    expect(theirs).toBeTruthy();
    h.workbooks.saveEdits({ workbookId: 'trend-tracker', changes: [{ sheetId: timeline.id, rowKey: theirs, columnKey: timeline.columns[0], value: 'SECRET NOTE', base: null }] });
    h.as(['program-mine']);
    const scoped = await h.workbooks.read({ workbookId: 'trend-tracker' });
    expect(JSON.stringify(scoped)).not.toMatch(/Firefly|SECRET NOTE|run-theirs/);
    expect(JSON.stringify(scoped)).toMatch(/Agentic checkout/);
    h.as(null);
    expect(JSON.stringify(await h.workbooks.read({ workbookId: 'trend-tracker' }))).toMatch(/SECRET NOTE/);
  });
});
