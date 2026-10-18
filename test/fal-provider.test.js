import { describe, expect, it, vi } from 'vitest';
import { picture } from './helpers/pictures.js';
const { createFalProvider, falInput, appOf, MAX_INLINE_REFERENCE_BYTES } = require('../src/main/fal-provider.js');
const { json, bytes, fakeFetch } = require('./helpers/fetch-fixtures.js');

// fal.ai pictures and videos through its queue (src/main/fal-provider.js), with fetch fixtures and a fake clock: submit,
// poll until COMPLETED, read the result, download only from fal's media hosts. No request leaves the test.
const KEY = 'fal-key-0123456789abcdef:secret';
const PNG = picture(64, 48, 7);
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(64, 1)]);
const EDIT = { fields: ['prompt', 'image_urls', 'num_images', 'output_format', 'aspect_ratio'], referenceImages: 10, referenceField: 'image_urls', png: true, aspectRatios: ['3:2', '1:1', '2:3'] };
const FLUX = { fields: ['prompt', 'image_size', 'num_images', 'output_format'], referenceImages: 0, referenceField: '', png: true, imageSizes: ['landscape_4_3', 'square_hd', 'portrait_4_3'] };
const SEEDANCE = { fields: ['prompt', 'duration', 'resolution', 'aspect_ratio', 'generate_audio'], durationType: 'string' };
const queue = (app, id) => ({ request_id: id, status_url: `https://queue.fal.run/${app}/requests/${id}/status`, response_url: `https://queue.fal.run/${app}/requests/${id}`, cancel_url: `https://queue.fal.run/${app}/requests/${id}/cancel` });
// A clock that moves 2.5 s per poll, so the polling rhythm is visible without waiting.
function provider(handler, options = {}) {
  let clock = 0; const sleeps = [];
  const { fetchImpl, calls } = fakeFetch(handler);
  const fal = createFalProvider({ getKey: () => KEY, fetchImpl, clock: () => clock, sleep: async (ms) => { sleeps.push(ms); clock += ms; }, ...options });
  return { fal, calls, sleeps };
}
const deliverable = (references = [], extra = {}) => ({ id: 'brand-image', kind: 'image', label: 'Hero', variants: 1, size: '1536x1024', variantPrompts: ['A calm hero picture'], references, ...extra });
const style = (shade) => ({ role: 'style', mime: 'image/png', data: picture(32, 32, shade) });

describe('fal.ai inputs', () => {
  it('maps a request to each endpoint’s own field names and types', () => {
    expect(falInput(SEEDANCE, { kind: 'video', prompt: 'p', durationSeconds: 8, resolution: '720p', aspectRatio: '9:16', sound: false })).toEqual({ prompt: 'p', duration: '8', resolution: '720p', aspect_ratio: '9:16', generate_audio: false });
    expect(falInput(FLUX, { kind: 'image', prompt: 'p', size: '1024x1536' })).toEqual({ prompt: 'p', image_size: 'portrait_4_3', num_images: 1, output_format: 'png' });
    expect(falInput(EDIT, { kind: 'image', prompt: 'p', size: '1536x1024', referenceDataUris: ['data:image/png;base64,AAAA'] })).toEqual({ prompt: 'p', aspect_ratio: '3:2', num_images: 1, output_format: 'png', image_urls: ['data:image/png;base64,AAAA'] });
    expect(appOf('bytedance/seedance-2.0/fast/text-to-video')).toBe('bytedance/seedance-2.0');
  });
});

