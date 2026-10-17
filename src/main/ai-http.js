'use strict';
// Small HTTP helpers the AI runners and catalogs share (OpenRouter, OpenAI, fal.ai): JSON requests with a timeout and a
// size cap, and a Server-Sent Events reader with an idle timer. fetch is injected so tests never touch the network.
// Electron-free. Errors carry a stable .code; no request is retried here.

const DEFAULT_TIMEOUT_MS = 20000;
const MAX_JSON_BYTES = 8 * 1024 * 1024;

function httpError(message, code, fields = {}) {
  const error = new Error(message); error.code = code;
  for (const [key, value] of Object.entries(fields)) if (value !== undefined) error[key] = value;
  return error;
}

// Reads a response body as text, refusing past maxBytes.
async function readText(response, maxBytes = MAX_JSON_BYTES) {
  if (Number(response.headers?.get?.('content-length')) > maxBytes) throw httpError('The service sent a reply that is too large.', 'AI_RESPONSE_TOO_LARGE');
  if (!response.body?.getReader) return typeof response.text === 'function' ? String(await response.text()).slice(0, maxBytes) : '';
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > maxBytes) { await reader.cancel().catch(() => {}); throw httpError('The service sent a reply that is too large.', 'AI_RESPONSE_TOO_LARGE'); }
      chunks.push(Buffer.from(value));
    }
  } finally { try { reader.releaseLock(); } catch (_) { /* already released */ } }
  return Buffer.concat(chunks).toString('utf8');
}

// One request; resolves { status, ok, headers, json, text } for any HTTP status (callers map statuses to plain copy) and
// rejects only for a timeout (AI_TIMEOUT), a cancel (CANCELLED) or a network failure (AI_NETWORK).
async function fetchJson(fetchImpl, url, { method = 'GET', headers = {}, body, timeoutMs = DEFAULT_TIMEOUT_MS, signal, maxBytes = MAX_JSON_BYTES, redirect = 'error' } = {}) {
  const controller = new AbortController(); let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, Math.min(timeoutMs, 2 ** 31 - 1));
  const cancel = () => controller.abort();
  if (signal?.aborted) controller.abort(); else signal?.addEventListener?.('abort', cancel, { once: true });
  try {
    const response = await fetchImpl(url, { method, headers, ...(body !== undefined ? { body } : {}), redirect, signal: controller.signal });
    const text = await readText(response, maxBytes);
    let json = null; try { json = text ? JSON.parse(text) : null; } catch (_) { json = null; }
    return { status: response.status, ok: response.ok, headers: response.headers, json, text };
  } catch (error) {
    if (timedOut) throw httpError('The service did not answer in time.', 'AI_TIMEOUT');
    if (signal?.aborted) throw httpError('Job cancelled.', 'CANCELLED');
    if (error?.code && String(error.code).startsWith('AI_')) throw error;
    throw httpError('The service could not be reached. Check the internet connection, then retry.', 'AI_NETWORK');
  } finally { clearTimeout(timer); signal?.removeEventListener?.('abort', cancel); }
}

// Reads text/event-stream: calls onEvent({ event, data }) per event (data joined across lines; '[DONE]' passed through).
// Comment lines (": OPENROUTER PROCESSING") count as activity: each resets the idle timer. Resolves when the stream ends.
async function readSse(response, onEvent, { idleMs = 120000, onIdle } = {}) {
  if (!response.body?.getReader) {
    const text = typeof response.text === 'function' ? await response.text() : '';
    parseBlocks(String(text), onEvent); return;
  }
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''; let idle = null;
  const arm = () => { clearTimeout(idle); idle = setTimeout(() => { try { onIdle?.(); } finally { reader.cancel().catch(() => {}); } }, idleMs); };
  try {
    arm();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      arm();
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n?/g, '\n');
      let cut;
      while ((cut = buffer.indexOf('\n\n')) >= 0) { const block = buffer.slice(0, cut); buffer = buffer.slice(cut + 2); dispatch(block, onEvent); }
    }
    buffer += decoder.decode();
    if (buffer.trim()) dispatch(buffer, onEvent);
  } finally { clearTimeout(idle); try { reader.releaseLock(); } catch (_) { /* released */ } }
}
function parseBlocks(text, onEvent) { for (const block of text.replace(/\r\n?/g, '\n').split('\n\n')) if (block.trim()) dispatch(block, onEvent); }
function dispatch(block, onEvent) {
  let event = 'message'; const data = [];
  for (const line of block.split('\n')) {
    if (!line || line.startsWith(':')) continue;
    const colon = line.indexOf(':'); const field = colon < 0 ? line : line.slice(0, colon); const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (field === 'event') event = value; else if (field === 'data') data.push(value);
  }
  if (data.length) onEvent({ event, data: data.join('\n') });
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = { httpError, readText, fetchJson, readSse, wait, DEFAULT_TIMEOUT_MS };
