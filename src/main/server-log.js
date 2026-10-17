'use strict';
// Structured logs for the browser studio's server: one JSON line per event on stdout ({at, level, event, …}), so a log
// collector can index them. What goes in is metadata only (request id, method or channel, status, duration, identity
// id); never payloads, file contents, cookies, link tokens, passwords or keys. Keys whose names look secret are
// dropped, long hex strings and provider key prefixes are masked, and strings are capped.
// STUDIO_LOG_LEVEL picks the lowest level written: error, warn, info (default) or debug.
const LEVELS = Object.freeze({ error: 0, warn: 1, info: 2, debug: 3 });
const SECRET_KEY = /token|hash|password|secret|cookie|payload|authorization|apikey|api_key/i;
const MASK = /(?:Bearer\s+|sk-ant-|sk-|apify_api_)[\w.-]+|\b[0-9a-f]{32,}\b/gi;

function clean(value, depth = 0) {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.replace(MASK, '[redacted]').slice(0, 500);
  if (Array.isArray(value) && depth < 2) return value.slice(0, 20).map((entry) => clean(entry, depth + 1));
  if (value && typeof value === 'object' && depth < 2) {
    const out = {};
    for (const [key, entry] of Object.entries(value)) if (!SECRET_KEY.test(key)) { const cleaned = clean(entry, depth + 1); if (cleaned !== undefined) out[key] = cleaned; }
    return out;
  }
  return undefined;
}

function createServerLog({ level = process.env.STUDIO_LOG_LEVEL, write = (line) => process.stdout.write(`${line}\n`), now = () => new Date() } = {}) {
  const threshold = LEVELS[String(level || '').toLowerCase()] ?? LEVELS.info;
  function log(at, event, fields = {}) {
    if (!(at in LEVELS) || LEVELS[at] > threshold) return;
    const entry = { at: now().toISOString(), level: at, event: String(event || 'event'), ...clean(fields && typeof fields === 'object' ? fields : {}) };
    try { write(JSON.stringify(entry)); } catch (_) { /* logging never fails the work it describes */ }
  }
  return {
    log,
    enabled: (at) => at in LEVELS && LEVELS[at] <= threshold,
    error: (event, fields) => log('error', event, fields),
    warn: (event, fields) => log('warn', event, fields),
    info: (event, fields) => log('info', event, fields),
    debug: (event, fields) => log('debug', event, fields),
  };
}
// An error as loggable fields: its code and a masked first line, plus a few stack frames for unexpected failures.
function errorFields(error, { stack = false } = {}) {
  const message = String(error?.message ?? error ?? '').split('\n')[0];
  return { code: typeof error?.code === 'string' ? error.code : '', error: message, ...(stack && error?.stack ? { stack: String(error.stack).split('\n').slice(1, 6).map((line) => line.trim()) } : {}) };
}

module.exports = { createServerLog, errorFields, LEVELS };
