const Anthropic = require('@anthropic-ai/sdk').default;
const { CLAUDE_EFFORT_LEVELS, CLAUDE_SYSTEM_PROMPT, DEFAULT_AI_MAX_BUDGET_USD, DEFAULT_CLAUDE_MODEL, MAX_CLAUDE_STDIN_BYTES, modelMatches } = require('./claude-runner');
const { estimateTokens, modelPrice } = require('./research-program');

// Direct Messages API route for machines without the Claude CLI. Same contract as the CLI path: run() resolves
// { output, receipt } and throws Errors with a stable `code` plus `costUsd` (a number when known, null when the
// call was billed but the amount is unknown, so callers keep their reservation).
const ANTHROPIC_PROVIDER = 'claude-api';
// Pinned so the saved key never follows an ANTHROPIC_BASE_URL inherited from a developer shell.
const ANTHROPIC_API_URL = 'https://api.anthropic.com';
const COST_BASIS = 'Anthropic API usage at list prices';
const MODEL_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,159}$/;
// The API takes far larger bodies, but one ceiling across routes keeps a stage from working on only one of them.
const MAX_PROMPT_BYTES = MAX_CLAUDE_STDIN_BYTES;
// Below this a structured answer (after adaptive thinking) cannot fit; paying for it only buys a truncated reply.
const MIN_OUTPUT_TOKENS = 1024;
// Same as the CLI route's process timeout, so a stage behaves alike on either route.
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
// Model lookups are free metadata GETs; a slow one must not hold a run or Settings → Check for minutes.
const LOOKUP_TIMEOUT_MS = 20 * 1000;

// Capabilities from Anthropic's model docs (Oct 2026), used only when the Models API cannot be read. Unknown IDs get a
// conservative profile (no effort or thinking parameters, a 32K output cap) so the fallback never sends one they reject.
const MODEL_PROFILES = [
  [/^claude-(fable|mythos)-5|^claude-opus-(5|4-[78])|^claude-sonnet-5/, { maxOutputTokens: 128000, efforts: CLAUDE_EFFORT_LEVELS, adaptiveThinking: true }],
  [/^claude-(opus|sonnet)-4-6/, { maxOutputTokens: 128000, efforts: ['low', 'medium', 'high', 'max'], adaptiveThinking: true }],
  [/^claude-haiku-4-5/, { maxOutputTokens: 64000, efforts: [], adaptiveThinking: false }],
];
function staticModelProfile(model) {
  const known = MODEL_PROFILES.find(([pattern]) => pattern.test(String(model)))?.[1];
  return { maxOutputTokens: 32000, efforts: [], adaptiveThinking: false, ...known, structuredOutputs: true, source: 'docs' };
}
// The Models API is the live source for output limits and feature support; fields it omits fall back to the table.
function profileFromModelInfo(info, model) {
  const fallback = staticModelProfile(model); const caps = isObject(info?.capabilities) ? info.capabilities : {};
  const { effort, thinking } = caps;
  return {
    maxOutputTokens: Number.isInteger(info?.max_tokens) && info.max_tokens > 0 ? info.max_tokens : fallback.maxOutputTokens,
    efforts: isObject(effort) ? (effort.supported ? CLAUDE_EFFORT_LEVELS.filter((level) => effort[level]?.supported === true) : []) : fallback.efforts,
    adaptiveThinking: isObject(thinking) ? thinking.supported === true && thinking.types?.adaptive?.supported === true : fallback.adaptiveThinking,
    structuredOutputs: typeof caps.structured_outputs?.supported === 'boolean' ? caps.structured_outputs.supported : true,
    source: 'models-api',
  };
}

// Nearest level the model supports; a tie goes to the lower level, which never costs more than the one requested.
function resolveEffort(requested, supported = CLAUDE_EFFORT_LEVELS, model = 'This model') {
  if (!requested || supported.includes(requested)) return { effort: requested || '', note: '' };
  if (!supported.length) return { effort: '', note: `${model} does not take an effort level, so it ran at its default.` };
  const rank = (level) => CLAUDE_EFFORT_LEVELS.indexOf(level); const target = rank(requested);
  const [nearest] = [...supported].sort((a, b) => Math.abs(rank(a) - target) - Math.abs(rank(b) - target) || rank(a) - rank(b));
  return { effort: nearest, note: `${model} does not support ${requested} effort, so it ran at ${nearest}.` };
}

