import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { createRequire } from 'node:module';

// When a button's target matches two or more things, Ask AI asks which one on a choice card. No two rows may read the
// same: the same item found twice is one item (and needs no question), and items of the same name get the fact that tells
// them apart (when they started, their status, counts, the program) on their second line. Checked in help-assistant.js
// (distinctChoices) and in the real main process (src/main/index.js helpResolveActions, loaded as the Mac app runs it,
// with Codex as the AI).
const require = createRequire(import.meta.url);
const { distinctChoices, modelCard } = require('../src/main/help-assistant.js');

describe('distinctChoices', () => {
  const run = (id, facts, at = '') => ({ ids: { ref: { kind: 'run', id }, runId: id }, title: 'Quick scan · SEO and search marketing', detail: 'Activity · 2026-10-17', facts, at });
  it('adds the first fact that tells same-named items apart, and only that one', () => {
    expect(distinctChoices([run('a', ['started 9:42 AM EDT', 'done', '4 themes']), run('b', ['started 11:05 AM EDT', 'done', '4 themes'])]).map((row) => row.detail))
      .toEqual(['Activity · 2026-10-17 · started 9:42 AM EDT', 'Activity · 2026-10-17 · started 11:05 AM EDT']);
    // The same start time: the status tells them apart.
    expect(distinctChoices([run('a', ['started 9:42 AM EDT', 'done']), run('b', ['started 9:42 AM EDT', 'didn’t finish'])]).map((row) => row.detail))
      .toEqual(['Activity · 2026-10-17 · done', 'Activity · 2026-10-17 · didn’t finish']);
    // Items that already read differently keep their line as it was.
    expect(distinctChoices([{ ids: { a: 1 }, title: 'AI Overviews', detail: 'Trends · 2026-10-16', facts: ['x'] }, { ids: { a: 2 }, title: 'AI Overviews', detail: 'Reports · 2026-10-16', facts: ['y'] }]).map((row) => row.detail))
      .toEqual(['Trends · 2026-10-16', 'Reports · 2026-10-16']);
  });
  it('shows the same item once, and tells alike items apart by age when nothing else does', () => {
    expect(distinctChoices([run('a', ['started 9:42 AM EDT']), { ...run('a', ['started 9:42 AM EDT']), ids: { runId: 'a', ref: { kind: 'run', id: 'a' } } }])).toHaveLength(1);
    expect(distinctChoices([run('a', ['done'], '2026-10-17T09:00:00Z'), run('b', ['done'], '2026-10-17T10:00:00Z')]).map((row) => row.detail))
      .toEqual(['Activity · 2026-10-17 · older', 'Activity · 2026-10-17 · newer']);
    const rows = distinctChoices([run('a', []), run('b', []), run('c', [])]);
    expect(new Set(rows.map((row) => `${row.title}\n${row.detail}`)).size).toBe(3);
  });
  it('keeps a model’s question to answers that read differently', () => {
    const card = modelCard({ type: 'choice', title: 'Which report?', note: '', items: ['Enterprise | Make assets for Enterprise', 'enterprise', ' Enterprise  ', 'SMB'], actionIndexes: [] });
    expect(card.data.options.map((row) => row.label)).toEqual(['Enterprise', 'SMB']);
    // Only case and spacing make two answers the same: signs and symbols are part of what they say.
    expect(modelCard({ type: 'choice', title: 'How much?', note: '', items: ['+10%', '-10%', 'Keep it'], actionIndexes: [] }).data.options.map((row) => row.label)).toEqual(['+10%', '-10%', 'Keep it']);
    expect(modelCard({ type: 'choice', title: 'Which guide?', note: '', items: ['C++ guide', 'C# guide'], actionIndexes: [] })?.data.options.map((row) => row.label)).toEqual(['C++ guide', 'C# guide']);
    expect(distinctChoices([{ ids: { a: 1 }, title: 'Budget', detail: '', facts: ['+10%'] }, { ids: { a: 2 }, title: 'Budget', detail: '', facts: ['-10%'] }]).map((row) => row.detail)).toEqual(['+10%', '-10%']);
  });
});

const mainPath = path.resolve('src/main/index.js');
const mainRequire = createRequire(mainPath);
const cleanups = [];
afterEach(() => { for (const done of cleanups.splice(0)) done(); });

