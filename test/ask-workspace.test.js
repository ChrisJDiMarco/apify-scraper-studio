import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import askStoreModule from '../src/main/ask-store.js';
import askProgressModule from '../src/main/ask-progress.js';
const roots = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const turn = (workspaceId, answer) => ({ workspaceId, user: { content: 'Same question', requestId: 'same-request-id' }, assistant: { content: answer } });
function harness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ask-workspace-')); roots.push(root);
  let selected = 'semrush';
  return { store: askStoreModule.createAskStore({ root, getWorkspaceId: () => selected, legacyWorkspaceId: 'semrush' }), select: id => { selected = id; } };
}

it('scopes conversation reads, mutation and request reuse to the selected workspace', () => {
  const h = harness(); const first = h.store.appendTurn('member-riley', turn('semrush', 'Private Semrush answer'));
  h.select('adobe');
  expect(h.store.listConversations('member-riley')).toEqual([]);
  expect(h.store.readConversation('member-riley', first.conversation.id)).toBeNull();
  expect(h.store.findByRequest('member-riley', 'same-request-id')).toBeNull();
  expect(() => h.store.renameConversation('member-riley', { conversationId: first.conversation.id, title: 'Changed' })).toThrow(/available/);
  expect(() => h.store.deleteConversation('member-riley', first.conversation.id)).toThrow(/available/);
  const second = h.store.appendTurn('member-riley', turn('adobe', 'Private Adobe answer'));
  expect(h.store.findByRequest('member-riley', 'same-request-id').message.content).toBe('Private Adobe answer');
  h.select('semrush');
  expect(h.store.findByRequest('member-riley', 'same-request-id').message.content).toBe('Private Semrush answer');
  expect(h.store.readConversation('member-riley', second.conversation.id)).toBeNull();
});

it('keeps personal memory, updates and forgetting within its originating workspace', () => {
  const h = harness();
  const memory = h.store.saveMemory('member-riley', { text: 'Use the Semrush editorial voice.', scope: 'me' }, { workspaceId: 'semrush' });
  h.select('adobe');
  expect(h.store.listMemory('member-riley', { workspaceId: 'adobe' })).toEqual([]);
  expect(h.store.recall('member-riley', { workspaceId: 'adobe', query: 'editorial voice' })).toEqual([]);
  expect(() => h.store.saveMemory('member-riley', { id: memory.id, text: 'Changed' }, { workspaceId: 'adobe' })).toThrow(/anymore/);
  expect(() => h.store.forgetMemory('member-riley', memory.id)).toThrow(/anymore/);
  h.store.saveMemory('member-riley', { text: 'Use the Adobe visual style.', scope: 'me' }, { workspaceId: 'adobe' });
  h.select('semrush');
  expect(h.store.listMemory('member-riley').map(item => item.text)).toEqual(['Use the Semrush editorial voice.']);
});

it('keeps simultaneous progress records with the same request ID separate by workspace', () => {
  let workspaceId = 'semrush';
  const progress = askProgressModule.createAskProgress({ getWorkspaceId: () => workspaceId });
  progress.begin({ identityId: 'member-riley', requestId: 'same-id', question: 'Private Semrush question' });
  workspaceId = 'adobe';
  expect(progress.snapshot('member-riley', 'same-id')).toBeNull();
  expect(progress.active('member-riley')).toEqual([]);
  progress.begin({ identityId: 'member-riley', requestId: 'same-id', question: 'Private Adobe question' });
  expect(progress.snapshot('member-riley', 'same-id').question).toBe('Private Adobe question');
  workspaceId = 'semrush';
  expect(progress.snapshot('member-riley', 'same-id').question).toBe('Private Semrush question');
});
