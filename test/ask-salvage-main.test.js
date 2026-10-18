import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

// "hey what can you do" in the real main process (src/main/index.js, loaded as the Mac app runs it) on the Anthropic API
// key route: the API refuses the Ask AI schema as a grammar, the schema-in-prompt retry comes back with an unescaped
// quote, and the answer is still saved through answerHelp with the note, no cards or buttons, its real cost on the receipt
// and counted once in the daily spend total, plus one diagnostics file. The SDK client is a fake: nothing is billed.
const mainPath = path.resolve('src/main/index.js');
const mainRequire = createRequire(mainPath);
const realRunner = mainRequire('../shared/anthropic-runner');
const Anthropic = mainRequire('@anthropic-ai/sdk').default;
const KEY = 'sk-ant-api03-fixture-key-0123456789abcdef';
const NOTE = 'Some extras (cards and buttons) couldn’t be read this time.';
const USAGE = { input_tokens: 31000, output_tokens: 700, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
const ANSWER = 'I can run a "quick scan" on any topic, write trend reports and draft posts for your channels.';
const REPLY = `Here is my answer:\n{"answer":"${ANSWER}","pages":[],"followUps":["Start a quick scan","What does it cost?"],"image":{"create":false,"title":"","prompt":"","size":"1536x1024","family":"none"},"actions":[{"kind":"open","label":"Open Trends","target":"trends","params":[]}],"show":{"autoStart":false,"steps":[]},"lookups":[],"cards":[{"type":"metric","ref":"","title":"Spend","note":"","items":["Today | $2"],"actionIndexes":[0]}],"remember":[],"summary":"","title":"What Ask AI can do"}`;
const cleanups = [];
afterEach(() => { for (const done of cleanups.splice(0)) done(); });

function boot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ask-salvage-main-'));
  fs.writeFileSync(path.join(root, 'data.json'), JSON.stringify({ settings: { aiProvider: 'claude-api' } }));
  const streams = []; const handlers = new Map();
  class FakeAnthropic {
    messages = {
      stream: (params) => {
        streams.push(params); const listeners = [];
        return {
          request_id: `req_${streams.length}`, currentMessage: undefined,
          on(event, listener) { if (event === 'text') listeners.push(listener); return this; },
          finalMessage() {
            if (params.output_config?.format) return Promise.reject(Anthropic.APIError.generate(400, { type: 'error', error: { type: 'invalid_request_error', message: 'The compiled grammar is too large, which would cause performance issues.' } }, undefined, new Headers({ 'request-id': 'req_grammar' })));
            this.currentMessage = { model: params.model };
            for (let at = 0; at < REPLY.length; at += 40) for (const listener of listeners) listener(REPLY.slice(at, at + 40));
            return Promise.resolve({ id: 'msg_1', type: 'message', role: 'assistant', model: params.model, content: [{ type: 'thinking', thinking: '', signature: 's' }, { type: 'text', text: REPLY }], stop_reason: 'end_turn', usage: USAGE });
          },
        };
      },
    };
    models = { retrieve: async (id) => ({ id, max_tokens: 128000, capabilities: { structured_outputs: { supported: true }, thinking: { supported: true, types: { adaptive: { supported: true } } }, effort: { supported: true, low: { supported: true }, medium: { supported: true }, high: { supported: true } } } }) };
  }
  // The Claude app isn't installed here, and no command line tool is needed on the API key route.
  const spawn = () => { const child = new EventEmitter(); queueMicrotask(() => child.emit('error', Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }))); child.kill = () => true; return child; };
  const app = Object.assign(new EventEmitter(), { getPath: () => root, whenReady: () => ({ then() {} }), getVersion: () => 'test' });
  vm.runInNewContext(fs.readFileSync(mainPath, 'utf8'), {
    require: (name) => {
      if (name === 'electron') return { app, ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) }, safeStorage: { isEncryptionAvailable: () => false } };
      if (name === 'electron-updater') return {};
      if (name === 'child_process') return { spawn };
      if (name === '../shared/anthropic-runner') return { ...realRunner, createAnthropicRunner: (options) => realRunner.createAnthropicRunner({ ...options, Client: FakeAnthropic }) };
      return mainRequire(name);
    },
    process: { pid: process.pid, platform: 'darwin', env: { ANTHROPIC_API_KEY: KEY, STUDIO_DAILY_AI_BUDGET_USD: '50' }, argv: [] },
    __dirname: path.dirname(mainPath), Buffer, URL, AbortController, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
  }, { filename: mainPath });
  cleanups.push(() => { app.emit('before-quit', { preventDefault() {} }); app.emit('quit'); fs.rmSync(root, { recursive: true, force: true }); });
  const call = async (channel, payload) => handlers.get(channel)(null, payload);
  return { call, root, streams };
}

describe('Ask AI keeps an answer it could read when the rest of the reply is broken', () => {
  it('saves the answer with the note and its real cost, counts the spend once and leaves a diagnostic', async () => {
    const h = boot();
    const reply = await h.call('help:ask', { question: 'hey what can you do', requestId: 'req-salvage-0001', page: { id: 'simple-mode', label: 'Simple mode', layout: 'simple' } });
    expect(h.streams).toHaveLength(2);
    expect(h.streams[1].messages[0].content).toContain('ANSWER FORMAT');
    expect(reply.message.content).toBe(`${ANSWER}\n\n${NOTE}`);
    expect(reply.message.followUps).toEqual(['Start a quick scan', 'What does it cost?']);
    expect(reply.message.cards).toEqual([]);
    expect(reply.message.actions).toEqual([]);
    const cost = realRunner.usageCost(reply.message.receipt.model, USAGE);
    expect(cost).toBeGreaterThan(0);
    expect(reply.message.receipt).toEqual({ costUsd: cost, model: expect.stringMatching(/^claude-/), route: 'claude-api' });
    // The daily spend total counted the billed call once (the refused grammar cost nothing).
    const ledger = JSON.parse(fs.readFileSync(path.join(h.root, 'ai-spend.json'), 'utf8'));
    expect(ledger).toMatchObject({ usd: cost, calls: 1 });
    const progress = (await h.call('help:progress', { requestId: 'req-salvage-0001' })).progress;
    expect(progress).toMatchObject({ status: 'done', text: `${ANSWER}\n\n${NOTE}` });
    // One diagnostics file, owner-only, with the reply (no key, no question).
    const dir = path.join(h.root, 'content-studio', 'diagnostics');
    const files = fs.readdirSync(dir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^ai-invalid-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.json$/);
    const entry = JSON.parse(fs.readFileSync(path.join(dir, files[0]), 'utf8'));
    expect(entry).toEqual({ at: expect.any(String), taskId: 'assistant.ask-ai', route: 'claude-api', model: reply.message.receipt.model, stopReason: 'end_turn', schemaInPrompt: true, blockTypes: ['thinking', 'text'], textLength: REPLY.length, text: REPLY });
    const raw = fs.readFileSync(path.join(dir, files[0]), 'utf8');
    expect(raw).not.toContain(KEY); expect(raw).not.toContain('hey what can you do');
    if (process.platform !== 'win32') expect(fs.statSync(path.join(dir, files[0])).mode & 0o777).toBe(0o600);
  });
});
