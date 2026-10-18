'use strict';
// Every AI text call goes through here: generateStructuredOutput({ schema, prompt, cachePrefix, taskId | task, onStream, … }).
// It resolves the task's connection, model and effort (ai-routing.js; a run's snapshot wins), refuses a connection that
// isn't ready (no silent fallback; 'auto' is Claude Code, else the Anthropic key), runs the matching runner, writes the
// answer to outputPath, and adds taskId, route and metered to the receipt.
//
// Streaming contract (Ask AI): onStream({ type: 'text', delta }) gets the answer field ('answer', or streamField) as it is
// written on every route that streams (Anthropic API, OpenRouter, OpenAI, Claude Code when it supports stream-json), and
// the whole field once at the end on the others (Codex); onStream({ type: 'status', text }) reports progress.
// A call with neither taskId nor task keeps the behavior from before Model routing: the studio text default with the
// model and effort it passes. Electron-free.
const { fieldStreamer } = require('../shared/structured-stream');

function createTextRouter({ routing, connections, runners, catalog = null, writeJson, apiRequests = new Map(), maxBudgetUsd: defaultBudget = () => 1 } = {}) {
  function legacyTask({ model, effort }) {
    const studio = routing.current();
    const route = studio.defaults.text.route;
    const codex = route === 'codex';
    const chosen = codex ? '' : model || studio.defaults.text.model;
    return { taskId: null, kind: 'text', route, model: chosen, effort: codex ? '' : effort || '', metered: !codex, price: catalog?.priceFor?.(route, chosen, 'text') || null, modelLabel: catalog?.modelLabel?.(route, chosen) || chosen, routeLabel: routing.routeLabel(route), source: 'legacy-call' };
  }

  async function run(args = {}) {
    const { schema, prompt, cachePrefix = '', workspaceDir, outputPath, jobId, timeoutMs, onStream, streamField = 'answer', program = null, run: studioRun = null } = args;
    const resolved = args.task || (args.taskId ? routing.resolve(args.taskId, { program, run: studioRun }) : legacyTask(args));
    if (resolved.kind && resolved.kind !== 'text') throw Object.assign(new Error(`${resolved.label || resolved.taskId} isn’t a writing job.`), { code: 'AI_ROUTING_PROBLEM' });
    if (resolved.problem) throw Object.assign(new Error(`${resolved.problem} Nothing was started.`), { code: 'AI_ROUTING_PROBLEM', costUsd: 0 });
    const streamer = fieldStreamer(onStream, streamField);
    const route = await connections.require(resolved.route);
    const runner = runners[route];
    if (!runner) throw Object.assign(new Error('That AI connection can’t write answers on this studio. Nothing was started.'), { code: 'AI_NOT_CONNECTED' });
    streamer?.status(`Writing with ${resolved.modelLabel || resolved.model || 'the default model'} · ${routing.routeLabel(route)}`);
    const budget = args.maxBudgetUsd ?? defaultBudget();
    const common = { schema, prompt, cachePrefix, model: resolved.model, effort: resolved.effort || undefined, maxBudgetUsd: budget, timeoutMs, workspaceDir, outputPath, jobId, ...(streamer ? { onDelta: streamer.push } : {}) };
    let result;
    if (['claude-api', 'openrouter', 'openai'].includes(route)) {
      // API calls register an AbortController under the job id, so Cancel (and quitting) stop them.
      const controller = new AbortController(); if (jobId) apiRequests.set(jobId, controller);
      try {
        // OpenRouter's list (and OpenAI prices it mirrors) may not be loaded yet in a fresh process: read it once first.
        if (route !== 'claude-api' && typeof catalog?.openrouterModels === 'function' && !(catalog.profile?.(route, resolved.model, 'text') && catalog.priceFor?.(route, resolved.model, 'text')?.known)) await catalog.openrouterModels().catch(() => null);
        const profile = route === 'claude-api' ? undefined : catalog?.profile?.(route, resolved.model, 'text') || {};
        // A snapshot's price is what the run was estimated with; a live list may know a newer one.
        const live = route === 'claude-api' ? null : catalog?.priceFor?.(route, resolved.model, 'text');
        const known = live?.known ? live : resolved.price?.known ? resolved.price : null;
        const price = known ? { inputUsdPerMTok: known.inputUsdPerMTok, outputUsdPerMTok: known.outputUsdPerMTok, cacheReadUsdPerMTok: known.cacheReadUsdPerMTok } : null;
        const call = route === 'claude-api'
          ? { schema, prompt, ...(cachePrefix ? { cachePrefix } : {}), model: resolved.model, effort: resolved.effort || undefined, maxBudgetUsd: budget, timeoutMs, signal: controller.signal, ...(streamer ? { onDelta: streamer.push } : {}) }
          : { ...common, signal: controller.signal, profile, price };
        const { output, receipt } = await runner.run(call);
        if (outputPath) writeJson(outputPath, output);
        result = { output, receipt, stdout: '' };
      } finally { if (jobId && apiRequests.get(jobId) === controller) apiRequests.delete(jobId); }
    } else result = await runner.run(common);
    streamer?.flush(result.output);
    if (resolved.taskId) result.receipt = { ...result.receipt, taskId: resolved.taskId, route, metered: resolved.metered !== false };
    return result;
  }
  return { run };
}

module.exports = { createTextRouter };
