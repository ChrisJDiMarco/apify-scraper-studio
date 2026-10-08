// Which way the app reaches Claude, and whether that way can run the models a job needs.
// "auto" (the default for new installs) uses the Claude app (Claude Code CLI) when it is installed,
// signed in and new enough for every flag the app passes; otherwise the Anthropic API key from Settings.
// Electron-free: the main process injects process spawning, key lookup and settings.
const fs = require('fs');
const path = require('path');
const { buildClaudeCommand, parseClaudeResult, modelMatches, missingClaudeFlags } = require('../shared/claude-runner');

const AI_ROUTE_TTL_MS = 10 * 60 * 1000;
const AI_ROUTE_LABELS = { claude: 'the Claude app', 'claude-api': 'the Anthropic API key', codex: 'Codex' };
const ADD_KEY = 'Add an Anthropic API key in Settings → Writing & research.';
const PING_SCHEMA = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false };

function createAiRoutes({ spawn, getKey, getSettings, dataDir, createRunner, describeError = (error) => error?.message || String(error), now = Date.now }) {
  let cached = null; // a working route, reused for ten minutes
  let client = null; // { apiKey, runner }
  const answered = new Set(); // `${route}:${model}` that answered this session
  const apiRequests = new Map(); // jobId → AbortController for in-flight API calls

  function invalidate() { cached = null; answered.clear(); }

  async function detectClaudeCli() {
    const run = (args) => spawn('claude', args, { timeoutMs: 10000 });
    let version;
    try { version = String((await run(['--version'])).stdout || '').trim(); }
    catch (error) { return { installed: false, error: error?.code === 'ENOENT' ? 'The Claude app (Claude Code) is not installed.' : describeError(error) }; }
    try {
      const missingFlags = missingClaudeFlags((await run(['--help'])).stdout);
      const status = JSON.parse((await run(['auth', 'status', '--json'])).stdout);
      return { installed: true, version, loggedIn: status.loggedIn === true, missingFlags };
    } catch (error) { return { installed: true, version, loggedIn: false, missingFlags: [], error: describeError(error) }; }
  }
  function cliProblem(cli) {
    if (!cli?.installed) return cli?.error || 'The Claude app (Claude Code) is not installed.';
    if (cli.missingFlags?.length) return `This Claude app (${cli.version}) is too old for Scraper Studio; it lacks ${cli.missingFlags.join(', ')}. Run "claude update" in Terminal.`;
    if (!cli.loggedIn) return 'The Claude app is not signed in. Run "claude auth login" in Terminal.';
    return '';
  }

  // { provider, route, cli, keySaved, problem }; route is '' when nothing works. Only working routes are cached.
  async function resolve(provider = getSettings().aiProvider || 'auto', { fresh = false } = {}) {
    if (!fresh && cached?.provider === provider && now() - cached.at < AI_ROUTE_TTL_MS) return cached;
    const keySaved = Boolean(getKey('ANTHROPIC_API_KEY'));
    let resolved;
    if (provider === 'codex') resolved = { provider, route: 'codex', problem: '' };
    else if (provider === 'claude-api') resolved = { provider, route: 'claude-api', keySaved, problem: keySaved ? '' : ADD_KEY };
    else {
      const cli = await detectClaudeCli(); const issue = cliProblem(cli);
      if (provider === 'claude') resolved = { provider, route: 'claude', cli, keySaved, problem: issue };
      else if (!issue) resolved = { provider, route: 'claude', cli, keySaved, problem: '' };
      else if (keySaved) resolved = { provider, route: 'claude-api', cli, keySaved, problem: '' };
      else resolved = { provider, route: '', cli, keySaved, problem: `${issue} Or ${ADD_KEY.charAt(0).toLowerCase()}${ADD_KEY.slice(1)}` };
    }
    if (!resolved.problem) cached = { ...resolved, at: now() };
    return resolved;
  }
  async function requireRoute() {
    const resolved = await resolve();
    if (resolved.problem) throw new Error(resolved.problem);
    return resolved;
  }

  function runner() {
    const apiKey = getKey('ANTHROPIC_API_KEY');
    if (!apiKey) throw new Error(ADD_KEY);
    if (client?.apiKey !== apiKey) client = { apiKey, runner: createRunner({ apiKey }) };
    return client.runner;
  }

  // One tiny structured request through the Claude app proves the account can use a model (a few cents).
  async function pingCli(model) {
    const dir = path.join(dataDir(), 'preflight'); fs.mkdirSync(dir, { recursive: true });
    const invocation = buildClaudeCommand({ model, maxBudgetUsd: 0.25, effort: 'low', prompt: 'Return {"ok": true}.', schema: PING_SCHEMA });
    const result = await spawn(invocation.command, invocation.args, { cwd: dir, stdin: invocation.stdin, timeoutMs: 120000 });
    const parsed = parseClaudeResult(result.stdout);
    if (!modelMatches(model, parsed.actualModels)) throw new Error(`Claude answered with ${parsed.actualModels.join(', ') || 'an unreported model'} instead of ${model}.`);
  }

  // Which of these models the route can use: free through the Models API, a tiny request each through the
  // Claude app. Successes are remembered for the session.
  async function checkModels(route, models, { fresh = false } = {}) {
    const unique = [...new Set((models || []).filter((model) => typeof model === 'string' && model))];
    if (!unique.length || !route || route === 'codex') return [];
    const pending = unique.filter((model) => fresh || !answered.has(`${route}:${model}`));
    const found = new Map();
    if (route === 'claude-api' && pending.length) for (const row of (await runner().checkModels({ models: pending })).models || []) found.set(row.id, row);
    if (route === 'claude') for (const model of pending) {
      try { await pingCli(model); found.set(model, { id: model, available: true }); }
      catch (error) { found.set(model, { id: model, available: false, error: describeError(error) }); }
    }
    return unique.map((model) => {
      const row = found.get(model) || { id: model, available: answered.has(`${route}:${model}`) };
      if (row.available) answered.add(`${route}:${model}`);
      return { id: model, available: Boolean(row.available), error: row.available ? '' : row.error || 'Not available to this account.' };
    });
  }

  // Before anything that spends: a usable route, and every model the work will need.
  async function preflight(models) {
    const { route } = await requireRoute();
    const blocked = (await checkModels(route, models)).filter((row) => !row.available);
    if (blocked.length) throw new Error(`${AI_ROUTE_LABELS[route]} can't use ${blocked.map((row) => row.id).join(' or ')}: ${blocked[0].error} Choose another model for those stages under "AI models and effort per stage", or use an account with access. Nothing was started.`);
  }

  // Settings → Check: the route the selected provider resolves to, the Claude app's state, and model access.
  async function check({ provider = getSettings().aiProvider || 'auto', models = [] } = {}) {
    const resolved = await resolve(provider, { fresh: true });
    const base = { provider, route: resolved.route, cli: resolved.cli || null, keySaved: resolved.keySaved, version: resolved.cli?.version || '', loggedIn: resolved.cli?.loggedIn };
    if (resolved.problem) return { ...base, ok: false, models: [], error: resolved.problem };
    let rows;
    try { rows = await checkModels(resolved.route, models, { fresh: true }); }
    catch (error) { return { ...base, ok: false, models: [], error: describeError(error) }; }
    const blocked = rows.find((row) => !row.available);
    return { ...base, ok: !blocked, models: rows, error: blocked ? `${blocked.id}: ${blocked.error}` : '' };
  }

  return { resolve, requireRoute, runner, checkModels, preflight, check, invalidate, apiRequests, detectClaudeCli };
}

module.exports = { createAiRoutes, AI_ROUTE_TTL_MS, AI_ROUTE_LABELS };
