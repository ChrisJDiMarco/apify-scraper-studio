import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import askStoreModule from '../src/main/ask-store.js';
import promptStoreModule from '../src/main/prompt-store.js';
import reportNotesModule from '../src/main/report-notes.js';
const { createAskStore } = askStoreModule;
const { createPromptStore } = promptStoreModule;
const { createReportNotes } = reportNotesModule;

// On Windows a backup agent, EDR or the Search indexer can hold a file so it can't be read for a moment (EBUSY). That is
// not damage: Ask AI's history, a saved prompt and report notes must stay where they are, never be moved aside and reset.
const roots = [];
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const temp = (prefix) => { const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); roots.push(root); return root; };
const failure = (fn) => { try { fn(); } catch (error) { return error; } throw new Error('expected a refusal'); };
// readFileSync throws EBUSY for files whose name ends with `suffix`; everything else reads as usual.
function holdFiles(suffix) {
  const real = fs.readFileSync;
  return vi.spyOn(fs, 'readFileSync').mockImplementation((file, ...rest) => {
    if (String(file).endsWith(suffix)) throw Object.assign(new Error(`EBUSY: resource busy or locked, open '${file}'`), { code: 'EBUSY' });
    return real.call(fs, file, ...rest);
  });
}
const asideCopies = (dir) => fs.readdirSync(dir, { recursive: true }).map(String).filter((name) => name.includes('.unreadable-'));

const ALEX = 'member-11111111-1111-4111-8111-111111111111';
const turn = (question) => ({ workspaceId: 'general', user: { content: question, page: { layout: 'simple', tab: 'home' }, requestId: `req-${crypto.randomUUID()}` }, assistant: { content: `Answer to ${question}`, pages: [], followUps: [], actions: [], show: null, image: null, cards: [], read: [], receipt: { costUsd: 0.01, model: 'claude-opus-5-5', route: 'claude' } } });

describe('Ask AI', () => {
  it('refuses for now when its index can’t be read, and keeps every conversation', () => {
    const root = temp('win-ask-'); const store = createAskStore({ root, now: () => new Date('2026-10-18T09:00:00Z') });
    const saved = store.appendTurn(ALEX, turn('Where are my trends?'));
    const index = fs.readdirSync(root, { recursive: true }).map(String).find((name) => name.endsWith('index.json'));
    const before = fs.readFileSync(path.join(root, index), 'utf8');
    holdFiles('index.json');
    const error = failure(() => store.listConversations(ALEX));
    expect(error).toMatchObject({ status: 503, message: 'Ask AI’s saved conversations and memory could not be read right now; nothing was changed. Try again.' });
    expect(() => store.appendTurn(ALEX, turn('And my reports?'))).toThrow(/could not be read right now/);
    vi.restoreAllMocks();
    expect(asideCopies(root)).toEqual([]);
    expect(fs.readFileSync(path.join(root, index), 'utf8')).toBe(before);
    expect(store.listConversations(ALEX).map((row) => row.id)).toEqual([saved.conversation.id]);
  });

  it('never replaces a held memory file with an empty one; a damaged one is still moved aside', () => {
    const root = temp('win-ask-'); const store = createAskStore({ root, now: () => new Date('2026-10-18T09:00:00Z') });
    store.saveMemory(ALEX, { kind: 'preference', text: 'Prefers short answers' });
    const memory = path.join(root, fs.readdirSync(root, { recursive: true }).map(String).find((name) => name.endsWith('memory.json')));
    holdFiles('memory.json');
    expect(failure(() => store.saveMemory(ALEX, { kind: 'fact', text: 'Works on the Semrush blog' })).status).toBe(503);
    vi.restoreAllMocks();
    expect(store.listMemory(ALEX).map((item) => item.text)).toEqual(['Prefers short answers']);
    fs.writeFileSync(memory, '{ not json');
    expect(store.listMemory(ALEX)).toEqual([]);
    expect(asideCopies(root)).toHaveLength(1);
  });
});

