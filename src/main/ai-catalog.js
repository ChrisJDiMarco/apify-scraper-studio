'use strict';
// Model lists, capabilities and prices for every connection (Settings → Model routing, estimates and preflight).
// Sources: the curated src/shared/ai-models.json (Claude, OpenAI pictures, fallback fal models), Codex's own model list
// ($CODEX_HOME/models_cache.json, read best-effort), OpenRouter's public model list (cached 6 h in
// <data>/ai-catalog/openrouter-models.json) and fal.ai's model and pricing APIs (cached 24 h in <data>/ai-catalog/fal.json).
// priceFor and profile are synchronous and read only what is cached; refresh/list/falModel fetch. Electron-free.
const fs = require('fs');
const os = require('os');
const path = require('path');
const MODELS = require('../shared/ai-models.json');
const { fetchJson } = require('./ai-http');

const OPENROUTER_API = 'https://openrouter.ai/api/v1';
const FAL_PLATFORM_API = 'https://api.fal.ai/v1';
const OPENROUTER_TTL_MS = 6 * 60 * 60 * 1000;
const FAL_TTL_MS = 24 * 60 * 60 * 1000;
const CLAUDE_ROUTES = new Set(['auto', 'claude', 'claude-api']);
const FAL_CATEGORIES = { image: ['text-to-image', 'image-to-image'], video: ['text-to-video', 'image-to-video'] };
const perMTok = (value) => { const number = Number(value); return Number.isFinite(number) && number >= 0 ? Math.round(number * 1e6 * 1e6) / 1e6 : null; };
const copy = (value) => (value == null ? value : JSON.parse(JSON.stringify(value)));

// OpenRouter /models row → the studio's model shape.
function mapOpenRouterModel(row, nowMs = Date.now()) {
  if (!row || typeof row.id !== 'string') return null;
  const params = Array.isArray(row.supported_parameters) ? row.supported_parameters : [];
  const inputs = Array.isArray(row.architecture?.input_modalities) ? row.architecture.input_modalities : [];
  const outputs = Array.isArray(row.architecture?.output_modalities) ? row.architecture.output_modalities : ['text'];
  const expires = row.expiration_date ? Date.parse(row.expiration_date) : NaN;
  return {
    id: row.id, label: String(row.name || row.id), route: 'openrouter', kind: 'text',
    contextTokens: Number.isFinite(row.context_length) ? row.context_length : Number.isFinite(row.top_provider?.context_length) ? row.top_provider.context_length : null,
    maxOutputTokens: Number.isFinite(row.top_provider?.max_completion_tokens) ? row.top_provider.max_completion_tokens : null,
    efforts: params.includes('reasoning') ? ['low', 'medium', 'high'] : [],
    reasoning: params.includes('reasoning'),
    structured: params.includes('structured_outputs') ? 'native' : params.includes('response_format') ? 'json-mode' : 'prompt',
    imageInput: inputs.includes('image'), textOutput: outputs.includes('text'),
    inputUsdPerMTok: perMTok(row.pricing?.prompt), outputUsdPerMTok: perMTok(row.pricing?.completion), cacheReadUsdPerMTok: perMTok(row.pricing?.input_cache_read),
    ...(Number.isFinite(expires) ? { expiresAt: new Date(expires).toISOString(), deprecated: expires <= nowMs } : {}),
    source: 'live',
  };
}

