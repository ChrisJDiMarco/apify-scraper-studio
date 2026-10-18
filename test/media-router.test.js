import { describe, expect, it, vi } from 'vitest';
const { createMediaRouter } = require('../src/main/media-router.js');
const { createAiRouting } = require('../src/main/ai-routing.js');

// Every picture and video (src/main/media-router.js) goes by its task's route: OpenAI's GPT Image or fal.ai, with the
// same request contract, and each picture request lists the brand reference images it sends.
const picture = (references = []) => ({ id: 'brand-image', kind: 'image', label: 'Hero', variants: 1, size: '1536x1024', variantPrompts: ['p'], references });
function harness(routing = {}, { ready = () => true } = {}) {
  const settings = { aiRouting: { version: 1, defaults: { text: { route: 'auto', model: 'claude-opus-5-5' }, image: { route: 'openai', model: 'gpt-image-2.5-flare', quality: 'medium' }, video: { route: 'fal', model: 'bytedance/seedance-2.0/fast/text-to-video' } }, tasks: {}, ...routing } };
  const routes = createAiRouting({ getSettings: () => settings });
  const openaiImages = { generateImage: vi.fn(async () => [{ variantIndex: 0, png: Buffer.from('png'), receipt: {} }]) };
  const fal = { generateImages: vi.fn(async () => [{ variantIndex: 0, png: Buffer.from('png'), receipt: {} }]), generateVideo: vi.fn(async () => ({ mp4: Buffer.from('mp4'), receipt: {} })) };
  const catalog = { profile: vi.fn((route, model, kind) => ({ id: model, kind, referenceImages: 10, referenceField: 'image_urls' })), falModel: vi.fn(async (model) => ({ profile: { id: model, png: true, fields: ['prompt', 'image_urls'] }, price: null })), priceFor: vi.fn(() => ({ basis: 'unit', unit: 'image', unitUsd: 0.039, known: true })) };
  const connections = { problem: vi.fn((route) => (ready(route) ? '' : route === 'fal' ? 'Add a fal.ai key in Settings, AI connections. Nothing was started.' : 'Add an OpenAI key in Settings, AI connections. Nothing was started.')) };
  return { router: createMediaRouter({ routing: routes, openaiImages, fal, catalog, connections }), openaiImages, fal, catalog };
}

describe('media router', () => {
  it('sends a picture to GPT Image with the routed model and quality, or to fal.ai with its schema and price', async () => {
    const openai = harness({ tasks: { 'pictures.ask-ai': { quality: 'high' } } });
    await openai.router.generateImage({ taskId: 'pictures.ask-ai', deliverable: picture(), runId: 'r', maxBudgetUsd: 1, onRequest: async () => {} });
    expect(openai.openaiImages.generateImage).toHaveBeenCalledWith(expect.objectContaining({ deliverable: expect.objectContaining({ model: 'gpt-image-2.5-flare', quality: 'high', references: [] }), runId: 'r' }));
    const fal = harness({ defaults: { text: { route: 'auto', model: 'claude-opus-5-5' }, image: { route: 'fal', model: 'fal-ai/nano-banana/edit' }, video: { route: 'fal', model: 'bytedance/seedance-2.0/fast/text-to-video' } } });
    const refs = [{ role: 'style', mime: 'image/png', data: Buffer.from('x') }];
    await fal.router.generateImage({ taskId: 'pictures.content-image', deliverable: picture(refs), runId: 'r2', maxBudgetUsd: 1, onRequest: async () => {} });
    expect(fal.fal.generateImages).toHaveBeenCalledWith(expect.objectContaining({ model: 'fal-ai/nano-banana/edit', deliverable: expect.objectContaining({ references: refs }), profile: expect.objectContaining({ png: true, referenceImages: 10 }), price: expect.objectContaining({ unitUsd: 0.039 }) }));
    expect(fal.fal.generateImages.mock.calls[0][0].taskId).toBeUndefined();
    expect(fal.openaiImages.generateImage).not.toHaveBeenCalled();
  });
  it('refuses a picture request that doesn’t list its reference images, or a job that can’t run, before anything is sent', async () => {
    const h = harness();
    await expect(h.router.generateImage({ taskId: 'pictures.kit-image', deliverable: { ...picture(), references: undefined } })).rejects.toMatchObject({ code: 'IMAGE_INPUT_INVALID', field: 'deliverable.references', beforeDispatch: true });
    const broken = harness({ tasks: { 'pictures.kit-image': { model: 'fal-ai/flux/dev' } } });
    await expect(broken.router.generateImage({ taskId: 'pictures.kit-image', deliverable: picture() })).rejects.toMatchObject({ code: 'IMAGE_ROUTING', message: expect.stringContaining('Nothing was started.') });
    expect(h.openaiImages.generateImage).not.toHaveBeenCalled(); expect(broken.openaiImages.generateImage).not.toHaveBeenCalled();
  });
  it('makes a video on fal.ai with the routed length, shape and sound', async () => {
    const h = harness({ tasks: { 'video.social-clip': { durationSeconds: 10, aspectRatio: '1:1', sound: true } } });
    await h.router.generateVideo({ taskId: 'video.social-clip', prompt: 'A calm push-in', runId: 'r', maxBudgetUsd: 3 });
    expect(h.fal.generateVideo).toHaveBeenCalledWith(expect.objectContaining({ model: 'bytedance/seedance-2.0/fast/text-to-video', durationSeconds: 10, aspectRatio: '1:1', resolution: '720p', sound: true, prompt: 'A calm push-in' }));
    await expect(h.router.generateVideo({ taskId: 'pictures.kit-image', prompt: 'p' })).rejects.toMatchObject({ code: 'VIDEO_INPUT_INVALID' });
  });
  it('says whether pictures and videos can be made here, and what to do when they can’t', () => {
    const ready = harness();
    expect(ready.router.ready('pictures.ask-ai')).toBe(true); expect(ready.router.problem('video.social-clip')).toBe('');
    const noKeys = harness({}, { ready: () => false });
    expect(noKeys.router.ready('pictures.ask-ai')).toBe(false);
    expect(noKeys.router.problem('pictures.ask-ai')).toBe('Add an OpenAI key in Settings, AI connections.');
    expect(noKeys.router.problem('video.social-clip')).toBe('Connect fal.ai in Settings, AI connections to make videos.');
  });
});
