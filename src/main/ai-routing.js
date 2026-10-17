'use strict';
// Which connection, model and effort (or picture quality, or video options) each AI task uses. The registry is
// src/shared/ai-tasks.json; admins choose studio-wide in Settings → Model routing (data.json settings.aiRouting); a research
// program may choose its own stages (program.ai.overrides); a started run keeps what it resolved (run.ai.routing).
//
// resolve(taskId, { program, run }) walks: the run's snapshot → (for runs made before routing) the run's own models →
// the task and then each task it inherits from, filling only missing fields from the program's choice for that node's
// stage, the studio's choice for that node, and the node's default → the studio defaults for the task's kind. There is no
// silent cross-provider fallback: 'auto' (Claude Code, else the Anthropic key) is resolved per call by the text router.
// Electron-free and synchronous; prices and capabilities come from the injected catalog.
const TASKS = require('../shared/ai-tasks.json');
const PROVIDERS = require('../shared/ai-providers.json');
const MODELS = require('../shared/ai-models.json');

const FIELDS = ['route', 'model', 'effort', 'quality', 'durationSeconds', 'resolution', 'aspectRatio', 'sound'];
const EFFORTS = PROVIDERS.efforts;
const STAGES = ['discovery', 'synthesis', 'matching', 'tagging', 'reports'];
const LEGACY_DEFAULT_AI = Object.freeze({ models: { discovery: 'claude-opus-5-5', synthesis: 'claude-opus-5-5', matching: 'claude-opus-5-5', tagging: 'claude-fable-5-1', reports: 'claude-fable-5-1' }, effort: { discovery: 'medium', synthesis: 'high', matching: 'medium', tagging: 'low', reports: 'high' } });
const CONNECTIONS = Object.fromEntries([...PROVIDERS.connections, ...PROVIDERS.pseudo].map((entry) => [entry.id, entry]));
const ROUTES = { text: ['auto', 'claude', 'claude-api', 'codex', 'openai', 'openrouter'], image: ['openai', 'fal'], video: ['fal'] };
const QUALITIES = ['low', 'medium', 'high'];
const PRESET_IDS = ['balanced', 'lowest-cost', 'highest-quality'];
const PRIVACY = PROVIDERS.privacy.map((entry) => entry.id);
const copy = (value) => (value == null ? value : JSON.parse(JSON.stringify(value)));
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const familyOf = (route) => CONNECTIONS[route]?.family || '';
const routeLabel = (route) => CONNECTIONS[route]?.label || route || '';
function fail(field, message, extra = {}) { return Object.assign(new Error(message), { field, status: 400, ...extra }); }

// Which family an id looks like: claude-*, provider/model (OpenRouter), a fal endpoint, or a plain id (OpenAI, Codex).
function modelFits(route, model, kind) {
  const family = familyOf(route); if (!family) return false;
  if (kind === 'image') return route === 'openai' ? /^gpt-image-/.test(model) : route === 'fal' ? new RegExp(PROVIDERS.modelPatterns.fal).test(model) : false;
  if (kind === 'video') return route === 'fal' && new RegExp(PROVIDERS.modelPatterns.fal).test(model);
  if (family === 'claude') return new RegExp(PROVIDERS.modelPatterns.claude).test(model);
  if (family === 'codex') return new RegExp(PROVIDERS.modelPatterns.codex).test(model) && !/^claude-/.test(model);
  if (family === 'openai') return new RegExp(PROVIDERS.modelPatterns.openai).test(model) && !/^claude-/.test(model) && !/^gpt-image-/.test(model);
  if (family === 'openrouter') return new RegExp(PROVIDERS.modelPatterns.openrouter).test(model);
  return false;
}

