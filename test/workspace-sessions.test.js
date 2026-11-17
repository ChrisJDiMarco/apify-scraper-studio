import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import teams from '../src/main/team-store.js';
import workspaces from '../src/main/content-workspace.js';
import accessModule from '../src/main/access.js';
import webRuntime from '../src/main/web-runtime.js';

const roots = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const owner = { id: 'owner', name: 'Alex', role: 'admin', via: 'password' };
function harness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-workspace-sessions-')); roots.push(root);
  const calls = new AsyncLocalStorage();
  const workspace = workspaces.createContentWorkspace({ root, runAI: async () => { throw new Error('No paid work in this test'); }, defaultWorkspaceId: 'semrush', getWorkspaceId: () => calls.getStore()?.workspaceId || '' });
  const team = teams.createTeamStore({ root, defaultWorkspaceId: 'semrush', workspaceId: () => calls.getStore()?.workspaceId || workspace.activeWorkspaceId() });
  const access = accessModule.createAccess({ teamStore: team, workspace, web: true, currentCall: () => calls.getStore() });
  function rpc(identity, session, method, payload) {
    return calls.run({ user: identity, session, workspaceId: session.workspaceId || '' }, () => {
      const viewer = access.currentViewer(); const input = access.check(method, payload, viewer);
      if (method === 'selectContentWorkspace') return access.selectWorkspace(input);
      if (method === 'state') return access.project({ contentStudio: workspace.publicState() }, viewer);
      return workspace.withWorkspace(viewer.workspaceId, () => {
        if (method === 'saveMember') return team.saveMember(input, identity);
        if (method === 'saveWorkspaceMembership') return team.assignWorkspaceMember(input, identity);
        return workspace[method](input);
      });
    });
  }
  return { workspace, team, access, calls, rpc };
}

describe('workspace sessions and access', () => {
  it('keeps two sessions separate and requires explicit membership in a new workspace', () => {
    const h = harness(); const a = { workspaceId: 'semrush' }; const b = { workspaceId: 'semrush' };
    const member = h.rpc(owner, a, 'saveMember', { name: 'Sam', email: 'sam@example.com', role: 'admin' });
    const adobe = h.rpc(owner, a, 'saveContentWorkspace', { name: 'Adobe', editionId: 'general' });
    h.rpc(owner, b, 'selectContentWorkspace', adobe.id);
    expect(a.workspaceId).toBe('semrush');
    expect(h.rpc(owner, a, 'state').contentStudio.activeWorkspaceId).toBe('semrush');
    expect(h.rpc(owner, b, 'state').contentStudio.activeWorkspaceId).toBe(adobe.id);
    const identity = h.team.identityFor(h.team.globalMemberById(member.id));
    const session = { workspaceId: 'semrush' };
    expect(h.rpc(identity, session, 'state').viewer.isSuperAdmin).toBe(false);
    expect(h.rpc(identity, session, 'state').viewer.allowed).not.toContain('createSignInLink');
    expect(() => h.rpc(identity, session, 'createSignInLink', { id: member.id })).toThrow(/Super Admin/);
    expect(() => h.rpc(identity, session, 'revokeSignInLink', { id: member.id })).toThrow(/Super Admin/);
    expect(h.rpc(identity, session, 'state').contentStudio.workspaces.map((row) => row.id)).toEqual(['semrush']);
    expect(() => h.rpc(identity, session, 'selectContentWorkspace', adobe.id)).toThrow();
    expect(() => h.rpc(identity, session, 'saveContentWorkspace', { name: 'Unauthorized' })).toThrow(/Super Admin/);
    expect(() => h.rpc(identity, session, 'saveWorkspaceMembership', { memberId: member.id, workspaceId: adobe.id, role: 'admin' })).toThrow(/Super Admin/);
    h.rpc(owner, a, 'saveWorkspaceMembership', { memberId: member.id, workspaceId: adobe.id, role: 'channel', channelId: 'social' });
    h.rpc(identity, session, 'selectContentWorkspace', adobe.id);
    const state = h.rpc(identity, session, 'state');
    expect(state.viewer).toMatchObject({ workspaceId: adobe.id, role: 'channel', channelId: 'social' });
    expect(() => h.rpc(identity, session, 'saveContentWorkspace', { id: 'semrush', name: 'Cross-workspace overwrite' })).toThrow();
  });

  it('holds a request workspace across an await even when that same session switches', async () => {
    const session = { workspaceId: 'semrush' };
    let resume; const waiting = new Promise((resolve) => { resume = resolve; });
    webRuntime.electron.ipcMain.handle('test:workspace-snapshot', async () => {
      expect(webRuntime.currentCall().workspaceId).toBe('semrush');
      await waiting;
      return webRuntime.currentCall().workspaceId;
    });
    const pending = webRuntime.invoke('test:workspace-snapshot', {}, { user: owner, session });
    session.workspaceId = 'adobe'; resume();
    expect((await pending).result).toBe('semrush');
  });

  it('imports setup only into the selected workspace and does not move the global default', () => {
    const h = harness(); const session = { workspaceId: 'semrush' };
    const adobe = h.rpc(owner, session, 'saveContentWorkspace', { name: 'Adobe', editionId: 'general' });
    const bundle = h.workspace.withWorkspace('general', () => h.workspace.exportSetup());
    bundle.workspace.knowledge.name = 'Adobe Firefly';
    const result = h.workspace.withWorkspace(adobe.id, () => h.workspace.importSetup({ bundle }));
    expect(result.workspaceId).toBe(adobe.id);
    expect(h.workspace.defaultWorkspaceId()).toBe('semrush');
    expect(h.workspace.withWorkspace('general', () => h.workspace.exportSetup()).workspace.knowledge.name).not.toBe('Adobe Firefly');
    const semrush = h.workspace.withWorkspace('semrush', () => h.workspace.exportSetup());
    expect(() => h.workspace.withWorkspace(adobe.id, () => h.workspace.previewSetup({ bundle: semrush }))).toThrow(/Switch to a .*workspace/);
  });

  it('merges tour completion by workspace and role without dropping another tour', () => {
    const h = harness(); const at = '2026-11-17T12:00:00.000Z';
    h.team.setPrefs('owner', { workspaceTours: { 'semrush:superadmin': at } });
    h.team.setPrefs('owner', { workspaceTours: { 'adobe:channel': at } });
    expect(h.team.prefsFor('owner').workspaceTours).toEqual({ 'semrush:superadmin': at, 'adobe:channel': at });
  });
});
