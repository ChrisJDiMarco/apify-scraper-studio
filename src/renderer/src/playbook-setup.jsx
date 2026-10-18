import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight } from 'lucide-react';
import CATALOG from '../../shared/playbooks.json';
import { Dialog, DialogClose } from './role-screens.jsx';
import { hasCapability, writeProps } from './viewer.js';
import { money } from './studio-actions.js';
import { ChannelPicker, RuleBuilder, StepRail, TriggerFields, localTimeZone } from './workflow-editor.jsx';
import { STEP_CATALOG, budgetLines, roundUp, validateDraft } from './workflow-model.js';
import './workflows.css';

// Setting up a playbook: a guided sheet in six steps (basics, research, approval, reports and assets, schedule and
// sharing, review and cost) with the live step rail beside it. Rendered once at the shell (App.jsx) and opened from both
// layouts. The server instantiates and prices it (previewPlaybook) and saves it (applyPlaybook, or saveWorkflow for a
// draft on an existing program), checking everything again.
const STEPS = ['Basics', 'Research', 'Approval', 'Reports and assets', 'Schedule and sharing', 'Review and cost'];
const list = (value) => (Array.isArray(value) ? value : []);
const requestId = () => `pb-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
const NOTES_MAX = STEP_CATALOG.limits.notesChars;

export function PlaybookSetup({ playbookId, onClose, api = {}, state = {}, viewer = {}, can = () => true, action, confirm, edition = 'general', desktop = false, settingsAllowed = false, onDone, onOpenPrompts }) {
  const titleId = useId();
  const studio = state.contentStudio || {};
  const programs = list(studio.programs);
  const playbook = [...CATALOG.playbooks, ...list(studio.playbooks)].find((row) => row.id === playbookId) || null;
  const showCosts = hasCapability(viewer, 'seeCosts');
  const approver = can('approveWorkflowBudget') && can('applyPlaybook');
  const mayCreateProgram = can('applyPlaybook');
  const [step, setStep] = useState(0);
  const [inputs, setInputs] = useState(() => Object.fromEntries(list(playbook?.inputs).filter((input) => input.default).map((input) => [input.id, input.default])));
  const [sourceProgramId, setSourceProgramId] = useState(programs[0]?.id || '');
  const [programMode, setProgramMode] = useState(() => (!mayCreateProgram || playbook?.research?.mode === 'quick-scan' || playbook?.blank ? 'existing' : 'new'));
  const [accountsMode, setAccountsMode] = useState(playbook?.research?.sourceFrom === 'accounts' || !programs.length ? 'accounts' : 'copy');
  const [workflow, setWorkflow] = useState(null);
  const [programEdits, setProgramEdits] = useState({});
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [budget, setBudget] = useState(null);
  const timeZone = useMemo(localTimeZone, []);
  const touched = useRef(false);

  // The playbook filled in with the answers; the person's edits (workflow, program fields) ride along once made, so the
  // preview and its price follow what will be saved.
  const answers = { ...inputs, ...(accountsMode === 'copy' ? { accounts: '' } : {}) };
  const payload = { playbookId, inputs: answers, timeZone, sourceProgramId: accountsMode === 'copy' || programMode === 'existing' ? sourceProgramId : '', programMode, ...(touched.current && workflow ? { workflow } : {}), ...(Object.keys(programEdits).length ? { program: programEdits } : {}) };
  const key = JSON.stringify(payload);
  useEffect(() => {
    if (!playbook || typeof api.previewPlaybook !== 'function') return undefined;
    let live = true;
    const timer = setTimeout(() => {
      api.previewPlaybook(payload).then((result) => { if (!live) return; setPreview(result); if (!touched.current || !workflow) setWorkflow(result.workflow); }, (error) => { if (live) setPreview({ missing: [{ field: 'playbook', message: error.message }] }); });
    }, 350);
    return () => { live = false; clearTimeout(timer); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (preview?.estimate?.perRun && !budget) setBudget({ perRunUsd: roundUp(preview.estimate.perRun.capUsd), perMonthUsd: roundUp(preview.estimate.perMonth?.capUsd || preview.estimate.perRun.capUsd * 5) }); }, [preview?.estimate]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!playbook) return null;
  const edit = (next) => { touched.current = true; setWorkflow(next); };
  const steps = list(workflow?.steps);
  const setStepAt = (kind, patch) => edit({ ...workflow, steps: steps.map((row) => (row.kind === kind ? { ...row, ...patch } : row)) });
  const stepOf = (kind) => steps.find((row) => row.kind === kind);
  const draftPrograms = preview?.program ? [...programs, { ...preview.program, ...programEdits }] : programs;
  const missing = list(preview?.missing);
  const problems = workflow ? validateDraft(workflow, { programs: draftPrograms }) : [];
  const blocking = [...missing, ...problems];
  const ctx = { programs: draftPrograms, edition, monday: state.monday, imagesReady: Boolean(studio.capabilities?.imagesConfigured) };
  const estimate = preview?.estimate || null;
  const costs = showCosts && estimate?.steps ? Object.fromEntries(estimate.steps.map((row) => [row.stepId, row])) : null;
  const inputField = (input) => {
    if (input.kind === 'program') return null;
    const value = inputs[input.id] || '';
    const set = (next) => setInputs({ ...inputs, [input.id]: next });
    const error = missing.find((row) => row.field === `inputs.${input.id}`)?.message;
    return <label key={input.id} className="wf-field">{input.label}{input.kind === 'accounts'
      ? <textarea rows={3} value={value} placeholder={input.placeholder} maxLength={input.max} onChange={(event) => set(event.target.value)} />
      : <input type={input.kind === 'date' ? 'date' : 'text'} value={value} placeholder={input.placeholder} maxLength={input.max} onChange={(event) => set(event.target.value)} />}{error && <span className="wf-error">{error}</span>}</label>;
  };

  async function save({ activate = false, runOnce = false } = {}) {
    if (!workflow) return;
    setBusy(true);
    try {
      let saved = null;
      if (mayCreateProgram) {
        const result = await action(() => api.applyPlaybook({ playbookId, ...(preview?.program && programMode === 'new' ? { program: { ...preview.program, ...programEdits } } : { programId: sourceProgramId }), workflow, ...(activate ? { budget, budgetHash: estimate?.budgetHash, activate: true } : {}) }), activate ? `“${workflow.name}” is set up and on.` : runOnce ? '' : `“${workflow.name}” is saved. Turn it on from Workflows after approving its budget.`);
        saved = result?.workflow || null;
      } else {
        saved = await action(() => api.saveWorkflow({ workflow: { ...workflow, playbookId }, requestApproval: true }), 'Saved. An admin can approve its budget from their Inbox.');
      }
      if (saved && runOnce && typeof api.estimateWorkflow === 'function') {
        const priced = await api.estimateWorkflow({ workflowId: saved.id });
        const cap = roundUp(priced?.perRun?.capUsd);
        if (priced && !priced.blocked && (await confirm?.({ title: `Run “${saved.name}” once now?`, lines: showCosts ? [`This run: about ${money(priced.perRun.aboutUsd)}, never more than ${money(cap)}.`] : [], confirmLabel: 'Run now' }))) await action(() => api.runWorkflow({ workflowId: saved.id, budgetHash: priced.budgetHash, ...(saved.needsBudget ? { capUsd: cap } : {}), requestId: requestId() }), `“${saved.name}” is running.`);
      }
      if (saved) { onDone?.(saved.id); onClose?.(); }
    } finally { setBusy(false); }
  }

  // These answers' steps, schedule, notes and program size as a playbook for the team (no accounts, no program id).
  async function saveAsTeamPlaybook() {
    const notes = { research: programEdits.notes?.research ?? preview?.program?.notes?.research ?? '', reports: programEdits.notes?.reports ?? preview?.program?.notes?.reports ?? '' };
    const sized = Object.fromEntries(['query', 'lookbackDays', 'maxThemes'].filter((key) => programEdits[key] !== undefined).map((key) => [key, programEdits[key]]));
    await action(() => api.savePlaybook({ playbook: { basedOn: playbook.basedOn || playbook.id, name: workflow.name || playbook.name, summary: playbook.summary, outcome: playbook.outcome, trigger: workflow.trigger, steps: steps.map(({ id: _id, programId: _programId, ...step }) => step), notes, ...(Object.keys(sized).length ? { research: { program: sized } } : {}) } }), 'Saved for your team. It’s under Your team’s playbooks.');
  }

  const panes = [
    // 1. Basics
    <div key="basics" className="wf-form">
      {list(playbook.inputs).map(inputField)}
      <label className="wf-field">Workflow name<input value={workflow?.name || ''} maxLength={80} onChange={(event) => edit({ ...workflow, name: event.target.value })} /></label>
    </div>,
    // 2. Research
    <div key="research" className="wf-form">
      {playbook.research?.mode === 'quick-scan' || playbook.blank ? <label className="wf-field">{playbook.research?.mode === 'quick-scan' ? 'Read accounts from' : 'Research program'}<select value={sourceProgramId} onChange={(event) => setSourceProgramId(event.target.value)}><option value="">Choose a program</option>{programs.map((program) => <option key={program.id} value={program.id}>{program.name}</option>)}</select></label> : <>
        <div className="studio-segment" role="radiogroup" aria-label="Accounts to follow">
          {programs.length > 0 && playbook.research?.sourceFrom !== 'accounts' && <button type="button" aria-pressed={programMode === 'new' && accountsMode === 'copy'} disabled={!mayCreateProgram} onClick={() => { setProgramMode('new'); setAccountsMode('copy'); }}>Copy accounts from a program (recommended)</button>}
          {programs.length > 0 && playbook.research?.sourceFrom !== 'accounts' && <button type="button" aria-pressed={programMode === 'existing'} onClick={() => setProgramMode('existing')}>Use a program as it is</button>}
          <button type="button" aria-pressed={programMode === 'new' && accountsMode === 'accounts'} disabled={!mayCreateProgram} onClick={() => { setProgramMode('new'); setAccountsMode('accounts'); }}>Enter accounts</button>
        </div>
        {!mayCreateProgram && <p className="wf-hint">Only someone who manages research programs can make a new one. Use a program as it is, or ask an admin.</p>}
        {(programMode === 'existing' || accountsMode === 'copy') && <label className="wf-field">{programMode === 'existing' ? 'Program' : 'Copy accounts from'}<select value={sourceProgramId} onChange={(event) => setSourceProgramId(event.target.value)}><option value="">Choose a program</option>{programs.map((program) => <option key={program.id} value={program.id}>{program.name}</option>)}</select></label>}
        {programMode === 'new' && accountsMode === 'accounts' && !list(playbook.inputs).some((input) => input.kind === 'accounts') && <label className="wf-field">Accounts to follow<textarea rows={3} value={inputs.accounts || ''} placeholder="@handle, r/community, https://www.linkedin.com/company/name" onChange={(event) => setInputs({ ...inputs, accounts: event.target.value })} /></label>}
        {programMode === 'new' && preview?.program && <div className="wf-grid">
          <label className="wf-field">Focus<input value={programEdits.query ?? preview.program.query ?? ''} maxLength={500} onChange={(event) => setProgramEdits({ ...programEdits, query: event.target.value })} /></label>
          <label className="wf-field">Look back (days)<input type="number" min="1" max="365" value={programEdits.lookbackDays ?? preview.program.lookbackDays ?? 7} onChange={(event) => setProgramEdits({ ...programEdits, lookbackDays: Number(event.target.value) })} /></label>
          <label className="wf-field">Trends to find, at most<select value={programEdits.maxThemes ?? preview.program.maxThemes ?? 6} onChange={(event) => setProgramEdits({ ...programEdits, maxThemes: Number(event.target.value) })}>{[1, 2, 3, 4, 5, 6].map((count) => <option key={count} value={count}>{count}</option>)}</select></label>
        </div>}
      </>}
      {stepOf('quick-scan') && <div className="wf-grid">
        <label className="wf-field">Depth<select value={stepOf('quick-scan').scan?.depth || 'standard'} onChange={(event) => setStepAt('quick-scan', { scan: { ...stepOf('quick-scan').scan, depth: event.target.value } })}><option value="lite">Small and cheap</option><option value="standard">Balanced</option><option value="deep">Thorough</option></select></label>
        <label className="wf-field">Look back (hours)<input type="number" min="1" max="168" value={stepOf('quick-scan').scan?.lookbackHours || 6} onChange={(event) => setStepAt('quick-scan', { scan: { ...stepOf('quick-scan').scan, lookbackHours: Number(event.target.value) } })} /></label>
      </div>}
    </div>,
    // 3. Approval
    <div key="approval" className="wf-form">
      {stepOf('approve') ? <>
        <div className="studio-segment" role="radiogroup" aria-label="How trends are approved">{Object.entries(STEP_CATALOG.approveModes).map(([mode, label]) => <button key={mode} type="button" aria-pressed={stepOf('approve').mode === mode} onClick={() => setStepAt('approve', { mode, ...(mode === 'rules' && !list(stepOf('approve').rules).length ? { rules: [{ priority: ['FAST-TRACK', 'STRONG'] }] } : {}) })}>{label}</button>)}</div>
        {stepOf('approve').mode === 'rules' && <><RuleBuilder rules={list(stepOf('approve').rules)} onChange={(rules) => setStepAt('approve', { rules })} />
          <label className="wf-field">Approve at most<select value={stepOf('approve').maxApprove || 3} onChange={(event) => setStepAt('approve', { maxApprove: Number(event.target.value) })}>{[1, 2, 3, 4, 5, 6].map((count) => <option key={count} value={count}>{count}</option>)}</select></label>
          <label className="wf-field">Trends that don’t meet the rules<select value={stepOf('approve').otherwise || 'review'} onChange={(event) => setStepAt('approve', { otherwise: event.target.value })}><option value="review">Wait for someone’s OK</option><option value="skip">Skip them</option></select></label></>}
        <p className="wf-hint">Momentum is the trend’s momentum when it was found, compared with the program’s last run.</p>
      </> : <p className="wf-hint">Quick scans don’t need approval: their trends go to the Inbox as a short report.</p>}
    </div>,
    // 4. Reports and assets
    <div key="assets" className="wf-form">
      {stepOf('assets') ? <ChannelPicker channels={list(stepOf('assets').channels)} onChange={(channels) => setStepAt('assets', { channels })} edition={edition} viewer={viewer} pictures={stepOf('assets').pictures !== false} onPictures={(pictures) => setStepAt('assets', { pictures })} imagesReady={ctx.imagesReady} settingsAllowed={settingsAllowed} /> : <p className="wf-hint">This playbook doesn’t make channel assets.</p>}
      {programMode === 'new' && preview?.program && <>
        <label className="wf-field">Notes for the research<textarea rows={2} maxLength={NOTES_MAX + 50} value={programEdits.notes?.research ?? preview.program.notes?.research ?? ''} onChange={(event) => setProgramEdits({ ...programEdits, notes: { research: event.target.value, reports: programEdits.notes?.reports ?? preview.program.notes?.reports ?? '' } })} /></label>
        <label className="wf-field">Notes for the writers<textarea rows={2} maxLength={NOTES_MAX + 50} value={programEdits.notes?.reports ?? preview.program.notes?.reports ?? ''} onChange={(event) => setProgramEdits({ ...programEdits, notes: { research: programEdits.notes?.research ?? preview.program.notes?.research ?? '', reports: event.target.value } })} /></label>
      </>}
      {stepOf('assets') && <label className="wf-field">Notes for channel assets<textarea rows={2} maxLength={NOTES_MAX + 50} value={stepOf('assets').teamNotes || ''} onChange={(event) => setStepAt('assets', { teamNotes: event.target.value })} /></label>}
      <p className="wf-hint">Notes are added to the prompts for this workflow only.{onOpenPrompts && can('listPrompts') ? <> For deeper changes, <button type="button" className="studio-link" onClick={onOpenPrompts}>open the full prompts</button>.</> : ''}</p>
    </div>,
    // 5. Schedule and sharing
    <div key="schedule" className="wf-form">
      {workflow && <TriggerFields trigger={workflow.trigger} onChange={(trigger) => edit({ ...workflow, trigger })} programs={draftPrograms} source={steps[0]?.kind || 'research'} programId={steps[0]?.programId || ''} desktop={desktop} />}
      {steps[0]?.kind === 'research' && <label className="wf-check"><input type="checkbox" checked={Boolean(stepOf('monday'))} onChange={(event) => edit({ ...workflow, steps: event.target.checked ? [...steps.filter((row) => row.kind !== 'notify'), { kind: 'monday', alsoAtReview: false }, ...steps.filter((row) => row.kind === 'notify')] : steps.filter((row) => row.kind !== 'monday') })} />Update Monday.com{!state.monday?.connected && <span className="wf-hint">{settingsAllowed ? ' · Connect Monday.com in Settings' : ' · Ask an admin to connect Monday.com'}</span>}</label>}
      <div className="wf-chip-row" role="group" aria-label="Tell in their Inbox">{Object.entries(STEP_CATALOG.audiences).map(([id, label]) => { const notify = stepOf('notify'); const on = list(notify?.audience).includes(id); return <button key={id} type="button" className="wf-toggle" aria-pressed={on} onClick={() => { const audience = on ? list(notify?.audience).filter((value) => value !== id) : [...list(notify?.audience), id]; edit({ ...workflow, steps: audience.length ? (notify ? steps.map((row) => (row.kind === 'notify' ? { ...row, audience } : row)) : [...steps, { kind: 'notify', audience, slackSummary: false }]) : steps.filter((row) => row.kind !== 'notify') }); }}>Tell {label.toLowerCase()}</button>; })}</div>
    </div>,
    // 6. Review and cost
    <div key="review" className="wf-form">
      {blocking.length > 0 && <ul className="wf-problems" role="alert">{blocking.map((row) => <li key={row.field + row.message}><button type="button" className="studio-link" onClick={() => setStep(/inputs|program/.test(row.field) ? (row.field === 'inputs.program' || row.field.startsWith('program') ? 1 : 0) : /trigger/.test(row.field) ? 4 : 2)}>{row.message}</button></li>)}</ul>}
      {showCosts && estimate && !estimate.error && <ul className="wf-lines">{budgetLines(estimate).map((line) => <li key={line}>{line}</li>)}</ul>}
      {list(preview?.warnings).length > 0 && <ul className="wf-warnings">{preview.warnings.map((line) => <li key={line}>{line}</li>)}</ul>}
      {showCosts && approver && budget && <div className="wf-grid">
        <label className="wf-field">Each run, at most ($)<input type="number" min="1" value={budget.perRunUsd} onChange={(event) => setBudget({ ...budget, perRunUsd: Number(event.target.value) })} /></label>
        <label className="wf-field">Each month, at most ($)<input type="number" min="1" value={budget.perMonthUsd} onChange={(event) => setBudget({ ...budget, perMonthUsd: Number(event.target.value) })} /></label>
      </div>}
      <div className="wf-save-bar">
        {approver && <button type="button" className="studio-primary" {...writeProps(viewer, busy || blocking.length > 0 || !estimate || estimate.blocked || !budget || budget.perMonthUsd < budget.perRunUsd)} onClick={() => save({ activate: true })}>Save and turn on</button>}
        {!approver && <button type="button" className="studio-primary" {...writeProps(viewer, busy || blocking.length > 0 || programMode !== 'existing')} title={programMode !== 'existing' ? 'Use a program as it is, or ask an admin to set this up.' : undefined} onClick={() => save()}>Save for an admin to approve</button>}
        {mayCreateProgram && <button type="button" className="studio-quiet" {...writeProps(viewer, busy || blocking.length > 0)} onClick={() => save()}>Save without turning on</button>}
        {mayCreateProgram && can('runWorkflow') && <button type="button" className="studio-quiet" {...writeProps(viewer, busy || blocking.length > 0 || !estimate || estimate.blocked)} onClick={() => save({ runOnce: true })}>Run once now…</button>}
        {can('savePlaybook') && !playbook.blank && <button type="button" className="studio-link" {...writeProps(viewer, busy || !workflow)} onClick={saveAsTeamPlaybook}>Save as a team playbook</button>}
      </div>
    </div>,
  ];

  return <Dialog labelledBy={titleId} onClose={onClose} closeDisabled={busy} className="wf-sheet" wide>
    <div className="studio-dialog-head"><div><small>Set up a playbook</small><h2 id={titleId}>{playbook.name}</h2></div><DialogClose onClose={onClose} disabled={busy} /></div>
    <div className="wf-sheet-body" data-spot="playbook.setup">
      <ol className="wf-stepper" aria-label="Setup steps">{STEPS.map((name, index) => <li key={name}><button type="button" aria-current={index === step ? 'step' : undefined} className={index < step ? 'is-done' : ''} onClick={() => setStep(index)}><span className="wf-stepper-dot" aria-hidden="true">{index < step ? <Check size={12} /> : index + 1}</span>{name}</button></li>)}</ol>
      <section className="wf-sheet-pane" aria-label={STEPS[step]}><h3>{STEPS[step]}</h3>{panes[step]}
        <div className="wf-pane-nav">
          {step > 0 && <button type="button" className="studio-quiet small" onClick={() => setStep(step - 1)}><ChevronLeft size={14} aria-hidden="true" />Back</button>}
          {step < STEPS.length - 1 && <button type="button" className="studio-primary small" onClick={() => setStep(step + 1)}>Next<ChevronRight size={14} aria-hidden="true" /></button>}
        </div>
      </section>
      <aside className="wf-sheet-preview" aria-label="What it will do">
        <h3>What it will do</h3>
        {workflow ? <StepRail steps={steps.map((row, index) => ({ ...row, id: row.id || `step-${index + 1}` }))} ctx={ctx} costs={costs} /> : <p className="wf-hint">Filling in the playbook…</p>}
        {showCosts && estimate?.perRun && <p className="wf-hint">About {money(estimate.perRun.aboutUsd)} a run{estimate.perMonth ? `, about ${money(estimate.perMonth.aboutUsd)} a month` : ''}.</p>}
      </aside>
    </div>
  </Dialog>;
}
