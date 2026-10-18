import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import workspaceModule from '../src/main/content-workspace.js';
import policyModule from '../src/main/workspace-policy.js';

// One-workspace builds (package.json studioWorkspace / STUDIO_WORKSPACE_MODE): one Semrush-edition workspace shown as
// Main; every other workspace hidden (archived), never deleted; reversible by starting in multi mode.
const { createContentWorkspace } = workspaceModule;
const { resolveWorkspacePolicy } = policyModule;
const SINGLE = { mode: 'single', id: 'semrush', editionId: 'semrush', name: 'Main' };
const roots = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const program = (extra = {}) => ({ id: 'program-a', name: 'Weekly research', sourceGroups: [{ platform: 'x', targets: ['researcher'] }], window: { startDate: '2026-09-20', endDate: '2026-09-26' }, budgets: { collectionUsd: 1, aiUsd: 10 }, ...extra });
const daily = { frequency: 'daily', enabled: true, time: '09:00', timeZone: 'UTC', weekday: 1, dayOfMonth: 1, lookbackDays: 1 };
function harness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'single-workspace-test-')); roots.push(root);
  let now = '2026-10-01T12:00:00Z';
  const collect = vi.fn(async () => ({ items: [], receipt: { provider: 'fixture', paid: false, jobCount: 1 } }));
  const runAI = vi.fn(async () => ({ output: { candidates: [] }, receipt: { provider: 'fixture', costUsd: 0, paid: false } }));
  const datasets = [{ id: 'dataset-loose', name: 'Unowned collection', platform: 'x', itemCount: 3, createdAt: '2026-09-01T00:00:00Z' }];
  const make = (workspacePolicy = null) => createContentWorkspace({ root, collect, runAI, clock: () => new Date(now), getDatasets: () => datasets, workspacePolicy });
  const readState = () => JSON.parse(fs.readFileSync(path.join(root, 'state.json'), 'utf8'));
  return { root, make, collect, readState, setTime: (value) => { now = value; } };
}
// A two-workspace studio with a program in each (general's on a schedule), left on the general workspace.
function seeded(h) {
  const multi = h.make();
  multi.saveResearchProgram(program({ id: 'program-general', name: 'General research', workspaceId: 'general', schedule: daily }));
  multi.selectContentWorkspace('semrush');
  multi.saveResearchProgram(program({ id: 'program-semrush', name: 'Semrush research', workspaceId: 'semrush' }));
  multi.selectContentWorkspace('general');
  return multi;
}

describe('workspace policy', () => {
  it('defaults to several workspaces and reads the package field and the environment', () => {
    expect(resolveWorkspacePolicy({ packageConfig: {}, env: {} })).toEqual({ mode: 'multi', id: 'semrush', editionId: 'semrush', name: 'Main' });
    const pkg = { studioDefaultWorkspace: 'semrush', studioWorkspace: { mode: 'single', id: 'semrush', editionId: 'semrush', name: 'Main' } };
    expect(resolveWorkspacePolicy({ packageConfig: pkg, env: {} })).toMatchObject({ mode: 'single', id: 'semrush', name: 'Main' });
    expect(resolveWorkspacePolicy({ packageConfig: pkg, env: { STUDIO_WORKSPACE_MODE: 'multi' } }).mode).toBe('multi');
    expect(resolveWorkspacePolicy({ packageConfig: {}, env: { STUDIO_WORKSPACE_MODE: 'single' } }).mode).toBe('single');
    expect(resolveWorkspacePolicy({ packageConfig: pkg, env: { STUDIO_WORKSPACE_MODE: 'sometimes' } }).mode).toBe('single');
    // The name is cleaned and defaults to Main; a bad id or edition falls back.
    expect(resolveWorkspacePolicy({ packageConfig: pkg, env: { STUDIO_WORKSPACE_NAME: '  Team\u0007 studio  ' } }).name).toBe('Team studio');
    expect(resolveWorkspacePolicy({ packageConfig: pkg, env: { STUDIO_WORKSPACE_NAME: '   ' } }).name).toBe('Main');
    expect(resolveWorkspacePolicy({ packageConfig: pkg, env: { STUDIO_WORKSPACE_NAME: 'x'.repeat(80) } }).name).toHaveLength(60);
    expect(resolveWorkspacePolicy({ packageConfig: { studioDefaultWorkspace: 'general', studioWorkspace: { mode: 'single', id: '../etc', editionId: 'other' } }, env: {} })).toMatchObject({ id: 'general', editionId: 'general' });
    expect(Object.isFrozen(resolveWorkspacePolicy())).toBe(true);
  });

  it('ships the Semrush package as a one-workspace build named Main', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    expect(resolveWorkspacePolicy({ packageConfig: pkg, env: {} })).toMatchObject({ mode: 'single', editionId: 'semrush', name: 'Main' });
  });
});

