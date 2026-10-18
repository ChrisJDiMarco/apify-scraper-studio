'use strict';
// fal.ai pictures and videos through its queue: submit (POST https://queue.fal.run/<endpoint>), poll the status until
// COMPLETED, read the result, then download the file from fal's media hosts only. Pictures keep the image provider's
// contract (a durable checkpoint before every paid request, receipts, partialImages, an unknown outcome blocks repeats);
// a video is one request that can be resumed by its request id after a restart, and is never submitted twice.
// Brand reference images travel as data URIs inside the request (never uploaded to fal storage), only to models that
// take image inputs; otherwise the receipt says they were left out. fal bills only successful outputs, so a failed
// request costs nothing; a finished one costs unit price × units. Electron-free; fetch, clock and sleep are injected.
const { createHash, randomUUID } = require('node:crypto');
const { validatePng } = require('./image-provider');
const { wait } = require('./ai-http');

const QUEUE = 'https://queue.fal.run';
const DEFAULT_MEDIA_HOSTS = ['fal.media', 'fal.run', 'fal.ai'];
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
const MAX_INLINE_REFERENCE_BYTES = 24 * 1024 * 1024;
const COST_BASIS = 'fal unit price (fal charges only successful outputs)';
const ENDPOINT = /^[a-z0-9][a-z0-9._-]*(\/[a-zA-Z0-9._-]+){1,6}$/;
const stamp = () => new Date().toISOString();
const copy = (value) => JSON.parse(JSON.stringify(value));
const digest = (value) => createHash('sha256').update(value).digest('hex');
function problem(code, field, message, extra = {}) { return Object.assign(new Error(message), { code, field, ...extra }); }
const redact = (text) => String(text ?? '').replace(/Key\s+[A-Za-z0-9:._-]+/g, 'Key …');

// Picture size → the shape names fal models use.
const ASPECT_FOR_SIZE = { '1536x1024': ['3:2', '4:3', '16:9'], '1024x1536': ['2:3', '3:4', '9:16'], '1024x1024': ['1:1'] };
const IMAGE_SIZE_ENUM = { '1536x1024': 'landscape_4_3', '1024x1536': 'portrait_4_3', '1024x1024': 'square_hd' };

// A request's body from the endpoint's own field names and types (catalog mapFalOpenApi), e.g. Seedance's duration as '8'.
function falInput(profile = {}, request = {}) {
  const fields = new Set(profile.fields || []); const has = (name) => !fields.size || fields.has(name);
  const body = { prompt: request.prompt };
  if (request.kind === 'image') {
    const [width, height] = String(request.size || '1536x1024').split('x').map(Number);
    if (fields.has('image_size')) body.image_size = profile.imageSizes?.length ? (profile.imageSizes.includes(IMAGE_SIZE_ENUM[request.size]) ? IMAGE_SIZE_ENUM[request.size] : { width, height }) : { width, height };
    if (fields.has('aspect_ratio')) { const options = ASPECT_FOR_SIZE[request.size] || ['1:1']; body.aspect_ratio = options.find((value) => !profile.aspectRatios?.length || profile.aspectRatios.includes(value)) || options[0]; }
    if (has('num_images')) body.num_images = 1;
    if (has('output_format')) body.output_format = 'png';
    if (request.referenceDataUris?.length && profile.referenceField) body[profile.referenceField] = request.referenceDataUris;
  } else {
    if (fields.has('duration') || !fields.size) body.duration = profile.durationType === 'number' ? Number(request.durationSeconds) : String(request.durationSeconds);
    if (request.resolution && has('resolution')) body.resolution = request.resolution;
    if (request.aspectRatio && has('aspect_ratio')) body.aspect_ratio = request.aspectRatio;
    if (fields.has('generate_audio')) body.generate_audio = Boolean(request.sound);
    if (request.imageDataUri && (fields.has('image_url') || !fields.size)) body.image_url = request.imageDataUri;
  }
  if (request.negativePrompt && fields.has('negative_prompt')) body.negative_prompt = request.negativePrompt;
  return body;
}
// A request's status, result and cancel addresses use the app id (owner/app) without the endpoint's sub-path, e.g.
// bytedance/seedance-2.0 for bytedance/seedance-2.0/fast/text-to-video (fal returns them; these are the fallbacks).
const appOf = (endpoint) => String(endpoint || '').split('/').slice(0, 2).join('/');
const isMp4 = (bytes) => Buffer.isBuffer(bytes) && bytes.length > 12 && bytes.toString('ascii', 4, 8) === 'ftyp';