// ── Structured-output schemas ────────────────────────────────────────────────────────────────────────────────────
// Structured outputs take a JSON Schema subset (types, enum/const, anyOf/allOf, $ref/$defs, ten string formats,
// minItems of 0 or 1, additionalProperties: false on every object). Other constraints move into the description as a
// hint, as the SDK's own transform does; the app re-validates every answer, so relaxing one here never admits a bad one.
const SCHEMA_TYPES = ['object', 'array', 'string', 'integer', 'number', 'boolean', 'null'];
const SCHEMA_FORMATS = new Set(['date-time', 'time', 'date', 'duration', 'email', 'hostname', 'uri', 'ipv4', 'ipv6', 'uuid']);
const SCHEMA_METADATA = new Set(['$schema', '$id', '$comment']);
// Keywords that only constrain one JSON type; a `type: [...]` union hands each to the matching anyOf branch.
const TYPE_KEYWORDS = {
  object: ['properties', 'required', 'additionalProperties', 'patternProperties', 'propertyNames', 'minProperties', 'maxProperties', 'dependentRequired', 'dependentSchemas', 'unevaluatedProperties'],
  array: ['items', 'prefixItems', 'contains', 'minContains', 'maxContains', 'minItems', 'maxItems', 'uniqueItems', 'unevaluatedItems'],
  string: ['format', 'pattern', 'minLength', 'maxLength', 'contentEncoding', 'contentMediaType'],
  number: ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf'],
};
TYPE_KEYWORDS.integer = TYPE_KEYWORDS.number;
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isPrimitive = (value) => value === null || ['string', 'number', 'boolean'].includes(typeof value);
const jsonType = (value) => value === null ? 'null' : Array.isArray(value) ? 'array' : Number.isInteger(value) ? 'integer' : typeof value;
const acceptsValue = (type, value) => jsonType(value) === type || (type === 'number' && jsonType(value) === 'integer');
const schemaError = (path, problem) => new Error(`The structured output schema ${path === '#' ? '' : `at ${path} `}${problem}.`);
const mapSchemas = (schemas, path) => Object.fromEntries(Object.entries(schemas).map(([name, child]) => [name, convertSchema(child, `${path}/${name}`)]));

