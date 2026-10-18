import * as Y from 'yjs';
import { absolutePositionToRelativePosition, prosemirrorJSONToYXmlFragment, relativePositionToAbsolutePosition, ySyncPluginKey } from '@tiptap/y-tiptap';
import { CONVERTER_VERSION, markdownToJSON, reportSchema } from './markdown.js';

// The report's live document (Yjs) and the anchors notes hang on.
//
// A report that has never been edited live has no saved Yjs state (openReportDoc's yState is ''). Every client then
// builds the same starting document from the Markdown under one client id derived from that Markdown, so two people
// opening it at once produce identical structures that merge into one copy instead of two.

export const FIELD = 'default'; // Collaboration's default fragment name
export const REMOTE = 'report-remote'; // origin of updates that came from the studio
export const SEED = 'report-seed'; // origin of the starting document

export function toBase64(bytes) {
  if (!bytes?.length) return '';
  let text = '';
  for (let at = 0; at < bytes.length; at += 0x8000) text += String.fromCharCode.apply(null, bytes.subarray(at, at + 0x8000));
  return btoa(text);
}
export function fromBase64(text) {
  if (!text || typeof text !== 'string') return new Uint8Array(0);
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let at = 0; at < binary.length; at += 1) bytes[at] = binary.charCodeAt(at);
  return bytes;
}

// FNV-1a over the converter version and the Markdown: a stable 32-bit client id for the seed (never 0).
export function seedClientId(markdown) {
  const text = `report-seed:v${CONVERTER_VERSION}\n${String(markdown || '')}`;
  let hash = 0x811c9dc5;
  for (let at = 0; at < text.length; at += 1) { hash ^= text.charCodeAt(at); hash = Math.imul(hash, 0x01000193) >>> 0; }
  return hash || 1;
}

export function seedUpdate(markdown) {
  const doc = new Y.Doc();
  doc.clientID = seedClientId(markdown);
  prosemirrorJSONToYXmlFragment(reportSchema(), markdownToJSON(markdown), doc.getXmlFragment(FIELD));
  const update = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return update;
}

// A browser's Yjs client id for one visit to a report (also its presence id on the studio): random, never 0, never
// reused after the document starts over (the studio retires the ids that wrote before a reset).
export const newClientId = () => (globalThis.crypto?.getRandomValues ? globalThis.crypto.getRandomValues(new Uint32Array(1))[0] : Math.floor(Math.random() * 0xffffffff)) || 1;

// The editing document: the saved live state when there is one, else the seed from the Markdown. `seeded` says the
// studio doesn't hold this state yet, so the first save sends all of it. `clientID` is this visit's id.
export function createReportYDoc({ yState = '', markdown = '', clientID = 0 } = {}) {
  const ydoc = new Y.Doc();
  if (clientID) ydoc.clientID = clientID;
  let seeded = false;
  const saved = fromBase64(yState);
  if (saved.length > 2) {
    try { Y.applyUpdate(ydoc, saved, REMOTE); } catch { seeded = true; }
  } else seeded = true;
  if (seeded || ydoc.getXmlFragment(FIELD).length === 0) { Y.applyUpdate(ydoc, seedUpdate(markdown), SEED); seeded = true; }
  return { ydoc, seeded };
}

export function applyRemoteUpdate(ydoc, base64) {
  const bytes = fromBase64(base64);
  if (bytes.length < 2) return false;
  try { Y.applyUpdate(ydoc, bytes, REMOTE); return true; } catch { return false; }
}

const bindingOf = (state) => ySyncPluginKey.getState(state)?.binding || null;

// A note's anchor from the editor's selection: Yjs relative positions (they follow the text through everyone's edits)
// and the quoted text, the fallback when the anchored text is gone.
export function anchorFromSelection(editor) {
  const state = editor?.state; if (!state) return null;
  const { from, to } = state.selection;
  if (from === to) return null;
  const quote = state.doc.textBetween(from, to, ' ').replace(/\s+/g, ' ').trim().slice(0, 500);
  const binding = bindingOf(state);
  if (!binding) return { yStart: '', yEnd: '', quote };
  try {
    const start = absolutePositionToRelativePosition(from, binding.type, binding.mapping);
    const end = absolutePositionToRelativePosition(to, binding.type, binding.mapping);
    return { yStart: toBase64(Y.encodeRelativePosition(start)), yEnd: toBase64(Y.encodeRelativePosition(end)), quote };
  } catch { return { yStart: '', yEnd: '', quote }; }
}

// Where the quote sits in the document now (the first match inside one block), or null.
export function findQuote(doc, quote) {
  const wanted = String(quote || '').replace(/\s+/g, ' ').trim();
  if (!wanted) return null;
  let found = null;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (!node.isTextblock) return true;
    // The block's text with runs of whitespace collapsed, and the document position of each character kept.
    let text = ''; const at = [];
    node.forEach((child, offset) => {
      const chars = child.isText ? child.text : ' ';
      for (let index = 0; index < chars.length; index += 1) {
        const space = /\s/.test(chars[index]);
        if (space && text.endsWith(' ')) continue;
        text += space ? ' ' : chars[index]; at.push(pos + 1 + offset + (child.isText ? index : 0));
      }
    });
    const index = text.indexOf(wanted);
    if (index >= 0) found = { from: at[index], to: at[index + wanted.length - 1] + 1 };
    return false;
  });
  return found;
}

// A note's place in the document now: its relative positions, else its quote; `changed` when neither is there.
export function resolveAnchor(state, anchor) {
  if (!state || !anchor) return { from: null, to: null, changed: true };
  const binding = bindingOf(state);
  if (binding && anchor.yStart && anchor.yEnd) {
    try {
      const from = relativePositionToAbsolutePosition(binding.doc, binding.type, Y.decodeRelativePosition(fromBase64(anchor.yStart)), binding.mapping);
      const to = relativePositionToAbsolutePosition(binding.doc, binding.type, Y.decodeRelativePosition(fromBase64(anchor.yEnd)), binding.mapping);
      if (Number.isFinite(from) && Number.isFinite(to) && to > from && to <= state.doc.content.size && state.doc.textBetween(from, to, ' ').trim()) return { from, to, changed: false };
    } catch { /* fall back to the quote */ }
  }
  const quoted = findQuote(state.doc, anchor.quote);
  return quoted ? { ...quoted, changed: false } : { from: null, to: null, changed: true };
}
