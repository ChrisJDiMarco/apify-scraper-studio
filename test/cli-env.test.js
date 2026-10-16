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
  ANTHROPIC_API_KEY: 'sk-ant-fixture', OPENAI_API_KEY: 'sk-fixture', APIFY_API_TOKEN: 'apify_api_fixture', MONDAY_API_TOKEN: 'fixture-monday',
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

  it('starts Codex for Ask AI without them, in a folder of its own that is removed afterwards', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-env-'));
    fs.writeFileSync(path.join(root, 'data.json'), JSON.stringify({ settings: { aiProvider: 'codex' } }));
    const calls = []; const handlers = new Map();
    const answer = { answer: 'Open **Trends** in the sidebar.', pages: [], followUps: [], image: { create: false, title: '', prompt: '', size: '1536x1024' }, actions: [], show: { autoStart: false, steps: [] }, lookups: [] };
    // Codex writes its answer where --output-last-message says, as the real CLI does.
    function spawn(command, args = [], options = {}) {
      const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
      child.stdin = new Writable({ write(_chunk, _encoding, done) { done(); } }); child.kill = () => true;
      calls.push({ command, args, cwd: options.cwd, env: options.env, existed: fs.existsSync(options.cwd || '') });
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
        __dirname: path.dirname(mainPath), Buffer, URL, AbortController, setTimeout, clearTimeout,
      }, { filename: mainPath });
      const reply = await handlers.get('help:ask')(null, { question: 'Where are my trends?', page: { id: 'simple-mode', label: 'Simple mode', layout: 'simple' } });
      expect(reply.answer).toBe('Open **Trends** in the sidebar.');
      const codex = calls.filter((call) => call.command === 'codex');
      expect(codex).toHaveLength(1);
      for (const name of Object.keys(SECRETS)) expect(codex[0].env, name).not.toHaveProperty(name);
      expect(JSON.stringify(codex[0].env)).not.toMatch(/fixture-studio-secret|sk-ant-fixture|fixture-monday|script\.google\.com/);
      expect(codex[0].existed).toBe(true);
      expect(path.dirname(codex[0].cwd)).toBe(path.join(root, 'help', 'calls'));
      expect(fs.existsSync(codex[0].cwd)).toBe(false);
      expect(fs.readdirSync(path.join(root, 'help', 'calls'))).toEqual([]);
    } finally { app.emit('before-quit'); app.emit('quit'); fs.rmSync(root, { recursive: true, force: true }); }
  });
});