function toApiSchema(schema) {
  if (!isObject(schema)) throw new Error('Claude structured output requires a JSON schema object.');
  return convertSchema(schema, '#');
}
function convertSchema(node, path) {
  if (!isObject(node)) throw schemaError(path, 'must be a schema object');
  const out = {}; const rest = {};
  for (const [key, value] of Object.entries(node)) {
    if (SCHEMA_METADATA.has(key)) continue;
    if ((key === '$defs' || key === 'definitions') && isObject(value)) out[key] = mapSchemas(value, `${path}/${key}`);
    else rest[key] = value;
  }
  if (typeof rest.$ref === 'string') return { ...out, $ref: rest.$ref }; // As in the SDK, a reference stands alone.
  const variants = rest.anyOf ?? rest.oneOf;
  if (Array.isArray(variants)) {
    // Sibling keywords fold into every branch so each is complete on its own; oneOf becomes anyOf.
    const { anyOf, oneOf, description, title, ...shared } = rest;
    return withNotes({ ...out, anyOf: variants.map((variant, index) => convertSchema(isObject(variant) ? { ...shared, ...variant } : variant, `${path}/anyOf/${index}`)) }, { description, title });
  }
  if (Array.isArray(rest.type)) {
    const types = [...new Set(rest.type)];
    if (types.length > 1) return typeUnion(rest, types, out, path);
    rest.type = types[0];
  }
  return convertNode(rest, out, path);
}
// type: ['string', 'null'] → anyOf: [{ type: 'string' }, { type: 'null' }]; each branch keeps its own keywords and enum values.
function typeUnion(rest, types, out, path) {
  const { type, description, title, enum: values, const: constant, ...shared } = rest;
  if (values !== undefined && !Array.isArray(values)) throw schemaError(path, 'has an enum that is not a list');
  const owned = new Set(['allOf', ...types.flatMap((t) => TYPE_KEYWORDS[t] || [])]);
  const branches = [];
  for (const branchType of types) {
    if (!SCHEMA_TYPES.includes(branchType)) throw schemaError(path, `has an unknown type "${branchType}"`);
    const branch = { type: branchType };
    for (const key of ['allOf', ...(TYPE_KEYWORDS[branchType] || [])]) if (key in shared) branch[key] = shared[key];
    if (values !== undefined) { branch.enum = values.filter((value) => acceptsValue(branchType, value)); if (!branch.enum.length) continue; }
    if (constant !== undefined) { if (!acceptsValue(branchType, constant)) continue; branch.const = constant; }
    branches.push(convertSchema(branch, `${path}/anyOf/${branches.length}`));
  }
  if (!branches.length) throw schemaError(path, 'allows no value: its enum or const matches none of its types');
  return withNotes({ ...out, anyOf: branches }, { description, title }, Object.fromEntries(Object.entries(shared).filter(([key]) => !owned.has(key))));
}
function convertNode(rest, out, path) {
  const result = { ...out }; const hints = {}; const { description, title } = rest;
  if (rest.type !== undefined && !SCHEMA_TYPES.includes(rest.type)) throw schemaError(path, `has an unknown type "${rest.type}"`);
  // A typeless node is read the way its keywords describe it; that only narrows what the model may return.
  const type = rest.type ?? (rest.properties !== undefined ? 'object' : rest.items !== undefined ? 'array' : undefined);
  if (type === undefined && rest.enum === undefined && rest.const === undefined && rest.allOf === undefined) throw schemaError(path, 'needs a type');
  if (type !== undefined) result.type = type;
  for (const [key, value] of Object.entries(rest)) {
    if (key === 'type' || key === 'description' || key === 'title' || (type === 'object' && key === 'additionalProperties')) continue;
    if (key === 'enum') { if (!Array.isArray(value)) throw schemaError(path, 'has an enum that is not a list'); if (value.every(isPrimitive)) result.enum = value; else hints.enum = value; }
    else if (key === 'const') { if (isPrimitive(value)) result.const = value; else hints.const = value; }
    else if (key === 'allOf' && Array.isArray(value)) result.allOf = value.map((entry, index) => convertSchema(entry, `${path}/allOf/${index}`));
    else if (type === 'object' && key === 'properties') { if (!isObject(value)) throw schemaError(path, 'has properties that are not an object'); result.properties = mapSchemas(value, `${path}/properties`); }
    else if (type === 'object' && key === 'required') { if (!Array.isArray(value)) throw schemaError(path, 'has a required list that is not a list'); result.required = value; }
    else if (type === 'array' && key === 'items') { if (!isObject(value)) throw schemaError(path, 'uses tuple-style items, which structured outputs do not support'); result.items = convertSchema(value, `${path}/items`); }
    else if (type === 'array' && key === 'minItems' && (value === 0 || value === 1)) result.minItems = value;
    else if (type === 'string' && key === 'format' && SCHEMA_FORMATS.has(value)) result.format = value;
    else hints[key] = value;
  }
  if (type === 'object') { result.properties ||= {}; result.additionalProperties = false; }
  return withNotes(result, { description, title }, hints);
}
// Unsupported constraints travel as description text (the SDK's convention) so the model still sees them.
function withNotes(schema, { description, title }, hints = {}) {
  if (typeof title === 'string') schema.title = title;
  const note = Object.keys(hints).length ? `{${Object.entries(hints).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join(', ')}}` : '';
  const text = [typeof description === 'string' ? description : '', note].filter(Boolean).join('\n\n');
  if (text) schema.description = text;
  return schema;
}

// ── Requests, spend and receipts ─────────────────────────────────────────────────────────────────────────────────
// `schema` is API-ready (toApiSchema). Effort and the JSON format share output_config; adaptive thinking is compatible
// with structured outputs and is the only thinking mode the current models accept.
function buildMessageParams({ model, prompt, schema, maxTokens, effort = '', adaptiveThinking = true }) {
  return {
    model, max_tokens: maxTokens, system: CLAUDE_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
    ...(adaptiveThinking ? { thinking: { type: 'adaptive' } } : {}),
    output_config: { ...(effort ? { effort } : {}), format: { type: 'json_schema', schema } },
  };
}

