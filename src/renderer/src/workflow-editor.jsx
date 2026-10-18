import React, { useId, useMemo, useState } from 'react';
import { Bell, ChevronDown, ChevronUp, Circle, CircleAlert, CircleCheck, CircleDot, CircleMinus, Clock, FileText, Images, LoaderCircle, Plus, Radar, ScanSearch, SquareKanban, Trash2 } from 'lucide-react';
import { Dialog, DialogClose } from './role-screens.jsx';
import { focusChannelOptions } from './nav-model.js';
import { money } from './studio-actions.js';
import { STATUS_WORDS, STEP_CATALOG, allowedNext, budgetLines, describeStep, describeTrigger, newStep, roundUp, stepLabel } from './workflow-model.js';
import './workflows.css';

// The step rail and the workflow editor (Workflows, playbook setup). Pure UI over a draft; the page saves through the
// server, which checks everything again (src/shared/workflow-core.js).
const ICONS = { Radar, ScanSearch, CircleCheck, FileText, Images, SquareKanban, Bell };
const STATE_ICONS = { pending: Circle, running: LoaderCircle, waiting: Clock, done: CircleCheck, partial: CircleDot, skipped: CircleMinus, failed: CircleAlert };
const list = (value) => (Array.isArray(value) ? value : []);
const LIMITS = STEP_CATALOG.limits;
const TIME_ZONES = (() => { try { return Intl.supportedValuesOf('timeZone'); } catch (_) { return ['UTC', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Asia/Tokyo']; } })();
export const localTimeZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (_) { return 'UTC'; } };

// An <ol> of steps joined by a line: icon tile, title, summary, cost chip (See costs only) and, for a run, its state.
// editable: Edit / Remove / move buttons and an "Add a step" menu at the end.
export function StepRail({ steps = [], run = null, editable = false, compact = false, costs = null, ctx = {}, onEdit, onAdd, onRemove, onMove, links = null }) {
  const states = Object.fromEntries(list(run?.steps).map((step) => [step.stepId, step]));
  const next = editable ? allowedNext(steps) : [];
  return <div className={`wf-rail-wrap${compact ? ' compact' : ''}`}>
    <ol className="wf-rail" aria-label={compact ? 'Steps at a glance' : 'Workflow steps'}>
      {steps.map((step, index) => {
        const Icon = ICONS[STEP_CATALOG.steps[step.kind]?.icon] || Circle;
        const state = run ? states[step.id] : null; const StateIcon = state ? STATE_ICONS[state.status] || Circle : null;
        const cost = costs?.[step.id];
        return <li key={step.id || `${step.kind}-${index}`} className={`wf-node${state ? ` is-${state.status}` : ''}`}>
          <span className="wf-tile" aria-hidden="true"><Icon size={compact ? 14 : 17} /></span>
          {!compact && <div className="wf-node-body">
            <div className="wf-node-head">
              <strong>{stepLabel(step.kind)}</strong>
              {cost && (cost.capUsd > 0 || cost.aboutUsd > 0) && <span className="studio-chip plain wf-cost">About {money(cost.aboutUsd)}{cost.capUsd > 0 ? ` · up to ${money(cost.capUsd)}` : ''}</span>}
              {state && <span className={`wf-state is-${state.status}`}><StateIcon size={14} aria-hidden="true" className={state.status === 'running' ? 'spin' : ''} />{STATUS_WORDS[state.status] || state.status}</span>}
            </div>
            <p className="wf-node-summary">{describeStep(step, ctx)}</p>
            {state?.message && <p className="wf-node-message">{state.message}</p>}
            {links?.[step.id]?.length > 0 && <div className="wf-node-links">{links[step.id]}</div>}
            {editable && <div className="wf-node-actions">
              <button type="button" className="studio-link" onClick={() => onEdit?.(index)}>Edit</button>
              {index > 0 && <button type="button" className="studio-link" onClick={() => onRemove?.(index)}><Trash2 size={13} aria-hidden="true" />Remove</button>}
              {index > 1 && <button type="button" className="studio-icon-button" aria-label={`Move ${stepLabel(step.kind)} up`} onClick={() => onMove?.(index, -1)}><ChevronUp size={15} aria-hidden="true" /></button>}
              {index > 0 && index < steps.length - 1 && <button type="button" className="studio-icon-button" aria-label={`Move ${stepLabel(step.kind)} down`} onClick={() => onMove?.(index, 1)}><ChevronDown size={15} aria-hidden="true" /></button>}
            </div>}
          </div>}
          {compact && <span className="wf-sr">{stepLabel(step.kind)}</span>}
        </li>;
      })}
    </ol>
    {editable && next.length > 0 && <div className="wf-add">
      <span className="wf-add-label"><Plus size={14} aria-hidden="true" />Add a step</span>
      {next.map((kind) => <button key={kind} type="button" className="studio-quiet small" onClick={() => onAdd?.(kind)}>{stepLabel(kind)}</button>)}
    </div>}
  </div>;
}

// When it runs. Schedules use the research schedule's words; every few hours is offered only for quick scans.
export function TriggerFields({ trigger = {}, onChange, programs = [], source = 'research', programId = '', desktop = false }) {
  const id = useId();
  const schedule = trigger.schedule || {};
  const set = (patch) => onChange({ ...trigger, schedule: { frequency: 'weekly', time: '09:00', timeZone: localTimeZone(), weekday: 1, dayOfMonth: 1, ...schedule, ...patch } });
  const program = programs.find((row) => row.id === programId);
  const kinds = [['schedule', 'On a schedule'], ...(source === 'research' ? [['program-run', program ? `Whenever “${program.name}” runs` : 'Whenever the program runs']] : []), ['manual', 'Only when someone starts it']];
  return <fieldset className="wf-fieldset">
    <legend>When it runs</legend>
    <div className="studio-segment" role="radiogroup" aria-label="When it runs">
      {kinds.map(([kind, label]) => <label key={kind} className={trigger.kind === kind ? 'checked' : ''}><input type="radio" name={`${id}-kind`} checked={trigger.kind === kind} onChange={() => onChange(kind === 'schedule' ? { kind, schedule: { frequency: source === 'quick-scan' ? 'hourly' : 'weekly', time: '09:00', timeZone: localTimeZone(), weekday: 1, dayOfMonth: 1, ...(source === 'quick-scan' ? { everyHours: 6, until: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10) } : {}) } } : kind === 'program-run' ? { kind, programId } : { kind })} />{label}</label>)}
    </div>
    {trigger.kind === 'schedule' && <div className="wf-grid">
      <label className="wf-field">How often<select value={schedule.frequency || 'weekly'} onChange={(event) => set({ frequency: event.target.value, ...(event.target.value === 'hourly' ? { everyHours: schedule.everyHours || 6, until: schedule.until || new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10) } : {}) })}>
        {source === 'quick-scan' && <option value="hourly">Every few hours</option>}
        <option value="daily">Every day</option><option value="weekly">Every week</option><option value="monthly">Every month</option>
      </select></label>
      {schedule.frequency === 'hourly' && <label className="wf-field">Every<select value={schedule.everyHours || 6} onChange={(event) => set({ everyHours: Number(event.target.value) })}>{LIMITS.everyHours.map((hours) => <option key={hours} value={hours}>{hours === 1 ? 'hour' : `${hours} hours`}</option>)}</select></label>}
      {schedule.frequency === 'hourly' && <label className="wf-field">Last day<input type="date" value={schedule.until || ''} onChange={(event) => set({ until: event.target.value })} /></label>}
      {schedule.frequency === 'weekly' && <label className="wf-field">On<select value={schedule.weekday ?? 1} onChange={(event) => set({ weekday: Number(event.target.value) })}>{['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((day, index) => <option key={day} value={index}>{day}</option>)}</select></label>}
      {schedule.frequency === 'monthly' && <label className="wf-field">Day<input type="number" min="1" max="31" value={schedule.dayOfMonth || 1} onChange={(event) => set({ dayOfMonth: Number(event.target.value) })} /></label>}
      <label className="wf-field">{schedule.frequency === 'hourly' ? 'Starting at' : 'At'}<input type="time" value={schedule.time || '09:00'} onChange={(event) => set({ time: event.target.value })} /></label>
      <label className="wf-field">Time zone<select value={schedule.timeZone || 'UTC'} onChange={(event) => set({ timeZone: event.target.value })}>{[...new Set([schedule.timeZone || 'UTC', ...TIME_ZONES])].map((zone) => <option key={zone} value={zone}>{zone.replace(/_/g, ' ')}</option>)}</select></label>
    </div>}
    <p className="wf-hint">{describeTrigger(trigger, programs, { desktop })}.</p>
  </fieldset>;
}

// Approval rules: Momentum and Priority chip rows per rule (fields ANDed), rules ORed, up to 4.
export function RuleBuilder({ rules = [], onChange }) {
  const toggle = (index, field, value) => onChange(rules.map((rule, at) => {
    if (at !== index) return rule;
    const now = new Set(list(rule[field])); if (now.has(value)) now.delete(value); else now.add(value);
    const next = { ...rule, [field]: [...now] }; if (!next[field].length) delete next[field];
    return next;
  }));
  const chips = (index, field, table, label) => <div className="wf-chip-row" role="group" aria-label={label}>
    <span className="wf-chip-label">{label}</span>
    {Object.entries(table).map(([value, text]) => <button key={value} type="button" className="wf-toggle" aria-pressed={list(rules[index][field]).includes(value)} onClick={() => toggle(index, field, value)}>{text}</button>)}
  </div>;
  return <div className="wf-rules">
    {rules.map((rule, index) => <div key={index} className="wf-rule">
      <div className="wf-rule-head"><strong>{index ? 'Or' : 'Approve trends that are'}</strong>{rules.length > 1 && <button type="button" className="studio-link" onClick={() => onChange(rules.filter((_, at) => at !== index))}>Remove rule</button>}</div>
      {chips(index, 'momentum', STEP_CATALOG.momentum, 'Momentum when found')}
      {chips(index, 'priority', STEP_CATALOG.priority, 'Priority')}
      {chips(index, 'velocity', STEP_CATALOG.velocity, 'Speed')}
    </div>)}
    {rules.length < LIMITS.rules && <button type="button" className="studio-quiet small" onClick={() => onChange([...rules, { priority: ['FAST-TRACK'] }])}><Plus size={14} aria-hidden="true" />Add another rule</button>}
  </div>;
}

// Channels for an assets step, plus the pictures switch (off with a reason when pictures aren't ready).
export function ChannelPicker({ channels = [], onChange, edition = 'general', viewer = {}, pictures = true, onPictures, imagesReady = true, settingsAllowed = false, label = 'Channels' }) {
  const options = focusChannelOptions(viewer?.channels ? viewer : {}, edition);
  const toggle = (id) => onChange(channels.includes(id) ? channels.filter((value) => value !== id) : [...channels, id]);
  return <fieldset className="wf-fieldset">
    <legend>{label}</legend>
    <div className="wf-chip-row" role="group" aria-label={label}>{options.map((channel) => <button key={channel.id} type="button" className="wf-toggle" aria-pressed={channels.includes(channel.id)} onClick={() => toggle(channel.id)}>{channel.name}</button>)}</div>
    {onPictures && <label className="wf-check"><input type="checkbox" checked={pictures && imagesReady} disabled={!imagesReady} onChange={(event) => onPictures(event.target.checked)} />Make pictures too{!imagesReady && <span className="wf-hint">{settingsAllowed ? ' · Turn on pictures in Settings' : ' · Pictures are off for your team'}</span>}</label>}
  </fieldset>;
}

function Counter({ value = '', max }) { return <span className={`wf-counter${value.length > max ? ' over' : ''}`}>{value.length} / {max}</span>; }

// One step's form.
function StepForm({ step, index, onChange, programs, edition, viewer, monday, imagesReady, settingsAllowed, problems }) {
  const set = (patch) => onChange({ ...step, ...patch });
  const errorFor = (field) => problems.find((problem) => problem.field === `steps.${index}.${field}` || (field === '' && problem.field === `steps.${index}`))?.message || '';
  switch (step.kind) {
    case 'research':
    case 'quick-scan': return <div className="wf-form">
      <label className="wf-field">{step.kind === 'research' ? 'Research program' : 'Read accounts from'}<select value={step.programId || ''} onChange={(event) => set({ programId: event.target.value })}>
        <option value="">Choose a program</option>{programs.map((program) => <option key={program.id} value={program.id}>{program.name}</option>)}
      </select>{errorFor('programId') && <span className="wf-error">{errorFor('programId')}</span>}</label>
      {step.kind === 'quick-scan' && <>
        <label className="wf-field">Topic<input value={step.scan?.topic || ''} maxLength={200} onChange={(event) => set({ scan: { ...step.scan, topic: event.target.value } })} />{errorFor('scan.topic') && <span className="wf-error">{errorFor('scan.topic')}</span>}</label>
        <label className="wf-field">Depth<select value={step.scan?.depth || 'lite'} onChange={(event) => set({ scan: { ...step.scan, depth: event.target.value } })}><option value="lite">Small and cheap</option><option value="standard">Balanced</option><option value="deep">Thorough</option></select></label>
        <label className="wf-field">Look back (hours)<input type="number" min="1" max="168" value={step.scan?.lookbackHours || 12} onChange={(event) => set({ scan: { ...step.scan, lookbackHours: Number(event.target.value) } })} /></label>
      </>}
    </div>;
    case 'approve': return <div className="wf-form">
      <div className="studio-segment" role="radiogroup" aria-label="How trends are approved">
        {Object.entries(STEP_CATALOG.approveModes).map(([mode, label]) => <button key={mode} type="button" aria-pressed={step.mode === mode} onClick={() => set({ mode, ...(mode === 'rules' && !list(step.rules).length ? { rules: [{ momentum: ['rising', 'new'], priority: ['FAST-TRACK', 'STRONG'] }] } : {}) })}>{label}</button>)}
      </div>
      {errorFor('mode') && <p className="wf-error">{errorFor('mode')}</p>}
      {step.mode === 'rules' && <>
        <RuleBuilder rules={list(step.rules)} onChange={(rules) => set({ rules })} />
        {errorFor('rules') && <p className="wf-error">{errorFor('rules')}</p>}
        <label className="wf-field">Approve at most<select value={step.maxApprove || 3} onChange={(event) => set({ maxApprove: Number(event.target.value) })}>{[1, 2, 3, 4, 5, 6].map((count) => <option key={count} value={count}>{count} {count === 1 ? 'trend' : 'trends'}</option>)}</select></label>
        <label className="wf-field">Trends that don’t meet the rules<select value={step.otherwise || 'review'} onChange={(event) => set({ otherwise: event.target.value })}><option value="review">Wait for someone’s OK</option><option value="skip">Skip them</option></select></label>
      </>}
      {step.mode !== 'all' && (step.mode === 'review' || step.otherwise !== 'skip') && <div className="wf-grid">
        <label className="wf-field">Wait for an OK<select value={step.waitHours || 48} onChange={(event) => set({ waitHours: Number(event.target.value) })}>{[4, 12, 24, 48, 72, 168, 336].map((hours) => <option key={hours} value={hours}>{hours % 24 ? `${hours} hours` : `${hours / 24} ${hours === 24 ? 'day' : 'days'}`}</option>)}</select></label>
        <label className="wf-field">Then<select value={step.afterWait || 'continue'} onChange={(event) => set({ afterWait: event.target.value })}><option value="continue">Skip the rest and carry on</option><option value="stop">Stop the run</option></select></label>
      </div>}
      <ChannelPicker label="Send approved trends to (none means every channel)" channels={list(step.channels)} onChange={(channels) => set({ channels })} edition={edition} viewer={viewer} />
      <label className="wf-field">Note for the channels<input value={step.note || ''} maxLength={LIMITS.noteChars} placeholder="Approved by rule: Rising · Strong" onChange={(event) => set({ note: event.target.value })} /><Counter value={step.note || ''} max={LIMITS.noteChars} /></label>
    </div>;
    case 'reports': return <p className="wf-hint">Writes a trends report and an editorial toolkit for each approved trend, with the research run’s own AI budget.</p>;
    case 'assets': return <div className="wf-form">
      <ChannelPicker channels={list(step.channels)} onChange={(channels) => set({ channels })} edition={edition} viewer={viewer} pictures={step.pictures !== false} onPictures={(pictures) => set({ pictures })} imagesReady={imagesReady} settingsAllowed={settingsAllowed} />
      {errorFor('channels') && <p className="wf-error">{errorFor('channels')}</p>}
      <label className="wf-field">Notes for channel assets<textarea rows={3} value={step.teamNotes || ''} maxLength={LIMITS.notesChars + 50} placeholder="Lead with the numbers. Keep social posts under 200 characters." onChange={(event) => set({ teamNotes: event.target.value })} /><Counter value={step.teamNotes || ''} max={LIMITS.notesChars} />{errorFor('teamNotes') && <span className="wf-error">{errorFor('teamNotes')}</span>}</label>
    </div>;
    case 'monday': return <div className="wf-form">
      {monday?.connected && monday?.link?.boardName ? <p className="wf-hint">Board: “{monday.link.boardName}”.</p> : <p className="wf-hint">{settingsAllowed ? 'Connect Monday.com in Settings. Until then this step is skipped.' : 'Ask an admin to connect Monday.com. Until then this step is skipped.'}</p>}
      <label className="wf-check"><input type="checkbox" checked={Boolean(step.alsoAtReview)} onChange={(event) => set({ alsoAtReview: event.target.checked })} />Also update it when trends are waiting for review</label>
    </div>;
    case 'notify': return <div className="wf-form">
      <div className="wf-chip-row" role="group" aria-label="Who to tell">{Object.entries(STEP_CATALOG.audiences).map(([id, label]) => <button key={id} type="button" className="wf-toggle" aria-pressed={list(step.audience).includes(id)} onClick={() => set({ audience: list(step.audience).includes(id) ? step.audience.filter((value) => value !== id) : [...list(step.audience), id] })}>{label}</button>)}</div>
      <label className="wf-check"><input type="checkbox" checked={Boolean(step.slackSummary)} onChange={(event) => set({ slackSummary: event.target.checked })} />Offer a summary to copy into Slack</label>
      <p className="wf-hint">Channel owners hear through the channels a trend is sent to.</p>
    </div>;
    default: return null;
  }
}

// The editor: name, trigger, the step rail with an inline form for the step being edited.
export function WorkflowEditor({ draft, onChange, programs = [], edition = 'general', viewer = {}, monday = null, imagesReady = true, settingsAllowed = false, problems = [], estimate = null, showCosts = false, desktop = false, focus = [] }) {
  const [editing, setEditing] = useState(null);
  const steps = list(draft.steps).map((step, index) => ({ ...step, id: step.id || `step-${index + 1}` }));
  const setSteps = (next) => onChange({ ...draft, steps: next });
  const ctx = { programs, edition, monday, imagesReady };
  const costs = useMemo(() => (showCosts && estimate?.steps ? Object.fromEntries(estimate.steps.map((row) => [row.stepId, row])) : null), [estimate, showCosts]);
  const source = steps[0]?.kind || 'research';
  const top = problems.filter((problem) => !/^steps\.\d+\./.test(problem.field));
  return <div className="wf-editor">
    <div className="wf-grid">
      <label className="wf-field">Name<input value={draft.name || ''} maxLength={LIMITS.nameChars} onChange={(event) => onChange({ ...draft, name: event.target.value })} placeholder="Weekly SEO watch" /></label>
      <label className="wf-field">What it’s for (optional)<input value={draft.description || ''} maxLength={LIMITS.descriptionChars} onChange={(event) => onChange({ ...draft, description: event.target.value })} /></label>
    </div>
    <TriggerFields trigger={draft.trigger || { kind: 'manual' }} onChange={(trigger) => onChange({ ...draft, trigger })} programs={programs} source={source} programId={steps[0]?.programId || ''} desktop={desktop} />
    {top.length > 0 && <ul className="wf-problems" role="alert">{top.map((problem) => <li key={problem.field + problem.message}>{problem.message}</li>)}</ul>}
    <StepRail steps={steps} editable ctx={ctx} costs={costs}
      onEdit={(index) => setEditing(editing === index ? null : index)}
      onRemove={(index) => { setSteps(steps.filter((_, at) => at !== index)); setEditing(null); }}
      onMove={(index, delta) => { const next = [...steps]; const [moved] = next.splice(index, 1); next.splice(index + delta, 0, moved); setSteps(next); setEditing(index + delta); }}
      onAdd={(kind) => { const next = [...steps]; const step = newStep(kind, { programId: steps[0]?.programId || '', focus }); const order = source === 'quick-scan' ? STEP_CATALOG.afterQuickScan : STEP_CATALOG.afterResearch; const at = next.findIndex((row, index) => index > 0 && order.indexOf(row.kind) > order.indexOf(kind)); if (at < 0) next.push(step); else next.splice(at, 0, step); setSteps(next); setEditing(at < 0 ? next.length - 1 : at); }} />
    {editing !== null && steps[editing] && <section className="wf-step-form" aria-label={`Edit ${stepLabel(steps[editing].kind)}`}>
      <div className="wf-step-form-head"><h3>{stepLabel(steps[editing].kind)}</h3><button type="button" className="studio-link" onClick={() => setEditing(null)}>Done</button></div>
      <StepForm step={steps[editing]} index={editing} onChange={(step) => setSteps(steps.map((row, at) => (at === editing ? step : row)))} programs={programs} edition={edition} viewer={viewer} monday={monday} imagesReady={imagesReady} settingsAllowed={settingsAllowed} problems={problems} />
    </section>}
  </div>;
}

// "Let “Weekly SEO watch” spend on its own?": the estimate lines, per-run and per-month budget fields (default: the
// caps, rounded up) and Approve budget and turn on.
export function BudgetDialog({ workflow = {}, estimate = {}, onApprove, onClose, busy = false, confirmLabel = 'Approve budget and turn on' }) {
  const titleId = useId();
  const [perRun, setPerRun] = useState(String(roundUp(workflow.budget?.perRunUsd || estimate.perRun?.capUsd)));
  const [perMonth, setPerMonth] = useState(String(roundUp(workflow.budget?.perMonthUsd || estimate.perMonth?.capUsd || (estimate.perRun?.capUsd || 0) * 5)));
  const run = Number(perRun); const month = Number(perMonth);
  const problem = !(run > 0) ? 'Choose a budget for each run.' : !(month >= run) ? 'The monthly budget needs to be at least one run’s.' : run < (estimate.steps?.[0]?.capUsd || 0) ? `Each run needs at least ${money(estimate.steps[0].capUsd)}: the first step alone can cost that much.` : '';
  return <Dialog labelledBy={titleId} onClose={onClose} closeDisabled={busy} className="wf-budget-dialog">
    <div className="studio-dialog-head"><h2 id={titleId}>Let “{workflow.name || 'this workflow'}” spend on its own?</h2><DialogClose onClose={onClose} disabled={busy} /></div>
    <div className="studio-dialog-body">
    <ul className="wf-lines">{budgetLines(estimate).map((line) => <li key={line}>{line}</li>)}</ul>
    {list(estimate.warnings).length > 0 && <ul className="wf-warnings">{estimate.warnings.map((line) => <li key={line}>{line}</li>)}</ul>}
    <div className="wf-grid">
      <label className="wf-field">Each run, at most ($)<input type="number" min="1" step="1" value={perRun} onChange={(event) => setPerRun(event.target.value)} /></label>
      <label className="wf-field">Each month, at most ($)<input type="number" min="1" step="1" value={perMonth} onChange={(event) => setPerMonth(event.target.value)} /></label>
    </div>
    {problem && <p className="wf-error" role="alert">{problem}</p>}
    </div>
    <div className="studio-dialog-foot">
      <button type="button" className="studio-quiet" onClick={onClose} disabled={busy}>Cancel</button>
      <button type="button" className="studio-primary" disabled={busy || Boolean(problem) || estimate.blocked} onClick={() => onApprove?.({ perRunUsd: run, perMonthUsd: month })}>{busy ? 'Saving…' : confirmLabel}</button>
    </div>
  </Dialog>;
}

// "Notes for the AI" for a research program (program.notes: { research, reports }, up to 600 characters each): added to
// the research prompts and to the trends report and editorial toolkit prompts after their instructions. For the program
// editor (program-editor.jsx); the Prompt Library stays the place for deep edits.
export function ProgramNotesFields({ draft = {}, setDraft, idPrefix = 'pn', onOpenPrompts }) {
  const notes = draft.notes || {};
  const set = (key, value) => setDraft({ ...draft, notes: { research: notes.research || '', reports: notes.reports || '', [key]: value } });
  return <details className="wf-notes">
    <summary>Notes for the AI</summary>
    <label className="wf-field" htmlFor={`${idPrefix}-notes-research`}>Notes for the research<textarea id={`${idPrefix}-notes-research`} rows={2} maxLength={LIMITS.notesChars + 50} value={notes.research || ''} onChange={(event) => set('research', event.target.value)} /><Counter value={notes.research || ''} max={LIMITS.notesChars} /></label>
    <label className="wf-field" htmlFor={`${idPrefix}-notes-reports`}>Notes for the writers<textarea id={`${idPrefix}-notes-reports`} rows={2} maxLength={LIMITS.notesChars + 50} value={notes.reports || ''} onChange={(event) => set('reports', event.target.value)} /><Counter value={notes.reports || ''} max={LIMITS.notesChars} /></label>
    <p className="wf-hint">They never override the studio’s rules.{onOpenPrompts ? <> For deeper changes, <button type="button" className="studio-link" onClick={onOpenPrompts}>open the full prompts</button>.</> : ''}</p>
  </details>;
}
