import { describe, expect, it, vi } from 'vitest';
const { createTextRouter } = require('../src/main/text-router.js');
const { createAiRouting } = require('../src/main/ai-routing.js');
const { createAiCatalog } = require('../src/main/ai-catalog.js');

// Every AI text call (src/main/text-router.js, index.js generateStructuredOutput): the task's connection, model and
// effort from Model routing, a refusal before anything is spent when it can't run, and the streaming contract Ask AI
// relies on: onStream({ type: 'status' }) for progress and onStream({ type: 'text', delta }) for the answer field, streamed
// where the route streams and sent whole, once, where it doesn't.
const schema = { type: 'object', additionalProperties: false, required: ['answer', 'cards'], properties: { answer: { type: 'string' }, cards: { type: 'array', items: { type: 'object' } } } };
const ANSWER = { answer: 'Rising "fast"\nand wide', cards: [{ answer: 'nested is not streamed' }] };
const text = JSON.stringify(ANSWER);
const pieces = (value, size = 5) => Array.from({ length: Math.ceil(value.length / size) }, (_, index) => value.slice(index * size, (index + 1) * size));
const catalog = createAiCatalog({ dataDir: '', codexHome: '/nonexistent-codex-home', fetchImpl: async () => { throw new Error('offline'); } });
// A streaming runner sends the raw JSON in pieces; a final-only runner (Codex, an older Claude Code) just answers.
const streaming = (provider) => ({ run: vi.fn(async ({ onDelta }) => { for (const piece of pieces(text)) onDelta?.(piece); return { output: ANSWER, receipt: { provider, costUsd: 0.01 } }; }) });
const finalOnly = (provider) => ({ run: vi.fn(async () => ({ output: ANSWER, receipt: { provider, costUsd: provider === 'codex' ? null : 0.02 }, stdout: '' })) });
function harness(routing = {}, { ready = () => true, openrouterPrice = true } = {}) {
  const settings = { aiRouting: { version: 1, defaults: { text: { route: 'auto', model: 'claude-opus-5-5' } }, tasks: {}, ...routing } };
  const routes = createAiRouting({ getSettings: () => settings, catalog: { ...catalog, profile: (route, model, kind) => (route === 'openrouter' ? { id: model, structured: 'native', reasoning: true, efforts: ['low', 'medium', 'high'], contextTokens: 200000 } : catalog.profile(route, model, kind)), priceFor: (route, model, kind, options) => (route === 'openrouter' ? (openrouterPrice ? { basis: 'tokens', inputUsdPerMTok: 3, outputUsdPerMTok: 15, known: true, source: 'openrouter' } : { basis: 'tokens', known: false }) : catalog.priceFor(route, model, kind, options)) } });
  const connections = { require: vi.fn(async (route) => { if (!ready(route)) throw Object.assign(new Error('Add an OpenRouter key in Settings, AI connections. Nothing was started.'), { code: 'AI_NOT_CONNECTED' }); return route === 'auto' ? 'claude-api' : route; }) };
  const runners = { 'claude-api': streaming('anthropic'), openrouter: streaming('openrouter'), openai: streaming('openai'), codex: finalOnly('codex'), claude: finalOnly('claude') };
  const written = {}; const apiRequests = new Map();
  const router = createTextRouter({ routing: routes, connections, runners, catalog: { ...catalog, profile: routes ? (route, model) => (route === 'openrouter' ? { structured: 'native', reasoning: true } : null) : null, priceFor: (route) => (route === 'openrouter' && openrouterPrice ? { known: true, inputUsdPerMTok: 3, outputUsdPerMTok: 15 } : { known: false }) }, writeJson: (target, value) => { written[target] = value; }, apiRequests, maxBudgetUsd: () => 1 });
  return { router, runners, connections, written, apiRequests };
}
const collect = () => { const events = []; return { events, onStream: (event) => events.push(event), deltas: () => events.filter((event) => event.type === 'text').map((event) => event.delta) }; };

