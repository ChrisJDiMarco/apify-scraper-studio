'use strict';
// Optional studio-wide AI limits, for a shared browser studio (both off unless set, which is today's behavior):
//   STUDIO_AI_CONCURRENCY       at most this many AI calls (text and pictures) run at once across the studio; the rest
//                               wait in line, oldest first, and a cancelled call leaves the line.
//   STUDIO_DAILY_AI_BUDGET_USD  once the AI spend recorded today (UTC) reaches this, new AI calls are refused until
//                               midnight UTC. Spend is what each call reports (Claude's receipts, the image usage
//                               estimate); Codex reports none, so its calls are not counted.
// The day's total is kept in a small file beside the studio data, so a restart doesn't reset it.
// index.js wraps generateStructuredOutput and the image provider with it. CommonJS, main process only.
const fs = require('fs');
const path = require('path');

const day = (ms) => new Date(ms).toISOString().slice(0, 10);
const money = (value) => `$${(Math.round(Number(value) * 100) / 100).toFixed(2)}`;
function positive(raw, { integer = false } = {}) {
  const text = String(raw ?? '').trim(); if (!text) return null;
  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0 || (integer && !Number.isInteger(value))) return null;
  return value;
}
const refusal = (message, code, status = 429) => Object.assign(new Error(message), { code, status });

function createAiLimits({ env = process.env, file = '', now = () => Date.now(), log = (line) => console.warn(line) } = {}) {
  const concurrency = positive(env.STUDIO_AI_CONCURRENCY, { integer: true });
  const dailyBudgetUsd = positive(env.STUDIO_DAILY_AI_BUDGET_USD);
  if (String(env.STUDIO_AI_CONCURRENCY ?? '').trim() && !concurrency) log('STUDIO_AI_CONCURRENCY must be a whole number above 0; it is ignored.');
  if (String(env.STUDIO_DAILY_AI_BUDGET_USD ?? '').trim() && !dailyBudgetUsd) log('STUDIO_DAILY_AI_BUDGET_USD must be a dollar amount above 0; it is ignored.');

  // ---------- today's spend ----------
  let ledger = { day: '', usd: 0, calls: 0 };
  function loadLedger() {
    if (!dailyBudgetUsd || !file) return;
    try { const saved = JSON.parse(fs.readFileSync(file, 'utf8')); if (saved && typeof saved.day === 'string' && Number.isFinite(saved.usd)) ledger = { day: saved.day, usd: Math.max(0, saved.usd), calls: Math.max(0, Number(saved.calls) || 0) }; }
    catch (error) { if (error.code !== 'ENOENT') log(`The daily AI spend file (${path.basename(file)}) could not be read; today starts from $0.`); }
  }
  loadLedger();
  function today() { const current = day(now()); if (ledger.day !== current) ledger = { day: current, usd: 0, calls: 0 }; return ledger; }
  function saveLedger() {
    if (!dailyBudgetUsd || !file) return;
    try { fs.mkdirSync(path.dirname(file), { recursive: true }); const temp = `${file}.${process.pid}.tmp`; fs.writeFileSync(temp, JSON.stringify(ledger), { mode: 0o600 }); fs.renameSync(temp, file); }
    catch (_) { /* The in-memory total still holds the cap until a restart. */ }
  }
  // Called with each call's reported cost (failed calls included); unknown or Codex costs count as nothing.
  function record(costUsd) {
    const cost = Number(costUsd);
    if (!Number.isFinite(cost) || cost <= 0) return;
    const entry = today(); entry.usd = Math.round((entry.usd + cost) * 1e6) / 1e6; entry.calls++;
    saveLedger();
  }
  function checkBudget() {
    if (!dailyBudgetUsd) return;
    const entry = today();
    if (entry.usd + 1e-9 >= dailyBudgetUsd) throw refusal(`The studio’s daily AI budget of ${money(dailyBudgetUsd)} is used up for today (${money(entry.usd)} so far). New AI work can start after midnight UTC, or an admin can raise STUDIO_DAILY_AI_BUDGET_USD.`, 'dailyAiBudget');
  }

  // ---------- how many at once ----------
  let running = 0; const waiting = [];
  function next() {
    while (waiting.length && running < concurrency) {
      const entry = waiting.shift(); if (entry.done) continue;
      entry.done = true; running++; entry.resolve(release());
    }
  }
  function release() { let released = false; return () => { if (released) return; released = true; running--; next(); }; }
  // Resolves with a release function once a slot is free. `onWait(ahead)` hears the line's length when it has to wait;
  // the returned cancel() (also given to `register`) rejects a call still waiting, with "Job cancelled." like every stop.
  function acquire({ register, onWait } = {}) {
    if (!concurrency) return Promise.resolve(() => {});
    if (running < concurrency && !waiting.length) { running++; return Promise.resolve(release()); }
    let entry;
    const promise = new Promise((resolve, reject) => { entry = { resolve, reject, done: false }; });
    const cancel = () => { if (entry.done) return; entry.done = true; const index = waiting.indexOf(entry); if (index >= 0) waiting.splice(index, 1); entry.reject(Object.assign(new Error('Job cancelled.'), { code: 'cancelled' })); };
    waiting.push(entry);
    if (register) register(cancel);
    try { onWait?.(waiting.length); } catch (_) { /* a message is a courtesy */ }
    if (waiting.length === 1 || waiting.length % 10 === 0) log(JSON.stringify({ event: 'ai-queue', waiting: waiting.length, running }));
    return promise;
  }

  // One AI call under both limits: the budget is checked before waiting and again once a slot is free.
  async function run(task, { register, onWait, cost = (result) => result?.receipt?.costUsd } = {}) {
    checkBudget();
    const done = await acquire({ register, onWait });
    try {
      checkBudget();
      const result = await task();
      record(cost(result));
      return result;
    } catch (error) {
      record(error?.costUsd);
      throw error;
    } finally { done(); }
  }

  const status = () => ({ concurrency: concurrency || null, running, waiting: waiting.length, dailyBudgetUsd: dailyBudgetUsd || null, spentTodayUsd: dailyBudgetUsd ? Math.round(today().usd * 100) / 100 : null, day: today().day });
  return { enabled: Boolean(concurrency || dailyBudgetUsd), concurrency: concurrency || null, dailyBudgetUsd: dailyBudgetUsd || null, acquire, run, record, checkBudget, status };
}

module.exports = { createAiLimits };
