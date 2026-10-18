// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

// The report editor's shared documents (src/main/report-docs.js): Yjs merges from several browsers, the Markdown
// written through the studio's edit path, versions and restore, presence and its timeouts, and who hears each event.
const require = createRequire(import.meta.url);
const Y = require('yjs');
const { createReportDocs, LIMITS } = require('../src/main/report-docs.js');

const roots = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const AT = Date.parse('2026-10-18T10:00:00.000Z');
const RILEY = { id: 'member-riley', name: 'Riley' };
const JORDAN = { id: 'member-jordan', name: 'Jordan' };
const ALEX = { id: 'member-alex', name: 'Alex' };
const b64 = (bytes) => Buffer.from(bytes).toString('base64');

// What report-docs needs from content-workspace, recording every Markdown write.
function fakeWorkspace() {
  const assets = {
    'asset-report': { id: 'asset-report', kind: 'text', deliverableId: 'evidence-report', title: 'AI Citation Tracking report', createdAt: '2026-10-10T10:00:00.000Z', workspaceId: 'semrush' },
    'asset-page': { id: 'asset-page', kind: 'text', deliverableId: 'landingpage', title: 'Landing page', createdAt: '2026-10-10T10:00:00.000Z', workspaceId: 'semrush' },
    'asset-picture': { id: 'asset-picture', kind: 'image', deliverableId: 'social-image', title: 'Picture', createdAt: '2026-10-10T10:00:00.000Z', workspaceId: 'semrush' },
  };
  const generated = { 'asset-report': '# AI Citation Tracking\n\nGenerated text.', 'asset-page': '<p>Page</p>' };
  const edits = new Map(); const writes = []; const cleared = [];
  return {
    writes, cleared, edits,
    findAsset: (id) => (assets[id] ? { asset: { ...assets[id], ...(edits.has(id) ? { edited: edits.get(id).meta } : {}) }, run: null } : null),
    readStudioAsset: ({ assetId }) => ({ markdown: edits.get(assetId)?.markdown ?? generated[assetId] }),
    writeReportMarkdown: ({ assetId, markdown, by, persist }) => { const at = new Date(AT).toISOString(); writes.push({ assetId, markdown, by, persist }); edits.set(assetId, { markdown, meta: { at, by } }); return { savedAt: at }; },
    clearReportEdits: ({ assetId, by }) => { cleared.push({ assetId, by }); edits.delete(assetId); },
  };
}
function harness({ live = () => true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'report-docs-')); roots.push(root);
  const workspace = fakeWorkspace(); const sent = []; const versions = []; let now = AT;
  const make = () => createReportDocs({ root, workspace, push: (identityId, event) => sent.push({ to: identityId, ...event }), isLive: live, onVersion: (row) => versions.push(row), clock: () => new Date(now), log: () => {} });
  const docs = make();
  return { root, workspace, sent, versions, docs, make, tick: (ms) => { now += ms; }, now: () => now };
}
// A browser: its own Y.Doc, seeded from the opened state, sending what the server hasn't had yet.
function browser(opened) {
  const doc = new Y.Doc();
  if (opened.yState) Y.applyUpdate(doc, Buffer.from(opened.yState, 'base64'));
  let synced = Y.encodeStateVector(doc);
  return {
    doc, clientId: String(doc.clientID),
    type(text, at = doc.getText('body').length) { doc.getText('body').insert(at, text); },
    pending() { const update = Y.encodeStateAsUpdate(doc, synced); synced = Y.encodeStateVector(doc); return b64(update); },
    receive(update) { Y.applyUpdate(doc, Buffer.from(update, 'base64')); },
    text: () => doc.getText('body').toString(),
    vector: () => b64(Y.encodeStateVector(doc)),
  };
}
const serverText = (yState) => { const doc = new Y.Doc(); Y.applyUpdate(doc, Buffer.from(yState, 'base64')); return doc.getText('body').toString(); };

