import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import limitsModule from '../src/main/ai-limits.js';

const { createAiLimits } = limitsModule;
const quiet = () => {};
const tick = () => new Promise((resolve) => setImmediate(resolve));

describe('studio-wide AI limits', () => {
  it('changes nothing when neither limit is set', async () => {
    const limits = createAiLimits({ env: {}, log: quiet });
    expect(limits.enabled).toBe(false);
    const results = await Promise.all([1, 2, 3].map((n) => limits.run(async () => ({ n, receipt: { costUsd: 50 } }))));
    expect(results.map((result) => result.n)).toEqual([1, 2, 3]);
    expect(() => limits.checkBudget()).not.toThrow();
  });

  it('runs at most STUDIO_AI_CONCURRENCY calls at once, oldest waiting first, and lets a waiting call be cancelled', async () => {
    const limits = createAiLimits({ env: { STUDIO_AI_CONCURRENCY: '2' }, log: quiet });
    const started = []; const finish = {};
    const call = (name, extra = {}) => limits.run(() => new Promise((resolve) => { started.push(name); finish[name] = () => resolve({ name }); }), extra);
    const a = call('a'); const b = call('b');
    let cancelC = null; let waitedBehind = 0;
    const c = call('c', { register: (cancel) => { cancelC = cancel; }, onWait: (ahead) => { waitedBehind = ahead; } });
    const d = call('d');
    await tick();
    expect(started).toEqual(['a', 'b']);
    expect(limits.status()).toMatchObject({ concurrency: 2, running: 2, waiting: 2 });
    expect(waitedBehind).toBe(1);
    cancelC();
    await expect(c).rejects.toThrow('Job cancelled.');
    finish.a(); await a; await tick();
    expect(started).toEqual(['a', 'b', 'd']); // c left the line; d took the free slot
    finish.b(); finish.d(); await Promise.all([b, d]);
    expect(limits.status()).toMatchObject({ running: 0, waiting: 0 });
  });

  it('refuses new AI work once the day’s recorded spend reaches STUDIO_DAILY_AI_BUDGET_USD, and keeps the total across a restart', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-limits-')); const file = path.join(dir, 'ai-spend.json');
    let now = Date.parse('2026-10-17T10:00:00Z');
    const limits = createAiLimits({ env: { STUDIO_DAILY_AI_BUDGET_USD: '1.00' }, file, now: () => now, log: quiet });
    await limits.run(async () => ({ receipt: { costUsd: 0.6 } }));
    await limits.run(async () => ({ receipt: { costUsd: null } })); // Codex reports no cost: nothing is counted
    expect(limits.status().spentTodayUsd).toBe(0.6);
    // A failed call's reported cost counts too.
    await expect(limits.run(async () => { throw Object.assign(new Error('Claude stopped'), { costUsd: 0.45 }); })).rejects.toThrow('Claude stopped');
    expect(limits.status()).toMatchObject({ dailyBudgetUsd: 1, spentTodayUsd: 1.05 });
    let ran = false;
    await expect(limits.run(async () => { ran = true; })).rejects.toMatchObject({ code: 'dailyAiBudget', status: 429, message: expect.stringMatching(/daily AI budget of \$1\.00 is used up for today \(\$1\.05 so far\)\. New AI work can start after midnight UTC/) });
    expect(ran).toBe(false);
    // A restart reads the same day's total; the next UTC day starts from zero.
    const again = createAiLimits({ env: { STUDIO_DAILY_AI_BUDGET_USD: '1' }, file, now: () => now, log: quiet });
    expect(() => again.checkBudget()).toThrow(/used up/);
    now = Date.parse('2026-10-18T00:00:01Z');
    expect(() => again.checkBudget()).not.toThrow();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('ignores a setting that isn’t a positive number, and says so', () => {
    const lines = [];
    const limits = createAiLimits({ env: { STUDIO_AI_CONCURRENCY: 'many', STUDIO_DAILY_AI_BUDGET_USD: '-5' }, log: (line) => lines.push(line) });
    expect(limits.enabled).toBe(false);
    expect(lines.join('\n')).toMatch(/STUDIO_AI_CONCURRENCY must be a whole number.*\n.*STUDIO_DAILY_AI_BUDGET_USD must be a dollar amount/);
  });
});
