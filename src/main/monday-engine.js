'use strict';
// Monday.com two-way sync (docs/design-review/SPEC-3.md, wave 3B; HANDOFF.md → Monday.com). One serialized queue for
// all Monday I/O: push (studio → Monday: new trends, changed fields, group moves, milestone updates), pull (Monday →
// studio: Yes/Skip while a trend waits for an OK, owner, dates, comments, deletions) and a full reconcile. Webhooks bring
// changes instantly on the web; otherwise the 60 s scheduler polls. The integration makes no AI calls and spends no
// money; its only budget is Monday's API call allowance. Monday can never start Write reports or any other paid step.
//
// Idempotency: every item carries the studio key (a Studio key column), keys whose create may have happened are
// persisted 'unsure' before the request leaves and looked up by key before anything is created again, and only an
// itemMissing answer ever clears a saved item ID. Payload values from webhooks are never trusted: the item is re-read.
// Posts written before the rename to Golden Thread still count as the studio's own.
const LEGACY_STUDIO_POST = 'Scraper Studio · ';
const crypto = require('crypto');
const catalog = require('../shared/monday.json');
const api = require('./monday-sync');
const cardsLib = require('./monday-cards');
const { hashSecret } = require('./monday-store');

const L = catalog.limits;
const FIELDS = new Map(catalog.fields.map((field) => [field.id, field]));
const STAGES = Object.keys(catalog.stageLabels);
const BACKOFF_MIN = [5, 30, 120, 360];
const HOUR = 3600000; const DAY = 24 * HOUR;
const FULL_EVERY = 6 * HOUR;
const PEOPLE_TTL = DAY;
const DECISION_OF = { potential: 'pending', approved: 'approved', passed: 'passed' };
const list = (value) => (Array.isArray(value) ? value : []);
const record = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
const clip = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const chunks = (rows, size) => { const out = []; for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size)); return out; };
const refuse = (message, status = 400, code) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
const quoted = (name) => `“${clip(name, 120) || 'this trend'}”`;
const isMondayError = (error) => error instanceof api.MondayError || error?.name === 'MondayError';

function defaultLink(web) {
  return {
    active: false, columns: {}, columnInfo: {}, fieldOptions: { plannedDate: { direction: 'toMonday' }, owner: { direction: 'fromMonday' } }, statusLabels: { ...catalog.stageLabels },
    groups: { by: 'stage', ids: {}, defaultGroupId: '' },
    push: { mode: 'live', dailyAt: '09:00', timeZone: 'UTC', from: 'all', includeSkipped: true, postUpdates: true },
    pull: { mode: web ? 'instant' : 'poll', pollMinutes: 5, decisions: web ? 'members' : 'anyone', comments: true, owner: true, dates: true },
    onDeleted: 'leave', webhooks: [], hookStatus: 'off', hookNote: '', cursor: { activityFrom: '', seenActivityIds: [], lastUpdateId: '' }, paused: null, fieldProblems: {}, lastRun: null,
  };
}