describe('fal.ai pictures', () => {
  it('submits, polls with the queue position, downloads from fal’s media host and records the unit price, with reference images inline', async () => {
    const states = [{ status: 'IN_QUEUE', queue_position: 2 }, { status: 'IN_PROGRESS' }, { status: 'COMPLETED' }]; const order = [];
    const h = provider((call) => {
      if (call.method === 'POST') { order.push('submit'); return json(queue('fal-ai/nano-banana', 'req-1')); }
      if (call.url.includes('/status')) return json(states.shift(), { status: 202 });
      if (call.url.startsWith('https://queue.fal.run/fal-ai/nano-banana/requests/req-1')) return json({ images: [{ url: 'https://v3.fal.media/files/abc/out.png', width: 64, height: 48 }] });
      if (call.url === 'https://v3.fal.media/files/abc/out.png') return bytes(PNG);
      throw new Error(call.url);
    });
    const onRequest = vi.fn(() => { order.push('checkpoint'); }); const onVariant = vi.fn();
    const refs = [style(1), style(2), { role: 'logo', mime: 'image/png', data: picture(20, 10, 3) }];
    const [image] = await h.fal.generateImages({ deliverable: deliverable(refs), model: 'fal-ai/nano-banana/edit', profile: EDIT, price: { unitUsd: 0.039, unit: 'image', asOf: '2026-10-17' }, runId: 'run-1', maxBudgetUsd: 1, onRequest, onVariant });
    const submit = h.calls.find((call) => call.method === 'POST');
    expect(submit.url).toBe('https://queue.fal.run/fal-ai/nano-banana/edit'); expect(submit.headers.Authorization).toBe(`Key ${KEY}`);
    expect(submit.json.image_urls).toHaveLength(3); expect(submit.json.image_urls[0]).toMatch(/^data:image\/png;base64,/); expect(submit.json.output_format).toBe('png');
    expect(onRequest).toHaveBeenCalledWith(expect.objectContaining({ provider: 'fal', status: 'dispatched', estimatedCostUsd: 0.039, references: [expect.objectContaining({ role: 'style' }), expect.objectContaining({ role: 'style' }), expect.objectContaining({ role: 'logo' })] }));
    expect(order).toEqual(['checkpoint', 'submit']); // the durable checkpoint is saved before the paid request
    expect(image.png.equals(PNG)).toBe(true); expect(onVariant).toHaveBeenCalledOnce();
    expect(image.receipt).toMatchObject({ status: 'succeeded', requestId: 'req-1', costUsd: 0.039, unitUsd: 0.039, units: 1, width: 64, height: 48, costBasis: 'fal unit price (fal charges only successful outputs)' });
    expect(h.sleeps).toEqual([2500, 2500]);
  });
  it('makes pictures without references on a model that can’t take them, and says so', async () => {
    const h = provider((call) => (call.method === 'POST' ? json(queue('fal-ai/flux', 'req-2')) : call.url.includes('/status') ? json({ status: 'COMPLETED' }) : call.url.includes('fal.media') ? bytes(PNG) : json({ images: [{ url: 'https://fal.media/files/out.png' }] })));
    const [image] = await h.fal.generateImages({ deliverable: deliverable([style(1)]), model: 'fal-ai/flux/dev', profile: FLUX, price: { unitUsd: 0.025, unit: 'image' }, runId: 'run-2', maxBudgetUsd: 1, onRequest: async () => {} });
    expect(h.calls[0].json.image_urls).toBeUndefined(); expect(image.receipt.referencesOmitted).toBe(true);
  });
  it('refuses before anything is sent: no reference list, oversized references, unknown price, no PNG', async () => {
    const never = vi.fn(); const { fal } = provider(never);
    const ask = (extra) => fal.generateImages({ deliverable: deliverable([]), model: 'fal-ai/nano-banana/edit', profile: EDIT, price: { unitUsd: 0.039, unit: 'image' }, runId: 'r', maxBudgetUsd: 1, onRequest: async () => {}, ...extra });
    await expect(ask({ deliverable: deliverable(undefined, { references: undefined }) })).rejects.toMatchObject({ code: 'IMAGE_INPUT_INVALID', field: 'deliverable.references', beforeDispatch: true });
    const huge = { role: 'style', mime: 'image/png', data: Buffer.alloc(Math.ceil(MAX_INLINE_REFERENCE_BYTES * 0.8)) };
    await expect(ask({ deliverable: deliverable([huge, huge]) })).rejects.toMatchObject({ code: 'IMAGE_INPUT_INVALID', beforeDispatch: true, message: expect.stringContaining('too large to send to fal.ai together') });
    await expect(ask({ price: {} })).rejects.toMatchObject({ code: 'IMAGE_PRICE_UNKNOWN', beforeDispatch: true });
    await expect(ask({ profile: { ...EDIT, png: false } })).rejects.toMatchObject({ code: 'IMAGE_INPUT_INVALID', message: expect.stringContaining('can’t return PNG') });
    expect(never).not.toHaveBeenCalled();
  });
  it('costs nothing when fal reports a failure, and refuses a file outside fal’s media hosts (which was billed)', async () => {
    const failed = provider((call) => (call.method === 'POST' ? json(queue('fal-ai/nano-banana', 'req-3')) : json({ status: 'COMPLETED', error: 'NSFW content detected' })));
    const error = await failed.fal.generateImages({ deliverable: deliverable([]), model: 'fal-ai/nano-banana/edit', profile: EDIT, price: { unitUsd: 0.039, unit: 'image' }, runId: 'r', maxBudgetUsd: 1, onRequest: async () => {} }).catch((caught) => caught);
    expect(error.attemptReceipts[0]).toMatchObject({ status: 'failed', costUsd: 0, requestId: 'req-3' }); expect(error.message).toContain('NSFW content detected');
    const elsewhere = provider((call) => (call.method === 'POST' ? json(queue('fal-ai/nano-banana', 'req-4')) : call.url.includes('/status') ? json({ status: 'COMPLETED' }) : json({ images: [{ url: 'https://evil.example.com/out.png' }] })));
    const refused = await elsewhere.fal.generateImages({ deliverable: deliverable([]), model: 'fal-ai/nano-banana/edit', profile: EDIT, price: { unitUsd: 0.039, unit: 'image' }, runId: 'r', maxBudgetUsd: 1, onRequest: async () => {} }).catch((caught) => caught);
    expect(refused.message).toContain('evil.example.com, which isn’t one of its media hosts'); expect(refused.attemptReceipts[0]).toMatchObject({ status: 'failed', costUsd: 0.039 });
    expect(elsewhere.calls.some((call) => call.url.includes('evil.example.com'))).toBe(false);
  });
});

