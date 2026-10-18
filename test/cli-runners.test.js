import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
const { createClaudeCliRunner, createCodexRunner, createCliProbe, codexUsage } = require('../src/main/cli-runners.js');

// The subscription connections as text runners (src/main/cli-runners.js) with a fake process launcher: Codex gets the
// routed model and reasoning level only when they are set and supported, keeps its isolation, and reports no cost;
// Claude Code streams its answer through stream-json when the installed CLI can, and otherwise answers once.
const schema = { type: 'object', additionalProperties: false, required: ['answer'], properties: { answer: { type: 'string' } } };
const result = (output, { model = 'claude-opus-5-5', cost = 0.0312, subtype = 'success', extra = {} } = {}) => ({ type: 'result', subtype, is_error: subtype !== 'success', structured_output: output, total_cost_usd: cost, duration_ms: 1200, usage: { input_tokens: 900, output_tokens: 40 }, modelUsage: { [model]: { inputTokens: 900 } }, ...extra });
const streamLines = (output, opts) => [
  { type: 'system', subtype: 'init' },
  { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'hmm' } } },
  { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"answer":"Ris' } } },
  { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: 'ing fast"}' } } },
  result(output, opts),
].map((event) => JSON.stringify(event)).join('\n') + '\n';

describe('Codex runner', () => {
  function codex({ efforts = () => ['low', 'medium', 'high'], stdout = '' } = {}) {
    const calls = []; const written = {};
    const spawnCli = vi.fn(async (command, args, cwd, options) => {
      calls.push({ command, args, cwd, options, entries: fs.readdirSync(cwd) });
      fs.writeFileSync(args[args.indexOf('--output-last-message') + 1], JSON.stringify({ answer: 'From Codex' }));
      return { stdout, stderr: '' };
    });
    const runner = createCodexRunner({ spawnCli, writeJson: (target, value) => { written[target] = value; }, support: async () => ({ ephemeral: true }), wrapper: (text) => `Read ${text} and answer.`, efforts });
    return { runner, calls, written };
  }
  it('passes the routed model and a supported reasoning level, and keeps Codex isolated with no cost', async () => {
    const usage = JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 1200, cached_input_tokens: 800, output_tokens: 90, reasoning_output_tokens: 30 } });
    const h = codex({ stdout: `{"type":"thread.started"}\n${usage}\n` });
    const out = await h.runner.run({ schema, prompt: 'Question', cachePrefix: 'GUIDE ', model: 'gpt-6-codex', effort: 'high', outputPath: '/answers/a.json', jobId: 'job-1', timeoutMs: 180000 });
    const [call] = h.calls;
    expect(call.args).toEqual(expect.arrayContaining(['exec', '-m', 'gpt-6-codex', '-c', 'model_reasoning_effort="high"', '--sandbox', 'read-only', '--output-schema', '--output-last-message', '--ephemeral']));
    expect(call.args.at(-1)).toBe('-'); expect(call.entries).toEqual(['output.schema.json']);
    expect(call.options).toMatchObject({ jobId: 'job-1', timeoutMs: 180000, providerLabel: 'Codex', stdin: 'Read the text below and answer.\n\nGUIDE Question' });
    expect(fs.existsSync(call.cwd)).toBe(false); // the private folder is removed afterwards
    expect(out.output).toEqual({ answer: 'From Codex' }); expect(h.written['/answers/a.json']).toEqual({ answer: 'From Codex' });
    expect(out.receipt).toMatchObject({ provider: 'codex', requestedModel: 'gpt-6-codex', effort: 'high', costUsd: null, usage: { input_tokens: 1200, output_tokens: 90, cached_input_tokens: 800, reasoning_output_tokens: 30 } });
    expect(out.receipt.costBasis).toMatch(/^Codex reports no cost/);
  });
  it('leaves the model and reasoning to Codex when none is chosen or the model doesn’t offer the level', async () => {
    const plain = codex(); const out = await plain.runner.run({ schema, prompt: 'Q', model: '', effort: '' });
    expect(plain.calls[0].args).not.toContain('-m'); expect(plain.calls[0].args.join(' ')).not.toContain('model_reasoning_effort');
    expect(out.receipt).toMatchObject({ requestedModel: 'Codex default' }); expect(out.receipt.effort).toBeUndefined();
    const unsupported = codex({ efforts: () => ['low', 'medium'] }); const capped = await unsupported.runner.run({ schema, prompt: 'Q', model: 'gpt-6-codex-mini', effort: 'max' });
    expect(unsupported.calls[0].args.join(' ')).not.toContain('model_reasoning_effort');
    expect(capped.receipt.effortNote).toBe('gpt-6-codex-mini doesn’t offer max reasoning, so it ran at its default.');
    // Codex's list unknown (no models_cache.json): a chosen level is passed through.
    const unknown = codex({ efforts: () => null }); await unknown.runner.run({ schema, prompt: 'Q', model: 'gpt-6-codex', effort: 'low' });
    expect(unknown.calls[0].args).toEqual(expect.arrayContaining(['-c', 'model_reasoning_effort="low"']));
    expect(codexUsage('not json\n{"usage": {"input_tokens": 0, "output_tokens": 0}}')).toBeNull();
  });
});

