'use strict';
// Reads the JSON object out of a model's text reply. An answer in the API's own structured-output format is valid JSON,
// but one written with the schema in the prompt (the Anthropic grammar fallback, OpenRouter's json-mode and prompt modes,
// OpenAI's json_object) is free text that should hold one object, and models slip in ways JSON.parse refuses: a code
// fence, a sentence before or after it, raw line breaks inside a string, a trailing comma.
//
//   parseJsonReply(text)                     JSON.parse, as { value, repaired: 'none' }
//   parseJsonReply(text, { lenient: true })  then, in order:
//     'fence'      the text inside a code fence (not one inside the reply's own object: that is part of a string)
//     'extracted'  a balanced top-level {...} in the text (strings and escapes respected); the longest that parses wins
//     'repaired'   the same objects with raw control characters inside strings escaped, trailing commas dropped, and an
//                  escape JSON doesn't have written out (\' as ', any other with its backslash kept)
//   `accept(value)` (optional; the runners pass schemaAccept(schema)) must also hold for a fence or extracted object,
//   so an object nested inside a broken answer, or a schema echoed before it, is never taken for the answer.
//
// It never invents content: a repair only changes how the same characters are written. Anything else (an unescaped
// quote inside a string, a cut-off object) throws, and so does a reply whose own object never closes: an object in a
// value's place after it (its image or scan) is skipped. Callers still validate every value. Pure and Electron-free.

// A "{" that never closes costs a scan to the end of the reply, so only this many are tried (a long reply full of open
// braces stays cheap). A balanced object costs only its own length, and the next scan starts after it.
const MAX_MISSES = 64;
const CONTROL = { '\n': '\\n', '\r': '\\r', '\t': '\\t', '\b': '\\b', '\f': '\\f' };
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// Code-fenced blocks: the whole reply as one fence first, then each fenced block in it that doesn't open inside one of the
// reply's own objects (`spans`, from objectSpans). The whole fence is checked with plain string tests: a regex whose
// whitespace runs overlap backtracks for minutes on a long run of spaces.
function fencedBlocks(text, spans = []) {
  const blocks = [];
  const trimmed = text.trim(); const lineEnd = trimmed.indexOf('\n');
  if (trimmed.length >= 6 && trimmed.startsWith('```') && trimmed.endsWith('```') && lineEnd > 0 && /^[\w-]*[^\S\n]*$/.test(trimmed.slice(3, lineEnd))) blocks.push(trimmed.slice(lineEnd + 1, -3));
  for (const match of text.matchAll(/```[\w-]*[^\S\n]*\n([\s\S]*?)```/g)) {
    if (spans.some(([start, end]) => match.index > start && match.index < end)) continue;
    if (!blocks.includes(match[1])) blocks.push(match[1]);
  }
  return blocks;
}

// Where the object or array opening at `start` closes, or -1 when it never does (or the wrong bracket closes it).
function closingOf(text, start) {
  const open = []; let inString = false; let escaped = false;
  for (let at = start; at < text.length; at++) {
    const char = text[at];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') open.push('}');
    else if (char === '[') open.push(']');
    else if (char === '}' || char === ']') {
      if (open.pop() !== char) return -1;
      if (!open.length) return at;
    }
  }
  return -1;
}

// Whether a value starts at `start`: right after `"key":`, `[` or `,`.
function valuePosition(text, start) {
  let at = start - 1; while (at >= 0 && /\s/.test(text[at])) at--;
  if (text[at] === '[' || text[at] === ',') return true;
  if (text[at] !== ':') return false;
  at--; while (at >= 0 && /\s/.test(text[at])) at--;
  return text[at] === '"';
}

// Balanced top-level {...} spans ([start, end]), in order. A "{" that never closes (prose, a cut-off object) is skipped
// and the scan goes on from the next character; once one has, a "{" in a value's place is inside it (the reply's own
// image or scan object when an unescaped quote or a cut-off broke the reply) and is skipped too.
function objectSpans(text) {
  const found = []; let from = 0; let misses = 0;
  while (from < text.length && misses < MAX_MISSES) {
    const start = text.indexOf('{', from);
    if (start < 0) break;
    if (misses && valuePosition(text, start)) { from = start + 1; continue; }
    const end = closingOf(text, start);
    if (end < 0) { misses++; from = start + 1; continue; }
    found.push([start, end]);
    from = end + 1;
  }
  return found;
}
const objectCandidates = (text) => objectSpans(text).map(([start, end]) => text.slice(start, end + 1));

