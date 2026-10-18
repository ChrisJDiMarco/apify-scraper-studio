import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

// Local diagnostics for an AI answer the studio couldn't read (src/main/ai-diagnostics.js, called by text-router.js):
// one owner-only file per failure in content-studio/diagnostics with the reply's text, redacted and capped, the newest 10
// kept, never the prompt or who asked, and never an error of its own.
const require = createRequire(import.meta.url);
const { createAiDiagnostics, AI_DIAGNOSTICS_MAX_TEXT_BYTES } = require('../src/main/ai-diagnostics.js');
const { createTextRouter } = require('../src/main/text-router.js');
const { createAiRouting } = require('../src/main/ai-routing.js');
const { createAiCatalog } = require('../src/main/ai-catalog.js');

const folders = [];
afterEach(() => { for (const folder of folders.splice(0)) fs.rmSync(folder, { recursive: true, force: true }); });
const tempDir = () => { const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-diagnostics-')); folders.push(folder); return folder; };
const invalid = (rawText, extra = {}) => Object.assign(new Error('Claude returned structured output that is not valid JSON. No unvalidated answer was saved.'), { code: 'CLAUDE_INVALID_RESULT', costUsd: 0.0108, stopReason: 'end_turn', schemaInPrompt: true, blockTypes: ['thinking', 'text'], rawText, rawTextLength: rawText.length, ...extra });
const clock = (start = Date.parse('2026-10-18T09:30:00.000Z')) => { let at = start; return () => new Date((at += 1000)); };
const files = (folder) => fs.readdirSync(folder).sort();
const readEntry = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

describe('AI diagnostics files', () => {
  it('writes one owner-only file with the reply and what it ran on, and nothing else', () => {
    const root = tempDir(); const dir = path.join(root, 'content-studio', 'diagnostics');
    const diagnostics = createAiDiagnostics({ dir: () => dir, now: () => new Date('2026-10-18T09:30:01.234Z') });
    const text = '{"answer":"I can run a "quick scan" for you."}';
    const file = diagnostics.record({ taskId: 'assistant.ask-ai', route: 'claude-api', model: 'claude-opus-5-5', error: invalid(text, { prompt: 'THE PROMPT', identityId: 'person-alex', email: 'alex@example.com' }) });
    expect(path.basename(file)).toBe('ai-invalid-2026-10-18T09-30-01-234Z.json');
    expect(files(dir)).toEqual(['ai-invalid-2026-10-18T09-30-01-234Z.json']);
    expect(readEntry(file)).toEqual({ at: '2026-10-18T09:30:01.234Z', taskId: 'assistant.ask-ai', route: 'claude-api', model: 'claude-opus-5-5', stopReason: 'end_turn', schemaInPrompt: true, blockTypes: ['thinking', 'text'], textLength: text.length, text });
    const raw = fs.readFileSync(file, 'utf8');
    for (const secret of ['THE PROMPT', 'person-alex', 'alex@example.com']) expect(raw).not.toContain(secret);
    if (process.platform !== 'win32') expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it('redacts every key shape the studio knows and caps the text at 100 KB', () => {
    const dir = tempDir(); const diagnostics = createAiDiagnostics({ dir, now: clock() });
    // Fixture shapes only: the AI keys, Monday's token (a JWT), FAL, Google (API key, access and refresh tokens, client
    // secret, the Sheets webhook URL, a service account's private key), credentials in a URL and a long hex secret. The
    // private key is built from parts so the handoff key scan (scripts/make-handoff.sh) doesn't take it for a real one.
    const secrets = ['sk-ant-api03-abcdefghijklmnop', 'sk-or-v1-0123456789abcdef', 'sk-proj-fixture0123456789', 'apify_api_ABCDEFGHIJ123456', 'Bearer abc.def-ghi',
      'eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjEyMzQ1Njc4OX0.fixtureSignature0123', '0f8fad5b-d9cb-469f-a165-70867728950e:4c1b6f0e9f2a4b7d8e3c5a1b2d4f6e8a',
      'AIzaSyA-fixture0123456789abcdefghijk', 'ya29.a0AfB_fixture0123456789', '1//0gFixture0123456789abcdefghij', 'GOCSPX-fixture0123456789abc',
      'script.google.com/macros/s/AKfycbFixture0123456789', ['-----BEGIN', 'PRIVATE KEY-----\nMIIEfixture\n-----END', 'PRIVATE KEY-----'].join(' '), 'sam:hunter2@',
      'a3f9c2e1b4d5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1'];
    const entry = readEntry(diagnostics.record({ route: 'openrouter', model: 'meta/llama-5', error: invalid(`{"answer":"${secrets.join(' and ').replace('sam:hunter2@', 'https://sam:hunter2@host.example')}"`) }));
    for (const secret of secrets) expect(entry.text).not.toContain(secret);
    expect(entry.text).toContain('[redacted]');
    // Ordinary words with a key prefix inside them stay as they are.
    const words = 'assistant.ask-ai, task-list, risk-based, desk-top and Key takeaways';
    expect(readEntry(diagnostics.record({ route: 'claude-api', error: invalid(`{"answer":"${words}"`) })).text).toBe(`{"answer":"${words}"`);
    expect(entry.taskId).toBeNull();
    const long = `{"answer":"${'é'.repeat(120 * 1024)}`;
    const capped = readEntry(diagnostics.record({ route: 'claude-api', model: 'claude-opus-5-5', error: invalid(long, { rawTextLength: 250000 }) }));
    expect(Buffer.byteLength(capped.text)).toBeLessThanOrEqual(AI_DIAGNOSTICS_MAX_TEXT_BYTES);
    expect(capped.text.startsWith('{"answer":"ééé')).toBe(true);
    expect(capped.textLength).toBe(250000);
  });

  it('keeps only the newest 10 and leaves other files in the folder alone', () => {
    const dir = tempDir(); const diagnostics = createAiDiagnostics({ dir, now: clock() });
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'keep me');
    const written = Array.from({ length: 13 }, (_, index) => diagnostics.record({ route: 'claude-api', model: 'claude-opus-5-5', error: invalid(`{"answer":"reply ${index}`) }));
    const kept = files(dir).filter((name) => name.startsWith('ai-invalid-'));
    expect(kept).toHaveLength(10);
    expect(kept).toEqual(written.slice(3).map((file) => path.basename(file)));
    expect(readEntry(path.join(dir, kept[0])).text).toBe('{"answer":"reply 3');
    expect(fs.readFileSync(path.join(dir, 'notes.txt'), 'utf8')).toBe('keep me');
    // Two failures in the same millisecond get two files, and both count as the newest when older ones are pruned.
    const same = createAiDiagnostics({ dir, now: () => new Date('2026-10-20T00:00:00.000Z') });
    const first = same.record({ route: 'claude-api', error: invalid('a') }); const second = same.record({ route: 'claude-api', error: invalid('b') });
    expect(path.basename(second)).toBe('ai-invalid-2026-10-20T00-00-00-000Z-2.json');
    const after = files(dir).filter((name) => name.startsWith('ai-invalid-'));
    expect(after).toHaveLength(10);
    expect(after).toEqual(expect.arrayContaining([path.basename(first), path.basename(second), path.basename(written[12])]));
    expect(after).not.toContain(path.basename(written[3]));
  });

  it('removes files older than 30 days, when one is written and on prune() at start', () => {
    const dir = tempDir(); let at = Date.parse('2026-08-01T00:00:00.000Z');
    const diagnostics = createAiDiagnostics({ dir, now: () => new Date(at) });
    const old = diagnostics.record({ route: 'claude-api', error: invalid('{"answer":"old"') });
    at = Date.parse('2026-08-20T00:00:00.000Z'); const recent = diagnostics.record({ route: 'claude-api', error: invalid('{"answer":"recent"') });
    fs.writeFileSync(path.join(dir, 'ai-invalid-not-a-time.json'), '{}');
    at = Date.parse('2026-09-05T00:00:00.000Z');
    const latest = diagnostics.record({ route: 'claude-api', error: invalid('{"answer":"latest"') });
    expect(files(dir)).toEqual([path.basename(recent), path.basename(latest), 'ai-invalid-not-a-time.json'].sort());
    expect(fs.existsSync(old)).toBe(false);
    at = Date.parse('2026-10-18T00:00:00.000Z');
    diagnostics.prune();
    expect(files(dir)).toEqual(['ai-invalid-not-a-time.json']);
    // A folder that isn't there yet, or can't be read, is no failure.
    expect(() => createAiDiagnostics({ dir: path.join(dir, 'missing') }).prune()).not.toThrow();
    expect(() => createAiDiagnostics({ dir: () => { throw new Error('no data folder'); } }).prune()).not.toThrow();
  });

  it('never throws: an error without a reply writes nothing, and a folder that can’t be made is logged', () => {
    const dir = tempDir(); const log = vi.fn();
    expect(createAiDiagnostics({ dir, log }).record({ error: Object.assign(new Error('Timed out'), { code: 'TIMEOUT' }) })).toBeNull();
    expect(createAiDiagnostics({ dir, log }).record({})).toBeNull();
    expect(files(dir)).toEqual([]);
    const blocked = path.join(dir, 'a-file'); fs.writeFileSync(blocked, 'x');
    expect(createAiDiagnostics({ dir: path.join(blocked, 'diagnostics'), log }).record({ error: invalid('{') })).toBeNull();
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^An AI diagnostics file couldn’t be saved: /));
    expect(createAiDiagnostics({ dir: () => { throw new Error('no data folder'); }, log }).record({ error: invalid('{') })).toBeNull();
  });
});

