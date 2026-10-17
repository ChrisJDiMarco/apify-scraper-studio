'use strict';
// The Prompt Library's API (SPEC-2 §A), served through the content workspace's studio:* methods: the list, one prompt with
// its history, a free preview on a recent run or the bundled sample, diffs, saves and restores (checked, versioned and
// credited), admin locks, and a paid test run that goes through the stage's real builder, schema and validator after
// the person confirmed its estimate. Electron-free; the content workspace supplies the store, the samples and the hosts.
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const template = require('../shared/prompt-template');
const research = require('../shared/research-program');
const cases = require('./prompt-cases');
const SAMPLES = require('../shared/prompt-samples.json');
const TASKS = require('../shared/ai-tasks.json');

const IMAGE_MODEL = 'gpt-image-2.5-flare';
const IMAGE_CAP_USD = 0.25; // the image provider's smallest dispatch allowance per picture
// Every picture prompt builds the campaign picture, so its tests send the campaign set's brand reference images.
const PICTURE_FAMILY = 'campaign';
const REFERENCE_USD = 0.015; // asset-kit KIT_REFERENCE_USD: each reference image's input on a GPT Image picture
const TEST_TIMEOUT_MS = 600000;
const fail = (message, status, extra = {}) => Object.assign(new Error(message), { status, ...extra });
const round = (value) => Math.round(value * 100) / 100;
const safeError = (error) => String(error?.message || error).replace(/(?:Bearer\s+|(?:sk-|apify_api_))[\w.-]+/gi, '[redacted]').slice(0, 1500);
const idOf = (payload) => String(payload?.id || payload?.promptId || '');
const modelLabel = (model) => research.RESEARCH_MODELS.find((entry) => entry.id === model)?.label || model;
const ROUTE_LABELS = { claude: 'the Claude app', 'claude-api': 'the Claude API key', codex: 'Codex', openai: 'the OpenAI API key', openrouter: 'OpenRouter', fal: 'fal.ai' };

