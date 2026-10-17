// @vitest-environment jsdom
import React from 'react';
import { createRequire } from 'node:module';
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AI_ACTION_METHOD, aiActionAllowed, aiRequest, useStudioActions } from '../src/renderer/src/studio-actions.js';

// The one list of Ask AI's buttons (src/shared/ask-actions.json): the server's prompt and reply cleaner read it, and so
// does the renderer that runs each button. These checks keep the two sides, the API and the role policy in step.
const require = createRequire(import.meta.url);
const ASK = require('../src/shared/ask-actions.json');
const { methods: API_METHODS } = require('../src/shared/studio-api-channels.json');
const ROLES = require('../src/shared/roles.json');
const help = require('../src/main/help-assistant.js');
const kinds = Object.keys(ASK.actions);
const TYPES = ['text', 'enum', 'names', 'channels', 'channel', 'date', 'url', 'emails', 'int', 'bool', 'role'];

describe('the Ask AI action catalog', () => {
  it('lists every kind with what the prompt, the cleaner and the runner need', () => {
    for (const [kind, row] of Object.entries(ASK.actions)) {
      expect(row.prompt, kind).toMatch(/^target = /);
      expect(Object.keys(ASK.targets), kind).toContain(row.target);
      expect(['none', 'dialog', 'estimate', 'handoff', 'card'], kind).toContain(row.confirm);
      expect(['always', 'params', 'never'], kind).toContain(row.form);
      expect(row.layouts, kind).toEqual(['simple', 'classic']);
      expect(typeof row.spends, kind).toBe('boolean');
      expect(typeof row.destructive, kind).toBe('boolean');
      for (const type of Object.values(row.params)) expect(TYPES, `${kind}: ${type}`).toContain(String(type).split(':')[0]);
      // Paid work always confirms with a cost (an estimate, its card, or a dialog elsewhere); destructive work asks first.
      if (row.spends) expect(['estimate', 'card', 'handoff'], kind).toContain(row.confirm);
      if (row.destructive) expect(row.confirm, kind).toBe('dialog');
    }
    for (const [from, alias] of Object.entries(ASK.aliases)) { expect(kinds, from).not.toContain(from); expect(kinds, from).toContain(alias.kind); }
  });
  it('names only real methods, each in exactly one capability, and nothing a person must do themselves', () => {
    const capabilityOf = (method) => ROLES.capabilities.filter((cap) => cap.methods.includes(method)).map((cap) => cap.id);
    for (const [kind, row] of Object.entries(ASK.actions)) for (const method of row.methods) {
      expect(Object.keys(API_METHODS), `${kind}: ${method}`).toContain(method);
      expect(capabilityOf(method), `${kind}: ${method}`).toHaveLength(1);
    }
    // Never offered (SPEC: Ask AI never saves keys, deletes for good, switches workspace, removes people or changes access).
    const never = ['saveKey', 'clearKey', 'removeMember', 'deleteRole', 'deleteReferenceDoc', 'removeWorkbook', 'deleteRecipe', 'selectContentWorkspace', 'applySetup', 'saveRolePolicy', 'saveMemberAccess', 'saveMember'];
    for (const row of Object.values(ASK.actions)) for (const method of row.methods) expect(never).not.toContain(method);
  });
  it('is the renderer’s list too: every kind has a runner and the same methods', () => {
    const { result } = renderHook(() => useStudioActions({ api: {}, state: {}, viewer: { preview: false }, can: () => true, canRun: () => true, confirm: async () => true }));
    expect(Object.keys(result.current.executors).sort()).toEqual([...kinds].sort());
    for (const kind of kinds) expect(AI_ACTION_METHOD[kind]).toEqual(ASK.actions[kind].methods);
    expect(aiRequest({ kind: 'open-report', target: 'X' })).toMatchObject({ kind: 'open', params: { type: 'report' } });
    expect(aiRequest({ kind: 'approve-all-trends' }).kind).toBe('approve-trends');
  });
  it('gates a button on every method it calls, the same way on both sides', () => {
    const allowed = ['askHelp', 'approveResearchThemes', 'decideResearchTheme', 'readStudioAsset'];
    const offered = Object.keys(help.actionsFor(help.promptRights(), help.reachOf({ allowed }), 'editor'));
    // Write reports needs Start research's continueResearchRun too, so an editor without it is never offered the button.
    expect(offered).not.toContain('write-reports');
    expect(offered).toEqual(expect.arrayContaining(['approve-trend', 'pass-trend', 'approve-trends', 'open', 'copy', 'ask']));
    expect(aiActionAllowed('write-reports', (method) => allowed.includes(method))).toBe(false);
    expect(aiActionAllowed('approve-trend', (method) => allowed.includes(method))).toBe(true);
    // Kinds that also need a Prompt Library right or a connection are left out on the server until those are there.
    for (const kind of kinds) expect(aiActionAllowed(kind, (method) => allowed.includes(method)) && !ASK.actions[kind].needs, kind).toBe(offered.includes(kind));
  });
  it('keeps admin-only buttons from editors even when the caller passes no access', () => {
    const editor = Object.keys(help.actionsFor(help.promptRights(), help.reachOf(), 'editor'));
    for (const kind of ['invite-people', 'view-as', 'lock-prompt', 'draft-program', 'mark-used']) expect(editor).not.toContain(kind);
    const admin = Object.keys(help.actionsFor(help.promptRights({ view: true, edit: true, admin: true }), help.reachOf({ drive: true }), 'admin'));
    expect(admin).toEqual(expect.arrayContaining(['invite-people', 'view-as', 'lock-prompt', 'draft-program', 'mark-used', 'publish-docs', 'edit-prompt']));
    expect(Object.keys(help.actionsFor(help.promptRights(), help.reachOf(), 'admin'))).not.toContain('publish-docs'); // Drive not connected
    void React;
  });
});
