'use strict';
// Monday.com sync bookkeeping: content-studio/monday.json (the account, one board link per studio workspace, the item map,
// a people cache and today's API calls) and content-studio/monday-log.jsonl (the sync log, newest 2,000 rows). Both live
// inside the folder the owner lock protects, and backups include them. Synchronous, atomic writes (temp file, fsync,
// rename, fsync the folder), so high-churn sync bookkeeping never rewrites config.json, which holds the encrypted keys.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const catalog = require('../shared/monday.json');
const { writeFileDurable } = require('../shared/durable-write');

const VERSION = 1;
const LOG_ROWS = catalog.limits.logRows;
const KINDS = new Set(['created', 'updated', 'moved', 'posted', 'decision', 'reverted', 'comment', 'owner', 'date', 'removed', 'duplicate', 'adopted', 'error', 'paused', 'resumed', 'webhook']);
const copy = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
const record = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
const fresh = () => ({ version: VERSION, account: null, links: {}, items: {}, people: {}, usage: { day: '', calls: 0 } });
const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest();
const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const clip = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

function createMondayStore({ root, now = () => Date.now(), onDamaged = (message) => console.warn(message) } = {}) {
  if (!root) throw new Error('The Monday.com store needs the studio data folder.');
  const target = path.join(root, 'monday.json');
  const logFile = path.join(root, 'monday-log.jsonl');
  let data = load();
  let logCount = countLog();
  let callFlushAt = 0;

  function load() {
    let text;
    try { text = fs.readFileSync(target, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return fresh(); throw error; }
    try {
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new SyntaxError('not an object');
      if (Number(parsed.version) > VERSION) throw Object.assign(new Error('The Monday.com sync file is from a newer Scraper Studio. Update the app or server.'), { code: 'mondayNewer' });
      return { ...fresh(), ...parsed, links: record(parsed.links), items: record(parsed.items), people: record(parsed.people), usage: { ...fresh().usage, ...record(parsed.usage) } };
    } catch (error) {
      if (error.code === 'mondayNewer') throw error;
      // A damaged file is kept beside the new one. Nothing is lost on Monday: the Studio key column lets the next push
      // find every item again instead of adding it twice.
      const kept = `${target}.bad-${now()}`;
      try { fs.copyFileSync(target, kept); } catch (_) { /* best effort */ }
      onDamaged(`The Monday.com sync file was damaged; a copy was kept at ${path.basename(kept)}.`);
      return fresh();
    }
  }
  // A private temp file, fsync, rename (retried on Windows while a scanner holds the file), then fsync the folder.
  function writeFile(file, text) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    writeFileDurable(file, text);
  }
  // Write-through: a change that can't reach the disk is undone in memory too.
  function change(mutate) {
    const before = JSON.stringify(data);
    try { const result = mutate(); writeFile(target, JSON.stringify(data, null, 2)); return result; }
    catch (error) { data = JSON.parse(before); throw error; }
  }

  // ---------- Account ----------
  const account = () => copy(data.account);
  const setAccount = (value) => change(() => { data.account = value ? { ...record(value), checkedAt: new Date(now()).toISOString() } : null; return copy(data.account); });

  // ---------- Links ----------
  const link = (ws) => (data.links[ws] ? copy(data.links[ws]) : null);
  const links = () => copy(data.links);
  // A setup save from Settings: refused when someone else saved since this person loaded it (rev), then rev moves on.
  function saveLink(ws, patch, { rev } = {}) {
    return change(() => {
      const current = data.links[ws] || null;
      if (current && rev !== undefined && rev !== null && Number(rev) !== Number(current.rev)) {
        const at = current.savedAt ? new Date(current.savedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : 'a moment ago';
        throw Object.assign(new Error(`Someone changed the Monday.com setup at ${at}. Reload to see it.`), { status: 409, code: 'mondaySetupChanged' });
      }
      data.links[ws] = { ...(current || {}), ...copy(patch), rev: (Number(current?.rev) || 0) + 1, savedAt: new Date(now()).toISOString() };
      return copy(data.links[ws]);
    });
  }
  // The engine's own bookkeeping (last run, cursor, pause, problems): never moves rev, so it never collides with Settings.
  function updateLink(ws, patch) {
    return change(() => { if (!data.links[ws]) return null; data.links[ws] = { ...data.links[ws], ...copy(patch) }; return copy(data.links[ws]); });
  }
  // The item map stays unless forgetItems, so reconnecting the same board never adds anything twice.
  function removeLink(ws, { forgetItems = false } = {}) {
    return change(() => { delete data.links[ws]; if (forgetItems) delete data.items[ws]; return true; });
  }

  // ---------- Items ----------
  const items = (ws) => copy(data.items[ws] || {});
  const item = (ws, key) => (data.items[ws]?.[key] ? copy(data.items[ws][key]) : null);
  // { key: patch } merged, or { key: null } removed; one write for the whole set.
  function patchItems(ws, patches) {
    const entries = Object.entries(record(patches));
    if (!entries.length) return;
    change(() => {
      const map = data.items[ws] || (data.items[ws] = {});
      for (const [key, patch] of entries) { if (patch === null) delete map[key]; else map[key] = { ...(map[key] || {}), ...copy(patch) }; }
    });
  }
  const keyForItem = (ws, itemId) => Object.entries(data.items[ws] || {}).find(([, entry]) => entry.itemId && String(entry.itemId) === String(itemId))?.[0] || '';

  // ---------- People (Monday users seen in changes; refreshed daily) ----------
  const people = () => copy(data.people);
  const setPeople = (rows) => change(() => { for (const row of rows) if (row?.id) data.people[String(row.id)] = { name: clip(row.name, 120), email: clip(row.email, 254).toLowerCase(), at: new Date(now()).toISOString() }; });

  // ---------- Usage: counted in memory, written at most once a minute, reset at 00:00 UTC ----------
  function countCall(count = 1) {
    const day = utcDay(now());
    if (data.usage.day !== day) data.usage = { day, calls: 0 };
    data.usage.calls += count;
    if (now() - callFlushAt >= 60000) { callFlushAt = now(); try { writeFile(target, JSON.stringify(data, null, 2)); } catch (_) { /* the count is a convenience */ } }
  }
  const callsToday = () => (data.usage.day === utcDay(now()) ? data.usage.calls : 0);
  const flush = () => { try { writeFile(target, JSON.stringify(data, null, 2)); } catch (_) { /* best effort on quit */ } };

  // ---------- Sync log ----------
  function countLog() { try { return fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).length; } catch (_) { return 0; } }
  function readRows() {
    let text = ''; try { text = fs.readFileSync(logFile, 'utf8'); } catch (_) { return []; }
    const rows = [];
    for (const line of text.split('\n')) { if (!line) continue; try { rows.push(JSON.parse(line)); } catch (_) { /* a torn last line is skipped */ } }
    return rows;
  }
  function appendLog(rows) {
    const clean = (Array.isArray(rows) ? rows : [rows]).filter((row) => row && KINDS.has(row.kind)).map((row) => ({
      at: row.at || new Date(now()).toISOString(), ws: clip(row.ws, 120), dir: ['out', 'in', 'setup'].includes(row.dir) ? row.dir : 'setup', kind: row.kind,
      key: clip(row.key, 400), itemId: clip(row.itemId, 40), trendName: clip(row.trendName, 200), by: clip(row.by, 160), text: clip(row.text, 300), ok: row.ok !== false,
    }));
    if (!clean.length) return;
    fs.mkdirSync(root, { recursive: true });
    fs.appendFileSync(logFile, clean.map((row) => `${JSON.stringify(row)}\n`).join(''), { mode: 0o600 });
    logCount += clean.length;
    if (logCount > LOG_ROWS + 200) { const kept = readRows().slice(-LOG_ROWS); writeFile(logFile, kept.map((row) => `${JSON.stringify(row)}\n`).join('')); logCount = kept.length; }
  }
  // Newest first. before: an ISO time (rows strictly older); problemsOnly: failures, pauses and reverts.
  function readLog({ ws = '', limit = 50, before = '', problemsOnly = false, key = '', direction = '' } = {}) {
    const size = Math.max(1, Math.min(200, Math.floor(Number(limit) || 50)));
    const rows = readRows().filter((row) => (!ws || row.ws === ws) && (!before || String(row.at) < String(before)) && (!key || row.key === key) && (!direction || row.dir === direction) && (!problemsOnly || row.ok === false || ['error', 'paused', 'reverted', 'duplicate'].includes(row.kind))).reverse();
    return { rows: rows.slice(0, size), more: rows.length > size };
  }

  // ---------- Webhook secrets: only sha256 hashes are stored; compared in constant time ----------
  function hookMatch(secret) {
    if (typeof secret !== 'string' || !/^[a-f0-9]{64}$/.test(secret)) return null;
    const hash = sha256(secret);
    let found = null;
    for (const [ws, entry] of Object.entries(data.links)) {
      if (typeof entry?.hookSecretHash !== 'string' || entry.hookSecretHash.length !== 64) continue;
      if (crypto.timingSafeEqual(hash, Buffer.from(entry.hookSecretHash, 'hex')) && !found) found = ws;
    }
    return found;
  }

  // ---------- Migration from config.json's monday (the one-way sync before wave 3B) ----------
  // Keeps today's manual behaviour until an admin turns automatic sync on, and keeps every item ID, so nothing is added
  // twice. Returns true when it moved something (the caller then deletes config.monday and saves config.json).
  function migrateLegacy(legacy, workspaceId) {
    if (!legacy?.boardId || Object.keys(data.links).length || !workspaceId) return false;
    const at = new Date(now()).toISOString();
    change(() => {
      data.links[workspaceId] = {
        rev: 1, savedAt: at, active: true, linkedAt: at, linkedBy: { id: 'system', name: 'Automatic' }, boardId: String(legacy.boardId), boardName: clip(legacy.boardName, 160), boardUrl: '', mondayWorkspaceName: '',
        columns: { stage: legacy.statusColumnId || '', notes: legacy.notesColumnId || '' }, columnInfo: { ...(legacy.statusColumnId ? { [legacy.statusColumnId]: { title: 'Status', type: 'status' } } : {}), ...(legacy.notesColumnId ? { [legacy.notesColumnId]: { title: 'Notes', type: 'long_text' } } : {}) },
        fieldOptions: {}, statusLabels: { ...catalog.stageLabels }, groups: { by: 'none', ids: {}, defaultGroupId: '' },
        push: { mode: 'manual', dailyAt: '09:00', timeZone: 'UTC', from: 'all', includeSkipped: true, postUpdates: false },
        pull: { mode: 'manual', pollMinutes: 5, decisions: 'off', comments: false, owner: false, dates: false }, onDeleted: 'recreate',
        webhooks: [], hookStatus: 'off', cursor: { activityFrom: '', seenActivityIds: [], lastUpdateId: '' }, paused: null, fieldProblems: {}, lastRun: legacy.lastSyncedAt ? { at: legacy.lastSyncedAt, kind: 'push' } : null,
      };
      data.items[workspaceId] = Object.fromEntries(Object.entries(record(legacy.itemIds)).filter(([, id]) => /^\d+$/.test(String(id))).map(([key, id]) => [key, { itemId: String(id), url: '', state: 'synced', pushed: {}, attempts: 0 }]));
    });
    appendLog({ ws: workspaceId, dir: 'setup', kind: 'resumed', text: 'Moved your Monday.com board setup to the new sync. Turn on automatic sync in Settings.' });
    return true;
  }

  return { file: target, logFile, load: () => copy(data), account, setAccount, link, links, saveLink, updateLink, removeLink, items, item, patchItems, keyForItem, people, setPeople, countCall, callsToday, flush, appendLog, readLog, hookMatch, migrateLegacy };
}

const hashSecret = (secret) => sha256(secret).toString('hex');

module.exports = { createMondayStore, hashSecret, VERSION };
