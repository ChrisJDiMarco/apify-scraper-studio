'use strict';
// OpenAI text through the Responses API (POST https://api.openai.com/v1/responses), streamed, with a strict json_schema
// answer format. Same contract as the other text runners. OpenAI has no pricing API, so the cost comes from the
// resolved price (the studio's table, or OpenRouter's public list for the same model); a model without a known price is
// refused before anything is sent. A 400 about the schema retries once with the schema written in the prompt.
const { STUDIO_SYSTEM_PROMPT } = require('../shared/claude-runner');
const { answerFormat, planBudget, toApiSchema, GRAMMAR_REFUSED, RAISE_BUDGET, RAW_TEXT_BYTES, usd } = require('../shared/anthropic-runner');
const { parseJsonReply, schemaAccept, clipText } = require('../shared/json-reply');
const { toStrictSchema, stripNulls } = require('./openrouter-runner');
const { readSse, httpError, fetchJson } = require('./ai-http');

const OPENAI_API = 'https://api.openai.com/v1';
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const redact = (text) => String(text ?? '').replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-…').replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer …');
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
function runnerError(message, code, fields = {}) { return httpError(redact(message), code, fields); }

function createOpenAiTextRunner({ getKey, fetchImpl = globalThis.fetch, clock = Date.now } = {}) {
  function key() {
    const value = getKey('OPENAI_API_KEY');
    if (typeof value !== 'string' || !value.trim()) throw runnerError('Add an OpenAI API key in Settings, AI connections. Nothing was started.', 'AI_NOT_CONNECTED', { costUsd: 0 });
    return value.trim();
  }
  function statusError(status, body, model) {
    const detail = redact(body?.error?.message || '').replace(/\s+/g, ' ').slice(0, 300);
    if (status === 401) return runnerError('The OpenAI key was rejected. Check it in Settings, AI connections.', 'OPENAI_AUTH', { costUsd: 0, status });
    if (status === 403) return runnerError(`The OpenAI key can’t use ${model}${detail ? ` (${detail})` : ''}.`, 'OPENAI_AUTH', { costUsd: 0, status });
    if (status === 404) return runnerError(`This OpenAI key can’t use ${model}. Choose another model, or use a key with access to it.`, 'OPENAI_MODEL_UNAVAILABLE', { costUsd: 0, status });
    if (status === 429) return runnerError('The OpenAI rate limit or quota for this key was reached. Wait a minute, or check the account’s billing.', 'OPENAI_RATE_LIMITED', { costUsd: 0, status });
    if (status >= 400 && status < 500) return runnerError(`OpenAI rejected this request: ${detail || status}`, 'OPENAI_BAD_REQUEST', { costUsd: 0, status, detail });
    return runnerError(`OpenAI had an error (${status}). Retry in a few minutes.`, 'OPENAI_ERROR', { costUsd: 0, status });
  }
  // List-price cost from usage: cached input at the cached rate when known (else the full input rate, the upper bound).
  function costOf(usage, price) {
    if (!isObject(usage)) return null;
    const input = Number(usage.input_tokens) || 0; const cached = Number(usage.input_tokens_details?.cached_tokens) || 0; const output = Number(usage.output_tokens) || 0;
    const cachedRate = Number.isFinite(price.cacheReadUsdPerMTok) ? price.cacheReadUsdPerMTok : price.inputUsdPerMTok;
    return Math.round(((input - cached) * price.inputUsdPerMTok + cached * cachedRate + output * price.outputUsdPerMTok)) / 1e6;
  }

  async function run({ schema, prompt, cachePrefix = '', model, effort = '', maxBudgetUsd = 1, timeoutMs, signal, onDelta, profile = {}, price = null } = {}) {
    if (typeof model !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,80}$/.test(model)) throw runnerError('Choose an OpenAI model ID.', 'AI_BAD_INPUT', { costUsd: 0 });
    if (!isObject(schema)) throw runnerError('A structured answer needs a JSON schema object.', 'AI_BAD_INPUT', { costUsd: 0 });
    if (typeof prompt !== 'string' || !prompt.trim()) throw runnerError('The AI input is empty.', 'AI_BAD_INPUT', { costUsd: 0 });
    const budget = Number(maxBudgetUsd);
    if (!Number.isFinite(budget) || budget < 0.01 || budget > 100) throw runnerError('The AI budget must be between $0.01 and $100.', 'AI_BAD_INPUT', { costUsd: 0 });
    const known = (value) => (value === null || value === undefined || value === '' ? NaN : Number(value));
    const rates = { inputUsdPerMTok: known(price?.inputUsdPerMTok ?? profile.inputUsdPerMTok), outputUsdPerMTok: known(price?.outputUsdPerMTok ?? profile.outputUsdPerMTok), cacheReadUsdPerMTok: known(price?.cacheReadUsdPerMTok ?? profile.cacheReadUsdPerMTok) };
    if (!Number.isFinite(rates.inputUsdPerMTok) || !Number.isFinite(rates.outputUsdPerMTok) || rates.outputUsdPerMTok <= 0) throw runnerError(`The studio doesn’t know ${model}’s price, so it can’t cap this request. Nothing was started.`, 'AI_PRICE_UNKNOWN', { costUsd: 0 });
    const credential = key(); const schemaText = JSON.stringify(schema);
    const { budgetTokens } = planBudget({ model, maxBudgetUsd: budget, inputCharacters: STUDIO_SYSTEM_PROMPT.length + cachePrefix.length + prompt.length + schemaText.length, price: { input: rates.inputUsdPerMTok, output: rates.outputUsdPerMTok } });
    const modelCap = Number.isFinite(profile.maxOutputTokens) && profile.maxOutputTokens > 0 ? profile.maxOutputTokens : 32000;
    const maxTokens = Math.min(modelCap, budgetTokens); const capSource = budgetTokens < modelCap ? 'budget' : 'model';
    const levels = Array.isArray(profile.efforts) ? profile.efforts : [];
    const chosenEffort = effort && levels.includes(effort) ? effort : '';
    const limitMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.min(timeoutMs, 2 ** 31 - 1) : DEFAULT_TIMEOUT_MS;
    const startedAt = clock();
    const body = (inPrompt) => ({
      model, instructions: STUDIO_SYSTEM_PROMPT, stream: true, store: false, max_output_tokens: maxTokens,
      // The stable prefix leads the input, so OpenAI's automatic prompt caching can reuse it between calls.
      input: `${cachePrefix}${prompt}${inPrompt ? answerFormat(schemaText) : ''}`,
      text: { format: inPrompt ? { type: 'json_object' } : { type: 'json_schema', name: 'studio_answer', strict: true, schema: toStrictSchema(schema) } },
      ...(chosenEffort ? { reasoning: { effort: chosenEffort } } : {}),
    });
    async function attempt(inPrompt) {
      const controller = new AbortController(); let timedOut = false; const cancel = () => controller.abort();
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, limitMs);
      if (signal?.aborted) controller.abort(); else signal?.addEventListener?.('abort', cancel, { once: true });
      let started = false; let text = ''; let final = null; let failure = null;
      try {
        let response;
        try { response = await fetchImpl(`${OPENAI_API}/responses`, { method: 'POST', headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' }, body: JSON.stringify(body(inPrompt)), redirect: 'error', signal: controller.signal }); }
        catch (_) { if (timedOut) throw runnerError(`OpenAI timed out after ${Math.round(limitMs / 1000)} seconds.`, 'TIMEOUT', { costUsd: 0 }); if (signal?.aborted) throw runnerError('Job cancelled.', 'CANCELLED', { costUsd: 0 }); throw runnerError('Could not reach OpenAI. Check the internet connection, then retry.', 'AI_NETWORK', { costUsd: 0 }); }
        if (!response.ok) { let parsed = null; try { parsed = JSON.parse(await response.text()); } catch (_) { parsed = null; } throw statusError(response.status, parsed, model); }
        started = true;
        await readSse(response, ({ data }) => {
          let event; try { event = JSON.parse(data); } catch (_) { return; }
          if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') { text += event.delta; if (typeof onDelta === 'function') { try { onDelta(event.delta); } catch (_) { /* courtesy */ } } }
          else if (event.type === 'response.refusal.delta' || event.type === 'response.refusal.done') failure = { refusal: true, message: event.refusal || event.delta || '' };
          else if (['response.completed', 'response.incomplete', 'response.failed'].includes(event.type)) final = event.response || null;
          else if (event.type === 'error') failure = { message: event.message || event.error?.message || 'error', code: event.code };
        }, { idleMs: 180000 });
      } catch (error) {
        if (error?.code && typeof error.code === 'string' && !(started && (timedOut || signal?.aborted))) throw error;
        const costUsd = started ? null : 0;
        if (timedOut) throw runnerError(`OpenAI timed out after ${Math.round(limitMs / 1000)} seconds.`, 'TIMEOUT', { costUsd });
        if (signal?.aborted) throw runnerError('Job cancelled.', 'CANCELLED', { costUsd });
        throw runnerError('OpenAI stopped streaming before the answer finished.', 'AI_NETWORK', { costUsd });
      } finally { clearTimeout(timer); signal?.removeEventListener?.('abort', cancel); }
      return { text, final, failure };
    }
    let inPrompt = false; let reply;
    try { reply = await attempt(false); }
    catch (error) {
      if (error.code !== 'OPENAI_BAD_REQUEST' || !(GRAMMAR_REFUSED.test(error.detail || '') || /schema|json_schema|text\.format/i.test(error.detail || ''))) throw error;
      inPrompt = true; reply = await attempt(true);
    }
    const usage = reply.final?.usage || null; const costUsd = costOf(usage, rates);
    const fields = { costUsd, requestId: reply.final?.id || null };
    if (reply.failure?.refusal) throw runnerError(`${model} declined this request.${reply.failure.message ? ` ${String(reply.failure.message).slice(0, 300)}` : ''} No answer was saved.`, 'AI_REFUSED', fields);
    if (reply.failure) throw runnerError(`OpenAI stopped with an error: ${reply.failure.message}`, 'OPENAI_ERROR', { ...fields, costUsd: costUsd ?? null });
    if (!reply.final) throw runnerError('OpenAI ended the stream without finishing. No unvalidated answer was saved.', 'AI_INVALID_RESULT', { ...fields, costUsd: costUsd ?? null });
    if (reply.final.model && !String(reply.final.model).startsWith(model)) throw runnerError(`OpenAI answered with ${reply.final.model} instead of ${model}. No answer was saved.`, 'AI_MODEL_MISMATCH', fields);
    if (reply.final.status === 'incomplete') {
      const reason = reply.final.incomplete_details?.reason;
      if (reason === 'max_output_tokens') throw capSource === 'budget' ? runnerError(`The model stopped at this step’s spending cap before finishing (the ${usd(budget)} allowance covers about ${maxTokens.toLocaleString('en-US')} output tokens on ${model}). ${RAISE_BUDGET}`, 'AI_BUDGET_EXCEEDED', fields) : runnerError(`${model} reached its ${maxTokens.toLocaleString('en-US')}-token output limit before finishing.`, 'AI_OUTPUT_TRUNCATED', fields);
      throw runnerError(`OpenAI stopped before finishing (${reason || 'incomplete'}).`, reason === 'content_filter' ? 'AI_REFUSED' : 'AI_INVALID_RESULT', fields);
    }
    if (reply.final.status === 'failed') throw runnerError(`OpenAI couldn’t finish: ${redact(reply.final.error?.message || 'unknown error')}`, 'OPENAI_ERROR', fields);
    // The strict schema's answer is JSON as sent; the schema-in-prompt retry's is read leniently (json-reply.js), and only
    // an object shaped like the answer counts (schemaAccept). An answer that can't be read keeps its text (redacted, 200 KB
    // at most) for the local diagnostic and Ask AI.
    let output; let parse = 'none';
    try { ({ value: output, repaired: parse } = parseJsonReply(reply.text, { lenient: inPrompt, accept: schemaAccept(schema) })); }
    catch (_) { throw runnerError('The model’s answer wasn’t valid JSON. No unvalidated answer was saved.', 'AI_INVALID_RESULT', { ...fields, rawText: clipText(redact(reply.text), RAW_TEXT_BYTES), rawTextLength: reply.text.length, schemaInPrompt: inPrompt, stopReason: String(reply.final.status || '') }); }
    if (!isObject(output)) throw runnerError('The model’s answer wasn’t a JSON object. No unvalidated answer was saved.', 'AI_INVALID_RESULT', fields);
    if (!inPrompt) output = stripNulls(output, toApiSchema(schema));
    return { output, receipt: { provider: 'openai', requestedModel: model, actualModel: reply.final.model || model, effort: chosenEffort, ...(effort && !chosenEffort ? { effortNote: `${model} doesn’t offer ${effort} reasoning here, so it ran at its default.` } : {}), costUsd, costBasis: 'OpenAI list prices from the studio’s table', usage, durationMs: Math.max(0, clock() - startedAt), requestId: reply.final.id || null, structuredOutput: inPrompt ? 'schema in prompt' : 'native', maxTokens, ...(parse !== 'none' ? { parse } : {}) } };
  }
  // Free: whether this key can see a model (GET /v1/models/{id}).
  async function checkModel(model) {
    const reply = await fetchJson(fetchImpl, `${OPENAI_API}/models/${encodeURIComponent(model)}`, { headers: { Authorization: `Bearer ${key()}`, Accept: 'application/json' }, timeoutMs: 15000 });
    if (!reply.ok) throw statusError(reply.status, reply.json, model);
    return { id: reply.json?.id || model, available: true };
  }
  return { run, checkModel };
}

module.exports = { createOpenAiTextRunner, OPENAI_API };
