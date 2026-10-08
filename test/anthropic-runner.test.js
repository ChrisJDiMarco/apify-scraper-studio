import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import runner from '../src/shared/anthropic-runner.js';
import claude from '../src/shared/claude-runner.js';
import program from '../src/shared/research-program.js';
import reports from '../src/shared/research-reports.js';

// The CommonJS build the runner requires, so SDK errors built here pass its instanceof checks.
const Anthropic = createRequire(import.meta.url)('@anthropic-ai/sdk').default;
const { createAnthropicRunner, toApiSchema, buildMessageParams, planBudget, resolveEffort, staticModelProfile, profileFromModelInfo, usageCost, describeApiError, MIN_OUTPUT_TOKENS } = runner;

const KEY = 'sk-ant-api03-test-key-0123456789abcdefghij';
const LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];
const schema = { type: 'object', properties: { reply: { type: 'string' } }, required: ['reply'], additionalProperties: false };
const modelInfo = (id, { maxTokens = 128000, efforts = LEVELS, adaptive = true, structured = true } = {}) => ({ type: 'model', id, display_name: id, max_input_tokens: 1000000, max_tokens: maxTokens, capabilities: { structured_outputs: { supported: structured }, thinking: { supported: adaptive, types: { adaptive: { supported: adaptive }, enabled: { supported: false } } }, effort: { supported: efforts.length > 0, ...Object.fromEntries(LEVELS.map((level) => [level, { supported: efforts.includes(level) }])) } } });
const reply = (overrides = {}) => ({ id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'thinking', thinking: '', signature: 'sig' }, { type: 'text', text: '{"reply":"pong"}' }], stop_reason: 'end_turn', stop_details: null, usage: { input_tokens: 1200, output_tokens: 300, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, ...overrides });
const apiError = (status, type, message, headers = {}) => Anthropic.APIError.generate(status, { type: 'error', error: { type, message } }, undefined, new Headers({ 'request-id': `req_${status}`, ...headers }));
const waitForAbort = ({ signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Anthropic.APIUserAbortError()), { once: true }));

// Stands in for the SDK client: records constructor options and requests, and answers from a script.
// A Models API entry may be info, an Error to throw, or a function of the request options.
function fakeSdk({ answer = reply(), models = {} } = {}) {
  const calls = { options: null, streams: [], lookups: [] };
  class FakeAnthropic {
    constructor(options) { calls.options = options; }
    messages = { stream: (params, options) => { calls.streams.push({ params, options }); return fakeStream(typeof answer === 'function' ? answer(params) : answer, options); } };
    models = {
      retrieve: async (id, params, options) => {
        calls.lookups.push({ id, options }); const info = id in models ? models[id] : modelInfo(id);
        if (info instanceof Error) throw info;
        return typeof info === 'function' ? info(options) : info;
      },
    };
  }
  return { Client: FakeAnthropic, calls };
}
// `{ hang: true }` streams until aborted; `{ error, started }` fails before or after message_start.
function fakeStream(outcome, options) {
  const stream = { request_id: 'req_stream', currentMessage: undefined };
  stream.finalMessage = () => {
    if (outcome?.hang) { stream.currentMessage = reply({ content: [], stop_reason: null }); return waitForAbort(options); }
    if (outcome?.error) { if (outcome.started) stream.currentMessage = reply({ content: [], stop_reason: null }); return Promise.reject(outcome.error); }
    stream.currentMessage = outcome; return Promise.resolve(outcome);
  };
  return stream;
}
const setup = (options = {}) => { const sdk = fakeSdk(options); let now = 1000; return { ...sdk, runner: createAnthropicRunner({ apiKey: KEY, Client: sdk.Client, clock: () => (now += 2500), maxRetries: 3 }) }; };
const failure = (promise) => promise.then(() => { throw new Error('Expected the run to fail.'); }, (error) => error);
const thrown = (fn) => { try { fn(); } catch (error) { return error; } throw new Error('Expected a throw.'); };
const budgetTokens = (prompt, model = 'claude-opus-5-5', budget = 1) => { const price = program.modelPrice(model); return Math.floor((budget * 1e6 - program.estimateTokens(claude.CLAUDE_SYSTEM_PROMPT.length + prompt.length + JSON.stringify(schema).length) * price.input) / price.output); };

