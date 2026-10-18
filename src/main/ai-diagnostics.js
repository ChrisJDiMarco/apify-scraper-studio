'use strict';
// A local record of an AI answer the studio couldn't read. When a text runner throws CLAUDE_INVALID_RESULT or
// AI_INVALID_RESULT with the reply's text (error.rawText), text-router.js hands it here and one file is written to
// <data>/content-studio/diagnostics/ai-invalid-<time>.json:
//   { at, taskId, route, model, stopReason, schemaInPrompt, blockTypes, textLength, text }
// `text` is the reply as the runner kept it (its own key already redacted), redacted again for every key shape the studio
// holds (SECRETS) and capped at 100 KB; textLength is the whole reply's length. Never the prompt, a key or who asked. The
// file is owner-only (0600), written atomically (durable-write.js); the newest 10 are kept, and none older than 30 days
// (checked on each write and by prune() at start). A failure here is logged and swallowed: a diagnostic never changes what
// the person sees. RUNBOOK.md's incident checklist points here; SECURITY.md lists it under retention.
// CommonJS, Electron-free: the Mac app, the Windows app and the browser studio's server all load it.
const fs = require('fs');
const path = require('path');
const { writeFileDurable } = require('../shared/durable-write');
const { clipText } = require('../shared/json-reply');

const PREFIX = 'ai-invalid-';
const KEEP = 10;
const MAX_TEXT_BYTES = 100 * 1024;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
// Every key shape the studio holds, each as a whole word (so ask-ai or task-list stay as they are): the AI and Apify keys,
// Bearer tokens, Slack, GitHub, AWS, Google (API keys, access and refresh tokens, client secrets, the Sheets webhook URL, a
// service account's private key), Monday's token (a JWT), FAL keys (uuid:hex), credentials in a URL and long hex secrets.
const SECRETS = new RegExp([
  String.raw`Bearer\s+[\w.:/+=-]{8,}`,
  String.raw`\b(?:sk-|apify_api_|xox[abprs]-|gh[pousr]_|github_pat_|GOCSPX-)[\w.:-]{8,}`,
  String.raw`\bAKIA[0-9A-Z]{16}\b`,
  String.raw`\bAIza[\w-]{20,}`,
  String.raw`\bya29\.[\w.-]+`,
  String.raw`\b1\/\/0[\w-]{20,}`,
  String.raw`\beyJ[\w-]{8,}\.[\w-]{8,}(?:\.[\w-]*)?`,
  String.raw`\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}:[0-9a-fA-F]{16,}\b`,
  String.raw`script\.google\.com\/macros\/s\/[\w-]+`,
  String.raw`-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)`,
  String.raw`(?<=\/\/)[^/\s:@"]+:[^/\s@"]+(?=@)`,
  String.raw`\b[0-9a-fA-F]{32,}\b`,
].join('|'), 'g');
const redact = (text) => String(text ?? '').replace(SECRETS, '[redacted]');
const short = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');
// ISO time with the characters Windows refuses in a file name swapped out; names sort in time order.
const stamp = (iso) => iso.replace(/[:.]/g, '-');
// The time in a file's name (ai-invalid-2026-10-18T09-30-01-234Z.json, or …Z-2.json), or NaN.
function nameTime(name) {
  const match = /^ai-invalid-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/.exec(name);
  return match ? Date.parse(`${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z`) : NaN;
}

function createAiDiagnostics({ dir, fsImpl = fs, now = () => new Date(), log = (line) => console.warn(line), keep = KEEP } = {}) {
  const folderOf = () => (typeof dir === 'function' ? dir() : dir);

  // Newest `keep` files stay, and none older than 30 days; nothing else in the folder is touched.
  function prune(folder, nowMs) {
    // Sorted without the extension, so "<time>-2" (a second file in the same millisecond) comes after "<time>".
    const files = fsImpl.readdirSync(folder).filter((name) => name.startsWith(PREFIX) && name.endsWith('.json')).map((name) => name.slice(0, -5)).sort().map((name) => `${name}.json`);
    const expired = files.filter((name) => nameTime(name) < nowMs - MAX_AGE_MS);
    const current = files.filter((name) => !expired.includes(name));
    for (const name of [...expired, ...current.slice(0, Math.max(0, current.length - keep))]) { try { fsImpl.unlinkSync(path.join(folder, name)); } catch (_) { /* gone already */ } }
  }

  // { taskId, route, model, error } → the file written, or null.
  function record({ taskId = null, route = '', model = '', error } = {}) {
    try {
      if (!error || typeof error.rawText !== 'string') return null;
      const folder = folderOf(); if (!folder) return null;
      const at = now().toISOString();
      const entry = {
        at, taskId: typeof taskId === 'string' && taskId ? short(taskId, 80) : null, route: short(route, 40), model: short(model, 160),
        stopReason: short(error.stopReason, 60), schemaInPrompt: error.schemaInPrompt === true,
        blockTypes: Array.isArray(error.blockTypes) ? error.blockTypes.slice(0, 50).map((type) => short(String(type), 40)) : [],
        textLength: Number.isInteger(error.rawTextLength) && error.rawTextLength >= 0 ? error.rawTextLength : error.rawText.length,
        text: clipText(redact(error.rawText), MAX_TEXT_BYTES),
      };
      fsImpl.mkdirSync(folder, { recursive: true, mode: 0o700 });
      let file = path.join(folder, `${PREFIX}${stamp(at)}.json`);
      for (let copy = 2; fsImpl.existsSync(file) && copy < 100; copy++) file = path.join(folder, `${PREFIX}${stamp(at)}-${copy}.json`);
      writeFileDurable(file, `${JSON.stringify(entry, null, 2)}\n`, { mode: 0o600, fsImpl });
      prune(folder, Date.parse(at));
      return file;
    } catch (failure) {
      try { log(`An AI diagnostics file couldn’t be saved: ${failure?.code || failure?.message || failure}`); } catch (_) { /* logging is a courtesy too */ }
      return null;
    }
  }

  // At start: files past 30 days go even when no new failure writes one. Never throws.
  function sweep() {
    try {
      const folder = folderOf();
      if (folder && fsImpl.existsSync(folder)) prune(folder, now().getTime());
    } catch (failure) {
      try { log(`Old AI diagnostics files couldn’t be removed: ${failure?.code || failure?.message || failure}`); } catch (_) { /* logging is a courtesy too */ }
    }
  }

  return { record, prune: sweep };
}

module.exports = { createAiDiagnostics, AI_DIAGNOSTICS_PREFIX: PREFIX, AI_DIAGNOSTICS_KEEP: KEEP, AI_DIAGNOSTICS_MAX_TEXT_BYTES: MAX_TEXT_BYTES };