const usd = (value) => `$${value >= 0.1 ? value.toFixed(2) : Number(value.toPrecision(2))}`;
const RAISE_BUDGET = "Raise the run's AI budget and retry; finished steps are kept.";
// Spend guard: refuse before any request when the estimated input alone, or the input plus a minimal answer, would
// exceed the cap. Otherwise return how many output tokens (thinking included) the rest of the cap can buy.
function planBudget({ model, maxBudgetUsd, inputCharacters }) {
  const price = modelPrice(model); const inputTokens = estimateTokens(inputCharacters); const inputCostUsd = inputTokens * price.input / 1e6;
  if (inputCostUsd > maxBudgetUsd) throw runnerError(`This step's ${usd(maxBudgetUsd)} AI budget cannot cover the request: the input alone is estimated at ${usd(inputCostUsd)} on ${model}. ${RAISE_BUDGET}`, 'CLAUDE_BUDGET_EXCEEDED', { costUsd: 0 });
  // The epsilon absorbs float noise such as 49789.999… for an exact 49790.
  const budgetTokens = Math.floor((maxBudgetUsd * 1e6 - inputTokens * price.input) / price.output + 1e-9);
  if (budgetTokens < MIN_OUTPUT_TOKENS) throw runnerError(`This step's ${usd(maxBudgetUsd)} AI budget leaves room for only ${budgetTokens} output tokens on ${model} after the estimated input (${usd(inputCostUsd)}); a structured answer needs at least ${MIN_OUTPUT_TOKENS}. ${RAISE_BUDGET}`, 'CLAUDE_BUDGET_EXCEEDED', { costUsd: 0 });
  return { inputTokens, inputCostUsd, budgetTokens };
}

// Cache reads bill at 0.1× input, but 0.05× on Opus 5.5 and 0.025× on Fable 5.1 / Mythos 5.1 (prompt-caching docs).
const cacheReadRate = (model) => /^claude-(fable|mythos)-5-1(-|$)/.test(model) ? 0.025 : /^claude-opus-5-5(-|$)/.test(model) ? 0.05 : 0.1;
// List-price USD for a reply's usage. output_tokens already includes thinking. This route never asks for caching, so
// cache counts are normally zero; writes (1.25× for 5 minutes, 2× for 1 hour) and reads are priced in case any appear.
function usageCost(model, usage) {
  if (!isObject(usage)) return null;
  const count = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
  const price = modelPrice(model); const split = isObject(usage.cache_creation) ? usage.cache_creation : {};
  const fiveMinute = count(split.ephemeral_5m_input_tokens); const oneHour = count(split.ephemeral_1h_input_tokens);
  const writes = fiveMinute + oneHour ? fiveMinute * 1.25 + oneHour * 2 : count(usage.cache_creation_input_tokens) * 1.25;
  const inputUnits = count(usage.input_tokens) + writes + count(usage.cache_read_input_tokens) * cacheReadRate(model);
  return Math.round(inputUnits * price.input + count(usage.output_tokens) * price.output) / 1e6;
}