describe('fal.ai videos', () => {
  it('checkpoints before submitting, reports progress, checks the MP4 and costs unit price × seconds', async () => {
    const states = [{ status: 'IN_QUEUE', queue_position: 3 }, { status: 'IN_PROGRESS' }, { status: 'IN_PROGRESS' }, { status: 'COMPLETED' }];
    const h = provider((call) => {
      if (call.method === 'POST') return json(queue('bytedance/seedance-2.0', 'vid-1'));
      if (call.url.includes('/status')) return json(states.shift(), { status: 202 });
      if (call.url.includes('fal.media')) return bytes(MP4);
      return json({ video: { url: 'https://v3.fal.media/files/clip.mp4' } });
    });
    const order = []; const progress = [];
    const done = await h.fal.generateVideo({ model: 'bytedance/seedance-2.0/fast/text-to-video', profile: SEEDANCE, price: { unitUsd: 0.2419, unit: 'second' }, prompt: 'A slow push-in on a search box', durationSeconds: 8, resolution: '720p', aspectRatio: '9:16', runId: 'run-v', maxBudgetUsd: 3,
      onRequest: async (receipt) => { order.push(['checkpoint', receipt.requestId]); }, onSubmitted: async (receipt) => { order.push(['submitted', receipt.requestId]); }, onProgress: (event) => progress.push(event) });
    expect(order).toEqual([['checkpoint', null], ['submitted', 'vid-1']]);
    expect(h.calls[0].json).toEqual({ prompt: 'A slow push-in on a search box', duration: '8', resolution: '720p', aspect_ratio: '9:16', generate_audio: false });
    expect(progress[0]).toMatchObject({ status: 'IN_QUEUE', queuePosition: 3 }); expect(progress.at(-1)).toMatchObject({ status: 'COMPLETED' });
    expect(done.mp4.equals(MP4)).toBe(true);
    expect(done.receipt).toMatchObject({ status: 'succeeded', requestId: 'vid-1', units: 8, estimatedCostUsd: 1.94, costUsd: 1.94, durationSeconds: 8 });
  });
  it('resumes an earlier request by its id without submitting again, and an unknown request blocks a repeat', async () => {
    const resumed = provider((call) => (call.url.includes('/status') ? json({ status: 'COMPLETED' }) : call.url.includes('fal.media') ? bytes(MP4) : json({ video: { url: 'https://fal.media/clip.mp4' } })));
    const receipt = { provider: 'fal', attemptId: 'a-1', requestId: 'vid-2', status: 'dispatched', units: 8, estimatedCostUsd: 1.94 };
    const done = await resumed.fal.generateVideo({ model: 'bytedance/seedance-2.0/fast/text-to-video', profile: SEEDANCE, price: { unitUsd: 0.2419, unit: 'second' }, prompt: 'p', durationSeconds: 8, resume: { requestId: 'vid-2', statusUrl: 'https://queue.fal.run/bytedance/seedance-2.0/requests/vid-2/status', responseUrl: 'https://queue.fal.run/bytedance/seedance-2.0/requests/vid-2', receipt } });
    expect(resumed.calls.some((call) => call.method === 'POST')).toBe(false); expect(done.receipt).toMatchObject({ attemptId: 'a-1', status: 'succeeded', costUsd: 1.94 });
    const lost = provider(() => json({ detail: 'Request not found' }, { status: 404 }));
    const error = await lost.fal.generateVideo({ model: 'bytedance/seedance-2.0/fast/text-to-video', profile: SEEDANCE, price: { unitUsd: 0.2419, unit: 'second' }, prompt: 'p', durationSeconds: 8, resume: { requestId: 'vid-3', statusUrl: 'https://queue.fal.run/bytedance/seedance-2.0/requests/vid-3/status', responseUrl: 'https://queue.fal.run/bytedance/seedance-2.0/requests/vid-3', receipt: { ...receipt, requestId: 'vid-3' } } }).catch((caught) => caught);
    expect(error).toMatchObject({ code: 'FAL_REQUEST_UNKNOWN' }); expect(error.receipt).toMatchObject({ status: 'unknown' });
  });
  it('refuses a video over its budget or with a price unit it can’t estimate, before anything is sent, and rejects a non-MP4', async () => {
    const never = vi.fn(); const { fal } = provider(never);
    await expect(fal.generateVideo({ model: 'bytedance/seedance-2.0/fast/text-to-video', profile: SEEDANCE, price: { unitUsd: 0.2419, unit: 'second' }, prompt: 'p', durationSeconds: 8, maxBudgetUsd: 1, onRequest: async () => {} })).rejects.toMatchObject({ code: 'VIDEO_ALLOWANCE' });
    await expect(fal.generateVideo({ model: 'bytedance/seedance-2.0/fast/text-to-video', profile: SEEDANCE, price: { unitUsd: 0.01, unit: 'compute seconds' }, prompt: 'p', durationSeconds: 8, onRequest: async () => {} })).rejects.toMatchObject({ code: 'VIDEO_PRICE_UNKNOWN' });
    expect(never).not.toHaveBeenCalled();
    const notMp4 = provider((call) => (call.method === 'POST' ? json(queue('bytedance/seedance-2.0', 'vid-4')) : call.url.includes('/status') ? json({ status: 'COMPLETED' }) : call.url.includes('fal.media') ? bytes(Buffer.from('<html>nope</html>')) : json({ video: { url: 'https://fal.media/clip.mp4' } })));
    const error = await notMp4.fal.generateVideo({ model: 'bytedance/seedance-2.0/fast/text-to-video', profile: SEEDANCE, price: { unitUsd: 0.2419, unit: 'second' }, prompt: 'p', durationSeconds: 8, onRequest: async () => {} }).catch((caught) => caught);
    expect(error).toMatchObject({ code: 'VIDEO_RESPONSE_INVALID' }); expect(error.receipt).toMatchObject({ status: 'failed', costUsd: 1.94 });
  });
  it('asks fal to stop a request, keeping a result that already finished', async () => {
    const h = provider([json({ status: 'CANCELLATION_REQUESTED' }, { status: 202 }), json({ status: 'ALREADY_COMPLETED' }, { status: 400 })]);
    expect(await h.fal.cancel({ endpoint: 'bytedance/seedance-2.0/fast/text-to-video', requestId: 'vid-5' })).toEqual({ status: 'cancel-requested' });
    expect(h.calls[0]).toMatchObject({ method: 'PUT', url: 'https://queue.fal.run/bytedance/seedance-2.0/requests/vid-5/cancel' });
    expect(await h.fal.cancel({ endpoint: 'bytedance/seedance-2.0/fast/text-to-video', requestId: 'vid-6' })).toEqual({ status: 'already-completed' });
  });
});