// The request schema of a fal endpoint's OpenAPI document (the POST body), with $refs followed one level.
function falInputSchema(openapi) {
  if (!openapi || typeof openapi !== 'object') return null;
  const resolve = (node) => {
    if (node?.$ref && typeof node.$ref === 'string') { const name = node.$ref.split('/').pop(); return openapi.components?.schemas?.[name] || null; }
    return node || null;
  };
  for (const methods of Object.values(openapi.paths || {})) {
    const body = methods?.post?.requestBody?.content?.['application/json']?.schema;
    const schema = resolve(body);
    if (schema?.properties) return { ...schema, properties: Object.fromEntries(Object.entries(schema.properties).map(([name, prop]) => [name, resolve(prop) || prop])) };
  }
  return null;
}
const enumOf = (prop) => (Array.isArray(prop?.enum) ? prop.enum : Array.isArray(prop?.anyOf) ? prop.anyOf.flatMap((entry) => entry.enum || []) : []);
// What a fal endpoint takes, from its input schema: field names and allowed values (Seedance durations are strings).
function mapFalOpenApi(endpointId, openapi, kind) {
  const schema = falInputSchema(openapi); const props = schema?.properties || {};
  const durations = enumOf(props.duration).map((value) => Number(value)).filter((value) => Number.isFinite(value));
  const formats = enumOf(props.output_format).map(String);
  const refs = props.image_urls ? (Number.isInteger(props.image_urls.maxItems) ? props.image_urls.maxItems : 10) : props.reference_image_urls ? (props.reference_image_urls.maxItems || 4) : 0;
  return {
    id: endpointId, route: 'fal', kind,
    fields: Object.keys(props),
    durationType: props.duration?.type === 'string' || enumOf(props.duration).some((value) => typeof value === 'string') ? 'string' : 'number',
    durations, resolutions: enumOf(props.resolution).map(String), aspectRatios: enumOf(props.aspect_ratio).map(String),
    imageSizes: enumOf(props.image_size).map(String),
    sound: Boolean(props.generate_audio),
    referenceImages: refs, referenceField: props.image_urls ? 'image_urls' : props.reference_image_urls ? 'reference_image_urls' : '',
    imageInput: Boolean(props.image_url || props.image_urls || props.reference_image_urls), input: props.image_url ? 'image' : 'text',
    png: formats.length ? formats.includes('png') : null,
    negativePrompt: Boolean(props.negative_prompt), numImages: Boolean(props.num_images),
  };
}

