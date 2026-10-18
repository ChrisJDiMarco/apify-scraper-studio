import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import studio from './helpers/roles-studio.js';

// The report editor and notes on the real main process (src/main/index.js) as the browser studio runs it: who may
// open, edit and leave notes (roles.json, access.js channel scopes), the Markdown written through the studio's edit
// path, noteCounts and each person's Inbox items in their state, and which people hear each live event.
const mainPath = path.resolve('src/main/index.js');
const mainRequire = createRequire(mainPath);
const Y = mainRequire('yjs');
const { MEMBERS, identity, seedStudio } = studio;
const roots = [];
afterAll(() => { for (const root of roots) fs.rmSync(root, { recursive: true, force: true }); });
const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('the report editor and notes on the browser studio', () => {
  let runtime; let dataDir; const sessions = new Map(); const heard = [];
  const sessionOf = (member, viewAs = null) => { const key = `${member.id}:${JSON.stringify(viewAs)}`; if (!sessions.has(key)) sessions.set(key, { expires: Date.now() + 3600000, kind: 'link', memberId: member.id, linkId: 'fixture', viewAs }); return sessions.get(key); };
  const as = (member, viewAs = null) => (channel, payload) => runtime.invoke(channel, payload, { user: identity(member), session: sessionOf(member, viewAs), origin: 'https://studio.example.com' }).then((outcome) => outcome.result);
  const chris = as(MEMBERS.chris); const riley = as(MEMBERS.riley); const alex = as(MEMBERS.alex); const sam = as(MEMBERS.sam);
  const events = (type) => heard.filter((entry) => entry.event.type === type);

  beforeAll(async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'report-editor-gate-')); roots.push(root); dataDir = path.join(root, 'data');
    seedStudio(dataDir);
    process.env.SHELL = '/bin/sh';
    runtime = mainRequire('./web-runtime');
    runtime.configure({ dataDir, secretKey: 'report-editor-gate-secret-0123456789abcdef' });
    runtime.onPersonal('person', (target, event) => heard.push({ to: target.identityId, event }));
    vm.runInNewContext(fs.readFileSync(mainPath, 'utf8'), {
      require: (name) => (name === 'child_process' ? { spawn: () => { throw new Error('No processes in this test.'); } } : mainRequire(name)),
      process: { pid: process.pid, platform: 'darwin', env: { STUDIO_RUNTIME: 'web', STUDIO_PASSWORD: 'report-editor-gate-password' }, argv: [] },
      __dirname: path.dirname(mainPath), Buffer, URL, AbortController, setTimeout, clearTimeout, setInterval, clearInterval, setImmediate,
      fetch: () => { throw new Error('Network access is forbidden in this test.'); },
    }, { filename: mainPath });
    await sleep(50);
  });
  afterAll(() => { runtime?.shutdown(); });

  it('lets an editor edit, writes the Markdown through the edit path, and sends the change to the others with it open', async () => {
    const watching = await chris('studio:openReportDoc', { assetId: 'asset-report', clientId: 'tab-chris' });
    expect(watching).toMatchObject({ canEdit: true, canNote: true, yState: '', epoch: 0 });
    const opened = await riley('studio:openReportDoc', { assetId: 'asset-report', clientId: 'tab-riley' });
    expect(opened.editors.map((row) => row.id)).toEqual(['member-chris', 'member-riley']);
    const doc = new Y.Doc(); doc.getText('body').insert(0, 'Riley rewrote the opening.');
    heard.length = 0;
    const markdown = '# AI Citation Tracking\n\nRiley rewrote the opening.';
    const saved = await riley('studio:pushReportDocUpdate', { assetId: 'asset-report', clientId: 'tab-riley', update: b64(Y.encodeStateAsUpdate(doc)), markdown });
    expect(saved).toMatchObject({ version: 1, epoch: 0, markdownSaved: true, savedAt: expect.any(String) });
    // Kits, exports, Google Docs, brand check and Ask AI read the report through readStudioAsset and the edited files.
    const read = await riley('studio:readStudioAsset', { assetId: 'asset-report' });
    expect(read).toMatchObject({ markdown, edited: { byName: 'Riley' } });
    expect(fs.readFileSync(path.join(dataDir, 'content-studio', 'runs', 'content-trend', 'asset-report.edited.md'), 'utf8')).toBe(markdown);
    expect(fs.readFileSync(path.join(dataDir, 'content-studio', 'runs', 'content-trend', 'asset-report.edited.html'), 'utf8')).toContain('Riley rewrote the opening.');
    expect(events('doc-update').map((entry) => [entry.to, entry.event.from.id])).toEqual([['member-chris', 'member-riley']]);
    const reopened = await chris('studio:openReportDoc', { assetId: 'asset-report', clientId: 'tab-chris' });
    const copy = new Y.Doc(); Y.applyUpdate(copy, Buffer.from(reopened.yState, 'base64'));
    expect(copy.getText('body').toString()).toBe('Riley rewrote the opening.');
    expect(reopened.versions.map((row) => [row.label, row.by.name])).toEqual([['Edited', 'Riley'], ['Original', 'Studio']]);
  });

  it('starts the shared document over when the report is edited elsewhere, and restores versions', async () => {
    const current = await riley('studio:readStudioAsset', { assetId: 'asset-report' });
    heard.length = 0;
    await chris('studio:editStudioAsset', { assetId: 'asset-report', markdown: '# Changed by Ask AI', baseEditedAt: current.asset.edited.at });
    expect(events('doc-update').filter((entry) => entry.event.reset).map((entry) => entry.to).sort()).toEqual(['member-chris', 'member-riley']);
    const opened = await riley('studio:openReportDoc', { assetId: 'asset-report', clientId: 'tab-riley-2' });
    expect(opened).toMatchObject({ yState: '', epoch: 1, markdown: '# Changed by Ask AI' });
    await expect(riley('studio:pushReportDocUpdate', { assetId: 'asset-report', clientId: 'tab-riley', markdown: 'stale' })).rejects.toMatchObject({ status: 409, code: 'docReset' });
    const restored = await riley('studio:restoreReportVersion', { assetId: 'asset-report', versionId: 'original' });
    expect(restored).toMatchObject({ epoch: 2, markdown: expect.stringContaining('AI Citation Tracking'), canEdit: true });
    expect((await riley('studio:readStudioAsset', { assetId: 'asset-report' })).edited).toBeNull();
  });

  it('lets a channel owner read and leave notes on their own channel’s briefs and assets, and never edit', async () => {
    const brief = await alex('studio:openReportDoc', { assetId: 'asset-toolkit', clientId: 'tab-alex' });
    expect(brief).toMatchObject({ assetId: 'asset-toolkit', canEdit: false, canNote: true });
    await expect(alex('studio:pushReportDocUpdate', { assetId: 'asset-toolkit', clientId: 'tab-alex', markdown: 'mine now' })).rejects.toMatchObject({ status: 403 });
    await expect(alex('studio:restoreReportVersion', { assetId: 'asset-toolkit', versionId: 'original' })).rejects.toMatchObject({ status: 403 });
    // Another channel's asset: neither open, read nor note.
    await expect(alex('studio:openReportDoc', { assetId: 'asset-kit-social' })).rejects.toMatchObject({ status: 403, message: 'That belongs to another channel.' });
    await expect(alex('studio:listReportNotes', { assetId: 'asset-kit-social' })).rejects.toMatchObject({ status: 403 });
    await expect(alex('studio:saveReportNote', { assetId: 'asset-kit-social', anchor: { yStart: '', yEnd: '', quote: 'Posts' }, body: 'Hi' })).rejects.toMatchObject({ status: 403 });
    const listed = await alex('studio:listReportNotes', { assetId: 'asset-toolkit' });
    expect(listed.notes).toEqual([]);
    expect(listed.mentionable.map((row) => row.id).sort()).toEqual(['member-alex', 'member-chris', 'member-riley', 'member-sam']); // a brief: everyone reads it
    const { note } = await alex('studio:saveReportNote', { assetId: 'asset-toolkit', anchor: { yStart: '', yEnd: '', quote: 'lead with the measurement gap' }, body: 'Can the Blog take this angle?', mentions: ['member-riley'], workspaceId: 'general' });
    expect(note).toMatchObject({ author: { id: 'member-alex', name: 'Alex' }, mentions: ['member-riley'] });
    // An editor can't change Alex's note, but may resolve it.
    await expect(riley('studio:saveReportNote', { assetId: 'asset-toolkit', noteId: note.id, body: 'Mine' })).rejects.toMatchObject({ status: 403, code: 'notYourNote' });
    expect(await riley('studio:resolveReportNote', { assetId: 'asset-toolkit', noteId: note.id, resolved: true })).toMatchObject({ note: { resolved: { by: { id: 'member-riley' } } } });
    await expect(chris('studio:deleteReportNote', { assetId: 'asset-toolkit', noteId: 'note-missing' })).rejects.toMatchObject({ status: 404 });
    await alex('studio:closeReportDoc', { assetId: 'asset-toolkit', clientId: 'tab-alex' });
    expect((await riley('studio:openReportDoc', { assetId: 'asset-toolkit', clientId: 'tab-riley-brief' })).editors.map((row) => row.id)).toEqual(['member-riley']);
    await riley('studio:closeReportDoc', { assetId: 'asset-toolkit', clientId: 'tab-riley-brief' });
    // Closing a report that's gone (deleted, or a switched workspace) is never refused: it only takes the channel
    // owner's own browser off it.
    expect(await alex('studio:closeReportDoc', { assetId: 'asset-removed', clientId: 'tab-alex' })).toEqual({ ok: true });
  });

  it('mentions only people who can read the report, and puts mentions and replies in their Inbox and counts on the rows', async () => {
    heard.length = 0;
    await riley('studio:openReportDoc', { assetId: 'asset-kit-social', clientId: 'tab-riley-social' });
    const listed = await sam('studio:listReportNotes', { assetId: 'asset-kit-social' });
    expect(listed.mentionable.map((row) => row.id).sort()).toEqual(['member-chris', 'member-riley', 'member-sam']); // not the Blog's owner
    const { note } = await sam('studio:saveReportNote', { assetId: 'asset-kit-social', anchor: { yStart: '', yEnd: '', quote: 'Posts for LinkedIn' }, body: 'Riley, is the X thread too long?', mentions: ['member-riley', 'member-alex'] });
    expect(note.mentions).toEqual(['member-riley']);
    // Riley (mentioned, and with the asset open) hears it; Alex, who can't read the asset, doesn't.
    expect(events('note-changed').map((entry) => entry.to)).toEqual(['member-riley']);
    const rileyState = await riley('state');
    expect(rileyState.contentStudio.noteCounts['asset-kit-social']).toEqual({ open: 1, total: 1 });
    // Alex's mention on the brief (earlier) and Sam's, newest first.
    expect(rileyState.contentStudio.noteMentions).toMatchObject([{ kind: 'mention', assetId: 'asset-kit-social', assetTitle: 'AI Citation Tracking social posts', noteId: note.id, by: { id: 'member-sam' }, read: false }, { kind: 'mention', assetId: 'asset-toolkit', by: { id: 'member-alex' }, read: false }]);
    // The Blog's owner sees counts only for their own channel's assets and the briefs.
    const alexState = await alex('state');
    expect(alexState.contentStudio.noteCounts).toEqual({ 'asset-toolkit': { open: 0, total: 1 } });
    expect(alexState.contentStudio.noteMentions).toEqual([]);
    // A reply reaches the note's author; opening the notes reads your own items.
    await riley('studio:saveReportNote', { assetId: 'asset-kit-social', replyTo: note.id, body: 'Trimmed it.' });
    expect((await sam('state')).contentStudio.noteMentions.map((item) => item.kind)).toEqual(['reply']);
    await riley('studio:listReportNotes', { assetId: 'asset-kit-social' });
    expect((await riley('state')).contentStudio.noteMentions.map((item) => [item.assetId, item.read])).toEqual([['asset-kit-social', true], ['asset-toolkit', false]]);
  });

  it('keeps an admin’s preview to reading', async () => {
    const preview = as(MEMBERS.chris, { role: 'editor' });
    expect(await preview('studio:openReportDoc', { assetId: 'asset-report' })).toMatchObject({ canEdit: false, canNote: false });
    await expect(preview('studio:pushReportDocUpdate', { assetId: 'asset-report', markdown: 'x' })).rejects.toMatchObject({ status: 403, code: 'preview' });
    await expect(preview('studio:saveReportNote', { assetId: 'asset-report', anchor: { yStart: '', yEnd: '', quote: 'x' }, body: 'x' })).rejects.toMatchObject({ status: 403, code: 'preview' });
  });
});
