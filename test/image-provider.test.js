import { describe, expect, it, vi } from 'vitest';
import { deflateSync } from 'node:zlib';
import images from '../src/main/image-provider.js';
const { createImageProvider, validatePng, MODEL, MAX_RESPONSE_BYTES } = images;
const digestUsage = { input_tokens: 1000, input_tokens_details: { text_tokens: 1000, image_tokens: 0 }, output_tokens: 4096, total_tokens: 5096 };
function crc32(buffer) { let crc = -1; for (const byte of buffer) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); } return (crc ^ -1) >>> 0; }
function chunk(type, data) { const name = Buffer.from(type); const length = Buffer.alloc(4); length.writeUInt32BE(data.length); const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([name, data]))); return Buffer.concat([length, name, data, checksum]); }
function png(width = 1536, height = 1024, { truncatedPixels = false, invalidFilter = false, compressed } = {}) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 1; header[9] = 0;
  const pixels = Buffer.alloc((Math.ceil(width / 8) + 1) * height - (truncatedPixels ? 1 : 0)); if (invalidFilter) pixels[0] = 7;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', compressed || deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
const IMAGE = png();
function response({ bytes = IMAGE, usage = digestUsage, data, ...rest } = {}) { return new Response(JSON.stringify({ data: data || [{ b64_json: bytes.toString('base64') }], usage, output_format: 'png', ...rest }), { headers: { 'x-request-id': 'req_fixture_123', 'content-type': 'application/json' } }); }
function request(variants = 3, extra = {}) { return { runId: 'fixture-run', deliverable: { id: 'brand-image', label: 'Fixture visual', kind: 'image', variants, size: '1536x1024', variantPrompts: Array.from({ length: variants }, (_, i) => `Original fixture direction ${i + 1}`) }, maxBudgetUsd: 1, onRequest: async () => {}, ...extra }; }
async function failed(promise) { try { await promise; throw new Error('Expected fixture operation to fail'); } catch (error) { return error; } }
function adapter(fetchImpl, extra = {}) { return createImageProvider({ getApiKey: () => 'fixture-private-key', fetchImpl, ...extra }); }

