import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

// Ask AI's streamed answers in the window. The main process sends each answer's progress as events (src/main/
// ask-progress.js: { type:'progress', requestId, seq, progress } and { type:'delta', requestId, seq, at, text }) through
// api.onAskStream (IPC on the Mac, the person's live-update stream on the web). This file folds them into one progress
// object per request, reads a request back (api.readAskProgress) whenever events may have been missed, and gives React
// hooks that re-render only the message that is streaming.

export const FINAL_STATUSES = Object.freeze(['done', 'stopped', 'failed']);
export const isFinal = (status) => FINAL_STATUSES.includes(status);
const list = (value) => (Array.isArray(value) ? value : []);

export function emptyProgress(requestId = '', meta = {}) {
  return { requestId, conversationId: meta.conversationId || '', question: meta.question || '', mode: meta.mode || '', status: 'sending', steps: [], text: '', title: '', seq: 0, startedAt: meta.startedAt || '', final: null, error: null, gap: false };
}

// One event folded into a request's progress (pure). Events at or below the seq already seen are ignored. A delta adds
// text at its offset (`at`); a progress event replaces the status, steps and title, and a shorter textLength withdraws
// text. Anything that shows events were missed (a seq jump, text beyond what arrived) sets `gap`, so the store reads
// the request back.
export function reduceAskProgress(current, event) {
  if (!event || typeof event !== 'object') return current;
  const base = current || emptyProgress(event.requestId || '');
  if (event.type === 'snapshot') return fromSnapshot(event.snapshot, base);
  const seq = Number(event.seq) || 0;
  if (!seq || seq <= base.seq) return base;
  const missed = seq > base.seq + 1;
  const conversationId = typeof event.conversationId === 'string' && event.conversationId ? event.conversationId : base.conversationId;
  if (event.type === 'delta') {
    const at = Number(event.at) || 0; const piece = typeof event.text === 'string' ? event.text : '';
    if (at > base.text.length) return { ...base, seq, conversationId, gap: true };
    return { ...base, seq, conversationId, text: base.text.slice(0, at) + piece, status: isFinal(base.status) ? base.status : 'writing', gap: base.gap || missed };
  }
  if (event.type === 'progress') {
    const next = event.progress && typeof event.progress === 'object' ? event.progress : {};
    const textLength = Number.isFinite(next.textLength) ? next.textLength : base.text.length;
    return {
      ...base, seq, conversationId,
      status: typeof next.status === 'string' && next.status ? next.status : base.status,
      steps: Array.isArray(next.steps) ? next.steps : base.steps,
      title: typeof next.title === 'string' ? next.title : base.title,
      question: next.question || base.question, startedAt: next.startedAt || base.startedAt, mode: next.mode ?? base.mode,
      final: next.final ?? base.final, error: next.error ?? base.error,
      text: textLength < base.text.length ? base.text.slice(0, textLength) : base.text,
      gap: base.gap || missed || textLength > base.text.length,
    };
  }
  return base;
}
// A snapshot read back from readAskProgress, as progress (it carries the whole text so far).
export function fromSnapshot(snapshot, current = null) {
  if (!snapshot || typeof snapshot !== 'object') return current;
  const base = current || emptyProgress(snapshot.requestId || '');
  return {
    ...base, requestId: snapshot.requestId || base.requestId, conversationId: snapshot.conversationId || base.conversationId, question: snapshot.question || base.question, mode: snapshot.mode ?? base.mode,
    status: snapshot.status || base.status, steps: list(snapshot.steps), text: typeof snapshot.text === 'string' ? snapshot.text : base.text, title: snapshot.title || '',
    seq: Number(snapshot.seq) || base.seq, startedAt: snapshot.startedAt || base.startedAt, final: snapshot.final || null, error: snapshot.error || null, gap: false,
  };
}

