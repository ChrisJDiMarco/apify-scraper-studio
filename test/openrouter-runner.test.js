import { describe, expect, it, vi } from 'vitest';
const { createOpenRouterRunner, toStrictSchema, stripNulls } = require('../src/main/openrouter-runner.js');
const { json, sse, fakeFetch } = require('./helpers/fetch-fixtures.js');

// OpenRouter (src/main/openrouter-runner.js) through fetch fixtures: no request reaches openrouter.ai.
const KEY = 'sk-or-v1-0123456789abcdefghij0123456789';
const schema = { type: 'object', additionalProperties: false, required: ['answer'], properties: { answer: { type: 'string' }, tip: { type: 'string' } } };
const profile = { structured: 'native', reasoning: true, efforts: ['low', 'medium', 'high'], maxOutputTokens: 64000, inputUsdPerMTok: 3, outputUsdPerMTok: 15 };
const price = { inputUsdPerMTok: 3, outputUsdPerMTok: 15 };
const reply = (text, { model = 'anthropic/claude-opus-5.5', cost = 0.0123, finish = 'stop' } = {}) => [
  ': OPENROUTER PROCESSING\n\n',
  { id: 'gen-1', model, choices: [{ delta: { content: text.slice(0, 5) } }] },
  ': OPENROUTER PROCESSING\n\n',
  { id: 'gen-1', model, choices: [{ delta: { content: text.slice(5) }, finish_reason: finish }] },
  { id: 'gen-1', model, choices: [], usage: { prompt_tokens: 1200, completion_tokens: 80, prompt_tokens_details: { cached_tokens: 1000 }, completion_tokens_details: { reasoning_tokens: 20 }, ...(cost == null ? {} : { cost }) } },
];
const runner = (fetchImpl, options = {}) => createOpenRouterRunner({ getKey: () => KEY, fetchImpl, clock: () => 1000, sleep: async () => {}, ...options });
const base = { schema, prompt: 'Question about trends', model: 'anthropic/claude-opus-5.5', maxBudgetUsd: 1, profile, price };

