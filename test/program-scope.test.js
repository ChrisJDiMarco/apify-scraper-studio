import { describe, expect, it } from 'vitest';
import scope from '../src/main/program-scope.js';
import roles from '../src/main/roles.js';
import fixture from './fixtures/roles-state.js';

// Two programs: Pulse (a research run with a trend, its report run, a channel-asset set and a Create content draft made
// from the report) and Weekly (its own run and report). A draft from a pasted brief belongs to no program.
const studio = {
  activeWorkspaceId: 'w', workspaces: [{ id: 'w', editionId: 'semrush' }],
  programs: [{ id: 'pulse', name: 'Pulse' }, { id: 'weekly', name: 'Weekly' }],
  researchRuns: [
    { id: 'r-pulse', programId: 'pulse', discoveredThemes: [{ id: 't-aio' }], themes: [{ id: 't-aio' }], reportRunIds: [{ themeId: 't-aio', runId: 'c-report' }] },
    { id: 'r-weekly', programId: 'weekly', discoveredThemes: [{ id: 't-local' }], themes: [{ id: 't-local' }] },
  ],
  contentRuns: [
    { id: 'c-report', themeId: 't-aio' }, // listed by r-pulse
    { id: 'c-weekly-report', themeId: 't-local', researchRunId: 'r-weekly' },
    { id: 'c-kit', kit: { reportAssetId: 'a-report', themeId: 't-aio' } },
    { id: 'c-draft', sourceAssetId: 'a-report' },
    { id: 'c-pasted' },
  ],
  assets: [{ id: 'a-report', runId: 'c-report' }, { id: 'a-weekly', runId: 'c-weekly-report' }, { id: 'a-kit', runId: 'c-kit' }, { id: 'a-draft', runId: 'c-draft' }, { id: 'a-pasted', runId: 'c-pasted' }],
  themes: [{ id: 't-aio' }, { id: 't-local' }],
  workflows: [{ id: 'f-pulse', steps: [{ programId: 'pulse' }] }, { id: 'f-weekly', steps: [{ programId: 'weekly' }] }],
  adoptionsByTheme: { 't-aio': { blog: {} }, 't-local': { blog: {} } },
};

describe('which program work belongs to', () => {
  it('follows a file and a run back to its research program', () => {
    const index = scope.indexStudio(studio);
    expect(['r-pulse', 'c-report', 'c-kit', 'c-draft', 'c-weekly-report', 'c-pasted'].map(index.ofRun)).toEqual(['pulse', 'pulse', 'pulse', 'pulse', 'weekly', '']);
    expect(['a-report', 'a-kit', 'a-draft', 'a-weekly', 'a-pasted', 'a-gone'].map(index.ofAsset)).toEqual(['pulse', 'pulse', 'pulse', 'weekly', '', '']);
    expect(index.ofTheme('t-aio')).toEqual(['pulse']);
  });

  it('gives everyone every program until programs are chosen, and admins always', () => {
    expect(scope.scopeOf({ base: 'editor' })).toBeNull();
    expect(scope.scopeOf({ base: 'admin', programIds: ['weekly'] })).toBeNull();
    expect([...scope.scopeOf({ base: 'editor', programIds: ['weekly'] })]).toEqual(['weekly']);
  });
});

