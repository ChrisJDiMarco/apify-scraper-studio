'use strict';
// Ask AI's live progress, one record per question: what the answer says so far, the steps the studio took (looking at
// the studio, reading a report, waiting for an AI slot), and how it ended. index.js begins a record when a question is
// accepted, the Ask AI pipeline (help-assistant.js askHelp) reports into it, and every change goes out at once to that
// person's open windows through `send(target, event)` (pushAskEvent: IPC on the Mac, the person's own event stream on the
// web). A window that missed events (a dropped stream, a reload, a second tab) reads the record back with
// readAskProgress, so nothing depends on every event arriving. CommonJS and Electron-free, so it is unit-testable.
//
// Wire events (each passes through `project` first, so a role without See costs never receives money):
//   { v:1, type:'progress', requestId, conversationId, seq, progress:{ status, steps, title, question, startedAt, mode,
//     textLength, final?, error? } }
//   { v:1, type:'delta', requestId, conversationId, seq, at, text }   at = how much answer text came before this piece
// `seq` grows by one per event of a request, so a window can tell when it missed one. A progress event whose textLength
// is shorter than the text a window holds means the studio withdrew text (a reading round, a retry inside the route).
// Text arrives in frames: deltas collect for `frameMs` and go out as one event, and any other event sends what is
// waiting first, so the order always holds.
const FINAL = new Set(['done', 'stopped', 'failed']);
const STATUSES = new Set(['starting', 'thinking', 'reading', 'writing', 'finishing', 'done', 'stopped', 'failed']);
const STEP_STATUSES = new Set(['running', 'done', 'failed']);
const MAX_STEPS = 12;
const MAX_TEXT = 12000; // the same limit cleanReply puts on an answer
const RECENT_MS = 60000; // active() also lists answers that finished this recently, so a reloaded window can show them
const clip = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