describe('OpenAI images host adapter', () => {
  it('dispatches distinct directions sequentially after durable checkpoints and returns real validated PNGs', async () => {
    const events = []; let fetching = false;
    const provider = adapter(async (url, options) => {
      expect(fetching).toBe(false); fetching = true; expect(events.at(-1).status).toBe('dispatched');
      const body = JSON.parse(options.body); expect(url).toBe('https://api.openai.com/v1/images/generations'); expect(options.redirect).toBe('error'); expect(options.headers.Authorization).toBe('Bearer fixture-private-key');
      expect(body).toMatchObject({ model: MODEL, n: 1, size: '1536x1024', quality: 'medium', output_format: 'png', background: 'opaque', moderation: 'auto' }); expect(body.response_format).toBeUndefined();
      expect(body.prompt).toBe(`Original fixture direction ${events.filter(e => e.status === 'dispatched').length}`); await Promise.resolve(); fetching = false; return response();
    });
    const result = await provider.generateImage(request(3, { onRequest: async receipt => { events.push(receipt); }, onVariant: async image => { events.push(image.receipt); } }));
    expect(result).toHaveLength(3); expect(events.map(event => event.status)).toEqual(['dispatched', 'succeeded', 'dispatched', 'succeeded', 'dispatched', 'succeeded']);
    for (const image of result) { expect(image.png.equals(IMAGE)).toBe(true); expect(image.receipt).toMatchObject({ provider: 'openai', requestedModel: MODEL, requestId: 'req_fixture_123', status: 'succeeded', billable: true, costUsd: 0.12788, costBasis: 'usage-estimate', budgetKind: 'dispatch-allowance', returnedModel: null }); expect(image.receipt.budgetNotice).toContain('not the final provider charge'); }
    expect(JSON.stringify(result.map(image => image.receipt))).not.toContain('fixture-private-key');
  });
  it('preserves completed bytes on a later ambiguous failure and never retries a paid request', async () => {
    const fetchImpl = vi.fn(async () => { if (fetchImpl.mock.calls.length === 2) throw new Error('private provider URL with fixture-private-key'); return response(); });
    const error = await failed(adapter(fetchImpl).generateImage(request()));
    expect(fetchImpl).toHaveBeenCalledTimes(2); expect(error.code).toBe('IMAGE_NETWORK_ERROR'); expect(error.partialImages).toHaveLength(1); expect(error.partialImages[0].png.equals(IMAGE)).toBe(true);
    expect(error.attemptReceipts.map(receipt => receipt.status)).toEqual(['succeeded', 'unknown']); expect(error.attemptReceipts[1]).toMatchObject({ billable: null, costUsd: null, variantIndex: 1 }); expect(error.message).not.toContain('fixture-private-key');
  });
  it('resumes only missing variants and rejects reuse when prompt or dimensions changed', async () => {
    let saved; const firstFetch = vi.fn(async () => { if (firstFetch.mock.calls.length === 2) return new Response('', { status: 403 }); return response(); });
    const first = await failed(adapter(firstFetch).generateImage(request())); saved = first.partialImages;
    const resumedFetch = vi.fn(async () => response()); const provider = adapter(resumedFetch);
    const resumed = await provider.generateImage(request(3, { maxBudgetUsd: 0.5, completedVariants: saved })); expect(resumed).toHaveLength(3); expect(resumedFetch).toHaveBeenCalledTimes(2); expect(JSON.parse(resumedFetch.mock.calls[0][1].body).prompt).toBe('Original fixture direction 2');
    const changed = request(3, { completedVariants: saved }); changed.deliverable.variantPrompts[0] = 'Different brief'; await expect(provider.generateImage(changed)).rejects.toMatchObject({ beforeDispatch: true, field: 'completedVariants' });
    const broken = [{ ...saved[0], png: png(1024, 1024) }]; await expect(provider.generateImage(request(3, { completedVariants: broken }))).rejects.toMatchObject({ beforeDispatch: true, code: 'IMAGE_DIMENSIONS_MISMATCH' });
    expect(resumedFetch).toHaveBeenCalledTimes(2);
  });
  it('returns already completed variants without reading credentials or spending another allowance', async () => {
    const saved = await adapter(async () => response()).generateImage(request(1));
    const fetchImpl = vi.fn(); const getApiKey = vi.fn(() => { throw new Error('Must not load credentials'); });
    const provider = createImageProvider({ getApiKey, fetchImpl }); const result = await provider.generateImage(request(1, { maxBudgetUsd: 0, completedVariants: saved }));
    expect(result[0].receipt).toEqual(saved[0].receipt); expect(result[0].png.equals(saved[0].png)).toBe(true); expect(fetchImpl).not.toHaveBeenCalled(); expect(getApiKey).not.toHaveBeenCalled();
  });
  it('requires reasonable allowances and complete bounded prompts before making any call', async () => {
    const fetchImpl = vi.fn(async () => response()); const provider = adapter(fetchImpl);
    for (const payload of [request(3, { maxBudgetUsd: 0.74 }), request(1, { onRequest: undefined }), request(1, { maxBudgetUsd: -1 })]) await expect(provider.generateImage(payload)).rejects.toMatchObject({ beforeDispatch: true });
    const tooLong = request(); tooLong.deliverable.variantPrompts[2] = 'x'.repeat(32001); await expect(provider.generateImage(tooLong)).rejects.toMatchObject({ beforeDispatch: true, field: 'deliverable.variantPrompts' });
    const mismatch = request(); mismatch.deliverable.variantPrompts.pop(); await expect(provider.generateImage(mismatch)).rejects.toMatchObject({ beforeDispatch: true }); expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('stops later variants when a completed request consumes the allowance without claiming a hard provider cap', async () => {
    const expensive = { input_tokens: 0, input_tokens_details: { text_tokens: 0, image_tokens: 0 }, output_tokens: 30000, total_tokens: 30000 };
    const fetchImpl = vi.fn(async () => response({ usage: expensive })); const error = await failed(adapter(fetchImpl).generateImage(request(3, { maxBudgetUsd: 0.75 })));
    expect(fetchImpl).toHaveBeenCalledOnce(); expect(error.code).toBe('IMAGE_ALLOWANCE_EXHAUSTED'); expect(error.partialImages[0].receipt.costUsd).toBe(0.9); expect(error.attemptReceipts[0].allowanceUsd).toBe(0.25);
  });
  it('keeps missing, inconsistent, and invalid usage unknown rather than treating it as free', async () => {
    for (const usage of [null, { output_tokens: 30 }, { ...digestUsage, total_tokens: 9 }, { ...digestUsage, input_tokens: '1000' }, { ...digestUsage, output_tokens: 0 }]) {
      const fetchImpl = vi.fn(async () => response({ usage })); const provider = adapter(fetchImpl); const error = await failed(provider.generateImage(request()));
      expect(error.code).toBe('IMAGE_USAGE_UNKNOWN'); expect(fetchImpl).toHaveBeenCalledOnce(); expect(error.partialImages[0].receipt).toMatchObject({ status: 'succeeded', billable: true, costUsd: null });
      const last = await provider.generateImage(request(1)); expect(last[0].receipt.costUsd).toBeNull();
    }
  });
  it('stops before a paid call when checkpointing fails, and preserves the image when its saving callback fails', async () => {
    const fetchImpl = vi.fn(async () => response()); const provider = adapter(fetchImpl);
    const early = await failed(provider.generateImage(request(1, { onRequest: async () => { throw new Error('storage secret'); } })));
    expect(fetchImpl).not.toHaveBeenCalled(); expect(early.code).toBe('IMAGE_CHECKPOINT_FAILED'); expect(early.attemptReceipts[0]).toMatchObject({ status: 'failed', billable: false, costUsd: 0 });
    const late = await failed(provider.generateImage(request(3, { onVariant: async () => { throw new Error('storage secret'); } })));
    expect(fetchImpl).toHaveBeenCalledOnce(); expect(late.partialImages).toHaveLength(1); expect(late.attemptReceipts[0].status).toBe('succeeded'); expect(late.message).not.toContain('storage secret');
  });
  it('aborts a pending request and records ambiguous spend, with no additional dispatch', async () => {
    const controller = new AbortController(); let begin;
    const started = new Promise(resolve => { begin = resolve; }); const fetchImpl = vi.fn(async (_url, options) => new Promise((_resolve, reject) => { begin(); options.signal.addEventListener('abort', () => reject(new Error('aborted private detail'))); }));
    const running = adapter(fetchImpl).generateImage(request(3, { signal: controller.signal })); await started; controller.abort(); const error = await failed(running);
    expect(error.code).toBe('IMAGE_CANCELLED'); expect(error.attemptReceipts[0].status).toBe('unknown'); expect(fetchImpl).toHaveBeenCalledOnce();
    await expect(adapter(fetchImpl).generateImage(request(1, { signal: controller.signal }))).rejects.toMatchObject({ beforeDispatch: true }); expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it('honors host cancellation polling and timeouts without retrying', async () => {
    for (const cancellation of [true, false]) {
      let cancelled = false; const fetchImpl = vi.fn(async (_url, options) => new Promise((_resolve, reject) => { if (cancellation) cancelled = true; options.signal.addEventListener('abort', () => reject(new Error('transport detail'))); }));
      const error = await failed(adapter(fetchImpl, { timeoutMs: cancellation ? 500 : 10 }).generateImage(request(1, { isCancelled: () => cancelled })));
      expect(error.code).toBe(cancellation ? 'IMAGE_CANCELLED' : 'IMAGE_TIMEOUT'); expect(error.attemptReceipts[0].status).toBe('unknown'); expect(fetchImpl).toHaveBeenCalledOnce();
    }
  });
  it('distinguishes rejected HTTP requests from ambiguous server failures and redacts provider errors', async () => {
    for (const status of [400, 401, 403, 408, 429, 500, 503]) {
      const fetchImpl = vi.fn(async () => new Response('fixture-private-key private-provider-body', { status })); const error = await failed(adapter(fetchImpl).generateImage(request(1)));
      expect(fetchImpl).toHaveBeenCalledOnce(); expect(error.code).toBe('IMAGE_HTTP_ERROR'); expect(error.attemptReceipts[0].status).toBe(status < 500 && status !== 408 ? 'failed' : 'unknown'); expect(error.attemptReceipts[0].costUsd).toBe(status < 500 && status !== 408 ? 0 : null); expect(error.message).not.toMatch(/private-provider-body|fixture-private-key/);
    }
  });
  it('rejects fake, corrupted, truncated, wrong-size, and decompression-invalid PNGs', async () => {
    const corrupt = Buffer.from(IMAGE); corrupt[corrupt.length - 5] ^= 1;
    for (const bytes of [Buffer.from('not an image'), Buffer.concat([IMAGE.subarray(0, 8), Buffer.alloc(80)]), corrupt, IMAGE.subarray(0, IMAGE.length - 12), png(1024, 1024), png(1536, 1024, { truncatedPixels: true }), png(1536, 1024, { invalidFilter: true }), png(1536, 1024, { compressed: Buffer.from('not deflate') })]) {
      const error = await failed(adapter(async () => response({ bytes })).generateImage(request(1)));
      expect(error.partialImages).toEqual([]); expect(error.attemptReceipts[0]).toMatchObject({ status: 'failed', billable: true, costUsd: 0.12788 });
    }
    expect(validatePng(IMAGE)).toMatchObject({ width: 1536, height: 1024 });
  });
  it('rejects malformed base64, multiple images, unexpected models, and oversized response bodies', async () => {
    for (const makeResponse of [
      () => response({ data: [{ b64_json: 'https://private.invalid/image' }] }),
      () => response({ data: [{ b64_json: IMAGE.toString('base64') }, { b64_json: IMAGE.toString('base64') }] }),
      () => response({ model: 'unapproved-model' }),
      () => new Response('{}', { headers: { 'content-length': String(MAX_RESPONSE_BYTES + 1) } }),
      () => new Response('bad json'),
      () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(MAX_RESPONSE_BYTES + 1)); controller.close(); } })),
    ]) {
      const fetchImpl = vi.fn(async () => makeResponse()); const error = await failed(adapter(fetchImpl).generateImage(request(1))); expect(error.partialImages).toHaveLength(0); expect(fetchImpl).toHaveBeenCalledOnce();
    }
  });
  it('checks model access with a fixed read-only GET without claiming generation verification', async () => {
    const fetchImpl = vi.fn(async (url, options) => { expect(url).toBe(`https://api.openai.com/v1/models/${MODEL}`); expect(options.method).toBe('GET'); expect(options.redirect).toBe('error'); return new Response(JSON.stringify({ id: MODEL, private_metadata: 'do not expose' })); });
    const result = await adapter(fetchImpl).checkAccess(); expect(result).toMatchObject({ accessible: true, requestedModel: MODEL, generationVerified: false }); expect(JSON.stringify(result)).not.toContain('do not expose'); expect(fetchImpl).toHaveBeenCalledOnce();
    await expect(adapter(async () => new Response(JSON.stringify({ id: 'wrong' }))).checkAccess()).rejects.toMatchObject({ code: 'IMAGE_ACCESS_UNVERIFIED' });
  });
  it('treats credential failures as pre-dispatch and prevents same-job concurrency', async () => {
    const never = vi.fn(); const missing = createImageProvider({ getApiKey: () => { throw new Error('fixture-private-key'); }, fetchImpl: never }); const error = await failed(missing.generateImage(request(1))); expect(error).toMatchObject({ beforeDispatch: true, code: 'IMAGE_AUTH_REQUIRED' }); expect(error.message).not.toContain('fixture-private-key'); expect(never).not.toHaveBeenCalled();
    let release; let start; const entered = new Promise(resolve => { start = resolve; }); const wait = new Promise(resolve => { release = resolve; });
    const provider = adapter(async () => { start(); await wait; return response(); }); const running = provider.generateImage(request(1)); await entered;
    await expect(provider.generateImage(request(1))).rejects.toMatchObject({ code: 'IMAGE_JOB_BUSY', beforeDispatch: true }); release(); expect(await running).toHaveLength(1);
  });
});
