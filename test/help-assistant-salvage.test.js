import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

// Ask AI keeps its answer when the reply around it can't be read (src/main/help-assistant.js salvageReply, used by
// askHelp): the answer is read from the error's rawText, checked by cleanReply like any answer, with one plain note under
// it, followUps only when they parse, and no cards or buttons. The receipt carries the call's real cost. The full chain
// here is askHelp → text-router.js → the Anthropic API runner with a fake SDK client, whose schema is refused as a
// grammar and whose schema-in-prompt reply has an unescaped quote: nothing is billed.
const require = createRequire(import.meta.url);
const help = require('../src/main/help-assistant.js');
const { createAnthropicRunner, usageCost } = require('../src/shared/anthropic-runner.js');
const { createTextRouter } = require('../src/main/text-router.js');
const { createAiRouting } = require('../src/main/ai-routing.js');
const { createAiCatalog } = require('../src/main/ai-catalog.js');
const { createAiDiagnostics } = require('../src/main/ai-diagnostics.js');
const Anthropic = require('@anthropic-ai/sdk').default;

const NOTE = 'Some extras (cards and buttons) couldn’t be read this time.';
const USAGE = { input_tokens: 30000, output_tokens: 900, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
const ANSWER = 'I can run a "quick scan" on a topic, write trend reports, draft channel posts and answer questions about your studio.';
// What the model wrote with the schema in the prompt: valid but for the unescaped quotes in the answer.
const BROKEN = `{"answer":"${ANSWER}","pages":[],"followUps":["Start a quick scan","What does a scan cost?",],"actions":[{"kind":"quick-scan","label":"Scan","target":"AI search","params":[]}],"cards":[{"type":"metric","ref":"","title":"Spend","note":"","items":["$4"],"actionIndexes":[0]}],"lookups":[],"title":"What I can do"}`;
const invalid = (rawText, extra = {}) => Object.assign(new Error('Claude returned structured output that is not valid JSON. No unvalidated answer was saved.'), { code: 'CLAUDE_INVALID_RESULT', costUsd: 0.0421, stopReason: 'end_turn', schemaInPrompt: true, blockTypes: ['thinking', 'text'], rawText, route: 'claude-api', model: 'claude-opus-5-5', ...extra });

const folders = [];
afterEach(() => { for (const folder of folders.splice(0)) fs.rmSync(folder, { recursive: true, force: true }); });

describe('salvageReply', () => {
  it('keeps the whole answer past its unescaped quotes, with the note, followUps that parse, and the real cost', () => {
    const salvaged = help.salvageReply(invalid(BROKEN));
    expect(salvaged.output).toEqual({ answer: `${ANSWER}\n\n${NOTE}`, followUps: ['Start a quick scan', 'What does a scan cost?'] });
    expect(salvaged.output).not.toHaveProperty('cards');
    expect(salvaged.output).not.toHaveProperty('actions');
    expect(salvaged.receipt).toEqual({ costUsd: 0.0421, provider: 'claude-api', requestedModel: 'claude-opus-5-5', salvaged: true });
    expect(help.SALVAGE_NOTE).toBe(NOTE);
  });

  it('drops followUps that don’t parse, keeps raw line breaks, and fits the note inside the answer limit', () => {
    expect(help.salvageReply(invalid('{"answer":"Line one\nLine two "quoted"","followUps":["open'))).toMatchObject({ output: { answer: `Line one\nLine two "quoted"\n\n${NOTE}`, followUps: [] } });
    expect(help.salvageReply(invalid('{"answer":"Fine "x"","followUps":[1,2]}')).output.followUps).toEqual([]);
    const long = help.salvageReply(invalid(`{"answer":"${'a'.repeat(13000)} "q"","followUps":[]}`));
    expect(long.output.answer.length).toBeLessThanOrEqual(12000);
    expect(long.output.answer.endsWith(NOTE)).toBe(true);
    expect(help.salvageReply(invalid('{"answer":"x"}', { costUsd: null })).receipt.costUsd).toBeNull();
  });

  it('keeps a reading round’s lookups when they parse, and reads the answer to the schema’s next key', () => {
    const reading = '{"answer":"Let me check the "Zero-click search" report first.","pages":[],"followUps":[],"lookups":[{"kind":"report","target":"Zero-click search report"},{"kind":7},"x"]}';
    expect(help.salvageReply(invalid(reading)).output.lookups).toEqual([{ kind: 'report', target: 'Zero-click search report' }]);
    expect(help.salvageReply(invalid(BROKEN)).output).not.toHaveProperty('lookups'); // an empty list adds nothing
    expect(help.salvageReply(invalid('{"answer":"x","lookups":"none"}')).output).not.toHaveProperty('lookups');
    const keys = Object.keys(help.helpSchema().properties);
    expect(help.salvageReply(invalid('{"answer":"Pick "Lite", "Standard": both work.","pages":[]}'), { keys }).output.answer).toBe(`Pick "Lite", "Standard": both work.\n\n${NOTE}`);
    expect(help.salvageReply(invalid('{"answer":"Use {"url": "https://example.com"} as the source.","pages":[]}'), { keys }).output.answer).toBe(`Use {"url": "https://example.com"} as the source.\n\n${NOTE}`);
  });

  it('salvages nothing from other failures, a reply without an answer, or one whose answer never ends', () => {
    expect(help.salvageReply(Object.assign(new Error('Job cancelled.'), { code: 'CANCELLED', rawText: '{"answer":"x"}' }))).toBeNull();
    expect(help.salvageReply(invalid('{"answer":"x"}', { code: 'CLAUDE_REFUSED' }))).toBeNull();
    expect(help.salvageReply(invalid(undefined))).toBeNull();
    expect(help.salvageReply(invalid('{"title":"No answer here"}'))).toBeNull();
    expect(help.salvageReply(invalid('{"answer":"   ","followUps":[]}'))).toBeNull();
    expect(help.salvageReply(invalid('{"answer":"Cut off mid-sent'))).toBeNull();
    expect(help.salvageReply(null)).toBeNull();
    // OpenRouter and OpenAI fail with AI_INVALID_RESULT; their answers are kept the same way.
    expect(help.salvageReply(invalid('{"answer":"Use "Run"."}', { code: 'AI_INVALID_RESULT', route: 'openrouter', model: 'meta/llama-5' }))).toMatchObject({ output: { answer: `Use "Run".\n\n${NOTE}` }, receipt: { provider: 'openrouter', requestedModel: 'meta/llama-5' } });
  });
});

describe('askHelp with a reading round that couldn’t be read', () => {
  it('still reads what the round asked for, then answers from the next round, adding up both calls', async () => {
    const reading = '{"answer":"Let me check the "Zero-click search" report first.","pages":[],"followUps":[],"lookups":[{"kind":"report","target":"Zero-click search report"}],"cards":[],"title":""}';
    const rounds = []; const read = [];
    const reply = await help.askHelp({ question: 'What did the zero-click report find?' }, {
      context: () => ({ layout: 'simple', role: 'admin' }), guide: 'Guide',
      readLookup: async (lookup) => { read.push(lookup); return { ...lookup, found: true, title: 'Zero-click search', text: 'Zero-click answers grew 12% this month.' }; },
      generate: async ({ round }) => {
        rounds.push(round);
        if (round === 0) throw invalid(reading, { costUsd: 0.05 });
        return { output: { answer: 'Zero-click answers grew 12% this month.', followUps: [] }, receipt: { costUsd: 0.1, provider: 'claude-api', requestedModel: 'claude-opus-5-5' } };
      },
    });
    expect(rounds).toEqual([0, 1]);
    expect(read).toEqual([{ kind: 'report', target: 'Zero-click search report' }]);
    expect(reply.answer).toBe('Zero-click answers grew 12% this month.');
    expect(reply.read).toEqual([{ kind: 'report', title: 'Zero-click search' }]);
    expect(reply.receipt).toEqual({ costUsd: 0.15, model: 'claude-opus-5-5', route: 'claude-api' });
  });
});

describe('Ask AI with an unreadable reply, end to end through the router and the Anthropic API runner', () => {
  const catalog = createAiCatalog({ dataDir: '', codexHome: '/nonexistent-codex-home', fetchImpl: async () => { throw new Error('offline'); } });
  const refused = () => Anthropic.APIError.generate(400, { type: 'error', error: { type: 'invalid_request_error', message: 'The compiled grammar is too large, which would cause performance issues.' } }, undefined, new Headers({ 'request-id': 'req_400' }));
  // The fake SDK refuses the structured-output request and answers the schema-in-prompt retry with `text`, streaming it.
  function fakeClient(text, calls) {
    return class FakeAnthropic {
      messages = {
        stream: (params) => {
          calls.push(params); const listeners = [];
          return {
            request_id: 'req_retry', currentMessage: undefined,
            on(event, listener) { if (event === 'text') listeners.push(listener); return this; },
            finalMessage() {
              if (params.output_config?.format) return Promise.reject(refused());
              this.currentMessage = { model: params.model };
              for (let at = 0; at < text.length; at += 11) for (const listener of listeners) listener(text.slice(at, at + 11));
              return Promise.resolve({ id: 'msg_1', type: 'message', role: 'assistant', model: params.model, content: [{ type: 'thinking', thinking: '', signature: 's' }, { type: 'text', text }], stop_reason: 'end_turn', usage: USAGE });
            },
          };
        },
      };
      models = { retrieve: async (id) => ({ id, max_tokens: 128000, capabilities: { structured_outputs: { supported: true }, thinking: { supported: true, types: { adaptive: { supported: true } } }, effort: { supported: true, medium: { supported: true } } } }) };
    };
  }
  function studio(text) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ask-salvage-')); folders.push(dir);
    const calls = [];
    const settings = { aiRouting: { version: 1, defaults: { text: { route: 'claude-api', model: 'claude-opus-5-5' } }, tasks: {} } };
    const routing = createAiRouting({ getSettings: () => settings, catalog });
    const runner = createAnthropicRunner({ apiKey: 'sk-ant-api03-fixture-0123456789abcdef', Client: fakeClient(text, calls) });
    const diagnostics = createAiDiagnostics({ dir });
    const router = createTextRouter({ routing, connections: { require: async (route) => route }, runners: { 'claude-api': runner }, catalog, writeJson: () => {}, maxBudgetUsd: () => 2, onInvalidResult: (event) => diagnostics.record(event) });
    const log = []; let shown = '';
    const progress = { step: (step) => log.push(['step', step.id, step.status]), text: (delta) => { shown += delta; }, reset: () => { shown = ''; }, title: () => {}, status: (status) => log.push(['status', status]) };
    const ask = (question) => help.askHelp({ question }, {
      context: () => ({ layout: 'simple', role: 'admin' }), guide: 'Guide', progress,
      generate: ({ schema, prefix, body, onStream }) => router.run({ taskId: 'assistant.ask-ai', schema, prompt: body, cachePrefix: prefix, onStream, streamField: 'answer' }),
    });
    return { ask, calls, dir, log, shown: () => shown };
  }

  it('answers "hey what can you do" with the answer it could read, the note, and the real cost', async () => {
    const h = studio(BROKEN);
    const reply = await h.ask('hey what can you do');
    expect(h.calls).toHaveLength(2); // the refused grammar, then the schema in the prompt
    expect(reply.answer).toBe(`${ANSWER}\n\n${NOTE}`);
    expect(reply.followUps).toEqual(['Start a quick scan', 'What does a scan cost?']);
    expect(reply.cards).toEqual([]);
    expect(reply.actions).toEqual([]);
    expect(reply.receipt).toEqual({ costUsd: usageCost('claude-opus-5-5', USAGE), model: 'claude-opus-5-5', route: 'claude-api' });
    // What the person watched ends as the saved answer, and the reply finished normally.
    expect(h.shown()).toBe(reply.answer);
    expect(h.log.filter((row) => row[0] === 'status').map((row) => row[1])).toEqual(['thinking', 'finishing']);
    // The unreadable reply was also kept as a local diagnostic.
    const [file] = fs.readdirSync(h.dir);
    expect(JSON.parse(fs.readFileSync(path.join(h.dir, file), 'utf8'))).toMatchObject({ taskId: 'assistant.ask-ai', route: 'claude-api', model: 'claude-opus-5-5', schemaInPrompt: true, blockTypes: ['thinking', 'text'], text: BROKEN });
  });

  // A whole Ask AI reply (image, scan and show objects inside) whose own object can't be read: one stray quote, a missing
  // last brace, or a quoted brace. None of its inner objects may stand in for the reply.
  const whole = (answer) => `{"answer":"${answer}","pages":[{"page":"research","label":"Research programs"}],"followUps":["Start a quick scan"],"image":{"create":false,"title":"","prompt":"","size":"1024x1024","family":"none"},"actions":[],"scan":{"topic":"","depth":"lite","platforms":[]},"show":{"autoStart":false,"steps":[]},"lookups":[],"cards":[],"remember":[],"summary":"","title":"What I can do"}`;
  it.each([
    ['one stray quote', whole('Pictures work best up to 12" wide. I can also run a quick scan or write a report.'), 'Pictures work best up to 12" wide. I can also run a quick scan or write a report.'],
    ['a missing last brace', whole('I can run a quick scan or write a report.').slice(0, -1), 'I can run a quick scan or write a report.'],
    ['a quoted brace', whole('Type "}" to close a group, then press Run.'), 'Type "}" to close a group, then press Run.'],
  ])('keeps the answer of a whole reply with %s, and leaves a diagnostic', async (_, text, answer) => {
    const h = studio(text);
    const reply = await h.ask('hey what can you do');
    expect(reply.answer).toBe(`${answer}\n\n${NOTE}`);
    expect(reply.followUps).toEqual(['Start a quick scan']);
    expect(reply.pages).toEqual([]);
    expect(reply.receipt.costUsd).toBe(usageCost('claude-opus-5-5', USAGE));
    expect(fs.readdirSync(h.dir)).toHaveLength(1);
  });

  it('keeps today’s error when no answer can be read', async () => {
    const h = studio('Sorry, I ran into a problem {"oops": "not "closed"}');
    const error = await h.ask('hey what can you do').catch((caught) => caught);
    expect(error).toMatchObject({ code: 'CLAUDE_INVALID_RESULT', message: 'Claude returned structured output that is not valid JSON. No unvalidated answer was saved.', costUsd: usageCost('claude-opus-5-5', USAGE) });
    expect(error.partial).toBe('');
  });
});

describe('salvage when Claude answers in plain prose', () => {
  it('uses the whole prose reply as the answer after a schema-in-prompt retry', async () => {
    const { salvageReply, SALVAGE_NOTE } = await import('../src/main/help-assistant.js');
    const rawText = 'Neither of your latest runs failed. Both were **cancelled**.\n\n- Research run: cancelled while collecting.';
    const saved = salvageReply(Object.assign(new Error('x'), { code: 'CLAUDE_INVALID_RESULT', rawText, schemaInPrompt: true, costUsd: 0.2 }));
    expect(saved.output.answer).toBe(`${rawText}\n\n${SALVAGE_NOTE}`);
    expect(saved.receipt.costUsd).toBe(0.2);
  });
  it('does not treat broken JSON or a native reply as prose', async () => {
    const { salvageReply } = await import('../src/main/help-assistant.js');
    expect(salvageReply(Object.assign(new Error('x'), { code: 'CLAUDE_INVALID_RESULT', rawText: '{"pages": [', schemaInPrompt: true }))).toBeNull();
    expect(salvageReply(Object.assign(new Error('x'), { code: 'CLAUDE_INVALID_RESULT', rawText: 'Plain words', schemaInPrompt: false }))).toBeNull();
  });
});
