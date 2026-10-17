import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { createRequire } from 'node:module';

// Ask AI's handlers in the real main process (src/main/index.js, loaded as the Mac app runs it, with Codex as the AI):
// live progress read back with help:progress, Stop through help:cancel, two questions at once per person and no more,
// and Retry replacing the last answer while keeping the earlier one as a version.
const mainPath = path.resolve('src/main/index.js');
const mainRequire = createRequire(mainPath);
const cleanups = [];
afterEach(() => { for (const done of cleanups.splice(0)) done(); });

function boot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ask-main-'));
  fs.writeFileSync(path.join(root, 'data.json'), JSON.stringify({ settings: { aiProvider: 'codex' } }));
  const handlers = new Map(); const runs = [];
  // Each Codex run waits until the test answers it (or Stop kills it); `codex exec --help` answers at once.
  function spawn(command, args = [], options = {}) {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.stdin = new Writable({ write(chunk, _encoding, done) { done(); } });
    let closed = false; const close = (code, signal) => { if (closed) return; closed = true; child.emit('close', code, signal); };
    child.kill = (signal = 'SIGTERM') => { queueMicrotask(() => close(null, signal)); return true; };
    // The Claude app isn't installed here; Codex answers its version and help at once.
    if (command === 'claude') { queueMicrotask(() => child.emit('error', Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' }))); return child; }
    if (!args.includes('--output-last-message')) { queueMicrotask(() => { child.stdout.write(args.includes('--help') ? 'Options:\n      --ephemeral\n' : args.includes('status') ? 'Logged in using ChatGPT\n' : 'codex-cli 0.60.0\n'); close(0, null); }); return child; }
    const out = args[args.indexOf('--output-last-message') + 1];
    runs.push({ answer: (body) => { fs.writeFileSync(out, JSON.stringify(body)); close(0, null); }, killed: () => closed });
    return child;
  }
  const app = Object.assign(new EventEmitter(), { getPath: () => root, whenReady: () => ({ then() {} }), getVersion: () => 'test' });
  vm.runInNewContext(fs.readFileSync(mainPath, 'utf8'), {
    require: (name) => {
      if (name === 'electron') return { app, ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) }, safeStorage: { isEncryptionAvailable: () => false } };
      if (name === 'electron-updater') return {};
      if (name === 'child_process') return { spawn };
      return mainRequire(name);
    },
    process: { pid: process.pid, platform: 'darwin', env: {}, argv: [] },
    __dirname: path.dirname(mainPath), Buffer, URL, AbortController, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
  }, { filename: mainPath });
  cleanups.push(() => { app.emit('before-quit', { preventDefault() {} }); app.emit('quit'); fs.rmSync(root, { recursive: true, force: true }); });
  const call = async (channel, payload) => handlers.get(channel)(null, payload);
  const until = async (check) => { for (let tries = 0; tries < 200; tries++) { if (check()) return; await new Promise((resolve) => setTimeout(resolve, 10)); } throw new Error('Timed out waiting.'); };
  return { call, runs, until };
}
const output = (answer, extra = {}) => ({ answer, pages: [], followUps: [], image: { create: false, title: '', prompt: '', size: '1536x1024' }, actions: [], scan: { topic: '', depth: 'lite', platforms: [], xAccounts: -1, linkedinAccounts: -1, redditAccounts: -1, itemsPerPlatform: -1, commentsPerPost: -1, lookbackHours: -1, aiBudgetUsd: -1, collectionBudgetUsd: -1, programId: '' }, show: { autoStart: false, steps: [] }, lookups: [], cards: [], remember: [], summary: '', title: '', ...extra });
const page = { id: 'simple-mode', label: 'Simple mode', layout: 'simple' };

