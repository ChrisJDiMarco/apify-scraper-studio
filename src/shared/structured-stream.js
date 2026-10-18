'use strict';
// Streams one text field out of a structured answer while the model is still writing it. The runners receive the
// answer as raw JSON text in pieces (an SSE delta, a CLI partial message); createFieldStream('answer').push(piece)
// returns only the newly decoded characters of the top-level "answer" string, so Ask AI can show it as it arrives.
// Pure and Electron-free; nothing here is trusted: the finished answer is still parsed and checked by its caller.
//
//   const stream = createFieldStream('answer');
//   stream.push('{"answer":"Hel');   // → 'Hel'
//   stream.push('lo\\nwor');          // → 'lo\nwor'
//   stream.push('ld","cards":[]}');   // → 'ld'
//   stream.text();                   // → 'Hello\nworld'
//
// Leading text before the first "{" (a code fence from a schema-in-prompt answer) is skipped. Only the top-level
// field is read; the same name nested deeper is ignored. Escapes split across pieces (é, a surrogate pair) are
// held until they are complete.

const ESCAPES = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };

function createFieldStream(field = 'answer') {
  if (typeof field !== 'string' || !field) throw new Error('Name the field to stream.');
  let state = 'start'; // start → object → key → colon → value → (target | skip) → object … → done
  let key = ''; let keyEscape = null;
  let skip = null; // { depth, inString, escape, scalar }
  let escape = null; // '' after a backslash, 'uXXXX' while reading a unicode escape
  let pendingHigh = ''; // a high surrogate waiting for its pair
  let found = false; let text = '';

  function unicode(hex) {
    const code = parseInt(hex, 16);
    if (Number.isNaN(code)) return '';
    if (code >= 0xd800 && code <= 0xdbff) { pendingHigh = String.fromCharCode(code); return ''; }
    if (code >= 0xdc00 && code <= 0xdfff && pendingHigh) { const pair = pendingHigh + String.fromCharCode(code); pendingHigh = ''; return pair; }
    const lone = pendingHigh; pendingHigh = '';
    return lone + String.fromCharCode(code);
  }

  function push(chunk) {
    if (chunk == null || state === 'done') return '';
    const input = String(chunk); let out = '';
    for (let index = 0; index < input.length; index++) {
      const char = input[index];
      switch (state) {
        case 'start':
          if (char === '{') state = 'object';
          break;
        case 'object':
          if (char === '"') { state = 'key'; key = ''; keyEscape = null; }
          else if (char === '}') state = 'done';
          break;
        case 'key':
          if (keyEscape !== null) {
            if (keyEscape === '' && char !== 'u') { key += ESCAPES[char] ?? char; keyEscape = null; }
            else { keyEscape += char; if (keyEscape.length === 5) { key += String.fromCharCode(parseInt(keyEscape.slice(1), 16) || 0); keyEscape = null; } }
          } else if (char === '\\') keyEscape = '';
          else if (char === '"') state = 'colon';
          else key += char;
          break;
        case 'colon':
          if (char === ':') state = 'value';
          break;
        case 'value':
          if (/\s/.test(char)) break;
          if (key === field && !found && char === '"') { state = 'target'; found = true; escape = null; break; }
          // Any other value (or a non-string answer) is skipped, with nesting and strings tracked.
          skip = { depth: char === '{' || char === '[' ? 1 : 0, inString: char === '"', escape: false, scalar: char !== '{' && char !== '[' && char !== '"' };
          state = 'skip';
          if (skip.scalar && (char === ',' || char === '}')) { state = char === '}' ? 'done' : 'object'; skip = null; }
          break;
        case 'skip': {
          if (skip.inString) {
            if (skip.escape) skip.escape = false;
            else if (char === '\\') skip.escape = true;
            else if (char === '"') { skip.inString = false; if (!skip.depth) { state = 'object'; skip = null; } }
            break;
          }
          if (skip.scalar) {
            if (char === ',') { state = 'object'; skip = null; } else if (char === '}') { state = 'done'; skip = null; }
            break;
          }
          if (char === '"') skip.inString = true;
          else if (char === '{' || char === '[') skip.depth++;
          else if (char === '}' || char === ']') { skip.depth--; if (!skip.depth) { state = 'object'; skip = null; } }
          break;
        }
        case 'target':
          if (escape !== null) {
            if (escape === '' && char !== 'u') {
              const lone = pendingHigh; pendingHigh = '';
              out += lone + (ESCAPES[char] ?? char); escape = null;
            } else {
              escape += char;
              if (escape.length === 5) { out += unicode(escape.slice(1)); escape = null; }
            }
          } else if (char === '\\') escape = '';
          else if (char === '"') { if (pendingHigh) { out += pendingHigh; pendingHigh = ''; } state = 'object'; }
          else { if (pendingHigh) { out += pendingHigh; pendingHigh = ''; } out += char; }
          break;
        default:
          break;
      }
    }
    text += out;
    return out;
  }

  return {
    push,
    text: () => text,
    // True once the field's closing quote has been read (or the object ended).
    get complete() { return found ? state !== 'target' : state === 'done'; },
    get found() { return found; },
  };
}