// The window's store of streamed answers. track(requestId, meta) starts following a question this window asked;
// events for requests it doesn't track are kept too, so a second tab of the same person can mirror an answer.
// onAny(listener) hears every event ((event, progress); a follow-up message arrives as { type:'followup' } with no
// progress). A request still running that hears nothing for `pollMs` is read back, which covers a dropped stream.
export function createAskStreamStore(api, { pollMs = 4000, now = () => Date.now(), maxEntries = 40 } = {}) {
  const entries = new Map(); const anyListeners = new Set();
  let disposed = false; let timer = null;
  const read = typeof api?.readAskProgress === 'function' ? (payload) => api.readAskProgress(payload) : null;
  const safe = (fn, ...args) => { try { fn(...args); } catch { /* a listener's failure never stops the stream */ } };
  function ensure(requestId) {
    let entry = entries.get(requestId);
    if (!entry) { entry = { progress: emptyProgress(requestId), listeners: new Set(), tracked: false, heardAt: now(), fetching: false }; entries.set(requestId, entry); }
    return entry;
  }
  function publish(entry, next, event) {
    entry.heardAt = now();
    if (next === entry.progress) return;
    entry.progress = next;
    for (const fn of [...entry.listeners]) safe(fn);
    for (const fn of [...anyListeners]) safe(fn, event, next);
  }
  function prune() {
    if (entries.size <= maxEntries) return;
    for (const [id, entry] of entries) { if (entries.size <= maxEntries) break; if (!entry.listeners.size && isFinal(entry.progress.status)) entries.delete(id); }
  }
  function fetchSnapshot(requestId) {
    const entry = entries.get(requestId);
    if (!entry || entry.fetching || !read || disposed) return;
    entry.fetching = true;
    Promise.resolve().then(() => read({ requestId })).then((result) => { if (result?.progress) adopt(result.progress); }).catch(() => {}).finally(() => { entry.fetching = false; entry.heardAt = now(); });
  }
  // A snapshot replaces local progress when it is as new or newer, or when local progress knows it missed something.
  function adopt(snapshot) {
    if (!snapshot?.requestId || disposed) return;
    const entry = ensure(snapshot.requestId);
    if ((Number(snapshot.seq) || 0) < entry.progress.seq && !entry.progress.gap) return;
    publish(entry, fromSnapshot(snapshot, entry.progress), { type: 'snapshot', requestId: snapshot.requestId });
  }
  function receive(event) {
    if (disposed || !event || typeof event !== 'object') return;
    if (event.type === 'resync') { resync(); return; }
    if (event.type === 'followup') { for (const fn of [...anyListeners]) safe(fn, event, null); return; }
    const requestId = typeof event.requestId === 'string' ? event.requestId : '';
    if (!requestId) return;
    const entry = ensure(requestId); const next = reduceAskProgress(entry.progress, event);
    publish(entry, next, event);
    if (next.gap) fetchSnapshot(requestId);
    prune();
  }
  function resync() { for (const [id, entry] of entries) if (!isFinal(entry.progress.status)) fetchSnapshot(id); }
  function poll() {
    let live = false;
    for (const [id, entry] of entries) {
      if (!entry.tracked || isFinal(entry.progress.status)) continue;
      live = true;
      if (now() - entry.heardAt >= pollMs) fetchSnapshot(id);
    }
    if (!live) { clearInterval(timer); timer = null; }
  }
  const off = typeof api?.onAskStream === 'function' ? api.onAskStream(receive) : null;
  return {
    live: typeof api?.onAskStream === 'function',
    track(requestId, meta = {}) {
      const entry = ensure(requestId); entry.tracked = true; entry.heardAt = now();
      // A question asked again under the same id (after an error) starts over: the server's events count from 1 again.
      if (isFinal(entry.progress.status)) publish(entry, emptyProgress(requestId, meta), { type: 'track', requestId });
      else if (entry.progress.status === 'sending' && !entry.progress.seq) entry.progress = { ...entry.progress, ...emptyProgress(requestId, meta) };
      if (!timer && read && pollMs > 0) timer = setInterval(poll, Math.max(250, Math.round(pollMs / 2)));
      return entry.progress;
    },
    // The question's answer arrived by its own call: the progress is final even if no event said so.
    settle(requestId, status = 'done', final = null) {
      const entry = entries.get(requestId); if (!entry || isFinal(entry.progress.status)) return;
      publish(entry, { ...entry.progress, status, final: final || entry.progress.final }, { type: 'settle', requestId });
    },
    get: (requestId) => entries.get(requestId)?.progress || null,
    subscribe(requestId, listener) { const entry = ensure(requestId); entry.listeners.add(listener); return () => entry.listeners.delete(listener); },
    onAny(listener) { anyListeners.add(listener); return () => anyListeners.delete(listener); },
    adopt, resync, receive,
    forget(requestId) { const entry = entries.get(requestId); if (entry && !entry.listeners.size) entries.delete(requestId); },
    dispose() { disposed = true; clearInterval(timer); timer = null; try { off?.(); } catch { /* already gone */ } anyListeners.clear(); entries.clear(); },
  };
}