function createMondayEngine({ store, getToken, saveToken = () => {}, clearToken = () => {}, workspace, teamStore, access = null, web = false, origin = () => '', emitState = () => {}, jobs = null, now = () => Date.now(), fetchImpl, sleep, timers = {}, warn = (message) => console.warn(message) } = {}) {
  if (!store || !workspace) throw new Error('The Monday.com engine needs its store and the content workspace.');
  const T = { setTimeout: timers.setTimeout || setTimeout, clearTimeout: timers.clearTimeout || clearTimeout, setInterval: timers.setInterval || setInterval, clearInterval: timers.clearInterval || clearInterval };
  const iso = (ms = now()) => new Date(ms).toISOString();
  const activeWs = () => workspace.activeWorkspaceId();
  // A link saved on a workspace this build hides (single-workspace mode archives the others) never syncs: nothing is
  // scheduled, sent, read or re-registered for it until the workspace comes back.
  const hiddenWs = (ws) => typeof workspace.isWorkspaceHidden === 'function' && Boolean(workspace.isWorkspaceHidden(ws));
  let clientCache = null;
  function client(token = getToken()) {
    if (!token) throw new api.MondayError('auth', { message: 'Connect Monday.com in Settings first.' });
    if (clientCache?.token !== token) clientCache = { token, request: api.createMondayClient({ token, fetchImpl, sleep, now, onCall: () => store.countCall() }) };
    return clientCache.request;
  }
  // Timers the engine owns (follow-ups, debounces, the scheduler); unref'd so they never hold a process open.
  const owned = new Set();
  function later(ms, fn) { const timer = T.setTimeout(() => { owned.delete(timer); fn(); }, ms); timer?.unref?.(); owned.add(timer); return timer; }
  function cancel(timer) { if (timer) { T.clearTimeout(timer); owned.delete(timer); } }
  let emitting = false;
  const emit = () => { emitting = true; try { emitState(); } catch (_) { /* a broadcast failure never fails a sync */ } finally { emitting = false; } };
  const log = (rows) => { try { store.appendLog(rows); } catch (error) { warn(`The Monday.com sync log could not be written: ${error.message}`); } };

  // ---------- The queue ----------
  let chain = Promise.resolve();
  const waiting = new Map(); // signature → promise of a run not started yet (a repeat joins it)
  const waitingJobs = new Map(); // signature → the Sync now job of a run not started yet
  let current = null; // { kind, ws, done, total, job, signature }
  const signatureOf = (kind, ws, opts = {}) => `${kind}|${ws}|${list(opts.keys).slice().sort().join(',')}|${opts.full ? 'full' : ''}|${opts.force ? 'force' : ''}`;
  function enqueue(kind, ws, opts = {}) {
    const signature = signatureOf(kind, ws, opts);
    if (waiting.has(signature)) return waiting.get(signature);
    const promise = chain.then(async () => {
      waiting.delete(signature); waitingJobs.delete(signature);
      current = { kind, ws, done: 0, total: 0, job: opts.job || null, signature };
      try {
        if (hiddenWs(ws)) return { skipped: 'hidden' };
        if (kind === 'push') return await push(ws, opts);
        if (kind === 'pull') return await pull(ws, opts);
        if (kind === 'hooks') return await checkHooks(ws);
        const pulled = await pull(ws, { ...opts, full: true });
        const pushed = await push(ws, opts);
        store.updateLink(ws, { lastFullAt: iso() });
        return { pulled, pushed };
      } finally { current = null; }
    });
    waiting.set(signature, promise);
    chain = promise.catch(() => {});
    return promise;
  }
  const run = (kind, opts = {}) => enqueue(kind, opts.ws || activeWs(), opts);

  // ---------- Link helpers ----------
  const typesOf = (link) => { const out = { name: 'name' }; for (const [field, columnId] of Object.entries(record(link.columns))) if (columnId) out[field] = link.columnInfo?.[columnId]?.type || FIELDS.get(field)?.types?.[0] || ''; return out; };
  const pullMode = (link) => (link.pull?.mode === 'instant' && link.hookStatus !== 'on' ? 'poll' : link.pull?.mode || 'manual');
  function blocked(link, force = false) {
    const paused = link?.paused; if (!paused) return false;
    if (paused.reason === 'daily') return Date.parse(paused.until || '') > now();
    if (paused.reason === 'user' || paused.reason === 'token') return true;
    return !force; // permission or board-missing: Sync now tries again
  }
  function localTime(ms, timeZone) {
    try {
      const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(ms)).map((part) => [part.type, part.value]));
      return { day: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
    } catch (_) { const d = new Date(ms).toISOString(); return { day: d.slice(0, 10), time: d.slice(11, 16) }; }
  }
  const clockOf = (ms) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  function backoff(attempts) { return iso(now() + BACKOFF_MIN[Math.min(BACKOFF_MIN.length - 1, Math.max(0, attempts - 1))] * 60000); }
  function nextUtcMidnight() { const d = new Date(now()); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1); }

  function pause(ws, reason, message, until = '') {
    const link = store.link(ws); if (!link) return;
    if (link.paused?.reason === reason && link.paused?.message === message) return;
    store.updateLink(ws, { paused: { reason, until, message } });
    log({ ws, dir: 'setup', kind: 'paused', text: message, ok: false });
  }
  function plainError(error, link, { name = '', field = '' } = {}) {
    switch (error?.kind) {
      case 'auth': return api.COPY.auth;
      case 'permission': return `The studio’s Monday account can’t edit “${link?.boardName || 'the board'}”. Give it edit rights on the board.`;
      case 'daily': return `Monday.com’s daily API limit is used up. Syncing starts again at ${clockOf(nextUtcMidnight())}.`;
      case 'boardMissing': return `The board “${link?.boardName || 'linked board'}” is gone, or the studio’s account can’t see it. Choose another board.`;
      case 'columnMissing': return `The “${link?.columnInfo?.[link?.columns?.[field]]?.title || FIELDS.get(field)?.title || 'mapped'}” column is gone. Choose another column for ${FIELDS.get(field)?.label || 'that field'}, or turn it off.`;
      case 'value': return /label/i.test(error.detail || '') ? `Monday wouldn’t add a label${name ? ` for ${quoted(name)}` : ''}. Add it on the board, or let the studio’s account change the board.` : `Monday.com didn’t accept a value${name ? ` for ${quoted(name)}` : ''}.`;
      case 'rate': case 'concurrency': return `${api.COPY[error.kind]} Trying again at ${clockOf(now() + Math.max(60, error.retryInSeconds || 0) * 1000)}.`;
      case 'timeout': case 'network': case 'server': return `${api.COPY[error.kind]} Trying again at ${clockOf(now() + 5 * 60000)}.`;
      default: return error?.message ? clip(error.message, 240) : 'Monday.com didn’t accept the change.';
    }
  }
  // A failure that would repeat for everything left: pause, or back off and come back.
  function runError(ws, link, error, kind) {
    if (!isMondayError(error)) { log({ ws, dir: kind === 'pull' ? 'in' : 'out', kind: 'error', text: clip(error?.message || 'The Monday.com sync stopped.', 300), ok: false }); return; }
    const message = plainError(error, link);
    if (error.kind === 'auth') pause(ws, 'token', message);
    else if (error.kind === 'permission') pause(ws, 'permission', message);
    else if (error.kind === 'daily') pause(ws, 'daily', message, iso(nextUtcMidnight()));
    else if (error.kind === 'boardMissing') pause(ws, 'board-missing', message);
    else {
      const wait = ['rate', 'concurrency'].includes(error.kind) ? Math.max(60, error.retryInSeconds || 0) * 1000 : 5 * 60000;
      log({ ws, dir: kind === 'pull' ? 'in' : 'out', kind: 'error', text: `${kind === 'pull' ? 'Couldn’t read changes from Monday' : 'Couldn’t send to Monday'}: ${message}`, ok: false });
      later(wait, () => enqueue(kind, ws, {}).catch(() => {}));
    }
  }

  // ---------- Cards ----------
  function cardsFor(ws, link, items) {
    const source = workspace.boardSource(ws) || {};
    return cardsLib.buildMondayCards({ ...source, adoptions: teamStore?.adoptionsFor ? teamStore.adoptionsFor(ws) : [], origin: link.studioOrigin || '', linkedAt: link.linkedAt, from: link.push?.from, includeSkipped: link.push?.includeSkipped !== false, items });
  }
  const ownItem = (link, item) => item && (!item.boardId || String(item.boardId) === String(link.boardId));
  const postedFor = (card) => Object.fromEntries(cardsLib.milestones(card).map((entry) => [entry.id, true]));
  const groupFor = (link, card) => (link.groups?.by === 'stage' ? link.groups.ids?.[card.stage] : link.groups?.by === 'run' ? link.groups.ids?.[card.runId] : link.groups?.defaultGroupId) || link.groups?.defaultGroupId || '';

  // ---------- PUSH ----------
  async function push(ws, { keys = null, force = false, signal = null } = {}) {
    let link = store.link(ws);
    if (!link || !link.active) return { skipped: 'inactive' };
    if (blocked(link, force)) return { skipped: 'paused' };
    const token = getToken();
    if (!token) { pause(ws, 'token', api.COPY.auth); emit(); return { skipped: 'token' }; }
    if (force && link.paused) link = store.updateLink(ws, { paused: null });
    const started = now(); const counts = { created: 0, updated: 0, moved: 0, posted: 0, failed: 0 };
    let request;
    try { request = client(token); } catch (error) { runError(ws, link, error, 'push'); return { skipped: 'token' }; }
    let items = store.items(ws);
    let cards; try { cards = cardsFor(ws, link, items); } catch (error) { warn(`Monday.com cards could not be built: ${error.message}`); return { skipped: 'cards' }; }
    // A run deleted (or cancelled with no reports) leaves its items on Monday as they are, logged once.
    if (!keys) {
      const live = new Set(cards.map((card) => card.key)); const gone = {};
      for (const [key, item] of Object.entries(items)) if (ownItem(link, item) && item.itemId && !live.has(key) && !item.gone && link.push?.from !== 'now' && (link.push?.includeSkipped !== false || item.pushedStage !== 'passed')) gone[key] = { gone: true };
      if (Object.keys(gone).length) { store.patchItems(ws, gone); log(Object.keys(gone).map((key) => ({ ws, dir: 'out', kind: 'removed', key, itemId: items[key].itemId, trendName: items[key].name || '', text: `${quoted(items[key].name)} is no longer in the studio; its Monday item was left as it is.` }))); }
    }
    if (keys) cards = cards.filter((card) => keys.includes(card.key));
    const types = typesOf(link); const people = store.people(); const problems = record(link.fieldProblems);
    const valuesFor = (card, item) => {
      const values = cardsLib.fieldValues(card, link, { people });
      for (const field of Object.keys(problems)) delete values[field];
      if (item?.state === 'conflict' && !force) delete values.stage;
      return values;
    };
    // Plan: which keys need a lookup or a create, and which known items changed.
    const lookups = []; const entries = new Map();
    for (const card of cards) {
      const item = ownItem(link, items[card.key]) ? items[card.key] : null;
      if (item?.state === 'removed' && link.onDeleted !== 'recreate') continue;
      if (item?.state === 'failed' && item.nextTryAt && Date.parse(item.nextTryAt) > now() && !force) continue;
      if (force && item?.state === 'conflict') { store.patchItems(ws, { [card.key]: { state: 'synced', reverts: [] } }); item.state = 'synced'; }
      entries.set(card.key, card);
      if (!item?.itemId || item.state === 'removed') lookups.push(card.key);
    }
    // Look before creating: an item already carrying this key on the board is adopted, never added twice.
    try {
      if (lookups.length && link.columns?.studioKey) {
        for (const batch of chunks(lookups, L.lookupChunk)) {
          if (signal?.aborted) break;
          const found = await api.findItemsByKey(request, link.boardId, link.columns.studioKey, batch);
          const patches = {}; const rows = [];
          for (const key of batch) {
            const hits = found.filter((row) => row.key === key); if (!hits.length) continue;
            const [oldest] = hits; const card = entries.get(key);
            patches[key] = { boardId: link.boardId, itemId: oldest.itemId, url: oldest.url, groupId: oldest.groupId, name: card.name, state: 'synced', pushed: {}, attempts: 0, error: '', nextTryAt: '', posted: postedFor(card), gone: false };
            rows.push({ ws, dir: 'out', kind: 'adopted', key, itemId: oldest.itemId, trendName: card.name, text: `Found ${quoted(card.name)} already on Monday and linked it.` });
            if (hits.length > 1) rows.push({ ws, dir: 'out', kind: 'duplicate', key, itemId: oldest.itemId, trendName: card.name, text: `Two Monday items are named for ${quoted(card.name)}; the studio kept the older one. Delete the other on Monday.`, ok: false });
          }
          if (Object.keys(patches).length) { store.patchItems(ws, patches); log(rows); }
        }
        items = store.items(ws);
      }
      // Groups per research run are made when their first item is sent.
      if (link.groups?.by === 'run') {
        const missing = [...new Set([...entries.values()].filter((card) => !ownItem(link, items[card.key])?.itemId && !link.groups.ids?.[card.runId]).map((card) => card.runId))];
        if (missing.length) {
          const names = missing.map((runId) => { const card = [...entries.values()].find((row) => row.runId === runId); return `${card.programName} · ${String(card.discoveredAt).slice(0, 10)}`; });
          const ids = await api.createGroups(request, link.boardId, names);
          link = store.updateLink(ws, { groups: { ...link.groups, ids: { ...link.groups.ids, ...Object.fromEntries(missing.map((runId, i) => [runId, ids[i]]).filter(([, id]) => id)) } } });
        }
      }
    } catch (error) { runError(ws, link, error, 'push'); store.updateLink(ws, { lastPushAt: iso() }); emit(); return { error: error.kind || 'failed' }; }

    const ops = [];
    for (const [key, card] of entries) {
      const item = ownItem(link, items[key]) ? items[key] : null;
      const values = valuesFor(card, item);
      const { changed, hashes } = cardsLib.diff(values, item?.itemId && item.state !== 'removed' ? item.pushed || {} : {}, types);
      if (!item?.itemId || item.state === 'removed') {
        const columnValues = {};
        for (const [field, value] of Object.entries(values)) { if (field === 'name') continue; const encoded = api.encodeValue(types[field], value); if (encoded !== '' && !(typeof encoded === 'object' && !Object.keys(encoded).length)) columnValues[link.columns[field]] = encoded; }
        ops.push({ kind: 'create', key, card, name: card.name, groupId: groupFor(link, card), values: columnValues, hashes });
        continue;
      }
      const columnValues = {};
      for (const [field, value] of Object.entries(changed)) { if (field === 'name') columnValues.name = clip(value, 255); else columnValues[link.columns[field]] = api.encodeValue(types[field], value); }
      if (Object.keys(columnValues).length) ops.push({ kind: 'update', key, card, itemId: item.itemId, values: columnValues, hashes: Object.fromEntries(Object.keys(changed).map((field) => [field, hashes[field]])), fields: Object.keys(changed) });
      if (link.groups?.by === 'stage' && item.state !== 'conflict') { const target = link.groups.ids?.[card.stage]; if (target && item.groupId !== target) ops.push({ kind: 'move', key, card, itemId: item.itemId, groupId: target }); }
      if (link.push?.postUpdates !== false) for (const entry of cardsLib.milestones(card)) if (!item.posted?.[entry.id]) ops.push({ kind: 'post', key, card, itemId: item.itemId, body: entry.text, milestone: entry.id });
    }
    const sending = ops.slice(0, L.opsPerRun);
    if (current) { current.total = ops.length; current.done = 0; }
    if (ops.length > L.opsPerRun) later(60000, () => enqueue('push', ws, {}).catch(() => {}));
    let stopped = null;
    for (const batch of chunks(sending, L.chunk)) {
      if (signal?.aborted) break;
      const creates = batch.filter((op) => op.kind === 'create');
      // Persisted before the request leaves: a crash or a lost answer leads the next run to look these up, not re-create.
      if (creates.length) store.patchItems(ws, Object.fromEntries(creates.map((op) => [op.key, { boardId: link.boardId, name: op.card.name, state: 'unsure', lastPushAt: iso() }])));
      let results;
      try { results = await api.pushChunk(request, link.boardId, batch.map(({ kind, itemId, groupId, name, values, body }) => ({ kind, itemId, groupId, name, values, body }))); }
      catch (error) { stopped = error; break; }
      items = store.items(ws);
      const patches = {}; const rows = []; const fieldProblems = {};
      const patchOf = (key) => (patches[key] ||= {});
      batch.forEach((op, index) => {
        const result = results[index] || { ok: false, error: new api.MondayError('other') }; const item = items[op.key] || {}; const patch = patchOf(op.key);
        if (result.ok) {
          if (op.kind === 'create') { Object.assign(patch, { boardId: link.boardId, itemId: result.id, url: result.url, groupId: op.groupId || '', name: op.card.name, state: 'synced', pushed: op.hashes, pushedStage: op.card.stage, attempts: 0, error: '', nextTryAt: '', posted: postedFor(op.card), lastPushAt: iso(), gone: false }); counts.created++; rows.push({ ws, dir: 'out', kind: 'created', key: op.key, itemId: result.id, trendName: op.card.name, text: `Sent ${quoted(op.card.name)} (new item).` }); }
          else if (op.kind === 'update') { Object.assign(patch, { pushed: { ...(item.pushed || {}), ...(patch.pushed || {}), ...op.hashes }, pushedStage: op.card.stage, state: item.state === 'conflict' ? 'conflict' : 'synced', attempts: 0, error: '', nextTryAt: '', lastPushAt: iso() }); counts.updated++; rows.push({ ws, dir: 'out', kind: 'updated', key: op.key, itemId: op.itemId, trendName: op.card.name, text: `Updated ${quoted(op.card.name)} on Monday (${op.fields.map((field) => FIELDS.get(field)?.label || field).join(', ')}).` }); }
          else if (op.kind === 'move') { patch.groupId = op.groupId; counts.moved++; rows.push({ ws, dir: 'out', kind: 'moved', key: op.key, itemId: op.itemId, trendName: op.card.name, text: `Moved ${quoted(op.card.name)} to the ${catalog.stageLabels[op.card.stage] || op.card.stage} group.` }); }
          else { patch.posted = { ...(item.posted || {}), ...(patch.posted || {}), [op.milestone]: true }; counts.posted++; rows.push({ ws, dir: 'out', kind: 'posted', key: op.key, itemId: op.itemId, trendName: op.card.name, text: `Posted an update on ${quoted(op.card.name)}: ${clip(op.body, 160)}` }); }
          return;
        }
        const error = result.error || new api.MondayError('other');
        const lost = ['timeout', 'network', 'server'].includes(error.kind) && !error.neverLeft;
        if (error.kind === 'itemMissing' && op.kind !== 'create') {
          // The only failure that clears a saved item ID.
          Object.assign(patch, { itemId: '', url: '', state: 'removed', error: '' });
          rows.push({ ws, dir: 'out', kind: 'removed', key: op.key, itemId: op.itemId, trendName: op.card.name, text: `${quoted(op.card.name)} is gone from Monday.com.${link.onDeleted === 'recreate' ? ' It will be added again.' : ' It stays deleted.'}` });
          return;
        }
        if (error.kind === 'columnMissing') {
          const field = Object.keys(record(link.columns)).find((id) => link.columns[id] && String(error.detail).includes(link.columns[id])) || '';
          if (field) { fieldProblems[field] = plainError(error, link, { field }); return; }
        }
        if (op.kind === 'post' && lost) { patch.posted = { ...(item.posted || {}), [op.milestone]: true }; return; } // never post the same update twice
        const attempts = (Number(item.attempts) || 0) + 1;
        const message = plainError(error, link, { name: op.card.name });
        if (op.kind === 'create' && lost) Object.assign(patch, { state: 'unsure', error: message, attempts, nextTryAt: backoff(attempts) });
        else Object.assign(patch, { state: 'failed', error: message, attempts, nextTryAt: backoff(attempts) });
        counts.failed++;
        rows.push({ ws, dir: 'out', kind: 'error', key: op.key, itemId: op.itemId || '', trendName: op.card.name, text: `Couldn’t send ${quoted(op.card.name)}: ${message}`, ok: false });
      });
      store.patchItems(ws, patches); log(rows);
      if (Object.keys(fieldProblems).length) { link = store.updateLink(ws, { fieldProblems: { ...record(link.fieldProblems), ...fieldProblems } }); log(Object.values(fieldProblems).map((text) => ({ ws, dir: 'setup', kind: 'error', text, ok: false }))); }
      if (current) current.done += batch.length;
      if (current?.job) current.job.progress?.(Math.round((100 * current.done) / Math.max(1, sending.length)));
      if (sending.length > L.chunk) emit();
    }
    if (stopped) runError(ws, link, stopped, 'push');
    const changedSomething = Object.values(counts).some(Boolean) || Boolean(stopped);
    const sentSome = counts.created + counts.updated + counts.moved + counts.posted > 0;
    store.updateLink(ws, { lastPushAt: iso(), ...(sentSome ? { lastSentAt: iso() } : {}), ...(changedSomething ? { lastRun: { at: iso(), kind: 'push', ...counts, ms: now() - started } } : {}) });
    if (changedSomething) emit();
    return { ...counts, total: ops.length, sent: sending.length };
  }

  // ---------- PULL ----------
  const peopleFresh = (person) => person && now() - Date.parse(person.at || 0) < PEOPLE_TTL;
  async function refreshPeople(request, ids) {
    const cache = store.people(); const missing = [...new Set(ids.filter((id) => id && !peopleFresh(cache[id])))];
    if (!missing.length) return cache;
    try { const users = await api.findUsers(request, { ids: missing.slice(0, 100) }); if (users.length) store.setPeople(users); } catch (error) { if (!['other', 'value'].includes(error?.kind)) throw error; }
    return store.people();
  }
  // Who changed it on Monday, and whether their Yes or Skip counts here. 'members' (web): a studio member matched by
  // email who may decide trends. 'anyone' (and always on the Mac, which has no member list): anyone who can edit the board.
  function actorFor(userId, link, cache) {
    const person = userId ? cache[userId] : null; const name = person?.name || 'Someone on Monday.com';
    const policy = web ? link.pull?.decisions : 'anyone';
    if (policy !== 'members') return { ok: true, name, actor: { id: `monday:${userId || 'unknown'}`, name: `${clip(name, 100)} (Monday.com)` } };
    const identity = person?.email && typeof teamStore?.identityForEmail === 'function' ? teamStore.identityForEmail(person.email) : null;
    const allowed = Boolean(identity?.role) && typeof access?.allows === 'function' && access.allows(identity, 'decideResearchTheme');
    return allowed ? { ok: true, name, actor: { id: identity.id, name: identity.name } } : { ok: false, name };
  }

  async function pull(ws, { itemIds = [], full = false, force = false } = {}) {
    const link = store.link(ws);
    if (!link || !link.active) return { skipped: 'inactive' };
    if (blocked(link, force)) return { skipped: 'paused' };
    const token = getToken();
    if (!token) { pause(ws, 'token', api.COPY.auth); emit(); return { skipped: 'token' }; }
    const started = now(); const startedIso = iso(); const counts = { pulled: 0, decisions: 0, reverted: 0, comments: 0, removed: 0 };
    let request; try { request = client(token); } catch (error) { runError(ws, link, error, 'pull'); return { skipped: 'token' }; }
    let items = store.items(ws);
    const byItemId = new Map(Object.entries(items).filter(([, item]) => ownItem(link, item) && item.itemId).map(([key, item]) => [String(item.itemId), key]));
    const cursor = { activityFrom: '', seenActivityIds: [], lastUpdateId: '', ...record(link.cursor) };
    const changed = new Set(list(itemIds).map(String));
    let activity = []; let boardUpdates = []; let needsFull = Boolean(full) || Boolean(link.needsFull);
    const stageColumn = link.columns?.stage || ''; const ownerColumn = link.columns?.owner || ''; const dateColumn = link.columns?.plannedDate || '';
    try {
      const from = cursor.activityFrom ? iso(Date.parse(cursor.activityFrom) - 60000) : iso(now() - HOUR);
      const changes = await api.readChanges(request, link.boardId, from);
      const seen = new Set(cursor.seenActivityIds);
      activity = changes.activity.filter((row) => !seen.has(row.id));
      for (const row of activity) for (const id of row.itemIds) changed.add(id);
      boardUpdates = changes.updates;
      if (link.pull?.comments !== false) for (const row of boardUpdates) if (Number(row.id) > Number(cursor.lastUpdateId || 0) && row.itemId) changed.add(row.itemId);
      if (changes.needsFull) needsFull = true;
      const ids = needsFull ? [...byItemId.keys()] : [...changed].filter((id) => byItemId.has(id));
      const rows = [];
      for (const batch of chunks(ids, L.readChunk)) rows.push(...(await api.readItems(request, batch, [stageColumn, ownerColumn, dateColumn].filter(Boolean), { updates: link.pull?.comments !== false })));
      const returned = new Set(rows.map((row) => row.itemId));
      const cache = await refreshPeople(request, [...activity.map((row) => row.userId), ...rows.flatMap((row) => (ownerColumn && row.columns[ownerColumn] ? api.decodeValue('people', row.columns[ownerColumn]) : []))]);
      const cards = new Map(cardsFor(ws, { ...link, push: { ...link.push, from: 'all', includeSkipped: true } }, items).map((card) => [card.key, card]));
      const labels = { ...catalog.stageLabels, ...record(link.statusLabels) };
      const reverse = new Map(STAGES.map((stage) => [String(labels[stage]).toLowerCase(), stage]));
      const types = typesOf(link);
      const patches = {}; const logs = []; const reverts = [];
      const patchOf = (key) => (patches[key] ||= {});
      for (const id of ids) {
        if (returned.has(id)) continue;
        const key = byItemId.get(id); const item = items[key];
        if (item.state === 'removed') continue;
        Object.assign(patchOf(key), { state: 'removed', itemId: '', url: '' }); counts.removed++;
        logs.push({ ws, dir: 'in', kind: 'removed', key, itemId: id, trendName: item.name || cards.get(key)?.name || '', text: `${quoted(item.name || cards.get(key)?.name)} was deleted on Monday.com.${link.onDeleted === 'recreate' ? ' It will be added again.' : ' It stays deleted.'}` });
      }
      for (const row of rows) {
        const key = byItemId.get(row.itemId); const item = items[key]; const card = cards.get(key); const name = card?.name || item.name || row.name;
        counts.pulled++;
        if (row.state === 'deleted' || row.state === 'archived') {
          if (item.state !== 'removed') { Object.assign(patchOf(key), { state: 'removed', ...(row.state === 'deleted' ? { itemId: '', url: '' } : {}) }); counts.removed++; logs.push({ ws, dir: 'in', kind: 'removed', key, itemId: row.itemId, trendName: name, text: `${quoted(name)} was ${row.state} on Monday.com.${link.onDeleted === 'recreate' ? ' It will be added again.' : ' It stays that way.'}` }); }
          continue;
        }
        if (item.state === 'removed') Object.assign(patchOf(key), { state: 'synced' });
        if (row.url && row.url !== item.url) patchOf(key).url = row.url;
        if (!card) continue; // the run is gone; the item is left as it is
        // Stage: shared while the trend waits for an OK (newest change wins, from an allowed person); the studio's after.
        if (stageColumn && row.columns[stageColumn] && item.state !== 'conflict') {
          const label = String(api.decodeValue('status', row.columns[stageColumn]) || '').trim();
          const stage = reverse.get(label.toLowerCase());
          const studioLabel = labels[card.stage];
          if (stage && label.toLowerCase() !== String(studioLabel).toLowerCase()) {
            const change = activity.filter((entry) => entry.itemIds.includes(row.itemId) && (!entry.columnId || entry.columnId === stageColumn)).sort((a, b) => b.at - a.at)[0] || null;
            const changedAt = change?.at || Date.parse(row.updatedAt || '') || now();
            const decision = DECISION_OF[stage];
            let reason = '';
            if (!decision) reason = 'Ready and In production are set by the studio.';
            else if (!card.canDecide) reason = 'Decisions close once reports start.';
            else if (link.pull?.decisions === 'off') reason = 'Yes and Skip from Monday are turned off.';
            else if (card.decidedBy?.at && Date.parse(card.decidedBy.at) > changedAt) reason = 'A newer decision in the studio wins.';
            let who = null;
            if (!reason) { who = actorFor(change?.userId || '', link, cache); if (!who.ok) reason = `${who.name} isn’t in this studio, so their change wasn’t used.`; }
            if (!reason) {
              try {
                workspace.decideResearchTheme({ runId: card.runId, themeId: card.themeId, decision }, { by: who.actor, via: 'monday', workspaceId: ws });
                try { teamStore?.log?.('trend-decision', ws, { runId: card.runId, themeId: card.themeId, trendName: card.name, decision, via: 'monday' }, who.actor); } catch (_) { /* analytics never block a decision */ }
                Object.assign(patchOf(key), { pushed: { ...(item.pushed || {}), stage: cardsLib.hashOf(types.stage, labels[stage]) }, pushedStage: stage });
                counts.decisions++;
                logs.push({ ws, dir: 'in', kind: 'decision', key, itemId: row.itemId, trendName: name, by: who.name, text: decision === 'pending' ? `${who.name} moved ${quoted(name)} back to waiting on Monday.` : `${who.name} said ${decision === 'approved' ? 'Yes' : 'Skip'} on Monday to ${quoted(name)}.` });
              } catch (error) { reason = clip(error.message, 160) || 'Decisions close once reports start.'; }
            }
            if (reason) reverts.push({ key, item, card, name, studioLabel, reason });
          }
        }
        // Owner and planned date: read only when Monday owns them.
        if (ownerColumn && link.pull?.owner !== false && (link.fieldOptions?.owner?.direction || 'fromMonday') === 'fromMonday') {
          const ids = api.decodeValue('people', row.columns[ownerColumn] || {}); const person = ids[0] ? cache[ids[0]] : null;
          const owner = ids[0] ? { id: ids[0], name: clip(person?.name || 'Someone on Monday.com', 120) } : null;
          if (JSON.stringify(owner) !== JSON.stringify(item.owner || null)) { patchOf(key).owner = owner; logs.push({ ws, dir: 'in', kind: 'owner', key, itemId: row.itemId, trendName: name, text: owner ? `${owner.name} owns ${quoted(name)} on Monday.` : `${quoted(name)} has no owner on Monday any more.` }); }
        }
        if (dateColumn && link.pull?.dates !== false && link.fieldOptions?.plannedDate?.direction === 'fromMonday') {
          const date = String(api.decodeValue('date', row.columns[dateColumn] || {}) || '').slice(0, 10);
          if (date !== (item.mondayDate || '')) { patchOf(key).mondayDate = date; logs.push({ ws, dir: 'in', kind: 'date', key, itemId: row.itemId, trendName: name, text: date ? `Planned date for ${quoted(name)} set to ${date} on Monday.` : `Planned date for ${quoted(name)} cleared on Monday.` }); }
        }
        // Comments: Monday's. Stored as plain text (data, never instructions); the studio's own posts are skipped.
        if (link.pull?.comments !== false && row.updates.length) {
          const known = new Set(list(item.notes).map((note) => note.id)); const accountId = store.account()?.userId || '';
          const fresh = row.updates.filter((update) => !known.has(update.id) && !([api.STUDIO_POST, LEGACY_STUDIO_POST].some((prefix) => update.text.startsWith(prefix.trim())) && (!accountId || update.creatorId === accountId)))
            .map((update) => ({ id: update.id, by: update.creatorName || 'Someone on Monday.com', text: clip(update.text, L.noteChars), at: update.at }));
          if (fresh.length) {
            patchOf(key).notes = [...list(item.notes), ...fresh].sort((a, b) => String(a.at).localeCompare(String(b.at))).slice(-L.notesPerItem);
            counts.comments += fresh.length;
            logs.push(...fresh.map((note) => ({ ws, dir: 'in', kind: 'comment', key, itemId: row.itemId, trendName: name, by: note.by, text: `${note.by} commented on ${quoted(name)} on Monday.` })));
          }
        }
      }
      store.patchItems(ws, patches); log(logs);
      // Changes the studio doesn't take are changed back on Monday; an item changed back three times in an hour is left
      // alone (its stage isn't sent again until someone presses Sync now).
      if (reverts.length) {
        items = store.items(ws);
        const ops = []; const after = {}; const rowsOut = [];
        for (const entry of reverts) {
          const recent = [...list(items[entry.key]?.reverts).filter((at) => now() - Date.parse(at) < HOUR), iso()];
          const conflict = recent.length >= L.revertsPerHour;
          after[entry.key] = { reverts: recent.slice(-L.revertsPerHour), ...(conflict ? { state: 'conflict', error: `Someone (or a Monday automation) keeps changing ${quoted(entry.name)} on Monday; its stage there won’t be updated until you press Sync now.` } : {}) };
          ops.push({ kind: 'update', itemId: entry.item.itemId, values: { [stageColumn]: api.encodeValue('status', entry.studioLabel) } });
          rowsOut.push({ ws, dir: 'out', kind: 'reverted', key: entry.key, itemId: entry.item.itemId, trendName: entry.name, text: `Changed back ${quoted(entry.name)} on Monday: ${entry.reason}`, ok: false });
        }
        for (const batch of chunks(ops, L.chunk)) await api.pushChunk(request, link.boardId, batch);
        counts.reverted = reverts.length;
        store.patchItems(ws, after); log(rowsOut);
      }
      const seenIds = [...cursor.seenActivityIds, ...activity.map((row) => row.id)].slice(-200);
      const lastUpdateId = boardUpdates.reduce((max, row) => (Number(row.id) > Number(max || 0) ? row.id : max), cursor.lastUpdateId || '');
      store.updateLink(ws, { cursor: { activityFrom: startedIso, seenActivityIds: seenIds, lastUpdateId: String(lastUpdateId || '') }, needsFull: false, lastPullAt: iso(), ...(counts.decisions || counts.reverted || counts.comments || counts.removed ? { lastRun: { at: iso(), kind: full ? 'full' : 'pull', ...counts, ms: now() - started } } : {}) });
    } catch (error) {
      runError(ws, link, error, 'pull');
      store.updateLink(ws, { lastPullAt: iso() }); emit();
      return { error: error?.kind || 'failed' };
    }
    if (counts.decisions || counts.reverted || counts.comments || counts.removed) emit();
    return counts;
  }

  // ---------- Webhooks ----------
  const hookQueue = new Map(); // ws → Set of item IDs
  const pendingSecrets = new Map(); // hash → ws, while create_webhook's challenge is in flight
  let hookTimer = null; const hookSeen = new Map();
  function receiveHook(secret, body) {
    const ws = store.hookMatch(secret) || (typeof secret === 'string' && /^[a-f0-9]{64}$/.test(secret) ? pendingSecrets.get(hashSecret(secret)) : null);
    if (!ws) return { status: 404, body: { error: 'Unknown endpoint.' } };
    if (body && typeof body.challenge === 'string') return body.challenge.length <= 200 ? { status: 200, body: { challenge: body.challenge } } : { status: 400, body: { error: 'Send JSON.' } };
    const link = store.link(ws); const event = record(body?.event);
    if (!link?.active || String(event.boardId ?? '') !== String(link.boardId) || !/^\d{1,20}$/.test(String(event.pulseId ?? ''))) return { status: 200, body: {} };
    const queue = hookQueue.get(ws) || new Set(); hookQueue.set(ws, queue);
    if (queue.size >= L.hookQueue) store.updateLink(ws, { needsFull: true }); else queue.add(String(event.pulseId));
    hookSeen.set(ws, now());
    cancel(hookTimer);
    hookTimer = later(3000, () => {
      hookTimer = null;
      for (const [target, ids] of hookQueue) {
        hookQueue.delete(target);
        if (hookSeen.has(target)) { store.updateLink(target, { lastHookAt: iso(hookSeen.get(target)) }); hookSeen.delete(target); }
        enqueue('pull', target, { itemIds: [...ids] }).catch(() => {});
      }
    });
    return { status: 200, body: {} };
  }
  function hookUrl(base, secret) {
    const url = `${String(base || '').replace(/\/+$/, '')}/hooks/monday/${secret}`;
    let parsed = null; try { parsed = new URL(url); } catch (_) { parsed = null; }
    if (!parsed || parsed.protocol !== 'https:' || /^(?:localhost|127\.|\[::1\]|0\.0\.0\.0)|\.(?:localhost|local|test)$/i.test(parsed.hostname) || url.length > 255) return '';
    return url;
  }
  async function removeHooks(request, link) {
    for (const hook of list(link?.webhooks)) { try { await api.deleteWebhook(request, hook.id); } catch (_) { /* best effort: Monday drops hooks of deleted boards itself */ } }
  }
  const UNAVAILABLE = 'Monday couldn’t reach this studio. If it sits behind company sign-in, let /hooks/monday/ through (deploy guide). Checking every 5 minutes instead.';
  async function registerHooks(request, ws, link, base) {
    const secret = crypto.randomBytes(32).toString('hex'); const url = hookUrl(base, secret);
    if (!url) return { hookStatus: 'unavailable', hookNote: base ? UNAVAILABLE : 'Instant updates need the studio’s public https address. Checking every 5 minutes instead.', webhooks: [], hookSecretHash: '' };
    const hash = hashSecret(secret); pendingSecrets.set(hash, ws);
    const created = [];
    try {
      for (const event of catalog.hookEvents) created.push({ id: await api.createWebhook(request, link.boardId, url, event), event });
      return { hookStatus: 'on', hookNote: '', webhooks: created, hookSecretHash: hash };
    } catch (error) {
      await removeHooks(request, { webhooks: created });
      if (['auth', 'permission', 'boardMissing', 'daily'].includes(error?.kind)) throw error;
      return { hookStatus: 'unavailable', hookNote: UNAVAILABLE, webhooks: [], hookSecretHash: '' };
    } finally { pendingSecrets.delete(hash); }
  }
  async function checkHooks(ws) {
    const link = store.link(ws); if (!link?.active || link.hookStatus !== 'on') return null;
    const request = client();
    const ids = new Set((await api.listWebhooks(request, link.boardId)).map((hook) => hook.id));
    const missing = list(link.webhooks).filter((hook) => !ids.has(hook.id));
    if (missing.length) {
      await removeHooks(request, link);
      const hooks = await registerHooks(request, ws, link, link.studioOrigin);
      store.updateLink(ws, { ...hooks, lastHookCheckAt: iso() });
      log({ ws, dir: 'setup', kind: 'webhook', text: hooks.hookStatus === 'on' ? 'Turned instant updates back on: Monday had dropped the studio’s webhooks.' : hooks.hookNote, ok: hooks.hookStatus === 'on' });
    } else store.updateLink(ws, { lastHookCheckAt: iso() });
    return { ok: !missing.length };
  }

  // ---------- Scheduler ----------
  let ticker = null; let liveTimer = null;
  function tick() {
    for (const [ws, link] of Object.entries(store.links())) {
      if (!link?.active || hiddenWs(ws)) continue;
      if (link.paused?.reason === 'daily' && Date.parse(link.paused.until || '') <= now()) { store.updateLink(ws, { paused: null }); log({ ws, dir: 'setup', kind: 'resumed', text: 'Monday.com’s daily limit reset; syncing again.' }); }
      const fresh = store.link(ws); if (blocked(fresh)) continue;
      const lastPush = Date.parse(fresh.lastPushAt || '') || 0; const lastPull = Date.parse(fresh.lastPullAt || '') || 0;
      const mode = fresh.push?.mode;
      if (mode === 'hourly' && now() - lastPush >= HOUR) enqueue('push', ws).catch(() => {});
      if (mode === 'daily') { const local = localTime(now(), fresh.push.timeZone || 'UTC'); const last = lastPush ? localTime(lastPush, fresh.push.timeZone || 'UTC') : null; if (local.time >= (fresh.push.dailyAt || '09:00') && (!last || last.day < local.day || last.time < (fresh.push.dailyAt || '09:00'))) enqueue('push', ws).catch(() => {}); }
      const pulling = pullMode(fresh);
      if (pulling === 'poll' && now() - lastPull >= (Number(fresh.pull?.pollMinutes) || 5) * 60000) enqueue('pull', ws).catch(() => {});
      if (pulling === 'instant' && now() - lastPull >= HOUR) enqueue('pull', ws).catch(() => {}); // catches events Monday never sent
      if ((mode !== 'manual' || pulling !== 'manual') && now() - (Date.parse(fresh.lastFullAt || '') || 0) >= FULL_EVERY) enqueue('full', ws).catch(() => {});
      if (fresh.hookStatus === 'on' && now() - (Date.parse(fresh.lastHookCheckAt || '') || 0) >= DAY) enqueue('hooks', ws).catch(() => {});
    }
  }
  function start() { if (ticker) return; ticker = T.setInterval(() => { try { tick(); } catch (error) { warn(`Monday.com scheduler: ${error.message}`); } }, 60000); ticker?.unref?.(); }
  function stop() { if (ticker) T.clearInterval(ticker); ticker = null; for (const timer of owned) T.clearTimeout(timer); owned.clear(); liveTimer = null; hookTimer = null; try { store.flush(); } catch (_) { /* best effort */ } }
  // Called from every state broadcast: a live link sends what changed 15 s after the first change.
  function noteChange() {
    if (emitting || liveTimer) return;
    const live = Object.entries(store.links()).filter(([ws, link]) => link?.active && link.push?.mode === 'live' && !blocked(link) && !hiddenWs(ws));
    if (!live.length) return;
    liveTimer = later(15000, () => { liveTimer = null; for (const [ws] of live) enqueue('push', ws).catch(() => {}); });
  }

  // ---------- Background job: Sync now ----------
  function syncNow({ keys, full = false, force } = {}) {
    const ws = activeWs(); const link = store.link(ws);
    if (!getToken()) throw refuse('Connect Monday.com in Settings first.');
    if (!link?.boardId) throw refuse('Choose a Monday.com board in Settings first.');
    if (!link.active) throw refuse('Turn on syncing in Settings → Monday.com first.');
    const wanted = Array.isArray(keys) ? [...new Set(keys.filter((key) => typeof key === 'string' && key.length <= 400 && /^[^:\s]+:[^\s]+$/.test(key)))].slice(0, 500) : null;
    if (Array.isArray(keys) && !wanted.length) throw refuse('Choose a trend to send.');
    const signature = signatureOf(full ? 'full' : 'push', ws, { keys: wanted, full, force: force ?? true });
    if (current?.job && current.signature === signature) return { jobId: current.job.id, queued: 0, joined: true };
    if (waitingJobs.has(signature)) return { jobId: waitingJobs.get(signature).id, queued: 0, joined: true };
    const id = `monday-${crypto.randomUUID()}`;
    const handle = jobs?.start ? jobs.start({ id, kind: 'monday', title: 'Syncing with Monday.com' }) : null;
    const job = { id, progress: handle?.progress };
    const opts = { keys: wanted, full, force: force ?? true, job, signal: handle?.signal || null };
    const queuedRun = enqueue(full ? 'full' : 'push', ws, opts);
    if (waiting.has(signature)) waitingJobs.set(signature, job);
    queuedRun.then((result) => {
      const pushed = full ? result?.pushed : result; const failed = Number(pushed?.failed) || 0;
      handle?.finish?.({ status: 'succeeded', message: pushed?.skipped ? 'Monday.com sync is paused.' : `${pushed?.created || 0} new, ${pushed?.updated || 0} updated${failed ? `, ${failed} couldn’t send` : ''}.` });
    }, (error) => handle?.fail?.(error));
    return { jobId: id, queued: wanted ? wanted.length : 0 };
  }
  function activeLine() { return current && !current.job ? `Monday.com: syncing ${store.link(current.ws)?.boardName || 'your board'}` : ''; }

  // ---------- Setup ----------
  const dailyLimitOf = (tier) => catalog.dailyCalls[String(tier || '').toLowerCase()] ?? null;
  const publicAccount = (acc) => (acc ? { name: acc.userName || '', accountName: acc.accountName || '', plan: acc.tier ? acc.tier.charAt(0).toUpperCase() + acc.tier.slice(1) : '' } : null);
  async function connect({ token } = {}) {
    const value = typeof token === 'string' ? token.trim() : '';
    if (value.length < 20 || value.length > 4000 || /\s/.test(value)) return { ok: false, account: null, dailyLimit: null, error: 'That doesn’t look like a Monday.com API token. Copy it again from Developers → My access tokens.' };
    let account;
    try { account = await api.whoAmI(client(value)); }
    catch (error) {
      if (error?.kind === 'auth' || error?.kind === 'permission') return { ok: false, account: null, dailyLimit: null, error: 'Monday.com didn’t accept this token. Copy it again from Developers → My access tokens.' };
      return { ok: false, account: null, dailyLimit: null, error: plainError(error, null) };
    }
    saveToken(value); store.setAccount(account); tokenSaved();
    log({ ws: activeWs(), dir: 'setup', kind: 'resumed', text: `Connected as ${account.userName || 'the token’s owner'} · ${account.accountName || 'Monday.com'}.` });
    emit();
    return { ok: true, account: publicAccount(account), dailyLimit: dailyLimitOf(account.tier) };
  }
  function tokenSaved() {
    for (const [ws, link] of Object.entries(store.links())) if (link?.paused?.reason === 'token') { store.updateLink(ws, { paused: null }); log({ ws, dir: 'setup', kind: 'resumed', text: 'The Monday.com token works again; syncing resumed.' }); }
  }
  function tokenCleared() {
    for (const ws of Object.keys(store.links())) pause(ws, 'token', 'Monday.com was disconnected. Connect it again in Settings → Monday.com to keep syncing.');
  }
  function problemsFor(board, link) {
    const problems = [];
    for (const [field, columnId] of Object.entries(record(link?.columns))) {
      if (!columnId) continue;
      const column = board.columns.find((row) => row.id === columnId);
      const spec = FIELDS.get(field);
      if (!column) problems.push(`The “${link.columnInfo?.[columnId]?.title || columnId}” column is gone. Choose another column for ${spec?.label || field}, or turn it off.`);
      else if (spec && !spec.types.includes(column.type)) problems.push(`The “${column.title}” column can’t hold ${spec.label}. Choose another column.`);
    }
    for (const field of catalog.fields.filter((row) => row.required)) if (!link?.columns?.[field.id]) problems.push(`Choose a column for ${field.label}.`);
    return problems;
  }
  async function test() {
    const token = getToken();
    if (!token) return { ok: false, account: null, board: null, hooks: { status: 'off', note: '' }, callsToday: store.callsToday() };
    const request = client(token); let account = null;
    try { account = await api.whoAmI(request); store.setAccount(account); }
    catch (error) {
      if (error?.kind === 'auth') { for (const ws of Object.keys(store.links())) pause(ws, 'token', api.COPY.auth); emit(); }
      return { ok: false, account: null, board: null, hooks: { status: 'off', note: '' }, callsToday: store.callsToday(), error: plainError(error, null) };
    }
    if (Object.values(store.links()).some((row) => row?.paused?.reason === 'token')) tokenSaved();
    const ws = activeWs(); let link = store.link(ws); let board = null; let hooks = { status: link?.hookStatus || 'off', note: link?.hookNote || '' };
    if (link?.boardId) {
      try {
        const described = await api.describeBoard(request, link.boardId);
        const problems = problemsFor(described, link);
        board = { ok: !problems.length, name: described.name, problems };
        if (link.paused && ['permission', 'board-missing'].includes(link.paused.reason)) { link = store.updateLink(ws, { paused: null }); log({ ws, dir: 'setup', kind: 'resumed', text: `The board “${described.name}” is reachable again; syncing resumed.` }); }
        if (link.hookStatus === 'on') { const result = await checkHooks(ws); hooks = { status: store.link(ws).hookStatus, note: store.link(ws).hookNote || (result?.ok ? '' : 'Instant updates were turned back on.') }; }
      } catch (error) { board = { ok: false, name: link.boardName || '', problems: [plainError(error, link)] }; if (error?.kind === 'boardMissing') pause(ws, 'board-missing', plainError(error, link)); }
    }
    emit();
    return { ok: Boolean(account) && (!board || board.ok), account: publicAccount(account), board, hooks, callsToday: store.callsToday() };
  }
  async function listBoards({ workspaceId = '', search = '', page = 1 } = {}) {
    const request = client();
    const [workspaces, boards] = await Promise.all([api.listWorkspaces(request), api.listBoards(request, { workspaceId, search, page })]);
    return { workspaces: workspaces.map(({ id, name }) => ({ id, name })), boards: boards.boards, more: boards.more };
  }
  // A suggested mapping matches title and type only (a board's first Status column might be Priority), plus Studio key's
  // fixed column id; the linked board keeps its saved mapping.
  function suggestion(board, link) {
    const columns = {}; const used = new Set();
    for (const field of catalog.fields) {
      if (field.fixed) continue;
      const saved = link?.boardId === board.id ? link.columns?.[field.id] : '';
      const titles = [field.title, field.label].filter(Boolean).map((text) => text.toLowerCase());
      const pick = (saved && board.columns.find((column) => column.id === saved && field.types.includes(column.type)))
        || board.columns.find((column) => !used.has(column.id) && field.types.includes(column.type) && ((field.columnId && column.id === field.columnId) || titles.includes(column.title.toLowerCase())));
      if (pick) { columns[field.id] = pick.id; used.add(pick.id); }
    }
    const stageColumn = board.columns.find((column) => column.id === columns.stage);
    const existing = list(stageColumn?.labels);
    const statusLabels = Object.fromEntries(STAGES.map((stage) => { const saved = link?.boardId === board.id ? link.statusLabels?.[stage] : ''; const fallback = catalog.stageLabels[stage]; return [stage, saved || existing.find((label) => label.toLowerCase() === fallback.toLowerCase()) || fallback]; }));
    return { columns, statusLabels };
  }
  function boardShape(board, link) {
    const suggested = suggestion(board, link);
    const missing = catalog.fields.filter((field) => field.required && !suggested.columns[field.id]).map((field) => field.id);
    const problems = missing.map((id) => (id === 'studioKey' ? 'Add a Studio key column so the studio never adds an item twice.' : `Add a ${FIELDS.get(id).label} column (Status) so trends show their stage.`));
    return { board: { id: board.id, name: board.name, url: board.url, workspaceName: board.workspaceName, itemsCount: board.itemsCount || 0 }, columns: board.columns, groups: board.groups, suggested, missing, problems };
  }
  async function readBoard(payload = {}) {
    const boardId = api.boardIdFrom(payload);
    return boardShape(await api.describeBoard(client(), boardId), store.link(activeWs()));
  }
  const columnSpecs = (fields) => [...new Set(fields)].map((id) => FIELDS.get(id)).filter((field) => field && !field.fixed).map((field) => ({ field: field.id, type: field.types[0], title: field.title || field.label, ...(field.columnId ? { id: field.columnId } : {}) }));
  async function createBoard({ name, workspaceId = '', kind = 'public', groupBy = 'stage', fields = [] } = {}) {
    const ws = activeWs(); const request = client();
    const title = clip(name, 160); if (!title) throw refuse('Name the board.');
    const by = ['stage', 'run', 'none'].includes(groupBy) ? groupBy : 'stage';
    const chosen = ['stage', 'studioKey', ...list(fields).filter((id) => FIELDS.has(id) && !(id === 'studioLink' && !origin()))];
    const made = await api.createBoard(request, { name: title, kind, workspaceId: workspaceId && /^\d{1,20}$/.test(String(workspaceId)) ? String(workspaceId) : '' });
    const results = [];
    for (const batch of chunks(columnSpecs(chosen), 8)) results.push(...(await api.createColumns(request, made.id, batch)));
    const groupNames = by === 'stage' ? STAGES.map((stage) => catalog.stageLabels[stage]) : ['Trends'];
    const groupIds = await api.createGroups(request, made.id, groupNames);
    const ours = new Set(groupIds.filter(Boolean));
    const board = await api.describeBoard(request, made.id);
    for (const group of board.groups) if (!ours.has(group.id)) { try { await api.deleteGroup(request, made.id, group.id); } catch (_) { /* a template's leftover group can stay */ } }
    const columns = Object.fromEntries(results.filter((row) => row.ok).map((row) => [row.field, row.id]));
    const columnInfo = Object.fromEntries(results.filter((row) => row.ok).map((row) => [row.id, { title: row.title, type: row.type }]));
    const base = defaultLink(web);
    const existing = store.link(ws);
    const saved = store.saveLink(ws, { ...base, ...(existing ? { webhooks: existing.webhooks, hookStatus: existing.hookStatus } : {}), active: false, boardId: made.id, boardName: title, boardUrl: made.url || board.url, mondayWorkspaceName: board.workspaceName, columns, columnInfo,
      groups: { by, ids: by === 'stage' ? Object.fromEntries(STAGES.map((stage, i) => [stage, groupIds[i]]).filter(([, id]) => id)) : {}, defaultGroupId: by === 'stage' ? groupIds[0] || '' : groupIds[0] || '' },
      push: { ...base.push, from: 'all' } });
    const failed = results.filter((row) => !row.ok);
    log({ ws, dir: 'setup', kind: 'resumed', text: `Made “${title}” on Monday with ${results.length - failed.length} columns.${failed.length ? ` ${failed.length} couldn’t be added.` : ''}` });
    emit();
    return { ...boardShape(await api.describeBoard(request, made.id), saved), link: publicLink(ws, saved) };
  }
  async function fixBoard({ boardId, add = [] } = {}) {
    const ws = activeWs(); const request = client(); const link = store.link(ws);
    const target = boardId ? api.validateBoardId(boardId) : link?.boardId;
    if (!target) throw refuse('Choose a Monday.com board first.');
    const fields = list(add).filter((id) => FIELDS.has(id) && !FIELDS.get(id).fixed);
    if (!fields.length) throw refuse('Choose the columns to add.');
    const results = await api.createColumns(request, target, columnSpecs(fields));
    const failed = results.filter((row) => !row.ok);
    if (failed.length === results.length) throw refuse(failed[0]?.error?.kind === 'permission' ? `The studio’s Monday account can’t add columns to this board. Give it edit rights on the board.` : 'Monday didn’t add the columns. Try again, or add them on the board.');
    if (link?.boardId === target) {
      const ok = results.filter((row) => row.ok);
      const problems = { ...record(link.fieldProblems) }; for (const row of ok) delete problems[row.field];
      store.saveLink(ws, { columns: { ...record(link.columns), ...Object.fromEntries(ok.map((row) => [row.field, row.id])) }, columnInfo: { ...record(link.columnInfo), ...Object.fromEntries(ok.map((row) => [row.id, { title: row.title, type: row.type }])) }, fieldProblems: problems });
    }
    emit();
    return { ...boardShape(await api.describeBoard(request, target), store.link(ws)), rev: Number(store.link(ws)?.rev) || 0 };
  }
  const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  const validZone = (zone) => { try { new Intl.DateTimeFormat('en-US', { timeZone: zone }); return true; } catch (_) { return false; } };
  async function saveLink(payload = {}) {
    const ws = activeWs(); const existing = store.link(ws);
    if (existing && payload.rev !== undefined && Number(payload.rev) !== Number(existing.rev)) store.saveLink(ws, {}, { rev: payload.rev }); // throws mondaySetupChanged
    const actor = typeof access?.actorForCall === 'function' ? access.actorForCall() : { id: 'system', name: 'Automatic' };
    // Pause or resume only.
    if (typeof payload.paused === 'boolean' && !payload.boardId) {
      if (!existing) throw refuse('Choose a Monday.com board first.');
      const saved = store.saveLink(ws, { paused: payload.paused ? { reason: 'user', until: '', message: `${actor.name || 'An admin'} paused syncing.` } : null }, { rev: payload.rev });
      log({ ws, dir: 'setup', kind: payload.paused ? 'paused' : 'resumed', by: actor.name, text: payload.paused ? `${actor.name || 'An admin'} paused syncing.` : `${actor.name || 'An admin'} resumed syncing.` });
      if (!payload.paused && saved.active) enqueue('full', ws, { force: true }).catch(() => {});
      emit();
      return { monday: publicState() };
    }
    const request = client();
    const boardId = api.validateBoardId(payload.boardId || existing?.boardId);
    const board = await api.describeBoard(request, boardId);
    const base = existing?.boardId === boardId ? existing : { ...defaultLink(web), ...(existing ? { webhooks: existing.webhooks } : {}) };
    // Columns: each exists, its type fits the field, required fields are mapped, no column is used twice.
    const columns = {}; const seen = new Set();
    for (const [field, columnId] of Object.entries(record(payload.columns))) {
      const spec = FIELDS.get(field); if (!spec || spec.fixed) continue;
      if (!columnId) continue;
      const column = board.columns.find((row) => row.id === String(columnId));
      if (!column) throw refuse(`The column chosen for ${spec.label} isn’t on the board any more. Reload the board.`);
      if (!spec.types.includes(column.type)) throw refuse(`The “${column.title}” column can’t hold ${spec.label}.`);
      if (seen.has(column.id)) throw refuse(`The “${column.title}” column is chosen twice. Use each column for one field.`);
      if (field === 'studioLink' && !origin()) throw refuse(web ? 'Open in studio needs the studio’s web address.' : 'Open in studio needs a Studio web address in Settings first.');
      seen.add(column.id); columns[field] = column.id;
    }
    for (const field of catalog.fields.filter((row) => row.required)) if (!columns[field.id]) throw refuse(`Choose a column for ${field.label}${field.id === 'studioKey' ? ' (or press Add the missing columns)' : ''}.`);
    const columnInfo = Object.fromEntries(Object.values(columns).map((id) => { const column = board.columns.find((row) => row.id === id); return [id, { title: column.title, type: column.type }]; }));
    const statusLabels = {}; const labelSeen = new Set();
    for (const stage of STAGES) {
      const label = clip(record(payload.statusLabels)[stage] ?? base.statusLabels?.[stage] ?? catalog.stageLabels[stage], 80);
      if (!label) throw refuse('Give every stage a Monday label.');
      if (label.length > L.labelChars) throw refuse(`Keep Monday labels to ${L.labelChars} characters.`);
      if (labelSeen.has(label.toLowerCase())) throw refuse(`“${label}” is used for two stages. Use a different label for each.`);
      labelSeen.add(label.toLowerCase()); statusLabels[stage] = label;
    }
    const options = record(payload.fieldOptions);
    const fieldOptions = { plannedDate: { direction: options.plannedDate?.direction === 'fromMonday' ? 'fromMonday' : 'toMonday' }, owner: { direction: options.owner?.direction === 'toMonday' ? 'toMonday' : 'fromMonday' } };
    const pushIn = { ...base.push, ...record(payload.push) };
    const push = { mode: catalog.pushModes.includes(pushIn.mode) ? pushIn.mode : 'live', dailyAt: TIME.test(String(pushIn.dailyAt)) ? String(pushIn.dailyAt) : '09:00', timeZone: validZone(pushIn.timeZone) ? String(pushIn.timeZone) : 'UTC', from: pushIn.from === 'now' ? 'now' : 'all', includeSkipped: pushIn.includeSkipped !== false, postUpdates: pushIn.postUpdates !== false };
    const pullIn = { ...base.pull, ...record(payload.pull) };
    const pull = { mode: ['instant', 'poll', 'manual'].includes(pullIn.mode) ? pullIn.mode : 'poll', pollMinutes: catalog.pollMinutes.includes(Number(pullIn.pollMinutes)) ? Number(pullIn.pollMinutes) : 5, decisions: ['members', 'anyone', 'off'].includes(pullIn.decisions) ? pullIn.decisions : web ? 'members' : 'anyone', comments: pullIn.comments !== false, owner: pullIn.owner !== false, dates: pullIn.dates !== false };
    if (!web && pull.mode === 'instant') pull.mode = 'poll'; // the Mac app always polls, and only while it is open
    if (!web && pull.decisions === 'members') pull.decisions = 'anyone';
    // Groups: per stage (made now when missing), per research run (made with their first item), or one group.
    const groupsIn = record(payload.groups); const by = ['stage', 'run', 'none'].includes(groupsIn.by) ? groupsIn.by : base.groups?.by || 'stage';
    let groups = { by, ids: by === base.groups?.by ? { ...record(base.groups?.ids) } : {}, defaultGroupId: '' };
    if (by === 'stage') {
      const want = STAGES.filter((stage) => !board.groups.some((group) => group.id === groups.ids[stage]));
      for (const stage of want) { const match = board.groups.find((group) => group.title.toLowerCase() === statusLabels[stage].toLowerCase() || group.title.toLowerCase() === catalog.stageLabels[stage].toLowerCase()); if (match) groups.ids[stage] = match.id; }
      const missing = STAGES.filter((stage) => !groups.ids[stage]);
      if (missing.length) { const ids = await api.createGroups(request, boardId, missing.map((stage) => statusLabels[stage])); missing.forEach((stage, i) => { if (ids[i]) groups.ids[stage] = ids[i]; }); }
      groups.defaultGroupId = groups.ids.potential || board.groups[0]?.id || '';
    } else if (by === 'none') {
      const chosen = String(groupsIn.defaultGroupId || base.groups?.defaultGroupId || '');
      groups.defaultGroupId = board.groups.some((group) => group.id === chosen) ? chosen : board.groups[0]?.id || (await api.createGroups(request, boardId, ['Trends']))[0] || '';
      groups.ids = {};
    } else groups.defaultGroupId = board.groups[0]?.id || '';
    const active = payload.active === undefined ? Boolean(base.active) : Boolean(payload.active);
    const boardChanged = existing?.boardId && existing.boardId !== boardId;
    const becomesActive = active && (!existing?.active || boardChanged || !existing?.linkedAt);
    const studioOrigin = origin() || base.studioOrigin || '';
    // Webhooks: registered when Instantly is chosen (web), removed otherwise; re-made on a board change or on request.
    let hooks = { webhooks: list(base.webhooks), hookStatus: base.hookStatus || 'off', hookNote: base.hookNote || '', hookSecretHash: base.hookSecretHash || '' };
    const wantHooks = web && active && pull.mode === 'instant';
    if (!wantHooks || boardChanged || payload.resetHooks || (wantHooks && hooks.hookStatus !== 'on')) {
      if (hooks.webhooks.length) await removeHooks(request, existing || base);
      hooks = { webhooks: [], hookStatus: 'off', hookNote: '', hookSecretHash: '' };
      if (wantHooks) hooks = await registerHooks(request, ws, { boardId }, studioOrigin);
    }
    const saved = store.saveLink(ws, {
      ...base, active, boardId, boardName: board.name, boardUrl: board.url, mondayWorkspaceName: board.workspaceName, columns, columnInfo, fieldOptions, statusLabels, groups, push, pull,
      onDeleted: payload.onDeleted === 'recreate' ? 'recreate' : 'leave', studioOrigin, ...hooks,
      fieldProblems: {}, paused: base.paused?.reason === 'user' ? base.paused : null,
      ...(becomesActive ? { linkedAt: iso(), linkedBy: { id: String(actor.id || ''), name: clip(actor.name, 120) } } : {}),
      ...(boardChanged ? { cursor: { activityFrom: '', seenActivityIds: [], lastUpdateId: '' }, lastRun: null, lastPushAt: '', lastPullAt: '', lastFullAt: '' } : {}),
    }, { rev: existing ? payload.rev ?? existing.rev : undefined });
    log({ ws, dir: 'setup', kind: hooks.hookStatus === 'unavailable' && wantHooks ? 'webhook' : 'resumed', by: actor.name, text: becomesActive ? `${actor.name || 'An admin'} started syncing with “${board.name}”.` : `${actor.name || 'An admin'} saved the Monday.com setup.`, ok: true });
    if (wantHooks && hooks.hookStatus === 'unavailable') log({ ws, dir: 'setup', kind: 'webhook', text: hooks.hookNote, ok: false });
    if (becomesActive) enqueue('full', ws, { force: true }).catch(() => {});
    emit();
    return { monday: publicState(), saved: publicLink(ws, saved) };
  }
  async function disconnect({ scope = 'board', forgetItems = false } = {}) {
    const ws = activeWs(); const link = store.link(ws);
    if (link) {
      const token = getToken();
      if (token && list(link.webhooks).length) { try { await removeHooks(client(token), link); } catch (_) { /* best effort */ } }
      store.removeLink(ws, { forgetItems: Boolean(forgetItems) });
      log({ ws, dir: 'setup', kind: 'paused', text: `Stopped syncing with “${link.boardName || 'the board'}”. Items on Monday stay as they are.${forgetItems ? ' The studio forgot which items belong to which trends.' : ''}` });
    }
    if (scope === 'all') { clearToken(); store.setAccount(null); clientCache = null; tokenCleared(); log({ ws, dir: 'setup', kind: 'paused', text: 'Disconnected Monday.com.' }); }
    emit();
    return { monday: publicState() };
  }

  // ---------- Reads ----------
  function readLog({ limit = 50, before = '', problemsOnly = false, direction = '', key = '' } = {}) {
    const ws = activeWs(); const items = store.items(ws);
    const result = store.readLog({ ws, limit, before: typeof before === 'string' ? before.slice(0, 40) : '', problemsOnly: Boolean(problemsOnly), direction: ['in', 'out'].includes(direction) ? direction : '', key: typeof key === 'string' ? key.slice(0, 400) : '' });
    return { rows: result.rows.map(({ ws: _ws, ...row }) => ({ ...row, url: row.key && items[row.key]?.url ? items[row.key].url : '' })), more: result.more };
  }
  function readItem({ key } = {}) {
    if (typeof key !== 'string' || !key || key.length > 400) throw refuse('Choose a trend.');
    const ws = activeWs(); const item = store.item(ws, key); if (!item) return null;
    return { itemId: item.itemId || '', url: item.url || '', state: item.state || 'waiting', owner: item.owner ? { name: item.owner.name } : null, mondayDate: item.mondayDate || '', notes: list(item.notes).map(({ by, text, at }) => ({ by, text, at })), history: readLog({ key, limit: 10 }).rows };
  }

  // ---------- State (active workspace only; no secret, hook hash, email or money) ----------
  function nextRunAt(link) {
    const at = []; const lastPush = Date.parse(link.lastPushAt || '') || now(); const lastPull = Date.parse(link.lastPullAt || '') || now();
    if (link.push?.mode === 'hourly') at.push(lastPush + HOUR);
    if (pullMode(link) === 'poll') at.push(lastPull + (Number(link.pull?.pollMinutes) || 5) * 60000);
    return at.length ? iso(Math.min(...at)) : '';
  }
  function publicLink(ws, link = store.link(ws)) {
    if (!link) return null;
    const items = Object.values(store.items(ws)).filter((item) => ownItem(link, item));
    const counts = { onMonday: items.filter((item) => item.itemId && item.state !== 'removed').length, waiting: items.filter((item) => item.state === 'unsure').length, failed: items.filter((item) => item.state === 'failed').length, removed: items.filter((item) => item.state === 'removed').length, conflict: items.filter((item) => item.state === 'conflict').length };
    const problems = [...Object.values(record(link.fieldProblems)), ...(counts.conflict ? [`${counts.conflict} trend${counts.conflict === 1 ? '' : 's'} keep${counts.conflict === 1 ? 's' : ''} being changed on Monday; press Sync now to send the studio’s stage again.`] : [])];
    return {
      boardId: link.boardId || '', boardName: link.boardName || '', boardUrl: link.boardUrl || '', active: Boolean(link.active), rev: Number(link.rev) || 0, linkedAt: link.linkedAt || '',
      columns: Object.fromEntries(Object.entries(record(link.columns)).filter(([, id]) => id).map(([field, id]) => [field, { id, title: link.columnInfo?.[id]?.title || '', type: link.columnInfo?.[id]?.type || '' }])),
      fieldOptions: link.fieldOptions || {}, statusLabels: link.statusLabels || { ...catalog.stageLabels }, groups: { by: link.groups?.by || 'none', defaultGroupId: link.groups?.defaultGroupId || '' }, push: link.push || {},
      pull: { ...(link.pull || {}), instant: link.hookStatus || 'off', instantNote: link.hookNote || '', lastHookAt: link.lastHookAt || '' }, onDeleted: link.onDeleted || 'leave',
      lastRun: link.lastRun || null, lastPushAt: link.lastPushAt || '', lastSentAt: link.lastSentAt || '', lastPullAt: link.lastPullAt || '', nextRunAt: nextRunAt(link), paused: link.paused || null, problems, counts,
      progress: current && current.ws === ws && current.total ? { done: current.done, total: current.total } : null, webAddress: Boolean(origin() || link.studioOrigin),
    };
  }
  function publicState() {
    const ws = activeWs(); const account = store.account(); const link = store.link(ws); const items = store.items(ws);
    return {
      connected: Boolean(getToken()), account: publicAccount(account), dailyLimit: dailyLimitOf(account?.tier), callsToday: store.callsToday(), web: Boolean(web), webAddress: Boolean(web || origin()), // the web studio always knows its address when an admin saves
      // Older readers (Workflows' "Update Monday.com" check): the linked board's id and name.
      boardId: link?.boardId || '', boardName: link?.boardName || '',
      link: publicLink(ws, link),
      items: link ? Object.fromEntries(Object.entries(items).filter(([, item]) => ownItem(link, item)).map(([key, item]) => [key, { itemId: item.itemId || '', url: item.url || '', state: item.state === 'unsure' ? 'waiting' : item.state || 'synced', ...(item.error ? { error: item.error } : {}), ...(item.owner ? { owner: item.owner.name } : {}), ...(item.mondayDate ? { date: item.mondayDate } : {}), ...(list(item.notes).length ? { notes: item.notes.length } : {}) }])) : {},
    };
  }

  return { start, stop, tick, noteChange, run, push: (ws, opts) => enqueue('push', ws, opts), pull: (ws, opts) => enqueue('pull', ws, opts), full: (ws, opts) => enqueue('full', ws, opts), receiveHook, receive: receiveHook, syncNow, activeLine, connect, test, listBoards, readBoard, createBoard, fixBoard, saveLink, disconnect, readLog, readItem, publicState, tokenSaved, tokenCleared, idle: () => chain };
}

module.exports = { createMondayEngine, defaultLink };
