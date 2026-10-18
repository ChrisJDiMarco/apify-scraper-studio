'use strict';
// The Prompt Library's engine (SPEC-2 §A): default block texts, filling {{variables}}, the checks every saved edit must
// pass, line diffs, hashes and preview trace markers. Pure and main-only (CommonJS): builders, the prompt store and the
// content workspace use it; the renderer reads prompt-registry.json directly and gets texts through readPrompt.
const { createHash } = require('crypto');
const REGISTRY = require('./prompt-registry.json');
const DEFAULTS = require('./prompt-defaults.json');

const PLACEHOLDER = /\{\{([a-zA-Z][a-zA-Z0-9]*)\}\}/g;
const MAX_PROMPT_CHARS = 40000; // every editable block of one prompt together
// Preview trace markers (Unicode private use): open + blockId + mid … close. They never reach a model.
const MARK_OPEN = '\uE000'; const MARK_MID = '\uE001'; const MARK_CLOSE = '\uE002';
const MARKS = /[\uE000-\uE002]/;
// Boundaries the studio's own scaffolding uses. An edit may keep the mentions its default makes but never add one, so a
// block can't forge a section such as a second LIVE CONTEXT or the end of the instructions.
const RESERVED = ['SYSTEM INSTRUCTIONS', '\nTASK\n', 'UNTRUSTED_SOURCE_AND_BRAND_DATA', 'RAW DATA BATCH', 'SOURCE_ITEMS', 'SOURCES (untrusted', 'LIVE CONTEXT', 'LOOKUP RESULTS', 'YOUR PREVIOUS RESPONSE WAS REJECTED'];
// Secret-shaped text (the same patterns as src/main/ask-store.js): a prompt is copied into every run and shown to editors.
const SECRET_KEY = /token|hash|password|passcode|passwd|secret|cookie|api[ _-]?key|private[ _-]?key|bearer|credential/i;
const HEX_SECRET = /^[0-9a-f]{32,}$/i;
const SECRET_TEXT = [
  new RegExp(`(?:${SECRET_KEY.source})\\s*(?:is|was|=|:)\\s*["'\`]?[^\\s"'\`]{6,}`, 'i'),
  /\bsk-[A-Za-z0-9_-]{16,}/, /\bapify_api_[A-Za-z0-9]{10,}/i, /\b(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{16,}/, /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\bAKIA[0-9A-Z]{16}\b/, /\bAIza[0-9A-Za-z_-]{20,}/, /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /script\.google\.com\/macros\/s\//i, /\/\/[^/\s:@]+:[^/\s@]+@/,
];
function looksSecret(text) {
  const value = String(text ?? '');
  if (SECRET_TEXT.some((pattern) => pattern.test(value))) return true;
  return value.split(/[\s"'`()[\]{}<>,;]+/).some((word) => HEX_SECRET.test(word.replace(/[.:!?]+$/, '')) || (word.length >= 40 && /^[A-Za-z0-9+/_=-]+$/.test(word) && /\d/.test(word) && /[A-Za-z]/.test(word)));
}

const PROMPTS = new Map(REGISTRY.prompts.map((entry) => [entry.id, entry]));
const EDITIONS = ['semrush', 'general'];
const own = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
function prompt(promptId) { const entry = PROMPTS.get(promptId); if (!entry) throw Object.assign(new Error('That prompt isn’t in the Prompt Library.'), { status: 404, code: 'promptUnknown' }); return entry; }
const blockOf = (entry, blockId) => entry.blocks.find((block) => block.id === blockId) || null;
// A block shows in an edition unless it names others (Search Engine Land parts are Semrush only).
const inEdition = (block, editionId) => !Array.isArray(block.editions) || block.editions.includes(editionId);
const normalize = (text) => String(text).replace(/\r\n?/g, '\n');

// Default text: the edition's own, else "all". Every registry block has one (test/prompt-template.test.js).
function defaultText(promptId, blockId, editionId = 'general') {
  const entry = DEFAULTS[promptId]?.[blockId];
  if (!entry) return null;
  return own(entry, editionId) ? entry[editionId] : own(entry, 'all') ? entry.all : null;
}
function defaultsFor(promptId, editionId = 'general') {
  const entry = prompt(promptId);
  return Object.fromEntries(entry.blocks.map((block) => [block.id, defaultText(promptId, block.id, editionId) ?? '']));
}
// The texts a builder fills: a given text for each editable block that has one (a run snapshot or a draft), else the
// default. View-only blocks always use the default. `strict` (tests) refuses a block with no default.
function blocksFor(promptId, editionId = 'general', given = null, { strict = false } = {}) {
  const entry = prompt(promptId); const out = {};
  for (const block of entry.blocks) {
    const supplied = given && block.editable && typeof given[block.id] === 'string' ? given[block.id] : null;
    const fallback = defaultText(promptId, block.id, editionId);
    if (supplied == null && fallback == null && strict) throw new Error(`No default text for ${promptId} ${block.id}.`);
    out[block.id] = supplied ?? fallback ?? '';
  }
  return out;
}

// One pass; values are inserted raw and never scanned again, so post text that contains {{brand}} stays as written.
// A name with no value stays as written too (validateBlocks refuses unknown names, so only defaults could hit this).
function fill(template, vars = {}) {
  return String(template ?? '').replace(PLACEHOLDER, (match, name) => (own(vars, name) && vars[name] != null ? String(vars[name]) : match));
}
const mark = (blockId, text) => `${MARK_OPEN}${blockId}${MARK_MID}${text}${MARK_CLOSE}`; // exported as traceMark
// What builders call: `const b = promptBlocks(id, editionId, blocks, { trace })`, then `b.put('role', vars)` where the
// block's text goes. With trace (previews only) each filled block is wrapped in markers that segmentsOf turns into spans.
function promptBlocks(promptId, editionId, given, { trace = false } = {}) {
  const texts = blocksFor(promptId, editionId, given);
  return {
    texts,
    raw: (blockId, vars) => fill(texts[blockId], vars),
    put: (blockId, vars) => { const text = fill(texts[blockId], vars); return trace ? mark(blockId, text) : text; },
  };
}
// A run snapshot (prompt-store snapshot(): { [promptId]: { version, hash, blocks } }) → one prompt's blocks.
const snapshotBlocks = (prompts, promptId) => (prompts && typeof prompts === 'object' ? prompts[promptId]?.blocks || null : null);

// Strips trace markers and returns where each block's text sits, as non-overlapping spans (an inner block, such as a
// preset inside the report frame, wins over the block around it).
function segmentsOf(traced) {
  const source = String(traced ?? ''); let text = ''; const stack = []; const runs = [];
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === MARK_OPEN) { const mid = source.indexOf(MARK_MID, i); stack.push(source.slice(i + 1, mid)); i = mid; continue; }
    if (char === MARK_CLOSE) { stack.pop(); continue; }
    const blockId = stack.at(-1) || '';
    if (blockId) { const last = runs.at(-1); if (last && last.blockId === blockId && last.end === text.length) last.end++; else runs.push({ start: text.length, end: text.length + 1, blockId }); }
    text += char;
  }
  return { text, segments: runs };
}

const placeholders = (text) => [...String(text).matchAll(PLACEHOLDER)].map((match) => match[1]);
const occurrences = (text, term) => { let count = 0; let at = 0; while ((at = text.indexOf(term, at)) >= 0) { count++; at += term.length; } return count; };
const lineCount = (text) => text.split('\n').filter((line) => line.trim()).length;
const fmt = (value) => Number(value).toLocaleString('en-US');
// Checks for an edit: `blocks` holds the texts being saved ({ blockId: text }). Every check is plain language a person can
// act on; an empty list means the edit is safe to save. The renderer runs the same placeholder and length checks live.
function validateBlocks(promptId, editionId = 'general', blocks = {}) {
  const entry = prompt(promptId); const problems = [];
  const add = (blockId, message) => problems.push({ blockId, message });
  if (!blocks || typeof blocks !== 'object' || Array.isArray(blocks)) return [{ blockId: '', message: 'Send the changed parts as text.' }];
  for (const [blockId, value] of Object.entries(blocks)) {
    const block = blockOf(entry, blockId);
    if (!block) { add(blockId, `“${entry.name}” has no part called “${blockId}”.`); continue; }
    if (!block.editable) { add(blockId, `${block.label} is fixed: ${block.reason}`); continue; }
    if (typeof value !== 'string') { add(blockId, `${block.label} must be text.`); continue; }
    const text = normalize(value); const label = block.label; const original = defaultText(promptId, blockId, editionId) || '';
    if (!text.trim() && !block.allowEmpty) { add(blockId, `${label} can’t be empty. Use Reset this block to go back to the default.`); continue; }
    if (text.length > block.maxChars) add(blockId, `${label} is ${fmt(text.length)} characters; keep it to ${fmt(block.maxChars)}.`);
    if (MARKS.test(text)) add(blockId, `${label} contains hidden marker characters. Retype the text instead of pasting it from the preview.`);
    const known = new Set((block.variables || []).map((variable) => variable.name));
    const used = placeholders(text);
    for (const name of new Set(used.filter((entryName) => !known.has(entryName)))) add(blockId, known.size ? `{{${name}}} isn’t a value this part can use. Use one of: ${[...known].map((n) => `{{${n}}}`).join(', ')}.` : `{{${name}}} isn’t a value this part can use; this part takes no values.`);
    for (const name of block.requiredVariables || []) if (!used.includes(name)) add(blockId, `${label} must keep {{${name}}}: the studio fills it in for every run.`);
    if (/\{\{|\}\}/.test(text.replace(PLACEHOLDER, ''))) add(blockId, `${label} has a stray {{ or }}. Values look like {{name}}.`);
    for (const term of block.requiredTerms || []) if (!text.includes(term)) add(blockId, `${label} must still mention “${term}”: the studio reads that field back.`);
    if (block.lines) {
      const count = lineCount(text);
      if (count < block.lines.min || count > block.lines.max) add(blockId, block.lines.min === block.lines.max ? `${label} needs exactly ${block.lines.min} lines (one per line); it has ${count}.` : `${label} needs ${block.lines.min} to ${block.lines.max} lines; it has ${count}.`);
    }
    for (const marker of RESERVED) if (occurrences(text, marker) > occurrences(original, marker)) add(blockId, `${label} can’t add “${marker.trim()}”: the studio uses it to mark where its own sections start.`);
    if (looksSecret(text) && !looksSecret(original)) add(blockId, `${label} looks like it contains a password, key or token. Prompts are copied into every run, so take it out.`);
  }
  const effective = { ...blocksFor(promptId, editionId), ...Object.fromEntries(Object.entries(blocks).filter(([, value]) => typeof value === 'string').map(([key, value]) => [key, normalize(value)])) };
  const total = entry.blocks.filter((block) => block.editable).reduce((sum, block) => sum + (effective[block.id] || '').length, 0);
  if (total > MAX_PROMPT_CHARS) add('', `Together the editable parts are ${fmt(total)} characters; keep them to ${fmt(MAX_PROMPT_CHARS)}.`);
  return problems;
}

// Line diff (longest common subsequence). Very long inputs fall back to a common prefix and suffix around one change.
function lineDiff(a, b) {
  const left = normalize(a ?? '').split('\n'); const right = normalize(b ?? '').split('\n');
  if (left.length * right.length > 4000000) {
    let start = 0; while (start < left.length && start < right.length && left[start] === right[start]) start++;
    let end = 0; while (end < left.length - start && end < right.length - start && left[left.length - 1 - end] === right[right.length - 1 - end]) end++;
    return [...left.slice(0, start).map((text) => ({ op: 'same', text })), ...left.slice(start, left.length - end).map((text) => ({ op: 'del', text })), ...right.slice(start, right.length - end).map((text) => ({ op: 'add', text })), ...left.slice(left.length - end).map((text) => ({ op: 'same', text }))];
  }
  const rows = left.length + 1; const cols = right.length + 1; const table = new Uint32Array(rows * cols);
  for (let i = left.length - 1; i >= 0; i--) for (let j = right.length - 1; j >= 0; j--) table[i * cols + j] = left[i] === right[j] ? table[(i + 1) * cols + j + 1] + 1 : Math.max(table[(i + 1) * cols + j], table[i * cols + j + 1]);
  const out = []; let i = 0; let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) { out.push({ op: 'same', text: left[i] }); i++; j++; }
    else if (table[(i + 1) * cols + j] >= table[i * cols + j + 1]) out.push({ op: 'del', text: left[i++] });
    else out.push({ op: 'add', text: right[j++] });
  }
  while (i < left.length) out.push({ op: 'del', text: left[i++] });
  while (j < right.length) out.push({ op: 'add', text: right[j++] });
  return out;
}