describe('Claude Code runner', () => {
  it('answers once with a JSON result when nobody is watching, and records the CLI-reported cost', async () => {
    const spawnCli = vi.fn(async () => ({ stdout: JSON.stringify(result({ answer: 'Hello' })), stderr: '' }));
    const written = {}; const cliInfo = vi.fn(async () => ({ streaming: true }));
    const runner = createClaudeCliRunner({ spawnCli, writeJson: (target, value) => { written[target] = value; }, cliInfo });
    const out = await runner.run({ schema, prompt: 'Q', cachePrefix: 'GUIDE ', model: 'claude-opus-5-5', effort: 'medium', maxBudgetUsd: 0.75, outputPath: '/a.json', workspaceDir: '/tmp', jobId: 'job-2' });
    const [command, args, , options] = spawnCli.mock.calls[0];
    expect(command).toBe('claude'); expect(args).toEqual(expect.arrayContaining(['--print', '--model', 'claude-opus-5-5', '--output-format', 'json', '--effort', 'medium']));
    expect(args).not.toContain('--include-partial-messages'); expect(cliInfo).not.toHaveBeenCalled();
    expect(options).toMatchObject({ jobId: 'job-2', stdin: 'GUIDE Q', providerLabel: 'Claude', keepStdoutOnError: true });
    expect(out.output).toEqual({ answer: 'Hello' }); expect(written['/a.json']).toEqual({ answer: 'Hello' });
    expect(out.receipt).toMatchObject({ provider: 'claude', requestedModel: 'claude-opus-5-5', actualModel: 'claude-opus-5-5', effort: 'medium', costUsd: 0.0312 });
  });
  it('streams the answer as it is written when the installed Claude Code supports stream-json', async () => {
    const stdout = streamLines({ answer: 'Rising fast' });
    const spawnCli = vi.fn(async (command, args, cwd, options) => { for (let index = 0; index < stdout.length; index += 37) options.onStdout(Buffer.from(stdout.slice(index, index + 37))); return { stdout, stderr: '' }; });
    const pieces = [];
    const runner = createClaudeCliRunner({ spawnCli, writeJson: () => {}, cliInfo: async () => ({ streaming: true }) });
    const out = await runner.run({ schema, prompt: 'Q', model: 'claude-opus-5-5', onDelta: (piece) => pieces.push(piece) });
    expect(spawnCli.mock.calls[0][1]).toEqual(expect.arrayContaining(['--output-format', 'stream-json', '--verbose', '--include-partial-messages']));
    expect(pieces.join('')).toBe('{"answer":"Rising fast"}');
    expect(out.output).toEqual({ answer: 'Rising fast' }); expect(out.receipt.costUsd).toBe(0.0312);
    // An older Claude Code without the flags answers once (the router then sends the whole answer as one delta).
    const once = vi.fn(async () => ({ stdout: JSON.stringify(result({ answer: 'x' })), stderr: '' }));
    await createClaudeCliRunner({ spawnCli: once, writeJson: () => {}, cliInfo: async () => ({ streaming: false }) }).run({ schema, prompt: 'Q', model: 'claude-opus-5-5', onDelta: () => {} });
    expect(once.mock.calls[0][1]).toEqual(expect.arrayContaining(['--output-format', 'json']));
  });
  it('refuses another model’s answer and keeps the cost of a run stopped by its cap', async () => {
    const other = createClaudeCliRunner({ spawnCli: async () => ({ stdout: JSON.stringify(result({ answer: 'x' }, { model: 'claude-haiku-4-5' })), stderr: '' }), writeJson: () => {} });
    await expect(other.run({ schema, prompt: 'Q', model: 'claude-opus-5-5' })).rejects.toMatchObject({ code: 'AI_MODEL_MISMATCH', costUsd: 0.0312 });
    const capped = createClaudeCliRunner({ spawnCli: async () => { throw Object.assign(new Error('Claude stopped'), { stdout: JSON.stringify(result(null, { subtype: 'error_max_budget_usd', cost: 0.25, extra: { errors: ['Reached maximum budget'] } })) }); }, writeJson: () => {} });
    await expect(capped.run({ schema, prompt: 'Q', model: 'claude-opus-5-5', maxBudgetUsd: 0.25 })).rejects.toMatchObject({ code: 'CLAUDE_BUDGET_EXCEEDED', costUsd: 0.25 });
  });
});

describe('CLI probe', () => {
  it('answers a quick status check and says when the command isn’t installed, never throwing', async () => {
    const spawn = vi.fn((command, args) => {
      const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => true;
      queueMicrotask(() => { if (command === 'missing') child.emit('error', Object.assign(new Error('spawn missing ENOENT'), { code: 'ENOENT' })); else { child.stdout.write(`${args.join(' ')} ok`); child.emit('close', 0); } });
      return child;
    });
    const probe = createCliProbe({ spawn, env: () => ({ PATH: '/bin' }) });
    expect(await probe('codex', ['login', 'status'])).toEqual({ code: 0, stdout: 'login status ok', stderr: '' });
    expect(await probe('missing', ['--version'])).toMatchObject({ missing: true });
    expect(spawn.mock.calls[0][2]).toMatchObject({ env: { PATH: '/bin' } });
  });
});
