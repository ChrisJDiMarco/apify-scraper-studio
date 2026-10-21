'use strict';
// OpenRouter (any model through one key): POST https://openrouter.ai/api/v1/chat/completions, streamed. Same contract as
// the other text runners: run({ schema, prompt, cachePrefix, model, effort, maxBudgetUsd, timeoutMs, signal, onDelta,
// profile, price }) → { output, receipt }, errors with .code and .costUsd (a number, or null when billed but unknown).
// Structured answers: a strict json_schema with require_parameters when the model supports it ('native'), else
// response_format json_object plus the schema written in the prompt ('json-mode'), else the schema in the prompt only
// ('prompt'). A 400 about the schema retries once with the schema in the prompt. The key is never logged and the base
// URL is pinned (no environment override). Electron-free; fetch is injected.
const { STUDIO_SYSTEM_PROMPT } = require('../shared/claude-runner');
const { toApiSchema, answerFormat, planBudget, GRAMMAR_REFUSED, RAISE_BUDGET, RAW_TEXT_BYTES, usd } = require('../shared/anthropic-runner');
const { parseJsonReply, schemaAccept, clipText } = require('../shared/json-reply');
const { fetchJson, readSse, wait, httpError } = require('./ai-http');

const OPENROUTER_API = 'https://openrouter.ai/api/v1';
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const IDLE_MS = 120000;
const KEY = /sk-or-[A-Za-z0-9_-]+/g;
const redact = (text) => String(text ?? '').replace(KEY, 'sk-or-…').replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer …');
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
function runnerError(message, code, fields = {}) { return httpError(redact(message), code, fields); }

// Strict structured outputs need every property listed in required; an optional one becomes "T or null", and the nulls
// the original schema didn't ask for are removed again (stripNulls) before the caller validates the answer.
function toStrictSchema(schema) {
  const visit = (node) => {
    if (!isObject(node)) return node;
    const out = { ...node };
    for (const key of ['anyOf', 'allOf', 'oneOf']) if (Array.isArray(out[key])) out[key] = out[key].map(visit);
    if (isObject(out.items)) out.items = visit(out.items);
    if (isObject(out.$defs)) out.$defs = Object.fromEntries(Object.entries(out.$defs).map(([name, child]) => [name, visit(child)]));
    if (out.type === 'object' && isObject(out.properties)) {
      const required = new Set(Array.isArray(out.required) ? out.required : []);
      out.properties = Object.fromEntries(Object.entries(out.properties).map(([name, child]) => {
        const strict = visit(child);
        return [name, required.has(name) ? strict : { anyOf: [strict, { type: 'null' }] }];
      }));
      out.required = Object.keys(out.properties);
      out.additionalProperties = false;
    }
    return out;
  };
  return visit(toApiSchema(schema));
}
function stripNulls(value, schema) {
  if (!isObject(schema)) return value;
  if (Array.isArray(value)) return isObject(schema.items) ? value.map((entry) => stripNulls(entry, schema.items)) : value;
  if (!isObject(value) || !isObject(schema.properties)) return value;
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  return Object.fromEntries(Object.entries(value).filter(([key, entry]) => !(entry === null && !required.has(key))).map(([key, entry]) => [key, stripNulls(entry, schema.properties[key])]));
}