describe('text router streaming contract', () => {
  it.each([
    ['the Anthropic API key', {}, 'claude-api', 'Writing with Claude Opus 5.5 · Anthropic API key'],
    ['OpenRouter', { tasks: { 'assistant.ask-ai': { route: 'openrouter', model: 'anthropic/claude-opus-5.5' } } }, 'openrouter', 'Writing with anthropic/claude-opus-5.5 · OpenRouter'],
    ['OpenAI', { tasks: { 'assistant.ask-ai': { route: 'openai', model: 'gpt-5.6-terra' } } }, 'openai', 'Writing with GPT-5.6 Terra · OpenAI API key'],
  ])('streams only the answer field as it is written on %s', async (_, routing, runnerId, status) => {
    const h = harness(routing); const stream = collect();
    const result = await h.router.run({ taskId: 'assistant.ask-ai', schema, prompt: 'Q', cachePrefix: 'GUIDE', outputPath: '/answer.json', jobId: 'help-1::0', onStream: stream.onStream });
    expect(stream.events[0]).toEqual({ type: 'status', text: status });
    expect(stream.deltas().length).toBeGreaterThan(2);
    expect(stream.deltas().join('')).toBe(ANSWER.answer);
    expect(h.runners[runnerId].run).toHaveBeenCalledWith(expect.objectContaining({ schema, prompt: 'Q', cachePrefix: 'GUIDE', maxBudgetUsd: 1, signal: expect.any(AbortSignal) }));
    expect(h.written['/answer.json']).toEqual(ANSWER);
    expect(result.receipt).toMatchObject({ taskId: 'assistant.ask-ai', route: runnerId, metered: true });
    expect(h.apiRequests.size).toBe(0); // the call's AbortController is gone once it finished
  });
  it('sends the whole answer once on routes that answer at the end (Codex, an older Claude Code)', async () => {
    for (const [route, runnerId] of [['codex', 'codex'], ['claude', 'claude']]) {
      const h = harness({ defaults: { text: { route, model: route === 'codex' ? '' : 'claude-opus-5-5' } } }); const stream = collect();
      const result = await h.router.run({ taskId: 'assistant.ask-ai', schema, prompt: 'Q', onStream: stream.onStream });
      expect(stream.deltas()).toEqual([ANSWER.answer]);
      expect(h.runners[runnerId].run).toHaveBeenCalledWith(expect.objectContaining({ onDelta: expect.any(Function), model: route === 'codex' ? '' : 'claude-opus-5-5' }));
      expect(result.receipt).toMatchObject({ route: runnerId, metered: route !== 'codex' });
    }
    // Even an answer with no text calls onStream once.
    const h = harness({ defaults: { text: { route: 'codex', model: '' } } }); h.runners.codex.run.mockResolvedValueOnce({ output: { answer: '', cards: [] }, receipt: {} });
    const stream = collect(); await h.router.run({ taskId: 'assistant.ask-ai', schema, prompt: 'Q', onStream: stream.onStream });
    expect(stream.deltas()).toEqual(['']);
  });
  it('passes the routed model and effort, and a run’s snapshot wins over today’s routing', async () => {
    const h = harness({ tasks: { 'research.tagging': { model: 'claude-haiku-5-5', effort: 'medium' } } });
    await h.router.run({ taskId: 'research.tagging', schema, prompt: 'Q' });
    expect(h.runners['claude-api'].run).toHaveBeenLastCalledWith(expect.objectContaining({ model: 'claude-haiku-5-5', effort: 'medium' }));
    const run = { ai: { version: 2, routing: { 'research.tagging': { taskId: 'research.tagging', kind: 'text', route: 'openrouter', model: 'deepseek/deepseek-v4', effort: 'low', metered: true, price: { known: true, inputUsdPerMTok: 0.3, outputUsdPerMTok: 1.2 } } } } };
    await h.router.run({ taskId: 'research.tagging', run, schema, prompt: 'Q' });
    expect(h.runners.openrouter.run).toHaveBeenLastCalledWith(expect.objectContaining({ model: 'deepseek/deepseek-v4', effort: 'low', price: expect.objectContaining({ inputUsdPerMTok: 3 }) }));
    // A call that names no task keeps the behavior from before Model routing: the text default with the model it passes.
    await h.router.run({ schema, prompt: 'Q', model: 'claude-sonnet-5-5', effort: 'high' });
    expect(h.runners['claude-api'].run).toHaveBeenLastCalledWith(expect.objectContaining({ model: 'claude-sonnet-5-5', effort: 'high' }));
  });
  it('refuses before anything is spent when the job can’t run where it is routed', async () => {
    const off = harness({ tasks: { 'data.threads': { route: 'openrouter', model: 'deepseek/deepseek-v4' } } }, { ready: (route) => route !== 'openrouter' });
    await expect(off.router.run({ taskId: 'data.threads', schema, prompt: 'Q' })).rejects.toThrow('Add an OpenRouter key in Settings, AI connections. Nothing was started.');
    expect(off.runners.openrouter.run).not.toHaveBeenCalled();
    const wrong = harness({ defaults: { text: { route: 'codex', model: '' } }, tasks: { 'data.threads': { model: 'claude-opus-5-5' } } });
    await expect(wrong.router.run({ taskId: 'data.threads', schema, prompt: 'Q' })).rejects.toMatchObject({ code: 'AI_ROUTING_PROBLEM', message: expect.stringMatching(/can’t run on Codex.*Nothing was started\.$/) });
    expect(wrong.runners.codex.run).not.toHaveBeenCalled();
    await expect(harness().router.run({ taskId: 'pictures.kit-image', schema, prompt: 'Q' })).rejects.toThrow('isn’t a writing job');
    await expect(harness().router.run({ taskId: 'no.such-task', schema, prompt: 'Q' })).rejects.toThrow('Unknown AI job');
  });
});