// The progress of one request, re-rendering only the component that reads it.
export function useAskProgress(store, requestId) {
  const subscribe = useCallback((listener) => (store && requestId ? store.subscribe(requestId, listener) : () => {}), [store, requestId]);
  const get = useCallback(() => (store && requestId ? store.get(requestId) : null), [store, requestId]);
  return useSyncExternalStore(subscribe, get, get);
}

export function usePrefersReducedMotion() {
  const query = '(prefers-reduced-motion: reduce)';
  const [reduced, setReduced] = useState(() => { try { return Boolean(window.matchMedia?.(query).matches); } catch { return false; } });
  useEffect(() => {
    let media = null; try { media = window.matchMedia?.(query) || null; } catch { media = null; }
    if (!media) return undefined;
    const update = () => setReduced(Boolean(media.matches)); update();
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);
  return reduced;
}

// How much of `target` to show this frame, so text arrives smoothly rather than in bursts. While `live`, the shown text
// catches up exponentially (about 90 ms behind, at least a character a frame), snapping forward to the next space
// when one is near so words appear whole. Once the text is complete (`live` false: the answer finished, or a route
// that answers all at once), the rest is revealed within 600 ms. Reduced motion, a hidden tab or no animation frames
// show the target at once. When the target stops extending what is shown (text withdrawn), it snaps back to what the
// two still share. → { text, done } (done: everything in target is shown).
const TIME_CONSTANT_MS = 90;
const FINISH_MS = 600;
const WORD_SNAP = 12;
export function useSmoothText(target, { live = true, reduced = false } = {}) {
  const goal = String(target ?? '');
  const [length, setLength] = useState(goal.length);
  const shown = useRef(goal.length); const previous = useRef(goal); const goalRef = useRef(goal);
  const frame = useRef(0); const lastTime = useRef(0); const liveRef = useRef(live); const finish = useRef(null);
  goalRef.current = goal; liveRef.current = live;
  const instant = reduced || typeof requestAnimationFrame !== 'function' || (typeof document !== 'undefined' && document.visibilityState === 'hidden');
  useEffect(() => {
    const before = previous.current.slice(0, shown.current); previous.current = goal;
    let common = 0; const max = Math.min(before.length, goal.length);
    while (common < max && before.charCodeAt(common) === goal.charCodeAt(common)) common++;
    if (instant) { shown.current = goal.length; setLength(goal.length); return; }
    shown.current = common; setLength(common);
    if (!live && finish.current === null) finish.current = Math.max(1, goal.length - common);
    if (live) finish.current = null;
    if (common >= goal.length || frame.current) return;
    const tick = (time) => {
      const text = goalRef.current; const dt = lastTime.current ? Math.min(64, Math.max(1, time - lastTime.current)) : 16; lastTime.current = time;
      const remaining = text.length - shown.current;
      if (remaining <= 0) { frame.current = 0; lastTime.current = 0; return; }
      let next = shown.current;
      if (liveRef.current) next += Math.max(1, Math.ceil(remaining * (1 - Math.exp(-dt / TIME_CONSTANT_MS))));
      else next += Math.max(1, Math.ceil((finish.current || remaining) * dt / FINISH_MS));
      if (next < text.length) { const space = text.slice(next, next + WORD_SNAP).search(/\s/); if (space >= 0) next += space; }
      shown.current = Math.min(text.length, next); setLength(shown.current);
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }, [goal, live, instant]);
  useEffect(() => () => { if (frame.current && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame.current); frame.current = 0; }, []);
  const visible = instant ? goal.length : Math.min(length, goal.length);
  return { text: goal.slice(0, visible), done: visible >= goal.length };
}
