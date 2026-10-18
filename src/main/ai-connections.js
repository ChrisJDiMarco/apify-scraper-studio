'use strict';
// The six AI connections and whether each is ready: Claude Code and Codex (subscription sign-ins on the machine the
// studio runs on; on the browser studio that is the server), and the Anthropic, OpenAI, OpenRouter and fal.ai keys.
// status() is free and cached for a minute; require(route) refuses work on a connection that isn't ready with a plain
// message; test() runs Settings → AI connections → Test; preflight(tasks) checks every model a piece of work will use
// before anything is spent. Electron-free; index.js injects the CLI probe, keys and runners.
const PROVIDERS = require('../shared/ai-providers.json');

const STATUS_TTL_MS = 60 * 1000;
const CONNECTIONS = Object.fromEntries(PROVIDERS.connections.map((entry) => [entry.id, entry]));
const KEY_ROUTES = ['claude-api', 'openai', 'openrouter', 'fal'];
const NOTHING = 'Nothing was started.';

// "codex login status" output → how Codex is signed in: 'chatgpt' | 'api-key', '' when it says it is signed out, or
// 'unknown' when the answer can't be read (an older Codex without the command, a timeout). Only a clear "not logged in"
// stops work; an unreadable answer lets Codex run and report its own sign-in problem, as before Model routing.
function codexSignIn({ code, stdout = '', stderr = '', timedOut = false } = {}) {
  const text = `${stdout}\n${stderr}`;
  if (/not logged in|logged out|not signed in/i.test(text)) return '';
  if (/logged in using an api key/i.test(text)) return 'api-key';
  if (code === 0 && /logged in/i.test(text)) return 'chatgpt';
  return timedOut || code !== 0 || !text.trim() || !/logged in/i.test(text) ? 'unknown' : 'chatgpt';
}
const versionOf = (text) => String(text || '').trim().split(/\r?\n/)[0].replace(/^codex-cli\s+/i, '').replace(/\s*\(Claude Code\)\s*$/i, '').slice(0, 60);