describe('Anthropic API request', () => {
  it('streams one structured request with the CLI system prompt, adaptive thinking, effort and a budget-sized max_tokens', async () => {
    const { runner: api, calls } = setup(); const prompt = 'Summarize the supplied evidence.';
    const { output, receipt } = await api.run({ schema, prompt, model: 'claude-opus-5-5', effort: 'high', maxBudgetUsd: 1 });
    expect(output).toEqual({ reply: 'pong' });
    expect(calls.options).toEqual({ apiKey: KEY, authToken: null, baseURL: 'https://api.anthropic.com', maxRetries: 3 });
    expect(calls.streams).toHaveLength(1);
    const { params, options } = calls.streams[0];
    expect(params).toEqual({ model: 'claude-opus-5-5', max_tokens: budgetTokens(prompt), system: claude.CLAUDE_SYSTEM_PROMPT, messages: [{ role: 'user', content: prompt }], thinking: { type: 'adaptive' }, output_config: { effort: 'high', format: { type: 'json_schema', schema } } });
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(calls.lookups).toEqual([{ id: 'claude-opus-5-5', options: expect.objectContaining({ timeout: 20000 }) }]);
    expect(receipt).toEqual({ provider: 'claude-api', requestedModel: 'claude-opus-5-5', actualModel: 'claude-opus-5-5', actualModels: ['claude-opus-5-5'], effort: 'high', costUsd: 0.0108, usage: reply().usage, durationMs: 2500, stopReason: 'end_turn', requestId: 'req_stream', maxTokens: budgetTokens(prompt), costBasis: 'Anthropic API usage at list prices' });
  });
  it('builds request params from a converted schema and omits effort and thinking a model does not take', () => {
    const apiSchema = toApiSchema(program.MATCHING_SCHEMA);
    expect(buildMessageParams({ model: 'claude-haiku-4-5', prompt: 'Match themes.', schema: apiSchema, maxTokens: 4000, adaptiveThinking: false })).toEqual({ model: 'claude-haiku-4-5', max_tokens: 4000, system: claude.CLAUDE_SYSTEM_PROMPT, messages: [{ role: 'user', content: 'Match themes.' }], output_config: { format: { type: 'json_schema', schema: apiSchema } } });
  });
  it('reads model limits once per key, caps max_tokens at the model maximum and accepts a dated snapshot', async () => {
    const { runner: api, calls } = setup({ answer: reply({ model: 'claude-haiku-4-5-20251001' }), models: { 'claude-haiku-4-5': modelInfo('claude-haiku-4-5', { maxTokens: 64000, efforts: [], adaptive: false }) } });
    const first = await api.run({ schema, prompt: 'Tag these posts.', model: 'claude-haiku-4-5', effort: 'low', maxBudgetUsd: 100 });
    await api.run({ schema, prompt: 'Tag these posts.', model: 'claude-haiku-4-5', maxBudgetUsd: 100 });
    expect(calls.lookups.map((lookup) => lookup.id)).toEqual(['claude-haiku-4-5']);
    expect(calls.streams[0].params.max_tokens).toBe(64000);
    expect(calls.streams[0].params).not.toHaveProperty('thinking');
    expect(calls.streams[0].params.output_config).toEqual({ format: { type: 'json_schema', schema } });
    expect(first.receipt).toMatchObject({ actualModel: 'claude-haiku-4-5-20251001', actualModels: ['claude-haiku-4-5-20251001'], effort: '', requestedEffort: 'low', effortNote: 'claude-haiku-4-5 does not take an effort level, so it ran at its default.', costUsd: (1200 * 1 + 300 * 5) / 1e6, maxTokens: 64000 });
  });
  it('runs an unsupported effort at the nearest supported level and notes it on the receipt', async () => {
    const { runner: api, calls } = setup({ answer: reply({ model: 'claude-opus-4-6' }), models: { 'claude-opus-4-6': modelInfo('claude-opus-4-6', { efforts: ['low', 'medium', 'high', 'max'] }) } });
    const { receipt } = await api.run({ schema, prompt: 'Synthesize.', model: 'claude-opus-4-6', effort: 'xhigh' });
    expect(calls.streams[0].params.output_config.effort).toBe('high');
    expect(receipt).toMatchObject({ effort: 'high', requestedEffort: 'xhigh', effortNote: 'claude-opus-4-6 does not support xhigh effort, so it ran at high.' });
    expect(resolveEffort('max', ['low', 'medium', 'high'])).toEqual({ effort: 'high', note: 'This model does not support max effort, so it ran at high.' });
    expect(resolveEffort('low', ['medium', 'high']).effort).toBe('medium');
    expect(resolveEffort('medium', LEVELS)).toEqual({ effort: 'medium', note: '' });
    expect(resolveEffort(undefined, [])).toEqual({ effort: '', note: '' });
  });
  it('falls back to the documented model profile when the Models API is briefly unavailable, without caching it', async () => {
    const { runner: api, calls } = setup({ models: { 'claude-opus-5-5': apiError(503, 'api_error', 'Service unavailable') } });
    await api.run({ schema, prompt: 'Report.', model: 'claude-opus-5-5', effort: 'xhigh', maxBudgetUsd: 50 });
    await api.run({ schema, prompt: 'Report.', model: 'claude-opus-5-5', maxBudgetUsd: 50 });
    expect(calls.lookups).toHaveLength(2);
    expect(calls.streams[0].params).toMatchObject({ max_tokens: 128000, thinking: { type: 'adaptive' }, output_config: { effort: 'xhigh' } });
  });
  it('profiles models from the Models API and from the documented table', () => {
    expect(profileFromModelInfo(modelInfo('claude-sonnet-5-5', { maxTokens: 64000, efforts: ['low', 'medium', 'high'], structured: false }), 'claude-sonnet-5-5')).toEqual({ maxOutputTokens: 64000, efforts: ['low', 'medium', 'high'], adaptiveThinking: true, structuredOutputs: false, source: 'models-api' });
    expect(profileFromModelInfo({ id: 'claude-opus-5-5', max_tokens: null, capabilities: null }, 'claude-opus-5-5')).toMatchObject({ maxOutputTokens: 128000, efforts: LEVELS, adaptiveThinking: true, structuredOutputs: true });
    expect(staticModelProfile('claude-fable-5-1')).toMatchObject({ maxOutputTokens: 128000, efforts: LEVELS, adaptiveThinking: true });
    expect(staticModelProfile('claude-sonnet-4-6')).toMatchObject({ maxOutputTokens: 128000, efforts: ['low', 'medium', 'high', 'max'], adaptiveThinking: true });
    expect(staticModelProfile('claude-haiku-4-5-20251001')).toMatchObject({ maxOutputTokens: 64000, efforts: [], adaptiveThinking: false });
    expect(staticModelProfile('claude-opus-4-5')).toMatchObject({ maxOutputTokens: 32000, efforts: [], adaptiveThinking: false });
  });
});

