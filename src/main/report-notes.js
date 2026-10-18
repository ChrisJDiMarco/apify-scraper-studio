'use strict';
// Notes on reports (wave 3C): threads people leave on a passage of a written report or draft, with replies, @mentions,
// resolve and reopen, and each person's mentions and replies for their Inbox. One synchronous, atomic file:
// content-studio/report-notes.json { v: 1, notes: { [assetId]: [Note] }, inbox: { [identityId]: [Item] } }.
//
// Note = { id, assetId, anchor: { yStart, yEnd, quote }, author: { id, name }, body, mentions: [id], createdAt, editedAt,
//          resolved: { by: { id, name }, at } | null, replies: [{ id, author, body, mentions, createdAt, editedAt }] }
// The anchor is two Yjs relative positions (base64, made by the editor) plus the quoted text, which the editor falls
// back to when the passage is gone ("text was changed"). Item = { id, kind: 'mention' | 'reply', assetId, noteId,
// replyId?, assetTitle, by: { id, name }, excerpt, at, read } (the rows the Inbox reads as contentStudio.noteMentions).
//
// Who may do what is the gate's (roles.json commentReports, access.js channel scopes); this store only checks that a
// person changes or deletes their own notes (admins may delete anyone's) and that mentions name someone who can read the
// report (index.js passes that list).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { renameDurable } = require('../shared/durable-write');

const LIMITS = Object.freeze({ body: 4000, quote: 1000, anchor: 4096, mentions: 20, notesPerReport: 500, repliesPerNote: 200, inboxPerPerson: 200, inboxDays: 60, excerpt: 140 });
const ID = /^[a-zA-Z0-9_-]{1,180}$/;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const DAY = 86400000;
const fail = (message, status = 400, code) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
const list = (value) => (Array.isArray(value) ? value : []);
const copy = (value) => JSON.parse(JSON.stringify(value));
const time = (value) => { const ms = Date.parse(value || ''); return Number.isFinite(ms) ? ms : 0; };
const person = (value) => ({ id: String(value?.id || 'local').slice(0, 180), name: String(value?.name || '').slice(0, 120) || 'Someone' });
const newId = (prefix) => `${prefix}-${crypto.randomUUID()}`;
const excerptOf = (body) => { const text = String(body || '').replace(/\s+/g, ' ').trim(); return text.length > LIMITS.excerpt ? `${text.slice(0, LIMITS.excerpt - 1).trim()}…` : text; };

function defaultWriteJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  const fd = fs.openSync(temp, 'w', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  renameDurable(temp, file); // retried on Windows while a scanner holds the file
}

