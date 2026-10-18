import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const { createAiCatalog, mapOpenRouterModel, mapFalOpenApi, OPENROUTER_TTL_MS } = require('../src/main/ai-catalog.js');
const { json, fakeFetch } = require('./helpers/fetch-fixtures.js');

// The model catalog (src/main/ai-catalog.js): the curated list, Codex's own model list, OpenRouter's and fal.ai's live
// lists through fetch fixtures, prices and caching. No request leaves the test.
const dirs = [];
const tmp = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-catalog-')); dirs.push(dir); return dir; };
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
const NOW = Date.parse('2026-10-17T10:00:00Z');
const OR_MODELS = { data: [
  { id: 'anthropic/claude-opus-5.5', name: 'Anthropic: Claude Opus 5.5', context_length: 1000000, pricing: { prompt: '0.000004', completion: '0.00002', input_cache_read: '0.0000002' }, supported_parameters: ['structured_outputs', 'response_format', 'reasoning'], architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] }, top_provider: { max_completion_tokens: 128000 } },
  { id: 'deepseek/deepseek-v4', name: 'DeepSeek V4', context_length: 64000, pricing: { prompt: '0.0000003', completion: '0.0000012' }, supported_parameters: ['response_format'], architecture: { input_modalities: ['text'], output_modalities: ['text'] } },
  { id: 'old/retired', name: 'Retired', context_length: 8000, pricing: { prompt: '0.000001', completion: '0.000001' }, supported_parameters: [], expiration_date: '2026-09-01' },
  { id: 'image/maker', name: 'Pictures only', pricing: { prompt: '0', completion: '0' }, architecture: { output_modalities: ['image'] } },
] };
const SEEDANCE_OPENAPI = { paths: { '/bytedance/seedance-2.0/fast/text-to-video': { post: { requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Input' } } } } } } }, components: { schemas: { Input: { properties: { prompt: { type: 'string' }, duration: { type: 'string', enum: ['4', '5', '8', '10'] }, resolution: { enum: ['480p', '720p'] }, aspect_ratio: { enum: ['16:9', '9:16', '1:1'] }, generate_audio: { type: 'boolean' } } } } } };
const EDIT_OPENAPI = { paths: { '/fal-ai/nano-banana/edit': { post: { requestBody: { content: { 'application/json': { schema: { properties: { prompt: { type: 'string' }, image_urls: { type: 'array', maxItems: 10 }, output_format: { enum: ['jpeg', 'png'] }, num_images: { type: 'integer' } } } } } } } } } };

describe('live model lists', () => {
  it('maps OpenRouter models: per-token prices to per million, structured answers, reasoning, image input, retirement', () => {
    const [opus, deepseek, retired] = OR_MODELS.data.map((row) => mapOpenRouterModel(row, NOW));
    expect(opus).toMatchObject({ id: 'anthropic/claude-opus-5.5', route: 'openrouter', inputUsdPerMTok: 4, outputUsdPerMTok: 20, cacheReadUsdPerMTok: 0.2, structured: 'native', reasoning: true, efforts: ['low', 'medium', 'high'], imageInput: true, contextTokens: 1000000, maxOutputTokens: 128000 });
    expect(deepseek).toMatchObject({ structured: 'json-mode', reasoning: false, efforts: [], imageInput: false, inputUsdPerMTok: 0.3 });
    expect(retired).toMatchObject({ structured: 'prompt', deprecated: true, expiresAt: '2026-09-01T00:00:00.000Z' });
  });
  it('reads what a fal endpoint takes from its OpenAPI input: durations as strings, shapes, sound, reference images, PNG', () => {
    expect(mapFalOpenApi('bytedance/seedance-2.0/fast/text-to-video', SEEDANCE_OPENAPI, 'video')).toMatchObject({ durationType: 'string', durations: [4, 5, 8, 10], resolutions: ['480p', '720p'], aspectRatios: ['16:9', '9:16', '1:1'], sound: true, imageInput: false, input: 'text', referenceImages: 0 });
    expect(mapFalOpenApi('fal-ai/nano-banana/edit', EDIT_OPENAPI, 'image')).toMatchObject({ referenceImages: 10, referenceField: 'image_urls', imageInput: true, png: true, numImages: true });
  });
  it('caches OpenRouter’s list for six hours on disk, and says when a refresh failed', async () => {
    const dataDir = tmp(); let clock = NOW;
    const { fetchImpl, calls } = fakeFetch((call) => (calls.length === 1 ? json(OR_MODELS) : new Error('offline')));
    const catalog = createAiCatalog({ dataDir, fetchImpl, now: () => clock, codexHome: tmp() });
    const first = await catalog.openrouterModels();
    expect(first.stale).toBe(false); expect(first.models.map((row) => row.id)).toEqual(['anthropic/claude-opus-5.5', 'deepseek/deepseek-v4', 'old/retired']);
    expect(JSON.parse(fs.readFileSync(path.join(dataDir, 'ai-catalog', 'openrouter-models.json'), 'utf8')).models).toHaveLength(3);
    await catalog.openrouterModels(); expect(calls).toHaveLength(1);
    clock += OPENROUTER_TTL_MS + 1;
    const stale = await catalog.openrouterModels();
    expect(calls).toHaveLength(2); expect(stale).toMatchObject({ stale: true }); expect(stale.models).toHaveLength(3);
    // A fresh process reads the saved list without fetching.
    const again = createAiCatalog({ dataDir, fetchImpl: () => { throw new Error('no fetch'); }, now: () => NOW, codexHome: tmp() });
    expect(again.hasOpenRouterModel('deepseek/deepseek-v4')).toBe(true);
    expect(again.profile('openrouter', 'deepseek/deepseek-v4')).toMatchObject({ structured: 'json-mode' });
    // listAiModels: search, the structured filter on by default for text jobs, no retired models, paging.
    const listed = await again.list({ route: 'openrouter', kind: 'text', filters: { structured: true } });
    expect(listed.models.map((row) => row.id)).toEqual(['anthropic/claude-opus-5.5']);
    expect((await again.list({ route: 'openrouter', kind: 'text', query: 'deep' })).models.map((row) => row.id)).toEqual(['deepseek/deepseek-v4']);
    const page = await again.list({ route: 'openrouter', kind: 'text', limit: 1 });
    expect(page.nextCursor).toBe('1');
  });
  it('loads a fal model’s input schema and price once a day, and lists fal models with the curated fallbacks first', async () => {
    const dataDir = tmp();
    const { fetchImpl, calls } = fakeFetch((call) => {
      if (call.url.includes('/models/pricing')) return json({ prices: [{ endpoint_id: 'bytedance/seedance-2.0/fast/text-to-video', unit_price: 0.25, unit: 'second', currency: 'USD' }] });
      if (call.url.includes('expand=openapi-3.0')) return json({ models: [{ endpoint_id: 'bytedance/seedance-2.0/fast/text-to-video', metadata: { display_name: 'Seedance 2.0 Fast', category: 'text-to-video', status: 'active' }, openapi: SEEDANCE_OPENAPI }] });
      return json({ models: [{ endpoint_id: 'acme/new-video', metadata: { display_name: 'Acme video', category: 'text-to-video' } }], has_more: false });
    });
    const catalog = createAiCatalog({ dataDir, fetchImpl, getKey: (name) => (name === 'FAL_KEY' ? 'fal-key-0123456789' : ''), now: () => NOW, codexHome: tmp() });
    const { profile, price } = await catalog.falModel('bytedance/seedance-2.0/fast/text-to-video', { kind: 'video' });
    expect(profile).toMatchObject({ label: 'Seedance 2.0 Fast', durations: [4, 5, 8, 10], durationType: 'string' }); expect(price).toMatchObject({ unitUsd: 0.25, unit: 'second' });
    expect(calls[0].headers.Authorization).toBe('Key fal-key-0123456789');
    // The live price wins over the curated one, and the profile merges the live schema.
    expect(catalog.priceFor('fal', 'bytedance/seedance-2.0/fast/text-to-video', 'video')).toMatchObject({ basis: 'unit', unitUsd: 0.25, unit: 'second', source: 'fal', known: true });
    expect(catalog.profile('fal', 'bytedance/seedance-2.0/fast/text-to-video', 'video')).toMatchObject({ durations: [4, 5, 8, 10], label: 'Seedance 2.0 Fast' });
    const before = calls.length; await catalog.falModel('bytedance/seedance-2.0/fast/text-to-video', { kind: 'video' }); expect(calls).toHaveLength(before);
    const listed = await catalog.list({ route: 'fal', kind: 'video', filters: { category: 'text-to-video' } });
    expect(listed.models.map((row) => row.id)).toEqual([...require('../src/shared/ai-models.json').videos.map((row) => row.id), 'acme/new-video']);
  });
});

describe('prices and Codex', () => {
  it('prices every connection: Claude list prices with Haiku 5.5 tiers, Codex not metered, unknown models refused', () => {
    const catalog = createAiCatalog({ dataDir: '', fetchImpl: async () => { throw new Error('offline'); }, codexHome: tmp() });
    expect(catalog.priceFor('claude-api', 'claude-haiku-5-5')).toMatchObject({ basis: 'tokens', inputUsdPerMTok: 0.1, outputUsdPerMTok: 0.5, tiers: [{ aboveInputTokens: 100000, inputUsdPerMTok: 0.5, outputUsdPerMTok: 2.5 }], known: true });
    expect(catalog.priceFor('claude', 'claude-opus-5-5')).toMatchObject({ inputUsdPerMTok: 4, note: 'List-price equivalent; your Claude plan may cover it.' });
    expect(catalog.priceFor('codex', '')).toMatchObject({ basis: 'none', known: true });
    expect(catalog.priceFor('openrouter', 'nobody/knows')).toMatchObject({ known: false });
    expect(catalog.priceFor('openai', 'gpt-image-2.5-flare', 'image', { quality: 'high' })).toMatchObject({ basis: 'unit', unitUsd: 0.2 });
    expect(catalog.priceFor('fal', 'fal-ai/flux/dev', 'image')).toMatchObject({ basis: 'unit', unitUsd: 0.025, source: 'catalog' });
    expect(catalog.priceFor('fal', 'acme/unknown', 'image')).toMatchObject({ known: false, note: 'fal.ai didn’t return a price for acme/unknown, so the studio can’t estimate it.' });
    expect(catalog.unitsFor({ unit: 'second' }, { durationSeconds: 8 })).toBe(8);
    expect(catalog.unitsFor({ unit: 'megapixels' }, { count: 2, width: 1536, height: 1024 })).toBe(4);
    expect(catalog.unitsFor({ unit: 'tokens' })).toBeNull();
    expect(catalog.profile('claude-api', 'claude-haiku-5-5')).toMatchObject({ efforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'medium', strongReader: false });
  });
  it('reads Codex’s own model list when it has one, and copes when it doesn’t', async () => {
    const home = tmp();
    const catalog = createAiCatalog({ dataDir: '', codexHome: home, fetchImpl: async () => { throw new Error('offline'); } });
    expect(catalog.codexModels()).toEqual([expect.objectContaining({ id: '', label: 'Codex default' })]);
    fs.writeFileSync(path.join(home, 'models_cache.json'), JSON.stringify({ models: [{ slug: 'gpt-6-codex', display_name: 'GPT-6 Codex', supported_reasoning_levels: [{ effort: 'low' }, { effort: 'medium' }, { effort: 'high' }, { effort: 'ultra' }], default_reasoning_level: 'medium', context_window: 400000 }, { slug: 'hidden', visibility: 'hide' }, { nonsense: true }] }));
    expect(catalog.codexModels().map((row) => row.id)).toEqual(['', 'gpt-6-codex']);
    expect(catalog.profile('codex', 'gpt-6-codex')).toMatchObject({ efforts: ['low', 'medium', 'high', 'ultra'], defaultEffort: 'medium', contextTokens: 400000 });
    expect((await catalog.list({ route: 'codex', kind: 'text', query: 'gpt' })).models.map((row) => row.id)).toEqual(['gpt-6-codex']);
    fs.writeFileSync(path.join(home, 'models_cache.json'), '{ not json');
    expect(catalog.codexModels()).toHaveLength(1);
  });
});