describe('Prompt Library', () => {
  it('refuses for now when a saved prompt can’t be read, and leaves the file in place', () => {
    const root = temp('win-prompts-'); const store = createPromptStore({ root, now: () => new Date('2026-10-18T09:00:00Z') });
    const empty = 'Return an empty list when nothing in this batch is a real trend.';
    store.save('general', 'general', 'research.discovery', { blocks: { empty }, expectedVersion: 0, note: 'Plainer rule', by: { id: 'id-sam', name: 'Sam', role: 'editor' } });
    const file = path.join(root, 'general', 'research.discovery.json'); const before = fs.readFileSync(file, 'utf8');
    holdFiles('research.discovery.json');
    const error = failure(() => store.read('general', 'general', 'research.discovery'));
    expect(error).toMatchObject({ status: 503, code: 'promptsUnreadable', message: 'This prompt’s saved versions could not be read right now; nothing was changed. Try again.' });
    expect(() => store.save('general', 'general', 'research.discovery', { blocks: { empty: `${empty} Again.` }, expectedVersion: 1, note: 'Again', by: { id: 'id-sam', name: 'Sam', role: 'editor' } })).toThrow(/could not be read right now/);
    vi.restoreAllMocks();
    expect(asideCopies(root)).toEqual([]);
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
    expect(store.read('general', 'general', 'research.discovery')).toMatchObject({ version: 1, customized: ['empty'], damaged: false });
  });
});

describe('Report notes', () => {
  const ANCHOR = { yStart: 'AAEC', yEnd: 'AwQF', quote: 'Teams can’t tie AI citations to revenue.' };
  const RILEY = { id: 'member-riley', name: 'Riley' };
  const badCopies = (dir) => fs.readdirSync(dir).filter((name) => name.includes('.bad-'));

  it('keeps every note when the file is held at launch, and reads it once it is free', () => {
    const root = temp('win-notes-'); const file = path.join(root, 'content-studio', 'report-notes.json');
    const first = createReportNotes({ file, log: () => {} });
    first.save({ assetId: 'report-a', anchor: ANCHOR, body: 'First' }, RILEY);
    first.save({ assetId: 'report-a', anchor: ANCHOR, body: 'Second' }, RILEY);
    const before = fs.readFileSync(file, 'utf8');
    holdFiles('report-notes.json');
    // The lock also stops the file from being moved, as a sharing violation does on Windows.
    const realRename = fs.renameSync;
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => { if (String(from) === file) throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' }); return realRename.call(fs, from, to); });
    const notes = createReportNotes({ file, log: () => {} });
    expect(failure(() => notes.save({ assetId: 'report-b', anchor: ANCHOR, body: 'Third' }, RILEY))).toMatchObject({ status: 503, code: 'notesUnreadable', message: 'Report notes could not be read right now (EBUSY); nothing was changed. Try again.' });
    expect(failure(() => notes.list('report-a')).status).toBe(503);
    vi.restoreAllMocks();
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
    expect(badCopies(path.dirname(file))).toEqual([]);
    expect(notes.list('report-a').map((note) => note.body)).toEqual(['First', 'Second']); // read again on the next use
    notes.save({ assetId: 'report-b', anchor: ANCHOR, body: 'Third' }, RILEY);
    expect(Object.keys(JSON.parse(fs.readFileSync(file, 'utf8')).notes).sort()).toEqual(['report-a', 'report-b']);
  });

  it('refuses to start over a damaged file it can’t move aside', () => {
    const root = temp('win-notes-'); const file = path.join(root, 'content-studio', 'report-notes.json');
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, '{ not json');
    vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' }); });
    expect(() => createReportNotes({ file, log: () => {} })).toThrow('Report notes are damaged and could not be put aside (EPERM); nothing was changed. Close any program using content-studio/report-notes.json and open the studio again.');
    vi.restoreAllMocks();
    expect(fs.readFileSync(file, 'utf8')).toBe('{ not json');
    expect(badCopies(path.dirname(file))).toEqual([]);
  });
});
