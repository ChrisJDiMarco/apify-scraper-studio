import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import askStoreModule from '../src/main/ask-store.js';
const { createAskStore, askHistory, looksSecret, MAX_ACTIVE_MEMORY, MAX_CONVERSATIONS, MAX_MESSAGES, HISTORY_TURNS } = askStoreModule;
const roots = [];
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
// Every write fsyncs the file and its folder (about 25 ms a turn on a Mac). The cap tests write hundreds of times to check
// what is kept, not durability, so they skip the fsyncs; the atomic-write test above keeps them.
const skipFsync = () => vi.spyOn(fs, 'fsyncSync').mockImplementation(() => {});

const ALEX = 'member-11111111-1111-4111-8111-111111111111';
const SAM = 'guest:sam@example.com';
const DAY = 86400000;
function harness({ start = '2026-10-16T09:00:00.000Z' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ask-store-')); roots.push(root);
  const clock = { ms: Date.parse(start) };
  const store = createAskStore({ root, now: () => new Date(clock.ms) });
  const folder = (identityId) => path.join(root, crypto.createHash('sha256').update(identityId).digest('hex').slice(0, 32));
  return { root, clock, store, folder, advance: (ms) => { clock.ms += ms; } };
}
const turn = (question, extra = {}) => ({ workspaceId: 'general', user: { content: question, page: { layout: 'simple', tab: 'home' }, requestId: `req-${crypto.randomUUID()}` }, assistant: { content: `Answer to ${question}`, pages: [], followUps: [], actions: [], show: null, image: null, cards: [], read: [], receipt: { costUsd: 0.01, model: 'claude-opus-5-5', route: 'claude' } }, ...extra });

describe('conversations', () => {
  it('keeps each person in a hashed folder of their own, written atomically', () => {
    const h = harness();
    const first = h.store.appendTurn(ALEX, turn('How do I start a research run?'));
    expect(first.conversation.id).toMatch(/^ask-[0-9a-f-]{36}$/);
    expect(first.userMessage.id).toMatch(/^msg-[0-9a-f-]{36}$/);
    expect(first.message).toMatchObject({ role: 'assistant', content: 'Answer to How do I start a research run?', remembered: [] });
    const files = fs.readdirSync(h.folder(ALEX));
    expect(files.sort()).toEqual(['c', 'index.json']);
    expect(fs.readdirSync(path.join(h.folder(ALEX), 'c'))).toEqual([`${first.conversation.id}.json`]);
    expect(fs.statSync(path.join(h.folder(ALEX), 'index.json')).mode & 0o777).toBe(0o600);
    expect(fs.readdirSync(h.folder(ALEX)).some((name) => name.endsWith('.tmp'))).toBe(false);
    // Another person sees nothing, and can't read it by id.
    expect(h.store.listConversations(SAM)).toEqual([]);
    expect(h.store.readConversation(SAM, first.conversation.id)).toBeNull();
    expect(h.store.listConversations(ALEX)).toEqual([expect.objectContaining({ id: first.conversation.id, title: 'How do I start a research run?', workspaceId: 'general', messageCount: 2, pinned: false })]);
  });

  it('titles a conversation from its first question unless the model suggests one, and never overrides a rename', () => {
    const h = harness();
    const long = h.store.appendTurn(ALEX, turn('Can you tell me what changed in the AI Overviews trend since the last research run and why it matters?'));
    expect(long.conversation.title.length).toBeLessThanOrEqual(60);
    expect(long.conversation.title.endsWith('…')).toBe(true);
    const named = h.store.appendTurn(ALEX, turn('What is new?', { title: 'New trends this week' }));
    expect(named.conversation.title).toBe('New trends this week');
    h.store.renameConversation(ALEX, { conversationId: named.conversation.id, title: 'Riley’s questions', pinned: true });
    const next = h.store.appendTurn(ALEX, turn('And what is fading?', { conversationId: named.conversation.id, title: 'Ignored' }));
    expect(next.conversation.title).toBe('Riley’s questions');
    expect(h.store.listConversations(ALEX)[0]).toMatchObject({ id: named.conversation.id, pinned: true, messageCount: 4 });
    expect(() => h.store.renameConversation(ALEX, { conversationId: named.conversation.id, title: '   ' })).toThrow('Give the conversation a name.');
  });

  it('returns the stored reply for a request already answered instead of paying again', () => {
    const h = harness();
    const input = turn('Where are my reports?');
    const saved = h.store.appendTurn(ALEX, input);
    const again = h.store.findByRequest(ALEX, input.user.requestId);
    expect(again).toEqual(saved);
    expect(h.store.findByRequest(SAM, input.user.requestId)).toBeNull();
    expect(h.store.findByRequest(ALEX, 'req-unknown-request')).toBeNull();
    // Deleting the conversation forgets its requests too.
    h.store.deleteConversation(ALEX, saved.conversation.id);
    expect(h.store.findByRequest(ALEX, input.user.requestId)).toBeNull();
    expect(h.store.listConversations(ALEX)).toEqual([]);
  });

  it('rebuilds a damaged index from the conversation files, keeping the damaged copy', () => {
    const h = harness();
    const input = turn('First question');
    const saved = h.store.appendTurn(ALEX, input);
    fs.writeFileSync(path.join(h.folder(ALEX), 'index.json'), '{ not json');
    expect(h.store.listConversations(ALEX).map((row) => row.id)).toEqual([saved.conversation.id]);
    expect(h.store.findByRequest(ALEX, input.user.requestId)?.message.id).toBe(saved.message.id);
    expect(fs.readdirSync(h.folder(ALEX)).some((name) => name.startsWith('index.json.unreadable-'))).toBe(true);
    fs.writeFileSync(path.join(h.folder(ALEX), 'index.json'), JSON.stringify({ version: 99, conversations: [] }));
    expect(() => h.store.listConversations(ALEX)).toThrow('newer Scraper Studio');
  });

  it('refuses ids that could leave the person’s folder', () => {
    const h = harness();
    expect(h.store.readConversation(ALEX, '../../team')).toBeNull();
    expect(() => h.store.deleteConversation(ALEX, '../index')).toThrow('isn’t available');
    expect(() => h.store.listConversations('../../etc')).toThrow('Sign in to use Ask AI.');
  });

  it('caps conversations per person, deleting the oldest unpinned ones first', () => {
    skipFsync(); const h = harness();
    const pinned = h.store.appendTurn(ALEX, turn('Keep me'));
    h.store.renameConversation(ALEX, { conversationId: pinned.conversation.id, pinned: true });
    h.advance(1000);
    const oldest = h.store.appendTurn(ALEX, turn('Oldest unpinned'));
    for (let index = 0; index < MAX_CONVERSATIONS - 1; index++) { h.advance(1000); h.store.appendTurn(ALEX, turn(`Question ${index}`)); }
    const rows = h.store.listConversations(ALEX, { limit: 500 });
    expect(rows).toHaveLength(MAX_CONVERSATIONS);
    expect(rows.some((row) => row.id === pinned.conversation.id)).toBe(true);
    expect(rows.some((row) => row.id === oldest.conversation.id)).toBe(false);
    expect(fs.existsSync(path.join(h.folder(ALEX), 'c', `${oldest.conversation.id}.json`))).toBe(false);
  }, 30000); // hundreds of atomic writes; slow when the suite runs in parallel.

  it('caps messages per conversation and keeps the newest', () => {
    skipFsync(); const h = harness();
    const first = h.store.appendTurn(ALEX, turn('Question 0'));
    for (let index = 1; index < MAX_MESSAGES / 2 + 5; index++) h.store.appendTurn(ALEX, turn(`Question ${index}`, { conversationId: first.conversation.id }));
    const conversation = h.store.readConversation(ALEX, first.conversation.id);
    expect(conversation.messages).toHaveLength(MAX_MESSAGES);
    expect(conversation.messages.at(-2).content).toBe(`Question ${MAX_MESSAGES / 2 + 4}`);
    expect(conversation.messages.some((message) => message.content === 'Question 0')).toBe(false);
  }, 30000); // hundreds of atomic writes; slow when the suite runs in parallel.
});

describe('history', () => {
  it('sends the last turns, the rolling summary and what the summary does not cover yet', () => {
    const h = harness();
    const first = h.store.appendTurn(ALEX, turn('Question 0'));
    const id = first.conversation.id;
    for (let index = 1; index < 3; index++) h.store.appendTurn(ALEX, turn(`Question ${index}`, { conversationId: id }));
    // Six messages: everything fits in the last turns, nothing to summarize.
    let past = h.store.history(ALEX, id);
    expect(past.turns.map((row) => row.content)).toEqual(['Question 0', 'Answer to Question 0', 'Question 1', 'Answer to Question 1', 'Question 2', 'Answer to Question 2']);
    expect(past.pending).toEqual([]);
    for (let index = 3; index < 6; index++) h.store.appendTurn(ALEX, turn(`Question ${index}`, { conversationId: id }));
    past = h.store.history(ALEX, id);
    expect(past.turns).toHaveLength(HISTORY_TURNS);
    expect(past.turns[0].content).toBe('Question 2');
    expect(past.pending.map((row) => row.content)).toEqual(['Question 0', 'Answer to Question 0', 'Question 1', 'Answer to Question 1']);
    // The model folds them into a summary; the next history sends only what came after.
    h.store.appendTurn(ALEX, turn('Question 6', { conversationId: id, summary: { text: 'They asked about runs 0 and 1.', through: past.coverThrough } }));
    past = h.store.history(ALEX, id);
    expect(past.summary).toBe('They asked about runs 0 and 1.');
    expect(past.pending.map((row) => row.content)).toEqual(['Question 2', 'Answer to Question 2']);
    expect(askHistory({ messages: [] })).toEqual({ summary: '', turns: [], pending: [], coverThrough: '' });
  });

  it('folds button outcomes, pictures and seed background into the history', () => {
    const h = harness();
    const input = turn('Start my weekly research', { assistant: { content: 'Here is the button.', actions: [{ kind: 'start-research', label: 'Start research for Weekly listening', target: 'Weekly listening' }, { kind: 'open-tab', label: 'Open Trends', target: 'trends' }], image: { title: 'Hero', prompt: 'A calm desk', size: '1536x1024', status: 'creating' }, cards: [{ type: 'run', title: 'Weekly listening', note: '', data: {}, actionIndexes: [] }] } });
    input.user.context = 'Background from the report reader.';
    const saved = h.store.appendTurn(ALEX, input);
    h.store.recordOutcome(ALEX, { conversationId: saved.conversation.id, messageId: saved.message.id, index: 0, outcome: { status: 'done', text: 'Research started.' } });
    const picture = h.store.recordOutcome(ALEX, { conversationId: saved.conversation.id, messageId: saved.message.id, outcome: { kind: 'image', imageId: 'help-image-22222222-2222-4222-8222-222222222222' } });
    expect(picture.image).toMatchObject({ imageId: 'help-image-22222222-2222-4222-8222-222222222222', status: 'ready' });
    const past = h.store.history(ALEX, saved.conversation.id);
    expect(past.turns[0]).toEqual({ role: 'user', content: 'Background from the report reader.' });
    expect(past.turns[2].content).toContain('[Offered: Start research for Weekly listening. Outcome: done (Research started.).]');
    expect(past.turns[2].content).toContain('[Offered: Open Trends. Outcome: not clicked.]');
    expect(past.turns[2].content).toContain('[Picture created from this prompt: A calm desk]');
    expect(past.turns[2].content).toContain('[Cards shown: run "Weekly listening"]');
    expect(() => h.store.recordOutcome(ALEX, { conversationId: saved.conversation.id, messageId: saved.message.id, index: 9, outcome: { status: 'done' } })).toThrow('That button isn’t on this answer anymore.');
    expect(() => h.store.recordOutcome(ALEX, { conversationId: saved.conversation.id, messageId: saved.message.id, outcome: { kind: 'image', imageId: '../../secret' } })).toThrow('no longer available');
  });
});

describe('memory', () => {
  it('remembers durable items with their source, drops secrets and repeats, and shows a Remembered card', () => {
    const h = harness();
    const saved = h.store.appendTurn(ALEX, turn('I prefer LinkedIn for B2B', { remember: [
      { kind: 'preference', text: 'Prefers LinkedIn over X for B2B topics.', scope: 'me', replaces: '' },
      { kind: 'fact', text: 'My Apify token is apify_api_ABCDEFGHIJKLMNOPQRST', scope: 'me', replaces: '' },
      { kind: 'preference', text: 'prefers linkedin over x for b2b topics', scope: 'me', replaces: '' },
    ] }));
    expect(saved.message.remembered).toEqual([{ id: expect.stringMatching(/^mem-[0-9a-f-]{36}$/), text: 'Prefers LinkedIn over X for B2B topics.' }]);
    expect(saved.message.cards.at(-1)).toEqual({ type: 'memory', title: 'Remembered', note: '', data: { items: saved.message.remembered }, actionIndexes: [] });
    const [item] = h.store.listMemory(ALEX);
    expect(item).toMatchObject({ kind: 'preference', scope: 'me', status: 'active', uses: 0, pinned: false, source: { conversationId: saved.conversation.id, messageId: saved.message.id } });
    expect(h.store.listMemory(SAM)).toEqual([]);
    // Saying it again only refreshes it: no new chip.
    const again = h.store.appendTurn(ALEX, turn('Again', { conversationId: saved.conversation.id, remember: [{ kind: 'preference', text: 'Prefers LinkedIn over X for B2B topics!', scope: 'me', replaces: '' }] }));
    expect(again.message.remembered).toEqual([]);
    expect(h.store.listMemory(ALEX)).toHaveLength(1);
    expect(() => h.store.saveMemory(ALEX, { text: 'password: hunter2hunter2' })).toThrow('Ask AI never keeps those');
  });

  it('retires the item a new one replaces, forgets on request, and can bring it back', () => {
    const h = harness();
    const [first] = h.store.remember(ALEX, [{ kind: 'decision', text: 'Weekly listening runs on Mondays.', scope: 'workspace', replaces: '' }], { workspaceId: 'general' });
    const [second] = h.store.remember(ALEX, [{ kind: 'decision', text: 'Weekly listening runs on Tuesdays.', scope: 'workspace', replaces: first.id }], { workspaceId: 'general' });
    expect(h.store.listMemory(ALEX, { workspaceId: 'general' }).map((item) => item.id)).toEqual([second.id]);
    expect(h.store.listMemory(ALEX, { workspaceId: 'general', includeForgotten: true }).find((item) => item.id === first.id).status).toBe('forgotten');
    // Text "" with replaces just forgets.
    expect(h.store.remember(ALEX, [{ kind: 'decision', text: '', scope: 'workspace', replaces: second.id }], { workspaceId: 'general' })).toEqual([]);
    expect(h.store.listMemory(ALEX, { workspaceId: 'general' })).toEqual([]);
    expect(h.store.saveMemory(ALEX, { id: second.id, status: 'active' }).status).toBe('active');
    expect(h.store.forgetMemory(ALEX, second.id).status).toBe('forgotten');
    expect(() => h.store.forgetMemory(ALEX, 'mem-missing')).toThrow('doesn’t remember that');
  });

  it('recalls pinned items, then word matches, then live names and recent ones, within the limits', () => {
    const h = harness();
    const add = (text, extra = {}) => h.store.saveMemory(ALEX, { kind: 'preference', text, ...extra }, { workspaceId: 'general' });
    const budget = add('Keeps quick scans under two dollars of AI spend.');
    h.advance(10 * DAY);
    const tone = add('Writes newsletters in a friendly, plain tone.');
    const pinned = add('Signs every report as the Growth team.', { pinned: true });
    const named = add('Cares most about the AI Overviews trend.');
    const other = h.store.saveMemory(ALEX, { kind: 'fact', text: 'Semrush workspace uses quick scans daily.', scope: 'workspace' }, { workspaceId: 'semrush' });
    h.advance(DAY);
    const recalled = h.store.recall(ALEX, { workspaceId: 'general', query: 'How much will a quick scan cost?', names: ['AI Overviews', 'Weekly listening'], limit: 3 });
    // Pinned first; then the item that matches the question's words (despite being 11 days old); then the one naming a
    // live trend. The recent but unrelated item is left out.
    expect(recalled.map((item) => item.id)).toEqual([pinned.id, budget.id, named.id]);
    expect(recalled.map((item) => item.id)).not.toContain(other.id); // another workspace's item never comes along
    expect(recalled.map((item) => item.id)).not.toContain(tone.id);
    // Recalled items count as used.
    const stored = h.store.listMemory(ALEX, { workspaceId: 'general' });
    expect(stored.find((item) => item.id === budget.id)).toMatchObject({ uses: 1, lastUsedAt: '2026-10-27T09:00:00.000Z' });
    expect(stored.find((item) => item.id === tone.id).uses).toBe(0);
    // maxChars holds the whole block to a size: the pinned item and the word match fit, nothing else does.
    expect(h.store.recall(ALEX, { workspaceId: 'general', query: 'newsletter tone', maxChars: 170 }).map((item) => item.id)).toEqual([pinned.id, tone.id]);
    expect(h.store.recall(SAM, { workspaceId: 'general', query: 'anything' })).toEqual([]);
    // The memory lookup searches beyond what was recalled.
    expect(h.store.searchMemory(ALEX, { workspaceId: 'general', query: 'newsletter tone', exclude: [] }).map((item) => item.id)).toEqual([tone.id]);
    expect(h.store.searchMemory(ALEX, { workspaceId: 'general', query: 'newsletter tone', exclude: [tone.id] })).toEqual([]);
  });

  it('caps active memory, dropping the oldest unpinned items first', () => {
    skipFsync(); const h = harness();
    const keep = h.store.saveMemory(ALEX, { text: 'Pinned and old.', pinned: true });
    h.advance(1000);
    const oldest = h.store.saveMemory(ALEX, { text: 'Oldest unpinned item.' });
    for (let index = 0; index < MAX_ACTIVE_MEMORY - 1; index++) { h.advance(1000); h.store.saveMemory(ALEX, { text: `Item number ${index}.` }); }
    const items = h.store.listMemory(ALEX);
    expect(items).toHaveLength(MAX_ACTIVE_MEMORY);
    expect(items.some((item) => item.id === keep.id)).toBe(true);
    expect(items.some((item) => item.id === oldest.id)).toBe(false);
  }, 30000); // hundreds of atomic writes; slow when the suite runs in parallel.

  it('spots secret-shaped text', () => {
    for (const text of ['my key is sk-ant-api03-abcdefghijklmnopqrstuvwxyz', 'token: 3f2a9c1e7b6d4a5f8e9c0b1a2d3e4f56', 'https://script.google.com/macros/s/AKfycb/exec', 'password = correct-horse', 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sig'])
      expect(looksSecret(text), text).toBe(true);
    for (const text of ['Prefers LinkedIn over X for B2B topics.', 'Keeps quick scans under $2.', 'Calls the program Weekly listening.'])
      expect(looksSecret(text), text).toBe(false);
  });
});

describe('search and purge', () => {
  it('finds what was decided in earlier conversations, best match first', () => {
    const h = harness();
    const pricing = h.store.appendTurn(ALEX, turn('Should we write about pricing pages?', { assistant: { content: 'We decided to skip the pricing pages trend this month and revisit in November.' } }));
    h.store.appendTurn(ALEX, turn('How do I make channel assets?'));
    h.store.appendTurn(ALEX, turn('Pricing for the semrush workspace', { workspaceId: 'semrush' }));
    const found = h.store.searchConversations(ALEX, 'what did we decide about pricing pages', 5, { workspaceId: 'general' });
    expect(found.map((row) => row.id)).toEqual([pricing.conversation.id]);
    expect(found[0].matches).toEqual(expect.arrayContaining([expect.objectContaining({ role: 'assistant', text: expect.stringContaining('skip the pricing pages trend') })]));
    expect(h.store.searchConversations(ALEX, 'pricing', 5, { workspaceId: 'general', exclude: pricing.conversation.id })).toEqual([]);
    expect(h.store.searchConversations(SAM, 'pricing', 5)).toEqual([]);
    expect(h.store.searchConversations(ALEX, 'the and of', 5)).toEqual([]);
  });
  it('keeps only good matches when asked to (Ask AI’s related conversations), not any shared common word', () => {
    const h = harness();
    h.store.appendTurn(ALEX, turn('Should we write about pricing pages?', { assistant: { content: 'We decided to skip the pricing pages trend this month.' } }));
    for (let i = 0; i < 6; i += 1) h.store.appendTurn(ALEX, turn(`Question ${i} about budgets and runs`, { assistant: { content: `Answer ${i} about the research run budget.` } }));
    expect(h.store.searchConversations(ALEX, 'tell me about the run', 2, { workspaceId: 'general' })).toHaveLength(2);
    expect(h.store.searchConversations(ALEX, 'tell me about the run', 2, { workspaceId: 'general', minScore: 3 })).toEqual([]);
    expect(h.store.searchConversations(ALEX, 'what did we decide about pricing pages', 2, { workspaceId: 'general', minScore: 3 }).map((row) => row.title)).toEqual(['Should we write about pricing pages?']);
  });
  it('tells the next answer which buttons were dropped because nothing matched', () => {
    const h = harness();
    const saved = h.store.appendTurn(ALEX, turn('Publish the zero-click post', { assistant: { content: 'I couldn’t find that post.', actions: [], cards: [], unresolved: ['the zero-click post'] } }));
    expect(h.store.history(ALEX, saved.conversation.id).turns[1].content).toContain('[Couldn’t find, so no button was offered: the zero-click post]');
  });

  it('purges a removed member’s conversations and memory, leaving everyone else’s', () => {
    const h = harness();
    h.store.appendTurn(ALEX, turn('Mine', { remember: [{ kind: 'goal', text: 'Wants one trend report a week.', scope: 'me', replaces: '' }] }));
    h.store.appendTurn(SAM, turn('Theirs'));
    expect(fs.existsSync(h.folder(ALEX))).toBe(true);
    expect(h.store.purge(ALEX)).toBe(true);
    expect(fs.existsSync(h.folder(ALEX))).toBe(false);
    expect(h.store.listConversations(ALEX)).toEqual([]);
    expect(h.store.listMemory(ALEX)).toEqual([]);
    expect(h.store.listConversations(SAM)).toHaveLength(1);
    expect(h.store.purge('')).toBe(false);
  });
});
