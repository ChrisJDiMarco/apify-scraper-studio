import React, { useEffect, useId, useRef, useState } from 'react';
import { ClipboardCopy, Copy, LayoutGrid, Pause, Play, Plus, RotateCcw, Square, Trash2 } from 'lucide-react';
import { Dialog, DialogClose, MoreMenu, copyText } from './role-screens.jsx';
import { hasCapability, writeProps } from './viewer.js';
import { money } from './studio-actions.js';
import { BudgetDialog, StepRail, WorkflowEditor } from './workflow-editor.jsx';
import { blankWorkflow, budgetLines, describeTrigger, roundUp, runCounts, runLine, slackSummary, stepLabel, validateDraft, workflowStatus } from './workflow-model.js';
import './workflows.css';

// Workflows (Advanced › Automate): saved automations, what runs, when, and what it may spend. Every write goes through
// the server (studio:*Workflow*), which checks access, the budget hash and the grammar again; this page only asks.
const list = (value) => (Array.isArray(value) ? value : []);
const when = (value) => { const date = new Date(value || 0); return value && Number.isFinite(date.getTime()) ? date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''; };
const requestId = () => `wf-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
const TRIGGER_WORDS = { schedule: 'Schedule', 'program-run': 'Program run', manual: 'By hand', retry: 'Try again' };

// The draft as the server's shape (step ids kept; the editor adds missing ones).
const draftOf = (workflow) => ({ ...(workflow.id ? { id: workflow.id } : {}), name: workflow.name || '', description: workflow.description || '', trigger: workflow.trigger || { kind: 'manual' }, steps: list(workflow.steps).map((step, index) => ({ ...step, id: step.id || `step-${index + 1}` })), ...(workflow.playbookId ? { playbookId: workflow.playbookId, playbookVersion: workflow.playbookVersion } : {}) });

// The estimate for a draft, refreshed a moment after it stops changing.
export function useWorkflowEstimate(api, draft, enabled = true) {
  const [estimate, setEstimate] = useState(null);
  const key = JSON.stringify(draft || null);
  useEffect(() => {
    if (!enabled || !draft || typeof api?.estimateWorkflow !== 'function') { setEstimate(null); return undefined; }
    let live = true;
    const timer = setTimeout(() => { api.estimateWorkflow({ workflow: draft }).then((result) => { if (live) setEstimate(result); }, (error) => { if (live) setEstimate({ blocked: true, warnings: [error.message], steps: [] }); }); }, 400);
    return () => { live = false; clearTimeout(timer); };
  }, [key, enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  return estimate;
}

// "Run “Weekly SEO watch” now?": the estimate lines; a draft (no approved budget) asks for a one-off cap.
function RunNowDialog({ workflow, estimate, showCosts, busy, onRun, onClose }) {
  const titleId = useId();
  const needsCap = workflow.needsBudget;
  const minimum = estimate?.steps?.[0]?.capUsd || 0;
  const [cap, setCap] = useState(String(roundUp(estimate?.perRun?.capUsd)));
  const value = Number(cap);
  const problem = needsCap && showCosts && !(value >= minimum) ? `Choose a cap of at least ${money(minimum)}: the first step alone can cost that much.` : '';
  const hasApprove = list(workflow.steps).some((step) => step.kind === 'approve' && step.mode === 'rules');
  return <Dialog labelledBy={titleId} onClose={onClose} closeDisabled={busy} className="wf-run-dialog">
    <div className="studio-dialog-head"><h2 id={titleId}>Run “{workflow.name}” now?</h2><DialogClose onClose={onClose} disabled={busy} /></div>
    <div className="studio-dialog-body">{!estimate ? <p className="wf-hint">Checking what it would cost…</p> : <>
      {showCosts && <ul className="wf-lines">{budgetLines({ ...estimate, perMonth: null }).filter((line) => !/stops and asks/.test(line)).map((line) => <li key={line}>{line}</li>)}</ul>}
      {hasApprove && <p className="wf-hint">Trends that meet your rules are approved automatically; the rest wait for your OK.</p>}
      {list(estimate.warnings).length > 0 && <ul className="wf-warnings">{estimate.warnings.map((line) => <li key={line}>{line}</li>)}</ul>}
      {needsCap && showCosts && <label className="wf-field">This run may spend at most ($)<input type="number" min={Math.ceil(minimum)} step="1" value={cap} onChange={(event) => setCap(event.target.value)} /><span className="wf-hint">Its budget isn’t approved yet, so this cap is for this run only.</span></label>}
      {needsCap && !showCosts && <p className="wf-hint">Its budget isn’t approved yet. Ask an admin to approve it first.</p>}
      {problem && <p className="wf-error" role="alert">{problem}</p>}
    </>}</div>
    <div className="studio-dialog-foot">
      <button type="button" className="studio-quiet" onClick={onClose} disabled={busy}>Cancel</button>
      <button type="button" className="studio-primary" disabled={busy || !estimate || estimate.blocked || Boolean(problem) || (needsCap && !showCosts)} onClick={() => onRun(needsCap ? value : undefined)}><Play size={14} aria-hidden="true" />{busy ? 'Starting…' : 'Run now'}</button>
    </div>
  </Dialog>;
}

// One run, step by step, with links to what it made, and Stop / Try again / Raise budget.
export function RunTimeline({ run, workflow, programs, edition, monday, imagesReady, can, viewer, busy, onOpenTarget, onCancel, onRetry, onRaise, onOpenUrl }) {
  if (!run) return null;
  const steps = list(run.plan).length ? run.plan : workflow.steps;
  const links = {};
  const link = (label, target) => <button key={label} type="button" className="studio-link" onClick={() => onOpenTarget?.(target)}>{label}</button>;
  for (const step of list(run.steps)) {
    const refs = step.refs || {}; const out = [];
    if (refs.researchRunId) { out.push(link('Open run', { kind: 'run', id: refs.researchRunId, page: 'research' })); if (step.kind === 'research' && ['done', 'running'].includes(step.status)) out.push(link('Review trends', { kind: 'page', page: 'board', runId: refs.researchRunId })); }
    if (refs.quickScanRunId && refs.scanReportAssetId) out.push(link('Open the trends report', { kind: 'report', id: refs.scanReportAssetId }));
    list(refs.reportRuns).slice(0, 6).forEach((entry, index) => out.push(link(list(refs.reportRuns).length > 1 ? `Open report ${index + 1}` : 'Open report', { kind: 'report', id: entry.reportAssetId })));
    list(refs.kitRuns).filter((entry) => entry.contentRunId).slice(0, 6).forEach((entry, index) => out.push(link(list(refs.kitRuns).length > 1 ? `Open folder ${index + 1}` : 'Open folder', { kind: 'run', id: entry.contentRunId })));
    if (step.kind === 'monday' && monday?.link?.boardUrl && step.status !== 'pending') out.push(<button key="monday" type="button" className="studio-link" onClick={() => onOpenUrl?.(monday.link.boardUrl)}>Open Monday board</button>);
    if (out.length) links[step.stepId] = out;
  }
  const live = ['running', 'waiting-review', 'waiting-budget'].includes(run.status);
  const stopped = ['failed', 'partial', 'cancelled', 'waiting-budget'].includes(run.status);
  const showCosts = hasCapability(viewer, 'seeCosts');
  return <section className="wf-timeline" aria-label="Run">
    <div className="wf-timeline-head">
      <div><strong>{runLine(run)}</strong><span className="wf-hint">{TRIGGER_WORDS[run.trigger] || run.trigger} · {when(run.createdAt)} · started by {run.startedBy?.name || 'Automatic'}{showCosts && Number.isFinite(run.spentUsd) ? ` · ${run.spentEstimated ? 'about ' : ''}${money(run.spentUsd)} spent${run.capUsd ? ` of ${money(run.capUsd)}` : ''}` : ''}</span></div>
      <div className="studio-head-actions">
        {live && can('cancelWorkflowRun') && <button type="button" className="studio-danger small" {...writeProps(viewer, busy)} onClick={onCancel}><Square size={13} aria-hidden="true" />Stop</button>}
        {stopped && run.status === 'waiting-budget' && can('approveWorkflowBudget') && <button type="button" className="studio-quiet small" {...writeProps(viewer, busy)} onClick={onRaise}>Raise budget</button>}
        {stopped && can('retryWorkflowRun') && <button type="button" className="studio-quiet small" {...writeProps(viewer, busy)} onClick={onRetry}><RotateCcw size={13} aria-hidden="true" />Try again</button>}
      </div>
    </div>
    {run.message && <p className="wf-node-message">{run.message}</p>}
    {run.needsAdmin && <p className="wf-warning-line">An admin needs to take over this workflow before it can run again.</p>}
    <StepRail steps={steps} run={run} ctx={{ programs, edition, monday, imagesReady }} links={links} />
  </section>;
}

export function WorkflowsView({ state = {}, api = {}, viewer = {}, can = () => true, confirm, action, onOpenTarget, onOpenPlaybooks, initial = null, desktop = false, edition = 'general', settingsAllowed = false }) {
  const studio = state.contentStudio || {};
  const workflows = list(studio.workflows);
  const runs = list(studio.workflowRuns);
  const summary = studio.workflowSummary || {};
  const programs = list(studio.programs).filter((program) => !studio.activeWorkspaceId || !program.workspaceId || program.workspaceId === studio.activeWorkspaceId);
  const monday = state.monday || null;
  const imagesReady = Boolean(studio.capabilities?.imagesConfigured);
  const showCosts = hasCapability(viewer, 'seeCosts');
  const admin = (viewer?.base || viewer?.role) === 'admin';
  const [selectedId, setSelectedId] = useState(initial?.workflowId || '');
  const [tab, setTab] = useState(initial?.runId ? 'runs' : 'steps');
  const [editing, setEditing] = useState(null); // a draft, or null
  const [runDetail, setRunDetail] = useState(null);
  const [dialog, setDialog] = useState(null); // { kind: 'run' | 'budget', workflow, estimate }
  const [busy, setBusy] = useState(false);
  const headingRef = useRef(null);
  const selected = workflows.find((row) => row.id === selectedId) || null;
  const editEstimate = useWorkflowEstimate(api, editing, Boolean(editing) && can('estimateWorkflow'));
  const problems = editing ? validateDraft(editing, { programs }) : [];
  const serverProblem = editEstimate?.error ? [{ field: editEstimate.error.field || 'workflow', message: editEstimate.error.message }] : [];

  // Opened for one workflow (the palette, the Inbox, Home): select it, show a run, or ask to run it now.
  useEffect(() => {
    if (!initial?.workflowId) return;
    setSelectedId(initial.workflowId); setEditing(null);
    if (initial.runId) { setTab('runs'); openRun(initial.runId); }
    const target = workflows.find((row) => row.id === initial.workflowId);
    if (initial.run && target && can('runWorkflow') && !viewer?.preview) startRun(target);
  }, [initial?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  async function openRun(runId) {
    if (typeof api.readWorkflowRun !== 'function') return;
    try { setRunDetail(await api.readWorkflowRun({ runId })); } catch (error) { setRunDetail(null); action?.(() => Promise.reject(error)); }
  }
  // A run on screen follows the live state (summaries) between full reads.
  const liveRun = runDetail ? { ...runDetail, ...(runs.find((row) => row.id === runDetail.id) || {}), steps: (runs.find((row) => row.id === runDetail.id)?.steps || runDetail.steps).map((step) => ({ ...step, log: runDetail.steps.find((row) => row.stepId === step.stepId)?.log || [] })) } : null;

  async function work(fn, message) { setBusy(true); try { return await action(fn, message); } finally { setBusy(false); } }
  async function startRun(workflow) {
    const estimate = await api.estimateWorkflow({ workflowId: workflow.id }).catch(() => null);
    setDialog({ kind: 'run', workflow, estimate });
  }
  async function approve(workflow, activate = true) {
    const estimate = await api.estimateWorkflow({ workflowId: workflow.id }).catch(() => null);
    setDialog({ kind: 'budget', workflow, estimate, activate });
  }
  async function setStatus(workflow, status) {
    if (status === 'active' && workflow.needsBudget) { if (can('approveWorkflowBudget')) approve(workflow, true); else action?.(() => Promise.reject(new Error('Its budget needs approving again. Ask an admin.'))); return; }
    const stopRun = status === 'paused' && workflow.running ? await confirm?.({ title: `Pause “${workflow.name}”?`, lines: ['It won’t start again until someone turns it back on.', 'A run is going now. Stop it too?'], confirmLabel: 'Pause and stop the run', cancelLabel: 'Pause, let it finish' }) : false;
    await work(() => api.setWorkflowStatus({ workflowId: workflow.id, status, ...(stopRun ? { stopRun: true } : {}) }), status === 'paused' ? `“${workflow.name}” is paused.` : `“${workflow.name}” is on.`);
  }
  async function remove(workflow) {
    if (!(await confirm?.({ title: `Delete “${workflow.name}”?`, lines: ['Its runs are forgotten. Trends, reports and assets it made stay.'], confirmLabel: 'Delete workflow', tone: 'danger' }))) return;
    const done = await work(() => api.deleteWorkflow({ workflowId: workflow.id }), `“${workflow.name}” was deleted.`);
    if (done) setSelectedId('');
  }
  async function pauseAll() {
    if (!(await confirm?.({ title: 'Pause every workflow?', lines: ['Nothing starts on its own until each one is turned back on. Runs already going finish.'], confirmLabel: 'Pause all' }))) return;
    await work(() => api.setWorkflowStatus({ all: true, status: 'paused' }), (result) => `${result?.paused || 0} paused.`);
  }
  async function saveDraft({ requestApproval = false } = {}) {
    const saved = await work(() => api.saveWorkflow({ workflow: editing, ...(selected && editing.id ? { baseUpdatedAt: selected.updatedAt } : {}), ...(requestApproval ? { requestApproval: true } : {}) }), requestApproval ? 'Saved. An admin can approve its budget from their Inbox.' : 'Workflow saved.');
    if (saved?.id) { setEditing(null); setSelectedId(saved.id); setTab('steps'); }
    return saved;
  }

  const runsOf = (workflowId) => runs.filter((run) => run.workflowId === workflowId);
  const ctx = { programs, edition, monday, imagesReady };

  if (editing) {
    const all = [...problems, ...serverProblem];
    return <div className="studio-screen studio-page wf-page">
      <div className="studio-page-head"><div><h1 ref={headingRef}>{editing.id ? `Edit “${editing.name || 'workflow'}”` : 'New workflow'}</h1><p>Choose when it runs and what each step does. You see the cost before it spends anything.</p></div></div>
      <WorkflowEditor draft={editing} onChange={setEditing} programs={programs} edition={edition} viewer={viewer} monday={monday} imagesReady={imagesReady} settingsAllowed={settingsAllowed} problems={all} estimate={editEstimate} showCosts={showCosts} desktop={desktop} focus={list(viewer?.prefs?.focusChannels)} />
      {showCosts && editEstimate?.perRun && <ul className="wf-lines">{budgetLines(editEstimate).map((line) => <li key={line}>{line}</li>)}</ul>}
      {list(editEstimate?.warnings).length > 0 && !editEstimate?.error && <ul className="wf-warnings">{editEstimate.warnings.map((line) => <li key={line}>{line}</li>)}</ul>}
      <div className="wf-save-bar">
        <button type="button" className="studio-quiet" onClick={() => setEditing(null)} disabled={busy}>Cancel</button>
        {!can('approveWorkflowBudget') && <button type="button" className="studio-quiet" {...writeProps(viewer, busy || all.length > 0)} onClick={() => saveDraft({ requestApproval: true })}>Save for an admin to approve</button>}
        <button type="button" className="studio-primary" {...writeProps(viewer, busy || all.length > 0)} onClick={() => saveDraft()}>{busy ? 'Saving…' : 'Save workflow'}</button>
      </div>
    </div>;
  }

  return <div className="studio-screen studio-page wf-page">
    <div className="studio-page-head">
      <div><h1 ref={headingRef}>Workflows</h1><p>Saved automations: what runs, when, and what it may spend.{desktop ? ' Schedules run while the studio is open.' : ''}</p></div>
      <div className="studio-head-actions">
        {admin && workflows.some((row) => row.status === 'active') && can('setWorkflowStatus') && <button type="button" className="studio-quiet" {...writeProps(viewer, busy)} onClick={pauseAll}><Pause size={14} aria-hidden="true" />Pause all</button>}
        {onOpenPlaybooks && <button type="button" className="studio-quiet" onClick={onOpenPlaybooks}><LayoutGrid size={14} aria-hidden="true" />From a playbook</button>}
        {can('saveWorkflow') && <button type="button" className="studio-primary" {...writeProps(viewer, !programs.length)} title={programs.length ? undefined : 'Save a research program first.'} onClick={() => { setRunDetail(null); setEditing(blankWorkflow(programs[0]?.id || '')); }}><Plus size={15} aria-hidden="true" />New workflow</button>}
      </div>
    </div>

    <dl className="wf-summary" aria-label="Workflows at a glance">
      <div><dt>On</dt><dd>{summary.active || 0}</dd></div>
      <div><dt>Paused</dt><dd>{summary.paused || 0}</dd></div>
      <div><dt>Waiting on you</dt><dd>{summary.waiting || 0}</dd></div>
      {showCosts && Number.isFinite(summary.monthSpentUsd) && <div><dt>Spent this month</dt><dd>{money(summary.monthSpentUsd)}{summary.monthCapUsd ? <span className="wf-hint"> of {money(summary.monthCapUsd)}</span> : null}</dd></div>}
    </dl>

    {!workflows.length ? <div className="studio-empty"><strong>No workflows yet.</strong><span>Start from a playbook to set up research, approvals, reports and assets in one go.</span>{onOpenPlaybooks && <button type="button" className="studio-primary small" onClick={onOpenPlaybooks}>Browse playbooks</button>}</div>
      : <ul className="wf-list" aria-label="Workflows">{workflows.map((workflow, index) => {
        const status = workflowStatus(workflow); const last = runsOf(workflow.id)[0];
        const share = showCosts && workflow.budget?.perMonthUsd ? Math.min(100, Math.round((workflow.monthSpentUsd || 0) / workflow.budget.perMonthUsd * 100)) : null;
        return <li key={workflow.id} className={`wf-row${workflow.id === selectedId ? ' is-selected' : ''}`}>
          <button type="button" className="wf-row-main" aria-expanded={workflow.id === selectedId} onClick={() => { setSelectedId(workflow.id === selectedId ? '' : workflow.id); setRunDetail(null); setTab('steps'); }}>
            <span className="wf-row-title"><strong>{workflow.name}</strong><span className={`studio-chip wf-status is-${status.id}`}>{status.label}</span>{workflow.running && <span className="studio-chip new">Running</span>}</span>
            <span className="wf-row-line">{describeTrigger(workflow.trigger, programs, { desktop })}{workflow.nextRunAt ? ` · next ${when(workflow.nextRunAt)}` : ''}</span>
            {last && <span className="wf-row-line">Last run: {runLine(last)} · {when(last.createdAt)}</span>}
            {workflow.pausedReason && <span className="wf-row-line wf-warning-line">{workflow.pausedReason}</span>}
          </button>
          <StepRail steps={workflow.steps} compact ctx={ctx} run={workflow.running ? runs.find((run) => run.id === workflow.liveRunId) : null} />
          {share !== null && <div className="wf-meter" role="img" aria-label={`${money(workflow.monthSpentUsd)} of ${money(workflow.budget.perMonthUsd)} spent this month`}><span style={{ width: `${share}%` }} /></div>}
          <div className="wf-row-actions">
            {can('runWorkflow') && <button type="button" className="studio-quiet small" data-spot={index === 0 ? 'workflows.run' : undefined} {...writeProps(viewer, busy || workflow.running)} onClick={() => startRun(workflow)}><Play size={13} aria-hidden="true" />Run now…</button>}
            {can('setWorkflowStatus') && (workflow.status === 'active'
              ? <button type="button" className="studio-quiet small" {...writeProps(viewer, busy)} onClick={() => setStatus(workflow, 'paused')}><Pause size={13} aria-hidden="true" />Pause</button>
              : <button type="button" className="studio-quiet small" {...writeProps(viewer, busy)} onClick={() => setStatus(workflow, 'active')}><Play size={13} aria-hidden="true" />{workflow.status === 'draft' ? 'Turn on…' : 'Resume'}</button>)}
            {can('saveWorkflow') && <button type="button" className="studio-link" {...writeProps(viewer)} onClick={() => setEditing(draftOf(workflow))}>Edit</button>}
            <MoreMenu label={`More for ${workflow.name}`} disabled={viewer?.preview} items={[
              can('saveWorkflow') && { label: 'Duplicate', icon: Copy, onSelect: () => setEditing({ ...draftOf(workflow), id: undefined, name: `${workflow.name} (copy)`.slice(0, 80) }) },
              can('deleteWorkflow') && { label: 'Delete', icon: Trash2, danger: true, disabled: workflow.running, onSelect: () => remove(workflow) },
            ]} />
          </div>
        </li>;
      })}</ul>}

    {selected && <section className="wf-detail" aria-label={`${selected.name} details`}>
      <div className="studio-segment" role="tablist" aria-label="Workflow details">
        {[['steps', 'Steps'], ['runs', 'Runs'], ['settings', 'Settings']].map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} aria-pressed={tab === id} onClick={() => { setTab(id); setRunDetail(null); }}>{label}</button>)}
      </div>
      {tab === 'steps' && <StepRail steps={selected.steps} ctx={ctx} editable={false} />}
      {tab === 'runs' && (liveRun ? <>
        <button type="button" className="studio-link" onClick={() => setRunDetail(null)}>All runs</button>
        <RunTimeline run={liveRun} workflow={selected} programs={programs} edition={edition} monday={monday} imagesReady={imagesReady} can={can} viewer={viewer} busy={busy} onOpenTarget={onOpenTarget} onOpenUrl={(url) => api.openSourceUrl?.(url)}
          onCancel={async () => { if (await confirm?.({ title: 'Stop this run?', lines: ['Work already finished is kept.'], confirmLabel: 'Stop the run', tone: 'danger' })) { await work(() => api.cancelWorkflowRun({ runId: liveRun.id }), 'Run stopped.'); openRun(liveRun.id); } }}
          onRetry={async () => { const estimate = await api.estimateWorkflow({ workflowId: selected.id }).catch(() => null); if (!estimate || estimate.blocked) { action?.(() => Promise.reject(new Error(estimate?.warnings?.[0] || 'This workflow can’t run right now.')));
            return; } if (await confirm?.({ title: 'Try again?', lines: ['It picks up where it stopped. Finished steps aren’t run or paid for again.', ...(showCosts ? budgetLines({ ...estimate, perMonth: null }).slice(0, 1) : [])], confirmLabel: 'Try again' })) { await work(() => api.retryWorkflowRun({ runId: liveRun.id, budgetHash: estimate.budgetHash, ...(selected.needsBudget ? { capUsd: roundUp(estimate.perRun?.capUsd) } : {}), requestId: requestId() }), 'Trying again.'); openRun(liveRun.id); } }}
          onRaise={() => approve(selected, selected.status === 'active')} />
        {liveRun.notify?.slackSummary && ['succeeded', 'partial'].includes(liveRun.status) && <button type="button" className="studio-quiet small" onClick={() => copyText(slackSummary(liveRun, selected)).then(() => action?.(() => Promise.resolve(), 'Summary copied. Paste it into Slack.'))}><ClipboardCopy size={13} aria-hidden="true" />Copy summary for Slack</button>}
      </> : !runsOf(selected.id).length ? <p className="wf-hint">No runs yet.</p> : <table className="wf-runs">
        <thead><tr><th scope="col">When</th><th scope="col">Trigger</th><th scope="col">Status</th><th scope="col">Approved by rule / by people</th><th scope="col">Reports</th><th scope="col">Asset sets</th>{showCosts && <th scope="col">Spent</th>}</tr></thead>
        <tbody>{runsOf(selected.id).map((run) => { const counts = runCounts(run); return <tr key={run.id}>
          <td><button type="button" className="studio-link" onClick={() => openRun(run.id)}>{when(run.createdAt)}</button></td>
          <td>{TRIGGER_WORDS[run.trigger] || run.trigger}</td><td>{runLine(run)}</td><td>{counts.byRule} / {counts.byPeople}</td><td>{counts.reports}</td><td>{counts.sets}</td>
          {showCosts && <td>{Number.isFinite(run.spentUsd) ? `${run.spentEstimated ? '~' : ''}${money(run.spentUsd)}` : ''}</td>}
        </tr>; })}</tbody>
      </table>)}
      {tab === 'settings' && <div className="wf-settings">
        {showCosts && <div className="wf-setting"><strong>Budget</strong>{selected.budget ? <span>{money(selected.budget.perRunUsd)} a run, {money(selected.budget.perMonthUsd)} a month · approved by {selected.budget.approvedBy?.name || 'an admin'} on {when(selected.budget.approvedAt)}{selected.needsBudget ? ' · the setup changed since' : ''}</span> : <span>Not approved yet.</span>}
          {can('approveWorkflowBudget') && <button type="button" className="studio-quiet small" {...writeProps(viewer, busy)} onClick={() => approve(selected, selected.status !== 'paused')}>Change budget…</button>}</div>}
        <div className="wf-setting"><strong>Runs with</strong><span>{selected.owner?.name || 'its owner'}’s access{selected.needsAdmin ? ' · they no longer have access to every step' : ''}</span>
          {can('approveWorkflowBudget') && selected.owner?.id !== viewer?.id && <button type="button" className="studio-quiet small" {...writeProps(viewer, busy)} onClick={async () => { if (await confirm?.({ title: `Take over “${selected.name}”?`, lines: ['Its runs will use your access from now on.'], confirmLabel: 'Take over' })) await work(() => api.approveWorkflowBudget({ workflowId: selected.id, takeOver: true }), 'You own this workflow now.'); }}>Take over</button>}</div>
        {selected.playbookId && <div className="wf-setting"><strong>Set up from</strong><span>a playbook ({selected.playbookId.replace(/-/g, ' ')})</span></div>}
        <div className="wf-setting"><strong>Changed</strong><span>{when(selected.updatedAt)} by {selected.updatedBy?.name || 'someone'}</span></div>
      </div>}
    </section>}

    {dialog?.kind === 'run' && <RunNowDialog workflow={dialog.workflow} estimate={dialog.estimate} showCosts={showCosts} busy={busy} onClose={() => setDialog(null)}
      onRun={async (capUsd) => { const run = await work(() => api.runWorkflow({ workflowId: dialog.workflow.id, budgetHash: dialog.estimate.budgetHash, ...(capUsd ? { capUsd } : {}), requestId: requestId() }), `“${dialog.workflow.name}” is running.`); setDialog(null); if (run?.id) { setSelectedId(dialog.workflow.id); setTab('runs'); openRun(run.id); } }} />}
    {dialog?.kind === 'budget' && dialog.estimate && <BudgetDialog workflow={dialog.workflow} estimate={dialog.estimate} busy={busy} confirmLabel={dialog.activate ? 'Approve budget and turn on' : 'Approve budget'} onClose={() => setDialog(null)}
      onApprove={async ({ perRunUsd, perMonthUsd }) => { const saved = await work(() => api.approveWorkflowBudget({ workflowId: dialog.workflow.id, perRunUsd, perMonthUsd, budgetHash: dialog.estimate.budgetHash, activate: Boolean(dialog.activate) }), dialog.activate ? `“${dialog.workflow.name}” is on.` : 'Budget approved.'); if (saved) setDialog(null); }} />}
  </div>;
}

export { draftOf, stepLabel };

// Home's Automations card (weekly-briefing.jsx), for people who can see workflows: up to four, with their status, next
// run and what waits on someone, Pause / Resume, and Manage (Workflows; from Simple it opens as a peek).
export function AutomationsCard({ state = {}, api = {}, viewer = {}, can = () => true, onOpenTarget, onNotice, desktop = false }) {
  const studio = state.contentStudio || {};
  const workflows = list(studio.workflows);
  const runs = list(studio.workflowRuns);
  const [busyId, setBusyId] = useState('');
  if (!can('estimateWorkflow') || !workflows.length) return null;
  const waitingOf = (workflow) => runs.find((run) => run.workflowId === workflow.id && ['waiting-review', 'waiting-budget'].includes(run.status));
  const shown = [...workflows].sort((a, b) => Number(Boolean(waitingOf(b))) - Number(Boolean(waitingOf(a))) || Number(b.running) - Number(a.running) || String(a.nextRunAt || '9').localeCompare(String(b.nextRunAt || '9'))).slice(0, 4);
  async function toggle(workflow) {
    setBusyId(workflow.id);
    try { await api.setWorkflowStatus({ workflowId: workflow.id, status: workflow.status === 'active' ? 'paused' : 'active' }); onNotice?.(workflow.status === 'active' ? `“${workflow.name}” is paused.` : `“${workflow.name}” is on.`); }
    catch (error) { onNotice?.(error.message || String(error)); }
    finally { setBusyId(''); }
  }
  return <section className="wb-card wf-home" aria-labelledby="wb-automations-title" data-spot="home.automations">
    <header className="wb-card-head"><span className="wb-icon tone-ink" aria-hidden="true"><LayoutGrid size={17} /></span><h2 id="wb-automations-title"><span className="wb-title-text">Automations</span> <span className="wb-count">{workflows.length}</span></h2></header>
    <ul className="wb-list">{shown.map((workflow) => { const status = workflowStatus(workflow); const waiting = waitingOf(workflow); return <li key={workflow.id} className="wf-home-row">
      <button type="button" className="wb-title-link" onClick={() => onOpenTarget?.({ kind: 'workflow', id: workflow.id, page: 'workflows' })}>{workflow.name}</button>
      <small className="wb-muted">{status.label}{workflow.running ? ' · running now' : ''}{workflow.nextRunAt ? ` · next ${when(workflow.nextRunAt)}` : workflow.trigger?.kind === 'manual' ? ' · runs when started' : ''}{desktop && workflow.trigger?.kind === 'schedule' ? ' (while the studio is open)' : ''}</small>
      {waiting && <small className="wf-warning-line">{runLine(waiting)}</small>}
      {can('setWorkflowStatus') && !(workflow.status !== 'active' && workflow.needsBudget) && <button type="button" className="studio-link" {...writeProps(viewer, busyId === workflow.id)} onClick={() => toggle(workflow)}>{workflow.status === 'active' ? 'Pause' : 'Resume'}</button>}
    </li>; })}</ul>
    <button type="button" className="studio-link" onClick={() => onOpenTarget?.({ kind: 'page', page: 'workflows' })}>Manage</button>
  </section>;
}