function createAskProgress({ send = () => {}, now = Date.now, frameMs = 50, keepMs = 600000, maxPerPerson = 20, maxTotal = 500, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const records = new Map(); // `${identityId}\u0000${requestId}` → record
  const keyOf = (identityId, requestId) => `${identityId}\u0000${requestId}`;
  const iso = () => new Date(now()).toISOString();

  function deliver(record, event) {
    let out;
    try { out = record.project(event); } catch (_) { return; } // never send what couldn't be projected
    if (!out) return;
    try { send(record.target, out); } catch (_) { /* a window that can't take it reads the snapshot later */ }
  }
  function body(record) {
    return {
      status: record.status, steps: record.steps.map((step) => ({ ...step })), title: record.title, question: record.question, startedAt: record.startedAt, mode: record.mode,
      textLength: record.text.length, ...(record.final ? { final: record.final } : {}), ...(record.error ? { error: { ...record.error } } : {}),
    };
  }
  function base(record, type) { record.seq += 1; return { v: 1, type, requestId: record.requestId, conversationId: record.conversationId, seq: record.seq }; }
  function flushText(record) {
    if (record.timer) { clearTimer(record.timer); record.timer = null; }
    if (record.text.length <= record.sent) return;
    const at = record.sent; const text = record.text.slice(at); record.sent = record.text.length;
    deliver(record, { ...base(record, 'delta'), at, text });
  }
  function changed(record) { flushText(record); deliver(record, { ...base(record, 'progress'), progress: body(record) }); }

  // Finished records stay for `keepMs` (a reload or a second tab can still read them), and each person and the whole
  // studio keep a bounded number; the oldest finished ones go first. Running answers are never dropped.
  function prune() {
    const at = now();
    for (const [key, record] of records) if (record.finishedAt && at - record.finishedAt > keepMs) records.delete(key);
    const finished = [...records.entries()].filter(([, record]) => record.finishedAt).sort((a, b) => a[1].finishedAt - b[1].finishedAt);
    const perPerson = new Map();
    for (const [, record] of records) perPerson.set(record.identityId, (perPerson.get(record.identityId) || 0) + 1);
    for (const [key, record] of finished) {
      if ((perPerson.get(record.identityId) || 0) <= maxPerPerson) continue;
      records.delete(key); perPerson.set(record.identityId, perPerson.get(record.identityId) - 1);
    }
    for (const [key] of finished) { if (records.size <= maxTotal) break; records.delete(key); }
  }

  function snapshotOf(record) {
    return {
      v: 1, requestId: record.requestId, conversationId: record.conversationId, question: record.question, status: record.status, mode: record.mode,
      steps: record.steps.map((step) => ({ ...step })), text: record.text, title: record.title, seq: record.seq, startedAt: record.startedAt,
      ...(record.final ? { final: record.final } : {}), ...(record.error ? { error: { ...record.error } } : {}),
    };
  }
  function projected(record) { try { return record.project(snapshotOf(record)) || null; } catch (_) { return null; } }

  function handleFor(record) {
    const open = () => !FINAL.has(record.status);
    return {
      requestId: record.requestId,
      // { id, kind, label, status }: a step with the same id is updated in place. At most MAX_STEPS are kept.
      step({ id, kind = '', label = '', status = 'running' } = {}) {
        if (!open() || !id) return;
        const row = { id: clip(id, 60), kind: clip(kind, 30), label: clip(label, 120), status: STEP_STATUSES.has(status) ? status : 'running' };
        const at = record.steps.findIndex((step) => step.id === row.id);
        if (at >= 0) { const before = record.steps[at]; if (before.label === row.label && before.status === row.status && before.kind === row.kind) return; record.steps[at] = row; }
        else { record.steps.push(row); if (record.steps.length > MAX_STEPS) record.steps.splice(0, record.steps.length - MAX_STEPS); }
        changed(record);
      },
      text(delta) {
        if (!open() || typeof delta !== 'string' || !delta) return;
        const room = MAX_TEXT - record.text.length; if (room <= 0) return;
        if (record.status !== 'writing') { record.status = 'writing'; changed(record); }
        record.text += delta.slice(0, room);
        if (!record.timer) record.timer = setTimer(() => { record.timer = null; flushText(record); }, frameMs);
      },
      // Withdraws the text shown so far (a reading round's "checking" line, a route that started over).
      reset() {
        if (!open() || (!record.text && !record.sent)) return;
        if (record.timer) { clearTimer(record.timer); record.timer = null; }
        record.text = ''; record.sent = 0;
        changed(record);
      },
      title(value) { const next = clip(value, 60); if (!open() || !next || next === record.title) return; record.title = next; changed(record); },
      status(value) { if (!open() || !STATUSES.has(value) || FINAL.has(value) || value === record.status) return; record.status = value; changed(record); },
      conversation(id) { if (!open() || typeof id !== 'string' || !id || id === record.conversationId) return; record.conversationId = id; },
      // reply: what help:ask returns ({ conversation, userMessage, message }).
      done(reply) {
        if (!open()) return;
        if (reply?.conversation?.id) record.conversationId = String(reply.conversation.id);
        record.status = 'done'; record.final = reply || null; record.finishedAt = now();
        changed(record); prune();
      },
      // stopped: the person pressed Stop; reply is the stored partial answer, when there was text to keep.
      failed({ message = '', code = '', stopped = false, reply = null, retryable = true } = {}) {
        if (!open()) return;
        if (reply?.conversation?.id) record.conversationId = String(reply.conversation.id);
        record.status = stopped ? 'stopped' : 'failed'; record.final = reply || null; record.finishedAt = now();
        record.error = { message: String(message || (stopped ? 'Stopped.' : 'Something went wrong. Try again.')).slice(0, 600), code: typeof code === 'string' ? code.slice(0, 40) : '', retryable: retryable !== false };
        changed(record); prune();
      },
      textSoFar: () => record.text,
      finished: () => !open(),
    };
  }

  // `target` is who the events go to ({ identityId, session }); `project(event)` shapes each event and snapshot for the
  // person who asked (money stripped for roles without See costs). `space` is the channel a channel owner asked from
  // ('' for everything else), the same space as their conversations (ask-store.js): snapshot() and active() given a
  // space return only that space's answers, so a person moved from Editor to a channel role, or to another channel,
  // never reads back an answer written for the old one. A finished record under the same request id is replaced; a
  // running one is joined (help:ask joins a repeated request rather than asking twice).
  function begin({ requestId, identityId, target = null, conversationId = '', question = '', mode = '', project = (event) => event, space = '' } = {}) {
    if (!requestId || !identityId) throw new Error('Ask AI progress needs a request and a person.');
    const key = keyOf(identityId, requestId); const existing = records.get(key);
    if (existing && !FINAL.has(existing.status)) return handleFor(existing);
    const record = {
      key, identityId: String(identityId), requestId: String(requestId), target: target || { identityId }, project: typeof project === 'function' ? project : (event) => event, space: String(space || ''),
      conversationId: String(conversationId || ''), question: String(question || '').slice(0, 2000), mode: mode === 'regenerate' || mode === 'edit' ? mode : '',
      status: 'starting', steps: [], text: '', sent: 0, title: '', seq: 0, startedAt: iso(), finishedAt: 0, final: null, error: null, timer: null,
    };
    records.set(key, record);
    changed(record); prune();
    return handleFor(record);
  }
  // `space` (a channel owner's channel): only answers asked from that space. None (admins and editors): all of theirs.
  const inSpace = (space) => { const wanted = typeof space === 'string' && space ? space : null; return (record) => !wanted || record.space === wanted; };
  const snapshot = (identityId, requestId, { space } = {}) => { const record = records.get(keyOf(identityId, requestId)); return record && inSpace(space)(record) ? projected(record) : null; };
  // This person's answers still running, and those that finished in the last minute.
  function active(identityId, { space } = {}) {
    const at = now(); const keep = inSpace(space);
    return [...records.values()].filter((record) => record.identityId === identityId && keep(record) && (!record.finishedAt || at - record.finishedAt <= RECENT_MS)).map(projected).filter(Boolean);
  }
  const running = (identityId) => [...records.values()].filter((record) => record.identityId === identityId && !record.finishedAt).length;
  return { begin, snapshot, active, running, size: () => records.size };
}

module.exports = { createAskProgress, ASK_PROGRESS_STATUSES: [...STATUSES], MAX_ASK_STEPS: MAX_STEPS, MAX_ASK_TEXT: MAX_TEXT };
