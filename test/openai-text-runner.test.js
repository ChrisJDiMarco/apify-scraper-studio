import { describe, expect, it, vi } from 'vitest';
const { createOpenAiTextRunner } = require('../src/main/openai-text-runner.js');
const { json, sse, fakeFetch } = require('./helpers/fetch-fixtures.js');

// OpenAI text through the Responses API (src/main/openai-text-runner.js), with fetch fixtures: no request reaches OpenAI.
const KEY = 'sk-proj-fixture0123456789abcdef';
const schema = { type: 'object', additionalProperties: false, required: ['answer'], properties: { answer: { type: 'string' }, tip: { type: 'string' } } };
const profile = { efforts: ['low', 'medium', 'high'], maxOutputTokens: 64000 };
const price = { inputUsdPerMTok: 2, outputUsdPerMTok: 8, cacheReadUsdPerMTok: 0.5 };
const completed = (text, { model = 'gpt-5.6-terra-2026-09-30', status = 'completed', incomplete = null } = {}) => [
  { type: 'response.created', response: { id: 'resp_1' } },
  { type: 'response.output_text.delta', delta: text.slice(0, 6) },
  { type: 'response.output_text.delta', delta: text.slice(6) },
  { type: status === 'completed' ? 'response.completed' : 'response.incomplete', response: { id: 'resp_1', model, status, ...(incomplete ? { incomplete_details: { reason: incomplete } } : {}), usage: { input_tokens: 10000, input_tokens_details: { cached_tokens: 4000 }, output_tokens: 500 } } },
];
const runner = (fetchImpl) => createOpenAiTextRunner({ getKey: () => KEY, fetchImpl, clock: () => 0 });
const base = { schema, prompt: 'Question', model: 'gpt-5.6-terra', maxBudgetUsd: 1, profile, price };

describe('OpenAI text runner', () => {
  it('sends a strict schema with a supported reasoning level, streams the answer, and prices it from the table', async () => {
    const { fetchImpl, calls } = fakeFetch([sse(completed('{"answer":"Up","tip":null}'), { done: false, split: 9 })]);
    const deltas = [];
    const { output, receipt } = await runner(fetchImpl).run({ ...base, effort: 'high', cachePrefix: 'GUIDE ', onDelta: (piece) => deltas.push(piece) });
    expect(output).toEqual({ answer: 'Up' }); expect(deltas.join('')).toBe('{"answer":"Up","tip":null}');
    const [call] = calls;
    expect(call.url).toBe('https://api.openai.com/v1/responses'); expect(call.headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(call.json).toMatchObject({ model: 'gpt-5.6-terra', stream: true, store: false, input: 'GUIDE Question', reasoning: { effort: 'high' }, text: { format: { type: 'json_schema', name: 'studio_answer', strict: true, schema: { required: ['answer', 'tip'] } } } });
    expect(call.json.instructions).toMatch(/structured output/i);
    // 6,000 fresh input × $2 + 4,000 cached × $0.50 + 500 output × $8, per million.
    expect(receipt).toMatchObject({ provider: 'openai', requestedModel: 'gpt-5.6-terra', actualModel: 'gpt-5.6-terra-2026-09-30', effort: 'high', costUsd: 0.018, structuredOutput: 'native', requestId: 'resp_1' });
  });
  it('leaves out a reasoning level the model doesn’t offer, and retries once with the schema in the prompt when it is refused', async () => {
    const { fetchImpl, calls } = fakeFetch([json({ error: { message: "Invalid schema for response_format 'studio_answer'" } }, { status: 400 }), sse(completed('```json\n{"answer":"Loose"}\n```'), { done: false })]);
    const { output, receipt } = await runner(fetchImpl).run({ ...base, effort: 'max' });
    expect(calls[0].json.reasoning).toBeUndefined();
    expect(calls[1].json.text.format).toEqual({ type: 'json_object' }); expect(calls[1].json.input).toContain('"answer"');
    expect(output).toEqual({ answer: 'Loose' }); expect(receipt).toMatchObject({ structuredOutput: 'schema in prompt', effortNote: 'gpt-5.6-terra doesn’t offer max reasoning here, so it ran at its default.' });
  });
  it('refuses a model without a known price before sending anything, and maps errors to plain messages without the key', async () => {
    const never = vi.fn();
    await expect(runner(never).run({ ...base, price: null, profile: {} })).rejects.toMatchObject({ code: 'AI_PRICE_UNKNOWN', costUsd: 0 });
    expect(never).not.toHaveBeenCalled();
    for (const [status, code, text] of [[401, 'OPENAI_AUTH', 'The OpenAI key was rejected'], [404, 'OPENAI_MODEL_UNAVAILABLE', 'This OpenAI key can’t use gpt-5.6-terra'], [429, 'OPENAI_RATE_LIMITED', 'rate limit or quota']]) {
      const { fetchImpl } = fakeFetch([json({ error: { message: `bad key ${KEY}` } }, { status })]);
      const error = await runner(fetchImpl).run(base).catch((caught) => caught);
      expect(error).toMatchObject({ code, costUsd: 0 }); expect(error.message).toContain(text); expect(error.message).not.toContain(KEY);
    }
  });
  it('tells a spending-cap stop from a model limit, and refuses another model’s answer', async () => {
    const capped = await runner(fakeFetch([sse(completed('{"answer":"cut', { status: 'incomplete', incomplete: 'max_output_tokens' }), { done: false })]).fetchImpl).run({ ...base, maxBudgetUsd: 0.05 }).catch((error) => error);
    expect(capped).toMatchObject({ code: 'AI_BUDGET_EXCEEDED' }); expect(capped.costUsd).toBeGreaterThan(0);
    const limit = await runner(fakeFetch([sse(completed('{"answer":"cut', { status: 'incomplete', incomplete: 'max_output_tokens' }), { done: false })]).fetchImpl).run({ ...base, profile: { ...profile, maxOutputTokens: 1000 } }).catch((error) => error);
    expect(limit).toMatchObject({ code: 'AI_OUTPUT_TRUNCATED' });
    const other = await runner(fakeFetch([sse(completed('{"answer":"x"}', { model: 'gpt-4o' }), { done: false })]).fetchImpl).run(base).catch((error) => error);
    expect(other).toMatchObject({ code: 'AI_MODEL_MISMATCH' });
  });
  it('checks whether the key can see a model for free', async () => {
    const { fetchImpl, calls } = fakeFetch([json({ id: 'gpt-5.6-terra', object: 'model' }), json({ error: { message: 'not found' } }, { status: 404 })]);
    expect(await runner(fetchImpl).checkModel('gpt-5.6-terra')).toEqual({ id: 'gpt-5.6-terra', available: true });
    await expect(runner(fetchImpl).checkModel('gpt-nope')).rejects.toMatchObject({ code: 'OPENAI_MODEL_UNAVAILABLE' });
    expect(calls.map((call) => [call.method, call.url])).toEqual([['GET', 'https://api.openai.com/v1/models/gpt-5.6-terra'], ['GET', 'https://api.openai.com/v1/models/gpt-nope']]);
  });
});