describe('one-workspace builds', () => {
  it('starts a fresh install with only Main', () => {
    const h = harness(); const api = h.make(SINGLE);
    const state = api.publicState();
    expect(state.workspaces.map(({ id, name, editionId }) => ({ id, name, editionId }))).toEqual([{ id: 'semrush', name: 'Main', editionId: 'semrush' }]);
    expect(state.activeWorkspaceId).toBe('semrush');
    expect(state.workspacePolicy).toEqual({ mode: 'single', name: 'Main', editionId: 'semrush', archived: [] });
    expect(fs.existsSync(path.join(h.root, 'state.before-single-workspace.json'))).toBe(false);
  });

  it('turns an existing studio into Main without deleting anything, once', () => {
    const h = harness(); seeded(h);
    const before = fs.readFileSync(path.join(h.root, 'state.json'), 'utf8');
    const api = h.make(SINGLE);
    const state = api.publicState();
    expect(state.workspaces.map((row) => row.id)).toEqual(['semrush']);
    expect(state.workspaces[0].name).toBe('Main');
    expect(state.activeWorkspaceId).toBe('semrush');
    expect(state.programs.map((row) => row.id)).toEqual(['program-semrush']);
    expect(state.workspacePolicy.archived).toEqual([{ id: 'general', name: 'Your workspace', programs: 1, runs: 0, assets: 0 }]);
    // Everything stays on disk: the hidden workspace, its program, and Main's old name.
    const saved = h.readState();
    expect(saved.workspaces.find((row) => row.id === 'general').archived).toMatchObject({ reason: 'single-workspace' });
    expect(saved.workspaces.find((row) => row.id === 'semrush')).toMatchObject({ name: 'Main', previousName: 'Semrush workspace' });
    expect(saved.programs.map((row) => row.id).sort()).toEqual(['program-general', 'program-semrush']);
    expect(saved.workspacePolicy).toMatchObject({ mode: 'single', mainId: 'semrush', name: 'Main' });
    // The state from before the switch is kept once, private to the owner.
    const backup = path.join(h.root, 'state.before-single-workspace.json');
    expect(fs.readFileSync(backup, 'utf8')).toBe(before);
    if (process.platform !== 'win32') expect(fs.statSync(backup).mode & 0o777).toBe(0o600);
    // A second start changes nothing and leaves the backup alone.
    fs.writeFileSync(backup, 'kept');
    const again = h.make(SINGLE);
    expect(again.publicState().workspaces.map((row) => row.id)).toEqual(['semrush']);
    expect(fs.readFileSync(backup, 'utf8')).toBe('kept');
  });

  it('keeps the Semrush workspace that holds the data when the configured one is empty', () => {
    const h = harness(); const multi = h.make();
    multi.saveContentWorkspace({ name: 'Old Semrush', editionId: 'semrush', knowledge: {}, products: [] });
    const oldId = multi.publicState().activeWorkspaceId;
    multi.saveResearchProgram(program({ id: 'program-old', workspaceId: oldId }));
    const api = h.make(SINGLE);
    const state = api.publicState();
    expect(state.workspaces.map((row) => row.id)).toEqual([oldId]);
    expect(state.workspaces[0].name).toBe('Main');
    expect(state.programs.map((row) => row.id)).toEqual(['program-old']);
    expect(api.workspacePolicy()).toMatchObject({ mode: 'single', mainId: oldId });
  });

  it('refuses another workspace, a new workspace and renaming Main', () => {
    const h = harness(); seeded(h); const api = h.make(SINGLE);
    expect(() => api.selectContentWorkspace('general')).toThrow(expect.objectContaining({ status: 409, code: 'singleWorkspace' }));
    expect(api.selectContentWorkspace('semrush').activeWorkspaceId).toBe('semrush');
    expect(() => api.saveContentWorkspace({ name: 'Another', editionId: 'general', knowledge: {}, products: [] })).toThrow(expect.objectContaining({ status: 409, code: 'singleWorkspace' }));
    const saved = api.saveContentWorkspace({ id: 'semrush', name: 'Renamed', editionId: 'semrush', knowledge: {}, products: [] });
    expect(saved.name).toBe('Main');
    expect(api.publicState().workspaces).toHaveLength(1);
  });

  it('never runs a hidden workspace’s schedule', () => {
    const h = harness(); seeded(h);
    h.setTime('2026-10-03T12:00:00Z'); // the general program's daily run is due
    const api = h.make(SINGLE);
    expect(api.checkDueResearchSchedules()).toEqual([]);
    expect(h.collect).not.toHaveBeenCalled();
  });

  it('imports only its own edition’s setup files, into Main', () => {
    const h = harness(); const multi = seeded(h);
    const generalBundle = multi.exportSetup({ workspaceId: 'general' });
    multi.selectContentWorkspace('semrush');
    const semrushBundle = multi.exportSetup({ workspaceId: 'semrush' });
    const api = h.make(SINGLE);
    expect(() => api.previewSetup({ bundle: generalBundle })).toThrow(/for the general edition\. This studio has one Semrush workspace, Main, so it can’t be imported\. Nothing was imported\./);
    expect(api.previewSetup({ bundle: semrushBundle }).summary).toBeTruthy();
  });

  it('gives unowned saved collections to Main', () => {
    const h = harness(); const api = h.make(SINGLE);
    expect(api.publicState().availableDatasets.map((row) => row.id)).toEqual(['dataset-loose']);
  });

  it('brings every workspace back in multi mode, with Main’s old name and no catch-up runs', () => {
    const h = harness(); seeded(h); h.make(SINGLE);
    h.setTime('2026-10-05T12:00:00Z');
    const multi = h.make();
    const state = multi.publicState();
    expect(state.workspaces.map((row) => row.id).sort()).toEqual(['general', 'semrush']);
    expect(state.workspaces.find((row) => row.id === 'semrush').name).toBe('Semrush workspace');
    expect(state.workspacePolicy).toEqual({ mode: 'multi' });
    const saved = h.readState();
    expect(saved.workspacePolicy).toBeUndefined();
    expect(saved.workspaces.some((row) => row.archived || row.previousName)).toBe(false);
    const revived = saved.programs.find((row) => row.id === 'program-general');
    expect(Date.parse(revived.schedule.nextRunAt)).toBeGreaterThan(Date.parse('2026-10-05T12:00:00Z'));
    expect(multi.checkDueResearchSchedules()).toEqual([]);
  });
});
