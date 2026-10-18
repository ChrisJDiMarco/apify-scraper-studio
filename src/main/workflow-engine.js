'use strict';
// Workflows (SPEC-3 wave 3B): saved automations that run research programs and quick scans, approve trends by rules or
// wait for a person, write reports, make channel assets, update Monday.com and tell the team. The engine makes every
// decision deterministically (no AI calls of its own) and reuses the studio's own pipelines through the content
// workspace, so every AI route works and Model routing decides every model.
//
// Money: anything a workflow starts on its own spends only inside an approved per-run and per-month budget bound to a
// hash of the paid setup (workflow-core budgetHash); a manual run confirms its estimate, and a draft confirms a one-off
// cap. Each paid step is capped by its child run's own hard cap, and the caps are summed against the run's cap, so a run
// can never commit more than it may spend. On Codex nothing is metered: estimates stand in (spentEstimated).
//
// Who: a run acts with its owner's access, checked before every step; children are credited to the workflow
// ({ id: 'workflow:<id>', name }) through runAs. Desktop schedules run while the studio is open, like research schedules.
const { randomUUID } = require('crypto');
const core = require('../shared/workflow-core');
const research = require('../shared/research-program');
const kit = require('../shared/asset-kit');
const content = require('../shared/content-studio');
const PLAYBOOKS = require('../shared/playbooks.json').playbooks;
// The Trend board's cards for some research runs, built on the server with the board's own keys (`${runId}:${themeId}`)
// and stages by the Monday.com area's card builder (src/main/monday-cards.js, kept in step with trend-board.js).
const MONDAY_CARDS = { cardsForRuns: (studio, runIds) => require('./monday-cards').stageCards({ ...studio, researchRuns: (studio.researchRuns || []).filter((run) => runIds.includes(run.id)) }) };

const { CATALOG, LIMITS, NEW_PROGRAM_ID } = core;
const ACTIVE = new Set(['queued', 'running']);
const LIVE = new Set(['running', 'waiting-review', 'waiting-budget']);
const DONE_STEP = new Set(['done', 'partial', 'skipped']);
const list = (value) => (Array.isArray(value) ? value : []);
const copy = (value) => JSON.parse(JSON.stringify(value));
const cents = (value) => Math.round((Number(value) || 0) * 100) / 100;
const centsUp = (value) => Math.ceil((Number(value) || 0) * 100) / 100;
const fail = (message, status = 400, extra = {}) => Object.assign(new Error(message), { status, ...extra });
const money = (value) => `$${(Number(value) || 0).toFixed(2)}`;
const plural = (count, word, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;
const label = (kind) => CATALOG.steps[kind]?.label || kind;
const actorOf = (value) => ({ id: String(value?.id || 'system').slice(0, 320), name: String(value?.name || 'Automatic').slice(0, 120) });
const when = (value) => { const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }) : 'an earlier time'; };

