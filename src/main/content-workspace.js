// Shared application service for desktop and browser hosts. No Electron dependency.
const fs = require('fs');
const path = require('path');
const { randomUUID, createHash } = require('crypto');
const { writeFileDurable } = require('../shared/durable-write');
const content = require('../shared/content-studio');
const research = require('../shared/research-program');
const researchPrompts = require('../shared/research-prompts');
const intel = require('../shared/research-intel');
const { validateResearchSchedule, nextResearchScheduleAt, latestResearchScheduleAt, researchScheduleWindow } = require('../shared/research-schedule');
// Golden Thread trend report + editorial toolkit (loaded on use so older hosts keep starting).
const reports = () => require('../shared/research-reports');
// Share-your-setup file format (export, preview, import); loaded on use for the same reason.
const setupBundle = () => require('../shared/setup-bundle');
// Asset kits: every channel asset from one report, as the n8n "Generate All Channel Assets" workflow made them.
const kit = () => require('../shared/asset-kit');
// Brand reference images: the style examples and approved logos kit pictures send to the image model.
const brandImages = () => require('../shared/brand-images');
// Reports edited in the studio: Markdown → safe HTML for the edited copy's page.
const { markdownToHtml, splitTitle } = require('./markdown-html');
// Prompt Library (SPEC-2 §A): saved prompt versions per workspace; each run keeps its own copy (input.prompts).
const { createPromptStore } = require('./prompt-store');
const { snapshotBlocks, REGISTRY: PROMPT_REGISTRY } = require('../shared/prompt-template');
const promptLabModule = () => require('./prompt-lab');
// The written channel assets that have their own task in Model routing (src/shared/ai-tasks.json).
const KIT_TEXT_TASKS = new Set(require('../shared/ai-tasks.json').tasks.filter(task => task.group === 'assets').map(task => task.id));
// Refusals people read (copy lives in the roles policy data so every screen and doc says the same thing).
const { copy: COPY } = require('../shared/roles.json');
const say = (key, vars = {}) => COPY[key].replace(/\{(\w+)\}/g, (_, name) => (vars[name] == null ? '' : String(vars[name])));
const refusal = (key, vars, status) => Object.assign(new Error(say(key, vars)), { status, code: key });
// "Oct 14, 10:42 AM EDT": the zone is named because a server's clock may not be the reader's.
const when = value => { const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }) : 'an earlier time'; };
// Who did something, when no person did: schedules, automatic approval and records from before attribution.
const SYSTEM = Object.freeze({ id: 'system', name: 'Automatic' });
const REPORT_DELIVERABLES = ['evidence-report', 'editorial-toolkit'];
const MAX_EDIT_CHARS = 250000;
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
// actor() names the person calling a public method ({ id, name }). It is read once, synchronously, at the start of each
// public method and passed down: the host's call context also follows background work a call starts, so reading it inside
// a run would credit later automatic steps to whoever started the run.
// getAiProvider (optional, may be async) resolves the AI route in use ('claude' | 'claude-api' | 'codex'), which the "auto"
// setting alone can't tell; without it the setting decides.
// getCallerRole (optional) names the caller's role ('admin', 'editor', a custom role id…), read at the entry of the prompt
// methods like actor(): prompt saves are credited with it and only 'admin' may change a locked prompt or lock one. Without
// it (tests, a single-person host) the caller counts as an admin. trackJob (optional) registers a cancellable job in the
// host's job tray ({ id, kind, title, cancellable } → { finish(patch), fail(error), cancelled() }) for prompt test runs.
// getCallerCapabilities (optional) lists the caller's capability ids ('*' = all): a Prompt Library preview or test uses a
// recent run's data only when the caller may read it. Without it the caller holds everything.
// onRunEvent (optional) hears when a run started from an Ask AI conversation reaches a point worth posting there (a quick
// scan's trends report, trends waiting for an OK, reports written, a stop): { type, key, identityId, conversationId, run,
// report?, error?, attempt? } → { messageId } | null (src/main/ask-followups.js). It never fails a run.
function createContentWorkspace({ root, runAI, collect, getDatasets = () => [], readDataset, emit = () => {}, cancelProvider = () => {}, generateImage, publishCampaign, capabilities = () => ({}), importSource, openFile, clock = () => new Date(), defaultWorkspaceId = 'general', actor = () => SYSTEM, getAiProvider, getCallerRole, getCallerCapabilities, trackJob, onRunEvent, routing: routingHost = null, generateVideo = null, hooks = {}, isWorkflowCall = () => false, workspacePolicy = null } = {}) {
  if (!root || typeof runAI !== 'function') throw new Error('Studio storage and AI host are required.');
  // One workspace or several (src/main/workspace-policy.js). Single mode keeps one workspace of the package's edition,
  // shown as policy.name (Main); the others are hidden (archived), never deleted. See migrateWorkspacePolicy below.
  const policy = workspacePolicy?.mode === 'single' ? { mode: 'single', id: /^[a-z0-9-]{1,40}$/.test(String(workspacePolicy.id || '')) ? workspacePolicy.id : 'semrush', editionId: workspacePolicy.editionId === 'general' ? 'general' : 'semrush', name: String(workspacePolicy.name || 'Main').slice(0, 60) || 'Main' } : { mode: 'multi' };
  // Model routing (src/main/ai-routing.js): which connection, model and effort each AI task uses. The host passes its
  // studio routing; without one (tests, older hosts) the same rules run on the capabilities' text route and model.
  const routing = routingHost || localRouting();
  function localRouting() {
    const local = require('./ai-routing').createAiRouting({ getSettings: () => { const extra = capabilities(); return { aiProvider: extra.aiProvider || 'auto', aiModel: extra.textModel || 'claude-opus-5-5' }; }, programs: () => routingPrograms() });
    return { resolve: local.resolve, snapshot: local.snapshot, current: local.current, taskIdForPrompt: local.taskIdForPrompt, priceFor: () => ({ basis: 'none', known: false }), unitsFor: () => 1, mediaProblem: () => '' };
  }
  const stamp = () => new Date(clock()).toISOString();
  const who = () => { let value = null; try { value = actor(); } catch (_) { value = null; } return { id: String(value?.id || SYSTEM.id).slice(0, 320), name: String(value?.name || SYSTEM.name).slice(0, 120) }; };
  fs.mkdirSync(root, { recursive: true });
  const stateFile = path.join(root, 'state.json');
  const editionWorkspace = (editionId, workspaceId = editionId, name = editionId === 'semrush' ? 'Semrush workspace' : 'Your workspace') => ({ id: workspaceId, name, editionId, knowledge: content.validateBrandKnowledge(editionId === 'semrush' ? content.SEMRUSH_KNOWLEDGE_PRESET : {}, { editionId }), products: [], ...(editionId === 'semrush' ? { brandDefaults: copy(content.SEMRUSH_BRAND_2026) } : {}), createdAt: stamp(), updatedAt: stamp() });
  // A fresh install has one workspace per edition; in single mode only the package's own, named Main.
  const fresh = () => ({ version: 1, activeWorkspaceId: policy.mode === 'single' ? policy.id : ['general', 'semrush'].includes(defaultWorkspaceId) ? defaultWorkspaceId : 'general', workspaces: policy.mode === 'single' ? [editionWorkspace(policy.editionId, policy.id, policy.name)] : ['general', 'semrush'].map(editionId => editionWorkspace(editionId)), ...(policy.mode === 'single' ? { workspacePolicy: { mode: 'single', mainId: policy.id, name: policy.name, appliedAt: stamp() } } : {}), programs: [], researchRuns: [], contentRuns: [], themes: [], history: [], detections: [], assets: [], exports: [], datasetOwners: {} });
  let state;
  try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw new Error('Studio data could not be read. Restore the saved state before continuing.'); state = fresh(); }
  state.detections ||= [];
  const active = new Map(); const stopped = new Set(); const publishing = new Set();
  let researchScheduleTimer;
  function file(runId, name) { safeId(runId); const dir = path.join(root, 'runs', runId); fs.mkdirSync(dir, { recursive: true }); return path.join(dir, name); }
  // A private temp file, fsync, rename (retried on Windows while a scanner holds the file), then fsync the folder; a
  // failed write leaves no temp file behind (src/shared/durable-write.js).
  function writeBytes(target, data) { writeFileDurable(target, data); }
  function write(target, data) { writeBytes(target, JSON.stringify(data, null, 2)); }
  function read(target) { return JSON.parse(fs.readFileSync(target, 'utf8')); }
  function save() { write(stateFile, state); emit(); }
  function staleSave(existing, base, what) {
    if (typeof base !== 'string' || !existing || (existing.updatedAt || '') === base) return;
    throw Object.assign(new Error(`Someone saved ${what} at ${when(existing.updatedAt)}, after you opened it. Reopen it to see their changes, then make yours again.`), { status: 409, code: 'saveConflict' });
  }
  // state.exports lists the Mac app's export folders (the newest 100); nothing reads more than that.
  function recordExport(result) { state.exports.push(result); if (state.exports.length > 100) state.exports.splice(0, state.exports.length - 100); save(); }
  // ---------- Prompt Library: saved versions (prompts/<workspaceId>/), and the copy each run starts with ----------
  const prompts = createPromptStore({ root: path.join(root, 'prompts'), now: clock });
  const callerRole = () => { if (typeof getCallerRole !== 'function') return 'admin'; try { return String(getCallerRole() || ''); } catch (_) { return ''; } };
  const callerCaps = () => { if (typeof getCallerCapabilities !== 'function') return new Set(['*']); try { const caps = getCallerCapabilities(); return new Set(Array.isArray(caps) ? caps : []); } catch (_) { return new Set(); } };
  const PROMPT_IDS = new Set(PROMPT_REGISTRY.prompts.map(entry => entry.id));
  const RESEARCH_PROMPTS = ['research.discovery', 'research.synthesis', 'research.matching', 'research.tagging', 'reports.trends-report', 'reports.editorial-toolkit', 'system.repair'];
  const REPORT_PROMPTS = ['reports.trends-report', 'reports.editorial-toolkit', 'system.repair'];
  const isTextDeliverable = deliverableId => content.CONTENT_DELIVERABLES.find(d => d.id === deliverableId)?.kind === 'text';
  // The prompts channel assets (kit) or Create content drafts are written with. Kit pictures go through a brief; Create
  // content pictures use the content-image prompt.
  function assetPromptIds(deliverableIds = [], { kit: isKit = false } = {}) {
    const kindOf = id => content.CONTENT_DELIVERABLES.find(d => d.id === id)?.kind;
    const pictures = deliverableIds.some(id => kindOf(id) === 'image'); const video = isKit && deliverableIds.some(id => kindOf(id) === 'video');
    return ['assets.shared', ...deliverableIds.filter(isTextDeliverable).map(id => `assets.${id}`), ...(pictures || video ? ['pictures.direction'] : []), ...(pictures ? ['pictures.variations', ...(isKit ? ['pictures.kit-brief', 'pictures.kit-image'] : ['pictures.content-image'])] : []), ...(video ? ['video.brief', 'video.clip'] : []), ...(isKit ? ['system.repair'] : [])].filter(id => PROMPT_IDS.has(id));
  }
  const promptSnapshot = (w, ids) => prompts.snapshot(w.id, w.editionId, ids);
  const pickPrompts = (snapshot, ids) => Object.fromEntries(Object.entries(snapshot || {}).filter(([promptId]) => ids.includes(promptId)));
  // run.prompts: the version of each prompt a run started with, for receipts ("Custom prompts: Find candidate trends v3").
  const promptRecord = snapshot => Object.fromEntries(Object.entries(snapshot || {}).map(([promptId, entry]) => [promptId, { version: entry.version, custom: Boolean(entry.custom) }]));
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
  // Single mode (the Semrush package): one workspace of the package's edition, shown as Main. The main one is the one a
  // previous start chose, else the configured id when it holds data (or nothing else does), else the edition's workspace
  // with the most programs, runs and assets. Every other workspace is archived: hidden from the switcher, the state and
  // the scheduler, with every record kept on disk. Before the first change state.json is copied once to
  // state.before-single-workspace.json. Multi mode undoes it: archived workspaces come back, Main gets its old name back,
  // and revived schedules wait for their next time instead of running at once. Idempotent; returns whether it changed.
  function migrateWorkspacePolicy() {
    const applied = state.workspacePolicy && typeof state.workspacePolicy === 'object' ? state.workspacePolicy : null;
    if (policy.mode !== 'single') {
      if (applied?.mode !== 'single') return false;
      const now = stamp();
      for (const w of state.workspaces) {
        if (w.archived?.reason === 'single-workspace') {
          delete w.archived;
          for (const program of state.programs) if (program.workspaceId === w.id && program.schedule?.enabled && program.schedule.frequency !== 'manual') program.schedule.nextRunAt = nextResearchScheduleAt(program.schedule, { from: now });
        }
        if (w.id === applied.mainId) { if (w.previousName && w.name === applied.name) w.name = w.previousName; delete w.previousName; }
      }
      delete state.workspacePolicy;
      return true;
    }
    const score = w => [state.programs, state.researchRuns, state.contentRuns, state.assets].reduce((sum, rows) => sum + (rows || []).filter(row => row.workspaceId === w.id).length, 0);
    const candidates = state.workspaces.filter(w => w.editionId === policy.editionId);
    const pinned = applied?.mode === 'single' ? candidates.find(w => w.id === applied.mainId) : null;
    const configured = candidates.find(w => w.id === policy.id);
    const holding = candidates.filter(w => w !== configured).map(w => ({ w, n: score(w) })).filter(row => row.n > 0).sort((a, b) => b.n - a.n || String(b.w.updatedAt || '').localeCompare(String(a.w.updatedAt || '')));
    let main = pinned || (configured && (score(configured) > 0 || !holding.length) ? configured : holding[0]?.w || configured || candidates[0] || null);
    let changed = false;
    const change = () => {
      if (changed) return; changed = true;
      const backup = path.join(root, 'state.before-single-workspace.json');
      try { if (fs.existsSync(stateFile) && !fs.existsSync(backup)) writeBytes(backup, fs.readFileSync(stateFile)); } catch (error) { console.warn(`The studio data couldn’t be copied before switching to one workspace: ${safeError(error)}`); }
    };
    if (!main) { change(); main = editionWorkspace(policy.editionId, state.workspaces.some(w => w.id === policy.id) ? id('workspace') : policy.id, policy.name); state.workspaces.push(main); }
    if (main.archived) { change(); delete main.archived; }
    if (main.name !== policy.name) { change(); if (!main.previousName) main.previousName = main.name; main.name = policy.name; }
    for (const w of state.workspaces) if (w !== main && !w.archived) { change(); w.archived = { at: stamp(), reason: 'single-workspace' }; }
    if (state.activeWorkspaceId !== main.id) { change(); state.activeWorkspaceId = main.id; }
    if (applied?.mode !== 'single' || applied.mainId !== main.id || applied.name !== policy.name) { change(); state.workspacePolicy = { mode: 'single', mainId: main.id, name: policy.name, appliedAt: stamp() }; }
    return changed;
  }
  const isArchived = workspaceId => Boolean(state.workspaces.find(w => w.id === workspaceId)?.archived);
  const mainId = () => state.workspacePolicy?.mainId || policy.id;
  // Who owns a saved collection with no recorded workspace: Main in single mode, the general workspace otherwise.
  const datasetFallback = () => (policy.mode === 'single' ? mainId() : 'general');
  const singleRefusal = message => Object.assign(new Error(message), { status: 409, code: 'singleWorkspace' });
  // What publicState says about the policy: in single mode, Main's name and edition and what the hidden workspaces hold.
  function workspacePolicyView() {
    if (policy.mode !== 'single') return { mode: 'multi' };
    const count = (rows, w) => (rows || []).filter(row => row.workspaceId === w.id).length;
    const archived = state.workspaces.filter(w => w.archived?.reason === 'single-workspace').map(w => ({ id: w.id, name: w.name, programs: count(state.programs, w), runs: count(state.researchRuns, w) + count(state.contentRuns, w), assets: count(state.assets, w) }));
    return { mode: 'single', name: policy.name, editionId: policy.editionId, archived };
  }
  function workspace(workspaceId = state.activeWorkspaceId, enforce = true) { safeId(workspaceId); const result = state.workspaces.find(w => w.id === workspaceId); if (!result || (enforce && workspaceId !== state.activeWorkspaceId)) throw new Error('Select the workspace that owns this record.'); return result; }
  function owned(list, recordId) { safeId(recordId); const item = list.find(row => row.id === recordId); if (!item || item.workspaceId !== state.activeWorkspaceId) throw new Error('Record not found in the selected workspace.'); return item; }
  function runRecord(runId) { return owned([...state.contentRuns, ...state.researchRuns], runId); }
  // A report edited in the studio keeps its generated files and adds <id>.edited.md and <id>.edited.html. Everything that
  // reads a report's text or page goes through assetFile or assetResult, so drafts, kits, exports, Drive and Ask AI all
  // use the edit; the original .json stays the data (evidence register, theme) behind it.
  function editedFile(asset, extension) { return file(asset.runId, `${safeId(asset.id)}.edited.${extension}`); }
  const videoExtensions = asset => ['mp4', ...['srt', 'poster.png'].filter(extension => fs.existsSync(file(asset.runId, `${asset.id}.${extension}`)))];
  function assetFile(asset, extension) { return asset.edited && ['md', 'html'].includes(extension) && fs.existsSync(editedFile(asset, extension)) ? editedFile(asset, extension) : file(asset.runId, `${asset.id}.${extension}`); }
  const editedOf = asset => (asset.edited?.at ? { at: asset.edited.at, byName: asset.edited.by?.name || '' } : null);
  // Writing an edit: editStudioAsset and the report editor (report-docs.js, writeReportMarkdown) write the same two files.
  // An edit or restore made outside the editor tells it (hooks.onAssetEdited), so its shared document starts over.
  function checkEditable(asset, markdown) {
    if (asset.kind !== 'text' || asset.deliverableId === 'landingpage') throw new Error('Pictures and landing pages can’t be edited here.');
    if (typeof markdown !== 'string' || !markdown.trim()) throw new Error('Write the report before saving, or restore the original.');
    if (markdown.length > MAX_EDIT_CHARS) throw new Error('Keep the report under 250,000 characters.');
  }
  function writeEdit(asset, markdown) {
    let editionId = state.workspaces.find(w => w.id === asset.workspaceId)?.editionId || 'general';
    try { editionId = read(file(asset.runId, 'input.json')).editionId || editionId; } catch (_) { /* The workspace's edition will do. */ }
    const { title, body } = splitTitle(markdown);
    writeBytes(editedFile(asset, 'md'), markdown);
    writeBytes(editedFile(asset, 'html'), content.wrapHtml(title || asset.title, markdownToHtml(body), editionId));
  }
  const editorActor = by => (by && typeof by === 'object' && by.id ? { id: String(by.id).slice(0, 320), name: String(by.name || '').slice(0, 120) } : who());
  function editedOutside(asset, kind, markdown, by) {
    if (typeof hooks.onAssetEdited !== 'function') return;
    try { hooks.onAssetEdited({ assetId: asset.id, kind, markdown, by }); } catch (_) { /* the editor catches up the next time the report opens */ }
  }
  // Every report or channel asset written, edited or restored (hooks.onAssetChanged): the Google Drive folder sync
  // (drive-sync.js) queues it. reason: 'created' | 'edited' | 'restored'. Never stops a save.
  // The report's Doc in the admin's Drive folder (drive-sync.js), when the folder sync has copied it.
  function driveLink(assetId) { if (typeof hooks.driveLink !== 'function') return ''; try { const url = String(hooks.driveLink(assetId) || ''); return /^https:\/\//.test(url) ? url : ''; } catch (_) { return ''; } }
  function legacyDrivePublish(program) {
    if (typeof hooks.legacyDrivePublish !== 'function') return Boolean(program?.delivery?.publishToDrive);
    try { return Boolean(hooks.legacyDrivePublish(program)); } catch (_) { return false; }
  }
  function assetChanged(asset, reason) {
    if (typeof hooks.onAssetChanged !== 'function') return;
    try { hooks.onAssetChanged({ assetId: asset.id, workspaceId: asset.workspaceId, reason }); } catch (_) { /* the next save or Copy existing reports catches up */ }
  }
  const MAX_VIDEO_RESULT_BYTES = 60 * 1024 * 1024;
  function assetResult(asset) {
    if (asset.kind === 'video') {
      // The clip travels as base64 to the page (a Blob URL there); a very long one is opened from the file instead.
      const mp4 = file(asset.runId, `${asset.id}.mp4`); const bytes = fs.statSync(mp4).size;
      const poster = file(asset.runId, `${asset.id}.poster.png`);
      const extra = { captions: Array.isArray(asset.captions) ? [...asset.captions] : [], ...(fs.existsSync(poster) ? { posterDataUrl: `data:image/png;base64,${fs.readFileSync(poster).toString('base64')}` } : {}) };
      if (bytes > MAX_VIDEO_RESULT_BYTES) return { asset: copy(asset), tooLarge: true, ...extra };
      return { asset: copy(asset), video: { mime: 'video/mp4', bytes, base64: fs.readFileSync(mp4).toString('base64') }, ...extra };
    }
    if (asset.kind !== 'text') return { asset: copy(asset), imageDataUrl: `data:image/png;base64,${fs.readFileSync(file(asset.runId, `${asset.id}.png`)).toString('base64')}` };
    const output = read(file(asset.runId, `${asset.id}.json`)); const original = read(file(asset.runId, 'input.json')).source;
    const generated = content.renderContentExport(output); const edits = assetFile(asset, 'md') === editedFile(asset, 'md');
    return { asset: copy(asset), output, markdown: edits ? fs.readFileSync(editedFile(asset, 'md'), 'utf8') : generated, ...(edits ? { originalMarkdown: generated } : {}), edited: edits ? editedOf(asset) : null, evidence: content.normalizeSource(original).evidence, aggregateMetrics: original.aggregateMetrics };
  }
  // The Ask AI conversation a run was started from stays on the server; only followUpAt (a follow-up was posted) is shown.
  const withoutAsk = value => { if (value && typeof value === 'object') { delete value.ask; if (value.quickScan && typeof value.quickScan === 'object') delete value.quickScan.ask; } return value; };
  // The workflow run a child run belongs to (workflow engine): ids and the workflow's name only.
  function workflowLink(value) {
    if (!value || typeof value !== 'object') return null;
    const link = { id: String(value.id || '').slice(0, 180), runId: String(value.runId || '').slice(0, 180), name: String(value.name || '').slice(0, 120) };
    return /^workflow-[a-zA-Z0-9_-]{1,170}$/.test(link.id) && /^wfrun-[a-zA-Z0-9_-]{1,170}$/.test(link.runId) ? link : null;
  }
  // A research run's cost includes its report runs and a quick scan's trends report (ownCostUsd is its own).
  function publicRun(run) { const value = withoutAsk(copy(run)); if (run.type === 'research') { value.ownCostUsd = run.costUsd; value.costUsd += [...(run.reportRunIds || []).map(entry => entry.runId), ...(run.scanReport?.runId ? [run.scanReport.runId] : [])].reduce((sum, childId) => sum + (state.contentRuns.find(child => child.id === childId)?.costUsd || 0), 0); } return value; }
  function publicState() {
    const scoped = list => copy(list.filter(row => row.workspaceId === state.activeWorkspaceId));
    const datasets = getDatasets().filter(d => (state.datasetOwners[d.id] || d.workspaceId || datasetFallback()) === state.activeWorkspaceId).map(d => ({ id: d.id, name: d.name, platform: d.platform, itemCount: d.itemCount, createdAt: d.createdAt }));
    // Reference documents can be long; state carries their metadata and readReferenceDoc returns the text.
    // Brand reference images arrive grouped by picture set; readBrandImage returns a picture's bytes.
    const activeView = w => ({ ...w, referenceDocs: (w.referenceDocs || []).map(({ text, ...doc }) => ({ ...doc, characters: String(text || '').length })), brandImageSets: brandImages().brandImageFamilies(w.editionId).map(family => ({ ...family, images: (w.brandImages || []).filter(image => image.family === family.id) })) });
    return { activeWorkspaceId: state.activeWorkspaceId, workspaces: copy(state.workspaces.filter(w => !w.archived).map(w => w.id === state.activeWorkspaceId ? activeView(w) : { id: w.id, name: w.name, editionId: w.editionId, createdAt: w.createdAt, updatedAt: w.updatedAt })), workspacePolicy: workspacePolicyView(), programs: scoped(state.programs).map(program => ({ ...program, schedule: program.schedule || validateResearchSchedule() })), researchRuns: state.researchRuns.filter(run => run.workspaceId === state.activeWorkspaceId).map(publicRun), contentRuns: scoped(state.contentRuns), themes: scoped(state.themes), assets: scoped(state.assets), availableDatasets: datasets, availableReports: scoped(state.assets).filter(a => ['evidence-report', 'editorial-toolkit', 'scan-report'].includes(a.deliverableId)).map(a => ({ id: a.id, assetId: a.id, title: a.title, createdAt: a.createdAt })), capabilities: { imagesConfigured: !!generateImage, googleConfigured: false, googlePublishConfigured: !!publishCampaign, ...capabilities() }, promptChanges: recentPromptChanges() };
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
    const ended = [];
    for (const run of [...state.contentRuns, ...state.researchRuns]) if (['queued', 'running'].includes(run.status)) {
      ended.push([run, run.message || '']);
      run.status = (run.jobs || []).some(job => job.status === 'succeeded' || job.assetIds?.length) ? 'partial' : 'failed';
      run.message = 'The app stopped during this run. Retry resumes saved stages and keeps completed assets.';
      for (const job of run.jobs || []) if (job.status === 'running') { job.status = job.assetIds?.length ? 'partial' : 'failed'; job.error = 'Interrupted before completion.'; }
      updateScheduledRun(run);
    }
    // A quick scan whose trends report was being written (or retried) when the app stopped: Retry report finishes it.
    for (const run of state.researchRuns) if (run.scanReport && ['queued', 'running'].includes(run.scanReport.status)) {
      const child = state.contentRuns.find(row => row.id === run.scanReport.runId);
      run.scanReport = { ...run.scanReport, status: child?.status === 'succeeded' ? 'succeeded' : 'failed', error: child?.status === 'succeeded' ? '' : 'The app stopped while the trends report was being written.' };
    }
    save();
    for (const [run, reached] of ended) runEnded(run, reached, run.message);
  }
  // A run that ended failed or partial (hooks.onRunEnded: the admins' email, run-alerts.js), with the step it showed last
  // and what stopped it: the thrown error, else the first output's.
  function runEnded(run, reached = '', error = '') {
    if (typeof hooks.onRunEnded !== 'function' || !['failed', 'partial'].includes(run.status)) return;
    const jobs = [...(run.jobs || []), ...(run.reportRunIds || []).flatMap(entry => state.contentRuns.find(child => child.id === entry.runId)?.jobs || [])];
    try { hooks.onRunEnded({ run: publicRun(run), reached, error: error || jobs.find(job => job.error)?.error || '' }); } catch (_) { /* an alert never changes the run */ }
  }
  function check(run) { if (stopped.has(run.id)) throw new Error('Run cancelled.'); }
  function launch(run, task) {
    if (active.has(run.id)) return copy(run);
    stopped.delete(run.id); run.status = 'queued'; run.updatedAt = stamp(); save();
    let reached = ''; let thrown = '';
    const work = Promise.resolve().then(async () => { check(run); run.status = 'running'; updateScheduledRun(run); save(); await task(); }).catch(error => { reached = run.message || ''; thrown = safeError(error); run.status = stopped.has(run.id) ? 'cancelled' : (run.jobs || []).some(j => j.status === 'succeeded' || j.assetIds?.length) ? 'partial' : 'failed'; run.message = safeError(error); if (run.status !== 'cancelled' && askOf(run)) { const ask = askOf(run); ask.stops = (Number(ask.stops) || 0) + 1; runEvent(run, 'run-stopped', { attempt: ask.stops }); } }).finally(() => { active.delete(run.id); run.updatedAt = stamp(); updateScheduledRun(run); save(); runEnded(run, reached, thrown); });
    active.set(run.id, work); return copy(run);
  }
  // One Claude call. Research stages size the per-call spending cap from the call's own estimate
  // (generous headroom, never the whole run divided evenly, which starved large batches);
  // content runs keep the even split across their remaining outputs.
  async function ai(run, key, schema, prompt, remainingSteps, options = {}) {
    check(run); const remaining = Math.round((run.maxBudgetUsd - run.reservedUsd) * 100) / 100;
    // Codex reports no cost and takes no spending cap (it bills the person's Codex plan or OpenAI key), so its calls
    // reserve nothing and the run's budget can't stop them. options.task (a resolved AI task) says which connection runs it.
    const task = options.task || null;
    const unmetered = task ? task.metered === false : capabilities().aiProvider === 'codex';
    if (!unmetered && remaining < .01) throw new Error('Run budget exhausted. Increase the budget before retrying.');
    let allowance;
    if (unmetered) allowance = 0;
    else if (Number.isFinite(options.estimateUsd)) {
      const needed = Math.min(100, Math.max(.01, options.estimateUsd));
      if (remaining < needed) throw new Error(`This step needs about $${needed.toFixed(2)} but $${remaining.toFixed(2)} of the run's AI budget is left. Raise the budget and retry; finished steps are kept.`);
      allowance = Math.min(remaining, 100, Math.max(.5, Math.ceil(options.estimateUsd * (options.headroom || 3) * 100) / 100));
    } else {
      allowance = Math.min(100, Math.floor(remaining / Math.max(1, remainingSteps) * 100) / 100);
      if (allowance < .01) throw new Error('Budget is too small for the remaining requests.');
    }
    // Reserve before launch; interrupted/unknown-cost calls keep their reservation.
    const working = options.message || key;
    run.reservedUsd += allowance; run.message = working; save();
    // Under the studio's AI concurrency limit (ai-limits.js) a call may wait its turn; the run says so meanwhile.
    const onWait = position => { run.message = `Waiting for a free AI slot (${position === 1 ? 'next in line' : `${position} in line`}) · ${working}`; save(); };
    const onStart = () => { if (run.message !== working) { run.message = working; save(); } };
    try {
      const result = await runAI({ runId: run.id, schema, prompt, maxBudgetUsd: allowance, workspaceDir: path.dirname(file(run.id, 'receipt.json')), outputPath: file(run.id, `${safeId(key)}.raw.json`), ...(task ? { task } : {}), ...(options.model ? { model: options.model } : {}), ...(options.effort ? { effort: options.effort } : {}), ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}), onWait, onStart });
      const receipt = result.receipt || {};
      if (Number.isFinite(receipt.costUsd) && receipt.costUsd >= 0) { run.reservedUsd += Math.max(0, receipt.costUsd) - allowance; run.costUsd += receipt.costUsd; }
      run.receipts.push({ stage: key, allowanceUsd: allowance, ...receipt, ...(unmetered && !Number.isFinite(receipt.costUsd) ? { costBasis: 'Codex reports no cost; it uses the Codex plan or OpenAI key' } : {}) }); save(); check(run); return result.output;
    } catch (error) {
      if (Number.isFinite(error?.costUsd) && error.costUsd >= 0) { run.reservedUsd += error.costUsd - allowance; run.costUsd += error.costUsd; run.receipts.push({ stage: key, allowanceUsd: allowance, failed: true, costUsd: error.costUsd, error: safeError(error).slice(0, 300) }); save(); }
      throw error;
    }
  }
  // A call whose structured output fails validation gets one repair attempt with the validation
  // message; a call stopped by its spending cap gets one retry with a larger cap. The repaired answer is checked with
  // { final: true }: validators that support it (the report builders) leave out optional items that still break a rule
  // and cut what runs long, instead of throwing a paid-for draft away. If the repaired answer is still unusable, the
  // first answer gets the same final check before the call fails (with the repair's error, which names the fields).
  async function aiValidated(run, key, schema, prompt, validate, options = {}) {
    const call = async (callKey, text) => {
      try { return await ai(run, callKey, schema, text, 1, options); }
      catch (error) {
        if (!['CLAUDE_BUDGET_EXCEEDED', 'AI_BUDGET_EXCEEDED'].includes(error?.code) || !Number.isFinite(options.estimateUsd)) throw error;
        return ai(run, `${callKey}-retry`, schema, text, 1, { ...options, headroom: (options.headroom || 3) * 3 });
      }
    };
    const raw = await call(key, prompt);
    try { return validate(raw); } catch (error) {
      check(run);
      const repaired = await call(`${key}-repair`, prompt + researchPrompts.repairInstruction(error, raw));
      let result;
      try { result = validate(repaired, { final: true }); } catch (repairError) {
        if (repairError?.field === undefined) throw repairError;
        try { result = validate(raw, { final: true }); } catch (_) { throw repairError; }
      }
      if (Array.isArray(result?.salvaged) && result.salvaged.length) run.warnings = [...new Set([...(run.warnings || []), `${options.message || key}: the AI's corrected draft still broke ${result.salvaged.length} rule${result.salvaged.length === 1 ? '' : 's'}, so the parts that didn't pass were left out (${result.salvaged.slice(0, 3).join(' ').slice(0, 400)}).`])];
      return result;
    }
  }
  // A stage that can't be split (synthesis, matching, a report) and whose answer failed its checks twice stops with a
  // message that says what failed and that a retry runs only that step again: everything finished before it is saved.
  function unusableStep(run, error, step, kept) {
    if (!unusableOutput(run, error)) return error;
    const failed = new Error(`${step} failed its checks twice (${String(error.field || 'not valid JSON')}: ${safeError(error).slice(0, 300)}). ${kept} Retry runs only this step again.`);
    failed.field = error.field; failed.cause = error; return failed;
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
    // The title and text the person sees in Create content win (they may have edited the brief there); the report's own
    // fill in when they sent none. The evidence always comes from the saved report.
    const title = typeof source.title === 'string' && source.title.trim() ? source.title.trim().slice(0, 240) : asset.title;
    const text = typeof source.text === 'string' && source.text.trim() ? source.text : result.markdown;
    if (original.kind === 'research-theme') {
      // A research report already carries its 500-post selection; follow-up content only needs the
      // report text and the posts it cites (the full selection would exceed the content budget).
      const cited = (result.output.evidenceRegister || []).filter(record => record?.id && record.text).slice(0, 120).map(record => ({ id: record.id, text: String(record.text).slice(0, 4000), url: record.url || '', platform: record.platform || '', author: record.author || '', publishedAt: record.publishedAt || '' }));
      return { kind: 'report', id: asset.id, title, text, evidence: cited };
    }
    return { kind: 'report', id: asset.id, title, text, evidence: content.normalizeSource(original).evidence, aggregateMetrics: original.aggregateMetrics };
  }
  // `by` is who started the run; a research run's report runs inherit the research run's.
  function newContentRun(payload, internalWorkspace, by = null) {
    const w = internalWorkspace || workspace(payload.workspaceId); const source = sourceFromReport(payload.source || {});
    const createdBy = by ? { createdBy: { id: by.id, name: by.name } } : {};
    if (source.kind === 'research-theme') {
      // Research reports skip the generic content plan: the Golden Thread report builders own
      // their prompts, schemas and validation, and the toolkit is generated from the report.
      const deliverables = ['evidence-report', 'editorial-toolkit'].map(key => content.CONTENT_DELIVERABLES.find(d => d.id === key));
      const docs = w.referenceDocs || [];
      // Report runs write with the prompts their research run started with (its input.prompts); older runs have none.
      let parentPrompts = null; if (payload.researchRunId) { try { parentPrompts = read(file(payload.researchRunId, 'input.json')).prompts || null; } catch (_) { parentPrompts = null; } }
      const reportPrompts = pickPrompts(parentPrompts, REPORT_PROMPTS); const hasPrompts = Object.keys(reportPrompts).length > 0;
      const input = { editionId: w.editionId, source, brandKnowledge: copy(w.knowledge), productRegistry: copy(w.products), referenceDocs: copy(docs), enterpriseProducts: copy(w.enterpriseProducts || (w.editionId === 'semrush' ? SEMRUSH_ENTERPRISE_PRODUCTS : [])), deliverableIds: deliverables.map(d => d.id), research: true, ...(hasPrompts ? { prompts: reportPrompts } : {}) };
      const warnings = [...(!w.products?.length ? ['No product registry is loaded, so the toolkit’s Enterprise and self-serve angles will state the gap instead of naming products.'] : []), ...(!docs.some(doc => doc.kind === 'registry') && w.products?.length ? ['The toolkit uses the structured registry; add the registry document for the model’s full tool descriptions.'] : [])];
      const run = { id: id('content'), workspaceId: w.id, type: 'content', title: source.title || 'Research report', sourceAssetId: undefined, researchRunId: payload.researchRunId, themeId: payload.themeId, ...createdBy, status: 'queued', stage: 'content', createdAt: stamp(), maxBudgetUsd: budget(payload.maxBudgetUsd ?? 5), reservedUsd: 0, costUsd: 0, receipts: [], warnings, ai: payload.ai || null, ...(hasPrompts ? { prompts: promptRecord(reportPrompts) } : {}), jobs: deliverables.map(d => ({ id: d.id, label: w.editionId === 'semrush' && d.id === 'evidence-report' ? 'Comprehensive trends report' : d.id === 'editorial-toolkit' ? 'Editorial toolkit brief' : d.label, kind: 'text', status: 'queued' })) };
      delete run.sourceAssetId;
      write(file(run.id, 'input.json'), input); state.contentRuns.unshift(run); save(); return run;
    }
    const snapshot = promptSnapshot(w, assetPromptIds((Array.isArray(payload.deliverableIds) ? payload.deliverableIds : []).filter(key => typeof key === 'string')));
    const chosen = (Array.isArray(payload.deliverableIds) ? payload.deliverableIds : []).map(key => content.CONTENT_DELIVERABLES.find(d => d.id === key)).filter(Boolean);
    if (chosen.some(d => d.kitOnly)) throw new Error('Short videos are made in a set of channel assets.');
    // Pictures keep the brand reference images in Settings when the run starts (a copy in the run folder), so a retry
    // sends the same ones; the prompts number them. The run also keeps the AI it resolved (Model routing) now.
    const runId = id('content'); const pictures = chosen.filter(d => d.kind === 'image');
    let references = { summary: {}, roles: {} };
    try {
      if (pictures.length) references = snapshotRunReferences({ id: runId }, w, pictures);
      const input = { editionId: w.editionId, source, brandKnowledge: copy(w.knowledge), productRegistry: copy(w.products), deliverableIds: payload.deliverableIds, imageVariants: payload.imageVariants, prompts: snapshot, ...(Object.keys(references.roles).length ? { references: references.roles } : {}) };
      const plan = content.buildContentPlan(input); const run = { id: runId, workspaceId: w.id, type: 'content', title: source.title || 'Content campaign', ...(source.kind === 'report' && source.id ? { sourceAssetId: source.id } : {}), ...createdBy, status: 'queued', stage: 'content', createdAt: stamp(), maxBudgetUsd: budget(payload.maxBudgetUsd ?? 5), reservedUsd: 0, costUsd: 0, receipts: [], warnings: plan.warnings, prompts: promptRecord(snapshot), ai: { version: 2, routing: routing.snapshot(['create.drafts', ...(pictures.length ? ['pictures.content-image'] : [])]) }, ...(Object.keys(references.summary).length ? { references: references.summary } : {}), jobs: plan.deliverables.map(d => ({ id: d.id, label: d.label, kind: d.kind, status: 'queued' })) };
      write(file(run.id, 'input.json'), input); state.contentRuns.unshift(run); save(); return run;
    } catch (error) { if (pictures.length) { try { fs.rmSync(path.join(root, 'runs', runId), { recursive: true, force: true }); } catch (_) { /* the error that stopped the run is the one to report */ } } throw error; }
  }
  // ---------- Asset kits (n8n Golden Thread v2: every channel asset from one report) ----------
  // The report a kit is made from. A trend's toolkit and comprehensive report are written as a pair, so the kit reads
  // both, as n8n read the trend doc. Evidence gets short IDs (E1…) because models mis-copy long ones.
  const shortEvidence = records => (records || []).filter(record => record?.text).slice(0, 120).map((record, index) => ({ id: `E${index + 1}`, text: String(record.text).slice(0, 4000), url: record.url || '', platform: record.platform || '', author: record.author || '', publishedAt: record.publishedAt || '' }));
  function kitSource(input = {}) {
    if (!input || typeof input !== 'object') throw new Error('Choose a report, a Google Doc or pasted text.');
    if (input.kind === 'run') {
      const earlier = runRecord(input.runId); if (!earlier.kit) throw new Error('Choose an earlier set of channel assets.');
      const { sourceKey, sourceKind, reportAssetId, themeId, sourceUrl } = earlier.kit;
      return { source: read(file(earlier.id, 'input.json')).source, key: sourceKey, kind: sourceKind, ...(reportAssetId ? { reportAssetId } : {}), ...(themeId ? { themeId } : {}), ...(sourceUrl ? { url: sourceUrl } : {}) };
    }
    if (input.kind === 'report') {
      const asset = owned(state.assets, input.assetId || input.id);
      const parent = state.contentRuns.find(run => run.id === asset.runId);
      if (asset.kind !== 'text' || parent?.kit) throw new Error('Choose a written report.');
      const original = read(file(asset.runId, 'input.json')).source;
      if (original.kind === 'research-theme') {
        const parts = state.assets.filter(row => row.runId === asset.runId && ['editorial-toolkit', 'evidence-report'].includes(row.deliverableId)).sort((a, b) => (a.deliverableId === 'editorial-toolkit' ? -1 : 0) - (b.deliverableId === 'editorial-toolkit' ? -1 : 0)).map(row => ({ asset: row, result: assetResult(row) }));
        const report = parts.find(part => part.asset.deliverableId === 'evidence-report') || parts[0];
        const title = kit().cleanTitle(parts.find(part => part.result.output.theme?.name)?.result.output.theme.name || parent?.title || asset.title) || 'Trend';
        // The newest edit of either part is the one the plan mentions ("Uses Riley's edited brief").
        const edited = parts.map(part => part.result.edited).filter(Boolean).sort((a, b) => String(b.at).localeCompare(String(a.at)))[0] || null;
        return { source: { id: 'trend-brief', kind: 'report', title, text: [`# ${title}`, ...parts.map(part => part.result.markdown)].join('\n\n---\n\n'), evidence: shortEvidence(report.result.output.evidenceRegister) }, key: `theme:${parent?.themeId || asset.runId}`, kind: 'trend', reportAssetId: report.asset.id, ...(parent?.themeId ? { themeId: parent.themeId } : {}), edited };
      }
      const result = assetResult(asset);
      return { source: { id: 'report-brief', kind: 'report', title: kit().cleanTitle(asset.title) || 'Report', text: result.markdown, evidence: shortEvidence(result.evidence) }, key: `report:${asset.id}`, kind: 'report', reportAssetId: asset.id, edited: result.edited };
    }
    const text = typeof input.text === 'string' ? input.text.trim() : '';
    if (!text) throw new Error('Paste the report text, read a Google Doc, or choose a report.');
    const kind = input.kind === 'upload' ? 'upload' : 'text';
    const doc = /^https:\/\/docs\.google\.com\/document\/(?:u\/\d+\/)?d\/([a-zA-Z0-9_-]{10,200})/.exec(String(input.url || ''));
    const url = doc ? `https://docs.google.com/document/d/${doc[1]}/edit` : '';
    const title = kit().cleanTitle(input.title) || kit().titleFromText(text) || 'Pasted report';
    return { source: { id: 'brief', kind, title, text, ...(url ? { url } : {}) }, key: doc ? `gdoc:${doc[1]}` : `${kind === 'upload' ? 'file' : 'text'}:${createHash('sha256').update(text).digest('hex').slice(0, 16)}`, kind: doc ? 'google-doc' : kind === 'upload' ? 'file' : 'text', ...(url ? { url } : {}) };
  }
  // The AI tasks a kit deliverable runs: a written asset its channel's task (or Every channel asset), a picture set its art
  // direction and pictures, the short video its plan, clip and (for models that start from a picture) a first frame.
  const kitTextTask = deliverableId => (KIT_TEXT_TASKS.has(`assets.${deliverableId}`) ? `assets.${deliverableId}` : 'assets.default');
  function kitTaskIds(deliverables) {
    const ids = [];
    for (const deliverable of deliverables) {
      if (deliverable.kind === 'image') ids.push('pictures.kit-brief', 'pictures.kit-image');
      else if (deliverable.kind === 'video') { ids.push('video.brief', 'video.social-clip'); if (routing.resolve('video.social-clip').video?.input === 'image') ids.push('video.keyframe'); }
      else ids.push(kitTextTask(deliverable.id));
    }
    return [...new Set(ids)];
  }
  // Each deliverable's routed tasks for the estimate (asset-kit estimateKit tasks).
  function kitEstimateTasks(deliverables, resolve = taskId => routing.resolve(taskId), references = {}) {
    return Object.fromEntries(deliverables.map(deliverable => {
      if (deliverable.kind === 'image') return [deliverable.id, { brief: resolve('pictures.kit-brief'), image: resolve('pictures.kit-image') }];
      if (deliverable.kind === 'video') { const clip = resolve('video.social-clip'); return [deliverable.id, { brief: resolve('video.brief'), clip, ...(clip.video?.input === 'image' ? { keyframe: resolve('video.keyframe'), keyframeReferences: references['brand-image'] || 0 } : {}) }]; }
      return [deliverable.id, { text: resolve(kitTextTask(deliverable.id)) }];
    }));
  }
  function kitPlan(payload = {}) {
    const w = workspace(payload.workspaceId); const picked = kitSource(payload.source);
    const imagesReady = picturesReady(); const videoReady = videosReady();
    const offered = kit().kitDeliverableIds(w.editionId); const kindOf = id => content.CONTENT_DELIVERABLES.find(d => d.id === id).kind;
    // A short video is never in the default set: it takes minutes and costs dollars, so someone ticks it on purpose.
    let deliverableIds = offered.filter(id => kindOf(id) !== 'video' && (imagesReady || kindOf(id) !== 'image'));
    if (payload.deliverableIds != null) {
      if (!Array.isArray(payload.deliverableIds) || payload.deliverableIds.some(id => !offered.includes(id))) throw new Error('Choose assets from this kit.');
      deliverableIds = offered.filter(id => payload.deliverableIds.includes(id));
    }
    if (!deliverableIds.length) throw new Error('Choose at least one asset to make.');
    if (!imagesReady && deliverableIds.some(id => kindOf(id) === 'image')) throw new Error('Turn on pictures in Settings first, or leave the pictures out.');
    if (!videoReady && deliverableIds.some(id => kindOf(id) === 'video')) throw new Error('Connect fal.ai in Settings, AI connections to make videos, or leave the video out.');
    // One snapshot of every offered asset's prompts prices the plan and becomes the run's copy (only the chosen ones), so
    // the estimate someone approves is built from the same text the run writes with.
    const promptsAll = promptSnapshot(w, assetPromptIds(offered, { kit: true }));
    // Notes a workflow's assets step adds for the writers (only when there are some, so other kits keep their exact input).
    const teamNotes = payload.teamNotes === undefined || payload.teamNotes === '' ? '' : require('../shared/workflow-core').notesText(payload.teamNotes, 'teamNotes');
    const input = { editionId: w.editionId, source: picked.source, brandKnowledge: copy(w.knowledge), productRegistry: copy(w.products), deliverableIds, imageVariants: 3, prompts: pickPrompts(promptsAll, assetPromptIds(deliverableIds, { kit: true })), ...(teamNotes ? { teamNotes } : {}) };
    const plan = content.buildContentPlan(input);
    const ai = kitAiNow(w);
    const references = kitReferenceCounts(w);
    return { w, picked, input, plan, ai, imagesReady, videoReady, offered, references, promptsAll, estimate: kit().estimateKit({ plan, ai, references, tasks: kitEstimateTasks(plan.deliverables, undefined, references) }) };
  }
  // Every channel asset's model and effort (Model routing's assets.default), and how many a kit writes at once (the newest
  // program's batches at once, as before).
  function kitAiNow(w) {
    const legacy = kit().kitAi(state.programs.filter(program => program.workspaceId === w.id));
    const task = routing.resolve('assets.default');
    return { ...legacy, model: task.model || legacy.model, effort: task.route === 'codex' ? legacy.effort : task.effort, route: task.route, metered: task.metered };
  }
  // Pictures need an image provider on this host and a key in Settings (publicState's capabilities, without building it).
  function picturesReady() { const extra = capabilities(); return Boolean(generateImage) && Boolean(extra.imagesConfigured ?? true); }
  // Videos need the host's video maker and a ready connection for the video task (fal.ai).
  function videosReady() { const extra = capabilities(); return typeof generateVideo === 'function' && Boolean(extra.videosConfigured ?? false); }
  // The active workspace's research programs as Model routing reads them (their own stage choices; the newest one's report
  // model seeds a studio whose routing was never saved).
  function routingPrograms() {
    return (state?.programs || []).filter(program => program.workspaceId === state.activeWorkspaceId).map(program => ({ id: program.id, name: program.name, updatedAt: program.updatedAt || '', createdAt: program.createdAt || '', ai: program.ai }));
  }
  // ---------- Brand reference images (Settings → Brand reference images) ----------
  // Up to six per picture set and workspace, kept as files beside the studio state.
  const sha256 = data => createHash('sha256').update(data).digest('hex');
  function brandImageFile(workspaceId, image) {
    if (!['png', 'jpg', 'webp'].includes(image.extension)) throw new Error('That reference image record is damaged. Remove it and add the picture again.');
    const dir = path.join(root, 'brand-images', safeId(workspaceId)); fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, `${safeId(image.id)}.${image.extension}`);
  }
  function brandImageRecord(w, imageId) {
    const image = (w.brandImages || []).find(entry => entry.id === safeId(imageId));
    if (!image) throw new Error('That reference image is no longer in this workspace.');
    return image;
  }
  // How many reference images each picture deliverable would send now, e.g. { 'sel-image': 6 }.
  function kitReferenceCounts(w) {
    return Object.fromEntries(brandImages().brandImageFamilies(w.editionId).map(family => [family.deliverableId, (w.brandImages || []).filter(image => image.family === family.id).length]));
  }
  // A kit run keeps the reference images it started with. Each picture set's style examples and logo are copied into
  // the run folder, so a retry sends the same pictures and its saved variants still match, whatever changes in Settings
  // later. Copy-on-write clones take no extra space where the disk supports them (APFS). Never hard links: the run
  // folder is the Codex CLI's writable workspace, and a write there must not reach Settings or other runs.
  function snapshotKitReferences(run, w, deliverables) { return snapshotRunReferences(run, w, deliverables).summary; }
  // Any run's copy of its pictures' reference images: { summary: { [id]: { style, logo } }, roles: { [id]: [{ role }] } }.
  function snapshotRunReferences(run, w, deliverables) {
    const sets = {};
    for (const deliverable of deliverables.filter(d => d.kind === 'image')) {
      const family = brandImages().familyForDeliverable(deliverable.id);
      const chosen = family ? brandImages().orderedReferences((w.brandImages || []).filter(image => image.family === family.id)) : [];
      if (!chosen.length) continue;
      sets[deliverable.id] = chosen.map((image, index) => {
        const source = brandImageFile(w.id, image); const name = `reference-${safeId(deliverable.id)}-${index + 1}.${image.extension}`; const target = file(run.id, name);
        if (!fs.existsSync(source)) throw new Error(`The reference image “${image.name}” is missing from the studio’s data folder. Remove it in Settings → Brand reference images and add it again.`);
        fs.rmSync(target, { force: true });
        fs.copyFileSync(source, target, fs.constants.COPYFILE_FICLONE); // a plain copy where cloning isn't supported
        if (sha256(fs.readFileSync(target)) !== image.sha256) throw new Error(`The reference image “${image.name}” changed on disk. Remove it in Settings → Brand reference images and add it again.`);
        return { role: image.role, name: image.name, mime: image.mime, extension: image.extension, bytes: image.bytes, width: image.width, height: image.height, sha256: image.sha256, file: name };
      });
    }
    write(file(run.id, 'brand-references.json'), { takenAt: stamp(), sets });
    return { summary: Object.fromEntries(Object.entries(sets).map(([deliverableId, images]) => [deliverableId, brandImages().referenceSummary(images)])), roles: Object.fromEntries(Object.entries(sets).map(([deliverableId, images]) => [deliverableId, images.map(image => ({ role: image.role }))])) };
  }
  // The brand reference set a picture family sends now, read from Settings (with each picture's bytes when data is true).
  // A missing or changed file stops before anything is spent. 'none' or a family this edition doesn't have sends none.
  function currentReferenceSet(w, familyId, { data = true } = {}) {
    const family = brandImages().brandImageFamilies(w?.editionId || 'general').find(entry => entry.id === familyId);
    if (!family) return { family: 'none', label: '', images: [] };
    const images = brandImages().orderedReferences((w.brandImages || []).filter(image => image.family === family.id)).map(image => {
      const entry = { id: image.id, name: image.name, role: image.role, mime: image.mime, extension: image.extension, sha256: image.sha256 };
      if (!data) return entry;
      let bytes; try { bytes = fs.readFileSync(brandImageFile(w.id, image)); } catch (_) { throw new Error(`The reference image “${image.name}” is missing from the studio’s data folder. Remove it in Settings → Brand reference images and add it again.`); }
      if (sha256(bytes) !== image.sha256) throw new Error(`The reference image “${image.name}” changed on disk. Remove it in Settings → Brand reference images and add it again.`);
      return { ...entry, data: bytes };
    });
    return { family: family.id, label: family.label, images };
  }
  // The reference images a kit picture set started with; none for runs made before Settings kept them.
  function kitReferences(run, deliverableId) {
    const snapshot = file(run.id, 'brand-references.json'); if (!fs.existsSync(snapshot)) return [];
    const damaged = () => new Error(`A reference image saved with this run is missing or damaged, so its pictures were not drawn. ${run.kit ? 'Make a new set of channel assets' : 'Start a new run'} to use the reference images in Settings.`);
    return (read(snapshot).sets?.[deliverableId] || []).map(ref => {
      if (!/^reference-[a-zA-Z0-9_-]+-\d+\.(?:png|jpg|webp)$/.test(String(ref?.file)) || !brandImages().BRAND_IMAGE_ROLES.includes(ref.role)) throw damaged();
      let data; try { data = fs.readFileSync(file(run.id, ref.file)); } catch (_) { throw damaged(); }
      if (sha256(data) !== ref.sha256) throw damaged();
      return { ...ref, data };
    });
  }
  function saveTextAsset(run, deliverable, output) {
    const asset = { id: id('asset'), workspaceId: run.workspaceId, runId: run.id, deliverableId: deliverable.id, title: output.title, kind: 'text', channel: deliverable.channel, format: deliverable.extension || 'markdown', createdAt: stamp(), reviewStatus: 'draft' };
    write(file(run.id, `${asset.id}.json`), output); fs.writeFileSync(file(run.id, `${asset.id}.md`), content.renderContentExport(output)); fs.writeFileSync(file(run.id, `${asset.id}.html`), content.renderContentExport(output, { format: 'html' })); state.assets.unshift(asset); assetChanged(asset, 'created'); return asset;
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
    imageAccounting(run, job); save(); assetChanged(asset, 'created'); return asset;
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
      const images = await generateImage({ task: runTask(run, run.kit ? 'pictures.kit-image' : 'pictures.content-image'), deliverable, runId: run.id, input, maxBudgetUsd: allowance, isCancelled: () => stopped.has(run.id), completedVariants: completed,
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
    if (input.scanReport) return performScanReport(run, input);
    const plan = content.buildContentPlan(input);
    const perform = async job => {
      check(run); job.status = 'running'; delete job.error; save();
      const deliverable = plan.deliverables.find(d => d.id === job.id);
      try {
        if (deliverable.kind === 'image') {
          // Every picture sends its set's brand reference images (an empty list when the set has none).
          await performImages(run, job, run.kit ? await kitPicture(run, job, deliverable, input) : contentPicture(run, job, deliverable), input);
        } else if (deliverable.kind === 'video') {
          if (!run.kit) throw new Error('Short videos are made in a set of channel assets.');
          await performVideo(run, job, deliverable, input);
        } else {
          const validate = raw => content.validateContentOutput(raw, { deliverable, source: input.source, productRegistry: input.productRegistry, editionId: input.editionId });
          // A kit asset gets one repair attempt when its draft fails the checks, as research stages do.
          const task = runTask(run, run.kit ? kitTextTask(job.id) : 'create.drafts');
          const output = run.kit
            ? await aiValidated(run, `output-${job.id}`, deliverable.schema, deliverable.prompt, validate, { model: task.model, effort: task.effort, task, estimateUsd: kit().kitCallEstimate(deliverable, run.ai, task), message: `Writing ${job.label}` })
            : validate(await ai(run, `output-${job.id}`, deliverable.schema, deliverable.prompt, run.jobs.filter(j => j.status !== 'succeeded' && j.kind === 'text').length, { task }));
          job.assetId = saveTextAsset(run, deliverable, output).id;
        }
        job.status = 'succeeded';
      } catch (error) { job.status = stopped.has(run.id) ? 'cancelled' : job.assetIds?.length ? 'partial' : 'failed'; job.error = safeError(error); }
      if (run.kit) run.progress = { completed: run.jobs.filter(j => j.status === 'succeeded').length, total: run.jobs.length };
      save(); check(run);
    };
    if (run.kit) {
      // n8n wrote every channel at once; a kit writes a few at a time, with the pictures in their own lane.
      const open = run.jobs.filter(job => job.status !== 'succeeded');
      // A short video takes minutes at fal.ai, so it has a lane of its own.
      const lanes = await Promise.allSettled([pool(open.filter(job => job.kind === 'text'), run.kit.concurrency || 3, perform), pool(open.filter(job => job.kind === 'image'), 2, perform), pool(open.filter(job => job.kind === 'video'), 1, perform)]);
      const halted = lanes.find(lane => lane.status === 'rejected'); if (halted) throw halted.reason;
    } else for (const job of run.jobs) { if (job.status !== 'succeeded') await perform(job); }
    run.status = run.jobs.every(j => j.status === 'succeeded') ? 'succeeded' : run.jobs.some(j => j.status === 'succeeded' || j.assetIds?.length) ? 'partial' : 'failed';
    run.message = run.kit ? (run.status === 'succeeded' ? `All ${run.jobs.length} assets are ready.` : 'Some assets need another try. Finished ones are saved.') : run.status === 'succeeded' ? 'Drafts ready to review and export.' : 'Some outputs need attention. Completed assets are saved.';
  }
  // A kit picture set: Claude writes the art direction from the whole report once (saved, so a retry reuses it
  // and never pays twice), then only that brief goes to the image model, with the set's brand reference images.
  async function kitPicture(run, job, deliverable, input) {
    const references = kitReferences(run, job.id);
    const briefPath = file(run.id, `${safeId(job.id)}.brief.json`);
    let brief = fs.existsSync(briefPath) ? read(briefPath) : null;
    if (!brief) {
      const request = kit().imageBriefRequest(deliverable, input, { references });
      const task = runTask(run, 'pictures.kit-brief');
      brief = await aiValidated(run, `brief-${job.id}`, kit().IMAGE_BRIEF_SCHEMA, request.prompt, raw => kit().validateImageBrief(raw, request), { model: task.model, effort: task.effort, task, estimateUsd: kit().kitBriefEstimate(deliverable, run.ai, task), message: `Planning ${job.label}` });
      write(briefPath, brief); save();
    }
    const picture = kit().kitImageDeliverable(deliverable, brief, { editionId: input.editionId, label: job.label, references, prompts: input.prompts });
    // The pictures themselves, in the order the prompt numbers them (an empty list when the set has none).
    return { ...picture, references: references.map(ref => ({ role: ref.role, mime: ref.mime, data: ref.data })) };
  }
  // A Create content picture with the reference images its run started with (none for runs made before they were kept).
  function contentPicture(run, job, deliverable) {
    return { ...deliverable, references: kitReferences(run, job.id).map(ref => ({ role: ref.role, mime: ref.mime, data: ref.data })) };
  }
  // ---------- Short social video (a kit's social-video deliverable, made with fal.ai) ----------
  // The plan is written once from the report (saved, so a retry reuses it and never pays twice); when the routed video
  // model starts from a picture, a first frame is drawn with the campaign set's reference images; then the clip is made.
  const VIDEO_SIZE = { '9:16': '1024x1536', '16:9': '1536x1024', '1:1': '1024x1024' };
  async function kitVideo(run, job, deliverable, input) {
    const briefPath = file(run.id, `${safeId(job.id)}.video-brief.json`);
    const clipTask = runTask(run, 'video.social-clip');
    let brief = fs.existsSync(briefPath) ? read(briefPath) : null;
    if (!brief) {
      const task = runTask(run, 'video.brief');
      const request = kit().videoBriefRequest(deliverable, input, { durationSeconds: clipTask.video?.durationSeconds, aspectRatio: clipTask.video?.aspectRatio });
      brief = await aiValidated(run, `video-brief-${job.id}`, kit().VIDEO_BRIEF_SCHEMA, request.prompt, raw => kit().validateVideoBrief(raw, request), { model: task.model, effort: task.effort, task, estimateUsd: research.callCost(task.model || run.ai.model, task.effort || kit().BRIEF_EFFORT, research.estimateTokens(request.prompt.length), kit().VIDEO_BRIEF_OUTPUT_TOKENS, priceOptions(task)), message: `Planning ${job.label}` });
      write(briefPath, brief); save();
    }
    const plan = kit().kitVideoDeliverable(deliverable, brief, { editionId: input.editionId, prompts: input.prompts, durationSeconds: clipTask.video?.durationSeconds, aspectRatio: clipTask.video?.aspectRatio, sound: clipTask.video?.sound });
    const keyframe = clipTask.video?.input === 'image' ? await kitKeyframe(run, job, plan) : null;
    return { plan, brief, keyframe, clipTask };
  }
  // The first frame, as a picture of the campaign set (its reference images go with it), saved as <job>.keyframe.png.
  async function kitKeyframe(run, job, plan) {
    const target = file(run.id, `${safeId(job.id)}.keyframe.png`);
    if (fs.existsSync(target)) { const bytes = fs.readFileSync(target); if (validPng(bytes)) return bytes; }
    job.keyframeCalls ||= [];
    if (job.keyframeCalls.some(call => call.attempts.some(attempt => ['dispatched', 'unknown'].includes(attempt.status)))) throw new Error('An earlier first-frame request may have been billed but has no saved picture. Automatic repeat is blocked; check the provider receipts before starting a new set.');
    // The campaign set's style examples go with it (the video has no logos, so the approved logo stays out), numbered in
    // the prompt as every picture's reference images are.
    const references = kitReferences(run, 'brand-image').filter(ref => ref.role === 'style').map(ref => ({ role: ref.role, mime: ref.mime, data: ref.data }));
    const editionId = state.workspaces.find(w => w.id === run.workspaceId)?.editionId || 'general';
    const framePrompt = [plan.keyframePrompt, ...brandImages().referencePromptLines(references, { owner: brandImages().referenceOwner('campaign', editionId), dataRule: true })].join('\n');
    const allowance = Math.min(1, Math.max(.25, Math.floor((run.maxBudgetUsd - run.reservedUsd) * 100) / 100));
    if (run.maxBudgetUsd - run.reservedUsd < .05) throw new Error('Not enough of the budget is left for the video’s first frame. Raise the budget and retry.');
    const call = { id: id('keyframe-call'), status: 'running', allowanceUsd: allowance, attempts: [] }; job.keyframeCalls.push(call);
    run.reservedUsd += allowance; save();
    let spent = null;
    try {
      const [image] = await generateImage({ task: runTask(run, 'video.keyframe'), deliverable: { id: `${job.id}-keyframe`, kind: 'image', label: `${job.label} · first frame`, variants: 1, size: VIDEO_SIZE[plan.aspectRatio] || '1024x1536', variantPrompts: [framePrompt], references }, runId: run.id, maxBudgetUsd: allowance, isCancelled: () => stopped.has(run.id),
        onRequest: async receipt => { check(run); call.attempts.push({ ...copy(receipt), status: 'dispatched' }); save(); } });
      if (!image?.png || !validPng(image.png)) throw new Error('The first frame came back damaged.');
      writeBytes(target, image.png);
      spent = Number.isFinite(image.receipt?.costUsd) ? image.receipt.costUsd : null;
      Object.assign(call.attempts.at(-1) || {}, copy(image.receipt || {}), { status: 'succeeded' }); call.status = 'succeeded';
      return image.png;
    } catch (error) {
      for (const receipt of error.attemptReceipts || []) { const attempt = call.attempts.find(row => row.attemptId === receipt.attemptId); if (attempt) Object.assign(attempt, copy(receipt)); }
      call.status = 'failed';
      const attempt = call.attempts.at(-1);
      if (attempt && Number.isFinite(attempt.costUsd)) spent = attempt.costUsd; else if (!attempt || error.beforeDispatch) spent = 0;
      throw error;
    } finally {
      if (spent != null) { run.reservedUsd += spent - allowance; run.costUsd += spent; }
      run.receipts.push({ stage: `keyframe-${job.id}`, callId: call.id, allowanceUsd: allowance, status: call.status, attempts: copy(call.attempts), costUsd: spent }); save();
    }
  }
  async function performVideo(run, job, deliverable, input) {
    if (state.assets.some(asset => asset.runId === run.id && asset.deliverableId === job.id && asset.kind === 'video')) return;
    if (typeof generateVideo !== 'function') throw new Error('Videos aren’t available on this studio.');
    job.videoCalls ||= [];
    // A request fal took (it has a request id) is checked again, never sent twice; one without an id may or may not have
    // reached fal, so it blocks an automatic repeat.
    const pending = job.videoCalls.flatMap(call => call.attempts.map(attempt => ({ call, attempt }))).find(({ attempt }) => ['dispatched', 'unknown'].includes(attempt.status));
    if (pending && !pending.attempt.requestId) throw new Error('An earlier video request may have been billed but has no saved result. Automatic repeat is blocked; check fal.ai’s request history before starting a new set.');
    const { plan, brief, keyframe, clipTask } = await kitVideo(run, job, deliverable, input);
    const price = clipTask.price || {};
    const seconds = plan.durationSeconds; const unit = String(price.unit || 'second').toLowerCase();
    const estimate = Number.isFinite(price.unitUsd) ? Math.round(price.unitUsd * (/second/.test(unit) ? seconds : 1) * 100) / 100 : null;
    if (estimate == null) throw new Error(`fal.ai didn’t return a price for ${clipTask.modelLabel || clipTask.model}, so the studio can’t estimate the video. Nothing was started.`);
    let call = pending?.call; let resume = null;
    if (pending) resume = { requestId: pending.attempt.requestId, statusUrl: pending.attempt.statusUrl, responseUrl: pending.attempt.responseUrl, receipt: pending.attempt };
    else {
      const left = Math.round((run.maxBudgetUsd - run.reservedUsd) * 100) / 100;
      if (left < estimate) throw new Error(`This video needs about $${estimate.toFixed(2)} but $${left.toFixed(2)} of the budget is left. Raise the budget and retry; finished assets are kept.`);
      call = { id: id('video-call'), status: 'running', allowanceUsd: estimate, attempts: [], startedAt: stamp() }; job.videoCalls.push(call);
      run.reservedUsd += estimate; save();
    }
    const label = job.label; let lastSaved = 0;
    const progress = ({ status, queuePosition, elapsedMs }) => {
      const message = status === 'IN_QUEUE' && Number.isInteger(queuePosition) ? `Making the video · ${queuePosition} ahead in line` : `Making the video · ${Math.floor(elapsedMs / 60000)}:${String(Math.floor(elapsedMs / 1000) % 60).padStart(2, '0')}`;
      if (Date.now() - lastSaved > 4000) { lastSaved = Date.now(); run.message = `${message} · ${label}`; save(); }
    };
    let result; let failure = null;
    try {
      result = await generateVideo({ task: clipTask, prompt: plan.prompt, imageDataUri: keyframe ? `data:image/png;base64,${Buffer.from(keyframe).toString('base64')}` : '', runId: run.id, maxBudgetUsd: estimate, resume, isCancelled: () => stopped.has(run.id),
        onRequest: async receipt => { check(run); call.attempts.push({ ...copy(receipt), status: 'dispatched' }); save(); },
        onSubmitted: async receipt => { const attempt = call.attempts.find(row => row.attemptId === receipt.attemptId); if (attempt) Object.assign(attempt, { requestId: receipt.requestId, statusUrl: receipt.statusUrl, responseUrl: receipt.responseUrl, cancelUrl: receipt.cancelUrl }); save(); },
        onProgress: progress });
    } catch (error) { failure = error; }
    const receipt = result?.receipt || failure?.receipt || null;
    const attempt = receipt ? call.attempts.find(row => row.attemptId === receipt.attemptId) : call.attempts.at(-1);
    if (attempt && receipt) Object.assign(attempt, copy(receipt));
    if (attempt && failure && !receipt) attempt.status = failure.beforeDispatch ? 'failed' : 'unknown';
    const cost = Number.isFinite(attempt?.costUsd) ? attempt.costUsd : attempt?.status === 'failed' ? 0 : null;
    if (cost != null && !['dispatched', 'unknown'].includes(attempt?.status)) { run.reservedUsd = Math.max(0, run.reservedUsd + cost - call.allowanceUsd); run.costUsd += cost; call.allowanceUsd = cost; }
    call.status = result ? 'succeeded' : stopped.has(run.id) ? 'cancelled' : 'failed';
    const existing = run.receipts.findIndex(row => row.callId === call.id);
    const row = { stage: `video-${job.id}`, callId: call.id, allowanceUsd: call.allowanceUsd, status: call.status, attempts: copy(call.attempts), costUsd: cost };
    if (existing < 0) run.receipts.push(row); else run.receipts[existing] = row;
    save();
    if (failure) throw failure;
    persistVideo(run, job, deliverable, plan, brief, result, keyframe);
  }
  function persistVideo(run, job, deliverable, plan, brief, result, keyframe) {
    const assetId = `video-${createHash('sha256').update(`${run.id}:${job.id}:0`).digest('hex').slice(0, 32)}`;
    writeBytes(file(run.id, `${assetId}.mp4`), result.mp4);
    if (keyframe) writeBytes(file(run.id, `${assetId}.poster.png`), keyframe);
    const srt = kit().captionsSrt(brief.onScreenText, plan.durationSeconds); if (srt) fs.writeFileSync(file(run.id, `${assetId}.srt`), srt);
    const asset = { id: assetId, workspaceId: run.workspaceId, runId: run.id, deliverableId: deliverable.id, variantIndex: 0, kind: 'video', format: 'mp4', channel: deliverable.channel, title: brief.title || job.label, durationSeconds: plan.durationSeconds, aspectRatio: plan.aspectRatio, resolution: runTask(run, 'video.social-clip').video?.resolution || '', sound: Boolean(plan.sound), ...(Number.isFinite(result.width) ? { width: result.width } : {}), ...(Number.isFinite(result.height) ? { height: result.height } : {}), hasPoster: Boolean(keyframe), captions: [...brief.onScreenText], bytes: result.mp4.length, createdAt: stamp(), receipt: copy(result.receipt || {}), reviewStatus: 'draft' };
    state.assets = state.assets.filter(row => row.id !== assetId); state.assets.unshift(asset);
    job.assetId = asset.id; job.assetIds = [asset.id]; save();
    return asset;
  }
  // ---------- Research pipeline (n8n Golden Thread phases 2–5) ----------
  const STAGE_OUTPUT_TOKENS = { discovery: 3500, synthesis: 6000, matching: 2500, report: 8000, toolkit: 5000 };
  // A research stage's AI: the task its run snapshotted when it started (run.ai.routing), else, for runs made before Model
  // routing, the run's own models. Quick scans use their own tasks for discovery and synthesis.
  const stageTaskId = (run, stage) => (run.origin === 'quick-scan' && (stage === 'discovery' || stage === 'synthesis') ? `quickScans.${stage}` : run.origin === 'quick-scan' && stage === 'reports' ? 'quickScans.report' : stage === 'reports' ? 'reports.trends-report' : `research.${stage}`);
  function stageAi(run, stage) {
    const ai = run.ai || read(file(run.id, 'input.json')).program?.ai || research.DEFAULT_RESEARCH_AI;
    const task = runTask(run.ai ? run : { ...run, ai }, stageTaskId(run, stage));
    return { model: task.model, effort: task.effort, concurrency: ai.concurrency || research.DEFAULT_RESEARCH_AI.concurrency, task };
  }
  // The resolved AI task a run uses for taskId: its snapshot, the run's own models for an older run, else what Model
  // routing says now (a content run started before routing kept no AI choice and followed the studio default).
  function runTask(run, taskId) { return routing.resolve(taskId, run?.ai ? { run } : {}); }
  // Planning cost of one call with a resolved task's price (an OpenRouter model's live price, say).
  const priceOptions = (task) => (task?.price?.basis === 'tokens' && task.price.known ? { price: task.price, reasoning: task.price.reasoning !== false } : {});
  const estimateCall = ({ model, effort, task }, prompt, outputTokens) => research.callCost(model, effort, research.estimateTokens(prompt.length), outputTokens, priceOptions(task));
  function editionFor(run) {
    const w = state.workspaces.find(row => row.id === run.workspaceId) || {};
    return { editionId: w.editionId || 'general', brandName: w.knowledge?.name || w.name || '', workspace: w };
  }
  function activeRepository(workspaceId) {
    return state.themes.filter(theme => theme.workspaceId === workspaceId && theme.status !== 'archived').sort((a, b) => String(b.lastDetectedAt || b.updatedAt || '').localeCompare(String(a.lastDetectedAt || a.updatedAt || ''))).slice(0, 150);
  }
  // Quick scans are pulse observations and never add to a tracked theme's velocity.
  function detectionCount(workspaceId, themeId, runId) {
    return new Set((state.detections || []).filter(entry => entry.workspaceId === workspaceId && entry.themeId === themeId && entry.runId !== runId && entry.origin !== 'quick-scan').map(entry => entry.runId)).size + 1;
  }
  // Runs started before a program field existed still get every default (n8n batch sizes, models…).
  const runProgram = input => ({ ...research.validateResearchProgram(input.program), workspaceId: input.program.workspaceId });
  const withRaw = (items, rawItems) => (Array.isArray(rawItems) && rawItems.length === items.length ? items.map((item, index) => (item.raw || !rawItems[index] ? item : { ...item, raw: rawItems[index] })) : items);
  async function performDiscovery(run) {
    const input = read(file(run.id, 'input.json')); const program = runProgram(input);
    // A quick scan stops after synthesis: status 'succeeded', stage 'scan-complete', themes only in discoveredThemes.
    const quick = run.origin === 'quick-scan';
    // A scan started from Ask AI says so in that conversation (scan-empty: nothing to read or found; scan-finished: trends
    // found with the report turned off). A scan that writes its report posts once the report is done (settleScan).
    const scanDone = (message, themes = []) => { run.themes = []; run.discoveredThemes = copy(themes); run.decisions = {}; run.stage = 'scan-complete'; run.status = 'succeeded'; run.message = message; save(); runEvent(run, themes.length ? 'scan-finished' : 'scan-empty'); };
    const scanWindow = run.quickScan?.lookbackHours ? `the last ${run.quickScan.lookbackHours === 1 ? 'hour' : `${run.quickScan.lookbackHours} hours`}` : 'this window';
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
    // A quiet window is a real answer for a quick scan, not a failure.
    if (!discovery.batches.length && quick) return scanDone(evidence.items.length ? `None of the ${evidence.items.length} posts from ${scanWindow} had enough engagement to read yet. Try a longer window.` : `The chosen accounts posted nothing in ${scanWindow}. Try a longer window or more accounts.`);
    if (!discovery.batches.length) throw new Error('No evidence met the discovery engagement thresholds. Widen the date window or lower the thresholds and start a new run.');
    const edition = editionFor(run); const settings = stageAi(run, 'discovery');
    run.stage = 'discovery'; run.discoveryProgress = { completed: 0, total: discovery.batches.length }; save();
    const byBatch = new Map();
    // Lanes run per platform (X → LinkedIn → Reddit), 200 posts per batch, several batches at once.
    await pool(discovery.batches, settings.concurrency, async batch => {
      check(run); const cache = file(run.id, `${batch.id}.validated.json`); let result;
      if (fs.existsSync(cache)) result = read(cache);
      else {
        result = await discoverGroup(run, batch, batch, { program, input, edition, settings }, `Discovering trends · ${research.PLATFORM_LABELS[batch.platform]} batch ${batch.platformBatchNumber}`);
        write(cache, { ...result, platform: batch.platform, batchNumber: batch.platformBatchNumber, itemsProcessed: batch.items.length, completedAt: stamp() });
      }
      byBatch.set(batch.id, result.candidates); run.discoveryProgress.completed++; save();
    });
    const candidates = discovery.batches.flatMap(batch => byBatch.get(batch.id) || []);
    const merged = research.mergeCandidates(candidates);
    run.candidateCount = { raw: candidates.length, merged: merged.length };
    if (!merged.length && quick) return scanDone(`The scan read ${evidence.items.length} posts from ${scanWindow} but found no specific, evidence-backed trends.`);
    if (!merged.length) { run.themes = []; run.discoveredThemes = []; run.stage = 'theme-review'; run.status = 'succeeded'; run.message = 'Discovery found no specific, evidence-backed trends in this window.'; save(); runEvent(run, 'no-trends'); return; }
    const w = edition.workspace; const taxonomy = w.taxonomy || null;
    const synthesisCache = file(run.id, 'theme-synthesis.validated.json'); let synthesized;
    if (fs.existsSync(synthesisCache)) synthesized = read(synthesisCache);
    else {
      const synthesisSettings = stageAi(run, 'synthesis');
      const sources = Object.fromEntries(Object.entries(discovery.receipt.perPlatform).map(([p]) => [research.PLATFORM_LABELS[p], discovery.batches.filter(b => b.platform === p).reduce((sum, b) => sum + b.items.length, 0)]));
      const prompt = researchPrompts.synthesisPrompt({ candidates: merged, totalPosts: discovery.receipt.plannedCount, sources, maxThemes: program.maxThemes, taxonomy, query: program.query, ...edition, notes: program.notes?.research || '', blocks: snapshotBlocks(input.prompts, 'research.synthesis') });
      if (prompt.length > 2500000) throw new Error('Theme synthesis exceeds the context budget. Use a shorter window or fewer sources; every completed discovery batch is saved.');
      run.stage = 'synthesis'; save();
      try { synthesized = await aiValidated(run, 'theme-synthesis', { ...research.THEMES_SCHEMA, properties: { themes: { ...research.THEMES_SCHEMA.properties.themes, maxItems: program.maxThemes } } }, prompt, raw => research.validateThemes(raw, { runId: run.id, candidates: merged, maxThemes: program.maxThemes, taxonomy }), { ...synthesisSettings, estimateUsd: estimateCall(synthesisSettings, prompt, STAGE_OUTPUT_TOKENS.synthesis), message: 'Synthesizing the top themes' }); }
      catch (error) { throw unusableStep(run, error, 'Theme synthesis', `All ${discovery.batches.length} discovery batches are saved and won't be paid for again.`); }
      write(synthesisCache, synthesized);
    }
    let themes = synthesized.themes;
    // n8n "Match Themes": compare against the active repository; a match keeps the tracked theme's
    // stable ID (so velocity accrues) and the cleaner of the two names. Quick scans skip it: they never join the repository.
    const existing = quick ? [] : activeRepository(run.workspaceId);
    if (existing.length && themes.length) {
      const matchingCache = file(run.id, 'theme-matching.validated.json'); let matching;
      if (fs.existsSync(matchingCache)) matching = read(matchingCache);
      else {
        const matchingSettings = stageAi(run, 'matching');
        const prompt = researchPrompts.matchingPrompt({ themes, existing, ...edition, blocks: snapshotBlocks(input.prompts, 'research.matching') });
        run.stage = 'matching'; save();
        try { matching = await aiValidated(run, 'theme-matching', research.MATCHING_SCHEMA, prompt, raw => research.validateThemeMatches(raw, { themes, existing }), { ...matchingSettings, estimateUsd: estimateCall(matchingSettings, prompt, STAGE_OUTPUT_TOKENS.matching), message: 'Matching themes against the repository' }); }
        catch (error) { throw unusableStep(run, error, 'Matching themes against tracked trends', 'Discovery and theme synthesis are saved and won\u2019t be paid for again.'); }
        write(matchingCache, matching);
      }
      const byTheme = new Map(matching.matches.map(match => [match.themeId, match])); const names = new Set();
      themes = themes.map(theme => {
        const match = byTheme.get(theme.id); const previous = match?.matchedExistingId ? existing.find(row => row.id === match.matchedExistingId) : null;
        let name = match?.finalName || theme.name; if (names.has(name.toLowerCase())) name = theme.name; names.add(name.toLowerCase());
        return { ...theme, id: previous ? previous.id : theme.id, name, aliases: [...new Set([...(previous?.aliases || []), ...(previous && previous.name !== name ? [previous.name] : []), ...(theme.name !== name ? [theme.name] : [])])].slice(-50), match: { matched: !!previous, existingThemeId: previous?.id || null, existingName: previous?.name || '', nameSource: match?.nameSource || 'new', reason: match?.reason || '' } };
      });
    } else themes = themes.map(theme => ({ ...theme, match: { matched: false, existingThemeId: null, existingName: '', nameSource: 'new', reason: quick ? 'Quick scans are not matched with tracked trends.' : existing.length ? '' : 'No tracked themes yet.' } }));
    // n8n "Calculate Trend Velocity": count, velocity tier, taxonomy cross-reference, priority tier.
    themes = themes.map(theme => ({ ...theme, scoring: intel.scoreTheme({ theme, detectionCount: detectionCount(run.workspaceId, theme.id, run.id), taxonomy }) }));
    recordDetections(run, themes);
    if (quick) {
      const found = themes.length ? `Found ${themes.length} ${themes.length === 1 ? 'trend' : 'trends'} in ${evidence.items.length} posts from ${scanWindow}.` : `The scan read ${evidence.items.length} posts from ${scanWindow} but found no specific, evidence-backed trends.`;
      // Scans priced with the trends report write it now (a child report run, so its spend, receipts and retries are its
      // own); older scans and scans with the report turned off stop here, as before.
      if (!themes.length || run.quickScan?.report !== true) return scanDone(found, themes);
      run.themes = []; run.discoveredThemes = copy(themes); run.decisions = {}; run.message = `${found} Writing a short trends report…`; save();
      await writeScanReport(run, { evidence, themes, input });
      return settleScan(run, found);
    }
    run.themes = themes; run.discoveredThemes = copy(themes); run.decisions = {}; run.stage = 'theme-review';
    if (program.autoApproveThemes) {
      run.decisions = Object.fromEntries(themes.map(theme => [theme.id, 'approved'])); run.approvedAt = stamp(); run.autoApproved = true;
      run.decisionsBy = Object.fromEntries(themes.map(theme => [theme.id, { ...SYSTEM, at: run.approvedAt }])); run.message = 'Themes approved automatically; tagging every post.'; save();
      return performClassification(run);
    }
    run.status = 'awaiting-review'; run.message = 'Review and approve themes before classifying evidence and generating reports.'; save();
    runEvent(run, 'trends-ready'); // a run started from Ask AI posts its trends there for Yes or Skip
  }
  // Every detection names its origin. A quick scan's are pulse observations for trend history: they never join the tracked
  // repository (matching, velocity, the Trend board) unless someone promotes a theme.
  function recordDetections(run, themes) {
    const now = stamp(); const origin = run.origin === 'quick-scan' ? 'quick-scan' : 'research';
    state.detections = (state.detections || []).filter(entry => entry.runId !== run.id);
    for (const theme of themes) {
      state.detections.push({ workspaceId: run.workspaceId, themeId: theme.id, runId: run.id, name: theme.name, detectedAt: now, origin });
      if (origin === 'quick-scan') continue;
      const previous = state.themes.find(row => row.workspaceId === run.workspaceId && row.id === theme.id);
      const { candidateIds: _c, evidenceIds: _e, runId: _r, ...fields } = theme;
      const entry = { ...(previous || {}), ...fields, workspaceId: run.workspaceId, status: previous?.status === 'archived' ? 'active' : previous?.status || 'active', firstDetectedAt: previous?.firstDetectedAt || now, lastDetectedAt: now, detectionCount: theme.scoring.count, lastRunId: run.id, evidenceCount: theme.evidenceCount, updatedAt: now };
      state.themes = state.themes.filter(row => !(row.workspaceId === run.workspaceId && row.id === theme.id)); state.themes.push(entry);
    }
  }
  // Discovery works the same way as tagging below: a batch whose answer is still rejected after its repair (or isn't
  // JSON) is split in half and each half read on its own. Halves below DISCOVERY_MIN_SPLIT posts aren't split again:
  // that group adds no candidates and the run says so. Cancellation, budget and provider errors still stop the run.
  const DISCOVERY_MIN_SPLIT = 40;
  async function discoverGroup(run, batch, group, { program, input, edition, settings }, label) {
    const prompt = researchPrompts.discoveryPrompt({ batch: group, query: program.query, ...edition, notes: program.notes?.research || '', blocks: snapshotBlocks(input.prompts, 'research.discovery') });
    try {
      const result = await aiValidated(run, group.id, research.DISCOVERY_SCHEMA, prompt, raw => research.validateCandidates(raw, { runId: run.id, batch: group }), { ...settings, estimateUsd: estimateCall(settings, prompt, STAGE_OUTPUT_TOKENS.discovery), message: label });
      return { ...result, candidates: result.candidates.map(candidate => ({ ...candidate, batchId: batch.id })) };
    } catch (error) {
      if (!unusableOutput(run, error)) throw error;
      const where = `${research.PLATFORM_LABELS[batch.platform]} discovery batch ${batch.platformBatchNumber}`;
      if (group.items.length < DISCOVERY_MIN_SPLIT) {
        run.warnings = [...new Set([...(run.warnings || []), `${where}: ${group.items.length} posts could not be read after repeated attempts (${safeError(error).slice(0, 160)}), so they add no trend candidates. The rest of the run is unaffected.`])];
        return { candidates: [], receipt: { runId: run.id, batchId: group.id, inputCount: group.items.length, candidateCount: 0, citedCount: 0, unreadCount: group.items.length } };
      }
      run.warnings = [...new Set([...(run.warnings || []), `${where}: a discovery response was rejected (${safeError(error).slice(0, 160)}), so its posts were read again in smaller groups.`])];
      const half = Math.ceil(group.items.length / 2); const results = [];
      for (const [index, items] of [group.items.slice(0, half), group.items.slice(half)].entries()) {
        const part = { ...group, id: `${group.id}-${index + 1}`, items, evidenceIds: items.map(item => item.id) };
        results.push(await discoverGroup(run, batch, part, { program, input, edition, settings }, `${label} (smaller group ${index + 1} of 2)`));
      }
      const candidates = research.mergeCandidates(results.flatMap(r => r.candidates)).map(({ sourceCandidateIds: _s, batchCount: _b, ...candidate }) => ({ ...candidate, id: `candidate-${createHash('sha256').update(`${run.id}:${batch.id}:${candidate.name.toLowerCase()}`).digest('hex').slice(0, 24)}`, batchId: batch.id }));
      return { candidates, receipt: { runId: run.id, batchId: batch.id, inputCount: group.items.length, candidateCount: candidates.length, citedCount: new Set(candidates.flatMap(c => c.evidenceIds)).size, unreadCount: results.reduce((sum, r) => sum + (r.receipt?.unreadCount || 0), 0), split: true } };
    }
  }
  // A response the validator still rejects after its repair attempt (or that isn't JSON) is a problem
  // with this group of posts, not with the run: the group is split in half and each half tagged on its
  // own, down to single posts, and a post that still can't be tagged is recorded as unclassified.
  // Cancellation, budget and provider errors still stop the run (finished batches are kept).
  const unusableOutput = (run, error) => !stopped.has(run.id) && (error?.field !== undefined || error instanceof SyntaxError);
  async function tagGroup(run, batch, group, validate, settings, edition, label) {
    const prompt = researchPrompts.taggingPrompt({ batch: group, themes: run.themes, ...edition });
    try {
      return await aiValidated(run, group.id, research.ASSIGNMENTS_SCHEMA, prompt, validate(group), { ...settings, estimateUsd: estimateCall(settings, prompt, group.items.length * 110), message: label });
    } catch (error) {
      if (!unusableOutput(run, error)) throw error;
      const note = `${research.PLATFORM_LABELS[batch.platform]} batch ${batch.platformBatchNumber}: a tagging response was rejected (${safeError(error).slice(0, 160)}), so its posts were retagged in smaller groups.`;
      run.warnings = [...new Set([...(run.warnings || []), note])];
      if (group.items.length < 2) return { assignments: [], missingIds: group.items.map(item => item.id) };
      const half = Math.ceil(group.items.length / 2); const parts = [group.items.slice(0, half), group.items.slice(half)];
      const results = [];
      for (const [index, items] of parts.entries()) {
        const part = { ...group, id: `${group.id}-${index + 1}`, items, evidenceIds: items.map(item => item.id) };
        results.push(await tagGroup(run, batch, part, validate, settings, edition, `${label} (smaller group ${index + 1} of 2)`));
      }
      return { assignments: results.flatMap(r => r.assignments), missingIds: results.flatMap(r => r.missingIds) };
    }
  }
  async function classifyBatch(run, program, batch, settings, edition) {
    const cache = file(run.id, `${batch.id}.validated.json`);
    if (fs.existsSync(cache)) return read(cache);
    const validate = target => raw => research.validateAssignments(raw, { runId: run.id, batch: target, themes: run.themes, confidenceThreshold: program.confidenceThreshold, autoAcceptThreshold: program.autoAcceptThreshold });
    const label = `Tagging posts · ${research.PLATFORM_LABELS[batch.platform]} batch ${batch.platformBatchNumber}`;
    let result = await tagGroup(run, batch, batch, validate, settings, edition, label);
    let assignments = result.assignments.map(row => ({ ...row, batchId: batch.id })); let missing = result.missingIds;
    if (missing.length) {
      // One focused retry for posts the model skipped; anything still missing is recorded as unclassified.
      const subset = { ...batch, id: `${batch.id}-missing`, items: batch.items.filter(item => missing.includes(item.id)), evidenceIds: missing };
      const retry = await tagGroup(run, batch, subset, validate, settings, edition, `${label} (retrying ${missing.length} skipped posts)`);
      assignments = [...assignments, ...retry.assignments.map(row => ({ ...row, batchId: batch.id }))]; missing = retry.missingIds;
      if (missing.length) { assignments.push(...research.unclassifiedAssignments({ runId: run.id, batch, itemIds: missing })); run.warnings = [...new Set([...(run.warnings || []), `${missing.length} posts in ${research.PLATFORM_LABELS[batch.platform]} batch ${batch.platformBatchNumber} were not returned by the classifier and are marked unclassified.`])]; }
    }
    result = { assignments, missingIds: [], unclassifiedIds: missing, platform: batch.platform, batchNumber: batch.platformBatchNumber, completedAt: stamp() };
    write(cache, result); return result;
  }
  async function performClassification(run) {
    const input = read(file(run.id, 'input.json')); const program = runProgram(input); const evidence = read(file(run.id, 'evidence.json'));
    const { batches } = research.buildAssignmentBatches({ runId: run.id, items: evidence.items, batchSize: program.taggingBatchSize, batchSizes: program.taggingBatchSizes });
    // The tagging prompt's text travels with the edition fields into taggingPrompt (and its missing-posts retry).
    const edition = { ...editionFor(run), blocks: snapshotBlocks(input.prompts, 'research.tagging') }; const settings = stageAi(run, 'tagging');
    run.stage = 'classification'; run.assignmentProgress = { completed: 0, total: batches.length }; save();
    const byBatch = new Map();
    await pool(batches, settings.concurrency, async batch => { check(run); byBatch.set(batch.id, (await classifyBatch(run, program, batch, settings, edition)).assignments); run.assignmentProgress.completed++; save(); });
    let assignments = []; for (const batch of batches) assignments = research.applyAssignments(assignments, byBatch.get(batch.id) || []);
    write(file(run.id, 'assignments.json'), assignments); run.stage = 'reports';
    writeThemeStats(run, evidence.items, assignments); // the Trend tracker's per-theme numbers, kept beside the tags
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
      const payload = { theme: { id: theme.id, name: theme.name, description: theme.description, matchingKeywords: theme.matchingKeywords, matchingCriteria: theme.matchingCriteria, negativeCriteria: theme.negativeCriteria, novelty: theme.novelty, taxonomyCategory: theme.taxonomyCategory }, selection, brandName: w.editionId === 'semrush' ? 'Semrush' : (w.knowledge?.name || w.name), analysisFocus: w.editionId === 'semrush' ? 'SEO Trends' : (program.query || w.knowledge?.audience || ''), targetAudience: w.editionId === 'semrush' ? 'SEO Professionals' : (w.knowledge?.audience || ''), ...(program.notes?.reports ? { notes: program.notes.reports } : {}) };
      const source = { kind: 'research-theme', id: `${run.id}-${theme.id}`, title: theme.name, text: `${theme.name}: ${theme.description}`, evidence: selection.posts.map(post => ({ id: post.id, text: post.text, url: post.url, platform: post.platform, author: post.author, publishedAt: post.date || post.publishedAt || '' })), research: payload };
      const remainingThemes = run.themes.length - run.reportRunIds.length;
      const estimate = reportEstimate(reportSettings, selection);
      const allocation = Math.floor(Math.min(run.maxBudgetUsd - run.reservedUsd, Math.max(estimate * 2.5, (run.maxBudgetUsd - run.reservedUsd) / remainingThemes)) * 100) / 100;
      if (allocation < Math.min(estimate, 1)) throw new Error(`Not enough AI budget remains for the paired reports (about $${estimate.toFixed(2)} each). Increase the run budget before retrying.`);
      const reportRun = newContentRun({ source, maxBudgetUsd: allocation, researchRunId: run.id, themeId: theme.id, ai: { model: reportSettings.model, effort: reportSettings.effort, version: 2, routing: { 'reports.trends-report': reportSettings.task, 'reports.editorial-toolkit': runTask(run, 'reports.editorial-toolkit') } } }, w, run.createdBy || null);
      run.reportRunIds.push({ themeId: theme.id, runId: reportRun.id }); run.reservedUsd += allocation; save(); await launchAndWait(reportRun, () => performContent(reportRun)); check(run);
      // Unused report budget returns to the research run.
      run.reservedUsd -= Math.max(0, allocation - reportRun.reservedUsd); save();
    }
    run.status = run.reportRunIds.length && run.reportRunIds.every(entry => state.contentRuns.find(r => r.id === entry.runId)?.status === 'succeeded') ? 'succeeded' : run.reportRunIds.length ? 'partial' : 'succeeded'; run.message = 'Classification complete. Review the paired reports and any outputs needing attention.';
    // A program's own "Publish reports to Google Drive" (before the folder sync) runs only while no Drive folder is
    // connected; once one is, Settings → Google Drive's studio-wide switch decides (hooks.legacyDrivePublish).
    if (legacyDrivePublish(program) && publishCampaign && run.reportRunIds.length) {
      try { await publishRun(run); run.message = 'Reports are ready and published to Google Drive.'; }
      catch (error) { run.warnings = [...new Set([...(run.warnings || []), `Google Drive publishing needs attention: ${safeError(error)}`])]; }
    }
    // A run started from Ask AI posts its finished reports there: each trend's trends report (else its first document).
    const written = (run.reportRunIds || []).map(entry => ({ entry, child: state.contentRuns.find(r => r.id === entry.runId) })).filter(({ child }) => child?.status === 'succeeded');
    if (written.length) runEvent(run, 'reports-ready', { reports: written.map(({ entry, child }) => { const own = state.assets.filter(asset => asset.runId === child.id && asset.kind === 'text'); const asset = own.find(row => row.deliverableId === 'evidence-report') || own[0]; return asset ? { assetId: asset.id, title: asset.title, themeId: entry.themeId, themeName: (run.themes || []).find(theme => theme.id === entry.themeId)?.name || child.title || '', createdAt: asset.createdAt } : null; }).filter(Boolean) });
  }
  function reportEstimate(settings, selection) {
    const characters = (selection.posts || []).reduce((sum, post) => sum + String(post.text || '').length + 260, 0) + 12000;
    return research.callCost(settings.model, settings.effort, research.estimateTokens(characters), STAGE_OUTPUT_TOKENS.report, priceOptions(settings.task)) + research.callCost(settings.model, settings.effort, 38000, STAGE_OUTPUT_TOKENS.toolkit, priceOptions(settings.task));
  }
  async function performResearchReports(run, input) {
    // The report and toolkit tasks the research run handed this run (an older report run keeps its own model and effort).
    const settingsFor = (taskId) => { const task = runTask(run, taskId); return { model: task.model, effort: task.effort, task }; };
    const reportSettings = settingsFor('reports.trends-report'); const toolkitSettings = settingsFor('reports.editorial-toolkit');
    const { research: payload } = input.source; const lib = reports();
    for (const job of run.jobs) {
      if (job.status === 'succeeded') continue; check(run); job.status = 'running'; delete job.error; save();
      const deliverable = content.CONTENT_DELIVERABLES.find(d => d.id === job.id);
      try {
        let output;
        if (job.id === 'evidence-report') {
          const request = lib.buildTrendReportRequest({ theme: payload.theme, selection: payload.selection, editionId: input.editionId, brandName: payload.brandName, analysisFocus: payload.analysisFocus, targetAudience: payload.targetAudience, notes: payload.notes || '', blocks: snapshotBlocks(input.prompts, 'reports.trends-report') });
          output = await aiValidated(run, `output-${job.id}`, request.schema, request.prompt, (raw, opts) => lib.validateTrendReport(raw, request.context, opts), { ...reportSettings, estimateUsd: estimateCall(reportSettings, request.prompt, STAGE_OUTPUT_TOKENS.report), message: `Writing the trends report · ${payload.theme.name}`, timeoutMs: 2400000 });
        } else {
          const reportJob = run.jobs.find(entry => entry.id === 'evidence-report');
          if (reportJob?.status !== 'succeeded' || !reportJob.assetId) throw new Error('The editorial toolkit is built from the trends report. Generate the report first.');
          const trendReport = read(file(run.id, `${reportJob.assetId}.json`));
          const registryDoc = (input.referenceDocs || []).find(doc => doc.kind === 'registry');
          const request = lib.buildToolkitRequest({ theme: payload.theme, trendReport, trendReportMarkdown: content.renderContentExport(trendReport), metrics: payload.selection.metrics, registryText: registryDoc?.text || '', products: input.productRegistry || [], referenceDocs: (input.referenceDocs || []).filter(doc => doc.kind !== 'registry'), enterpriseProducts: input.enterpriseProducts || [], editionId: input.editionId, brandName: payload.brandName, notes: payload.notes || '', blocks: snapshotBlocks(input.prompts, 'reports.editorial-toolkit') });
          output = await aiValidated(run, `output-${job.id}`, request.schema, request.prompt, (raw, opts) => lib.validateToolkit(raw, request.context, opts).output, { ...toolkitSettings, estimateUsd: estimateCall(toolkitSettings, request.prompt, STAGE_OUTPUT_TOKENS.toolkit), message: `Writing the editorial toolkit · ${payload.theme.name}`, timeoutMs: 2400000 });
        }
        job.assetId = saveTextAsset(run, deliverable, output).id; job.status = 'succeeded';
      } catch (error) { job.status = stopped.has(run.id) ? 'cancelled' : 'failed'; job.error = safeError(unusableStep(run, error, `The ${job.label || 'report'} draft`, 'Finished reports are kept.')); }
      save(); check(run);
    }
    run.status = run.jobs.every(j => j.status === 'succeeded') ? 'succeeded' : run.jobs.some(j => j.status === 'succeeded') ? 'partial' : 'failed';
    run.message = run.status === 'succeeded' ? 'Trends report and editorial toolkit ready to review.' : 'Some outputs need attention. Completed reports are saved.';
  }
  // ---------- Quick scan trends report and Ask AI follow-ups (SPEC-3) ----------
  const scanReports = () => require('../shared/research-scan-report');
  const ASK_CONVERSATION = /^ask-[0-9a-f-]{36}$/; const ASK_MESSAGE = /^msg-[0-9a-f-]{36}$/;
  const cents = value => Math.round((Number(value) || 0) * 100) / 100;
  const centsDown = value => Math.floor((Number(value) || 0) * 100) / 100;
  const centsUp = value => Math.ceil((Number(value) || 0) * 100) / 100;
  const dollars = value => `$${cents(value).toFixed(2)}`;
  // The Ask AI conversation a start came from ({ conversationId, messageId?, actionIndex? }), checked; a bad link is
  // dropped, so a paid start never fails because of it. Follow-ups go to whoever started the run (`by`), never to a person
  // the payload names, so a made-up conversation id can only reach the caller's own conversations.
  function askLink(value, by) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !by?.id || by.id === SYSTEM.id) return null;
    const conversationId = typeof value.conversationId === 'string' && ASK_CONVERSATION.test(value.conversationId) ? value.conversationId : '';
    if (!conversationId) return null;
    const messageId = typeof value.messageId === 'string' && ASK_MESSAGE.test(value.messageId) ? value.messageId : '';
    const actionIndex = Number.isInteger(value.actionIndex) && value.actionIndex >= 0 && value.actionIndex < 50 ? value.actionIndex : -1;
    return { identityId: by.id, conversationId, messageId, actionIndex, posted: {} };
  }
  // Quick scans keep the link with their scan settings (quickScan.ask); full research runs on the run itself (ask).
  function askOf(run) { const ask = run?.quickScan?.ask || run?.ask; return ask && typeof ask === 'object' && ask.conversationId ? ask : null; }
  // One follow-up per event (key: the event, plus the attempt when it can happen again), posted through the host. A host
  // failure is logged and never fails the run; a run with no conversation, or a host without onRunEvent, posts nothing.
  function runEvent(run, type, extra = {}) {
    const ask = askOf(run); if (!ask || typeof onRunEvent !== 'function') return null;
    const key = extra.attempt ? `${type}:${extra.attempt}` : type;
    if (!ask.posted || typeof ask.posted !== 'object') ask.posted = {};
    if (ask.posted[key]) return null;
    const record = result => {
      if (!result?.messageId) return null;
      ask.posted[key] = { messageId: String(result.messageId).slice(0, 80), at: stamp() };
      run.followUpAt = ask.posted[key].at; save(); return result;
    };
    const skip = error => { console.error(`The Ask AI follow-up for ${run.id} (${key}) wasn’t posted: ${safeError(error)}`); return null; };
    try {
      const programName = state.programs.find(program => program.id === run.programId && program.workspaceId === run.workspaceId)?.name || '';
      const result = onRunEvent({ type, key, identityId: ask.identityId, conversationId: ask.conversationId, messageId: ask.messageId || '', actionIndex: Number.isInteger(ask.actionIndex) ? ask.actionIndex : -1, workspaceId: run.workspaceId, programName, run: publicRun(run), ...extra });
      return result && typeof result.then === 'function' ? result.then(record, skip) : record(result);
    } catch (error) { return skip(error); }
  }
  // The report's model and effort, as the scan priced them (quickScanPlan puts the routed ones in the run's reports stage).
  const scanReportAi = run => { const settings = stageAi(run, 'reports'); return { model: settings.model, effort: settings.effort, task: settings.task }; };
  // A quick scan's trends report: a child report run (run.scanReport.runId) the scan's AI cap pays for. The scan calls this
  // when it finds trends, and a retry of the scan calls it again, which relaunches only a report that didn't finish. One
  // try and one repair fit the allowance; when the cap can't cover even one try, nothing is called and the report waits
  // for Retry report, whose confirmation names what it may spend.
  async function writeScanReport(run, { evidence, themes, input }) {
    const lib = scanReports(); const settings = scanReportAi(run);
    const unmetered = settings.task ? settings.task.metered === false : capabilities().aiProvider === 'codex';
    let child = run.scanReport?.runId ? state.contentRuns.find(row => row.id === run.scanReport.runId) || null : null;
    if (child?.status === 'succeeded') return finishScanReport(run, child);
    if (child && active.has(child.id)) { await active.get(child.id); check(run); return finishScanReport(run, child); }
    const left = cents(run.maxBudgetUsd - run.reservedUsd);
    let allocation = 0;
    if (!child) {
      const w = workspace(run.workspaceId, false); const edition = editionFor(run);
      const scan = lib.scanSummary({ run, themes, postCount: evidence.items.length });
      const selection = lib.selectScanEvidence({ themes: themes.slice(0, scan.themes.length), items: evidence.items });
      const prompts = pickPrompts(input.prompts, [lib.PROMPT_ID, 'system.repair']);
      const audience = w.editionId === 'semrush' ? '' : String(w.knowledge?.audience || '');
      const request = lib.buildScanReportRequest({ scan, selection, editionId: edition.editionId, brandName: edition.brandName, audience, blocks: snapshotBlocks(prompts, lib.PROMPT_ID) });
      const estimate = estimateCall(settings, request.prompt, lib.OUTPUT_TOKENS); const enough = Math.max(.6, estimate * 4);
      const short = !unmetered && left < Math.max(.01, estimate);
      const reason = short ? `Not enough of the ${dollars(run.maxBudgetUsd)} AI cap is left for the trends report (about ${dollars(Math.max(.01, estimate))}).` : '';
      allocation = short ? 0 : unmetered ? Math.max(.01, centsDown(Math.min(Math.max(left, .01), enough))) : centsDown(Math.min(left, enough));
      child = {
        id: id('content'), workspaceId: run.workspaceId, type: 'content', title: lib.scanReportTitle(scan.topic, run.createdAt), researchRunId: run.id, scanReport: true,
        ...(run.createdBy ? { createdBy: { id: run.createdBy.id, name: run.createdBy.name } } : {}), status: short ? 'failed' : 'queued', stage: 'content', createdAt: stamp(),
        // Short of budget, the allowance is what one try needs; it is only spent after Retry report is confirmed.
        maxBudgetUsd: short ? Math.min(1000, centsUp(enough)) : allocation, reservedUsd: 0, costUsd: 0, receipts: [], warnings: [], ...(short ? { message: reason } : {}),
        ai: { model: settings.model, effort: settings.effort, ...(unmetered ? { route: 'codex' } : {}), ...(settings.task ? { version: 2, routing: { 'quickScans.report': settings.task } } : {}) }, prompts: promptRecord(prompts),
        jobs: [{ id: lib.SCAN_REPORT_DELIVERABLE.id, label: 'Quick scan trends report', kind: 'text', status: short ? 'failed' : 'queued', ...(short ? { error: reason } : {}) }],
      };
      write(file(child.id, 'input.json'), { editionId: edition.editionId, scanReport: true, source: lib.scanSource(scan, selection), scan, selection, brandName: edition.brandName, audience, prompts });
      state.contentRuns.unshift(child);
      run.scanReport = { runId: child.id, status: child.status, assetId: '', title: '', estimateUsd: cents(Math.max(.01, estimate)), attempts: 0, error: reason, ...(short ? { reason: 'budget' } : {}) };
      if (short) { save(); return run.scanReport; }
    } else {
      // The scan is being tried again: the report run gets back to one full try from what is left of the scan's cap.
      const room = cents(child.maxBudgetUsd - child.reservedUsd); const enough = Math.max(.6, (Number(run.scanReport?.estimateUsd) || .1) * 4);
      if (!unmetered && room < enough && left > 0) { allocation = centsDown(Math.min(left, enough - room)); child.maxBudgetUsd = cents(child.maxBudgetUsd + allocation); }
      for (const job of child.jobs || []) if (job.status !== 'succeeded') { job.status = 'queued'; delete job.error; }
    }
    run.reservedUsd += allocation;
    run.stage = 'scan-report'; run.message = `Writing the trends report · ${run.quickScan?.topic || run.title}`;
    run.scanReport = { ...run.scanReport, status: 'running', attempts: (Number(run.scanReport.attempts) || 0) + 1, error: '' }; delete run.scanReport.reason; save();
    const before = child.reservedUsd;
    await launchAndWait(child, () => performContent(child));
    // What the try didn't use goes back to the scan; a report that didn't finish keeps room for one more try (Retry report).
    run.reservedUsd = Math.max(0, cents(run.reservedUsd - Math.max(0, allocation - (child.reservedUsd - before))));
    if (child.status !== 'succeeded') roomForRetry(child, run.scanReport.estimateUsd);
    save(); check(run);
    return finishScanReport(run, child);
  }
  // A report run that didn't finish keeps an allowance of one full try, which Retry report's confirmation shows.
  function roomForRetry(child, estimateUsd) {
    const enough = Math.max(.6, (Number(estimateUsd) || .1) * 4);
    if (cents(child.maxBudgetUsd - child.reservedUsd) < enough) child.maxBudgetUsd = Math.min(1000, centsUp(child.reservedUsd + enough));
  }
  // The report run's outcome on the scan (run.scanReport: { runId, status, assetId, title, estimateUsd, attempts, error }).
  function finishScanReport(run, child) {
    const job = (child.jobs || [])[0] || {}; const asset = job.assetId ? state.assets.find(row => row.id === job.assetId) : null;
    const status = job.status === 'succeeded' && asset ? 'succeeded' : stopped.has(child.id) || child.status === 'cancelled' || job.status === 'cancelled' ? 'cancelled' : 'failed';
    run.scanReport = { ...(run.scanReport || {}), runId: child.id, status, assetId: asset?.id || '', title: asset?.title || '', error: status === 'succeeded' ? '' : String(safeError(job.error || child.message || 'It stopped early.')).slice(0, 400) };
    save(); return run.scanReport;
  }
  const reportProblem = report => (report.reason === 'budget'
    ? `${report.error} Retry report writes it; you’ll see what it can spend first.`
    : report.status === 'cancelled' ? 'The trends report was stopped. Retry report writes it; the posts aren’t collected again.'
      : `The trends report didn’t finish: ${String(report.error || 'it stopped early').replace(/[.\s]+$/, '')}. Retry report writes only the report; the posts aren’t collected again.`);
  // What the conversation is told about a finished report.
  function scanReportFacts(run) {
    const asset = state.assets.find(row => row.id === run.scanReport?.assetId) || null; const child = state.contentRuns.find(row => row.id === run.scanReport?.runId) || null;
    let summary = ''; try { summary = asset ? String(read(file(asset.runId, `${asset.id}.json`)).summary || '') : ''; } catch (_) { summary = ''; }
    return { assetId: asset?.id || '', title: asset?.title || '', summary: summary.slice(0, 600), childRunId: child?.id || '', costUsd: Number(child?.costUsd) || 0, model: child?.ai?.model || '', route: child?.ai?.route || '' };
  }
  // The scan found its trends, so it is done either way; the message, and the follow-up posted in Ask AI, say whether the
  // report is ready. A report that didn't finish is retried on its own (Retry report). Stopping the scan stops both.
  function settleScan(run, found) {
    if (stopped.has(run.id)) throw new Error('Run cancelled.');
    run.stage = 'scan-complete'; run.status = 'succeeded'; run.scanReport = { ...(run.scanReport || {}), found };
    announceScanReport(run);
  }
  function announceScanReport(run) {
    const report = run.scanReport || {}; const found = report.found || '';
    if (report.status === 'succeeded') { run.message = `${found} The trends report is ready.`.trim(); save(); runEvent(run, 'scan-report-ready', { report: scanReportFacts(run) }); return; }
    run.message = `${found} ${reportProblem(report)}`.trim(); save();
    // Each try that fails is said once (a skip for budget is its own), so a Retry report that fails again is still told.
    if (report.status !== 'cancelled') runEvent(run, 'scan-report-failed', { attempt: report.reason === 'budget' ? 'budget' : Number(report.attempts) || 1, error: report.error || '' });
  }
  // Retry report: the report run alone tries again (the scan stays done), within the allowance its confirmation showed;
  // the scan's record and its conversation hear how it went.
  function retryScanReportRun(child) {
    const parent = state.researchRuns.find(row => row.id === child.researchRunId && row.workspaceId === child.workspaceId) || null;
    if (parent && active.has(parent.id)) throw new Error('The quick scan is still running; it writes its report when it finishes.');
    for (const job of child.jobs || []) if (job.status !== 'succeeded') { job.status = 'queued'; delete job.error; }
    delete child.message;
    if (parent) { parent.scanReport = { ...(parent.scanReport || {}), runId: child.id, status: 'running', error: '', attempts: (Number(parent.scanReport?.attempts) || 0) + 1 }; delete parent.scanReport.reason; parent.message = `${parent.scanReport.found || ''} Writing the trends report again…`.trim(); save(); }
    return launch(child, async () => {
      try { await performContent(child); }
      finally { if (parent) { if (child.status !== 'succeeded') roomForRetry(child, parent.scanReport.estimateUsd); finishScanReport(parent, child); announceScanReport(parent); } }
    });
  }
  // The report run's one job: the request built from what the scan saved (input.scan, input.selection) and the prompt copy
  // it started with, checked by validateScanReport (one repair), saved as a report asset.
  async function performScanReport(run, input) {
    const lib = scanReports(); const job = (run.jobs || [])[0];
    if (!job) throw new Error('This report run has nothing to write.');
    const routedTask = run.ai?.routing?.['quickScans.report'] || null; // the scan's report task, kept with the report run
    const settings = { model: routedTask?.model ?? (run.ai?.model || research.DEFAULT_RESEARCH_AI.models.synthesis), effort: routedTask ? routedTask.effort : run.ai?.effort || '', ...(routedTask ? { task: routedTask } : {}) };
    if (job.status !== 'succeeded') {
      check(run); job.status = 'running'; delete job.error; save();
      try {
        const request = lib.buildScanReportRequest({ scan: input.scan, selection: input.selection, editionId: input.editionId, brandName: input.brandName || '', audience: input.audience || '', blocks: snapshotBlocks(input.prompts, lib.PROMPT_ID) });
        const output = await aiValidated(run, 'output-scan-report', request.schema, request.prompt, raw => lib.validateScanReport(raw, request.context), { ...settings, estimateUsd: estimateCall(settings, request.prompt, lib.OUTPUT_TOKENS), message: `Writing the trends report · ${input.scan?.topic || ''}`, timeoutMs: 900000 });
        job.assetId = saveTextAsset(run, lib.SCAN_REPORT_DELIVERABLE, output).id; job.status = 'succeeded';
      } catch (error) { job.status = stopped.has(run.id) ? 'cancelled' : 'failed'; job.error = safeError(error); }
      save(); check(run);
    }
    run.status = job.status === 'succeeded' ? 'succeeded' : 'failed';
    run.message = job.status === 'succeeded' ? 'Trends report ready.' : `The trends report needs another try: ${job.error || 'it stopped early.'}`;
  }
  // A file Drive was sent never changes (both delivery routes refuse a changed asset under the same id), so an edited
  // report or draft is delivered as its own file next to the original, under an id stamped with the edit's time. Each
  // later edit is another new file; Restore goes back to the original's id, which Drive already has.
  function deliveryId(asset) {
    const at = Date.parse(asset.edited?.at || '');
    return asset.kind === 'text' && Number.isFinite(at) && assetFile(asset, 'html') === editedFile(asset, 'html') ? `${asset.id}-edited-${at}` : asset.id;
  }
  const docLink = entry => entry?.files?.find(f => /docs\.google\.com/.test(f.url || ''))?.url || '';
  // The Google Doc of the version of a report Drive has now: the edited copy when that was delivered, else the original.
  function deliveredDoc(receipt, asset) { const rows = receipt?.assets || []; return docLink(rows.find(row => row.assetId === deliveryId(asset))) || docLink(rows.find(row => row.assetId === asset.id)); }
  // n8n names: trend report "Priority_Trends_<Theme>_<yyyy-MM-dd_HH-mm>", toolkit "<Theme>__<yyyy-MM-dd_HH-mm>".
  function docStamp(value) { const date = new Date(value); const pad = number => String(number).padStart(2, '0'); return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}_${pad(date.getUTCHours())}-${pad(date.getUTCMinutes())}`; }
  function deliveryAsset(asset, html, run) {
    const id = deliveryId(asset); const edited = id !== asset.id ? ' (edited)' : '';
    if (run?.kit) {
      // A kit lands in Drive as n8n left it: the run folder, then a folder per channel team, then n8n's file names.
      const editionId = state.workspaces.find(w => w.id === run.workspaceId)?.editionId || 'general';
      const name = kit().kitFileName({ deliverableId: asset.deliverableId, editionId, title: run.kit.sourceTitle, createdAt: run.createdAt, variant: Number.isInteger(asset.variantIndex) ? asset.variantIndex + 1 : 0 });
      return { id, title: asset.kind === 'image' ? name : `${asset.title}${edited}`, channel: kit().kitFolderFor(asset.deliverableId, editionId).name, kind: asset.kind, deliverableId: asset.deliverableId, docName: `${name}${edited}`,
        ...(asset.kind === 'image' ? { png: fs.readFileSync(file(asset.runId, `${asset.id}.png`)), svg: fs.readFileSync(file(asset.runId, `${asset.id}.svg`), 'utf8') } : { html: html ?? fs.readFileSync(assetFile(asset, 'html'), 'utf8') }) };
    }
    const theme = asset.deliverableId === 'evidence-report' || asset.deliverableId === 'editorial-toolkit' ? (read(file(asset.runId, `${asset.id}.json`)).theme?.name || asset.title.replace(/^TREND:\s*/i, '').replace(/\s+—\s+Comprehensive Trends Report$/, '')) : '';
    const docName = asset.deliverableId === 'evidence-report' && theme ? `Priority_Trends_${theme}_${docStamp(asset.createdAt)}${edited}` : asset.deliverableId === 'editorial-toolkit' && theme ? `${theme}__${docStamp(asset.createdAt)}${edited}` : undefined;
    return { id, title: `${asset.title}${edited}`, channel: asset.channel, kind: asset.kind, deliverableId: asset.deliverableId, ...(docName ? { docName } : {}),
      ...(asset.kind === 'image' ? { png: fs.readFileSync(file(asset.runId, `${asset.id}.png`)), svg: fs.readFileSync(file(asset.runId, `${asset.id}.svg`), 'utf8') } : { html: html ?? fs.readFileSync(assetFile(asset, 'html'), 'utf8') }) };
  }
  async function publishRun(run) {
    if (publishing.has(run.id)) throw new Error('This run is already being delivered to Google Drive.');
    const ids = new Set([run.id, ...(run.reportRunIds || []).map(entry => entry.runId)]);
    const assets = state.assets.filter(asset => asset.workspaceId === run.workspaceId && ids.has(asset.runId));
    if (!assets.length) throw new Error('Generate at least one asset before publishing.');
    publishing.add(run.id);
    const deliver = async list => { const receipt = await publishCampaign({ campaignId: run.id, title: run.kit?.folderName || run.title, previousReceipt: run.googleDelivery, assets: list, onProgress: async update => { run.googleDelivery = copy(update.receipt); run.deliveryMessage = update.phase; save(); } }); run.googleDelivery = copy(receipt); save(); return receipt; };
    try {
      // Trend reports first, so each toolkit's "Full evidence" line can link its report doc (n8n order).
      const toolkits = assets.filter(asset => asset.deliverableId === 'editorial-toolkit');
      // Videos aren't published to Drive yet; the downloaded set has them.
      if (assets.some(asset => asset.kind === 'video')) run.warnings = [...new Set([...(run.warnings || []), 'Videos aren’t published to Drive yet; download the set instead.'])];
      let receipt = await deliver(assets.filter(asset => asset.deliverableId !== 'editorial-toolkit' && asset.kind !== 'video').map(asset => deliveryAsset(asset, undefined, run)));
      if (toolkits.length) {
        // A toolkit links the first trends doc Drive got for its report and keeps that link, so a later edit of the report
        // (delivered as a new file) never changes a toolkit Drive already has.
        const firstDoc = sibling => (receipt.assets || []).filter(entry => entry.assetId === sibling.id || String(entry.assetId).startsWith(`${sibling.id}-edited-`)).map(docLink).find(Boolean) || '';
        receipt = await deliver(toolkits.map(asset => {
          const sibling = state.assets.find(row => row.runId === asset.runId && row.deliverableId === 'evidence-report');
          const url = sibling ? firstDoc(sibling) : '';
          // An edited toolkit keeps its edited page; the link to the trends doc goes at the end instead of being rendered in.
          if (assetFile(asset, 'html') === editedFile(asset, 'html')) return deliveryAsset(asset, url ? withTrendsLink(fs.readFileSync(editedFile(asset, 'html'), 'utf8'), url) : undefined);
          const output = read(file(asset.runId, `${asset.id}.json`));
          return deliveryAsset(asset, url ? content.renderContentExport({ ...output, trendsDocUrl: url }, { format: 'html' }) : undefined);
        }));
      }
      run.deliveryMessage = receipt.status; save(); return receipt;
    } catch (error) { run.deliveryMessage = safeError(error); save(); throw error; }
    finally { publishing.delete(run.id); }
  }
  function withTrendsLink(html, url) {
    const safe = url.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
    const paragraph = `<p><a href="${safe}">Full evidence, quotes, and source links.</a></p>`; // the toolkit's own wording
    return html.includes('</main>') ? html.replace(/<\/main>(?![\s\S]*<\/main>)/, `${paragraph}</main>`) : html.replace(/<\/body>/, `${paragraph}</body>`);
  }
  async function launchAndWait(run, fn) { launch(run, fn); await active.get(run.id); }
  // `by` is the person who started it; schedules start as the system. A quick scan passes { origin: 'quick-scan', quickScan }
  // with its derived program, which is written only to the run's input.json: the saved program and its schedule never change.
  function startResearchRun(program, datasetIds = [], scheduledFor = '', by = SYSTEM, { origin = '', quickScan = null, ask = null, workflow = null } = {}) {
    const scan = origin === 'quick-scan';
    // A scan that writes its trends report prices it with discovery and synthesis (quickScan.reportUsd, from its plan).
    const reportUsd = scan && quickScan?.report === true ? Math.max(0, Number(quickScan.reportUsd) || 0) : 0;
    const snapshot = copy(program);
    const recurring = program.schedule && program.schedule.frequency !== 'manual';
    // A saved window wins; schedules search their rolling window; otherwise the n8n default:
    // the last `lookbackDays` (7) up to now. An hour-level window keeps its exact start (startAt).
    const window = recurring ? { ...researchScheduleWindow(program.schedule, scheduledFor || stamp()), resolvedFrom: 'schedule' } : research.resolveResearchWindow(research.validateResearchProgram(program), clock());
    snapshot.window = { startDate: window.startDate, endDate: window.endDate || '', ...(window.startAt ? { startAt: window.startAt } : {}) };
    const validated = research.validateResearchProgram(snapshot);
    // What each stage runs on, resolved now and kept with the run (run.ai.routing): a retry never changes provider or price.
    const taskIds = scan ? ['quickScans.discovery', 'quickScans.synthesis', 'quickScans.report'] : ['research.discovery', 'research.synthesis', 'research.matching', 'research.tagging', 'reports.trends-report', 'reports.editorial-toolkit'];
    const routed = routing.snapshot(taskIds, { program: validated });
    const stageTask = (stage) => routed[stageTaskId({ origin }, stage)] || (stage === 'reports' ? routed['reports.trends-report'] : routed[`research.${stage}`]);
    const fullEstimate = research.estimateResearchCost(validated, { stages: Object.fromEntries(research.RESEARCH_STAGES.map((stage) => { const task = stageTask(stage); return [stage, task?.metered && task.model ? { model: task.model, effort: task.effort, ...(task.price?.known ? { price: task.price } : {}) } : null]; }).filter(([, entry]) => entry)) });
    // Before review only discovery → matching is spent; unattended runs need the whole estimate. A quick scan stops after
    // synthesis (and its short trends report), so only those are priced (and shown on the run).
    const beforeReview = Math.round((fullEstimate.stages.discovery + fullEstimate.stages.synthesis + (scan ? reportUsd : fullEstimate.stages.matching)) * 100) / 100;
    const estimate = scan ? { ...fullEstimate, stages: { ...fullEstimate.stages, matching: 0, tagging: 0, reports: reportUsd }, totalUsd: beforeReview } : fullEstimate;
    const required = validated.autoApproveThemes && !scan ? estimate.totalUsd : beforeReview;
    if (!datasetIds.length && required > 0 && validated.budgets.aiUsd < required * 0.5) throw new Error(`This ${scan ? 'scan' : 'program'}’s AI budget ($${validated.budgets.aiUsd.toFixed(2)}) is far below the estimated $${required.toFixed(2)} ${validated.autoApproveThemes && !scan ? 'for a full unattended run' : 'to discover themes'} from about ${estimate.posts.total.toLocaleString('en-US')} posts with the selected models. Raise the AI budget or choose lighter models, then start again.`);
    const warnings = validated.budgets.aiUsd < estimate.totalUsd ? [`The AI budget ($${validated.budgets.aiUsd.toFixed(2)}) is below the estimate of $${estimate.totalUsd.toFixed(2)}; the run stops when it is used up and can resume with a higher budget.`] : [];
    // The collection plan is checked before any run exists, so a collection budget below the Actors' minimum charges (or a
    // roster too large to plan) is refused here instead of failing after the run starts.
    if (!datasetIds.length && collect) {
      try { require('../shared/research-collection').buildCollectionPlan(validated, { now: clock() }); }
      catch (error) { throw Object.assign(new Error(`${safeError(error)} Nothing was started.`), { field: error.field, status: 400 }); }
    }
    const run = { id: id('research'), workspaceId: program.workspaceId, type: 'research', title: scan && quickScan?.topic ? `Quick scan · ${quickScan.topic}` : program.name, programId: program.id, createdBy: { id: by.id, name: by.name }, status: 'queued', stage: 'collecting', createdAt: stamp(), maxBudgetUsd: program.budgets.aiUsd, reservedUsd: 0, costUsd: 0, receipts: [], themes: [], window, ai: { ...copy(validated.ai), ...(Object.values(routed).some((task) => task.route === 'codex') ? { route: 'codex' } : {}), version: 2, routing: routed }, estimate, warnings, ...(scheduledFor ? { scheduledFor } : {}), ...(origin ? { origin } : {}), ...(quickScan ? { quickScan: copy(quickScan) } : {}), ...(ask && !scan ? { ask: copy(ask) } : {}) };
    // The prompts this run writes with, copied now so an edit made while it runs never changes it (a retry may opt in). A
    // quick scan stops after synthesis (and its trends report), so it keeps only those.
    const promptCopy = promptSnapshot(workspace(program.workspaceId, false), scan ? ['research.discovery', 'research.synthesis', ...(quickScan?.report === true ? ['reports.quick-scan'] : []), 'system.repair'] : RESEARCH_PROMPTS); run.prompts = promptRecord(promptCopy);
    write(file(run.id, 'input.json'), { program: { ...validated, workspaceId: program.workspaceId }, datasetIds: [...new Set(datasetIds)], prompts: promptCopy });
    if (scheduledFor) {
      // The occurrence and the queued run are committed together before launch can
      // reach a provider. A restart never silently replays an interrupted claim.
      Object.assign(program.schedule, { lastRunAt: stamp(), lastScheduledFor: scheduledFor, lastRunId: run.id, lastStatus: 'queued', lastError: '', skippedAt: '', skippedReason: '' });
    }
    // A workflow's run is linked in the same save that creates it (the workflow engine rebuilds its refs from this).
    if (workflow) run.workflow = workflow;
    state.researchRuns.unshift(run);
    const started = launch(run, () => performDiscovery(run));
    // A program's run started by a person or its own schedule may start a "whenever this program runs" workflow.
    if (!workflow && !scan && typeof hooks.onResearchRunStarted === 'function') { try { hooks.onResearchRunStarted(copy(run)); } catch (_) { /* a workflow never stops the run it follows */ } }
    return started;
  }
  // ---------- Quick scans (SPEC §2): a small, hour-level research run priced and started from Ask AI ----------
  const quickScans = () => require('../shared/research-quick-scan');
  const QUICK_SCAN_RANK_RUNS = 5; // ranking reads this many of the program's latest full runs
  const rankEvidence = new Map(); const rankMemo = new Map();
  // The program's latest full research runs in this workspace that saved evidence, newest first, as compact posts. Paths are
  // checked directly (file() would create run folders) and each file is cached by its time, since saved evidence never
  // changes. Quick scans are left out so the accounts one scan chose don't keep choosing themselves.
  function rankingEvidence(program) {
    const runs = state.researchRuns.filter(run => run.workspaceId === program.workspaceId && run.programId === program.id && run.origin !== 'quick-scan' && /^[a-zA-Z0-9_-]{1,180}$/.test(run.id || '')).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    const out = [];
    for (const run of runs) {
      if (out.length >= QUICK_SCAN_RANK_RUNS) break;
      const target = path.join(root, 'runs', run.id, 'evidence.json');
      let mtime; try { mtime = fs.statSync(target).mtimeMs; } catch (_) { continue; }
      let cached = rankEvidence.get(run.id);
      if (!cached || cached.mtime !== mtime) {
        try { cached = { mtime, items: (read(target).items || []).map(item => ({ platform: item.platform, author: item.author, community: item.community, url: item.url, title: item.title, text: String(item.text || '').slice(0, 2000) })) }; } catch (_) { continue; }
        rankEvidence.delete(run.id); rankEvidence.set(run.id, cached); if (rankEvidence.size > 8) rankEvidence.delete(rankEvidence.keys().next().value);
      }
      out.push({ runId: run.id, createdAt: run.createdAt, mtime, items: cached.items });
    }
    return out;
  }
  function rankFor(program, topic) {
    const evidence = rankingEvidence(program);
    const key = JSON.stringify([program.id, program.updatedAt || '', topic, evidence.map(run => `${run.runId}:${run.mtime}`)]);
    if (!rankMemo.has(key)) { rankMemo.set(key, quickScans().rankTargetsForTopic({ program, topic, evidence })); if (rankMemo.size > 6) rankMemo.delete(rankMemo.keys().next().value); }
    return rankMemo.get(key);
  }
  // The program a scan picks accounts from: the one named, else the only (or most recently saved) one in this workspace.
  function scanProgram(programId) {
    if (programId) return owned(state.programs, programId);
    const programs = state.programs.filter(program => program.workspaceId === state.activeWorkspaceId).sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    if (!programs.length) throw new Error('Save a research program with sources first. A quick scan picks from its accounts and communities.');
    return programs[0];
  }
  // One derivation shared by the cost check, the start and the model check, so all three describe the same run.
  function quickScanPlan({ programId, scan } = {}, { rank = true } = {}) {
    const lib = quickScans(); const asked = scan && typeof scan === 'object' && !Array.isArray(scan) ? scan : {};
    const normalized = lib.normalizeScan({ ...asked, programId: typeof programId === 'string' && programId ? programId : asked.programId ?? '' });
    const saved = scanProgram(normalized.programId);
    const ranking = rank ? rankFor(saved, normalized.topic) : [];
    const derived = lib.deriveQuickScanProgram(saved, normalized, { ranking, now: clock() });
    // The short trends report is on unless the plan turned it off (scan.report false); the fingerprint covers the choice,
    // so a plan priced with the report never starts without it, or the other way round.
    const report = asked.report !== false && asked.report !== 'false';
    return { scan: { ...normalized, report, programId: saved.id }, saved, derived, selection: lib.selectQuickScanTargets(saved, normalized, ranking), fingerprint: lib.scanFingerprint({ ...derived, quickScanReport: report }) };
  }
  const activeQuickScan = (workspaceId, exceptId = '') => state.researchRuns.find(run => run.id !== exceptId && run.workspaceId === workspaceId && run.origin === 'quick-scan' && (active.has(run.id) || ['queued', 'running'].includes(run.status)));
  const quickScanBusy = busy => Object.assign(new Error(`${busy.createdBy?.name || 'Someone'} started a quick scan at ${when(busy.createdAt)} that is still running. One quick scan runs at a time in a workspace; wait for it or stop it first.`), { status: 409, code: 'quickScanRunning' });
  // What a start refuses before anything is spent: no collection here, a plan that changed since the cost check, or a
  // second quick scan while one is still running in this workspace.
  function guardQuickScan(payload, fingerprint) {
    if (!collect) throw new Error('Source collection is unavailable on this host, so quick scans can’t run here.');
    if (typeof payload?.fingerprint !== 'string' || payload.fingerprint !== fingerprint) throw Object.assign(new Error('The plan changed; check the cost again.'), { status: 409, code: 'quickScanChanged' });
    const busy = activeQuickScan(state.activeWorkspaceId);
    if (busy) throw quickScanBusy(busy);
  }
  // A quick scan stops after synthesis, so only discovery and synthesis are priced.
  // With the trends report on, its estimate is part of the total the plan shows (stages.report, report: { on, usd, model }).
  // Each step is priced with what it will run on (Model routing's quickScans.* tasks with the scan's program), resolved the
  // way startResearchRun snapshots them, so the plan, the run's estimate and the report's model agree. A step on a route
  // that isn't metered (Codex) is priced with the program's model as a guide.
  function quickScanAiEstimate(program, { report = false } = {}) {
    const routed = routing.snapshot(['quickScans.discovery', 'quickScans.synthesis', 'quickScans.report'], { program });
    const priced = task => (task?.metered && task.model ? { model: task.model, effort: task.effort, ...(task.price?.known ? { price: task.price } : {}) } : null);
    const routedStages = { discovery: priced(routed['quickScans.discovery']), synthesis: priced(routed['quickScans.synthesis']) };
    const estimate = research.estimateResearchCost(program, { stages: Object.fromEntries(Object.entries(routedStages).filter(([, entry]) => entry)) });
    const reportTask = routed['quickScans.report'] || null;
    const reportPricing = priced(reportTask) || { model: program.ai.models.synthesis, effort: program.ai.effort.synthesis };
    const reportUsd = report ? Math.max(.01, cents(scanReports().scanReportEstimate({ ...reportPricing, themes: program.maxThemes }))) : 0;
    const stages = { discovery: estimate.stages.discovery, synthesis: estimate.stages.synthesis, report: reportUsd };
    const modelOf = (stage, task) => task?.model || program.ai.models[stage]; const effortOf = (stage, task) => (task ? task.effort : program.ai.effort[stage]);
    const reportModel = reportTask?.model || reportPricing.model;
    return { totalUsd: Math.round((stages.discovery + stages.synthesis + reportUsd) * 100) / 100, stages, capUsd: program.budgets.aiUsd, posts: estimate.posts, models: { discovery: modelOf('discovery', routed['quickScans.discovery']), synthesis: modelOf('synthesis', routed['quickScans.synthesis']), report: reportModel }, effort: { discovery: effortOf('discovery', routed['quickScans.discovery']), synthesis: effortOf('synthesis', routed['quickScans.synthesis']), report: reportTask ? reportTask.effort : reportPricing.effort }, report: { on: Boolean(report), usd: reportUsd, model: reportModel }, basis: estimate.basis };
  }
  // The AI route the next call takes. The host resolves "auto" (getAiProvider); without it the saved setting decides.
  async function aiRouteNow() {
    if (typeof getAiProvider === 'function') { try { const route = await getAiProvider(); if (['claude', 'claude-api', 'codex'].includes(route)) return route; } catch (_) { /* fall back to the setting */ } }
    const setting = capabilities().aiProvider;
    return setting === 'codex' || setting === 'claude-api' ? setting : 'claude';
  }
  // ---------- Prompt Library: retries that take newer prompts, "Latest run" samples and the API (prompt-lab.js) ----------
  // A retry with refreshPrompts takes the prompts saved since the run started, only for what it hasn't finished: finished
  // stages are cached and keep their copy, and so does a picture set with saved pictures, whose resumes check each
  // picture's exact prompt (promptHash). Unfinished report runs of a research run follow it.
  function refreshRunPrompts(run) {
    const w = workspace(run.workspaceId, false); const target = file(run.id, 'input.json'); const input = read(target);
    let ids;
    if (run.type === 'research') {
      const quick = run.origin === 'quick-scan';
      ids = [...(run.approvedAt ? [] : ['research.discovery', 'research.synthesis', ...(quick ? [] : ['research.matching'])]), ...(quick || fs.existsSync(runPath(run.id, 'assignments.json')) ? [] : ['research.tagging']), ...(quick ? [] : ['reports.trends-report', 'reports.editorial-toolkit']), 'system.repair'];
      for (const entry of run.reportRunIds || []) { const child = state.contentRuns.find(row => row.id === entry.runId); if (child && child.status !== 'succeeded' && !active.has(child.id)) refreshRunPrompts(child); }
      // A quick scan's trends report not written yet takes the newer prompt too (its own run, or the copy it starts from).
      if (quick && run.quickScan?.report === true && run.scanReport?.status !== 'succeeded') {
        ids.splice(ids.length - 1, 0, 'reports.quick-scan');
        const child = run.scanReport?.runId ? state.contentRuns.find(row => row.id === run.scanReport.runId) : null;
        if (child && child.status !== 'succeeded' && !active.has(child.id)) refreshRunPrompts(child);
      }
    } else {
      const open = (run.jobs || []).filter(job => job.status !== 'succeeded'); const text = open.filter(job => job.kind !== 'image');
      const picturesStarted = (run.jobs || []).some(job => job.kind === 'image' && (job.assetIds?.length || job.imageCalls?.length));
      const pictureIds = run.kit ? ['pictures.direction', 'pictures.variations', 'pictures.kit-brief', 'pictures.kit-image'] : ['pictures.direction', 'pictures.variations', 'pictures.content-image'];
      // Create content pictures carry the shared rules in their prompt, so those freeze with the pictures; kit pictures don't.
      const sharedOpen = run.kit ? text.length > 0 : open.length > 0 && !picturesStarted;
      if (input.research) ids = [...text.map(job => (job.id === 'evidence-report' ? 'reports.trends-report' : 'reports.editorial-toolkit')), 'system.repair'];
      else if (input.scanReport) ids = open.length ? ['reports.quick-scan', 'system.repair'] : [];
      else ids = [...text.map(job => `assets.${job.id}`), ...(sharedOpen ? ['assets.shared'] : []), ...(open.length > text.length && !picturesStarted ? pictureIds : []), ...(run.kit ? ['system.repair'] : [])];
    }
    ids = ids.filter(promptId => PROMPT_IDS.has(promptId));
    if (!ids.length) return;
    const fresh = promptSnapshot(w, ids);
    write(target, { ...input, prompts: { ...(input.prompts || {}), ...fresh } });
    run.prompts = { ...(run.prompts || promptRecord(input.prompts)), ...promptRecord(fresh) }; save();
  }
  // "Latest run" samples for the Prompt Library preview and test: this workspace's newest saved data that the prompt reads,
  // in the shape of prompt-samples.json (parts a run doesn't have come from it). null when no run has it yet.
  async function latestPromptSample(promptId) {
    const w = state.workspaces.find(row => row.id === state.activeWorkspaceId); if (!w) return null;
    const base = require('../shared/prompt-samples.json');
    const newest = rows => [...rows].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    const day = run => String(run.createdAt || '').slice(0, 10);
    const found = (overrides, label) => ({ sample: { ...base, ...overrides, label }, label });
    const count = (n, one, many) => `${n} ${n === 1 ? one : many}`; const PLATFORM = { x: 'X', linkedin: 'LinkedIn', reddit: 'Reddit' };
    const readSafe = target => { try { return read(target); } catch (_) { return null; } };
    const researchRuns = newest(state.researchRuns.filter(run => run.workspaceId === w.id && /^[a-zA-Z0-9_-]{1,180}$/.test(run.id || '') && fs.existsSync(runPath(run.id, 'evidence.json'))));
    if (promptId === 'research.discovery' || promptId === 'research.tagging') {
      const stage = promptId === 'research.discovery' ? 'discovery' : 'tagging';
      const run = stage === 'tagging' ? researchRuns.find(row => (row.themes || []).length || (row.discoveredThemes || []).length) : researchRuns[0];
      if (!run) return null;
      const items = (readSafe(runPath(run.id, 'evidence.json'))?.items || []).filter(item => item?.eligible?.[stage] !== false && item.text);
      const platform = ['x', 'linkedin', 'reddit'].map(p => [p, items.filter(item => item.platform === p).length]).sort((a, b) => b[1] - a[1])[0][0];
      const posts = items.filter(item => item.platform === platform).sort((a, b) => (b.engagement?.value || 0) - (a.engagement?.value || 0)).slice(0, stage === 'discovery' ? 40 : 20);
      if (!posts.length) return null;
      const themes = (run.themes || []).length ? run.themes : run.discoveredThemes || [];
      return found({ runId: run.id, posts, query: readSafe(runPath(run.id, 'input.json'))?.program?.query || '', ...(themes.length ? { themes: copy(themes).slice(0, 6) } : {}) }, `${count(posts.length, `${PLATFORM[platform]} post`, `${PLATFORM[platform]} posts`)} from “${run.title}” (${day(run)})`);
    }
    if (promptId === 'research.synthesis') {
      for (const run of researchRuns) {
        const input = readSafe(runPath(run.id, 'input.json')); if (!input?.program) continue;
        try {
          const program = runProgram(input); const evidence = readSafe(runPath(run.id, 'evidence.json'))?.items || [];
          const { batches } = research.buildDiscoveryBatches({ runId: run.id, items: evidence, batchSize: program.discoveryBatchSize });
          const candidates = batches.flatMap(batch => readSafe(runPath(run.id, `${batch.id}.validated.json`))?.candidates || []);
          if (!candidates.length) continue;
          const merged = research.mergeCandidates(candidates).slice(0, 60);
          return found({ runId: run.id, posts: evidence, candidates: merged, maxThemes: program.maxThemes, taxonomy: w.taxonomy || null, query: program.query || '' }, `${count(merged.length, 'candidate trend', 'candidate trends')} from “${run.title}” (${day(run)})`);
        } catch (_) { continue; }
      }
      return null;
    }
    if (promptId === 'research.matching') {
      const run = newest(state.researchRuns.filter(row => row.workspaceId === w.id && row.origin !== 'quick-scan' && (row.discoveredThemes || row.themes || []).length))[0];
      if (!run) return null;
      const themes = copy(run.discoveredThemes || run.themes).slice(0, 6); const ids = new Set(themes.map(theme => theme.id));
      const existing = activeRepository(w.id).filter(theme => !ids.has(theme.id));
      return found({ themes, existingThemes: existing }, `${count(themes.length, 'trend', 'trends')} from “${run.title}” (${day(run)}), compared with ${count(existing.length, 'trend', 'trends')} you track`);
    }
    if (promptId === 'reports.trends-report' || promptId === 'reports.editorial-toolkit') {
      for (const run of newest(state.contentRuns.filter(row => row.workspaceId === w.id && row.researchRunId && !row.kit && /^[a-zA-Z0-9_-]{1,180}$/.test(row.id || '')))) {
        const input = readSafe(runPath(run.id, 'input.json')); const payload = input?.source?.research;
        if (!payload?.selection?.posts?.length || !payload.theme) continue;
        if (promptId === 'reports.trends-report') return found({ reportPayload: payload }, `The ${count(payload.selection.posts.length, 'post', 'posts')} behind “${payload.theme.name || run.title}” (${day(run)})`);
        const job = (run.jobs || []).find(entry => entry.id === 'evidence-report' && entry.status === 'succeeded' && entry.assetId);
        const trendReport = job ? readSafe(runPath(run.id, `${job.assetId}.json`)) : null; if (!trendReport) continue;
        const registryDoc = (input.referenceDocs || []).find(doc => doc.kind === 'registry');
        return found({ reportPayload: payload, themes: [payload.theme], trendReport, selection: payload.selection, registryText: registryDoc?.text || '', products: input.productRegistry || [], referenceDocs: input.referenceDocs || [], enterpriseProducts: input.enterpriseProducts || [] }, `The trends report for “${payload.theme.name || run.title}” (${day(run)})`);
      }
      return null;
    }
    // A quick scan's trends report reads the trends the newest scan found and the posts behind them.
    if (promptId === 'reports.quick-scan') {
      const lib = scanReports();
      for (const run of researchRuns.filter(row => row.origin === 'quick-scan' && (row.discoveredThemes || []).length)) {
        const items = readSafe(runPath(run.id, 'evidence.json'))?.items || []; if (!items.length) continue;
        const themes = copy(run.discoveredThemes).slice(0, 6); const selection = lib.selectScanEvidence({ themes, items });
        if (!selection.posts.length) continue;
        return found({ scanReportPayload: { scan: lib.scanSummary({ run, themes, postCount: items.length }), selection } }, `The ${count(themes.length, 'trend', 'trends')} from “${run.title}” (${day(run)})`);
      }
      return null;
    }
    if (promptId.startsWith('assets.') || promptId.startsWith('pictures.')) {
      const needsBrief = ['pictures.kit-image', 'pictures.variations', 'pictures.direction'].includes(promptId);
      for (const run of newest(state.contentRuns.filter(row => row.workspaceId === w.id && !row.researchRunId && /^[a-zA-Z0-9_-]{1,180}$/.test(row.id || '')))) {
        const input = readSafe(runPath(run.id, 'input.json')); if (!input?.source || input.research) continue;
        let brief = null;
        if (needsBrief) { const job = (run.jobs || []).find(entry => entry.kind === 'image' && /^[a-zA-Z0-9_-]{1,180}$/.test(entry.id || '') && fs.existsSync(runPath(run.id, `${entry.id}.brief.json`))); brief = job ? readSafe(runPath(run.id, `${job.id}.brief.json`)) : null; if (!brief) continue; }
        return found({ source: input.source, brandKnowledge: input.brandKnowledge || base.brandKnowledge, products: input.productRegistry || [], ...(brief ? { brief } : {}) }, `${brief ? 'The picture brief and source' : 'The source'} of “${run.title}” (${day(run)})`);
      }
      return null;
    }
    if ((promptId === 'assistant.ask-datasets' || promptId.startsWith('data.')) && typeof readDataset === 'function') {
      const datasets = newest(getDatasets().filter(d => (state.datasetOwners[d.id] || d.workspaceId || datasetFallback()) === w.id));
      for (const dataset of datasets.slice(0, 3)) {
        let payload; try { payload = await readDataset(dataset.id); } catch (_) { continue; }
        const items = (payload?.items || []).filter(item => item && typeof item.id === 'string' && typeof item.text === 'string' && item.text.trim()).slice(0, 40);
        if (items.length) return found({ dataset: copy({ ...dataset, items: undefined }), datasetItems: items }, `${count(items.length, 'item', 'items')} from “${dataset.name || 'a dataset'}”`);
      }
    }
    return null;
  }
  let lab = null;
  const promptLab = () => (lab ||= promptLabModule().createPromptLab({
    store: prompts, workspace: () => state.workspaces.find(w => w.id === state.activeWorkspaceId) || null, who, callerRole, callerCaps,
    programs: () => state.programs.filter(program => program.workspaceId === state.activeWorkspaceId), kitAi: () => kit().kitAi(state.programs.filter(program => program.workspaceId === state.activeWorkspaceId)),
    settingsModel: () => capabilities().textModel || 'claude-opus-5-5', aiRoute: aiRouteNow, runAI, generateImage, imagesReady: picturesReady, trackJob, latestSample: latestPromptSample,
    testsRoot: path.join(root, 'prompt-tests'), emit: () => emit(),
    // Model routing decides each prompt's model (its task); picture tests send the campaign set's reference images.
    routing, referenceSet: (familyId, options) => currentReferenceSet(state.workspaces.find(w => w.id === state.activeWorkspaceId), familyId, options),
  }));
  // The latest prompt saves in this workspace (newest first) for the Inbox. Never fails the state.
  function recentPromptChanges() { try { return promptLab().recentChanges(20); } catch (_) { return []; } }
  function checkDueResearchSchedules() {
    const now = stamp(); const results = [];
    for (const program of state.programs) {
      const schedule = program.schedule;
      if (isArchived(program.workspaceId)) continue; // a workspace hidden in a one-workspace build never spends
      if (!schedule?.enabled || schedule.frequency === 'manual' || !schedule.nextRunAt || Date.parse(schedule.nextRunAt) > Date.parse(now)) continue;
      try {
        const validated = research.validateResearchProgram(program);
        if (!Number.isFinite(Date.parse(schedule.nextRunAt))) throw new Error('The saved schedule is invalid. Save it again to resume.');
        // Resume with only the latest due occurrence after sleep, giving it a fresh
        // rolling window. Older missed occurrences are not replayed.
        const scheduledFor = latestResearchScheduleAt(validated.schedule, { at: now });
        const nextRunAt = nextResearchScheduleAt(validated.schedule, { from: now });
        // Quick scans read the program's accounts but are not its runs; they never hold a scheduled run back.
        const pending = state.researchRuns.find(run => run.programId === program.id && run.workspaceId === program.workspaceId && run.origin !== 'quick-scan' && (active.has(run.id) || ['queued', 'running', 'awaiting-review'].includes(run.status)));
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
  // Preserve server-owned execution metadata; never trust dates or run IDs posted by the renderer
  // or carried in a setup file. Editing program copy alone preserves the cadence.
  function scheduleState(schedule, previous) {
    const changed = JSON.stringify(validateResearchSchedule(previous)) !== JSON.stringify(schedule);
    const metadata = Object.fromEntries(['lastRunAt', 'lastRunId', 'lastStatus', 'lastError', 'lastScheduledFor', 'skippedAt', 'skippedReason'].map(key => [key, previous?.[key] || '']));
    const result = { ...schedule, ...metadata, nextRunAt: !schedule.enabled ? '' : changed || !previous?.nextRunAt ? nextResearchScheduleAt(schedule, { from: stamp() }) : previous.nextRunAt };
    if (changed) { result.lastError = ''; result.skippedAt = ''; result.skippedReason = ''; }
    return result;
  }
  // Share your setup. Preview and import share one plan, so they always agree, and import changes
  // nothing until the whole file has passed. The target is the first workspace of the file's edition
  // (fresh installs have one each), which stays the same across re-imports.
  function setupPlan(input) {
    const lib = setupBundle(); const bundle = lib.validateSetupBundle(input); const source = bundle.workspace;
    // A one-workspace build imports only its own edition's files, into Main.
    if (policy.mode === 'single' && source.editionId !== policy.editionId) throw new Error(`This setup file is for the ${source.editionId === 'semrush' ? 'Semrush' : 'general'} edition. This studio has one ${policy.editionId === 'semrush' ? 'Semrush' : 'general'} workspace, ${policy.name}, so it can’t be imported. Nothing was imported.`);
    const target = (policy.mode === 'single' ? state.workspaces.find(w => w.id === mainId()) : state.workspaces.find(w => w.editionId === source.editionId && !w.archived)) || null;
    for (const program of bundle.programs) {
      const elsewhere = state.programs.find(row => row.id === program.id && row.workspaceId !== target?.id);
      const owner = elsewhere && state.workspaces.find(w => w.id === elsewhere.workspaceId);
      if (elsewhere) throw new Error(`Program “${program.name}” already belongs to ${owner?.archived ? `“${owner.name}”, a workspace hidden in this build,` : `“${owner?.name || 'another workspace'}”,`} so it cannot be imported into “${target?.name || source.name}”. Nothing was imported.`);
    }
    const shared = new Set(bundle.programs.map(program => program.id));
    const context = {
      target: target ? { workspaceId: target.id, name: target.name, exists: true, products: (target.products || []).length, taxonomyCategories: target.taxonomy?.categories?.length || 0, referenceDocs: (target.referenceDocs || []).length } : { name: source.name, exists: false },
      programActions: Object.fromEntries(bundle.programs.map(program => [program.id, state.programs.some(row => row.id === program.id) ? 'update' : 'add'])),
      keptPrograms: target ? state.programs.filter(row => row.workspaceId === target.id && !shared.has(row.id)).length : 0,
    };
    return { bundle, target, ...lib.summarizeSetupBundle(bundle, context) };
  }
  const api = {
    publicState, recoverInterrupted, checkDueResearchSchedules, startResearchScheduler, stopResearchScheduler,
    // Create content offers every deliverable but the kit-only short video.
    contentCatalog: () => ({ editions: copy(content.CONTENT_EDITIONS), deliverables: copy(content.CONTENT_DELIVERABLES.filter(d => !d.kitOnly)) }),
    selectContentWorkspace(workspaceId) {
      if (policy.mode === 'single' && workspaceId !== mainId()) throw singleRefusal(`This studio has one workspace, ${policy.name}. Its data is the only data in this build.`);
      workspace(workspaceId, false); if (isArchived(workspaceId)) throw new Error('That workspace is hidden in this build.');
      state.activeWorkspaceId = workspaceId; save(); return publicState();
    },
    // Single mode: what this build's workspace policy is, for the host's logs and tests.
    workspacePolicy: () => copy(state.workspacePolicy || { mode: policy.mode }),
    // baseUpdatedAt (optional, here and on saveResearchProgram): the updatedAt the form opened with. A save over a newer
    // one made since is refused, so two admins editing the same record never silently replace each other's changes.
    saveContentWorkspace(payload) {
      if (policy.mode === 'single' && !payload.id) throw singleRefusal(`This studio has one workspace. Edit ${policy.name}’s brand knowledge instead.`);
      const existing = payload.id ? workspace(payload.id) : null; const editionId = existing?.editionId || payload.editionId || 'general';
      staleSave(existing, payload.baseUpdatedAt, 'this workspace');
      const w = { id: existing?.id || id('workspace'), name: String(payload.name || '').trim().slice(0, 160), editionId, knowledge: content.validateBrandKnowledge(payload.knowledge || {}, { editionId }), products: content.validateProductRegistry(payload.products || [], { editionId }), ...(editionId === 'semrush' ? { brandDefaults: copy(content.SEMRUSH_BRAND_2026) } : {}), createdAt: existing?.createdAt || stamp(), updatedAt: stamp() };
      if (payload.enterpriseProducts !== undefined) w.enterpriseProducts = enterpriseList(payload.enterpriseProducts);
      if (policy.mode === 'single') w.name = policy.name; // Main's name comes with the app
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
    // Brand reference images (Settings): style examples and one approved logo per picture set. The host reads the
    // picked file; this checks what the bytes really are and keeps a copy in the studio's data folder.
    addBrandImage({ workspaceId, family, role, name, data } = {}) {
      const w = workspace(workspaceId); const set = brandImages().brandImageFamily(family, w.editionId);
      if (!brandImages().BRAND_IMAGE_ROLES.includes(role)) throw new Error('Mark the picture as a style example or the approved logo.');
      if (!(data instanceof Uint8Array)) throw new Error('Choose a PNG, JPEG or WebP picture.');
      const info = brandImages().checkBrandImage(data);
      const siblings = (w.brandImages || []).filter(image => image.family === set.id);
      if (siblings.length >= set.max) throw new Error(`${set.label} hold up to ${set.max} reference images. Remove one first.`);
      if (role === 'logo' && siblings.some(image => image.role === 'logo')) throw new Error(`${set.label} already have an approved logo. Remove it first, or add this picture as a style example.`);
      const digest = sha256(data);
      if (siblings.some(image => image.sha256 === digest)) throw new Error('That picture is already in this set.');
      const label = path.basename(String(name || '')).replace(/[\u0000-\u001f\u007f]+/g, '').trim().slice(0, 120) || `Reference.${info.extension}`;
      const image = { id: id('brand-image'), family: set.id, role, name: label, mime: info.mime, extension: info.extension, bytes: data.length, width: info.width, height: info.height, sha256: digest, addedAt: stamp() };
      writeBytes(brandImageFile(w.id, image), Buffer.from(data));
      w.brandImages = [...(w.brandImages || []), image]; w.updatedAt = stamp(); save();
      return { image: copy(image) };
    },
    readBrandImage({ workspaceId, imageId } = {}) {
      const w = workspace(workspaceId); const image = brandImageRecord(w, imageId);
      let data; try { data = fs.readFileSync(brandImageFile(w.id, image)); } catch (_) { throw new Error(`The reference image “${image.name}” is missing from the studio’s data folder. Remove it and add it again.`); }
      return { id: image.id, name: image.name, mime: image.mime, dataUrl: `data:${image.mime};base64,${data.toString('base64')}` };
    },
    setBrandImageRole({ workspaceId, imageId, role } = {}) {
      const w = workspace(workspaceId); const image = brandImageRecord(w, imageId);
      if (!brandImages().BRAND_IMAGE_ROLES.includes(role)) throw new Error('Mark the picture as a style example or the approved logo.');
      if (role === 'logo' && (w.brandImages || []).some(entry => entry.family === image.family && entry.role === 'logo' && entry.id !== image.id)) throw new Error('This set already has an approved logo. Mark that one as a style example first.');
      image.role = role; w.updatedAt = stamp(); save();
      return { image: copy(image) };
    },
    removeBrandImage({ workspaceId, imageId } = {}) {
      const w = workspace(workspaceId); const image = brandImageRecord(w, imageId);
      w.brandImages = (w.brandImages || []).filter(entry => entry.id !== image.id); w.updatedAt = stamp(); save();
      fs.rmSync(brandImageFile(w.id, image), { force: true }); // runs that started with it keep their own copy
      return { removed: image.id };
    },
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
      // Each stage priced on what it would run on now (Model routing with this draft's own stage choices); a stage on a
      // connection that reports no cost (Codex) is named in uncappedTasks and priced at Claude list prices as a guide.
      let routed = {}; try { routed = routing.snapshot(['research.discovery', 'research.synthesis', 'research.matching', 'research.tagging', 'reports.trends-report'], { program }); } catch (_) { routed = {}; }
      const stageOf = (stage) => routed[stage === 'reports' ? 'reports.trends-report' : `research.${stage}`];
      const stages = Object.fromEntries(research.RESEARCH_STAGES.map((stage) => { const task = stageOf(stage); return [stage, task?.metered && task.model ? { model: task.model, effort: task.effort, ...(task.price?.known && task.price.basis === 'tokens' ? { price: task.price } : {}) } : null]; }).filter(([, entry]) => entry));
      const uncappedTasks = [...new Set(Object.values(routed).filter((task) => task && task.metered === false).map((task) => task.label))];
      return { ai: research.estimateResearchCost(program, { stages }), ...(uncappedTasks.length ? { uncappedTasks } : {}), routes: Object.fromEntries(research.RESEARCH_STAGES.map((stage) => [stage, stageOf(stage) ? { route: stageOf(stage).route, routeLabel: stageOf(stage).routeLabel, model: stageOf(stage).model, modelLabel: stageOf(stage).modelLabel, effort: stageOf(stage).effort } : null])), collection: collection && !collection.error ? { worstCaseUsd: collection.worstCaseUsd, totalBudgetUsd: collection.totalBudgetUsd, jobCount: collection.jobCount, platforms: collection.platforms, window: collection.window, warnings: collection.warnings } : collection, models: research.RESEARCH_MODELS, effortLevels: research.EFFORT_LEVELS };
    },
    setThemeStatus({ themeId, status } = {}) {
      if (!['active', 'archived'].includes(status)) throw new Error('Choose active or archived.');
      const theme = owned(state.themes, themeId); theme.status = status; theme.updatedAt = stamp(); save(); return publicState();
    },
    saveResearchProgram(payload) {
      const w = workspace(payload.workspaceId);
      if (state.programs.some(p => p.id === payload.id && p.workspaceId !== w.id)) throw new Error('Program belongs to another workspace.');
      const existing = state.programs.find(row => row.id === payload.id);
      staleSave(existing, payload.baseUpdatedAt, 'this program');
      const p = { ...research.validateResearchProgram(payload), workspaceId: w.id, updatedAt: stamp() };
      p.schedule = scheduleState(p.schedule, existing?.schedule);
      state.programs = state.programs.filter(row => row.id !== p.id); state.programs.push(p); save(); return copy(p);
    },
    // Share your setup: the workspace's research knowledge and programs as one portable bundle.
    // Never includes run history, datasets, assets, themes, detections, workbooks, receipts or keys
    // (the host attaches keys itself with setup-bundle's attachSetupSecrets).
    exportSetup({ workspaceId, programIds, appVersion } = {}) {
      const w = workspace(workspaceId); const limit = setupBundle().SETUP_LIMITS.programs;
      if (programIds !== undefined && (!Array.isArray(programIds) || programIds.length > limit)) throw new Error(`Choose up to ${limit} programs to share.`);
      const programs = programIds === undefined ? state.programs.filter(program => program.workspaceId === w.id) : [...new Set(programIds)].map(programId => owned(state.programs, programId));
      // An unset Enterprise list means the edition default; the file carries the list in effect.
      return setupBundle().buildSetupBundle({ workspace: { ...w, enterpriseProducts: w.enterpriseProducts ?? (w.editionId === 'semrush' ? SEMRUSH_ENTERPRISE_PRODUCTS : []) }, programs, exportedAt: stamp(), appVersion: appVersion == null ? '' : String(appVersion) });
    },
    previewSetup({ bundle } = {}) { const { summary, warnings } = setupPlan(bundle); return { summary, warnings }; },
    // Replaces the target workspace's knowledge, products, taxonomy and reference documents, upserts
    // programs by ID and selects the workspace, in one save. Secrets in the file are ignored here.
    importSetup({ bundle } = {}) {
      const plan = setupPlan(bundle); const source = plan.bundle.workspace; const now = stamp(); const workspaceId = plan.target?.id || id('workspace');
      const enterprise = source.enterpriseProducts && enterpriseList(source.enterpriseProducts);
      // Imported schedules arrive paused (cadence kept, no next run), so a tester never starts spending
      // by accident; a re-import keeps this machine's run history for programs it already has.
      const programs = plan.bundle.programs.map(program => ({ ...program, workspaceId, updatedAt: now, schedule: scheduleState({ ...program.schedule, enabled: false }, state.programs.find(row => row.id === program.id)?.schedule) }));
      const w = plan.target || { id: workspaceId, name: source.name, editionId: source.editionId, createdAt: now };
      if (!plan.target) state.workspaces.push(w);
      Object.assign(w, { knowledge: source.knowledge, products: source.products, ...(w.editionId === 'semrush' ? { brandDefaults: copy(content.SEMRUSH_BRAND_2026) } : {}), referenceDocs: source.referenceDocs.map(doc => ({ id: id('doc'), ...doc, updatedAt: now })), updatedAt: now });
      if (enterprise) w.enterpriseProducts = enterprise; else delete w.enterpriseProducts;
      if (source.taxonomy) w.taxonomy = source.taxonomy; else delete w.taxonomy;
      for (const program of programs) { const index = state.programs.findIndex(row => row.id === program.id); if (index >= 0) state.programs[index] = program; else state.programs.push(program); }
      state.activeWorkspaceId = w.id; save();
      return { summary: plan.summary, warnings: plan.warnings, workspaceId: w.id, programIds: programs.map(program => program.id), state: publicState() };
    },
    // A program's run that is still queued, running or waiting for review isn't started twice by accident: the person is
    // told who started it and when, and the screen asks before sending again: true. Schedules keep their own rule.
    // ask ({ conversationId, messageId?, actionIndex? }, optional): the Ask AI conversation it was started from, where the
    // trends that need an OK and the finished reports are posted.
    startResearchRun({ programId, datasetIds = [], again = false, ask = null } = {}) {
      const by = who();
      const program = owned(state.programs, programId); if (!Array.isArray(datasetIds) || datasetIds.length > 50) throw new Error('Choose up to 50 datasets.'); const allowed = new Set(publicState().availableDatasets.map(d => d.id)); if (datasetIds.some(key => !allowed.has(key))) throw new Error('Choose datasets from this workspace.');
      api.checkResearchIdle({ programId, again });
      return withoutAsk(startResearchRun(program, datasetIds, '', by, { ask: askLink(ask, by) }));
    },
    // Quick scan cost check (the chat's scan-plan card): the accounts it would read and why, the AI estimate against its cap
    // and the collection worst case against its cap, for the same derived run startQuickScan would start. Reads only.
    async estimateQuickScan(payload = {}) {
      const { scan, saved, derived, selection, fingerprint } = quickScanPlan(payload);
      const route = await aiRouteNow(); const uncapped = route === 'codex';
      const ai = quickScanAiEstimate(derived, { report: scan.report }); const warnings = [...selection.warnings]; let blocked = false;
      let collection;
      try {
        const receipt = require('../shared/research-collection').buildCollectionPlan(derived, { now: clock() }).receipt;
        collection = { worstCaseUsd: receipt.worstCaseUsd, totalBudgetUsd: receipt.totalBudgetUsd, jobCount: receipt.jobCount, platforms: receipt.platforms, warnings: receipt.warnings.filter(warning => !/^Planned counts/.test(warning)) };
        if (receipt.worstCaseUsd > derived.budgets.collectionUsd) warnings.push(`Collection could cost up to $${receipt.worstCaseUsd.toFixed(2)} in the worst case, above the $${derived.budgets.collectionUsd.toFixed(2)} cap. Each source stops when its share runs out.`);
        warnings.push(...collection.warnings.filter(warning => /only filters by day/.test(warning)));
      } catch (error) { collection = { worstCaseUsd: 0, totalBudgetUsd: 0, jobCount: 0, platforms: {}, warnings: [], error: safeError(error) }; warnings.push(collection.error); blocked = true; }
      if (!collect) { warnings.push('Source collection is unavailable on this host, so quick scans can’t run here.'); blocked = true; }
      // The same refusal startResearchRun applies, so the card never offers a start the server turns down.
      if (ai.totalUsd > 0 && derived.budgets.aiUsd < ai.totalUsd * 0.5) { warnings.push(`The $${derived.budgets.aiUsd.toFixed(2)} AI cap is far below the estimate of about $${ai.totalUsd.toFixed(2)}. Raise the AI cap.`); blocked = true; }
      else if (!uncapped && derived.budgets.aiUsd < ai.totalUsd) warnings.push(`The AI estimate (about $${ai.totalUsd.toFixed(2)}) is above the $${derived.budgets.aiUsd.toFixed(2)} cap; the scan stops when the cap is used up and can resume with a higher one.`);
      const busy = activeQuickScan(state.activeWorkspaceId);
      if (busy) { warnings.push(`A quick scan (“${busy.title}”) is still running. One quick scan runs at a time in a workspace.`); blocked = true; }
      const plan = { platforms: selection.platforms, targets: selection.targets.map(({ platform, sourceId, target, score, reasons }) => ({ platform, sourceId, target, score, reasons })), available: selection.available, window: { startAt: derived.window.startAt, hours: scan.lookbackHours }, itemsPerPlatform: scan.itemsPerPlatform, commentsPerPost: scan.commentsPerPost };
      return { scan, programId: saved.id, programName: saved.name, plan, ai, collection, route, uncapped, warnings: [...new Set(warnings)], lines: quickScans().describeScan(scan, { ...plan, ai, collection, uncapped }), fingerprint, ready: !blocked };
    },
    // Starts the scan the card priced. The plan is derived again and must match what the person saw (fingerprint);
    // startResearchRun checks the collection plan before the run exists. The saved program, its schedule and nextRunAt
    // are never touched: the derived program goes only into the run's input.json.
    // payload.ask ({ conversationId, messageId?, actionIndex? }): the Ask AI conversation the plan was started from, where
    // the trends report is posted when the scan finishes (never part of the plan or its fingerprint).
    startQuickScan(payload = {}) {
      const by = who(); const { scan, saved, derived, selection, fingerprint } = quickScanPlan(payload);
      guardQuickScan(payload, fingerprint);
      const link = askLink(payload?.ask, by); const reportUsd = scan.report ? quickScanAiEstimate(derived, { report: true }).report.usd : 0;
      const quickScan = { topic: scan.topic, depth: scan.depth, platforms: selection.platforms, lookbackHours: scan.lookbackHours, targets: selection.targets.map(({ platform, target }) => ({ platform, target })), itemsPerPlatform: scan.itemsPerPlatform, commentsPerPost: scan.commentsPerPost, fingerprint, report: scan.report, reportUsd, ...(link ? { ask: link } : {}) };
      return withoutAsk(startResearchRun({ ...derived, workspaceId: saved.workspaceId }, [], '', by, { origin: 'quick-scan', quickScan }));
    },
    // The `ai` block a quick scan will use, for the host's model check before startQuickScan. Given the start payload
    // (with its fingerprint) it also refuses a changed plan or a second scan first, so neither pays for that check.
    quickScanAi(payload = {}) {
      if (payload?.fingerprint === undefined) return copy(quickScanPlan(payload, { rank: false }).derived.ai);
      const { derived, fingerprint } = quickScanPlan(payload); guardQuickScan(payload, fingerprint);
      return copy(derived.ai);
    },
    // The duplicate check alone, so the host can run it before its model check. Quick scans aren't the program's runs.
    checkResearchIdle({ programId, again = false } = {}) {
      if (again === true) return;
      const program = owned(state.programs, programId);
      const pending = state.researchRuns.find(run => run.programId === program.id && run.workspaceId === program.workspaceId && run.origin !== 'quick-scan' && (active.has(run.id) || ['queued', 'running', 'awaiting-review'].includes(run.status)));
      if (pending) throw refusal('researchRunning', { name: pending.createdBy?.name || 'Someone', time: when(pending.createdAt) }, 409);
    },
    approveResearchThemes({ runId, themes }) {
      const by = who(); const run = runRecord(runId); if (run.type !== 'research' || run.status !== 'awaiting-review') throw new Error('This run is not awaiting theme review.');
      if (!Array.isArray(themes) || !themes.length || themes.length > 6) throw new Error('Select one to six discovered themes.');
      const discovered = run.discoveredThemes || run.themes; // re-approval must still see themes passed over last time
      const selected = [...new Set(themes.map(t => typeof t === 'string' ? t : t.id))].map(key => { const t = discovered.find(row => row.id === key); if (!t) throw new Error('Only discovered themes can be approved.'); const edit = themes.find(row => row && typeof row === 'object' && row.id === key); if (!edit) return t; const name = String(edit.name ?? t.name).trim(); const description = String(edit.description ?? t.description).trim(); if (!name || name.length > 160 || !description || description.length > 5000) throw new Error('Theme name and description must be concise and non-empty.'); return { ...t, name, description }; });
      run.discoveredThemes ||= copy(run.themes); const before = run.decisions || {};
      run.decisions = Object.fromEntries(discovered.map(t => [t.id, selected.some(row => row.id === t.id) ? 'approved' : 'passed']));
      // Only decisions this approval changed are credited to this person; earlier ones keep who made them.
      const at = stamp(); run.decisionsBy = { ...(run.decisionsBy || {}) };
      for (const [themeId, decision] of Object.entries(run.decisions)) if (before[themeId] !== decision) run.decisionsBy[themeId] = { ...by, at };
      // Reviewer edits become the tracked name; the discovered wording stays as an alias.
      for (const theme of selected) { const repo = state.themes.find(row => row.workspaceId === run.workspaceId && row.id === theme.id); const original = discovered.find(row => row.id === theme.id); if (repo && original && (original.name !== theme.name || original.description !== theme.description)) Object.assign(repo, { name: theme.name, description: theme.description, aliases: [...new Set([...(repo.aliases || []), ...(original.name !== theme.name ? [original.name] : [])])].slice(-50), updatedAt: stamp() }); }
      run.themes = selected; run.approvedAt = stamp(); save(); return copy(run);
    },
    // Trend board: OK or pass one discovered theme at a time. Nothing is spent until the run continues. A yes can carry a
    // note for the channels and the channels it is for (kit folder ids; none, or every one, means all channels), which
    // channel owners read on the trend's card and analytics use to decide which channels it was offered to.
    // internal ({ by, via, workspaceId }) is the Monday.com sync's (monday-engine.js): never reachable over RPC, because the
    // studio:* handler passes the payload alone, so a browser can't claim to be someone else.
    decideResearchTheme({ runId, themeId, decision, note, channels }, internal = {}) {
      const monday = internal?.via === 'monday' && internal.by;
      const by = monday ? { id: String(internal.by.id || SYSTEM.id).slice(0, 320), name: String(internal.by.name || SYSTEM.name).slice(0, 120) } : who();
      const run = monday && internal.workspaceId ? state.researchRuns.find(row => row.id === runId && row.workspaceId === internal.workspaceId) : runRecord(runId);
      if (!run) throw new Error('Record not found in the selected workspace.');
      if (run.type !== 'research' || run.status !== 'awaiting-review') throw new Error('This trend is no longer waiting for a decision.');
      if (!['approved', 'passed', 'pending'].includes(decision)) throw new Error('Choose approve, pass, or undo.');
      if (!(run.discoveredThemes || run.themes).some(t => t.id === themeId)) throw new Error('Only discovered trends can be decided.');
      const words = typeof note === 'string' ? note.replace(/\s+/g, ' ').trim() : '';
      if (words.length > 280) throw new Error('Keep the note for the channels under 280 characters.');
      const known = kit().kitFolders(state.workspaces.find(w => w.id === run.workspaceId)?.editionId || 'general').map(folder => folder.id);
      const routed = decision === 'approved' && Array.isArray(channels) ? [...new Set(channels.filter(value => typeof value === 'string'))] : [];
      if (routed.some(value => !known.includes(value))) throw new Error('Choose channels from this workspace.');
      run.decisions = { ...(run.decisions || {}) }; run.decisionsBy = { ...(run.decisionsBy || {}) }; run.decidedAt = stamp();
      // Undo forgets who decided, so analytics show the trend as waiting again.
      if (decision === 'pending') { delete run.decisions[themeId]; delete run.decisionsBy[themeId]; }
      else { run.decisions[themeId] = decision; run.decisionsBy[themeId] = { ...by, at: run.decidedAt, ...(words ? { note: words } : {}), ...(routed.length && routed.length < known.length ? { channels: routed } : {}), ...(monday ? { via: 'monday' } : {}) }; }
      save(); return publicRun(run);
    },
    continueResearchRun({ runId }) { const run = runRecord(runId); if (!run.approvedAt || run.type !== 'research') throw new Error('Approve the research themes first.'); return launch(run, () => performClassification(run)); },
    createContentRun(payload) { const by = who(); const run = newContentRun(payload, null, by); return launch(run, () => performContent(run)); },
    // Asset kits: what a kit from this source would make and cost, before anything is spent.
    planAssetKit(payload = {}) {
      const { w, picked, input, plan, ai, imagesReady, videoReady, offered, references, estimate, promptsAll } = kitPlan(payload);
      const chosen = new Set(plan.deliverables.map(d => d.id));
      // Every offered asset is priced, so ticking one back on shows what it adds.
      const pricedPlan = content.buildContentPlan({ ...input, prompts: promptsAll, deliverableIds: offered.filter(id => { const kind = content.CONTENT_DELIVERABLES.find(d => d.id === id).kind; return kind === 'video' ? videoReady : imagesReady || kind !== 'image'; }) });
      const pricedItems = kit().estimateKit({ plan: pricedPlan, ai, references, tasks: kitEstimateTasks(pricedPlan.deliverables, undefined, references) }).items;
      const priced = new Map(pricedItems.map(item => [item.id, item.usd])); const videoOf = new Map(pricedItems.filter(item => item.video).map(item => [item.id, item.video]));
      const text = plan.deliverables.filter(d => d.kind === 'text').length; const sets = plan.deliverables.filter(d => d.kind === 'image').length;
      // Which connection writes, draws and films this set, and the jobs on connections that report no cost.
      const tasks = Object.fromEntries(kitTaskIds(pricedPlan.deliverables.concat(plan.deliverables)).map(taskId => [taskId, routing.resolve(taskId)]));
      const labelOf = task => (task ? `${task.routeLabel}${task.modelLabel ? ` · ${task.modelLabel}` : ''}` : '');
      const writes = plan.deliverables.find(d => d.kind === 'text'); const writer = writes ? tasks[kitTextTask(writes.id)] : routing.resolve('assets.default');
      // What each picture set would send the image model now: { style, logo } from Settings → Brand reference images.
      const referencesFor = id => { const family = brandImages().familyForDeliverable(id); return brandImages().referenceSummary((w.brandImages || []).filter(image => image.family === family?.id)); };
      return {
        title: picked.source.title, sourceKey: picked.key, sourceKind: picked.kind, characters: picked.source.text.length, evidenceCount: (picked.source.evidence || []).length,
        earlierRuns: state.contentRuns.filter(run => run.workspaceId === w.id && run.kit?.sourceKey === picked.key).length,
        folders: kit().kitFolders(w.editionId).map(folder => ({ id: folder.id, name: folder.name, items: folder.deliverableIds.map(id => { const kind = content.CONTENT_DELIVERABLES.find(d => d.id === id).kind; return { id, label: kit().kitFileLabel(id, w.editionId), kind, ...(kind === 'image' ? { pictures: 3, references: referencesFor(id) } : {}), ...(kind === 'video' ? { video: { seconds: videoOf.get(id)?.seconds || routing.resolve('video.social-clip').video?.durationSeconds || 8, modelLabel: videoOf.get(id)?.modelLabel || '' }, optIn: true, references: referencesFor('brand-image') } : {}), selected: chosen.has(id), available: kind === 'video' ? videoReady : kind !== 'image' || imagesReady, ...(kind === 'video' && !videoReady ? { unavailable: routing.mediaProblem?.('video.social-clip') || 'Connect fal.ai in Settings, AI connections to make videos.' } : {}), usd: priced.get(id) ?? null }; }) })),
        // On Codex the writing uses the person's Codex plan or OpenAI key, and nothing reports what it cost.
        route: writer.route === 'codex' ? 'codex' : 'claude',
        routes: { writes: labelOf(writer), draws: labelOf(tasks['pictures.kit-image'] || routing.resolve('pictures.kit-image')), films: labelOf(tasks['video.social-clip'] || routing.resolve('video.social-clip')) },
        uncappedTasks: [...new Set(Object.values(tasks).filter(task => task.metered === false).map(task => task.label))],
        estimate, imagesReady, videosReady: videoReady, warnings: plan.warnings, edited: picked.edited || null,
        // About 3 minutes per written asset at the report model's effort, a few at a time; pictures run alongside.
        minutes: Math.max(5, Math.round(Math.max(Math.ceil(text / ai.concurrency) * 3, Math.ceil(sets / 2) * 4))),
      };
    },
    // onlyIfIdle (set by the server for channel owners): refuse while a set from the same source that makes any of the
    // same files is queued or running, so a double tap or two owners of one channel don't pay twice. The check and the
    // new run happen in one synchronous step, so two calls can't both pass it.
    createAssetKit(payload = {}) {
      const by = who(); const { w, picked, input, plan, ai, estimate } = kitPlan(payload); const createdAt = stamp();
      if (payload.onlyIfIdle === true) {
        const wanted = new Set(plan.deliverables.map(d => d.id));
        const busy = state.contentRuns.find(run => run.workspaceId === w.id && run.kit?.sourceKey === picked.key && (active.has(run.id) || ['queued', 'running'].includes(run.status)) && (run.jobs || []).some(job => wanted.has(job.id)));
        if (busy) throw refusal('alreadyMaking', { channel: kit().kitFolderFor((busy.jobs || []).find(job => wanted.has(job.id)).id, w.editionId).name }, 409);
      }
      const run = { id: id('content'), workspaceId: w.id, type: 'content', title: picked.source.title, ...(picked.reportAssetId ? { sourceAssetId: picked.reportAssetId } : {}), createdBy: by,
        kit: { version: 1, sourceKey: picked.key, sourceKind: picked.kind, sourceTitle: picked.source.title, folderName: kit().kitRunFolderName({ title: picked.source.title, editionId: w.editionId, createdAt }), concurrency: ai.concurrency, estimateUsd: estimate.totalUsd, ...(picked.reportAssetId ? { reportAssetId: picked.reportAssetId } : {}), ...(picked.themeId ? { themeId: picked.themeId } : {}), ...(picked.url ? { sourceUrl: picked.url } : {}) },
        ai: { model: ai.model, effort: ai.effort, ...(ai.route === 'codex' ? { route: 'codex' } : {}), version: 2, routing: routing.snapshot(kitTaskIds(plan.deliverables)) }, prompts: promptRecord(input.prompts), status: 'queued', stage: 'content', createdAt, maxBudgetUsd: budget(payload.maxBudgetUsd ?? estimate.capUsd), reservedUsd: 0, costUsd: 0, receipts: [], warnings: plan.warnings, progress: { completed: 0, total: plan.deliverables.length },
        jobs: plan.deliverables.map(d => ({ id: d.id, label: kit().kitFileLabel(d.id, w.editionId), kind: d.kind, folder: kit().kitFolderFor(d.id, w.editionId).name, status: 'queued' })) };
      // A short video whose model starts from a picture draws its first frame with the campaign set, so that set is kept
      // too even when the set's own hero graphic wasn't chosen (only chosen picture sets show in run.kit.references).
      // Only the workflow engine (its runs act as the workflow) may link a set to a workflow run.
      if (payload.workflow !== undefined) { if (!isWorkflowCall()) throw Object.assign(new Error('Only a workflow can link a set of channel assets to its run.'), { status: 403 }); run.workflow = workflowLink(payload.workflow); }
      const keyframeSet = run.ai.routing['video.keyframe'] && !plan.deliverables.some(d => d.id === 'brand-image') ? [{ id: 'brand-image', kind: 'image' }] : [];
      try { const references = Object.fromEntries(Object.entries(snapshotKitReferences(run, w, [...plan.deliverables, ...keyframeSet])).filter(([deliverableId]) => plan.deliverables.some(d => d.id === deliverableId))); if (Object.keys(references).length) run.kit.references = references; }
      catch (error) { try { fs.rmSync(path.join(root, 'runs', run.id), { recursive: true, force: true }); } catch (_) { /* the error that stopped the set is the one to report */ } throw error; }
      write(file(run.id, 'input.json'), input); state.contentRuns.unshift(run); save();
      return launch(run, () => performContent(run));
    },
    // A kit run as the folder n8n left in Drive: "<run folder>/<channel folder>/<n8n file name>", plus the source.
    // The Mac app writes it straight into a folder it names (Downloads); the browser studio zips an export copy, made with
    // `temporary` (not listed in state.exports) and removed by the host once the zip is offered.
    // `channels` (the server sets it from a channel owner's own channel) keeps only those channels' folders; the source
    // text goes along only for a trend's set, whose brief everyone with access to the set may read.
    // `platform` is the desktop app's (index.js passes its process.platform): on 'win32' names are fitted to Windows path
    // limits. Without it (the browser studio's zip, tests) names are left whole.
    exportAssetKit({ runId } = {}, { into, channels, temporary = false, platform = '' } = {}) {
      const run = runRecord(runId); if (!run.kit) throw new Error('Only channel asset sets download as folders.');
      const editionId = state.workspaces.find(w => w.id === run.workspaceId)?.editionId || 'general';
      let assets = state.assets.filter(asset => asset.workspaceId === run.workspaceId && asset.runId === run.id);
      if (Array.isArray(channels)) {
        assets = assets.filter(asset => channels.includes(kit().kitFolderFor(asset.deliverableId, editionId).id));
        if (!assets.length) throw new Error('Nothing for your channel is ready yet.');
      }
      if (!assets.length) throw new Error('Nothing is ready to download yet.');
      // The source the set was made from. A channel owner's export leaves it out unless it is the team's trend brief, so a
      // pasted text or private document never reaches them; everyone else's folder keeps it.
      const withSource = Boolean(run.kit.themeId || !Array.isArray(channels));
      const exportId = into ? '' : id('export'); const parent = into || path.join(root, 'exports', exportId);
      const folderName = title => kit().safeFileName(title === run.kit.sourceTitle ? run.kit.folderName : kit().kitRunFolderName({ title, editionId, createdAt: run.createdAt }));
      const channelDir = asset => kit().safeFileName(kit().kitFolderFor(asset.deliverableId, editionId).name);
      const fileName = (asset, title) => kit().safeFileName(kit().kitFileName({ deliverableId: asset.deliverableId, editionId, title, createdAt: run.createdAt, variant: Number.isInteger(asset.variantIndex) ? asset.variantIndex + 1 : 0 }));
      const sourceName = title => `${kit().safeFileName(`Source — ${title}`)}.md`;
      // Windows: Explorer, Office and zip tools can't open a path past 260 characters, and the title is in the folder name
      // and every file name. A long title is cut at a word until the deepest file fits in 240 (a video's .poster.png, after
      // a " (99)" copy number).
      const longest = title => { const top = path.join(parent, `${folderName(title)} (99)`); return Math.max(...assets.map(asset => path.join(top, channelDir(asset), fileName(asset, title)).length + '.poster.png'.length), withSource ? path.join(top, sourceName(title)).length : 0); };
      const title = platform === 'win32' ? kit().fitTitle(run.kit.sourceTitle, candidate => longest(candidate) <= 240) : run.kit.sourceTitle;
      const name = folderName(title);
      let top = path.join(parent, name);
      if (into) for (let copyNumber = 2; fs.existsSync(top); copyNumber++) top = path.join(into, `${name} (${copyNumber})`);
      for (const asset of assets) {
        const dir = path.join(top, channelDir(asset)); fs.mkdirSync(dir, { recursive: true });
        const base = path.join(dir, fileName(asset, title));
        // Pictures as PNG plus an SVG wrapper for Figma, the landing page as a web page, everything else as Markdown and HTML.
        // A video goes with its on-screen lines (.srt) and first frame (.poster.png) when it has them.
        for (const extension of asset.kind === 'video' ? videoExtensions(asset) : asset.kind === 'image' ? ['png', 'svg'] : asset.deliverableId === 'landingpage' ? ['html', 'md'] : ['md', 'html']) fs.copyFileSync(assetFile(asset, extension), `${base}.${extension}`);
      }
      if (withSource) fs.writeFileSync(path.join(top, sourceName(title)), read(file(run.id, 'input.json')).source.text);
      const result = { ...(exportId ? { id: exportId } : {}), workspaceId: run.workspaceId, runId: run.id, path: top, folderName: title === run.kit.sourceTitle ? run.kit.folderName : name, assetCount: assets.length, createdAt: stamp() };
      if (!into && !temporary) recordExport(result);
      return result;
    },
    assetKitAi: () => kitAiNow(workspace(state.activeWorkspaceId, false)),
    async cancelStudioRun({ runId }) {
      let run = runRecord(runId);
      // A quick scan's report run stops with its scan while the scan is waiting on it (Retry report runs it alone).
      if (run.scanReport === true) { const scan = state.researchRuns.find(row => row.id === run.researchRunId && row.workspaceId === run.workspaceId); if (scan && active.has(scan.id)) run = scan; }
      if (!active.has(run.id) && run.status !== 'awaiting-review') return withoutAsk(copy(run));
      stopped.add(run.id); await cancelProvider(run.id);
      for (const childId of [...(run.reportRunIds || []).map(entry => entry.runId), ...(run.scanReport?.runId ? [run.scanReport.runId] : [])]) { stopped.add(childId); await cancelProvider(childId); }
      run.status = 'cancelled'; run.message = 'Cancelled. Completed outputs are retained.'; updateScheduledRun(run); save(); return withoutAsk(copy(run));
    },
    // refreshPrompts: true takes the prompts saved since the run started, for the stages it hasn't finished (see
    // refreshRunPrompts); otherwise a retry writes with the run's own copy.
    retryStudioRun({ runId, maxBudgetUsd, refreshPrompts }) {
      const run = runRecord(runId); if (active.has(run.id)) throw new Error('This run is still active.'); if (run.status === 'succeeded') return copy(run);
      // One quick scan at a time in a workspace, for a retry as for a start; refused before anything about the run changes.
      if (run.type === 'research' && run.origin === 'quick-scan') { const busy = activeQuickScan(run.workspaceId, run.id); if (busy) throw quickScanBusy(busy); }
      if (maxBudgetUsd != null) { const next = budget(maxBudgetUsd); if (next < run.reservedUsd) throw new Error('Budget cannot be below already reserved spend.'); run.maxBudgetUsd = next; }
      if (refreshPrompts === true) refreshRunPrompts(run);
      // The files about to be tried again wait as queued (files already made stay), so no screen reads them as failed while
      // the retry runs; a channel whose own files are settled in a shared set is told it's finished (channel-view.js).
      if (run.type === 'content') for (const job of run.jobs || []) if (job.status !== 'succeeded') { job.status = 'queued'; delete job.error; }
      // Retry report: a quick scan's trends report tries again on its own, and its scan hears how it went.
      if (run.type === 'content' && run.scanReport === true) return retryScanReportRun(run);
      return withoutAsk(launch(run, () => run.type === 'content' ? performContent(run) : run.approvedAt ? performClassification(run) : performDiscovery(run)));
    },
    readStudioRun({ runId }) { return publicRun(runRecord(runId)); },
    readStudioAsset({ assetId }) { return assetResult(owned(state.assets, assetId)); },
    // Edits a written report or draft in place (D5): the edited Markdown and its page sit beside the generated files, and
    // everything made from the report afterwards uses them. baseEditedAt is the edit the person opened ('' for the
    // generated text); if someone saved or restored since, nothing is written and they're told who and when.
    editStudioAsset({ assetId, markdown, baseEditedAt } = {}) {
      const by = who(); const asset = owned(state.assets, assetId);
      checkEditable(asset, markdown);
      if ((asset.edited?.at || '') !== (typeof baseEditedAt === 'string' ? baseEditedAt : '')) { const last = asset.edited || asset.restored || {}; throw refusal('editConflict', { name: last.by?.name || 'Someone', time: when(last.at) }, 409); }
      writeEdit(asset, markdown);
      asset.edited = { at: stamp(), by }; delete asset.restored; save();
      editedOutside(asset, 'edited', markdown, by); assetChanged(asset, 'edited');
      return { asset: copy(asset) };
    },
    // Where a report, draft or picture is in the team's pipeline: Draft → In review → Approved → Scheduled → Published.
    // reviewStatus holds it (assets saved before this say 'draft'); `review` says who moved it and when, and Published
    // keeps the live link. The channel's "Using" answer lives in the team store, so a published channel asset made from
    // a trend comes back with adoptionSuggested and the screen records the answer with that link.
    setAssetStatus({ assetId, status, link } = {}) {
      const by = who(); const asset = owned(state.assets, assetId);
      if (!['draft', 'in-review', 'approved', 'scheduled', 'published'].includes(status)) throw new Error('Choose Draft, In review, Approved, Scheduled or Published.');
      const raw = typeof link === 'string' ? link.trim() : '';
      let live = '';
      if (status === 'published' && raw) {
        try { const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw.replace(/^\/+/, '')}`); if (['http:', 'https:'].includes(url.protocol) && url.hostname.includes('.') && !url.username && !url.password && !/\s/.test(raw) && url.href.length <= 2048) live = url.href; } catch (_) { live = ''; }
        if (!live) throw new Error('That doesn’t look like a web link.');
      }
      // Published again without a link keeps the link it already had.
      const kept = status === 'published' ? live || (asset.review?.status === 'published' ? asset.review.link || '' : '') : '';
      asset.reviewStatus = status; asset.review = { status, by, at: stamp(), ...(kept ? { link: kept } : {}) }; save();
      const run = state.contentRuns.find(row => row.id === asset.runId);
      const editionId = state.workspaces.find(w => w.id === asset.workspaceId)?.editionId || 'general';
      const themeId = run?.kit?.themeId || ''; const channelId = themeId ? kit().kitFolderFor(asset.deliverableId, editionId)?.id || '' : '';
      return { asset: copy(asset), ...(status === 'published' && themeId && channelId ? { adoptionSuggested: true, themeId, channelId, link: kept } : {}) };
    },
    // Back to the generated text. Drafts already made from the edit keep it.
    restoreStudioAsset({ assetId } = {}) {
      const by = who(); const asset = owned(state.assets, assetId);
      if (asset.kind !== 'text') throw new Error('Only written reports and drafts have an original to restore.');
      if (!asset.edited) return { asset: copy(asset) };
      delete asset.edited; asset.restored = { at: stamp(), by }; save();
      for (const extension of ['md', 'html']) fs.rmSync(editedFile(asset, extension), { force: true });
      editedOutside(asset, 'restored', null, by); assetChanged(asset, 'restored');
      return { asset: copy(asset) };
    },
    // Internal (not in studioMethods), for the report editor (report-docs.js). Its shared document has already merged
    // everyone's changes, so its Markdown is written without editStudioAsset's conflict check. persist: false keeps the
    // new asset.edited in memory until the next save (the files are written every time), so typing doesn't rewrite and
    // broadcast state.json every second and a half; the first edit always saves.
    writeReportMarkdown({ assetId, markdown, by, persist = true } = {}) {
      const asset = owned(state.assets, assetId);
      checkEditable(asset, markdown);
      writeEdit(asset, markdown);
      const first = !asset.edited;
      asset.edited = { at: stamp(), by: editorActor(by) }; delete asset.restored;
      if (persist || first) save();
      assetChanged(asset, 'edited'); // the Drive copy follows a minute after the last change
      return { asset: copy(asset), savedAt: asset.edited.at };
    },
    // Internal: the editor's Restore of the original (restoreStudioAsset without telling the editor about itself).
    clearReportEdits({ assetId, by } = {}) {
      const asset = owned(state.assets, assetId);
      if (asset.kind !== 'text') throw new Error('Only written reports and drafts have an original to restore.');
      if (!asset.edited) return { asset: copy(asset) };
      delete asset.edited; asset.restored = { at: stamp(), by: editorActor(by) }; save();
      for (const extension of ['md', 'html']) fs.rmSync(editedFile(asset, extension), { force: true });
      assetChanged(asset, 'restored');
      return { asset: copy(asset) };
    },
    // A short video opens (or, on the web, downloads) as its MP4.
    async openStudioAsset({ assetId }) { const asset = owned(state.assets, assetId); const target = asset.kind === 'image' ? file(asset.runId, `${asset.id}.png`) : asset.kind === 'video' ? file(asset.runId, `${asset.id}.mp4`) : assetFile(asset, 'html'); if (openFile) await openFile(target); return { path: target }; },
    async importStudioSource(payload) { if (!importSource) throw new Error('Document import is unavailable on this host. Paste source text instead.'); const source = await importSource(payload); if (!source) return null; content.normalizeSource({ ...source, kind: 'upload' }); return source; },
    async publishStudioRun({ runId }) {
      const run = runRecord(runId);
      if (!publishCampaign || !publicState().capabilities.googlePublishConfigured) throw new Error('Connect Google Drive with file creation permission in Settings first.');
      return publishRun(run);
    },
    // `temporary`: the browser studio's download copy, not listed in state.exports; the host removes it once zipped.
    exportStudioRun({ runId } = {}, { temporary = false } = {}) {
      const run = runRecord(runId); const ids = new Set([run.id, ...(run.reportRunIds || []).map(r => r.runId)]); const assets = state.assets.filter(a => a.workspaceId === run.workspaceId && ids.has(a.runId)); if (!assets.length) throw new Error('Generate at least one asset before exporting.');
      const exportId = id('export'); const dir = path.join(root, 'exports', exportId); fs.mkdirSync(dir, { recursive: true });
      for (const asset of assets) { const channel = asset.channel.replace(/[^a-zA-Z0-9_-]/g, '-'); const dest = path.join(dir, channel); fs.mkdirSync(dest, { recursive: true }); for (const extension of asset.kind === 'video' ? videoExtensions(asset) : asset.kind === 'image' ? ['png', 'svg'] : ['md', 'html', 'json']) fs.copyFileSync(assetFile(asset, extension), path.join(dest, `${asset.deliverableId}-${asset.id}.${extension}`)); }
      write(path.join(dir, 'manifest.json'), { exportedAt: stamp(), workspaceId: run.workspaceId, run: copy(run), assets, notice: 'Drafts require editorial review. SVG files embed raster images; they are not editable vectors.' });
      for (const childId of ids) fs.copyFileSync(file(childId, 'input.json'), path.join(dir, `${childId}-source.json`));
      const result = { id: exportId, workspaceId: run.workspaceId, runId, path: dir, assetCount: assets.length, createdAt: stamp() }; if (!temporary) recordExport(result); return result;
    },
    // Export copies older than `olderThanDays` (the browser studio's leftovers from before downloads were temporary), and
    // their state.exports rows. The Mac app keeps its exports; the host calls this only on the browser studio.
    pruneExports({ olderThanDays = 7 } = {}) {
      const dir = path.join(root, 'exports'); const cutoff = new Date(clock()).getTime() - Math.max(0, Number(olderThanDays) || 0) * 86400000; let removed = 0;
      let entries = []; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { entries = []; }
      for (const entry of entries) {
        if (!entry.isDirectory() || !/^export-[a-zA-Z0-9-]+$/.test(entry.name)) continue;
        const target = path.join(dir, entry.name);
        try { if (fs.statSync(target).mtimeMs < cutoff) { fs.rmSync(target, { recursive: true, force: true }); removed++; } } catch (_) { /* gone already */ }
      }
      const before = state.exports.length;
      state.exports = state.exports.filter(row => !row?.path || fs.existsSync(row.path));
      if (removed || state.exports.length !== before) save();
      return { removed, kept: state.exports.length };
    },
    activeWorkspaceId: () => state.activeWorkspaceId,
    // ---------- Reads for the access gate (src/main/access.js), all in the active workspace ----------
    findAsset(assetId) {
      if (typeof assetId !== 'string' || !/^[a-zA-Z0-9_-]{1,180}$/.test(assetId)) return null;
      const asset = state.assets.find(row => row.id === assetId && row.workspaceId === state.activeWorkspaceId); if (!asset) return null;
      const run = [...state.contentRuns, ...state.researchRuns].find(row => row.id === asset.runId);
      return { asset: copy(asset), run: run ? copy(run) : null };
    },
    findRun(runId) {
      if (typeof runId !== 'string' || !/^[a-zA-Z0-9_-]{1,180}$/.test(runId)) return null;
      const run = [...state.contentRuns, ...state.researchRuns].find(row => row.id === runId && row.workspaceId === state.activeWorkspaceId);
      return run ? copy(run) : null;
    },
    activeEditionId: () => state.workspaces.find(w => w.id === state.activeWorkspaceId)?.editionId || 'general',
    activeWorkspace() { const w = state.workspaces.find(row => row.id === state.activeWorkspaceId); return w ? { id: w.id, name: w.name, editionId: w.editionId } : null; },
    workspaceById(workspaceId) { const w = state.workspaces.find(row => row.id === workspaceId); return w ? { id: w.id, name: w.name, editionId: w.editionId } : null; },
    // Internal: a workspace hidden in this build (single-workspace mode archives the others). The Monday.com sync skips
    // a link saved on one, so a board linked before the switch stops syncing until the workspace comes back.
    isWorkspaceHidden: workspaceId => isArchived(workspaceId),
    // A trend's brief: the comprehensive report or editorial toolkit of a finished report run made for a trend.
    isTrendReport(asset) {
      const record = asset && state.assets.find(row => row.id === asset.id && row.workspaceId === state.activeWorkspaceId);
      if (!record || record.kind !== 'text' || !REPORT_DELIVERABLES.includes(record.deliverableId)) return false;
      const run = state.contentRuns.find(row => row.id === record.runId);
      return Boolean(run && !run.kit && run.status === 'succeeded' && run.themeId);
    },
    kitRunsFor: sourceKey => copy(state.contentRuns.filter(run => run.workspaceId === state.activeWorkspaceId && run.kit && run.kit.sourceKey === sourceKey)),
    // What channel-view's readyTrends reads, for the active workspace, without publicState()'s deep copy: callers only read.
    trendSource() { const mine = row => row.workspaceId === state.activeWorkspaceId; return { activeWorkspaceId: state.activeWorkspaceId, researchRuns: state.researchRuns.filter(mine), contentRuns: state.contentRuns.filter(mine), assets: state.assets.filter(mine), themes: state.themes.filter(mine) }; },
    // Internal (not in studioMethods): what the Monday.com sync builds its cards from, for one workspace. Callers only read.
    // docLinks: each report's Google Doc from the Drive receipts (the research run's, else the report run's); history:
    // the trend tracker (momentum, the same trend across runs), for the active workspace only.
    boardSource(workspaceId = state.activeWorkspaceId) {
      const mine = row => row.workspaceId === workspaceId; const researchRuns = state.researchRuns.filter(mine); const contentRuns = state.contentRuns.filter(mine);
      const assets = state.assets.filter(mine); const docLinks = {};
      for (const run of researchRuns) for (const entry of run.reportRunIds || []) {
        const report = contentRuns.find(row => row.id === entry.runId);
        for (const asset of assets) if (asset.runId === entry.runId && REPORT_DELIVERABLES.includes(asset.deliverableId)) { const url = (run.googleDelivery ? deliveredDoc(run.googleDelivery, asset) : '') || (report?.googleDelivery ? deliveredDoc(report.googleDelivery, asset) : '') || driveLink(asset.id); if (url) docLinks[asset.id] = url; }
      }
      let history = null; if (workspaceId === state.activeWorkspaceId) { try { history = trendHistory().history; } catch (_) { history = null; } }
      return { researchRuns, contentRuns, assets, programs: state.programs.filter(mine), editionId: state.workspaces.find(w => w.id === workspaceId)?.editionId || 'general', history, docLinks };
    },
    // Internal (not in studioMethods): the Google Drive folder sync (drive-sync.js) reads where each report goes from the
    // active workspace's runs and programs (callers only read), and each file's page: the report HTML every export uses
    // (the edit when there is one), with a toolkit's link to its trends report's Doc once that is in Drive, or the PNG.
    driveSource() {
      const mine = row => row.workspaceId === state.activeWorkspaceId;
      return { workspaceId: state.activeWorkspaceId, editionId: state.workspaces.find(w => w.id === state.activeWorkspaceId)?.editionId || 'general', researchRuns: state.researchRuns.filter(mine), contentRuns: state.contentRuns.filter(mine), assets: state.assets.filter(mine), programs: state.programs };
    },
    driveDocument(assetId, { trendsDocUrl = '' } = {}) {
      const asset = state.assets.find(row => row.id === assetId && row.workspaceId === state.activeWorkspaceId);
      if (!asset) return null;
      if (asset.kind === 'image') return { asset: copy(asset), png: fs.readFileSync(file(asset.runId, `${safeId(asset.id)}.png`)) };
      if (asset.kind !== 'text') return null;
      const url = /^https:\/\/docs\.google\.com\//.test(trendsDocUrl) ? trendsDocUrl : '';
      if (url && asset.deliverableId === 'editorial-toolkit') {
        if (assetFile(asset, 'html') === editedFile(asset, 'html')) return { asset: copy(asset), html: withTrendsLink(fs.readFileSync(editedFile(asset, 'html'), 'utf8'), url) };
        return { asset: copy(asset), html: content.renderContentExport({ ...read(file(asset.runId, `${asset.id}.json`)), trendsDocUrl: url }, { format: 'html' }) };
      }
      return { asset: copy(asset), html: fs.readFileSync(assetFile(asset, 'html'), 'utf8') };
    },
    picturesReady,
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
      const reports = (run.reportRunIds || []).map(entry => ({ themeId: entry.themeId, runId: entry.runId, assets: (state.assets || []).filter(asset => asset.runId === entry.runId).map(asset => ({ id: asset.id, deliverableId: asset.deliverableId, title: asset.title, url: deliveredDoc(run.googleDelivery, asset) })) }));
      const workspaceRuns = state.researchRuns.filter(row => row.workspaceId === run.workspaceId).map(row => ({ id: row.id, title: row.title, createdAt: row.createdAt }));
      const w = state.workspaces.find(row => row.id === run.workspaceId) || {};
      // Report links for every theme in the repository (Trend Velocity shows the latest docs per theme).
      const repositoryReports = {}; for (const researchRun of state.researchRuns.filter(row => row.workspaceId === run.workspaceId)) for (const entry of researchRun.reportRunIds || []) { const docs = (state.assets || []).filter(asset => asset.runId === entry.runId).map(asset => ({ deliverableId: asset.deliverableId, title: asset.title || '', createdAt: asset.createdAt, url: deliveredDoc(researchRun.googleDelivery, asset) })); if (docs.length && (!repositoryReports[entry.themeId] || String(docs[0].createdAt) > String(repositoryReports[entry.themeId][0].createdAt))) repositoryReports[entry.themeId] = docs; }
      // Trend Velocity counts runs per trend the way the Trend tracker links them, and names each trend's hero picture.
      const { trackerCounts, trendRuns, visuals } = velocityExtras();
      return { run: publicRun(run), program, evidence, raw, assignments, batches, themes: copy((state.themes || []).filter(t => t.workspaceId === run.workspaceId)), history: copy((state.history || []).filter(h => h.workspaceId === run.workspaceId)), detections: copy((state.detections || []).filter(d => d.workspaceId === run.workspaceId)), taxonomy: copy(w.taxonomy || null), repositoryReports, reports, runs: workspaceRuns, trackerCounts, trendRuns, visuals, version: researchWorkbookVersion(run) };
    },
    // Trend tracking over time: the Trend tracker workbook, Home's "What changed", Ask AI's trend memory and its `trend`
    // and `posts` lookups. Every read is scoped to the active workspace and rebuilt only when its runs change.
    listTrendHistorySources() {
      const observed = trendRunList().filter(trendObserved);
      const blank = { rising: 0, new: 0, steady: 0, fading: 0 };
      if (!observed.length) return { version: trendVersion(), runCount: 0, runsWithThemes: 0, quickScanCount: 0, trendCount: 0, counts: blank, sinceRun: null, createdAt: '', updatedAt: '', runs: [] };
      const { version, history, changes } = trendHistory();
      const research = history.trends.filter(trend => trend.origin === 'research'); const counts = { ...blank }; for (const trend of research) counts[trend.momentum]++;
      return { version, runCount: history.runCount, runsWithThemes: history.runsWithThemes, quickScanCount: history.quickScanCount, trendCount: history.trends.length, counts, sinceRun: changes.sinceRun,
        createdAt: observed.map(run => String(run.createdAt || '')).sort()[0] || '', updatedAt: observed.map(run => String(run.updatedAt || run.createdAt || '')).sort().at(-1) || '',
        runs: observed.map(run => ({ runId: run.id, programId: run.programId || '', title: run.title, origin: run.origin === 'quick-scan' ? 'quick-scan' : 'research', status: run.status, stage: run.stage, createdAt: run.createdAt, updatedAt: run.updatedAt || run.createdAt, themeCount: trendModule().runThemes(run).length })) };
    },
    readTrendHistorySource() { return trendHistorySource(trendVersion()); },
    // Ask AI's live context: what is rising, new and fading across every run, in at most 3,000 characters.
    trendMemory() { try { return copy(trendHistory().digest); } catch (_) { return null; } },
    readTrendHistory(payload = {}) {
      const { history, changes, digest } = trendHistory(); const limit = Math.round(Number(payload?.limit));
      const trends = history.trends.slice(0, Math.min(500, Math.max(1, Number.isFinite(limit) && limit > 0 ? limit : 200))).map(trendModule().compactTrend);
      return copy({ asOf: history.asOf, runCount: history.runCount, runsWithThemes: history.runsWithThemes, quickScanCount: history.quickScanCount, span: history.span, trends, categories: history.categories.map(({ weekly: _weekly, ...entry }) => entry), changes, digest });
    },
    readTrendRecord(payload = {}) {
      const record = trendModule().findTrend(trendHistory().history, { trendId: String(payload?.trendId || '').slice(0, 200), name: String(payload?.name || '').slice(0, 300) });
      return record ? copy(record) : null;
    },
    // Real posts behind "what are people saying about X": this workspace's research runs and quick scans from the last
    // `days`, ranked by how many query terms a post mentions, then engagement.
    searchRunPosts(payload = {}) {
      const query = String(payload?.query || '').slice(0, 300); if (!query.trim()) return [];
      const limit = Math.min(50, Math.max(1, Math.round(Number(payload?.limit)) || 12)); const days = Math.min(365, Math.max(1, Number(payload?.days) || 30));
      const since = new Date(clock()).getTime() - days * 86400000;
      const runs = trendRunList().filter(run => Date.parse(run.createdAt || '') >= since).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))).slice(0, 20);
      return copy(trendModule().rankPosts(runs.flatMap(runPosts), query, { limit }));
    },
    // "What people are saying" on a trend card: up to `limit` (1-10, default 2) real posts behind one trend, free (no AI)
    // and in the active workspace only. A trend is named by a theme id, a trend id (any theme id it has used) or its name.
    // The posts are the theme's tagged evidence in a run that was tagged, else the posts discovery cited for it; the
    // newest run first, then the most engaged. Each run's posts are cached by the run's version (trendPostsFor).
    readTrendPosts(payload = {}) {
      const limit = Math.min(10, Math.max(1, Math.round(Number(payload?.limit)) || 2));
      const themeId = String(payload?.themeId || '').slice(0, 200); const trendId = String(payload?.trendId || '').slice(0, 200); const name = String(payload?.name || '').slice(0, 300);
      if (!themeId && !trendId && !name.trim()) return [];
      const runs = trendRunList(); const byId = new Map(runs.map(run => [run.id, run]));
      let pairs = themeId ? runs.filter(run => trendModule().runThemes(run).some(theme => theme.id === themeId)).map(run => ({ run, themeId })) : [];
      if (!pairs.length) {
        let record = null; try { record = trendModule().findTrend(trendHistory().history, { trendId: trendId || themeId, name }); } catch (_) { record = null; }
        pairs = (record?.appearances || []).map(entry => ({ run: byId.get(entry.runId), themeId: entry.themeId })).filter(entry => entry.run);
      }
      pairs.sort((a, b) => String(b.run.createdAt || '').localeCompare(String(a.run.createdAt || '')));
      const seen = new Set(); const posts = [];
      for (const pair of pairs) for (const post of trendPostsFor(pair.run, pair.themeId)) {
        const key = post.url || post.text; if (seen.has(key)) continue; seen.add(key); posts.push(post);
        if (posts.length >= limit) return copy(posts);
      }
      return copy(posts);
    },
    // ---------- Prompt Library (SPEC-2 §A; the logic is in prompt-lab.js). Prompts are per workspace: the active one. ----------
    listPrompts: payload => promptLab().listPrompts(payload),
    readPrompt: payload => promptLab().readPrompt(payload),
    // Free: builds the real prompt from a recent run or the bundled sample, with the editable spans marked.
    previewPrompt: payload => promptLab().previewPrompt(payload),
    diffPromptVersions: payload => promptLab().diffPromptVersions(payload),
    // Saves and restores are checked, versioned and credited to the caller (who() plus getCallerRole).
    savePromptVersion: payload => promptLab().savePromptVersion(payload),
    revertPrompt: payload => promptLab().revertPrompt(payload),
    setPromptLock: payload => promptLab().setPromptLock(payload),
    estimatePromptTest: payload => promptLab().estimatePromptTest(payload),
    // Paid: refuses a fingerprint that no longer matches the estimate the person confirmed.
    testPrompt: payload => promptLab().testPrompt(payload),
    // For the host: the Claude models a test run needs (model preflight), and a prompt's saved text for the callers that
    // build their prompts live (Ask AI, Ask your datasets, dataset analysis, the Workflows asset pack). blocks null = defaults.
    promptTestModels: payload => promptLab().testModels(payload),
    // ---------- Model routing reads for the host (preflight before spending, Settings → Model routing tests) ----------
    routingPrograms,
    // The tasks a run will use when it continues or retries: its snapshot (or, for an older run, what its models resolve to).
    runTasks(runId) {
      let run; try { run = runRecord(runId); } catch (_) { return []; }
      if (run.ai?.routing) return Object.values(run.ai.routing);
      if (run.type === 'research') return ['discovery', 'synthesis', 'matching', 'tagging', 'reports'].map(stage => runTask(run, stageTaskId(run, stage)));
      return [runTask(run, run.kit ? 'assets.default' : run.researchRunId ? 'reports.trends-report' : 'create.drafts')];
    },
    contentRunTasks(payload = {}) {
      const ids = Array.isArray(payload.deliverableIds) ? payload.deliverableIds : [];
      const pictures = ids.some(key => content.CONTENT_DELIVERABLES.find(d => d.id === key)?.kind === 'image');
      return ['create.drafts', ...(pictures ? ['pictures.content-image'] : [])].map(taskId => routing.resolve(taskId));
    },
    kitTasks(payload = {}) {
      try { const { plan } = kitPlan(payload); return kitTaskIds(plan.deliverables).map(taskId => routing.resolve(taskId)); } catch (_) { return []; }
    },
    promptTestTasks: payload => promptLab().testTasks(payload),
    estimateAiTaskTest: payload => promptLab().estimateTaskTest(payload),
    testAiTask: payload => promptLab().testTask(payload),
    // The brand reference set a picture family sends now (Ask AI pictures read it at request start; that read is the copy).
    brandReferenceSet({ family = 'none', data = true } = {}) { return currentReferenceSet(state.workspaces.find(w => w.id === state.activeWorkspaceId), family, { data }); },
    promptEffective(promptId) {
      const w = state.workspaces.find(row => row.id === state.activeWorkspaceId);
      try { return w ? prompts.effective(w.id, w.editionId, promptId) : { version: 0, custom: false, blocks: null }; } catch (_) { return { version: 0, custom: false, blocks: null }; }
    },
    waitForIdle: async () => { while (active.size) await Promise.allSettled([...active.values()]); },
    // Runs working right now (any workspace), for the host's "quit anyway?" check.
    // ---------- Workflows (SPEC-3 wave 3B; src/main/workflow-engine.js) ----------
    // The engine's own way in: each start writes run.workflow ({ id, runId, name }) in the save that creates the run, and
    // is credited to the workflow (the host runs these as the workflow's actor). Existing methods are unchanged.
    startResearchRunFor({ programId, by = null, link } = {}) {
      const program = owned(state.programs, programId);
      api.checkResearchIdle({ programId });
      return withoutAsk(startResearchRun(program, [], '', by || who(), { workflow: workflowLink(link) }));
    },
    // A quick scan a workflow runs: no fingerprint (the workflow's approved budget binds the setup), still one quick scan
    // at a time in a workspace.
    startQuickScanFor({ scan, programId, by = null, link } = {}) {
      const { scan: planned, saved, derived, selection, fingerprint } = quickScanPlan({ programId, scan: { ...(scan || {}), report: true } });
      if (!collect) throw new Error('Source collection is unavailable on this host, so quick scans can’t run here.');
      const busy = activeQuickScan(state.activeWorkspaceId); if (busy) throw quickScanBusy(busy);
      const reportUsd = quickScanAiEstimate(derived, { report: true }).report.usd;
      const quickScan = { topic: planned.topic, depth: planned.depth, platforms: selection.platforms, lookbackHours: planned.lookbackHours, targets: selection.targets.map(({ platform, target }) => ({ platform, target })), itemsPerPlatform: planned.itemsPerPlatform, commentsPerPost: planned.commentsPerPost, fingerprint, report: true, reportUsd };
      return withoutAsk(startResearchRun({ ...derived, workspaceId: saved.workspaceId }, [], '', by || who(), { origin: 'quick-scan', quickScan, workflow: workflowLink(link) }));
    },
    // What a workflow's quick scan would cost and cap: { aboutUsd, capUsd, lines, warnings, blocked }.
    estimateQuickScanFor({ scan, programId } = {}) {
      const { derived, scan: planned } = quickScanPlan({ programId, scan: { ...(scan || {}), report: true } });
      const ai = quickScanAiEstimate(derived, { report: true }); const warnings = []; let collection = 0; let blocked = false;
      try { const receipt = require('../shared/research-collection').buildCollectionPlan(derived, { now: clock() }).receipt; collection = Math.min(receipt.worstCaseUsd, derived.budgets.collectionUsd); }
      catch (error) { warnings.push(safeError(error)); blocked = true; }
      if (!collect) { warnings.push('Source collection is unavailable on this host, so quick scans can’t run here.'); blocked = true; }
      return { aboutUsd: cents(ai.totalUsd + collection), capUsd: cents(derived.budgets.aiUsd + derived.budgets.collectionUsd), topic: planned.topic, warnings, blocked };
    },
    // A "whenever this program runs" workflow attaches to a run someone (or the program's schedule) started.
    linkRunToWorkflow({ runId, link } = {}) { const run = runRecord(runId); run.workflow = workflowLink(link); save(); return publicRun(run); },
    // Per trend at review time, for approval rules: momentum on the discovery basis ("momentum when found"), priority and
    // speed from scoring, posts and platforms from discovery.
    reviewSignals({ runId } = {}) {
      const run = runRecord(runId); const themes = run.discoveredThemes || run.themes || [];
      let momentum = {}; try { momentum = trendModule().reviewMomentum(trendHistorySource(trendVersion()), run.id); } catch (_) { momentum = {}; }
      return Object.fromEntries(themes.map(theme => [theme.id, { name: theme.name, momentum: momentum[theme.id] || 'new', priorityTier: theme.scoring?.priorityTier || '', priorityScore: Number.isFinite(theme.scoring?.priorityScore) ? theme.scoring.priorityScore : 0, velocity: theme.scoring?.velocity || '', posts: Number(theme.evidenceCount ?? theme.evidenceIds?.length) || 0, platforms: Array.isArray(theme.platforms) ? [...theme.platforms] : [] }]));
    },
    // A workflow whose rules approved nothing ends the review: every undecided trend is skipped (credited to the workflow)
    // and the run finishes, so the program's next run isn't held back by a review nobody will do.
    closeReviewFor({ runId, message = '' } = {}) {
      const by = who(); const run = runRecord(runId); if (run.type !== 'research' || run.status !== 'awaiting-review') throw new Error('This run is not awaiting theme review.');
      const at = stamp(); const discovered = run.discoveredThemes || run.themes || [];
      run.discoveredThemes ||= copy(run.themes); run.decisions = { ...(run.decisions || {}) }; run.decisionsBy = { ...(run.decisionsBy || {}) };
      for (const theme of discovered) if (run.decisions[theme.id] !== 'passed') { run.decisions[theme.id] = 'passed'; run.decisionsBy[theme.id] = { ...by, at }; }
      run.themes = []; run.approvedAt = at; run.decidedAt = at; run.status = 'succeeded'; run.stage = 'theme-review'; run.message = String(message || 'No trends were approved.').slice(0, 300);
      updateScheduledRun(run); save(); return publicRun(run);
    },
    // The reports a research run wrote, per approved trend.
    reportAssetsForRun({ runId } = {}) {
      const run = runRecord(runId);
      return (run.reportRunIds || []).map(entry => {
        const child = state.contentRuns.find(row => row.id === entry.runId); const own = state.assets.filter(asset => asset.runId === entry.runId);
        return { themeId: entry.themeId, contentRunId: entry.runId, status: child?.status || 'failed', reportAssetId: own.find(asset => asset.deliverableId === 'evidence-report')?.id || '', toolkitAssetId: own.find(asset => asset.deliverableId === 'editorial-toolkit')?.id || '' };
      });
    },
    // A typical set of channel assets priced before any report exists: against the workspace's newest trends report, or
    // the bundled sample brief. → { aboutUsd, capUsd } per set.
    estimateKitTypical({ workspaceId, deliverableIds } = {}) {
      const w = workspace(workspaceId); const kits = new Set(state.contentRuns.filter(run => run.kit).map(run => run.id));
      const newest = state.assets.filter(asset => asset.workspaceId === w.id && asset.deliverableId === 'evidence-report' && !kits.has(asset.runId)).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0];
      const sample = require('../shared/prompt-samples.json').source;
      const source = newest ? { kind: 'report', assetId: newest.id } : { kind: 'text', title: sample.title, text: sample.text };
      const { estimate } = kitPlan({ workspaceId: w.id, source, deliverableIds });
      return { aboutUsd: cents(estimate.totalUsd), capUsd: cents(estimate.capUsd), basis: newest ? 'report' : 'sample' };
    },
    activeWork: () => [...active.keys()].map(runId => [...state.researchRuns, ...state.contentRuns].find(run => run.id === runId)).filter(run => run && ['queued', 'running'].includes(run.status)).map(run => ({ runId: run.id, kind: run.type === 'research' ? 'research' : 'content', title: run.title || 'Untitled run', stage: run.stage || '' })),
  };
  function researchWorkbookVersion(run) {
    const stamp = name => { try { return fs.statSync(path.join(root, 'runs', run.id, name)).mtimeMs; } catch (_) { return 0; } };
    let cached = 0; try { cached = fs.readdirSync(path.join(root, 'runs', run.id)).filter(name => name.endsWith('.validated.json')).length; } catch (_) { /* No run folder yet. */ }
    return [run.updatedAt || run.createdAt, run.status, run.stage, stamp('evidence.json'), stamp('assignments.json'), cached, (run.themes || []).length, JSON.stringify(run.decisions || {}).length].join('|');
  }
  // ── Trend tracking over time (pure logic in shared/trend-history.js, loaded on use so older hosts keep starting) ──
  const trendModule = () => require('../shared/trend-history');
  // Existence checks and stats never go through file(), which creates the run folder.
  const runPath = (runId, name) => path.join(root, 'runs', runId, name);
  const mtime = target => { try { return fs.statSync(target).mtimeMs; } catch (_) { return 0; } };
  const trendRunList = () => state.researchRuns.filter(run => run.workspaceId === state.activeWorkspaceId);
  const trendObserved = run => Array.isArray(run.discoveredThemes) || (run.themes || []).length > 0;
  const themeStatsCache = new Map(); const postCache = new Map(); let trendCache = null;
  function trendRunVersion(run) {
    return [run.id, run.updatedAt || run.createdAt, run.status, run.stage, (run.discoveredThemes || []).length, (run.themes || []).map(theme => theme?.name || '').join('|').length, JSON.stringify(run.decisions || {}).length, (run.reportRunIds || []).length, (run.googleDelivery?.assets || []).length, mtime(runPath(run.id, 'assignments.json'))].join(':');
  }
  function trendVersion() {
    const runs = trendRunList(); const w = state.workspaces.find(row => row.id === state.activeWorkspaceId);
    const children = new Set(runs.flatMap(run => (run.reportRunIds || []).map(entry => entry.runId)));
    const reports = state.assets.filter(asset => children.has(asset.runId) && REPORT_DELIVERABLES.includes(asset.deliverableId));
    const parts = [state.activeWorkspaceId, (w?.taxonomy?.categories || []).length, reports.length, reports.map(asset => String(asset.createdAt || '')).sort().at(-1) || '', state.history.filter(row => row.workspaceId === state.activeWorkspaceId).length, ...runs.map(trendRunVersion)];
    return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32);
  }
  // Per-run theme numbers, cached as runs/<id>/theme-stats.json: written when classification finishes, counted here for
  // older runs (and again whenever the run's tags or themes change).
  function themeStatsFor(run, preload = null) {
    const evidencePath = runPath(run.id, 'evidence.json'); const assignmentsPath = runPath(run.id, 'assignments.json');
    if (!preload && !fs.existsSync(evidencePath)) return null;
    const ids = [...(run.discoveredThemes || []), ...(run.themes || [])].map(theme => theme?.id).filter(Boolean).sort();
    const key = createHash('sha256').update([mtime(evidencePath), mtime(assignmentsPath), ...ids].join('|')).digest('hex').slice(0, 24);
    const memo = themeStatsCache.get(run.id); if (!preload && memo?.key === key) return memo.stats;
    const target = runPath(run.id, 'theme-stats.json'); let stats = null;
    if (!preload) { try { const saved = read(target); if (saved?.version === 1 && saved.key === key) stats = saved; } catch (_) { /* Not written yet, or unreadable: count again below. */ } }
    if (!stats) {
      const evidence = preload ? preload.evidence : read(evidencePath).items || [];
      const assignments = preload ? preload.assignments : fs.existsSync(assignmentsPath) ? read(assignmentsPath) : [];
      stats = { ...trendModule().computeThemeStats({ run, evidence, assignments }), key, computedAt: stamp() };
      try { write(target, stats); } catch (_) { /* The cache is a convenience; these counts still serve this read. */ }
    }
    themeStatsCache.set(run.id, { key, stats });
    return stats;
  }
  function writeThemeStats(run, evidence, assignments) { try { themeStatsFor(run, { evidence, assignments }); } catch (_) { /* Counted again on the first read instead. */ } }
  function trendHistorySource(version) {
    const workspaceId = state.activeWorkspaceId; const runs = trendRunList(); const themeStats = {};
    for (const run of runs) {
      if (!trendObserved(run)) continue;
      let stats = null; try { stats = themeStatsFor(run); } catch (_) { stats = null; } // a damaged file leaves this run on discovery counts
      if (stats) themeStats[run.id] = { retained: stats.retained, discoveryEligible: stats.discoveryEligible, tagged: stats.tagged || {}, discovery: stats.discovery || {} };
    }
    const reportAssets = new Map(); for (const asset of state.assets) if (asset.workspaceId === workspaceId && REPORT_DELIVERABLES.includes(asset.deliverableId)) { if (!reportAssets.has(asset.runId)) reportAssets.set(asset.runId, []); reportAssets.get(asset.runId).push(asset); }
    const reports = [];
    for (const run of runs) for (const entry of run.reportRunIds || []) for (const asset of reportAssets.get(entry.runId) || []) reports.push({ researchRunId: run.id, themeId: entry.themeId, contentRunId: entry.runId, assetId: asset.id, deliverableId: asset.deliverableId, title: asset.title || '', createdAt: asset.createdAt || '', url: run.googleDelivery ? deliveredDoc(run.googleDelivery, asset) : '' });
    const w = state.workspaces.find(row => row.id === workspaceId) || {};
    return { workspaceId, runs: runs.map(run => ({ id: run.id, programId: run.programId || '', title: run.title || '', origin: run.origin === 'quick-scan' ? 'quick-scan' : 'research', status: run.status, stage: run.stage, createdAt: run.createdAt, updatedAt: run.updatedAt || run.createdAt, window: run.window || null, counts: run.counts || null, approvedAt: run.approvedAt || '', decisions: run.decisions || {}, discoveredThemes: run.discoveredThemes, themes: run.themes || [], quickScan: run.quickScan || null })),
      repository: state.themes.filter(theme => theme.workspaceId === workspaceId), history: state.history.filter(row => row.workspaceId === workspaceId), reports, themeStats, taxonomy: w.taxonomy || null, version };
  }
  function trendHistory() {
    const version = trendVersion();
    if (trendCache?.version === version) return trendCache;
    const trends = trendModule(); const history = trends.buildTrendHistory(trendHistorySource(version), { now: clock() });
    trendCache = { version, history, changes: trends.trendChanges(history), digest: trends.trendMemoryDigest(history, { limit: 12, maxChars: 3000 }) };
    return trendCache;
  }
  // Trend Velocity extras: runs-seen and momentum per theme id (every id a linked trend has used), how many runs have
  // found trends, and each trend's newest channel-asset hero picture.
  function velocityExtras() {
    let history = null; try { history = trendHistory().history; } catch (_) { history = null; }
    const trackerCounts = {};
    for (const trend of history?.trends || []) {
      if (trend.origin !== 'research') continue;
      const report = trend.reports.find(entry => entry.deliverableId === 'evidence-report');
      for (const themeId of trend.themeIds) trackerCounts[themeId] = { trendId: trend.trendId, runsSeen: trend.runsSeen, momentum: trend.momentum, reportTitle: report?.title || '', reportUrl: report?.url || '' };
    }
    const workspaceId = state.activeWorkspaceId; const reportTheme = new Map(); const assetTheme = new Map(); const images = new Map(); const visuals = {};
    for (const run of state.researchRuns) if (run.workspaceId === workspaceId) for (const entry of run.reportRunIds || []) reportTheme.set(entry.runId, entry.themeId);
    for (const asset of state.assets) {
      if (asset.workspaceId !== workspaceId) continue;
      if (reportTheme.has(asset.runId)) assetTheme.set(asset.id, reportTheme.get(asset.runId));
      if (asset.kind === 'image') { if (!images.has(asset.runId)) images.set(asset.runId, []); images.get(asset.runId).push(asset); }
    }
    const HERO = ['brand-image', 'sel-image', 'sel-social-image']; const rank = asset => (HERO.includes(asset.deliverableId) ? HERO.indexOf(asset.deliverableId) : HERO.length) * 10 + (Number(asset.variantIndex) || 0);
    for (const kitRun of state.contentRuns.filter(run => run.workspaceId === workspaceId && run.kit).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))) {
      const themeId = kitRun.kit.themeId || assetTheme.get(kitRun.kit.reportAssetId || kitRun.sourceAssetId); if (!themeId || visuals[themeId]) continue;
      const hero = [...(images.get(kitRun.id) || [])].sort((a, b) => rank(a) - rank(b))[0]; if (!hero) continue;
      const url = (kitRun.googleDelivery?.assets || []).find(row => row.assetId === hero.id)?.files?.find(entry => /^https:\/\//.test(entry?.url || ''))?.url || '';
      visuals[themeId] = { title: hero.title || 'Hero picture', url, createdAt: kitRun.createdAt || '' };
    }
    // A recurring trend shows its newest hero picture under every theme id it has used.
    for (const trend of history?.trends || []) {
      const newest = trend.themeIds.map(themeId => visuals[themeId]).filter(Boolean).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
      if (newest) for (const themeId of trend.themeIds) visuals[themeId] = newest;
    }
    return { trackerCounts, trendRuns: history?.runsWithThemes || 0, visuals };
  }
  // One run's posts per theme for readTrendPosts, cached by the run's version and its evidence file: [{ platform, author,
  // text (280 characters at most), url, publishedAt, engagement }], most engaged first, ten per theme.
  const trendPostCache = new Map();
  function trendPostsFor(run, themeId) {
    const evidencePath = runPath(run.id, 'evidence.json'); const assignmentsPath = runPath(run.id, 'assignments.json');
    const key = `${trendRunVersion(run)}|${mtime(evidencePath)}`;
    let memo = trendPostCache.get(run.id);
    if (memo?.key !== key) {
      let items = []; try { items = fs.existsSync(evidencePath) ? read(evidencePath).items || [] : []; } catch (_) { items = []; }
      let assignments = []; try { assignments = fs.existsSync(assignmentsPath) ? read(assignmentsPath) : []; } catch (_) { assignments = []; }
      const rows = new Map((Array.isArray(items) ? items : []).filter(item => item?.id).map(item => [item.id, item]));
      const tagged = new Map();
      for (const entry of Array.isArray(assignments) ? assignments : []) { if (!entry || entry.status === 'rejected' || !entry.themeId) continue; if (!tagged.has(entry.themeId)) tagged.set(entry.themeId, []); tagged.get(entry.themeId).push(entry.itemId); }
      const clip = value => (value.length > 280 ? `${value.slice(0, 279).trimEnd()}…` : value);
      const view = item => {
        const body = String(item.text || '').replace(/\s+/g, ' ').trim(); const title = String(item.title || '').replace(/\s+/g, ' ').trim();
        return { platform: String(item.platform || ''), author: String(item.authorName || item.author || '').slice(0, 120), text: clip(title && !body.startsWith(title) ? `${title} — ${body}` : body || title),
          url: /^https?:\/\//.test(item.url || '') ? item.url : '', publishedAt: String(item.publishedAt || ''), engagement: typeof item.engagement?.value === 'number' && Number.isFinite(item.engagement.value) ? Math.round(item.engagement.value * 100) / 100 : 0 };
      };
      memo = { key, byTheme: new Map() };
      for (const theme of trendModule().runThemes(run)) {
        const ids = tagged.get(theme.id)?.length ? tagged.get(theme.id) : Array.isArray(theme.evidenceIds) ? theme.evidenceIds : [];
        const posts = [...new Set(ids)].map(itemId => rows.get(itemId)).filter(item => item && (item.text || item.title)).map(view)
          .sort((a, b) => b.engagement - a.engagement || b.publishedAt.localeCompare(a.publishedAt));
        memo.byTheme.set(theme.id, posts.slice(0, 10));
      }
      trendPostCache.delete(run.id); trendPostCache.set(run.id, memo); while (trendPostCache.size > 8) trendPostCache.delete(trendPostCache.keys().next().value);
    }
    return memo.byTheme.get(themeId) || [];
  }
  function runPosts(run) {
    const target = runPath(run.id, 'evidence.json'); const key = mtime(target); if (!key) return [];
    const memo = postCache.get(run.id); if (memo?.key === key) return memo.posts;
    let items = []; try { items = read(target).items || []; } catch (_) { return []; }
    const { normalizeText } = trendModule(); const origin = run.origin === 'quick-scan' ? 'quick-scan' : 'research';
    const posts = items.filter(item => item && (item.text || item.title)).map(item => {
      const body = String(item.text || '').replace(/\s+/g, ' ').trim(); const title = String(item.title || '').replace(/\s+/g, ' ').trim();
      const text = title && !body.startsWith(title) ? `${title} — ${body}` : body || title;
      return { runId: run.id, runTitle: run.title || '', origin, platform: item.platform || '', author: String(item.author || ''), authorName: String(item.authorName || ''), community: String(item.community || ''), text: text.length > 400 ? `${text.slice(0, 399).trimEnd()}…` : text,
        url: /^https?:\/\//.test(item.url || '') ? item.url : '', publishedAt: item.publishedAt || '', engagement: typeof item.engagement?.value === 'number' && Number.isFinite(item.engagement.value) ? Math.round(item.engagement.value * 100) / 100 : 0,
        haystack: normalizeText(`${text} ${item.author || ''} ${item.authorName || ''} ${item.community || ''}`).slice(0, 2400) };
    });
    postCache.delete(run.id); postCache.set(run.id, { key, posts }); while (postCache.size > 8) postCache.delete(postCache.keys().next().value);
    return posts;
  }
  // Persist before exposing the service; startup does not emit events or run providers.
  const policyChanged = migrateWorkspacePolicy();
  if (migrateSemrushBrandDefaults() || policyChanged) write(stateFile, state);
  return api;
}
module.exports = { createContentWorkspace };