describe('Anthropic API spend guard and cost', () => {
  it('refuses before any request when the estimated input alone exceeds the budget', async () => {
    const { runner: api, calls } = setup();
    const error = await failure(api.run({ schema, prompt: 'x'.repeat(240000), model: 'claude-opus-5-5', maxBudgetUsd: 0.25 }));
    expect(error).toMatchObject({ code: 'CLAUDE_BUDGET_EXCEEDED', costUsd: 0 });
    expect(error.message).toMatch(/input alone is estimated at \$0\.41 on claude-opus-5-5/);
    expect(calls.lookups).toHaveLength(0);
    expect(calls.streams).toHaveLength(0);
  });
  it('refuses when the budget left after the input cannot buy a minimal answer, and sizes max_tokens from the rest', () => {
    expect(thrown(() => planBudget({ model: 'claude-opus-5-5', maxBudgetUsd: 0.06, inputCharacters: 24000 }))).toMatchObject({ code: 'CLAUDE_BUDGET_EXCEEDED', costUsd: 0, message: expect.stringMatching(/only 800 output tokens.*at least 1024/) });
    expect(planBudget({ model: 'claude-opus-5-5', maxBudgetUsd: 1, inputCharacters: 24000 })).toEqual({ inputTokens: 11000, inputCostUsd: 0.044, budgetTokens: 47800 });
    expect(planBudget({ model: 'claude-fable-5-1', maxBudgetUsd: 1, inputCharacters: 24000 }).budgetTokens).toBe(17800);
    expect(planBudget({ model: 'claude-haiku-4-5', maxBudgetUsd: 0.07, inputCharacters: 0 }).budgetTokens).toBe(13800);
    expect(MIN_OUTPUT_TOKENS).toBe(1024);
  });
  it('turns a budget-capped reply that stops at max_tokens into a budget error carrying its real cost', async () => {
    const usage = { input_tokens: 1300, output_tokens: 49700 };
    const { runner: api } = setup({ answer: reply({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"reply":"po' }], usage }) });
    const error = await failure(api.run({ schema, prompt: 'Long report', model: 'claude-opus-5-5', maxBudgetUsd: 1 }));
    expect(error).toMatchObject({ code: 'CLAUDE_BUDGET_EXCEEDED', costUsd: (1300 * 4 + 49700 * 20) / 1e6, stopReason: 'max_tokens', requestId: 'req_stream' });
    expect(error.message).toMatch(/spending cap before finishing/);
  });
  it('reports a reply cut off at the model maximum as truncated, not over budget', async () => {
    const { runner: api, calls } = setup({ answer: reply({ stop_reason: 'max_tokens', usage: { input_tokens: 2000, output_tokens: 128000 } }) });
    const error = await failure(api.run({ schema, prompt: 'Long report', model: 'claude-opus-5-5', maxBudgetUsd: 50 }));
    expect(calls.streams[0].params.max_tokens).toBe(128000);
    expect(error).toMatchObject({ code: 'CLAUDE_OUTPUT_TRUNCATED', costUsd: (2000 * 4 + 128000 * 20) / 1e6 });
  });
  it('prices input, output, cache writes by TTL and cache reads at each model\'s list rate', () => {
    const usage = { input_tokens: 1000, output_tokens: 500, cache_creation_input_tokens: 2000, cache_read_input_tokens: 10000, cache_creation: { ephemeral_5m_input_tokens: 1000, ephemeral_1h_input_tokens: 1000 } };
    expect(usageCost('claude-opus-5-5', usage)).toBe((1000 * 4 + (1000 * 1.25 + 1000 * 2) * 4 + 10000 * 0.05 * 4 + 500 * 20) / 1e6);
    expect(usageCost('claude-fable-5-1', { ...usage, cache_creation: null })).toBe((1000 * 10 + 2000 * 1.25 * 10 + 10000 * 0.025 * 10 + 500 * 50) / 1e6);
    expect(usageCost('claude-sonnet-5-5', { input_tokens: 100, output_tokens: 100, cache_read_input_tokens: 1000 })).toBe((100 * 2 + 1000 * 0.1 * 2 + 100 * 10) / 1e6);
    expect(usageCost('claude-opus-5-5', null)).toBeNull();
  });
});

describe('Anthropic API failures', () => {
  it.each([
    ['ANTHROPIC_AUTH', apiError(401, 'authentication_error', `invalid x-api-key ${KEY}`), /^The Anthropic API key was rejected\./],
    ['ANTHROPIC_AUTH', apiError(403, 'permission_error', 'Access to this model requires an access grant your request does not have.'), /rejected for this request \(Access to this model requires/],
    ['ANTHROPIC_MODEL_UNAVAILABLE', apiError(404, 'not_found_error', 'model: claude-opus-5-5'), /^This API key cannot use claude-opus-5-5\./],
    ['ANTHROPIC_RATE_LIMITED', apiError(429, 'rate_limit_error', 'Number of request tokens has exceeded your per-minute rate limit', { 'retry-after': '30' }), /rate limit.*Wait about 30 seconds, then retry/],
    ['ANTHROPIC_OVERLOADED', apiError(529, 'overloaded_error', 'Overloaded'), /temporarily overloaded/],
    ['ANTHROPIC_SERVER_ERROR', apiError(500, 'api_error', 'Internal server error'), /internal error \(500\)/],
    ['ANTHROPIC_BAD_REQUEST', apiError(400, 'invalid_request_error', 'prompt is too long: 1200000 tokens > 1000000 maximum'), /rejected this request: prompt is too long/],
    ['ANTHROPIC_BILLING', apiError(402, 'billing_error', 'Your credit balance is too low.'), /billing problem \(Your credit balance is too low\.\)/],
    ['ANTHROPIC_CONNECTION', new Anthropic.APIConnectionError({ message: 'Connection error.' }), /Could not reach the Anthropic API/],
  ])('maps a rejected request to %s with no cost and no key in the message', async (code, error, message) => {
    const { runner: api } = setup({ answer: { error } });
    const result = await failure(api.run({ schema, prompt: 'x' }));
    expect(result).toMatchObject({ code, costUsd: 0 });
    expect(result.message).toMatch(message);
    expect(result.message).not.toContain(KEY);
    if (error.status) expect(result).toMatchObject({ status: error.status, requestId: `req_${error.status}` });
  });
  it('redacts any API key the service echoes back', () => {
    const error = describeApiError(apiError(400, 'invalid_request_error', `malformed header x-api-key: ${KEY}`));
    expect(error).toMatchObject({ code: 'ANTHROPIC_BAD_REQUEST', message: 'The Anthropic API rejected this request: malformed header x-api-key: sk-ant-…' });
  });
  it('stops before any paid request when the model lookup says the key or model is unusable', async () => {
    for (const [error, code] of [[apiError(404, 'not_found_error', 'model: claude-fable-5-1'), 'ANTHROPIC_MODEL_UNAVAILABLE'], [apiError(401, 'authentication_error', 'invalid x-api-key'), 'ANTHROPIC_AUTH']]) {
      const { runner: api, calls } = setup({ models: { 'claude-fable-5-1': error } });
      expect(await failure(api.run({ schema, prompt: 'x', model: 'claude-fable-5-1' }))).toMatchObject({ code, costUsd: 0 });
      expect(calls.streams).toHaveLength(0);
    }
    const { runner: api, calls } = setup({ models: { 'claude-opus-5-5': modelInfo('claude-opus-5-5', { structured: false }) } });
    expect(await failure(api.run({ schema, prompt: 'x' }))).toMatchObject({ code: 'ANTHROPIC_MODEL_UNAVAILABLE', costUsd: 0, message: expect.stringMatching(/structured output/) });
    expect(calls.streams).toHaveLength(0);
  });
  it('treats an error after the answer began as billed at an unknown cost', async () => {
    const error = new Anthropic.APIError(undefined, { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }, undefined, new Headers({ 'request-id': 'req_sse' }), 'overloaded_error');
    const { runner: api } = setup({ answer: { error, started: true } });
    expect(await failure(api.run({ schema, prompt: 'x' }))).toMatchObject({ code: 'ANTHROPIC_OVERLOADED', costUsd: null, requestId: 'req_sse' });
  });
  it('cancels through the caller signal and times out on its own clock', async () => {
    const controller = new AbortController();
    const cancelled = setup({ answer: () => { queueMicrotask(() => controller.abort()); return { hang: true }; } });
    expect(await failure(cancelled.runner.run({ schema, prompt: 'x', signal: controller.signal }))).toMatchObject({ code: 'CANCELLED', message: 'Job cancelled.', costUsd: null });
    const early = setup();
    expect(await failure(early.runner.run({ schema, prompt: 'x', signal: AbortSignal.abort() }))).toMatchObject({ code: 'CANCELLED', costUsd: 0 });
    expect(early.calls.lookups).toHaveLength(0);
    const timedOut = await failure(setup({ answer: { hang: true } }).runner.run({ schema, prompt: 'x', timeoutMs: 20 }));
    expect(timedOut).toMatchObject({ code: 'TIMEOUT', costUsd: null, message: expect.stringMatching(/^Claude timed out after/) });
    const lookup = await failure(setup({ models: { 'claude-opus-5-5': waitForAbort } }).runner.run({ schema, prompt: 'x', timeoutMs: 20 }));
    expect(lookup).toMatchObject({ code: 'TIMEOUT', costUsd: 0 });
    expect(describeApiError(new Anthropic.APIConnectionTimeoutError())).toMatchObject({ code: 'TIMEOUT', costUsd: 0 });
  });
  it('rejects a reply from a different model and keeps what it cost', async () => {
    const { runner: api } = setup({ answer: reply({ model: 'claude-sonnet-5-5' }) });
    const error = await failure(api.run({ schema, prompt: 'x', model: 'claude-opus-5-5' }));
    expect(error).toMatchObject({ code: 'CLAUDE_MODEL_MISMATCH', costUsd: (1200 * 2 + 300 * 10) / 1e6, message: expect.stringMatching(/unverified or different model \(claude-sonnet-5-5\)/) });
  });
  it.each([
    ['CLAUDE_REFUSED', { stop_reason: 'refusal', stop_details: { category: 'cyber', explanation: 'Declined for safety.' }, content: [] }, /declined this request \(cyber\)\. Declined for safety\./],
    ['CLAUDE_INVALID_RESULT', { content: [{ type: 'text', text: '{"reply":' }] }, /not valid JSON/],
    ['CLAUDE_MISSING_STRUCTURED_OUTPUT', { content: [{ type: 'thinking', thinking: '', signature: 'sig' }] }, /required structured output/],
    ['CLAUDE_MISSING_STRUCTURED_OUTPUT', { content: [{ type: 'text', text: '["pong"]' }] }, /required structured output/],
    ['CLAUDE_CONTEXT_EXCEEDED', { stop_reason: 'model_context_window_exceeded' }, /context window/],
    ['CLAUDE_INVALID_RESULT', { stop_reason: 'pause_turn' }, /stopped before finishing \(pause_turn\)/],
  ])('never saves a %s answer, and charges what it cost', async (code, overrides, message) => {
    const { runner: api } = setup({ answer: reply(overrides) });
    expect(await failure(api.run({ schema, prompt: 'x' }))).toMatchObject({ code, costUsd: 0.0108, message: expect.stringMatching(message) });
  });
  it('validates input like the CLI route before any request', async () => {
    const { runner: api, calls } = setup();
    await expect(api.run({ schema: null, prompt: 'x' })).rejects.toThrow(/schema/);
    await expect(api.run({ schema, prompt: 'x', model: '--help' })).rejects.toThrow(/model/);
    for (const maxBudgetUsd of [0, 101, NaN, true, '']) await expect(api.run({ schema, prompt: 'x', maxBudgetUsd })).rejects.toThrow(/budget must be between/);
    await expect(api.run({ schema, prompt: 'x', effort: 'extreme' })).rejects.toThrow(/effort level/);
    await expect(api.run({ schema, prompt: 42 })).rejects.toThrow(/must be text/);
    await expect(api.run({ schema, prompt: '   ' })).rejects.toThrow(/empty/);
    await expect(api.run({ schema, prompt: '界'.repeat(Math.ceil(claude.MAX_CLAUDE_STDIN_BYTES / 3) + 1), maxBudgetUsd: 100 })).rejects.toThrow(/too large/);
    expect(calls.lookups).toHaveLength(0);
    expect(calls.streams).toHaveLength(0);
    expect(thrown(() => createAnthropicRunner({ apiKey: ' ', Client: fakeSdk().Client }))).toMatchObject({ code: 'ANTHROPIC_AUTH' });
  });
});

describe('Anthropic structured-output schemas', () => {
  const walk = (node, path = '#', found = []) => {
    found.push({ path, node });
    for (const [key, child] of Object.entries(node.properties || {})) walk(child, `${path}/properties/${key}`, found);
    if (node.items) walk(node.items, `${path}/items`, found);
    for (const [index, child] of (node.anyOf || []).entries()) walk(child, `${path}/anyOf/${index}`, found);
    return found;
  };
  const toolkit = reports.buildToolkitRequest({ trendReportMarkdown: `# Trends\n\n${'Practitioners report lost clicks on informational pages. '.repeat(3)}`, brandName: 'Fixture Co' }).schema;
  const appSchemas = { DISCOVERY_SCHEMA: program.DISCOVERY_SCHEMA, THEMES_SCHEMA: program.THEMES_SCHEMA, MATCHING_SCHEMA: program.MATCHING_SCHEMA, ASSIGNMENTS_SCHEMA: program.ASSIGNMENTS_SCHEMA, TREND_REPORT_SCHEMA: reports.TREND_REPORT_SCHEMA, toolkit };

  it.each(Object.keys(appSchemas))('converts %s to the supported subset without changing the original', (name) => {
    const original = appSchemas[name]; const before = structuredClone(original);
    const converted = toApiSchema(original);
    expect(original).toEqual(before);
    for (const { path, node } of walk(converted)) {
      expect(Array.isArray(node.type), path).toBe(false);
      for (const keyword of ['maxItems', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'pattern', 'uniqueItems', 'oneOf']) expect(node, `${path} ${keyword}`).not.toHaveProperty(keyword);
      if ('minItems' in node) expect([0, 1], path).toContain(node.minItems);
      if (node.type === 'object') expect(node, path).toMatchObject({ additionalProperties: false, properties: expect.any(Object) });
      if (!node.anyOf) expect(typeof node.type, path).toBe('string');
    }
  });
  it('keeps enums, splits nullable types into anyOf and moves unsupported limits into the description', () => {
    const assignment = toApiSchema(program.ASSIGNMENTS_SCHEMA).properties.assignments.items.properties;
    expect(assignment.themeId).toEqual({ anyOf: [{ type: 'string' }, { type: 'null' }] });
    expect(assignment.confidence).toEqual({ type: 'number', description: '{minimum: 0, maximum: 1}' });
    expect(assignment.painPoint).toEqual({ type: 'string', enum: program.PAIN_POINTS });
    expect(toApiSchema(program.THEMES_SCHEMA).properties.themes).toMatchObject({ type: 'array', description: '{maxItems: 6}' });
    expect(toApiSchema(program.THEMES_SCHEMA).properties.themes.items.properties.novelty).toEqual({ type: 'string', enum: ['NEW TOPIC', 'NEW ANGLE', 'EVERGREEN'] });
    expect(toApiSchema(reports.TREND_REPORT_SCHEMA).properties.painPoints).toMatchObject({ type: 'array', description: '{minItems: 3, maxItems: 3}' });
    expect(toApiSchema(toolkit).properties.enterpriseAngle.properties.productId).toEqual({ type: 'string', enum: [''] });
  });
  it('converts type unions, oneOf, formats, refs and open objects by the documented rules', () => {
    expect(toApiSchema({
      $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object',
      properties: {
        status: { type: ['string', 'null'], enum: ['open', 'closed', null], description: 'Ticket state' },
        score: { type: ['integer', 'string'], minimum: 1, maxLength: 3, default: 2 },
        when: { type: 'string', format: 'date-time' },
        site: { type: 'string', format: 'url', pattern: '^https://' },
        tags: { type: 'array', items: { type: 'string' }, minItems: 1, uniqueItems: true },
        choice: { oneOf: [{ type: 'string' }, { type: 'integer' }], description: 'Either' },
        ref: { $ref: '#/$defs/item' },
        extra: { type: 'object', properties: { a: { type: 'string' } }, additionalProperties: true },
      },
      $defs: { item: { properties: { id: { type: 'string' } } } },
    })).toEqual({
      type: 'object',
      properties: {
        status: { anyOf: [{ type: 'string', enum: ['open', 'closed'] }, { type: 'null', enum: [null] }], description: 'Ticket state' },
        score: { anyOf: [{ type: 'integer', description: '{minimum: 1}' }, { type: 'string', description: '{maxLength: 3}' }], description: '{default: 2}' },
        when: { type: 'string', format: 'date-time' },
        site: { type: 'string', description: '{format: "url", pattern: "^https://"}' },
        tags: { type: 'array', items: { type: 'string' }, minItems: 1, description: '{uniqueItems: true}' },
        choice: { anyOf: [{ type: 'string' }, { type: 'integer' }], description: 'Either' },
        ref: { $ref: '#/$defs/item' },
        extra: { type: 'object', properties: { a: { type: 'string' } }, additionalProperties: false },
      },
      additionalProperties: false,
      $defs: { item: { type: 'object', properties: { id: { type: 'string' } }, additionalProperties: false } },
    });
  });
  it('rejects schemas structured outputs cannot express instead of guessing', () => {
    expect(() => toApiSchema(null)).toThrow(/JSON schema object/);
    expect(() => toApiSchema({ type: 'object', properties: { free: {} } })).toThrow('The structured output schema at #/properties/free needs a type.');
    expect(() => toApiSchema({ type: 'array', items: [{ type: 'string' }] })).toThrow(/tuple-style items/);
    expect(() => toApiSchema({ type: ['string', 'null'], enum: [1] })).toThrow(/allows no value/);
  });
});

describe('Anthropic model access check', () => {
  it('checks each model through the free Models API and reuses what it learned', async () => {
    const { runner: api, calls } = setup({ models: { 'claude-fable-5-1': apiError(404, 'not_found_error', 'model: claude-fable-5-1'), 'claude-legacy-1': modelInfo('claude-legacy-1', { structured: false }) } });
    expect(await api.checkModels({ models: ['claude-opus-5-5', 'claude-fable-5-1', 'claude-opus-5-5', 'claude-legacy-1', '--bad'] })).toEqual({ ok: false, models: [
      { id: 'claude-opus-5-5', available: true, error: '' },
      { id: 'claude-fable-5-1', available: false, error: "The model ID is unknown, or this key's organization has no access to it." },
      { id: 'claude-legacy-1', available: false, error: "This model can't return structured output through the API." },
      { id: '--bad', available: false, error: 'Not a valid Claude model ID.' },
    ] });
    expect(calls.streams).toHaveLength(0);
    await api.run({ schema, prompt: 'x', model: 'claude-opus-5-5' });
    expect(calls.lookups.map((lookup) => lookup.id)).toEqual(['claude-opus-5-5', 'claude-fable-5-1', 'claude-legacy-1']);
    expect(await setup().runner.checkModels({ models: ['claude-opus-5-5', 'claude-sonnet-5-5'] })).toEqual({ ok: true, models: [{ id: 'claude-opus-5-5', available: true, error: '' }, { id: 'claude-sonnet-5-5', available: true, error: '' }] });
  });
  it('marks every model unavailable with the key message when the key is rejected', async () => {
    const { runner: api } = setup({ models: { 'claude-opus-5-5': apiError(401, 'authentication_error', 'invalid x-api-key') } });
    const result = await api.checkModels({ models: ['claude-opus-5-5', 'claude-fable-5-1'] });
    expect(result.ok).toBe(false);
    expect(result.models).toEqual(['claude-opus-5-5', 'claude-fable-5-1'].map((id) => ({ id, available: false, error: expect.stringMatching(/^The Anthropic API key was rejected\./) })));
  });
});