function createFalProvider({ getKey, fetchImpl = globalThis.fetch, clock = Date.now, sleep = wait, pollMs = 2500, slowPollMs = 5000, maxWaitMs = 15 * 60 * 1000, mediaHosts = String(process.env.STUDIO_FAL_MEDIA_HOSTS || '').split(',').map((host) => host.trim().toLowerCase()).filter(Boolean), limits = null } = {}) {
  const hosts = mediaHosts.length ? mediaHosts : DEFAULT_MEDIA_HOSTS;
  const allowedHost = (hostname) => hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`));
  function key() {
    let value; try { value = getKey('FAL_KEY'); } catch (_) { value = ''; }
    if (typeof value !== 'string' || !value.trim() || /\s/.test(value.trim())) throw problem('FAL_AUTH', 'falConnection', 'Add a fal.ai key in Settings, AI connections. Nothing was started.');
    return value.trim();
  }
  async function call(url, { method = 'GET', body, credential, signal } = {}) {
    let response;
    try { response = await fetchImpl(url, { method, redirect: 'error', signal, headers: { Authorization: `Key ${credential}`, Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }); }
    catch (error) { if (signal?.aborted) throw problem('CANCELLED', 'fal', 'Job cancelled.'); throw problem('FAL_NETWORK', 'fal', 'fal.ai could not be reached. Check the internet connection.', { network: true }); }
    let json = null; try { json = await response.json(); } catch (_) { json = null; }
    return { status: response.status, ok: response.ok, json };
  }
  const queueUrl = (value, fallback) => { try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === 'queue.fal.run' ? url.href : fallback; } catch (_) { return fallback; } };
  // Downloads a result file from fal's media hosts only (≤ 3 redirects, each inside the allowlist), with a size cap.
  async function download(value, maxBytes, { signal } = {}) {
    if (typeof value === 'string' && value.startsWith('data:')) {
      const match = /^data:[\w/+.-]+;base64,([A-Za-z0-9+/=]+)$/.exec(value);
      if (!match) throw problem('FAL_RESULT_INVALID', 'fal', 'fal.ai returned a file the studio can’t read.');
      const bytes = Buffer.from(match[1], 'base64'); if (bytes.length > maxBytes) throw problem('FAL_RESULT_TOO_LARGE', 'fal', 'fal.ai returned a file that is too large.');
      return bytes;
    }
    let url = value;
    for (let hop = 0; hop <= 3; hop++) {
      let parsed; try { parsed = new URL(url); } catch (_) { throw problem('FAL_RESULT_INVALID', 'fal', 'fal.ai returned an unreadable file address.'); }
      if (parsed.protocol !== 'https:' || !allowedHost(parsed.hostname.toLowerCase())) throw problem('FAL_RESULT_HOST', 'fal', `fal.ai returned a file on ${parsed.hostname}, which isn’t one of its media hosts, so it wasn’t downloaded.`);
      let response;
      try { response = await fetchImpl(parsed.href, { method: 'GET', redirect: 'manual', signal }); } catch (_) { throw problem('FAL_NETWORK', 'fal', 'The finished file couldn’t be downloaded from fal.ai.', { network: true }); }
      if ([301, 302, 303, 307, 308].includes(response.status)) { const next = response.headers?.get?.('location'); if (!next) break; url = new URL(next, parsed.href).href; continue; }
      if (!response.ok) throw problem('FAL_DOWNLOAD_FAILED', 'fal', `The finished file couldn’t be downloaded from fal.ai (${response.status}).`);
      if (Number(response.headers?.get?.('content-length')) > maxBytes) throw problem('FAL_RESULT_TOO_LARGE', 'fal', 'fal.ai returned a file that is too large.');
      if (!response.body?.getReader) { const bytes = Buffer.from(await response.arrayBuffer()); if (bytes.length > maxBytes) throw problem('FAL_RESULT_TOO_LARGE', 'fal', 'fal.ai returned a file that is too large.'); return bytes; }
      const reader = response.body.getReader(); const chunks = []; let size = 0;
      try { while (true) { const { done, value: chunk } = await reader.read(); if (done) break; size += chunk.byteLength; if (size > maxBytes) { await reader.cancel().catch(() => {}); throw problem('FAL_RESULT_TOO_LARGE', 'fal', 'fal.ai returned a file that is too large.'); } chunks.push(Buffer.from(chunk)); } }
      finally { try { reader.releaseLock(); } catch (_) { /* released */ } }
      return Buffer.concat(chunks);
    }
    throw problem('FAL_RESULT_HOST', 'fal', 'fal.ai redirected the download too many times, so it was stopped.');
  }
  async function slot({ signal, isCancelled }) {
    if (!limits) return () => {};
    let leave = null;
    const poll = setInterval(() => { try { if (signal?.aborted || isCancelled?.()) leave?.(); } catch (_) { leave?.(); } }, 100);
    try { return await limits.acquire({ register: (cancel) => { leave = cancel; } }); }
    catch (_) { throw problem('CANCELLED', 'fal', 'Cancelled before another paid request.'); }
    finally { clearInterval(poll); }
  }
  const underBudget = () => { if (!limits) return; try { limits.checkBudget(); } catch (error) { throw problem('FAL_DAILY_BUDGET', 'fal', error.message); } };
  const failure = (json) => redact(json?.error?.message || json?.error || json?.detail?.[0]?.msg || json?.detail || 'fal.ai couldn’t finish this request.').slice(0, 300);

  // Submit (or resume) one queue request and wait for it: { result, requestId, statusUrl, responseUrl }.
  async function runRequest({ endpoint, input, credential, signal, isCancelled = () => false, onSubmitted, onProgress, resume = null }) {
    let requestId = resume?.requestId || ''; let statusUrl = resume?.statusUrl || ''; let responseUrl = resume?.responseUrl || '';
    const base = `${QUEUE}/${appOf(endpoint)}/requests/`;
    if (!requestId) {
      const leave = await slot({ signal, isCancelled });
      let submitted;
      try { underBudget(); submitted = await call(`${QUEUE}/${endpoint}`, { method: 'POST', body: input, credential, signal }); }
      finally { leave(); }
      if (!submitted.ok || typeof submitted.json?.request_id !== 'string') {
        const status = submitted.status;
        throw problem(status === 401 || status === 403 ? 'FAL_AUTH' : status === 422 ? 'FAL_INPUT_REJECTED' : status === 429 ? 'FAL_RATE_LIMITED' : 'FAL_SUBMIT_FAILED', 'fal', status === 401 || status === 403 ? 'fal.ai rejected the key. Check it in Settings, AI connections.' : status === 422 ? `fal.ai didn’t accept this request: ${failure(submitted.json)}` : status === 429 ? 'fal.ai’s rate limit was reached. Wait a minute, then retry.' : `fal.ai didn’t take the request (${status}).`, { definitiveRejected: status >= 400 && status < 500 && status !== 408 });
      }
      requestId = submitted.json.request_id;
      statusUrl = queueUrl(submitted.json.status_url, `${base}${requestId}/status`);
      responseUrl = queueUrl(submitted.json.response_url, `${base}${requestId}`);
      await onSubmitted?.({ requestId, statusUrl, responseUrl, cancelUrl: queueUrl(submitted.json.cancel_url, `${base}${requestId}/cancel`) });
    }
    const started = clock();
    while (true) {
      if (signal?.aborted || isCancelled()) throw problem('CANCELLED', 'fal', 'Stopped while fal.ai was working. The request may still finish and be charged.', { requestId, statusUrl, responseUrl, dispatched: true });
      const status = await call(`${statusUrl}${statusUrl.includes('?') ? '&' : '?'}logs=0`, { credential, signal });
      if (status.status === 404) throw problem('FAL_REQUEST_UNKNOWN', 'fal', 'fal.ai no longer knows this request, so its outcome is unknown. It may have been billed.', { requestId, unknown: true });
      if (status.ok) {
        const state = status.json?.status;
        try { onProgress?.({ status: state, queuePosition: Number.isInteger(status.json?.queue_position) ? status.json.queue_position : null, elapsedMs: clock() - started }); } catch (_) { /* courtesy */ }
        if (state === 'COMPLETED') {
          if (status.json?.error) throw problem('FAL_FAILED', 'fal', `fal.ai couldn’t make this: ${failure(status.json)}`, { requestId, falFailed: true });
          break;
        }
      }
      if (clock() - started > maxWaitMs) throw problem('FAL_TIMEOUT', 'fal', `fal.ai didn’t finish within ${Math.round(maxWaitMs / 60000)} minutes. It may still finish and be charged; Try again checks it without paying twice.`, { requestId, statusUrl, responseUrl, unknown: true });
      await sleep(clock() - started < 30000 ? pollMs : slowPollMs);
    }
    const leave = await slot({ signal, isCancelled });
    try {
      const result = await call(responseUrl, { credential, signal });
      if (!result.ok) throw problem('FAL_FAILED', 'fal', `fal.ai couldn’t make this: ${failure(result.json)}`, { requestId, falFailed: result.status === 422 || result.status === 400 });
      return { result: result.json || {}, requestId, statusUrl, responseUrl, leave };
    } catch (error) { leave(); throw error; }
  }

  // Pictures, one request per variant (fal's num_images repeats one prompt; each variant has its own direction).
  async function generateImages({ deliverable, model, profile = {}, price = {}, runId, maxBudgetUsd, isCancelled = () => false, signal, onRequest, onVariant, completedVariants = [] } = {}) {
    if (!ENDPOINT.test(String(model || ''))) throw problem('IMAGE_INPUT_INVALID', 'model', 'Choose a fal.ai picture model.', { beforeDispatch: true });
    if (!deliverable || deliverable.kind !== 'image' || !Number.isInteger(deliverable.variants) || deliverable.variants < 1 || deliverable.variants > 3) throw problem('IMAGE_INPUT_INVALID', 'deliverable', 'Choose one to three image variants.', { beforeDispatch: true });
    if (!Array.isArray(deliverable.references)) throw problem('IMAGE_INPUT_INVALID', 'deliverable.references', 'Every picture request lists the brand reference images it sends (an empty list when its set has none).', { beforeDispatch: true });
    if (typeof onRequest !== 'function') throw problem('IMAGE_INPUT_INVALID', 'onRequest', 'A durable request checkpoint is required before a paid image call.', { beforeDispatch: true });
    if (!Number.isFinite(price.unitUsd)) throw problem('IMAGE_PRICE_UNKNOWN', 'model', `fal.ai didn’t return a price for ${model}, so the studio can’t estimate it. Nothing was started.`, { beforeDispatch: true });
    const prompts = deliverable.variantPrompts;
    if (!Array.isArray(prompts) || prompts.length !== deliverable.variants || prompts.some((text) => typeof text !== 'string' || !text.trim() || text.length > 32000)) throw problem('IMAGE_INPUT_INVALID', 'deliverable.variantPrompts', 'Each image direction needs a prompt of 1–32,000 characters.', { beforeDispatch: true });
    if (profile.png === false) throw problem('IMAGE_INPUT_INVALID', 'model', `${model} can’t return PNG pictures. Choose another picture model.`, { beforeDispatch: true });
    const [width, height] = String(deliverable.size || '1536x1024').split('x').map(Number);
    // Pictures are priced per image or per megapixel; any other unit can't be estimated before the request.
    const unitName = String(price.unit || 'image').toLowerCase();
    const units = /^megapixels?$/.test(unitName) ? Math.ceil((width * height) / 1e6) : /^images?$/.test(unitName) ? 1 : null;
    if (units == null) throw problem('IMAGE_PRICE_UNKNOWN', 'model', `fal.ai prices ${model} per ${price.unit}, which the studio can’t estimate. Nothing was started.`, { beforeDispatch: true });
    const estimateUsd = Math.round(price.unitUsd * units * 1e6) / 1e6;
    // References: data URIs, only to a model that takes images, within the inline size cap (checked before anything is sent).
    const takes = (profile.referenceImages || 0) > 0 && profile.referenceField;
    const refs = takes ? deliverable.references.slice(0, profile.referenceImages) : [];
    const inline = refs.map((reference) => `data:${reference.mime};base64,${Buffer.from(reference.data).toString('base64')}`);
    if (inline.reduce((sum, uri) => sum + uri.length, 0) > MAX_INLINE_REFERENCE_BYTES) throw problem('IMAGE_INPUT_INVALID', 'deliverable.references', 'The brand reference images are too large to send to fal.ai together (24 MB). Use smaller reference images in Settings.', { beforeDispatch: true });
    const referencesOmitted = deliverable.references.length > refs.length;
    const referencesHash = refs.length ? digest(JSON.stringify(refs.map((reference) => [reference.role, digest(Buffer.from(reference.data))]))) : null;
    const images = new Map(); const attempts = []; let spent = 0;
    for (const image of completedVariants) {
      const receipt = image?.receipt; const index = image?.variantIndex;
      if (!Number.isInteger(index) || receipt?.status !== 'succeeded' || receipt.provider !== 'fal' || receipt.endpoint !== model || receipt.promptHash !== digest(prompts[index]) || receipt.runId !== runId) throw problem('IMAGE_INPUT_INVALID', 'completedVariants', 'A saved image does not match this run, prompt or model.', { beforeDispatch: true });
      validatePng(image.png, { maxWidth: 3840 });
      images.set(index, { variantIndex: index, title: String(image.title || deliverable.label || 'Generated image'), png: Buffer.from(image.png), receipt: copy(receipt) });
    }
    const credential = key();
    try {
      for (let variantIndex = 0; variantIndex < deliverable.variants; variantIndex++) {
        if (images.has(variantIndex)) continue;
        if (signal?.aborted || isCancelled()) throw problem('IMAGE_CANCELLED', 'image', 'Image generation was cancelled before another paid request.');
        const remaining = maxBudgetUsd - spent;
        if (remaining + 1e-9 < estimateUsd) throw problem('IMAGE_ALLOWANCE_EXHAUSTED', 'maxBudgetUsd', 'The picture allowance is used up. Finished pictures are saved; raise the budget to continue.');
        const receipt = { provider: 'fal', attemptId: randomUUID(), runId, variantIndex, endpoint: model, requestedModel: model, model, returnedModel: null, promptHash: digest(prompts[variantIndex]), size: deliverable.size, quality: '', status: 'dispatched', allowanceUsd: Number(Math.min(remaining, Math.max(estimateUsd, remaining / (deliverable.variants - images.size))).toFixed(12)), requestId: null, startedAt: stamp(), unit: price.unit || 'image', unitUsd: price.unitUsd, units, estimatedCostUsd: estimateUsd, costUsd: null, costBasis: COST_BASIS, pricingAsOf: price.asOf || '', ...(referencesHash ? { referencesHash, references: refs.map((reference) => ({ role: reference.role, mime: reference.mime, bytes: Buffer.from(reference.data).length, sha256: digest(Buffer.from(reference.data)) })) } : {}), ...(referencesOmitted ? { referencesOmitted: true } : {}) };
        attempts.push(receipt); let dispatched = false; let leave = () => {};
        try {
          try { await onRequest(copy(receipt)); } catch (_) { throw problem('IMAGE_CHECKPOINT_FAILED', 'imageCheckpoint', 'The image request checkpoint could not be saved. No new request was sent.'); }
          const input = falInput(profile, { kind: 'image', prompt: prompts[variantIndex], size: deliverable.size, referenceDataUris: inline });
          dispatched = true;
          const done = await runRequest({ endpoint: model, input, credential, signal, isCancelled, onSubmitted: ({ requestId }) => { receipt.requestId = requestId; } });
          leave = done.leave;
          const file = done.result?.images?.[0];
          if (!file?.url) throw problem('IMAGE_RESPONSE_INVALID', 'image', 'fal.ai finished without a picture.', { falFailed: false });
          const png = await download(file.url, MAX_IMAGE_BYTES, { signal });
          const size = validatePng(png, { maxWidth: 3840 });
          receipt.status = 'succeeded'; receipt.completedAt = stamp(); receipt.costUsd = estimateUsd; receipt.width = size.width; receipt.height = size.height; receipt.returnedModel = model;
          spent += estimateUsd; limits?.record?.(estimateUsd);
          const image = { variantIndex, title: `${String(deliverable.label || 'Generated image').slice(0, 250)} · ${variantIndex + 1}`, png, receipt: copy(receipt) };
          images.set(variantIndex, image);
          if (onVariant) { try { await onVariant(image); } catch (_) { throw problem('IMAGE_CHECKPOINT_FAILED', 'imageCheckpoint', 'A completed image could not be saved. No further image request was sent.'); } }
        } catch (error) {
          if (receipt.status !== 'succeeded') {
            if (!dispatched || error.definitiveRejected || error.falFailed) { receipt.status = 'failed'; receipt.costUsd = 0; receipt.costBasis = dispatched ? COST_BASIS : 'not-dispatched-or-rejected'; }
            else if (error.code === 'IMAGE_PNG_INVALID' || error.code === 'IMAGE_RESPONSE_INVALID' || error.code === 'FAL_RESULT_HOST' || error.code === 'FAL_RESULT_TOO_LARGE') { receipt.status = 'failed'; receipt.costUsd = estimateUsd; spent += estimateUsd; limits?.record?.(estimateUsd); }
            else receipt.status = 'unknown';
            receipt.completedAt = stamp(); receipt.errorCode = error.code || 'IMAGE_GENERATION_FAILED';
          }
          throw error;
        } finally { leave(); }
      }
      return [...images.values()].sort((a, b) => a.variantIndex - b.variantIndex);
    } catch (error) {
      const safe = String(error?.code || '').startsWith('IMAGE_') ? error : problem('IMAGE_GENERATION_FAILED', 'image', error?.message || 'fal.ai couldn’t make this picture. No request was automatically retried.');
      safe.partialImages = [...images.values()].sort((a, b) => a.variantIndex - b.variantIndex); safe.attemptReceipts = copy(attempts);
      if (!attempts.length) safe.beforeDispatch = true;
      throw safe;
    }
  }

  // One video. onRequest(receipt) is the durable checkpoint before submit; resume ({ requestId, statusUrl, responseUrl })
  // polls an earlier request instead of submitting again. Resolves { mp4, durationSeconds, receipt }.
  async function generateVideo({ model, profile = {}, price = {}, prompt, imageDataUri = '', durationSeconds, resolution, aspectRatio, sound = false, negativePrompt = '', runId, maxBudgetUsd, onRequest, onSubmitted, onProgress, resume = null, isCancelled = () => false, signal } = {}) {
    if (!ENDPOINT.test(String(model || ''))) throw problem('VIDEO_INPUT_INVALID', 'model', 'Choose a fal.ai video model.');
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 4000) throw problem('VIDEO_INPUT_INVALID', 'prompt', 'The video needs a prompt under 4,000 characters.');
    if (!Number.isInteger(durationSeconds) || durationSeconds < 1 || durationSeconds > 60) throw problem('VIDEO_INPUT_INVALID', 'durationSeconds', 'Choose a video length.');
    if (!Number.isFinite(price.unitUsd)) throw problem('VIDEO_PRICE_UNKNOWN', 'model', `fal.ai didn’t return a price for ${model}, so the studio can’t estimate it. Nothing was started.`);
    const unit = String(price.unit || 'second').toLowerCase();
    // Seconds of video, or one clip; any other unit (GPU compute seconds, say) can't be estimated from a video's length.
    const units = /^seconds?$/.test(unit) ? durationSeconds : /^(videos?|clips?)$/.test(unit) ? 1 : null;
    if (units == null) throw problem('VIDEO_PRICE_UNKNOWN', 'model', `fal.ai prices ${model} per ${price.unit}, which the studio can’t estimate. Nothing was started.`);
    const estimateUsd = Math.round(price.unitUsd * units * 100) / 100;
    if (!resume && Number.isFinite(maxBudgetUsd) && maxBudgetUsd + 1e-9 < estimateUsd) throw problem('VIDEO_ALLOWANCE', 'maxBudgetUsd', `This video needs about $${estimateUsd.toFixed(2)}, more than the $${maxBudgetUsd.toFixed(2)} left in its budget. Nothing was started.`);
    const credential = key();
    const receipt = resume?.receipt ? copy(resume.receipt) : { provider: 'fal', attemptId: randomUUID(), runId, endpoint: model, requestedModel: model, requestId: null, status: 'dispatched', unit: price.unit || 'second', unitUsd: price.unitUsd, units, estimatedCostUsd: estimateUsd, costUsd: null, costBasis: COST_BASIS, pricingAsOf: price.asOf || '', durationSeconds, resolution: resolution || '', aspectRatio: aspectRatio || '', sound: Boolean(sound), input: imageDataUri ? 'image' : 'text', promptHash: digest(prompt), startedAt: stamp() };
    if (!resume) { try { await onRequest?.(copy(receipt)); } catch (_) { throw problem('VIDEO_CHECKPOINT_FAILED', 'videoCheckpoint', 'The video request checkpoint could not be saved. Nothing was sent.'); } }
    let leave = () => {};
    try {
      const input = falInput(profile, { kind: 'video', prompt, imageDataUri, durationSeconds, resolution, aspectRatio, sound, negativePrompt });
      const done = await runRequest({ endpoint: model, input, credential, signal, isCancelled, onProgress, resume: resume?.requestId ? resume : null,
        onSubmitted: async (ids) => { receipt.requestId = ids.requestId; receipt.statusUrl = ids.statusUrl; receipt.responseUrl = ids.responseUrl; receipt.cancelUrl = ids.cancelUrl; await onSubmitted?.(copy(receipt)); } });
      leave = done.leave;
      const file = done.result?.video || done.result?.videos?.[0];
      if (!file?.url) throw problem('VIDEO_RESPONSE_INVALID', 'video', 'fal.ai finished without a video.');
      const mp4 = await download(file.url, MAX_VIDEO_BYTES, { signal });
      if (!isMp4(mp4)) throw problem('VIDEO_RESPONSE_INVALID', 'video', 'fal.ai returned a file that isn’t an MP4 video.');
      receipt.status = 'succeeded'; receipt.completedAt = stamp(); receipt.costUsd = estimateUsd; receipt.bytes = mp4.length;
      limits?.record?.(estimateUsd);
      return { mp4, durationSeconds, ...(Number.isFinite(file.width) ? { width: file.width } : {}), ...(Number.isFinite(file.height) ? { height: file.height } : {}), receipt: copy(receipt) };
    } catch (error) {
      if (receipt.status !== 'succeeded') {
        if (error.falFailed || (!receipt.requestId && error.definitiveRejected)) { receipt.status = 'failed'; receipt.costUsd = 0; }
        else if (!receipt.requestId && !error.unknown && error.code !== 'CANCELLED') { receipt.status = 'failed'; receipt.costUsd = 0; receipt.costBasis = 'not-dispatched-or-rejected'; }
        else if (error.code === 'VIDEO_RESPONSE_INVALID' || error.code === 'FAL_RESULT_HOST' || error.code === 'FAL_RESULT_TOO_LARGE') { receipt.status = 'failed'; receipt.costUsd = estimateUsd; limits?.record?.(estimateUsd); }
        else receipt.status = 'unknown';
        receipt.completedAt = stamp(); receipt.errorCode = error.code || 'VIDEO_FAILED';
      }
      error.receipt = copy(receipt);
      throw error;
    } finally { leave(); }
  }

  // Asks fal to stop a request: 202 → it may still be charged if it finishes; ALREADY_COMPLETED → keep the result.
  async function cancel({ endpoint, requestId, cancelUrl } = {}) {
    const credential = key();
    const url = queueUrl(cancelUrl, `${QUEUE}/${appOf(endpoint)}/requests/${encodeURIComponent(requestId)}/cancel`);
    const reply = await call(url, { method: 'PUT', credential });
    if (reply.status === 202 || reply.json?.status === 'CANCELLATION_REQUESTED') return { status: 'cancel-requested' };
    if (reply.status === 400 && /ALREADY_COMPLETED/i.test(JSON.stringify(reply.json || {}))) return { status: 'already-completed' };
    return { status: reply.ok ? 'cancel-requested' : 'unknown' };
  }
  function checkKey() { key(); return { configured: true }; }

  return { generateImages, generateVideo, cancel, checkKey, falInput };
}

module.exports = { createFalProvider, falInput, isMp4, appOf, DEFAULT_MEDIA_HOSTS, MAX_INLINE_REFERENCE_BYTES };
