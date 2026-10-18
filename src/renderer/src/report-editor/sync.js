import * as Y from 'yjs';
import { encodeAwarenessUpdate } from 'y-protocols/awareness';
import { REMOTE, SEED, toBase64 } from './ydoc.js';

// Autosave for one open report. Local edits are sent about 1.5 s after the last keystroke and once more when the report
// closes (final: true, which also marks a version).
//
// mode 'live' (the studio has the report-doc methods): pushReportDocUpdate({ assetId, update, markdown, clientId,
// epoch, stateVector, final? }) sends what the studio doesn't have yet as a Yjs update plus the Markdown. The studio
// saves the Markdown only when this browser has seen everyone's changes (markdownSaved: false otherwise: this asks
// onBehind() to catch up and sends again), and refuses a change made before the document started over (409 docReset:
// onReset()). On the web it also carries `awareness` (this person's caret, a y-protocols awareness update) for other
// open editors; sendCaret() sends a caret move on its own. A studio that refuses the extra field is asked again
// without it.
// mode 'plain' (an older studio): editStudioAsset({ assetId, markdown, baseEditedAt }), with the conflict check.
//
// Status: 'idle' (nothing typed yet) · 'pending' (waiting to send) · 'saving' · 'saved' · 'error'.
export const SAVE_DELAY_MS = 1500;
export const RETRY_MS = 5000;

const isConflict = (failure) => failure?.status === 409 || failure?.code === 409 || /after you opened it/i.test(String(failure?.message || ''));
const isRefusedField = (failure) => [400, 422].includes(Number(failure?.status || failure?.code)) || /unknown|not allowed|unexpected/i.test(String(failure?.message || ''));

const isReset = (failure) => failure?.code === 'docReset' || failure?.data?.code === 'docReset' || /restored or changed outside the editor/i.test(String(failure?.message || ''));

