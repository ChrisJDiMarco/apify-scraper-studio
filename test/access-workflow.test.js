import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import accessModule from '../src/main/access.js';
import teamStoreModule from '../src/main/team-store.js';
import roles from '../src/main/roles.js';

const { createAccess } = accessModule;
const { createTeamStore } = teamStoreModule;
const roots = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const ADMIN = { id: 'owner', name: 'Studio admin', via: 'password' };
const workspace = { activeEditionId: () => 'semrush', activeWorkspace: () => ({ id: 'semrush', name: 'Main', editionId: 'semrush' }), workspaceById: () => ({ id: 'semrush', editionId: 'semrush' }), picturesReady: () => true };

function team() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'access-workflow-')); roots.push(root);
  const store = createTeamStore({ root });
  const access = createAccess({ teamStore: store, workspace, web: true, currentCall: () => null });
  return { store, access };
}

describe('a workflow owner’s access (canIdentityCall)', () => {
  it('treats the Mac’s person and the web admin password as admins', () => {
    const { access } = team();
    expect(access.canIdentityCall('local', 'createAssetKit')).toBe(true);
    expect(access.canIdentityCall('owner', 'approveWorkflowBudget')).toBe(true);
  });
  it('follows the member’s role and own access, and refuses removed or paused members', () => {
    const { store, access } = team();
    const admin = store.saveMember({ name: 'Pat Admin', email: 'pat@example.com', role: 'admin' }, ADMIN);
    const editor = store.saveMember({ name: 'Riley Editor', email: 'riley@example.com', role: 'editor' }, ADMIN);
    expect(access.canIdentityCall(admin.id, 'approveWorkflowBudget')).toBe(true);
    const editorId = editor.id;
    for (const method of ['startResearchRun', 'decideResearchTheme', 'approveResearchThemes', 'continueResearchRun', 'createAssetKit', 'runWorkflow']) expect(access.canIdentityCall(editorId, method)).toBe(true);
    expect(access.canIdentityCall(editorId, 'approveWorkflowBudget')).toBe(false);
    // Taking away Make channel assets (and Build and run workflows, which needs it) stops their workflows at that step.
    store.saveMemberAccess({ id: editorId, grants: [], denies: ['manageWorkflows', 'makeAssets'] }, ADMIN);
    expect(access.canIdentityCall(editorId, 'createAssetKit')).toBe(false);
    expect(access.canIdentityCall(editorId, 'startResearchRun')).toBe(true);
    store.saveMember({ id: editorId, disabled: true }, ADMIN);
    expect(access.canIdentityCall(editorId, 'startResearchRun')).toBe(false);
    const sam = store.saveMember({ name: 'Sam Editor', email: 'sam@example.com', role: 'editor' }, ADMIN);
    expect(access.canIdentityCall(sam.id, 'startResearchRun')).toBe(true);
    store.removeMember(sam.id, ADMIN);
    expect(access.canIdentityCall(sam.id, 'startResearchRun')).toBe(false);
    expect(access.canIdentityCall('member-nobody', 'startResearchRun')).toBe(false);
  });
});

describe('workflows in the state each person receives', () => {
  const base = { contentStudio: { activeWorkspaceId: 'semrush', workspaces: [{ id: 'semrush', editionId: 'semrush' }], workflows: [{ id: 'workflow-a', name: 'Weekly SEO watch', budget: { perRunUsd: 40, perMonthUsd: 200 }, monthSpentUsd: 12 }], workflowRuns: [{ id: 'wfrun-a', workflowId: 'workflow-a', capUsd: 40, committedUsd: 11, spentUsd: 3.2, message: 'Needs a bigger budget: the next step can cost up to $9.00.' }], playbooks: [{ id: 'team-a' }], workflowSummary: { active: 1, paused: 0, drafts: 0, waiting: 1, monthSpentUsd: 12, monthCapUsd: 200 } } };
  const viewer = (capabilities) => ({ id: 'member-x', role: 'editor', base: 'editor', capabilities, allowed: [] });
  it('keeps workflows for people who can see them, without money for people who can’t see costs', () => {
    const full = roles.projectState(base, viewer(['core', 'readResearch', 'readWorkflows', 'seeCosts']));
    expect(full.contentStudio.workflows[0].budget.perRunUsd).toBe(40);
    const noMoney = roles.projectState(base, viewer(['core', 'readResearch', 'readWorkflows']));
    expect(noMoney.contentStudio.workflows[0]).toEqual({ id: 'workflow-a', name: 'Weekly SEO watch', budget: {} });
    expect(noMoney.contentStudio.workflowRuns[0]).toEqual({ id: 'wfrun-a', workflowId: 'workflow-a', message: 'This run’s budget needs attention. Ask someone who can see costs to raise it; finished steps are kept.' });
    expect(noMoney.contentStudio.workflowSummary).toEqual({ active: 1, paused: 0, drafts: 0, waiting: 1 });
  });
  it('empties them for a role without “See workflows and playbooks”', () => {
    const none = roles.projectState(base, viewer(['core', 'readResearch', 'seeCosts']));
    expect(none.contentStudio).toMatchObject({ workflows: [], workflowRuns: [], playbooks: [], workflowSummary: { active: 0, paused: 0, drafts: 0, waiting: 0 } });
  });
});