function createAiRouting({ tasks = TASKS, getSettings = () => ({}), catalog = null, programs = () => [], isReady = () => null, now = () => new Date() } = {}) {
  const byId = new Map(tasks.tasks.map((task) => [task.id, task]));
  const labelOf = (route, model, kind) => (catalog?.modelLabel ? catalog.modelLabel(route, model, kind) : (MODELS.text.find((row) => row.id === model)?.label || model || (route === 'codex' ? 'Codex default' : '')));
  const profileOf = (route, model, kind) => (catalog?.profile ? catalog.profile(route, model, kind) : null);
  const priceOf = (route, model, kind, options) => (catalog?.priceFor ? catalog.priceFor(route, model, kind, options) : { basis: familyOf(route) === 'codex' ? 'none' : 'tokens', known: false, source: 'none' });

  // ---------- Studio routing (settings.aiRouting), normalized; older data derives it from aiProvider / aiModel ----------
  function newestProgram(list) {
    return [...(list || [])].sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')))[0] || null;
  }
  // Behavior-identical first routing for a studio saved before Model routing existed.
  function migrate(settings = {}, programList = []) {
    const provider = ROUTES.text.includes(settings.aiProvider) ? settings.aiProvider : 'auto';
    const routing = { version: 1, updatedAt: '', updatedBy: null, preset: 'balanced', defaults: copy(tasks.defaults), tasks: {}, openrouter: { privacy: 'no-training' }, maxBudgetUsd: Number.isFinite(settings.aiMaxBudgetUsd) ? settings.aiMaxBudgetUsd : 1 };
    routing.defaults.text = { route: provider, model: provider === 'codex' ? '' : (typeof settings.aiModel === 'string' && settings.aiModel ? settings.aiModel : tasks.defaults.text.model) };
    // Kits used to follow the newest program's report model; that becomes the studio's choice for every channel asset.
    const newest = newestProgram(programList);
    const reportModel = newest?.ai?.overrides?.reports?.model || newest?.ai?.models?.reports; const reportEffort = newest?.ai?.overrides?.reports?.effort || newest?.ai?.effort?.reports;
    if (newest && ((reportModel && reportModel !== LEGACY_DEFAULT_AI.models.reports) || (reportEffort && reportEffort !== LEGACY_DEFAULT_AI.effort.reports))) {
      routing.tasks['assets.default'] = { ...(reportModel ? { model: reportModel } : {}), ...(reportEffort ? { effort: reportEffort } : {}) };
      routing.preset = 'custom';
    }
    return routing;
  }
  function normalize(input = {}, { strict = false } = {}) {
    const raw = isObject(input) ? input : {};
    const defaults = copy(tasks.defaults);
    for (const kind of ['text', 'image', 'video']) {
      const given = isObject(raw.defaults?.[kind]) ? raw.defaults[kind] : {};
      if (given.route !== undefined) { if (!ROUTES[kind].includes(given.route)) { if (strict) throw fail(`defaults.${kind}.route`, 'Choose a connection that can do this kind of work.'); } else defaults[kind].route = given.route; }
      if (typeof given.model === 'string') defaults[kind].model = given.model.trim();
      if (kind === 'image' && given.quality !== undefined) { if (QUALITIES.includes(given.quality)) defaults.image.quality = given.quality; else if (strict) throw fail('defaults.image.quality', 'Choose low, medium or high picture quality.'); }
    }
    const out = {
      version: 1, updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '', updatedBy: isObject(raw.updatedBy) ? { id: String(raw.updatedBy.id || ''), name: String(raw.updatedBy.name || '') } : null,
      preset: [...PRESET_IDS, 'custom'].includes(raw.preset) ? raw.preset : 'custom',
      defaults, tasks: {},
      openrouter: { privacy: PRIVACY.includes(raw.openrouter?.privacy) ? raw.openrouter.privacy : 'no-training' },
      maxBudgetUsd: Number.isFinite(raw.maxBudgetUsd) && raw.maxBudgetUsd >= 0.01 && raw.maxBudgetUsd <= 100 ? raw.maxBudgetUsd : 1,
    };
    if (strict && raw.maxBudgetUsd !== undefined && !(Number.isFinite(raw.maxBudgetUsd) && raw.maxBudgetUsd >= 0.01 && raw.maxBudgetUsd <= 100)) throw fail('maxBudgetUsd', 'The cap for single requests must be between $0.01 and $100.');
    for (const [taskId, choice] of Object.entries(isObject(raw.tasks) ? raw.tasks : {})) {
      if (!byId.has(taskId)) { if (strict) throw fail(`tasks.${taskId}`, 'That AI job isn’t in this studio.'); continue; }
      if (!isObject(choice)) continue;
      const clean = {};
      for (const field of FIELDS) if (choice[field] !== undefined && choice[field] !== null && choice[field] !== '@inherit') clean[field] = typeof choice[field] === 'string' ? choice[field].trim() : choice[field];
      if (Object.keys(clean).length) out.tasks[taskId] = clean;
    }
    return out;
  }
  function current(settings = getSettings()) {
    return settings?.aiRouting ? normalize(settings.aiRouting) : migrate(settings || {}, programs());
  }

  // ---------- Program overrides ----------
  // A program's own choices: ai.overrides when it has them; for a program saved before them, the stages whose model or
  // effort differ from the shipped defaults (programs always stored filled-in defaults, so equal values aren't choices).
  function programOverrides(program) {
    const ai = program?.ai; if (!isObject(ai)) return {};
    if (isObject(ai.overrides)) return copy(ai.overrides);
    const out = {};
    for (const stage of STAGES) {
      const model = ai.models?.[stage]; const effort = ai.effort?.[stage];
      const entry = { ...(model && model !== LEGACY_DEFAULT_AI.models[stage] ? { model } : {}), ...(effort && effort !== LEGACY_DEFAULT_AI.effort[stage] ? { effort } : {}) };
      if (Object.keys(entry).length) out[stage] = entry;
    }
    return out;
  }

  // ---------- Resolution ----------
  // A run made before Model routing: text on the route it started with ('auto' or Codex) and its own models; pictures on
  // OpenAI's GPT Image at medium, the only picture route then, so a retry still matches its saved pictures.
  function legacyRunTask(run, taskId) {
    const task = byId.get(taskId) || { id: taskId, kind: 'text' };
    if (task.kind === 'image') return finish(task, { route: 'openai', model: tasks.defaults.image.model, quality: 'medium' }, { source: 'legacy' });
    if (task.kind === 'video') return resolve(taskId);
    const stage = task.programStage; const ai = run?.ai || {};
    const stageModel = stage && isObject(ai.models) ? ai.models[stage] : ''; const stageEffort = stage && isObject(ai.effort) ? ai.effort[stage] : '';
    const settingsNow = current(); const studioText = settingsNow.defaults.text.route;
    // The run's route was the studio's Claude route when it started (or Codex, which it recorded).
    const route = ai.route === 'codex' ? 'codex' : familyOf(studioText) === 'claude' ? studioText : 'auto';
    const model = route === 'codex' ? '' : stageModel || (typeof ai.model === 'string' ? ai.model : '') || (task.default?.model && !String(task.default.model).startsWith('@') ? task.default.model : settingsNow.defaults.text.model);
    // Picture and video briefs always ran at their own fixed effort, not the kit's.
    const fixed = ['pictures.kit-brief', 'video.brief'].includes(task.id) ? task.default.effort : '';
    const effort = route === 'codex' ? '' : stageEffort || fixed || (typeof ai.effort === 'string' ? ai.effort : '') || '';
    return finish(task, { route, model, effort, effortSource: 'explicit' }, { source: 'legacy' });
  }
  function clampEffort(route, model, kind, effort) {
    if (!effort || kind !== 'text') return { effort: effort || '', note: '' };
    const found = profileOf(route, model, kind);
    const levels = Array.isArray(found?.efforts) ? found.efforts : null;
    if (!levels) return { effort, note: '' };
    if (!levels.length) return { effort: '', note: `${found.label || model} doesn’t take an effort level, so it runs at its default.` };
    if (levels.includes(effort)) return { effort, note: '' };
    const rank = (level) => { const index = EFFORTS.indexOf(level); return index < 0 ? EFFORTS.length : index; };
    const [nearest] = [...levels].sort((a, b) => Math.abs(rank(a) - rank(effort)) - Math.abs(rank(b) - rank(effort)) || rank(a) - rank(b));
    return { effort: nearest, note: `${found.label || model} doesn’t offer ${effort} effort, so it runs at ${nearest}.` };
  }
  function cheapestStrongReader(route) {
    if (familyOf(route) !== 'claude') return null;
    const cost = (row) => (50000 * row.inputUsdPerMTok + 10000 * 1.3 * row.outputUsdPerMTok) / 1e6;
    return [...MODELS.text.filter((row) => row.family === 'claude' && row.strongReader)].sort((a, b) => cost(a) - cost(b))[0]?.id || null;
  }
  function finish(task, fields, { source, problem = '', note = '' } = {}) {
    const kind = task.kind || 'text';
    const route = fields.route; const model = fields.model ?? '';
    const connection = CONNECTIONS[route];
    const price = priceOf(route, model, kind, { quality: fields.quality });
    const resolved = {
      taskId: task.id, label: task.label, kind, route, model, routeLabel: routeLabel(route), modelLabel: labelOf(route, model, kind),
      ...(kind === 'text' ? { effort: fields.effort || '', effortSource: fields.effortSource || 'default' } : {}),
      ...(kind === 'image' ? { quality: fields.quality || '' } : {}),
      ...(kind === 'video' ? { video: { durationSeconds: fields.durationSeconds, resolution: fields.resolution, aspectRatio: fields.aspectRatio, sound: Boolean(fields.sound), input: profileOf(route, model, 'video')?.input || 'text' } } : {}),
      metered: connection ? (connection.metering || (connection.resolvesTo ? 'cli-reported' : 'none')) !== 'none' : true,
      price, source,
      ...(problem ? { problem } : {}), ...(note ? { note } : {}),
    };
    return resolved;
  }

  // resolve(taskId, { program, run, lite, routing }) → ResolvedTask (see the file header).
  function resolve(taskId, { program = null, run = null, lite = false, routing = null } = {}) {
    const task = byId.get(taskId);
    if (!task) throw fail('taskId', `Unknown AI job: ${taskId}.`);
    if (run) {
      const snapshot = run.ai?.routing?.[taskId];
      if (snapshot) return copy(snapshot);
      if (run.ai && !run.ai.routing) return legacyRunTask(run, taskId);
    }
    const studio = routing ? normalize(routing) : current();
    const overrides = program ? programOverrides(program) : {};
    const fields = {}; const sources = {}; const seen = new Set(); let programRoute = '';
    let node = task;
    while (node) {
      if (seen.has(node.id)) throw fail(`tasks.${task.id}`, 'This AI job inherits from itself.');
      seen.add(node.id);
      const tag = node.id === task.id ? null : `inherited:${node.id}`;
      const layers = [];
      if (program && node.programStage && overrides[node.programStage]) layers.push([overrides[node.programStage], 'program']);
      if (studio.tasks[node.id]) layers.push([studio.tasks[node.id], tag || 'studio']);
      layers.push([node.default || {}, tag || 'default']);
      for (const [values, label] of layers) for (const field of FIELDS) {
        if (fields[field] !== undefined) continue;
        const value = values[field];
        if (value === undefined || value === null || value === '@inherit') continue;
        fields[field] = value; sources[field] = label;
        if (label === 'program' && field === 'route') programRoute = value;
      }
      node = node.inherit ? byId.get(node.inherit) : null;
    }
    const kind = task.kind || 'text'; const base = studio.defaults[kind] || {};
    for (const field of ['route', 'model', 'quality']) if (fields[field] === undefined && base[field] !== undefined) { fields[field] = base[field]; sources[field] = 'default'; }
    if (fields.route === '@text') fields.route = studio.defaults.text.route;
    if (fields.model === '@textModel') fields.model = studio.defaults.text.model;
    if (fields.model === undefined) fields.model = '';
    // Compatibility: a default model that doesn't fit the route is mapped; an explicit one is kept and reported.
    let problem = '';
    const studioClaudeRoute = familyOf(studio.defaults.text.route) === 'claude' ? studio.defaults.text.route : 'auto';
    if (!modelFits(fields.route, fields.model, kind)) {
      const fromDefault = ['default'].includes(sources.model) || String(sources.model || '').startsWith('inherited:') && !studio.tasks[String(sources.model).slice(10)]?.model;
      if (sources.model === 'program' && !programRoute && kind === 'text' && /^claude-/.test(fields.model)) { fields.route = studioClaudeRoute; sources.route = 'program'; }
      else if (fromDefault || fields.model === '') {
        const mapped = fitModel(fields.route, fields.model, kind, studio);
        if (mapped !== null) fields.model = mapped;
      }
      if (!modelFits(fields.route, fields.model, kind)) problem = fields.model ? `${labelOf('claude', fields.model, kind) || fields.model} can’t run on ${routeLabel(fields.route)}. Choose another model in Settings, Model routing.` : `Choose a model for ${task.label} in Settings, Model routing.`;
    }
    if (lite && task.lite) {
      const cheapest = cheapestStrongReader(fields.route);
      if (cheapest && task.lite.model === '@cheapestStrongReader') { fields.model = cheapest; sources.model = 'lite'; }
      if (task.lite.effort) { fields.effort = task.lite.effort; sources.effort = 'lite'; }
    }
    let note = '';
    if (kind === 'text') {
      const effortSource = ['program', 'studio', 'lite'].includes(sources.effort) || (String(sources.effort || '').startsWith('inherited:') && studio.tasks[String(sources.effort).slice(10)]?.effort) ? 'explicit' : 'default';
      fields.effortSource = effortSource;
      // Codex chooses its own reasoning unless someone picked one for this job (it ignored per-stage models before routing).
      if (fields.route === 'codex' && effortSource === 'default') fields.effort = '';
      const clamped = clampEffort(fields.route, fields.model, kind, fields.effort || '');
      fields.effort = clamped.effort; note = clamped.note;
    }
    if (kind === 'image' && fields.route === 'openai' && !QUALITIES.includes(fields.quality)) fields.quality = 'medium';
    if (kind === 'video') {
      const found = profileOf(fields.route, fields.model, 'video');
      if (found?.durations?.length && !found.durations.includes(Number(fields.durationSeconds))) problem ||= `${found.label} can’t make a ${fields.durationSeconds}-second video.`;
    }
    const source = sources.model === 'program' || sources.route === 'program' || sources.effort === 'program' ? 'program' : sources.model === 'studio' || sources.route === 'studio' || sources.effort === 'studio' ? 'studio' : Object.values(sources).find((value) => String(value).startsWith('inherited:')) || 'default';
    return finish(task, fields, { source, problem, note });
  }
  // A registry default on a connection it doesn't fit: Claude on OpenRouter → its OpenRouter id (only when OpenRouter lists
  // it); anything on Codex → Codex's default; OpenAI text → the studio text model when it fits; pictures on fal → a fal
  // model that takes reference images. null when nothing fits.
  function fitModel(route, model, kind, studio) {
    const family = familyOf(route);
    if (kind === 'image') return route === 'fal' ? (MODELS.images.find((row) => row.route === 'fal' && row.referenceImages > 0)?.id || null) : route === 'openai' ? tasks.defaults.image.model : null;
    if (kind === 'video') return route === 'fal' ? tasks.defaults.video.model : null;
    if (family === 'codex') return '';
    if (family === 'openrouter') { const id = MODELS.text.find((row) => row.id === model)?.openrouterId; return id && catalog?.hasOpenRouterModel?.(id) ? id : null; }
    if (family === 'openai') return modelFits(route, studio.defaults.text.model, 'text') ? studio.defaults.text.model : null;
    if (family === 'claude') return modelFits(route, studio.defaults.text.model, 'text') ? studio.defaults.text.model : tasks.defaults.text.model;
    return null;
  }
  function resolveMany(taskIds, context = {}) { return taskIds.map((taskId) => resolve(taskId, context)); }
  function snapshot(taskIds, context = {}) { return Object.fromEntries([...new Set(taskIds)].map((taskId) => [taskId, resolve(taskId, context)])); }

  // ---------- Validation (saveAiRouting) ----------
  function validate(input) {
    const routing = normalize(input, { strict: true });
    for (const kind of ['text', 'image', 'video']) {
      const { route, model } = routing.defaults[kind];
      if (model && !modelFits(route, model, kind)) throw fail(`defaults.${kind}.model`, `${model} can’t run on ${routeLabel(route)}. Choose a model that connection offers.`);
      if (kind !== 'text' && !model) throw fail(`defaults.${kind}.model`, 'Choose a model.');
    }
    for (const [taskId, choice] of Object.entries(routing.tasks)) {
      const task = byId.get(taskId); const kind = task.kind || 'text';
      if (choice.route && !ROUTES[kind].includes(choice.route)) throw fail(`tasks.${taskId}.route`, `${routeLabel(choice.route) || choice.route} can’t do ${task.label}.`);
      const resolved = resolve(taskId, { routing });
      if (choice.model !== undefined && choice.model !== '' && !modelFits(resolved.route, choice.model, kind)) throw fail(`tasks.${taskId}.model`, `${labelOf(resolved.route, choice.model, kind) || choice.model} can’t run on ${routeLabel(resolved.route)}.`);
      if (choice.effort && !EFFORTS.includes(choice.effort) && !(resolved.route === 'codex' && /^[a-z]{2,10}$/.test(choice.effort))) throw fail(`tasks.${taskId}.effort`, `Choose an effort level: ${EFFORTS.join(', ')}.`);
      if (choice.quality && !QUALITIES.includes(choice.quality)) throw fail(`tasks.${taskId}.quality`, 'Choose low, medium or high picture quality.');
      if (kind === 'video') {
        const found = profileOf(resolved.route, resolved.model, 'video');
        if (choice.durationSeconds !== undefined && (!Number.isInteger(choice.durationSeconds) || (found?.durations?.length && !found.durations.includes(choice.durationSeconds)))) throw fail(`tasks.${taskId}.durationSeconds`, 'Choose a video length this model makes.');
        if (choice.aspectRatio !== undefined && found?.aspectRatios?.length && !found.aspectRatios.includes(choice.aspectRatio)) throw fail(`tasks.${taskId}.aspectRatio`, 'Choose a shape this model makes.');
        if (choice.resolution !== undefined && found?.resolutions?.length && !found.resolutions.includes(choice.resolution)) throw fail(`tasks.${taskId}.resolution`, 'Choose a resolution this model makes.');
        if (choice.sound !== undefined && typeof choice.sound !== 'boolean') throw fail(`tasks.${taskId}.sound`, 'Sound is on or off.');
      }
      const minimum = task.needs?.minContextTokens;
      const found = profileOf(resolved.route, resolved.model, kind);
      if (minimum && Number.isFinite(found?.contextTokens) && found.contextTokens < minimum) throw fail(`tasks.${taskId}.model`, `${task.label} needs a model that reads at least ${Math.round(minimum / 1000)}K tokens.`);
    }
    return routing;
  }

  // ---------- Presets ----------
  // The routing a preset makes: for each task, the first candidate whose connection is ready: the studio's Claude
  // connection, then OpenRouter with the model's OpenRouter id, then Codex's default.
  function presetDraft(presetId, { base = current(), ready = (route) => isReady(route) !== false } = {}) {
    const preset = tasks.presets.find((entry) => entry.id === presetId);
    if (!preset) throw fail('preset', 'Choose Balanced, Lowest cost or Highest quality.');
    const routing = normalize({ ...copy(base), tasks: {}, preset: presetId });
    const claudeRoute = familyOf(routing.defaults.text.route) === 'claude' ? routing.defaults.text.route : 'auto';
    for (const [taskId, choice] of Object.entries(preset.tasks || {})) {
      if (!byId.has(taskId)) continue;
      const openrouterId = MODELS.text.find((row) => row.id === choice.model)?.openrouterId;
      const candidates = [[claudeRoute, choice.model], ...(openrouterId ? [['openrouter', openrouterId]] : []), ['codex', '']];
      const [route, model] = candidates.find(([candidate]) => ready(candidate)) || candidates[0];
      routing.tasks[taskId] = { ...(route !== routing.defaults.text.route ? { route } : {}), model, ...(route === 'codex' ? {} : { effort: choice.effort }) };
    }
    if (preset.image?.quality) {
      if (routing.defaults.image.route === 'openai') routing.defaults.image.quality = preset.image.quality;
      if (presetId === 'lowest-cost' && !ready('openai') && ready('fal')) routing.defaults.image = { route: 'fal', model: 'fal-ai/flux/dev', quality: 'low' };
    }
    if (preset.video) {
      if (preset.video.model) routing.defaults.video = { route: 'fal', model: preset.video.model };
      if (preset.video.durationSeconds) routing.tasks['video.social-clip'] = { ...(routing.tasks['video.social-clip'] || {}), durationSeconds: preset.video.durationSeconds };
    }
    return routing;
  }

  // ---------- Preview (Settings → Model routing) ----------
  const TYPICAL = { text: { input: 30000, output: 4000 }, image: { count: 1 }, video: {} };
  function typicalUsd(resolved) {
    const price = resolved.price || {};
    if (!resolved.metered) return null;
    if (price.basis === 'tokens' && price.known) {
      const multiplier = price.reasoning === false ? 1 : ({ low: 1.3, medium: 1.8, high: 2.5, xhigh: 3.5, max: 5 }[resolved.effort] || 2);
      return Math.round((TYPICAL.text.input * price.inputUsdPerMTok + TYPICAL.text.output * multiplier * price.outputUsdPerMTok) / 1e6 * 1000) / 1000;
    }
    if (price.basis === 'unit' && price.known && Number.isFinite(price.unitUsd)) {
      const units = catalog?.unitsFor ? catalog.unitsFor(price, { count: 1, durationSeconds: resolved.video?.durationSeconds || 0, width: 1536, height: 1024 }) : 1;
      return units == null ? null : Math.round(price.unitUsd * units * 100) / 100;
    }
    return null;
  }
  function overriddenBy() {
    return (programs() || []).map((program) => ({ programId: program.id, name: program.name, stages: Object.keys(programOverrides(program)) })).filter((entry) => entry.stages.length);
  }
  function preview({ routing = null, preset = null } = {}) {
    const base = current();
    const draft = preset ? presetDraft(preset, { base: routing ? normalize(routing) : base }) : normalize(routing || base);
    const rows = tasks.tasks.map((task) => {
      const resolved = resolve(task.id, { routing: draft });
      const readyState = isReady(resolved.route);
      const missing = readyState === false ? `${routeLabel(resolved.route)} isn’t connected. Connect it in Settings, AI connections.` : '';
      return {
        taskId: task.id, label: task.label, group: task.group, kind: task.kind, powers: task.powers || [], inherit: task.inherit || null,
        route: resolved.route, routeLabel: resolved.routeLabel, model: resolved.model, modelLabel: resolved.modelLabel,
        effort: resolved.effort, quality: resolved.quality, video: resolved.video,
        source: draft.tasks[task.id] ? (preset ? 'preset' : 'task') : resolved.source === 'studio' ? 'task' : resolved.source,
        explicit: copy(draft.tasks[task.id] || {}),
        ready: readyState !== false && !resolved.problem, problem: resolved.problem || missing || '', note: resolved.note || '',
        metered: resolved.metered, typicalUsd: typicalUsd(resolved), unit: task.kind === 'image' ? 'picture' : task.kind === 'video' ? 'clip' : 'call',
        efforts: task.kind === 'text' ? (profileOf(resolved.route, resolved.model, 'text')?.efforts || null) : null,
        structured: task.kind === 'text' ? (profileOf(resolved.route, resolved.model, 'text')?.structured || null) : null,
        referenceImages: task.kind === 'image' ? (profileOf(resolved.route, resolved.model, 'image')?.referenceImages ?? null) : null,
      };
    });
    const warnings = [];
    for (const row of rows) {
      if (!row.metered && row.kind === 'text' && !row.inherit) warnings.push(`${row.label}: Codex doesn’t report cost, so caps for this job are guides.`);
      if (row.kind === 'image' && row.referenceImages === 0) warnings.push(`${row.label}: this model can’t take your brand reference images, so pictures are made without them.`);
      if (row.kind === 'text' && row.taskId.startsWith('research.') && row.structured && row.structured !== 'native') warnings.push(`${row.label}: answers are checked afterwards and may need a repair try (paid).`);
    }
    const changedCount = rows.filter((row) => JSON.stringify(row.explicit) !== JSON.stringify(base.tasks[row.taskId] || {})).length + ['text', 'image', 'video'].filter((kind) => JSON.stringify(draft.defaults[kind]) !== JSON.stringify(base.defaults[kind])).length;
    const research = ['research.discovery', 'research.synthesis', 'research.matching', 'research.tagging', 'reports.trends-report'].map((id) => rows.find((row) => row.taskId === id));
    // A typical research run: about 12 discovery batches, one synthesis and matching call, 60 tagging batches, 6 report pairs.
    const weights = { 'research.discovery': 12 * 3, 'research.synthesis': 2, 'research.matching': 0.5, 'research.tagging': 60, 'reports.trends-report': 6 * 4 };
    const researchRunUsd = research.every((row) => row?.typicalUsd != null) ? Math.round(research.reduce((sum, row) => sum + row.typicalUsd * weights[row.taskId], 0) * 100) / 100 : null;
    const kitRow = rows.find((row) => row.taskId === 'assets.default'); const pictureRow = rows.find((row) => row.taskId === 'pictures.kit-image');
    const kitUsd = kitRow?.typicalUsd != null && pictureRow?.typicalUsd != null ? Math.round((kitRow.typicalUsd * 14 + pictureRow.typicalUsd * 9) * 100) / 100 : null;
    const askRow = rows.find((row) => row.taskId === 'assistant.ask-ai');
    return { routing: draft, tasks: rows, warnings: [...new Set(warnings)], examples: { researchRunUsd, kitUsd, askUsd: askRow?.typicalUsd ?? null }, overriddenBy: overriddenBy(), changedCount, presets: tasks.presets.map(({ id, label, description, recommended }) => ({ id, label, description, recommended: Boolean(recommended) })) };
  }

  // Which tasks a top-level method will use (for preflight before anything is spent).
  function taskIdsFor(method, { pictures = false, video = false, deliverableIds = [] } = {}) {
    if (method === 'startResearchRun') return ['research.discovery', 'research.synthesis', 'research.matching', 'research.tagging', 'reports.trends-report', 'reports.editorial-toolkit'];
    if (method === 'startQuickScan') return ['quickScans.discovery', 'quickScans.synthesis'];
    if (method === 'createContentRun') return ['create.drafts', ...(pictures ? ['pictures.content-image'] : [])];
    if (method === 'createAssetKit') {
      const written = deliverableIds.filter((id) => byId.has(`assets.${id}`)).map((id) => `assets.${id}`);
      return [...(written.length ? written : []), ...(pictures ? ['pictures.kit-brief', 'pictures.kit-image'] : []), ...(video ? ['video.brief', 'video.social-clip'] : [])];
    }
    if (method === 'askFindings') return ['assistant.ask-datasets'];
    if (method === 'askHelp') return ['assistant.ask-ai'];
    if (method === 'createHelpImage') return ['pictures.ask-ai'];
    if (method === 'generateAssets') return ['data.workflow-asset-pack'];
    return [];
  }
  // The task a Prompt Library prompt tests with (its registry entry's ai.taskId, else the task that lists it).
  function taskIdForPrompt(entry) {
    if (entry?.ai?.taskId && byId.has(entry.ai.taskId)) return entry.ai.taskId;
    const listed = tasks.tasks.find((task) => (task.promptIds || []).includes(entry?.id));
    if (listed) return listed.id;
    const source = entry?.ai?.modelSource;
    if (source === 'research' && entry.ai.stage) return byId.has(`research.${entry.ai.stage}`) ? `research.${entry.ai.stage}` : 'reports.trends-report';
    if (source === 'kit') return 'assets.default';
    if (source === 'image') return 'pictures.kit-image';
    if (source === 'settings') return 'create.drafts';
    return null;
  }
  function stamp(routing, by) { return { ...routing, updatedAt: now().toISOString(), updatedBy: by ? { id: String(by.id || ''), name: String(by.name || '') } : null }; }

  return { resolve, resolveMany, snapshot, preview, validate, normalize, current, presetDraft, migrate, programOverrides, legacyRunTask, taskIdsFor, taskIdForPrompt, stamp, typicalUsd, modelFits, routeLabel, task: (id) => copy(byId.get(id) || null), tasks: () => copy(tasks.tasks) };
}

module.exports = { createAiRouting, modelFits, ROUTES, FIELDS, LEGACY_DEFAULT_AI, routeLabel };
