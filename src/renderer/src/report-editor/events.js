// Live events for the report editor, on the per-person push the studio already uses for Ask AI's streamed answers
// (index.js pushPersonEvent beside pushAskEvent: IPC on the Mac, the person's own event stream on the web):
//   { type: 'doc-update', assetId, update, from: { id, name, color }, awareness? }
//   { type: 'doc-presence', assetId, editors: [{ id, name, color }], cursors?, awareness? }
//   { type: 'note-changed', assetId, noteId }
// The bridge is api.onPersonEvent (preload and web-api), or api.onAskStream on a host that only has the Ask AI bridge.
// { type: 'resync' } (the web's stream came back after a gap) makes an open report read its state again.
export const DOC_EVENTS = new Set(['doc-update', 'doc-presence', 'note-changed', 'resync']);

export function subscribePersonEvents(api, listener) {
  if (!api || typeof listener !== 'function') return () => {};
  const bridges = [typeof api.onPersonEvent === 'function' ? api.onPersonEvent : api.onAskStream].filter((fn) => typeof fn === 'function');
  const offs = bridges.map((bridge) => {
    try { return bridge.call(api, (event) => { if (event && typeof event === 'object' && DOC_EVENTS.has(event.type)) listener(event); }); } catch { return null; }
  });
  return () => offs.forEach((off) => { if (typeof off === 'function') off(); });
}

// Opening a report from the Inbox at one note: the router asks first, the report's notes panel takes it when it opens.
const pendingFocus = new Map();
export function requestNoteFocus(assetId, noteId) { if (assetId && noteId) pendingFocus.set(String(assetId), String(noteId)); }
export function takeNoteFocus(assetId) { const id = pendingFocus.get(String(assetId)) || ''; pendingFocus.delete(String(assetId)); return id; }
export function peekNoteFocus(assetId) { return pendingFocus.get(String(assetId)) || ''; }