const redactKey = (text) => String(text).replace(/sk-ant-[A-Za-z0-9_-]+/g, 'sk-ant-…');
function runnerError(message, code, fields = {}) {
  const error = new Error(redactKey(message)); error.code = code;
  for (const [key, value] of Object.entries(fields)) if (value !== undefined) error[key] = value;
  return error;
}
function apiDetail(error) {
  const text = typeof error?.error?.error?.message === 'string' ? error.error.error.message : typeof error?.message === 'string' ? error.message : String(error || 'Unknown error');
  return redactKey(text).replace(/\s+/g, ' ').trim().slice(0, 300) || 'no details';
}
// SDK error → readable message and stable code. Classified by the SDK's typed classes, HTTP status and API error type
// (the docs advise against matching message text); status-less errors are mid-stream SSE errors.
function describeApiError(error, { model = 'this model', costUsd = 0 } = {}) {
  const status = Number.isInteger(error?.status) ? error.status : null;
  const type = typeof error?.type === 'string' && error.type ? error.type : typeof error?.error?.error?.type === 'string' ? error.error.error.type : '';
  const fields = { costUsd, ...(status ? { status } : {}), ...(error?.requestID ? { requestId: error.requestID } : {}) };
  const detail = apiDetail(error);
  if (error instanceof Anthropic.APIUserAbortError) return runnerError('Job cancelled.', 'CANCELLED', fields);
  if (error instanceof Anthropic.APIConnectionTimeoutError) return runnerError('The Anthropic API did not respond in time. Check the internet connection, then retry.', 'TIMEOUT', fields);
  if (status === 401 || type === 'authentication_error') return runnerError('The Anthropic API key was rejected. Check the key in Settings → Writing & research, or create a new one in the Anthropic Console.', 'ANTHROPIC_AUTH', fields);
  if (status === 403 || type === 'permission_error') return runnerError(`The Anthropic API key was rejected for this request (${detail}). Check the key's organization and workspace access in the Anthropic Console.`, 'ANTHROPIC_AUTH', fields);
  if (status === 404 || type === 'not_found_error') return runnerError(`This API key cannot use ${model}. Choose another model, or use a key from an organization with access to it.`, 'ANTHROPIC_MODEL_UNAVAILABLE', fields);
  if (status === 429 || type === 'rate_limit_error') {
    const wait = Number(error?.headers?.get?.('retry-after'));
    return runnerError(`The Anthropic API rate limit for this key was reached, even after automatic retries. ${wait > 0 ? `Wait about ${Math.ceil(wait)} seconds` : 'Wait a minute'}, then retry, or run fewer AI steps at once.`, 'ANTHROPIC_RATE_LIMITED', fields);
  }
  if (status === 529 || type === 'overloaded_error') return runnerError('The Anthropic API is temporarily overloaded, even after automatic retries. Retry in a few minutes, or choose another model.', 'ANTHROPIC_OVERLOADED', fields);
  if (status === 402 || type === 'billing_error') return runnerError(`The Anthropic account behind this API key has a billing problem (${detail}). Check Plans & Billing in the Anthropic Console.`, 'ANTHROPIC_BILLING', fields);
  if ((status >= 400 && status < 500) || type === 'invalid_request_error' || type === 'request_too_large') return runnerError(`The Anthropic API rejected this request: ${detail}`, 'ANTHROPIC_BAD_REQUEST', fields);
  if (status >= 500 || type === 'api_error') return runnerError(`The Anthropic API had an internal error${status ? ` (${status})` : ''}, even after automatic retries. Retry in a few minutes.`, 'ANTHROPIC_SERVER_ERROR', fields);
  if (error instanceof Anthropic.APIConnectionError) return runnerError('Could not reach the Anthropic API. Check the internet connection, then retry.', 'ANTHROPIC_CONNECTION', fields);
  return runnerError(`The Anthropic API request failed: ${detail}`, 'ANTHROPIC_ERROR', fields);
}
// Failures worth riding out with the docs' table instead of the live model profile.
const transientError = (error) => error instanceof Anthropic.APIConnectionError || [408, 409, 429].includes(error?.status) || error?.status >= 500;

function validateRequest({ schema, prompt, model, effort, maxBudgetUsd }) {
  if (typeof model !== 'string' || !MODEL_ID.test(model)) throw new Error('Choose a valid Claude model ID.');
  if (!isObject(schema)) throw new Error('Claude structured output requires a JSON schema object.');
  const budget = Number(maxBudgetUsd);
  if (typeof maxBudgetUsd === 'boolean' || !Number.isFinite(budget) || budget < 0.01 || budget > 100) throw new Error('Claude run budget must be between $0.01 and $100.');
  if (typeof prompt !== 'string') throw new Error('Claude input must be text.');
  if (!prompt.trim()) throw new Error('Claude input is empty.');
  if (effort !== undefined && effort !== '' && !CLAUDE_EFFORT_LEVELS.includes(effort)) throw new Error(`Choose a Claude effort level: ${CLAUDE_EFFORT_LEVELS.join(', ')}.`);
  if (Buffer.byteLength(prompt, 'utf8') > MAX_PROMPT_BYTES) throw new Error('This research context is too large for Claude. Use a smaller dataset or fewer sources.');
  let schemaText; try { schemaText = JSON.stringify(schema); } catch (_) { throw new Error('Claude structured output requires a JSON schema object.'); }
  return { budget, schemaText };
}

