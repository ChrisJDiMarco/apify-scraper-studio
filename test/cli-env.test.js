import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { createRequire } from 'node:module';

// On the Codex route the AI CLI can run shell commands with the studio's environment, so nobody can ask Ask AI (or a
// kit) to print a secret: every STUDIO_* setting and every saved-key variable is removed before any CLI starts.
const mainPath = path.resolve('src/main/index.js');
const mainRequire = createRequire(mainPath);
const { studioCliEnv } = mainRequire('./studio-host');
const SECRETS = {
  STUDIO_SECRET_KEY: 'fixture-studio-secret-key-0123456789abcdef', STUDIO_PASSWORD: 'fixture-admin-password', STUDIO_SESSION_SECRET: 'fixture-session',
  ANTHROPIC_API_KEY: 'sk-ant-fixture', OPENAI_API_KEY: 'sk-fixture', OPENROUTER_API_KEY: 'sk-or-fixture', FAL_KEY: 'fixture-fal-key', APIFY_API_TOKEN: 'apify_api_fixture', MONDAY_API_TOKEN: 'fixture-monday',
  GOOGLE_SHEETS_WEBHOOK_URL: 'https://script.google.com/macros/s/fixture/exec', GOOGLE_DOCS_ACCESS_TOKEN: 'ya29.fixture',
};
const saved = {};
beforeAll(() => { for (const [name, value] of Object.entries(SECRETS)) { saved[name] = process.env[name]; process.env[name] = value; } process.env.FIXTURE_UNRELATED = 'kept'; });
afterAll(() => { for (const name of Object.keys(SECRETS)) { if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name]; } delete process.env.FIXTURE_UNRELATED; });

describe('AI CLI environment', () => {
  it('drops every studio setting and saved key and keeps the rest', () => {
    const env = studioCliEnv();
    for (const name of Object.keys(SECRETS)) expect(env, name).not.toHaveProperty(name);
    expect(env.FIXTURE_UNRELATED).toBe('kept'); expect(env.PATH).toContain(path.join(os.homedir(), '.local', 'bin'));
  });

  it('starts Codex for Ask AI without them, isolated in an empty folder outside the data folder that is removed afterwards', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-env-'));
    fs.writeFileSync(path.join(root, 'data.json'), JSON.stringify({ settings: { aiProvider: 'codex' } }));
    const calls = []; const handlers = new Map(); const delays = [];
    const answer = { answer: 'Open **Trends** in the sidebar.', pages: [], followUps: [], image: { create: false, title: '', prompt: '', size: '1536x1024' }, actions: [], show: { autoStart: false, steps: [] }, lookups: [] };
    // `codex exec --help` lists the flags this CLI takes; an answer goes where --output-last-message says, as the real CLI does.
    function spawn(command, args = [], options = {}) {
      const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
      const call = { command, args, cwd: options.cwd, env: options.env, existed: fs.existsSync(options.cwd || ''), stdin: '', entries: options.cwd && fs.existsSync(options.cwd) ? fs.readdirSync(options.cwd) : [] };
      child.stdin = new Writable({ write(chunk, _encoding, done) { call.stdin += chunk.toString(); done(); } }); child.kill = () => true;
      calls.push(call);
      if (args.includes('--help')) { queueMicrotask(() => { child.stdout.write('Options:\n      --ephemeral\n      --ignore-user-config\n'); child.emit('close', 0, null); }); return child; }
      // The quick checks before a Codex job (Settings → AI connections): its version and `codex login status`.
      if (!args.includes('--output-last-message')) { queueMicrotask(() => { child.stdout.write(args.includes('status') ? 'Logged in using ChatGPT\n' : 'codex-cli 0.60.0\n'); child.emit('close', 0, null); }); return child; }
      queueMicrotask(() => { fs.writeFileSync(args[args.indexOf('--output-last-message') + 1], JSON.stringify(answer)); child.emit('close', 0, null); });
      return child;
    }
    const app = Object.assign(new EventEmitter(), { getPath: () => root, whenReady: () => ({ then() {} }), getVersion: () => 'test' });
    try {
      vm.runInNewContext(fs.readFileSync(mainPath, 'utf8'), {
        require: (name) => {
          if (name === 'electron') return { app, ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) }, safeStorage: { isEncryptionAvailable: () => false } };
          if (name === 'electron-updater') return {};
          if (name === 'child_process') return { spawn };
          return mainRequire(name);
        },
        process: { pid: process.pid, platform: 'darwin', env: { ...SECRETS }, argv: [] },
        // Timers are recorded: Ask AI's own 3-minute limit must reach Codex too (coherence D6), not Codex's 10-minute default.
        __dirname: path.dirname(mainPath), Buffer, URL, AbortController, setTimeout: (fn, ms, ...rest) => { delays.push(ms); return setTimeout(fn, ms, ...rest); }, clearTimeout,
      }, { filename: mainPath });
      const reply = await handlers.get('help:ask')(null, { question: 'Where are my trends?', page: { id: 'simple-mode', label: 'Simple mode', layout: 'simple' } });
      expect(reply.answer).toBe('Open **Trends** in the sidebar.');
      for (const call of calls.filter((entry) => entry.command === 'codex')) for (const name of Object.keys(SECRETS)) expect(call.env, name).not.toHaveProperty(name);
      const codex = calls.filter((call) => call.command === 'codex' && call.args.includes('--output-last-message'));
      expect(codex).toHaveLength(1);
      expect(JSON.stringify(codex[0].env)).not.toMatch(/fixture-studio-secret|sk-ant-fixture|fixture-monday|script\.google\.com/);
      // An empty private folder outside the data folder, gone afterwards: nothing in it to read but the answer schema.
      expect(codex[0].existed).toBe(true);
      expect(path.dirname(codex[0].cwd)).toBe(os.tmpdir());
      expect(path.relative(root, codex[0].cwd).startsWith('..')).toBe(true);
      expect(codex[0].entries).toEqual(['output.schema.json']);
      expect(fs.existsSync(codex[0].cwd)).toBe(false);
      // Tools off, read-only, the prompt on stdin, and no session files (this CLI takes --ephemeral); the Mac app keeps the CLI's own config.
      expect(codex[0].args).toEqual(expect.arrayContaining(['--sandbox', 'read-only', '-c', 'features.shell_tool=false', '--ephemeral']));
      expect(codex[0].args).not.toContain('workspace-write'); expect(codex[0].args).not.toContain('--ignore-user-config');
      expect(codex[0].args.at(-1)).toBe('-');
      expect(delays).toContain(180000); expect(delays).not.toContain(600000);
      expect(codex[0].stdin).toMatch(/^Read the text below and complete the requested structured analysis\./);
      expect(codex[0].stdin).toContain('Where are my trends?');
      expect(fs.readdirSync(path.join(root, 'help', 'calls'))).toEqual([]);
      expect(fs.readdirSync(root, { recursive: true }).some((name) => String(name).endsWith('ai-input.txt'))).toBe(false);
    } finally { app.emit('before-quit'); app.emit('quit'); fs.rmSync(root, { recursive: true, force: true }); }
  });
});
