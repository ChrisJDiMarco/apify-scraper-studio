import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const { createPromptStore, MAX_TESTS } = require('../src/main/prompt-store');
const template = require('../src/shared/prompt-template');

const roots = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function store(now = () => new Date('2026-10-17T14:00:00Z')) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-store-test-')); roots.push(root);
  return { root, store: createPromptStore({ root, now }) };
}
const alex = { id: 'id-alex', name: 'Alex', role: 'admin' };
const sam = { id: 'id-sam', name: 'Sam', role: 'editor' };
// Only the prompts that write channel assets (their words, pictures and videos) can be saved over, so the edits below
// change the short video plan (video.brief, four editable parts). Research prompts are set by the studio.
const STORY = 'Tell the trend’s story in one calm, continuous shot, specific to this trend.';
const EMPTY = 'Return an empty list when nothing in this batch is a real trend.';
const failure = (fn) => { try { fn(); } catch (error) { return error; } throw new Error('expected a refusal'); };

describe('prompt store', () => {
  it('starts every prompt on its defaults at version 0', () => {
    const { store: s } = store();
    const read = s.read('semrush', 'semrush', 'research.discovery');
    expect(read).toMatchObject({ version: 0, locked: false, customized: [], history: [], damaged: false });
    expect(read.effective).toEqual(template.defaultsFor('research.discovery', 'semrush'));
    expect(s.summary('semrush', 'semrush')).toEqual({});
  });

  it('saves only the changed blocks, credits the author and appends history', () => {
    const { root, store: s } = store();
    expect(s.save('semrush', 'semrush', 'video.brief', { blocks: { instruction: `${STORY}\r\n` }, expectedVersion: 0, note: '  Calmer   story ', by: sam })).toEqual({ version: 1, changed: true });
    const file = JSON.parse(fs.readFileSync(path.join(root, 'semrush', 'video.brief.json'), 'utf8'));
    expect(file.blocks).toEqual({ instruction: `${STORY}\n` });
    expect(file.defaultHashes.instruction).toBe(template.hashOf(template.defaultText('video.brief', 'instruction', 'semrush')));
    const read = s.read('semrush', 'semrush', 'video.brief');
    expect(read.customized).toEqual(['instruction']);
    expect(read.history[0]).toMatchObject({ version: 1, source: 'library', note: 'Calmer story', by: { id: 'id-sam', name: 'Sam', role: 'editor' }, blockIds: ['instruction'] });
    expect(s.summary('semrush', 'semrush')['video.brief']).toMatchObject({ version: 1, custom: true, updatedBy: { name: 'Sam', role: 'editor' }, defaultChanged: false });
  });

  it('refuses a stale version, naming who saved and when', () => {
    const { store: s } = store();
    s.save('semrush', 'semrush', 'video.brief', { blocks: { instruction: STORY }, expectedVersion: 0, note: 'One', by: sam });
    const error = failure(() => s.save('semrush', 'semrush', 'video.brief', { blocks: { instruction: 'Tell it in two simple cuts.' }, expectedVersion: 0, note: 'Two', by: alex }));
    expect(error).toMatchObject({ status: 409, code: 'promptConflict', version: 1 });
    expect(error.message).toMatch(/^Sam saved version 1 of “Short video plan” at Oct 17/);
  });

  it('refuses edits that fail the checks, with every problem', () => {
    const { store: s } = store();
    const error = failure(() => s.save('general', 'general', 'video.brief', { blocks: { role: 'You plan a {{brand}} video.', fields: '- title: a short working title.' }, expectedVersion: 0, note: 'Shorter', by: alex }));
    expect(error).toMatchObject({ status: 400, code: 'promptInvalid' });
    expect(error.problems.map((problem) => problem.message)).toEqual(expect.arrayContaining([expect.stringMatching(/must keep \{\{seconds\}\}/), expect.stringMatching(/\{\{brand\}\} isn’t a value/), expect.stringMatching(/must still mention “evidenceIds”/)]));
    expect(failure(() => s.save('general', 'general', 'video.brief', { blocks: { instruction: STORY }, expectedVersion: 0, note: '  ', by: alex })).code).toBe('promptNote');
    expect(failure(() => s.save('general', 'general', 'video.brief', { blocks: {}, expectedVersion: 0, note: 'n', by: alex })).code).toBe('promptEmpty');
    expect(failure(() => s.save('general', 'general', 'system.claude', { blocks: { text: 'Be brief.' }, expectedVersion: 0, note: 'n', by: alex })).problems[0].message).toMatch(/is fixed/);
    // Research, reports, Ask AI and the data tools are set by the studio: their parts are refused like any fixed part,
    // an admin's edit too.
    expect(failure(() => s.save('general', 'general', 'research.discovery', { blocks: { empty: EMPTY }, expectedVersion: 0, note: 'n', by: alex }))).toMatchObject({ status: 400, code: 'promptInvalid', message: 'When nothing qualifies is fixed: Set by the studio. Only the prompts that write channel assets can be changed.' });
    expect(s.read('general', 'general', 'research.discovery')).toMatchObject({ version: 0, customized: [] });
    expect(failure(() => s.save('general', 'general', 'pictures.variations', { blocks: { 'sel-image': 'a\nb\nc' }, expectedVersion: 0, note: 'n', by: alex })).problems[0].message).toMatch(/isn’t used in this workspace’s edition/);
    expect(failure(() => s.save('general', 'general', 'not.a.prompt', { blocks: { a: 'b' }, expectedVersion: 0, note: 'n', by: alex })).status).toBe(404);
    expect(failure(() => s.read('../escape', 'general', 'research.discovery')).status).toBe(400);
  });

  it('makes no version when the text is unchanged, and stores nothing for a block put back to its default', () => {
    const { store: s } = store();
    s.save('general', 'general', 'video.brief', { blocks: { instruction: STORY }, expectedVersion: 0, note: 'One', by: alex });
    expect(s.save('general', 'general', 'video.brief', { blocks: { instruction: STORY }, expectedVersion: 1, note: 'Same', by: alex })).toEqual({ version: 1, changed: false });
    expect(s.save('general', 'general', 'video.brief', { blocks: { instruction: template.defaultText('video.brief', 'instruction') }, expectedVersion: 1, note: 'Back', by: alex })).toEqual({ version: 2, changed: true });
    expect(s.read('general', 'general', 'video.brief').customized).toEqual([]);
  });

  it('lets only admins lock, and only admins change a locked prompt', () => {
    const { store: s } = store();
    expect(failure(() => s.setLock('general', 'general', 'video.brief', { locked: true, by: sam }))).toMatchObject({ status: 403, code: 'adminOnly' });
    expect(s.setLock('general', 'general', 'video.brief', { locked: true, by: alex })).toEqual({ locked: true });
    expect(s.read('general', 'general', 'video.brief')).toMatchObject({ locked: true, version: 0, lock: { locked: true, by: { name: 'Alex' } } });
    expect(failure(() => s.save('general', 'general', 'video.brief', { blocks: { instruction: STORY }, expectedVersion: 0, note: 'n', by: sam }))).toMatchObject({ status: 403, code: 'promptLocked' });
    expect(failure(() => s.revert('general', 'general', 'video.brief', { toVersion: 0, expectedVersion: 0, by: sam })).status).toBe(403);
    expect(s.save('general', 'general', 'video.brief', { blocks: { instruction: STORY }, expectedVersion: 0, note: 'Admin edit', by: alex }).version).toBe(1);
    expect(failure(() => s.setLock('general', 'general', 'video.brief', { locked: 'yes', by: alex })).status).toBe(400);
  });

  it('restores an earlier version or the default as a new version', () => {
    const { store: s } = store();
    s.save('general', 'general', 'video.brief', { blocks: { instruction: STORY }, expectedVersion: 0, note: 'One', by: alex });
    s.save('general', 'general', 'video.brief', { blocks: { instruction: 'Tell the story in two or three simple cuts.' }, expectedVersion: 1, note: 'Two', by: sam });
    expect(s.revert('general', 'general', 'video.brief', { toVersion: 1, expectedVersion: 2, note: '', by: alex })).toEqual({ version: 3, changed: true });
    let read = s.read('general', 'general', 'video.brief');
    expect(read.effective.instruction).toBe(STORY);
    expect(read.history[0]).toMatchObject({ version: 3, source: 'restore', revertOf: 1, note: 'Restored version 1' });
    s.revert('general', 'general', 'video.brief', { toVersion: 0, expectedVersion: 3, by: alex });
    read = s.read('general', 'general', 'video.brief');
    expect(read).toMatchObject({ version: 4, customized: [] }); expect(read.history[0]).toMatchObject({ revertOf: 0, note: 'Restored the default' });
    expect(failure(() => s.revert('general', 'general', 'video.brief', { toVersion: 9, expectedVersion: 4, by: alex })).status).toBe(400);
  });

  it('diffs versions, the default and a draft by block', () => {
    const { store: s } = store();
    s.save('general', 'general', 'video.brief', { blocks: { instruction: STORY }, expectedVersion: 0, note: 'One', by: alex });
    expect(s.diff('general', 'general', 'video.brief', { from: 0, to: 1 })).toEqual({ from: 0, to: 1, blocks: [{ blockId: 'instruction', label: 'How to tell the story', lines: [{ op: 'del', text: template.defaultText('video.brief', 'instruction') }, { op: 'add', text: STORY }] }] });
    expect(s.diff('general', 'general', 'video.brief', { from: 'current', to: 'draft', draft: { sourceRule: 'Only one rule.' } }).blocks.map((block) => block.blockId)).toEqual(['sourceRule']);
    expect(s.diff('general', 'general', 'video.brief', { from: 1, to: 'current' }).blocks).toEqual([]);
  });

  it('snapshots the effective text of every listed prompt for a run', () => {
    const { store: s } = store();
    s.save('semrush', 'semrush', 'pictures.kit-brief', { blocks: { role: 'Art-direct {{purpose}} for {{owner}}; the image model gets your brief and the brand rules{{sees}}.' }, expectedVersion: 0, note: 'Shorter', by: alex });
    const snapshot = s.snapshot('semrush', 'semrush', ['pictures.kit-brief', 'research.discovery', 'not.a.prompt', 'pictures.kit-brief']);
    expect(Object.keys(snapshot)).toEqual(['pictures.kit-brief', 'research.discovery']);
    expect(snapshot['pictures.kit-brief']).toMatchObject({ version: 1, custom: true, hash: template.hashOf(snapshot['pictures.kit-brief'].blocks) });
    expect(snapshot['pictures.kit-brief'].blocks.role).toMatch(/^Art-direct \{\{purpose\}\} for \{\{owner\}\}/);
    // A prompt the studio sets is always its text.
    expect(snapshot['research.discovery']).toMatchObject({ version: 0, custom: false, blocks: template.defaultsFor('research.discovery', 'semrush') });
    expect(s.effective('semrush', 'semrush', 'pictures.kit-brief')).toMatchObject({ version: 1, custom: true });
  });

  it('notices when a newer build changed a default someone saved over', () => {
    const { root, store: s } = store();
    s.save('general', 'general', 'video.brief', { blocks: { instruction: STORY }, expectedVersion: 0, note: 'One', by: alex });
    const target = path.join(root, 'general', 'video.brief.json'); const file = JSON.parse(fs.readFileSync(target, 'utf8'));
    fs.writeFileSync(target, JSON.stringify({ ...file, defaultHashes: { instruction: 'an-older-default' } }));
    expect(s.read('general', 'general', 'video.brief').defaultChanged).toEqual(['instruction']);
    expect(s.summary('general', 'general')['video.brief'].defaultChanged).toBe(true);
  });

  it('keeps test records apart from versions, up to the last 50', () => {
    const { root, store: s } = store();
    for (let i = 0; i < MAX_TESTS + 3; i++) s.recordTest('general', 'general', 'research.matching', { id: `ptest-${i}`, ok: i % 2 === 0, costUsd: 0.1, by: alex, problems: ['x'] });
    const read = s.read('general', 'general', 'research.matching');
    expect(read.version).toBe(0); expect(read.tests).toHaveLength(10); expect(read.tests[0].id).toBe(`ptest-${MAX_TESTS + 2}`);
    expect(JSON.parse(fs.readFileSync(path.join(root, 'general', 'research.matching.json'), 'utf8')).tests).toHaveLength(MAX_TESTS);
  });

  it('moves a damaged file aside, refuses a newer format and purges a workspace', () => {
    const { root, store: s } = store();
    fs.mkdirSync(path.join(root, 'general'), { recursive: true });
    fs.writeFileSync(path.join(root, 'general', 'research.discovery.json'), '{ not json');
    expect(s.read('general', 'general', 'research.discovery')).toMatchObject({ version: 0, damaged: true });
    expect(fs.readdirSync(path.join(root, 'general')).some((name) => name.startsWith('research.discovery.json.unreadable-'))).toBe(true);
    fs.writeFileSync(path.join(root, 'general', 'research.matching.json'), JSON.stringify({ format: 99, promptId: 'research.matching' }));
    expect(failure(() => s.read('general', 'general', 'research.matching')).status).toBe(409);
    s.purgeWorkspace('general');
    expect(fs.existsSync(path.join(root, 'general'))).toBe(false);
  });
});