// Raw control characters inside strings become their escapes (a line break stays a line break), and a comma right
// before } or ] is dropped. A backslash JSON can't read as an escape is written out: \' is the apostrophe it was meant as,
// and any other (\d, C:\users, one before a raw line break) stays a backslash. Nothing else changes.
const ESCAPABLE = new Set(['"', '\\', '/', 'b', 'f', 'n', 'r', 't']);
function repairJson(text) {
  const source = String(text ?? ''); let out = ''; let inString = false;
  for (let at = 0; at < source.length; at++) {
    const char = source[at]; const code = char.charCodeAt(0);
    if (inString) {
      if (char === '\\') {
        const next = source[at + 1];
        if (next === undefined) { out += char; continue; }
        if (ESCAPABLE.has(next) || (next === 'u' && /^[0-9a-fA-F]{4}$/.test(source.slice(at + 2, at + 6)))) { out += char + next; at++; continue; }
        if (next === "'") { out += next; at++; continue; }
        out += '\\\\'; continue;
      }
      if (char === '"') inString = false;
      else if (code < 0x20) { out += CONTROL[char] || `\\u${code.toString(16).padStart(4, '0')}`; continue; }
      out += char; continue;
    }
    if (char === '"') inString = true;
    else if (char === ',') {
      let next = at + 1; while (next < source.length && /\s/.test(source[next])) next++;
      if (source[next] === '}' || source[next] === ']') continue;
    }
    out += char;
  }
  return out;
}

const tryParse = (text) => { try { return { ok: true, value: JSON.parse(text) }; } catch (_) { return { ok: false }; } };

function parseJsonReply(text, { lenient = false, accept = () => true } = {}) {
  if (typeof text !== 'string') throw new Error('The reply is not text.');
  const direct = tryParse(text);
  if (direct.ok) return { value: direct.value, repaired: 'none' };
  if (!lenient) throw new Error('The reply is not valid JSON.');
  const fits = (value) => isObject(value) && Boolean(accept(value));
  const spans = objectSpans(text);
  for (const block of fencedBlocks(text, spans)) {
    const fenced = tryParse(block.trim());
    if (fenced.ok && fits(fenced.value)) return { value: fenced.value, repaired: 'fence' };
  }
  // Every balanced object that parses as written or once repaired; the longest is the answer (ties go to the first).
  let best = null;
  for (const [start, end] of spans) {
    const length = end + 1 - start;
    if (best && length <= best.length) continue;
    const candidate = text.slice(start, end + 1);
    const plain = tryParse(candidate);
    if (plain.ok && fits(plain.value)) { best = { value: plain.value, repaired: 'extracted', length }; continue; }
    const fixed = tryParse(repairJson(candidate));
    if (fixed.ok && fits(fixed.value)) best = { value: fixed.value, repaired: 'repaired', length };
  }
  if (best) return { value: best.value, repaired: best.repaired };
  throw new Error('No JSON object in the reply.');
}

// parseJsonReply's `accept` for a schema: the answer holds at least half of the schema's required top-level keys (so a
// model that leaves out a few still counts), which an object nested inside it, a stub cut short by a quoted brace, or a
// schema echoed before it doesn't. Any object passes when the schema names no required keys.
function schemaAccept(schema) {
  const required = Array.isArray(schema?.required) ? schema.required.filter((key) => typeof key === 'string') : [];
  if (!required.length) return () => true;
  const needed = Math.ceil(required.length / 2);
  return (value) => required.filter((key) => Object.prototype.hasOwnProperty.call(value, key)).length >= needed;
}

// The value of the first `"field":` holding an object or array, from a reply that isn't valid JSON as a whole (Ask AI
// keeps an answer's followUps this way). Parsed as written, else repaired; undefined when it isn't there or won't parse.
function readJsonField(text, field) {
  const source = String(text ?? ''); const name = JSON.stringify(String(field ?? ''));
  for (let from = source.indexOf(name); from >= 0; from = source.indexOf(name, from + 1)) {
    const value = /^\s*:\s*([[{])/.exec(source.slice(from + name.length, from + name.length + 200));
    if (!value) continue;
    const start = from + name.length + value[0].length - 1; const end = closingOf(source, start);
    if (end < 0) return undefined;
    const span = source.slice(start, end + 1);
    const plain = tryParse(span); if (plain.ok) return plain.value;
    const fixed = tryParse(repairJson(span)); return fixed.ok ? fixed.value : undefined;
  }
  return undefined;
}

// At most maxBytes of UTF-8, never splitting a character. Diagnostics and error fields keep a reply this size.
function clipText(text, maxBytes) {
  const value = String(text ?? '');
  if (value.length * 3 <= maxBytes || Buffer.byteLength(value, 'utf8') <= maxBytes) return value;
  return Buffer.from(value, 'utf8').subarray(0, Math.max(0, maxBytes)).toString('utf8').replace(/\uFFFD+$/, '');
}

module.exports = { parseJsonReply, schemaAccept, repairJson, objectCandidates, readJsonField, clipText };
