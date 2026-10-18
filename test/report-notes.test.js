// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

// Notes on reports (src/main/report-notes.js): threads, replies, edits and deletes of your own, resolve and reopen,
// mentions only of people who can read the report, Inbox items and their unread count.
const require = createRequire(import.meta.url);
const { createReportNotes, LIMITS } = require('../src/main/report-notes.js');

const roots = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const RILEY = { id: 'member-riley', name: 'Riley' };
const JORDAN = { id: 'member-jordan', name: 'Jordan' };
const SAM = { id: 'member-sam', name: 'Sam' };
const CAN_READ = new Set(['member-riley', 'member-jordan', 'member-sam']);
const ANCHOR = { yStart: 'AAEC', yEnd: 'AwQF', quote: 'Teams can’t tie AI citations to revenue.' };

function harness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'report-notes-')); roots.push(root);
  const file = path.join(root, 'content-studio', 'report-notes.json'); let now = Date.parse('2026-10-18T10:00:00.000Z');
  const make = () => createReportNotes({ file, clock: () => new Date(now), log: () => {} });
  return { file, make, notes: make(), tick: (ms) => { now += ms; } };
}

describe('notes and replies', () => {
  it('adds a note on a passage, replies to it, and lists the thread oldest first', () => {
    const h = harness();
    const { note, notified } = h.notes.save({ assetId: 'asset-report', anchor: ANCHOR, body: '  Can we add a source here?  ', mentions: ['member-jordan', 'member-riley', 'member-nobody'] }, RILEY, { mentionable: CAN_READ, title: 'AI Citation Tracking report' });
    expect(note).toMatchObject({ assetId: 'asset-report', anchor: ANCHOR, author: RILEY, body: 'Can we add a source here?', mentions: ['member-jordan'], resolved: null, replies: [], editedAt: '' });
    expect(note.id).toMatch(/^note-/);
    expect(notified).toEqual(['member-jordan']); // never yourself, never someone who can't read the report
    h.tick(1000);
    const reply = h.notes.save({ assetId: 'asset-report', replyTo: note.id, body: 'Added the Gartner figure.' }, JORDAN, { mentionable: CAN_READ });
    expect(reply.note.replies).toEqual([expect.objectContaining({ author: JORDAN, body: 'Added the Gartner figure.', mentions: [] })]);
    expect(reply.notified).toEqual(['member-riley']); // the note's author hears about replies
    h.tick(1000);
    h.notes.save({ assetId: 'asset-report', anchor: { ...ANCHOR, quote: 'Second passage' }, body: 'Later note' }, SAM, { mentionable: CAN_READ });
    expect(h.notes.list('asset-report').map((row) => row.body)).toEqual(['Can we add a source here?', 'Later note']);
    expect(h.notes.list('asset-other')).toEqual([]);
  });

  it('checks what a note needs', () => {
    const h = harness();
    expect(() => h.notes.save({ assetId: 'asset-report', anchor: ANCHOR, body: '   ' }, RILEY)).toThrow(/Write a note first/);
    expect(() => h.notes.save({ assetId: 'asset-report', anchor: { yStart: '', yEnd: '', quote: ' ' }, body: 'x' }, RILEY)).toThrow(/Select the text/);
    expect(() => h.notes.save({ assetId: 'asset-report', anchor: { ...ANCHOR, yStart: 'not base64!' }, body: 'x' }, RILEY)).toThrow(/Select the text again/);
    expect(() => h.notes.save({ assetId: 'asset-report', anchor: ANCHOR, body: 'x'.repeat(LIMITS.body + 1) }, RILEY)).toThrow(/under 4,000/);
    expect(() => h.notes.save({ assetId: '../x', anchor: ANCHOR, body: 'x' }, RILEY)).toThrow(/Choose a report/);
    expect(() => h.notes.save({ assetId: 'asset-report', replyTo: 'note-gone', body: 'x' }, RILEY)).toThrow(expect.objectContaining({ status: 404 }));
    // The Mac app has no members, so no mentions at all.
    expect(h.notes.save({ assetId: 'asset-report', anchor: ANCHOR, body: 'Solo', mentions: ['member-jordan'] }, RILEY, { mentionable: null }).note.mentions).toEqual([]);
    expect(fs.existsSync(h.file)).toBe(true);
  });

  it('lets people edit and delete only their own notes and replies; admins may delete anyone’s', () => {
    const h = harness();
    const { note } = h.notes.save({ assetId: 'asset-report', anchor: ANCHOR, body: 'First take' }, RILEY, { mentionable: CAN_READ });
    const { note: withReply } = h.notes.save({ assetId: 'asset-report', replyTo: note.id, body: 'A reply' }, JORDAN, { mentionable: CAN_READ });
    const replyId = withReply.replies[0].id;
    expect(() => h.notes.save({ assetId: 'asset-report', noteId: note.id, body: 'Hijack' }, JORDAN)).toThrow(expect.objectContaining({ status: 403, code: 'notYourNote' }));
    h.tick(5000);
    const edited = h.notes.save({ assetId: 'asset-report', noteId: note.id, body: 'Second take', mentions: ['member-sam'] }, RILEY, { mentionable: CAN_READ });
    expect(edited.note).toMatchObject({ body: 'Second take', mentions: ['member-sam'], editedAt: '2026-10-18T10:00:05.000Z' });
    expect(edited.notified).toEqual(['member-sam']); // only someone newly mentioned
    // A reply is edited by its own author, named either way.
    expect(h.notes.save({ assetId: 'asset-report', noteId: note.id, replyId, body: 'A better reply' }, JORDAN).note.replies[0].body).toBe('A better reply');
    expect(h.notes.save({ assetId: 'asset-report', noteId: replyId, replyTo: note.id, body: 'Best reply' }, JORDAN).note.replies[0].body).toBe('Best reply');
    expect(() => h.notes.save({ assetId: 'asset-report', noteId: note.id, replyId, body: 'No' }, RILEY)).toThrow(/only your own/);
    expect(() => h.notes.remove({ assetId: 'asset-report', noteId: note.id, replyId }, RILEY)).toThrow(/only your own/);
    expect(h.notes.remove({ assetId: 'asset-report', noteId: note.id, replyId }, JORDAN).note.replies).toEqual([]);
    expect(() => h.notes.remove({ assetId: 'asset-report', noteId: note.id }, JORDAN)).toThrow(/only your own/);
    expect(h.notes.remove({ assetId: 'asset-report', noteId: note.id }, JORDAN, { admin: true })).toEqual({ ok: true, note: null });
    expect(h.notes.list('asset-report')).toEqual([]);
    expect(h.notes.counts()).toEqual({});
  });

  it('resolves and reopens threads, and counts open and total per report', () => {
    const h = harness();
    const first = h.notes.save({ assetId: 'asset-report', anchor: ANCHOR, body: 'One' }, RILEY).note;
    h.notes.save({ assetId: 'asset-report', anchor: ANCHOR, body: 'Two' }, RILEY);
    h.notes.save({ assetId: 'asset-toolkit', anchor: ANCHOR, body: 'Three' }, SAM);
    expect(h.notes.resolve({ assetId: 'asset-report', noteId: first.id, resolved: true }, JORDAN).note.resolved).toEqual({ by: JORDAN, at: '2026-10-18T10:00:00.000Z' });
    expect(h.notes.counts()).toEqual({ 'asset-report': { open: 1, total: 2 }, 'asset-toolkit': { open: 1, total: 1 } });
    expect(h.notes.resolve({ assetId: 'asset-report', noteId: first.id, resolved: false }, RILEY).note.resolved).toBeNull();
    expect(h.notes.counts()['asset-report']).toEqual({ open: 2, total: 2 });
  });
});