describe('a person invited to Weekly only', () => {
  const weekly = new Set(['weekly']);

  it('receives Weekly’s work and work of no program, and nothing of Pulse', () => {
    const seen = scope.scopeStudio(studio, weekly);
    expect(seen.programs.map((row) => row.id)).toEqual(['weekly']);
    expect(seen.researchRuns.map((row) => row.id)).toEqual(['r-weekly']);
    expect(seen.contentRuns.map((row) => row.id)).toEqual(['c-weekly-report', 'c-pasted']);
    expect(seen.assets.map((row) => row.id)).toEqual(['a-weekly', 'a-pasted']);
    expect(seen.themes.map((row) => row.id)).toEqual(['t-local']);
    expect(seen.workflows.map((row) => row.id)).toEqual(['f-weekly']);
    expect(Object.keys(seen.adoptionsByTheme)).toEqual(['t-local']);
  });

  it('can’t name Pulse’s run, file, trend or program in a call', () => {
    const index = scope.indexStudio(studio);
    for (const payload of [{ programId: 'pulse' }, { runId: 'r-pulse' }, { runId: 'c-kit' }, { assetId: 'a-report' }, { source: { kind: 'report', assetId: 'a-draft' } }, { themeId: 't-aio' }, { workbookId: 'r-pulse' }, 'a-report']) {
      expect(scope.outOfScope(index, payload, weekly), JSON.stringify(payload)).toBe(true);
    }
    for (const payload of [{ programId: 'weekly' }, { runId: 'r-weekly' }, { assetId: 'a-weekly' }, { assetId: 'a-pasted' }, { themeId: 't-local' }, {}, 'a-weekly']) {
      expect(scope.outOfScope(index, payload, weekly), JSON.stringify(payload)).toBe(false);
    }
  });

  it('gets lists that span programs without Pulse’s rows', () => {
    const index = scope.indexStudio(studio);
    expect(scope.scopeResult([{ id: 'r-pulse', programId: 'pulse' }, { id: 'r-weekly', programId: 'weekly' }, { id: 'dataset' }], index, weekly).map((row) => row.id)).toEqual(['r-weekly', 'dataset']);
    expect(scope.scopeResult({ asOf: 'x', trends: [{ name: 'AIO', programIds: ['pulse'] }, { name: 'Local', programIds: ['weekly', 'pulse'] }] }, index, weekly).trends.map((row) => row.name)).toEqual(['Local']);
    expect(scope.scopeResult({ items: [{ runId: 'r-pulse' }, { runId: 'r-weekly' }] }, index, weekly).items).toEqual([{ runId: 'r-weekly' }]);
  });
});

describe('the projection sends each person only their programs', () => {
  const admins = [{ id: 'member-chris', name: 'Chris' }];
  const view = (identity, access, viewAs = null, previewMember = null) => {
    const viewer = roles.buildViewer({ identity, session: { viewAs }, prefs: {}, editionId: 'semrush', web: true, admins, access, previewMember });
    return roles.projectState(fixture.baseState(), viewer, { adoptions: fixture.adoptions(), admins, memberCount: 5, editionId: 'semrush' });
  };
  const riley = { id: 'member-riley', name: 'Riley', email: 'riley@semrush.com', role: 'editor', channelId: null, via: 'link' };
  const chris = { id: 'local', name: 'Chris', email: '', role: 'admin', channelId: null, via: 'desktop' };
  const programsIn = (state) => state.contentStudio.programs.map((row) => row.id);

  it('narrows an editor to their programs and leaves admins with all of them', () => {
    expect(programsIn(view(chris, null))).toEqual(['program-pulse']);
    // Invited to Pulse: Pulse's work arrives.
    const pulse = view(riley, { grants: [], denies: [], programIds: ['program-pulse'] });
    expect(pulse.viewer.programIds).toEqual(['program-pulse']);
    expect(programsIn(pulse)).toEqual(['program-pulse']);
    expect(pulse.contentStudio.researchRuns.length).toBeGreaterThan(0);
    // Invited to another program only: none of Pulse's runs, reports, sets or trends.
    const other = view(riley, { grants: [], denies: [], programIds: ['program-other'] });
    expect(programsIn(other)).toEqual([]);
    expect(other.contentStudio.researchRuns).toEqual([]);
    expect(other.contentStudio.contentRuns.filter((run) => run.themeId || run.kit)).toEqual([]);
    expect(other.contentStudio.assets.map((asset) => asset.deliverableId)).not.toContain('evidence-report');
    expect(Object.keys(other.contentStudio.adoptionsByTheme)).toEqual([]);
    // Nothing chosen: every program. An admin always sees every program, whatever is stored.
    expect(programsIn(view(riley, { grants: [], denies: [] }))).toEqual(['program-pulse']);
    expect(view(chris, { grants: [], denies: [], programIds: ['program-other'] }).viewer.programIds).toBeUndefined();
  });

  it('previews one person with their programs', () => {
    const state = view(chris, null, { memberId: 'member-riley' }, { ...riley, grants: [], denies: [], programIds: ['program-other'] });
    expect(state.viewer.preview).toBe(true);
    expect(programsIn(state)).toEqual([]);
  });
});