function createReportNotes({ file, writeJson = defaultWriteJson, clock = () => new Date(), log = (message) => console.warn(message) } = {}) {
  if (!file) throw new Error('Report notes need their file.');
  const stamp = () => new Date(clock()).toISOString();
  let data = { v: 1, notes: {}, inbox: {} };
  // A file that can't be opened (on Windows a backup agent or scanner can hold it: EBUSY, EPERM) isn't damage: it stays
  // where it is, every call refuses with 503 and reads it again, and nothing is written over it meanwhile.
  let unreadable = null;
  function load() {
    let text;
    try { text = fs.readFileSync(file, 'utf8'); }
    catch (error) { unreadable = error.code === 'ENOENT' ? null : error; return; }
    unreadable = null;
    let parsed;
    try {
      parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object' || typeof parsed.notes !== 'object') throw new Error('not a notes file');
    } catch (error) {
      // A damaged file is put aside (never overwritten) and the studio starts with no notes; one that can't be moved
      // stops the studio instead, since the next note would replace it.
      const aside = `${file}.bad-${Date.now()}`;
      try { fs.renameSync(file, aside); }
      catch (moveError) { throw new Error(`Report notes are damaged and could not be put aside (${moveError.code || moveError.message}); nothing was changed. Close any program using content-studio/report-notes.json and open the studio again.`); }
      log(`Report notes could not be read and were put aside (${path.basename(aside)}): ${error.message}`);
      return;
    }
    if (Number(parsed.v) > 1) throw new Error('This report-notes.json was written by a newer version of the studio. Update the studio, or restore content-studio/report-notes.json from a backup.');
    data = { v: 1, notes: parsed.notes || {}, inbox: parsed.inbox && typeof parsed.inbox === 'object' ? parsed.inbox : {} };
  }
  load();
  if (unreadable) log(`Report notes can't be read right now (${unreadable.code || unreadable.message}); they are read again on the next use.`);
  function ready() {
    if (unreadable) load();
    if (unreadable) throw fail(`Report notes could not be read right now (${unreadable.code || 'unreadable'}); nothing was changed. Try again.`, 503, 'notesUnreadable');
  }
  // Every change is made on a copy and written before it replaces what's in memory, so a failed write changes nothing.
  function change(mutate) {
    const next = copy(data);
    const result = mutate(next);
    writeJson(file, next);
    data = next;
    return result;
  }

  // ---------- Checks ----------
  const assetIdOf = (value) => { if (typeof value !== 'string' || !ID.test(value)) throw fail('Choose a report.', 400); return value; };
  function bodyOf(value) {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text) throw fail('Write a note first.', 400);
    if (text.length > LIMITS.body) throw fail(`Keep a note under ${LIMITS.body.toLocaleString('en-US')} characters.`, 400);
    return text;
  }
  // Only people who can read the report, never yourself; `mentionable` null (the Mac app) means no mentions at all.
  function mentionsOf(value, actor, mentionable) {
    if (!mentionable || typeof mentionable.has !== 'function') return [];
    return [...new Set(list(value).filter((id) => typeof id === 'string' && id !== actor.id && mentionable.has(id)))].slice(0, LIMITS.mentions);
  }
  function anchorOf(value) {
    const anchor = value && typeof value === 'object' ? value : {};
    const part = (raw) => { const text = typeof raw === 'string' ? raw : ''; if (text.length > LIMITS.anchor || text.length % 4 !== 0 || !BASE64.test(text)) throw fail('Select the text again, then add your note.', 400); return text; };
    const quote = typeof anchor.quote === 'string' ? anchor.quote.trim().slice(0, LIMITS.quote) : '';
    if (!quote) throw fail('Select the text your note is about.', 400);
    return { yStart: part(anchor.yStart), yEnd: part(anchor.yEnd), quote };
  }
  const notesOn = (store, assetId) => (store.notes[assetId] ||= []);
  function noteIn(store, assetId, noteId) {
    const note = typeof noteId === 'string' ? list(store.notes[assetId]).find((row) => row.id === noteId) : null;
    if (!note) throw fail('That note was deleted. Reload the notes.', 404);
    return note;
  }
  const own = (row, actor) => { if (row.author?.id !== actor.id) throw fail('You can change only your own notes.', 403, 'notYourNote'); };

  // ---------- Inbox ----------
  function notify(store, identityId, item) {
    if (!identityId) return;
    const rows = (store.inbox[identityId] ||= []);
    const cutoff = time(item.at) - LIMITS.inboxDays * DAY;
    rows.unshift({ id: newId('ni'), read: false, ...item });
    store.inbox[identityId] = rows.filter((row) => time(row.at) >= cutoff).slice(0, LIMITS.inboxPerPerson);
  }
  function forget(store, assetId, noteId, replyId = '') {
    for (const [id, rows] of Object.entries(store.inbox)) {
      const kept = rows.filter((row) => !(row.assetId === assetId && row.noteId === noteId && (!replyId || row.replyId === replyId)));
      if (kept.length) store.inbox[id] = kept; else delete store.inbox[id];
    }
  }

  // ---------- Methods ----------
  const list_ = (assetId) => copy(list(data.notes[assetIdOf(assetId)]).sort((a, b) => time(a.createdAt) - time(b.createdAt)));

  // saveReportNote. New note: { assetId, anchor, body, mentions }. Reply: { assetId, replyTo, body, mentions }. Edit a
  // note: { assetId, noteId, body, mentions }. Edit a reply: { assetId, noteId, replyId, … } (or { noteId: <reply>,
  // replyTo: <note> }). Returns { note, notified: [identityId] } (who got an Inbox item).
  function save(input = {}, by = {}, { mentionable = null, title = '' } = {}) {
    const assetId = assetIdOf(input.assetId); const actor = person(by); const body = bodyOf(input.body);
    const mentions = mentionsOf(input.mentions, actor, mentionable);
    const reportTitle = String(title || '').slice(0, 200);
    const parentId = input.replyId ? input.noteId : input.replyTo;
    const childId = input.replyId || (input.replyTo && input.noteId) || '';
    return change((store) => {
      const at = stamp(); const notified = [];
      const tell = (identityId, item) => { if (identityId && identityId !== actor.id && !notified.includes(identityId)) { notified.push(identityId); notify(store, identityId, { ...item, assetId, assetTitle: reportTitle, by: actor, at }); } };
      let note;
      if (childId) {
        note = noteIn(store, assetId, parentId);
        const reply = list(note.replies).find((row) => row.id === childId);
        if (!reply) throw fail('That reply was deleted. Reload the notes.', 404);
        own(reply, actor);
        const added = mentions.filter((id) => !list(reply.mentions).includes(id));
        Object.assign(reply, { body, mentions, editedAt: at });
        for (const id of added) tell(id, { kind: 'mention', noteId: note.id, replyId: reply.id, excerpt: excerptOf(body) });
      } else if (parentId) {
        note = noteIn(store, assetId, parentId);
        if (list(note.replies).length >= LIMITS.repliesPerNote) throw fail('This note has as many replies as it can hold. Start a new note.', 409);
        const reply = { id: newId('reply'), author: actor, body, mentions, createdAt: at, editedAt: '' };
        (note.replies ||= []).push(reply);
        for (const id of mentions) tell(id, { kind: 'mention', noteId: note.id, replyId: reply.id, excerpt: excerptOf(body) });
        tell(note.author?.id, { kind: 'reply', noteId: note.id, replyId: reply.id, excerpt: excerptOf(body) });
      } else if (input.noteId) {
        note = noteIn(store, assetId, input.noteId);
        own(note, actor);
        const added = mentions.filter((id) => !list(note.mentions).includes(id));
        Object.assign(note, { body, mentions, editedAt: at });
        for (const id of added) tell(id, { kind: 'mention', noteId: note.id, excerpt: excerptOf(body) });
      } else {
        const notes = notesOn(store, assetId);
        if (notes.length >= LIMITS.notesPerReport) throw fail('This report has as many notes as it can hold. Delete resolved notes first.', 409);
        note = { id: newId('note'), assetId, anchor: anchorOf(input.anchor), author: actor, body, mentions, createdAt: at, editedAt: '', resolved: null, replies: [] };
        notes.push(note);
        for (const id of mentions) tell(id, { kind: 'mention', noteId: note.id, excerpt: excerptOf(body) });
      }
      return { note: copy(note), notified };
    });
  }

  // resolveReportNote: anyone who may leave notes resolves or reopens a thread.
  function resolve({ assetId, noteId, resolved } = {}, by = {}) {
    const id = assetIdOf(assetId); const actor = person(by);
    return change((store) => {
      const note = noteIn(store, id, noteId);
      note.resolved = resolved === false ? null : { by: actor, at: stamp() };
      return { note: copy(note) };
    });
  }

  // deleteReportNote: a whole thread, or one reply (replyId). Your own, or anyone's for an admin.
  function remove({ assetId, noteId, replyId } = {}, by = {}, { admin = false } = {}) {
    const id = assetIdOf(assetId); const actor = person(by);
    return change((store) => {
      const note = noteIn(store, id, noteId);
      if (replyId) {
        const reply = list(note.replies).find((row) => row.id === replyId);
        if (!reply) throw fail('That reply was deleted. Reload the notes.', 404);
        if (!admin) own(reply, actor);
        note.replies = note.replies.filter((row) => row.id !== replyId);
        forget(store, id, note.id, replyId);
        return { ok: true, note: copy(note) };
      }
      if (!admin) own(note, actor);
      store.notes[id] = store.notes[id].filter((row) => row.id !== note.id);
      if (!store.notes[id].length) delete store.notes[id];
      forget(store, id, note.id);
      return { ok: true, note: null };
    });
  }

  // { [assetId]: { open, total } } for every report with a note (threads, not replies).
  function counts() {
    const out = {};
    for (const [assetId, notes] of Object.entries(data.notes)) {
      const rows = list(notes); if (!rows.length) continue;
      out[assetId] = { open: rows.filter((note) => !note.resolved).length, total: rows.length };
    }
    return out;
  }
  // One person's mentions and replies, newest first, from the last 30 days, at most 60; unread counts those not read.
  function inboxFor(identityId, { days = 30, limit = 60, now = new Date(clock()).getTime() } = {}) {
    const since = now - days * DAY;
    const items = list(data.inbox[String(identityId || '')]).filter((row) => time(row.at) >= since).slice(0, limit).map((row) => copy(row));
    return { items, unread: items.filter((row) => !row.read).length };
  }
  // Opening a report's notes reads that person's items about it. True when something changed.
  function markRead(identityId, assetId) {
    const rows = list(data.inbox[String(identityId || '')]);
    if (!rows.some((row) => row.assetId === assetId && !row.read)) return false;
    change((store) => { for (const row of store.inbox[identityId]) if (row.assetId === assetId) row.read = true; });
    return true;
  }

  const guarded = (method) => (...args) => { ready(); return method(...args); };
  return { list: guarded(list_), save: guarded(save), resolve: guarded(resolve), remove: guarded(remove), counts: guarded(counts), inboxFor: guarded(inboxFor), markRead: guarded(markRead) };
}

module.exports = { createReportNotes, LIMITS };