// Stop reason → answer or coded error. Every error here was billed, so it carries the measured cost.
function settle(message, { model, budget, maxTokens, capSource, effort, requestedEffort, requestId, durationMs }) {
  const actualModel = typeof message?.model === 'string' ? message.model : '';
  const verified = modelMatches(model, [actualModel]);
  const usage = isObject(message?.usage) ? message.usage : null;
  const costUsd = usageCost(verified ? model : actualModel || model, usage);
  const stopReason = typeof message?.stop_reason === 'string' ? message.stop_reason : '';
  const fields = { costUsd, requestId, stopReason };
  if (!verified) throw runnerError(`Claude returned an unverified or different model (${actualModel || 'not reported'}). No fallback answer was saved.`, 'CLAUDE_MODEL_MISMATCH', fields);
  if (stopReason === 'refusal') {
    const { category, explanation } = isObject(message.stop_details) ? message.stop_details : {};
    throw runnerError(`Claude declined this request${category ? ` (${category})` : ''}.${explanation ? ` ${String(explanation).slice(0, 300)}` : ''} No answer was saved.`, 'CLAUDE_REFUSED', fields);
  }
  if (stopReason === 'max_tokens' && capSource === 'budget') throw runnerError(`Claude stopped at this step's spending cap before finishing (the ${usd(budget)} allowance covers about ${maxTokens.toLocaleString('en-US')} output tokens on ${model}). ${RAISE_BUDGET}`, 'CLAUDE_BUDGET_EXCEEDED', fields);
  if (stopReason === 'max_tokens') throw runnerError(`Claude reached ${model}'s ${maxTokens.toLocaleString('en-US')}-token output limit before finishing. Use fewer sources or a lower effort level.`, 'CLAUDE_OUTPUT_TRUNCATED', fields);
  if (stopReason === 'model_context_window_exceeded') throw runnerError(`The research context and Claude's answer did not fit in ${model}'s context window. Use a smaller dataset or fewer sources.`, 'CLAUDE_CONTEXT_EXCEEDED', fields);
  if (stopReason !== 'end_turn') throw runnerError(`Claude stopped before finishing (${stopReason || 'no stop reason'}). No unvalidated answer was saved.`, 'CLAUDE_INVALID_RESULT', fields);
  // With output_config.format the answer is the JSON text block that follows any thinking blocks.
  const text = Array.isArray(message.content) ? message.content.find((block) => block?.type === 'text')?.text : undefined;
  const missing = () => runnerError('Claude did not return the required structured output. No unvalidated answer was saved.', 'CLAUDE_MISSING_STRUCTURED_OUTPUT', fields);
  if (typeof text !== 'string' || !text.trim()) throw missing();
  let output;
  try { output = JSON.parse(text); } catch (_) { throw runnerError('Claude returned structured output that is not valid JSON. No unvalidated answer was saved.', 'CLAUDE_INVALID_RESULT', fields); }
  if (!isObject(output)) throw missing();
  return {
    output,
    receipt: {
      provider: ANTHROPIC_PROVIDER, requestedModel: model, actualModel, actualModels: [actualModel],
      effort: effort.effort, ...(effort.note ? { requestedEffort, effortNote: effort.note } : {}),
      costUsd, usage, durationMs, stopReason, requestId, maxTokens, costBasis: COST_BASIS,
    },
  };
}