describe('the Inbox', () => {
  it('lists mentions and replies newest first, marks a report’s items read when its notes open, and forgets deleted notes', () => {
    const h = harness();
    const { note } = h.notes.save({ assetId: 'asset-report', anchor: ANCHOR, body: 'Jordan, can you check the numbers in this paragraph before Friday?', mentions: ['member-jordan'] }, RILEY, { mentionable: CAN_READ, title: 'AI Citation Tracking report' });
    h.tick(60000);
    h.notes.save({ assetId: 'asset-toolkit', anchor: ANCHOR, body: 'And here', mentions: ['member-jordan'] }, SAM, { mentionable: CAN_READ, title: 'Toolkit' });
    h.tick(60000);
    h.notes.save({ assetId: 'asset-report', replyTo: note.id, body: 'Checked.' }, JORDAN, { mentionable: CAN_READ, title: 'AI Citation Tracking report' });
    const jordan = h.notes.inboxFor('member-jordan');
    expect(jordan.unread).toBe(2);
    expect(jordan.items.map((item) => [item.kind, item.assetId, item.by.id, item.assetTitle])).toEqual([['mention', 'asset-toolkit', 'member-sam', 'Toolkit'], ['mention', 'asset-report', 'member-riley', 'AI Citation Tracking report']]);
    expect(jordan.items[1]).toMatchObject({ noteId: note.id, read: false, excerpt: 'Jordan, can you check the numbers in this paragraph before Friday?', at: '2026-10-18T10:00:00.000Z' });
    expect(h.notes.inboxFor('member-riley').items).toEqual([expect.objectContaining({ kind: 'reply', noteId: note.id, replyId: expect.stringMatching(/^reply-/), by: JORDAN })]);
    expect(h.notes.markRead('member-jordan', 'asset-report')).toBe(true);
    expect(h.notes.markRead('member-jordan', 'asset-report')).toBe(false);
    expect(h.notes.inboxFor('member-jordan').unread).toBe(1);
    // Kept across a restart; a deleted note takes its Inbox items with it.
    const again = h.make();
    expect(again.inboxFor('member-jordan').items).toHaveLength(2);
    again.remove({ assetId: 'asset-report', noteId: note.id }, RILEY);
    expect(again.inboxFor('member-jordan').items.map((item) => item.assetId)).toEqual(['asset-toolkit']);
    expect(again.inboxFor('member-riley').items).toEqual([]);
    // Older than 30 days drops out of the Inbox.
    h.tick(31 * 86400000);
    expect(h.make().inboxFor('member-jordan', { now: Date.parse('2026-11-20T00:00:00.000Z') }).items).toEqual([]);
  });

  it('puts a damaged notes file aside instead of overwriting it', () => {
    const h = harness();
    fs.mkdirSync(path.dirname(h.file), { recursive: true }); fs.writeFileSync(h.file, '{ not json');
    const notes = h.make();
    expect(notes.counts()).toEqual({});
    expect(fs.readdirSync(path.dirname(h.file)).some((name) => name.startsWith('report-notes.json.bad-'))).toBe(true);
    fs.writeFileSync(h.file, JSON.stringify({ v: 2, notes: {}, inbox: {} }));
    expect(() => h.make()).toThrow(/newer version of the studio/);
  });
});