// Streams a structured answer's field to onStream as { type: 'text', delta } events. The returned function takes raw
// JSON pieces; flush(output) sends the whole field once when nothing streamed (routes that only answer at the end).
function fieldStreamer(onStream, field = 'answer') {
  if (typeof onStream !== 'function') return null;
  const stream = createFieldStream(field); let sent = false;
  const emit = (delta) => { if (!delta) return; sent = true; try { onStream({ type: 'text', delta }); } catch (_) { /* a display courtesy never stops the call */ } };
  return {
    push: (chunk) => emit(stream.push(chunk)),
    status: (text) => { try { onStream({ type: 'status', text: String(text || '') }); } catch (_) { /* courtesy */ } },
    flush(output) {
      if (sent) return;
      const value = output && typeof output === 'object' ? output[field] : null;
      if (typeof value === 'string' && value) { emit(value); return; }
      // Nothing to show; the route still calls onStream once, as the contract promises.
      sent = true; try { onStream({ type: 'text', delta: '' }); } catch (_) { /* courtesy */ }
    },
    get streamed() { return sent; },
    text: () => stream.text(),
  };
}

// One string field read from a finished reply that isn't valid JSON (Ask AI keeps its answer when the rest of the reply
// can't be read). The first `"field": "` is the field (the answer is the schema's first property, and no nested object
// uses the name). Escapes decode as above and a raw line break stays one. A quote ends the string only when what follows
// it continues the object (`, "key":`, `}` or the end of the text); any other quote is one the model forgot to escape and
// is kept, so `Press "Run" to start` isn't cut short. `keys` (optional) are the schema's own property names: then only
// `, "<one of them>":` continues the object (so `Pick "Lite", "Standard": both` stays whole), and a `}` ends the string
// only when no later quote could (an inline {"url": "…"} example is followed by the rest of the answer and its real end).
// null when the field isn't there or never ends.
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function readStringField(text, field = 'answer', { keys } = {}) {
  const source = String(text ?? ''); const name = JSON.stringify(String(field));
  const key = new RegExp(`${escapeRegExp(name)}\\s*:\\s*"`).exec(source);
  if (!key) return null;
  const names = Array.isArray(keys) ? keys.filter((entry) => typeof entry === 'string' && entry && entry !== field) : [];
  const next = names.length ? `"(?:${names.map(escapeRegExp).join('|')})"` : '"[^"\\\\\\n]{1,80}"';
  const keyEnd = new RegExp(`\\s*,\\s*${next}\\s*:`, 'y');
  const braceEnd = /\s*(?:,?\s*\}|$)/y;
  const laterEnd = names.length ? new RegExp(`"\\s*(?:,\\s*${next}\\s*:|,?\\s*\\})`, 'g') : null;
  let out = '';
  for (let at = key.index + key[0].length; at < source.length; at++) {
    const char = source[at];
    if (char === '\\') {
      const following = source[at + 1];
      if (following === 'u' && /^[0-9a-fA-F]{4}$/.test(source.slice(at + 2, at + 6))) { out += String.fromCharCode(parseInt(source.slice(at + 2, at + 6), 16)); at += 5; continue; }
      if (following === undefined) return null;
      out += ESCAPES[following] ?? following; at++; continue;
    }
    if (char === '"') {
      keyEnd.lastIndex = at + 1;
      if (keyEnd.test(source)) return out;
      braceEnd.lastIndex = at + 1;
      if (braceEnd.test(source)) {
        if (!laterEnd) return out;
        laterEnd.lastIndex = at + 1;
        if (!laterEnd.test(source)) return out;
      }
    }
    out += char;
  }
  return null;
}

module.exports = { createFieldStream, fieldStreamer, readStringField };