describe('opening a report', () => {
  it('answers with the Markdown, no Yjs state yet, the original version and who has it open', () => {
    const h = harness();
    const opened = h.docs.open({ assetId: 'asset-report', clientId: 'tab-1' }, RILEY, { canEdit: true, canNote: true });
    expect(opened).toMatchObject({ assetId: 'asset-report', title: 'AI Citation Tracking report', markdown: '# AI Citation Tracking\n\nGenerated text.', yState: '', version: 0, epoch: 0, canEdit: true, canNote: true, awareness: [] });
    expect(opened.versions).toEqual([{ id: 'original', at: '2026-10-10T10:00:00.000Z', by: { id: 'system', name: 'Studio' }, label: 'Original' }]);
    expect(opened.editors).toEqual([{ id: 'member-riley', name: 'Riley', color: expect.stringMatching(/^#[0-9A-F]{6}$/) }]);
    // A landing page opens to read, never to edit; a picture doesn't open at all.
    expect(h.docs.open({ assetId: 'asset-page' }, RILEY, { canEdit: true }).canEdit).toBe(false);
    expect(() => h.docs.open({ assetId: 'asset-picture' }, RILEY)).toThrow(/Only written reports and drafts/);
    expect(() => h.docs.open({ assetId: '../state' }, RILEY)).toThrow(/Choose a report/);
    expect(() => h.docs.open({ assetId: 'asset-gone' }, RILEY)).toThrow(/isn’t in this workspace/);
  });

  it('keeps an edit made before the editor existed as the first version', () => {
    const h = harness();
    h.workspace.edits.set('asset-report', { markdown: '# Edited by hand', meta: { at: '2026-10-12T09:00:00.000Z', by: { id: 'member-chris', name: 'Chris' } } });
    const opened = h.docs.open({ assetId: 'asset-report' }, RILEY);
    expect(opened.versions.map((row) => row.label)).toEqual(['Saved edit', 'Original']);
    expect(opened.versions[0]).toMatchObject({ at: '2026-10-12T09:00:00.000Z', by: { id: 'member-chris', name: 'Chris' } });
  });
});

describe('editing together', () => {
  it('merges concurrent changes from two browsers into one document and sends each to the other', () => {
    const h = harness();
    const a = browser(h.docs.open({ assetId: 'asset-report', clientId: 'tab-a' }, RILEY));
    const b = browser(h.docs.open({ assetId: 'asset-report', clientId: 'tab-b' }, JORDAN));
    a.type('Riley’s intro. '); b.type('Jordan’s summary.');
    h.sent.length = 0;
    const first = h.docs.push({ assetId: 'asset-report', clientId: 'tab-a', update: a.pending(), markdown: 'Riley’s intro.' }, RILEY);
    const second = h.docs.push({ assetId: 'asset-report', clientId: 'tab-b', update: b.pending(), markdown: 'Jordan’s summary.' }, JORDAN);
    expect(first.version).toBe(1); expect(second.version).toBe(2);
    const record = JSON.parse(fs.readFileSync(path.join(h.root, 'report-docs', 'asset-report.json'), 'utf8'));
    const merged = serverText(record.yState);
    expect(merged).toContain('Riley’s intro. '); expect(merged).toContain('Jordan’s summary.');
    // Each change went to the other person only, never back to the browser that sent it.
    const updates = h.sent.filter((event) => event.type === 'doc-update');
    expect(updates.map((event) => [event.to, event.from.id, event.clientId])).toEqual([['member-jordan', 'member-riley', 'tab-a'], ['member-riley', 'member-jordan', 'tab-b']]);
    for (const event of updates) (event.to === 'member-riley' ? a : b).receive(event.update);
    expect(a.text()).toBe(b.text()); expect(a.text()).toBe(merged);
    // A repeat of a change already merged changes nothing and is sent to nobody.
    h.sent.length = 0;
    const again = h.docs.push({ assetId: 'asset-report', clientId: 'tab-a', update: updates[1].update }, RILEY);
    expect(again.version).toBe(2); expect(h.sent).toEqual([]);
  });

  it('saves and sends a deletion on its own (it leaves the state vector as it was)', () => {
    const h = harness();
    const a = browser(h.docs.open({ assetId: 'asset-report', clientId: 'tab-a' }, RILEY));
    const b = browser(h.docs.open({ assetId: 'asset-report', clientId: 'tab-b' }, JORDAN));
    a.type('Keep this. Cut this.');
    h.docs.push({ assetId: 'asset-report', clientId: 'tab-a', update: a.pending() }, RILEY);
    b.receive(h.sent.filter((event) => event.type === 'doc-update').at(-1).update);
    h.sent.length = 0;
    a.doc.getText('body').delete(10, 10);
    const result = h.docs.push({ assetId: 'asset-report', clientId: 'tab-a', update: a.pending(), markdown: 'Keep this.' }, RILEY);
    expect(result.version).toBe(2);
    const record = JSON.parse(fs.readFileSync(path.join(h.root, 'report-docs', 'asset-report.json'), 'utf8'));
    expect(serverText(record.yState)).toBe('Keep this.');
    const sent = h.sent.filter((event) => event.type === 'doc-update');
    expect(sent.map((event) => event.to)).toEqual(['member-jordan']);
    b.receive(sent[0].update);
    expect(b.text()).toBe('Keep this.');
  });

  it('sends a change to the sender’s own other browser, and relays carets as they came', () => {
    const h = harness();
    const a = browser(h.docs.open({ assetId: 'asset-report', clientId: 'tab-a' }, RILEY));
    h.docs.open({ assetId: 'asset-report', clientId: 'tab-a2' }, RILEY);
    h.docs.open({ assetId: 'asset-report', clientId: 'tab-x' }, ALEX);
    h.sent.length = 0;
    a.type('Hello');
    h.docs.push({ assetId: 'asset-report', clientId: 'tab-a', update: a.pending(), awareness: b64(Buffer.from('caret-a')) }, RILEY);
    expect(h.sent.filter((event) => event.type === 'doc-update').map((event) => event.to).sort()).toEqual(['member-alex', 'member-riley']);
    expect(h.sent.find((event) => event.type === 'doc-update').awareness).toBe(b64(Buffer.from('caret-a')));
    // A caret move alone reaches the others as presence; someone who opens later gets the latest carets.
    h.sent.length = 0;
    h.docs.push({ assetId: 'asset-report', clientId: 'tab-a', awareness: b64(Buffer.from('caret-moved')) }, RILEY);
    expect(h.sent).toEqual(expect.arrayContaining([expect.objectContaining({ to: 'member-alex', type: 'doc-presence', awareness: b64(Buffer.from('caret-moved')) })]));
    expect(h.docs.open({ assetId: 'asset-report', clientId: 'tab-j' }, JORDAN).awareness).toEqual([b64(Buffer.from('caret-moved'))]);
  });

  it('refuses changes that aren’t strict base64 Yjs updates, or are too large', () => {
    const h = harness();
    h.docs.open({ assetId: 'asset-report', clientId: 'tab-a' }, RILEY);
    expect(() => h.docs.push({ assetId: 'asset-report', clientId: 'tab-a', update: 'not base64!' }, RILEY)).toThrow(expect.objectContaining({ status: 400, code: 'docUpdateInvalid' }));
    expect(() => h.docs.push({ assetId: 'asset-report', clientId: 'tab-a', update: b64(Buffer.from([255, 255, 255, 255, 1, 2, 3])) }, RILEY)).toThrow(expect.objectContaining({ code: 'docUpdateInvalid' }));
    const huge = 'A'.repeat(Math.ceil((LIMITS.updateBytes + 10) / 3) * 4);
    expect(() => h.docs.push({ assetId: 'asset-report', clientId: 'tab-a', update: huge }, RILEY)).toThrow(expect.objectContaining({ status: 413, code: 'docTooLarge' }));
    expect(() => h.docs.push({ assetId: 'asset-report', clientId: 'tab-a', markdown: 'x'.repeat(LIMITS.markdownChars + 1) }, RILEY)).toThrow(/under 250,000/);
    expect(() => h.docs.push({ assetId: 'asset-page', clientId: 'tab-a', markdown: 'x' }, RILEY)).toThrow(/Landing pages/);
    expect(h.workspace.writes).toEqual([]);
  });
});

describe('the Markdown everything else reads', () => {
  it('is written through the edit path, saving state.json on the first edit, every minute and on close', () => {
    const h = harness();
    const a = browser(h.docs.open({ assetId: 'asset-report', clientId: 'tab-a' }, RILEY));
    a.type('One');
    h.docs.push({ assetId: 'asset-report', clientId: 'tab-a', update: a.pending(), markdown: '# One' }, RILEY);
    h.tick(1500); a.type(' two');
    h.docs.push({ assetId: 'asset-report', clientId: 'tab-a', update: a.pending(), markdown: '# One two' }, RILEY);
    h.tick(1500);
    // The same Markdown again is not written again.
    h.docs.push({ assetId: 'asset-report', clientId: 'tab-a', markdown: '# One two' }, RILEY);
    h.tick(LIMITS.persistEveryMs); a.type(' three');
    h.docs.push({ assetId: 'asset-report', clientId: 'tab-a', update: a.pending(), markdown: '# One two three' }, RILEY);
    h.docs.push({ assetId: 'asset-report', clientId: 'tab-a', markdown: '# One two three', final: true }, RILEY);
    expect(h.workspace.writes.map((row) => [row.markdown, row.persist])).toEqual([['# One', true], ['# One two', false], ['# One two three', true], ['# One two three', true]]);
    expect(h.workspace.writes[0].by).toEqual(RILEY);
    // A blank document never replaces the report.
    expect(h.docs.push({ assetId: 'asset-report', clientId: 'tab-a', markdown: '   ' }, RILEY).markdownSaved).toBe(false);
  });

  it('waits for a browser that hasn’t seen everyone’s changes yet (stateVector) before taking its Markdown', () => {
    const h = harness();
    const a = browser(h.docs.open({ assetId: 'asset-report', clientId: 'tab-a' }, RILEY));
    const b = browser(h.docs.open({ assetId: 'asset-report', clientId: 'tab-b' }, JORDAN));
    a.type('From Riley. ');
    h.docs.push({ assetId: 'asset-report', clientId: 'tab-a', update: a.pending(), markdown: 'From Riley.', stateVector: a.vector() }, RILEY);
    b.type('From Jordan.');
    const behind = h.docs.push({ assetId: 'asset-report', clientId: 'tab-b', update: b.pending(), markdown: 'From Jordan.', stateVector: b.vector() }, JORDAN);
    expect(behind.markdownSaved).toBe(false);
    const toJordan = h.sent.find((event) => event.type === 'doc-update' && event.to === 'member-jordan');
    b.receive(toJordan.update);
    const caughtUp = h.docs.push({ assetId: 'asset-report', clientId: 'tab-b', markdown: `Both: ${b.text()}`, stateVector: b.vector() }, JORDAN);
    expect(caughtUp.markdownSaved).toBe(true);
    expect(h.workspace.writes.map((row) => row.markdown)).toEqual(['From Riley.', `Both: ${b.text()}`]);
  });
});

describe('versions and restore', () => {
  it('keeps a version per editor at most every five minutes and when they close, last 50 plus the original', () => {
    const h = harness();
    const a = browser(h.docs.open({ assetId: 'asset-report', clientId: 'tab-a' }, RILEY));
    const edit = (text, extra = {}) => { a.type(text); return h.docs.push({ assetId: 'asset-report', clientId: 'tab-a', update: a.pending(), markdown: a.text(), ...extra }, RILEY); };
    edit('a'); h.tick(60000); edit('b'); h.tick(60000); edit('c');
    let opened = h.docs.open({ assetId: 'asset-report', clientId: 'tab-a' }, RILEY);
    expect(opened.versions.map((row) => row.label)).toEqual(['Edited', 'Original']);
    h.tick(LIMITS.versionEveryMs); edit('d');
    edit('e', { final: true });
    // Closing with nothing new since the last save keeps no extra version.
    h.docs.push({ assetId: 'asset-report', clientId: 'tab-a', final: true }, RILEY);
    opened = h.docs.open({ assetId: 'asset-report', clientId: 'tab-a' }, RILEY);
    expect(opened.versions.map((row) => row.label)).toEqual(['Edited', 'Edited', 'Edited', 'Original']);
    expect(opened.versions[0].by).toEqual(RILEY);
    expect(h.versions.every((row) => row.kind === 'edit' && row.by.id === 'member-riley')).toBe(true);
    for (let index = 0; index < 60; index++) edit(String(index % 10), { final: true });
    opened = h.docs.open({ assetId: 'asset-report', clientId: 'tab-a' }, RILEY);
    expect(opened.versions).toHaveLength(LIMITS.keepVersions + 1);
    expect(opened.versions.at(-1).id).toBe('original');
    expect(fs.readdirSync(path.join(h.root, 'report-docs', 'asset-report.versions'))).toHaveLength(LIMITS.keepVersions);
  });

  it('restores a version for everyone: the Markdown is written, the document starts over and stale browsers are refused', () => {
    const h = harness();
    const a = browser(h.docs.open({ assetId: 'asset-report', clientId: 'tab-a' }, RILEY));
    const b = browser(h.docs.open({ assetId: 'asset-report', clientId: 'tab-b' }, JORDAN));
    a.type('First draft.');
    h.docs.push({ assetId: 'asset-report', clientId: 'tab-a', update: a.pending(), markdown: 'First draft.', final: true }, RILEY);
    const firstVersion = h.docs.open({ assetId: 'asset-report', clientId: 'tab-a' }, RILEY).versions[0];
    h.tick(LIMITS.versionEveryMs); a.type(' Second thoughts.');
    h.docs.push({ assetId: 'asset-report', clientId: 'tab-a', update: a.pending(), markdown: a.text(), final: true }, RILEY);
    h.sent.length = 0;
    const restored = h.docs.restore({ assetId: 'asset-report', versionId: firstVersion.id }, JORDAN, { canEdit: true, canNote: true });
    expect(restored).toMatchObject({ markdown: 'First draft.', epoch: 1, canEdit: true });
    expect(serverText(restored.yState)).toBe('First draft.');
    expect(restored.versions.slice(0, 1).map((row) => [row.label, row.by.id])).toEqual([['Restored an earlier version', 'member-jordan']]);
    expect(h.workspace.writes.at(-1)).toMatchObject({ markdown: 'First draft.', persist: true, by: JORDAN });
    // Everyone with it open is told to reopen it.
    expect(h.sent.filter((event) => event.type === 'doc-update' && event.reset).map((event) => event.to).sort()).toEqual(['member-jordan', 'member-riley']);
    // A browser from before the restore is refused, by its epoch or by its client id; a reopened one is not.
    a.type(' Old tab.');
    expect(() => h.docs.push({ assetId: 'asset-report', clientId: 'tab-a', update: a.pending(), markdown: 'old' }, RILEY)).toThrow(expect.objectContaining({ status: 409, code: 'docReset' }));
    expect(() => h.docs.push({ assetId: 'asset-report', clientId: 'tab-b', markdown: 'old', epoch: 0 }, JORDAN)).toThrow(expect.objectContaining({ code: 'docReset' }));
    const fresh = browser(h.docs.open({ assetId: 'asset-report', clientId: 'tab-a-new' }, RILEY));
    expect(fresh.text()).toBe('First draft.');
    fresh.type(' Better.');
    expect(h.docs.push({ assetId: 'asset-report', clientId: 'tab-a-new', update: fresh.pending(), markdown: fresh.text(), epoch: 1 }, RILEY).markdownSaved).toBe(true);
    void b;
  });

  it('restores the original through the studio’s own Restore and keeps what was there as a version first', () => {
    const h = harness();
    const a = browser(h.docs.open({ assetId: 'asset-report', clientId: 'tab-a' }, RILEY));
    a.type('Rewritten.');
    h.docs.push({ assetId: 'asset-report', clientId: 'tab-a', update: a.pending(), markdown: 'Rewritten.' }, RILEY);
    h.tick(1000); a.type(' More.');
    h.docs.push({ assetId: 'asset-report', clientId: 'tab-a', update: a.pending(), markdown: 'Rewritten. More.' }, RILEY);
    const restored = h.docs.restore({ assetId: 'asset-report', versionId: 'original' }, RILEY, { canEdit: true });
    expect(h.workspace.cleared).toEqual([{ assetId: 'asset-report', by: RILEY }]);
    expect(restored).toMatchObject({ markdown: '# AI Citation Tracking\n\nGenerated text.', yState: '', epoch: 1 });
    expect(restored.versions.map((row) => row.label)).toEqual(['Restored the original', 'Before a restore', 'Edited', 'Original']);
    expect(() => h.docs.restore({ assetId: 'asset-report', versionId: 'ver-zz-000000' }, RILEY)).toThrow(/isn’t kept anymore/);
    expect(() => h.docs.restore({ assetId: 'asset-report', versionId: '../x' }, RILEY)).toThrow(/Choose a version/);
  });

  it('starts over when the report is changed outside the editor, and ignores reports never opened in it', () => {
    const h = harness();
    h.docs.outsideEdit({ assetId: 'asset-report', kind: 'edited', markdown: 'Ask AI edit', by: RILEY });
    expect(fs.existsSync(path.join(h.root, 'report-docs', 'asset-report.json'))).toBe(false);
    const a = browser(h.docs.open({ assetId: 'asset-report', clientId: 'tab-a' }, RILEY));
    a.type('Typed.');
    h.docs.push({ assetId: 'asset-report', clientId: 'tab-a', update: a.pending(), markdown: 'Typed.' }, RILEY);
    h.sent.length = 0;
    h.docs.outsideEdit({ assetId: 'asset-report', kind: 'edited', markdown: 'Ask AI edit', by: { id: 'member-chris', name: 'Chris' } });
    expect(h.sent).toEqual([expect.objectContaining({ to: 'member-riley', type: 'doc-update', reset: true, epoch: 1, from: expect.objectContaining({ id: 'member-chris' }) })]);
    const reopened = h.docs.open({ assetId: 'asset-report', clientId: 'tab-b' }, RILEY);
    expect(reopened).toMatchObject({ yState: '', epoch: 1 });
    // Riley's typing was already kept (a first save keeps a version), so nothing more is kept before the change.
    expect(reopened.versions.map((row) => row.label)).toEqual(['Changed outside the editor', 'Edited', 'Original']);
    // The document survives a restart of the studio.
    const again = h.make().open({ assetId: 'asset-report', clientId: 'tab-c' }, RILEY);
    expect(again).toMatchObject({ epoch: 1, version: reopened.version });
    expect(again.versions.map((row) => row.id)).toEqual(reopened.versions.map((row) => row.id));
  });
});

describe('who has a report open', () => {
  it('tells everyone when someone opens or closes it, and lets a silent browser go after its timeout', () => {
    let alexLive = true;
    const h = harness({ live: (id) => id === 'member-alex' && alexLive });
    h.docs.open({ assetId: 'asset-report', clientId: 'tab-r' }, RILEY);
    h.sent.length = 0;
    h.docs.open({ assetId: 'asset-report', clientId: 'tab-x' }, ALEX);
    expect(h.sent.map((event) => [event.to, event.type, event.editors.map((row) => row.id)])).toEqual([['member-riley', 'doc-presence', ['member-riley', 'member-alex']], ['member-alex', 'doc-presence', ['member-riley', 'member-alex']]]);
    // A live connection keeps a quiet reader listed; without one they leave two minutes after their last change.
    h.tick(LIMITS.idleMs + 1000); h.sent.length = 0; h.docs.sweep(h.now());
    expect(h.docs.editorsOf('asset-report').map((row) => row.id)).toEqual(['member-alex']);
    alexLive = false; h.docs.sweep(h.now());
    expect(h.docs.editorsOf('asset-report')).toEqual([]);
    // Closing without a client id takes all of that person's browsers off the report.
    h.docs.open({ assetId: 'asset-report', clientId: 'tab-r1' }, RILEY); h.docs.open({ assetId: 'asset-report', clientId: 'tab-r2' }, RILEY); h.docs.open({ assetId: 'asset-report', clientId: 'tab-j' }, JORDAN);
    h.sent.length = 0;
    expect(h.docs.close({ assetId: 'asset-report' }, RILEY)).toEqual({ ok: true });
    expect(h.docs.presentIds('asset-report')).toEqual(['member-jordan']);
    expect(h.sent).toEqual([expect.objectContaining({ to: 'member-jordan', type: 'doc-presence', editors: [expect.objectContaining({ id: 'member-jordan' })] })]);
  });

  it('keeps a version of what someone changed when their browser goes quiet without closing', () => {
    const h = harness({ live: () => false });
    const a = browser(h.docs.open({ assetId: 'asset-report', clientId: 'tab-a' }, RILEY));
    a.type('x'); h.docs.push({ assetId: 'asset-report', clientId: 'tab-a', update: a.pending(), markdown: 'x' }, RILEY);
    h.tick(30000); a.type('y'); h.docs.push({ assetId: 'asset-report', clientId: 'tab-a', update: a.pending(), markdown: 'xy' }, RILEY);
    h.tick(LIMITS.idleMs + 1000); h.docs.sweep(h.now());
    expect(h.docs.open({ assetId: 'asset-report', clientId: 'tab-b' }, JORDAN).versions.map((row) => row.label)).toEqual(['Edited', 'Edited', 'Original']);
  });
});