function createOpenRouterRunner({ getKey, fetchImpl = globalThis.fetch, clock = Date.now, privacy = () => 'no-training', sleep = wait, appTitle = 'Golden Thread' } = {}) {
  function key() {
    const value = getKey('OPENROUTER_API_KEY');
    if (typeof value !== 'string' || !value.trim()) throw runnerError('Add an OpenRouter key in Settings, AI connections. Nothing was started.', 'AI_NOT_CONNECTED', { costUsd: 0 });
    return value.trim();
  }
  const headers = (credential) => ({ Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json', Accept: 'text/event-stream', 'X-Title': appTitle });

  function statusError(status, body, model, costUsd = 0) {
    const detail = redact(body?.error?.message || body?.message || '').replace(/\s+/g, ' ').slice(0, 300);
    if (status === 401) return runnerError('The OpenRouter key was rejected. Check it in Settings, AI connections.', 'OPENROUTER_AUTH', { costUsd, status });
    if (status === 402) return runnerError('The OpenRouter account is out of credits. Add credits on openrouter.ai, then retry.', 'OPENROUTER_CREDITS', { costUsd, status });
    if (status === 403) return runnerError(`OpenRouter’s moderation declined this request.${detail ? ` (${detail})` : ''}`, 'AI_REFUSED', { costUsd, status });
    if (status === 404 || (status === 400 && /model|provider|endpoint/i.test(detail) && !GRAMMAR_REFUSED.test(detail) && !/schema|grammar|response_format|json/i.test(detail))) return runnerError(`OpenRouter can’t find ${model} (or no provider that meets your privacy setting serves it with structured answers).`, 'OPENROUTER_MODEL_UNAVAILABLE', { costUsd, status });
    if (status === 408) return runnerError('OpenRouter timed out before the model answered. Retry in a minute.', 'TIMEOUT', { costUsd, status });
    if (status === 429) return runnerError('OpenRouter’s rate limit for this key was reached, even after retries. Wait a minute, then retry.', 'OPENROUTER_RATE_LIMITED', { costUsd, status });
    if (status === 502 || status === 503) return runnerError(`No provider for ${model} is answering right now. Retry in a few minutes, or choose another model.`, 'OPENROUTER_UNAVAILABLE', { costUsd, status });
    if (status >= 400 && status < 500) return runnerError(`OpenRouter rejected this request: ${detail || status}`, 'OPENROUTER_BAD_REQUEST', { costUsd, status, detail });
    return runnerError(`OpenRouter had an error (${status}). Retry in a few minutes.`, 'OPENROUTER_ERROR', { costUsd, status });
  }

  // The charge for a finished generation when the stream ended without its usage (3 tries, 2 s apart).
  async function recoverCost(credential, generationId) {
    if (!generationId) return null;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) await sleep(2000);
      try {
        const reply = await fetchJson(fetchImpl, `${OPENROUTER_API}/generation?id=${encodeURIComponent(generationId)}`, { headers: { Authorization: `Bearer ${credential}`, Accept: 'application/json' }, timeoutMs: 15000 });
        const cost = Number(reply.json?.data?.total_cost);
        if (reply.ok && Number.isFinite(cost) && cost >= 0) return cost;
      } catch (_) { /* try again */ }
    }
    return null;
  }

  async function run({ schema, prompt, cachePrefix = '', model, effort = '', maxBudgetUsd = 1, timeoutMs, signal, onDelta, profile = {}, price = null } = {}) {
    if (typeof model !== 'string' || !/^[a-z0-9][a-z0-9._-]*\/[a-zA-Z0-9][a-zA-Z0-9._:-]{0,120}$/.test(model)) throw runnerError('Choose an OpenRouter model ID such as anthropic/claude-opus-5.5.', 'AI_BAD_INPUT', { costUsd: 0 });
    if (!isObject(schema)) throw runnerError('A structured answer needs a JSON schema object.', 'AI_BAD_INPUT', { costUsd: 0 });
    if (typeof prompt !== 'string' || !prompt.trim()) throw runnerError('The AI input is empty.', 'AI_BAD_INPUT', { costUsd: 0 });
    const budget = Number(maxBudgetUsd);
    if (!Number.isFinite(budget) || budget < 0.01 || budget > 100) throw runnerError('The AI budget must be between $0.01 and $100.', 'AI_BAD_INPUT', { costUsd: 0 });
    const known = (value) => (value === null || value === undefined || value === '' ? NaN : Number(value));
    const inputPrice = known(price?.inputUsdPerMTok ?? profile.inputUsdPerMTok); const outputPrice = known(price?.outputUsdPerMTok ?? profile.outputUsdPerMTok);
    if (!Number.isFinite(inputPrice) || !Number.isFinite(outputPrice) || outputPrice <= 0) throw runnerError(`The studio doesn’t know ${model}’s price, so it can’t cap this request. Nothing was started.`, 'AI_PRICE_UNKNOWN', { costUsd: 0 });
    const credential = key();
    const schemaText = JSON.stringify(schema);
    const mode = profile.structured === 'native' || profile.structured === 'json-mode' ? profile.structured : 'prompt';
    const { budgetTokens } = planBudget({ model, maxBudgetUsd: budget, inputCharacters: STUDIO_SYSTEM_PROMPT.length + cachePrefix.length + prompt.length + schemaText.length, price: { input: inputPrice, output: outputPrice } });
    const modelCap = Number.isFinite(profile.maxOutputTokens) && profile.maxOutputTokens > 0 ? profile.maxOutputTokens : 32000;
    const maxTokens = Math.min(modelCap, budgetTokens); const capSource = budgetTokens < modelCap ? 'budget' : 'model';
    const setting = typeof privacy === 'function' ? privacy() : privacy;
    const cacheable = /^(anthropic|google)\//.test(model);
    const reasoning = effort && profile.reasoning ? { effort: ['low', 'medium', 'high'].includes(effort) ? effort : effort === 'max' || effort === 'xhigh' ? 'high' : 'medium' } : undefined;
    const body = (structured) => ({
      model, stream: true, max_tokens: maxTokens, usage: { include: true },
      messages: [
        { role: 'system', content: STUDIO_SYSTEM_PROMPT },
        ...(cachePrefix ? [{ role: 'system', content: [{ type: 'text', text: cachePrefix, ...(cacheable ? { cache_control: { type: 'ephemeral' } } : {}) }] }] : []),
        { role: 'user', content: structured === 'native' ? prompt : prompt + answerFormat(schemaText) },
      ],
      ...(structured === 'native' ? { response_format: { type: 'json_schema', json_schema: { name: 'studio_answer', strict: true, schema: toStrictSchema(schema) } } } : structured === 'json-mode' ? { response_format: { type: 'json_object' } } : {}),
      provider: { ...(structured !== 'prompt' ? { require_parameters: true } : {}), data_collection: setting === 'any' ? 'allow' : 'deny', ...(setting === 'zdr' ? { zdr: true } : {}) },
      ...(reasoning ? { reasoning } : {}),
    });
    const limitMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.min(timeoutMs, 2 ** 31 - 1) : DEFAULT_TIMEOUT_MS;
    const startedAt = clock();

    async function attempt(structured) {
      const controller = new AbortController(); let timedOut = false; let idled = false;
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, limitMs);
      const cancel = () => controller.abort();
      if (signal?.aborted) controller.abort(); else signal?.addEventListener?.('abort', cancel, { once: true });
      let started = false; let text = ''; let usage = null; let finish = ''; let generationId = ''; let returnedModel = ''; let streamError = null;
      try {
        let response;
        for (let tries = 0; ; tries++) {
          try { response = await fetchImpl(`${OPENROUTER_API}/chat/completions`, { method: 'POST', headers: headers(credential), body: JSON.stringify(body(structured)), redirect: 'error', signal: controller.signal }); }
          catch (error) { if (timedOut) throw runnerError(`OpenRouter timed out after ${Math.round(limitMs / 1000)} seconds.`, 'TIMEOUT', { costUsd: 0 }); if (signal?.aborted) throw runnerError('Job cancelled.', 'CANCELLED', { costUsd: 0 }); throw runnerError('Could not reach OpenRouter. Check the internet connection, then retry.', 'AI_NETWORK', { costUsd: 0 }); }
          if (response.status === 429 && tries < 2) {
            const waitSeconds = Number(response.headers?.get?.('retry-after'));
            await sleep(Math.min(30000, Number.isFinite(waitSeconds) && waitSeconds > 0 ? waitSeconds * 1000 : 2000 * (tries + 1)));
            continue;
          }
          break;
        }
        if (!response.ok) { let parsed = null; try { parsed = JSON.parse(await response.text()); } catch (_) { parsed = null; } throw statusError(response.status, parsed, model, 0); }
        started = true;
        await readSse(response, ({ data }) => {
          if (data === '[DONE]') return;
          let chunk; try { chunk = JSON.parse(data); } catch (_) { return; }
          if (chunk.id && !generationId) generationId = String(chunk.id);
          if (typeof chunk.model === 'string' && chunk.model) returnedModel = chunk.model;
          if (chunk.error) { streamError = chunk.error; return; }
          const choice = Array.isArray(chunk.choices) ? chunk.choices[0] : null;
          const piece = choice?.delta?.content;
          if (typeof piece === 'string' && piece) { text += piece; if (typeof onDelta === 'function') { try { onDelta(piece); } catch (_) { /* courtesy */ } } }
          if (choice?.finish_reason) finish = choice.finish_reason;
          if (choice?.error) streamError = choice.error;
          if (isObject(chunk.usage)) usage = chunk.usage;
        }, { idleMs: IDLE_MS, onIdle: () => { idled = true; } });
      } catch (error) {
        if (error?.code && !['AbortError'].includes(error.name)) { if (!(started && (timedOut || signal?.aborted))) throw error; }
        const costUsd = started ? null : 0;
        if (timedOut) throw runnerError(`OpenRouter timed out after ${Math.round(limitMs / 1000)} seconds.`, 'TIMEOUT', { costUsd });
        if (signal?.aborted) throw runnerError('Job cancelled.', 'CANCELLED', { costUsd });
        throw runnerError(`OpenRouter stopped streaming before the answer finished: ${redact(error?.message || error)}`, 'AI_NETWORK', { costUsd });
      } finally { clearTimeout(timer); signal?.removeEventListener?.('abort', cancel); }
      if (idled && !finish) throw runnerError('OpenRouter went quiet for two minutes before finishing. Retry, or choose another model.', 'TIMEOUT', { costUsd: await recoverCost(credential, generationId) });
      let costUsd = Number.isFinite(Number(usage?.cost)) ? Number(usage.cost) : await recoverCost(credential, generationId);
      if (!Number.isFinite(costUsd)) costUsd = null;
      return { text, usage, finish, generationId, returnedModel, streamError, costUsd };
    }

    let structured = mode; let reply;
    try { reply = await attempt(structured); }
    catch (error) {
      // A schema the provider won't take is refused before any answer (nothing billed): ask once with it in the prompt.
      if (error.code !== 'OPENROUTER_BAD_REQUEST' || !(GRAMMAR_REFUSED.test(error.detail || '') || /schema|grammar|response_format|json/i.test(error.detail || '')) || structured === 'prompt') throw error;
      structured = 'prompt'; reply = await attempt(structured);
    }
    const fields = { costUsd: reply.costUsd, requestId: reply.generationId || null };
    if (reply.streamError) {
      const detail = redact(reply.streamError.message || reply.streamError.code || 'unknown error').slice(0, 300);
      if (/moderat|flag|refus/i.test(detail)) throw runnerError(`OpenRouter’s moderation declined this request (${detail}).`, 'AI_REFUSED', fields);
      throw runnerError(`OpenRouter’s provider stopped with an error: ${detail}`, 'OPENROUTER_ERROR', fields);
    }
    if (reply.returnedModel && reply.returnedModel !== model && !reply.returnedModel.startsWith(model) && !model.startsWith(reply.returnedModel.split(':')[0])) throw runnerError(`OpenRouter answered with ${reply.returnedModel} instead of ${model}. No answer was saved.`, 'AI_MODEL_MISMATCH', fields);
    if (reply.finish === 'length') throw capSource === 'budget' ? runnerError(`The model stopped at this step’s spending cap before finishing (the ${usd(budget)} allowance covers about ${maxTokens.toLocaleString('en-US')} output tokens on ${model}). ${RAISE_BUDGET}`, 'AI_BUDGET_EXCEEDED', fields) : runnerError(`${model} reached its ${maxTokens.toLocaleString('en-US')}-token output limit before finishing. Use fewer sources or a lower effort level.`, 'AI_OUTPUT_TRUNCATED', fields);
    if (reply.finish === 'content_filter') throw runnerError(`${model}’s provider declined this request. No answer was saved.`, 'AI_REFUSED', fields);
    if (reply.finish && !['stop', 'end_turn'].includes(reply.finish)) throw runnerError(`The model stopped before finishing (${reply.finish}). No unvalidated answer was saved.`, 'AI_INVALID_RESULT', fields);
    if (!reply.text.trim()) throw runnerError('The model returned no answer. No unvalidated answer was saved.', 'AI_INVALID_RESULT', fields);
    // A strict schema's answer is JSON as sent; one written with the schema in the prompt is read leniently (json-reply.js),
    // and only an object shaped like the answer counts (schemaAccept). An answer that can't be read keeps its text
    // (redacted, 200 KB at most) for the local diagnostic and Ask AI.
    let output; let parse = 'none';
    try { ({ value: output, repaired: parse } = parseJsonReply(reply.text, { lenient: structured !== 'native', accept: schemaAccept(schema) })); }
    catch (_) { throw runnerError('The model’s answer wasn’t valid JSON. No unvalidated answer was saved.', 'AI_INVALID_RESULT', { ...fields, rawText: clipText(redact(reply.text), RAW_TEXT_BYTES), rawTextLength: reply.text.length, schemaInPrompt: structured !== 'native', stopReason: reply.finish || '' }); }
    if (!isObject(output)) throw runnerError('The model’s answer wasn’t a JSON object. No unvalidated answer was saved.', 'AI_INVALID_RESULT', fields);
    if (structured === 'native') output = stripNulls(output, toApiSchema(schema));
    const usage = reply.usage ? { prompt_tokens: reply.usage.prompt_tokens ?? null, completion_tokens: reply.usage.completion_tokens ?? null, cached_tokens: reply.usage.prompt_tokens_details?.cached_tokens ?? null, reasoning_tokens: reply.usage.completion_tokens_details?.reasoning_tokens ?? null } : null;
    return {
      output,
      receipt: { provider: 'openrouter', requestedModel: model, actualModel: reply.returnedModel || model, effort: reasoning?.effort || '', ...(effort && !reasoning ? { effortNote: `${model} takes no reasoning setting on OpenRouter, so it ran at its default.` } : {}), costUsd: reply.costUsd, costBasis: reply.costUsd == null ? 'OpenRouter charge not reported yet' : 'OpenRouter charge', usage, durationMs: Math.max(0, clock() - startedAt), requestId: reply.generationId || null, structuredOutput: structured === 'native' ? 'native' : 'schema in prompt', maxTokens, ...(parse !== 'none' ? { parse } : {}) },
    };
  }

  // Free: the key's label and remaining limit (GET /key).
  async function checkKey() {
    const credential = key();
    const reply = await fetchJson(fetchImpl, `${OPENROUTER_API}/key`, { headers: { Authorization: `Bearer ${credential}`, Accept: 'application/json' }, timeoutMs: 15000 });
    if (!reply.ok) throw statusError(reply.status, reply.json, 'this key');
    const data = reply.json?.data || {};
    const num = (value) => (Number.isFinite(Number(value)) && value !== null ? Number(value) : null);
    return { label: redact(String(data.label || '')).slice(0, 80), limitRemainingUsd: num(data.limit_remaining), usageUsd: num(data.usage), freeTier: data.is_free_tier === true };
  }

  return { run, checkKey };
}

module.exports = { createOpenRouterRunner, toStrictSchema, stripNulls, OPENROUTER_API };