// Two quick scans of the same topic on the same day, an hour and a half apart, the way the owner's screenshot had them,
// in the package's one workspace (package.json studioWorkspace).
const scan = (id, createdAt, extra = {}) => ({ id, workspaceId: 'semrush', type: 'research', origin: 'quick-scan', title: 'Quick scan · SEO and search marketing', status: 'succeeded', stage: 'scan-complete', message: '', createdAt, updatedAt: createdAt, costUsd: 0.12, maxBudgetUsd: 1.5, quickScan: { topic: 'SEO and search marketing', lookbackHours: 6, platforms: ['x'] }, discoveredThemes: [{ id: `${id}-t1`, name: 'Listicle crackdown' }], counts: { retained: 120 }, ...extra });
function boot(researchRuns) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ask-choices-'));
  fs.writeFileSync(path.join(root, 'data.json'), JSON.stringify({ settings: { aiProvider: 'codex' } }));
  fs.mkdirSync(path.join(root, 'content-studio'), { recursive: true });
  const at = '2026-10-17T08:00:00.000Z';
  fs.writeFileSync(path.join(root, 'content-studio', 'state.json'), JSON.stringify({ version: 1, activeWorkspaceId: 'semrush', workspaces: [{ id: 'semrush', name: 'Main', editionId: 'semrush', products: [], createdAt: at, updatedAt: at }], programs: [], researchRuns, contentRuns: [], themes: [], history: [], detections: [], assets: [], exports: [], datasetOwners: {} }));
  const handlers = new Map(); const runs = [];
  function spawn(command, args = []) {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.stdin = new Writable({ write(chunk, _encoding, done) { done(); } });
    let closed = false; const close = (code, signal) => { if (closed) return; closed = true; child.emit('close', code, signal); };
    child.kill = (signal = 'SIGTERM') => { queueMicrotask(() => close(null, signal)); return true; };
    if (command === 'claude') { queueMicrotask(() => child.emit('error', Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' }))); return child; }
    if (!args.includes('--output-last-message')) { queueMicrotask(() => { child.stdout.write(args.includes('--help') ? 'Options:\n      --ephemeral\n' : args.includes('status') ? 'Logged in using ChatGPT\n' : 'codex-cli 0.60.0\n'); close(0, null); }); return child; }
    const out = args[args.indexOf('--output-last-message') + 1];
    runs.push({ answer: (body) => { fs.writeFileSync(out, JSON.stringify(body)); close(0, null); } });
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
const open = { kind: 'open', label: 'Open the SEO quick scan', target: 'Quick scan · SEO and search marketing', params: ['type=run'] };
async function ask(h, requestId) {
  const asked = h.call('help:ask', { question: 'Open the SEO quick scan', requestId, page });
  await h.until(() => h.runs.length === 1);
  h.runs[0].answer(output('Here it is.', { actions: [open] }));
  return asked;
}

describe('a button whose target matches two things', () => {
  it('asks which one, with a second line that tells the two quick scans apart', async () => {
    const h = boot([scan('research-scan-b', '2026-10-17T15:05:00.000Z'), scan('research-scan-a', '2026-10-17T13:42:00.000Z')]);
    const { message } = await ask(h, 'req-choice-0001');
    const choice = message.cards.find((card) => card.type === 'choice');
    expect(choice).toBeTruthy();
    expect(choice.title).toBe('Which “Quick scan · SEO and search marketing” did you mean?');
    const rows = choice.data.options.map((row) => `${row.label}\n${row.detail}`);
    expect(rows).toHaveLength(2);
    expect(new Set(rows).size).toBe(2);
    for (const row of choice.data.options) expect(row.detail).toMatch(/^Activity · 2026-10-17 · started \d{1,2}:\d{2} [AP]M/);
    expect(choice.data.options.map((row) => row.ids.runId).sort()).toEqual(['research-scan-a', 'research-scan-b']);
  });
  it('names the local day beside a start time when it isn’t the stored day', async () => {
    // 03:30 UTC is the evening before in the Americas and the same morning in Europe and Asia: the row says the day the
    // time belongs to whenever it isn't the stored day the row's first line shows.
    const late = '2026-10-17T03:30:00.000Z'; const noon = '2026-10-17T12:00:00.000Z';
    const h = boot([scan('research-scan-a', late), scan('research-scan-b', noon)]);
    const { message } = await ask(h, 'req-choice-0003');
    const details = Object.fromEntries(message.cards.find((card) => card.type === 'choice').data.options.map((row) => [row.ids.runId, row.detail]));
    const localDay = (iso) => { const date = new Date(iso); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; };
    for (const [id, iso] of [['research-scan-a', late], ['research-scan-b', noon]]) {
      expect(details[id]).toMatch(/^Activity · 2026-10-17 · started \d{1,2}:\d{2} [AP]M/);
      if (localDay(iso) === '2026-10-17') expect(details[id]).not.toMatch(/ on \d{4}-/);
      else expect(details[id]).toMatch(new RegExp(` on ${localDay(iso)}$`));
    }
  });
  it('needs no question when both matches are the same item', async () => {
    const same = scan('research-scan-a', '2026-10-17T13:42:00.000Z');
    const h = boot([same, { ...same }]);
    const { message } = await ask(h, 'req-choice-0002');
    expect(message.cards.some((card) => card.type === 'choice')).toBe(false);
    expect(message.actions).toEqual([expect.objectContaining({ kind: 'open', runId: 'research-scan-a', ref: { kind: 'run', id: 'research-scan-a' } })]);
    expect(message.actions[0].candidates).toBeUndefined();
  });
});
