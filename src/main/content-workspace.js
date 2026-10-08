// Shared application service for desktop and browser hosts. No Electron dependency.
const fs = require('fs');
const path = require('path');
const { randomUUID, createHash } = require('crypto');
const content = require('../shared/content-studio');
const research = require('../shared/research-program');
const researchPrompts = require('../shared/research-prompts');
const intel = require('../shared/research-intel');
const { validateResearchSchedule, nextResearchScheduleAt, latestResearchScheduleAt, researchScheduleWindow } = require('../shared/research-schedule');
// Golden Thread trend report + editorial toolkit (loaded on use so older hosts keep starting).
const reports = () => require('../shared/research-reports');
const SEMRUSH_ENTERPRISE_PRODUCTS = ['Enterprise SEO', 'Enterprise SI (Site Intelligence)', 'Enterprise AIO'];
const REFERENCE_DOC_KINDS = ['icp', 'positioning', 'registry', 'ai-visibility', 'other'];
const copy = value => JSON.parse(JSON.stringify(value));
const id = prefix => `${prefix}-${randomUUID()}`;
function safeId(value) { if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,180}$/.test(value)) throw new Error('Invalid studio record ID.'); return value; }
function budget(value) { if (typeof value === 'boolean' || !Number.isFinite(Number(value)) || Number(value) < .01 || Number(value) > 1000) throw new Error('Choose a run budget from $0.01 to $1,000.'); return Number(value); }
function enterpriseList(value) { const list = (Array.isArray(value) ? value : String(value || '').split(',')).map(entry => String(entry).trim()).filter(Boolean); if (list.length > 20 || list.some(entry => entry.length > 160)) throw new Error('List up to 20 Enterprise products by their exact registry names.'); return [...new Set(list)]; }
function safeError(error) { return String(error?.message || error).replace(/(?:Bearer\s+|(?:sk-|apify_api_))[\w.-]+/gi, '[redacted]').slice(0, 1500); }
// Exact strings from the shipped semrush-workflow-v1 preset. Never match by a
// substring or replace the whole knowledge object: edited fields belong to the owner.
const LEGACY_SEMRUSH_BRAND_FIELDS = Object.freeze({
  positioning: 'Explain the practitioner problem and the relevant approved product fit. Treat this as editorial direction, not proof of product features, measured outcomes or corporate positioning claims.',
  editorialRules: 'Enterprise and self-serve products stay separate. Affiliate material uses only explicitly approved self-serve products. Comprehensive evidence reports quote X and LinkedIn sources directly; Reddit is summarized with links. Editorial toolkits contain both enterprise and self-serve angles, five product-agnostic headlines/subheads/hooks each, two Enterprise CTAs and three PLG CTAs. Search Engine Land copy is attributed journalism, not product advertising. PR research excludes Search Engine Land, MarTech, Backlinko, Exploding Topics and Search Engine Roundtable under the supplied workspace policy; no guessed contacts or prior articles.',
});
function createContentWorkspace({ root, runAI, collect, getDatasets = () => [], readDataset, emit = () => {}, cancelProvider = () => {}, generateImage, publishCampaign, capabilities = () => ({}), importSource, openFile, clock = () => new Date(), defaultWorkspaceId = 'general' } = {}) {
  if (!root || typeof runAI !== 'function') throw new Error('Studio storage and AI host are required.');
  const stamp = () => new Date(clock()).toISOString();
  fs.mkdirSync(root, { recursive: true });
  const stateFile = path.join(root, 'state.json');
  const fresh = () => ({ version: 1, activeWorkspaceId: ['general', 'semrush'].includes(defaultWorkspaceId) ? defaultWorkspaceId : 'general', workspaces: ['general', 'semrush'].map(editionId => ({ id: editionId, name: editionId === 'semrush' ? 'Semrush workspace' : 'Your workspace', editionId, knowledge: content.validateBrandKnowledge(editionId === 'semrush' ? content.SEMRUSH_KNOWLEDGE_PRESET : {}, { editionId }), products: [], ...(editionId === 'semrush' ? { brandDefaults: copy(content.SEMRUSH_BRAND_2026) } : {}), createdAt: stamp(), updatedAt: stamp() })), programs: [], researchRuns: [], contentRuns: [], themes: [], history: [], detections: [], assets: [], exports: [], datasetOwners: {} });
  let state;
  try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw new Error('Studio data could not be read. Restore the saved state before continuing.'); state = fresh(); }
  state.detections ||= [];
  const active = new Map(); const stopped = new Set(); const publishing = new Set();
  let researchScheduleTimer;
  function file(runId, name) { safeId(runId); const dir = path.join(root, 'runs', runId); fs.mkdirSync(dir, { recursive: true }); return path.join(dir, name); }
  function writeBytes(target, data) {
    const temp = `${target}.${process.pid}.tmp`; const fd = fs.openSync(temp, 'w', 0o600);
    try { fs.writeFileSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temp, target);
    let directory;
    try { directory = fs.openSync(path.dirname(target), 'r'); fs.fsyncSync(directory); }
    catch (error) { if (!['EINVAL', 'ENOTSUP', 'EPERM', 'EACCES', 'EISDIR'].includes(error.code)) throw error; }
    finally { if (directory != null) fs.closeSync(directory); }
  }
  function write(target, data) { writeBytes(target, JSON.stringify(data, null, 2)); }
  function read(target) { return JSON.parse(fs.readFileSync(target, 'utf8')); }
  function save() { write(stateFile, state); emit(); }
  function migrateSemrushBrandDefaults() {
    let changed = false;
    for (const w of state.workspaces) {
      if (w.editionId !== 'semrush') continue;
      let workspaceChanged = false;
      const knowledge = w.knowledge;
      if (knowledge?.editionId === 'semrush' && knowledge.version === 'semrush-workflow-v1') {
        let migrated = false;
        for (const [field, legacyValue] of Object.entries(LEGACY_SEMRUSH_BRAND_FIELDS)) {
          if (knowledge[field] !== legacyValue) continue;
          knowledge[field] = content.SEMRUSH_KNOWLEDGE_PRESET[field];
          migrated = true;
        }
        if (migrated) {
          knowledge.version = content.SEMRUSH_KNOWLEDGE_PRESET.version;
          workspaceChanged = true;
        }
      }
      // Brand provenance is independent of editable knowledge and its version.
      if (JSON.stringify(w.brandDefaults) !== JSON.stringify(content.SEMRUSH_BRAND_2026)) {
        w.brandDefaults = copy(content.SEMRUSH_BRAND_2026);
        workspaceChanged = true;
      }
      if (workspaceChanged) { w.updatedAt = stamp(); changed = true; }
    }
    return changed;
  }
  function workspace(workspaceId = state.activeWorkspaceId, enforce = true) { safeId(workspaceId); const result = state.workspaces.find(w => w.id === workspaceId); if (!result || (enforce && workspaceId !== state.activeWorkspaceId)) throw new Error('Select the workspace that owns this record.'); return result; }
  function owned(list, recordId) { safeId(recordId); const item = list.find(row => row.id === recordId); if (!item || item.workspaceId !== state.activeWorkspaceId) throw new Error('Record not found in the selected workspace.'); return item; }
  function runRecord(runId) { return owned([...state.contentRuns, ...state.researchRuns], runId); }
  function assetResult(asset) { const output = asset.kind === 'text' ? read(file(asset.runId, `${asset.id}.json`)) : undefined; const original = output ? read(file(asset.runId, 'input.json')).source : null; return { asset: copy(asset), ...(output ? { output, markdown: content.renderContentExport(output), evidence: content.normalizeSource(original).evidence, aggregateMetrics: original.aggregateMetrics } : { imageDataUrl: `data:image/png;base64,${fs.readFileSync(file(asset.runId, `${asset.id}.png`)).toString('base64')}` }) }; }
  function publicRun(run) { const value = copy(run); if (run.type === 'research') { value.ownCostUsd = run.costUsd; value.costUsd += (run.reportRunIds || []).reduce((sum, entry) => sum + (state.contentRuns.find(child => child.id === entry.runId)?.costUsd || 0), 0); } return value; }
  function publicState() {
    const scoped = list => copy(list.filter(row => row.workspaceId === state.activeWorkspaceId));
    const datasets = getDatasets().filter(d => (state.datasetOwners[d.id] || d.workspaceId || 'general') === state.activeWorkspaceId).map(d => ({ id: d.id, name: d.name, platform: d.platform, itemCount: d.itemCount, createdAt: d.createdAt }));
    // Reference documents can be long; state carries their metadata and readReferenceDoc returns the text.
    const activeView = w => ({ ...w, referenceDocs: (w.referenceDocs || []).map(({ text, ...doc }) => ({ ...doc, characters: String(text || '').length })) });
    return { activeWorkspaceId: state.activeWorkspaceId, workspaces: copy(state.workspaces.map(w => w.id === state.activeWorkspaceId ? activeView(w) : { id: w.id, name: w.name, editionId: w.editionId, createdAt: w.createdAt, updatedAt: w.updatedAt })), programs: scoped(state.programs).map(program => ({ ...program, schedule: program.schedule || validateResearchSchedule() })), researchRuns: state.researchRuns.filter(run => run.workspaceId === state.activeWorkspaceId).map(publicRun), contentRuns: scoped(state.contentRuns), themes: scoped(state.themes), assets: scoped(state.assets), availableDatasets: datasets, availableReports: scoped(state.assets).filter(a => ['evidence-report', 'editorial-toolkit'].includes(a.deliverableId)).map(a => ({ id: a.id, assetId: a.id, title: a.title, createdAt: a.createdAt })), capabilities: { imagesConfigured: !!generateImage, googleConfigured: false, googlePublishConfigured: !!publishCampaign, ...capabilities() } };
  }
  function updateScheduledRun(run) {
    if (!run.scheduledFor) return;
    const program = state.programs.find(row => row.id === run.programId && row.workspaceId === run.workspaceId);
    if (!program || program.schedule?.lastRunId !== run.id) return;
    program.schedule.lastStatus = run.status;
    if (['failed', 'partial', 'cancelled'].includes(run.status)) {
      program.schedule.enabled = false; program.schedule.nextRunAt = '';
      program.schedule.lastError = run.message || 'The scheduled run needs attention. Review it before resuming.';
    }
  }
  function recoverInterrupted() {
    for (const run of [...state.contentRuns, ...state.researchRuns]) if (['queued', 'running'].includes(run.status)) {
      run.status = (run.jobs || []).some(job => job.status === 'succeeded' || job.assetIds?.length) ? 'partial' : 'failed';
      run.message = 'The app stopped during this run. Retry resumes saved stages and keeps completed assets.';
      for (const job of run.jobs || []) if (job.status === 'running') { job.status = job.assetIds?.length ? 'partial' : 'failed'; job.error = 'Interrupted before completion.'; }
      updateScheduledRun(run);
    }
    save();
  }
  function check(run) { if (stopped.has(run.id)) throw new Error('Run cancelled.'); }
  function launch(run, task) {
    if (active.has(run.id)) return copy(run);
    stopped.delete(run.id); run.status = 'queued'; run.updatedAt = stamp(); save();
    const work = Promise.resolve().then(async () => { check(run); run.status = 'running'; updateScheduledRun(run); save(); await task(); }).catch(error => { run.status = stopped.has(run.id) ? 'cancelled' : (run.jobs || []).some(j => j.status === 'succeeded' || j.assetIds?.length) ? 'partial' : 'failed'; run.message = safeError(error); }).finally(() => { active.delete(run.id); run.updatedAt = stamp(); updateScheduledRun(run); save(); });
    active.set(run.id, work); return copy(run);
  }
  // One Claude call. Research stages size the per-call spending cap from the call's own estimate
  // (generous headroom, never the whole run divided evenly, which starved large batches);
  // content runs keep the even split across their remaining outputs.
  async function ai(run, key, schema, prompt, remainingSteps, options = {}) {
    check(run); const remaining = Math.round((run.maxBudgetUsd - run.reservedUsd) * 100) / 100;
    if (remaining < .01) throw new Error('Run budget exhausted. Increase the budget before retrying.');
    let allowance;
    if (Number.isFinite(options.estimateUsd)) {
      const needed = Math.min(100, Math.max(.01, options.estimateUsd));
      if (remaining < needed) throw new Error(`This step needs about $${needed.toFixed(2)} but $${remaining.toFixed(2)} of the run's AI budget is left. Raise the budget and retry; finished steps are kept.`);
      allowance = Math.min(remaining, 100, Math.max(.5, Math.ceil(options.estimateUsd * (options.headroom || 3) * 100) / 100));
    } else {
      allowance = Math.min(100, Math.floor(remaining / Math.max(1, remainingSteps) * 100) / 100);
      if (allowance < .01) throw new Error('Budget is too small for the remaining requests.');
    }
    // Reserve before launch; interrupted/unknown-cost calls keep their reservation.
    run.reservedUsd += allowance; run.message = options.message || key; save();
    try {
      const result = await runAI({ runId: run.id, schema, prompt, maxBudgetUsd: allowance, workspaceDir: path.dirname(file(run.id, 'receipt.json')), outputPath: file(run.id, `${safeId(key)}.raw.json`), ...(options.model ? { model: options.model } : {}), ...(options.effort ? { effort: options.effort } : {}), ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}) });
      const receipt = result.receipt || {};
      if (Number.isFinite(receipt.costUsd) && receipt.costUsd >= 0) { run.reservedUsd += Math.max(0, receipt.costUsd) - allowance; run.costUsd += receipt.costUsd; }
      run.receipts.push({ stage: key, allowanceUsd: allowance, ...receipt }); save(); check(run); return result.output;
    } catch (error) {
      if (Number.isFinite(error?.costUsd) && error.costUsd >= 0) { run.reservedUsd += error.costUsd - allowance; run.costUsd += error.costUsd; run.receipts.push({ stage: key, allowanceUsd: allowance, failed: true, costUsd: error.costUsd, error: safeError(error).slice(0, 300) }); save(); }
      throw error;
    }
  }
  // A call whose structured output fails validation gets one repair attempt with the validation
  // message; a call stopped by its spending cap gets one retry with a larger cap.
  async function aiValidated(run, key, schema, prompt, validate, options = {}) {
    const call = async (callKey, text) => {
      try { return await ai(run, callKey, schema, text, 1, options); }
      catch (error) {
        if (error?.code !== 'CLAUDE_BUDGET_EXCEEDED' || !Number.isFinite(options.estimateUsd)) throw error;
        return ai(run, `${callKey}-retry`, schema, text, 1, { ...options, headroom: (options.headroom || 3) * 3 });
      }
    };
    const raw = await call(key, prompt);
    try { return validate(raw); } catch (error) {
      check(run);
      const repaired = await call(`${key}-repair`, prompt + researchPrompts.repairInstruction(error, raw));
      return validate(repaired);
    }
  }
  async function pool(items, limit, worker) {
    const queue = [...items]; let failure;
    const runners = Array.from({ length: Math.max(1, Math.min(limit, queue.length)) }, async () => {
      while (queue.length && !failure) { const item = queue.shift(); try { await worker(item); } catch (error) { failure ||= error; } }
    });
    await Promise.all(runners); if (failure) throw failure;
  }
  function sourceFromReport(source) {
    if (source.kind !== 'report') return source;
    const asset = owned(state.assets, source.id || source.assetId); const result = assetResult(asset);
    if (!result.output) throw new Error('Choose a written report.');
    const original = read(file(asset.runId, 'input.json')).source;
    if (original.kind === 'research-theme') {
      // A research report already carries its 500-post selection; follow-up content only needs the
      // report text and the posts it cites (the full selection would exceed the content budget).
      const cited = (result.output.evidenceRegister || []).filter(record => record?.id && record.text).slice(0, 120).map(record => ({ id: record.id, text: String(record.text).slice(0, 4000), url: record.url || '', platform: record.platform || '', author: record.author || '', publishedAt: record.publishedAt || '' }));
      return { kind: 'report', id: asset.id, title: asset.title, text: result.markdown, evidence: cited };
    }
    return { kind: 'report', id: asset.id, title: asset.title, text: result.markdown, evidence: content.normalizeSource(original).evidence, aggregateMetrics: original.aggregateMetrics };
  }
  function newContentRun(payload, internalWorkspace) {
    const w = internalWorkspace || workspace(payload.workspaceId); const source = sourceFromReport(payload.source || {});
    if (source.kind === 'research-theme') {
      // Research reports skip the generic content plan: the Golden Thread report builders own
      // their prompts, schemas and validation, and the toolkit is generated from the report.
      const deliverables = ['evidence-report', 'editorial-toolkit'].map(key => content.CONTENT_DELIVERABLES.find(d => d.id === key));
      const docs = w.referenceDocs || [];
      const input = { editionId: w.editionId, source, brandKnowledge: copy(w.knowledge), productRegistry: copy(w.products), referenceDocs: copy(docs), enterpriseProducts: copy(w.enterpriseProducts || (w.editionId === 'semrush' ? SEMRUSH_ENTERPRISE_PRODUCTS : [])), deliverableIds: deliverables.map(d => d.id), research: true };
      const warnings = [...(!w.products?.length ? ['No product registry is loaded, so the toolkit’s Enterprise and self-serve angles will state the gap instead of naming products.'] : []), ...(!docs.some(doc => doc.kind === 'registry') && w.products?.length ? ['The toolkit uses the structured registry; add the registry document for the model’s full tool descriptions.'] : [])];
      const run = { id: id('content'), workspaceId: w.id, type: 'content', title: source.title || 'Research report', sourceAssetId: undefined, researchRunId: payload.researchRunId, themeId: payload.themeId, status: 'queued', stage: 'content', createdAt: stamp(), maxBudgetUsd: budget(payload.maxBudgetUsd ?? 5), reservedUsd: 0, costUsd: 0, receipts: [], warnings, ai: payload.ai || null, jobs: deliverables.map(d => ({ id: d.id, label: w.editionId === 'semrush' && d.id === 'evidence-report' ? 'Comprehensive trends report' : d.id === 'editorial-toolkit' ? 'Editorial toolkit brief' : d.label, kind: 'text', status: 'queued' })) };
      delete run.sourceAssetId;
      write(file(run.id, 'input.json'), input); state.contentRuns.unshift(run); save(); return run;
    }
    const input = { editionId: w.editionId, source, brandKnowledge: copy(w.knowledge), productRegistry: copy(w.products), deliverableIds: payload.deliverableIds, imageVariants: payload.imageVariants };
    const plan = content.buildContentPlan(input); const run = { id: id('content'), workspaceId: w.id, type: 'content', title: source.title || 'Content campaign', ...(source.kind === 'report' && source.id ? { sourceAssetId: source.id } : {}), status: 'queued', stage: 'content', createdAt: stamp(), maxBudgetUsd: budget(payload.maxBudgetUsd ?? 5), reservedUsd: 0, costUsd: 0, receipts: [], warnings: plan.warnings, jobs: plan.deliverables.map(d => ({ id: d.id, label: d.label, kind: d.kind, status: 'queued' })) };
    write(file(run.id, 'input.json'), input); state.contentRuns.unshift(run); save(); return run;
  }
  function saveTextAsset(run, deliverable, output) {
    const asset = { id: id('asset'), workspaceId: run.workspaceId, runId: run.id, deliverableId: deliverable.id, title: output.title, kind: 'text', channel: deliverable.channel, format: deliverable.extension || 'markdown', createdAt: stamp(), reviewStatus: 'draft' };
    write(file(run.id, `${asset.id}.json`), output); fs.writeFileSync(file(run.id, `${asset.id}.md`), content.renderContentExport(output)); fs.writeFileSync(file(run.id, `${asset.id}.html`), content.renderContentExport(output, { format: 'html' })); state.assets.unshift(asset); return asset;
  }
  const knownCost = receipt => Number.isFinite(receipt?.costUsd) && receipt.costUsd >= 0;
  const promptHash = (deliverable, index) => createHash('sha256').update(deliverable.variantPrompts?.[index] || deliverable.prompt || '').digest('hex');
  function variantIndex(value, deliverable) {
    if (!Number.isInteger(value) || value < 0 || value >= deliverable.variants) throw new Error('Image provider returned an invalid variant index.');
    return value;
  }
  function validPng(bytes) {
    return Buffer.isBuffer(bytes) && bytes.length >= 8 && bytes.length <= 50 * 1024 * 1024 && bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a';
  }
  function imageAccounting(run, job) {
    let reserved = 0; let cost = 0;
    for (const call of job.imageCalls || []) {
      const attempts = call.attempts || [];
      const charged = attempts.reduce((sum, attempt) => sum + (knownCost(attempt) ? attempt.costUsd : 0), 0);
      if (call.callbackMode) {
        const committed = attempts.reduce((sum, attempt) => sum + (knownCost(attempt) ? attempt.costUsd : attempt.allowanceUsd), 0);
        reserved += call.status === 'running' ? Math.max(call.allowanceUsd, committed) : committed;
      } else reserved += call.status === 'succeeded' && attempts.length && attempts.every(knownCost) ? charged : Math.max(call.allowanceUsd, charged);
      cost += charged;
      const receipt = { stage: `image-${job.id}`, callId: call.id, allowanceUsd: call.allowanceUsd, status: call.status, attempts: copy(attempts), costUsd: attempts.length && attempts.every(knownCost) ? charged : null };
      const existing = run.receipts.findIndex(row => row.callId === call.id);
      if (existing < 0) run.receipts.push(receipt); else run.receipts[existing] = receipt;
    }
    run.reservedUsd = Math.max(0, run.reservedUsd + reserved - (job.imageReservedUsd || 0));
    run.costUsd = Math.max(0, run.costUsd + cost - (job.imageCostUsd || 0));
    job.imageReservedUsd = reserved; job.imageCostUsd = cost;
  }
  function upsertImageAttempt(call, receipt, deliverable, { dispatch = false } = {}) {
    if (!receipt || typeof receipt !== 'object' || typeof receipt.attemptId !== 'string' || !receipt.attemptId || receipt.attemptId.length > 200) throw new Error('Image provider must identify every paid request.');
    const index = variantIndex(receipt.variantIndex, deliverable);
    const previous = call.attempts.find(row => row.attemptId === receipt.attemptId);
    if (previous && previous.variantIndex !== index) throw new Error('Image request receipt changed its variant.');
    if (!previous && !dispatch) throw new Error('Image completion has no saved dispatch checkpoint.');
    const allowanceUsd = previous?.allowanceUsd ?? receipt.allowanceUsd;
    if (!Number.isFinite(allowanceUsd) || allowanceUsd <= 0 || allowanceUsd > call.allowanceUsd) throw new Error('Image request allowance exceeds its saved budget.');
    if (dispatch && previous) throw new Error('This image request was already dispatched. Retry cannot repeat a paid request.');
    if (dispatch && call.attempts.some(row => row.variantIndex === index)) throw new Error('A variant may be dispatched only once per generation call.');
    if (!previous && call.attempts.reduce((sum, row) => sum + (knownCost(row) ? row.costUsd : row.allowanceUsd), 0) + allowanceUsd > call.allowanceUsd + 1e-8) throw new Error('Image requests exceed the reserved call budget.');
    if (receipt.promptHash && receipt.promptHash !== promptHash(deliverable, index)) throw new Error('Image request does not match the saved variant prompt.');
    const next = { ...previous, ...copy(receipt), variantIndex: index, allowanceUsd, ...(dispatch ? { status: 'dispatched', costUsd: null } : {}) };
    if (!['dispatched', 'succeeded', 'failed', 'unknown'].includes(next.status)) throw new Error('Image provider returned an invalid request status.');
    if (previous) Object.assign(previous, next); else call.attempts.push(next);
    return previous || next;
  }
  function savedImageVariants(run, job, deliverable) {
    const completed = [];
    for (let index = 0; index < deliverable.variants; index++) {
      const manifestPath = file(run.id, `${job.id}.variant-${index}.json`);
      let asset = state.assets.find(row => row.workspaceId === run.workspaceId && row.runId === run.id && row.deliverableId === job.id && row.variantIndex === index);
      if (!asset && fs.existsSync(manifestPath)) {
        const manifest = read(manifestPath); asset = manifest.asset;
        if (!asset || asset.workspaceId !== run.workspaceId || asset.runId !== run.id || asset.deliverableId !== job.id || asset.variantIndex !== index || manifest.promptHash !== promptHash(deliverable, index)) throw new Error('Saved image checkpoint does not match this workspace and variant.');
        safeId(asset.id);
        const bytes = fs.readFileSync(file(run.id, `${asset.id}.png`));
        if (!validPng(bytes) || createHash('sha256').update(bytes).digest('hex') !== manifest.pngHash) throw new Error('A saved image checkpoint is damaged. Restore the original file before retrying.');
        state.assets.unshift(asset);
      }
      if (!asset) continue;
      const bytes = fs.readFileSync(file(run.id, `${safeId(asset.id)}.png`));
      if (!validPng(bytes)) throw new Error('A saved image is damaged. Restore the original file before retrying; it will not be generated again automatically.');
      const call = (job.imageCalls || []).find(row => row.id === asset.imageCallId);
      if (call && asset.receipt?.attemptId) {
        if (call.callbackMode) upsertImageAttempt(call, asset.receipt, deliverable);
        else if (!call.attempts.some(row => row.attemptId === asset.receipt.attemptId)) call.attempts.push(copy(asset.receipt));
      }
      completed.push({ variantIndex: index, title: asset.title, png: bytes, receipt: copy(asset.receipt || {}) });
    }
    job.assetIds = state.assets.filter(row => row.workspaceId === run.workspaceId && row.runId === run.id && row.deliverableId === job.id && Number.isInteger(row.variantIndex)).sort((a, b) => a.variantIndex - b.variantIndex).map(row => row.id);
    if (job.assetIds.length) job.assetId = job.assetIds[0];
    return completed;
  }
  function persistImageVariant(run, job, deliverable, call, generated, fallbackIndex) {
    const index = variantIndex(generated.variantIndex ?? fallbackIndex, deliverable);
    if (!validPng(generated.png)) throw new Error('Image provider did not return a valid bounded PNG for this variant.');
    const existing = state.assets.find(row => row.workspaceId === run.workspaceId && row.runId === run.id && row.deliverableId === job.id && row.variantIndex === index);
    if (existing) {
      if (generated.receipt?.attemptId && existing.receipt?.attemptId !== generated.receipt.attemptId) throw new Error('A saved image variant cannot be overwritten by another paid attempt.');
      return existing;
    }
    let receipt;
    if (call.callbackMode) receipt = upsertImageAttempt(call, { ...generated.receipt, variantIndex: index, status: 'succeeded' }, deliverable);
    else {
      receipt = { ...copy(generated.receipt || {}), attemptId: `${call.id}-variant-${index}`, variantIndex: index, promptHash: promptHash(deliverable, index), status: 'succeeded', allowanceUsd: call.allowanceUsd / deliverable.variants };
      call.attempts.push(receipt);
    }
    const asset = { id: `image-${createHash('sha256').update(`${run.id}:${job.id}:${index}`).digest('hex').slice(0, 32)}`, workspaceId: run.workspaceId, runId: run.id, deliverableId: deliverable.id, variantIndex: index, imageCallId: call.id, title: generated.title || deliverable.label, kind: 'image', channel: deliverable.channel, format: 'png', createdAt: stamp(), receipt: copy(receipt), reviewStatus: 'draft' };
    writeBytes(file(run.id, `${asset.id}.png`), generated.png);
    writeBytes(file(run.id, `${asset.id}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="1024" viewBox="0 0 1536 1024"><title>Embedded raster image — pixels are not editable vectors</title><image width="1536" height="1024" href="data:image/png;base64,${generated.png.toString('base64')}"/></svg>`);
    write(file(run.id, `${job.id}.variant-${index}.json`), { asset, promptHash: promptHash(deliverable, index), pngHash: createHash('sha256').update(generated.png).digest('hex') });
    state.assets.unshift(asset); job.assetIds = [...new Set([...(job.assetIds || []), asset.id])]; job.assetId ||= asset.id;
    imageAccounting(run, job); save(); return asset;
  }
  async function performImages(run, job, deliverable, input) {
    if ((deliverable.variantPrompts || [deliverable.prompt]).some(prompt => typeof prompt !== 'string' || prompt.length > 32000)) throw new Error('Image prompts must be 32,000 characters or fewer. Shorten the source brief or brand context, or generate written outputs separately. No image request was sent.');
    job.imageCalls ||= [];
    const completed = savedImageVariants(run, job, deliverable);
    const completedIndices = new Set(completed.map(image => image.variantIndex));
    for (const call of job.imageCalls) if (call.status === 'running') {
      call.status = 'interrupted';
      for (const receipt of call.attempts) if (receipt.status === 'dispatched') receipt.status = 'unknown';
    }
    if (completed.length === deliverable.variants) {
      for (const call of job.imageCalls) if (!call.callbackMode && call.status === 'interrupted') call.status = 'succeeded';
    }
    imageAccounting(run, job); save();
    if (completed.length === deliverable.variants) return;
    const unresolved = job.imageCalls.some(call => (!call.callbackMode && call.status !== 'succeeded') || call.attempts.some(receipt => !completedIndices.has(receipt.variantIndex) && (['dispatched', 'unknown'].includes(receipt.status) || (receipt.status !== 'succeeded' && !knownCost(receipt)))));
    if (unresolved) throw new Error('An earlier image request may have been billed but has no saved result. Automatic repeat is blocked. Check the provider request receipts and billing before starting a new run; increasing this run budget does not resolve an unknown request.');
    if (!generateImage || !publicState().capabilities.imagesConfigured) throw new Error('Connect the image provider in Settings to generate this image. Written outputs can complete independently.');
    const allowance = Math.floor((run.maxBudgetUsd - run.reservedUsd) / Math.max(1, run.jobs.filter(row => row.status !== 'succeeded').length) * 100) / 100;
    if (allowance < .01) throw new Error('Image budget exhausted. Increase the total budget before retrying.');
    const call = { id: id('image-call'), status: 'running', allowanceUsd: allowance, callbackMode: false, attempts: [], startedAt: stamp() };
    job.imageCalls.push(call); imageAccounting(run, job); save();
    let failure;
    try {
      const images = await generateImage({ deliverable, runId: run.id, input, maxBudgetUsd: allowance, isCancelled: () => stopped.has(run.id), completedVariants: completed,
        onRequest: async receipt => {
          check(run);
          if (completedIndices.has(receipt?.variantIndex)) throw new Error('This image variant is already saved and must not be generated again.');
          upsertImageAttempt(call, receipt, deliverable, { dispatch: true }); call.callbackMode = true; imageAccounting(run, job); save();
        },
        // Persist a completed paid result even if cancellation arrived while the provider was responding.
        onVariant: async image => { persistImageVariant(run, job, deliverable, call, image); },
      });
      if (!Array.isArray(images)) throw new Error('Image provider did not return its completed PNG variants.');
      for (const [index, image] of images.entries()) persistImageVariant(run, job, deliverable, call, image, index);
      if ((job.assetIds || []).length !== deliverable.variants) throw new Error('Image provider did not complete all requested PNG variants. Completed images are saved.');
      call.status = 'succeeded';
    } catch (error) {
      failure = error;
      for (const receipt of error.attemptReceipts || []) {
        try {
          if (!call.attempts.some(row => row.attemptId === receipt.attemptId) && receipt.status === 'failed' && receipt.billable === false && receipt.costUsd === 0) {
            upsertImageAttempt(call, receipt, deliverable, { dispatch: true }); call.callbackMode = true;
          }
          upsertImageAttempt(call, receipt, deliverable);
        } catch (receiptError) { failure = new Error(`${safeError(error)} Receipt problem: ${safeError(receiptError)}`); }
      }
      for (const [index, image] of (error.partialImages || []).entries()) {
        try { persistImageVariant(run, job, deliverable, call, image, image.variantIndex ?? index); } catch (imageError) { failure = new Error(`${safeError(error)} Image checkpoint problem: ${safeError(imageError)}`); }
      }
      if (error.beforeDispatch === true && call.attempts.length === 0) call.callbackMode = true;
      call.status = stopped.has(run.id) ? 'cancelled' : 'failed';
      for (const receipt of call.attempts) if (receipt.status === 'dispatched') receipt.status = 'unknown';
    }
    imageAccounting(run, job); save();
    if (failure) throw failure;
  }
  async function performContent(run) {
    const input = read(file(run.id, 'input.json'));
    if (input.research) return performResearchReports(run, input);
    const plan = content.buildContentPlan(input);
    for (const job of run.jobs) {
      if (job.status === 'succeeded') continue; check(run); job.status = 'running'; delete job.error; save();
      const deliverable = plan.deliverables.find(d => d.id === job.id);
      try {
        if (deliverable.kind === 'image') {
          await performImages(run, job, deliverable, input);
        } else {
          const raw = await ai(run, `output-${job.id}`, deliverable.schema, deliverable.prompt, run.jobs.filter(j => j.status !== 'succeeded' && j.kind !== 'image').length);
          const output = content.validateContentOutput(raw, { deliverable, source: input.source, productRegistry: input.productRegistry, editionId: input.editionId });
          job.assetId = saveTextAsset(run, deliverable, output).id;
        }
        job.status = 'succeeded';
      } catch (error) { job.status = stopped.has(run.id) ? 'cancelled' : job.assetIds?.length ? 'partial' : 'failed'; job.error = safeError(error); }
      save(); check(run);
    }
    run.status = run.jobs.every(j => j.status === 'succeeded') ? 'succeeded' : run.jobs.some(j => j.status === 'succeeded' || j.assetIds?.length) ? 'partial' : 'failed';
    run.message = run.status === 'succeeded' ? 'Drafts ready to review and export.' : 'Some outputs need attention. Completed assets are saved.';
  }
  // ---------- Research pipeline (n8n Golden Thread phases 2–5) ----------
  const STAGE_OUTPUT_TOKENS = { discovery: 3500, synthesis: 6000, matching: 2500, report: 8000, toolkit: 5000 };
  function stageAi(run, stage) {
    const ai = run.ai || read(file(run.id, 'input.json')).program?.ai || research.DEFAULT_RESEARCH_AI;
    return { model: ai.models?.[stage] || research.DEFAULT_RESEARCH_AI.models[stage], effort: ai.effort?.[stage] || research.DEFAULT_RESEARCH_AI.effort[stage], concurrency: ai.concurrency || research.DEFAULT_RESEARCH_AI.concurrency };
  }
  const estimateCall = ({ model, effort }, prompt, outputTokens) => research.callCost(model, effort, research.estimateTokens(prompt.length), outputTokens);
  function editionFor(run) {
    const w = state.workspaces.find(row => row.id === run.workspaceId) || {};
    return { editionId: w.editionId || 'general', brandName: w.knowledge?.name || w.name || '', workspace: w };
  }
  function activeRepository(workspaceId) {
    return state.themes.filter(theme => theme.workspaceId === workspaceId && theme.status !== 'archived').sort((a, b) => String(b.lastDetectedAt || b.updatedAt || '').localeCompare(String(a.lastDetectedAt || a.updatedAt || ''))).slice(0, 150);
  }
  function detectionCount(workspaceId, themeId, runId) {
    return new Set((state.detections || []).filter(entry => entry.workspaceId === workspaceId && entry.themeId === themeId && entry.runId !== runId).map(entry => entry.runId)).size + 1;
  }
  // Runs started before a program field existed still get every default (n8n batch sizes, models…).
  const runProgram = input => ({ ...research.validateResearchProgram(input.program), workspaceId: input.program.workspaceId });
  const withRaw = (items, rawItems) => (Array.isArray(rawItems) && rawItems.length === items.length ? items.map((item, index) => (item.raw || !rawItems[index] ? item : { ...item, raw: rawItems[index] })) : items);
  async function performDiscovery(run) {
    const input = read(file(run.id, 'input.json')); const program = runProgram(input);
    let evidence;
    if (fs.existsSync(file(run.id, 'evidence.json'))) evidence = read(file(run.id, 'evidence.json'));
    else {
      let all = [];
      if (input.datasetIds.length) for (const datasetId of input.datasetIds) { check(run); const result = await readDataset(datasetId); all.push(...withRaw(result.items || [], result.rawItems).map(item => ({ ...item, datasetId }))); }
      else {
        if (!collect) throw new Error('Source collection is unavailable on this host. Import a dataset first.');
        run.stage = 'collecting'; save(); const collection = await collect({ program, workspaceId: run.workspaceId, runId: run.id, isCancelled: () => stopped.has(run.id), onProgress: message => { run.message = message; save(); } });
        all = collection.items; run.collectionReceipt = collection.receipt; for (const datasetId of collection.datasetIds || []) state.datasetOwners[datasetId] = run.workspaceId;
        run.warnings = [...new Set([...(run.warnings || []), ...(collection.receipt?.warnings || []).filter(warning => !/^Planned counts/.test(warning))])];
        // Raw provider rows carry the fields the n8n tabs show (handles, titles, subreddits).
        if (collection.datasetIds?.length) { const rawById = new Map(); for (const datasetId of collection.datasetIds) { try { const stored = await readDataset(datasetId); for (const item of withRaw(stored.items || [], stored.rawItems)) if (item.raw) rawById.set(item.id, item.raw); } catch (_) { /* Normalized rows remain usable. */ } } all = all.map(item => (rawById.has(item.id) && !item.raw ? { ...item, raw: rawById.get(item.id) } : item)); }
      }
      evidence = research.prepareResearchEvidence({ runId: run.id, program, items: all }); write(file(run.id, 'evidence.json'), evidence); run.coverage = evidence.receipt;
    }
    const discovery = research.buildDiscoveryBatches({ runId: run.id, items: evidence.items, batchSize: program.discoveryBatchSize });
    const tagging = research.buildAssignmentBatches({ runId: run.id, items: evidence.items, batchSize: program.taggingBatchSize, batchSizes: program.taggingBatchSizes });
    run.counts = { retained: evidence.items.length, discoveryEligible: discovery.receipt.eligibleCount, taggingEligible: tagging.receipt.eligibleCount, platforms: evidence.receipt.platformCounts };
    if (!discovery.batches.length) throw new Error('No evidence met the discovery engagement thresholds. Widen the date window or lower the thresholds and start a new run.');
    const edition = editionFor(run); const settings = stageAi(run, 'discovery');
    run.stage = 'discovery'; run.discoveryProgress = { completed: 0, total: discovery.batches.length }; save();
    const byBatch = new Map();
    // Lanes run per platform (X → LinkedIn → Reddit), 200 posts per batch, several batches at once.
    await pool(discovery.batches, settings.concurrency, async batch => {
      check(run); const cache = file(run.id, `${batch.id}.validated.json`); let result;
      if (fs.existsSync(cache)) result = read(cache);
      else {
        const prompt = researchPrompts.discoveryPrompt({ batch, query: program.query, ...edition });
        result = await aiValidated(run, batch.id, research.DISCOVERY_SCHEMA, prompt, raw => research.validateCandidates(raw, { runId: run.id, batch }), { ...settings, estimateUsd: estimateCall(settings, prompt, STAGE_OUTPUT_TOKENS.discovery), message: `Discovering trends · ${research.PLATFORM_LABELS[batch.platform]} batch ${batch.platformBatchNumber}` });
        write(cache, { ...result, platform: batch.platform, batchNumber: batch.platformBatchNumber, itemsProcessed: batch.items.length, completedAt: stamp() });
      }
      byBatch.set(batch.id, result.candidates); run.discoveryProgress.completed++; save();
    });
    const candidates = discovery.batches.flatMap(batch => byBatch.get(batch.id) || []);
    const merged = research.mergeCandidates(candidates);
    run.candidateCount = { raw: candidates.length, merged: merged.length };
    if (!merged.length) { run.themes = []; run.discoveredThemes = []; run.stage = 'theme-review'; run.status = 'succeeded'; run.message = 'Discovery found no specific, evidence-backed trends in this window.'; save(); return; }
    const w = edition.workspace; const taxonomy = w.taxonomy || null;
    const synthesisCache = file(run.id, 'theme-synthesis.validated.json'); let synthesized;
    if (fs.existsSync(synthesisCache)) synthesized = read(synthesisCache);
    else {
      const synthesisSettings = stageAi(run, 'synthesis');
      const sources = Object.fromEntries(Object.entries(discovery.receipt.perPlatform).map(([p]) => [research.PLATFORM_LABELS[p], discovery.batches.filter(b => b.platform === p).reduce((sum, b) => sum + b.items.length, 0)]));
      const prompt = researchPrompts.synthesisPrompt({ candidates: merged, totalPosts: discovery.receipt.plannedCount, sources, maxThemes: program.maxThemes, taxonomy, query: program.query, ...edition });
      if (prompt.length > 2500000) throw new Error('Theme synthesis exceeds the context budget. Use a shorter window or fewer sources; every completed discovery batch is saved.');
      run.stage = 'synthesis'; save();
      synthesized = await aiValidated(run, 'theme-synthesis', { ...research.THEMES_SCHEMA, properties: { themes: { ...research.THEMES_SCHEMA.properties.themes, maxItems: program.maxThemes } } }, prompt, raw => research.validateThemes(raw, { runId: run.id, candidates: merged, maxThemes: program.maxThemes, taxonomy }), { ...synthesisSettings, estimateUsd: estimateCall(synthesisSettings, prompt, STAGE_OUTPUT_TOKENS.synthesis), message: 'Synthesizing the top themes' });
      write(synthesisCache, synthesized);
    }
    let themes = synthesized.themes;
    // n8n "Match Themes": compare against the active repository; a match keeps the tracked theme's
    // stable ID (so velocity accrues) and the cleaner of the two names.
    const existing = activeRepository(run.workspaceId);
    if (existing.length && themes.length) {
      const matchingCache = file(run.id, 'theme-matching.validated.json'); let matching;
      if (fs.existsSync(matchingCache)) matching = read(matchingCache);
      else {
        const matchingSettings = stageAi(run, 'matching');
        const prompt = researchPrompts.matchingPrompt({ themes, existing, ...edition });
        run.stage = 'matching'; save();
        matching = await aiValidated(run, 'theme-matching', research.MATCHING_SCHEMA, prompt, raw => research.validateThemeMatches(raw, { themes, existing }), { ...matchingSettings, estimateUsd: estimateCall(matchingSettings, prompt, STAGE_OUTPUT_TOKENS.matching), message: 'Matching themes against the repository' });
        write(matchingCache, matching);
      }
      const byTheme = new Map(matching.matches.map(match => [match.themeId, match])); const names = new Set();
      themes = themes.map(theme => {
        const match = byTheme.get(theme.id); const previous = match?.matchedExistingId ? existing.find(row => row.id === match.matchedExistingId) : null;
        let name = match?.finalName || theme.name; if (names.has(name.toLowerCase())) name = theme.name; names.add(name.toLowerCase());
        return { ...theme, id: previous ? previous.id : theme.id, name, aliases: [...new Set([...(previous?.aliases || []), ...(previous && previous.name !== name ? [previous.name] : []), ...(theme.name !== name ? [theme.name] : [])])].slice(-50), match: { matched: !!previous, existingThemeId: previous?.id || null, existingName: previous?.name || '', nameSource: match?.nameSource || 'new', reason: match?.reason || '' } };
      });
    } else themes = themes.map(theme => ({ ...theme, match: { matched: false, existingThemeId: null, existingName: '', nameSource: 'new', reason: existing.length ? '' : 'No tracked themes yet.' } }));
    // n8n "Calculate Trend Velocity": count, velocity tier, taxonomy cross-reference, priority tier.
    themes = themes.map(theme => ({ ...theme, scoring: intel.scoreTheme({ theme, detectionCount: detectionCount(run.workspaceId, theme.id, run.id), taxonomy }) }));
    recordDetections(run, themes);
    run.themes = themes; run.discoveredThemes = copy(themes); run.decisions = {}; run.stage = 'theme-review';
    if (program.autoApproveThemes) {
      run.decisions = Object.fromEntries(themes.map(theme => [theme.id, 'approved'])); run.approvedAt = stamp(); run.autoApproved = true; run.message = 'Themes approved automatically; tagging every post.'; save();
      return performClassification(run);
    }
    run.status = 'awaiting-review'; run.message = 'Review and approve themes before classifying evidence and generating reports.'; save();
  }
  function recordDetections(run, themes) {
    const now = stamp();
    state.detections = (state.detections || []).filter(entry => entry.runId !== run.id);
    for (const theme of themes) {
      state.detections.push({ workspaceId: run.workspaceId, themeId: theme.id, runId: run.id, name: theme.name, detectedAt: now });
      const previous = state.themes.find(row => row.workspaceId === run.workspaceId && row.id === theme.id);
      const { candidateIds: _c, evidenceIds: _e, runId: _r, ...fields } = theme;
      const entry = { ...(previous || {}), ...fields, workspaceId: run.workspaceId, status: previous?.status === 'archived' ? 'active' : previous?.status || 'active', firstDetectedAt: previous?.firstDetectedAt || now, lastDetectedAt: now, detectionCount: theme.scoring.count, lastRunId: run.id, evidenceCount: theme.evidenceCount, updatedAt: now };
      state.themes = state.themes.filter(row => !(row.workspaceId === run.workspaceId && row.id === theme.id)); state.themes.push(entry);
    }
  }
  async function classifyBatch(run, program, batch, settings, edition) {
    const cache = file(run.id, `${batch.id}.validated.json`);
    if (fs.existsSync(cache)) return read(cache);
    const validate = target => raw => research.validateAssignments(raw, { runId: run.id, batch: target, themes: run.themes, confidenceThreshold: program.confidenceThreshold, autoAcceptThreshold: program.autoAcceptThreshold });
    const prompt = researchPrompts.taggingPrompt({ batch, themes: run.themes, ...edition });
    const label = `Tagging posts · ${research.PLATFORM_LABELS[batch.platform]} batch ${batch.platformBatchNumber}`;
    let result = await aiValidated(run, batch.id, research.ASSIGNMENTS_SCHEMA, prompt, validate(batch), { ...settings, estimateUsd: estimateCall(settings, prompt, batch.items.length * 110), message: label });
    let assignments = result.assignments; let missing = result.missingIds;
    if (missing.length) {
      // One focused retry for posts the model skipped; anything still missing is recorded as unclassified.
      const subset = { ...batch, id: `${batch.id}-missing`, items: batch.items.filter(item => missing.includes(item.id)), evidenceIds: missing };
      const retryPrompt = researchPrompts.taggingPrompt({ batch: subset, themes: run.themes, ...edition });
      const retry = await aiValidated(run, subset.id, research.ASSIGNMENTS_SCHEMA, retryPrompt, validate(subset), { ...settings, estimateUsd: estimateCall(settings, retryPrompt, subset.items.length * 110), message: `${label} (retrying ${missing.length} skipped posts)` });
      assignments = [...assignments, ...retry.assignments.map(row => ({ ...row, batchId: batch.id }))]; missing = retry.missingIds;
      if (missing.length) { assignments.push(...research.unclassifiedAssignments({ runId: run.id, batch, itemIds: missing })); run.warnings = [...new Set([...(run.warnings || []), `${missing.length} posts in ${research.PLATFORM_LABELS[batch.platform]} batch ${batch.platformBatchNumber} were not returned by the classifier and are marked unclassified.`])]; }
    }
    result = { assignments, missingIds: [], unclassifiedIds: missing, platform: batch.platform, batchNumber: batch.platformBatchNumber, completedAt: stamp() };
    write(cache, result); return result;
  }
  async function performClassification(run) {
    const program = runProgram(read(file(run.id, 'input.json'))); const evidence = read(file(run.id, 'evidence.json'));
    const { batches } = research.buildAssignmentBatches({ runId: run.id, items: evidence.items, batchSize: program.taggingBatchSize, batchSizes: program.taggingBatchSizes });
    const edition = editionFor(run); const settings = stageAi(run, 'tagging');
    run.stage = 'classification'; run.assignmentProgress = { completed: 0, total: batches.length }; save();
    const byBatch = new Map();
    await pool(batches, settings.concurrency, async batch => { check(run); byBatch.set(batch.id, (await classifyBatch(run, program, batch, settings, edition)).assignments); run.assignmentProgress.completed++; save(); });
    let assignments = []; for (const batch of batches) assignments = research.applyAssignments(assignments, byBatch.get(batch.id) || []);
    write(file(run.id, 'assignments.json'), assignments); run.stage = 'reports';
    const w = workspace(run.workspaceId, false); run.reportRunIds ||= [];
    const reportSettings = stageAi(run, 'reports');
    const period = run.window?.startDate ? { startDate: run.window.startDate, endDate: run.window.endDate || run.createdAt.slice(0, 10) } : program.window?.startDate && program.window?.endDate ? program.window : { startDate: run.createdAt.slice(0, 10), endDate: run.createdAt.slice(0, 10) };
    const cohortKey = createHash('sha256').update(JSON.stringify({ sources: program.sourceGroups, thresholds: program.thresholds, cap: program.perAuthorCap, target: program.targetPerPlatform, max: program.maxEvidenceItems, confidence: program.confidenceThreshold, includeUndated: program.includeUndated })).digest('hex');
    for (const theme of run.themes) {
      check(run); const existingReport = run.reportRunIds.find(entry => entry.themeId === theme.id);
      const history = research.calculateThemeHistory({ theme, runId: run.id, period, items: evidence.items, assignments, previousSnapshots: state.history.filter(h => h.workspaceId === run.workspaceId), cohortKey, complete: !!period.startDate && !!period.endDate });
      state.history = state.history.filter(h => !(h.runId === run.id && h.themeId === theme.id)); state.history.push({ ...history.snapshot, workspaceId: run.workspaceId });
      const repo = state.themes.find(t => t.workspaceId === run.workspaceId && t.id === theme.id);
      if (repo) Object.assign(repo, { history, approvedRunId: run.id, updatedAt: stamp() }); else state.themes.push({ ...theme, workspaceId: run.workspaceId, status: 'active', history, updatedAt: stamp() });
      if (existingReport) { const child = state.contentRuns.find(row => row.id === existingReport.runId); if (child && child.status !== 'succeeded') { const unused = Math.max(0, run.maxBudgetUsd - run.reservedUsd); const remainingChildren = run.reportRunIds.filter(entry => state.contentRuns.find(r => r.id === entry.runId)?.status !== 'succeeded').length; const extra = Math.floor(unused / Math.max(1, remainingChildren) * 100) / 100; child.maxBudgetUsd += extra; run.reservedUsd += extra; save(); await launchAndWait(child, () => performContent(child)); } check(run); continue; }
      const selection = reports().selectThemeEvidence({ theme, items: evidence.items, assignments, maxPosts: 500 });
      if (!selection.coverage.matchedCount) { run.warnings = [...new Set([...(run.warnings || []), `No posts were tagged to “${theme.name}”, so its reports were skipped.`])]; continue; }
      const payload = { theme: { id: theme.id, name: theme.name, description: theme.description, matchingKeywords: theme.matchingKeywords, matchingCriteria: theme.matchingCriteria, negativeCriteria: theme.negativeCriteria, novelty: theme.novelty, taxonomyCategory: theme.taxonomyCategory }, selection, brandName: w.editionId === 'semrush' ? 'Semrush' : (w.knowledge?.name || w.name), analysisFocus: w.editionId === 'semrush' ? 'SEO Trends' : (program.query || w.knowledge?.audience || ''), targetAudience: w.editionId === 'semrush' ? 'SEO Professionals' : (w.knowledge?.audience || '') };
      const source = { kind: 'research-theme', id: `${run.id}-${theme.id}`, title: theme.name, text: `${theme.name}: ${theme.description}`, evidence: selection.posts.map(post => ({ id: post.id, text: post.text, url: post.url, platform: post.platform, author: post.author, publishedAt: post.date || post.publishedAt || '' })), research: payload };
      const remainingThemes = run.themes.length - run.reportRunIds.length;
      const estimate = reportEstimate(reportSettings, selection);
      const allocation = Math.floor(Math.min(run.maxBudgetUsd - run.reservedUsd, Math.max(estimate * 2.5, (run.maxBudgetUsd - run.reservedUsd) / remainingThemes)) * 100) / 100;
      if (allocation < Math.min(estimate, 1)) throw new Error(`Not enough AI budget remains for the paired reports (about $${estimate.toFixed(2)} each). Increase the run budget before retrying.`);
      const reportRun = newContentRun({ source, maxBudgetUsd: allocation, researchRunId: run.id, themeId: theme.id, ai: { model: reportSettings.model, effort: reportSettings.effort } }, w);
      run.reportRunIds.push({ themeId: theme.id, runId: reportRun.id }); run.reservedUsd += allocation; save(); await launchAndWait(reportRun, () => performContent(reportRun)); check(run);
      // Unused report budget returns to the research run.
      run.reservedUsd -= Math.max(0, allocation - reportRun.reservedUsd); save();
    }
    run.status = run.reportRunIds.length && run.reportRunIds.every(entry => state.contentRuns.find(r => r.id === entry.runId)?.status === 'succeeded') ? 'succeeded' : run.reportRunIds.length ? 'partial' : 'succeeded'; run.message = 'Classification complete. Review the paired reports and any outputs needing attention.';
    if (program.delivery?.publishToDrive && publishCampaign && run.reportRunIds.length) {
      try { await publishRun(run); run.message = 'Reports are ready and published to Google Drive.'; }
      catch (error) { run.warnings = [...new Set([...(run.warnings || []), `Google Drive publishing needs attention: ${safeError(error)}`])]; }
    }
  }
  function reportEstimate(settings, selection) {
    const characters = (selection.posts || []).reduce((sum, post) => sum + String(post.text || '').length + 260, 0) + 12000;
    return research.callCost(settings.model, settings.effort, research.estimateTokens(characters), STAGE_OUTPUT_TOKENS.report) + research.callCost(settings.model, settings.effort, 38000, STAGE_OUTPUT_TOKENS.toolkit);
  }
  async function performResearchReports(run, input) {
    const settings = { model: run.ai?.model || research.DEFAULT_RESEARCH_AI.models.reports, effort: run.ai?.effort || research.DEFAULT_RESEARCH_AI.effort.reports };
    const { research: payload } = input.source; const lib = reports();
    for (const job of run.jobs) {
      if (job.status === 'succeeded') continue; check(run); job.status = 'running'; delete job.error; save();
      const deliverable = content.CONTENT_DELIVERABLES.find(d => d.id === job.id);
      try {
        let output;
        if (job.id === 'evidence-report') {
          const request = lib.buildTrendReportRequest({ theme: payload.theme, selection: payload.selection, editionId: input.editionId, brandName: payload.brandName, analysisFocus: payload.analysisFocus, targetAudience: payload.targetAudience });
          output = await aiValidated(run, `output-${job.id}`, request.schema, request.prompt, raw => lib.validateTrendReport(raw, request.context), { ...settings, estimateUsd: estimateCall(settings, request.prompt, STAGE_OUTPUT_TOKENS.report), message: `Writing the trends report · ${payload.theme.name}`, timeoutMs: 2400000 });
        } else {
          const reportJob = run.jobs.find(entry => entry.id === 'evidence-report');
          if (reportJob?.status !== 'succeeded' || !reportJob.assetId) throw new Error('The editorial toolkit is built from the trends report. Generate the report first.');
          const trendReport = read(file(run.id, `${reportJob.assetId}.json`));
          const registryDoc = (input.referenceDocs || []).find(doc => doc.kind === 'registry');
          const request = lib.buildToolkitRequest({ theme: payload.theme, trendReport, trendReportMarkdown: content.renderContentExport(trendReport), metrics: payload.selection.metrics, registryText: registryDoc?.text || '', products: input.productRegistry || [], referenceDocs: (input.referenceDocs || []).filter(doc => doc.kind !== 'registry'), enterpriseProducts: input.enterpriseProducts || [], editionId: input.editionId, brandName: payload.brandName });
          output = await aiValidated(run, `output-${job.id}`, request.schema, request.prompt, raw => lib.validateToolkit(raw, request.context).output, { ...settings, estimateUsd: estimateCall(settings, request.prompt, STAGE_OUTPUT_TOKENS.toolkit), message: `Writing the editorial toolkit · ${payload.theme.name}`, timeoutMs: 2400000 });
        }
        job.assetId = saveTextAsset(run, deliverable, output).id; job.status = 'succeeded';
      } catch (error) { job.status = stopped.has(run.id) ? 'cancelled' : 'failed'; job.error = safeError(error); }
      save(); check(run);
    }
    run.status = run.jobs.every(j => j.status === 'succeeded') ? 'succeeded' : run.jobs.some(j => j.status === 'succeeded') ? 'partial' : 'failed';
    run.message = run.status === 'succeeded' ? 'Trends report and editorial toolkit ready to review.' : 'Some outputs need attention. Completed reports are saved.';
  }
  // n8n names: trend report "Priority_Trends_<Theme>_<yyyy-MM-dd_HH-mm>", toolkit "<Theme>__<yyyy-MM-dd_HH-mm>".
  function docStamp(value) { const date = new Date(value); const pad = number => String(number).padStart(2, '0'); return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}_${pad(date.getUTCHours())}-${pad(date.getUTCMinutes())}`; }
  function deliveryAsset(asset, html) {
    const theme = asset.deliverableId === 'evidence-report' || asset.deliverableId === 'editorial-toolkit' ? (read(file(asset.runId, `${asset.id}.json`)).theme?.name || asset.title.replace(/^TREND:\s*/i, '').replace(/\s+—\s+Comprehensive Trends Report$/, '')) : '';
    const docName = asset.deliverableId === 'evidence-report' && theme ? `Priority_Trends_${theme}_${docStamp(asset.createdAt)}` : asset.deliverableId === 'editorial-toolkit' && theme ? `${theme}__${docStamp(asset.createdAt)}` : undefined;
    return { id: asset.id, title: asset.title, channel: asset.channel, kind: asset.kind, deliverableId: asset.deliverableId, ...(docName ? { docName } : {}),
      ...(asset.kind === 'image' ? { png: fs.readFileSync(file(asset.runId, `${asset.id}.png`)), svg: fs.readFileSync(file(asset.runId, `${asset.id}.svg`), 'utf8') } : { html: html ?? fs.readFileSync(file(asset.runId, `${asset.id}.html`), 'utf8') }) };
  }
  async function publishRun(run) {
    if (publishing.has(run.id)) throw new Error('This run is already being delivered to Google Drive.');
    const ids = new Set([run.id, ...(run.reportRunIds || []).map(entry => entry.runId)]);
    const assets = state.assets.filter(asset => asset.workspaceId === run.workspaceId && ids.has(asset.runId));
    if (!assets.length) throw new Error('Generate at least one asset before publishing.');
    publishing.add(run.id);
    const deliver = async list => { const receipt = await publishCampaign({ campaignId: run.id, title: run.title, previousReceipt: run.googleDelivery, assets: list, onProgress: async update => { run.googleDelivery = copy(update.receipt); run.deliveryMessage = update.phase; save(); } }); run.googleDelivery = copy(receipt); save(); return receipt; };
    try {
      // Trend reports first, so each toolkit's "Full evidence" line can link its report doc (n8n order).
      const toolkits = assets.filter(asset => asset.deliverableId === 'editorial-toolkit');
      let receipt = await deliver(assets.filter(asset => asset.deliverableId !== 'editorial-toolkit').map(asset => deliveryAsset(asset)));
      if (toolkits.length) {
        const docUrl = assetId => receipt.assets?.find(entry => entry.assetId === assetId)?.files?.find(f => /docs\.google\.com/.test(f.url || ''))?.url || '';
        receipt = await deliver(toolkits.map(asset => {
          const sibling = state.assets.find(row => row.runId === asset.runId && row.deliverableId === 'evidence-report');
          const url = sibling ? docUrl(sibling.id) : ''; const output = read(file(asset.runId, `${asset.id}.json`));
          return deliveryAsset(asset, url ? content.renderContentExport({ ...output, trendsDocUrl: url }, { format: 'html' }) : undefined);
        }));
      }
      run.deliveryMessage = receipt.status; save(); return receipt;
    } catch (error) { run.deliveryMessage = safeError(error); save(); throw error; }
    finally { publishing.delete(run.id); }
  }
  async function launchAndWait(run, fn) { launch(run, fn); await active.get(run.id); }
  function startResearchRun(program, datasetIds = [], scheduledFor = '') {
    const snapshot = copy(program);
    const recurring = program.schedule && program.schedule.frequency !== 'manual';
    // A saved window wins; schedules search their rolling window; otherwise the n8n default:
    // the last `lookbackDays` (7) up to now.
    const window = recurring ? { ...researchScheduleWindow(program.schedule, scheduledFor || stamp()), resolvedFrom: 'schedule' } : research.resolveResearchWindow(research.validateResearchProgram(program), clock());
    snapshot.window = { startDate: window.startDate, endDate: window.endDate || '' };
    const validated = research.validateResearchProgram(snapshot);
    const estimate = research.estimateResearchCost(validated);
    // Before review only discovery → matching is spent; unattended runs need the whole estimate.
    const beforeReview = Math.round((estimate.stages.discovery + estimate.stages.synthesis + estimate.stages.matching) * 100) / 100;
    const required = validated.autoApproveThemes ? estimate.totalUsd : beforeReview;
    if (!datasetIds.length && required > 0 && validated.budgets.aiUsd < required * 0.5) throw new Error(`This program’s AI budget ($${validated.budgets.aiUsd.toFixed(2)}) is far below the estimated $${required.toFixed(2)} ${validated.autoApproveThemes ? 'for a full unattended run' : 'to discover themes'} from about ${estimate.posts.total.toLocaleString('en-US')} posts with the selected models. Raise the AI budget or choose lighter models, then start again.`);
    const warnings = validated.budgets.aiUsd < estimate.totalUsd ? [`The AI budget ($${validated.budgets.aiUsd.toFixed(2)}) is below the estimate of $${estimate.totalUsd.toFixed(2)}; the run stops when it is used up and can resume with a higher budget.`] : [];
    const run = { id: id('research'), workspaceId: program.workspaceId, type: 'research', title: program.name, programId: program.id, status: 'queued', stage: 'collecting', createdAt: stamp(), maxBudgetUsd: program.budgets.aiUsd, reservedUsd: 0, costUsd: 0, receipts: [], themes: [], window, ai: copy(validated.ai), estimate, warnings, ...(scheduledFor ? { scheduledFor } : {}) };
    write(file(run.id, 'input.json'), { program: { ...validated, workspaceId: program.workspaceId }, datasetIds: [...new Set(datasetIds)] });
    if (scheduledFor) {
      // The occurrence and the queued run are committed together before launch can
      // reach a provider. A restart never silently replays an interrupted claim.
      Object.assign(program.schedule, { lastRunAt: stamp(), lastScheduledFor: scheduledFor, lastRunId: run.id, lastStatus: 'queued', lastError: '', skippedAt: '', skippedReason: '' });
    }
    state.researchRuns.unshift(run);
    return launch(run, () => performDiscovery(run));
  }
  function checkDueResearchSchedules() {
    const now = stamp(); const results = [];
    for (const program of state.programs) {
      const schedule = program.schedule;
      if (!schedule?.enabled || schedule.frequency === 'manual' || !schedule.nextRunAt || Date.parse(schedule.nextRunAt) > Date.parse(now)) continue;
      try {
        const validated = research.validateResearchProgram(program);
        if (!Number.isFinite(Date.parse(schedule.nextRunAt))) throw new Error('The saved schedule is invalid. Save it again to resume.');
        // Resume with only the latest due occurrence after sleep, giving it a fresh
        // rolling window. Older missed occurrences are not replayed.
        const scheduledFor = latestResearchScheduleAt(validated.schedule, { at: now });
        const nextRunAt = nextResearchScheduleAt(validated.schedule, { from: now });
        const pending = state.researchRuns.find(run => run.programId === program.id && run.workspaceId === program.workspaceId && (active.has(run.id) || ['queued', 'running', 'awaiting-review'].includes(run.status)));
        if (pending) {
          Object.assign(schedule, { nextRunAt, skippedAt: now, skippedReason: pending.status === 'awaiting-review' ? 'The previous run is waiting for theme review.' : 'The previous run is still active.' });
          save(); results.push({ programId: program.id, status: 'skipped', runId: pending.id }); continue;
        }
        schedule.nextRunAt = nextRunAt;
        const run = startResearchRun(program, [], scheduledFor);
        results.push({ programId: program.id, status: 'started', runId: run.id });
      } catch (error) {
        Object.assign(schedule, { enabled: false, nextRunAt: '', lastStatus: 'failed', lastError: safeError(error) }); save();
        results.push({ programId: program.id, status: 'paused', error: schedule.lastError });
      }
    }
    return results;
  }
  function stopResearchScheduler() { clearInterval(researchScheduleTimer); researchScheduleTimer = undefined; }
  function startResearchScheduler() {
    stopResearchScheduler();
    const tick = () => {
      try { return checkDueResearchSchedules(); }
      catch (error) { stopResearchScheduler(); console.error('Research scheduler stopped:', safeError(error)); return [{ status: 'stopped', error: safeError(error) }]; }
    };
    researchScheduleTimer = setInterval(tick, 30000);
    researchScheduleTimer.unref?.();
    return tick();
  }
  const api = {
    publicState, recoverInterrupted, checkDueResearchSchedules, startResearchScheduler, stopResearchScheduler,
    contentCatalog: () => ({ editions: copy(content.CONTENT_EDITIONS), deliverables: copy(content.CONTENT_DELIVERABLES) }),
    selectContentWorkspace(workspaceId) { workspace(workspaceId, false); state.activeWorkspaceId = workspaceId; save(); return publicState(); },
    saveContentWorkspace(payload) {
      const existing = payload.id ? workspace(payload.id) : null; const editionId = existing?.editionId || payload.editionId || 'general';
      const w = { id: existing?.id || id('workspace'), name: String(payload.name || '').trim().slice(0, 160), editionId, knowledge: content.validateBrandKnowledge(payload.knowledge || {}, { editionId }), products: content.validateProductRegistry(payload.products || [], { editionId }), ...(editionId === 'semrush' ? { brandDefaults: copy(content.SEMRUSH_BRAND_2026) } : {}), createdAt: existing?.createdAt || stamp(), updatedAt: stamp() };
      if (payload.enterpriseProducts !== undefined) w.enterpriseProducts = enterpriseList(payload.enterpriseProducts);
      if (!w.name) throw new Error('Name your workspace.'); if (existing) Object.assign(existing, w); else state.workspaces.push(w); state.activeWorkspaceId = w.id; save(); return copy(w);
    },
    // Workspace research knowledge: the n8n Taxonomy Lookup tab, the product registry and the
    // ICP / positioning / AI-visibility documents the toolkit prompt reads.
    saveWorkspaceTaxonomy({ workspaceId, rows, taxonomy, sourceName = '' } = {}) {
      const w = workspace(workspaceId);
      if (taxonomy === null) { delete w.taxonomy; w.updatedAt = stamp(); save(); return publicState(); }
      const categories = rows ? intel.parseTaxonomyRows(rows) : intel.validateTaxonomy(taxonomy).categories;
      w.taxonomy = intel.validateTaxonomy({ categories, source: { kind: rows ? 'rows' : 'saved', name: String(sourceName || '').slice(0, 240), importedAt: stamp() } }); w.updatedAt = stamp(); save(); return publicState();
    },
    saveReferenceDoc({ workspaceId, doc = {} } = {}) {
      const w = workspace(workspaceId); const docs = w.referenceDocs || [];
      if (!REFERENCE_DOC_KINDS.includes(doc.kind)) throw new Error('Choose ICP, positioning, registry, AI visibility or other for this document.');
      const title = String(doc.title || '').trim().slice(0, 200); const text = String(doc.text || '').trim();
      if (!title) throw new Error('Name this reference document.'); if (!text || text.length > 300000) throw new Error('Reference documents need text, up to 300,000 characters.');
      const existing = doc.id ? docs.find(entry => entry.id === safeId(doc.id)) : null;
      const saved = { id: existing?.id || id('doc'), kind: doc.kind, title, text, source: doc.source && typeof doc.source === 'object' ? { kind: String(doc.source.kind || '').slice(0, 40), name: String(doc.source.name || '').slice(0, 300) } : null, updatedAt: stamp() };
      w.referenceDocs = [saved, ...docs.filter(entry => entry.id !== saved.id)].slice(0, 20); w.updatedAt = stamp(); save(); return { doc: { ...saved, text: undefined, characters: text.length }, state: publicState() };
    },
    readReferenceDoc({ workspaceId, docId } = {}) { const w = workspace(workspaceId); const doc = (w.referenceDocs || []).find(entry => entry.id === safeId(docId)); if (!doc) throw new Error('Reference document not found.'); return copy(doc); },
    deleteReferenceDoc({ workspaceId, docId } = {}) { const w = workspace(workspaceId); w.referenceDocs = (w.referenceDocs || []).filter(entry => entry.id !== safeId(docId)); w.updatedAt = stamp(); save(); return publicState(); },
    // Parses the "Product & Solution Registry" doc text into structured products (used to check
    // the toolkit's Enterprise / self-serve angles) and keeps the text for the toolkit prompt.
    importProductRegistry({ workspaceId, text, title = 'Product & Solution Registry', enterpriseProducts } = {}) {
      const w = workspace(workspaceId); const value = String(text || '').trim();
      if (!value || value.length > 300000) throw new Error('Paste the registry document text (up to 300,000 characters).');
      const enterprise = enterpriseList(enterpriseProducts ?? w.enterpriseProducts ?? (w.editionId === 'semrush' ? SEMRUSH_ENTERPRISE_PRODUCTS : []));
      const parsed = reports().parseToolkitRegistry(value, { enterpriseProducts: enterprise });
      w.products = content.validateProductRegistry(parsed.products.map(product => ({ ...product, editionId: w.editionId })), { editionId: w.editionId }); w.enterpriseProducts = enterprise;
      const docs = (w.referenceDocs || []).filter(entry => entry.kind !== 'registry');
      w.referenceDocs = [{ id: id('doc'), kind: 'registry', title: String(title).slice(0, 200), text: value, source: { kind: 'registry-import', name: String(title).slice(0, 300) }, updatedAt: stamp() }, ...docs].slice(0, 20); w.updatedAt = stamp(); save();
      return { products: w.products.length, enterprise: w.products.filter(product => product.segment === 'enterprise').map(product => product.name), selfServe: w.products.filter(product => product.segment === 'self-serve').map(product => product.name), warnings: parsed.warnings || [], state: publicState() };
    },
    // Cost preview for the program form: Apify worst case per lane and the AI estimate per stage.
    estimateResearchProgram(payload = {}) {
      const program = research.validateResearchProgram(payload);
      let collection = null; try { collection = require('../shared/research-collection').buildCollectionPlan(program, { now: clock() }).receipt; } catch (error) { collection = { error: safeError(error) }; }
      return { ai: research.estimateResearchCost(program), collection: collection && !collection.error ? { worstCaseUsd: collection.worstCaseUsd, totalBudgetUsd: collection.totalBudgetUsd, jobCount: collection.jobCount, platforms: collection.platforms, window: collection.window, warnings: collection.warnings } : collection, models: research.RESEARCH_MODELS, effortLevels: research.EFFORT_LEVELS };
    },
    setThemeStatus({ themeId, status } = {}) {
      if (!['active', 'archived'].includes(status)) throw new Error('Choose active or archived.');
      const theme = owned(state.themes, themeId); theme.status = status; theme.updatedAt = stamp(); save(); return publicState();
    },
    saveResearchProgram(payload) {
      const w = workspace(payload.workspaceId);
      if (state.programs.some(p => p.id === payload.id && p.workspaceId !== w.id)) throw new Error('Program belongs to another workspace.');
      const existing = state.programs.find(row => row.id === payload.id);
      const p = { ...research.validateResearchProgram(payload), workspaceId: w.id, updatedAt: stamp() };
      const previous = existing?.schedule;
      const changed = JSON.stringify(validateResearchSchedule(previous)) !== JSON.stringify(p.schedule);
      // Preserve server-owned execution metadata; never trust dates or run IDs
      // posted by the renderer. Editing program copy alone preserves the cadence.
      const metadata = Object.fromEntries(['lastRunAt', 'lastRunId', 'lastStatus', 'lastError', 'lastScheduledFor', 'skippedAt', 'skippedReason'].map(key => [key, previous?.[key] || '']));
      p.schedule = { ...p.schedule, ...metadata, nextRunAt: !p.schedule.enabled ? '' : changed || !previous?.nextRunAt ? nextResearchScheduleAt(p.schedule, { from: stamp() }) : previous.nextRunAt };
      if (changed) { p.schedule.lastError = ''; p.schedule.skippedAt = ''; p.schedule.skippedReason = ''; }
      state.programs = state.programs.filter(row => row.id !== p.id); state.programs.push(p); save(); return copy(p);
    },
    startResearchRun({ programId, datasetIds = [] }) {
      const program = owned(state.programs, programId); if (!Array.isArray(datasetIds) || datasetIds.length > 50) throw new Error('Choose up to 50 datasets.'); const allowed = new Set(publicState().availableDatasets.map(d => d.id)); if (datasetIds.some(key => !allowed.has(key))) throw new Error('Choose datasets from this workspace.');
      return startResearchRun(program, datasetIds);
    },
    approveResearchThemes({ runId, themes }) {
      const run = runRecord(runId); if (run.type !== 'research' || run.status !== 'awaiting-review') throw new Error('This run is not awaiting theme review.');
      if (!Array.isArray(themes) || !themes.length || themes.length > 6) throw new Error('Select one to six discovered themes.');
      const discovered = run.discoveredThemes || run.themes; // re-approval must still see themes passed over last time
      const selected = [...new Set(themes.map(t => typeof t === 'string' ? t : t.id))].map(key => { const t = discovered.find(row => row.id === key); if (!t) throw new Error('Only discovered themes can be approved.'); const edit = themes.find(row => row && typeof row === 'object' && row.id === key); if (!edit) return t; const name = String(edit.name ?? t.name).trim(); const description = String(edit.description ?? t.description).trim(); if (!name || name.length > 160 || !description || description.length > 5000) throw new Error('Theme name and description must be concise and non-empty.'); return { ...t, name, description }; });
      run.discoveredThemes ||= copy(run.themes); run.decisions = Object.fromEntries(discovered.map(t => [t.id, selected.some(row => row.id === t.id) ? 'approved' : 'passed']));
      // Reviewer edits become the tracked name; the discovered wording stays as an alias.
      for (const theme of selected) { const repo = state.themes.find(row => row.workspaceId === run.workspaceId && row.id === theme.id); const original = discovered.find(row => row.id === theme.id); if (repo && original && (original.name !== theme.name || original.description !== theme.description)) Object.assign(repo, { name: theme.name, description: theme.description, aliases: [...new Set([...(repo.aliases || []), ...(original.name !== theme.name ? [original.name] : [])])].slice(-50), updatedAt: stamp() }); }
      run.themes = selected; run.approvedAt = stamp(); save(); return copy(run);
    },
    // Trend board: OK or pass one discovered theme at a time. Nothing is spent until the run continues.
    decideResearchTheme({ runId, themeId, decision }) {
      const run = runRecord(runId); if (run.type !== 'research' || run.status !== 'awaiting-review') throw new Error('This trend is no longer waiting for a decision.');
      if (!['approved', 'passed', 'pending'].includes(decision)) throw new Error('Choose approve, pass, or undo.');
      if (!(run.discoveredThemes || run.themes).some(t => t.id === themeId)) throw new Error('Only discovered trends can be decided.');
      run.decisions = { ...(run.decisions || {}) }; if (decision === 'pending') delete run.decisions[themeId]; else run.decisions[themeId] = decision; run.decidedAt = stamp(); save(); return publicRun(run);
    },
    continueResearchRun({ runId }) { const run = runRecord(runId); if (!run.approvedAt || run.type !== 'research') throw new Error('Approve the research themes first.'); return launch(run, () => performClassification(run)); },
    createContentRun(payload) { const run = newContentRun(payload); return launch(run, () => performContent(run)); },
    async cancelStudioRun({ runId }) { const run = runRecord(runId); if (!active.has(run.id) && run.status !== 'awaiting-review') return copy(run); stopped.add(run.id); await cancelProvider(run.id); for (const child of run.reportRunIds || []) { stopped.add(child.runId); await cancelProvider(child.runId); } run.status = 'cancelled'; run.message = 'Cancelled. Completed outputs are retained.'; updateScheduledRun(run); save(); return copy(run); },
    retryStudioRun({ runId, maxBudgetUsd }) { const run = runRecord(runId); if (active.has(run.id)) throw new Error('This run is still active.'); if (run.status === 'succeeded') return copy(run); if (maxBudgetUsd != null) { const next = budget(maxBudgetUsd); if (next < run.reservedUsd) throw new Error('Budget cannot be below already reserved spend.'); run.maxBudgetUsd = next; } return launch(run, () => run.type === 'content' ? performContent(run) : run.approvedAt ? performClassification(run) : performDiscovery(run)); },
    readStudioRun({ runId }) { return publicRun(runRecord(runId)); },
    readStudioAsset({ assetId }) { return assetResult(owned(state.assets, assetId)); },
    async openStudioAsset({ assetId }) { const asset = owned(state.assets, assetId); const target = file(asset.runId, `${asset.id}.${asset.kind === 'image' ? 'png' : 'html'}`); if (openFile) await openFile(target); return { path: target }; },
    async importStudioSource(payload) { if (!importSource) throw new Error('Document import is unavailable on this host. Paste source text instead.'); const source = await importSource(payload); if (!source) return null; content.normalizeSource({ ...source, kind: 'upload' }); return source; },
    async publishStudioRun({ runId }) {
      const run = runRecord(runId);
      if (!publishCampaign || !publicState().capabilities.googlePublishConfigured) throw new Error('Connect Google Drive with file creation permission in Settings first.');
      return publishRun(run);
    },
    exportStudioRun({ runId }) {
      const run = runRecord(runId); const ids = new Set([run.id, ...(run.reportRunIds || []).map(r => r.runId)]); const assets = state.assets.filter(a => a.workspaceId === run.workspaceId && ids.has(a.runId)); if (!assets.length) throw new Error('Generate at least one asset before exporting.');
      const exportId = id('export'); const dir = path.join(root, 'exports', exportId); fs.mkdirSync(dir, { recursive: true });
      for (const asset of assets) { const channel = asset.channel.replace(/[^a-zA-Z0-9_-]/g, '-'); const dest = path.join(dir, channel); fs.mkdirSync(dest, { recursive: true }); for (const extension of asset.kind === 'image' ? ['png', 'svg'] : ['md', 'html', 'json']) fs.copyFileSync(file(asset.runId, `${asset.id}.${extension}`), path.join(dest, `${asset.deliverableId}-${asset.id}.${extension}`)); }
      write(path.join(dir, 'manifest.json'), { exportedAt: stamp(), workspaceId: run.workspaceId, run: copy(run), assets, notice: 'Drafts require editorial review. SVG files embed raster images; they are not editable vectors.' });
      for (const childId of ids) fs.copyFileSync(file(childId, 'input.json'), path.join(dir, `${childId}-source.json`));
      const result = { id: exportId, workspaceId: run.workspaceId, runId, path: dir, assetCount: assets.length, createdAt: stamp() }; state.exports.push(result); save(); return result;
    },
    activeWorkspaceId: () => state.activeWorkspaceId,
    // Sheets: every research run with saved evidence opens as a workbook. Reading never starts or changes a run.
    listResearchWorkbookSources() {
      return state.researchRuns.filter(run => run.workspaceId === state.activeWorkspaceId && fs.existsSync(path.join(root, 'runs', run.id, 'evidence.json')))
        .map(run => ({ runId: run.id, programId: run.programId || '', title: run.title, status: run.status, stage: run.stage, createdAt: run.createdAt, updatedAt: run.updatedAt || run.createdAt, evidenceCount: run.counts?.retained ?? run.coverage?.retainedCount ?? 0, themeCount: (run.discoveredThemes || run.themes || []).length, version: researchWorkbookVersion(run) }));
    },
    async readResearchWorkbookSource({ runId }) {
      const run = runRecord(runId); if (run.type !== 'research') throw new Error('Only research runs open as workbooks.');
      if (!fs.existsSync(file(run.id, 'evidence.json'))) throw new Error('This run has no saved evidence yet. It opens in Sheets once collection finishes.');
      const input = read(file(run.id, 'input.json')); let program; try { program = runProgram(input); } catch (_) { program = input.program || {}; } const evidence = read(file(run.id, 'evidence.json')).items || [];
      // Richer source fields (Reddit titles, LinkedIn headlines) live on the raw rows of the collected datasets.
      const datasetIds = new Set([...(input.datasetIds || []), ...getDatasets().filter(d => d.researchRunId === run.id).map(d => d.id)]);
      const wanted = new Set(evidence.map(row => row.sourceItemId).filter(Boolean)); const raw = {};
      for (const datasetId of datasetIds) {
        let payload; try { payload = await readDataset(datasetId); } catch (_) { continue; }
        for (const item of payload?.items || []) if (wanted.has(item.id) && item.raw) raw[item.id] = item.raw;
      }
      const discovery = research.buildDiscoveryBatches({ runId: run.id, items: evidence, batchSize: program.discoveryBatchSize });
      const batches = discovery.batches.map(batch => {
        const cache = file(run.id, `${batch.id}.validated.json`); const done = fs.existsSync(cache);
        const saved = done ? read(cache) : null;
        return { id: batch.id, index: batch.index, total: batch.totalBatches, platform: batch.platform, platformBatchNumber: batch.platformBatchNumber, evidenceIds: batch.evidenceIds, candidates: saved ? saved.candidates || [] : null, completedAt: saved ? saved.completedAt || fs.statSync(cache).mtime.toISOString() : '' };
      });
      let assignments = [];
      if (fs.existsSync(file(run.id, 'assignments.json'))) assignments = read(file(run.id, 'assignments.json'));
      else if (run.approvedAt) {
        // Classification in progress: show the batches already tagged.
        const tagging = research.buildAssignmentBatches({ runId: run.id, items: evidence, batchSize: program.taggingBatchSize, batchSizes: program.taggingBatchSizes });
        for (const batch of tagging.batches) { const cache = file(run.id, `${batch.id}.validated.json`); if (fs.existsSync(cache)) assignments = research.applyAssignments(assignments, read(cache).assignments || []); }
      }
      const reports = (run.reportRunIds || []).map(entry => ({ themeId: entry.themeId, runId: entry.runId, assets: (state.assets || []).filter(asset => asset.runId === entry.runId).map(asset => ({ id: asset.id, deliverableId: asset.deliverableId, title: asset.title, url: run.googleDelivery?.assets?.find(row => row.assetId === asset.id)?.files?.find(f => /docs\.google\.com/.test(f.url || ''))?.url || '' })) }));
      const workspaceRuns = state.researchRuns.filter(row => row.workspaceId === run.workspaceId).map(row => ({ id: row.id, title: row.title, createdAt: row.createdAt }));
      const w = state.workspaces.find(row => row.id === run.workspaceId) || {};
      // Report links for every theme in the repository (Trend Velocity shows the latest docs per theme).
      const repositoryReports = {}; for (const researchRun of state.researchRuns.filter(row => row.workspaceId === run.workspaceId)) for (const entry of researchRun.reportRunIds || []) { const docs = (state.assets || []).filter(asset => asset.runId === entry.runId).map(asset => ({ deliverableId: asset.deliverableId, createdAt: asset.createdAt, url: researchRun.googleDelivery?.assets?.find(row => row.assetId === asset.id)?.files?.find(f => /docs\.google\.com/.test(f.url || ''))?.url || '' })); if (docs.length && (!repositoryReports[entry.themeId] || String(docs[0].createdAt) > String(repositoryReports[entry.themeId][0].createdAt))) repositoryReports[entry.themeId] = docs; }
      return { run: publicRun(run), program, evidence, raw, assignments, batches, themes: copy((state.themes || []).filter(t => t.workspaceId === run.workspaceId)), history: copy((state.history || []).filter(h => h.workspaceId === run.workspaceId)), detections: copy((state.detections || []).filter(d => d.workspaceId === run.workspaceId)), taxonomy: copy(w.taxonomy || null), repositoryReports, reports, runs: workspaceRuns, version: researchWorkbookVersion(run) };
    },
    waitForIdle: async () => { while (active.size) await Promise.allSettled([...active.values()]); },
  };
  function researchWorkbookVersion(run) {
    const stamp = name => { try { return fs.statSync(path.join(root, 'runs', run.id, name)).mtimeMs; } catch (_) { return 0; } };
    let cached = 0; try { cached = fs.readdirSync(path.join(root, 'runs', run.id)).filter(name => name.endsWith('.validated.json')).length; } catch (_) { /* No run folder yet. */ }
    return [run.updatedAt || run.createdAt, run.status, run.stage, stamp('evidence.json'), stamp('assignments.json'), cached, (run.themes || []).length, JSON.stringify(run.decisions || {}).length].join('|');
  }
  // Persist before exposing the service; startup does not emit events or run providers.
  if (migrateSemrushBrandDefaults()) write(stateFile, state);
  return api;
}
module.exports = { createContentWorkspace };