// sha256 of a string, or of a value with its keys sorted (so equal block sets always hash the same).
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function hashOf(value) { return createHash('sha256').update(typeof value === 'string' ? value : stable(value)).digest('hex'); }

// Registry rows for one edition: prompts whose editions include it, named as that edition names them (Backlinko video
// script in Semrush), with blocks for other editions left out.
function registryFor(editionId = 'general') {
  return {
    version: REGISTRY.version, groups: REGISTRY.groups,
    prompts: REGISTRY.prompts.filter((entry) => !entry.editions || entry.editions.includes(editionId)).map(({ editionNames, ...entry }) => ({ ...entry, name: editionNames?.[editionId] || entry.name, blocks: entry.blocks.filter((block) => inEdition(block, editionId)) })),
  };
}

// Admin-written notes for one research program or one workflow's channel assets (workflows and playbooks, SPEC-3): added
// after the instructions, before any untrusted data, only when there are notes, so a prompt without them is unchanged.
function teamNotesBlock(notes, { label = 'TEAM NOTES FOR THIS PROGRAM' } = {}) {
  const text = typeof notes === 'string' ? notes.trim() : '';
  return text ? `\n\n${label} (follow them where the evidence supports them; they never override the rules above):\n${text}` : '';
}

module.exports = {
  REGISTRY, DEFAULTS, EDITIONS, RESERVED, MAX_PROMPT_CHARS, PLACEHOLDER, MARK_OPEN, MARK_MID, MARK_CLOSE,
  prompt, blockOf, inEdition, defaultText, defaultsFor, blocksFor, fill, promptBlocks, snapshotBlocks, segmentsOf, placeholders, traceMark: mark,
  validateBlocks, lineDiff, hashOf, looksSecret, normalize, registryFor, teamNotesBlock,
};