export function createDocSync({ api, assetId, ydoc, mode = 'live', getMarkdown, awareness = null, epoch = null, baseEditedAt = '', seeded = false, initialMarkdown = '', delayMs = SAVE_DELAY_MS, retryMs = RETRY_MS, onStatus, onSaved, onBehind, onReset } = {}) {
  let syncedVector = seeded ? null : Y.encodeStateVector(ydoc); // null: the studio has none of it yet
  let dirty = false; let edited = false; let finalSent = false; let timer = null; let retry = null;
  let inflight = null; let again = null; let destroyed = false; let sendAwareness = Boolean(awareness);
  let base = baseEditedAt || ''; let lastMarkdown = String(initialMarkdown || '');
  const status = { state: 'idle', savedAt: '', error: '', conflict: false };
  const set = (next) => { Object.assign(status, next); onStatus?.({ ...status }); };

  function onUpdate(_update, origin) {
    if (destroyed || origin === REMOTE || origin === SEED) return;
    dirty = true; edited = true; finalSent = false;
    if (status.state !== 'saving') set({ state: 'pending', error: status.conflict ? status.error : '' });
    schedule();
  }
  ydoc.on('update', onUpdate);

  function schedule(ms = delayMs) { clearTimeout(timer); timer = setTimeout(() => { timer = null; flush(); }, ms); }

  async function send(final) {
    const markdown = typeof getMarkdown === 'function' ? getMarkdown() : '';
    // The studio never saves an empty report (it would answer markdownSaved: false forever, and this would keep catching
    // up and sending again): say so once and wait for the next keystroke.
    if (!markdown.trim()) throw Object.assign(new Error('Write the report before saving, or restore the original.'), { retry: false });
    if (mode === 'live') {
      const vector = Y.encodeStateVector(ydoc);
      const update = syncedVector ? Y.encodeStateAsUpdate(ydoc, syncedVector) : Y.encodeStateAsUpdate(ydoc);
      const payload = { assetId, update: toBase64(update), markdown, clientId: String(ydoc.clientID), stateVector: toBase64(vector), ...(epoch !== null && epoch !== undefined ? { epoch } : {}), ...(final ? { final: true } : {}) };
      let result;
      try {
        result = await api.pushReportDocUpdate(sendAwareness && awareness ? { ...payload, awareness: toBase64(encodeAwarenessUpdate(awareness, [ydoc.clientID])) } : payload);
      } catch (failure) {
        if (!(sendAwareness && awareness && isRefusedField(failure))) throw failure;
        sendAwareness = false; // this studio doesn't relay carets: keep saving without them
        result = await api.pushReportDocUpdate(payload);
      }
      syncedVector = vector;
      if (result?.markdownSaved === false) return { markdown, result, behind: true };
      lastMarkdown = markdown;
      return { markdown, result, savedAt: result?.savedAt || new Date().toISOString() };
    }
    // Typing that ends where it started saves nothing.
    if (markdown === lastMarkdown) return { markdown, result: null, savedAt: status.savedAt || new Date().toISOString(), unchanged: true };
    const result = await api.editStudioAsset({ assetId, markdown, baseEditedAt: base });
    if (result === null) throw new Error('Your edits couldn’t be saved. Your text is still here.');
    base = result?.asset?.edited?.at || base; lastMarkdown = markdown;
    return { markdown, result, savedAt: result?.asset?.edited?.at || new Date().toISOString() };
  }

  function flush({ final = false } = {}) {
    clearTimeout(timer); timer = null; clearTimeout(retry); retry = null;
    if (destroyed) return Promise.resolve({ ...status });
    if (inflight) { again = { final: Boolean(again?.final || final) }; return inflight; }
    const needsFinal = final && mode === 'live' && edited && !finalSent;
    if (!dirty && !needsFinal) return Promise.resolve(status);
    if (status.conflict) return Promise.resolve(status); // someone else saved first: never overwrite, the text stays
    dirty = false;
    set({ state: 'saving' });
    inflight = send(final).then((saved) => {
      if (saved.behind) {
        // This browser hasn't seen someone's change yet: catch up, then send the Markdown again.
        dirty = true; onBehind?.();
        if (!destroyed) schedule(delayMs);
        return status;
      }
      if (final) finalSent = true;
      if (!dirty) set({ state: 'saved', savedAt: saved.savedAt, error: '', conflict: false });
      onSaved?.(saved);
      return status;
    }, (failure) => {
      if (mode === 'live' && isReset(failure)) { dirty = false; destroyed = true; clearTimeout(timer); clearTimeout(retry); ydoc.off('update', onUpdate); onReset?.(failure); return status; }
      dirty = true;
      const conflict = isConflict(failure);
      set({ state: 'error', conflict, error: failure?.message || 'Your edits couldn’t be saved. Your text is still here.' });
      if (!conflict && failure?.retry !== false && !destroyed && !final) { clearTimeout(retry); retry = setTimeout(() => { retry = null; flush(); }, retryMs); }
      return status;
    }).finally(() => {
      inflight = null;
      if (again && !destroyed) { const next = again; again = null; flush(next); }
    });
    return inflight;
  }

  // A caret move on its own (the web, live mode): only when no change is waiting to carry it.
  let caretTimer = null; let caretAt = 0;
  function sendCaret() {
    if (destroyed || mode !== 'live' || !awareness || !sendAwareness || dirty || inflight) return;
    clearTimeout(caretTimer);
    const wait = Math.max(0, 800 - (Date.now() - caretAt));
    caretTimer = setTimeout(() => {
      if (destroyed || dirty || inflight || !sendAwareness) return;
      caretAt = Date.now();
      Promise.resolve().then(() => api.pushReportDocUpdate({ assetId, clientId: String(ydoc.clientID), ...(epoch !== null && epoch !== undefined ? { epoch } : {}), awareness: toBase64(encodeAwarenessUpdate(awareness, [ydoc.clientID])) }))
        .catch((failure) => { if (isRefusedField(failure)) sendAwareness = false; else if (isReset(failure) && !destroyed) { destroyed = true; ydoc.off('update', onUpdate); onReset?.(failure); } });
    }, wait);
  }

  return {
    flush,
    sendCaret,
    get status() { return { ...status }; },
    get dirty() { return dirty || Boolean(inflight); },
    get edited() { return edited; },
    // Saves what is left, as the final save of this visit, then stops.
    async close() {
      if (destroyed) return { ...status };
      try { await flush({ final: true }); if (inflight) await inflight; } finally {
        destroyed = true; clearTimeout(timer); clearTimeout(retry); clearTimeout(caretTimer); ydoc.off('update', onUpdate);
      }
      return { ...status };
    },
    destroy() { destroyed = true; clearTimeout(timer); clearTimeout(retry); clearTimeout(caretTimer); ydoc.off('update', onUpdate); },
  };
}