describe('Ask AI handlers', () => {
  it('reports an answer’s progress while it runs and its reply once done, to the person who asked', async () => {
    const h = boot();
    const asked = h.call('help:ask', { question: 'Where are my trends?', requestId: 'req-progress-1', page });
    await h.until(() => h.runs.length === 1);
    const running = await h.call('help:progress', { requestId: 'req-progress-1' });
    expect(running.progress).toMatchObject({ requestId: 'req-progress-1', question: 'Where are my trends?', status: 'thinking' });
    expect(running.progress.steps.map((step) => step.id)).toEqual(expect.arrayContaining(['context', 'route', 'think-0']));
    expect((await h.call('help:progress', {})).active.map((row) => row.requestId)).toEqual(['req-progress-1']);
    h.runs[0].answer(output('Open **Trends** in the sidebar.', { title: 'Finding trends' }));
    const reply = await asked;
    expect(reply.message.content).toBe('Open **Trends** in the sidebar.');
    const done = (await h.call('help:progress', { requestId: 'req-progress-1' })).progress;
    // Codex answers all at once: the whole answer was shown when its round ended, then the reply landed.
    expect(done).toMatchObject({ status: 'done', text: 'Open **Trends** in the sidebar.', conversationId: reply.conversation.id, final: { message: { id: reply.message.id } } });
    await expect(h.call('help:progress', { requestId: 'bad id!' })).rejects.toThrow('Invalid question request ID.');
    expect((await h.call('help:progress', { requestId: 'req-unknown-1' })).progress).toBeNull();
  });

  it('stops an answer with help:cancel, and allows two questions at once per person but not a third', async () => {
    const h = boot();
    const first = h.call('help:ask', { question: 'First question', requestId: 'req-busy-0001', page });
    const second = h.call('help:ask', { question: 'Second question', requestId: 'req-busy-0002', page });
    await h.until(() => h.runs.length === 2);
    await expect(h.call('help:ask', { question: 'Third question', requestId: 'req-busy-0003', page })).rejects.toMatchObject({ status: 429, code: 'askBusy', message: 'You have two questions going. Wait for one to finish, or stop it.' });
    expect(await h.call('help:cancel', { requestId: 'req-busy-0001' })).toEqual({ stopped: true });
    // Codex hadn't written anything yet, so there is nothing to keep.
    await expect(first).rejects.toThrow('Ask AI stopped. Nothing was saved');
    expect((await h.call('help:progress', { requestId: 'req-busy-0001' })).progress).toMatchObject({ status: 'stopped' });
    expect(await h.call('help:cancel', { requestId: 'req-busy-0001' })).toEqual({ stopped: false });
    h.runs[1].answer(output('Second answer.'));
    await second;
    const third = h.call('help:ask', { question: 'Third question', requestId: 'req-busy-0003', page });
    await h.until(() => h.runs.length === 3);
    h.runs[2].answer(output('Third answer.'));
    expect((await third).message.content).toBe('Third answer.');
  });

  it('asks the last question again, replacing its answer and keeping the earlier one, and refuses any other', async () => {
    const h = boot();
    const asking = h.call('help:ask', { question: 'Which trend is biggest?', requestId: 'req-first-0001', page });
    await h.until(() => h.runs.length === 1); h.runs[0].answer(output('AI Overviews.'));
    const first = await asking;
    await expect(h.call('help:ask', { question: 'Which trend is biggest?', requestId: 'req-retry-0001', page, conversationId: first.conversation.id, mode: 'regenerate', replaces: 'msg-00000000-0000-4000-8000-000000000000' })).rejects.toMatchObject({ status: 409 });
    const again = h.call('help:ask', { question: 'Which trend is biggest?', requestId: 'req-retry-0002', page, conversationId: first.conversation.id, mode: 'regenerate', replaces: first.userMessage.id });
    await h.until(() => h.runs.length === 2); h.runs[1].answer(output('Zero-click search.'));
    const replaced = await again;
    expect(replaced.message.content).toBe('Zero-click search.');
    expect(replaced.message.versions.map((row) => row.content)).toEqual(['AI Overviews.']);
    const stored = (await h.call('help:conversation', { conversationId: first.conversation.id })).conversation;
    expect(stored.messages.map((row) => row.content)).toEqual(['Which trend is biggest?', 'Zero-click search.']);
  });
});