describe('OpenRouter runner', () => {
  it('sends a strict schema with the privacy filter and streams the answer to onDelta', async () => {
    const { fetchImpl, calls } = fakeFetch([sse(reply('{"answer":"Rising","tip":null}'), { split: 7 })]);
    const deltas = [];
    const { output, receipt } = await runner(fetchImpl).run({ ...base, effort: 'high', cachePrefix: 'GUIDE TEXT', onDelta: (piece) => deltas.push(piece) });
    expect(output).toEqual({ answer: 'Rising' }); // the optional null the strict schema forced is stripped again
    expect(deltas.join('')).toBe('{"answer":"Rising","tip":null}');
    const [call] = calls; const body = call.json;
    expect(call.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(call.headers).toMatchObject({ Authorization: `Bearer ${KEY}`, 'X-Title': 'Golden Thread' });
    expect(body).toMatchObject({ model: 'anthropic/claude-opus-5.5', stream: true, reasoning: { effort: 'high' }, provider: { require_parameters: true, data_collection: 'deny' } });
    expect(body.response_format.json_schema).toMatchObject({ name: 'studio_answer', strict: true, schema: { required: ['answer', 'tip'], properties: { tip: { anyOf: [{ type: 'string' }, { type: 'null' }] } } } });
    expect(body.messages[1].content[0]).toEqual({ type: 'text', text: 'GUIDE TEXT', cache_control: { type: 'ephemeral' } });
    expect(body.max_tokens).toBeLessThanOrEqual(64000);
    expect(receipt).toMatchObject({ provider: 'openrouter', requestedModel: 'anthropic/claude-opus-5.5', costUsd: 0.0123, costBasis: 'OpenRouter charge', structuredOutput: 'native', requestId: 'gen-1', usage: { cached_tokens: 1000, reasoning_tokens: 20 } });
  });
  it('honors zero-retention and any-provider privacy, leaves reasoning off where unsupported, and caches only Anthropic and Google prefixes', async () => {
    const zdr = fakeFetch([sse(reply('{"answer":"ok"}', { model: 'deepseek/deepseek-v4' }))]);
    await runner(zdr.fetchImpl, { privacy: () => 'zdr' }).run({ ...base, model: 'deepseek/deepseek-v4', effort: 'low', cachePrefix: 'P', profile: { ...profile, reasoning: false } });
    expect(zdr.calls[0].json.provider).toMatchObject({ data_collection: 'deny', zdr: true });
    expect(zdr.calls[0].json.reasoning).toBeUndefined();
    expect(zdr.calls[0].json.messages[1].content[0].cache_control).toBeUndefined();
    const any = fakeFetch([sse(reply('{"answer":"ok"}'))]);
    await runner(any.fetchImpl, { privacy: () => 'any' }).run(base);
    expect(any.calls[0].json.provider.data_collection).toBe('allow');
  });
  it('writes the schema into the prompt for models without structured answers, and retries once when a schema is refused', async () => {
    const jsonMode = fakeFetch([sse(reply('```json\n{"answer":"loose"}\n```', { model: 'meta/llama-5' }))]);
    const loose = await runner(jsonMode.fetchImpl).run({ ...base, model: 'meta/llama-5', profile: { ...profile, structured: 'json-mode' } });
    expect(loose.output).toEqual({ answer: 'loose' }); expect(loose.receipt.structuredOutput).toBe('schema in prompt');
    expect(jsonMode.calls[0].json.response_format).toEqual({ type: 'json_object' });
    expect(jsonMode.calls[0].json.messages.at(-1).content).toContain('ANSWER FORMAT');
    const refused = fakeFetch([json({ error: { message: 'Invalid schema: compiled grammar is too large' } }, { status: 400 }), sse(reply('{"answer":"second try"}'))]);
    const retried = await runner(refused.fetchImpl).run(base);
    expect(retried.output).toEqual({ answer: 'second try' });
    expect(refused.calls[1].json.response_format).toBeUndefined(); expect(refused.calls[1].json.messages.at(-1).content).toContain('ANSWER FORMAT');
  });
  it('reads a prompt-written answer leniently, and keeps an unreadable one’s text (redacted) with the same error', async () => {
    const repaired = fakeFetch([sse(reply('Here it is: {"answer":"Line one\nLine two",}', { model: 'meta/llama-5' }))]);
    const loose = await runner(repaired.fetchImpl).run({ ...base, model: 'meta/llama-5', profile: { ...profile, structured: 'prompt' } });
    expect(loose.output).toEqual({ answer: 'Line one\nLine two' }); expect(loose.receipt).toMatchObject({ structuredOutput: 'schema in prompt', parse: 'repaired' });
    const text = `{"answer":"Your key ${KEY} runs a "quick scan"."}`;
    const broken = fakeFetch([sse(reply(text, { model: 'meta/llama-5' }))]);
    const error = await runner(broken.fetchImpl).run({ ...base, model: 'meta/llama-5', profile: { ...profile, structured: 'json-mode' } }).catch((failure) => failure);
    expect(error).toMatchObject({ code: 'AI_INVALID_RESULT', message: 'The model’s answer wasn’t valid JSON. No unvalidated answer was saved.', costUsd: 0.0123, schemaInPrompt: true, stopReason: 'stop', rawTextLength: text.length });
    expect(error.rawText).toBe('{"answer":"Your key sk-or-… runs a "quick scan"."}');
    // The early-closed stub before a quoted brace isn't taken for the answer when it holds too few of the schema's keys.
    const wide = { ...schema, required: ['answer', 'tip', 'note'], properties: { ...schema.properties, note: { type: 'object', properties: { tip: { type: 'string' } } } } };
    const stub = '{"answer":"Type "}" to close.","tip":"x","note":{"tip":"y"}}';
    const nested = await runner(fakeFetch([sse(reply(stub, { model: 'meta/llama-5' }))]).fetchImpl).run({ ...base, schema: wide, model: 'meta/llama-5', profile: { ...profile, structured: 'prompt' } }).catch((failure) => failure);
    expect(nested).toMatchObject({ code: 'AI_INVALID_RESULT', schemaInPrompt: true, rawText: stub });
    // A strict schema's answer is taken as sent: no lenient reading, but the text is kept the same way.
    const strict = await runner(fakeFetch([sse(reply('```json\n{"answer":"x"}\n```'))]).fetchImpl).run(base).catch((failure) => failure);
    expect(strict).toMatchObject({ code: 'AI_INVALID_RESULT', schemaInPrompt: false, rawText: '```json\n{"answer":"x"}\n```' });
  });
  it('maps OpenRouter errors to plain messages and never shows the key', async () => {
    const cases = [[401, 'OPENROUTER_AUTH', /key was rejected/], [402, 'OPENROUTER_CREDITS', /out of credits/], [403, 'AI_REFUSED', /moderation declined/], [404, 'OPENROUTER_MODEL_UNAVAILABLE', /can’t find/], [502, 'OPENROUTER_UNAVAILABLE', /No provider/]];
    for (const [status, code, message] of cases) {
      const { fetchImpl } = fakeFetch([json({ error: { message: `upstream said ${KEY}` } }, { status })]);
      const error = await runner(fetchImpl).run(base).catch((failure) => failure);
      expect(error, String(status)).toMatchObject({ code, costUsd: 0 });
      expect(error.message).toMatch(message); expect(error.message).not.toContain(KEY);
    }
    const limited = fakeFetch([json({}, { status: 429, headers: { 'retry-after': '1' } }), json({}, { status: 429 }), json({}, { status: 429 })]);
    await expect(runner(limited.fetchImpl).run(base)).rejects.toMatchObject({ code: 'OPENROUTER_RATE_LIMITED' });
    expect(limited.calls).toHaveLength(3);
    const noKey = createOpenRouterRunner({ getKey: () => '', fetchImpl: vi.fn() });
    await expect(noKey.run(base)).rejects.toMatchObject({ code: 'AI_NOT_CONNECTED', message: expect.stringContaining('Nothing was started') });
    await expect(runner(vi.fn()).run({ ...base, price: null, profile: { ...profile, inputUsdPerMTok: null } })).rejects.toMatchObject({ code: 'AI_PRICE_UNKNOWN' });
  });
  it('tells a spending-cap stop from a model limit, refuses another model, and recovers a cost the stream left out', async () => {
    const capped = fakeFetch([sse(reply('{"answer":"part', { finish: 'length' }))]);
    await expect(runner(capped.fetchImpl).run({ ...base, maxBudgetUsd: 0.02 })).rejects.toMatchObject({ code: 'AI_BUDGET_EXCEEDED', costUsd: 0.0123 });
    const long = fakeFetch([sse(reply('{"answer":"part', { finish: 'length' }))]);
    await expect(runner(long.fetchImpl).run({ ...base, maxBudgetUsd: 100, profile: { ...profile, maxOutputTokens: 4000 } })).rejects.toMatchObject({ code: 'AI_OUTPUT_TRUNCATED' });
    const swapped = fakeFetch([sse(reply('{"answer":"x"}', { model: 'openai/gpt-6-luna' }))]);
    await expect(runner(swapped.fetchImpl).run(base)).rejects.toMatchObject({ code: 'AI_MODEL_MISMATCH' });
    const recovered = fakeFetch([sse(reply('{"answer":"x"}', { cost: null })), json({}, { status: 404 }), json({ data: { total_cost: 0.0042 } })]);
    const result = await runner(recovered.fetchImpl).run(base);
    expect(result.receipt.costUsd).toBe(0.0042);
    expect(recovered.calls[1].url).toBe('https://openrouter.ai/api/v1/generation?id=gen-1');
  });
  it('checks the key for free', async () => {
    const { fetchImpl, calls } = fakeFetch([json({ data: { label: 'Studio', limit_remaining: 42.1, usage: 7.9, is_free_tier: false } })]);
    expect(await runner(fetchImpl).checkKey()).toEqual({ label: 'Studio', limitRemainingUsd: 42.1, usageUsd: 7.9, freeTier: false });
    expect(calls[0].url).toBe('https://openrouter.ai/api/v1/key');
  });
  it('makes strict schemas and strips the nulls they add', () => {
    const strict = toStrictSchema({ type: 'object', required: ['a'], properties: { a: { type: 'string' }, b: { type: 'array', items: { type: 'object', required: [], properties: { c: { type: 'number' } } } } } });
    expect(strict.required).toEqual(['a', 'b']); expect(strict.properties.b.anyOf[0].items.required).toEqual(['c']);
    expect(stripNulls({ a: 'x', b: null, n: [{ c: null }] }, { type: 'object', required: ['a'], properties: { a: {}, b: {}, n: { type: 'array', items: { type: 'object', properties: { c: {} } } } } })).toEqual({ a: 'x', n: [{}] });
  });
});
