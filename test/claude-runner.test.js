import { describe, expect, it } from 'vitest';
import claude from '../src/shared/claude-runner.js';

const schema = { type: 'object', properties: { reply: { type: 'string' } }, required: ['reply'], additionalProperties: false };
const success = (overrides = {}) => ({ type: 'result', subtype: 'success', is_error: false, structured_output: { reply: 'pong' }, modelUsage: { 'claude-opus-5-5': { canonicalModel: 'claude-opus-5-5', outputTokens: 53, costUSD: 0.008964 } }, usage: { input_tokens: 2, output_tokens: 53 }, total_cost_usd: 0.008964, ...overrides });

describe('Claude isolated command', () => {
  it('uses exact Opus 5.5, disables tools/customizations, and sends user content only over stdin', () => {
    const prompt = 'Private customer evidence';
    const command = claude.buildClaudeCommand({ schema, prompt });
    expect(command.command).toBe('claude');
    expect(command.stdin).toBe(prompt);
    expect(command.args).not.toContain(prompt);
    const value = (flag) => command.args[command.args.indexOf(flag) + 1];
    expect(value('--model')).toBe('claude-opus-5-5');
    expect(value('--tools')).toBe('');
    expect(value('--mcp-config')).toBe('{"mcpServers":{}}');
    expect(value('--disallowedTools')).toBe('mcp__*');
    expect(value('--setting-sources')).toBe('');
    expect(value('--permission-mode')).toBe('dontAsk');
    expect(value('--permission-prompts')).toBe('none');
    expect(value('--max-budget-usd')).toBe('1');
    expect(value('--json-schema')).toBe(JSON.stringify(schema));
    for (const flag of ['--safe-mode', '--strict-mcp-config', '--no-session-persistence', '--disable-slash-commands', '--no-chrome']) expect(command.args).toContain(flag);
    expect(command.args).not.toContain('--bare');
    expect(command.args).not.toContain('--fallback-model');
  });
  it.each([0, -1, 101, Infinity, NaN, true, ''])('rejects unsafe or invalid budget %s', (maxBudgetUsd) => {
    expect(() => claude.buildClaudeCommand({ schema, maxBudgetUsd })).toThrow(/budget/);
  });
  it('accepts an explicit model without silently replacing it', () => {
    const command = claude.buildClaudeCommand({ model: 'claude-sonnet-5', schema, maxBudgetUsd: '0.25' });
    expect(command.args[command.args.indexOf('--model') + 1]).toBe('claude-sonnet-5');
    expect(command.args[command.args.indexOf('--max-budget-usd') + 1]).toBe('0.25');
  });
  it('rejects oversized UTF-8 input before invoking a paid request', () => {
    expect(() => claude.buildClaudeCommand({ schema, prompt: '界'.repeat(Math.ceil(claude.MAX_CLAUDE_STDIN_BYTES / 3) + 1) })).toThrow(/too large/);
  });
  it('requires a schema and a model token', () => {
    expect(() => claude.buildClaudeCommand({ schema: null })).toThrow(/schema/);
    expect(() => claude.buildClaudeCommand({ schema, model: '--help' })).toThrow(/model/);
  });
});

describe('Claude result parsing', () => {
  it('reads structured output and the actual model from a real CLI result shape', () => {
    const result = claude.parseClaudeResult(JSON.stringify(success()));
    expect(result.output).toEqual({ reply: 'pong' });
    expect(result.actualModel).toBe('claude-opus-5-5');
    expect(result.actualModels).toEqual(['claude-opus-5-5']);
    expect(result.usage.output_tokens).toBe(53);
    expect(result.costUsd).toBe(0.008964);
  });
  it('accepts a final result from JSONL events and JSON arrays', () => {
    expect(claude.parseClaudeResult(`${JSON.stringify({ type: 'system' })}\n${JSON.stringify(success())}`).output.reply).toBe('pong');
    expect(claude.parseClaudeResult(JSON.stringify([{ type: 'system' }, success()])).output.reply).toBe('pong');
  });
  it('never turns an API or budget error into a successful answer', () => {
    expect(() => claude.parseClaudeResult(success({ is_error: true, subtype: 'error_max_budget_usd', errors: ['Budget limit reached'] }))).toThrow(/Budget limit reached/);
    expect(() => claude.parseClaudeResult(success({ subtype: 'error_during_execution', result: 'Model is unavailable' }))).toThrow(/Model is unavailable/);
  });
  it('rejects malformed or unstructured answers rather than parsing guessed JSON', () => {
    expect(() => claude.parseClaudeResult('')).toThrow(/no result/);
    expect(() => claude.parseClaudeResult('Oops')).toThrow(/unreadable/);
    expect(() => claude.parseClaudeResult(JSON.stringify({ reply: 'pong' }))).toThrow(/completed result/);
    expect(() => claude.parseClaudeResult(success({ structured_output: undefined, result: '{"reply":"pong"}' }))).toThrow(/structured output/);
  });
  it('does not fabricate model or cost when receipts are missing, and exposes multiple actual models', () => {
    const missing = claude.parseClaudeResult(success({ modelUsage: undefined, total_cost_usd: undefined }));
    expect(missing.actualModel).toBe('');
    expect(missing.costUsd).toBeNull();
    const multiple = claude.parseClaudeResult(success({ modelUsage: { 'claude-opus-5-5': {}, 'claude-sonnet-5': {} } }));
    expect(multiple.actualModel).toBe('');
    expect(multiple.actualModels).toEqual(['claude-opus-5-5', 'claude-sonnet-5']);
  });
});