function createWorkflowEngine({
  store, workspace, clock = () => new Date(), emit = () => {}, preflight = async () => {}, describeRoutes = async () => ({ models: [], uncapped: false }),
  monday = null, trendCards = MONDAY_CARDS, canIdentityCall = () => true, logActivity = () => {}, runAs = (actor, fn) => fn(),
  isDraining = () => false, desktop = true,
} = {}) {
  if (!store || !workspace) throw new Error('The workflow engine needs its store and the content workspace.');
  const stamp = () => new Date(clock()).toISOString();
  const nowMs = () => new Date(clock()).getTime();
  let timer; let pokeTimer; let ticking = false; let again = false; let stopped = false;
  const advancing = new Set();

  // ---------- Context ----------
  const studio = () => workspace.publicState();
  const activeId = () => workspace.activeWorkspaceId();
  const editionId = () => workspace.activeEditionId?.() || 'general';
  const kitFolderIds = () => kit.kitFolders(editionId()).map((folder) => folder.id);
  const imagesReady = () => { try { return Boolean(workspace.picturesReady()); } catch (_) { return false; } };
  const mondayConnected = () => { try { return Boolean(monday?.connected?.()); } catch (_) { return false; } };
  const programsNow = (extra = []) => [...list(studio().programs), ...extra];
  const byId = (programs) => Object.fromEntries(list(programs).map((program) => [program.id, program]));
  const hashOf = (workflow, extra = []) => core.budgetHash(workflow, byId(programsNow(extra)));
  const validate = (draft, extra = []) => core.validateWorkflow(draft, { programs: programsNow(extra), editionId: editionId(), kitFolderIds: kitFolderIds(), mondayConnected: mondayConnected(), imagesReady: imagesReady(), now: new Date(clock()) });
  const workflowActor = (workflow) => ({ id: `workflow:${workflow.id}`, name: workflow.name });
  const linkOf = (workflow, run) => ({ id: workflow.id, runId: run.id, name: workflow.name });
  const findWorkflow = (data, workflowId) => {
    const workflow = data.workflows.find((row) => row.id === workflowId && row.workspaceId === activeId());
    if (!workflow) throw fail('That workflow isn’t in this workspace anymore.', 404);
    return workflow;
  };
  const findRun = (data, runId) => {
    const run = data.runs.find((row) => row.id === runId && row.workspaceId === activeId());
    if (!run) throw fail('That workflow run isn’t in this workspace anymore.', 404);
    return run;
  };
  const liveRunOf = (data, workflowId) => data.runs.find((run) => run.workflowId === workflowId && LIVE.has(run.status)) || null;
  const childRun = (snapshot, runId) => (runId ? [...list(snapshot.researchRuns), ...list(snapshot.contentRuns)].find((run) => run.id === runId) || null : null);
  const programOf = (workflow, extra = []) => programsNow(extra).find((program) => program.id === workflow.steps?.[0]?.programId) || null;
  const monthOf = (at, workflow) => core.monthKey(at, workflow?.trigger?.schedule?.timeZone || 'UTC');

  // The deliverables an assets step makes for its channels: no videos (opt-in and costly), no pictures when they're off.
  function deliverablesFor(step) {
    const folders = kit.kitFolders(editionId()); const pictures = step.pictures !== false && imagesReady();
    const kindOf = (id) => content.CONTENT_DELIVERABLES.find((entry) => entry.id === id)?.kind || 'text';
    return folders.filter((folder) => list(step.channels).includes(folder.id)).flatMap((folder) => folder.deliverableIds).filter((id) => kindOf(id) !== 'video' && (pictures || kindOf(id) !== 'image'));
  }
  // How many trends a run may approve (what reports and assets are priced for).
  function expectedTrends(workflow, program) {
    const approve = list(workflow.steps).find((step) => step.kind === 'approve');
    const max = Number(program?.maxThemes) || 6;
    return !approve || approve.mode === 'all' ? max : Math.min(approve.maxApprove, max);
  }

  // ---------- Estimates ----------
  // Each paid step's hard cap (what a run commits before starting it) and its typical cost.
  function researchCost(program) {
    const estimate = workspace.estimateResearchProgram(program);
    const stages = estimate.ai?.stages || {};
    const collection = Math.min(Number(estimate.collection?.worstCaseUsd) || 0, program.budgets.collectionUsd);
    return { stages, collection, capUsd: cents(program.budgets.aiUsd + program.budgets.collectionUsd), warnings: estimate.collection?.error ? [estimate.collection.error] : [] };
  }
  function estimateSteps(workflow, extra = []) {
    const program = programOf(workflow, extra); const trends = expectedTrends(workflow, program);
    let research = null;
    return list(workflow.steps).map((step) => {
      const row = { stepId: step.id, kind: step.kind, label: label(step.kind), aboutUsd: 0, capUsd: 0, lines: [], warnings: [], blocked: false };
      try {
        if (step.kind === 'research' && program) {
          research = researchCost(program);
          const auto = program.autoApproveThemes ? (Number(research.stages.tagging) || 0) + (Number(research.stages.reports) || 0) : 0;
          row.aboutUsd = cents((Number(research.stages.discovery) || 0) + (Number(research.stages.synthesis) || 0) + (Number(research.stages.matching) || 0) + research.collection + auto);
          row.capUsd = research.capUsd; row.warnings.push(...research.warnings);
          row.lines.push(`Collects posts and finds trends, never more than ${money(row.capUsd)} (the program’s caps).`);
        } else if (step.kind === 'quick-scan') {
          const scan = workspace.estimateQuickScanFor({ scan: step.scan, programId: step.programId });
          Object.assign(row, { aboutUsd: scan.aboutUsd, capUsd: scan.capUsd, blocked: scan.blocked }); row.warnings.push(...scan.warnings);
          row.lines.push(`Scans for “${scan.topic}” and writes a short trends report, never more than ${money(scan.capUsd)}.`);
        } else if (step.kind === 'reports' && research) {
          const share = trends / Math.max(1, Number(program.maxThemes) || 6);
          row.aboutUsd = program.autoApproveThemes ? 0 : cents(((Number(research.stages.tagging) || 0) + (Number(research.stages.reports) || 0)) * share);
          row.lines.push(`Paid from the research step’s AI cap, for up to ${plural(trends, 'trend')}.`);
        } else if (step.kind === 'assets') {
          const deliverableIds = deliverablesFor(step);
          if (!deliverableIds.length) { row.warnings.push('Nothing can be made for these channels right now.'); row.blocked = true; }
          else {
            const set = workspace.estimateKitTypical({ deliverableIds });
            row.aboutUsd = cents(set.aboutUsd * trends); row.capUsd = cents(set.capUsd * trends);
            row.lines.push(`About ${money(set.aboutUsd)} a set, never more than ${money(set.capUsd)}, for up to ${plural(trends, 'report')}.`);
          }
        }
      } catch (error) { row.warnings.push(String(error.message || error)); row.blocked = true; }
      return row;
    });
  }
  async function estimateFor(draft, extra = []) {
    let validated; let warnings = [];
    try { ({ workflow: validated, warnings } = validate(draft, extra)); }
    catch (error) { return { steps: [], perRun: { aboutUsd: 0, capUsd: 0 }, perMonth: null, route: '', uncapped: false, models: [], warnings: [error.message], blocked: true, error: { field: error.field || '', message: error.message }, budgetHash: '' }; }
    const steps = estimateSteps(validated, extra);
    const perRun = { aboutUsd: cents(steps.reduce((sum, row) => sum + row.aboutUsd, 0)), capUsd: cents(steps.reduce((sum, row) => sum + row.capUsd, 0)) };
    const runs = core.runsPerMonth(validated.trigger, programsNow(extra), { now: new Date(clock()) });
    const perMonth = runs ? { runs, aboutUsd: cents(perRun.aboutUsd * runs.max), capUsd: cents(perRun.capUsd * runs.max) } : null;
    let routes = { models: [], uncapped: false }; try { routes = (await describeRoutes(validated, programsNow(extra))) || routes; } catch (_) { /* shown without model names */ }
    return { steps, perRun, perMonth, route: routes.uncapped ? 'codex' : 'claude', uncapped: Boolean(routes.uncapped), models: list(routes.models), warnings, blocked: steps.some((row) => row.blocked), budgetHash: hashOf(validated, extra), workflow: validated };
  }
  // The smallest cap a run can start with: its first (source) step's own cap.
  function minimumCap(workflow) { const [first] = estimateSteps({ ...workflow, steps: workflow.steps.slice(0, 1) }); return first?.capUsd || 0; }

  // ---------- Public shapes ----------
  // programs: the workspace's programs, read once per state push (publicState) rather than once per workflow.
  function publicWorkflow(workflow, data, programs = programsNow()) {
    const runs = data.runs.filter((run) => run.workflowId === workflow.id);
    const month = monthOf(stamp(), workflow);
    const hash = (() => { try { return core.budgetHash(workflow, byId(programs)); } catch (_) { return ''; } })();
    const live = runs.find((run) => LIVE.has(run.status));
    return { ...copy(workflow), needsBudget: !workflow.budget || workflow.budget.budgetHash !== hash, running: Boolean(live), liveRunId: live?.id || '', monthSpentUsd: cents(runs.filter((run) => monthOf(run.createdAt, workflow) === month).reduce((sum, run) => sum + (LIVE.has(run.status) ? Math.max(run.spentUsd, run.committedUsd) : run.spentUsd), 0)), programName: programs.find((program) => program.id === workflow.steps?.[0]?.programId)?.name || '' };
  }
  const runSummary = (run) => { const { steps, ...rest } = copy(run); return { ...rest, steps: list(steps).map(({ log: _log, ...step }) => step) }; };
  // given.programs: the studio's programs when the caller already has them (index.js publicState), saving a read.
  function publicState(workspaceId = activeId(), given = {}) {
    const data = store.read(); const mine = data.workflows.filter((workflow) => workflow.workspaceId === workspaceId);
    const programs = !mine.length ? [] : Array.isArray(given.programs) ? given.programs : programsNow();
    const workflows = mine.map((workflow) => publicWorkflow(workflow, data, programs));
    const runs = data.runs.filter((run) => run.workspaceId === workspaceId).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    const perWorkflow = new Map(); const workflowRuns = [];
    for (const run of runs) { const count = perWorkflow.get(run.workflowId) || 0; if (count >= 10) continue; perWorkflow.set(run.workflowId, count + 1); workflowRuns.push(runSummary(run)); }
    const month = core.monthKey(stamp(), 'UTC');
    const workflowSummary = {
      active: workflows.filter((workflow) => workflow.status === 'active').length,
      paused: workflows.filter((workflow) => workflow.status === 'paused').length,
      drafts: workflows.filter((workflow) => workflow.status === 'draft').length,
      waiting: runs.filter((run) => run.status === 'waiting-review' || run.status === 'waiting-budget').length,
      monthSpentUsd: cents(runs.filter((run) => core.monthKey(run.createdAt, 'UTC') === month).reduce((sum, run) => sum + (Number(run.spentUsd) || 0), 0)),
      monthCapUsd: cents(workflows.filter((workflow) => workflow.status === 'active' && workflow.budget).reduce((sum, workflow) => sum + (Number(workflow.budget.perMonthUsd) || 0), 0)),
    };
    return { workflows, workflowRuns, playbooks: data.playbooks.filter((playbook) => playbook.workspaceId === workspaceId).map(copy), workflowSummary };
  }

  // ---------- Saving ----------
  function save(payload = {}, actor) {
    const by = actorOf(actor); const input = payload.workflow && typeof payload.workflow === 'object' ? payload.workflow : null;
    if (!input) throw fail('Describe the workflow to save.');
    const { workflow: valid, warnings } = validate(input);
    // Runs act with the owner's access, so whoever saves may only include steps they could run themselves (an editor
    // can't route an admin-owned workflow into Monday.com without Export and publish). Admins hold every step.
    if (!actor?.admin) {
      const step = valid.steps.find((row) => !(CATALOG.steps[row.kind]?.methods || []).every((method) => { try { return canIdentityCall(by.id, method); } catch (_) { return false; } }));
      if (step) throw fail(`Your role can’t use the ${label(step.kind)} step, so this workflow wasn’t saved. Ask an admin.`, 403, { field: 'steps' });
    }
    const saved = store.change((data) => {
      const existing = input.id ? findWorkflow(data, input.id) : null;
      if (existing && payload.baseUpdatedAt && payload.baseUpdatedAt !== existing.updatedAt) throw fail(`${existing.updatedBy?.name || 'Someone'} saved this workflow at ${when(existing.updatedAt)}, after you opened it. Reload to see their changes.`, 409, { code: 'workflowConflict' });
      if (!existing && data.workflows.filter((row) => row.workspaceId === activeId()).length >= LIMITS.workflows) throw fail(`A workspace can have up to ${LIMITS.workflows} workflows. Delete one you no longer use first.`, 409);
      const at = stamp();
      const workflow = {
        id: existing?.id || `workflow-${randomUUID()}`, workspaceId: activeId(), ...valid,
        ...(input.playbookId || existing?.playbookId ? { playbookId: String(input.playbookId || existing.playbookId).slice(0, 120), playbookVersion: Number(input.playbookVersion || existing?.playbookVersion) || 1 } : {}),
        status: existing?.status || 'draft', pausedReason: existing?.pausedReason || '', needsAdmin: Boolean(existing?.needsAdmin),
        owner: existing?.owner || by, budget: existing?.budget || null,
        // "Save for an admin to approve": an admin's Inbox shows it until someone approves its budget.
        ...(payload.requestApproval === true ? { approvalRequested: { by, at } } : existing?.approvalRequested ? { approvalRequested: existing.approvalRequested } : {}),
        nextRunAt: '', lastRun: existing?.lastRun || null, consecutiveFailures: existing?.consecutiveFailures || 0,
        createdAt: existing?.createdAt || at, createdBy: existing?.createdBy || by, updatedAt: at, updatedBy: by,
      };
      // A change to what it may spend needs the budget approved again before it runs on its own.
      if (workflow.status === 'active' && (!workflow.budget || workflow.budget.budgetHash !== hashOf(workflow))) { workflow.status = 'draft'; workflow.pausedReason = 'The setup changed, so its budget needs approving again.'; }
      if (workflow.status === 'active') workflow.nextRunAt = core.nextTriggerAt(workflow.trigger, { from: at });
      data.workflows = [...data.workflows.filter((row) => row.id !== workflow.id), workflow];
      return workflow;
    });
    logActivity('workflow-changed', activeId(), { workflowId: saved.id, workflowName: saved.name, change: input.id ? 'edited' : 'created' }, by);
    emit();
    return { ...publicWorkflow(saved, store.read()), warnings };
  }

  function approveBudget(payload = {}, actor) {
    const by = actorOf(actor);
    const result = store.change((data) => {
      const workflow = findWorkflow(data, payload.workflowId);
      if (payload.takeOver === true) { workflow.owner = by; workflow.needsAdmin = false; if (workflow.pausedReason && /access/.test(workflow.pausedReason)) workflow.pausedReason = ''; }
      if (payload.budgetHash !== undefined || payload.perRunUsd !== undefined) {
        const current = hashOf(workflow);
        if (payload.budgetHash !== current) throw fail('The setup changed since you saw the cost. Check the cost again.', 409, { code: 'workflowChanged' });
        const perRun = Number(payload.perRunUsd); const perMonth = Number(payload.perMonthUsd);
        const [min, max] = LIMITS.budgetUsd;
        if (!Number.isFinite(perRun) || perRun < min || perRun > max) throw fail(`Choose a per-run budget from ${money(min)} to ${money(max)}.`);
        if (!Number.isFinite(perMonth) || perMonth < perRun || perMonth > max * 10) throw fail('Choose a monthly budget at least as big as one run’s.');
        const needed = minimumCap(workflow);
        if (perRun < needed) throw fail(`Each run needs at least ${money(needed)}: the first step alone can cost that much.`);
        workflow.budget = { perRunUsd: cents(perRun), perMonthUsd: cents(perMonth), budgetHash: current, approvedBy: by, approvedAt: stamp() };
        delete workflow.approvalRequested;
        // A run waiting for a bigger budget picks the new one up.
        for (const run of data.runs) if (run.workflowId === workflow.id && run.status === 'waiting-budget' && run.budgetHash === current) run.capUsd = Math.max(run.capUsd, workflow.budget.perRunUsd);
      }
      if (payload.activate === true) activate(workflow);
      workflow.updatedAt = stamp(); workflow.updatedBy = by;
      return workflow;
    });
    logActivity('workflow-changed', activeId(), { workflowId: result.id, workflowName: result.name, change: payload.takeOver ? 'taken-over' : 'budget-approved' }, by);
    emit(); poke();
    return publicWorkflow(result, store.read());
  }
  // Turning a workflow on: a matching approved budget, a setup that still passes (a program may have changed), a fresh
  // next run. Missed runs are never made up.
  function activate(workflow) {
    if (!workflow.budget || workflow.budget.budgetHash !== hashOf(workflow)) throw fail('Approve this workflow’s budget before turning it on.', 409, { code: 'workflowBudget' });
    validate(workflow);
    Object.assign(workflow, { status: 'active', pausedReason: '', needsAdmin: false, consecutiveFailures: 0, nextRunAt: core.nextTriggerAt(workflow.trigger, { from: stamp() }) });
  }

  async function setStatus(payload = {}, actor) {
    const by = actorOf(actor); const status = payload.status;
    if (!['active', 'paused'].includes(status)) throw fail('Choose to turn it on or pause it.');
    if (payload.all === true) {
      if (!actor?.admin) throw fail('Only an admin can pause every workflow.', 403);
      if (status !== 'paused') throw fail('Turn workflows back on one at a time, after checking each budget.');
      const paused = store.change((data) => { let count = 0; for (const workflow of data.workflows) if (workflow.workspaceId === activeId() && workflow.status === 'active') { Object.assign(workflow, { status: 'paused', nextRunAt: '', pausedReason: `Paused by ${by.name}.`, updatedAt: stamp(), updatedBy: by }); count++; } return count; });
      logActivity('workflow-changed', activeId(), { change: 'paused-all', count: paused }, by); emit();
      return { paused };
    }
    const result = store.change((data) => {
      const workflow = findWorkflow(data, payload.workflowId);
      if (status === 'paused') Object.assign(workflow, { status: 'paused', nextRunAt: '', pausedReason: `Paused by ${by.name}.` });
      else activate(workflow);
      workflow.updatedAt = stamp(); workflow.updatedBy = by;
      return workflow;
    });
    if (status === 'paused' && payload.stopRun === true) { const live = liveRunOf(store.read(), result.id); if (live) await cancelRun({ runId: live.id }, actor); }
    logActivity('workflow-changed', activeId(), { workflowId: result.id, workflowName: result.name, change: status === 'paused' ? 'paused' : 'resumed' }, by);
    emit(); poke();
    return publicWorkflow(result, store.read());
  }

  function remove(payload = {}, actor) {
    const removed = store.change((data) => {
      const workflow = findWorkflow(data, payload.workflowId);
      if (liveRunOf(data, workflow.id)) throw fail('This workflow is running. Stop the run first.', 409);
      data.workflows = data.workflows.filter((row) => row.id !== workflow.id);
      data.runs = data.runs.filter((run) => run.workflowId !== workflow.id);
      return workflow;
    });
    logActivity('workflow-changed', activeId(), { workflowId: removed.id, workflowName: removed.name, change: 'deleted' }, actorOf(actor));
    emit();
    return { deleted: true, workflowId: removed.id };
  }

  // ---------- Runs ----------
  const blankStep = (step) => ({ stepId: step.id, kind: step.kind, status: 'pending', startedAt: '', finishedAt: '', message: '', refs: {}, log: [] });
  function newRun(workflow, { trigger, startedBy, capUsd, budgetHash, status = 'running', message = 'Starting.', uncapped = false }) {
    const at = stamp();
    return {
      id: `wfrun-${randomUUID()}`, workflowId: workflow.id, workspaceId: workflow.workspaceId, workflowName: workflow.name, trigger, startedBy: actorOf(startedBy),
      status, message, needsAdmin: false, budgetHash, capUsd: cents(capUsd), committedUsd: 0, spentUsd: 0, spentEstimated: Boolean(uncapped),
      currentStepId: status === 'running' ? workflow.steps[0].id : '', plan: copy(workflow.steps), steps: workflow.steps.map(blankStep),
      createdAt: at, updatedAt: at, finishedAt: status === 'running' ? '' : at,
    };
  }
  function putRun(run) {
    run.updatedAt = stamp();
    store.change((data) => {
      data.runs = [...data.runs.filter((row) => row.id !== run.id), run];
      const workflow = data.workflows.find((row) => row.id === run.workflowId);
      if (workflow) workflow.lastRun = { id: run.id, status: run.status, at: run.updatedAt };
    });
  }
  function recordSkipped(workflow, trigger, reason) {
    const run = newRun(workflow, { trigger, startedBy: workflow.owner, capUsd: 0, budgetHash: '', status: 'skipped', message: reason });
    run.steps.forEach((step) => { step.status = 'skipped'; });
    putRun(run); return run;
  }
  const logStep = (step, text) => { step.log = [...list(step.log), { at: stamp(), text: String(text).slice(0, 300) }].slice(-50); };

  async function startRun(workflow, { trigger, startedBy, capUsd, budgetHash, attachResearchRunId = '' }) {
    const routes = await describeRoutes(workflow, programsNow()).catch(() => ({ uncapped: false }));
    const run = newRun(workflow, { trigger, startedBy, capUsd, budgetHash, uncapped: routes?.uncapped });
    if (attachResearchRunId) {
      const step = run.steps[0]; step.status = 'running'; step.startedAt = stamp(); step.refs.researchRunId = attachResearchRunId;
      logStep(step, 'Following the program’s run that someone started.');
    }
    putRun(run);
    if (attachResearchRunId) { try { runAs(workflowActor(workflow), () => workspace.linkRunToWorkflow({ runId: attachResearchRunId, link: linkOf(workflow, run) })); } catch (_) { /* recover() rebuilds the link */ } }
    logActivity('workflow-run', workflow.workspaceId, { workflowId: workflow.id, workflowName: workflow.name, runId: run.id, trigger, status: 'started' }, actorOf(startedBy));
    emit();
    return run;
  }

  async function run(payload = {}, actor) {
    const by = actorOf(actor); const data = store.read(); const workflow = findWorkflow(data, payload.workflowId);
    validate(workflow);
    const current = hashOf(workflow);
    if (payload.budgetHash !== current) throw fail('The setup changed since you saw the cost. Check the cost again.', 409, { code: 'workflowChanged' });
    if (liveRunOf(data, workflow.id)) throw fail('This workflow is already running.', 409);
    const approved = workflow.budget && workflow.budget.budgetHash === current;
    let capUsd = approved ? workflow.budget.perRunUsd : Number(payload.capUsd);
    if (!approved) {
      const [min, max] = LIMITS.oneOffCapUsd; const needed = Math.max(min, minimumCap(workflow));
      if (!Number.isFinite(capUsd) || capUsd < needed || capUsd > max) throw fail(`Choose a cap for this run from ${money(needed)} to ${money(max)}.`, 400, { field: 'capUsd' });
    }
    if (workflow.steps[0].kind === 'research') workspace.checkResearchIdle({ programId: workflow.steps[0].programId });
    await preflight(workflow);
    const started = await startRun(workflow, { trigger: 'manual', startedBy: by, capUsd, budgetHash: current });
    await advance(started.id);
    return runSummary(findRun(store.read(), started.id));
  }

  // ---------- The step machine ----------
  function stopRun(run, status, message, { needsAdmin = false } = {}) {
    run.status = status; run.message = message; run.needsAdmin = run.needsAdmin || needsAdmin; run.currentStepId = ''; run.finishedAt = stamp(); delete run.waiting;
  }
  // Paid step guard: the owner's hash still matches, and the step's cap fits in the run's cap and the month's budget.
  function roomFor(run, workflow, stepCap, data) {
    if (hashOf(workflow) !== run.budgetHash) return { ok: false, changed: true, message: 'The setup changed since its budget was approved. Approve the budget again, then try again.' };
    if (cents(run.committedUsd + stepCap) > run.capUsd + 1e-9) return { ok: false, message: `Needs a bigger budget: the next step can cost up to ${money(stepCap)} and ${money(Math.max(0, run.capUsd - run.committedUsd))} is left for this run.`, needUsd: centsUp(run.committedUsd + stepCap) };
    if (workflow.budget && workflow.budget.budgetHash === run.budgetHash) {
      const month = monthOf(run.createdAt, workflow);
      const used = data.runs.filter((row) => row.workflowId === workflow.id && row.id !== run.id && monthOf(row.createdAt, workflow) === month).reduce((sum, row) => sum + (LIVE.has(row.status) ? Math.max(row.committedUsd, row.spentUsd) : row.spentUsd), 0);
      if (cents(used + run.committedUsd + stepCap) > workflow.budget.perMonthUsd + 1e-9) return { ok: false, message: `Needs a bigger budget: this month’s ${money(workflow.budget.perMonthUsd)} would run out.`, month: true };
    }
    return { ok: true };
  }
  function waitForBudget(run, step, room) {
    step.status = 'waiting'; step.message = room.message; logStep(step, room.message);
    run.status = 'waiting-budget'; run.message = room.message; run.waiting = { kind: 'budget', since: run.waiting?.since || stamp(), count: 0, ...(room.needUsd ? { needUsd: room.needUsd } : {}) };
  }
  function ownerAllowed(workflow, step) {
    const methods = CATALOG.steps[step.kind]?.methods || [];
    return methods.every((method) => { try { return canIdentityCall(workflow.owner?.id, method); } catch (_) { return false; } });
  }
  function pauseWorkflow(workflowId, reason, { needsAdmin = false } = {}) {
    store.change((data) => { const workflow = data.workflows.find((row) => row.id === workflowId); if (workflow) Object.assign(workflow, { status: 'paused', nextRunAt: '', pausedReason: reason, needsAdmin: Boolean(workflow.needsAdmin || needsAdmin) }); });
  }
  function spend(run, snapshot) {
    let spent = 0; let estimated = 0;
    for (const step of run.steps) {
      const refs = step.refs || {};
      for (const id of [refs.researchRunId, refs.quickScanRunId].filter(Boolean)) { const child = childRun(snapshot, id); if (child) spent += (Number(child.costUsd) || 0) + (Number(child.collectionReceipt?.costUsd) || 0); }
      for (const entry of list(refs.kitRuns)) spent += Number(childRun(snapshot, entry.contentRunId)?.costUsd) || 0;
      estimated += Number(refs.estimateUsd) || 0;
    }
    run.spentUsd = cents(run.spentEstimated ? Math.max(spent, estimated) : spent);
  }
  const discoveredOf = (child) => list(child?.discoveredThemes).length ? child.discoveredThemes : list(child?.themes);
  const decidedByPeople = (child) => Object.keys(child?.decisions || {}).filter((themeId) => !String(child.decisionsBy?.[themeId]?.id || '').startsWith('workflow:'));

  // One pass over a run: each step either finishes, waits for its child, or stops the run. Never re-runs a finished step.
  async function advance(runId) {
    if (advancing.has(runId)) return;
    advancing.add(runId);
    try {
      const data = store.read(); const run = data.runs.find((row) => row.id === runId);
      if (!run || !LIVE.has(run.status) || run.workspaceId !== activeId()) return;
      const workflow = data.workflows.find((row) => row.id === run.workflowId);
      if (!workflow) { stopRun(run, 'cancelled', 'The workflow was deleted.'); putRun(run); return; }
      const before = JSON.stringify(run);
      if (run.status === 'waiting-budget') run.status = 'running';
      await walk(run, { ...workflow, steps: run.plan || workflow.steps }, workflow, data);
      spend(run, studio());
      if (JSON.stringify(run) !== before) { putRun(run); if (!LIVE.has(run.status)) finish(run, workflow); emit(); }
    } finally { advancing.delete(runId); }
  }

  async function walk(run, plan, workflow, data) {
    const actor = workflowActor(workflow); const link = linkOf(workflow, run);
    const as = (fn) => runAs(actor, fn);
    for (const [index, step] of run.steps.entries()) {
      if (DONE_STEP.has(step.status)) continue;
      const config = plan.steps[index] || {};
      run.currentStepId = step.stepId;
      if (step.status === 'failed') { stopRun(run, run.steps.some((row) => row.status === 'done') ? 'partial' : 'failed', `Stopped at ${label(step.kind)}: ${step.message || 'it failed'}`); return; }
      if (step.status === 'pending') {
        if (!ownerAllowed(workflow, config)) {
          const reason = `${workflow.owner?.name || 'The owner'} no longer has access to ${label(step.kind)}. An admin can take over this workflow.`;
          step.status = 'failed'; step.message = reason; pauseWorkflow(workflow.id, reason, { needsAdmin: true });
          stopRun(run, run.steps.some((row) => row.status === 'done') ? 'partial' : 'failed', reason, { needsAdmin: true }); return;
        }
      }
      const snapshot = studio();
      const sourceRun = childRun(snapshot, run.steps[0]?.refs?.researchRunId);
      const result = await STEPS[step.kind]({ run, step, config, plan, workflow, data, snapshot, sourceRun, as, link });
      if (result === 'wait' || !LIVE.has(run.status)) return;
      // A failed Monday.com sync leaves the run partial and lets telling the team go ahead; anything else stops here.
      if (step.status === 'failed' && step.kind !== 'monday') { stopRun(run, run.steps.some((row) => row.status === 'done') ? 'partial' : 'failed', `Stopped at ${label(step.kind)}: ${step.message || 'it failed'}`); return; }
    }
    stopRun(run, run.steps.some((row) => row.status === 'failed') ? (run.steps.some((row) => row.status === 'done') ? 'partial' : 'failed') : run.steps.some((row) => row.status === 'partial') ? 'partial' : 'succeeded', '');
  }

  const begin = (step, text) => { step.status = 'running'; step.startedAt ||= stamp(); if (text) { step.message = text; logStep(step, text); } };
  const done = (step, text, status = 'done') => { step.status = status; step.finishedAt = stamp(); if (text) { step.message = text; logStep(step, text); } return 'next'; };
  const failed = (step, text) => { step.status = 'failed'; step.finishedAt = stamp(); step.message = text; logStep(step, text); return 'next'; };
  const childMessage = (child) => String(child?.message || child?.status || 'it stopped').replace(/\s+/g, ' ').slice(0, 240);

  const STEPS = {
    research({ run, step, config, workflow, data, snapshot, as, link }) {
      if (!step.refs.researchRunId) {
        const program = programOf(workflow);
        if (!program) return failed(step, 'The research program was deleted.');
        const cap = cents(program.budgets.aiUsd + program.budgets.collectionUsd);
        const room = roomFor(run, workflow, cap, data);
        if (!room.ok) { if (room.changed) { failed(step, room.message); return 'next'; } waitForBudget(run, step, room); return 'wait'; }
        let child;
        try { child = as(() => workspace.startResearchRunFor({ programId: config.programId, link })); }
        catch (error) { return failed(step, String(error.message || error)); }
        let about = 0; try { about = estimateSteps({ ...workflow, steps: [config] })[0]?.aboutUsd || 0; } catch (_) { about = 0; }
        step.refs.researchRunId = child.id; step.refs.estimateUsd = about; run.committedUsd = cents(run.committedUsd + cap);
        begin(step, `Started “${program.name}”.`); run.status = 'running'; run.message = 'Finding trends';
        return 'wait';
      }
      const child = childRun(snapshot, step.refs.researchRunId);
      if (!child) return failed(step, 'The research run is no longer in this workspace.');
      begin(step);
      const found = discoveredOf(child).length;
      if (child.status === 'awaiting-review') return done(step, `Found ${plural(found, 'trend')}.`);
      if (ACTIVE.has(child.status)) { if (child.approvedAt) return done(step, `Found ${plural(found, 'trend')}; the program approves every trend itself.`); run.message = 'Finding trends'; return 'wait'; }
      if (['succeeded', 'partial'].includes(child.status)) {
        if (!found) { done(step, 'No new trends this time.'); for (const rest of run.steps.slice(1)) if (rest.status === 'pending') rest.status = 'skipped'; stopRun(run, 'succeeded', 'No new trends this time.'); return 'wait'; }
        return done(step, `Found ${plural(found, 'trend')}.`);
      }
      return failed(step, `The research run stopped: ${childMessage(child)}`);
    },
    'quick-scan'({ run, step, config, workflow, data, snapshot, as, link }) {
      if (!step.refs.quickScanRunId) {
        let estimate;
        try { estimate = workspace.estimateQuickScanFor({ scan: config.scan, programId: config.programId }); } catch (error) { return failed(step, String(error.message || error)); }
        if (estimate.blocked) return failed(step, estimate.warnings[0] || 'This quick scan can’t run right now.');
        const room = roomFor(run, workflow, estimate.capUsd, data);
        if (!room.ok) { if (room.changed) return failed(step, room.message); waitForBudget(run, step, room); return 'wait'; }
        let child;
        try { child = as(() => workspace.startQuickScanFor({ scan: config.scan, programId: config.programId, link })); }
        catch (error) { return failed(step, String(error.message || error)); }
        step.refs.quickScanRunId = child.id; step.refs.estimateUsd = estimate.aboutUsd; run.committedUsd = cents(run.committedUsd + estimate.capUsd);
        begin(step, `Scanning for “${config.scan.topic}”.`); run.status = 'running'; run.message = 'Running a quick scan';
        return 'wait';
      }
      const child = childRun(snapshot, step.refs.quickScanRunId);
      if (!child) return failed(step, 'The quick scan is no longer in this workspace.');
      if (ACTIVE.has(child.status)) return 'wait';
      if (['succeeded', 'partial'].includes(child.status)) {
        const names = discoveredOf(child).map((theme) => theme.name).filter(Boolean);
        step.refs.trends = names.slice(0, 10); step.refs.scanReportAssetId = child.scanReport?.assetId || '';
        return done(step, names.length ? `Found ${plural(names.length, 'trend')}: ${names.slice(0, 3).join(', ')}${names.length > 3 ? '…' : ''}.` : 'No new trends this time.');
      }
      return failed(step, `The quick scan stopped: ${childMessage(child)}`);
    },
    async approve({ run, step, config, plan, workflow, sourceRun: child, as }) {
      if (!child) return failed(step, 'The research run is no longer in this workspace.');
      const discovered = discoveredOf(child);
      if (child.status === 'awaiting-review' && !child.approvedAt) {
        if (step.status === 'pending') {
          begin(step);
          const people = decidedByPeople(child);
          if (config.mode === 'all') return finishApproval({ run, step, config, child, as, people, all: true });
          if (config.mode === 'rules') {
            const signals = workspace.reviewSignals({ runId: child.id });
            const { approved } = core.selectByRules(discovered, signals, config, people);
            for (const pick of approved) {
              try {
                as(() => workspace.decideResearchTheme({ runId: child.id, themeId: pick.themeId, decision: 'approved', channels: config.channels, note: config.note || `Approved by rule: ${pick.reason}` }));
                logActivity('trend-decision', run.workspaceId, { runId: child.id, themeId: pick.themeId, trendName: pick.name, decision: 'approved', workflowId: workflow.id }, workflowActor(workflow));
              } catch (error) { logStep(step, `Couldn’t approve “${pick.name}”: ${error.message}`); }
            }
            step.refs.approved = approved;
            logStep(step, approved.length ? `Approved ${plural(approved.length, 'trend')} by rule: ${approved.map((row) => `${row.name} (${row.reason})`).join('; ')}.` : 'No trend met the rules.');
            if (config.otherwise === 'skip') return finishApproval({ run, step, config, child: workspace.findRun(child.id) || child, as, people });
          }
          step.status = 'waiting'; step.message = 'Waiting for someone’s OK.';
          run.waiting = { kind: 'review', since: stamp(), count: 0, untilAt: new Date(nowMs() + config.waitHours * 3600000).toISOString() };
          const mondayStep = plan.steps.find((row) => row.kind === 'monday');
          if (mondayStep?.alsoAtReview) await syncMonday(run, workflow, child.id).catch(() => null);
        }
        const latest = workspace.findRun(child.id) || child;
        const undecided = discoveredOf(latest).filter((theme) => !latest.decisions?.[theme.id]);
        run.status = 'waiting-review'; run.waiting = { ...(run.waiting || { kind: 'review', since: stamp() }), count: undecided.length };
        run.message = `Waiting for your OK on ${plural(undecided.length, 'trend')}`;
        const timedOut = run.waiting.untilAt && nowMs() >= Date.parse(run.waiting.untilAt);
        if (undecided.length && !timedOut) return 'wait';
        if (undecided.length && config.afterWait === 'stop') { done(step, 'Stopped waiting for review.', 'partial'); for (const rest of run.steps) if (rest.status === 'pending') rest.status = 'skipped'; stopRun(run, 'partial', 'Stopped waiting for review.'); return 'wait'; }
        run.status = 'running'; delete run.waiting;
        return finishApproval({ run, step, config, child: latest, as, people: decidedByPeople(latest) });
      }
      if (child.approvedAt) {
        step.refs.decidedByPeople = decidedByPeople(child);
        delete run.waiting; run.status = 'running';
        return done(step, child.autoApproved ? 'The program approves every trend itself.' : `${plural(list(child.themes).length, 'trend')} approved; someone wrote reports.`);
      }
      return failed(step, `The research run stopped: ${childMessage(child)}`);
    },
    reports({ run, step, workflow, data, sourceRun: child, as }) {
      if (!child) return failed(step, 'The research run is no longer in this workspace.');
      if (child.status === 'awaiting-review' && child.approvedAt) {
        if (step.status === 'running' && step.refs.continued) return 'wait';
        const room = roomFor(run, workflow, 0, data);
        if (!room.ok) return failed(step, room.message);
        try { as(() => workspace.continueResearchRun({ runId: child.id })); } catch (error) { return failed(step, String(error.message || error)); }
        step.refs.continued = true; begin(step, `Writing reports for ${plural(list(child.themes).length, 'trend')}.`); run.message = 'Writing reports';
        return 'wait';
      }
      if (ACTIVE.has(child.status)) { begin(step); run.message = 'Writing reports'; return 'wait'; }
      const reports = (() => { try { return workspace.reportAssetsForRun({ runId: child.id }); } catch (_) { return []; } })();
      step.refs.reportRuns = reports.filter((row) => row.reportAssetId).map(({ themeId, contentRunId, reportAssetId }) => ({ themeId, contentRunId, reportAssetId }));
      if (child.status === 'succeeded') return done(step, `${plural(step.refs.reportRuns.length, 'report')} written.`);
      if (child.status === 'partial' && step.refs.reportRuns.length) return done(step, `${plural(step.refs.reportRuns.length, 'report')} written; some need attention.`, 'partial');
      return failed(step, `Reports stopped: ${childMessage(child)}`);
    },
    assets({ run, step, config, workflow, data, as, link }) {
      const reportsStep = run.steps.find((row) => row.kind === 'reports');
      const reports = list(reportsStep?.refs?.reportRuns);
      step.refs.kitRuns = list(step.refs.kitRuns);
      const deliverableIds = deliverablesFor(config);
      if (!deliverableIds.length) return done(step, 'Nothing could be made for these channels.', 'skipped');
      begin(step);
      for (const report of reports) {
        if (step.refs.kitRuns.some((entry) => entry.themeId === report.themeId)) continue;
        let plan;
        try { plan = workspace.planAssetKit({ source: { kind: 'report', assetId: report.reportAssetId }, deliverableIds }); } catch (error) { logStep(step, `Couldn’t plan a set: ${error.message}`); step.refs.kitRuns.push({ themeId: report.themeId, contentRunId: '', error: String(error.message || error).slice(0, 200) }); continue; }
        const left = cents(run.capUsd - run.committedUsd); const about = Number(plan.estimate?.totalUsd) || 0;
        const cap = cents(Math.min(Number(plan.estimate?.capUsd) || about, left));
        const room = cap >= about && cap >= 0.01 ? roomFor(run, workflow, cap, data) : { ok: false, message: `Needs a bigger budget: the next set can cost about ${money(about)} and ${money(left)} is left for this run.`, needUsd: centsUp(run.committedUsd + about) };
        if (!room.ok) { if (room.changed) return failed(step, room.message); waitForBudget(run, step, room); return 'wait'; }
        let child;
        try { child = as(() => workspace.createAssetKit({ source: { kind: 'report', assetId: report.reportAssetId }, deliverableIds, maxBudgetUsd: cap, ...(config.teamNotes ? { teamNotes: config.teamNotes } : {}), workflow: link })); }
        catch (error) { logStep(step, `Couldn’t start a set: ${error.message}`); step.refs.kitRuns.push({ themeId: report.themeId, contentRunId: '', error: String(error.message || error).slice(0, 200) }); continue; }
        step.refs.kitRuns.push({ themeId: report.themeId, contentRunId: child.id }); step.refs.estimateUsd = cents((Number(step.refs.estimateUsd) || 0) + about);
        run.committedUsd = cents(run.committedUsd + cap); run.status = 'running'; run.message = 'Making channel assets';
        logStep(step, `Making ${plural(deliverableIds.length, 'asset')} for “${child.title || 'a trend'}”.`);
      }
      const now = studio(); // sets started above aren't in the step's earlier snapshot
      const children = step.refs.kitRuns.map((entry) => (entry.contentRunId ? childRun(now, entry.contentRunId) : null));
      if (children.some((child) => child && ACTIVE.has(child.status))) { run.message = 'Making channel assets'; return 'wait'; }
      const made = children.filter((child) => child?.status === 'succeeded').length;
      if (!step.refs.kitRuns.length) return done(step, 'No reports to make assets from.', 'skipped');
      return made === step.refs.kitRuns.length ? done(step, `${plural(made, 'set')} of channel assets made.`) : made ? done(step, `${made} of ${plural(step.refs.kitRuns.length, 'set')} made; the rest need attention.`, 'partial') : failed(step, 'The channel asset sets need attention.');
    },
    async monday({ run, step, workflow, sourceRun }) {
      if (!mondayConnected()) return done(step, 'Monday.com isn’t connected, so this step was skipped.', 'skipped');
      begin(step);
      try { const result = await syncMonday(run, workflow, sourceRun?.id); step.refs.monday = result; if (result.skipped) return done(step, 'Monday.com syncing is paused or off, so this step was skipped.', 'skipped'); return result.failed ? done(step, `Monday.com: ${result.created} added, ${result.updated} updated, ${result.failed} failed.`, 'partial') : done(step, `Monday.com: ${result.created} added, ${result.updated} updated.`); }
      catch (error) { return failed(step, `Monday.com sync failed: ${String(error.message || error).slice(0, 200)}; everything else finished.`); }
    },
    notify({ run, step, config }) {
      run.notify = { audience: list(config.audience), slackSummary: Boolean(config.slackSummary), summary: summaryOf(run) };
      return done(step, `Told ${config.audience.map((who) => CATALOG.audiences[who] || who).join(' and ').toLowerCase()} in their Inbox.`);
    },
  };

  // Approve the trends now marked yes (a rule's or a person's) and skip the rest for good; none approved closes the review.
  function finishApproval({ run, step, child, as, all = false, people = [] }) {
    const discovered = discoveredOf(child);
    const passedByPeople = new Set(people.filter((themeId) => child.decisions?.[themeId] === 'passed'));
    const ids = all ? discovered.map((theme) => theme.id).filter((themeId) => !passedByPeople.has(themeId)) : Object.entries(child.decisions || {}).filter(([, decision]) => decision === 'approved').map(([themeId]) => themeId);
    step.refs.decidedByPeople = people;
    if (!ids.length) {
      try { as(() => workspace.closeReviewFor({ runId: child.id, message: 'Nothing met the workflow’s rules, so these trends were skipped.' })); } catch (error) { return failed(step, String(error.message || error)); }
      done(step, 'Nothing met the rules.');
      for (const rest of run.steps) if (rest.status === 'pending') rest.status = 'skipped';
      stopRun(run, 'succeeded', 'Nothing met the rules.'); return 'wait';
    }
    try { as(() => workspace.approveResearchThemes({ runId: child.id, themes: ids.slice(0, 6) })); } catch (error) { return failed(step, String(error.message || error)); }
    delete run.waiting; run.status = 'running';
    return done(step, `${plural(ids.length, 'trend')} approved. Trends nobody decided are skipped.`);
  }

  async function syncMonday(run, workflow, researchRunId) {
    if (!researchRunId) return { created: 0, updated: 0, failed: 0 };
    const cards = trendCards.cardsForRuns(studio(), [researchRunId]);
    const result = await monday.syncCards({ workspaceId: run.workspaceId, cards, summary: `${workflow.name}: ${plural(cards.length, 'trend')}` });
    // A push that stopped (monday-engine returns { error } after logging and pausing or backing off) isn't a success.
    if (result?.error) throw new Error('it stopped early (the Monday.com log says why)');
    return { created: Number(result?.created) || 0, updated: Number(result?.updated) || 0, failed: list(result?.failed).length || Number(result?.failed) || 0, ...(result?.skipped ? { skipped: String(result.skipped) } : {}) };
  }

  function summaryOf(run) {
    const approved = run.steps.find((step) => step.kind === 'approve');
    const trends = list(approved?.refs?.approved).length + list(approved?.refs?.decidedByPeople).length;
    const reports = list(run.steps.find((step) => step.kind === 'reports')?.refs?.reportRuns).length;
    const kits = list(run.steps.find((step) => step.kind === 'assets')?.refs?.kitRuns).filter((entry) => entry.contentRunId).length;
    const scan = run.steps.find((step) => step.kind === 'quick-scan');
    if (scan) return `${run.workflowName}: ${list(scan.refs?.trends).length ? `found ${list(scan.refs.trends).join(', ')}` : 'no new trends'}.`;
    return `${run.workflowName}: ${[trends && plural(trends, 'trend'), reports && plural(reports, 'report'), kits && plural(kits, 'asset set')].filter(Boolean).join(', ') || 'nothing new'}.`;
  }

  // A run that ended: the workflow's last run, three failures in a row pause it, and the activity log hears.
  function finish(run, workflow) {
    if (!run.message) run.message = run.status === 'succeeded' ? `Done · ${summaryOf(run).replace(/^[^:]*:\s*/, '').replace(/\.$/, '')}` : run.message;
    store.change((data) => {
      const target = data.workflows.find((row) => row.id === workflow.id); if (!target) return;
      target.lastRun = { id: run.id, status: run.status, at: run.finishedAt || stamp() };
      target.consecutiveFailures = run.status === 'failed' ? (Number(target.consecutiveFailures) || 0) + 1 : 0;
      if (target.consecutiveFailures >= LIMITS.failuresBeforePause && target.status === 'active') Object.assign(target, { status: 'paused', nextRunAt: '', pausedReason: `Paused after ${LIMITS.failuresBeforePause} failed runs in a row. Check the last run, then turn it back on.` });
      const stored = data.runs.find((row) => row.id === run.id); if (stored) Object.assign(stored, { message: run.message });
    });
    logActivity('workflow-run', run.workspaceId, { workflowId: workflow.id, workflowName: workflow.name, runId: run.id, status: run.status }, workflowActor(workflow));
  }

  async function cancelRun(payload = {}, actor) {
    const data = store.read(); const target = findRun(data, payload.runId);
    if (!LIVE.has(target.status)) return runSummary(target);
    const snapshot = studio();
    for (const step of target.steps) {
      const ids = [step.refs?.researchRunId, step.refs?.quickScanRunId, ...list(step.refs?.kitRuns).map((entry) => entry.contentRunId)].filter(Boolean);
      for (const id of ids) { const child = childRun(snapshot, id); if (child && ACTIVE.has(child.status)) { try { await workspace.cancelStudioRun({ runId: id }); } catch (_) { /* already finished */ } } }
      if (['running', 'waiting'].includes(step.status)) { step.status = 'failed'; step.message = 'Stopped.'; }
    }
    stopRun(target, 'cancelled', `Stopped by ${actorOf(actor).name}.`);
    putRun(target); emit();
    return runSummary(target);
  }

  async function retryRun(payload = {}, actor) {
    const data = store.read(); const target = findRun(data, payload.runId); const workflow = findWorkflow(data, target.workflowId);
    if (!['failed', 'partial', 'cancelled', 'waiting-budget'].includes(target.status)) throw fail('Only a run that stopped can be tried again.', 409);
    const current = hashOf(workflow);
    if (payload.budgetHash !== current) throw fail('The setup changed since you saw the cost. Check the cost again.', 409, { code: 'workflowChanged' });
    if (liveRunOf(data, workflow.id) && liveRunOf(data, workflow.id).id !== target.id) throw fail('This workflow is already running.', 409);
    const approved = workflow.budget && workflow.budget.budgetHash === current;
    // An approved budget is the cap (raising it is approveWorkflowBudget's, like run()); only a run without one takes a
    // one-off cap here.
    const asked = approved ? NaN : Number(payload.capUsd);
    const cap = Math.max(target.capUsd, approved ? workflow.budget.perRunUsd : 0, Number.isFinite(asked) ? Math.min(asked, LIMITS.oneOffCapUsd[1]) : 0);
    await preflight(workflow);
    const snapshot = studio(); const actorRun = workflowActor(workflow);
    for (const step of target.steps) {
      // Finished steps never run again; a partial report or asset step finishes what's left.
      const retryable = ['failed', 'waiting', 'running', 'pending'].includes(step.status) || (step.status === 'partial' && ['reports', 'assets'].includes(step.kind));
      if (!retryable) continue;
      if (step.kind === 'assets') step.refs.kitRuns = list(step.refs.kitRuns).filter((entry) => entry.contentRunId);
      if (step.kind === 'reports') delete step.refs.continued;
      // Reports are written by the research run itself, so retrying them retries that run.
      const ids = [step.refs?.researchRunId, step.refs?.quickScanRunId, ...(step.kind === 'reports' ? [target.steps[0]?.refs?.researchRunId] : []), ...list(step.refs?.kitRuns).map((entry) => entry.contentRunId)].filter(Boolean);
      // A child that stopped resumes itself (retryStudioRun keeps what it finished, so nothing is paid twice).
      for (const id of ids) { const child = childRun(snapshot, id); if (child && ['failed', 'partial', 'cancelled'].includes(child.status)) runAs(actorRun, () => workspace.retryStudioRun({ runId: id })); }
      step.status = ids.length ? 'running' : 'pending'; step.message = ''; logStep(step, `Trying again (${actorOf(actor).name}).`);
    }
    Object.assign(target, { status: 'running', message: 'Trying again.', capUsd: cents(cap), finishedAt: '', needsAdmin: false, retries: (Number(target.retries) || 0) + 1 }); delete target.waiting;
    putRun(target); emit();
    await advance(target.id);
    return runSummary(findRun(store.read(), target.id));
  }

  function readRun(payload = {}) { return copy(findRun(store.read(), payload.runId)); }

  // ---------- Triggers ----------
  function onResearchRunStarted(child) {
    if (!child || child.origin === 'quick-scan' || child.workflow) return;
    const data = store.read();
    for (const workflow of data.workflows) {
      if (workflow.workspaceId !== child.workspaceId || workflow.status !== 'active' || workflow.trigger?.kind !== 'program-run' || workflow.trigger.programId !== child.programId) continue;
      if (liveRunOf(data, workflow.id)) { recordSkipped(workflow, 'program-run', 'Another run of this workflow was still going.'); continue; }
      const current = hashOf(workflow);
      if (!workflow.budget || workflow.budget.budgetHash !== current) { recordSkipped(workflow, 'program-run', 'Its budget needs approving again.'); continue; }
      startRun(workflow, { trigger: 'program-run', startedBy: workflow.owner, capUsd: workflow.budget.perRunUsd, budgetHash: current, attachResearchRunId: child.id }).then(() => poke(), () => null);
      return;
    }
  }

  async function tick() {
    if (ticking) { again = true; return; }
    ticking = true;
    try {
      do {
        again = false;
        const data = store.read(); const now = stamp(); const workspaceId = activeId();
        for (const workflow of data.workflows) {
          if (workflow.workspaceId !== workspaceId || workflow.status !== 'active' || workflow.trigger?.kind !== 'schedule' || !workflow.nextRunAt || Date.parse(workflow.nextRunAt) > Date.parse(now)) continue;
          const next = core.nextTriggerAt(workflow.trigger, { from: now });
          store.change((draft) => { const row = draft.workflows.find((entry) => entry.id === workflow.id); if (row) { row.nextRunAt = next; if (!next) Object.assign(row, { status: 'paused', pausedReason: 'Finished: its last day has passed.' }); } });
          if (stopped || isDraining()) { recordSkipped(workflow, 'schedule', 'The studio was restarting.'); continue; }
          if (liveRunOf(store.read(), workflow.id)) { recordSkipped(workflow, 'schedule', 'The previous run was still going.'); continue; }
          const current = hashOf(workflow);
          if (!workflow.budget || workflow.budget.budgetHash !== current) { pauseWorkflow(workflow.id, 'The setup changed since its budget was approved. Approve the budget again to turn it back on.'); recordSkipped(workflow, 'schedule', 'The setup changed since its budget was approved.'); continue; }
          if (workflow.steps[0].kind === 'research') { try { workspace.checkResearchIdle({ programId: workflow.steps[0].programId }); } catch (error) { recordSkipped(workflow, 'schedule', String(error.message || error)); continue; } }
          try { await preflight(workflow); }
          catch (error) { const skipped = recordSkipped(workflow, 'schedule', String(error.message || error)); skipped.status = 'failed'; putRun(skipped); finish(skipped, workflow); continue; }
          await startRun(workflow, { trigger: 'schedule', startedBy: workflow.owner, capUsd: workflow.budget.perRunUsd, budgetHash: current });
        }
        for (const run of store.read().runs) if (run.workspaceId === workspaceId && LIVE.has(run.status)) await advance(run.id);
      } while (again && !stopped);
    } finally { ticking = false; }
  }

  // After a restart: children the content workspace marked failed fail their step (Try again picks up there), and refs a
  // lost write missed are rebuilt from run.workflow on the children.
  function recover() {
    const snapshot = studio(); const children = [...list(snapshot.researchRuns), ...list(snapshot.contentRuns)].filter((row) => row.workflow?.runId);
    store.change((data) => {
      for (const run of data.runs) {
        if (!LIVE.has(run.status)) continue;
        for (const child of children.filter((row) => row.workflow.runId === run.id)) {
          if (child.type === 'research' && child.origin !== 'quick-scan') { const step = run.steps.find((row) => row.kind === 'research'); if (step && !step.refs.researchRunId) { step.refs.researchRunId = child.id; step.status = 'running'; } }
          else if (child.type === 'research') { const step = run.steps.find((row) => row.kind === 'quick-scan'); if (step && !step.refs.quickScanRunId) { step.refs.quickScanRunId = child.id; step.status = 'running'; } }
          else if (child.kit) { const step = run.steps.find((row) => row.kind === 'assets'); if (step && !list(step.refs.kitRuns).some((entry) => entry.contentRunId === child.id)) { step.refs.kitRuns = [...list(step.refs.kitRuns), { themeId: child.kit.themeId || '', contentRunId: child.id }]; step.status = 'running'; } }
        }
        let stoppedHere = false;
        for (const step of run.steps) {
          if (step.status !== 'running') continue;
          const ids = [step.refs.researchRunId, step.refs.quickScanRunId, ...list(step.refs.kitRuns).map((entry) => entry.contentRunId)].filter(Boolean);
          if (ids.some((id) => ['failed', 'partial'].includes(childRun(snapshot, id)?.status) && /app stopped/i.test(childRun(snapshot, id)?.message || ''))) { step.status = 'failed'; step.message = 'The studio stopped during this step. Try again picks up here.'; stoppedHere = true; }
        }
        if (stoppedHere) { run.status = run.steps.some((row) => row.status === 'done') ? 'partial' : 'failed'; run.message = 'The studio stopped during this run. Try again picks up where it stopped.'; run.finishedAt = stamp(); run.currentStepId = ''; delete run.waiting; }
      }
    });
  }

  function start() { stopped = false; recover(); clearInterval(timer); timer = setInterval(() => { tick().catch(() => null); }, 30000); timer.unref?.(); tick().catch(() => null); }
  function stop() { stopped = true; clearInterval(timer); timer = undefined; clearTimeout(pokeTimer); pokeTimer = undefined; }
  function poke() { if (stopped || pokeTimer) return; pokeTimer = setTimeout(() => { pokeTimer = undefined; tick().catch(() => null); }, 500); pokeTimer.unref?.(); }

  // ---------- Schedules elsewhere ----------
  // A program with its own schedule and a scheduled workflow on it would run twice: refused both ways.
  function assertNoScheduleConflict(program = {}) {
    if (!program?.id || !program.schedule?.enabled || program.schedule.frequency === 'manual') return;
    const clash = store.read().workflows.find((workflow) => workflow.workspaceId === activeId() && workflow.status !== 'paused' && workflow.trigger?.kind === 'schedule' && workflow.steps?.[0]?.kind === 'research' && workflow.steps[0].programId === program.id);
    if (clash) throw fail(`“${clash.name}” already runs this program on a schedule. Pause that workflow, or change its trigger to “Whenever this program runs”, before giving the program its own schedule.`, 409, { field: 'schedule.enabled' });
  }

  // ---------- Playbooks ----------
  const teamPlaybooks = () => store.read().playbooks.filter((playbook) => playbook.workspaceId === activeId());
  function playbookById(playbookId) {
    const found = PLAYBOOKS.find((row) => row.id === playbookId) || teamPlaybooks().find((row) => row.id === playbookId);
    if (!found) throw fail('That playbook isn’t available anymore.', 404);
    return found;
  }
  function brandName() { const w = studio().workspaces?.find((row) => row.id === activeId()); return editionId() === 'semrush' ? 'Semrush' : w?.knowledge?.name || w?.name || ''; }
  // A playbook set up with the person's answers; the setup sheet's own edits (payload.workflow, payload.program) replace
  // what the playbook filled in, so the estimate always prices what will be saved.
  function draftFor(payload = {}) {
    const playbook = playbookById(payload.playbookId);
    const made = core.instantiatePlaybook(playbook, payload.inputs || {}, { editionId: editionId(), brand: brandName(), programs: programsNow(), timeZone: payload.timeZone || 'UTC', sourceProgramId: payload.sourceProgramId || '', programMode: payload.programMode || '', kitFolderIds: kitFolderIds() });
    if (payload.workflow && typeof payload.workflow === 'object') made.workflow = copy(payload.workflow);
    if (made.program && payload.program && typeof payload.program === 'object') made.program = { ...made.program, ...copy(payload.program), id: NEW_PROGRAM_ID, sourceGroups: made.program.sourceGroups, schedule: { frequency: 'manual', enabled: false }, autoApproveThemes: false };
    let draftProgram = null; const missing = [...made.missing];
    if (made.program && made.program.sourceGroups.length) { try { draftProgram = research.validateResearchProgram({ ...made.program, id: NEW_PROGRAM_ID }); } catch (error) { missing.push({ field: `program.${error.field || ''}`, message: error.message }); } }
    return { playbook, made, draftProgram, missing };
  }
  async function previewPlaybook(payload = {}) {
    const { playbook, made, draftProgram, missing } = draftFor(payload);
    const extra = draftProgram ? [draftProgram] : [];
    const estimate = missing.length ? null : await estimateFor(made.workflow, extra);
    if (estimate?.error) missing.push({ field: estimate.error.field, message: estimate.error.message });
    return { playbook: copy(playbook), program: made.program, programMode: made.programMode, workflow: estimate?.workflow || made.workflow, estimate, warnings: estimate?.warnings || [], missing };
  }
  async function applyPlaybook(payload = {}, actor) {
    const by = actorOf(actor);
    const playbook = playbookById(payload.playbookId);
    const draft = payload.workflow && typeof payload.workflow === 'object' ? payload.workflow : draftFor(payload).made.workflow;
    const programInput = payload.program && typeof payload.program === 'object' ? payload.program : null;
    let draftProgram = null;
    if (programInput) draftProgram = research.validateResearchProgram({ ...programInput, id: NEW_PROGRAM_ID, schedule: { frequency: 'manual', enabled: false }, autoApproveThemes: false });
    const wantsBudget = payload.budget && typeof payload.budget === 'object' && payload.activate === true;
    // The hash the person saw (the unsaved program stood in as NEW_PROGRAM_ID).
    if (wantsBudget) { const { workflow: checked } = validate(draft, draftProgram ? [draftProgram] : []); if (payload.budgetHash !== hashOf(checked, draftProgram ? [draftProgram] : [])) throw fail('The setup changed since you saw the cost. Check the cost again.', 409, { code: 'workflowChanged' }); }
    else validate(draft, draftProgram ? [draftProgram] : []);
    let programId = payload.programId || draft.steps?.[0]?.programId || '';
    if (draftProgram) {
      const saved = workspace.saveResearchProgram({ ...programInput, id: `program-${randomUUID()}`, workspaceId: activeId(), schedule: { frequency: 'manual', enabled: false }, autoApproveThemes: false });
      programId = saved.id;
    }
    const swap = (value) => (value === NEW_PROGRAM_ID ? programId : value);
    const workflowDraft = { ...draft, playbookId: playbook.id, playbookVersion: playbook.version || 1, trigger: { ...draft.trigger, ...(draft.trigger?.programId ? { programId: swap(draft.trigger.programId) } : {}) }, steps: list(draft.steps).map((step) => (step.programId ? { ...step, programId: swap(step.programId) } : step)) };
    const saved = save({ workflow: workflowDraft }, actor);
    let approved = false; let result = saved;
    if (wantsBudget) {
      result = approveBudget({ workflowId: saved.id, perRunUsd: payload.budget.perRunUsd, perMonthUsd: payload.budget.perMonthUsd, budgetHash: hashOf(store.read().workflows.find((row) => row.id === saved.id)), activate: true }, by);
      approved = true;
    }
    return { programId, workflow: result, approved };
  }
  function savePlaybook(payload = {}, actor) {
    const by = actorOf(actor); const input = payload.playbook && typeof payload.playbook === 'object' ? payload.playbook : null;
    if (!input) throw fail('Describe the playbook to save.');
    const basedOn = PLAYBOOKS.find((row) => row.id === (input.basedOn || '')) || null;
    if (!basedOn) throw fail('Team playbooks start from one of the studio’s playbooks.', 400, { field: 'basedOn' });
    const name = String(input.name || '').replace(/\s+/g, ' ').trim();
    if (!name || name.length > LIMITS.nameChars) throw fail(`Name the playbook (up to ${LIMITS.nameChars} characters).`, 400, { field: 'name' });
    const steps = list(input.steps).map((step, index) => core.validateStep({ ...step, programId: step.programId || NEW_PROGRAM_ID }, index, { kitFolderIds: kitFolderIds() }));
    core.checkGrammar(steps);
    const notes = { research: core.notesText(input.notes?.research, 'notes.research'), reports: core.notesText(input.notes?.reports, 'notes.reports') };
    const saved = store.change((data) => {
      const existing = input.id ? data.playbooks.find((row) => row.id === input.id && row.workspaceId === activeId()) : null;
      if (input.id && !existing) throw fail('That team playbook isn’t in this workspace anymore.', 404);
      if (existing && payload.baseUpdatedAt && payload.baseUpdatedAt !== existing.updatedAt) throw fail(`${existing.createdBy?.name || 'Someone'} saved this playbook at ${when(existing.updatedAt)}, after you opened it. Reload to see their changes.`, 409);
      if (!existing && data.playbooks.filter((row) => row.workspaceId === activeId()).length >= LIMITS.playbooks) throw fail(`A workspace can keep up to ${LIMITS.playbooks} team playbooks.`, 409);
      const playbook = { ...copy(basedOn), id: existing?.id || `team-${randomUUID()}`, workspaceId: activeId(), basedOn: basedOn.id, name, summary: String(input.summary ?? basedOn.summary).slice(0, LIMITS.descriptionChars), outcome: String(input.outcome ?? basedOn.outcome).slice(0, LIMITS.descriptionChars), trigger: input.trigger ? core.validateTrigger(input.trigger, { now: new Date(clock()) }) : basedOn.trigger, steps: steps.map(({ id: _id, programId: _p, ...step }) => step), notes, blank: false, createdBy: existing?.createdBy || by, updatedAt: stamp() };
      if (input.research?.program && basedOn.research?.program) playbook.research = { ...basedOn.research, program: { ...basedOn.research.program, ...Object.fromEntries(Object.entries(input.research.program).filter(([key]) => ['name', 'query', 'lookbackDays', 'maxThemes', 'budgets'].includes(key))) } };
      data.playbooks = [...data.playbooks.filter((row) => row.id !== playbook.id), playbook];
      return playbook;
    });
    emit();
    return saved;
  }
  function deletePlaybook(payload = {}) {
    const removed = store.change((data) => {
      const found = data.playbooks.find((row) => row.id === payload.playbookId && row.workspaceId === activeId());
      if (!found) throw fail('Only your team’s own playbooks can be deleted.', 404);
      data.playbooks = data.playbooks.filter((row) => row.id !== found.id);
      return found;
    });
    emit();
    return { deleted: true, playbookId: removed.id };
  }

  async function estimate(payload = {}) {
    const draft = payload.workflowId ? findWorkflow(store.read(), payload.workflowId) : payload.workflow;
    if (!draft || typeof draft !== 'object') throw fail('Choose a workflow to price.');
    const result = await estimateFor(draft);
    delete result.workflow;
    return result;
  }

  return {
    publicState, estimate, save, approveBudget, setStatus, remove, run, cancelRun, retryRun, readRun, previewPlaybook, applyPlaybook, savePlaybook, deletePlaybook,
    assertNoScheduleConflict, onResearchRunStarted, start, stop, poke, tick, recover, advance, desktop,
  };
}

module.exports = { createWorkflowEngine };