// Hosts: store (prompt-store), workspace() → { id, editionId, name, knowledge }, who() → { id, name }, callerRole(),
// programs() (this workspace's research programs), kitAi(), settingsModel(), aiRoute() (async), runAI, generateImage,
// imagesReady(), trackJob({ id, kind, title, cancellable }) → { finish, fail, cancelled }, latestSample(promptId) (async)
// → { sample, label } | null, testsRoot, emit(). callerCaps() → Set of the caller's capability ids ('*' = all; the
// default, for a single-person host): a recent run's posts, reports or dataset rows go into a preview or test only for
// someone who may read them (SAMPLE_CAP); anyone else gets the bundled sample.
// The capability that owns the live data a prompt's "recent run" sample reads (content-workspace latestPromptSample).
const SAMPLE_CAP = (id) => (id.startsWith('research.') || id.startsWith('reports.') ? 'readResearch' : id.startsWith('assets.') || id.startsWith('pictures.') ? 'readAssets' : id === 'assistant.ask-datasets' || id.startsWith('data.') ? 'dataTools' : null);
// routing (optional): Model routing (resolve, current, taskIdForPrompt); each prompt tests on its task's connection and
// model. referenceSet(familyId, { data }) (optional): the brand reference images a picture family sends now.
function createPromptLab({ store, workspace, who, callerRole = () => 'admin', callerCaps = () => new Set(['*']), programs = () => [], kitAi, settingsModel = () => 'claude-opus-5-5', aiRoute = async () => 'claude', runAI, generateImage, imagesReady = () => false, trackJob, latestSample = async () => null, testsRoot, emit = () => {}, routing = null, referenceSet = () => ({ family: 'none', label: '', images: [] }) } = {}) {
  const running = new Set();
  let changesCache = null; // { key, rows }
  const space = () => { const w = workspace(); if (!w) throw fail('Choose a workspace first.', 400); return w; };
  const by = () => ({ ...who(), role: String(callerRole() || '') });
  const entryFor = (w, promptId) => {
    const entry = template.registryFor(w.editionId).prompts.find((row) => row.id === promptId);
    if (!entry) throw fail('That prompt isn’t in the Prompt Library for this workspace.', 404, { code: 'promptUnknown' });
    return entry;
  };
  // The prompt's AI task as its runs resolve it (research prompts with the newest program's own stage choices). override
  // ({ route, model, effort, quality }, admins testing a job in Settings → Model routing) replaces the studio's choice.
  function taskOf(entry, override = null) {
    if (!routing) return null;
    const taskId = routing.taskIdForPrompt(entry); if (!taskId) return null;
    const newest = [...programs()].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0] || null;
    const context = entry.ai?.modelSource === 'research' && newest ? { program: newest } : {};
    if (!override) return routing.resolve(taskId, context);
    const current = routing.current();
    return routing.resolve(taskId, { ...context, routing: { ...current, tasks: { ...current.tasks, [taskId]: override } } });
  }
  // Which model and effort a prompt runs on here, as its runs choose them (no route: that needs the host's async check).
  function modelOf(entry, override = null) {
    const source = entry.ai?.modelSource || 'none'; const stage = entry.ai?.stage;
    if (source !== 'none' && routing) {
      const task = taskOf(entry, override);
      if (task) return { model: task.model, effort: task.kind === 'text' ? task.effort : '', kind: task.kind === 'video' ? 'none' : task.kind, task };
    }
    if (source === 'image') return { model: IMAGE_MODEL, effort: '', kind: 'image' };
    if (source === 'none') return { model: '', effort: '', kind: 'none' };
    if (source === 'research') {
      const newest = [...programs()].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0];
      const ai = newest?.ai || research.DEFAULT_RESEARCH_AI;
      return { model: ai.models?.[stage] || research.DEFAULT_RESEARCH_AI.models[stage], effort: ai.effort?.[stage] || research.DEFAULT_RESEARCH_AI.effort[stage], kind: 'text' };
    }
    if (source === 'kit') { const ai = kitAi(); return { model: ai.model, effort: entry.ai?.effort || ai.effort, kind: 'text' }; }
    return { model: settingsModel(), effort: entry.ai?.effort || '', kind: 'text' };
  }
  async function settingsFor(entry, override = null) {
    const { model, effort, kind, task } = modelOf(entry, override);
    if (task) {
      // 'auto' is Claude Code or the Anthropic key, whichever answers now.
      const route = task.route === 'auto' ? await aiRoute() : task.route;
      if (kind === 'image') return { route, model, modelLabel: `${task.routeLabel} ${task.modelLabel}`.trim(), effort: '', quality: task.quality || '', metered: true, kind, task };
      return { route, model, modelLabel: route === 'codex' && !model ? 'Codex (your Codex model)' : task.modelLabel || modelLabel(model), effort, metered: task.metered !== false && route !== 'codex', kind, task };
    }
    const route = await aiRoute();
    if (kind === 'image') return { route: 'openai', model, modelLabel: 'OpenAI gpt-image-2.5-flare', effort, metered: true, kind };
    return { route, model, modelLabel: !model ? '' : route === 'codex' ? 'Codex (your Codex model)' : modelLabel(model), effort, metered: route !== 'codex', kind };
  }
  // The reference images a picture prompt's preview names and its test sends (the campaign set in Settings now).
  function pictureReferences(entry, { data = false } = {}) {
    if (entry.test?.kind !== 'image' && entry.id !== 'pictures.kit-brief') return { family: 'none', label: '', images: [] };
    try { return referenceSet(PICTURE_FAMILY, { data }) || { family: 'none', label: '', images: [] }; }
    catch (error) { if (data) throw error; return { family: PICTURE_FAMILY, label: '', images: [] }; }
  }
  function listRow(entry, row) {
    const saved = row || { version: 0, custom: false, locked: false, updatedAt: '', updatedBy: null, defaultChanged: false };
    return { id: entry.id, name: entry.name, group: entry.group, description: entry.description, powers: entry.powers, editable: entry.blocks.some((block) => block.editable), version: saved.version, custom: saved.custom, locked: saved.locked, updatedAt: saved.updatedAt, updatedBy: saved.updatedBy, defaultChanged: saved.defaultChanged };
  }
  function listPrompts() {
    const w = space(); const registry = template.registryFor(w.editionId); const summary = store.summary(w.id, w.editionId);
    return { editionId: w.editionId, groups: registry.groups, prompts: registry.prompts.map((entry) => listRow(entry, summary[entry.id])) };
  }
  async function readPrompt(payload = {}) {
    const role = String(callerRole() || ''); const w = space(); const entry = entryFor(w, idOf(payload)); const saved = store.read(w.id, w.editionId, entry.id);
    const shown = new Set(entry.blocks.map((block) => block.id)); const pick = (map) => Object.fromEntries(Object.entries(map).filter(([blockId]) => shown.has(blockId)));
    const settings = await settingsFor(entry);
    return {
      prompt: entry, editionId: w.editionId, blocks: pick(saved.effective), defaults: pick(saved.defaults), customized: saved.customized.filter((id) => shown.has(id)), defaultChanged: saved.defaultChanged.filter((id) => shown.has(id)),
      version: saved.version, locked: saved.locked, lock: saved.lock, lockedForYou: saved.locked && role !== 'admin', updatedAt: saved.updatedAt, updatedBy: saved.updatedBy,
      history: saved.history, tests: saved.tests, damaged: saved.damaged,
      model: settings.model, modelLabel: settings.modelLabel, effort: settings.effort, route: settings.route, metered: settings.metered, testable: entry.test?.kind !== 'none' && entry.test?.kind !== undefined,
    };
  }
  // The draft's own changed blocks (only editable ones of this edition; the rest are named by validateBlocks).
  function draftOf(entry, blocks) {
    if (blocks == null) return null;
    if (typeof blocks !== 'object' || Array.isArray(blocks)) throw fail('Send the draft as text per block.', 400);
    return Object.fromEntries(Object.entries(blocks).map(([blockId, text]) => [blockId, typeof text === 'string' ? template.normalize(text) : text]));
  }
  // The saved text of the prompt and the ones it's built with, with the draft over the prompt's own blocks.
  function promptSet(w, entry, draft) {
    const set = store.snapshot(w.id, w.editionId, cases.relatedIds(entry.id));
    if (draft) set[entry.id] = { ...(set[entry.id] || {}), blocks: { ...(set[entry.id]?.blocks || template.blocksFor(entry.id, w.editionId)), ...Object.fromEntries(Object.entries(draft).filter(([, text]) => typeof text === 'string')) } };
    return set;
  }
  async function sampleFor(entry, wanted) {
    const want = wanted === 'bundled' ? 'bundled' : 'latest';
    if (want === 'latest' && (entry.test?.samples || []).includes('latest')) {
      let caps; try { caps = callerCaps(); } catch (_) { caps = new Set(); }
      const need = SAMPLE_CAP(entry.id);
      if (need && !(caps instanceof Set && (caps.has('*') || caps.has(need)))) return { sample: SAMPLES, sampleLabel: `${SAMPLES.label} (recent runs need access to that data)`, sampleId: 'bundled' };
      let found = null; try { found = await latestSample(entry.id); } catch (_) { found = null; }
      if (found?.sample) return { sample: found.sample, sampleLabel: found.label, sampleId: 'latest' };
      return { sample: SAMPLES, sampleLabel: `${SAMPLES.label} (no recent run has this yet)`, sampleId: 'bundled' };
    }
    return { sample: SAMPLES, sampleLabel: SAMPLES.label, sampleId: 'bundled' };
  }
  // One derivation for preview, estimate and test, so all three describe the same call. role is read at the method's entry.
  async function derive(payload, { trace, role, override = null }) {
    const w = space(); const entry = entryFor(w, idOf(payload)); const draft = draftOf(entry, payload.blocks);
    const problems = draft ? template.validateBlocks(entry.id, w.editionId, draft) : [];
    const { sample, sampleLabel, sampleId } = await sampleFor(entry, payload.sample ?? payload.sampleId);
    // Picture prompts show and send the reference lines their runs would (roles only here; the bytes load for a test).
    const refs = pictureReferences(entry);
    let built;
    try { built = cases.build(entry.id, { editionId: w.editionId, brandName: w.knowledge?.name || w.name || '', sample, prompts: promptSet(w, entry, draft), trace, role: role || 'admin', references: refs.images.map((image) => ({ role: image.role })) }); }
    catch (error) { throw fail(`The ${sampleId === 'latest' ? 'recent run' : 'sample'} couldn’t be turned into this prompt: ${safeError(error)}`, 400, { code: 'promptSample' }); }
    return { w, entry, draft, problems, built, sampleLabel, sampleId, references: refs, settings: await settingsFor(entry, override) };
  }
  function costOf(settings, built, chars) {
    if (built.kind === 'image') return round(built.estimateUsd || 0);
    if (built.kind !== 'text' || !settings.model) return 0;
    const price = settings.task?.price?.basis === 'tokens' && settings.task.price.known ? { price: settings.task.price, reasoning: settings.task.price.reasoning !== false } : {};
    return round(research.callCost(settings.model, settings.effort, research.estimateTokens(chars), built.outputTokens || 2000, price));
  }
  // One test picture on the routed picture task: GPT Image's measured price for its quality plus each reference image, or
  // fal.ai's unit price.
  function pictureEstimate(settings, referenceCount) {
    const task = settings.task;
    if (task?.route === 'fal') return Number.isFinite(task.price?.unitUsd) ? round(task.price.unitUsd * (/megapixel/i.test(task.price.unit || '') ? 2 : 1)) : null;
    const base = task?.price?.basis === 'unit' && Number.isFinite(task.price.unitUsd) ? task.price.unitUsd : cases.PICTURE_USD;
    return round(base + referenceCount * REFERENCE_USD);
  }
  async function previewPrompt(payload = {}) {
    const { entry, problems, built, sampleLabel, sampleId, settings } = await derive(payload, { trace: true, role: String(callerRole() || '') });
    const { text, segments } = template.segmentsOf(built.prompt);
    return { id: entry.id, text, segments, chars: text.length, tokens: built.kind === 'image' ? 0 : research.estimateTokens(text.length), estimateUsd: costOf(settings, built, text.length), sampleLabel, sample: sampleId, problems, kind: built.kind, model: settings.model, modelLabel: settings.modelLabel, effort: settings.effort, route: settings.route, metered: settings.metered };
  }
  function diffPromptVersions(payload = {}) {
    const w = space(); const entry = entryFor(w, idOf(payload));
    const diff = store.diff(w.id, w.editionId, entry.id, { from: payload.from ?? 'current', to: payload.to ?? 'draft', draft: draftOf(entry, payload.draft) });
    const shown = new Set(entry.blocks.map((block) => block.id));
    return { ...diff, blocks: diff.blocks.filter((block) => shown.has(block.blockId)) };
  }
  async function afterChange(w, entry, result) {
    changesCache = null; if (result.changed !== false) emit();
    return { version: result.version, changed: result.changed !== false, prompt: listRow(entry, store.summaryRow(w.id, w.editionId, entry.id)), detail: await readPrompt({ id: entry.id }) };
  }
  async function savePromptVersion(payload = {}) {
    const author = by(); const w = space(); const entry = entryFor(w, idOf(payload));
    const source = payload.source === 'ask-ai' ? 'ask-ai' : 'library';
    const result = store.save(w.id, w.editionId, entry.id, { blocks: payload.blocks, expectedVersion: payload.expectedVersion, note: payload.note, by: author, source, conversationId: source === 'ask-ai' ? payload.conversationId : '' });
    return afterChange(w, entry, result);
  }
  async function revertPrompt(payload = {}) {
    const author = by(); const w = space(); const entry = entryFor(w, idOf(payload));
    const result = store.revert(w.id, w.editionId, entry.id, { toVersion: Number(payload.toVersion), expectedVersion: payload.expectedVersion, note: payload.note, by: author });
    return afterChange(w, entry, result);
  }
  async function setPromptLock(payload = {}) {
    const author = by(); const w = space(); const entry = entryFor(w, idOf(payload));
    store.setLock(w.id, w.editionId, entry.id, { locked: payload.locked, by: author }); changesCache = null; emit();
    return readPrompt({ id: entry.id });
  }
  // What a test run would cost and on what, before anything is spent. A test of a picture prompt draws one picture.
  async function estimate(payload, role, { override = null } = {}) {
    const derived = await derive(payload, { trace: false, role, override }); const { entry, built, settings } = derived;
    const kind = entry.test?.kind || 'none';
    const base = { id: entry.id, kind, sample: derived.sampleId, sampleLabel: derived.sampleLabel, problems: derived.problems, model: settings.model, modelLabel: settings.modelLabel, effort: settings.effort, route: settings.route, metered: settings.metered, chars: built.prompt.length };
    if (kind === 'none' || built.kind === 'none') return { ...derived, out: { ...base, available: false, reason: 'This prompt can’t be test-run on its own. Use the preview, or try it where it runs.', estimateUsd: 0, capUsd: 0, fingerprint: '' } };
    if (kind === 'image') {
      const prompt = built.pictures[0];
      const ready = typeof generateImage === 'function' && imagesReady();
      const refs = derived.references;
      const estimateUsd = pictureEstimate(settings, settings.task?.route === 'fal' ? 0 : refs.images.length);
      const priced = estimateUsd != null;
      const fingerprint = template.hashOf({ id: entry.id, prompt, model: settings.task?.model || IMAGE_MODEL, route: settings.task?.route || 'openai', quality: settings.task?.quality || '', size: built.deliverable.size, kind, references: refs.images.map((image) => [image.role, image.sha256]) });
      const note = refs.family === 'none' ? 'Draws one picture with the first variation.' : refs.images.length ? `Draws one picture with the first variation and sends the ${refs.images.length} reference image${refs.images.length === 1 ? '' : 's'} in ${refs.label}, as runs do.` : `Draws one picture with the first variation. No reference images in ${refs.label || 'the campaign set'} yet, so the test picture follows the brand colors only.`;
      return { ...derived, prompt, out: { ...base, available: ready && priced, reason: !ready ? 'Pictures aren’t set up. Connect a picture model in Settings → AI connections.' : priced ? '' : 'fal.ai didn’t return a price for this picture model, so it can’t be estimated.', estimateUsd: estimateUsd ?? 0, capUsd: Math.max(IMAGE_CAP_USD, Math.ceil((estimateUsd || 0) * 3 * 100) / 100), pictures: 1, fingerprint, note: `${note} The cap is the image provider’s smallest allowance, not the charge.`, references: { family: refs.family, label: refs.label, ...referenceSummaryOf(refs.images) } } };
    }
    const estimateUsd = costOf(settings, built, built.prompt.length);
    const capUsd = settings.metered ? Math.min(5, Math.max(0.5, Math.ceil(estimateUsd * 3 * 100) / 100)) : 0;
    const fingerprint = template.hashOf({ id: entry.id, prompt: built.prompt, schema: built.schema, model: settings.model, effort: settings.effort, route: settings.route, kind });
    return { ...derived, prompt: built.prompt, out: { ...base, available: true, reason: '', estimateUsd, capUsd, tokens: research.estimateTokens(built.prompt.length), fingerprint, note: settings.metered ? '' : 'Your Codex plan (not metered): Codex reports no cost and takes no cap.' } };
  }
  async function estimatePromptTest(payload = {}) { return (await estimate(payload, String(callerRole() || ''))).out; }
  const referenceSummaryOf = (images) => ({ style: images.filter((image) => image.role === 'style').length, logo: images.filter((image) => image.role === 'logo').length });
  // The tasks a test run uses (index.js checks their connections and models before anything is spent).
  function testTasks(payload = {}) {
    try {
      const w = space(); const entry = entryFor(w, idOf(payload));
      if (!['text', 'image'].includes(entry.test?.kind)) return [];
      const task = taskOf(entry); return task && task.kind === entry.test.kind ? [task] : [];
    } catch (_) { return []; }
  }
  // The model a text test needs (index.js runs its model preflight first). Synchronous; pictures need none, and the route
  // check skips Codex itself.
  function testModels(payload = {}) {
    try { const w = space(); const entry = entryFor(w, idOf(payload)); const { model, kind } = modelOf(entry); return entry.test?.kind === 'text' && kind === 'text' && model ? [model] : []; } catch (_) { return []; }
  }
  async function testPrompt(payload = {}, { override = null } = {}) {
    const author = by(); const derived = await estimate(payload, author.role, { override }); const { w, entry, draft, built, out, settings } = derived;
    if (!out.available) throw fail(out.reason, 400, { code: 'promptTestUnavailable' });
    if (typeof payload.fingerprint !== 'string' || payload.fingerprint !== out.fingerprint) throw fail('The prompt changed; check the cost again.', 409, { code: 'promptTestChanged' });
    if (derived.problems.length) throw fail('Fix the problems in this draft before testing it.', 400, { code: 'promptInvalid', problems: derived.problems });
    if (draft && Object.keys(draft).length && store.read(w.id, w.editionId, entry.id).locked && author.role !== 'admin') throw fail(`An admin locked “${entry.name}”. You can test the saved version, not a draft.`, 403, { code: 'promptLocked' });
    const key = `${w.id}:${entry.id}`;
    if (running.has(key)) throw fail(`A test run of “${entry.name}” is already running. Wait for it to finish.`, 409, { code: 'promptTestRunning' });
    running.add(key);
    const testId = `ptest-${randomUUID()}`; const dir = path.join(testsRoot, testId); fs.mkdirSync(dir, { recursive: true });
    // A picture request can't be stopped once sent, so only text tests offer Cancel.
    const job = typeof trackJob === 'function' ? trackJob({ id: testId, kind: 'prompt-test', title: `Test run · ${entry.name}`, cancellable: out.kind !== 'image' }) : null;
    const cancelled = () => Boolean(job?.cancelled?.());
    const started = Date.now(); let result = { ok: false, status: 'failed', problems: [], output: null, receipt: null };
    try {
      if (out.kind === 'image') {
        // The campaign set's reference images go with the test picture, read and checked now (as a run copies them).
        const refs = pictureReferences(entry, { data: true });
        const images = await generateImage({ ...(settings.task ? { task: settings.task } : {}), deliverable: { ...built.deliverable, kind: 'image', variants: 1, variantPrompts: [derived.prompt], references: refs.images.map((image) => ({ role: image.role, mime: image.mime, data: image.data })) }, runId: testId, maxBudgetUsd: out.capUsd, isCancelled: cancelled, onRequest: async () => {}, onVariant: async () => {} });
        const image = Array.isArray(images) ? images[0] : null;
        if (!image?.png) throw new Error('The image provider returned no picture.');
        result = { ok: true, status: 'passed', problems: [], output: { imageDataUrl: `data:image/png;base64,${Buffer.from(image.png).toString('base64')}`, size: built.deliverable.size }, receipt: { costUsd: Number.isFinite(image.receipt?.costUsd) ? image.receipt.costUsd : null, model: image.receipt?.requestedModel || settings.task?.model || IMAGE_MODEL, route: settings.task?.route || 'openai', metered: true, references: referenceSummaryOf(refs.images) } };
      } else {
        const call = await runAI({ runId: testId, jobId: testId, schema: built.schema, prompt: derived.prompt, maxBudgetUsd: out.capUsd, workspaceDir: dir, outputPath: path.join(dir, 'output.raw.json'), ...(settings.task ? { task: settings.task } : {}), ...(settings.model && settings.metered ? { model: settings.model } : {}), ...(settings.effort ? { effort: settings.effort } : {}), timeoutMs: TEST_TIMEOUT_MS });
        const receipt = { costUsd: Number.isFinite(call?.receipt?.costUsd) ? call.receipt.costUsd : null, model: call?.receipt?.actualModel || call?.receipt?.requestedModel || settings.model, route: settings.route, metered: settings.metered, effort: settings.effort };
        try { result = { ok: true, status: 'passed', problems: [], output: built.validate(call?.output), receipt }; }
        catch (error) { result = { ok: false, status: 'failed', problems: (Array.isArray(error.violations) && error.violations.length ? error.violations.map((entryRow) => entryRow.message) : [safeError(error)]).slice(0, 20), output: call?.output ?? null, receipt }; }
      }
      job?.finish?.({ status: result.ok ? 'succeeded' : 'failed' });
    } catch (error) {
      const stopped = cancelled();
      result = { ok: false, status: stopped ? 'cancelled' : 'failed', problems: [stopped ? 'The test run was stopped.' : safeError(error)], output: null, receipt: Number.isFinite(error?.costUsd) ? { costUsd: error.costUsd, model: settings.model, route: settings.route, metered: settings.metered } : null };
      if (stopped) job?.finish?.({ status: 'cancelled' }); else job?.fail?.(error);
    } finally {
      running.delete(key);
      fs.rmSync(dir, { recursive: true, force: true });
    }
    const record = store.recordTest(w.id, w.editionId, entry.id, { id: testId, draftHash: draft ? template.hashOf(draft) : '', sample: derived.sampleId, by: author, route: result.receipt?.route || settings.route, model: result.receipt?.model || settings.model, effort: settings.effort, costUsd: result.receipt?.costUsd ?? null, ok: result.ok, status: result.status, problems: result.problems });
    return { testId, ...result, chars: derived.prompt.length, durationMs: Date.now() - started, sampleLabel: derived.sampleLabel, test: record };
  }
  // ---------- Settings → Model routing: test one AI job on a chosen connection and model ----------
  // The job's own prompt runs once on the bundled sample, through its real builder and checks, with the admin's choice
  // ({ route, model, effort, quality }) in place of the studio's. Videos aren't tested here (a clip takes minutes).
  function taskTestEntry(taskId) {
    const task = TASKS.tasks.find((row) => row.id === taskId);
    if (!task) throw fail('That AI job isn’t in this studio.', 404);
    if (task.kind === 'video') throw fail('Try video models by making a video from a report; the estimate shows before anything is paid.', 400, { code: 'taskTestVideo' });
    const w = space(); const registry = template.registryFor(w.editionId).prompts;
    const ids = [...(task.promptIds || []), ...(task.kind === 'image' ? ['pictures.kit-image'] : [])];
    const entry = ids.map((promptId) => registry.find((row) => row.id === promptId)).find((row) => row && row.test?.kind === task.kind);
    if (!entry) throw fail(task.id === 'assistant.ask-ai' ? 'Ask AI can’t be test-run on its own. Ask it a question to try the model.' : 'This job has no prompt to test on its own.', 400, { code: 'taskTestUnavailable' });
    return { task, entry };
  }
  function overrideOf(payload, task) {
    const override = {};
    if (typeof payload.route === 'string' && payload.route) override.route = payload.route;
    if (typeof payload.model === 'string') override.model = payload.model.trim().slice(0, 200);
    if (task.kind === 'text' && typeof payload.effort === 'string') override.effort = payload.effort;
    if (task.kind === 'image' && typeof payload.quality === 'string' && payload.quality) override.quality = payload.quality;
    return override;
  }
  async function estimateTaskTest(payload = {}) {
    if (String(callerRole() || '') !== 'admin') throw fail('Only admins test AI jobs.', 403);
    const { task, entry } = taskTestEntry(String(payload.taskId || ''));
    const override = overrideOf(payload, task);
    const resolved = taskOf(entry, override);
    if (resolved?.problem) throw fail(resolved.problem, 400, { code: 'taskTestUnavailable' });
    const { out } = await estimate({ id: entry.id, sample: 'bundled' }, 'admin', { override });
    if (!out.available) throw fail(out.reason, 400, { code: 'taskTestUnavailable' });
    const through = ROUTE_LABELS[out.route] || out.route;
    const money = (value) => `$${value >= 0.1 ? value.toFixed(2) : Number(value.toPrecision(2))}`;
    const lines = task.kind === 'image'
      ? [`Draws one picture with the ${entry.name} prompt on the sample with ${out.modelLabel || out.model}${resolved?.quality ? ` at ${resolved.quality} quality` : ''}.`, out.metered ? `About ${money(out.estimateUsd)}, capped at ${money(out.capUsd)}.` : 'Not metered.', ...(out.note ? [out.note] : [])]
      : [`Runs the ${entry.name} prompt once on the sample with ${out.modelLabel || out.model || 'the default model'}${out.effort ? ` · ${out.effort}` : ''} through ${through}.`, out.metered ? `About ${money(Math.max(out.estimateUsd, 0.01))}, capped at ${money(out.capUsd)}.` : 'Codex doesn’t report cost and takes no cap.'];
    return { taskId: task.id, kind: task.kind, promptId: entry.id, sampleLabel: out.sampleLabel, estimateUsd: out.estimateUsd, capUsd: out.capUsd, metered: out.metered, lines, fingerprint: out.fingerprint, route: out.route, model: out.model };
  }
  const taskTests = new Map(); // requestId → the test's promise (a repeat of the same request joins it)
  async function testTask(payload = {}) {
    if (String(callerRole() || '') !== 'admin') throw fail('Only admins test AI jobs.', 403);
    const requestId = String(payload.requestId || '');
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(requestId)) throw fail('Invalid test request ID.', 400);
    if (taskTests.has(requestId)) return taskTests.get(requestId);
    const work = (async () => {
      const { task, entry } = taskTestEntry(String(payload.taskId || ''));
      const override = overrideOf(payload, task);
      const result = await testPrompt({ id: entry.id, sample: 'bundled', fingerprint: payload.fingerprint }, { override });
      const image = result.output?.imageDataUrl || '';
      return { ok: result.ok, durationMs: result.durationMs, receipt: result.receipt, problems: result.problems, ...(image ? { imageDataUrl: image } : { output: result.output, preview: result.output ? JSON.stringify(result.output, null, 2).slice(0, 4000) : '' }) };
    })();
    taskTests.set(requestId, work);
    work.catch(() => taskTests.delete(requestId)).then(() => { if (taskTests.size > 50) taskTests.delete(taskTests.keys().next().value); });
    return work;
  }
  // The latest saved changes in this workspace (newest first), for the Inbox and analytics. Cached until the next save.
  function recentChanges(limit = 20) {
    const w = workspace(); if (!w) return [];
    const key = `${w.id}:${w.editionId}`;
    if (changesCache?.key === key) return changesCache.rows.slice(0, limit);
    const names = new Map(template.REGISTRY.prompts.map((entry) => [entry.id, entry.name])); const rows = [];
    let summary = {}; try { summary = store.summary(w.id, w.editionId); } catch (_) { summary = {}; }
    for (const promptId of Object.keys(summary)) {
      let saved; try { saved = store.read(w.id, w.editionId, promptId); } catch (_) { continue; }
      // `by` lets the Inbox leave out a person's own saves; byName stays for older readers.
      for (const row of saved.history.slice(0, 10)) rows.push({ promptId, name: names.get(promptId) || promptId, version: row.version, at: row.at, by: { id: row.by?.id || '', name: row.by?.name || '' }, byName: row.by?.name || '', source: row.source, note: row.note, current: row.version === saved.version });
    }
    rows.sort((a, b) => String(b.at).localeCompare(String(a.at)));
    changesCache = { key, rows: rows.slice(0, 50) };
    return changesCache.rows.slice(0, limit);
  }
  return { listPrompts, readPrompt, previewPrompt, diffPromptVersions, savePromptVersion, revertPrompt, setPromptLock, estimatePromptTest, testPrompt: (payload) => testPrompt(payload), testModels, testTasks, estimateTaskTest, testTask, recentChanges };
}

module.exports = { createPromptLab, IMAGE_CAP_USD, ROUTE_LABELS };
