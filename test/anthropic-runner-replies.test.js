import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import runner from '../src/shared/anthropic-runner.js';

// How the Anthropic API route reads a finished reply (src/shared/anthropic-runner.js settle): every text block joined in
// order, JSON.parse, then the lenient reader (src/shared/json-reply.js) on both the structured-output path and the
// schema-in-prompt retry that follows a refused grammar. A reply that still can't be read fails with the same message and
// code as before, keeps what it cost, and carries the reply's text (keys redacted, 200 KB at most) for diagnostics and
// for Ask AI to keep its answer. A fake SDK client stands in for the API: nothing here is billed.
const Anthropic = createRequire(import.meta.url)('@anthropic-ai/sdk').default;
const { createAnthropicRunner, usageCost, RAW_TEXT_BYTES } = runner;

const KEY = 'sk-ant-api03-test-key-0123456789abcdefghij';
const schema = { type: 'object', additionalProperties: false, required: ['answer', 'followUps'], properties: { answer: { type: 'string' }, followUps: { type: 'array', items: { type: 'string' } } } };
const USAGE = { input_tokens: 1200, output_tokens: 300, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
const COST = usageCost('claude-opus-5-5', USAGE);
const THINKING = { type: 'thinking', thinking: '', signature: 'sig' };
const reply = (content, overrides = {}) => ({ id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content, stop_reason: 'end_turn', stop_details: null, usage: USAGE, ...overrides });
const modelInfo = (id) => ({ type: 'model', id, max_tokens: 128000, capabilities: { structured_outputs: { supported: true }, thinking: { supported: true, types: { adaptive: { supported: true } } }, effort: { supported: true, low: { supported: true }, medium: { supported: true }, high: { supported: true }, xhigh: { supported: true }, max: { supported: true } } } });
const refused = () => Anthropic.APIError.generate(400, { type: 'error', error: { type: 'invalid_request_error', message: 'The compiled grammar is too large, which would cause performance issues. Simplify your tool schemas or reduce the number of strict tools.' } }, undefined, new Headers({ 'request-id': 'req_400' }));

// Answers from a script; a stream also emits its text pieces to `on('text')` listeners, as the SDK does.
function setup(answer) {
  const streams = [];
  class FakeAnthropic {
    messages = {
      stream: (params) => {
        streams.push(params);
        const outcome = typeof answer === 'function' ? answer(params) : answer;
        const listeners = [];
        return {
          request_id: 'req_stream', currentMessage: undefined,
          on(event, listener) { if (event === 'text') listeners.push(listener); return this; },
          finalMessage() {
            if (outcome?.error) return Promise.reject(outcome.error);
            this.currentMessage = outcome;
            for (const block of outcome.content || []) if (block.type === 'text') for (let at = 0; at < block.text.length; at += 7) for (const listener of listeners) listener(block.text.slice(at, at + 7));
            return Promise.resolve(outcome);
          },
        };
      },
    };
    models = { retrieve: async (id) => modelInfo(id) };
  }
  return { streams, api: createAnthropicRunner({ apiKey: KEY, Client: FakeAnthropic, clock: () => 1000 }) };
}
// The schema is refused as a grammar, so the retry writes it into the prompt and the model writes the JSON itself.
const afterGrammarRefusal = (text) => setup((params) => (params.output_config?.format ? { error: refused() } : reply([THINKING, { type: 'text', text }])));
const failure = (promise) => promise.then(() => { throw new Error('Expected the run to fail.'); }, (error) => error);
const run = (api, extra = {}) => api.run({ schema, prompt: 'hey what can you do', model: 'claude-opus-5-5', effort: 'medium', ...extra });

describe('Anthropic API replies with more than one text block', () => {
  it('joins text blocks split around a thinking block, and notes it on the receipt', async () => {
    const { api } = setup(reply([THINKING, { type: 'text', text: '{"answer":"I can find tre' }, THINKING, { type: 'text', text: 'nds.","followUps":["How?"]}' }]));
    const deltas = [];
    const { output, receipt } = await run(api, { onDelta: (piece) => deltas.push(piece) });
    expect(output).toEqual({ answer: 'I can find trends.', followUps: ['How?'] });
    expect(receipt).toMatchObject({ textBlocks: 2, costUsd: COST });
    expect(receipt).not.toHaveProperty('parse'); // the joined text was valid JSON as it stood
    expect(deltas.join('')).toBe('{"answer":"I can find trends.","followUps":["How?"]}');
  });
  it('reads the longer of two whole answers in separate blocks', async () => {
    const { api } = setup(reply([{ type: 'text', text: '{"answer":"Draft","followUps":[]}' }, THINKING, { type: 'text', text: '{"answer":"The final, fuller answer.","followUps":[]}' }]));
    const { output, receipt } = await run(api);
    expect(output).toEqual({ answer: 'The final, fuller answer.', followUps: [] });
    expect(receipt).toMatchObject({ textBlocks: 2, parse: 'extracted' });
  });
  it('keeps one block’s receipt exactly as before', async () => {
    const { api } = setup(reply([THINKING, { type: 'text', text: '{"answer":"One block","followUps":[]}' }]));
    const { receipt } = await run(api);
    expect(receipt).not.toHaveProperty('textBlocks');
    expect(receipt).not.toHaveProperty('parse');
    expect(receipt).not.toHaveProperty('structuredOutput');
  });
});

describe('Anthropic API replies written with the schema in the prompt (after a refused grammar)', () => {
  it.each([
    ['raw line breaks inside the answer', '{"answer":"Here is what I can do:\n- Find trends\n- Write reports","followUps":[]}', { answer: 'Here is what I can do:\n- Find trends\n- Write reports', followUps: [] }, 'repaired'],
    ['trailing commas', '{"answer":"Plenty.","followUps":["Show me","Costs?",],}', { answer: 'Plenty.', followUps: ['Show me', 'Costs?'] }, 'repaired'],
    ['prose around the object', 'Sure, here is the JSON you asked for: {"answer":"Wrapped in prose.","followUps":[]} Let me know!', { answer: 'Wrapped in prose.', followUps: [] }, 'extracted'],
    ['a code fence with prose', 'Here you go:\n```json\n{"answer":"Fenced.","followUps":[]}\n```\nAnything else?', { answer: 'Fenced.', followUps: [] }, 'fence'],
    ['prose with braces before the object', 'Placeholders look like {name} or {topic}. {"answer":"After the braces.","followUps":[]}', { answer: 'After the braces.', followUps: [] }, 'extracted'],
    ['two objects', '{"answer":"Short"}\n{"answer":"The complete answer, with more.","followUps":["Next?"]}', { answer: 'The complete answer, with more.', followUps: ['Next?'] }, 'extracted'],
  ])('reads %s', async (_, text, expected, parse) => {
    const { api, streams } = afterGrammarRefusal(text);
    const { output, receipt } = await run(api);
    expect(streams).toHaveLength(2);
    expect(streams[1].messages[0].content).toContain('ANSWER FORMAT');
    expect(output).toEqual(expected);
    expect(receipt).toMatchObject({ structuredOutput: 'schema in prompt', parse, costUsd: COST });
  });

  it('fails as before on an unescaped quote it can’t repair, keeping the cost and the reply for diagnostics', async () => {
    const text = '{"answer":"I can run a "quick scan" for you, write reports and draw pictures.","followUps":["Start a scan"]}';
    const { api } = afterGrammarRefusal(text);
    const error = await failure(run(api));
    expect(error.message).toBe('Claude returned structured output that is not valid JSON. No unvalidated answer was saved.');
    expect(error).toMatchObject({ code: 'CLAUDE_INVALID_RESULT', costUsd: COST, requestId: 'req_stream', stopReason: 'end_turn', schemaInPrompt: true, blockTypes: ['thinking', 'text'], rawText: text, rawTextLength: text.length });
  });

  // A schema shaped like Ask AI's, whose answers hold objects of their own.
  const wide = { type: 'object', additionalProperties: false, required: ['answer', 'pages', 'image', 'show'], properties: { answer: { type: 'string' }, pages: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['page', 'label'], properties: { page: { type: 'string' }, label: { type: 'string' } } } }, image: { type: 'object', additionalProperties: false, required: ['create', 'title'], properties: { create: { type: 'boolean' }, title: { type: 'string' } } }, show: { type: 'object', additionalProperties: false, required: ['autoStart'], properties: { autoStart: { type: 'boolean' } } } } };
  const whole = (answer) => `{"answer":"${answer}","pages":[{"page":"research","label":"Open"}],"image":{"create":false,"title":""},"show":{"autoStart":false}}`;
  it.each([
    ['one stray quote', whole('Up to 12" wide.')],
    ['a missing last brace', whole('No last brace.').slice(0, -1)],
    ['a quoted brace', whole('Type "}" to close.')],
  ])('never answers with an object from inside a reply with %s', async (_, text) => {
    const error = await failure(run(afterGrammarRefusal(text).api, { schema: wide }));
    expect(error).toMatchObject({ code: 'CLAUDE_INVALID_RESULT', message: 'Claude returned structured output that is not valid JSON. No unvalidated answer was saved.', costUsd: COST, schemaInPrompt: true, rawText: text });
  });
  it('reads the answer, not a schema echoed before it or a fence inside its own text', async () => {
    const echo = await run(afterGrammarRefusal(`The schema is:\n${JSON.stringify(wide)}\n\nMy answer:\n${whole('Hi.')}`).api, { schema: wide });
    expect(echo.output).toEqual({ answer: 'Hi.', pages: [{ page: 'research', label: 'Open' }], image: { create: false, title: '' }, show: { autoStart: false } });
    expect(echo.receipt).toMatchObject({ parse: 'extracted' });
    const fenced = await run(afterGrammarRefusal('{"answer":"Send an empty filter:\n```json\n{}\n```\nThat’s all.","followUps":[]}').api);
    expect(fenced.output).toEqual({ answer: 'Send an empty filter:\n```json\n{}\n```\nThat’s all.', followUps: [] });
    expect(fenced.receipt).toMatchObject({ parse: 'repaired' });
  });

  it('redacts a key the reply echoes and caps the kept text at 200 KB', async () => {
    const echoed = await failure(run(afterGrammarRefusal(`{"answer":"Your key ${KEY} is "set"."}`).api));
    expect(echoed.rawText).toBe('{"answer":"Your key sk-ant-… is "set"."}');
    expect(echoed.rawText).not.toContain(KEY);
    const long = `{"answer":"${'x'.repeat(300 * 1024)} "quoted" end"}`;
    const capped = await failure(run(afterGrammarRefusal(long).api));
    expect(capped.code).toBe('CLAUDE_INVALID_RESULT');
    expect(Buffer.byteLength(capped.rawText)).toBeLessThanOrEqual(RAW_TEXT_BYTES);
    expect(capped.rawTextLength).toBe(long.length);
  });
});

describe('Anthropic API structured output path', () => {
  it('falls back to the lenient reader there too, and still refuses what isn’t an object', async () => {
    const fenced = await run(setup(reply([THINKING, { type: 'text', text: '```json\n{"answer":"Fenced anyway","followUps":[]}\n```' }])).api);
    expect(fenced.output).toEqual({ answer: 'Fenced anyway', followUps: [] });
    expect(fenced.receipt).toMatchObject({ parse: 'fence' });
    expect(fenced.receipt).not.toHaveProperty('structuredOutput');
    const broken = await failure(run(setup(reply([THINKING, { type: 'text', text: '{"answer":' }])).api));
    expect(broken).toMatchObject({ code: 'CLAUDE_INVALID_RESULT', schemaInPrompt: false, rawText: '{"answer":', blockTypes: ['thinking', 'text'], costUsd: COST });
    expect(await failure(run(setup(reply([{ type: 'text', text: '["pong"]' }])).api))).toMatchObject({ code: 'CLAUDE_MISSING_STRUCTURED_OUTPUT' });
  });
});