describe('the text router and unreadable answers', () => {
  const schema = { type: 'object', additionalProperties: false, required: ['answer'], properties: { answer: { type: 'string' } } };
  const catalog = createAiCatalog({ dataDir: '', codexHome: '/nonexistent-codex-home', fetchImpl: async () => { throw new Error('offline'); } });
  function harness(error, onInvalidResult) {
    const settings = { aiRouting: { version: 1, defaults: { text: { route: 'claude-api', model: 'claude-opus-5-5' } }, tasks: {} } };
    const routing = createAiRouting({ getSettings: () => settings, catalog });
    const runner = { run: vi.fn(async () => { throw error; }) };
    return createTextRouter({ routing, connections: { require: async (route) => route }, runners: { 'claude-api': runner }, catalog, writeJson: () => {}, maxBudgetUsd: () => 1, onInvalidResult });
  }

  it('saves a diagnostic and rethrows the same error, now naming its task, route and model', async () => {
    const dir = tempDir(); const diagnostics = createAiDiagnostics({ dir, now: clock() });
    const error = invalid('{"answer":"Press "Run"."}');
    const thrown = await harness(error, (event) => diagnostics.record(event)).run({ taskId: 'assistant.ask-ai', schema, prompt: 'Q' }).catch((caught) => caught);
    expect(thrown).toBe(error);
    expect(thrown).toMatchObject({ code: 'CLAUDE_INVALID_RESULT', message: 'Claude returned structured output that is not valid JSON. No unvalidated answer was saved.', costUsd: 0.0108, taskId: 'assistant.ask-ai', route: 'claude-api', model: expect.any(String) });
    const [name] = files(dir);
    expect(readEntry(path.join(dir, name))).toMatchObject({ taskId: 'assistant.ask-ai', route: 'claude-api', model: thrown.model, text: '{"answer":"Press "Run"."}' });
  });

  it('leaves other failures alone, and a diagnostic that fails never replaces the error', async () => {
    const heard = vi.fn();
    const timeout = Object.assign(new Error('Claude timed out after 180 seconds.'), { code: 'TIMEOUT', costUsd: null });
    await expect(harness(timeout, heard).run({ taskId: 'assistant.ask-ai', schema, prompt: 'Q' })).rejects.toBe(timeout);
    const noText = Object.assign(new Error('Claude stopped before finishing (pause_turn). No unvalidated answer was saved.'), { code: 'CLAUDE_INVALID_RESULT', costUsd: 0.01 });
    await expect(harness(noText, heard).run({ taskId: 'assistant.ask-ai', schema, prompt: 'Q' })).rejects.toBe(noText);
    expect(heard).not.toHaveBeenCalled();
    expect(noText.route).toBeUndefined();
    const error = invalid('{');
    await expect(harness(error, () => { throw new Error('disk full'); }).run({ taskId: 'assistant.ask-ai', schema, prompt: 'Q' })).rejects.toBe(error);
  });
});
