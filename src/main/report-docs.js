'use strict';
// The report editor's shared documents (wave 3C; docs/roles-and-access.md, ARCHITECTURE.md → Report editor and notes).
// Every written report or draft opened in the editor has a Yjs document here: the merged state of everyone's changes
// (content-studio/report-docs/<assetId>.json), its versions (<assetId>.versions/<versionId>.json: the Markdown, plus the
// Yjs state while it is under 2 MB) and, in memory only, who has it open. The browser builds and edits the document; the
// server never reads its structure. It checks and merges each change (strict base64, size caps), saves the Markdown the
// browser rendered through the studio's own edit path (content-workspace writeReportMarkdown, so kits, exports, Google
// Docs, brand check and Ask AI read the edit), keeps a version at most every 5 minutes per editor and whenever an editor
// closes, and sends each change to everyone else who has the report open (push: index.js pushPersonEvent).
//
// A restore, or an edit made outside the editor (Ask AI's report change, Restore original elsewhere), starts the document
// over: its epoch goes up, its Yjs state becomes the restored version's (or empty: the first browser to open it builds
// it from the Markdown), and everyone with it open hears { type: 'doc-update', reset: true } and reopens. A change made
// before the reset is refused (409 docReset) rather than bringing the old text back: by the epoch the browser opened, when
// it sends one, and otherwise by its clientId (each browser's Yjs client id): a browser that wrote or opened the report
// before the reset is retired. A browser's caret travels as a y-protocols awareness update (payload.awareness), relayed
// to the others as it is; the server never decodes it.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Y = require('yjs');
const { renameDurable } = require('../shared/durable-write');

const LIMITS = Object.freeze({
  updateBytes: 2 * 1024 * 1024, // one change
  docBytes: 8 * 1024 * 1024, // the merged document
  versionStateBytes: 2 * 1024 * 1024, // a version keeps its Yjs state up to this size; its Markdown always
  markdownChars: 250000, // content-workspace's limit for an edit
  versionEveryMs: 5 * 60000, // per editor
  keepVersions: 50, // plus the original (the generated report), which is never pruned
  persistEveryMs: 60000, // how often asset.edited is saved to state.json while someone types (the files every time)
  idleMs: 2 * 60000, // presence without a change and without a live connection
  openMs: 30 * 60000, // presence with a live connection but no change
  keepInMemoryMs: 10 * 60000,
  sweepMs: 30000,
  awarenessBytes: 64 * 1024, // one browser's caret and name (y-protocols awareness update)
  retiredClients: 500, // browsers remembered as having written before a reset
});
// Soft cursor and avatar colours, picked by a hash of the person's id so they stay put between visits.
const COLORS = Object.freeze(['#4F7FE8', '#E0703F', '#2F9E6E', '#A35FD6', '#C99415', '#D9527F', '#2795A8', '#6E7A99']);
const ID = /^[a-zA-Z0-9_-]{1,180}$/;
const VERSION_ID = /^(?:original|ver-[a-z0-9]{1,16}-[a-f0-9]{6})$/;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const CLIENT_ID = /^[A-Za-z0-9_.:-]{1,100}$/;
const SYSTEM = Object.freeze({ id: 'system', name: 'Studio' });

const fail = (message, status = 400, code) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
const list = (value) => (Array.isArray(value) ? value : []);
const time = (value) => { const ms = Date.parse(value || ''); return Number.isFinite(ms) ? ms : 0; };
const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const hashOf = (text) => crypto.createHash('sha256').update(String(text || '')).digest('hex').slice(0, 32);
const colorOf = (id) => COLORS[crypto.createHash('sha256').update(String(id)).digest()[0] % COLORS.length];
const bytesOf = (base64) => Math.floor((String(base64 || '').length * 3) / 4);
const person = (value) => ({ id: String(value?.id || 'local').slice(0, 180), name: String(value?.name || '').slice(0, 120) || 'Someone' });
const cleanClient = (value) => { const text = typeof value === 'number' && Number.isFinite(value) ? String(value) : typeof value === 'string' ? value.trim() : ''; return CLIENT_ID.test(text) ? text : 'default'; };
const unreadable = () => fail('That change couldn’t be read. Reload the report and try again.', 400, 'docUpdateInvalid');