function createAnthropicRunner({ apiKey, Client = Anthropic, clock = Date.now, maxRetries } = {}) {
  if (typeof apiKey !== 'string' || !apiKey.trim()) throw runnerError('Add an Anthropic API key in Settings → Writing & research.', 'ANTHROPIC_AUTH');
  // authToken: null stops an inherited ANTHROPIC_AUTH_TOKEN from being sent beside the key (the API rejects both).
  // Retries (429, 5xx, 529, connection errors) are the SDK's own, with backoff and retry-after.
  const client = new Client({ apiKey: apiKey.trim(), authToken: null, baseURL: ANTHROPIC_API_URL, ...(maxRetries != null ? { maxRetries } : {}) });
  const profiles = new Map(); // model → capability profile, per key (access differs between organizations)

  async function modelProfile(model, signal) {
    if (profiles.has(model)) return profiles.get(model);
    try {
      const profile = profileFromModelInfo(await client.models.retrieve(model, {}, { signal, timeout: LOOKUP_TIMEOUT_MS }), model);
      profiles.set(model, profile); return profile;
    } catch (error) {
      // A passing failure must not block the run; definitive ones (bad key, unknown model) stop it before any spend.
      if (!signal?.aborted && transientError(error)) return staticModelProfile(model);
      throw error;
    }
  }

  async function run({ schema, prompt, model = DEFAULT_CLAUDE_MODEL, effort, maxBudgetUsd = DEFAULT_AI_MAX_BUDGET_USD, timeoutMs, signal } = {}) {
    const { budget, schemaText } = validateRequest({ schema, prompt, model, effort, maxBudgetUsd });
    const apiSchema = toApiSchema(schema);
    const { budgetTokens } = planBudget({ model, maxBudgetUsd: budget, inputCharacters: CLAUDE_SYSTEM_PROMPT.length + prompt.length + schemaText.length });
    if (signal?.aborted) throw runnerError('Job cancelled.', 'CANCELLED', { costUsd: 0 });
    // setTimeout fires at once past 2^31-1 ms, so clamp rather than time out immediately.
    const limitMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.min(timeoutMs, 2 ** 31 - 1) : DEFAULT_TIMEOUT_MS;
    const controller = new AbortController(); const cancel = () => controller.abort();
    let timedOut = false; let stream = null;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, limitMs);
    signal?.addEventListener('abort', cancel, { once: true });
    const startedAt = clock();
    // Billing starts once the model begins its answer (message_start); an interrupted call after that has an unknown cost.
    const failure = (error) => {
      const costUsd = stream?.currentMessage ? null : 0;
      if (timedOut) return runnerError(`Claude timed out after ${Math.round(limitMs / 1000)} seconds.`, 'TIMEOUT', { costUsd });
      if (signal?.aborted) return runnerError('Job cancelled.', 'CANCELLED', { costUsd });
      return describeApiError(error, { model, costUsd });
    };
    try {
      let profile;
      try { profile = await modelProfile(model, controller.signal); } catch (error) { throw failure(error); }
      if (!profile.structuredOutputs) throw runnerError(`${model} can't return structured output through the Anthropic API. Choose another model.`, 'ANTHROPIC_MODEL_UNAVAILABLE', { costUsd: 0 });
      const chosen = resolveEffort(effort, profile.efforts, model);
      const maxTokens = Math.min(profile.maxOutputTokens, budgetTokens);
      const params = buildMessageParams({ model, prompt, schema: apiSchema, maxTokens, effort: chosen.effort, adaptiveThinking: profile.adaptiveThinking });
      let message;
      // Streamed so long thinking-plus-answer calls never hit HTTP idle timeouts; finalMessage() gathers the reply.
      try { stream = client.messages.stream(params, { signal: controller.signal }); message = await stream.finalMessage(); } catch (error) { throw failure(error); }
      return settle(message, { model, budget, maxTokens, capSource: budgetTokens < profile.maxOutputTokens ? 'budget' : 'model', effort: chosen, requestedEffort: effort, requestId: stream.request_id ?? null, durationMs: Math.max(0, clock() - startedAt) });
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
  }

  // Which models this key can use, from the free Models API (no paid request). A rejected key fails every model.
  async function checkModels({ models = [] } = {}) {
    const ids = [...new Set((Array.isArray(models) ? models : []).filter((id) => typeof id === 'string' && id))];
    const rows = await Promise.all(ids.map(async (id) => {
      if (!MODEL_ID.test(id)) return { id, available: false, error: 'Not a valid Claude model ID.' };
      try {
        const profile = profileFromModelInfo(await client.models.retrieve(id, {}, { timeout: LOOKUP_TIMEOUT_MS }), id); profiles.set(id, profile);
        return profile.structuredOutputs ? { id, available: true, error: '' } : { id, available: false, error: "This model can't return structured output through the API." };
      } catch (error) {
        const mapped = describeApiError(error, { model: id });
        return { id, available: false, error: mapped.code === 'ANTHROPIC_MODEL_UNAVAILABLE' ? "The model ID is unknown, or this key's organization has no access to it." : mapped.message, code: mapped.code };
      }
    }));
    const rejected = rows.find((row) => row.code === 'ANTHROPIC_AUTH');
    const results = rejected ? ids.map((id) => ({ id, available: false, error: rejected.error })) : rows.map(({ code, ...row }) => row);
    return { ok: results.every((row) => row.available), models: results };
  }

  return { run, checkModels };
}

module.exports = { ANTHROPIC_PROVIDER, ANTHROPIC_API_URL, MIN_OUTPUT_TOKENS, DEFAULT_TIMEOUT_MS, createAnthropicRunner, toApiSchema, buildMessageParams, planBudget, resolveEffort, staticModelProfile, profileFromModelInfo, usageCost, describeApiError };