function createAiConnections({ aiRoutes, probeCli, getKey, keyProblem = () => '', web = false, serverUser = '', catalog = null, runners = {}, getRouting = () => null, onChecked = () => {}, now = Date.now } = {}) {
  let cached = null; // { at, value }
  let inflight = null;
  const where = web ? 'on the studio server' : 'on this Mac';
  const keyState = (route) => {
    const name = CONNECTIONS[route].keyName; const problem = keyProblem(name);
    if (problem) return { status: 'key-unreadable', keySaved: true, keyProblem: problem };
    return getKey(name) ? { status: 'ready', keySaved: true } : { status: 'no-key', keySaved: false };
  };
  const vendorKey = { 'claude-api': 'Anthropic', openai: 'OpenAI', openrouter: 'OpenRouter', fal: 'fal.ai' };
  const storage = (route) => web ? `Stored encrypted on the studio server and sent only to ${vendorKey[route]}.` : `Stored encrypted in this Mac’s keychain and sent only to ${vendorKey[route]}.`;

  async function claudeStatus() {
    const cli = await aiRoutes.detectClaudeCli();
    const base = { id: 'claude', version: cli.installed ? versionOf(cli.version) : '', commands: [] };
    if (!cli.installed) return { ...base, status: 'not-installed', detail: `Claude Code isn’t installed ${where}. Install it, then sign in.`, commands: [{ label: 'Then sign in', command: 'claude auth login' }] };
    if (cli.missingFlags?.length) return { ...base, status: 'update', detail: 'This version can’t run studio requests. In Terminal run: claude update', commands: [{ label: 'Update', command: 'claude update' }] };
    if (!cli.loggedIn) return { ...base, status: 'sign-in', detail: 'Not signed in. In Terminal run: claude auth login', commands: [{ label: 'Sign in', command: 'claude auth login' }] };
    return { ...base, status: 'ready', signedInWith: cli.authMethod === 'claude.ai' || !cli.authMethod ? 'claude-plan' : 'api-key', detail: `Signed in · Claude Code ${versionOf(cli.version)}`, streaming: Boolean(cli.streaming) };
  }
  async function codexStatusNow() {
    const version = await probeCli('codex', ['--version']);
    if (version.missing) return { id: 'codex', status: 'not-installed', version: '', detail: `Codex isn’t installed ${where}. Install it, then sign in.`, commands: [{ label: 'Then sign in', command: 'codex login' }] };
    const login = await probeCli('codex', ['login', 'status']);
    const signedInWith = codexSignIn(login);
    const label = versionOf(version.stdout || version.stderr);
    if (!signedInWith) return { id: 'codex', status: 'sign-in', version: label, detail: 'Not signed in. In Terminal run: codex login', commands: [{ label: 'Sign in', command: 'codex login' }] };
    if (signedInWith === 'unknown') return { id: 'codex', status: 'ready', version: label, signedInWith: '', detail: `${label ? `Codex ${label} · ` : ''}the sign-in couldn’t be confirmed. If Codex jobs fail, run in Terminal: codex login`, commands: [{ label: 'Check the sign-in', command: 'codex login status' }] };
    return { id: 'codex', status: 'ready', version: label, signedInWith, detail: `${signedInWith === 'chatgpt' ? 'Signed in with ChatGPT' : 'Signed in with an API key'}${label ? ` · Codex ${label}` : ''}`, commands: [] };
  }
  // Codex's own status is cached apart from the rest, so a Codex job checks only Codex (two quick CLI calls a minute).
  let codexCached = null; let codexInflight = null;
  async function codexStatus({ fresh = false } = {}) {
    if (!fresh && codexCached && now() - codexCached.at < STATUS_TTL_MS) return codexCached.value;
    if (!fresh && codexInflight) return codexInflight;
    codexInflight = codexStatusNow().then((value) => { codexCached = { at: now(), value }; return value; }).finally(() => { codexInflight = null; });
    return codexInflight;
  }
  function keyStatus(route) {
    const state = keyState(route); const name = vendorKey[route];
    const detail = state.status === 'key-unreadable'
      ? (state.keyProblem === 'mismatch' ? 'This key was saved with a different STUDIO_SECRET_KEY. Start the studio with the original key, or clear it and save it again.' : 'This key can’t be read here. Clear it and save it again.')
      : state.status === 'ready' ? `Key saved. ${storage(route)}` : `Add a ${name} key to use it. ${storage(route)}`;
    return { id: route, ...state, detail, commands: [] };
  }
  const usedBy = (route) => {
    const routing = getRouting(); if (!routing?.tasks) return [];
    return routing.tasks.filter((row) => row.route === route || (route === 'claude' && row.route === 'auto') || (route === 'claude-api' && row.route === 'auto')).map((row) => row.taskId);
  };

  async function compute(fresh = false) {
    const rows = await Promise.all([
      claudeStatus().catch((error) => ({ id: 'claude', status: 'not-installed', detail: String(error?.message || error), commands: [] })),
      keyStatus('claude-api'),
      codexStatus({ fresh }).catch((error) => ({ id: 'codex', status: 'not-installed', detail: String(error?.message || error), commands: [] })),
      keyStatus('openai'), keyStatus('openrouter'), keyStatus('fal'),
    ]);
    return {
      host: web ? 'server' : 'mac', serverUser: web ? serverUser || null : null, checkedAt: new Date(now()).toISOString(),
      connections: rows.map((row) => { const meta = CONNECTIONS[row.id]; return { label: meta.label, ...(meta.plan ? { plan: meta.plan } : {}), kinds: meta.kinds, auth: meta.auth, ...row, ...(web && meta.auth === 'subscription-cli' ? { serverNote: `This uses the sign-in on the studio server${serverUser ? ` (user ${serverUser})` : ''}, not your own account. Whoever runs the server signs in there, and usage counts against that plan.${row.id === 'codex' ? ' Codex can read files the server’s user can read. Prefer Claude on a shared server.' : ''}` } : {}), usedBy: usedBy(row.id) }; }),
    };
  }
  async function status({ fresh = false } = {}) {
    if (!fresh && cached && now() - cached.at < STATUS_TTL_MS) return cached.value;
    if (!fresh && inflight) return inflight;
    inflight = compute(fresh).then((value) => { cached = { at: now(), value }; return value; }).finally(() => { inflight = null; });
    return inflight;
  }
  function invalidate() { cached = null; codexCached = null; aiRoutes?.invalidate?.(); }
  // Synchronous readiness from what's known now (keys are read directly; Claude Code and Codex from the last status).
  // null means not checked yet.
  function ready(route) {
    if (KEY_ROUTES.includes(route)) return keyState(route).status === 'ready';
    const row = route === 'codex' && codexCached ? codexCached.value : cached?.value?.connections?.find((entry) => entry.id === route);
    if (route === 'auto') { const claude = cached?.value?.connections?.find((entry) => entry.id === 'claude'); return claude?.status === 'ready' || keyState('claude-api').status === 'ready' ? true : claude ? false : null; }
    return row ? row.status === 'ready' : null;
  }
  function cachedStatus() { return cached?.value || null; }

  // The Claude route "auto" takes right now: Claude Code when ready, else the Anthropic key (ai-routes.js).
  async function claudeRoute(provider = 'auto') {
    const resolved = await aiRoutes.resolve(provider);
    if (resolved.problem) throw Object.assign(new Error(`${resolved.problem}${/Nothing was started/.test(resolved.problem) ? '' : ` ${NOTHING}`}`), { code: 'AI_NOT_CONNECTED' });
    return resolved.route;
  }
  // Refuses work on a connection that isn't ready. Returns the concrete route ('auto' becomes claude or claude-api).
  async function requireConnection(route) {
    if (route === 'auto' || route === 'claude') return claudeRoute(route);
    if (route === 'claude-api') { const state = keyState(route); if (state.status !== 'ready') throw notReady(route, state); return route; }
    if (route === 'codex') {
      // Only Codex is checked (its version and "codex login status"); a sign-out seen earlier is checked again first.
      let row = await codexStatus();
      if (row?.status !== 'ready') row = await codexStatus({ fresh: true });
      if (row?.status === 'not-installed') throw Object.assign(new Error(`Codex isn’t installed ${where}. ${NOTHING}`), { code: 'AI_NOT_CONNECTED' });
      if (row?.status !== 'ready') throw Object.assign(new Error(`Codex isn’t signed in ${where}. In Terminal run: codex login. ${NOTHING}`), { code: 'AI_NOT_CONNECTED' });
      return route;
    }
    if (KEY_ROUTES.includes(route)) { const state = keyState(route); if (state.status !== 'ready') throw notReady(route, state); return route; }
    throw Object.assign(new Error(`Unknown AI connection. ${NOTHING}`), { code: 'AI_NOT_CONNECTED' });
  }
  function notReady(route, state) {
    const name = { 'claude-api': 'an Anthropic API', openai: 'an OpenAI', openrouter: 'an OpenRouter', fal: 'a fal.ai' }[route];
    const message = state.status === 'key-unreadable' ? `The saved ${vendorKey[route]} key can’t be read here. Clear it in Settings, AI connections and save it again. ${NOTHING}` : `Add ${name} key in Settings, AI connections. ${NOTHING}`;
    return Object.assign(new Error(message), { code: 'AI_NOT_CONNECTED', route });
  }
  function problem(route) {
    if (KEY_ROUTES.includes(route)) { const state = keyState(route); return state.status === 'ready' ? '' : notReady(route, state).message; }
    const state = ready(route); return state === false ? `${CONNECTIONS[route]?.label || 'Claude'} isn’t ready ${where}. Check it in Settings, AI connections.` : '';
  }

  // Settings → AI connections → Test (free except Claude Code's model check, a few cents). Records lastAiCheck.
  async function test(connection, { models = [] } = {}) {
    const ids = [...new Set((Array.isArray(models) ? models : []).filter((id) => typeof id === 'string' && id))];
    let result;
    try {
      if (connection === 'claude' || connection === 'claude-api') {
        const check = await aiRoutes.check({ provider: connection, models: ids });
        result = { ok: Boolean(check.ok), connection, detail: check.ok ? (connection === 'claude' ? `Works · Claude Code ${versionOf(check.version)}` : `Works · can use ${check.models.filter((row) => row.available).map((row) => catalog?.modelLabel?.(connection, row.id) || row.id).join(', ') || 'the key'}`) : check.error || 'Not ready yet.', models: check.models || [], ...(check.error && !check.ok ? { error: check.error } : {}) };
      } else if (connection === 'codex') {
        const row = (await status({ fresh: true })).connections.find((entry) => entry.id === 'codex');
        const listed = catalog?.codexModels ? catalog.codexModels().filter((entry) => entry.id) : [];
        result = { ok: row?.status === 'ready', connection, detail: row?.detail || '', models: ids.map((id) => ({ id, available: !listed.length || listed.some((entry) => entry.id === id), error: listed.length && !listed.some((entry) => entry.id === id) ? 'Codex doesn’t list this model.' : '' })), modelCount: listed.length };
      } else if (connection === 'openai') {
        await requireConnection('openai');
        const checks = await Promise.all(ids.map(async (id) => { try { await runners.openaiCheck(id); return { id, available: true, error: '' }; } catch (error) { return { id, available: false, error: String(error?.message || error) }; } }));
        const ok = checks.every((row) => row.available);
        result = { ok, connection, detail: ok ? `Works · ${checks.map((row) => catalog?.modelLabel?.(row.id.startsWith('gpt-image') ? 'openai' : 'openai', row.id, row.id.startsWith('gpt-image') ? 'image' : 'text') || row.id).join(', ') || 'key accepted'}` : checks.find((row) => !row.available)?.error || 'Not ready.', models: checks };
      } else if (connection === 'openrouter') {
        await requireConnection('openrouter');
        const account = await runners.openrouter.checkKey();
        const list = await catalog?.refresh?.({ route: 'openrouter' });
        const found = ids.map((id) => ({ id, available: Boolean(list?.models?.some((row) => row.id === id)), error: list?.models?.some((row) => row.id === id) ? '' : 'OpenRouter doesn’t list this model.' }));
        const left = account.limitRemainingUsd;
        result = { ok: found.every((row) => row.available), connection, detail: `Works · ${Number.isFinite(left) ? `$${left.toFixed(2)} left on this key` : 'no spending limit on this key'}`, models: found, account };
      } else if (connection === 'fal') {
        await requireConnection('fal');
        const priced = ids.length ? await catalog.falPrices(ids) : {};
        for (const id of ids) { try { await catalog.falModel(id); } catch (error) { if (error.code === 'FAL_AUTH') throw error; } }
        const loaded = Object.values(priced).filter(Boolean).length;
        result = { ok: true, connection, detail: `Works · prices loaded for ${loaded} ${loaded === 1 ? 'model' : 'models'}`, models: ids.map((id) => ({ id, available: Boolean(priced[id]), error: priced[id] ? '' : 'fal.ai didn’t return a price for this model.' })), pricesLoaded: loaded };
      } else throw new Error('Choose a connection to test.');
    } catch (error) { result = { ok: false, connection, detail: '', error: String(error?.message || error), models: [] }; }
    try { onChecked({ ok: result.ok, provider: connection, at: new Date(now()).toISOString() }); } catch (_) { /* a record is a courtesy */ }
    invalidate();
    return result;
  }

  // Before anything that spends: every connection the work uses is ready, and every model is usable there.
  // tasks: ResolvedTask[] (ai-routing.js). Throws one plain message naming the job, model and reason.
  async function preflight(tasks = [], { needs = () => ({}) } = {}) {
    const list = (Array.isArray(tasks) ? tasks : []).filter(Boolean);
    for (const task of list) if (task.problem) throw Object.assign(new Error(`${task.problem} ${NOTHING}`), { code: 'AI_ROUTING_PROBLEM' });
    const byRoute = new Map();
    for (const task of list) { const key = task.route; if (!byRoute.has(key)) byRoute.set(key, []); byRoute.get(key).push(task); }
    for (const [route, group] of byRoute) {
      const actual = await requireConnection(route);
      const label = CONNECTIONS[actual]?.label || 'Claude';
      const refuse = (task, reason) => Object.assign(new Error(`${label} can’t use ${task.modelLabel || task.model} for ${taskLabel(task)}: ${reason} Choose another model in Settings, Model routing, or use an account with access. ${NOTHING}`), { code: 'AI_MODEL_UNAVAILABLE' });
      if (actual === 'claude' || actual === 'claude-api') {
        const models = [...new Set(group.map((task) => task.model).filter(Boolean))];
        const rows = await aiRoutes.checkModels(actual, models);
        const blocked = rows.find((row) => !row.available);
        if (blocked) throw refuse(group.find((task) => task.model === blocked.id), blocked.error);
      } else if (actual === 'openrouter') {
        const result = await catalog.openrouterModels();
        for (const task of group) {
          const found = result.models?.find((row) => row.id === task.model);
          if (!found) throw refuse(task, result.stale && !result.models?.length ? 'The OpenRouter model list couldn’t be read.' : 'OpenRouter doesn’t list this model.');
          if (found.deprecated) throw refuse(task, 'OpenRouter has retired this model.');
          const minimum = needs(task.taskId)?.minContextTokens;
          if (minimum && Number.isFinite(found.contextTokens) && found.contextTokens < minimum + 8000) throw refuse(task, `it reads ${Math.round(found.contextTokens / 1000)}K tokens and this job needs about ${Math.round((minimum + 8000) / 1000)}K.`);
          if (found.inputUsdPerMTok == null || found.outputUsdPerMTok == null) throw refuse(task, 'OpenRouter didn’t return its price, so the studio can’t estimate it.');
        }
      } else if (actual === 'openai') {
        for (const task of group) {
          if (task.kind === 'text' && !catalog.priceFor('openai', task.model, 'text').known) { await catalog.openrouterModels().catch(() => null); if (!catalog.priceFor('openai', task.model, 'text').known) throw refuse(task, 'the studio doesn’t know its price, so it can’t estimate it.'); }
          if (task.kind === 'image' && !/^gpt-image-/.test(task.model)) throw refuse(task, 'it isn’t a GPT Image model.');
        }
      } else if (actual === 'fal') {
        for (const task of group) {
          let found;
          try { found = await catalog.falModel(task.model, { kind: task.kind }); } catch (error) { throw refuse(task, String(error?.message || error)); }
          if (!found.profile && !catalog.profile('fal', task.model, task.kind)) throw refuse(task, 'fal.ai doesn’t list this model.');
          if (found.profile?.deprecated) throw refuse(task, 'fal.ai has retired this model.');
          const price = catalog.priceFor('fal', task.model, task.kind);
          if (!price.known || !Number.isFinite(price.unitUsd)) throw Object.assign(new Error(`fal.ai didn’t return a price for ${task.modelLabel || task.model}, so the studio can’t estimate it. ${NOTHING}`), { code: 'AI_PRICE_UNKNOWN' });
          if (task.kind === 'image' && (found.profile?.png === false)) throw refuse(task, 'it can’t return PNG pictures.');
        }
      }
      // Codex: a model Codex doesn't list is only a warning (its list is a cache that can lag); nothing to check here.
    }
  }
  const taskLabel = (task) => (task.label || task.taskId || 'this job');

  return { status, cachedStatus, ready, problem, invalidate, claudeRoute, require: requireConnection, test, preflight };
}

module.exports = { createAiConnections, codexSignIn, STATUS_TTL_MS };
