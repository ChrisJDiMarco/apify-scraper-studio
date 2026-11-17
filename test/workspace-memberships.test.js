import { describe, it, expect } from 'vitest';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createTeamStore } = require('../src/main/team-store');

describe('workspace memberships', () => {
  it('reenables a paused membership for global sign-in without enabling another workspace', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-memberships-'));
    const store = createTeamStore({ root, defaultWorkspaceId: 'semrush', workspaceId: () => 'semrush' });
    const owner = { via: 'desktop' };
    const member = store.saveMember({ name: 'Jordan', email: 'jordan@example.com', role: 'editor', disabled: true }, owner);
    expect(store.memberForSignIn(member.email)).toBeNull();
    store.saveMember({ id: member.id, disabled: false }, owner);
    expect(store.memberForSignIn(member.email)).toMatchObject({ id: member.id });
    expect(store.memberWorkspaces(member.id).map((entry) => entry.workspaceId)).toEqual(['semrush']);
    expect(store.issueEmailLink(member.id).token).toMatch(/^[a-f0-9]{64}$/);
    fs.rmSync(root, { recursive: true, force: true });
  });
  it('reuses a global account with independent roles, removal and persistence', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-memberships-'));
    let current = 'semrush';
    const options = { root, defaultWorkspaceId: 'semrush', workspaceId: () => current };
    const store = createTeamStore(options);
    const owner = { id: 'local', name: 'Alex', via: 'desktop' };
    const member = store.saveMember({ name: 'Riley', email: 'riley@example.com', role: 'admin' }, owner);
    current = 'adobe';
    expect(store.listMembers()).toEqual([]);
    store.assignWorkspaceMember({ memberId: member.id, workspaceId: 'adobe', role: 'channel', channelId: 'social' }, owner);
    expect(store.listMembers()[0]).toMatchObject({ id: member.id, role: 'channel', channelId: 'social' });
    current = 'semrush';
    expect(store.memberById(member.id).role).toBe('admin');
    current = 'adobe';
    store.removeMember(member.id, owner);
    expect(store.listMembers()).toEqual([]);
    current = 'semrush';
    const reopened = createTeamStore(options);
    expect(reopened.memberById(member.id).role).toBe('admin');
    expect(reopened.directory()[0]).toMatchObject({ id: member.id, email: 'riley@example.com' });
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('requires Super Admin authority to assign an existing account', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-memberships-'));
    const store = createTeamStore({ root, defaultWorkspaceId: 'semrush', workspaceId: () => 'semrush' });
    const member = store.saveMember({ name: 'Sam', email: 'sam@example.com', role: 'editor' }, { via: 'desktop' });
    expect(() => store.assignWorkspaceMember({ memberId: member.id, workspaceId: 'adobe', role: 'admin' }, { id: 'other', role: 'admin', via: 'link' })).toThrow(/Super Admin/);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