// Strict base64 (what Buffer.from would silently skip is refused), at most `max` bytes once decoded.
function decode64(value, max) {
  if (typeof value !== 'string' || value.length % 4 !== 0 || !BASE64.test(value)) throw unreadable();
  if (bytesOf(value) > max) throw fail('That change is too large to save in one go. Reload the report and try again.', 413, 'docTooLarge');
  return new Uint8Array(Buffer.from(value, 'base64'));
}
// Whether a state vector (the browser's, sent with its change) includes everything the server's document has: only then
// is the Markdown it rendered the whole document.
function covers(theirs, ours) {
  for (const [client, clock] of ours) if ((theirs.get(client) || 0) < clock) return false;
  return true;
}
function defaultWriteJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  const fd = fs.openSync(temp, 'w', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  renameDurable(temp, file); // retried on Windows while a scanner holds the file
}

// workspace: content-workspace (findAsset, readStudioAsset, writeReportMarkdown, clearReportEdits). push(identityId,
// event): index.js pushPersonEvent. isLive(identityId): whether that person still has a live connection (the browser
// studio's event streams; always true on the Mac). onVersion({ assetId, kind, by }): the activity log.
function createReportDocs({ root, workspace, push = () => {}, isLive = () => true, onVersion = () => {}, writeJson = defaultWriteJson, clock = () => new Date(), log = (message) => console.warn(message) } = {}) {
  if (!root || !workspace) throw new Error('Report documents need the studio folder and the content workspace.');
  const dir = path.join(root, 'report-docs');
  const docFile = (assetId) => path.join(dir, `${assetId}.json`);
  const versionFile = (assetId, versionId) => path.join(dir, `${assetId}.versions`, `${versionId}.json`);
  const nowMs = () => new Date(clock()).getTime();
  const stamp = () => new Date(nowMs()).toISOString();
  const docs = new Map(); // assetId → { record, ydoc, usedAt, dirty: Set(identityId) }
  const presence = new Map(); // assetId → Map(identityId → { id, name, color, since, clients: Map(clientId → { at, epoch, awareness }) })
  const opened = new Map(); // `${assetId}\n${identityId}\n${clientId}` → the epoch that browser opened (outlives presence)
  let timer = null;

  // ---------- Assets ----------
  function assetOf(assetId, { edit = false } = {}) {
    if (typeof assetId !== 'string' || !ID.test(assetId)) throw fail('Choose a report to open.', 400);
    const found = workspace.findAsset(assetId);
    if (!found) throw fail('That report isn’t in this workspace anymore.', 404);
    if (found.asset.kind !== 'text') throw fail('Only written reports and drafts open in the editor.', 400);
    if (edit && found.asset.deliverableId === 'landingpage') throw fail('Landing pages can’t be edited here.', 400);
    return found.asset;
  }
  const currentMarkdown = (assetId) => String(workspace.readStudioAsset({ assetId })?.markdown || '');

  // ---------- Storage ----------
  const blank = (assetId) => ({ v: 1, assetId, epoch: 0, version: 0, yState: '', markdown: '', savedAt: '', savedBy: null, persistedAt: '', versions: [], lastVersionAt: {}, writers: [], retired: [] });
  function readRecord(assetId) {
    let raw;
    try { raw = fs.readFileSync(docFile(assetId), 'utf8'); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    try {
      const record = JSON.parse(raw);
      if (!record || typeof record !== 'object' || record.assetId !== assetId) throw new Error('not a report document');
      return { ...blank(assetId), ...record, versions: list(record.versions).filter((row) => row && VERSION_ID.test(row.id)), lastVersionAt: record.lastVersionAt && typeof record.lastVersionAt === 'object' ? record.lastVersionAt : {}, writers: list(record.writers).filter((id) => typeof id === 'string'), retired: list(record.retired).filter((id) => typeof id === 'string') };
    } catch (error) {
      // The Markdown in the edited files is the report, so a damaged document is put aside and started over from it.
      const aside = `${docFile(assetId)}.bad-${Date.now()}`;
      try { fs.renameSync(docFile(assetId), aside); } catch (_) { /* started over either way */ }
      log(`A report document could not be read and was put aside (${path.basename(aside)}): ${error.message}`);
      return null;
    }
  }
  const saveRecord = (entry) => writeJson(docFile(entry.record.assetId), entry.record);
  function docFrom(yState) {
    const ydoc = new Y.Doc({ gc: true });
    if (yState) { try { Y.applyUpdate(ydoc, decode64(yState, LIMITS.docBytes)); } catch (_) { return null; } }
    return ydoc;
  }
  // The document in memory, read (or started) on first use. A report edited before the editor existed keeps that edit as
  // its first version ("Saved edit"), so Restore can always go back to it as well as to the original.
  function load(assetId, asset = null) {
    const hit = docs.get(assetId);
    if (hit) { hit.usedAt = nowMs(); return hit; }
    let record = readRecord(assetId); let fresh = false;
    if (!record) { record = blank(assetId); fresh = true; }
    let ydoc = docFrom(record.yState);
    if (!ydoc) { log(`A report document's saved state could not be read; it starts over from the Markdown (${assetId}).`); record.yState = ''; record.epoch += 1; ydoc = docFrom(''); fresh = true; }
    const entry = { record, ydoc, usedAt: nowMs(), dirty: new Set() };
    if (fresh) {
      const source = asset || assetOf(assetId);
      if (source.edited?.at && !record.versions.length) {
        const markdown = currentMarkdown(assetId); record.markdown = markdown;
        addVersion(entry, { kind: 'saved', label: 'Saved edit', by: person(source.edited.by), at: source.edited.at, markdown, yState: '' });
      }
      saveRecord(entry);
    }
    docs.set(assetId, entry);
    return entry;
  }
  function addVersion(entry, { kind, label, by, markdown, yState = entry.record.yState, at = stamp() }) {
    const { record } = entry;
    const id = `ver-${nowMs().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
    writeJson(versionFile(record.assetId, id), { markdown: String(markdown || ''), yState: bytesOf(yState) <= LIMITS.versionStateBytes ? yState : '' });
    record.versions.unshift({ id, at, by: person(by), label, kind, hash: hashOf(markdown) });
    while (record.versions.length > LIMITS.keepVersions) { const gone = record.versions.pop(); fs.rmSync(versionFile(record.assetId, gone.id), { force: true }); }
    try { onVersion({ assetId: record.assetId, kind, by: person(by) }); } catch (_) { /* the log never stops a save */ }
    return id;
  }
  function readVersion(assetId, versionId) {
    try { const saved = JSON.parse(fs.readFileSync(versionFile(assetId, versionId), 'utf8')); return { markdown: String(saved?.markdown || ''), yState: typeof saved?.yState === 'string' ? saved.yState : '' }; }
    catch (_) { throw fail('That version can’t be read anymore. Choose another one.', 404); }
  }
  // What is there now, kept as a version before a restore or an outside edit replaces it, unless the newest version holds it.
  function keepCurrent(entry, markdown, by, label) {
    if (!markdown.trim() || entry.record.versions[0]?.hash === hashOf(markdown)) return;
    addVersion(entry, { kind: 'before', label, by, markdown });
  }
  // Starts the document over at a new epoch (see the top of the file).
  function reset(entry, yState) {
    const { record } = entry; const open = [];
    for (const who of peopleOn(record.assetId).values()) for (const clientId of who.clients.keys()) if (clientId !== 'default') open.push(clientId);
    record.retired = [...new Set([...record.writers, ...open, ...record.retired])].slice(0, LIMITS.retiredClients); record.writers = [];
    for (const key of [...opened.keys()]) if (key.startsWith(`${record.assetId}\n`)) opened.delete(key);
    entry.ydoc.destroy();
    const restored = docFrom(yState);
    entry.ydoc = restored || docFrom('');
    entry.record.yState = restored ? yState : '';
    entry.record.epoch += 1; entry.record.version += 1; entry.dirty.clear();
  }

  // ---------- Presence ----------
  const peopleOn = (assetId) => presence.get(assetId) || new Map();
  function editorsOf(assetId) {
    return [...peopleOn(assetId).values()].sort((a, b) => a.since - b.since).map(({ id, name, color }) => ({ id, name, color }));
  }
  // The other browsers' latest carets, for someone who just opened the report.
  function awarenessOf(assetId, exceptClient = '') {
    const out = [];
    for (const entry of peopleOn(assetId).values()) for (const [clientId, client] of entry.clients) if (client.awareness && clientId !== exceptClient) out.push(client.awareness);
    return out;
  }
  function announce(assetId, extra = {}, skip = null) {
    const event = { type: 'doc-presence', assetId, editors: editorsOf(assetId), ...extra };
    for (const [id, entry] of peopleOn(assetId)) if (!skip || !skip(id, entry)) push(id, event);
  }
  // Registers (or refreshes) one browser of one person on a report; true when a new person joined.
  function join(assetId, who, clientId, epoch, awareness = null) {
    let people = presence.get(assetId); if (!people) { people = new Map(); presence.set(assetId, people); }
    let entry = people.get(who.id); let joined = false;
    if (!entry) { entry = { id: who.id, name: who.name, color: colorOf(who.id), since: nowMs(), clients: new Map() }; people.set(who.id, entry); joined = true; }
    const before = entry.clients.get(clientId);
    entry.clients.set(clientId, { at: nowMs(), epoch, awareness: awareness || before?.awareness || '' });
    if (clientId !== 'default') { opened.set(`${assetId}\n${who.id}\n${clientId}`, epoch); if (opened.size > 5000) opened.delete(opened.keys().next().value); }
    return joined;
  }
  // A person's last browser leaving, or timing out, keeps a version of what they changed since their last one.
  function leave(assetId, identityId, clientId) {
    const people = presence.get(assetId); const entry = people?.get(identityId);
    if (!entry || !entry.clients.delete(clientId)) return false;
    if (!entry.clients.size) { people.delete(identityId); versionOnLeave(assetId, entry); }
    if (!people.size) presence.delete(assetId);
    return true;
  }
  function versionOnLeave(assetId, who) {
    const entry = docs.get(assetId);
    if (!entry?.dirty.has(who.id)) return;
    entry.dirty.delete(who.id); entry.record.lastVersionAt[who.id] = stamp();
    addVersion(entry, { kind: 'edit', label: 'Edited', by: who, markdown: entry.record.markdown });
    saveRecord(entry);
  }

  // ---------- The answer openReportDoc, restoreReportVersion give ----------
  function versionsOf(record, asset) {
    return [...record.versions.map(({ id, at, by, label }) => ({ id, at, by: person(by), label })), { id: 'original', at: asset.createdAt || '', by: { ...SYSTEM }, label: 'Original' }];
  }
  function shape(entry, asset, markdown, { canEdit, canNote }, clientId = '') {
    const { record } = entry;
    return {
      assetId: asset.id, title: String(asset.title || ''), markdown, yState: record.yState || '', version: record.version, epoch: record.epoch,
      savedAt: record.savedAt || asset.edited?.at || '', versions: versionsOf(record, asset), canEdit: Boolean(canEdit), canNote: Boolean(canNote), editors: editorsOf(asset.id),
      awareness: awarenessOf(asset.id, clientId),
    };
  }
  function resetEveryone(assetId, by, epoch) {
    const event = { type: 'doc-update', assetId, update: '', reset: true, epoch, from: { id: by.id, name: by.name, color: colorOf(by.id) } };
    for (const id of peopleOn(assetId).keys()) push(id, event);
  }

  // ---------- Methods ----------
  // openReportDoc: the report's Markdown and its Yjs state ('' until a browser has built it), versions and who else has
  // it open; registers this browser (clientId) as having it open until closeReportDoc or a timeout.
  function open({ assetId, clientId } = {}, viewer = {}, { canEdit = false, canNote = false } = {}) {
    const asset = assetOf(assetId); const who = person(viewer); const client = cleanClient(clientId);
    const entry = load(asset.id, asset);
    const markdown = currentMarkdown(asset.id);
    if (join(asset.id, who, client, entry.record.epoch)) announce(asset.id);
    return shape(entry, asset, markdown, { canEdit: canEdit && asset.deliverableId !== 'landingpage', canNote }, client);
  }

  // pushReportDocUpdate: merges one change, saves the Markdown, keeps a version when one is due and sends the change to
  // everyone else with the report open. update and markdown may each be left out (a caret move or a keep-alive).
  // Optional: epoch (from openReportDoc), awareness (relayed), and stateVector (base64): the Markdown is saved only
  // when it covers the server's document, otherwise markdownSaved is false and the browser pushes again once it has
  // the changes it was sent.
  function pushUpdate(payload = {}, viewer = {}) {
    const asset = assetOf(payload.assetId, { edit: true }); const who = person(viewer); const client = cleanClient(payload.clientId);
    const entry = load(asset.id, asset); const { record } = entry; const final = payload.final === true;
    const known = payload.epoch !== undefined && payload.epoch !== null ? Number(payload.epoch) : opened.get(`${asset.id}\n${who.id}\n${client}`);
    if ((known !== undefined && known !== record.epoch) || (client !== 'default' && record.retired.includes(client))) throw fail('This report was restored or changed outside the editor. Reopen it to keep editing.', 409, 'docReset');
    let markdown = null;
    if (payload.markdown !== undefined && payload.markdown !== null) {
      if (typeof payload.markdown !== 'string') throw fail('Send the report as text.', 400);
      if (payload.markdown.length > LIMITS.markdownChars) throw fail('Keep the report under 250,000 characters.', 400);
      markdown = payload.markdown;
    }
    let theirs = null;
    if (payload.stateVector) { try { theirs = Y.decodeStateVector(decode64(payload.stateVector, 64 * 1024)); } catch (error) { throw error.status ? error : unreadable(); } }
    const awareness = typeof payload.awareness === 'string' && payload.awareness ? (decode64(payload.awareness, LIMITS.awarenessBytes), payload.awareness) : '';

    let changed = false;
    const update = payload.update ? decode64(payload.update, LIMITS.updateBytes) : null;
    if (update?.length) {
      if (bytesOf(record.yState) + update.length > LIMITS.docBytes) throw fail('This report is too long to keep editing here. Copy part of it into a new draft.', 413, 'docTooLarge');
      try { Y.decodeUpdate(update); } catch (_) { throw unreadable(); }
      // Yjs says whether the change added anything: a deletion alone leaves the state vector as it was, so comparing
      // vectors would drop it (never saved, never sent to the others).
      let applied = false; const heard = () => { applied = true; };
      entry.ydoc.on('update', heard);
      try { Y.applyUpdate(entry.ydoc, update, 'server'); } catch (_) { entry.ydoc.off('update', heard); entry.ydoc.destroy(); entry.ydoc = docFrom(record.yState) || docFrom(''); throw unreadable(); }
      entry.ydoc.off('update', heard);
      if (applied) {
        changed = true; record.yState = b64(Y.encodeStateAsUpdate(entry.ydoc)); record.version += 1; entry.dirty.add(who.id);
        if (client !== 'default' && !record.writers.includes(client)) record.writers = [client, ...record.writers].slice(0, LIMITS.retiredClients);
      }
    }

    // The Markdown is the report everything else reads; the Yjs state is only the editor's.
    let markdownSaved = false; let wrote = false;
    const lastVersion = time(record.lastVersionAt[who.id]);
    const versionDue = entry.dirty.has(who.id) && (final || !lastVersion || nowMs() - lastVersion >= LIMITS.versionEveryMs);
    if (markdown !== null && markdown.trim() && (!theirs || covers(theirs, Y.decodeStateVector(Y.encodeStateVector(entry.ydoc))))) {
      const persist = final || versionDue || !record.persistedAt || nowMs() - time(record.persistedAt) >= LIMITS.persistEveryMs;
      if (markdown !== record.markdown || persist) {
        const saved = workspace.writeReportMarkdown({ assetId: asset.id, markdown, by: who, persist });
        record.markdown = markdown; record.savedAt = saved?.savedAt || stamp(); record.savedBy = who; wrote = true;
        if (persist) record.persistedAt = stamp();
      }
      markdownSaved = true;
    }
    if (versionDue) {
      entry.dirty.delete(who.id); record.lastVersionAt[who.id] = stamp();
      addVersion(entry, { kind: 'edit', label: 'Edited', by: who, markdown: record.markdown || markdown || '' });
    }
    if (changed || wrote || versionDue) saveRecord(entry);

    const caretBefore = peopleOn(asset.id).get(who.id)?.clients.get(client)?.awareness || '';
    const joined = join(asset.id, who, client, record.epoch, awareness);
    const from = { id: who.id, name: who.name, color: colorOf(who.id) };
    // Everyone else with it open, and the sender's own other browsers; never back to the browser that sent it.
    const sender = (id, entryOf) => id === who.id && [...entryOf.clients.keys()].every((key) => key === client || key === 'default');
    if (changed) {
      const event = { type: 'doc-update', assetId: asset.id, update: payload.update, epoch: record.epoch, clientId: client, from, ...(awareness ? { awareness } : {}) };
      for (const [id, entryOf] of peopleOn(asset.id)) if (!sender(id, entryOf)) push(id, event);
    }
    if (joined || (awareness && awareness !== caretBefore && !changed)) announce(asset.id, awareness ? { from, clientId: client, awareness } : {}, joined ? null : sender);
    return { version: record.version, savedAt: record.savedAt || '', epoch: record.epoch, markdownSaved };
  }

  // restoreReportVersion: 'original' (the generated report) or a kept version. What's there now is kept as a version
  // first, the Markdown is written through, and the document starts over (everyone with it open reopens it).
  function restore({ assetId, versionId, clientId } = {}, viewer = {}, caps = {}) {
    const asset = assetOf(assetId, { edit: true }); const who = person(viewer); const client = cleanClient(clientId);
    if (typeof versionId !== 'string' || !VERSION_ID.test(versionId)) throw fail('Choose a version to restore.', 400);
    const entry = load(asset.id, asset); const { record } = entry;
    if (versionId !== 'original' && !record.versions.some((row) => row.id === versionId)) throw fail('That version isn’t kept anymore. Choose another one.', 404);
    keepCurrent(entry, currentMarkdown(asset.id), who, 'Before a restore');
    let markdown; let yState = ''; let label;
    if (versionId === 'original') {
      workspace.clearReportEdits({ assetId: asset.id, by: who });
      markdown = currentMarkdown(asset.id); label = 'Restored the original';
    } else {
      ({ markdown, yState } = readVersion(asset.id, versionId));
      if (!markdown.trim()) throw fail('That version is empty. Choose another one.', 409);
      workspace.writeReportMarkdown({ assetId: asset.id, markdown, by: who, persist: true });
      label = 'Restored an earlier version';
    }
    reset(entry, yState);
    record.markdown = markdown; record.savedAt = stamp(); record.savedBy = who; record.persistedAt = record.savedAt;
    addVersion(entry, { kind: 'restore', label, by: who, markdown });
    saveRecord(entry);
    resetEveryone(asset.id, who, record.epoch);
    join(asset.id, who, client, record.epoch);
    const found = workspace.findAsset(asset.id)?.asset || asset;
    return shape(entry, found, markdown, { canEdit: caps.canEdit !== false, canNote: Boolean(caps.canNote) }, client);
  }

  // closeReportDoc: this browser (clientId) no longer has the report open; without a clientId, none of this person's do.
  function close({ assetId, clientId } = {}, viewer = {}) {
    if (typeof assetId !== 'string' || !ID.test(assetId)) throw fail('Choose a report.', 400);
    const who = person(viewer); const client = cleanClient(clientId);
    const clients = client === 'default' ? [...(peopleOn(assetId).get(who.id)?.clients.keys() || [])] : [client, 'default'];
    let left = false;
    for (const key of clients) { opened.delete(`${assetId}\n${who.id}\n${key}`); if (leave(assetId, who.id, key)) left = true; }
    if (left && presence.has(assetId)) announce(assetId);
    return { ok: true };
  }

  // content-workspace's hook for an edit made outside the editor (editStudioAsset, restoreStudioAsset): a report nobody
  // has opened in the editor needs nothing; otherwise the document starts over from the new Markdown.
  function outsideEdit({ assetId, kind = 'edited', markdown, by } = {}) {
    if (typeof assetId !== 'string' || !ID.test(assetId) || (!docs.has(assetId) && !fs.existsSync(docFile(assetId)))) return;
    const who = person(by || SYSTEM); const entry = load(assetId);
    keepCurrent(entry, entry.record.markdown || '', who, 'Before a change outside the editor');
    const text = typeof markdown === 'string' ? markdown : (() => { try { return currentMarkdown(assetId); } catch (_) { return ''; } })();
    reset(entry, '');
    entry.record.markdown = text; entry.record.savedAt = stamp(); entry.record.savedBy = who;
    addVersion(entry, { kind: 'outside', label: kind === 'restored' ? 'Original restored' : 'Changed outside the editor', by: who, markdown: text, yState: '' });
    saveRecord(entry);
    resetEveryone(assetId, who, entry.record.epoch);
  }

  // Presence timeouts: a browser that stopped sending changes leaves after 2 minutes without a live connection, or 30
  // with one. Documents nobody has open leave memory after 10 minutes (their file stays).
  function sweep(at = nowMs()) {
    for (const [assetId, people] of [...presence]) {
      let changed = false;
      for (const [id, entry] of [...people]) {
        const live = Boolean(isLive(id));
        for (const [clientId, client] of [...entry.clients]) {
          const idle = at - client.at;
          if (idle > LIMITS.openMs || (!live && idle > LIMITS.idleMs)) { leave(assetId, id, clientId); changed = true; }
        }
      }
      if (changed && presence.has(assetId)) announce(assetId);
    }
    for (const [assetId, entry] of [...docs]) if (!presence.has(assetId) && at - entry.usedAt > LIMITS.keepInMemoryMs) { entry.ydoc.destroy(); docs.delete(assetId); }
  }
  function start() { if (!timer) { timer = setInterval(() => { try { sweep(); } catch (error) { log(`Report presence check failed: ${error.message}`); } }, LIMITS.sweepMs); timer.unref?.(); } }
  function stop() { if (timer) clearInterval(timer); timer = null; }

  return {
    open, push: pushUpdate, restore, close, outsideEdit, sweep, start, stop,
    // Everyone with a report open (note-changed events go to them).
    presentIds: (assetId) => [...peopleOn(assetId).keys()],
    editorsOf,
  };
}

module.exports = { createReportDocs, LIMITS, COLORS };
