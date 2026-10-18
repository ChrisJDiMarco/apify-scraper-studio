import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import workspaceModule from '../src/main/content-workspace.js';

// decideResearchTheme's internal second argument (src/main/content-workspace.js): only the Monday.com sync passes it.
// The studio:* RPC handler passes the payload alone, so a `by` inside the payload is never believed.
const { createContentWorkspace } = workspaceModule;
const roots = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'monday-decisions-')); roots.push(root);
  const theme = (id) => ({ id, name: `Trend ${id}`, description: 'Described.', evidenceIds: ['e1'], platforms: ['x'] });
  fs.writeFileSync(path.join(root, 'state.json'), JSON.stringify({ version: 1, activeWorkspaceId: 'general', workspaces: [{ id: 'general', name: 'Your workspace', editionId: 'general', knowledge: {}, products: [], createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' }], programs: [], researchRuns: [{ id: 'run-a', type: 'research', workspaceId: 'general', programId: '', title: 'Pulse', status: 'awaiting-review', createdAt: '2026-10-10T00:00:00Z', discoveredThemes: [theme('t1'), theme('t2')], themes: [theme('t1'), theme('t2')], decisions: {}, decisionsBy: {} }], contentRuns: [], themes: [], history: [], detections: [], assets: [], exports: [], datasetOwners: {} }));
  return createContentWorkspace({ root, runAI: async () => ({}), actor: () => ({ id: 'member-eli', name: 'Eli Editor' }) });
}

describe('decisions from Monday.com', () => {
  it('never takes `by` from the payload, and records the Monday actor only through the internal argument', () => {
    const api = workspace();
    const spoofed = api.decideResearchTheme({ runId: 'run-a', themeId: 't1', decision: 'approved', by: { id: 'someone-else', name: 'Spoofed' }, via: 'monday' });
    expect(spoofed.decisionsBy.t1).toMatchObject({ id: 'member-eli', name: 'Eli Editor' });
    expect(spoofed.decisionsBy.t1.via).toBeUndefined();
    const fromMonday = api.decideResearchTheme({ runId: 'run-a', themeId: 't2', decision: 'passed' }, { by: { id: 'monday:55', name: 'Dana Lee (Monday.com)' }, via: 'monday', workspaceId: 'general' });
    expect(fromMonday.decisionsBy.t2).toMatchObject({ id: 'monday:55', name: 'Dana Lee (Monday.com)', via: 'monday' });
    expect(fromMonday.decisions).toEqual({ t1: 'approved', t2: 'passed' });
  });

  it('builds the Monday cards’ source for a workspace without touching the runs', () => {
    const api = workspace();
    const source = api.boardSource('general');
    expect(source.researchRuns.map((run) => run.id)).toEqual(['run-a']);
    expect(source).toMatchObject({ editionId: 'general', docLinks: {} });
  });
});

describe('who may decide from Monday.com', () => {
  it('allows a member’s Yes or Skip only when their role may decide trends', async () => {
    const { createAccess } = (await import('../src/main/access.js')).default;
    const team = { prefsFor: () => ({}), admins: () => [], logEvent: () => {} };
    const access = createAccess({ teamStore: team, workspace: { activeEditionId: () => 'general' }, web: true });
    const person = (role, extra = {}) => ({ id: `m-${role}`, name: role, email: `${role}@example.com`, role, channelId: role === 'channel' ? 'blog' : null, via: 'monday', disabled: false, ...extra });
    expect(access.allows(person('editor'), 'decideResearchTheme')).toBe(true);
    expect(access.allows(person('admin'), 'decideResearchTheme')).toBe(true);
    expect(access.allows(person('channel'), 'decideResearchTheme')).toBe(false);
    expect(access.allows(person('editor', { disabled: true }), 'decideResearchTheme')).toBe(false);
    expect(access.allows(null, 'decideResearchTheme')).toBe(false);
  });
});
