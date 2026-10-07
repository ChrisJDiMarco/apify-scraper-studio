// Direct Images API adapter. Credentials stay in the calling host; no SDK retries.
const { createHash, randomUUID } = require('node:crypto');
const { inflateSync } = require('node:zlib');
const MODEL = 'gpt-image-2.5-flare';
const ENDPOINT = 'https://api.openai.com/v1/images/generations';
const MIN_DISPATCH_ALLOWANCE_USD = 0.25; // Local dispatch policy, not a quoted image price or hard charge cap.
const MAX_PNG_BYTES = 20 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
const BUDGET_NOTICE = 'The allowance controls new requests, not the final provider charge for an already-dispatched image.';
const stamp = () => new Date().toISOString();
const copy = value => JSON.parse(JSON.stringify(value));
const digest = value => createHash('sha256').update(value).digest('hex');
function problem(code, field, message) { const error = new Error(message); error.code = code; error.field = field; return error; }
function invalid(field, message) { throw problem('IMAGE_INPUT_INVALID', field, message); }
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => { for (let i = 0; i < 8; i++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0); return value >>> 0; });
function crc32(buffer) { let crc = 0xffffffff; for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }
function validatePng(buffer, { width: expectedWidth, height: expectedHeight } = {}) {
  const bad = () => { throw problem('IMAGE_PNG_INVALID', 'image', 'The provider returned an invalid, incomplete, or unsupported PNG.'); };
  if (!Buffer.isBuffer(buffer) || buffer.length < 57 || buffer.length > MAX_PNG_BYTES || buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') bad();
  let offset = 8; let width; let height; let depth; let color; let chunks = 0; let ended = false; let seenPalette = false; let seenData = false; let dataEnded = false; const idat = [];
  while (offset < buffer.length) {
    if (++chunks > 10000 || offset + 12 > buffer.length) bad();
    const length = buffer.readUInt32BE(offset); const end = offset + length + 12;
    if (end > buffer.length || length > MAX_PNG_BYTES) bad();
    const type = buffer.toString('ascii', offset + 4, offset + 8); const bytes = buffer.subarray(offset + 8, offset + 8 + length);
    if (!/^[A-Za-z]{4}$/.test(type) || crc32(buffer.subarray(offset + 4, offset + 8 + length)) !== buffer.readUInt32BE(end - 4)) bad();
    if (chunks === 1 && type !== 'IHDR') bad();
    if (type === 'IHDR') {
      if (chunks !== 1 || length !== 13) bad();
      width = bytes.readUInt32BE(0); height = bytes.readUInt32BE(4); depth = bytes[8]; color = bytes[9];
      const depths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
      if (!width || !height || width > 3840 || height > 3840 || width * height > 8294400 || !depths[color]?.includes(depth) || bytes[10] !== 0 || bytes[11] !== 0 || bytes[12] !== 0) bad();
      if ((expectedWidth && width !== expectedWidth) || (expectedHeight && height !== expectedHeight)) throw problem('IMAGE_DIMENSIONS_MISMATCH', 'image', 'The generated PNG dimensions do not match the requested size.');
    } else if (type === 'PLTE') {
      if (seenPalette || seenData || !length || length > 768 || length % 3 || color === 0 || color === 4 || (color === 3 && length / 3 > 2 ** depth)) bad(); seenPalette = true;
    } else if (type === 'IDAT') {
      if (dataEnded || (color === 3 && !seenPalette)) bad(); seenData = true; idat.push(bytes);
    } else if (type === 'IEND') {
      if (length || !seenData || end !== buffer.length) bad(); ended = true;
    } else if (type === 'acTL' || /^[A-Z]/.test(type)) bad();
    if (seenData && type !== 'IDAT') dataEnded = true;
    offset = end;
  }
  if (!ended || !idat.length) bad();
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[color]; const stride = Math.ceil(width * channels * depth / 8) + 1; const expectedBytes = stride * height;
  let pixels; try { pixels = inflateSync(Buffer.concat(idat), { maxOutputLength: expectedBytes }); } catch (_) { bad(); }
  if (pixels.length !== expectedBytes) bad();
  for (let row = 0; row < height; row++) if (pixels[row * stride] > 4) bad();
  return { width, height, bytes: buffer.length };
}
function normalizedUsage(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const result = {}; const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 100000000;
  for (const key of ['input_tokens', 'output_tokens', 'total_tokens']) if (count(raw[key])) result[key] = raw[key];
  for (const key of ['input_tokens_details', 'output_tokens_details']) {
    const value = raw[key]; if (!value || typeof value !== 'object') continue;
    const details = {}; for (const part of ['text_tokens', 'image_tokens']) if (count(value[part])) details[part] = value[part];
    if (Object.keys(details).length) result[key] = details;
  }
  return Object.keys(result).length ? result : null;
}
function usageCost(usage) {
  const input = usage?.input_tokens_details; const output = usage?.output_tokens_details;
  if (!input || !Number.isFinite(input.text_tokens) || !Number.isFinite(input.image_tokens) || !Number.isFinite(usage.input_tokens) || !Number.isFinite(usage.total_tokens) || !Number.isFinite(usage.output_tokens) || usage.output_tokens <= 0) return null;
  if (usage.input_tokens != null && usage.input_tokens !== input.text_tokens + input.image_tokens) return null;
  if (usage.total_tokens != null && usage.total_tokens !== input.text_tokens + input.image_tokens + usage.output_tokens) return null;
  if (output && ((output.text_tokens ?? 0) !== 0 || output.image_tokens !== usage.output_tokens)) return null;
  return Number(((input.text_tokens * 5 + input.image_tokens * 8 + usage.output_tokens * 30) / 1000000).toFixed(12));
}
function safeRequestId(response) { const value = response.headers?.get('x-request-id'); return typeof value === 'string' && /^req_[a-zA-Z0-9_-]{1,150}$/.test(value) ? value : null; }
async function readJson(response, limit = MAX_RESPONSE_BYTES) {
  if (Number(response.headers?.get('content-length')) > limit || !response.body?.getReader) throw problem('IMAGE_RESPONSE_INVALID', 'image', 'The provider returned an oversized or unreadable response.');
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > limit) { await reader.cancel(); throw problem('IMAGE_RESPONSE_INVALID', 'image', 'The provider returned an oversized response.'); } chunks.push(Buffer.from(value)); } }
  finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (_) { throw problem('IMAGE_RESPONSE_INVALID', 'image', 'The provider returned an unreadable image response.'); }
}
function decodeImage(body, dimensions) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.data) || body.data.length !== 1 || (body.output_format && body.output_format !== 'png')) throw problem('IMAGE_RESPONSE_INVALID', 'image', 'The provider did not return exactly one PNG for this creative direction.');
  const encoded = body.data[0]?.b64_json;
  if (typeof encoded !== 'string' || encoded.length < 76 || encoded.length > Math.ceil(MAX_PNG_BYTES / 3) * 4 || encoded.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw problem('IMAGE_RESPONSE_INVALID', 'image', 'The provider did not return valid bounded image bytes.');
  const png = Buffer.from(encoded, 'base64'); if (png.toString('base64') !== encoded) throw problem('IMAGE_RESPONSE_INVALID', 'image', 'The provider returned noncanonical image bytes.');
  validatePng(png, dimensions); return png;
}
function createImageProvider({ getApiKey, fetchImpl = globalThis.fetch, timeoutMs = 180000, quality = 'medium' } = {}) {
  if (typeof getApiKey !== 'function' || typeof fetchImpl !== 'function') invalid('imageConnection', 'Image generation needs a host credential provider and HTTP client.');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600000) invalid('timeoutMs', 'Choose an image timeout from 1 to 600,000 milliseconds.');
  if (!['low', 'medium', 'high'].includes(quality)) invalid('quality', 'Choose low, medium, or high image quality.');
  const active = new Set();
  async function key() {
    let value; try { value = await getApiKey(); } catch (_) { throw problem('IMAGE_AUTH_REQUIRED', 'imageConnection', 'The OpenAI credential could not be loaded. Reconnect images in Settings.'); }
    if (typeof value !== 'string' || !value || value.length > 12000 || /[^\x21-\x7e]/.test(value)) throw problem('IMAGE_AUTH_REQUIRED', 'imageConnection', 'Connect an OpenAI API key for images in Settings.');
    return value;
  }
  async function request(url, options, { signal, isCancelled = () => false, receipt } = {}) {
    const controller = new AbortController(); let timedOut = false; let cancelled = false;
    function cancel() { cancelled = true; controller.abort(); }
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    const poll = setInterval(() => { try { if (isCancelled()) cancel(); } catch (_) { cancel(); } }, 50);
    if (signal?.aborted) cancel(); else signal?.addEventListener('abort', cancel, { once: true });
    try {
      if (controller.signal.aborted || isCancelled()) { cancel(); throw problem('IMAGE_CANCELLED', 'image', 'Image generation was cancelled.'); }
      const response = await fetchImpl(url, { ...options, redirect: 'error', signal: controller.signal });
      if (receipt) receipt.requestId = safeRequestId(response);
      if (!response.ok) {
        const definitive = response.status >= 400 && response.status < 500 && response.status !== 408;
        const message = [401, 403].includes(response.status) ? 'OpenAI denied image access. Check the key, model permission, and organization verification.' : response.status === 429 ? 'OpenAI image rate limit or quota was reached. Review usage before retrying.' : `OpenAI image request failed with status ${response.status}.`;
        const error = problem('IMAGE_HTTP_ERROR', [401, 403].includes(response.status) ? 'imageConnection' : 'image', message); error.definitiveRejected = definitive; error.httpStatus = response.status; throw error;
      }
      return await readJson(response, options.method === 'GET' ? 1024 * 1024 : MAX_RESPONSE_BYTES);
    } catch (error) {
      if (timedOut) throw problem('IMAGE_TIMEOUT', 'image', 'Image generation timed out. The provider may still charge this request; it was not automatically retried.');
      if (cancelled || signal?.aborted) throw problem('IMAGE_CANCELLED', 'image', 'Image generation was cancelled. A dispatched request may still incur a provider charge.');
      if (error?.code?.startsWith('IMAGE_')) throw error;
      throw problem('IMAGE_NETWORK_ERROR', 'image', 'OpenAI could not complete the connection. The paid request was not automatically retried.');
    } finally { clearTimeout(timer); clearInterval(poll); signal?.removeEventListener('abort', cancel); }
  }
  async function checkAccess({ signal } = {}) {
    const credential = await key(); const result = await request(`https://api.openai.com/v1/models/${MODEL}`, { method: 'GET', headers: { Authorization: `Bearer ${credential}`, Accept: 'application/json' } }, { signal });
    if (![MODEL, `${MODEL}-2026-09-08`].includes(result?.id)) throw problem('IMAGE_ACCESS_UNVERIFIED', 'imageConnection', 'OpenAI returned an unexpected model-access response.');
    return { provider: 'openai', configured: true, model: result.id, requestedModel: MODEL, accessible: true, accessVerified: true, generationVerified: false, checkedAt: stamp(), message: 'Model access checked. Paid image generation and billing have not been tested.' };
  }
  async function generate({ deliverable, runId, maxBudgetUsd, isCancelled = () => false, signal, onRequest, onVariant, completedVariants = [] } = {}) {
    if (!deliverable || deliverable.kind !== 'image' || !Number.isInteger(deliverable.variants) || deliverable.variants < 1 || deliverable.variants > 3) invalid('deliverable', 'Choose one to three image variants.');
    if (typeof runId !== 'string' || !/^[a-zA-Z0-9_-]{1,180}$/.test(runId)) invalid('runId', 'Choose a valid image run identity.');
    if (typeof onRequest !== 'function') invalid('onRequest', 'A durable request checkpoint is required before a paid image call.');
    if (onVariant != null && typeof onVariant !== 'function') invalid('onVariant', 'The image checkpoint must be a function.');
    if (typeof isCancelled !== 'function' || (signal != null && (typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function'))) invalid('signal', 'Provide a cancellation callback or AbortSignal.');
    if (typeof maxBudgetUsd !== 'number' || !Number.isFinite(maxBudgetUsd) || maxBudgetUsd < 0 || maxBudgetUsd > 1000) invalid('maxBudgetUsd', 'Choose an image dispatch allowance from $0 to $1,000.');
    if (!['1024x1024', '1536x1024', '1024x1536'].includes(deliverable.size)) invalid('deliverable.size', 'Choose a supported square, landscape, or portrait image size.');
    const [width, height] = deliverable.size.split('x').map(Number); const dimensions = { width, height };
    const prompts = deliverable.variantPrompts;
    if (!Array.isArray(prompts) || prompts.length !== deliverable.variants || prompts.some(prompt => typeof prompt !== 'string' || !prompt.trim() || prompt.length > 32000)) invalid('deliverable.variantPrompts', 'Each image direction needs a prompt of 1–32,000 characters. Shorten the source brief rather than silently truncating it.');
    if (!Array.isArray(completedVariants) || completedVariants.length > deliverable.variants) invalid('completedVariants', 'Provide only saved completed variants for this image job.');
    const images = new Map(); const attemptReceipts = [];
    for (const image of completedVariants) {
      const index = image?.variantIndex; const receipt = image?.receipt;
      if (!Number.isInteger(index) || index < 0 || index >= deliverable.variants || images.has(index) || receipt?.status !== 'succeeded' || receipt.variantIndex !== index || receipt.promptHash !== digest(prompts[index]) || receipt.requestedModel !== MODEL || receipt.size !== deliverable.size || receipt.quality !== quality || receipt.runId !== runId) invalid('completedVariants', 'A saved image does not match this run, prompt, model, size, or quality.');
      validatePng(image.png, dimensions); images.set(index, { variantIndex: index, title: String(image.title || deliverable.label || 'Generated image').slice(0, 300), png: Buffer.from(image.png), receipt: copy(receipt) });
    }
    const remainingCount = deliverable.variants - images.size;
    if (remainingCount && maxBudgetUsd + 1e-10 < remainingCount * MIN_DISPATCH_ALLOWANCE_USD) throw problem('IMAGE_ALLOWANCE_REQUIRED', 'maxBudgetUsd', `Reserve at least $${(remainingCount * MIN_DISPATCH_ALLOWANCE_USD).toFixed(2)} for ${remainingCount} remaining image request(s). This is a local dispatch allowance, not a guaranteed final price.`);
    const activeKey = `${runId}:${deliverable.id || 'image'}`; if (active.has(activeKey)) throw problem('IMAGE_JOB_BUSY', 'runId', 'This image job is already running.'); active.add(activeKey);
    let spent = 0; let unknownSpend = false;
    try {
      for (let variantIndex = 0; variantIndex < deliverable.variants; variantIndex++) {
        if (images.has(variantIndex)) continue;
        if (signal?.aborted || isCancelled()) throw problem('IMAGE_CANCELLED', 'image', 'Image generation was cancelled before another paid request.');
        const remaining = maxBudgetUsd - spent;
        if (unknownSpend) throw problem('IMAGE_USAGE_UNKNOWN', 'maxBudgetUsd', 'An image completed without usable billing data. Its allowance remains reserved; review or increase the allowance before generating more variants.');
        if (remaining + 1e-10 < MIN_DISPATCH_ALLOWANCE_USD) throw problem('IMAGE_ALLOWANCE_EXHAUSTED', 'maxBudgetUsd', 'The image dispatch allowance is exhausted. Completed variants are preserved; increase the allowance to continue.');
        const credential = await key();
        const receipt = { provider: 'openai', attemptId: randomUUID(), runId, variantIndex, requestedModel: MODEL, model: MODEL, returnedModel: null, promptHash: digest(prompts[variantIndex]), size: deliverable.size, quality, status: 'dispatched', allowanceUsd: Number((remaining / (deliverable.variants - images.size)).toFixed(12)), budgetKind: 'dispatch-allowance', budgetNotice: BUDGET_NOTICE, requestId: null, startedAt: stamp(), billable: null, usage: null, costUsd: null, estimatedCostUsd: null, costBasis: 'unknown', pricingAsOf: '2026-09-27', pricingUsdPerMillion: { textInput: 5, imageInput: 8, imageOutput: 30 } };
        attemptReceipts.push(receipt); let dispatched = false;
        try {
          try { await onRequest(copy(receipt)); } catch (_) { throw problem('IMAGE_CHECKPOINT_FAILED', 'imageCheckpoint', 'The image request checkpoint could not be saved. No new request was sent.'); }
          if (signal?.aborted || isCancelled()) throw problem('IMAGE_CANCELLED', 'image', 'Image generation was cancelled before the request was sent.');
          dispatched = true;
          const body = await request(ENDPOINT, { method: 'POST', headers: { Authorization: `Bearer ${credential}`, Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ model: MODEL, prompt: prompts[variantIndex], n: 1, size: deliverable.size, quality, output_format: 'png', background: 'opaque', moderation: 'auto' }) }, { signal, isCancelled, receipt });
          receipt.usage = normalizedUsage(body?.usage); receipt.costUsd = usageCost(receipt.usage); receipt.estimatedCostUsd = receipt.costUsd; receipt.costBasis = receipt.costUsd == null ? 'unknown' : 'usage-estimate'; receipt.billable = true;
          if (body?.model != null && ![MODEL, `${MODEL}-2026-09-08`].includes(body.model)) throw problem('IMAGE_MODEL_MISMATCH', 'image', 'The provider returned an unexpected image model.');
          receipt.returnedModel = body?.model || null;
          const png = decodeImage(body, dimensions); receipt.status = 'succeeded'; receipt.completedAt = stamp();
          const image = { variantIndex, title: `${String(deliverable.label || 'Generated image').slice(0, 250)} · ${variantIndex + 1}`, png, receipt: copy(receipt) }; images.set(variantIndex, image);
          if (receipt.costUsd == null) unknownSpend = true; else spent += receipt.costUsd;
          if (onVariant) { try { await onVariant(image); } catch (_) { throw problem('IMAGE_CHECKPOINT_FAILED', 'imageCheckpoint', 'A completed image could not be saved. No further image request was sent.'); } }
        } catch (error) {
          if (receipt.status !== 'succeeded') {
            if (!dispatched || error.definitiveRejected) { receipt.status = 'failed'; receipt.billable = false; receipt.costUsd = 0; receipt.estimatedCostUsd = 0; receipt.costBasis = 'not-dispatched-or-rejected'; }
            else if (receipt.costUsd != null) { receipt.status = 'failed'; receipt.billable = true; }
            else { receipt.status = 'unknown'; receipt.billable = null; }
            receipt.completedAt = stamp(); receipt.errorCode = error.code || 'IMAGE_GENERATION_FAILED';
          }
          throw error;
        }
      }
      return [...images.values()].sort((a, b) => a.variantIndex - b.variantIndex);
    } catch (error) {
      const safe = error?.code?.startsWith('IMAGE_') ? error : problem('IMAGE_GENERATION_FAILED', 'image', 'Image generation could not complete. No request was automatically retried.');
      safe.partialImages = [...images.values()].sort((a, b) => a.variantIndex - b.variantIndex); safe.attemptReceipts = copy(attemptReceipts); throw safe;
    } finally { active.delete(activeKey); }
  }
  async function generateImage(options) {
    try { return await generate(options); }
    catch (error) { if (!error.attemptReceipts?.length) error.beforeDispatch = true; throw error; }
  }
  return { generateImage, checkAccess };
}
module.exports = { createImageProvider, validatePng, MODEL, MIN_DISPATCH_ALLOWANCE_USD, MAX_PNG_BYTES, MAX_RESPONSE_BYTES };