function createAiCatalog({ dataDir, getKey = () => '', fetchImpl = globalThis.fetch, codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), now = Date.now } = {}) {
  const dir = () => { const value = typeof dataDir === 'function' ? dataDir() : dataDir; return value ? path.join(value, 'ai-catalog') : ''; };
  const readCache = (name) => { try { return JSON.parse(fs.readFileSync(path.join(dir(), name), 'utf8')); } catch (_) { return null; } };
  const writeCache = (name, value) => { try { if (!dir()) return; fs.mkdirSync(dir(), { recursive: true }); fs.writeFileSync(path.join(dir(), name), JSON.stringify(value)); } catch (_) { /* a cache is a courtesy */ } };
  let openrouter = null; // { fetchedAt, models: [] }
  let fal = null; // { models: { [endpointId]: profile }, prices: { [endpointId]: { unitUsd, unit, currency, at } }, lists: { [category]: { fetchedAt, ids } } }
  const loadOpenRouter = () => (openrouter ||= readCache('openrouter-models.json') || { fetchedAt: '', models: [] });
  const loadFal = () => (fal ||= { models: {}, prices: {}, lists: {}, ...(readCache('fal.json') || {}) });
  const fresh = (at, ttl) => Boolean(at) && now() - Date.parse(at) < ttl;

  // ---------- Codex ----------
  function codexModels() {
    let raw = null;
    try { raw = JSON.parse(fs.readFileSync(path.join(codexHome, 'models_cache.json'), 'utf8')); } catch (_) { raw = null; }
    const rows = Array.isArray(raw?.models) ? raw.models : [];
    const models = rows.filter((row) => row && typeof row.slug === 'string' && row.visibility !== 'hide').map((row) => ({
      id: row.slug, label: String(row.display_name || row.slug), route: 'codex', kind: 'text',
      efforts: (Array.isArray(row.supported_reasoning_levels) ? row.supported_reasoning_levels : []).map((level) => (typeof level === 'string' ? level : level?.effort)).filter((level) => typeof level === 'string'),
      defaultEffort: typeof row.default_reasoning_level === 'string' ? row.default_reasoning_level : '',
      contextTokens: Number.isFinite(row.context_window) ? row.context_window : null,
      imageInput: Array.isArray(row.input_modalities) && row.input_modalities.includes('image'),
      structured: 'native', source: 'live',
    }));
    return [{ id: '', label: 'Codex default', route: 'codex', kind: 'text', efforts: null, defaultEffort: '', contextTokens: null, imageInput: false, structured: 'native', source: 'catalog' }, ...models];
  }

  // ---------- Profiles (synchronous, cached data only) ----------
  function claudeProfile(model) {
    const entry = MODELS.text.find((row) => row.id === model);
    return entry ? { ...copy(entry), route: 'claude', kind: 'text', source: 'catalog' } : null;
  }
  function openrouterProfile(model) { return loadOpenRouter().models.find((row) => row.id === model) || null; }
  function hasOpenRouterModel(model) { return Boolean(openrouterProfile(model)); }
  function openaiTextProfile(model) {
    const entry = MODELS.openaiText.find((row) => row.id === model);
    const live = openrouterProfile(entry?.openrouterId || `openai/${model}`);
    if (!entry && !live) return null;
    return { ...(entry ? copy(entry) : { id: model, label: model, family: 'openai', efforts: live?.efforts || [], structured: 'native', contextTokens: live?.contextTokens ?? null, maxOutputTokens: live?.maxOutputTokens ?? null }), route: 'openai', kind: 'text',
      inputUsdPerMTok: entry?.inputUsdPerMTok ?? live?.inputUsdPerMTok ?? null, outputUsdPerMTok: entry?.outputUsdPerMTok ?? live?.outputUsdPerMTok ?? null, cacheReadUsdPerMTok: entry?.cacheReadUsdPerMTok ?? live?.cacheReadUsdPerMTok ?? null,
      priceSource: entry?.inputUsdPerMTok != null ? 'catalog' : live?.inputUsdPerMTok != null ? 'openrouter' : 'none', source: entry ? 'catalog' : 'live' };
  }
  function imageProfile(route, model) {
    const curated = MODELS.images.find((row) => row.id === model && row.route === route);
    if (route === 'openai') return curated ? { ...copy(curated), kind: 'image' } : null;
    const live = loadFal().models[model];
    if (!curated && !live) return null;
    return { ...(curated ? copy(curated) : {}), ...(live ? copy(live) : {}), id: model, label: curated?.label || live?.label || model, route: 'fal', kind: 'image', referenceImages: live?.referenceImages ?? curated?.referenceImages ?? 0, png: live?.png ?? curated?.png ?? null };
  }
  function videoProfile(model) {
    const curated = MODELS.videos.find((row) => row.id === model);
    const live = loadFal().models[model];
    if (!curated && !live) return null;
    const merged = { ...(curated ? copy(curated) : {}), ...(live ? Object.fromEntries(Object.entries(live).filter(([, value]) => value != null && !(Array.isArray(value) && !value.length))) : {}) };
    return { ...merged, id: model, label: curated?.label || live?.label || model, route: 'fal', kind: 'video', input: live?.input || curated?.input || 'text', durations: merged.durations || [], resolutions: merged.resolutions || [], aspectRatios: merged.aspectRatios || [] };
  }
  // Capabilities of one model on one connection: { efforts, contextTokens, structured, imageInput, referenceImages, … } or null.
  function profile(route, model, kind = 'text') {
    if (kind === 'image') return imageProfile(route, model);
    if (kind === 'video') return videoProfile(model);
    if (CLAUDE_ROUTES.has(route)) { const entry = claudeProfile(model); return entry ? { ...entry, route } : null; }
    if (route === 'codex') return codexModels().find((row) => row.id === model) || (model ? { id: model, label: model, route: 'codex', kind: 'text', efforts: [], structured: 'native', source: 'typed' } : null);
    if (route === 'openrouter') return openrouterProfile(model);
    if (route === 'openai') return openaiTextProfile(model);
    return null;
  }
  function modelLabel(route, model, kind = 'text') {
    if (route === 'codex' && !model) return 'Codex default';
    const found = profile(route, model, kind);
    return found?.label || model || '';
  }

  // ---------- Prices ----------
  // { basis: 'tokens'|'unit'|'none', inputUsdPerMTok, outputUsdPerMTok, cacheReadUsdPerMTok, tiers, unitUsd, unit, source, asOf, known, note }
  function priceFor(route, model, kind = 'text', { quality = 'medium' } = {}) {
    const none = (note = '') => ({ basis: 'none', source: 'none', asOf: MODELS.asOf, known: true, note });
    const unknown = (basis, note) => ({ basis, source: 'none', asOf: '', known: false, note });
    if (kind === 'text') {
      if (route === 'codex') return none('Codex reports no cost; it uses your ChatGPT plan or the key Codex signed in with.');
      if (CLAUDE_ROUTES.has(route)) {
        const entry = MODELS.text.find((row) => row.id === model);
        if (!entry) return unknown('tokens', `The studio doesn’t have a price for ${model}.`);
        return { basis: 'tokens', inputUsdPerMTok: entry.inputUsdPerMTok, outputUsdPerMTok: entry.outputUsdPerMTok, cacheReadUsdPerMTok: entry.cacheReadUsdPerMTok ?? null, ...(entry.tiers ? { tiers: copy(entry.tiers) } : {}), reasoning: (entry.efforts || []).length > 0, source: 'catalog', asOf: MODELS.asOf, known: true, ...(route === 'claude' ? { note: 'List-price equivalent; your Claude plan may cover it.' } : {}) };
      }
      const found = route === 'openrouter' ? openrouterProfile(model) : route === 'openai' ? openaiTextProfile(model) : null;
      if (!found || found.inputUsdPerMTok == null || found.outputUsdPerMTok == null) return unknown('tokens', `The studio doesn’t know ${model}’s price yet, so it can’t estimate it.`);
      return { basis: 'tokens', inputUsdPerMTok: found.inputUsdPerMTok, outputUsdPerMTok: found.outputUsdPerMTok, cacheReadUsdPerMTok: found.cacheReadUsdPerMTok ?? null, reasoning: (found.efforts || []).length > 0, source: route === 'openrouter' ? 'openrouter' : found.priceSource || 'catalog', asOf: route === 'openrouter' ? loadOpenRouter().fetchedAt : MODELS.asOf, known: true };
    }
    if (kind === 'image' && route === 'openai') {
      const entry = MODELS.images.find((row) => row.id === model && row.route === 'openai');
      if (!entry) return unknown('unit', `The studio doesn’t have a price for ${model}.`);
      return { basis: 'unit', unit: 'image', unitUsd: entry.estimateUsd[quality] ?? entry.estimateUsd.medium, source: 'catalog', asOf: MODELS.asOf, known: true, note: 'Measured estimate per picture; each picture records what it actually used.' };
    }
    if (route === 'fal') {
      const live = loadFal().prices[model];
      const curated = (kind === 'video' ? MODELS.videos : MODELS.images).find((row) => row.id === model);
      if (live && Number.isFinite(live.unitUsd)) return { basis: 'unit', unit: live.unit, unitUsd: live.unitUsd, currency: live.currency || 'USD', source: 'fal', asOf: live.at || '', known: unitSupported(live.unit) };
      if (curated) return { basis: 'unit', unit: curated.unit, unitUsd: curated.unitUsd, source: 'catalog', asOf: MODELS.asOf, known: true };
      return unknown('unit', `fal.ai didn’t return a price for ${model}, so the studio can’t estimate it.`);
    }
    return unknown(kind === 'text' ? 'tokens' : 'unit', '');
  }
  const unitSupported = (unit) => ['image', 'images', 'second', 'seconds', 'video', 'videos', 'megapixel', 'megapixels'].includes(String(unit || '').toLowerCase());
  // How many units a fal request bills, from its unit: pictures, seconds of video, clips or megapixels.
  function unitsFor(price, { count = 1, durationSeconds = 0, width = 1024, height = 1024 } = {}) {
    const unit = String(price?.unit || '').toLowerCase();
    if (unit === 'image' || unit === 'images') return count;
    if (unit === 'second' || unit === 'seconds') return durationSeconds;
    if (unit === 'video' || unit === 'videos') return count;
    if (unit === 'megapixel' || unit === 'megapixels') return count * Math.ceil((width * height) / 1e6);
    return null;
  }

  // ---------- Live lists ----------
  async function openrouterModels({ force = false } = {}) {
    const cached = loadOpenRouter();
    if (!force && fresh(cached.fetchedAt, OPENROUTER_TTL_MS) && cached.models.length) return { ...cached, stale: false };
    try {
      const key = getKey('OPENROUTER_API_KEY');
      const reply = await fetchJson(fetchImpl, `${OPENROUTER_API}/models`, { headers: { Accept: 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) }, timeoutMs: 20000 });
      if (!reply.ok || !Array.isArray(reply.json?.data)) throw new Error(`OpenRouter answered ${reply.status}.`);
      const models = reply.json.data.map((row) => mapOpenRouterModel(row, now())).filter((row) => row && row.textOutput !== false);
      openrouter = { fetchedAt: new Date(now()).toISOString(), models }; writeCache('openrouter-models.json', openrouter);
      return { ...openrouter, stale: false };
    } catch (error) { return { ...cached, stale: true, error: error.message }; }
  }
  const falHeaders = () => { const key = getKey('FAL_KEY'); return { Accept: 'application/json', ...(key ? { Authorization: `Key ${key}` } : {}) }; };
  async function falPrices(endpointIds) {
    const ids = [...new Set(endpointIds.filter(Boolean))]; if (!ids.length) return {};
    const query = ids.map((id) => `endpoint_id=${encodeURIComponent(id)}`).join('&');
    const reply = await fetchJson(fetchImpl, `${FAL_PLATFORM_API}/models/pricing?${query}`, { headers: falHeaders(), timeoutMs: 20000 });
    if (reply.status === 401 || reply.status === 403) throw Object.assign(new Error('fal.ai rejected the key. Check it in Settings, AI connections.'), { code: 'FAL_AUTH' });
    if (!reply.ok) throw new Error(`fal.ai pricing answered ${reply.status}.`);
    const state = loadFal(); const at = new Date(now()).toISOString();
    for (const row of Array.isArray(reply.json?.prices) ? reply.json.prices : []) {
      if (typeof row?.endpoint_id !== 'string') continue;
      const unitUsd = Number(row.unit_price);
      if (Number.isFinite(unitUsd) && (!row.currency || row.currency === 'USD')) state.prices[row.endpoint_id] = { unitUsd, unit: String(row.unit || ''), currency: row.currency || 'USD', at };
    }
    writeCache('fal.json', state);
    return Object.fromEntries(ids.map((id) => [id, state.prices[id] || null]));
  }
  // One fal endpoint's input schema and price (fetched once a day). Throws a plain message when fal can't be read.
  async function falModel(endpointId, { kind = 'image', force = false } = {}) {
    const state = loadFal(); const known = state.models[endpointId];
    if (!force && known && fresh(known.fetchedAt, FAL_TTL_MS) && state.prices[endpointId] && fresh(state.prices[endpointId].at, FAL_TTL_MS)) return { profile: known, price: state.prices[endpointId] };
    const reply = await fetchJson(fetchImpl, `${FAL_PLATFORM_API}/models?endpoint_id=${encodeURIComponent(endpointId)}&expand=openapi-3.0`, { headers: falHeaders(), timeoutMs: 20000 });
    if (reply.status === 401 || reply.status === 403) throw Object.assign(new Error('fal.ai rejected the key. Check it in Settings, AI connections.'), { code: 'FAL_AUTH' });
    if (!reply.ok) throw new Error(`fal.ai answered ${reply.status} for ${endpointId}.`);
    const row = (Array.isArray(reply.json?.models) ? reply.json.models : []).find((entry) => entry?.endpoint_id === endpointId);
    if (!row) return { profile: null, price: null };
    const meta = row.metadata || {};
    const category = String(meta.category || '');
    const actualKind = /video/.test(category) ? 'video' : /image/.test(category) ? 'image' : kind;
    const mapped = { ...mapFalOpenApi(endpointId, row.openapi, actualKind), label: String(meta.display_name || endpointId), category, deprecated: meta.status === 'deprecated', fetchedAt: new Date(now()).toISOString() };
    state.models[endpointId] = mapped; writeCache('fal.json', state);
    let price = state.prices[endpointId] || null;
    try { price = (await falPrices([endpointId]))[endpointId]; } catch (error) { if (error.code === 'FAL_AUTH') throw error; }
    return { profile: mapped, price };
  }
  async function falList({ category, query = '', cursor = '', limit = 30 } = {}) {
    const params = new URLSearchParams({ category, limit: String(limit), ...(query ? { q: query } : {}), ...(cursor ? { cursor } : {}) });
    const reply = await fetchJson(fetchImpl, `${FAL_PLATFORM_API}/models?${params}`, { headers: falHeaders(), timeoutMs: 20000 });
    if (!reply.ok) throw new Error(reply.status === 401 || reply.status === 403 ? 'fal.ai rejected the key. Check it in Settings, AI connections.' : `fal.ai answered ${reply.status}.`);
    const rows = Array.isArray(reply.json?.models) ? reply.json.models : [];
    return { rows: rows.filter((row) => typeof row?.endpoint_id === 'string').map((row) => ({ id: row.endpoint_id, label: String(row.metadata?.display_name || row.endpoint_id), category: String(row.metadata?.category || category), deprecated: row.metadata?.status === 'deprecated' })), nextCursor: reply.json?.has_more && reply.json?.next_cursor ? String(reply.json.next_cursor) : null };
  }

  // listAiModels: models for a picker, searchable, at most 50 a page.
  async function list({ route, kind = 'text', query = '', filters = {}, cursor = '', limit = 30 } = {}) {
    const size = Math.max(1, Math.min(50, Number(limit) || 30)); const q = String(query || '').trim().toLowerCase();
    const match = (row) => !q || row.id.toLowerCase().includes(q) || String(row.label || '').toLowerCase().includes(q);
    const page = (rows, extra = {}) => { const start = Number(cursor) || 0; const slice = rows.slice(start, start + size); return { models: slice, nextCursor: start + size < rows.length ? String(start + size) : null, fetchedAt: new Date(now()).toISOString(), stale: false, ...extra }; };
    const withPrice = (row) => ({ ...row, ...priceFields(row.route, row.id, kind) });
    if (kind === 'text') {
      if (CLAUDE_ROUTES.has(route)) return page(MODELS.text.filter((row) => row.family === 'claude').map((row) => withPrice({ ...copy(row), route, kind, source: 'catalog' })).filter(match));
      if (route === 'codex') return page(codexModels().filter(match));
      if (route === 'openai') {
        const or = await openrouterModels().catch(() => ({ models: [] }));
        const extra = (or.models || []).filter((row) => row.id.startsWith('openai/') && !MODELS.openaiText.some((entry) => entry.openrouterId === row.id)).map((row) => row.id.slice('openai/'.length));
        const rows = [...MODELS.openaiText.map((row) => row.id), ...extra].map((id) => openaiTextProfile(id)).filter(Boolean).filter((row) => !filters.structured || row.structured === 'native');
        return page(rows.map((row) => withPrice(row)).filter(match));
      }
      if (route === 'openrouter') {
        const result = await openrouterModels();
        let rows = (result.models || []).filter((row) => !row.deprecated);
        if (filters.structured) rows = rows.filter((row) => row.structured === 'native');
        if (filters.imageInput) rows = rows.filter((row) => row.imageInput);
        return { ...page(rows.filter(match)), fetchedAt: result.fetchedAt, stale: Boolean(result.stale) };
      }
      return page([]);
    }
    if (route === 'openai') return page(MODELS.images.filter((row) => row.route === 'openai').map((row) => withPrice({ ...copy(row), kind: 'image', source: 'catalog', imageInput: true })).filter(match));
    if (route === 'fal') {
      const curated = (kind === 'video' ? MODELS.videos : MODELS.images.filter((row) => row.route === 'fal')).map((row) => withPrice({ ...copy(row), route: 'fal', kind, source: 'catalog', imageInput: kind === 'video' ? row.input === 'image' : (row.referenceImages || 0) > 0 }));
      if (!getKey('FAL_KEY')) return page(curated.filter(match));
      const categories = filters.category ? [filters.category] : FAL_CATEGORIES[kind] || [];
      try {
        const lists = await Promise.all(categories.map((category) => falList({ category, query: q, cursor: categories.length === 1 ? cursor : '', limit: size })));
        const seen = new Set(curated.map((row) => row.id));
        const live = lists.flatMap((entry) => entry.rows).filter((row) => !seen.has(row.id) && !row.deprecated).map((row) => withPrice({ ...row, route: 'fal', kind, source: 'live', ...(loadFal().models[row.id] ? { referenceImages: loadFal().models[row.id].referenceImages, imageInput: loadFal().models[row.id].imageInput } : {}) }));
        const rows = [...(cursor ? [] : curated.filter(match)), ...live].filter((row) => !filters.referenceImages || (row.referenceImages || 0) > 0);
        return { models: rows.slice(0, size), nextCursor: categories.length === 1 ? lists[0].nextCursor : null, fetchedAt: new Date(now()).toISOString(), stale: false };
      } catch (error) { return { ...page(curated.filter(match)), stale: true, error: error.message }; }
    }
    return page([]);
  }
  function priceFields(route, model, kind) {
    const price = priceFor(route, model, kind);
    if (price.basis === 'tokens') return { inputUsdPerMTok: price.inputUsdPerMTok ?? null, outputUsdPerMTok: price.outputUsdPerMTok ?? null };
    if (price.basis === 'unit') return { unitUsd: price.unitUsd ?? null, unit: price.unit || '' };
    return {};
  }

  async function refresh({ route } = {}) {
    if (route === 'openrouter' || route === 'openai') return openrouterModels({ force: true });
    return null;
  }

  return { profile, priceFor, unitsFor, unitSupported, modelLabel, list, refresh, openrouterModels, hasOpenRouterModel, codexModels, falModel, falPrices, catalog: MODELS };
}

module.exports = { createAiCatalog, mapOpenRouterModel, mapFalOpenApi, falInputSchema, OPENROUTER_TTL_MS, FAL_TTL_MS };
